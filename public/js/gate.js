// Porte du palais (intro 3D) : deux battants de laque rouge plein écran, clous d'or, heurtoirs,
// dragons en relief et un gong de bronze géant. On frappe le gong : il ondule et se balance,
// les battants s'ouvrent vers l'intérieur, la lumière jaillit et la caméra traverse le seuil.
// Derrière les portes, un « portail » affiche la vraie scène du temple (rendue dans une texture,
// échantillonnée en coordonnées écran) : au passage du seuil, on bascule sur elle sans coupure.
//
// Optimisation : rendu par le renderer et le composer existants (un seul contexte WebGL),
// clous instanciés, textures générées une fois, portail rendu seulement pendant l'ouverture,
// et tout est libéré à la fin de l'intro.
import * as THREE from 'three';

const W = 10; // largeur de l'ouverture (deux battants)
const H = 11.5; // hauteur des battants
const DOOR_T = 0.34;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const rand = (seed => () => ((seed = (seed * 16807) % 2147483647) / 2147483647))(7);

// ------------------------------------------------------------------ textures procédurales
function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

// Carte de normales calculée à partir d'une carte de hauteur (niveaux de gris)
function normalFromHeight(src, strength = 2.5) {
  const w = src.width, h = src.height;
  const data = src.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas(w, h);
  const out = ctx.createImageData(w, h);
  const hAt = (x, y) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (hAt(x + 1, y) - hAt(x - 1, y)) * strength;
      const dy = (hAt(x, y + 1) - hAt(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * w + x) * 4;
      out.data[i] = ((-dx / l) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((dy / l) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
}

// Laque rouge sur planches verticales : couleur, rugosité et relief (rainures + veinage)
function lacquerMaps() {
  const w = 512, h = 1024;
  const [col, c] = canvas(w, h);
  const [hei, hc] = canvas(w / 2, h / 2);
  const planks = 5;
  const pw = w / planks;
  for (let p = 0; p < planks; p++) {
    const g = c.createLinearGradient(p * pw, 0, (p + 1) * pw, 0);
    const k = 0.92 + rand() * 0.14;
    g.addColorStop(0, `rgb(${92 * k},${14 * k},${10 * k})`);
    g.addColorStop(0.5, `rgb(${160 * k},${28 * k},${20 * k})`);
    g.addColorStop(1, `rgb(${98 * k},${16 * k},${11 * k})`);
    c.fillStyle = g;
    c.fillRect(p * pw, 0, pw, h);
  }
  // veinage du bois sous la laque
  c.globalAlpha = 0.07;
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, w / 2, h / 2);
  for (let i = 0; i < 260; i++) {
    const x = rand() * w, amp = 2 + rand() * 6, f = 0.004 + rand() * 0.01, ph = rand() * 6;
    c.strokeStyle = rand() > 0.5 ? '#2a0403' : '#ff9a70';
    c.lineWidth = 0.6 + rand() * 1.6;
    c.beginPath();
    for (let y = 0; y <= h; y += 16) c.lineTo(x + Math.sin(y * f + ph) * amp, y);
    c.stroke();
    hc.strokeStyle = rand() > 0.5 ? '#767676' : '#8a8a8a';
    hc.lineWidth = 0.8;
    hc.beginPath();
    for (let y = 0; y <= h / 2; y += 8) hc.lineTo(x / 2 + Math.sin(y * 2 * f + ph) * amp * 0.5, y);
    hc.stroke();
  }
  c.globalAlpha = 1;
  // rainures entre les planches
  for (let p = 1; p < planks; p++) {
    c.fillStyle = 'rgba(20,2,1,0.65)';
    c.fillRect(p * pw - 1.5, 0, 3, h);
    hc.fillStyle = '#1a1a1a';
    hc.fillRect((p * pw) / 2 - 1.5, 0, 3, h / 2);
  }
  // usure légère : la laque s'éclaircit au centre (patine)
  const v = c.createRadialGradient(w / 2, h * 0.45, 40, w / 2, h * 0.45, h * 0.7);
  v.addColorStop(0, 'rgba(255,120,80,0.08)');
  v.addColorStop(1, 'rgba(0,0,0,0.25)');
  c.fillStyle = v;
  c.fillRect(0, 0, w, h);
  return { col, normal: normalFromHeight(hei, 3) };
}

// Bronze martelé du gong : anneaux concentriques, martelage, moyeu central marqué 開
function gongMaps() {
  const s = 512;
  const [col, c] = canvas(s, s);
  const [hei, hc] = canvas(256, 256);
  const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, '#e2b25c');
  g.addColorStop(0.32, '#c58b35');
  g.addColorStop(0.62, '#a26a20');
  g.addColorStop(0.86, '#7a4c14');
  g.addColorStop(1, '#4a2c08');
  c.fillStyle = g;
  c.fillRect(0, 0, s, s);
  hc.fillStyle = '#808080';
  hc.fillRect(0, 0, 256, 256);
  // anneaux tournés au tour
  for (let r = 8; r < s / 2; r += 3 + rand() * 4) {
    c.strokeStyle = rand() > 0.5 ? 'rgba(255,220,150,0.10)' : 'rgba(60,30,0,0.12)';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(s / 2, s / 2, r, 0, Math.PI * 2);
    c.stroke();
  }
  // coups de marteau
  for (let i = 0; i < 900; i++) {
    const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * 0.47;
    const x = 0.5 + Math.cos(a) * d, y = 0.5 + Math.sin(a) * d, r = 2 + rand() * 5;
    const lg = hc.createRadialGradient(x * 256, y * 256, 0, x * 256, y * 256, r);
    lg.addColorStop(0, '#5a5a5a');
    lg.addColorStop(1, 'rgba(128,128,128,0)');
    hc.fillStyle = lg;
    hc.beginPath();
    hc.arc(x * 256, y * 256, r, 0, Math.PI * 2);
    hc.fill();
    c.fillStyle = rand() > 0.5 ? 'rgba(255,230,170,0.05)' : 'rgba(40,20,0,0.06)';
    c.beginPath();
    c.arc(x * s, y * s, r * 2, 0, Math.PI * 2);
    c.fill();
  }
  // moyeu central
  const bg = c.createRadialGradient(s * 0.47, s * 0.46, 4, s / 2, s / 2, s * 0.16);
  bg.addColorStop(0, '#f4cf80');
  bg.addColorStop(0.6, '#a87124');
  bg.addColorStop(1, '#5a370c');
  c.fillStyle = bg;
  c.beginPath();
  c.arc(s / 2, s / 2, s * 0.16, 0, Math.PI * 2);
  c.fill();
  c.font = `900 ${s * 0.17}px "Yuji Syuku", "Noto Serif SC", serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillStyle = 'rgba(90,10,6,0.92)';
  c.fillText('開', s / 2, s / 2 + s * 0.01);
  const hb = hc.createRadialGradient(128, 128, 0, 128, 128, 42);
  hb.addColorStop(0, '#ffffff');
  hb.addColorStop(0.85, '#b0b0b0');
  hb.addColorStop(1, '#606060');
  hc.fillStyle = hb;
  hc.beginPath();
  hc.arc(128, 128, 41, 0, Math.PI * 2);
  hc.fill();
  return { col, normal: normalFromHeight(hei, 4) };
}

// Le dragon vert de la page (symbole SVG) dessiné en image, avec son relief
async function dragonMaps() {
  const sym = document.getElementById('dragon');
  const defs = document.querySelector('.svg-defs defs');
  if (!sym || !defs) return null;
  const css = [...document.styleSheets]
    .flatMap((ss) => { try { return [...ss.cssRules]; } catch { return []; } })
    .filter((r) => r.selectorText && /^\.dg-/.test(r.selectorText))
    .map((r) => r.cssText)
    .join('\n');
  const vb = sym.getAttribute('viewBox').split(/\s+/).map(Number);
  const w = 1024, h = Math.round((w * vb[3]) / vb[2]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb.join(' ')}" width="${w}" height="${h}"><style>${css}</style>${defs.outerHTML}${sym.innerHTML}</svg>`;
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  await img.decode();
  const [col, c] = canvas(w, h);
  c.drawImage(img, 0, 0, w, h);
  // relief : l'alpha flouté sert de carte de hauteur
  const [hei, hc] = canvas(w / 2, h / 2);
  hc.fillStyle = '#000';
  hc.fillRect(0, 0, w / 2, h / 2);
  hc.filter = 'blur(2px)';
  hc.drawImage(col, 0, 0, w / 2, h / 2);
  const d = hc.getImageData(0, 0, w / 2, h / 2);
  for (let i = 0; i < d.data.length; i += 4) d.data[i] = d.data[i + 1] = d.data[i + 2] = d.data[i + 3];
  hc.putImageData(d, 0, 0);
  return { col, normal: normalFromHeight(hei, 6) };
}

// ------------------------------------------------------------------ la porte
export class Gate {
  constructor(s3d) {
    this.s = s3d;
    this.renderer = s3d.renderer;
    this.lowEnd = s3d.isMobile;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060202);
    this.scene.environment = s3d.scene.environment;
    this.scene.environmentIntensity = 0.3;
    this.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 120);
    this.t = 0;
    this.strikeAt = -1;
    this.done = null;
    this.trash = [];
    this.tex = (c, color = true) => {
      const t = new THREE.CanvasTexture(c);
      if (color) t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
      this.trash.push(t);
      return t;
    };
    this.keep = (o) => (this.trash.push(o), o);
    this.build();
    this.fit();
    this.onResize = () => this.fit();
    addEventListener('resize', this.onResize);
  }

  build() {
    const lac = lacquerMaps();
    const lacquer = this.keep(new THREE.MeshPhysicalMaterial({
      map: this.tex(lac.col), normalMap: this.tex(lac.normal, false), normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.5, clearcoat: 0.8, clearcoatRoughness: 0.12, color: 0xb8b0b0,
    }));
    this.gold = this.keep(new THREE.MeshStandardMaterial({ color: 0xc08a36, metalness: 1, roughness: 0.38 }));
    const darkGold = this.keep(new THREE.MeshStandardMaterial({ color: 0x9a6a22, metalness: 1, roughness: 0.4 }));

    // ---------------------------------------------------------- battants (pivot sur les gonds)
    this.doors = [];
    const doorGeo = this.keep(new THREE.BoxGeometry(W / 2, H, DOOR_T));
    const bandH = this.keep(new THREE.BoxGeometry(W / 2 - 0.25, 0.2, 0.08));
    const bandV = this.keep(new THREE.BoxGeometry(0.2, H - 0.25, 0.08));
    const stud = this.keep(new THREE.SphereGeometry(0.17, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
    stud.rotateX(Math.PI / 2);
    // tête de lion bombée (calotte de sphère) : le reflet glisse dessus au lieu d'éblouir
    const boss = this.keep(new THREE.SphereGeometry(0.5, 40, 16, 0, Math.PI * 2, 0, Math.PI * 0.32));
    boss.rotateX(Math.PI / 2);
    boss.translate(0, 0, -0.42);
    const bossRing = this.keep(new THREE.TorusGeometry(0.4, 0.045, 12, 48));
    const ring = this.keep(new THREE.TorusGeometry(0.42, 0.06, 14, 56));
    this.rings = [];
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set((side * W) / 2, 0, 0);
      const door = new THREE.Group();
      door.position.x = (-side * W) / 4; // le battant s'étend vers le centre
      pivot.add(door);
      const slab = new THREE.Mesh(doorGeo, lacquer);
      slab.receiveShadow = true;
      slab.castShadow = true;
      door.add(slab);
      const zf = DOOR_T / 2 + 0.04;
      // ferrures dorées : bandes hautes et basses, montant au bord
      for (const y of [H / 2 - 0.55, H / 2 - 0.95, -H / 2 + 0.55, -H / 2 + 0.95]) {
        const b = new THREE.Mesh(bandH, this.gold);
        b.position.set(0, y, zf);
        door.add(b);
      }
      const edge = new THREE.Mesh(bandV, darkGold);
      edge.position.set((side * W) / 4 - side * 0.12, 0, zf);
      door.add(edge);
      // clous d'or (men ding) : 5 colonnes × 7 rangées, en un seul appel de rendu
      const cols = 5, rows = 6;
      const studs = new THREE.InstancedMesh(stud, this.gold, cols * rows);
      const m = new THREE.Matrix4();
      let k = 0;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = -W / 4 + 0.55 + (c * (W / 2 - 1.1)) / (cols - 1);
          const y = -4.4 + (r * 5.0) / (rows - 1);
          m.makeTranslation(x, y, DOOR_T / 2);
          studs.setMatrixAt(k++, m);
        }
      }
      studs.castShadow = true;
      door.add(studs);
      // heurtoir : tête de lion (moyeu) et anneau qui se balance
      const kx = -side * (W / 4 - 0.85);
      const ky = 1.25;
      const b = new THREE.Mesh(boss, this.gold);
      b.position.set(kx, ky, zf + 0.04);
      b.castShadow = true;
      door.add(b);
      const br = new THREE.Mesh(bossRing, darkGold);
      br.position.set(kx, ky, zf + 0.12);
      door.add(br);
      const ringPivot = new THREE.Group();
      ringPivot.position.set(kx, ky - 0.1, zf + 0.2);
      const rg = new THREE.Mesh(ring, this.gold);
      rg.position.y = -0.48;
      rg.castShadow = true;
      ringPivot.add(rg);
      door.add(ringPivot);
      this.rings.push(ringPivot);
      this.scene.add(pivot);
      this.doors.push({ pivot, door, side });
    }
    // dragons peints en relief (ajoutés quand l'image est prête)
    dragonMaps().then((maps) => {
      if (!maps || !this.scene) return;
      const mat = this.keep(new THREE.MeshStandardMaterial({ map: this.tex(maps.col), normalMap: this.tex(maps.normal, false), normalScale: new THREE.Vector2(1.4, 1.4), color: 0xe8e8e8, metalness: 0.25, roughness: 0.38, transparent: true, alphaTest: 0.25 }));
      const dw = W / 2 - 1.2;
      const geo = this.keep(new THREE.PlaneGeometry(dw, (dw * maps.col.height) / maps.col.width));
      for (const { door, side } of this.doors) {
        const d = new THREE.Mesh(geo, mat);
        d.position.set(side * 0.15, 2.2, DOOR_T / 2 + 0.03);
        if (side > 0) d.scale.x = -1; // les deux dragons se font face au milieu
        d.castShadow = true;
        door.add(d);
      }
    }).catch(() => {});

    // ---------------------------------------------------------- le gong et ses cordes
    const gm = gongMaps();
    this.gongMat = this.keep(new THREE.MeshPhysicalMaterial({
      map: this.tex(gm.col), normalMap: this.tex(gm.normal, false), normalScale: new THREE.Vector2(0.28, 0.28),
      metalness: 1, roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.35, emissive: 0x000000,
    }));
    // onde de choc dans le métal (vertex) + éclair de chaleur (fragment), pilotées par uStrike
    this.gongUniforms = { uStrike: { value: -1 } };
    this.gongMat.onBeforeCompile = (sh) => {
      sh.uniforms.uStrike = this.gongUniforms.uStrike;
      sh.vertexShader = 'uniform float uStrike;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        if (uStrike >= 0.0) {
          float rr = length(position.xz);
          float w = sin(rr * 9.0 - uStrike * 34.0) * exp(-uStrike * 1.8) * smoothstep(0.05, 0.4, rr);
          transformed.y += w * 0.05 * sign(position.y + 0.0001);
        }`);
      sh.fragmentShader = 'uniform float uStrike;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (uStrike >= 0.0) totalEmissiveRadiance += vec3(1.0, 0.55, 0.18) * exp(-uStrike * 3.5) * 0.45;`);
    };
    this.gongPivot = new THREE.Group();
    this.scene.add(this.gongPivot);
    const disc = this.keep(new THREE.CylinderGeometry(1, 1, 0.07, 96, 6));
    this.gong = new THREE.Mesh(disc, this.gongMat);
    this.gong.rotation.x = Math.PI / 2;
    this.gong.castShadow = true;
    const rim = this.keep(new THREE.TorusGeometry(1, 0.06, 16, 96));
    const rimMesh = new THREE.Mesh(rim, darkGold);
    this.gongBody = new THREE.Group();
    this.gongBody.add(this.gong, rimMesh);
    this.gongPivot.add(this.gongBody);
    const ropeMat = this.keep(new THREE.MeshStandardMaterial({ color: 0xa3201d, roughness: 0.8 }));
    const rope = this.keep(new THREE.CylinderGeometry(0.03, 0.03, 1, 8));
    rope.translate(0, 0.5, 0);
    this.ropes = [-1, 1].map((s) => {
      const r = new THREE.Mesh(rope, ropeMat);
      this.gongBody.add(r);
      return r;
    });

    // ---------------------------------------------------------- lumières
    this.scene.add(new THREE.HemisphereLight(0xffd9a8, 0x1a0805, 0.22));
    const key = (this.key = new THREE.SpotLight(0xffd2a0, 70, 60, 0.7, 0.7, 1.6));
    key.position.set(-7, 9, 13);
    key.target.position.set(0, 0, 0);
    this.scene.add(key, key.target);
    if (!this.lowEnd) {
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.bias = -0.0004;
      key.shadow.radius = 4;
    }
    // lanternes hors champ, de part et d'autre : lueur rouge qui vacille
    this.lanterns = [-1, 1].map((s) => {
      const l = new THREE.PointLight(0xff5a2a, 9, 18, 1.8);
      l.position.set(s * 7.5, 1.5, 3.5);
      this.scene.add(l);
      return l;
    });
    // lumière derrière les portes : elle éclaire les chants des battants à l'ouverture
    this.behind = new THREE.PointLight(0xffc77a, 0, 30, 1.2);
    this.behind.position.set(0, 0.5, -3);
    this.scene.add(this.behind);

    // ---------------------------------------------------------- portail vers le temple
    const dpr = this.renderer.getPixelRatio();
    this.portalRT = this.keep(new THREE.WebGLRenderTarget(innerWidth * dpr, innerHeight * dpr, { type: THREE.HalfFloatType }));
    this.portalMat = this.keep(new THREE.ShaderMaterial({
      uniforms: { tPortal: { value: this.portalRT.texture }, uRes: { value: new THREE.Vector2() }, uFlash: { value: 0 } },
      vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform sampler2D tPortal; uniform vec2 uRes; uniform float uFlash;
        void main(){ vec3 c = texture2D(tPortal, gl_FragCoord.xy / uRes).rgb; gl_FragColor = vec4(c + vec3(1.0, 0.82, 0.55) * uFlash, 1.0); }`,
      depthWrite: false,
    }));
    this.portal = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(400, 400)), this.portalMat);
    this.portal.position.z = -40;
    this.portal.visible = false;
    this.scene.add(this.portal);

    // ---------------------------------------------------------- rayons de lumière qui jaillissent de l'entrebâillement
    this.raysMat = this.keep(new THREE.ShaderMaterial({
      uniforms: { uOpen: { value: 0 }, uGap: { value: 0 }, uTime: { value: 0 } },
      vertexShader: 'varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uOpen, uGap, uTime; varying vec2 vP;
        void main(){
          float d = length(vP);
          float a = atan(vP.y, vP.x);
          float rays = 0.5 + 0.5 * sin(a * 21.0 + uTime * 0.5) * sin(a * 8.0 - uTime * 0.3 + 1.7);
          float slit = exp(-abs(vP.x) / (0.06 + uGap * 2.2)) * smoothstep(7.0, 0.0, abs(vP.y));
          float v = (slit * 0.9 + rays * exp(-d * 0.3) * 0.3 * uGap) * uOpen * (1.0 - uGap * 0.55);
          gl_FragColor = vec4(vec3(1.0, 0.76, 0.42) * v, 1.0);
        }`,
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.rays = new THREE.Mesh(this.keep(new THREE.PlaneGeometry(36, 30)), this.raysMat);
    this.rays.position.set(0, 0.5, 0.45);
    this.scene.add(this.rays);

    // ---------------------------------------------------------- poussière dans la lumière
    const N = this.lowEnd ? 500 : 1100;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) pos.set([(rand() - 0.5) * 12, (rand() - 0.5) * 10, 0.4 + rand() * 7], i * 3);
    const dg = this.keep(new THREE.BufferGeometry());
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.dustMat = this.keep(new THREE.PointsMaterial({ size: 0.05, map: this.s.glowTex, color: 0xffd49a, transparent: true, opacity: 0.28, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dust = new THREE.Points(dg, this.dustMat);
    this.scene.add(this.dust);
  }

  // Cadrage : les battants couvrent tout l'écran, quel que soit son format
  fit() {
    const cam = this.camera;
    cam.aspect = innerWidth / innerHeight;
    const tv = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const dW = W / 2 / (tv * cam.aspect), dH = H / 2 / tv;
    this.dist = Math.min(dW, dH) * 0.97;
    this.camY = 0.15;
    if (this.strikeAt < 0) cam.position.set(0, this.camY, this.dist);
    cam.updateProjectionMatrix();
    // le gong : énorme, centré dans le bas de l'écran, à 2,6 unités devant les portes
    const gz = 2.6;
    const hh = (this.dist - gz) * tv, hw = hh * cam.aspect;
    const r = Math.min(hh * 0.5, hw * 0.62);
    this.gongR = r;
    this.gongPivot.position.set(0, this.camY - hh * 0.32 + r * 0.55 + 14, gz);
    this.gongBody.position.y = -14 - r * 0.55;
    this.gongBody.scale.setScalar(1);
    this.gong.scale.set(r, 1, r);
    this.gongBody.children[1].scale.setScalar(r);
    this.ropes.forEach((rp, i) => {
      rp.position.set((i ? 1 : -1) * r * 0.42, r * 0.92, 0);
      rp.scale.y = 16;
      rp.rotation.z = (i ? -1 : 1) * 0.02;
    });
    const dpr = this.renderer.getPixelRatio();
    this.portalRT.setSize(innerWidth * dpr, innerHeight * dpr);
    this.renderer.getDrawingBufferSize(this.portalMat.uniforms.uRes.value);
  }

  // Frappe du gong ; la promesse se résout quand on a franchi le seuil
  strike({ calm = false } = {}) {
    if (this.strikeAt >= 0) return this.finished;
    this.strikeAt = this.t;
    this.calm = calm;
    this.finished = new Promise((r) => (this.done = r));
    return this.finished;
  }

  frame(dt) {
    this.t += dt;
    const t = this.t;
    const cam = this.camera;
    const since = this.strikeAt >= 0 ? t - this.strikeAt : -1;
    this.raysMat.uniforms.uTime.value = t;

    // lanternes qui vacillent, gong qui se balance doucement en attendant
    this.lanterns.forEach((l, i) => (l.intensity = 9 + Math.sin(t * 7.3 + i * 2) * 0.8 + Math.sin(t * 13.1 + i) * 0.6));
    const dp = this.dust.geometry.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      let y = dp.getY(i) + dt * 0.12;
      if (y > 5) y = -5;
      dp.setY(i, y);
      dp.setX(i, dp.getX(i) + Math.sin(t * 0.4 + i) * dt * 0.03);
    }
    dp.needsUpdate = true;

    // Le pivot est 14 unités plus haut (cordes) : une rotation positive pousse le gong vers les portes.
    let swing = Math.sin(t * 1.6) * 0.0035;
    let tilt = 0;
    if (since >= 0) {
      this.gongUniforms.uStrike.value = since;
      // frappé de face, il part vers les portes puis revient en oscillant ; le bas recule plus que le haut
      const e = Math.exp(-since * 1.3);
      swing += 0.03 * e * Math.sin(since * 6.2);
      tilt = 0.09 * e * Math.sin(since * 6.2 - 0.5);
      this.rings.forEach((rg, i) => (rg.rotation.x = -0.5 * Math.exp(-since * 2.2) * Math.sin(since * 9 + i)));
    }
    this.gongPivot.rotation.x = swing;
    this.gongBody.rotation.x = tilt;

    if (since < 0) {
      cam.position.set(0, this.camY, this.dist);
      cam.lookAt(0, this.camY, 0);
      this.render();
      return;
    }

    if (this.calm) {
      // animations réduites : on entre directement
      if (since > 0.35) return this.finish();
      this.render();
      return;
    }

    // ouverture des battants vers l'intérieur : l'onde de choc les pousse presque aussitôt
    // (départ rapide, fin de course amortie comme de lourdes portes), sans temps mort après le coup
    const open = 1 - (1 - clamp01((since - 0.12) / 2.25)) ** 2.4;
    const ang = open * THREE.MathUtils.degToRad(112);
    this.doors[0].pivot.rotation.y = ang;
    this.doors[1].pivot.rotation.y = -ang;
    const gap = clamp01((since - 0.12) / 1.0);
    this.raysMat.uniforms.uGap.value = gap;
    const glow = clamp01((since - 0.08) / 0.35) * (1 - clamp01((since - 2.15) / 0.5));
    this.raysMat.uniforms.uOpen.value = glow;
    this.dustMat.opacity = 0.28 + glow * 0.6;
    this.behind.intensity = glow * 60;
    this.portalMat.uniforms.uFlash.value = Math.max(0, 1 - Math.abs(since - 0.5) / 0.45) * 0.45;
    if (since > 0.1) this.portal.visible = true;
    if (since > 0.3 && !this.dollied) {
      this.dollied = true;
      this.s.introDolly(2.35);
    }

    // la caméra avance, monte un peu pour passer au-dessus du gong, et franchit le seuil
    const k = ease(clamp01((since - 0.3) / 2.3));
    const shake = Math.exp(-since * 5) * 0.07;
    cam.position.set((rand() - 0.5) * shake, this.camY + k * 2.4 + (rand() - 0.5) * shake, this.dist + (-1.6 - this.dist) * k);
    cam.lookAt(0, this.camY + k * 2.9, cam.position.z - 10);
    this.render();
    if (since > 2.65) this.finish();
  }

  render() {
    const s = this.s;
    const exp = this.renderer.toneMappingExposure;
    this.renderer.toneMappingExposure = 0.8;
    if (this.portal.visible) {
      this.renderer.setRenderTarget(this.portalRT);
      this.renderer.render(s.scene, s.camera);
      this.renderer.setRenderTarget(null);
    }
    s.renderPass.scene = this.scene;
    s.renderPass.camera = this.camera;
    s.composer.render();
    s.renderPass.scene = s.scene;
    s.renderPass.camera = s.camera;
    this.renderer.toneMappingExposure = exp;
  }

  async warmup() {
    // le portail est caché tant qu'on n'a pas frappé : on le rend visible le temps de la compilation,
    // sinon son shader serait compilé au moment de l'ouverture (image figée)
    this.portal.visible = true;
    try { await this.renderer.compileAsync(this.scene, this.camera); } catch { /* compilation au premier rendu */ }
    this.portal.visible = false;
  }

  // Premier rendu du temple dans la texture du portail, pendant l'écran de chargement :
  // textures envoyées au GPU, carte d'ombres calculée, shaders prêts. Sans ça, tout se fait
  // au moment où les portes s'entrouvrent et l'image se fige.
  prime() {
    const r = this.renderer;
    r.setRenderTarget(this.portalRT);
    r.render(this.s.scene, this.s.camera);
    r.setRenderTarget(null);
  }

  finish() {
    if (!this.scene) return;
    const done = this.done;
    this.dispose();
    this.s.gate = null;
    this.s.controls.enabled = true;
    if (done) done();
  }

  dispose() {
    removeEventListener('resize', this.onResize);
    for (const o of this.trash) o.dispose && o.dispose();
    this.trash = [];
    this.scene.clear();
    this.scene = null;
  }
}
