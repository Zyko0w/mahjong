// Duel immersif : l'adversaire est assis en face, de l'autre côté de la table.
// Son plateau (copie exacte du nôtre, même donne) est rejoué en direct à partir de ses actions,
// et un personnage en robe de jade tend les bras vers les tuiles qu'il choisit.
import * as THREE from 'three';
import { TILE, TABLE_RADIUS } from './scene.js';

const { TH, SX, SZ } = TILE;
const JADE = new THREE.Color(0.15, 1.0, 0.65);
const GOLD = new THREE.Color(1.5, 0.95, 0.25);
const ease = (t) => 1 - (1 - t) ** 3;

// Chaque adversaire a ses couleurs, tirées de son pseudo
const PALETTES = [
  { robe: '#1d6b50', dark: '#0f3a2c', skin: '#e9c49d', light: 0x7affd0 }, // jade
  { robe: '#25407a', dark: '#141f3d', skin: '#e6bf98', light: 0x8ab4ff }, // indigo
  { robe: '#8e1c22', dark: '#3d0a0e', skin: '#ecc8a2', light: 0xff8a6a }, // pourpre
  { robe: '#2b2b2b', dark: '#121212', skin: '#e2b98f', light: 0xffd38a }, // noir et or
  { robe: '#5b2a78', dark: '#2a1238', skin: '#e9c6a0', light: 0xd29aff }, // violet
];
function paletteFor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTES[h % PALETTES.length];
}

// Bras à deux segments : place le coude pour relier l'épaule à la main (cinématique inverse)
const UP = new THREE.Vector3(0, 1, 0);
function segment(mesh, from, to) {
  const d = to.clone().sub(from);
  const len = Math.max(0.001, d.length());
  mesh.position.copy(from);
  mesh.quaternion.setFromUnitVectors(UP, d.divideScalar(len));
  mesh.scale.set(1, len, 1);
}

function extents(game) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const t of game.tiles) {
    minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x + 2);
    minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y + 2);
  }
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: (maxX - minX) * SX, d: (maxY - minY) * SZ };
}

// Place les deux plateaux sur la table et calcule la taille de table nécessaire.
export function computeDuelLayout(game) {
  const { w, d } = extents(game);
  const oppScale = 0.7, gap = 2.0;
  const total = d + gap + d * oppScale;
  const ourZ = total / 2 - d / 2 + 0.6;
  const oppZ = -(total / 2 - (d * oppScale) / 2) + 0.6;
  const corner = (hw, z, hd) => Math.hypot(hw, Math.abs(z) + hd);
  const need = Math.max(corner(w / 2, ourZ, d / 2), corner((w * oppScale) / 2, oppZ, (d * oppScale) / 2)) + 0.7;
  const tableScale = Math.max(1, need / TABLE_RADIUS);
  return {
    ourZ, oppZ, oppScale, tableScale,
    width: Math.max(w, 2 * TABLE_RADIUS * tableScale * 0.7),
    depth: total + 7, // on garde de la place pour voir le personnage
    focusZ: (ourZ + oppZ) / 2 - 2.2,
    avatarZ: -(TABLE_RADIUS * tableScale + 0.9), // assis contre le bord de la table
  };
}

function textSprite(draw, w = 512, h = 160, scale = 4) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sp.scale.set(scale, (scale * h) / w, 1);
  sp.userData.redraw = (...args) => {
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    draw(ctx, w, h, ...args);
    tex.needsUpdate = true;
  };
  return sp;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class OpponentView {
  constructor(scene3d, game, layout, name) {
    this.s = scene3d;
    this.game = game;
    this.layout = layout;
    this.name = name;
    this.time = 0;
    this.selected = null;
    this.reaction = null;

    // ---------------------------------------------------------------- plateau
    const g = (this.group = new THREE.Group());
    g.position.set(0, 0, layout.oppZ);
    g.rotation.y = Math.PI; // tourné vers l'adversaire
    g.scale.setScalar(layout.oppScale);
    scene3d.scene.add(g);
    const { cx, cy } = extents(game);
    this.tiles = game.tiles.map((t) => {
      const tile = scene3d.createTile(game.face(t.id));
      const base = new THREE.Vector3((t.x + 1 - cx) * SX, TH / 2 + t.z * TH + 0.004, (t.y + 1 - cy) * SZ);
      tile.group.position.copy(base);
      g.add(tile.group);
      return { ...tile, id: t.id, base, lift: 0, glow: new THREE.Color(0), removed: false, anim: null };
    });

    this.buildAvatar();
    this.unsub = scene3d.addUpdater((dt) => this.update(dt));
  }

  // ---------------------------------------------------------------- personnage : un samouraï
  buildAvatar() {
    const a = (this.avatar = new THREE.Group());
    a.position.set(0, -0.2, this.layout.avatarZ);
    a.scale.setScalar(1.75);
    const pal = paletteFor(this.name);
    const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, ...o });
    const robe = M(pal.robe), robeDark = M(pal.dark), inner = M('#f1ebdd', { roughness: 0.8 });
    const gold = M('#d6a54a', { metalness: 0.85, roughness: 0.32 });
    const skin = M(pal.skin, { roughness: 0.55 });
    const hair = M('#17110d', { roughness: 0.45 });
    const ink = new THREE.MeshBasicMaterial({ color: '#120b08' });
    const white = new THREE.MeshBasicMaterial({ color: '#fbf6ea' });
    const band = M('#c4161c', { roughness: 0.7 });
    const mats = [robe, robeDark, inner, gold, skin, hair, band];
    this.mats = mats.concat([ink, white]);
    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

    // corps (penche vers la table quand il va chercher une tuile loin)
    const body = (this.body = new THREE.Group());
    body.position.y = 0;
    a.add(body);
    add(body, new THREE.CylinderGeometry(1.5, 2.05, 2.6, 28), robeDark, 0, -0.6, 0); // hakama
    add(body, new THREE.CylinderGeometry(1.08, 1.42, 2.4, 28), robe, 0, 1.6, 0); // kimono
    add(body, new THREE.CylinderGeometry(1.45, 1.45, 0.42, 28), band, 0, 0.62, 0); // obi
    const knot = add(body, new THREE.TorusGeometry(0.2, 0.08, 8, 16), gold, 0, 0.62, 1.42);
    knot.rotation.y = Math.PI / 2;
    // col croisé du kimono (blanc sous le col coloré)
    for (const side of [-1, 1]) {
      const c = add(body, new THREE.BoxGeometry(0.34, 1.9, 0.08), inner, side * 0.24, 1.95, 1.06);
      c.rotation.z = side * -0.5;
      const c2 = add(body, new THREE.BoxGeometry(0.16, 1.9, 0.09), gold, side * 0.42, 1.92, 1.08);
      c2.rotation.z = side * -0.5;
    }
    // kataginu : les épaulettes larges et rigides du samouraï
    for (const side of [-1, 1]) {
      const w = add(body, new THREE.BoxGeometry(1.7, 0.14, 1.5), robeDark, side * 1.15, 2.95, 0);
      w.rotation.z = side * -0.22;
      const rim = add(body, new THREE.BoxGeometry(1.72, 0.05, 0.06), gold, side * 1.15, 2.95, 0.76);
      rim.rotation.z = side * -0.22;
      const mon = add(body, new THREE.CircleGeometry(0.22, 20), gold, side * 0.62, 2.35, 1.02); // blason
      mon.rotation.x = -0.12;
    }
    add(body, new THREE.SphereGeometry(1.12, 22, 14), robe, 0, 2.7, 0).scale.set(1.15, 0.55, 0.85); // épaules
    // sabre dans le dos, la poignée dépasse au-dessus de l'épaule
    const katana = new THREE.Group();
    katana.position.set(0.55, 2.6, -0.75);
    katana.rotation.z = -0.55;
    add(katana, new THREE.CylinderGeometry(0.11, 0.11, 3.4, 10), M('#1a0c0a', { roughness: 0.3 }), 0, -0.6, 0);
    add(katana, new THREE.CylinderGeometry(0.28, 0.28, 0.07, 18), gold, 0, 1.15, 0);
    const grip = add(katana, new THREE.CylinderGeometry(0.1, 0.1, 1.0, 10), M('#e9e1cf', { roughness: 0.9 }), 0, 1.7, 0);
    grip.userData.wrap = true;
    body.add(katana);

    // tête
    const head = (this.head = new THREE.Group());
    head.position.y = 3.72;
    body.add(head);
    add(head, new THREE.CylinderGeometry(0.34, 0.4, 0.55, 14), skin, 0, -0.62, 0); // cou
    add(head, new THREE.SphereGeometry(0.86, 30, 20), skin).scale.set(0.96, 1.08, 0.98);
    for (const side of [-1, 1]) add(head, new THREE.SphereGeometry(0.17, 10, 8), skin, side * 0.84, -0.02, -0.02).scale.set(0.5, 1, 0.8); // oreilles
    // cheveux : calotte + chignon (chonmage)
    const cap = add(head, new THREE.SphereGeometry(0.9, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hair, 0, 0.12, -0.06);
    cap.scale.set(1.0, 0.85, 1.02);
    cap.rotation.x = 0.38; // la calotte part vers l'arrière : le front reste dégagé
    const bun = add(head, new THREE.CapsuleGeometry(0.13, 0.5, 4, 10), hair, 0, 0.98, 0.08);
    bun.rotation.x = Math.PI / 2 - 0.25;
    add(head, new THREE.TorusGeometry(0.15, 0.05, 6, 12), band, 0, 0.94, -0.17).rotation.x = Math.PI / 2;
    // hachimaki : bandeau rouge et ses deux pans
    const hb = add(head, new THREE.TorusGeometry(0.87, 0.05, 8, 40), band, 0, 0.34, -0.02);
    hb.rotation.x = Math.PI / 2 - 0.12;
    hb.scale.set(0.98, 1.0, 1);
    this.tails = [-1, 1].map((side) => {
      const t = add(head, new THREE.BoxGeometry(0.12, 0.62, 0.03), band, side * 0.16, 0.0, -0.92);
      t.rotation.z = side * 0.35;
      return t;
    });
    // visage
    this.eyes = [-1, 1].map((side) => {
      const eg = new THREE.Group();
      eg.position.set(side * 0.3, 0.07, 0.76);
      add(eg, new THREE.SphereGeometry(0.13, 14, 10), white).scale.set(1.25, 0.8, 0.5);
      add(eg, new THREE.SphereGeometry(0.075, 12, 8), ink, 0, 0, 0.05);
      head.add(eg);
      return eg;
    });
    this.brows = [-1, 1].map((side) => {
      const b = add(head, new THREE.BoxGeometry(0.34, 0.075, 0.06), hair, side * 0.3, 0.27, 0.8);
      b.rotation.z = side * -0.2;
      return b;
    });
    add(head, new THREE.ConeGeometry(0.08, 0.26, 10), skin, 0, -0.08, 0.86).rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) {
      const m = add(head, new THREE.CapsuleGeometry(0.035, 0.28, 3, 6), hair, side * 0.17, -0.27, 0.8);
      m.rotation.z = side * 1.15;
    }
    const mouth = (this.mouth = add(head, new THREE.TorusGeometry(0.13, 0.025, 6, 14, Math.PI), ink, 0, -0.4, 0.78));
    mouth.rotation.z = Math.PI;
    add(head, new THREE.ConeGeometry(0.12, 0.38, 10), hair, 0, -0.86, 0.6).rotation.x = Math.PI + 0.45; // barbiche

    // bras articulés (épaule → coude → poignet) avec mains et doigts
    const limb = (r1, r2, mat) => {
      const g = new THREE.CylinderGeometry(r2, r1, 1, 14);
      g.translate(0, 0.5, 0);
      return new THREE.Mesh(g, mat);
    };
    this.arms = [-1, 1].map((side) => {
      const upper = limb(0.5, 0.42, robe); // grande manche de kimono
      const fore = limb(0.4, 0.3, robe);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.06, 8, 18), gold);
      const elbowBall = new THREE.Mesh(new THREE.SphereGeometry(0.43, 14, 10), robe);
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.48), skin);
      palm.position.z = 0.16;
      hand.add(palm);
      for (let k = 0; k < 4; k++) {
        const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.26, 3, 6), skin);
        f.rotation.x = Math.PI / 2 + 0.35;
        f.position.set(-0.15 + k * 0.1, -0.06, 0.5 - Math.abs(k - 1.5) * 0.03);
        hand.add(f);
      }
      const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.2, 3, 6), skin);
      thumb.position.set(-side * 0.24, -0.02, 0.22);
      thumb.rotation.set(Math.PI / 2, 0, -side * 0.8);
      hand.add(thumb);
      a.add(upper, fore, cuff, elbowBall, hand);
      const rest = new THREE.Vector3(side * 1.4, 0.25, 2.1);
      return {
        side, upper, fore, cuff, elbowBall, hand,
        shoulder: new THREE.Vector3(side * 1.55, 2.68, 0.15),
        rest, target: rest.clone(), pos: rest.clone(), until: 0,
      };
    });

    // lumière douce sur le personnage
    const light = new THREE.PointLight(pal.light, 16, 16, 1.8);
    light.position.set(0, 5.5, 3.5);
    a.add(light);

    // plaque avec le nom et les tuiles restantes
    this.plate = textSprite((ctx, w, h, name, left, total) => {
      roundRect(ctx, 8, 8, w - 16, h - 16, 26);
      ctx.fillStyle = 'rgba(16, 40, 32, 0.88)';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#d6a54a';
      ctx.stroke();
      ctx.fillStyle = '#f6d58c';
      ctx.font = '900 52px "Shippori Mincho B1", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.slice(0, 16), w / 2, 58);
      const k = total ? (total - left) / total : 0;
      roundRect(ctx, 50, 104, w - 100, 22, 11);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fill();
      roundRect(ctx, 50, 104, Math.max(22, (w - 100) * k), 22, 11);
      ctx.fillStyle = '#43c28f';
      ctx.fill();
      ctx.font = '700 22px "Zen Kaku Gothic New", sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${left} tuiles`, w / 2, 116);
    }, 512, 150, 4.4);
    this.plate.position.set(-3.2, 4.6, 0.6);
    this.plate.scale.multiplyScalar(0.85);
    a.add(this.plate);
    this.setRemaining(this.game.remaining);

    // bulle d'émote
    this.bubble = textSprite((ctx, w, h, text) => {
      roundRect(ctx, 10, 10, w - 20, h - 50, 30);
      ctx.fillStyle = '#fff6e0';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(w / 2 - 22, h - 42);
      ctx.lineTo(w / 2, h - 8);
      ctx.lineTo(w / 2 + 22, h - 42);
      ctx.fill();
      ctx.fillStyle = '#7a1418';
      ctx.font = '900 54px "Shippori Mincho B1", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, (h - 40) / 2 + 6);
    }, 420, 170, 3.6);
    this.bubble.position.set(2.9, 5.2, 0.6);
    this.bubble.visible = false;
    a.add(this.bubble);

    this.s.scene.add(a);
  }

  setRemaining(n) {
    this.plate.userData.redraw(this.name, n, this.game.total);
  }

  emote(text) {
    this.bubble.userData.redraw(text);
    this.bubble.visible = true;
    this.bubbleAt = this.time;
  }

  // position (repère du personnage) d'une tuile de son plateau
  tileInAvatarSpace(id) {
    const T = this.tiles[id];
    const w = T.group.getWorldPosition(new THREE.Vector3());
    w.y += 0.3;
    return this.avatar.worldToLocal(w);
  }

  reach(id, armIndex = null, hold = 0.6) {
    if (id === null || !this.tiles[id]) return;
    const p = this.tileInAvatarSpace(id);
    const arm = armIndex !== null ? this.arms[armIndex] : this.arms[p.x < 0 ? 0 : 1];
    arm.target.copy(p);
    arm.until = this.time + hold;
  }

  // ---------------------------------------------------------------- actions de l'adversaire
  select(id) {
    if (this.selected !== null && this.tiles[this.selected]) this.tiles[this.selected].selected = false;
    this.selected = id;
    if (id !== null && this.tiles[id] && !this.tiles[id].removed) {
      this.tiles[id].selected = true;
      this.reach(id, null, 1.2);
    }
  }

  match(a, b) {
    if (!this.tiles[a] || !this.tiles[b]) return;
    this.game.alive[a] = this.game.alive[b] = false;
    this.select(null);
    const pa = this.tileInAvatarSpace(a), pb = this.tileInAvatarSpace(b);
    const left = pa.x < pb.x ? [a, b] : [b, a];
    this.reach(left[0], 0, 0.5);
    this.reach(left[1], 1, 0.5);
    for (const id of [a, b]) {
      const T = this.tiles[id];
      T.selected = false;
      T.anim = { t: 0, kind: 'remove' };
    }
    this.setRemaining(this.game.remaining);
  }

  undo(a, b) {
    for (const id of [a, b]) {
      const T = this.tiles[id];
      if (!T) continue;
      this.game.alive[id] = true;
      T.removed = false;
      T.group.visible = true;
      T.anim = { t: 0, kind: 'restore' };
    }
    this.setRemaining(this.game.remaining);
  }

  shuffle(faces) {
    for (const [id, face] of faces) {
      const T = this.tiles[id];
      if (!T || T.removed) continue;
      this.game.faces[id] = face;
      T.anim = { t: -Math.random() * 0.25, kind: 'shuffle', face, swapped: false };
    }
    this.arms.forEach((arm) => { arm.target.set(arm.side * 2.4, 3.2, 2.6); arm.until = this.time + 0.9; });
  }

  react(kind) {
    this.reaction = { kind, t: 0 };
    if (kind === 'win') this.emote('Victoire !');
    if (kind === 'lose') this.emote('Bien joué…');
  }

  intro() {
    this.tiles.forEach((T) => {
      T.anim = { t: -(T.base.y / TH) * 0.3 - Math.random() * 0.5, kind: 'drop' };
      T.group.position.y = T.base.y + 12;
    });
  }

  // ---------------------------------------------------------------- animation
  update(dt) {
    this.time += dt;
    const k = Math.min(1, dt * 10);
    const target = new THREE.Color();
    for (const T of this.tiles) {
      if (T.removed) continue;
      const an = T.anim;
      if (an) {
        an.t += dt;
        const t = Math.max(0, an.t);
        if (an.kind === 'drop') {
          const e = ease(Math.min(1, t / 0.7));
          T.group.position.set(T.base.x, T.base.y + 12 * (1 - e), T.base.z);
          if (t >= 0.7) T.anim = null;
        } else if (an.kind === 'remove') {
          const e = Math.min(1, t / 0.55);
          T.group.position.set(T.base.x, T.base.y + ease(e) * 2.2, T.base.z);
          T.group.rotation.set(0, e * Math.PI, 0);
          T.group.scale.setScalar(Math.max(0.001, 1 - e * e));
          T.bodyMat.emissive.copy(JADE).multiplyScalar(0.6 * e);
          if (e >= 1) {
            T.removed = true;
            T.group.visible = false;
            T.anim = null;
            const w = T.group.getWorldPosition(new THREE.Vector3());
            this.s.burst(w, { count: 30, color: '#5affc8', speed: 3.2, life: 0.9 });
          }
          continue;
        } else if (an.kind === 'restore') {
          const e = Math.min(1, t / 0.45);
          T.group.scale.setScalar(Math.max(0.001, e));
          T.group.rotation.set(0, 0, 0);
          T.group.position.set(T.base.x, T.base.y + (1 - ease(e)) * 1.5, T.base.z);
          if (e >= 1) T.anim = null;
          continue;
        } else if (an.kind === 'shuffle') {
          const e = Math.min(1, t / 0.9);
          T.group.position.set(T.base.x, T.base.y + Math.sin(Math.PI * e) * 1.8, T.base.z);
          T.group.rotation.set(0, e * Math.PI * 2, 0);
          if (!an.swapped && e >= 0.5) {
            an.swapped = true;
            T.faceMat.map = this.s.faceTexture(an.face);
            T.faceMat.needsUpdate = true;
          }
          if (e >= 1) { T.anim = null; T.group.rotation.set(0, 0, 0); }
          continue;
        }
      }
      const liftT = T.selected ? 0.35 : 0;
      T.lift += (liftT - T.lift) * k;
      target.copy(T.selected ? JADE : new THREE.Color(0)).multiplyScalar(T.selected ? 0.55 + 0.15 * Math.sin(this.time * 6) : 0);
      T.glow.lerp(target, k);
      T.bodyMat.emissive.copy(T.glow);
      T.faceMat.emissive.copy(T.glow).multiplyScalar(0.4);
      if (!T.anim) T.group.position.set(T.base.x, T.base.y + T.lift, T.base.z);
    }

    // respiration, regard, réactions
    const breathe = Math.sin(this.time * 1.6);
    this.body.scale.set(1 + breathe * 0.008, 1 + breathe * 0.012, 1);
    for (const t of this.tails) t.rotation.x = Math.sin(this.time * 2.2 + t.position.x * 5) * 0.18;
    const r = this.reaction;
    let lean = 0;
    if (r) {
      r.t += dt;
      if (r.kind === 'win') {
        this.avatar.position.y = -0.2 + Math.abs(Math.sin(r.t * 6)) * 0.5;
        this.arms.forEach((arm) => { arm.target.set(arm.side * 1.9, 5.6 + Math.sin(r.t * 8 + arm.side) * 0.3, 0.9); arm.until = this.time + 0.2; });
        this.mouth.rotation.z = Math.PI;
        this.brows.forEach((b, i) => (b.rotation.z = (i ? -1 : 1) * 0.1));
      } else {
        this.head.rotation.x += (0.55 - this.head.rotation.x) * k * 0.3;
        lean = -0.12;
        this.mouth.rotation.z = 0;
        this.brows.forEach((b, i) => (b.rotation.z = (i ? 1 : -1) * 0.35)); // sourcils tristes
      }
    } else {
      // regarde la tuile sélectionnée, sinon son plateau
      const look = this.selected !== null ? this.tileInAvatarSpace(this.selected) : new THREE.Vector3(0, 0, 4);
      this.head.rotation.y += (Math.atan2(look.x, Math.max(1, look.z)) * 0.7 - this.head.rotation.y) * k * 0.5;
      this.head.rotation.x += (0.32 - this.head.rotation.x) * k * 0.5;
    }
    // clignement des yeux
    const blink = (this.time % 3.7) < 0.12 ? 0.12 : 1;
    this.eyes.forEach((e) => (e.scale.y = blink));

    // le buste se penche quand une main part loin sur la table
    let reachZ = 0;
    for (const arm of this.arms) reachZ = Math.max(reachZ, arm.pos.z);
    lean += Math.min(0.45, Math.max(0, (reachZ - 2.2) * 0.09));
    this.body.rotation.x += (lean - this.body.rotation.x) * Math.min(1, dt * 5);

    // bras : 2 segments + coude calculé
    const L1 = 1.55, L2 = 1.5;
    for (const arm of this.arms) {
      if (this.time > arm.until) arm.target.copy(arm.rest);
      arm.pos.lerp(arm.target, Math.min(1, dt * 7));
      const S = arm.shoulder.clone().applyEuler(this.body.rotation);
      const T = arm.pos;
      const toT = T.clone().sub(S);
      let d = toT.length();
      // au-delà de la portée, les manches s'allongent un peu (style cartoon) plutôt que de rater la tuile
      const stretch = THREE.MathUtils.clamp(d / ((L1 + L2) * 0.98), 1, 1.35);
      const a1 = L1 * stretch, a2 = L2 * stretch;
      d = Math.min(d, (a1 + a2) * 0.999);
      const dir = toT.normalize();
      const cosA = THREE.MathUtils.clamp((a1 * a1 + d * d - a2 * a2) / (2 * a1 * d), -1, 1);
      const sinA = Math.sqrt(1 - cosA * cosA);
      // le coude part vers l'extérieur et vers le bas
      const pole = new THREE.Vector3(arm.side * 1, -0.8, -0.3);
      const perp = pole.sub(dir.clone().multiplyScalar(pole.dot(dir))).normalize();
      const E = S.clone().addScaledVector(dir, a1 * cosA).addScaledVector(perp, a1 * sinA);
      const H = S.clone().addScaledVector(dir, d);
      segment(arm.upper, S, E);
      segment(arm.fore, E, H);
      arm.elbowBall.position.copy(E);
      const fdir = H.clone().sub(E).normalize();
      arm.cuff.position.copy(E).lerp(H, 0.93);
      arm.cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fdir);
      // main : dans le prolongement de l'avant-bras, paume vers la table
      arm.hand.position.copy(H);
      arm.hand.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), fdir.clone().setY(Math.min(fdir.y, -0.25)).normalize());
    }

    // bulle d'émote : apparition puis disparition
    if (this.bubble.visible) {
      const t = this.time - this.bubbleAt;
      const pop = Math.min(1, t / 0.2);
      this.bubble.material.opacity = t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.4) : 1;
      this.bubble.scale.set(3.6 * (0.6 + 0.4 * pop), 3.6 * (170 / 420) * (0.6 + 0.4 * pop), 1);
      if (t > 2.8) this.bubble.visible = false;
    }
  }

  dispose() {
    this.unsub();
    this.s.scene.remove(this.group, this.avatar);
    for (const T of this.tiles) { T.bodyMat.dispose(); T.faceMat.dispose(); }
    for (const m of this.mats || []) m.dispose();
    this.avatar.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
      if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); }
    });
  }
}
