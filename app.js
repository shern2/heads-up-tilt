import { loadDeck, precacheDeck } from './deck.js';
import { requestMotionPermission, needsMotionPermission, TiltReader } from './tilt.js';

const DECKS = [
  { id: 'animals', name: 'Animals', url: 'decks/animals.json' },
];
const TIMES = [40, 70, 100];

const $ = (s) => document.querySelector(s);
const screens = {
  home: $('#screen-home'),
  calibrate: $('#screen-calibrate'),
  countdown: $('#screen-countdown'),
  play: $('#screen-play'),
  results: $('#screen-results'),
};
const show = (name) =>
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('active', k === name));

const state = {
  deckId: 'animals',
  seconds: 40,
  cards: [],
  idx: 0,
  score: 0,
  correct: [],
  passed: [],
  roundActive: false,
  endAt: 0,
  tickId: null,
  wakeLock: null,
  motion: 'unknown',
};

const tilt = new TiltReader();
tilt.onTilt = (kind) => { if (state.roundActive) scoreCard(kind); };
tilt.onSample = (delta) => {
  const d = $('#debug');
  if (d && !d.hidden) $('#debug-delta').textContent = delta.toFixed(2);
};

// ---- helpers ---------------------------------------------------------------
const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

function buildPills(container, items, isOn, onPick, label) {
  container.innerHTML = '';
  items.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'pill' + (isOn(it) ? ' on' : '');
    b.textContent = label(it);
    b.addEventListener('click', () => onPick(it));
    container.appendChild(b);
  });
}

function renderHome() {
  buildPills($('#deck-options'), DECKS, (d) => d.id === state.deckId,
    (d) => { state.deckId = d.id; renderHome(); }, (d) => d.name);
  buildPills($('#time-options'), TIMES, (t) => t === state.seconds,
    (t) => { state.seconds = t; renderHome(); }, (t) => `${t}s`);
  $('#play-timer').textContent = state.seconds;
}

// ---- card / round ----------------------------------------------------------
function renderCard() {
  const c = state.cards[state.idx];
  const img = $('#card-img');
  if (c.image) { img.src = c.image; img.style.display = ''; }
  else { img.removeAttribute('src'); img.style.display = 'none'; }
  $('#card-word').textContent = c.word;
}

function nextCard() {
  state.idx++;
  if (state.idx >= state.cards.length) { shuffle(state.cards); state.idx = 0; }
  renderCard();
}

function flash(kind) {
  const f = $('#feedback');
  f.classList.remove('correct', 'pass');
  void f.offsetWidth;
  f.classList.add(kind);
}

function scoreCard(kind) {
  const card = state.cards[state.idx];
  if (!card) return;
  if (kind === 'correct') { state.score++; state.correct.push(card.word); }
  else { state.passed.push(card.word); }
  $('#play-score').textContent = state.score;
  flash(kind);
  nextCard();
}

function resetRound() {
  shuffle(state.cards);
  state.idx = 0;
  state.score = 0;
  state.correct = [];
  state.passed = [];
  $('#play-score').textContent = '0';
  renderCard();
}

function startRound() {
  state.roundActive = true;
  $('#play-overlay').hidden = true;
  state.endAt = performance.now() + state.seconds * 1000;
  tick();
  state.tickId = setInterval(tick, 200);
  acquireWakeLock();
}

function tick() {
  const rem = Math.max(0, Math.ceil((state.endAt - performance.now()) / 1000));
  $('#play-timer').textContent = rem;
  if (rem <= 0) endRound();
}

function endRound() {
  if (!state.roundActive) return;
  state.roundActive = false;
  clearInterval(state.tickId);
  state.tickId = null;
  releaseWakeLock();
  renderResults();
  show('results');
}

function renderResults() {
  $('#results-score').textContent = state.score;
  const fill = (ul, arr) => {
    ul.innerHTML = '';
    if (!arr.length) { const li = document.createElement('li'); li.textContent = '—'; ul.appendChild(li); return; }
    arr.forEach((w) => { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
  };
  fill($('#list-correct'), state.correct);
  fill($('#list-passed'), state.passed);
}

function runCountdown() {
  resetRound();
  const el = $('#countdown');
  let n = 3;
  el.textContent = String(n);
  const id = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(id);
      el.textContent = 'GO';
      setTimeout(() => { show('play'); $('#play-overlay').hidden = false; }, 350);
      return;
    }
    el.textContent = String(n);
  }, 700);
}

// ---- wake lock -------------------------------------------------------------
async function acquireWakeLock() {
  try { if ('wakeLock' in navigator) state.wakeLock = await navigator.wakeLock.request('screen'); }
  catch { /* unsupported or denied — non-fatal */ }
}
function releaseWakeLock() {
  try { state.wakeLock && state.wakeLock.release(); } catch {}
  state.wakeLock = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.roundActive) acquireWakeLock();
});

// ---- flow ------------------------------------------------------------------
$('#btn-start').addEventListener('click', async () => {
  const btn = $('#btn-start');
  btn.disabled = true;
  const original = btn.textContent;
  try {
    // permission MUST be requested inside this user gesture (iOS)
    const perm = await requestMotionPermission();
    state.motion = perm;
    $('#debug-motion').textContent = perm;

    const meta = DECKS.find((d) => d.id === state.deckId);
    btn.textContent = 'Loading\u2026';
    const deck = await loadDeck(meta.url);
    await precacheDeck(deck, (d, t) => { btn.textContent = `Caching ${d}/${t}\u2026`; });
    state.cards = deck.cards.slice();

    $('#motion-status').textContent = perm === 'granted'
      ? ''
      : (needsMotionPermission() ? 'Motion access not granted — tap-to-score fallback active.' : '');
    show('calibrate');
  } catch (err) {
    alert('Could not start: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('#btn-calibrate').addEventListener('click', async () => {
  const b = $('#btn-calibrate');
  b.disabled = true;
  b.textContent = 'Hold still\u2026';
  tilt.start();
  await tilt.calibrate(900);
  b.disabled = false;
  b.textContent = 'Ready';
  show('countdown');
  runCountdown();
});

$('#btn-end').addEventListener('click', (e) => { e.stopPropagation(); endRound(); });
$('#play-overlay').addEventListener('click', startRound);
$('#btn-again').addEventListener('click', () => { show('countdown'); runCountdown(); });
$('#btn-home').addEventListener('click', () => { renderHome(); show('home'); });

// desktop / fallback: arrows simulate tilt
document.addEventListener('keydown', (e) => {
  if (!state.roundActive) return;
  if (e.key === 'ArrowUp') { e.preventDefault(); scoreCard('correct'); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); scoreCard('pass'); }
});

// ---- debug HUD -------------------------------------------------------------
$('#btn-debug').addEventListener('click', () => { $('#debug').hidden = !$('#debug').hidden; });
$('#debug-invert').addEventListener('change', (e) => { tilt.invert = e.target.checked; });
$('#debug-threshold').addEventListener('input', (e) => { tilt.threshold = Number(e.target.value); });

// ---- install / PWA ---------------------------------------------------------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('#btn-install').hidden = false;
});
$('#btn-install').addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  $('#btn-install').hidden = true;
});

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
if (isIOS && !standalone) $('#ios-hint').hidden = false;

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ---- init ------------------------------------------------------------------
renderHome();
$('#debug-motion').textContent = needsMotionPermission() ? 'needs grant' : 'open';
