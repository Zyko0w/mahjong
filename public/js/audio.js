// Sons du jeu (Web Audio) et musique d'ambiance.
// La musique vient de morceaux libres de droits listés dans public/music/playlist.json
// (crédits dans public/music/CREDITS.md). Les effets sonores restent synthétisés.
import { Instruments, freqOf } from './music.js';

const MODES = ['menu', 'solo', 'duel'];
const readVol = (key, def) => { const v = parseFloat(localStorage.getItem(key)); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : def; };

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('mj_muted') === '1';
    this.musicOn = localStorage.getItem('mj_music') !== '0';
    this.musicVol = readVol('mj_music_vol', 0.55);
    this.sfxVol = readVol('mj_sfx_vol', 0.9);
    this.trackName = 'menu';
    this.playlist = null;
    this.onTrack = null;
    this.queue = [];
    this.playlistReady = fetch('/music/playlist.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => (this.playlist = p))
      .catch(() => {});
    // On télécharge le premier morceau du menu dès l'ouverture de la page :
    // au premier clic, la musique démarre instantanément.
    this.playlistReady.then(() => this.preloadTrack('menu'));
  }

  songs(name) {
    return ((this.playlist && this.playlist[name]) || []).map((e) => (typeof e === 'string' ? { file: e } : e));
  }

  ensureAudioEl() {
    if (this.audioEl) return;
    this.audioEl = new Audio();
    this.audioEl.preload = 'auto';
    this.audioEl.addEventListener('ended', () => this.nextSong());
  }

  makeQueue(name) {
    this.queueMode = name;
    this.queue = this.songs(name).sort(() => Math.random() - 0.5);
    this.queueIdx = 0;
  }

  preloadTrack(name) {
    if (!this.songs(name).length || this.ctx) return;
    this.ensureAudioEl();
    this.makeQueue(name);
    this.audioEl.src = '/music/' + encodeURIComponent(this.queue[0].file);
    this.audioEl.load();
    this.preloaded = name;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);

    // Réverbération de salle de temple (réponse impulsionnelle générée)
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3.2;
    }
    this.reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverb.connect(wet);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = this.sfxVol;
    this.sfx.connect(this.master);
    wet.connect(this.sfx); // la réverbération suit le volume des effets
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicBus.connect(this.master);

    // Les instruments jouent aussi pour les effets sonores (guzheng, gong…)
    this.fxInst = new Instruments(ctx, this.sfx, this.reverb);

    const len2 = ctx.sampleRate * 0.2;
    this.noise = ctx.createBuffer(1, len2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len2; i++) d[i] = Math.random() * 2 - 1;
    if (this.musicOn) this.startMusic();
    this.loadSamples();
  }

  setMuted(m) {
    this.muted = m;
    localStorage.setItem('mj_muted', m ? '1' : '0');
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  setMusic(on) {
    this.musicOn = on;
    localStorage.setItem('mj_music', on ? '1' : '0');
    if (on) this.startMusic();
    else this.stopMusic();
  }

  // Volumes (0 à 1), mémorisés dans le navigateur
  setMusicVolume(v) {
    this.musicVol = Math.min(1, Math.max(0, v));
    localStorage.setItem('mj_music_vol', String(this.musicVol));
    if (this.ctx && this.musicOn) {
      this.musicBus.gain.cancelScheduledValues(this.ctx.currentTime);
      this.musicBus.gain.setTargetAtTime(this.musicVol, this.ctx.currentTime, 0.05);
    }
  }

  setSfxVolume(v) {
    this.sfxVol = Math.min(1, Math.max(0, v));
    localStorage.setItem('mj_sfx_vol', String(this.sfxVol));
    if (this.ctx) this.sfx.gain.setTargetAtTime(this.sfxVol, this.ctx.currentTime, 0.05);
  }

  // Change d'ambiance musicale avec un fondu : 'menu' | 'solo' | 'duel'
  setTrack(name) {
    if (!MODES.includes(name) || name === this.trackName) return;
    this.trackName = name;
    if (!this.ctx || !this.musicOn) return;
    this.fadeMusic(0, 0.6);
    clearTimeout(this.switchTimer);
    this.switchTimer = setTimeout(() => this.startMusic(), 700);
  }

  fadeMusic(target, time = 1.5) {
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(target * this.musicVol, t + time);
  }

  // Lit les morceaux de l'ambiance courante à la suite, dans un ordre aléatoire
  async startMusic() {
    if (!this.ctx) return;
    await this.playlistReady;
    if (!this.songs(this.trackName).length) return;
    this.ensureAudioEl();
    if (!this.audioConnected) {
      this.ctx.createMediaElementSource(this.audioEl).connect(this.musicBus);
      this.audioConnected = true;
    }
    if (this.preloaded === this.trackName) {
      this.preloaded = null;
      this.playCurrent(); // déjà téléchargé : démarrage immédiat
    } else {
      if (this.queueMode !== this.trackName || !this.queue.length) {
        this.makeQueue(this.trackName);
        this.queueIdx = -1;
      }
      this.nextSong();
    }
    this.fadeMusic(1, 0.8);
  }

  playCurrent() {
    const song = this.queue[this.queueIdx];
    if (!song) return;
    this.audioEl.loop = this.queue.length === 1;
    this.audioEl.play().catch(() => {});
    const label = song.title ? song.title + (song.author ? ' — ' + song.author : '') : song.file.replace(/\.[^.]+$/, '');
    this.onTrack && this.onTrack(label);
  }

  nextSong() {
    if (!this.queue.length || !this.musicOn) return;
    this.queueIdx = (this.queueIdx + 1) % this.queue.length;
    this.audioEl.src = '/music/' + encodeURIComponent(this.queue[this.queueIdx].file);
    this.playCurrent();
  }

  stopMusic() {
    if (!this.ctx) return;
    this.fadeMusic(0, 0.8);
    setTimeout(() => !this.musicOn && this.audioEl && this.audioEl.pause(), 900);
  }

  // Baisse temporaire de la musique (pour les jingles)
  duck(time = 2.5) {
    if (!this.ctx || !this.musicOn) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.15, t + 0.2);
    g.linearRampToValueAtTime(this.musicVol, t + time);
  }

  // ------------------------------------------------------------ effets
  tone(freq, { t = 0, dur = 0.5, type = 'sine', vol = 0.3, attack = 0.005 } = {}) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(vol, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g).connect(this.sfx);
    o.start(now);
    o.stop(now + dur + 0.05);
  }

  clack(vol = 0.5, pitch = 1) {
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400 * pitch * (0.9 + Math.random() * 0.2);
    bp.Q.value = 3;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    src.connect(bp).connect(g).connect(this.sfx);
    src.start(now);
    src.stop(now + 0.08);
    this.tone(1100 * pitch, { dur: 0.07, vol: vol * 0.25, type: 'triangle' });
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  // ------------------------------------------------------------ bruitages enregistrés (public/sfx, CC0)
  loadSamples() {
    this.samples = {};
    const names = ['kiai-court', 'kiai-long', 'katana-slash', 'katana-degaine', 'gong', 'gong-grand'];
    this.samplesReady = Promise.all(
      names.map(async (n) => {
        try {
          const buf = await (await fetch('/sfx/' + n + '.mp3')).arrayBuffer();
          this.samples[n] = await this.ctx.decodeAudioData(buf);
        } catch { /* son manquant : on l'ignore */ }
      })
    );
  }

  sample(name, { delay = 0, vol = 1, rate = 1 } = {}) {
    if (!this.ctx || !this.samples || !this.samples[name]) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.samples[name];
    src.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(g).connect(this.sfx);
    src.start(this.ctx.currentTime + delay);
  }

  // Transition de début de partie solo : coup de katana, cri, gong
  startSolo() {
    this.duck(3);
    this.sample('katana-slash', { vol: 0.9 });
    this.sample('kiai-court', { delay: 0.12, vol: 1 });
    this.sample('gong', { delay: 0.55, vol: 0.55 });
  }

  // Début de duel : sabre dégainé + long cri ; le grand gong sonne au « GO »
  startDuel() {
    this.duck(4);
    this.sample('katana-degaine', { vol: 0.9 });
    this.sample('kiai-long', { delay: 0.45, vol: 1 });
    this.sample('katana-slash', { delay: 0.5, vol: 0.8 });
  }

  duelGo() {
    this.sample('gong-grand', { vol: 0.75 });
    this.sample('kiai-court', { delay: 0.05, vol: 0.8, rate: 1.05 });
  }

  select() { this.clack(0.45, 1.1); }
  land() { this.clack(0.18, 0.8 + Math.random() * 0.3); }
  error() {
    if (!this.ctx) return;
    this.clack(0.3, 0.6);
    this.fxInst.block(this.now, 0.12);
  }
  match(combo = 1) {
    if (!this.ctx) return;
    const base = Math.min(combo - 1, 6), t = this.now;
    this.clack(0.45, 1.3);
    this.fxInst.zheng(base + 5, t + 0.02, 0.4, { bright: 0.7 });
    this.fxInst.zheng(base + 7, t + 0.1, 0.32, { bright: 0.7 });
    if (combo > 2) this.fxInst.zheng(base + 10, t + 0.18, 0.28, { bright: 0.8, bend: 2 });
    if (combo >= 5) this.fxInst.operaGong(t + 0.2, 0.12);
  }
  hint() {
    if (!this.ctx) return;
    this.fxInst.zhengGliss(8, 5, this.now, 0.18, 0.05);
  }
  shuffle() {
    for (let i = 0; i < 10; i++) setTimeout(() => this.clack(0.25, 0.8 + Math.random() * 0.5), i * 55);
    if (this.ctx) this.fxInst.zhengGliss(12, 10, this.now, 0.14, 0.04, -1);
  }
  undo() {
    if (!this.ctx) return;
    this.fxInst.zheng(6, this.now, 0.3, { bend: -2 });
  }
  tick(final = false) {
    if (!this.ctx) return;
    if (final) { this.fxInst.operaGong(this.now, 0.3); this.fxInst.drum(this.now, 0.6); }
    else this.fxInst.drum(this.now, 0.5, 1.2);
  }
  firework() {
    if (!this.ctx) return;
    this.fxInst.cymbal(this.now, 0.05, 0.6);
    this.tone(freqOf(10 + Math.floor(Math.random() * 6)), { dur: 1.1, vol: 0.05 });
  }
  win() {
    if (!this.ctx) return;
    this.duck(4);
    const t = this.now;
    this.fxInst.bigGong(t, 0.3);
    this.fxInst.zhengGliss(0, 16, t + 0.1, 0.22, 0.05);
    [5, 7, 8, 10].forEach((d, i) => this.fxInst.zheng(d, t + 1 + i * 0.22, 0.35, { bend: i === 3 ? 2 : 0 }));
  }
  lose() {
    if (!this.ctx) return;
    this.duck(4);
    const t = this.now;
    this.fxInst.operaGong(t, 0.2);
    this.fxInst.erhu(3, t + 0.2, 0.6, 0.08, 4);
    this.fxInst.erhu(2, t + 0.85, 0.6, 0.08);
    this.fxInst.erhu(0, t + 1.5, 1.6, 0.08, 1);
  }
}
