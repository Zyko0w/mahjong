// Décor d'ambiance chinoise : bambous, cerisiers en fleurs et pétales, bannières calligraphiées,
// paravent peint, vases bleu et blanc, brûle-encens fumant, service à thé, pagodes et lune.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FLOOR = -6.9;
const CJK = '"Noto Serif SC","Microsoft YaHei","SimSun",serif';
const rand = (a, b) => a + Math.random() * (b - a);
const polar = (angle, r, y = FLOOR) => new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
// angle « derrière » le plateau vu depuis la caméra par défaut (qui regarde vers -z)
const BACK = -Math.PI / 2;

function canvas(w, h, draw) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ bambous
function bambooTexture() {
  const t = canvas(64, 256, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, '#3f6a24');
    g.addColorStop(0.45, '#86b452');
    g.addColorStop(1, '#3a6222');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      c.fillStyle = `rgba(30,60,10,${Math.random() * 0.15})`;
      c.fillRect(Math.random() * w, Math.random() * h, 1, 10 + Math.random() * 30);
    }
    c.fillStyle = '#2f4f18';
    c.fillRect(0, h - 10, w, 6);
    c.fillStyle = 'rgba(220,240,170,0.6)';
    c.fillRect(0, h - 4, w, 2);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 7);
  return t;
}

function leafGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.quadraticCurveTo(0.14, 0.5, 0, 1.25);
  s.quadraticCurveTo(-0.14, 0.5, 0, 0);
  return new THREE.ShapeGeometry(s, 4);
}

function bambooCluster(stalkMat, leafMat, leafGeo, count) {
  const group = new THREE.Group();
  const stalkGeo = new THREE.CylinderGeometry(0.16, 0.21, 1, 8, 1);
  stalkGeo.translate(0, 0.5, 0);
  const stalks = new THREE.InstancedMesh(stalkGeo, stalkMat, count);
  const leaves = new THREE.InstancedMesh(leafGeo, leafMat, count * 30);
  const d = new THREE.Object3D();
  const col = new THREE.Color();
  let li = 0;
  for (let i = 0; i < count; i++) {
    const base = new THREE.Vector3(rand(-2.2, 2.2), 0, rand(-2.2, 2.2));
    const H = rand(13, 20);
    const lean = new THREE.Euler(rand(-0.08, 0.08), 0, rand(-0.08, 0.08));
    d.position.copy(base);
    d.rotation.copy(lean);
    d.scale.set(rand(0.8, 1.2), H, rand(0.8, 1.2));
    d.updateMatrix();
    stalks.setMatrixAt(i, d.matrix);
    const axis = new THREE.Vector3(0, 1, 0).applyEuler(lean);
    for (let sp = 0; sp < 6; sp++) {
      const h = H * rand(0.5, 1);
      const p = base.clone().addScaledVector(axis, h);
      const yaw = rand(0, Math.PI * 2);
      for (let k = 0; k < 5 && li < count * 30; k++) {
        d.position.copy(p);
        d.rotation.set(0, 0, 0);
        d.rotateY(yaw + (k - 2) * 0.35);
        d.rotateX(rand(1.6, 2.4)); // feuilles retombantes
        d.scale.setScalar(rand(0.8, 1.3));
        d.updateMatrix();
        leaves.setMatrixAt(li, d.matrix);
        leaves.setColorAt(li, col.setHSL(rand(0.24, 0.3), rand(0.45, 0.6), rand(0.22, 0.34)));
        li++;
      }
    }
  }
  leaves.count = li;
  group.add(stalks, leaves);
  return group;
}

// ------------------------------------------------------------------ cerisiers
function cherryTree(barkMat, blossomMat) {
  const tubes = [];
  const tips = [];
  const branch = (start, dir, len, radius, depth) => {
    const end = start.clone().addScaledVector(dir, len);
    const mid = start.clone().lerp(end, 0.5).add(new THREE.Vector3(rand(-0.3, 0.3) * len * 0.3, 0, rand(-0.3, 0.3) * len * 0.3));
    const curve = new THREE.CatmullRomCurve3([start, mid, end]);
    tubes.push(new THREE.TubeGeometry(curve, 6, radius, 7, false));
    if (depth === 0) {
      tips.push(end);
      return;
    }
    const n = depth === 3 ? 3 : 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const nd = dir.clone();
      const axis = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
      nd.applyAxisAngle(axis, rand(0.45, 0.95)).normalize();
      nd.y = Math.max(nd.y, 0.15);
      nd.normalize();
      branch(end, nd, len * rand(0.62, 0.78), radius * 0.62, depth - 1);
      if (depth <= 2) tips.push(end.clone().lerp(end.clone().addScaledVector(nd, len * 0.6), 0.5));
    }
  };
  branch(new THREE.Vector3(0, 0, 0), new THREE.Vector3(rand(-0.15, 0.15), 1, rand(-0.15, 0.15)).normalize(), 5.2, 0.5, 3);
  const g = new THREE.Group();
  g.add(new THREE.Mesh(mergeGeometries(tubes), barkMat));
  // Boules de fleurs
  const puffGeo = new THREE.IcosahedronGeometry(0.55, 1);
  const per = 16;
  const blossoms = new THREE.InstancedMesh(puffGeo, blossomMat, tips.length * per);
  const d = new THREE.Object3D();
  const palette = ['#ffc8d8', '#ffb3c9', '#ff9fbd', '#ffe3ec', '#f7a6c4'].map((c) => new THREE.Color(c));
  let i = 0;
  for (const tip of tips) {
    for (let k = 0; k < per; k++) {
      d.position.copy(tip).add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.6, 1.1), rand(-1.5, 1.5)));
      d.rotation.set(rand(0, 3), rand(0, 3), 0);
      d.scale.setScalar(rand(0.55, 1.35));
      d.updateMatrix();
      blossoms.setMatrixAt(i, d.matrix);
      blossoms.setColorAt(i, palette[i % palette.length]);
      i++;
    }
  }
  g.add(blossoms);
  g.userData.tips = tips;
  return g;
}

// ------------------------------------------------------------------ bannières calligraphiées
function bannerTexture(ch) {
  return canvas(160, 560, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#8e1016');
    g.addColorStop(1, '#5e0a0e');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.strokeStyle = '#d9a74a';
    c.lineWidth = 6;
    c.strokeRect(10, 10, w - 20, h - 20);
    c.lineWidth = 2;
    c.strokeRect(20, 20, w - 40, h - 40);
    // losange porte-bonheur
    c.save();
    c.translate(w / 2, h * 0.42);
    c.rotate(Math.PI / 4);
    c.fillStyle = '#c11e24';
    c.fillRect(-52, -52, 104, 104);
    c.strokeStyle = '#e6b85c';
    c.lineWidth = 4;
    c.strokeRect(-52, -52, 104, 104);
    c.restore();
    c.fillStyle = '#f2c96a';
    c.font = `900 96px ${CJK}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(ch, w / 2, h * 0.42);
    // motif nuages bas
    c.strokeStyle = 'rgba(230,184,92,0.7)';
    c.lineWidth = 3;
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.arc(w / 2 + (k - 1) * 36, h * 0.8, 14, Math.PI, Math.PI * 2.6);
      c.stroke();
    }
  });
}

// ------------------------------------------------------------------ paravent peint
function screenPainting() {
  return canvas(1536, 768, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#f3e6c6');
    g.addColorStop(1, '#e2cc9c');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    // soleil rouge
    const sun = c.createRadialGradient(w * 0.62, h * 0.36, 0, w * 0.62, h * 0.36, 60);
    sun.addColorStop(0, 'rgba(226,150,70,0.75)');
    sun.addColorStop(1, 'rgba(226,150,70,0)');
    c.fillStyle = sun;
    c.fillRect(w * 0.62 - 60, h * 0.36 - 60, 120, 120);
    // montagnes au lavis
    const layers = [['rgba(70,90,110,0.35)', 0.55, 160], ['rgba(50,65,80,0.55)', 0.68, 120], ['rgba(25,35,45,0.8)', 0.82, 90]];
    for (const [col, base, amp] of layers) {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(0, h);
      for (let x = 0; x <= w; x += 12) {
        const y = h * base - Math.abs(Math.sin(x * 0.004 + base * 9)) * amp - Math.sin(x * 0.013 + base) * amp * 0.25;
        c.lineTo(x, y);
      }
      c.lineTo(w, h);
      c.fill();
    }
    // brume
    for (let i = 0; i < 6; i++) {
      const mg = c.createLinearGradient(0, h * (0.5 + i * 0.06), 0, h * (0.56 + i * 0.06));
      mg.addColorStop(0, 'rgba(243,230,198,0)');
      mg.addColorStop(0.5, 'rgba(243,230,198,0.5)');
      mg.addColorStop(1, 'rgba(243,230,198,0)');
      c.fillStyle = mg;
      c.fillRect(0, h * (0.5 + i * 0.06), w, h * 0.06);
    }
    // grues
    c.strokeStyle = '#1c1c1c';
    c.lineWidth = 4;
    for (const [x, y, s] of [[300, 180, 1.2], [380, 230, 0.9], [460, 160, 0.7], [1050, 300, 0.8]]) {
      c.beginPath();
      c.moveTo(x - 30 * s, y - 10 * s);
      c.quadraticCurveTo(x - 10 * s, y - 22 * s, x, y);
      c.quadraticCurveTo(x + 10 * s, y - 22 * s, x + 30 * s, y - 10 * s);
      c.stroke();
    }
    // branche de pin
    c.strokeStyle = '#2a1a10';
    c.lineWidth = 12;
    c.beginPath();
    c.moveTo(0, 120);
    c.quadraticCurveTo(160, 150, 260, 90);
    c.stroke();
    c.fillStyle = 'rgba(30,70,40,0.85)';
    for (let i = 0; i < 14; i++) {
      c.beginPath();
      c.ellipse(60 + i * 15, 110 + Math.sin(i) * 20, 26, 12, rand(-0.5, 0.5), 0, Math.PI * 2);
      c.fill();
    }
    // sceau rouge et calligraphie
    c.fillStyle = '#b4232a';
    c.fillRect(w - 110, h - 190, 60, 60);
    c.fillStyle = '#f3e6c6';
    c.font = `900 40px ${CJK}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('雀', w - 80, h - 160);
    c.fillStyle = 'rgba(20,20,20,0.85)';
    c.font = `700 46px ${CJK}`;
    ['山', '水', '清', '音'].forEach((ch, i) => c.fillText(ch, w - 80, 90 + i * 56));
  });
}

function foldingScreen(lacquer, gold) {
  const g = new THREE.Group();
  const paint = screenPainting();
  const PW = 2.2, PH = 7.5, N = 6, A = 0.32;
  const frameGeoV = new THREE.BoxGeometry(0.14, PH + 0.3, 0.14);
  const frameGeoH = new THREE.BoxGeometry(PW, 0.14, 0.14);
  let x = -((N * PW * Math.cos(A)) / 2);
  for (let i = 0; i < N; i++) {
    const tex = paint.clone();
    tex.repeat.set(1 / N, 1);
    tex.offset.set(i / N, 0);
    tex.needsUpdate = true;
    const panel = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.12 }));
    face.position.set(PW / 2, PH / 2 + 0.3, 0);
    panel.add(face);
    for (const fx of [0, PW]) {
      const v = new THREE.Mesh(frameGeoV, lacquer);
      v.position.set(fx, PH / 2 + 0.15, 0);
      panel.add(v);
    }
    for (const fy of [0.3, PH + 0.3]) {
      const h = new THREE.Mesh(frameGeoH, lacquer);
      h.position.set(PW / 2, fy, 0);
      panel.add(h);
    }
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), gold);
    knob.position.set(0, PH + 0.5, 0);
    panel.add(knob);
    const rot = i % 2 === 0 ? A : -A;
    panel.rotation.y = rot;
    panel.position.set(x, 0, i % 2 === 0 ? 0 : -PW * Math.sin(A));
    x += PW * Math.cos(A);
    g.add(panel);
  }
  return g;
}

// ------------------------------------------------------------------ vases bleu et blanc
function porcelainTexture() {
  return canvas(512, 512, (c, w, h) => {
    c.fillStyle = '#f3f5f7';
    c.fillRect(0, 0, w, h);
    const blue = '#1d3f8f';
    c.fillStyle = blue;
    c.fillRect(0, 0, w, 26);
    c.fillRect(0, h - 40, w, 40);
    c.strokeStyle = blue;
    c.lineWidth = 3;
    for (const y of [40, 64, h - 60]) {
      c.beginPath();
      for (let x = 0; x <= w; x += 4) c.lineTo(x, y + Math.sin(x * 0.1) * 5);
      c.stroke();
    }
    // rinceaux de lotus
    c.lineWidth = 4;
    for (let i = 0; i < 8; i++) {
      const cx = (i + 0.5) * (w / 8), cy = h * 0.5 + (i % 2 ? 50 : -50);
      c.beginPath();
      c.arc(cx, cy, 30, 0, Math.PI * 1.6);
      c.stroke();
      c.beginPath();
      c.arc(cx + 12, cy - 6, 14, Math.PI, Math.PI * 2.7);
      c.stroke();
      c.fillStyle = 'rgba(29,63,143,0.85)';
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * Math.PI * 2;
        c.beginPath();
        c.ellipse(cx + Math.cos(a) * 16, cy + Math.sin(a) * 16, 9, 4, a, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.beginPath();
    for (let x = 0; x <= w; x += 4) c.lineTo(x, h * 0.5 + Math.sin(x * 0.05) * 60);
    c.stroke();
  });
}

function vase(mat, scale = 1) {
  const pts = [[0, 0], [0.62, 0], [0.75, 0.15], [1.05, 0.9], [1.3, 2.0], [1.22, 2.7], [0.8, 3.3], [0.42, 3.65], [0.36, 3.95], [0.5, 4.15], [0.46, 4.25], [0, 4.25]].map(([x, y]) => new THREE.Vector2(x * scale, y * scale));
  const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), mat);
  return m;
}

// ------------------------------------------------------------------ pagode lointaine
function pagoda(darkMat, roofMat, windowMat, tiers = 7) {
  const g = new THREE.Group();
  let y = 0, w = 7;
  for (let i = 0; i < tiers; i++) {
    const h = 3.4 - i * 0.15;
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), darkMat);
    body.position.y = y + h / 2;
    g.add(body);
    for (let k = 0; k < 4; k++) {
      const win = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.22, h * 0.45), windowMat);
      const a = (k / 4) * Math.PI * 2;
      win.position.set(Math.sin(a) * (w / 2 + 0.02), y + h * 0.45, Math.cos(a) * (w / 2 + 0.02));
      win.rotation.y = a;
      g.add(win);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.95, 1.6, 4, 1, true), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = y + h + 0.6;
    g.add(roof);
    y += h + 0.9;
    w *= 0.86;
  }
  const spire = new THREE.Mesh(new THREE.ConeGeometry(0.4, 5, 8), roofMat);
  spire.position.y = y + 2.2;
  g.add(spire);
  return g;
}

// ------------------------------------------------------------------ construction
export function buildProps(scene, { isMobile = false, glowTex } = {}) {
  const updaters = [];
  const lacquer = new THREE.MeshPhysicalMaterial({ color: '#6b0e12', roughness: 0.3, clearcoat: 0.7 });
  const gold = new THREE.MeshStandardMaterial({ color: '#d6a54a', metalness: 1, roughness: 0.3 });

  // Bambous
  const stalkMat = new THREE.MeshStandardMaterial({ map: bambooTexture(), roughness: 0.55 });
  const leafMat = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.7 });
  const leafGeo = leafGeometry();
  const bambooSpots = [[BACK - 0.95, 27], [BACK + 1.05, 28], [0.35, 29], [1.25, 30], [2.6, 29], [3.55, 30], [BACK + 0.25, 33]];
  for (const [a, r] of bambooSpots) {
    const cl = bambooCluster(stalkMat, leafMat, leafGeo, isMobile ? 6 : 11);
    cl.position.copy(polar(a, r));
    cl.userData.phase = Math.random() * 10;
    scene.add(cl);
    updaters.push((dt, t) => {
      cl.rotation.z = Math.sin(t * 0.6 + cl.userData.phase) * 0.012;
      cl.rotation.x = Math.cos(t * 0.45 + cl.userData.phase) * 0.01;
    });
  }

  // Cerisiers
  const barkMat = new THREE.MeshStandardMaterial({ color: '#3a2219', roughness: 0.9 });
  const blossomMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75, flatShading: true, emissive: '#ff6f9c', emissiveIntensity: 0.12 });
  const trees = [];
  for (const [a, r, s] of [[BACK - 0.45, 26, 1.25], [BACK + 0.6, 27, 1.15], [0.95, 28, 1.2], [2.15, 27, 1.25], [3.0, 28, 1.1]]) {
    const tr = cherryTree(barkMat, blossomMat);
    tr.position.copy(polar(a, r));
    tr.scale.setScalar(s);
    tr.rotation.y = rand(0, Math.PI * 2);
    scene.add(tr);
    trees.push(tr);
    updaters.push((dt, t) => (tr.rotation.z = Math.sin(t * 0.5 + a * 3) * 0.008));
  }
  scene.updateMatrixWorld(true);
  const canopy = [];
  for (const tr of trees) for (const tip of tr.userData.tips) canopy.push(tip.clone().applyMatrix4(tr.matrixWorld));

  // Pétales qui tombent (certains traversent la table)
  const NP = isMobile ? 140 : 320;
  const petalGeo = new THREE.PlaneGeometry(0.17, 0.12);
  const petalMat = new THREE.MeshStandardMaterial({ color: '#ffc0d3', side: THREE.DoubleSide, roughness: 0.6, emissive: '#ff8fb0', emissiveIntensity: 0.2 });
  const petals = new THREE.InstancedMesh(petalGeo, petalMat, NP);
  petals.frustumCulled = false;
  const P = Array.from({ length: NP }, () => ({}));
  const spawn = (p, init) => {
    if (Math.random() < 0.7 && canopy.length) {
      const c = canopy[Math.floor(Math.random() * canopy.length)];
      p.pos = c.clone().add(new THREE.Vector3(rand(-1.5, 1.5), rand(-0.5, 0.5), rand(-1.5, 1.5)));
    } else {
      const a = rand(0, Math.PI * 2), r = rand(2, 22);
      p.pos = new THREE.Vector3(Math.cos(a) * r, rand(7, 13), Math.sin(a) * r);
    }
    if (init) p.pos.y = rand(FLOOR, p.pos.y);
    p.vel = new THREE.Vector3(rand(0.2, 0.6), -rand(0.35, 0.75), rand(-0.2, 0.2));
    p.rot = new THREE.Euler(rand(0, 6), rand(0, 6), rand(0, 6));
    p.spin = new THREE.Vector3(rand(-2, 2), rand(-2, 2), rand(-2, 2));
    p.phase = rand(0, 10);
  };
  P.forEach((p) => spawn(p, true));
  scene.add(petals);
  const dummy = new THREE.Object3D();
  updaters.push((dt, t) => {
    for (let i = 0; i < NP; i++) {
      const p = P[i];
      p.pos.x += (p.vel.x + Math.sin(t * 0.8 + p.phase) * 0.35) * dt;
      p.pos.y += p.vel.y * dt;
      p.pos.z += (p.vel.z + Math.cos(t * 0.6 + p.phase) * 0.25) * dt;
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;
      const onTable = p.pos.x * p.pos.x + p.pos.z * p.pos.z < 13 * 13 && p.pos.y < 0.05 && p.pos.y > -0.5;
      if (p.pos.y < FLOOR + 0.05 || onTable || Math.abs(p.pos.x) > 45 || Math.abs(p.pos.z) > 45) spawn(p, false);
      dummy.position.copy(p.pos);
      dummy.rotation.copy(p.rot);
      dummy.updateMatrix();
      petals.setMatrixAt(i, dummy.matrix);
    }
    petals.instanceMatrix.needsUpdate = true;
  });

  // Bannières sur les piliers (mêmes angles que les piliers de scene.js)
  const chars = ['福', '龍', '壽', '喜', '財', '和', '雀', '春', '福', '鳳', '吉', '樂'];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.13;
    const tex = bannerTexture(chars[i]);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(2.1, 7.3),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.22, side: THREE.DoubleSide })
    );
    const pos = polar(a, 36 - 1.35, 4.5);
    m.position.copy(pos);
    m.lookAt(0, 4.5, 0);
    const baseRot = m.rotation.clone();
    scene.add(m);
    updaters.push((dt, t) => (m.rotation.z = baseRot.z + Math.sin(t * 0.7 + i) * 0.015));
  }

  // Paravent peint derrière le plateau
  const screen = foldingScreen(lacquer, gold);
  screen.position.copy(polar(BACK, 21));
  screen.lookAt(0, FLOOR, 0);
  scene.add(screen);

  // Vases bleu et blanc
  const porcelain = new THREE.MeshPhysicalMaterial({ map: porcelainTexture(), roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.08 });
  for (const [a, r, s] of [[BACK - 0.33, 19.5, 1.1], [BACK + 0.33, 19.5, 1.1], [0.4, 18, 0.9], [2.75, 18, 0.95], [1.57 + 0.5, 17.5, 0.8]]) {
    const v = vase(porcelain, s);
    v.position.copy(polar(a, r));
    v.rotation.y = rand(0, 6);
    scene.add(v);
    const stand = new THREE.Mesh(new THREE.CylinderGeometry(1.5 * s, 1.6 * s, 0.4, 24), lacquer);
    stand.position.copy(polar(a, r, FLOOR + 0.2));
    v.position.y += 0.4;
    scene.add(stand);
  }

  // Petite table basse : service à thé + brûle-encens
  const sideTable = new THREE.Group();
  const top = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.2, 0.25, 40), lacquer);
  top.position.y = 4.2;
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.8, 4.1, 16), lacquer);
  leg.position.y = 2.05;
  sideTable.add(top, leg);
  const clay = new THREE.MeshPhysicalMaterial({ color: '#7a4a32', roughness: 0.35, clearcoat: 0.6 });
  const celadon = new THREE.MeshPhysicalMaterial({ color: '#9cc7b0', roughness: 0.2, clearcoat: 1 });
  const pot = new THREE.Mesh(new THREE.LatheGeometry([[0, 0], [0.35, 0], [0.55, 0.2], [0.6, 0.45], [0.45, 0.7], [0.2, 0.78], [0, 0.78]].map(([x, y]) => new THREE.Vector2(x, y)), 24), clay);
  pot.position.set(-0.4, 4.33, 0);
  const lid = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), clay);
  lid.position.set(-0.4, 5.15, 0);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.1, 0.6, 8), clay);
  spout.position.set(0.15, 4.8, 0);
  spout.rotation.z = -0.9;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.045, 8, 16, Math.PI * 1.3), clay);
  handle.position.set(-0.95, 4.75, 0);
  handle.rotation.z = Math.PI / 2;
  sideTable.add(pot, lid, spout, handle);
  for (let k = 0; k < 3; k++) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.11, 0.2, 16, 1, true), celadon);
    cup.position.set(0.7 + Math.cos(k * 2.1) * 0.5, 4.43, Math.sin(k * 2.1) * 0.7);
    sideTable.add(cup);
  }
  sideTable.position.copy(polar(BACK + 0.62, 17));
  scene.add(sideTable);

  // Brûle-encens (ding) en bronze + fumée
  const bronze = new THREE.MeshStandardMaterial({ color: '#7a5a2a', metalness: 0.9, roughness: 0.45 });
  const ding = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(1.1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), bronze);
  bowl.scale.y = 0.8;
  bowl.position.y = 3.2;
  const rim = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.09, 8, 32), bronze);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 3.2;
  ding.add(bowl, rim);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.18, 2.6, 8), bronze);
    l.position.set(Math.cos(a) * 0.75, 1.3, Math.sin(a) * 0.75);
    ding.add(l);
  }
  for (const s of [-1, 1]) {
    const h = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.07, 8, 16, Math.PI), bronze);
    h.position.set(s * 0.75, 3.35, 0);
    ding.add(h);
  }
  const ember = new THREE.Mesh(new THREE.SphereGeometry(0.25, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff8a3a' }));
  ember.position.y = 3.1;
  ding.add(ember);
  const dingPos = polar(BACK - 0.62, 17);
  ding.position.copy(dingPos);
  scene.add(ding);
  const NS = 70;
  const smokePos = new Float32Array(NS * 3);
  const smokeCol = new Float32Array(NS * 3);
  const smoke = Array.from({ length: NS }, (_, i) => ({ life: (i / NS) * 6, max: 6 }));
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  sg.setAttribute('color', new THREE.BufferAttribute(smokeCol, 3));
  const smokePts = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.1, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  smokePts.frustumCulled = false;
  scene.add(smokePts);
  updaters.push((dt, t) => {
    for (let i = 0; i < NS; i++) {
      const s = smoke[i];
      s.life += dt;
      if (s.life > s.max) s.life = 0;
      const k = s.life / s.max;
      const h = s.life * 1.3;
      smokePos[i * 3] = dingPos.x + Math.sin(h * 0.9 + i) * 0.25 * (1 + h * 0.3) + h * 0.12;
      smokePos[i * 3 + 1] = dingPos.y + 3.3 + h;
      smokePos[i * 3 + 2] = dingPos.z + Math.cos(h * 0.7 + i * 0.5) * 0.25 * (1 + h * 0.3);
      const a = Math.sin(Math.PI * k) * 0.09;
      smokeCol[i * 3] = a * 1.0;
      smokeCol[i * 3 + 1] = a * 0.95;
      smokeCol[i * 3 + 2] = a * 0.9;
    }
    sg.attributes.position.needsUpdate = true;
    sg.attributes.color.needsUpdate = true;
    ember.material.color.setHSL(0.06, 1, 0.5 + Math.sin(t * 3) * 0.08);
  });

  // Pagodes et lune au loin
  const dark = new THREE.MeshStandardMaterial({ color: '#2a0d0c', roughness: 0.9 });
  const roof = new THREE.MeshStandardMaterial({ color: '#1a0807', roughness: 0.8, side: THREE.DoubleSide });
  const windowMat = new THREE.MeshBasicMaterial({ color: '#ffb35a', fog: false });
  for (const [a, r, s, n] of [[BACK - 0.55, 78, 1.1, 7], [BACK + 0.4, 88, 0.9, 5], [Math.PI * 0.15, 85, 1, 6]]) {
    const pg = pagoda(dark, roof, windowMat, n);
    pg.position.copy(polar(a, r));
    pg.scale.setScalar(s);
    pg.rotation.y = rand(0, 1);
    scene.add(pg);
  }
  const moon = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 16), new THREE.MeshBasicMaterial({ color: '#ffe8c0', fog: false }));
  moon.position.set(-38, 26, -112);
  scene.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffcf9a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.position.copy(moon.position);
  halo.scale.setScalar(42);
  scene.add(halo);

  return { update: (dt, t) => updaters.forEach((u) => u(dt, t)) };
}
