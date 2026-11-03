// Stockage du classement dans Vercel Blob : un simple fichier JSON, pas de base de données.
// Les écritures sont conditionnelles (ETag) : si deux scores arrivent en même temps,
// le second relit le fichier et réessaie, donc aucun score n'est perdu.
import { get, put, BlobPreconditionFailedError } from '@vercel/blob';
import { emptyBoard, normalizeBoard } from './leaderboard.js';

const PATHNAME = 'mahjong/leaderboard.json';
// Un « store » Blob est public ou privé selon le choix fait à sa création : on s'adapte tout seul.
let access = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

export const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function withAccess(fn) {
  try {
    return await fn(access);
  } catch (e) {
    if (!/access|private|public/i.test(String(e && e.message))) throw e;
    access = access === 'private' ? 'public' : 'private';
    return fn(access);
  }
}

async function read() {
  const res = await withAccess((a) => get(PATHNAME, { access: a, useCache: false }));
  if (!res || res.statusCode !== 200 || !res.stream) return { board: emptyBoard(), etag: null };
  const text = await new Response(res.stream).text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* fichier abîmé : on repart de zéro */ }
  return { board: normalizeBoard(data), etag: res.blob.etag };
}

export async function readBoard() {
  return (await read()).board;
}

// Applique « mutate » au classement puis l'enregistre. Renvoie ce que « mutate » renvoie.
export async function updateBoard(mutate) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { board, etag } = await read();
    const result = mutate(board);
    try {
      await withAccess((a) =>
        put(PATHNAME, JSON.stringify(board), {
          access: a,
          contentType: 'application/json',
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          // Fichier existant : on n'écrase que la version qu'on a lue (ETag).
          // Premier score : création seulement, échoue si quelqu'un l'a créé entre-temps.
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        })
      );
      return result;
    } catch (e) {
      const createRace = !etag && /exist/i.test(String(e && e.message));
      if (e instanceof BlobPreconditionFailedError || createRace) {
        await new Promise((r) => setTimeout(r, 80 + Math.random() * 200));
        continue; // quelqu'un a écrit entre-temps : on relit et on réessaie
      }
      throw e;
    }
  }
  throw new Error('Trop de conflits d’écriture, réessaie.');
}
