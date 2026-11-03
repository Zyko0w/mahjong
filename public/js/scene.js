// Rendu 3D immersif (Three.js) : salle de temple, table, tuiles, effets.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { drawFace, feltCanvas, woodCanvas, glowCanvas } from './textures.js';
import { buildProps } from './props.js';

const TW = 1.0, TD = 1.34, TH = 0.72, GAP = 0.035;
const SX = (TW + GAP) / 2, SZ = (TD + GAP) / 2;
export const TILE = { TW, TD, TH, GAP, SX, SZ };
export const TABLE_RADIUS = 12.7;
const IVORY = new THREE.Color('#f4ead2');
const GOLD = new THREE.Color(1.6, 0.95, 0.22);
const CYAN = new THREE.Color(0.15, 1.1, 1.3);
const HOVER = new THREE.Color(0.16, 0.12, 0.06);
const BLACK = new THREE.Color(0, 0, 0);

const ease = {
  outCubic: (t) => 1 - (1 - t) ** 3,
  inCubic: (t) => t * t * t,
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  outBack: (t) => 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
};
const clamp01 = (t) => Math.min(1, Math.max(0, t));

export class Scene3D {
  constructor(container, { onTileClick, onTileHover, onLand } = {}) {
    this.container = container;
    this.onTileClick = onTileClick || (() => {});
    this.onTileHover = onTileHover || (() => {});
    this.onLand = onLand || (() => {});
    this.isMobile = matchMedia('(pointer: coarse)').matches;

    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    r.setPixelRatio(Math.min(devicePixelRatio, this.isMobile ? 1.5 : 2));
    r.setSize(innerWidth, innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    container.appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x0e0506, 28, 85);
    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 300);
    this.camera.position.set(0, 26, 30);

    const pmrem = new THREE.PMREMGenerator(r);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.22;

    const c = (this.controls = new OrbitControls(this.camera, r.domElement));
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.minPolarAngle = 0.05;
    c.maxPolarAngle = 1.32;
    c.minDistance = 6;
    c.maxDistance = 34;
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.9;
    c.target.set(0, 0.6, 0.4);
    c.autoRotateSpeed = 0.5;

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.6, 0.45, 1.25);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.faceTextures = new Map();
    this.tiles = [];
    this.pickables = [];
    this.tweens = [];
    this.updaters = [];
    this.tableScaleTarget = 1;
    this.duelLayout = null;
    this.hovered = null;
    this.time = 0;
    this.lastFrame = performance.now();
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2(-9, -9);
    this.hoverDirty = false;
    this.camAnim = null;

    this.boardGroup = new THREE.Group();
    this.scene.add(this.boardGroup);

    this.glowTex = new THREE.CanvasTexture(glowCanvas());
    this.buildWorld();
    this.props = buildProps(this.scene, { isMobile: this.isMobile, glowTex: this.glowTex });
    this.buildTileAssets();
    this.buildParticles();
    this.bindEvents();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------ décor
  buildWorld() {
    const s = this.scene;
    // Dôme dégradé
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(140, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: {
          top: { value: new THREE.Color('#070304') },
          mid: { value: new THREE.Color('#2a0a0c') },
          bot: { value: new THREE.Color('#030102') },
        },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader:
          'uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(h, 0.55)) : mix(mid, bot, pow(-h, 0.35)); gl_FragColor = vec4(c, 1.0); }',
      })
    );
    s.add(sky);

    // Lumières
    s.add(new THREE.HemisphereLight(0xffe6cc, 0x1a0808, 0.4));
    const sun = (this.sun = new THREE.DirectionalLight(0xfff0dc, 1.55));
    sun.position.set(7, 20, 10);
    sun.castShadow = true;
    sun.shadow.mapSize.set(this.isMobile ? 1024 : 2048, this.isMobile ? 1024 : 2048);
    Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 13, bottom: -13, near: 5, far: 45 });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    s.add(sun);
    const fill = new THREE.DirectionalLight(0xff9a6a, 0.35);
    fill.position.set(-10, 8, -6);
    s.add(fill);

    // Table
    const wood = new THREE.CanvasTexture(woodCanvas());
    wood.wrapS = wood.wrapT = THREE.RepeatWrapping;
    wood.repeat.set(4, 1);
    wood.colorSpace = THREE.SRGBColorSpace;
    const woodMat = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.35, clearcoat: 0.7, clearcoatRoughness: 0.2, color: '#c08070' });
    const table = new THREE.Mesh(new THREE.CylinderGeometry(13.6, 13.2, 0.9, 96), woodMat);
    table.position.y = -0.45;
    table.receiveShadow = true;
    const tg = (this.tableGroup = new THREE.Group());
    s.add(tg);
    tg.add(table);
    const feltTex = new THREE.CanvasTexture(feltCanvas());
    feltTex.colorSpace = THREE.SRGBColorSpace;
    feltTex.anisotropy = 8;
    const felt = new THREE.Mesh(new THREE.CircleGeometry(12.7, 96), new THREE.MeshStandardMaterial({ map: feltTex, roughness: 0.95 }));
    felt.rotation.x = -Math.PI / 2;
    felt.position.y = 0.003;
    felt.receiveShadow = true;
    tg.add(felt);
    const goldMat = new THREE.MeshStandardMaterial({ color: '#d6a54a', metalness: 1, roughness: 0.28 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(12.85, 0.13, 12, 128), goldMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.05;
    tg.add(rim);
    const foot = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.2, 6, 48), woodMat);
    foot.position.y = -3.9;
    tg.add(foot);

    // Sol
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(90, 64),
      new THREE.MeshStandardMaterial({ color: '#1a0c08', roughness: 0.55, metalness: 0.2 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -6.9;
    floor.receiveShadow = true;
    s.add(floor);
    const rug = new THREE.Mesh(new THREE.RingGeometry(16, 18, 96), new THREE.MeshStandardMaterial({ color: '#5a1010', roughness: 0.9 }));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = -6.88;
    s.add(rug);

    // Piliers laqués
    const pillarMat = new THREE.MeshPhysicalMaterial({ color: '#6b0e12', roughness: 0.35, clearcoat: 0.6 });
    const pillarGeo = new THREE.CylinderGeometry(1.1, 1.2, 46, 24);
    const bandGeo = new THREE.TorusGeometry(1.22, 0.12, 8, 32);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + 0.13;
      const p = new THREE.Mesh(pillarGeo, pillarMat);
      p.position.set(Math.cos(a) * 36, 16, Math.sin(a) * 36);
      s.add(p);
      for (const y of [-5.5, 6, 14]) {
        const b = new THREE.Mesh(bandGeo, goldMat);
        b.rotation.x = Math.PI / 2;
        b.position.set(p.position.x, y, p.position.z);
        s.add(b);
      }
    }

    // Lanternes
    this.lanterns = [];
    const lanternBody = new THREE.SphereGeometry(0.95, 24, 16);
    const capGeo = new THREE.CylinderGeometry(0.42, 0.5, 0.22, 20);
    const tasselGeo = new THREE.CylinderGeometry(0.03, 0.14, 1.0, 8);
    const ropeGeo = new THREE.CylinderGeometry(0.015, 0.015, 30, 4);
    const lanternMat = new THREE.MeshStandardMaterial({ color: '#8a1010', emissive: '#ff4f1a', emissiveIntensity: 2.4, roughness: 0.7 });
    const tasselMat = new THREE.MeshStandardMaterial({ color: '#b01818', roughness: 0.8 });
    const ropeMat = new THREE.MeshBasicMaterial({ color: '#2a1008' });
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const rad = 20 + (i % 2) * 5;
      const g = new THREE.Group();
      const body = new THREE.Mesh(lanternBody, lanternMat);
      body.scale.y = 1.2;
      const top = new THREE.Mesh(capGeo, goldMat);
      top.position.y = 1.2;
      const bot = new THREE.Mesh(capGeo, goldMat);
      bot.position.y = -1.2;
      const tassel = new THREE.Mesh(tasselGeo, tasselMat);
      tassel.position.y = -1.85;
      const rope = new THREE.Mesh(ropeGeo, ropeMat);
      rope.position.y = 16;
      g.add(body, top, bot, tassel, rope);
      const y = 8 + (i % 3) * 1.6;
      g.position.set(Math.cos(a) * rad, y, Math.sin(a) * rad);
      g.userData = { phase: i * 1.7, y };
      s.add(g);
      this.lanterns.push(g);
    }
    for (const [x, z] of [[-17, -12], [17, 10]]) {
      const pl = new THREE.PointLight(0xff5a2a, 60, 40, 1.8);
      pl.position.set(x, 9, z);
      s.add(pl);
    }

    // Poussières dorées en suspension
    const N = this.isMobile ? 180 : 420;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * Math.PI * 2, d = 4 + Math.random() * 26;
      pos.set([Math.cos(a) * d, Math.random() * 16 - 2, Math.sin(a) * d], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dust = new THREE.Points(
      dg,
      new THREE.PointsMaterial({ size: 0.13, map: this.glowTex, color: '#ffcf8a', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    s.add(this.dust);
  }

  buildTileAssets() {
    this.bodyGeo = new RoundedBoxGeometry(TW, 0.46, TD, 4, 0.09);
    this.backGeo = new RoundedBoxGeometry(TW * 0.995, 0.32, TD * 0.995, 4, 0.09);
    this.faceGeo = new THREE.PlaneGeometry(TW * 0.84, TD * 0.86);
    this.faceGeo.rotateX(-Math.PI / 2);
    this.backMat = new THREE.MeshPhysicalMaterial({ color: '#17654a', roughness: 0.28, clearcoat: 0.9, clearcoatRoughness: 0.15 });
  }

  faceTexture(face) {
    let t = this.faceTextures.get(face);
    if (!t) {
      t = new THREE.CanvasTexture(drawFace(face));
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.faceTextures.set(face, t);
    }
    return t;
  }

  // ------------------------------------------------------------ particules
  buildParticles() {
    const N = (this.pN = 1600);
    this.pPos = new Float32Array(N * 3).fill(-999);
    this.pCol = new Float32Array(N * 3);
    this.pVel = new Float32Array(N * 3);
    this.pLife = new Float32Array(N);
    this.pMax = new Float32Array(N).fill(1);
    this.pBase = new Float32Array(N * 3);
    this.pGrav = new Float32Array(N);
    this.pIdx = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.particles = new THREE.Points(
      g,
      new THREE.PointsMaterial({ size: 0.3, map: this.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  burst(at, { count = 50, color = '#ffc35a', speed = 4, life = 1.0, gravity = 3.5, spread = 1 } = {}) {
    const col = new THREE.Color(color);
    for (let k = 0; k < count; k++) {
      const i = this.pIdx;
      this.pIdx = (this.pIdx + 1) % this.pN;
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.35 + Math.random() * 0.65);
      this.pPos.set([at.x, at.y, at.z], i * 3);
      this.pVel.set([Math.sin(ph) * Math.cos(th) * v * spread, Math.abs(Math.cos(ph)) * v * 0.9 + v * 0.3, Math.sin(ph) * Math.sin(th) * v * spread], i * 3);
      const tint = 0.75 + Math.random() * 0.5;
      this.pBase.set([col.r * tint, col.g * tint, col.b * tint], i * 3);
      this.pMax[i] = this.pLife[i] = life * (0.6 + Math.random() * 0.6);
      this.pGrav[i] = gravity;
    }
  }

  updateParticles(dt) {
    for (let i = 0; i < this.pN; i++) {
      if (this.pLife[i] <= 0) continue;
      this.pLife[i] -= dt;
      const i3 = i * 3;
      if (this.pLife[i] <= 0) {
        this.pPos[i3 + 1] = -999;
        this.pCol[i3] = this.pCol[i3 + 1] = this.pCol[i3 + 2] = 0;
        continue;
      }
      this.pVel[i3 + 1] -= this.pGrav[i] * dt;
      const drag = 1 - 1.6 * dt;
      this.pVel[i3] *= drag; this.pVel[i3 + 1] *= drag; this.pVel[i3 + 2] *= drag;
      this.pPos[i3] += this.pVel[i3] * dt;
      this.pPos[i3 + 1] += this.pVel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.pVel[i3 + 2] * dt;
      const f = (this.pLife[i] / this.pMax[i]) ** 1.5;
      this.pCol[i3] = this.pBase[i3] * f;
      this.pCol[i3 + 1] = this.pBase[i3 + 1] * f;
      this.pCol[i3 + 2] = this.pBase[i3 + 2] * f;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
    this.particles.geometry.attributes.color.needsUpdate = true;
  }

  // ------------------------------------------------------------ plateau
  clearBoard() {
    for (const t of this.tiles) {
      this.boardGroup.remove(t.group);
      t.bodyMat.dispose();
      t.faceMat.dispose();
    }
    this.tiles = [];
    this.pickables = [];
    this.tweens = this.tweens.filter((tw) => tw.keep);
    this.hovered = null;
  }

  // Compile tous les shaders et dessine quelques images avant d'afficher la page
  async warmup() {
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* ancien navigateur : compilation au premier rendu */ }
    for (let i = 0; i < 4; i++) await new Promise((r) => requestAnimationFrame(r));
  }

  // Crée le maillage d'une tuile (ivoire + dos jade + face), sans l'ajouter à la scène
  createTile(face) {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshPhysicalMaterial({ color: IVORY.clone(), roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.22, emissive: new THREE.Color(0) });
    const faceMat = new THREE.MeshStandardMaterial({ map: this.faceTexture(face), roughness: 0.38, emissive: new THREE.Color(0) });
    const body = new THREE.Mesh(this.bodyGeo, bodyMat);
    body.position.y = 0.13;
    const back = new THREE.Mesh(this.backGeo, this.backMat);
    back.position.y = -0.2;
    const faceMesh = new THREE.Mesh(this.faceGeo, faceMat);
    faceMesh.position.y = 0.363;
    for (const m of [body, back]) { m.castShadow = true; m.receiveShadow = true; }
    faceMesh.receiveShadow = true;
    group.add(body, back, faceMesh);
    return { group, bodyMat, faceMat, meshes: [body, back, faceMesh] };
  }

  // Décalage du plateau du joueur (en duel il se rapproche de la caméra)
  setBoardOffset(z) { this.boardGroup.position.set(0, 0, z); }

  // Agrandit la table en douceur (duel : deux plateaux dessus)
  setTableScale(k) { this.tableScaleTarget = k; }

  addUpdater(fn) {
    this.updaters.push(fn);
    return () => { this.updaters = this.updaters.filter((u) => u !== fn); };
  }

  buildBoard(game) {
    this.clearBoard();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const t of game.tiles) {
      minX = Math.min(minX, t.x); maxX = Math.max(maxX, t.x + 2);
      minY = Math.min(minY, t.y); maxY = Math.max(maxY, t.y + 2);
    }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    this.boardSize = { w: (maxX - minX) * SX, d: (maxY - minY) * SZ };

    for (const t of game.tiles) {
      const { group, bodyMat, faceMat, meshes } = this.createTile(game.face(t.id));
      const [body, back, face] = meshes;
      const base = new THREE.Vector3((t.x + 1 - cx) * SX, TH / 2 + t.z * TH + 0.004, (t.y + 1 - cy) * SZ);
      group.position.copy(base);
      group.rotation.y = (Math.random() - 0.5) * 0.012;
      for (const m of [body, back, face]) { m.userData.id = t.id; this.pickables.push(m); }
      this.boardGroup.add(group);
      this.tiles[t.id] = {
        id: t.id, group, bodyMat, faceMat, faceMesh: face, base,
        lift: 0, glow: new THREE.Color(0), dim: 1,
        selected: false, hintUntil: 0, blocked: false, shake: 0,
        removed: false, anim: false,
      };
    }
  }

  setBlocked(id, blocked) { const t = this.tiles[id]; if (t) t.blocked = blocked; }
  setSelected(id, on) { const t = this.tiles[id]; if (t) t.selected = on; }
  setHovered(id) { this.hovered = id; }
  shake(id) { const t = this.tiles[id]; if (t) t.shake = 0.35; }
  hint(ids) { const until = this.time + 2.6; for (const id of ids) if (this.tiles[id]) this.tiles[id].hintUntil = until; }
  clearHints() { for (const t of this.tiles) if (t) t.hintUntil = 0; }
  setBoardVisible(v) { this.boardGroup.visible = v; }

  tween(duration, update, done, delay = 0) {
    const tw = { t: -delay, duration, update, done };
    this.tweens.push(tw);
    return tw;
  }

  removePair(a, b) {
    return new Promise((resolve) => {
      const A = this.tiles[a], B = this.tiles[b];
      A.anim = B.anim = true;
      A.selected = B.selected = false;
      const pa = A.group.position.clone(), pb = B.group.position.clone();
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      mid.y = Math.max(pa.y, pb.y) + 1.7;
      const dir = new THREE.Vector3(pa.x - pb.x, 0, pa.z - pb.z);
      if (dir.lengthSq() < 1e-4) dir.set(1, 0, 0);
      dir.normalize();
      // Toujours côte à côte face caméra : direction projetée sur l'axe horizontal de la caméra
      const camRight = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
      const side = Math.sign(dir.dot(camRight)) || 1;
      const sa = mid.clone().addScaledVector(camRight, 0.62 * side);
      const sb = mid.clone().addScaledVector(camRight, -0.62 * side);
      const camYaw = Math.atan2(this.camera.position.x - mid.x, this.camera.position.z - mid.z);
      const tilt = 0.75;
      const ra = A.group.rotation.clone(), rb = B.group.rotation.clone();
      this.tween(0.72, (t) => {
        const t1 = ease.outCubic(clamp01(t / 0.55));
        const t2 = ease.inCubic(clamp01((t - 0.55) / 0.45));
        for (const [T, start, sidePos, r0] of [[A, pa, sa, ra], [B, pb, sb, rb]]) {
          const p = start.clone().lerp(sidePos, t1).lerp(mid, t2);
          T.group.position.copy(p);
          T.group.rotation.set(r0.x + tilt * t1, r0.y + (camYaw - r0.y) * t1, 0, 'YXZ');
          const sc = (1 + 0.15 * t1) * (1 - t2 * 0.95);
          T.group.scale.setScalar(Math.max(0.001, sc));
          T.glow.copy(GOLD).multiplyScalar(0.5 + 0.6 * t1);
          T.bodyMat.emissive.copy(T.glow);
          T.faceMat.emissive.copy(T.glow).multiplyScalar(0.4);
        }
      }, () => {
        for (const T of [A, B]) {
          T.group.visible = false;
          T.removed = true;
          T.anim = false;
        }
        const world = mid.clone().add(this.boardGroup.position);
        this.burst(world, { count: 70, color: '#ffc04a', speed: 5.5, life: 1.1 });
        this.burst(world, { count: 25, color: '#ff6a3a', speed: 3, life: 0.8 });
        resolve(world);
      });
    });
  }

  restorePair(a, b) {
    for (const id of [a, b]) {
      const T = this.tiles[id];
      T.removed = false;
      T.anim = true;
      T.group.visible = true;
      T.group.rotation.set(0, 0, 0);
      T.glow.setRGB(0, 0, 0);
      const from = T.base.clone().add(new THREE.Vector3(0, 2, 0));
      this.tween(0.45, (t) => {
        const e = ease.outBack(t);
        T.group.position.lerpVectors(from, T.base, ease.outCubic(t));
        T.group.scale.setScalar(Math.max(0.001, e));
      }, () => {
        T.anim = false;
        T.group.scale.setScalar(1);
        T.lift = 0;
      });
    }
  }

  // Animation de mélange : les tuiles s'envolent, tournent et retombent avec leurs nouvelles faces.
  shuffleAnim(game, ids) {
    return new Promise((resolve) => {
      let pending = ids.length;
      ids.forEach((id) => {
        const T = this.tiles[id];
        T.anim = true;
        T.selected = false;
        const delay = Math.random() * 0.25;
        const h = 1.4 + Math.random() * 1.6;
        let swapped = false;
        this.tween(1.0, (t) => {
          const e = Math.sin(Math.PI * t);
          T.group.position.set(T.base.x, T.base.y + e * h, T.base.z);
          T.group.rotation.set(0, ease.inOutCubic(t) * Math.PI * 2, Math.sin(Math.PI * t) * 0.4);
          if (!swapped && t >= 0.5) {
            swapped = true;
            T.faceMat.map = this.faceTexture(game.face(id));
            T.faceMat.needsUpdate = true;
          }
        }, () => {
          T.group.rotation.set(0, 0, 0);
          T.anim = false;
          if (--pending === 0) resolve();
        }, delay);
      });
      if (!ids.length) resolve();
    });
  }

  intro() {
    return new Promise((resolve) => {
      const list = this.tiles.filter(Boolean);
      let pending = list.length;
      let lastLand = 0;
      list.forEach((T) => {
        T.anim = true;
        const z = Math.round((T.base.y - TH / 2) / TH);
        const delay = z * 0.32 + Math.random() * 0.55;
        const h = 10 + Math.random() * 6;
        const spin = (Math.random() - 0.5) * 3;
        T.group.position.set(T.base.x, T.base.y + h, T.base.z);
        T.group.rotation.set(0, spin, 0);
        this.tween(0.75, (t) => {
          const e = ease.outCubic(t);
          T.group.position.y = T.base.y + h * (1 - e);
          T.group.rotation.y = spin * (1 - e);
          T.group.scale.setScalar(0.6 + 0.4 * e);
        }, () => {
          T.group.position.copy(T.base);
          T.group.rotation.set(0, 0, 0);
          T.group.scale.setScalar(1);
          T.anim = false;
          if (this.time - lastLand > 0.045) { lastLand = this.time; this.onLand(); }
          if (--pending === 0) resolve();
        }, delay);
      });
      if (!list.length) resolve();
    });
  }

  celebrate() {
    const colors = ['#ffcc4a', '#ff4a3a', '#4affc8', '#ff7ae0', '#7ab8ff', '#ffffff'];
    for (let k = 0; k < 14; k++) {
      this.tween(0.01, () => {}, () => {
        const p = new THREE.Vector3((Math.random() - 0.5) * 18, 5 + Math.random() * 5, (Math.random() - 0.5) * 12);
        this.burst(p, { count: 110, color: colors[k % colors.length], speed: 7, life: 1.6, gravity: 2.2 });
        this.onLand('firework');
      }, k * 0.28);
    }
    this.controls.autoRotate = true;
  }

  // ------------------------------------------------------------ caméra
  fitCamera(animate = true, duration = 1.6) {
    const { w, d } = this.boardSize || { w: 16, d: 11 };
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect;
    const polar = 0.62;
    const distW = (w * 0.62) / (Math.tan(vfov / 2) * aspect);
    const distD = (d * 0.75) / Math.tan(vfov / 2);
    const dist = Math.max(distW, distD, 9);
    this.controls.maxDistance = Math.max(34, dist * 1.4);
    const target = new THREE.Vector3(0, 0.6, 0.3 + this.boardGroup.position.z);
    const end = new THREE.Vector3(0, Math.cos(polar) * dist, Math.sin(polar) * dist).add(target);
    this.controls.autoRotate = false;
    if (!animate) {
      this.camera.position.copy(end);
      this.controls.target.copy(target);
      return;
    }
    this.camAnim = { from: this.camera.position.clone(), to: end, tFrom: this.controls.target.clone(), tTo: target, t: 0, d: duration };
  }

  fitDuelCamera(layout, animate = true, duration = 1.8) {
    const vfov = THREE.MathUtils.degToRad(this.camera.fov);
    const aspect = this.camera.aspect;
    const polar = 0.9;
    const distW = (layout.width * 0.58) / (Math.tan(vfov / 2) * aspect);
    const distD = (layout.depth * 0.6) / Math.tan(vfov / 2);
    const dist = Math.max(distW, distD, 16);
    this.controls.maxDistance = Math.max(40, dist * 1.4);
    const target = new THREE.Vector3(0, 2.0, layout.focusZ);
    const end = new THREE.Vector3(0, Math.cos(polar) * dist, Math.sin(polar) * dist).add(target);
    this.controls.autoRotate = false;
    this.duelLayout = layout;
    if (!animate) {
      this.camera.position.copy(end);
      this.controls.target.copy(target);
      return;
    }
    this.camAnim = { from: this.camera.position.clone(), to: end, tFrom: this.controls.target.clone(), tTo: target, t: 0, d: duration };
  }

  // Vues du duel : 'me' (mon plateau, comme en solo), 'opp' (gros plan sur l'adversaire), 'all' (ensemble)
  duelView(mode, layout = this.duelLayout, duration = 1.1) {
    if (!layout) return;
    this.duelLayout = layout;
    if (mode === 'all') return this.fitDuelCamera(layout, true, duration);
    if (mode === 'me') return this.fitCamera(true, duration);
    // adversaire : on se place au-dessus de son plateau, face à lui
    const target = new THREE.Vector3(0, 4.6, layout.avatarZ + 1.2);
    const end = new THREE.Vector3(0, 9.8, layout.oppZ + 7.5);
    this.controls.autoRotate = false;
    this.camAnim = { from: this.camera.position.clone(), to: end, tFrom: this.controls.target.clone(), tTo: target, t: 0, d: duration };
  }

  // Petite fenêtre en direct sur l'adversaire (rendue dans la zone de l'élément HTML donné)
  setPip(el, layout) {
    this.pipEl = el || null;
    if (!el || !layout) return;
    if (!this.pipCam) this.pipCam = new THREE.PerspectiveCamera(36, 1.6, 0.1, 200);
    this.pipCam.position.set(0, 8.6, layout.oppZ + 4.5);
    this.pipCam.lookAt(0, 4.4, layout.avatarZ + 0.6);
  }

  renderPip() {
    const el = this.pipEl;
    if (!el || el.classList.contains('hidden') || !this.boardGroup.visible) return;
    const r = el.getBoundingClientRect();
    if (r.width < 10) return;
    const r2 = this.renderer;
    const y = innerHeight - r.bottom;
    this.pipCam.aspect = r.width / r.height;
    this.pipCam.updateProjectionMatrix();
    r2.setScissorTest(true);
    r2.setViewport(r.left, y, r.width, r.height);
    r2.setScissor(r.left, y, r.width, r.height);
    r2.render(this.scene, this.pipCam);
    r2.setScissorTest(false);
    r2.setViewport(0, 0, innerWidth, innerHeight);
  }

  // Retour à la configuration solo
  resetDuel() {
    this.setPip(null);
    this.duelLayout = null;
    this.setBoardOffset(0);
    this.setTableScale(1);
  }

  // Vue cinématique basse pour le menu : on voit le décor, puis rotation lente
  menuCamera(duration = 2.4) {
    const target = new THREE.Vector3(0, 2, 0);
    const polar = 1.2, dist = 22;
    const az = Math.atan2(this.camera.position.x, this.camera.position.z);
    const end = new THREE.Vector3(Math.sin(az) * Math.sin(polar) * dist, Math.cos(polar) * dist, Math.cos(az) * Math.sin(polar) * dist).add(target);
    this.controls.autoRotate = false;
    this.controls.autoRotateSpeed = 0.3;
    this.camAnim = { from: this.camera.position.clone(), to: end, tFrom: this.controls.target.clone(), tTo: target, t: 0, d: duration, then: () => (this.controls.autoRotate = true) };
  }

  // ------------------------------------------------------------ évènements
  bindEvents() {
    const el = this.renderer.domElement;
    let down = null;
    el.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
    el.addEventListener('pointerup', (e) => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 7 && down.b === 0) {
        this.setMouse(e);
        const id = this.pick();
        if (id !== null) this.onTileClick(id);
      }
      down = null;
    });
    el.addEventListener('pointermove', (e) => { this.setMouse(e); this.hoverDirty = true; });
    el.addEventListener('pointerleave', () => { this.mouse.set(-9, -9); this.hoverDirty = true; });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('resize', () => this.resize());
  }

  setMouse(e) {
    this.mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  }

  pick() {
    if (!this.boardGroup.visible) return null;
    this.raycaster.setFromCamera(this.mouse, this.camera);
    const hits = this.raycaster.intersectObjects(this.pickables, false);
    for (const h of hits) {
      const T = this.tiles[h.object.userData.id];
      if (T && !T.removed && !T.anim) return T.id;
    }
    return null;
  }

  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight);
    this.bloom.resolution.set(innerWidth / 2, innerHeight / 2);
  }

  // ------------------------------------------------------------ boucle
  loop() {
    requestAnimationFrame(this.loop);
    const nowMs = performance.now();
    const dt = Math.min((nowMs - this.lastFrame) / 1000, 0.05);
    this.lastFrame = nowMs;
    this.time += dt;

    // tweens
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i];
      tw.t += dt;
      if (tw.t < 0) continue;
      const p = Math.min(1, tw.t / tw.duration);
      tw.update(p);
      if (p >= 1) {
        this.tweens.splice(i, 1);
        tw.done && tw.done();
      }
    }

    // caméra animée
    if (this.camAnim) {
      const a = this.camAnim;
      a.t += dt;
      const e = ease.inOutCubic(clamp01(a.t / a.d));
      this.camera.position.lerpVectors(a.from, a.to, e);
      this.controls.target.lerpVectors(a.tFrom, a.tTo, e);
      if (a.t >= a.d) { this.camAnim = null; a.then && a.then(); }
    }

    // survol
    if (this.hoverDirty) {
      this.hoverDirty = false;
      const id = this.pick();
      if (id !== this.hoverPicked) {
        this.hoverPicked = id;
        this.onTileHover(id);
      }
    }

    // état visuel des tuiles
    const k = Math.min(1, dt * 12);
    const target = new THREE.Color();
    for (const T of this.tiles) {
      if (!T || T.removed || T.anim) continue;
      const hov = this.hovered === T.id && !T.blocked;
      const hinted = T.hintUntil > this.time;
      const liftT = T.selected ? 0.24 : hov ? 0.07 : 0;
      T.lift += (liftT - T.lift) * k;
      if (T.selected) target.copy(GOLD).multiplyScalar(0.55 + 0.12 * Math.sin(this.time * 6));
      else if (hinted) target.copy(CYAN).multiplyScalar(0.55 + 0.45 * Math.sin(this.time * 9));
      else if (hov) target.copy(HOVER);
      else target.copy(BLACK);
      T.glow.lerp(target, k);
      T.bodyMat.emissive.copy(T.glow);
      T.faceMat.emissive.copy(T.glow).multiplyScalar(0.45);
      const dimT = T.blocked ? 0.5 : 1;
      T.dim += (dimT - T.dim) * k;
      T.bodyMat.color.copy(IVORY).multiplyScalar(T.dim);
      T.faceMat.color.setScalar(T.dim);
      let sx = 0;
      if (T.shake > 0) {
        T.shake = Math.max(0, T.shake - dt);
        sx = Math.sin(this.time * 70) * 0.07 * (T.shake / 0.35);
      }
      T.group.position.set(T.base.x + sx, T.base.y + T.lift, T.base.z);
    }

    // ambiance
    const dp = this.dust.geometry.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      let y = dp.getY(i) + dt * 0.25;
      if (y > 15) y = -2;
      dp.setY(i, y);
      dp.setX(i, dp.getX(i) + Math.sin(this.time * 0.5 + i) * dt * 0.08);
    }
    dp.needsUpdate = true;
    for (const l of this.lanterns) {
      const { phase, y } = l.userData;
      l.position.y = y + Math.sin(this.time * 0.7 + phase) * 0.25;
      l.rotation.z = Math.sin(this.time * 0.5 + phase) * 0.04;
      l.rotation.y += dt * 0.1;
    }
    this.updateParticles(dt);
    this.props.update(dt, this.time);
    const ts = this.tableGroup.scale.x + (this.tableScaleTarget - this.tableGroup.scale.x) * Math.min(1, dt * 3);
    this.tableGroup.scale.set(ts, 1, ts);
    for (const u of this.updaters) u(dt, this.time);

    this.controls.update();
    const t = this.controls.target;
    t.x = THREE.MathUtils.clamp(t.x, -9, 9);
    t.z = THREE.MathUtils.clamp(t.z, -7, 7);
    t.y = THREE.MathUtils.clamp(t.y, -0.5, 3);
    this.composer.render();
    this.renderPip();
  }
}
