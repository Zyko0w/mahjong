// Logique du classement, partagée entre server.js (fichier local) et les fonctions Vercel (Vercel Blob).
// Fonctions pures : elles prennent et modifient un objet « board », le stockage est géré ailleurs.
import { LAYOUTS as LAYOUT_DEFS } from '../public/js/layouts.js';

export const LAYOUTS = Object.keys(LAYOUT_DEFS);
// Difficultés : mélanges autorisés et suffixe de la catégorie de classement
export const DIFFICULTIES = {
  normal: { suffix: '', hints: true, shuffles: Infinity },
  hardcore: { suffix: '_hc', hints: false, shuffles: 2 },
  samurai: { suffix: '_sm', hints: false, shuffles: 0 },
};
// Une catégorie par forme et par difficulté : 'chat', 'chat_hc' (hardcore), 'chat_sm' (samouraï)
export const CATEGORIES = LAYOUTS.flatMap((l) => Object.values(DIFFICULTIES).map((d) => l + d.suffix));
export const HARDCORE_SHUFFLES = 2;

export function cleanDifficulty(d, legacyHardcore) {
  if (typeof d === 'string' && DIFFICULTIES[d]) return d;
  return legacyHardcore === true ? 'hardcore' : 'normal';
}
const MAX_ENTRIES = 100;

export function emptyBoard() {
  const b = { duel: {} };
  for (const c of CATEGORIES) b[c] = [];
  return b;
}

// Complète un classement lu depuis le stockage (nouvelles formes ajoutées depuis, etc.)
export function normalizeBoard(data) {
  const b = emptyBoard();
  if (data && typeof data === 'object') {
    for (const c of CATEGORIES) if (Array.isArray(data[c])) b[c] = data[c];
    if (data.duel && typeof data.duel === 'object') b.duel = data.duel;
  }
  return b;
}

export function cleanPseudo(raw) {
  if (typeof raw !== 'string') return null;
  const p = raw.normalize('NFC').replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return p.length >= 2 ? p : null;
}

// Vérifie un score envoyé par le navigateur. Renvoie l'entrée à enregistrer, ou lève une erreur.
export function parseScore(d) {
  if (!d || typeof d !== 'object') throw new Error('body');
  const pseudo = cleanPseudo(d.pseudo);
  const layout = LAYOUTS.includes(d.layout) ? d.layout : null;
  const time = Number(d.time);
  const moves = Math.floor(Number(d.moves));
  const score = Math.floor(Number(d.score));
  const hints = Math.max(0, Math.floor(Number(d.hints) || 0));
  const shuffles = Math.max(0, Math.floor(Number(d.shuffles) || 0));
  const difficulty = cleanDifficulty(d.difficulty, d.hardcore);
  const rules = DIFFICULTIES[difficulty];
  if (!pseudo || !layout) throw new Error('pseudo/layout');
  if (!(time >= 15 && time < 36000)) throw new Error('time');
  if (!(moves >= 1 && moves < 5000)) throw new Error('moves');
  if (!(score >= 0 && score <= 40000)) throw new Error('score');
  // Le serveur vérifie les règles de la difficulté : pas d'indice, pas trop de mélanges
  if ((!rules.hints && hints > 0) || shuffles > rules.shuffles) throw new Error('difficulty');
  return { pseudo, category: layout + rules.suffix, time, moves, score, hints, shuffles };
}

// Garde le meilleur score de chaque pseudo dans la catégorie. Renvoie { rank, improved }.
export function submitSolo(board, { pseudo, category, time, moves, score, hints, shuffles }) {
  const list = board[category];
  const entry = { pseudo, time: Math.round(time * 10) / 10, moves, score, hints, shuffles, date: Date.now() };
  const key = pseudo.toLowerCase();
  const idx = list.findIndex((e) => e.pseudo.toLowerCase() === key);
  let improved = true;
  if (idx >= 0) {
    const old = list[idx];
    if (old.score > score || (old.score === score && old.time <= entry.time)) improved = false;
    else list.splice(idx, 1);
  }
  if (improved) list.push(entry);
  list.sort((a, b) => b.score - a.score || a.time - b.time || a.date - b.date);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  const rank = list.findIndex((e) => e.pseudo.toLowerCase() === key) + 1;
  return { rank: rank || null, improved };
}

export function recordDuel(board, winner, loser, time) {
  for (const [name, won] of [[winner, true], [loser, false]]) {
    const clean = cleanPseudo(name) || 'Joueur';
    const key = clean.toLowerCase();
    const s = board.duel[key] || { pseudo: clean, wins: 0, losses: 0, best: null };
    s.pseudo = clean;
    if (won) {
      s.wins++;
      if (time && (s.best === null || time < s.best)) s.best = Math.round(time * 10) / 10;
    } else s.losses++;
    board.duel[key] = s;
  }
}

export function publicBoard(board) {
  const duel = Object.values(board.duel)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || (a.best ?? 1e9) - (b.best ?? 1e9))
    .slice(0, 50);
  const out = { duel };
  for (const c of CATEGORIES) out[c] = (board[c] || []).slice(0, 50);
  return out;
}
