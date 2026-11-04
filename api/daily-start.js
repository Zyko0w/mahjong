// POST /api/daily-start — enregistre le lancement du défi du jour (une seule partie par pseudo et par jour)
import { startDailyAttempt } from '../lib/leaderboard.js';
import { blobConfigured, blobEnvHint, updateBoard } from '../lib/blob-store.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!blobConfigured()) return res.status(503).json({ error: 'Classement non configuré : aucun store Vercel Blob relié à ce déploiement. ' + blobEnvHint() });
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  } catch {
    return res.status(400).json({ error: 'Données invalides' });
  }
  try {
    const result = await updateBoard((board) => startDailyAttempt(board, body));
    return res.status(200).json(result);
  } catch (e) {
    if (e && e.status) return res.status(e.status).json({ error: e.message });
    console.error('daily-start', e);
    return res.status(500).json({ error: 'Lancement du défi impossible : ' + (e && e.message ? e.message : e) });
  }
}
