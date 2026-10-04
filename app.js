import { loadDeck, precacheDeck } from './deck.js';
import { requestMotionPermission, needsMotionPermission, TiltReader } from './tilt.js';

const DECKS = [
  { id: 'animals', name: 'Animals', url: 'decks/animals.json' },
  { id: 'actions', name: 'Actions', url: 'decks/actions.json' },
  { id: 'food',    name: 'Food & Drink', url: 'decks/food.json' },
];
const TIMES = [40, 70, 100];
const CARDS = [5, 7, 10, 15]; // cards-per-round options

const $ = (s) => document.querySelector(s);
const screens = {
  home: $('#screen-home'),
  countdown: $('#screen-countdown'),
  play: $('#screen-play'),
  results: $('#screen-results'),
};
const show = (name) =>
  Object.entries(screens).forEach(([k, el]) => el.classList.toggle('active', k === name));

const state = {
  deckId: 'animals',
  seconds: 40,
  cardsPerRound: 7,
  deckCards: [], // full deck
  cards: [],     // this round's sample
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

const store = {
  get(k, d) { try { const v = localStorage.getItem('hut.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('hut.' + k, JSON.stringify(v)); } catch {} },
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
  buildPills($('#cards-options'), CARDS, (c) => c === state.cardsPerRound,
    (c) => { state.cardsPerRound = c; store.set('cardsPerRound', c); renderHome(); }, (c) => String(c));
  $('#settings-summary').textContent = `${state.cardsPerRound} cards / round`;
  $('#play-timer').textContent = state.seconds;
}

// ---- card / round ----------------------------------------------------------
function renderCard() {
  const c = state.cards[state.idx];
  const img = $('#card-img');
  const word = $('#card-word');
  // One thing on screen: the image if the card has one (it carries the word),
  // otherwise the word alone. No redundant duplicate line.
  if (c.image) { img.src = c.image; img.style.display = ''; word.style.display = 'none'; }
  else { img.removeAttribute('src'); img.style.display = 'none'; word.textContent = c.word; word.style.display = ''; }
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
  // Stop as soon as every card in the round has been guessed correctly.
  if (kind === 'correct' && state.score >= state.cards.length) { endRound('cleared'); return; }
  nextCard();
}

function sample(arr, n) {
  const c = arr.slice();
  shuffle(c);
  return c.slice(0, Math.max(1, Math.min(n, c.length)));
}

function resetRound() {
  state.cards = sample(state.deckCards, state.cardsPerRound);
  state.idx = 0;
  state.score = 0;
  state.correct = [];
  state.passed = [];
  $('#play-score').textContent = '0';
  renderCard();
}

function startRound() {
  state.roundActive = true;
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

function endRound(reason) {
  if (!state.roundActive) return;
  state.roundActive = false;
  clearInterval(state.tickId);
  state.tickId = null;
  releaseWakeLock();
  $('#results-title').textContent = reason === 'cleared' ? 'Cleared!' : 'Time!';
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
  show('countdown');
  const el = $('#countdown');
  tilt.start();
  // Capture the baseline in the final half-second of the countdown, so it
  // reflects the pose the player is actually holding at GO (not an earlier one).
  const calibrating = new Promise((resolve) => {
    setTimeout(async () => { await tilt.calibrate(500); resolve(); }, 1600);
  });
  let n = 3;
  el.textContent = String(n);
  const id = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(id);
      el.textContent = 'GO';
      calibrating.then(() => setTimeout(startRound, 200));
      return;
    }
    el.textContent = String(n);
  }, 700);
}

// ---- fullscreen ------------------------------------------------------------
async function toggleFullscreen(force) {
  const el = document.documentElement;
  try {
    const wantOn = force !== undefined ? force : !document.fullscreenElement;
    if (wantOn && !document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
      // best-effort: lock landscape once fullscreen (Android)
      try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch {}
    } else if (!wantOn && document.fullscreenElement && document.exitFullscreen) {
      await document.exitFullscreen();
    }
  } catch { /* iOS Safari: no Fullscreen API — install to Home Screen instead */ }
}
function syncFsButtons() {
  const home = $('#btn-fs-home');
  if (home) home.textContent = '\u26F6 Fullscreen';
  const f = $('#btn-fs');
  if (f) f.textContent = '\u26F6';   // stays a fullscreen icon — never an 'x'
  document.documentElement.classList.toggle('is-fullscreen', !!document.fullscreenElement);
}
document.addEventListener('fullscreenchange', syncFsButtons);
$('#btn-fs').addEventListener('click', (e) => { e.stopPropagation(); toggleFullscreen(); });
$('#btn-fs-home').addEventListener('click', () => toggleFullscreen());

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
    toggleFullscreen(true); // hide browser chrome (no-op on iOS Safari)

    const meta = DECKS.find((d) => d.id === state.deckId);
    btn.textContent = 'Loading\u2026';
    const deck = await loadDeck(meta.url);
    await precacheDeck(deck, (d, t) => { btn.textContent = `Caching ${d}/${t}\u2026`; });
    state.deckCards = deck.cards.slice();

    $('#motion-status').textContent = perm === 'granted'
      ? ''
      : (needsMotionPermission() ? 'Motion access not granted — tap-to-score fallback active.' : '');
    runCountdown();
  } catch (err) {
    alert('Could not start: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

$('#btn-end').addEventListener('click', (e) => { e.stopPropagation(); endRound('time'); });
// in-game: re-zero the tilt baseline without leaving the round
$('#btn-zero').addEventListener('click', async (e) => {
  e.stopPropagation();
  tilt.start();
  await tilt.calibrate(600);
});
$('#btn-tune').addEventListener('click', (e) => { e.stopPropagation(); $('#debug').hidden = !$('#debug').hidden; });
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
// settings panel (home)
$('#btn-settings').addEventListener('click', () => { renderHome(); $('#settings').hidden = !$('#settings').hidden; });
$('#btn-settings-close').addEventListener('click', () => { $('#settings').hidden = true; });
$('#debug-invert').addEventListener('change', (e) => { tilt.invert = e.target.checked; });
$('#debug-threshold').addEventListener('input', (e) => {
  tilt.threshold = Number(e.target.value);
  $('#debug-thresh').textContent = e.target.value;
});
$('#debug-rezero').addEventListener('click', async (e) => {
  e.stopPropagation();
  const b = e.currentTarget;
  tilt.start();
  b.textContent = 'Hold still\u2026';
  await tilt.calibrate(700);
  b.textContent = 'Set neutral';
  $('#debug-delta').textContent = '0.00';
});
$('#debug-thresh').textContent = String(tilt.threshold);

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
state.cardsPerRound = store.get('cardsPerRound', 7);
renderHome();
$('#debug-threshold').value = String(tilt.threshold);
$('#debug-motion').textContent = needsMotionPermission() ? 'needs grant' : 'open';
