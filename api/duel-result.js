// POST /api/duel-result — appelé par le serveur de duel (Railway/Render) à la fin de chaque duel.
// Protégé par une clé partagée : variable DUEL_SECRET, identique des deux côtés.
import crypto from 'node:crypto';
import { cleanPseudo, recordDuel } from '../lib/leaderboard.js';
import { blobConfigured, blobEnvHint, updateBoard } from '../lib/blob-store.js';

function sameSecret(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  const secret = process.env.DUEL_SECRET;
  const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!secret || !sameSecret(auth, secret)) return res.status(401).json({ error: 'Non autorisé' });
  if (!blobConfigured()) return res.status(503).json({ error: 'Classement non configuré : aucun store Vercel Blob relié à ce déploiement. ' + blobEnvHint() });
  let d;
  try {
    d = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    return res.status(400).json({ error: 'Données invalides' });
  }
  const winner = cleanPseudo(d.winner), loser = cleanPseudo(d.loser);
  const time = Number(d.time) > 0 && Number(d.time) < 36000 ? Number(d.time) : null;
  if (!winner || !loser) return res.status(400).json({ error: 'Données invalides' });
  try {
    await updateBoard((board) => recordDuel(board, winner, loser, time));
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('duel-result', e);
    return res.status(500).json({ error: 'Enregistrement impossible : ' + (e && e.message ? e.message : e) });
  }
}
