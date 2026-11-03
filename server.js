// Mahjong 3D — serveur HTTP statique + API classement (fichier JSON) + WebSocket duel
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { LAYOUTS as LAYOUT_DEFS } from './public/js/layouts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const THREE_DIR = path.join(__dirname, 'node_modules', 'three');
const LUCIDE_DIR = path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd');
const DATA_DIR = path.join(__dirname, 'data');
const BOARD_FILE = path.join(DATA_DIR, 'leaderboard.json');
const LAYOUTS = Object.keys(LAYOUT_DEFS);
// Une catégorie de classement par forme et par difficulté : 'chat' (normal), 'chat_hc' (hardcore)
const CATEGORIES = LAYOUTS.flatMap((l) => [l, l + '_hc']);
const HARDCORE_SHUFFLES = 2;
const MAX_ENTRIES = 100;

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

// ---------------------------------------------------------------- classement
function emptyBoard() {
  const b = { duel: {} };
  for (const c of CATEGORIES) b[c] = [];
  return b;
}

function loadBoard() {
  try {
    const data = JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8'));
    return { ...emptyBoard(), ...data };
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

function cleanPseudo(raw) {
  if (typeof raw !== 'string') return null;
  const p = raw.normalize('NFC').replace(/[^\p{L}\p{N} _\-.]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return p.length >= 2 ? p : null;
}

function sortSolo(list) {
  list.sort((a, b) => b.score - a.score || a.time - b.time || a.date - b.date);
}

function submitSolo({ pseudo, layout, time, moves, score, hints, shuffles }) {
  const list = board[layout];
  const entry = {
    pseudo,
    time: Math.round(time * 10) / 10,
    moves,
    score,
    hints,
    shuffles,
    date: Date.now(),
  };
  const key = pseudo.toLowerCase();
  const idx = list.findIndex((e) => e.pseudo.toLowerCase() === key);
  let improved = true;
  if (idx >= 0) {
    const old = list[idx];
    if (old.score > score || (old.score === score && old.time <= entry.time)) improved = false;
    else list.splice(idx, 1);
  }
  if (improved) list.push(entry);
  sortSolo(list);
  if (list.length > MAX_ENTRIES) list.length = MAX_ENTRIES;
  saveBoard();
  const rank = list.findIndex((e) => e.pseudo.toLowerCase() === key) + 1;
  return { rank: rank || null, improved };
}

function recordDuel(winner, loser, time) {
  for (const [name, won] of [[winner, true], [loser, false]]) {
    const key = name.toLowerCase();
    const s = board.duel[key] || { pseudo: name, wins: 0, losses: 0, best: null };
    s.pseudo = name;
    if (won) {
      s.wins++;
      if (time && (s.best === null || time < s.best)) s.best = Math.round(time * 10) / 10;
    } else s.losses++;
    board.duel[key] = s;
  }
  saveBoard();
}

function publicBoard() {
  const duel = Object.values(board.duel)
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || (a.best ?? 1e9) - (b.best ?? 1e9))
    .slice(0, 50);
  const out = { duel };
  for (const c of CATEGORIES) out[c] = (board[c] || []).slice(0, 50);
  return out;
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

  if (p === '/api/leaderboard' && req.method === 'GET') return sendJSON(res, 200, publicBoard());

  if (p === '/api/score' && req.method === 'POST') {
    const ip = req.socket.remoteAddress || '?';
    const now = Date.now();
    if (now - (lastPost.get(ip) || 0) < 2000) return sendJSON(res, 429, { error: 'Trop rapide' });
    lastPost.set(ip, now);
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 2048) req.destroy();
    });
    req.on('end', () => {
      try {
        const d = JSON.parse(body);
        const pseudo = cleanPseudo(d.pseudo);
        const layout = LAYOUTS.includes(d.layout) ? d.layout : null;
        const time = Number(d.time);
        const moves = Math.floor(Number(d.moves));
        const score = Math.floor(Number(d.score));
        const hints = Math.max(0, Math.floor(Number(d.hints) || 0));
        const shuffles = Math.max(0, Math.floor(Number(d.shuffles) || 0));
        if (!pseudo || !layout) throw new Error('pseudo/layout');
        if (!(time >= 15 && time < 36000)) throw new Error('time');
        if (!(moves >= 1 && moves < 5000)) throw new Error('moves');
        if (!(score >= 0 && score <= 30000)) throw new Error('score');
        const hardcore = d.hardcore === true;
        if (hardcore && (hints > 0 || shuffles > HARDCORE_SHUFFLES)) throw new Error('hardcore');
        sendJSON(res, 200, submitSolo({ pseudo, layout: hardcore ? layout + '_hc' : layout, time, moves, score, hints, shuffles }));
      } catch (e) {
        sendJSON(res, 400, { error: 'Données invalides' });
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
const wss = new WebSocketServer({ server, path: '/ws' });
const rooms = new Map();
const quickQueue = {}; // clé : forme + difficulté
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

function other(room, ws) {
  return room.players.find((p) => p !== ws);
}

function leaveAll(ws) {
  for (const k of Object.keys(quickQueue)) if (quickQueue[k] === ws) delete quickQueue[k];
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
  const countdown = 5000; // laisse le temps à la transition « VS » avant le 3-2-1
  room.startAt = Date.now() + countdown;
  for (const ws of room.players) {
    send(ws, {
      type: 'start',
      seed: room.seed,
      layout: room.layout,
      hardcore: room.hardcore,
      countdown,
      opponent: other(room, ws).pseudo,
    });
  }
}

function finishRoom(room, winner, loser, reason) {
  if (room.state !== 'playing') return;
  room.state = 'done';
  const time = Math.max(0, (Date.now() - room.startAt) / 1000);
  recordDuel(winner.pseudo, loser.pseudo, reason === 'finished' ? time : null);
  send(winner, { type: 'result', result: 'win', reason, time, winner: winner.pseudo });
  send(loser, { type: 'result', result: 'lose', reason, time, winner: winner.pseudo });
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
    const layout = LAYOUTS.includes(msg.layout) ? msg.layout : 'express';
    const hardcore = msg.hardcore === true;
    const qKey = layout + (hardcore ? '_hc' : '');

    switch (msg.type) {
      case 'create': {
        leaveAll(ws);
        const room = { code: newCode(), layout, hardcore, players: [ws], state: 'waiting', rematch: new Set() };
        rooms.set(room.code, room);
        ws.room = room;
        send(ws, { type: 'created', code: room.code, layout, hardcore });
        break;
      }
      case 'join': {
        const code = String(msg.code || '').toUpperCase().trim();
        const room = rooms.get(code);
        if (!room) return send(ws, { type: 'error', message: 'Salon introuvable.' });
        if (room.players.includes(ws)) return;
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
        const waiting = quickQueue[qKey];
        if (waiting && waiting !== ws && waiting.readyState === 1) {
          delete quickQueue[qKey];
          const room = { code: newCode(), layout, hardcore, players: [waiting, ws], state: 'waiting', rematch: new Set() };
          rooms.set(room.code, room);
          waiting.room = room;
          ws.room = room;
          startMatch(room);
        } else {
          quickQueue[qKey] = ws;
          send(ws, { type: 'queued', layout, hardcore });
        }
        break;
      }
      case 'cancel':
        leaveAll(ws);
        break;
      case 'progress': {
        const room = ws.room;
        if (!room || room.state !== 'playing') return;
        send(other(room, ws), {
          type: 'opp_progress',
          remaining: Number(msg.remaining) | 0,
          total: Number(msg.total) | 0,
          moves: Number(msg.moves) | 0,
          combo: Number(msg.combo) | 0,
        });
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
  console.log(`\n  🀄  Mahjong 3D prêt : http://localhost:${PORT}\n`);
});
