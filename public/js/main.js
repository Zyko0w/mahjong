// Contrôleur principal : menus, partie, score, classement, duel.
import { Scene3D } from './scene.js';
import { OpponentView, computeDuelLayout } from './opponent.js';
import { MahjongGame, LAYOUTS, FACE_NAMES } from './game.js';
import { Sound } from './audio.js';
import { DuelClient } from './net.js';
import { loadFaceFonts, drawFace } from './textures.js';
import { Run, COMBO_WINDOW, dailyChallenge, parisDate, shiftDate } from './rules.js';

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

const DUEL_HINT_COOLDOWN = 10000;
// Difficultés : indices autorisés, nombre de mélanges, multiplicateur de score, suffixe de classement
const DIFFS = {
  normal: { name: 'Normal', hints: true, shuffles: Infinity, mult: 1, suffix: '', glyph: '始', icon: 'leaf', rules: 'Indices et mélanges libres' },
  hardcore: { name: 'Hardcore', hints: false, shuffles: 2, mult: 1.5, suffix: '_hc', glyph: '死', icon: 'skull', rules: 'Aucun indice · 2 mélanges' },
  samurai: { name: 'Samouraï', hints: false, shuffles: 0, mult: 2, suffix: '_sm', glyph: '侍', icon: 'swords', rules: 'Aucun indice · aucun mélange' },
};
const diffOf = (d) => DIFFS[d] || DIFFS.normal;
const curDiff = () => diffOf(S.diff);
// Modes solo (le duel se joue toujours en Classique)
const VARIANTS_UI = {
  classic: { name: 'Classique', icon: 'layers', glyph: null, rules: 'Le mahjong solitaire de toujours', suffix: '' },
  timeattack: { name: 'Contre la montre', icon: 'timer', glyph: '速', rules: 'Chaque paire rajoute des secondes', suffix: '_ta' },
  blind: { name: 'Aveugle', icon: 'eye-off', glyph: '闇', rules: 'Tuiles bloquées face cachée · ×1,25', suffix: '_bl' },
  zen: { name: 'Zen', icon: 'flower-2', glyph: '禅', rules: 'Ni chrono, ni score, ni limite', suffix: null },
};
const variantOf = (v) => VARIANTS_UI[v] || VARIANTS_UI.classic;
const curVariant = () => variantOf(S.variant);

const S = {
  mode: 'solo',
  layout: LAYOUTS[localStorage.getItem('mj_layout')] ? localStorage.getItem('mj_layout') : 'classic',
  pseudo: localStorage.getItem('mj_pseudo') || '',
  assist: localStorage.getItem('mj_assist') !== '0',
  difficulty: DIFFS[localStorage.getItem('mj_difficulty')] ? localStorage.getItem('mj_difficulty') : localStorage.getItem('mj_hardcore') === '1' ? 'hardcore' : 'normal', // choisie dans le menu
  menuVariant: VARIANTS_UI[localStorage.getItem('mj_variant')] ? localStorage.getItem('mj_variant') : 'classic', // mode choisi dans le menu
  variant: 'classic', // mode de la partie en cours
  daily: null, // date du défi du jour en cours
  run: null, // règles + journal des coups de la partie en cours (rules.js)
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

// Horloge de la partie en millisecondes (les pauses ne comptent pas)
function clock() {
  const live = S.running && !S.paused ? (performance.now() - S.lastTick) / 1000 : 0;
  return Math.round((S.elapsed + live) * 1000);
}

// Recopie l'état de la partie (score, combo…) dans S, utilisé par le HUD et le duel
function syncRun() {
  const r = S.run;
  Object.assign(S, { score: r.score, combo: r.combo, maxCombo: r.maxCombo, moves: r.moves, hints: r.hints, shuffles: r.shuffles, undos: r.undos });
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
  refreshDailyButton();
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
async function newGame(layout, seed, mode, difficulty = S.difficulty, variant = 'classic', daily = null) {
  if (mode === 'duel' || !VARIANTS_UI[variant]) variant = 'classic';
  if (variant === 'zen' || daily) difficulty = 'normal';
  const D = diffOf(difficulty);
  const V = variantOf(variant);
  const hardcore = difficulty !== 'normal';
  S.diff = DIFFS[difficulty] ? difficulty : 'normal';
  S.variant = variant;
  S.daily = daily;
  S.mode = mode;
  S.hc = hardcore; // mode à contraintes (hardcore ou samouraï)
  S.layout = layout;
  S.seed = seed;
  S.run = new Run({ layout, seed, difficulty: S.diff, variant, penalties: mode === 'solo' });
  S.game = S.run.game;
  sound.setTrack(variant === 'zen' ? 'menu' : mode);
  Object.assign(S, { selected: null, running: false, paused: false, busy: true, ended: false, pending: 0, elapsed: 0, lastBeep: null });
  syncRun();
  closeModals();
  const L = LAYOUTS[layout];
  const tags = [daily ? 'Défi du jour' : null, variant !== 'classic' ? V.name : null, hardcore ? D.name : null].filter(Boolean);
  const tr = playTransition(
    mode === 'duel'
      ? { duel: true, glyph: '戰', title: 'Duel !', sub: `${L.name}${hardcore ? ' · ' + D.name : ''}`, left: S.pseudo, right: S.duel.opponent, hc: hardcore }
      : { glyph: daily ? '日' : V.glyph || D.glyph, title: L.name, sub: tags.length ? `${tags.join(' · ')} · ${(variant !== 'classic' ? V.rules : D.rules).toLowerCase()}` : L.desc, hc: hardcore }
  );
  const gameRef = S.game;
  await tr.covered; // l'écran est couvert : on prépare le plateau sans saccade visible
  if (S.game !== gameRef) return;
  $('#menu').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#duel-panel').classList.toggle('hidden', mode !== 'duel');
  $('#t-pause').disabled = mode === 'duel';
  const tag = $('#hardcore-tag');
  tag.classList.toggle('hidden', !tags.length);
  tag.classList.toggle('samurai', difficulty === 'samurai');
  tag.classList.toggle('mode', !hardcore);
  tag.innerHTML = '';
  tag.append(icon(daily ? 'calendar-days' : hardcore ? D.icon : V.icon), ' ' + tags.join(' · '));
  $('#h-time-label').textContent = variant === 'timeattack' ? 'Temps restant' : 'Temps';
  $('#h-time').parentElement.classList.toggle('hidden', variant === 'zen');
  $('#h-time').classList.remove('low');
  $('.score-box').classList.toggle('hidden', variant === 'zen');
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
  const blind = S.variant === 'blind';
  for (const t of g.tiles) {
    if (!g.alive[t.id]) continue;
    const free = g.isFree(t.id);
    scene.setBlocked(t.id, S.assist && !free);
    if (blind) scene.setHidden(t.id, !free, g.face(t.id));
  }
  const pairs = g.availablePairs().length;
  $('#h-pairs').textContent = pairs;
  $('#h-pairs').classList.toggle('zero', pairs === 0 && g.remaining > 0);
}

function updateHUD() {
  const g = S.game;
  if (!g) return;
  updateClock();
  $('#h-moves').textContent = S.moves;
  $('#h-tiles').textContent = g.remaining;
  $('#h-score').textContent = S.score;
  $('#t-undo').disabled = g.history.length === 0;
  const D = curDiff();
  const R = S.run;
  $('#t-hint').disabled = !R.hintsAllowed;
  $('#t-hint').title = R.hintsAllowed ? 'Indice (H)' : `Pas d’indice en ${D.name}`;
  const left = R.shufflesAllowed - S.shuffles;
  $('#shuffle-left').classList.toggle('hidden', !Number.isFinite(R.shufflesAllowed));
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

// Chrono : temps écoulé, ou temps restant en contre-la-montre (rouge sous 15 s)
function updateClock() {
  if (!S.run) return;
  if (S.run.timed) {
    const left = Math.max(0, S.run.timeLeft(clock()));
    $('#h-time').textContent = fmtTime(Math.ceil(left / 1000));
    $('#h-time').classList.toggle('low', left < 15000);
  } else $('#h-time').textContent = fmtTime(S.elapsed);
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
  const res = S.run.match(clock(), a, b);
  if (!res) {
    if (S.run.expired(clock())) timeUp();
    return;
  }
  select(null);
  syncRun();
  sendAct({ k: 'match', a, b });
  scene.clearHints();
  const { pts, mult, gain } = res;
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
  if (S.variant !== 'zen') floater(`+${pts}${mult > 1 ? ' ×' + mult : ''}${gain ? ` · +${gain / 1000} s` : ''}`, mid, mult >= 3 ? 'combo-big' : '');
  if (g.remaining === 0) return victory();
  if (S.pending === 0 && g.availablePairs().length === 0 && !S.ended) stuck();
}

function stuck() {
  const D = { name: curDiff().name, shuffles: S.run.shufflesAllowed };
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
  if (S.run.timed) return timeUp(true);
  S.running = false;
  S.ended = true;
  select(null);
  sound.lose();
  if (S.daily) markDailyPlayed(S.daily);
  const L = LAYOUTS[S.layout];
  $('#end-glyph').textContent = '敗';
  $('#end-glyph').classList.add('lose');
  $('#end-title').textContent = 'Partie perdue';
  $('#end-sub').textContent = `${L.name}${modeLabel(' en ')} : le plateau est resté bloqué.`;
  $('#end-stats').innerHTML =
    statCell('Tuiles restantes', S.game.remaining, true) +
    statCell('Temps', fmtTime(S.elapsed)) +
    statCell('Coups', S.moves) +
    statCell('Mélanges', S.shuffles);
  setRank('', null);
  setEndActions(endButtons(false));
  openModal('#m-end');
}

// Fin du contre-la-montre : temps écoulé, ou abandon quand le plateau est bloqué
function timeUp(gaveUp = false) {
  if (S.ended || !S.run || !S.run.timed || S.game.remaining === 0) return; // plateau vidé : la victoire arrive
  const endT = gaveUp ? clock() : S.run.deadline();
  S.running = false;
  S.ended = true;
  S.elapsed = endT / 1000;
  select(null);
  closeModals();
  sound.lose();
  const { score } = S.run.finish(endT);
  S.score = score;
  updateHUD();
  $('#h-time').textContent = gaveUp ? $('#h-time').textContent : '00:00';
  const L = LAYOUTS[S.layout];
  const pairs = (S.game.total - S.game.remaining) / 2;
  $('#end-glyph').textContent = '時';
  $('#end-glyph').classList.add('lose');
  $('#end-title').textContent = gaveUp ? 'Partie terminée' : 'Temps écoulé !';
  $('#end-sub').textContent = `${S.pseudo}, tu as retiré ${pairs} paire${pairs > 1 ? 's' : ''} sur ${S.game.total / 2} dans ${L.name}${modeLabel(' en ')}.`;
  $('#end-stats').innerHTML =
    statCell('Score', S.score, true) +
    statCell('Paires', `${pairs}/${S.game.total / 2}`) +
    statCell('Durée', fmtTime(S.elapsed)) +
    statCell('Combo max', '×' + Math.min(5, S.maxCombo)) +
    statCell('Coups', S.moves) +
    statCell('Mélanges', S.shuffles);
  setEndActions(endButtons());
  setTimeout(() => openModal('#m-end'), 900);
  submitScore(endT);
}

// « en Aveugle · Hardcore », « (défi du jour) »… pour les textes de fin
function modeLabel(prefix) {
  const parts = [S.variant !== 'classic' ? curVariant().name : null, S.hc ? curDiff().name : null].filter(Boolean);
  return (parts.length ? prefix + parts.join(' · ') : '') + (S.daily ? ' (défi du jour)' : '');
}

function endButtons(withBoard = true) {
  if (S.daily) {
    // une seule partie par jour : on montre le classement du jour à la place de « Rejouer »
    return [
      ['Classement du jour', 'primary', () => showBoard('daily'), null, 'trophy'],
      ['Menu', 'ghost', showMenu, null, 'house'],
    ];
  }
  const out = [['Rejouer', 'primary', () => newGame(S.layout, (Math.random() * 2 ** 31) | 0, 'solo', S.diff, S.variant), null, 'rotate-ccw']];
  if (withBoard && S.variant !== 'zen') out.push(['Classement', 'ghost', () => showBoard(S.layout, S.diff, S.variant), null, 'trophy']);
  out.push(['Menu', 'ghost', showMenu, null, 'house']);
  return out;
}

function doHint() {
  if (!canPlay() || S.busy) return;
  if (!S.run.hintsAllowed) return toast(`Pas d’indice en ${curDiff().name} !`, false, curDiff().icon);
  if (S.mode === 'duel') {
    const wait = S.duel.hintReadyAt - performance.now();
    if (wait > 0) return toast(`Indice disponible dans ${Math.ceil(wait / 1000)} s`, false, 'timer');
    S.duel.hintReadyAt = performance.now() + DUEL_HINT_COOLDOWN;
  }
  const h = S.run.hint(clock());
  if (!h) return S.run.expired(clock()) ? timeUp() : stuck();
  syncRun();
  scene.hint(h);
  sound.hint();
  updateHUD();
}

async function doShuffle() {
  if (!S.game || !S.running || S.paused || S.busy || S.ended || S.pending) return;
  const maxShuffles = S.run.shufflesAllowed;
  if (S.shuffles >= maxShuffles) return toast(maxShuffles ? `Plus aucun mélange en ${curDiff().name} !` : `Aucun mélange en ${curDiff().name} : fie-toi à ton sabre !`, false, curDiff().icon);
  const ids = S.run.shuffle(clock());
  if (!ids) return;
  closeModals();
  S.busy = true;
  select(null);
  syncRun();
  sendAct({ k: 'shuf', faces: ids.map((id) => [id, S.game.face(id)]) });
  if (Number.isFinite(maxShuffles)) toast(S.shuffles >= maxShuffles ? 'Dernier mélange utilisé !' : `Mélanges restants : ${maxShuffles - S.shuffles}`, false, curDiff().icon);
  sound.shuffle();
  updateHUD();
  await scene.shuffleAnim(S.game, ids);
  refreshBoard();
  sendProgress();
  S.busy = false;
}

function doUndo() {
  if (!S.game || !S.running || S.paused || S.busy || S.ended || S.pending) return;
  const last = S.run.undo(clock());
  if (!last) return;
  syncRun();
  closeModals();
  select(null);
  scene.restorePair(last[0], last[1]);
  sendAct({ k: 'undo', a: last[0], b: last[1] });
  $('#h-combo').textContent = '';
  sound.undo();
  refreshBoard();
  updateHUD();
  sendProgress();
}

function confirmQuitSolo() {
  if (S.ended) return true;
  return confirm(S.daily ? 'Quitter le défi du jour ? Il ne se joue qu’une fois : tu ne pourras pas le recommencer aujourd’hui.' : 'Quitter la partie en cours ?');
}

function togglePause(force) {
  if (!S.game || S.ended || S.mode === 'duel') return;
  const p = force !== undefined ? force : !S.paused;
  if (p === S.paused) return;
  S.paused = p;
  if (p) {
    scene.setBoardVisible(false);
    $('#p-restart').classList.toggle('hidden', !!S.daily);
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
  const endT = S.run.lastT; // fin officielle = dernière paire (le serveur compte pareil)
  S.elapsed = endT / 1000;
  scene.celebrate();
  sound.win();
  $('#end-glyph').classList.remove('lose');
  if (S.variant === 'zen') {
    $('#end-glyph').textContent = '禅';
    $('#end-title').textContent = 'Plateau apaisé';
    $('#end-sub').textContent = `${L.name} est vide. Respire, puis recommence quand tu veux.`;
    $('#end-stats').innerHTML = statCell('Paires', S.game.total / 2, true) + statCell('Coups', S.moves) + statCell('Mélanges', S.shuffles);
    setRank('', null);
    setEndActions(endButtons(false));
    setTimeout(() => openModal('#m-end'), 1600);
    return;
  }
  const { score, timeBonus } = S.run.finish(endT);
  S.score = score;
  updateHUD();
  const mult = curDiff().mult * (S.variant === 'blind' ? 1.25 : 1);
  $('#end-glyph').textContent = '勝';
  $('#end-title').textContent = S.hc ? `Victoire ${curDiff().name} !` : 'Victoire !';
  $('#end-sub').textContent = `${S.pseudo}, tu as vidé ${L.name} — ${L.desc}${modeLabel(' — en ')}${mult !== 1 ? ` (score ×${String(mult).replace('.', ',')})` : ''}.`;
  $('#end-stats').innerHTML =
    statCell('Score', S.score, true) +
    statCell(S.run.timed ? 'Durée' : 'Temps', fmtTime(S.elapsed)) +
    statCell('Coups', S.moves) +
    statCell(S.run.timed ? 'Bonus chrono' : 'Bonus temps', '+' + timeBonus) +
    statCell('Indices', S.hints) +
    statCell('Mélanges', S.shuffles);
  setEndActions(endButtons());
  setTimeout(() => openModal('#m-end'), 1600);
  submitScore(endT);
}

// Envoie la partie au serveur : il rejoue la liste des coups et recalcule lui-même le score.
async function submitScore(endT) {
  const L = LAYOUTS[S.layout];
  const where = S.daily ? 'défi du jour' : `${L.name}${modeLabel(' ')}`;
  const run = S.run;
  if (S.daily) markDailyPlayed(S.daily);
  $('#end-rank').textContent = 'Envoi au classement…';
  try {
    const res = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudo: S.pseudo, layout: S.layout, seed: S.seed, difficulty: S.diff, variant: S.variant, daily: S.daily || undefined, log: run.log, end: endT }),
    });
    const data = await res.json();
    if (S.run !== run) return; // une autre partie a commencé entre-temps
    if (!res.ok) throw new Error(data.error);
    if (!data.rank) setRank(`Score enregistré, mais hors du top 100 en ${where}.`, 'info');
    else setRank(data.improved ? `Classé n°${data.rank} en ${where} !` : `Ton record précédent reste meilleur (n°${data.rank}).`, data.improved ? 'medal' : 'info');
  } catch (e) {
    if (S.run !== run) return;
    setRank(e.message && !/fetch|JSON/i.test(e.message) ? 'Score non enregistré : ' + e.message : "Impossible d'enregistrer le score (serveur injoignable).", 'info');
  }
}

// ---------------------------------------------------------------- défi du jour
function dailyStreak() {
  const last = localStorage.getItem('mj_daily_last');
  const today = parisDate();
  if (last !== today && last !== shiftDate(today, -1)) return 0;
  return +localStorage.getItem('mj_daily_streak') || 0;
}

function markDailyPlayed(date) {
  const last = localStorage.getItem('mj_daily_last');
  if (last === date) return;
  const streak = last === shiftDate(date, -1) ? (+localStorage.getItem('mj_daily_streak') || 0) + 1 : 1;
  localStorage.setItem('mj_daily_last', date);
  localStorage.setItem('mj_daily_streak', String(streak));
  if (streak > 1) toast(`Série de défis : ${streak} jours d'affilée !`, false, 'flame');
}

function dailyDone() { return localStorage.getItem('mj_daily_last') === parisDate(); }

// Temps avant le prochain défi (minuit, heure de Paris)
function untilNextDaily() {
  const now = new Date();
  const paris = new Date(now.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const next = new Date(paris);
  next.setHours(24, 0, 0, 0);
  const min = Math.max(1, Math.round((next - paris) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}` : `${min} min`;
}

function refreshDailyButton() {
  const ch = dailyChallenge(parisDate());
  const done = dailyDone();
  const streak = dailyStreak();
  const btn = $('#btn-daily');
  btn.classList.toggle('done', done);
  btn.querySelector('.label').firstChild.textContent = done ? 'Défi du jour joué' : 'Défi du jour';
  $('#daily-info').textContent = done
    ? `Voir le classement · prochain dans ${untilNextDaily()}${streak > 1 ? ` · série de ${streak} j` : ''}`
    : `${LAYOUTS[ch.layout].name} · ${variantOf(ch.variant).name} · une seule partie${streak ? ` · série de ${streak} j` : ''}`;
}

// Le défi ne se joue qu'une fois par jour : le serveur enregistre le lancement avant la partie
async function startDaily() {
  sound.init();
  if (dailyDone()) return showBoard('daily');
  if (!validPseudo()) return;
  const ch = dailyChallenge(parisDate());
  const btn = $('#btn-daily');
  btn.disabled = true;
  try {
    const r = await fetch('/api/daily-start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pseudo: S.pseudo, date: ch.date }) });
    const data = await r.json().catch(() => ({}));
    if (r.status === 409) {
      markDailyPlayed(ch.date);
      refreshDailyButton();
      $('#menu-error').textContent = data.error;
      return;
    }
    if (!r.ok) throw new Error(data.error || 'serveur injoignable (' + r.status + ')');
  } catch (e) {
    $('#menu-error').textContent = 'Défi du jour indisponible : ' + (e.message && !/fetch/i.test(e.message) ? e.message : 'serveur injoignable') + '.';
    return;
  } finally {
    btn.disabled = false;
  }
  markDailyPlayed(ch.date);
  refreshDailyButton();
  newGame(ch.layout, ch.seed, 'solo', 'normal', ch.variant, ch.date);
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
    mk('Classement', 'ghost', 'trophy', () => { BOARD.duelLayout = S.layout; showBoard('duel', S.diff); });
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
const BOARD = { cat: 'overview', diff: 'normal', variant: 'classic', duelLayout: 'all', day: 'today' };
const BOARD_VARIANTS = ['classic', 'timeattack', 'blind'];

function catKey(layout, diff, variant = BOARD.variant) { return layout + variantOf(variant).suffix + diffOf(diff).suffix; }
// Duels : un classement par plateau (ou tous les plateaux) et par difficulté
function duelList(layout = BOARD.duelLayout) {
  return boardCache && boardCache.duel && !Array.isArray(boardCache.duel) ? boardCache.duel[layout + diffOf(BOARD.diff).suffix] || [] : [];
}
function boardDay() { return boardCache ? (BOARD.day === 'yesterday' ? shiftDate(boardCache.today, -1) : boardCache.today) : parisDate(); }
function dailyList(day = boardDay()) { return boardCache && boardCache.daily ? boardCache.daily[day] || [] : []; }

async function showBoard(cat = 'overview', diff = BOARD.diff, variant = BOARD.variant) {
  BOARD.cat = cat;
  if (cat === 'daily') BOARD.day = 'today';
  BOARD.diff = DIFFS[diff] ? diff : 'normal';
  BOARD.variant = BOARD_VARIANTS.includes(variant) ? variant : 'classic';
  openModal('#m-board');
  buildBoardCats();
  $('#board-table').innerHTML = '<tr><td class="empty">Chargement…</td></tr>';
  try {
    const r = await fetch('/api/leaderboard', { cache: 'no-store' });
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
    if (group) nav.appendChild(h('span', 'cat-group', group));
    const btn = h('button', 'cat' + (BOARD.cat === key ? ' active' : ''));
    btn.append(icon(ico), h('span', null, label));
    if (count) btn.appendChild(h('em', null, count));
    btn.onclick = () => { BOARD.cat = key; buildBoardCats(); renderBoard(); };
    nav.appendChild(btn);
  };
  add('overview', 'Vue d’ensemble', 'layout-grid', null);
  add('daily', 'Défi du jour', 'calendar-days', boardCache ? dailyList().length : null);
  let first = true;
  for (const [key, L] of Object.entries(LAYOUTS)) {
    const n = boardCache ? (boardCache[catKey(key, BOARD.diff)] || []).length : null;
    add(key, L.name.replace(/^(Le |La |L’)/, ''), L.icon || 'grid-3x3', n, first ? 'Plateaux' : null);
    first = false;
  }
  add('duel', 'Duels', 'swords', boardCache ? duelList().length : null, 'Duel');
  $$('#board-diff button').forEach((x) => x.classList.toggle('active', x.dataset.diff === BOARD.diff));
  $$('#board-variant button').forEach((x) => x.classList.toggle('active', x.dataset.variant === BOARD.variant));
  refreshIcons();
  const active = nav.querySelector('.cat.active');
  if (active) nav.scrollTo({ left: active.offsetLeft - nav.clientWidth / 2 + active.offsetWidth / 2, behavior: 'smooth' });
}

// Petits utilitaires du classement
function h(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}
// Les trois dragons du mahjong servent de médailles : 中 rouge, 發 vert, 白 blanc (même dessin que les tuiles 3D)
const PODIUM_FACES = ['zr', 'zg', 'zw'];
const faceURLs = new Map();
function tileImg(face, cls = '') {
  if (!faceURLs.has(face)) faceURLs.set(face, drawFace(face).toDataURL());
  const img = new Image();
  img.src = faceURLs.get(face);
  img.alt = '';
  img.draggable = false;
  if (cls) img.className = cls;
  return img;
}
function boardEmpty(text) {
  const d = h('div', 'board-empty');
  d.append(tileImg('zw', 'be-tile'), h('p', null, text));
  return d;
}
// Indicateur glissant des sélecteurs (mode, difficulté, jour)
function syncSeg(box) {
  const a = box && box.querySelector('button.active');
  if (!a || box.classList.contains('hidden')) return;
  box.style.setProperty('--x', a.offsetLeft + 'px');
  box.style.setProperty('--w', a.offsetWidth + 'px');
}
// Les nombres du podium défilent jusqu'à leur valeur
function countUpIn(root, delay = 650) {
  const els = [...root.querySelectorAll('[data-count]')];
  const start = performance.now() + delay;
  const step = (now) => {
    const k = Math.min(1, Math.max(0, (now - start) / 900));
    const e = 1 - (1 - k) ** 3;
    for (const n of els) n.textContent = Math.round(+n.dataset.count * e);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderBoard() {
  const cat = BOARD.cat;
  const title = $('#board-title');
  title.innerHTML = '';
  const L = LAYOUTS[cat];
  const meta = cat === 'overview' ? ['Vue d’ensemble', 'layout-grid'] : cat === 'duel' ? ['Duels', 'swords'] : cat === 'daily' ? ['Défi du jour', 'calendar-days'] : [L.name, L.icon];
  title.append(icon(meta[1]), h('span', null, meta[0]));
  const smText = L
    ? L.desc
    : cat === 'daily'
      ? (() => { const ch = dailyChallenge(boardDay()); return `${LAYOUTS[ch.layout].name}, ${variantOf(ch.variant).name.toLowerCase()} · ${new Date(ch.date + 'T12:00:00Z').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}`; })()
      : cat === 'duel'
        ? `${LAYOUTS[BOARD.duelLayout] ? LAYOUTS[BOARD.duelLayout].name : 'Tous les plateaux'} · ${diffOf(BOARD.diff).name}`
        : 'Le champion de chaque plateau';
  title.appendChild(h('small', null, smText));
  $('#board-diff').classList.toggle('hidden', cat === 'daily');
  $('#board-duel-layout').classList.toggle('hidden', cat !== 'duel');
  $('#board-duel-layout').value = BOARD.duelLayout;
  $('#board-variant').classList.toggle('hidden', cat === 'duel' || cat === 'daily');
  $('#board-day').classList.toggle('hidden', cat !== 'daily');
  $$('#board-day button').forEach((x) => x.classList.toggle('active', x.dataset.day === BOARD.day));
  const overview = cat === 'overview';
  $('#board-overview').classList.toggle('hidden', !overview);
  $('#board-wrap').classList.toggle('hidden', overview);
  requestAnimationFrame(() => ['#board-variant', '#board-diff', '#board-day'].forEach((s) => syncSeg($(s))));
  if (!boardCache) {
    $('#board-wrap').classList.remove('hidden');
    $('#board-overview').classList.add('hidden');
    $('#board-podium').classList.add('hidden');
    $('#board-table').replaceChildren(boardEmpty(BOARD.error || 'Serveur injoignable.'));
    refreshIcons();
    return;
  }
  if (overview) renderOverview();
  else renderTable(cat === 'duel' || cat === 'daily' ? cat : catKey(cat, BOARD.diff), cat === 'duel');
  refreshIcons();
}

// Vue d'ensemble : une plaque par catégorie, avec son plateau et son podium
function renderOverview() {
  const box = $('#board-overview');
  box.innerHTML = '';
  const cats = [['daily', 'Défi du jour', 'calendar-days'], ...Object.entries(LAYOUTS).map(([k, L]) => [k, L.name, L.icon]), ['duel', 'Duels', 'swords']];
  cats.forEach(([key, name, ico], n) => {
    const list = key === 'duel' ? duelList('all') : key === 'daily' ? dailyList() : boardCache[catKey(key, BOARD.diff)] || [];
    const card = h('button', 'ov-card' + (key === 'daily' ? ' daily' : ''));
    card.style.setProperty('--i', n);
    card.onclick = () => { BOARD.cat = key; if (key === 'duel') BOARD.duelLayout = 'all'; buildBoardCats(); renderBoard(); };
    const head = h('div', 'ov-head');
    head.append(icon(ico), h('span', null, name));
    card.appendChild(head);
    const art = h('div', 'ov-art');
    if (key !== 'duel') {
      const cv = document.createElement('canvas');
      cv.width = 160;
      cv.height = 72;
      drawLayoutPreview(cv, LAYOUTS[key === 'daily' ? dailyChallenge(parisDate()).layout : key].positions);
      art.appendChild(cv);
    } else art.append(icon('swords'));
    card.appendChild(art);
    const podium = h('ol');
    if (!list.length) podium.appendChild(h('li', 'none', 'Aucun nom gravé'));
    list.slice(0, 3).forEach((e, i) => {
      const li = h('li', 'p' + (i + 1));
      li.append(tileImg(PODIUM_FACES[i], 'ov-tile'), h('span', null, e.pseudo), h('b', null, key === 'duel' ? `${e.wins} V` : e.score));
      podium.appendChild(li);
    });
    card.appendChild(podium);
    box.appendChild(card);
  });
}

// Une catégorie : podium des trois dragons, puis la liste des suivants
function renderTable(key, isDuel) {
  const podium = $('#board-podium');
  const box = $('#board-table');
  podium.innerHTML = '';
  box.innerHTML = '';
  const list = key === 'daily' ? dailyList() : key === 'duel' ? duelList() : boardCache[key] || [];
  const timed = key === 'daily' ? dailyChallenge(boardDay()).variant === 'timeattack' : BOARD.variant === 'timeattack';
  if (!list.length) {
    podium.classList.add('hidden');
    box.appendChild(boardEmpty(key === 'daily' && BOARD.day === 'today' ? 'Personne n’a encore relevé le défi du jour. À toi l’honneur !' : 'Aucun nom gravé ici pour l’instant. Sois le premier !'));
    return;
  }
  podium.classList.remove('hidden');
  const me = (S.pseudo || '').toLowerCase();
  const value = (e) => (isDuel ? e.wins : e.score);
  const detail = (e) => isDuel
    ? `${e.losses} défaite${e.losses > 1 ? 's' : ''} · ${Math.round((e.wins / Math.max(1, e.wins + e.losses)) * 100)} %${e.best ? ' · record ' + fmtTime(e.best) : ''}`
    : `${fmtTime(e.time)} · ${timed ? (e.remaining || 0) + ' restantes' : e.moves + ' coups'} · ${e.shuffles ?? 0} mélange${(e.shuffles ?? 0) > 1 ? 's' : ''}`;
  // ordre d'affichage : 2e, 1er, 3e ; ordre d'arrivée : 3e, 2e, puis le champion
  [1, 0, 2].forEach((i) => {
    const e = list[i];
    const slot = h('div', `pd pd${i + 1}${e ? '' : ' vacant'}${e && e.pseudo.toLowerCase() === me ? ' me' : ''}`);
    slot.style.setProperty('--d', [2, 1, 0][i]);
    const tile = h('div', 'pd-tile');
    tile.appendChild(tileImg(PODIUM_FACES[i]));
    const val = h('div', 'pd-val');
    if (e) {
      const b = h('b', null, '0');
      b.dataset.count = value(e);
      val.append(b, h('small', null, isDuel ? 'victoires' : 'points'));
    } else val.appendChild(h('small', null, 'Place libre'));
    const base = h('div', 'pd-base');
    base.appendChild(h('span', 'pd-rank', ['1er', '2e', '3e'][i]));
    slot.append(tile, h('div', 'pd-name', e ? e.pseudo : '—'), val, h('div', 'pd-sub', e ? detail(e) : ''), base);
    podium.appendChild(slot);
  });
  if (list.length > 3) {
    const head = h('div', 'rk-head');
    head.append(h('span', null, 'Rang'), h('span', null, 'Joueur'), h('span', null, isDuel ? 'Bilan' : 'Partie'), h('span', null, isDuel ? 'Victoires' : 'Score'));
    box.appendChild(head);
  }
  const top = Math.max(1, value(list[0]));
  list.slice(3).forEach((e, j) => {
    const mine = e.pseudo.toLowerCase() === me;
    const row = h('div', 'rk-row' + (mine ? ' me' : ''));
    row.style.setProperty('--i', Math.min(j, 14));
    row.style.setProperty('--p', Math.max(0.04, value(e) / top));
    const who = h('span', 'rk-who');
    who.appendChild(h('b', null, e.pseudo));
    if (mine) who.appendChild(h('em', null, 'Toi'));
    row.append(h('span', 'rk-rank', j + 4), who, h('span', 'rk-detail', detail(e)), h('span', 'rk-val', value(e)), h('i', 'rk-bar'));
    box.appendChild(row);
  });
  countUpIn(podium);
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
      duelWaiting(`Recherche d'un adversaire… (de préférence en ${LAYOUTS[msg.layout].name}${msg.difficulty && msg.difficulty !== 'normal' ? ', ' + diffOf(msg.difficulty).name : ''} ; sinon tu rejoins la partie d'un joueur qui attend)`);
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
function selectVariant(v, withSound) {
  S.menuVariant = VARIANTS_UI[v] ? v : 'classic';
  localStorage.setItem('mj_variant', S.menuVariant);
  $$('#variant-select button').forEach((b) => b.classList.toggle('active', b.dataset.variant === S.menuVariant));
  $('#variant-info').textContent = VARIANTS_UI[S.menuVariant].rules + '.';
  $('#difficulty-select').classList.toggle('muted', S.menuVariant === 'zen');
  $('#difficulty-select').title = S.menuVariant === 'zen' ? 'En Zen, tout est permis : la difficulté ne compte pas.' : '';
  if (withSound) { sound.init(); sound.select(); }
}

function selectDifficulty(diff, withSound) {
  S.difficulty = DIFFS[diff] ? diff : 'normal';
  localStorage.setItem('mj_difficulty', S.difficulty);
  $$('#difficulty-select button').forEach((b) => b.classList.toggle('active', b.dataset.diff === S.difficulty));
  const D = DIFFS[S.difficulty];
  $('#difficulty-info').textContent = D.rules + (D.mult > 1 ? ` · score ×${String(D.mult).replace('.', ',')}` : '') + '.';
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
    newGame(S.layout, (Math.random() * 2 ** 31) | 0, 'solo', S.difficulty, S.menuVariant);
  };
  $('#btn-daily').onclick = startDaily;
  $$('#variant-select button').forEach((b) => (b.onclick = () => selectVariant(b.dataset.variant, true)));
  selectVariant(S.menuVariant, false);
  $$('#board-variant button').forEach((b) => (b.onclick = () => { BOARD.variant = b.dataset.variant; buildBoardCats(); renderBoard(); }));
  $$('#board-day button').forEach((b) => (b.onclick = () => { BOARD.day = b.dataset.day; buildBoardCats(); renderBoard(); }));
  const duelSel = $('#board-duel-layout');
  duelSel.append(new Option('Tous les plateaux', 'all'), ...Object.entries(LAYOUTS).map(([k, L]) => new Option(L.name, k)));
  duelSel.onchange = () => { BOARD.duelLayout = duelSel.value; buildBoardCats(); renderBoard(); };
  $('#btn-duel').onclick = () => { sound.init(); openDuel(); };
  $('#btn-board').onclick = () => showBoard('overview', S.difficulty, S.menuVariant);
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
  $('#t-quit').onclick = () => (S.mode === 'duel' ? quitGame() : confirmQuitSolo() && showMenu());

  // modales en jeu
  $('#s-shuffle').onclick = doShuffle;
  $('#s-undo').onclick = doUndo;
  $('#s-quit').onclick = () => (S.mode === 'solo' ? soloDefeat() : quitGame());
  $('#p-resume').onclick = () => togglePause(false);
  $('#p-restart').onclick = () => { if (S.daily) return; S.paused = false; newGame(S.layout, S.seed, 'solo', S.diff, S.variant); };
  $('#p-quit').onclick = () => { if (!confirmQuitSolo()) return; S.paused = false; showMenu(); };

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
      updateClock();
      if (S.run && S.run.timed) {
        // Contre la montre : tic-tac sur les 10 dernières secondes, puis fin de partie
        const left = S.run.timeLeft(clock());
        const sec = Math.ceil(left / 1000);
        if (sec > 0 && sec <= 10 && sec !== S.lastBeep) { S.lastBeep = sec; sound.tick(); }
        if (left <= 0) timeUp();
      }
      if (S.combo > 1 && S.run && clock() - S.run.lastMatch > COMBO_WINDOW) {
        S.combo = 0;
        $('#h-combo').textContent = '';
      }
    }
  }, 200);
}

// Chaque panneau reçoit sa crête de muraille (créneaux), ses quatre ferrures d'angle dorées
// et un reflet de lumière qui balaie la laque
function decoratePanels() {
  for (const card of $$('.menu-card, .modal-card')) {
    if (card.querySelector(':scope > .jf')) continue;
    card.prepend(h('span', 'crest'));
    for (const c of ['tl', 'tr', 'bl', 'br']) card.appendChild(h('span', 'jf ' + c));
    card.appendChild(h('span', 'jsheen'));
  }
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
  decoratePanels();
  showMenu(false); // plateau de démonstration en fond, menu encore caché
  sound.prepare(); // graphe audio prêt avant le coup de gong (sinon le clic fige l'image)
  step('Forge des portes du palais…');
  await scene.startGate(); // la porte 3D, rendue par le même renderer que le temple
  step('Allumage des lanternes…');
  await scene.warmup(); // shaders compilés + premières images dessinées : plus d'écran uni
  clearTimeout(window.mjLoadTimer);

  // Porte du palais : on frappe le gong (ce clic autorise aussi le son, règle des navigateurs).
  // Le gong ondule, les battants s'ouvrent, la caméra franchit le seuil et arrive sur le menu.
  const loader = $('#loader');
  loader.classList.add('ready');
  const enter = () => {
    if (loader.classList.contains('struck')) return;
    loader.classList.add('struck');
    removeEventListener('keydown', onKey);
    sound.init();
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // le coup part tout de suite ; le son suit dès qu'il est décodé (en général déjà fait,
    // le décodage démarre à l'appui du pointeur), et on l'abandonne s'il arrive trop tard
    const hitAt = performance.now();
    sound.samplesReady.then(() => { if (performance.now() - hitAt < 600) sound.sample('gong-grand', { vol: 0.9 }); });
    const entered = scene.gate ? scene.gate.strike({ calm }) : Promise.resolve();
    entered.then(() => {
      $('#menu').classList.remove('hidden');
      loader.classList.add('fade');
      setTimeout(() => loader.remove(), 700);
      const code = new URLSearchParams(location.search).get('duel');
      if (code) openDuel(code.toUpperCase().slice(0, 4));
    });
  };
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') enter(); };
  loader.addEventListener('click', enter); // frapper n'importe où sur la porte
  loader.style.cursor = 'pointer';
  addEventListener('keydown', onKey);
  $('#enter-btn').focus();
}

init().catch((e) => {
  console.error(e);
  window.mjLoadFailed && window.mjLoadFailed('Erreur au démarrage : ' + e.message);
});
