// Duel immersif : l'adversaire est assis en face, de l'autre côté de la table.
// Son plateau (copie exacte du nôtre, même donne) est rejoué en direct à partir de ses actions,
// et un personnage en robe de jade tend les bras vers les tuiles qu'il choisit.
import * as THREE from 'three';
import { TILE, TABLE_RADIUS } from './scene.js';

const { TH, SX, SZ } = TILE;
const JADE = new THREE.Color(0.15, 1.0, 0.65);
const GOLD = new THREE.Color(1.5, 0.95, 0.25);
const ease = (t) => 1 - (1 - t) ** 3;

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
    avatarZ: -(TABLE_RADIUS * tableScale + 1.6),
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

  // ---------------------------------------------------------------- personnage
  buildAvatar() {
    const a = (this.avatar = new THREE.Group());
    a.position.set(0, 0, this.layout.avatarZ);
    a.scale.setScalar(1.35);
    const robe = new THREE.MeshStandardMaterial({ color: '#1d6b50', roughness: 0.65 });
    const robeDark = new THREE.MeshStandardMaterial({ color: '#124634', roughness: 0.7 });
    const gold = new THREE.MeshStandardMaterial({ color: '#d6a54a', metalness: 0.9, roughness: 0.3 });
    const skin = new THREE.MeshStandardMaterial({ color: '#e7c39b', roughness: 0.6 });
    const ink = new THREE.MeshBasicMaterial({ color: '#1a0f0a' });
    const straw = new THREE.MeshStandardMaterial({ color: '#c9a25a', roughness: 0.85 });

    const torso = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 2.1, 4.6, 28), robe);
    torso.position.y = 0.4;
    const sash = new THREE.Mesh(new THREE.CylinderGeometry(1.42, 1.5, 0.45, 28), gold);
    sash.position.y = 0.9;
    const collarL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 0.1), gold);
    collarL.position.set(-0.32, 2.15, 1.18);
    collarL.rotation.z = -0.45;
    const collarR = collarL.clone();
    collarR.position.x = 0.32;
    collarR.rotation.z = 0.45;
    const shoulders = new THREE.Mesh(new THREE.SphereGeometry(1.45, 24, 12), robe);
    shoulders.scale.set(1.25, 0.55, 0.85);
    shoulders.position.y = 2.75;
    a.add(torso, sash, collarL, collarR, shoulders);

    const head = (this.head = new THREE.Group());
    head.position.y = 3.95;
    const skull = new THREE.Mesh(new THREE.SphereGeometry(0.92, 28, 18), skin);
    const eyeGeo = new THREE.SphereGeometry(0.1, 10, 8);
    const eyeL = new THREE.Mesh(eyeGeo, ink);
    eyeL.position.set(-0.32, 0.08, 0.84);
    const eyeR = eyeL.clone();
    eyeR.position.x = 0.32;
    this.eyes = [eyeL, eyeR];
    const browGeo = new THREE.BoxGeometry(0.34, 0.06, 0.05);
    const browL = new THREE.Mesh(browGeo, ink);
    browL.position.set(-0.33, 0.3, 0.83);
    browL.rotation.z = 0.18;
    const browR = browL.clone();
    browR.position.x = 0.33;
    browR.rotation.z = -0.18;
    const mouth = (this.mouth = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.035, 6, 16, Math.PI), ink));
    mouth.position.set(0, -0.32, 0.82);
    mouth.rotation.z = Math.PI;
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 10), ink);
    beard.position.set(0, -0.85, 0.62);
    beard.rotation.x = Math.PI + 0.35;
    const hat = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.8, 36, 1, true), straw);
    hat.material.side = THREE.DoubleSide;
    hat.position.set(0, 1.0, -0.25);
    hat.rotation.x = -0.35; // chapeau relevé : on voit le visage
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), gold);
    knob.position.set(0, 1.42, -0.4);
    head.add(skull, eyeL, eyeR, browL, browR, mouth, beard, hat, knob);
    a.add(head);

    // bras : manche étirable de l'épaule à la main
    this.arms = [-1, 1].map((side) => {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 1, 14), robeDark);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.1, 8, 18), gold);
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.38, 16, 12), skin);
      a.add(sleeve, cuff, hand);
      const rest = new THREE.Vector3(side * 1.55, 0.55, 2.3);
      return { side, sleeve, cuff, hand, shoulder: new THREE.Vector3(side * 1.65, 2.7, 0.3), rest, target: rest.clone(), pos: rest.clone(), until: 0 };
    });

    // lumière douce de jade sur le personnage
    const light = new THREE.PointLight(0x7affd0, 18, 18, 1.8);
    light.position.set(0, 6, 4);
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
      ctx.font = '900 52px Cinzel, serif';
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
      ctx.font = '700 22px Inter, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(`${left} tuiles`, w / 2, 116);
    }, 512, 150, 4.4);
    this.plate.position.set(-3.6, 5.2, 0.5);
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
      ctx.font = '900 54px Cinzel, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, w / 2, (h - 40) / 2 + 6);
    }, 420, 170, 3.6);
    this.bubble.position.set(3.2, 5.6, 0.5);
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
    const breathe = Math.sin(this.time * 1.6) * 0.05;
    this.head.position.y = 3.95 + breathe;
    const r = this.reaction;
    if (r) {
      r.t += dt;
      if (r.kind === 'win') {
        this.avatar.position.y = Math.abs(Math.sin(r.t * 6)) * 0.6;
        this.arms.forEach((arm) => { arm.target.set(arm.side * 2.2, 6.2 + Math.sin(r.t * 8) * 0.3, 0.8); arm.until = this.time + 0.2; });
        this.mouth.rotation.z = Math.PI;
      } else {
        this.head.rotation.x = Math.min(0.5, r.t * 1.2);
        this.mouth.rotation.z = 0;
      }
    } else {
      // regarde la tuile sélectionnée
      const look = this.selected !== null ? this.tileInAvatarSpace(this.selected) : new THREE.Vector3(0, 0, 4);
      this.head.rotation.y += (Math.atan2(look.x, Math.max(1, look.z)) * 0.6 - this.head.rotation.y) * k * 0.5;
      this.head.rotation.x += (0.28 - this.head.rotation.x) * k * 0.5;
    }
    // clignement des yeux
    const blink = (this.time % 3.7) < 0.12 ? 0.15 : 1;
    this.eyes.forEach((e) => (e.scale.y = blink));

    // bras
    for (const arm of this.arms) {
      if (this.time > arm.until) arm.target.copy(arm.rest);
      arm.pos.lerp(arm.target, Math.min(1, dt * 7));
      const dir = arm.pos.clone().sub(arm.shoulder);
      const len = dir.length();
      arm.sleeve.position.copy(arm.shoulder).addScaledVector(dir, 0.5);
      arm.sleeve.scale.set(1, len, 1);
      arm.sleeve.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
      arm.hand.position.copy(arm.pos);
      arm.cuff.position.copy(arm.shoulder).addScaledVector(dir, len * 0.92);
      arm.cuff.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
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
    this.avatar.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
      if (o.isSprite) { o.material.map.dispose(); o.material.dispose(); }
    });
  }
}
