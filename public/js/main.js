// Contrôleur principal : menus, partie, score, classement, duel.
import { Scene3D } from './scene.js';
import { OpponentView, computeDuelLayout } from './opponent.js';
import { MahjongGame, LAYOUTS, FACE_NAMES } from './game.js';
import { Sound } from './audio.js';
import { DuelClient } from './net.js';
import { loadFaceFonts } from './textures.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const sound = new Sound();
let scene;
let opp = null; // adversaire assis en face (duel)
let duelLayout = null;

// Vues du duel : ton plateau (avec l'adversaire en incrustation), l'adversaire en grand, ou l'ensemble
const DUEL_VIEWS = { me: 'Mon jeu', opp: 'Adversaire', all: 'Ensemble' };
function setDuelView(mode, duration = 1.1) {
  if (!duelLayout) return;
  S.duelView = DUEL_VIEWS[mode] ? mode : 'me';
  scene.duelView(S.duelView, duelLayout, duration);
  $('#t-view-label').textContent = DUEL_VIEWS[S.duelView];
  $('#pip').classList.toggle('hidden', S.duelView !== 'me');
}
function cycleDuelView() {
  const order = ['me', 'opp', 'all'];
  setDuelView(order[(order.indexOf(S.duelView) + 1) % order.length]);
}

function disposeOpponent() {
  if (opp) { opp.dispose(); opp = null; }
  duelLayout = null;
  $('#pip').classList.add('hidden');
  $('#t-view').classList.add('hidden');
  if (scene) scene.resetDuel();
}

const PENALTY = { hint: 30, shuffle: 80, undo: 20 };
const COMBO_WINDOW = 5000;
const DUEL_HINT_COOLDOWN = 10000;
// Difficultés : indices autorisés, nombre de mélanges, multiplicateur de score, suffixe de classement
const DIFFS = {
  normal: { name: 'Normal', hints: true, shuffles: Infinity, mult: 1, suffix: '', glyph: '始', icon: 'leaf', rules: 'Indices et mélanges libres' },
  hardcore: { name: 'Hardcore', hints: false, shuffles: 2, mult: 1.5, suffix: '_hc', glyph: '死', icon: 'skull', rules: 'Aucun indice · 2 mélanges' },
  samurai: { name: 'Samouraï', hints: false, shuffles: 0, mult: 2, suffix: '_sm', glyph: '侍', icon: 'swords', rules: 'Aucun indice · aucun mélange' },
};
const diffOf = (d) => DIFFS[d] || DIFFS.normal;
const curDiff = () => diffOf(S.diff);

const S = {
  mode: 'solo',
  layout: LAYOUTS[localStorage.getItem('mj_layout')] ? localStorage.getItem('mj_layout') : 'classic',
  pseudo: localStorage.getItem('mj_pseudo') || '',
  assist: localStorage.getItem('mj_assist') !== '0',
  difficulty: DIFFS[localStorage.getItem('mj_difficulty')] ? localStorage.getItem('mj_difficulty') : localStorage.getItem('mj_hardcore') === '1' ? 'hardcore' : 'normal', // choisie dans le menu
  diff: 'normal', // difficulté de la partie en cours
  hc: false, // difficulté de la partie en cours
  game: null,
  seed: 0,
  selected: null,
  running: false,
  paused: false,
  busy: false,
  pending: 0,
  ended: false,
  moves: 0, score: 0, combo: 0, lastMatch: 0, hints: 0, shuffles: 0, undos: 0,
  elapsed: 0, lastTick: 0,
  duel: { opponent: '', oppRemaining: 0, total: 0, hintReadyAt: 0, quitting: false, inRoom: false, oppLeft: false },
};

// ================================================================ utilitaires UI
function fmtTime(sec) {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

const EMOTES = { wave: ['hand', 'Salut !'], fire: ['flame', 'En feu !'], laugh: ['laugh', 'Haha !'], angry: ['angry', 'Grrr !'], zap: ['zap', 'Éclair !'] };

function icon(name) {
  const i = document.createElement('i');
  i.setAttribute('data-lucide', name);
  return i;
}

function refreshIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function toast(text, big = false, iconName = null, extraClass = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (big ? ' big' : '') + (extraClass ? ' ' + extraClass : '');
  if (iconName) el.appendChild(icon(iconName));
  el.appendChild(document.createTextNode(text));
  $(extraClass === 'music' ? '#now-playing' : '#toasts').appendChild(el);
  refreshIcons();
  setTimeout(() => el.remove(), extraClass === "music" ? 5100 : 3100);
}

// Copie dans le presse-papiers, avec une méthode de secours quand l'API moderne est bloquée
// (site en http://, navigateur intégré, iframe…). Renvoie true si la copie a réussi.
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* on tente la méthode de secours */ }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none;';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

async function copyWithFeedback(btn, text, okMsg) {
  const ok = await copyText(text);
  const label = btn.querySelector('span');
  const old = btn.dataset.label || (btn.dataset.label = label.textContent);
  label.textContent = ok ? 'Copié !' : 'Copie impossible';
  btn.classList.toggle('copied', ok);
  if (ok) toast(okMsg, false, 'check');
  else toast(`Copie bloquée par le navigateur : sélectionne « ${text} » à la main.`, false, 'info');
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { label.textContent = old; btn.classList.remove('copied'); }, 1800);
}

function setSoundIcon() {
  const box = $('#t-sound-ico');
  box.innerHTML = '';
  box.appendChild(icon(sound.muted ? 'volume-x' : 'volume-2'));
  const mute = $('#pop-mute');
  mute.innerHTML = '';
  mute.append(icon(sound.muted ? 'volume-2' : 'volume-x'), sound.muted ? ' Réactiver le son' : ' Couper tout le son');
  refreshIcons();
}

function floater(text, world, cls = '') {
  const v = world.clone().project(scene.camera);
  const el = document.createElement('div');
  el.className = 'floater ' + cls;
  el.textContent = text;
  el.style.left = ((v.x + 1) / 2) * innerWidth + 'px';
  el.style.top = ((1 - v.y) / 2) * innerHeight + 'px';
  $('#floaters').appendChild(el);
  setTimeout(() => el.remove(), 1150);
}

function openModal(id) {
  $$('.modal').forEach((m) => m.classList.add('hidden'));
  if (id) $(id).classList.remove('hidden');
}
function closeModals() { openModal(null); }

function showMenu(reveal = true) {
  closeModals();
  $('#hud').classList.add('hidden');
  $('#menu').classList.toggle('hidden', !reveal);
  $('#countdown').classList.add('hidden');
  S.running = false;
  S.ended = true;
  S.selected = null;
  document.body.style.cursor = 'default';
  disposeOpponent();
  sound.setTrack('menu');
  // Plateau de démonstration en fond
  const demo = new MahjongGame('classic', (Math.random() * 2 ** 31) | 0);
  S.game = null;
  scene.buildBoard(demo);
  scene.setBoardVisible(true);
  scene.menuCamera();
}

function validPseudo() {
  const input = $('#pseudo');
  const p = input.value.replace(/[^\p{L}\p{N} _\-.]/gu, '').trim().slice(0, 16);
  if (p.length < 2) {
    input.classList.remove('invalid');
    void input.offsetWidth;
    input.classList.add('invalid');
    $('#menu-error').textContent = 'Entre un pseudo (2 à 16 caractères) pour jouer.';
    input.focus();
    return null;
  }
  input.classList.remove('invalid');
  $('#menu-error').textContent = '';
  S.pseudo = p;
  input.value = p;
  localStorage.setItem('mj_pseudo', p);
  return p;
}

// ================================================================ transition de début de partie
// Les panneaux de laque se ferment, un coup de katana traverse l'écran, le sceau tombe,
// puis les panneaux s'ouvrent sur la table. Renvoie deux promesses : écran couvert / ouverture.
function playTransition({ glyph, title, sub, hc = false, duel = false, left = '', right = '' }) {
  const el = $('#transition');
  const hold = duel ? 1700 : 1150;
  el.className = '';
  void el.offsetWidth;
  el.classList.toggle('duel', duel);
  el.classList.toggle('hc', hc);
  $('#tr-glyph').textContent = glyph;
  $('#tr-title').textContent = title;
  $('#tr-sub').textContent = sub;
  $('#tr-left-name').textContent = left;
  $('#tr-right-name').textContent = right;
  sound.init();
  requestAnimationFrame(() => el.classList.add('closed'));
  setTimeout(() => {
    el.classList.add('slash');
    duel ? sound.startDuel() : sound.startSolo();
  }, duel ? 260 : 200);
  setTimeout(() => el.classList.add('stamp'), duel ? 520 : 420);
  const covered = new Promise((r) => setTimeout(r, 400));
  const opening = new Promise((r) =>
    setTimeout(() => {
      el.classList.add('out');
      el.classList.remove('closed');
      r();
      setTimeout(() => { el.className = 'hidden'; }, 600);
    }, 400 + hold)
  );
  return { covered, opening };
}

// ================================================================ partie
async function newGame(layout, seed, mode, difficulty = S.difficulty) {
  const D = diffOf(difficulty);
  const hardcore = difficulty !== 'normal';
  S.diff = DIFFS[difficulty] ? difficulty : 'normal';
  S.mode = mode;
  S.hc = hardcore; // mode à contraintes (hardcore ou samouraï)
  S.layout = layout;
  S.seed = seed;
  S.game = new MahjongGame(layout, seed);
  sound.setTrack(mode);
  Object.assign(S, { selected: null, running: false, paused: false, busy: true, ended: false, pending: 0, moves: 0, score: 0, combo: 0, maxCombo: 0, lastMatch: 0, hints: 0, shuffles: 0, undos: 0, elapsed: 0 });
  closeModals();
  const L = LAYOUTS[layout];
  const tr = playTransition(
    mode === 'duel'
      ? { duel: true, glyph: '戰', title: 'Duel !', sub: `${L.name}${hardcore ? ' · ' + D.name : ''}`, left: S.pseudo, right: S.duel.opponent, hc: hardcore }
      : { glyph: D.glyph, title: L.name, sub: hardcore ? `${D.name} · ${D.rules.toLowerCase()}` : L.desc, hc: hardcore }
  );
  const gameRef = S.game;
  await tr.covered; // l'écran est couvert : on prépare le plateau sans saccade visible
  if (S.game !== gameRef) return;
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#duel-panel').classList.toggle('hidden', mode !== 'duel');
  $('#t-pause').disabled = mode === 'duel';
  $('#hardcore-tag').classList.toggle('hidden', !hardcore);
  $('#hardcore-tag').classList.toggle('samurai', difficulty === 'samurai');
  $('#hardcore-tag').innerHTML = '';
  $('#hardcore-tag').append(icon(D.icon), ' ' + D.name);
  refreshIcons();
  $('#selected-info').textContent = '';
  scene.controls.autoRotate = false;
  disposeOpponent();
  scene.buildBoard(S.game);
  scene.setBoardVisible(true);
  if (mode === 'duel') {
    // Duel : notre plateau devant nous, celui de l'adversaire en face, sur une table agrandie
    duelLayout = computeDuelLayout(S.game);
    scene.setBoardOffset(duelLayout.ourZ);
    scene.setTableScale(duelLayout.tableScale);
    opp = new OpponentView(scene, new MahjongGame(layout, seed), duelLayout, S.duel.opponent || 'Adversaire');
    scene.setPip($('#pip'), duelLayout);
    $('#pip-label').textContent = S.duel.opponent || 'Adversaire';
    $('#t-view').classList.remove('hidden');
    S.duelView = 'all';
  }
  refreshBoard();
  updateHUD();
  scene.camera.position.set(0, 30, 34); // la caméra plonge vers la table à l'ouverture des panneaux
  await tr.opening;
  if (S.game !== gameRef) return;
  if (duelLayout) scene.fitDuelCamera(duelLayout, true, 1.8);
  else scene.fitCamera(true, 1.8);
  if (opp) opp.intro();
  await scene.intro();
  if (S.game && S.mode === mode && mode === 'solo' && !S.ended) startClock();
  S.busy = false;
}

function startClock() {
  S.running = true;
  S.lastTick = performance.now();
}

function refreshBoard() {
  const g = S.game;
  if (!g) return;
  for (const t of g.tiles) if (g.alive[t.id]) scene.setBlocked(t.id, S.assist && !g.isFree(t.id));
  const pairs = g.availablePairs().length;
  $('#h-pairs').textContent = pairs;
  $('#h-pairs').classList.toggle('zero', pairs === 0 && g.remaining > 0);
}

function updateHUD() {
  const g = S.game;
  if (!g) return;
  $('#h-time').textContent = fmtTime(S.elapsed);
  $('#h-moves').textContent = S.moves;
  $('#h-tiles').textContent = g.remaining;
  $('#h-score').textContent = S.score;
  $('#t-undo').disabled = g.history.length === 0;
  const D = curDiff();
  $('#t-hint').disabled = !D.hints;
  $('#t-hint').title = D.hints ? 'Indice (H)' : `Pas d’indice en ${D.name}`;
  const left = D.shuffles - S.shuffles;
  $('#shuffle-left').classList.toggle('hidden', !Number.isFinite(D.shuffles));
  $('#shuffle-left').textContent = Math.max(0, left);
  $('#t-shuffle').disabled = left <= 0;
  if (S.mode === 'duel') {
    $('#d-me-name').textContent = S.pseudo;
    $('#d-me-left').textContent = g.remaining;
    $('#d-me-bar').style.width = ((g.total - g.remaining) / g.total) * 100 + '%';
    $('#d-opp-name').textContent = S.duel.opponent;
    $('#d-opp-left').textContent = S.duel.oppRemaining;
    $('#d-opp-bar').style.width = ((g.total - S.duel.oppRemaining) / g.total) * 100 + '%';
  }
}

function sendProgress() {
  if (S.mode !== 'duel') return;
  duel.send({ type: 'progress', remaining: S.game.remaining, total: S.game.total, moves: S.moves, combo: S.combo, score: S.score, maxCombo: S.maxCombo, hints: S.hints, shuffles: S.shuffles });
}

// Actions envoyées à l'adversaire pour qu'il voie notre plateau bouger en direct
function sendAct(msg) {
  if (S.mode === 'duel' && S.running && !S.ended) duel.send({ type: 'act', ...msg });
}

function canPlay() {
  return S.game && S.running && !S.paused && !S.ended;
}

function select(id) {
  if (S.selected !== null) scene.setSelected(S.selected, false);
  S.selected = id;
  sendAct({ k: 'sel', id });
  if (id !== null) {
    scene.setSelected(id, true);
    $('#selected-info').textContent = FACE_NAMES[S.game.face(id)] || '';
  } else $('#selected-info').textContent = '';
}

function onTileClick(id) {
  sound.init();
  if (!canPlay()) return;
  const g = S.game;
  if (!g.isFree(id)) {
    sound.error();
    scene.shake(id);
    return;
  }
  if (S.selected === null) {
    sound.select();
    select(id);
  } else if (S.selected === id) {
    sound.select();
    select(null);
  } else if (g.canMatch(S.selected, id)) {
    doMatch(S.selected, id);
  } else {
    sound.error();
    scene.shake(S.selected);
    select(id);
  }
}

async function doMatch(a, b) {
  const g = S.game;
  select(null);
  g.match(a, b);
  sendAct({ k: 'match', a, b });
  scene.clearHints();
  S.moves++;
  const now = performance.now();
  S.combo = now - S.lastMatch < COMBO_WINDOW ? S.combo + 1 : 1;
  S.lastMatch = now;
  S.maxCombo = Math.max(S.maxCombo, S.combo);
  const mult = Math.min(S.combo, 5);
  const pts = 20 * mult;
  S.score += pts;
  sound.match(S.combo);
  const comboEl = $('#h-combo');
  comboEl.textContent = S.combo > 1 ? `COMBO ×${mult}` : '';
  comboEl.classList.remove('pop');
  void comboEl.offsetWidth;
  comboEl.classList.add('pop');
  refreshBoard();
  updateHUD();
  sendProgress();
  S.pending++;
  const gameRef = g;
  const mid = await scene.removePair(a, b);
  S.pending--;
  if (S.game !== gameRef) return;
  floater(`+${pts}${mult > 1 ? ' ×' + mult : ''}`, mid, mult >= 3 ? 'combo-big' : '');
  if (g.remaining === 0) return victory();
  if (S.pending === 0 && g.availablePairs().length === 0 && !S.ended) stuck();
}

function stuck() {
  const D = curDiff();
  const noShuffle = S.shuffles >= D.shuffles;
  $('#s-undo').disabled = S.game.history.length === 0;
  $('#s-shuffle').disabled = noShuffle;
  $('#m-stuck .sub').textContent = noShuffle
    ? `${D.name} : ${D.shuffles ? 'plus aucun mélange disponible' : 'aucun mélange autorisé'}. Annule un coup ou abandonne.`
    : Number.isFinite(D.shuffles)
      ? `Les tuiles libres ne forment aucune paire. Mélanges restants : ${D.shuffles - S.shuffles}.`
      : 'Les tuiles libres restantes ne forment aucune paire.';
  openModal('#m-stuck');
}

// Défaite en solo (abandon quand le plateau est bloqué)
function soloDefeat() {
  S.running = false;
  S.ended = true;
  select(null);
  sound.lose();
  const L = LAYOUTS[S.layout];
  $('#end-glyph').textContent = '敗';
  $('#end-glyph').classList.add('lose');
  $('#end-title').textContent = 'Partie perdue';
  $('#end-sub').textContent = `${L.name}${S.hc ? ' en ' + curDiff().name : ''} : le plateau est resté bloqué.`;
  $('#end-stats').innerHTML =
    statCell('Tuiles restantes', S.game.remaining, true) +
    statCell('Temps', fmtTime(S.elapsed)) +
    statCell('Coups', S.moves) +
    statCell('Mélanges', S.shuffles);
  setRank('', null);
  setEndActions([
    ['Rejouer', 'primary', () => newGame(S.layout, (Math.random() * 2 ** 31) | 0, 'solo', S.diff), null, 'rotate-ccw'],
    ['Menu', 'ghost', showMenu, null, 'house'],
  ]);
  openModal('#m-end');
}

function doHint() {
  if (!canPlay() || S.busy) return;
  if (!curDiff().hints) return toast(`Pas d’indice en ${curDiff().name} !`, false, curDiff().icon);
  if (S.mode === 'duel') {
    const wait = S.duel.hintReadyAt - performance.now();
    if (wait > 0) return toast(`Indice disponible dans ${Math.ceil(wait / 1000)} s`, false, 'timer');
    S.duel.hintReadyAt = performance.now() + DUEL_HINT_COOLDOWN;
  }
  const h = S.game.hint();
  if (!h) return stuck();
  S.hints++;
  if (S.mode === 'solo') S.score = Math.max(0, S.score - PENALTY.hint);
  scene.hint(h);
  sound.hint();
  updateHUD();
}

async function doShuffle() {
  if (!S.game || !S.running || S.paused || S.busy || S.ended || S.pending) return;
  if (S.shuffles >= curDiff().shuffles) return toast(curDiff().shuffles ? `Plus aucun mélange en ${curDiff().name} !` : `Aucun mélange en ${curDiff().name} : fie-toi à ton sabre !`, false, curDiff().icon);
  closeModals();
  S.busy = true;
  select(null);
  const ids = S.game.shuffle();
  sendAct({ k: 'shuf', faces: ids.map((id) => [id, S.game.face(id)]) });
  S.shuffles++;
  S.combo = 0;
  if (S.mode === 'solo') S.score = Math.max(0, S.score - PENALTY.shuffle);
  if (Number.isFinite(curDiff().shuffles)) toast(S.shuffles >= curDiff().shuffles ? 'Dernier mélange utilisé !' : `Mélanges restants : ${curDiff().shuffles - S.shuffles}`, false, curDiff().icon);
  sound.shuffle();
  updateHUD();
  await scene.shuffleAnim(S.game, ids);
  refreshBoard();
  sendProgress();
  S.busy = false;
}

function doUndo() {
  if (!S.game || !S.running || S.paused || S.busy || S.ended || S.pending) return;
  const last = S.game.undo();
  if (!last) return;
  closeModals();
  select(null);
  scene.restorePair(last[0], last[1]);
  sendAct({ k: 'undo', a: last[0], b: last[1] });
  S.undos++;
  S.moves++;
  S.combo = 0;
  $('#h-combo').textContent = '';
  if (S.mode === 'solo') S.score = Math.max(0, S.score - PENALTY.undo);
  sound.undo();
  refreshBoard();
  updateHUD();
  sendProgress();
}

function togglePause(force) {
  if (!S.game || S.ended || S.mode === 'duel') return;
  const p = force !== undefined ? force : !S.paused;
  if (p === S.paused) return;
  S.paused = p;
  if (p) {
    scene.setBoardVisible(false);
    openModal('#m-pause');
  } else {
    S.lastTick = performance.now();
    scene.setBoardVisible(true);
    closeModals();
  }
}

function quitGame() {
  if (S.mode === 'duel' && S.game && !S.ended) {
    if (!confirm('Abandonner le duel ? Ton adversaire remportera la victoire.')) return;
    S.duel.quitting = true;
    duel.send({ type: 'forfeit' });
    duel.send({ type: 'cancel' });
  } else if (S.mode === 'duel') {
    duel.send({ type: 'cancel' });
  }
  S.duel.inRoom = false;
  showMenu();
}

// ================================================================ fin de partie
function statCell(label, value, hl = false) {
  return `<div class="${hl ? 'hl' : ''}"><small>${label}</small><b>${value}</b></div>`;
}

function setRank(text, ico) {
  const el = $('#end-rank');
  el.innerHTML = '';
  if (ico && text) el.appendChild(icon(ico));
  el.appendChild(document.createTextNode(text));
  refreshIcons();
}

function setEndActions(buttons) {
  const box = $('#end-actions');
  box.innerHTML = '';
  for (const [label, cls, fn, id, ico] of buttons) {
    const b = document.createElement('button');
    b.className = 'btn ' + cls;
    if (ico) b.appendChild(icon(ico));
    b.appendChild(document.createTextNode((ico ? ' ' : '') + label));
    if (id) b.id = id;
    b.onclick = fn;
    box.appendChild(b);
  }
  refreshIcons();
}

async function victory() {
  if (S.ended) return;
  S.running = false;
  if (S.mode === 'duel') {
    // Le serveur arbitre : on annonce la fin, il renvoie le résultat.
    duel.send({ type: 'finished', time: S.elapsed, moves: S.moves });
    toast('Plateau vidé ! Vérification…', false, 'sparkles');
    return;
  }
  S.ended = true;
  const L = LAYOUTS[S.layout];
  const timeBonus = Math.max(0, Math.round((L.par - S.elapsed) * 5));
  const base = S.score;
  S.score = Math.round((base + L.bonus + timeBonus) * curDiff().mult);
  updateHUD();
  scene.celebrate();
  sound.win();
  $('#end-glyph').textContent = '勝';
  $('#end-glyph').classList.remove('lose');
  $('#end-title').textContent = S.hc ? `Victoire ${curDiff().name} !` : 'Victoire !';
  $('#end-sub').textContent = `${S.pseudo}, tu as vidé ${L.name} — ${L.desc}${S.hc ? ` — en ${curDiff().name} (score ×${String(curDiff().mult).replace('.', ',')})` : ''}.`;
  $('#end-stats').innerHTML =
    statCell('Score', S.score, true) +
    statCell('Temps', fmtTime(S.elapsed)) +
    statCell('Coups', S.moves) +
    statCell('Bonus temps', '+' + timeBonus) +
    statCell('Indices', S.hints) +
    statCell('Mélanges', S.shuffles);
  $('#end-rank').textContent = 'Envoi au classement…';
  setEndActions([
    ['Rejouer', 'primary', () => newGame(S.layout, (Math.random() * 2 ** 31) | 0, 'solo', S.diff), null, 'rotate-ccw'],
    ['Classement', 'ghost', () => showBoard(S.layout, S.diff), null, 'trophy'],
    ['Menu', 'ghost', showMenu, null, 'house'],
  ]);
  setTimeout(() => openModal('#m-end'), 1600);
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudo: S.pseudo, layout: S.layout, time: S.elapsed, moves: S.moves, score: S.score, hints: S.hints, shuffles: S.shuffles, difficulty: S.diff, hardcore: S.diff === 'hardcore' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);
    setRank(data.improved ? `Classé n°${data.rank} en ${L.name}${S.hc ? ' ' + curDiff().name : ''} !` : `Ton record précédent reste meilleur (n°${data.rank}).`, data.improved ? 'medal' : 'info');
  } catch (e) {
    setRank(e.message && !/fetch|JSON/i.test(e.message) ? 'Score non enregistré : ' + e.message : "Impossible d'enregistrer le score (serveur injoignable).", 'info');
  }
}

function duelResult(msg) {
  if (S.duel.quitting) { S.duel.quitting = false; return; }
  if (!S.game || S.mode !== 'duel') return; // déjà revenu au menu
  S.running = false;
  S.ended = true;
  select(null);
  const win = msg.result === 'win';
  if (win) { scene.celebrate(); sound.win(); } else sound.lose();
  if (opp) opp.react(win ? 'lose' : 'win');

  // Statistiques : les nôtres en local, celles de l'adversaire envoyées par le serveur
  const total = S.game ? S.game.total : 0;
  const mine = { pseudo: S.pseudo, score: S.score, remaining: S.game ? S.game.remaining : 0, total, moves: S.moves, maxCombo: S.maxCombo, shuffles: S.shuffles, hints: S.hints };
  const serverOpp = msg.players && (win ? msg.players.loser : msg.players.winner);
  const theirs = { pseudo: S.duel.opponent, remaining: S.duel.oppRemaining, total, moves: 0, score: 0, maxCombo: 0, shuffles: 0, hints: 0, ...(S.duel.oppStats || {}), ...(serverOpp || {}) };
  const time = msg.reason === 'finished' ? msg.time : S.elapsed;
  const gameRef = S.game;
  const reasons = {
    finished: win ? 'Tu as vidé le plateau en premier !' : `${msg.winner} a vidé le plateau avant toi.`,
    forfeit: win ? `${S.duel.opponent} a abandonné ou s'est déconnecté.` : 'Tu as abandonné.',
  };

  setTimeout(() => {
    // le joueur a pu revenir au menu entre-temps : on n'affiche rien par-dessus
    if (S.game !== gameRef || S.mode !== 'duel') return;
    const banner = $('#de-banner');
    banner.classList.toggle('lose', !win);
    $('#de-title').textContent = win ? 'Victoire !' : 'Défaite…';
    $('#de-sub').textContent = `${LAYOUTS[S.layout].name}${S.hc ? ' · ' + curDiff().name : ''} · ${fmtTime(time)}`;
    $('#de-reason').textContent = reasons[msg.reason] || '';
    fillDuelCard($('#de-me'), mine, 'Toi', win);
    fillDuelCard($('#de-opp'), theirs, 'Adversaire', !win);
    // relance les animations d'entrée
    for (const el of [banner, $('#de-me'), $('#de-opp'), $('.de-vs'), $('#de-reason'), $('#de-actions')]) {
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
    }
    const box = $('#de-actions');
    box.innerHTML = '';
    const mk = (label, cls, ico, fn, id) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + cls;
      if (id) btn.id = id;
      btn.append(icon(ico), ' ' + label);
      btn.onclick = fn;
      box.appendChild(btn);
      return btn;
    };
    const re = mk('Revanche', 'primary', 'swords', () => {
      duel.send({ type: 'rematch' });
      re.disabled = true;
      re.textContent = 'En attente…';
    }, 'btn-rematch');
    if (S.duel.oppLeft) re.disabled = true;
    mk('Classement', 'ghost', 'trophy', () => showBoard('duel'));
    mk('Menu', 'ghost', 'house', () => { duel.send({ type: 'cancel' }); S.duel.inRoom = false; showMenu(); });
    refreshIcons();
    openModal('#m-duel-end');
    countUp();
  }, win ? 1300 : 700);
}

function fillDuelCard(card, p, tag, isWinner) {
  card.classList.toggle('winner', isWinner);
  card.classList.toggle('loser', !isWinner);
  card.innerHTML = '';
  if (isWinner) {
    const crown = document.createElement('div');
    crown.className = 'de-crown';
    crown.appendChild(icon('crown'));
    card.appendChild(crown);
  }
  const name = document.createElement('div');
  name.className = 'de-name';
  name.textContent = p.pseudo || '—';
  const t = document.createElement('div');
  t.className = 'de-tag';
  t.textContent = isWinner ? tag + ' · vainqueur' : tag;
  const score = document.createElement('div');
  score.className = 'de-score';
  score.innerHTML = '<span data-count="' + (p.score | 0) + '">0</span><small>POINTS</small>';
  const cleared = Math.max(0, (p.total || 0) - (p.remaining || 0));
  const bar = document.createElement('div');
  bar.className = 'de-progress';
  bar.innerHTML = '<span></span>';
  requestAnimationFrame(() => (bar.firstChild.style.width = (p.total ? (cleared / p.total) * 100 : 0) + '%'));
  const stats = document.createElement('div');
  stats.className = 'de-stats';
  const rows = [
    ['Tuiles retirées', `${cleared}/${p.total || '?'}`],
    ['Coups', p.moves | 0],
    ['Combo max', '×' + Math.min(5, p.maxCombo | 0)],
    ['Mélanges', p.shuffles | 0],
  ];
  for (const [k, v] of rows) {
    const d = document.createElement('div');
    const sp = document.createElement('span');
    sp.textContent = k;
    const bb = document.createElement('b');
    bb.textContent = v;
    d.append(sp, bb);
    stats.appendChild(d);
  }
  card.append(name, t, score, bar, stats);
}

// Les scores défilent jusqu'à leur valeur finale
function countUp() {
  const els = $$('#m-duel-end [data-count]');
  const start = performance.now() + 700;
  const step = (now) => {
    const k = Math.min(1, Math.max(0, (now - start) / 1100));
    const e = 1 - (1 - k) ** 3;
    for (const el of els) el.textContent = Math.round(+el.dataset.count * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ================================================================ classement
// Catégories : vue d'ensemble, une par forme (Normal / Hardcore / Samouraï), et les duels.
let boardCache = null;
const BOARD = { cat: 'overview', diff: 'normal' };

function catKey(layout, diff) { return layout + diffOf(diff).suffix; }

async function showBoard(cat = 'overview', diff = BOARD.diff) {
  BOARD.cat = cat;
  BOARD.diff = DIFFS[diff] ? diff : 'normal';
  openModal('#m-board');
  buildBoardCats();
  $('#board-table').innerHTML = '<tr><td class="empty">Chargement…</td></tr>';
  try {
    const r = await fetch('/api/leaderboard');
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Classement indisponible (' + r.status + ').');
    boardCache = data;
  } catch (e) {
    boardCache = null;
    BOARD.error = e.message && !/fetch|JSON/i.test(e.message) ? e.message : 'Serveur injoignable.';
  }
  buildBoardCats();
  renderBoard();
}

function buildBoardCats() {
  const nav = $('#board-cats');
  nav.innerHTML = '';
  const add = (key, label, ico, count, group) => {
    if (group) {
      const g = document.createElement('div');
      g.className = 'cat-group';
      g.textContent = group;
      nav.appendChild(g);
    }
    const btn = document.createElement('button');
    btn.className = 'cat' + (BOARD.cat === key ? ' active' : '');
    btn.append(icon(ico));
    const name = document.createElement('span');
    name.textContent = label;
    btn.appendChild(name);
    if (count !== null) {
      const c = document.createElement('em');
      c.textContent = count;
      btn.appendChild(c);
    }
    btn.onclick = () => { BOARD.cat = key; buildBoardCats(); renderBoard(); };
    nav.appendChild(btn);
  };
  add('overview', 'Vue d’ensemble', 'layout-grid', null);
  let first = true;
  for (const [key, L] of Object.entries(LAYOUTS)) {
    const n = boardCache ? (boardCache[catKey(key, BOARD.diff)] || []).length : null;
    add(key, L.name, L.icon || 'grid-3x3', n, first ? 'Formes' : null);
    first = false;
  }
  add('duel', 'Duels', 'swords', boardCache ? (boardCache.duel || []).length : null, 'Multijoueur');
  $$('#board-diff button').forEach((x) => x.classList.toggle('active', x.dataset.diff === BOARD.diff));
  refreshIcons();
}

function renderBoard() {
  const cat = BOARD.cat;
  const title = $('#board-title');
  title.innerHTML = '';
  const L = LAYOUTS[cat];
  const meta = cat === 'overview' ? ['Vue d’ensemble', 'layout-grid'] : cat === 'duel' ? ['Duels', 'swords'] : [L.name, L.icon];
  title.append(icon(meta[1]), ' ' + meta[0]);
  if (L) {
    const sm = document.createElement('small');
    sm.textContent = ' · ' + L.desc;
    title.appendChild(sm);
  }
  $('#board-diff').classList.toggle('hidden', cat === 'duel');
  const overview = cat === 'overview';
  $('#board-overview').classList.toggle('hidden', !overview);
  $('#board-wrap').classList.toggle('hidden', overview);
  if (!boardCache) {
    $('#board-wrap').classList.remove('hidden');
    $('#board-table').innerHTML = '';
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.className = 'empty';
    td.textContent = BOARD.error || 'Serveur injoignable.';
    tr.appendChild(td);
    $('#board-table').appendChild(tr);
    refreshIcons();
    return;
  }
  if (overview) renderOverview();
  else renderTable(cat === 'duel' ? 'duel' : catKey(cat, BOARD.diff), cat === 'duel');
  refreshIcons();
}

// Une carte par catégorie avec le champion et le podium
function renderOverview() {
  const box = $('#board-overview');
  box.innerHTML = '';
  const cats = [...Object.entries(LAYOUTS).map(([k, L]) => [k, L.name, L.icon]), ['duel', 'Duels', 'swords']];
  for (const [key, name, ico] of cats) {
    const list = key === 'duel' ? boardCache.duel || [] : boardCache[catKey(key, BOARD.diff)] || [];
    const card = document.createElement('button');
    card.className = 'ov-card';
    card.onclick = () => { BOARD.cat = key; buildBoardCats(); renderBoard(); };
    const head = document.createElement('div');
    head.className = 'ov-head';
    head.append(icon(ico), ' ' + name);
    card.appendChild(head);
    if (key !== 'duel') {
      const cv = document.createElement('canvas');
      cv.width = 120;
      cv.height = 60;
      drawLayoutPreview(cv, LAYOUTS[key].positions);
      card.appendChild(cv);
    }
    const podium = document.createElement('ol');
    if (!list.length) {
      const li = document.createElement('li');
      li.className = 'none';
      li.textContent = 'Personne pour l’instant';
      podium.appendChild(li);
    }
    list.slice(0, 3).forEach((e, i) => {
      const li = document.createElement('li');
      li.className = 'p' + (i + 1);
      const who = document.createElement('span');
      who.textContent = e.pseudo;
      const val = document.createElement('b');
      val.textContent = key === 'duel' ? `${e.wins} V` : e.score;
      li.append(who, val);
      podium.appendChild(li);
    });
    card.appendChild(podium);
    box.appendChild(card);
  }
}

function renderTable(key, isDuel) {
  const table = $('#board-table');
  const list = boardCache[key] || [];
  table.innerHTML = '';
  const me = (S.pseudo || '').toLowerCase();
  const head = document.createElement('tr');
  const cols = isDuel ? ['#', 'Pseudo', 'Victoires', 'Défaites', 'Ratio', 'Meilleur temps'] : ['#', 'Pseudo', 'Score', 'Temps', 'Coups', 'Mélanges', 'Date'];
  for (const c of cols) { const th = document.createElement('th'); th.textContent = c; head.appendChild(th); }
  table.appendChild(head);
  if (!list.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = cols.length;
    td.className = 'empty';
    td.textContent = 'Aucun résultat pour l’instant. Sois le premier !';
    tr.appendChild(td);
    table.appendChild(tr);
    return;
  }
  list.forEach((e, i) => {
    const tr = document.createElement('tr');
    if (e.pseudo.toLowerCase() === me) tr.className = 'me';
    const cells = isDuel
      ? [i + 1, e.pseudo, e.wins, e.losses, Math.round((e.wins / Math.max(1, e.wins + e.losses)) * 100) + ' %', e.best ? fmtTime(e.best) : '—']
      : [i + 1, e.pseudo, e.score, fmtTime(e.time), e.moves, e.shuffles ?? 0, new Date(e.date).toLocaleDateString('fr-FR')];
    const cls = ['rank', 'pseudo', 'score'];
    cells.forEach((v, k) => {
      const td = document.createElement('td');
      td.textContent = v;
      if (cls[k]) td.className = cls[k];
      tr.appendChild(td);
    });
    table.appendChild(tr);
  });
}

// ================================================================ duel
const duel = new DuelClient(onDuelMessage, (st) => {
  // Connexion impossible ou coupée pendant l'attente dans le salon
  if ((st === 'error' || st === 'closed') && !$('#m-duel').classList.contains('hidden') && !(S.mode === 'duel' && S.game && !S.ended)) {
    duelReset();
    S.duel.inRoom = false;
    $('#duel-error').textContent = 'Serveur de duel injoignable. Réessaie dans un instant (un serveur gratuit peut mettre ~30 s à se réveiller).';
  }
  if (st === 'closed' && S.duel.inRoom) {
    S.duel.inRoom = false;
    if (S.mode === 'duel' && !S.ended) {
      toast('Connexion au serveur perdue.', true, 'wifi-off');
      showMenu();
    }
  }
});

function duelWaiting(text, code) {
  $('#duel-options').classList.add('hidden');
  $('#duel-wait').classList.remove('hidden');
  $('#duel-wait-text').textContent = text;
  $('#room-code-box').classList.toggle('hidden', !code);
  if (code) $('#room-code').textContent = code;
}

function duelReset() {
  $('#duel-options').classList.remove('hidden');
  $('#duel-wait').classList.add('hidden');
  $('#duel-error').textContent = '';
}

function openDuel(code = S.pendingCode || '') {
  if (code) S.pendingCode = code;
  if (!validPseudo()) return;
  S.pendingCode = '';
  duelReset();
  $('#d-code').value = code;
  $('#m-duel .sub').textContent = `Disposition : ${LAYOUTS[S.layout].name} (${LAYOUTS[S.layout].desc}) · ${diffOf(S.difficulty).name}${S.difficulty !== 'normal' ? ' : ' + diffOf(S.difficulty).rules.toLowerCase() : ''}. Même donne pour les deux joueurs — le premier qui vide le plateau gagne !`;
  openModal('#m-duel');
  duel.connect();
}

function onDuelMessage(msg) {
  switch (msg.type) {
    case 'created':
      S.duel.inRoom = true;
      S.duel.myCode = msg.code;
      duelWaiting('Salon créé ! Envoie ce code à ton adversaire :', msg.code);
      break;
    case 'queued':
      duelWaiting(`Recherche d'un adversaire (${LAYOUTS[msg.layout].name}${msg.difficulty && msg.difficulty !== 'normal' ? ', ' + diffOf(msg.difficulty).name : ''})…`);
      break;
    case 'error':
      duelReset();
      $('#duel-error').textContent = msg.message;
      break;
    case 'start': {
      S.duel = { ...S.duel, opponent: msg.opponent, oppRemaining: LAYOUTS[msg.layout].positions.length, hintReadyAt: 0, quitting: false, inRoom: true, oppLeft: false };
      history.replaceState(null, '', location.pathname);
      newGame(msg.layout, msg.seed, 'duel', msg.difficulty || (msg.hardcore ? 'hardcore' : 'normal'));
      countdown(msg.countdown);
      break;
    }
    case 'opp_act':
      if (!opp) break;
      if (msg.k === 'sel') opp.select(msg.id);
      else if (msg.k === 'match') opp.match(msg.a, msg.b);
      else if (msg.k === 'undo') opp.undo(msg.a, msg.b);
      else if (msg.k === 'shuf') opp.shuffle(msg.faces);
      break;
    case 'opp_progress':
      S.duel.oppStats = msg;
      S.duel.oppRemaining = msg.remaining;
      updateHUD();
      if (msg.combo >= 4 && msg.combo % 2 === 0) toast(`${S.duel.opponent} enchaîne un combo ×${Math.min(msg.combo, 5)} !`, false, 'flame');
      break;
    case 'result':
      duelResult(msg);
      break;
    case 'opp_rematch':
      toast(`${S.duel.opponent} veut une revanche !`, true, 'swords');
      { const b = $('#btn-rematch'); if (b && !b.disabled) { b.innerHTML = ''; b.append(icon('swords'), ' Accepter la revanche'); refreshIcons(); } }
      break;
    case 'opp_left':
      S.duel.oppLeft = true;
      S.duel.inRoom = false;
      toast(`${S.duel.opponent || "L'adversaire"} a quitté le salon.`, false, 'door-open');
      { const b = $('#btn-rematch'); if (b) { b.disabled = true; b.textContent = 'Adversaire parti'; } }
      break;
    case 'opp_emote':
      { const e = EMOTES[msg.emote]; if (e) { toast(`${S.duel.opponent} : ${e[1]}`, false, e[0]); if (opp) opp.emote(e[1]); } }
      break;
  }
}

function countdown(ms) {
  const el = $('#countdown');
  el.classList.remove('hidden');
  el.innerHTML = '';
  const start = performance.now();
  const steps = [3, 2, 1];
  steps.forEach((n, i) => {
    setTimeout(() => {
      el.innerHTML = `<span>${n}</span>`;
      sound.tick();
    }, ms - (3 - i) * 1000);
  });
  setTimeout(() => {
    el.innerHTML = '<span>GO !</span>';
    sound.duelGo();
    if (S.mode === 'duel' && !S.ended) {
      S.elapsed = 0;
      startClock();
      setDuelView('me', 1.2);
    }
    setTimeout(() => el.classList.add('hidden'), 800);
  }, Math.max(0, ms - (performance.now() - start)));
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ================================================================ crédits musique
async function loadCredits() {
  const ul = $('#music-credits');
  if (ul.childElementCount) return;
  try {
    const pl = await (await fetch('/music/playlist.json')).json();
    const seen = new Set();
    for (const e of Object.values(pl).flat()) {
      if (typeof e !== 'object' || seen.has(e.file)) continue;
      seen.add(e.file);
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = e.source || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = e.title;
      li.append(a, ` — ${e.author} (${e.license})`);
      ul.appendChild(li);
    }
  } catch { /* hors ligne */ }
}

// ================================================================ choix du plateau
// Aperçu vu de dessus : chaque tuile est un petit rectangle, plus clair et décalé selon l'étage.
function drawLayoutPreview(canvas, positions) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, maxZ = 0;
  for (const p of positions) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x + 2);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y + 2);
    maxZ = Math.max(maxZ, p.z);
  }
  const ratio = 1.34; // proportions d'une tuile
  const s = Math.min((W - 8) / (maxX - minX), (H - 8) / ((maxY - minY) * ratio));
  const ox = (W - (maxX - minX) * s) / 2, oy = (H - (maxY - minY) * s * ratio) / 2;
  ctx.clearRect(0, 0, W, H);
  const sorted = [...positions].sort((a, b) => a.z - b.z || a.y - b.y);
  for (const p of sorted) {
    const lift = p.z * 1.5;
    const x = ox + (p.x - minX) * s - lift, y = oy + (p.y - minY) * s * ratio - lift;
    const w = 2 * s - 1, h = 2 * s * ratio - 1;
    ctx.fillStyle = '#17654a';
    ctx.fillRect(x + 1, y + 1.5, w, h);
    const l = 72 + (maxZ ? (p.z / maxZ) * 22 : 0);
    ctx.fillStyle = `hsl(42, 45%, ${l}%)`;
    ctx.fillRect(x, y, w, h);
  }
}

function buildLayoutPicker() {
  const grid = $('#layout-select');
  grid.innerHTML = '';
  for (const [key, L] of Object.entries(LAYOUTS)) {
    const b = document.createElement('button');
    b.dataset.layout = key;
    b.title = `${L.name} — ${L.desc}`;
    const cv = document.createElement('canvas');
    cv.width = 120;
    cv.height = 78;
    drawLayoutPreview(cv, L.positions);
    const name = document.createElement('span');
    name.textContent = L.name.replace(/^(Le |La |L’)/, '');
    b.append(cv, name);
    b.onclick = () => selectLayout(key, true);
    grid.appendChild(b);
  }
  selectLayout(S.layout, false);
}

function selectLayout(key, withSound) {
  S.layout = key;
  localStorage.setItem('mj_layout', key);
  $$('#layout-select button').forEach((x) => x.classList.toggle('active', x.dataset.layout === key));
  const L = LAYOUTS[key];
  const info = $('#layout-info');
  info.innerHTML = '';
  info.append(icon(L.icon || 'grid-3x3'));
  const b = document.createElement('b');
  b.textContent = L.name;
  info.append(b, ` — ${L.desc}`);
  refreshIcons();
  if (withSound) { sound.init(); sound.select(); }
}

// ================================================================ difficulté et volumes
function selectDifficulty(diff, withSound) {
  S.difficulty = DIFFS[diff] ? diff : 'normal';
  localStorage.setItem('mj_difficulty', S.difficulty);
  $$('#difficulty-select button').forEach((b) => b.classList.toggle('active', b.dataset.diff === S.difficulty));
  $('#menu .menu-card').classList.toggle('hc', S.difficulty === 'hardcore');
  $('#menu .menu-card').classList.toggle('sm', S.difficulty === 'samurai');
  if (withSound) {
    sound.init();
    if (S.difficulty === 'samurai') sound.sample('katana-degaine', { vol: 0.7 });
    else if (S.difficulty === 'hardcore') sound.error();
    else sound.select();
  }
}

function bindVolumes() {
  const rows = $$('.volume-row');
  const sync = () => {
    for (const r of rows) {
      const v = Math.round((r.dataset.vol === 'music' ? sound.musicVol : sound.sfxVol) * 100);
      r.querySelector('input').value = v;
      r.querySelector('em').textContent = v + ' %';
      r.querySelector('input').style.setProperty('--p', v + '%');
    }
  };
  for (const r of rows) {
    r.querySelector('input').addEventListener('input', (e) => {
      sound.init();
      const v = e.target.value / 100;
      if (r.dataset.vol === 'music') {
        sound.setMusicVolume(v);
        if (v > 0 && !sound.musicOn) sound.setMusic(true);
        if (v === 0 && sound.musicOn) sound.setMusic(false);
      } else {
        sound.setSfxVolume(v);
      }
      sync();
    });
    // petit son de test quand on relâche le curseur des effets
    if (r.dataset.vol === 'sfx') r.querySelector('input').addEventListener('change', () => sound.select());
  }
  if (sound.musicVol === 0) sound.musicOn = false;
  sync();
}

// ================================================================ initialisation
function bindUI() {
  $('#pseudo').value = S.pseudo;
  buildLayoutPicker();
  $$('#board-diff button').forEach((b) => (b.onclick = () => { BOARD.diff = b.dataset.diff; buildBoardCats(); renderBoard(); }));
  $('#pseudo').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#btn-solo').click(); });
  $('#btn-solo').onclick = () => {
    sound.init();
    if (!validPseudo()) return;
    newGame(S.layout, (Math.random() * 2 ** 31) | 0, 'solo');
  };
  $('#btn-duel').onclick = () => { sound.init(); openDuel(); };
  $('#btn-board').onclick = () => showBoard('overview', S.difficulty);
  $('#btn-rules').onclick = () => { openModal('#m-rules'); loadCredits(); };
  $$('[data-close]').forEach((b) => (b.onclick = () => {
    const modal = b.closest('.modal');
    if (modal.id === 'm-duel') { duel.send({ type: 'cancel' }); S.duel.inRoom = false; }
    modal.classList.add('hidden');
    if (S.ended && S.game) openModal(S.mode === 'duel' ? '#m-duel-end' : '#m-end');
  }));

  // options
  $('#opt-assist').checked = S.assist;
  setSoundIcon();
  bindVolumes();
  $('#opt-assist').onchange = (e) => { S.assist = e.target.checked; localStorage.setItem('mj_assist', S.assist ? '1' : '0'); refreshBoard(); };
  $$('#difficulty-select button').forEach((b) => (b.onclick = () => selectDifficulty(b.dataset.diff, true)));
  selectDifficulty(S.difficulty, false);

  // barre d'outils
  $('#t-hint').onclick = doHint;
  $('#t-shuffle').onclick = doShuffle;
  $('#t-undo').onclick = doUndo;
  $('#t-view').onclick = cycleDuelView;
  $('#t-cam').onclick = () => (duelLayout ? setDuelView(S.duelView, 0.8) : scene.fitCamera(true, 0.9));
  $('#t-sound').onclick = (e) => {
    e.stopPropagation();
    sound.init();
    $('#sound-pop').classList.toggle('hidden');
  };
  $('#sound-pop').addEventListener('click', (e) => e.stopPropagation());
  addEventListener('click', () => $('#sound-pop').classList.add('hidden'));
  $('#pop-mute').onclick = () => {
    sound.init();
    sound.setMuted(!sound.muted);
    setSoundIcon();
  };
  $('#t-pause').onclick = () => togglePause();
  $('#t-quit').onclick = () => (S.mode === 'duel' ? quitGame() : (S.ended ? showMenu() : confirm('Quitter la partie en cours ?') && showMenu()));

  // modales en jeu
  $('#s-shuffle').onclick = doShuffle;
  $('#s-undo').onclick = doUndo;
  $('#s-quit').onclick = () => (S.mode === 'solo' ? soloDefeat() : quitGame());
  $('#p-resume').onclick = () => togglePause(false);
  $('#p-restart').onclick = () => { S.paused = false; newGame(S.layout, S.seed, 'solo', S.diff); };
  $('#p-quit').onclick = () => { S.paused = false; showMenu(); };

  // duel
  $('#d-create').onclick = () => { duel.send({ type: 'create', pseudo: S.pseudo, layout: S.layout, difficulty: S.difficulty }); duelWaiting('Création du salon…'); };
  $('#d-join').onclick = () => {
    const code = $('#d-code').value.trim().toUpperCase();
    if (code.length !== 4) { $('#duel-error').textContent = 'Le code fait 4 caractères.'; return; }
    if (code === S.duel.myCode) { $('#duel-error').textContent = "C'est le code de ton propre salon : envoie-le à ton adversaire !"; return; }
    duel.send({ type: 'join', code, pseudo: S.pseudo });
    duelWaiting('Connexion au salon…');
  };
  $('#d-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#d-join').click(); });
  $('#d-quick').onclick = () => { duel.send({ type: 'quick', pseudo: S.pseudo, layout: S.layout, difficulty: S.difficulty }); duelWaiting('Recherche d\'un adversaire…'); };
  $('#d-cancel').onclick = () => { duel.send({ type: 'cancel' }); S.duel.inRoom = false; duelReset(); };
  const code = () => $('#room-code').textContent.trim();
  $('#d-copy-code').onclick = (e) => copyWithFeedback(e.currentTarget, code(), 'Code copié !');
  $('#room-code').onclick = () => copyWithFeedback($('#d-copy-code'), code(), 'Code copié !');
  $('#d-copy').onclick = (e) => copyWithFeedback(e.currentTarget, `${location.origin}/?duel=${code()}`, 'Lien copié !');
  $$('#emotes button').forEach((b) => (b.onclick = () => {
    duel.send({ type: 'chat', emote: b.dataset.emote });
    toast(`Toi : ${EMOTES[b.dataset.emote][1]}`, false, EMOTES[b.dataset.emote][0]);
  }));

  // clavier
  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape' || k === 'p') {
      if (S.game && !S.ended && S.mode === 'solo') togglePause();
      return;
    }
    if (!S.game || S.ended) return;
    if (k === 'h') doHint();
    else if (k === 'm') doShuffle();
    else if (k === 'z' || (e.ctrlKey && k === 'z')) doUndo();
    else if (k === 'c') (duelLayout ? setDuelView(S.duelView, 0.8) : scene.fitCamera(true, 0.9));
    else if (k === 's') $('#t-sound').click();
    else if (k === 'v' && duelLayout) cycleDuelView();
  });
  addEventListener('pointerdown', () => sound.init());
  addEventListener('blur', () => { if (S.mode === 'solo' && S.running && !S.ended) togglePause(true); });

  // horloge
  setInterval(() => {
    if (S.running && !S.paused && !S.ended) {
      const now = performance.now();
      S.elapsed += (now - S.lastTick) / 1000;
      S.lastTick = now;
      $('#h-time').textContent = fmtTime(S.elapsed);
      if (S.combo > 1 && now - S.lastMatch > COMBO_WINDOW) {
        S.combo = 0;
        $('#h-combo').textContent = '';
      }
    }
  }, 200);
}

async function init() {
  refreshIcons();
  sound.onTrack = (title) => { if (sound.musicOn && !sound.muted) toast(title, false, 'music', 'music'); };
  const step = (t) => { const el = $('#loader-text'); if (el) el.textContent = t; };
  step('Chargement des calligraphies…');
  await loadFaceFonts();
  step('Construction du temple…');
  await new Promise((r) => requestAnimationFrame(r));
  scene = new Scene3D($('#stage'), {
    onTileClick,
    onTileHover: (id) => {
      const ok = id !== null && S.game && canPlay() && S.game.isFree(id);
      scene.setHovered(ok ? id : null);
      document.body.style.cursor = ok ? 'pointer' : 'default';
    },
    onLand: (kind) => (kind === 'firework' ? sound.firework() : sound.land()),
  });
  bindUI();
  showMenu(false); // plateau de démonstration en fond, menu encore caché
  step('Allumage des lanternes…');
  await scene.warmup(); // shaders compilés + premières images dessinées : plus d'écran uni
  clearTimeout(window.mjLoadTimer);

  // Porte d'entrée : ce clic autorise le son (règle des navigateurs), la musique part tout de suite
  const loader = $('#loader');
  loader.classList.add('ready');
  const enter = () => {
    if (loader.classList.contains('fade')) return;
    removeEventListener('keydown', onKey);
    sound.init();
    sound.select();
    loader.classList.add('fade');
    setTimeout(() => loader.remove(), 900);
    setTimeout(() => {
      $('#menu').classList.remove('hidden');
      const code = new URLSearchParams(location.search).get('duel');
      if (code) openDuel(code.toUpperCase().slice(0, 4));
    }, 350);
  };
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') enter(); };
  $('#enter-btn').onclick = enter;
  addEventListener('keydown', onKey);
  $('#enter-btn').focus();
}

init().catch((e) => {
  console.error(e);
  window.mjLoadFailed && window.mjLoadFailed('Erreur au démarrage : ' + e.message);
});
