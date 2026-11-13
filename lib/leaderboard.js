// Logique du classement, partagée entre server.js (fichier local) et les fonctions Vercel (Vercel Blob).
// Fonctions pures : elles prennent et modifient un objet « board », le stockage est géré ailleurs.
import { LAYOUTS as LAYOUT_DEFS } from '../public/js/layouts.js';
import { DIFFICULTIES, VARIANTS, CATEGORIES, categoryOf, replayLog, dailyChallenge, parisDate, shiftDate } from '../public/js/rules.js';

export { DIFFICULTIES, CATEGORIES };
export const LAYOUTS = Object.keys(LAYOUT_DEFS);
const DAILY_KEEP = 7; // jours de défi conservés
// Classement des duels : un par plateau et par difficulté, plus « all » (tous les plateaux) par difficulté
export const DUEL_CATEGORIES = ['all', ...Object.keys(LAYOUT_DEFS)].flatMap((l) => Object.values(DIFFICULTIES).map((d) => l + d.suffix));
export function duelCategory(layout, difficulty) {
  return (LAYOUTS.includes(layout) ? layout : 'all') + DIFFICULTIES[cleanDifficulty(difficulty)].suffix;
}

// Erreur avec un code HTTP (409 = déjà joué, 403 = défi non commencé…)
function httpError(message, status) {
  const e = new Error(message);
  e.status = status;
  return e;
}

export function cleanDifficulty(d, legacyHardcore) {
  if (typeof d === 'string' && DIFFICULTIES[d]) return d;
  return legacyHardcore === true ? 'hardcore' : 'normal';
}
const MAX_ENTRIES = 100;

export function emptyBoard() {
  const b = { duel: {}, daily: {}, dailyPlayed: {} };
  for (const c of CATEGORIES) b[c] = [];
  return b;
}

// Complète un classement lu depuis le stockage (nouvelles formes ajoutées depuis, etc.)
export function normalizeBoard(data) {
  const b = emptyBoard();
  if (data && typeof data === 'object') {
    for (const c of CATEGORIES) if (Array.isArray(data[c])) b[c] = data[c];
    if (data.duel && typeof data.duel === 'object') {
      // Ancien format (un seul classement de duel, sans plateau ni difficulté) : rangé dans « Tous les plateaux »
      const legacy = Object.values(data.duel).some((v) => v && typeof v.wins === 'number');
      b.duel = legacy ? { all: data.duel } : data.duel;
    }
    if (data.daily && typeof data.daily === 'object') b.daily = data.daily;
    if (data.dailyPlayed && typeof data.dailyPlayed === 'object') b.dailyPlayed = data.dailyPlayed;
  }
  return b;
}

export function cleanPseudo(raw) {
  if (typeof raw !== 'string') return null;
  const p = raw.normalize('NFC').replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return p.length >= 2 ? p : null;
}

// Vérifie une partie envoyée par le navigateur : le serveur REJOUE la liste des coups
// sur la même donne et recalcule lui-même le score. Renvoie l'entrée à enregistrer, ou lève une erreur.
export function parseScore(d, now = new Date()) {
  if (!d || typeof d !== 'object') throw new Error('body');
  const pseudo = cleanPseudo(d.pseudo);
  if (!pseudo) throw new Error('pseudo');
  let params;
  let daily = null;
  if (typeof d.daily === 'string') {
    // Défi du jour : le serveur impose lui-même plateau, donne et mode (aujourd'hui ou hier, pour les parties à cheval sur minuit)
    const today = parisDate(now);
    if (d.daily !== today && d.daily !== shiftDate(today, -1)) throw new Error('défi expiré');
    daily = d.daily;
    params = dailyChallenge(daily);
  } else {
    const seed = Number(d.seed);
    if (!Number.isInteger(seed) || seed < 0 || seed >= 2 ** 31) throw new Error('seed');
    params = { layout: d.layout, seed, difficulty: cleanDifficulty(d.difficulty, d.hardcore), variant: d.variant };
  }
  if (!VARIANTS[params.variant] || !VARIANTS[params.variant].scored) throw new Error('variant');
  const category = daily ? 'daily' : categoryOf(params.layout, params.variant, params.difficulty);
  if (!LAYOUTS.includes(params.layout) || !category) throw new Error('layout');
  const { run, endT, result } = replayLog({ ...params, log: d.log, end: d.end });
  const time = endT / 1000;
  if (!(time >= 15 && time < 36000)) throw new Error('time');
  return { pseudo, category, daily, time, moves: run.moves, score: result.score, hints: run.hints, shuffles: run.shuffles, cleared: result.cleared, remaining: run.game.remaining };
}

function pruneDays(obj) {
  const days = Object.keys(obj).sort();
  for (const old of days.slice(0, Math.max(0, days.length - DAILY_KEEP))) delete obj[old];
}

// Défi du jour : une seule partie par pseudo et par jour. Appelé au LANCEMENT de la partie :
// quitter ou recharger la page consomme quand même l'essai.
export function startDailyAttempt(board, d, now = new Date()) {
  const pseudo = cleanPseudo(d && d.pseudo);
  if (!pseudo) throw httpError('Pseudo invalide.', 400);
  // La date fait foi côté serveur : une horloge locale décalée ne doit pas donner un autre défi
  const today = parisDate(now);
  board.dailyPlayed ||= {};
  const day = (board.dailyPlayed[today] ||= {});
  const key = pseudo.toLowerCase();
  if (day[key]) throw httpError(`${pseudo} a déjà joué le défi du jour. Le prochain arrive à minuit !`, 409);
  day[key] = Date.now();
  pruneDays(board.dailyPlayed);
  return { ok: true, date: today };
}

function insertBest(list, entry) {
  const key = entry.pseudo.toLowerCase();
  const idx = list.findIndex((e) => e.pseudo.toLowerCase() === key);
  let improved = true;
  if (idx >= 0) {
    const old = list[idx];
    if (old.score > entry.score || (old.score === entry.score && old.time <= entry.time)) improved = false;
    else list.splice(idx, 1);
  }
  if (improved) list.push(entry);
  list.sort((a, b) => b.score - a.score || a.time - b.time || a.date - b.date);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  const rank = list.findIndex((e) => e.pseudo.toLowerCase() === key) + 1;
  return { rank: rank || null, improved };
}

// Garde le meilleur score de chaque pseudo dans la catégorie. Renvoie { rank, improved, score }.
export function submitSolo(board, { pseudo, category, daily, time, moves, score, hints, shuffles, remaining }) {
  const entry = { pseudo, time: Math.round(time * 10) / 10, moves, score, hints, shuffles, date: Date.now() };
  if (remaining) entry.remaining = remaining;
  let list;
  if (category === 'daily') {
    const key = pseudo.toLowerCase();
    if (!(board.dailyPlayed && board.dailyPlayed[daily] && board.dailyPlayed[daily][key])) throw httpError("Ce défi n'a pas été lancé depuis le jeu.", 403);
    board.daily ||= {};
    list = board.daily[daily] ||= [];
    if (list.some((e) => e.pseudo.toLowerCase() === key)) throw httpError('Ton résultat du défi du jour est déjà enregistré.', 409);
    pruneDays(board.daily);
  } else list = board[category];
  return { ...insertBest(list, entry), score };
}

// Compte le duel dans le classement de son plateau + difficulté, et dans « tous les plateaux » de la difficulté
export function recordDuel(board, winner, loser, time, layout, difficulty) {
  const diff = cleanDifficulty(difficulty);
  const cats = [...new Set([duelCategory(layout, diff), duelCategory('all', diff)])];
  for (const cat of cats) {
    const table = (board.duel[cat] ||= {});
    for (const [name, won] of [[winner, true], [loser, false]]) {
      const clean = cleanPseudo(name) || 'Joueur';
      const key = clean.toLowerCase();
      const s = table[key] || { pseudo: clean, wins: 0, losses: 0, best: null };
      s.pseudo = clean;
      if (won) {
        s.wins++;
        if (time && (s.best === null || time < s.best)) s.best = Math.round(time * 10) / 10;
      } else s.losses++;
      table[key] = s;
    }
  }
}

export function publicBoard(board, now = new Date()) {
  const duel = {};
  for (const cat of DUEL_CATEGORIES) {
    duel[cat] = Object.values(board.duel[cat] || {})
      .sort((a, b) => b.wins - a.wins || a.losses - b.losses || (a.best ?? 1e9) - (b.best ?? 1e9))
      .slice(0, 50);
  }
  const today = parisDate(now), yesterday = shiftDate(today, -1);
  const daily = {};
  for (const day of [today, yesterday]) daily[day] = ((board.daily || {})[day] || []).slice(0, 50);
  const out = { duel, daily, today };
  for (const c of CATEGORIES) out[c] = (board[c] || []).slice(0, 50);
  return out;
}
