// Logique du Mahjong solitaire : dispositions, génération de donnes solubles, règles.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

import { LAYOUTS } from './layouts.js';
export { LAYOUTS };

// Jeu complet de 144 tuiles : 34 types × 4, + 4 fleurs + 4 saisons.
export const FACE_NAMES = {};
function buildPairs() {
  const pairs = [];
  const suits = { p: 'Cercles', s: 'Bambous', m: 'Caractères' };
  for (const s of Object.keys(suits)) {
    for (let n = 1; n <= 9; n++) {
      const id = s + n;
      FACE_NAMES[id] = `${n} ${suits[s]}`;
      pairs.push([id, id], [id, id]);
    }
  }
  const winds = { E: 'Est', S: 'Sud', W: 'Ouest', N: 'Nord' };
  for (const w of Object.keys(winds)) {
    FACE_NAMES['w' + w] = 'Vent ' + winds[w];
    pairs.push(['w' + w, 'w' + w], ['w' + w, 'w' + w]);
  }
  const dragons = { r: 'Dragon Rouge', g: 'Dragon Vert', w: 'Dragon Blanc' };
  for (const d of Object.keys(dragons)) {
    FACE_NAMES['z' + d] = dragons[d];
    pairs.push(['z' + d, 'z' + d], ['z' + d, 'z' + d]);
  }
  ['Prunier', 'Orchidée', 'Chrysanthème', 'Bambou'].forEach((n, i) => (FACE_NAMES['f' + (i + 1)] = 'Fleur · ' + n));
  ['Printemps', 'Été', 'Automne', 'Hiver'].forEach((n, i) => (FACE_NAMES['n' + (i + 1)] = 'Saison · ' + n));
  pairs.push(['f1', 'f2'], ['f3', 'f4'], ['n1', 'n2'], ['n3', 'n4']);
  return pairs; // 72 paires
}
export const ALL_PAIRS = buildPairs();

export function groupOf(face) {
  if (face[0] === 'f') return 'F';
  if (face[0] === 'n') return 'N';
  return face;
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Pré-calcul des relations de blocage entre positions.
function computeRelations(pos) {
  return pos.map((a, i) => {
    const above = [], left = [], right = [];
    pos.forEach((b, j) => {
      if (i === j) return;
      const dx = b.x - a.x, dy = b.y - a.y;
      if (b.z === a.z + 1 && Math.abs(dx) < 2 && Math.abs(dy) < 2) above.push(j);
      if (b.z === a.z && Math.abs(dy) < 2) {
        if (dx === -2) left.push(j);
        if (dx === 2) right.push(j);
      }
    });
    return { above, left, right };
  });
}

function isFreeIn(rel, i, alive) {
  const r = rel[i];
  for (const j of r.above) if (alive[j]) return false;
  let leftBlocked = false, rightBlocked = false;
  for (const j of r.left) if (alive[j]) { leftBlocked = true; break; }
  if (!leftBlocked) return true;
  for (const j of r.right) if (alive[j]) { rightBlocked = true; break; }
  return !rightBlocked;
}

// Simule une partie à l'envers : on retire des paires de tuiles libres au hasard.
// L'ordre de retrait obtenu est une solution garantie, on y assigne les paires de faces.
function solvableOrder(rel, aliveInit, rng) {
  const ids = aliveInit.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  for (let attempt = 0; attempt < 400; attempt++) {
    const alive = aliveInit.slice();
    const order = [];
    let left = ids.length;
    while (left > 0) {
      const free = ids.filter((i) => alive[i] && isFreeIn(rel, i, alive));
      if (free.length < 2) break;
      // Tirage pondéré : favorise les tuiles hautes pour éviter les impasses (piles finales).
      const pick = (exclude) => {
        let best = -1, bestW = -1;
        for (const i of free) {
          if (i === exclude) continue;
          const w = rng() * (1 + 0.6 * rel[i].z);
          if (w > bestW) { bestW = w; best = i; }
        }
        return best;
      };
      const a = pick(-1);
      const b = pick(a);
      alive[a] = alive[b] = false;
      order.push([a, b]);
      left -= 2;
    }
    if (left === 0) return order;
  }
  return null;
}

export class MahjongGame {
  constructor(layoutKey, seed) {
    this.layoutKey = layoutKey;
    this.layout = LAYOUTS[layoutKey];
    this.seed = seed;
    this.rng = mulberry32(seed);
    const pos = this.layout.positions;
    this.rel = computeRelations(pos).map((r, i) => ({ ...r, z: pos[i].z }));
    this.alive = pos.map(() => true);
    this.history = [];

    const pairs = shuffleInPlace(ALL_PAIRS.map((p) => p.slice()), this.rng).slice(0, pos.length / 2);
    const order = solvableOrder(this.rel, this.alive, this.rng);
    this.faces = new Array(pos.length);
    this.solvable = !!order;
    if (order) {
      order.forEach(([a, b], k) => {
        this.faces[a] = pairs[k][0];
        this.faces[b] = pairs[k][1];
      });
    } else {
      const flat = shuffleInPlace(pairs.flat(), this.rng);
      flat.forEach((f, i) => (this.faces[i] = f));
    }
    this.tiles = pos.map((p, i) => ({ id: i, x: p.x, y: p.y, z: p.z }));
  }

  get total() { return this.tiles.length; }
  get remaining() { return this.alive.reduce((n, v) => n + (v ? 1 : 0), 0); }
  face(i) { return this.faces[i]; }
  group(i) { return groupOf(this.faces[i]); }
  isFree(i) { return this.alive[i] && isFreeIn(this.rel, i, this.alive); }

  canMatch(a, b) {
    return a !== b && this.isFree(a) && this.isFree(b) && this.group(a) === this.group(b);
  }

  match(a, b) {
    if (!this.canMatch(a, b)) return false;
    this.alive[a] = this.alive[b] = false;
    this.history.push([a, b]);
    return true;
  }

  undo() {
    const last = this.history.pop();
    if (!last) return null;
    this.alive[last[0]] = this.alive[last[1]] = true;
    return last;
  }

  freeTiles() {
    return this.tiles.filter((t) => this.isFree(t.id)).map((t) => t.id);
  }

  availablePairs() {
    const groups = new Map();
    for (const id of this.freeTiles()) {
      const g = this.group(id);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(id);
    }
    const out = [];
    for (const ids of groups.values()) {
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) out.push([ids[i], ids[j]]);
    }
    return out;
  }

  hint() {
    const pairs = this.availablePairs();
    if (!pairs.length) return null;
    return pairs[Math.floor(Math.random() * pairs.length)];
  }

  // Redistribue les faces des tuiles restantes de façon à garantir une solution.
  shuffle() {
    const ids = this.tiles.filter((t) => this.alive[t.id]).map((t) => t.id);
    const byGroup = new Map();
    for (const id of ids) {
      const g = this.group(id);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(this.faces[id]);
    }
    const pairs = [];
    for (const faces of byGroup.values()) for (let i = 0; i + 1 < faces.length; i += 2) pairs.push([faces[i], faces[i + 1]]);
    const rng = mulberry32((Math.random() * 2 ** 31) | 0);
    shuffleInPlace(pairs, rng);
    const order = solvableOrder(this.rel, this.alive, rng);
    if (order) {
      order.forEach(([a, b], k) => {
        this.faces[a] = pairs[k][0];
        this.faces[b] = pairs[k][1];
      });
    } else {
      const flat = shuffleInPlace(pairs.flat(), rng);
      ids.forEach((id, k) => (this.faces[id] = flat[k]));
    }
    this.history = [];
    return ids;
  }
}
