// Mahjong 3D — serveur Node : fichiers du jeu + API classement (fichier JSON) + duel en WebSocket.
// En local il fait tout. En production avec Vercel, il sert uniquement de serveur de duel
// (Railway, Render…) et envoie les résultats au classement Vercel (voir README).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { LAYOUTS, cleanDifficulty, emptyBoard, normalizeBoard, cleanPseudo, parseScore, submitSolo, recordDuel, publicBoard, startDailyAttempt } from './lib/leaderboard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const LUCIDE_DIR = path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
// Mode « serveur de duel » : les résultats partent vers le classement du site Vercel
const LEADERBOARD_URL = (process.env.LEADERBOARD_URL || '').replace(/\/+$/, '');
const DUEL_SECRET = process.env.DUEL_SECRET || '';
// Sites autorisés à se connecter au duel (ex. https://mon-mahjong.vercel.app), séparés par des virgules
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
};

// ---------------------------------------------------------------- classement (fichier local)
function loadBoard() {
  try {
    return normalizeBoard(JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')));
  } catch {
    return emptyBoard();
  }
}

let board = loadBoard();
let saveTimer = null;

function saveBoard() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = BOARD_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(board, null, 2));
    fs.renameSync(tmp, BOARD_FILE);
  }, 200);
}

// Résultat de duel : vers le classement Vercel si configuré, sinon dans le fichier local
async function reportDuel(winner, loser, time, layout, difficulty) {
  if (LEADERBOARD_URL && DUEL_SECRET) {
    // Plusieurs essais : un résultat de duel ne doit pas se perdre sur une erreur passagère
    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const r = await fetch(LEADERBOARD_URL + '/api/duel-result', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + DUEL_SECRET },
          body: JSON.stringify({ winner, loser, time, layout, difficulty }),
        });
        if (r.ok) return;
        const text = await r.text();
        console.warn(`duel-result refusé (essai ${attempt}) :`, r.status, text);
        if (r.status >= 400 && r.status < 500) return; // secret ou données refusés : inutile d'insister
      } catch (e) {
        console.warn(`duel-result injoignable (essai ${attempt}) :`, e.message);
      }
      await new Promise((res) => setTimeout(res, 1000 * attempt));
    }
    console.error('duel-result abandonné :', winner, 'contre', loser);
    return;
  }
  if (LEADERBOARD_URL && !DUEL_SECRET) console.warn('LEADERBOARD_URL défini sans DUEL_SECRET : résultat gardé en local seulement.');
  recordDuel(board, winner, loser, time, layout, difficulty);
  saveBoard();
}

// ---------------------------------------------------------------- HTTP
const lastPost = new Map();

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function serveFile(req, res, root, rel) {
  const filePath = path.resolve(root, '.' + path.posix.normalize('/' + rel));
  if (!filePath.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
      return;
    }
    const headers = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': root !== PUBLIC_DIR ? 'public, max-age=86400' : 'no-cache',
      'Accept-Ranges': 'bytes',
    };
    // Lecture partielle (nécessaire aux balises <audio> pour la durée et la recherche)
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? +m[1] : st.size - +m[2];
      const end = m[1] && m[2] ? Math.min(+m[2], st.size - 1) : st.size - 1;
      if (start < 0) start = 0;
      if (start > end) {
        res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }).end();
        return;
      }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(filePath, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);

  if (p === '/api/leaderboard' && req.method === 'GET') return sendJSON(res, 200, publicBoard(board));
  if (p === '/health') return sendJSON(res, 200, { ok: true, rooms: rooms.size, waiting: quickQueue.length });
  // Configuration du client (équivalent du fichier généré par « npm run build » pour Vercel)
  if (p === '/config.js') {
    res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' });
    return res.end('window.MJ_CONFIG = ' + JSON.stringify({ duelServer: process.env.DUEL_SERVER_URL || '' }) + ';\n');
  }

  if (p === '/api/score' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '?';
    const now = Date.now();
    if (now - (lastPost.get(ip) || 0) < 2000) return sendJSON(res, 429, { error: 'Trop rapide' });
    lastPost.set(ip, now);
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 131072) req.destroy();
    });
    req.on('end', () => {
      try {
        const entry = parseScore(JSON.parse(body));
        const result = submitSolo(board, entry);
        saveBoard();
        sendJSON(res, 200, result);
      } catch (e) {
        if (e && e.status) return sendJSON(res, e.status, { error: e.message });
        sendJSON(res, 400, { error: "Partie refusée par le serveur (" + (e && e.message ? e.message : "données invalides") + ")." });
      }
    });
    return;
  }

  if (p === '/api/daily-start' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        const result = startDailyAttempt(board, JSON.parse(body));
        saveBoard();
        sendJSON(res, 200, result);
      } catch (e) {
        sendJSON(res, (e && e.status) || 400, { error: (e && e.status && e.message) || 'Données invalides' });
      }
    });
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return res.writeHead(405).end();
  if (p.startsWith('/vendor/lucide/')) return serveFile(req, res, LUCIDE_DIR, p.slice('/vendor/lucide/'.length));
  if (p.startsWith('/vendor/three/')) return serveFile(req, res, THREE_DIR, p.slice('/vendor/three/'.length));
  serveFile(req, res, PUBLIC_DIR, p === '/' ? 'index.html' : p.slice(1));
});

// ---------------------------------------------------------------- Duel (WebSocket)
const wss = new WebSocketServer({
  server,
  path: '/ws',
  maxPayload: 16 * 1024,
  verifyClient: ({ origin }) => !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(String(origin || '').replace(/\/+$/, '')),
});
const rooms = new Map();
// File d'attente de la recherche rapide : { ws, layout, difficulty, since }
let quickQueue = [];
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_CHARS[crypto.randomInt(CODE_CHARS.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function samePlayer(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.cid && b.cid && a.cid === b.cid) return true;
  return String(a.pseudo).toLowerCase() === String(b.pseudo).toLowerCase();
}

function other(room, ws) {
  return room.players.find((p) => p !== ws);
}

function leaveAll(ws) {
  quickQueue = quickQueue.filter((q) => q.ws !== ws);
  const room = ws.room;
  if (!room) return;
  ws.room = null;
  const opp = other(room, ws);
  if (room.state === 'playing' && opp) finishRoom(room, opp, ws, 'forfeit');
  if (opp) {
    send(opp, { type: 'opp_left' });
    opp.room = null;
  }
  rooms.delete(room.code);
}

function startMatch(room) {
  room.seed = crypto.randomInt(2 ** 31);
  room.state = 'playing';
  room.rematch.clear();
  for (const p of room.players) p.stats = null;
  const countdown = 5000; // laisse le temps à la transition « VS » avant le 3-2-1
  room.startAt = Date.now() + countdown;
  for (const ws of room.players) {
    send(ws, {
      type: 'start',
      seed: room.seed,
      layout: room.layout,
      difficulty: room.difficulty,
      hardcore: room.difficulty === 'hardcore', // compatibilité
      countdown,
      opponent: other(room, ws).pseudo,
    });
  }
}

function finishRoom(room, winner, loser, reason) {
  if (room.state !== 'playing') return;
  room.state = 'done';
  const time = Math.max(0, (Date.now() - room.startAt) / 1000);
  reportDuel(winner.pseudo, loser.pseudo, reason === 'finished' ? time : null, room.layout, room.difficulty);
  const card = (ws) => ({ pseudo: ws.pseudo, ...(ws.stats || {}) });
  const players = { winner: card(winner), loser: card(loser) };
  send(winner, { type: 'result', result: 'win', reason, time, winner: winner.pseudo, players });
  send(loser, { type: 'result', result: 'lose', reason, time, winner: winner.pseudo, players });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.pseudo = 'Joueur';
  ws.room = null;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.pseudo) ws.pseudo = cleanPseudo(msg.pseudo) || ws.pseudo;
    // identifiant de navigateur (stocké en local) : sert à empêcher de s'affronter soi-même
    if (typeof msg.cid === 'string' && /^[a-z0-9-]{8,40}$/i.test(msg.cid)) ws.cid = msg.cid;
    const layout = LAYOUTS.includes(msg.layout) ? msg.layout : 'express';
    const difficulty = cleanDifficulty(msg.difficulty, msg.hardcore);
    const hardcore = difficulty !== 'normal';

    switch (msg.type) {
      case 'create': {
        leaveAll(ws);
        const room = { code: newCode(), layout, difficulty, hardcore, players: [ws], state: 'waiting', rematch: new Set() };
        rooms.set(room.code, room);
        ws.room = room;
        send(ws, { type: 'created', code: room.code, layout, difficulty });
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(ws, { type: 'error', message: 'Salon introuvable.' });
        if (room.players.some((p) => samePlayer(p, ws))) {
          const sameName = room.players.some((p) => p !== ws && p.cid !== ws.cid);
          return send(ws, {
            type: 'error',
            message: sameName
              ? 'Ce pseudo est déjà celui du créateur du salon : choisis-en un autre.'
              : 'Tu ne peux pas rejoindre ton propre salon : envoie le code à ton adversaire.',
          });
        }
        if (room.players.length >= 2 || room.state !== 'waiting')
          return send(ws, { type: 'error', message: 'Ce salon est déjà complet.' });
        leaveAll(ws);
        room.players.push(ws);
        ws.room = room;
        startMatch(room);
        break;
      }
      case 'quick': {
        leaveAll(ws);
        quickQueue = quickQueue.filter((q) => q.ws.readyState === 1 && !q.ws.room);
        // Adversaire possible : quelqu'un d'autre que soi (autre onglet, même pseudo)
        const others = quickQueue.filter((q) => !samePlayer(q.ws, ws));
        // Priorité : même forme et même difficulté, puis même difficulté, puis n'importe qui.
        // La partie se joue alors avec les réglages de celui qui attendait déjà.
        const pick =
          others.find((q) => q.layout === layout && q.difficulty === difficulty) ||
          others.find((q) => q.difficulty === difficulty) ||
          others[0];
        if (pick) {
          quickQueue = quickQueue.filter((q) => q !== pick);
          const room = { code: newCode(), layout: pick.layout, difficulty: pick.difficulty, hardcore: pick.difficulty !== 'normal', players: [pick.ws, ws], state: 'waiting', rematch: new Set() };
          rooms.set(room.code, room);
          pick.ws.room = room;
          ws.room = room;
          startMatch(room);
        } else if (quickQueue.some((q) => samePlayer(q.ws, ws))) {
          // le même joueur cherche déjà (autre onglet) : on ne l'appaire pas avec lui-même
          send(ws, { type: 'error', message: 'Tu cherches déjà un adversaire dans un autre onglet (ou avec ce pseudo).' });
        } else {
          quickQueue.push({ ws, layout, difficulty, since: Date.now() });
          send(ws, { type: 'queued', layout, difficulty });
        }
        break;
      }
      case 'cancel':
        leaveAll(ws);
        break;
      case 'progress': {
        const room = ws.room;
        if (!room || room.state !== 'playing') return;
        const stats = {
          remaining: Number(msg.remaining) | 0,
          total: Number(msg.total) | 0,
          moves: Number(msg.moves) | 0,
          combo: Number(msg.combo) | 0,
          score: Math.max(0, Number(msg.score) | 0),
          maxCombo: Math.max(0, Number(msg.maxCombo) | 0),
          hints: Math.max(0, Number(msg.hints) | 0),
          shuffles: Math.max(0, Number(msg.shuffles) | 0),
        };
        ws.stats = stats;
        send(other(room, ws), { type: 'opp_progress', ...stats });
        break;
      }
      case 'act': {
        // Actions en direct (sélection, paire, annulation, mélange) pour le plateau vu en face
        const room = ws.room;
        if (!room || room.state !== 'playing') return;
        const id = (v) => (Number.isInteger(v) && v >= 0 && v < 200 ? v : null);
        let out = null;
        if (msg.k === 'sel') out = { k: 'sel', id: id(msg.id) };
        else if ((msg.k === 'match' || msg.k === 'undo') && id(msg.a) !== null && id(msg.b) !== null) out = { k: msg.k, a: msg.a, b: msg.b };
        else if (msg.k === 'shuf' && Array.isArray(msg.faces) && msg.faces.length <= 144) {
          const faces = msg.faces.filter((p) => Array.isArray(p) && id(p[0]) !== null && /^[a-z][A-Za-z0-9]{1,2}$/.test(String(p[1])));
          out = { k: 'shuf', faces };
        }
        if (out) send(other(room, ws), { type: 'opp_act', ...out });
        break;
      }
      case 'finished': {
        const room = ws.room;
        if (!room || room.state !== 'playing') return;
        if (Date.now() - room.startAt < 10000) return; // anti-triche minimal
        finishRoom(room, ws, other(room, ws), 'finished');
        break;
      }
      case 'forfeit': {
        const room = ws.room;
        if (!room || room.state !== 'playing') return;
        finishRoom(room, other(room, ws), ws, 'forfeit');
        break;
      }
      case 'rematch': {
        const room = ws.room;
        if (!room || room.state !== 'done' || room.players.length < 2) return;
        room.rematch.add(ws);
        if (room.rematch.size === 2) startMatch(room);
        else send(other(room, ws), { type: 'opp_rematch' });
        break;
      }
      case 'chat': {
        const room = ws.room;
        const emote = String(msg.emote || '').slice(0, 8);
        if (room) send(other(room, ws), { type: 'opp_emote', emote });
        break;
      }
    }
  });

  ws.on('close', () => leaveAll(ws));
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, () => {
  console.log(`\n  🀄  Mahjong 3D prêt : http://localhost:${PORT}`);
  if (LEADERBOARD_URL) console.log(`  Résultats de duel envoyés à ${LEADERBOARD_URL}${DUEL_SECRET ? '' : ' (DUEL_SECRET manquant !)'}`);
  if (ALLOWED_ORIGINS.length) console.log(`  Origines autorisées : ${ALLOWED_ORIGINS.join(', ')}`);
  console.log('');
});
