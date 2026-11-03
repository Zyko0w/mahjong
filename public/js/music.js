// Instruments chinois synthétisés (Web Audio), utilisés pour les effets sonores du jeu :
// guzheng (corde pincée Karplus-Strong), erhu, dizi, gongs, tambour tanggu, cymbales, wood-block.

const BASE = 293.66; // Ré4
const PENTA = [0, 2, 4, 7, 9];
export const freqOf = (d) => {
  const o = Math.floor(d / 5);
  const s = ((d % 5) + 5) % 5;
  return BASE * 2 ** ((PENTA[s] + 12 * o) / 12);
};

// ------------------------------------------------------------------ instruments
export class Instruments {
  constructor(ctx, out, sendReverb) {
    this.ctx = ctx;
    this.out = out;
    this.rev = sendReverb;
    this.ksCache = new Map();
    const sr = ctx.sampleRate;
    this.noise = ctx.createBuffer(1, sr * 2, sr);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }

  connect(node, wet = 0.5) {
    node.connect(this.out);
    if (wet > 0) {
      const s = this.ctx.createGain();
      s.gain.value = wet;
      node.connect(s).connect(this.rev);
    }
  }

  // Corde pincée (Karplus-Strong) pré-calculée et mise en cache
  ksBuffer(freq, bright = 0.5) {
    const key = Math.round(freq * 10) + ':' + bright;
    let b = this.ksCache.get(key);
    if (b) return b;
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 2.6);
    b = this.ctx.createBuffer(1, len, sr);
    const out = b.getChannelData(0);
    const N = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(N);
    let prev = 0;
    for (let i = 0; i < N; i++) {
      const r = Math.random() * 2 - 1;
      prev = prev + (r - prev) * (0.35 + bright * 0.6); // excitation adoucie
      ring[i] = prev;
    }
    const decay = freq > 600 ? 0.993 : 0.9965;
    let idx = 0, peak = 0;
    for (let i = 0; i < len; i++) {
      const next = (idx + 1) % N;
      const v = ring[idx];
      out[i] = v;
      ring[idx] = (v + ring[next]) * 0.5 * decay;
      idx = next;
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
    const norm = 0.9 / (peak || 1);
    for (let i = 0; i < len; i++) out[i] *= norm;
    this.ksCache.set(key, b);
    return b;
  }

  // 古筝 guzheng : pincement avec glissé (bend) optionnel typique
  zheng(deg, t, vol = 0.3, { bend = 0, wet = 0.5, bright = 0.5 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.ksBuffer(freqOf(deg), bright);
    if (bend) {
      src.playbackRate.setValueAtTime(1, t + 0.12);
      src.playbackRate.linearRampToValueAtTime(2 ** (bend / 12), t + 0.32);
      src.playbackRate.linearRampToValueAtTime(1, t + 0.7);
    }
    const g = c.createGain();
    g.gain.value = vol;
    const body = c.createBiquadFilter();
    body.type = 'peaking';
    body.frequency.value = 900;
    body.gain.value = 4;
    src.connect(body).connect(g);
    this.connect(g, wet);
    src.start(t);
    src.stop(t + 2.6);
  }

  // Glissando de guzheng (balayage des cordes, très cliché)
  zhengGliss(fromDeg, count, t, vol = 0.22, step = 0.045, dir = 1) {
    for (let k = 0; k < count; k++) {
      const v = vol * (0.55 + 0.45 * (k / count));
      this.zheng(fromDeg + k * dir, t + k * step, v, { wet: 0.6, bright: 0.6 });
    }
  }

  // 二胡 erhu : vièle à deux cordes, timbre nasal, vibrato et portamento
  erhu(deg, t, dur, vol = 0.07, slideFrom = null) {
    const c = this.ctx;
    const f = freqOf(deg);
    const o1 = c.createOscillator(), o2 = c.createOscillator();
    o1.type = o2.type = 'sawtooth';
    o2.detune.value = 7;
    for (const o of [o1, o2]) {
      if (slideFrom !== null) {
        o.frequency.setValueAtTime(freqOf(slideFrom), t);
        o.frequency.exponentialRampToValueAtTime(f, t + 0.11);
      } else o.frequency.setValueAtTime(f, t);
    }
    const lfo = c.createOscillator();
    lfo.frequency.value = 5.4 + Math.random() * 0.6;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.013, t + Math.min(dur, 0.4));
    lfo.connect(lg);
    lg.connect(o1.frequency);
    lg.connect(o2.frequency);
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 280;
    const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 1250; pk.Q.value = 1.4; pk.gain.value = 8;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.07);
    g.gain.linearRampToValueAtTime(vol * 0.8, t + Math.max(0.1, dur * 0.6));
    g.gain.linearRampToValueAtTime(vol, t + Math.max(0.12, dur - 0.04));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.18);
    o1.connect(hp); o2.connect(hp);
    hp.connect(pk).connect(lp).connect(g);
    this.connect(g, 0.55);
    for (const o of [o1, o2, lfo]) { o.start(t); o.stop(t + dur + 0.25); }
  }

  // 笛子 dizi : flûte traversière, souffle + membrane vibrante
  dizi(deg, t, dur, vol = 0.12, grace = null) {
    const c = this.ctx;
    const f = freqOf(deg);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.06);
    g.gain.setValueAtTime(vol, t + Math.max(0.07, dur - 0.05));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
    const lfo = c.createOscillator();
    lfo.frequency.value = 5;
    const lg = c.createGain();
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f * 0.009, t + Math.min(dur, 0.5));
    lfo.connect(lg);
    const oscs = [];
    [[1, 1], [2, 0.22], [3, 0.07]].forEach(([h, a]) => {
      const o = c.createOscillator();
      o.type = 'sine';
      if (grace !== null) {
        o.frequency.setValueAtTime(freqOf(grace) * h, t);
        o.frequency.setValueAtTime(f * h, t + 0.06);
      } else o.frequency.setValueAtTime(f * h, t);
      lg.connect(o.frequency);
      const og = c.createGain();
      og.gain.value = a;
      o.connect(og).connect(g);
      oscs.push(o);
    });
    // membrane (dimo) : léger bourdonnement
    const buzz = c.createOscillator();
    buzz.type = 'sawtooth';
    buzz.frequency.setValueAtTime(f, t);
    lg.connect(buzz.frequency);
    const bh = c.createBiquadFilter(); bh.type = 'highpass'; bh.frequency.value = 3500;
    const bg = c.createGain(); bg.gain.value = 0.05;
    buzz.connect(bh).connect(bg).connect(g);
    // souffle
    const n = c.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2;
    const ng = c.createGain(); ng.gain.value = 0.18;
    n.connect(bp).connect(ng).connect(g);
    this.connect(g, 0.65);
    for (const o of [...oscs, buzz, lfo, n]) { o.start(t); o.stop(t + dur + 0.2); }
  }

  // 小锣 petit gong d'opéra : son « bwong » qui monte en hauteur
  operaGong(t, vol = 0.25) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    [1, 1.52, 2.4].forEach((p, i) => {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(420 * p, t);
      o.frequency.exponentialRampToValueAtTime(520 * p, t + 0.25);
      const og = c.createGain();
      og.gain.value = [1, 0.5, 0.25][i];
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 1.7);
    });
    this.connect(g, 0.5);
  }

  // 大锣 grand gong : grondement long et métallique
  bigGong(t, vol = 0.35) {
    const c = this.ctx;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 6);
    [1, 1.47, 2.09, 2.56, 3.17, 4.3].forEach((p, i) => {
      const o = c.createOscillator();
      o.frequency.setValueAtTime(72 * p, t);
      o.frequency.linearRampToValueAtTime(72 * p * 0.985, t + 5);
      const og = c.createGain();
      og.gain.value = 1 / (i + 1.2);
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + 6.1);
    });
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'bandpass'; lp.frequency.value = 900; lp.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.linearRampToValueAtTime(0.3, t + 0.4);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    n.connect(lp).connect(ng).connect(g);
    n.start(t);
    n.stop(t + 2);
    this.connect(g, 0.7);
  }

  // 堂鼓 tanggu : tambour grave
  drum(t, vol = 0.5, pitch = 1) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(150 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(55 * pitch, t + 0.16);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g);
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
    const ng = c.createGain();
    ng.gain.setValueAtTime(vol * 0.5, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    n.connect(lp).connect(ng).connect(g);
    this.connect(g, 0.25);
    o.start(t); o.stop(t + 0.5);
    n.start(t); n.stop(t + 0.1);
  }

  // 钹 bo : cymbales
  cymbal(t, vol = 0.12, len = 0.35) {
    const c = this.ctx;
    const n = c.createBufferSource();
    n.buffer = this.noise;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4500;
    const pk = c.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = 7000; pk.gain.value = 6;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    n.connect(hp).connect(pk).connect(g);
    this.connect(g, 0.35);
    n.start(t, Math.random());
    n.stop(t + len + 0.05);
  }

  // 木鱼 wood-block
  block(t, vol = 0.15, high = false) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.frequency.value = high ? 1250 : 880;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g);
    this.connect(g, 0.3);
    o.start(t);
    o.stop(t + 0.09);
  }
}

