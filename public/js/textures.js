// Génération procédurale des faces de tuiles (canvas) — aucune image externe.
export const FACE_W = 256;
export const FACE_H = 344;
const CJK = '"Noto Serif SC","Microsoft YaHei","PingFang SC","Hiragino Sans GB","SimSun",serif';
const LATIN = '"Zen Kaku Gothic New","Segoe UI",system-ui,sans-serif';
const C = { red: '#b81f2a', green: '#16703a', blue: '#1b4a87', ink: '#15203f', gold: '#b8862b', purple: '#7a2d8c', orange: '#d0661c' };

const IX = 34, IY = 42, IW = 188, IH = 272;
const P = (nx, ny) => [IX + nx * IW, IY + ny * IH];

export async function loadFaceFonts() {
  try {
    await Promise.race([
      document.fonts.load(`900 100px "Noto Serif SC"`, '一二三四五六七八九萬東南西北中發梅蘭菊竹春夏秋冬隱'),
      new Promise((r) => setTimeout(r, 2000)),
    ]);
  } catch { /* polices système en secours */ }
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(ctx, x, y, r, fill) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function background(ctx) {
  const g = ctx.createLinearGradient(0, 0, FACE_W * 0.3, FACE_H);
  g.addColorStop(0, '#fffbf1');
  g.addColorStop(1, '#f1e6cb');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, FACE_W, FACE_H);
  // très léger grain
  for (let i = 0; i < 380; i++) {
    ctx.fillStyle = `rgba(120,90,40,${Math.random() * 0.035})`;
    ctx.fillRect(Math.random() * FACE_W, Math.random() * FACE_H, 2, 2);
  }
  ctx.strokeStyle = 'rgba(140,100,40,0.16)';
  ctx.lineWidth = 3;
  rr(ctx, 9, 9, FACE_W - 18, FACE_H - 18, 20);
  ctx.stroke();
}

function corner(ctx, text, color) {
  ctx.font = `800 28px ${LATIN}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, 16, 13);
  ctx.globalAlpha = 1;
}

function glyph(ctx, ch, x, y, size, color, weight = 900) {
  ctx.font = `${weight} ${size}px ${CJK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.fillText(ch, x + 2, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(ch, x, y);
}

// ---- Cercles
function dot(ctx, x, y, r, color) {
  circle(ctx, x, y, r, color);
  circle(ctx, x, y, r * 0.8, '#fffbf1');
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  for (let k = 0; k < 8; k++) {
    ctx.rotate(Math.PI / 4);
    ctx.beginPath();
    ctx.ellipse(0, -r * 0.62, r * 0.09, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  circle(ctx, x, y, r * 0.42, color);
  circle(ctx, x, y, r * 0.17, '#fffbf1');
}

const DOTS = {
  1: [[[.5, .5], 76, 'big']],
  2: [[[.5, .26], 44, C.green], [[.5, .74], 44, C.blue]],
  3: [[[.22, .17], 35, C.blue], [[.5, .5], 35, C.red], [[.78, .83], 35, C.green]],
  4: [[[.27, .25], 37, C.blue], [[.73, .25], 37, C.green], [[.27, .75], 37, C.green], [[.73, .75], 37, C.blue]],
  5: [[[.25, .2], 33, C.blue], [[.75, .2], 33, C.green], [[.5, .5], 33, C.red], [[.25, .8], 33, C.green], [[.75, .8], 33, C.blue]],
  6: [[[.28, .16], 31, C.green], [[.72, .16], 31, C.green], [[.28, .55], 31, C.red], [[.72, .55], 31, C.red], [[.28, .85], 31, C.red], [[.72, .85], 31, C.red]],
  7: [[[.2, .11], 25, C.green], [[.5, .23], 25, C.green], [[.8, .35], 25, C.green], [[.28, .62], 27, C.red], [[.72, .62], 27, C.red], [[.28, .88], 27, C.red], [[.72, .88], 27, C.red]],
  8: [.12, .37, .63, .88].flatMap((y) => [[[.28, y], 29, C.blue], [[.72, y], 29, C.blue]]),
  9: [.17, .5, .83].flatMap((y, r) => [.2, .5, .8].map((x) => [[x, y], 26, [C.blue, C.red, C.green][r]])),
};

function drawDots(ctx, n) {
  for (const [[nx, ny], r, col] of DOTS[n]) {
    const [x, y] = P(nx, ny);
    if (col === 'big') {
      circle(ctx, x, y, r, C.green);
      circle(ctx, x, y, r * 0.86, '#fffbf1');
      ctx.save();
      ctx.translate(x, y);
      for (let k = 0; k < 16; k++) {
        ctx.rotate(Math.PI / 8);
        ctx.fillStyle = k % 2 ? C.blue : C.green;
        ctx.beginPath();
        ctx.ellipse(0, -r * 0.66, r * 0.09, r * 0.16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      circle(ctx, x, y, r * 0.46, C.red);
      circle(ctx, x, y, r * 0.3, '#fffbf1');
      circle(ctx, x, y, r * 0.18, C.red);
    } else dot(ctx, x, y, r, col);
  }
}

// ---- Bambous
function stick(ctx, x, y, h, color) {
  const w = 20;
  const top = y - h / 2;
  ctx.fillStyle = color;
  rr(ctx, x - w / 2, top, w, h, 9);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  rr(ctx, x - w / 2 + 4, top + 4, 5, h - 8, 3);
  ctx.fill();
  ctx.strokeStyle = '#fffbf1';
  ctx.lineWidth = 3;
  for (const f of [0.5]) {
    ctx.beginPath();
    ctx.moveTo(x - w / 2 - 2, top + h * f);
    ctx.lineTo(x + w / 2 + 2, top + h * f);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const f of [0.02, 0.5, 0.98]) {
    rr(ctx, x - w / 2 - 3, top + h * f - 4, w + 6, 8, 4);
    ctx.fill();
  }
}

const BAMS = {
  2: { h: 112, s: [[.5, .25, C.green], [.5, .75, C.blue]] },
  3: { h: 112, s: [[.5, .25, C.blue], [.3, .75, C.green], [.7, .75, C.green]] },
  4: { h: 112, s: [[.3, .25, C.green], [.7, .25, C.blue], [.3, .75, C.blue], [.7, .75, C.green]] },
  5: { h: 112, s: [[.2, .25, C.green], [.8, .25, C.blue], [.5, .5, C.red], [.2, .75, C.blue], [.8, .75, C.green]] },
  6: { h: 112, s: [.25, .75].flatMap((y) => [.2, .5, .8].map((x) => [x, y, C.green])) },
  7: { h: 76, s: [[.5, .17, C.red], ...[.5, .83].flatMap((y) => [.2, .5, .8].map((x) => [x, y, C.green]))] },
  8: { h: 112, s: [.25, .75].flatMap((y) => [.13, .38, .62, .87].map((x, i) => [x, y, i % 3 === 0 ? C.green : C.blue])) },
  9: { h: 78, s: [.17, .5, .83].flatMap((y) => [.2, .5, .8].map((x, i) => [x, y, i === 1 ? C.red : C.green])) },
};

function drawBird(ctx) {
  const cx = 128, cy = 182;
  // queue
  const tail = [C.blue, C.green, C.red, C.green, C.blue];
  tail.forEach((col, i) => {
    ctx.save();
    ctx.translate(cx - 6, cy + 30);
    ctx.rotate(-0.75 + i * 0.37);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.ellipse(0, 62, 15, 50, 0, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, 0, 88, 7, '#fffbf1');
    circle(ctx, 0, 88, 4, C.gold);
    ctx.restore();
  });
  // corps
  ctx.fillStyle = C.green;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 46, 58, 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = C.blue;
  ctx.beginPath();
  ctx.ellipse(cx - 14, cy + 6, 24, 42, -0.35, 0, Math.PI * 2);
  ctx.fill();
  // tête
  circle(ctx, cx + 22, cy - 72, 27, C.red);
  ctx.fillStyle = C.gold;
  ctx.beginPath();
  ctx.moveTo(cx + 45, cy - 78);
  ctx.lineTo(cx + 68, cy - 70);
  ctx.lineTo(cx + 45, cy - 62);
  ctx.fill();
  circle(ctx, cx + 30, cy - 78, 6, '#fffbf1');
  circle(ctx, cx + 31, cy - 78, 3, '#111');
  // crête
  [-0.5, 0, 0.5].forEach((a) => {
    ctx.save();
    ctx.translate(cx + 18, cy - 96);
    ctx.rotate(a);
    ctx.fillStyle = C.red;
    ctx.beginPath();
    ctx.ellipse(0, -10, 4, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

function drawBams(ctx, n) {
  if (n === 1) return drawBird(ctx);
  const { h, s } = BAMS[n];
  for (const [nx, ny, col] of s) {
    const [x, y] = P(nx, ny);
    stick(ctx, x, y, h, col);
  }
}

// ---- Fleurs / Saisons décor
function flower(ctx, x, y, r, petal, heart) {
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2 - Math.PI / 2;
    circle(ctx, x + Math.cos(a) * r * 0.62, y + Math.sin(a) * r * 0.62, r * 0.45, petal);
  }
  circle(ctx, x, y, r * 0.3, heart);
}

const NUM_CN = '一二三四五六七八九';
const WINDS = { E: '東', S: '南', W: '西', N: '北' };
const FLOWERS = [['梅', C.red, '#e65a7a'], ['蘭', C.purple, '#b06ad0'], ['菊', C.orange, '#f0a020'], ['竹', C.green, '#4aa35a']];
const SEASONS = [['春', C.green], ['夏', C.red], ['秋', C.orange], ['冬', C.blue]];

export function drawFace(face) {
  const cv = document.createElement('canvas');
  cv.width = FACE_W;
  cv.height = FACE_H;
  const ctx = cv.getContext('2d');
  const kind = face[0];
  const v = face.slice(1);
  if (kind === 'x') return drawHidden(cv, ctx); // mode Aveugle : tuile face cachée
  background(ctx);

  if (kind === 'p') { drawDots(ctx, +v); corner(ctx, v, C.blue); }
  else if (kind === 's') { drawBams(ctx, +v); corner(ctx, v, C.green); }
  else if (kind === 'm') {
    glyph(ctx, NUM_CN[+v - 1], 128, 112, 112, C.ink);
    glyph(ctx, '萬', 128, 248, 130, C.red);
    corner(ctx, v, C.red);
  } else if (kind === 'w') {
    glyph(ctx, WINDS[v], 128, 182, 176, C.ink);
    corner(ctx, { E: 'E', S: 'S', W: 'O', N: 'N' }[v], C.ink);
  } else if (kind === 'z') {
    if (v === 'r') glyph(ctx, '中', 128, 180, 190, C.red);
    else if (v === 'g') glyph(ctx, '發', 128, 180, 172, C.green);
    else {
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 10;
      rr(ctx, 50, 66, FACE_W - 100, FACE_H - 132, 14);
      ctx.stroke();
      ctx.lineWidth = 3;
      rr(ctx, 66, 82, FACE_W - 132, FACE_H - 164, 8);
      ctx.stroke();
    }
  } else if (kind === 'f') {
    const [ch, col, petal] = FLOWERS[+v - 1];
    flower(ctx, 92, 96, 44, petal, C.gold);
    flower(ctx, 168, 128, 26, petal, C.gold);
    ctx.strokeStyle = C.green; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(92, 140); ctx.quadraticCurveTo(110, 170, 150, 160); ctx.stroke();
    glyph(ctx, ch, 128, 250, 112, col);
    corner(ctx, v, col);
  } else if (kind === 'n') {
    const [ch, col] = SEASONS[+v - 1];
    ctx.strokeStyle = col; ctx.globalAlpha = 0.25; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(128, 172, 92, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    glyph(ctx, ch, 128, 176, 150, col);
    corner(ctx, v, col);
  }
  return cv;
}

// Face cachée (mode Aveugle) : laque jade, treillis doré et sceau 隱 (« caché »)
function drawHidden(cv, ctx) {
  const g = ctx.createLinearGradient(0, 0, FACE_W, FACE_H);
  g.addColorStop(0, '#1d7a58');
  g.addColorStop(1, '#0e4a35');
  ctx.fillStyle = g;
  rr(ctx, 0, 0, FACE_W, FACE_H, 22);
  ctx.fill();
  ctx.strokeStyle = 'rgba(224, 179, 90, 0.22)';
  ctx.lineWidth = 3;
  for (let k = -FACE_H; k < FACE_W + FACE_H; k += 34) {
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k - FACE_H, FACE_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(k, 0); ctx.lineTo(k + FACE_H, FACE_H); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(224, 179, 90, 0.75)';
  ctx.lineWidth = 6;
  rr(ctx, 18, 18, FACE_W - 36, FACE_H - 36, 16);
  ctx.stroke();
  ctx.fillStyle = 'rgba(10, 40, 28, 0.85)';
  ctx.beginPath(); ctx.arc(FACE_W / 2, FACE_H / 2, 62, 0, Math.PI * 2); ctx.fill();
  glyph(ctx, '隱', FACE_W / 2, FACE_H / 2 + 4, 86, '#e0b35a');
  return cv;
}

// Textures d'ambiance
export function feltCanvas() {
  const s = 1024;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.05, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, '#1d5a45');
  g.addColorStop(1, '#0c2c22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const img = ctx.getImageData(0, 0, s, s);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.strokeStyle = 'rgba(214,170,80,0.35)';
  ctx.lineWidth = 4;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.47, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(s / 2, s / 2, s * 0.455, 0, Math.PI * 2); ctx.stroke();
  // motifs nuages stylisés
  ctx.strokeStyle = 'rgba(214,170,80,0.10)';
  ctx.lineWidth = 3;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const x = s / 2 + Math.cos(a) * s * 0.42, y = s / 2 + Math.sin(a) * s * 0.42;
    for (let j = 0; j < 3; j++) {
      ctx.beginPath(); ctx.arc(x, y, 10 + j * 9, 0, Math.PI * 1.5); ctx.stroke();
    }
  }
  return cv;
}

export function woodCanvas() {
  const w = 1024, h = 128;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#3a130d';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 90; i++) {
    const y = Math.random() * h;
    ctx.strokeStyle = `rgba(${90 + Math.random() * 60},${25 + Math.random() * 20},15,${0.25 + Math.random() * 0.3})`;
    ctx.lineWidth = 1 + Math.random() * 3;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.01 + i) * 4);
    ctx.stroke();
  }
  return cv;
}

export function glowCanvas() {
  const s = 64;
  const cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,230,180,0.8)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  return cv;
}
