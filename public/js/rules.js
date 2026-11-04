// Règles d'une partie : score, combos, pénalités, chrono du contre-la-montre, défi du jour.
// Ce fichier est partagé : le navigateur s'en sert pendant la partie, le serveur pour REJOUER
// la liste des coups envoyée à la fin et recalculer lui-même le score (anti-triche).
// Tous les temps sont en millisecondes entières, pour que les deux côtés calculent exactement pareil.
import { MahjongGame, LAYOUTS } from './game.js';

// Difficultés : indices autorisés, nombre de mélanges, multiplicateur, suffixe de classement
export const DIFFICULTIES = {
  normal: { suffix: '', hints: true, shuffles: Infinity, mult: 1 },
  hardcore: { suffix: '_hc', hints: false, shuffles: 2, mult: 1.5 },
  samurai: { suffix: '_sm', hints: false, shuffles: 0, mult: 2 },
};

// Modes de jeu solo. suffix = null : mode non classé.
export const VARIANTS = {
  classic: { suffix: '', mult: 1, scored: true },
  timeattack: { suffix: '_ta', mult: 1, scored: true, timed: true },
  blind: { suffix: '_bl', mult: 1.25, scored: true, blind: true },
  zen: { suffix: null, mult: 1, scored: false, zen: true },
};
export const RANKED_VARIANTS = Object.keys(VARIANTS).filter((v) => VARIANTS[v].suffix !== null);

export const PENALTY = { hint: 30, shuffle: 80, undo: 20 };
export const COMBO_WINDOW = 5000;
export const MIN_MATCH_GAP = 150; // deux paires ne peuvent pas être jouées à moins de 150 ms d'écart
// Contre la montre : temps de départ selon la taille du plateau, secondes gagnées par paire et par combo
export const TIME_ATTACK = { perTile: 800, min: 60000, perPair: 4000, perCombo: 1000, perSecondLeft: 10 };

export const diffKey = (d) => (DIFFICULTIES[d] ? d : 'normal');
export const variantKey = (v) => (VARIANTS[v] ? v : 'classic');

export function categoryOf(layout, variant, difficulty) {
  const V = VARIANTS[variantKey(variant)];
  if (V.suffix === null) return null;
  return layout + V.suffix + DIFFICULTIES[diffKey(difficulty)].suffix;
}

export const CATEGORIES = Object.keys(LAYOUTS).flatMap((l) =>
  RANKED_VARIANTS.flatMap((v) => Object.keys(DIFFICULTIES).map((d) => categoryOf(l, v, d)))
);

// Une partie en cours : la donne, le score et le journal des coups.
export class Run {
  constructor({ layout, seed, difficulty = 'normal', variant = 'classic', penalties = true }) {
    this.layout = layout;
    this.L = LAYOUTS[layout];
    this.seed = seed;
    this.difficulty = diffKey(difficulty);
    this.variantName = variantKey(variant);
    this.V = VARIANTS[this.variantName];
    // Le zen ignore la difficulté : tout est permis
    this.D = this.V.zen ? DIFFICULTIES.normal : DIFFICULTIES[this.difficulty];
    this.penalties = penalties && this.V.scored;
    this.game = new MahjongGame(layout, seed);
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.lastMatch = -Infinity;
    this.moves = 0;
    this.hints = 0;
    this.shuffles = 0;
    this.undos = 0;
    this.bonusTime = 0;
    this.lastT = 0;
    this.log = [];
  }

  get hintsAllowed() { return this.D.hints; }
  get shufflesAllowed() { return this.D.shuffles; }
  get timed() { return !!this.V.timed; }
  get startTime() { return this.timed ? Math.max(TIME_ATTACK.min, this.game.total * TIME_ATTACK.perTile) : Infinity; }
  deadline() { return this.startTime + this.bonusTime; }
  timeLeft(t) { return this.deadline() - t; }
  expired(t) { return this.timed && t >= this.deadline(); }

  _stamp(t, ...entry) {
    t = Math.max(this.lastT, Math.round(t));
    this.lastT = t;
    this.log.push([t, ...entry]);
    return t;
  }

  _penalty(k) { if (this.penalties) this.score = Math.max(0, this.score - PENALTY[k]); }

  // Renvoie { pts, mult, gain } ou null si le coup est refusé
  match(t, a, b) {
    t = Math.max(this.lastT, Math.round(t));
    if (this.expired(t) || !this.game.match(a, b)) return null;
    this._stamp(t, 0, a, b);
    this.moves++;
    this.combo = t - this.lastMatch < COMBO_WINDOW ? this.combo + 1 : 1;
    this.lastMatch = t;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    const mult = Math.min(this.combo, 5);
    const pts = this.V.scored ? 20 * mult : 0;
    this.score += pts;
    let gain = 0;
    if (this.timed) {
      gain = TIME_ATTACK.perPair + (mult - 1) * TIME_ATTACK.perCombo;
      this.bonusTime += gain;
    }
    return { pts, mult, gain };
  }

  hint(t) {
    if (!this.hintsAllowed || this.expired(Math.round(t))) return null;
    const h = this.game.hint();
    if (!h) return null;
    this._stamp(t, 2);
    this.hints++;
    this._penalty('hint');
    return h;
  }

  shuffle(t) {
    if (this.shuffles >= this.shufflesAllowed || this.expired(Math.round(t))) return null;
    const ids = this.game.shuffle();
    this._stamp(t, 3);
    this.shuffles++;
    this.combo = 0;
    this._penalty('shuffle');
    return ids;
  }

  undo(t) {
    if (this.expired(Math.round(t))) return null;
    const last = this.game.undo();
    if (!last) return null;
    this._stamp(t, 1);
    this.undos++;
    this.moves++;
    this.combo = 0;
    this._penalty('undo');
    return last;
  }

  // Score final, à la fin de la partie (t = fin en ms)
  finish(t) {
    const cleared = this.game.remaining === 0;
    if (!this.V.scored) return { score: 0, timeBonus: 0, cleared };
    const mult = this.D.mult * this.V.mult;
    let timeBonus = 0, endBonus = 0;
    if (this.timed) {
      if (cleared) {
        endBonus = this.L.bonus;
        timeBonus = Math.floor(Math.max(0, this.timeLeft(t)) / 1000) * TIME_ATTACK.perSecondLeft;
      }
    } else {
      endBonus = this.L.bonus;
      timeBonus = Math.max(0, Math.round((this.L.par - t / 1000) * 5));
    }
    return { score: Math.round((this.score + endBonus + timeBonus) * mult), timeBonus, cleared };
  }
}

// Rejoue un journal de coups envoyé par le navigateur. Lève une erreur si un coup est impossible.
// Renvoie la partie rejouée, l'heure de fin (ms) et le score recalculé.
export function replayLog({ layout, seed, difficulty, variant, log, end }) {
  if (!LAYOUTS[layout]) throw new Error('layout');
  if (!Array.isArray(log) || log.length > 4000) throw new Error('log');
  const run = new Run({ layout, seed, difficulty, variant });
  let prev = 0, prevMatch = -Infinity;
  for (const e of log) {
    if (!Array.isArray(e)) throw new Error('entrée');
    const [t, k, a, b] = e;
    if (!Number.isInteger(t) || t < prev || t > 36e6) throw new Error('temps');
    prev = t;
    let ok;
    if (k === 0) {
      if (!Number.isInteger(a) || !Number.isInteger(b)) throw new Error('tuiles');
      if (t - prevMatch < MIN_MATCH_GAP) throw new Error('trop rapide');
      prevMatch = t;
      ok = run.match(t, a, b);
    } else if (k === 1) ok = run.undo(t);
    else if (k === 2) ok = run.hint(t);
    else if (k === 3) ok = run.shuffle(t);
    else throw new Error('action');
    if (!ok) throw new Error('coup impossible');
  }
  const cleared = run.game.remaining === 0;
  let endT;
  if (run.timed) endT = cleared ? prev : Math.min(run.deadline(), Math.max(prev, Math.round(Number(end) || 0)));
  else {
    if (!cleared) throw new Error('plateau non vidé');
    endT = prev;
  }
  return { run, endT, result: run.finish(endT) };
}

// ---------------------------------------------------------------- défi du jour
// Même plateau, même donne et même mode pour tout le monde, changés chaque jour à minuit (heure de Paris).
function fnv(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export function parisDate(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDate(date, days) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const DAILY_VARIANTS = ['classic', 'blind', 'timeattack'];
export function dailyChallenge(date = parisDate()) {
  const keys = Object.keys(LAYOUTS);
  const h = fnv('mj-daily:' + date);
  return {
    date,
    layout: keys[h % keys.length],
    seed: fnv('mj-seed:' + date) & 0x7fffffff,
    variant: DAILY_VARIANTS[(h >>> 8) % DAILY_VARIANTS.length],
    difficulty: 'normal',
  };
}
