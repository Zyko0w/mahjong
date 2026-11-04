// Stockage du classement dans Vercel Blob : un simple fichier JSON, pas de base de données.
// Les écritures sont conditionnelles (ETag) : si deux scores arrivent en même temps,
// le second relit le fichier et réessaie, donc aucun score n'est perdu.
import { get, head, put, BlobNotFoundError, BlobPreconditionFailedError } from '@vercel/blob';
import { emptyBoard, normalizeBoard } from './leaderboard.js';

const PATHNAME = 'mahjong/leaderboard.json';
// Un « store » Blob est public ou privé selon le choix fait à sa création : on s'adapte tout seul.
let access = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

// Identifiants Blob. Vercel peut en fournir de deux sortes, selon la façon dont le store a été connecté :
//  - BLOB_READ_WRITE_TOKEN (jeton « vercel_blob_rw_… »)
//  - BLOB_STORE_ID + jeton OIDC fourni automatiquement aux fonctions (connexion récente, sans jeton)
// Si un préfixe personnalisé a été choisi à la connexion (ex. MAHJONG_READ_WRITE_TOKEN), on le retrouve aussi.
function findCredentials() {
  const env = process.env;
  let token = env.BLOB_READ_WRITE_TOKEN || '';
  let storeId = env.BLOB_STORE_ID || '';
  for (const [k, v] of Object.entries(env)) {
    if (!token && typeof v === 'string' && v.startsWith('vercel_blob_rw_')) token = v;
    if (!storeId && /STORE_ID$/.test(k) && typeof v === 'string' && v.startsWith('store_')) storeId = v;
  }
  if (token) return { token };
  if (storeId) return { storeId };
  return null;
}

const creds = findCredentials();
export const blobConfigured = () => Boolean(creds);

// Aide au diagnostic : noms des variables liées à Blob (jamais leurs valeurs)
export function blobEnvHint() {
  const names = Object.keys(process.env).filter((k) => /BLOB|STORE_ID|READ_WRITE_TOKEN/i.test(k));
  return names.length ? `Variables trouvées : ${names.join(', ')}.` : 'Aucune variable BLOB_… dans cet environnement.';
}

async function withAccess(fn) {
  try {
    return await fn(access);
  } catch (e) {
    if (!/access|private|public/i.test(String(e && e.message))) throw e;
    access = access === 'private' ? 'public' : 'private';
    return fn(access);
  }
}

// Les ETag peuvent arriver entre guillemets ou en « W/… » selon la source : on compare la valeur brute.
const bareEtag = (e) => String(e || '').replace(/^W\//, '').replace(/"/g, '');

// Lecture fraîche du classement. Deux pièges évités ici :
//  - un store public est servi par le CDN (cache 60 s) : « useCache: false » n'a d'effet que sur un
//    store privé. Lire via le CDN renvoyait donc un fichier ET un ETag périmés pendant une minute,
//    et chaque écriture conditionnelle échouait (« trop de conflits d'écriture »), y compris les duels.
//  - on prend l'ETag de référence via head() (API, jamais en cache) puis on vérifie que le contenu
//    téléchargé correspond bien à cette version avant de s'en servir.
async function read() {
  for (let attempt = 0; attempt < 4; attempt++) {
    let meta;
    try {
      meta = await head(PATHNAME, { ...creds });
    } catch (e) {
      if (e instanceof BlobNotFoundError) return { board: emptyBoard(), etag: null };
      throw e;
    }
    const url = new URL(meta.url);
    url.searchParams.set('v', Date.now().toString(36) + Math.random().toString(36).slice(2, 6)); // contourne le cache CDN
    const res = await withAccess((a) => get(url.toString(), { access: a, useCache: false, ...creds }));
    if (!res || res.statusCode !== 200 || !res.stream) return { board: emptyBoard(), etag: null };
    const text = await new Response(res.stream).text();
    const gotEtag = bareEtag(res.blob.etag);
    if (gotEtag && gotEtag !== bareEtag(meta.etag)) {
      // contenu d'une autre version (écriture en cours ou cache) : on relit
      await new Promise((r) => setTimeout(r, 100 + Math.random() * 150));
      continue;
    }
    let data = null;
    try { data = JSON.parse(text); } catch { /* fichier abîmé : on repart de zéro */ }
    return { board: normalizeBoard(data), etag: meta.etag };
  }
  throw new BlobPreconditionFailedError();
}

export async function readBoard() {
  return (await read()).board;
}

// Applique « mutate » au classement puis l'enregistre. Renvoie ce que « mutate » renvoie.
export async function updateBoard(mutate) {
  for (let attempt = 0; attempt < 8; attempt++) {
    let board, etag;
    try {
      ({ board, etag } = await read());
    } catch (e) {
      if (!(e instanceof BlobPreconditionFailedError)) throw e;
      await new Promise((r) => setTimeout(r, 100 * (attempt + 1) + Math.random() * 200));
      continue;
    }
    const result = mutate(board);
    try {
      await withAccess((a) =>
        put(PATHNAME, JSON.stringify(board), {
          access: a,
          contentType: 'application/json',
          addRandomSuffix: false,
          cacheControlMaxAge: 60,
          ...creds,
          // Fichier existant : on n'écrase que la version qu'on a lue (ETag).
          // Premier score : création seulement, échoue si quelqu'un l'a créé entre-temps.
          ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
        })
      );
      return result;
    } catch (e) {
      const createRace = !etag && /exist/i.test(String(e && e.message));
      if (e instanceof BlobPreconditionFailedError || createRace) {
        await new Promise((r) => setTimeout(r, 100 * (attempt + 1) + Math.random() * 200));
        continue; // quelqu'un a écrit entre-temps : on relit et on réessaie
      }
      throw e;
    }
  }
  throw new Error('Trop de conflits d’écriture, réessaie.');
}
