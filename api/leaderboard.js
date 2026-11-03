// GET /api/leaderboard — classement complet (fonction Vercel)
import { publicBoard } from '../lib/leaderboard.js';
import { blobConfigured, readBoard } from '../lib/blob-store.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Méthode non autorisée' });
  if (!blobConfigured()) return res.status(503).json({ error: 'Classement non configuré : ajoute un store Vercel Blob au projet.' });
  try {
    const board = await readBoard();
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(publicBoard(board));
  } catch (e) {
    console.error('leaderboard', e);
    return res.status(500).json({ error: 'Lecture du classement impossible' });
  }
}
