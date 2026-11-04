// POST /api/score — enregistre un score solo (fonction Vercel)
import { parseScore, submitSolo } from '../lib/leaderboard.js';
import { blobConfigured, blobEnvHint, updateBoard } from '../lib/blob-store.js';

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    if (req.body.length > 131072) throw new Error('trop long');
    return JSON.parse(req.body);
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!blobConfigured()) return res.status(503).json({ error: 'Classement non configuré : aucun store Vercel Blob relié à ce déploiement. ' + blobEnvHint() });
  let entry;
  try {
    entry = parseScore(readBody(req));
  } catch (e) {
    return res.status(400).json({ error: 'Partie refusée par le serveur (' + (e && e.message ? e.message : 'données invalides') + ').' });
  }
  try {
    const result = await updateBoard((board) => submitSolo(board, entry));
    return res.status(200).json(result);
  } catch (e) {
    console.error('score', e);
    return res.status(500).json({ error: 'Enregistrement impossible : ' + (e && e.message ? e.message : e) });
  }
}
