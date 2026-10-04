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
// Safe helpers — never throw on a missing element, so a stale HTML/JS skew
// degrades gracefully instead of blanking the whole page.
const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
const setText = (sel, t) => { const el = $(sel); if (el) el.textContent = t; };

const screens = {
  home: $('#screen-home'),
  countdown: $('#screen-countdown'),
  play: $('#screen-play'),
  results: $('#screen-results'),
};
const show = (name) =>
  Object.entries(screens).forEach(([k, el]) => el && el.classList.toggle('active', k === name));

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
  countdownActive: false,
  endAt: 0,
  tickId: null,
  wakeLock: null,
  motion: 'unknown',
};

const tilt = new TiltReader();
tilt.onTilt = (kind) => { if (state.roundActive) scoreCard(kind); };
tilt.onSample = (delta) => {
  const d = $('#debug');
  if (d && !d.hidden) setText('#debug-delta', delta.toFixed(2));
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
  if (!container) return;
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
  setText('#settings-summary', `${state.cardsPerRound} cards / round`);
  setText('#play-timer', String(state.seconds));
}

// ---- card / round ----------------------------------------------------------
function renderCard() {
  const c = state.cards[state.idx];
  const img = $('#card-img');
  const word = $('#card-word');
  if (!c) { if (img) img.style.display = 'none'; if (word) { word.textContent = ''; word.style.display = 'none'; } return; }
  if (c.image) {
    word.style.display = 'none';
    img.style.display = '';
    img.alt = c.word;
    // if the image 404s between warm-cache and render, fall back to the word
    img.onerror = () => { img.style.display = 'none'; word.textContent = c.word; word.style.display = ''; };
    img.src = c.image;
  } else {
    img.removeAttribute('src');
    img.style.display = 'none';
    word.textContent = c.word;
    word.style.display = '';
  }
}

function flash(kind) {
  const f = $('#feedback');
  if (!f) return;
  f.classList.remove('correct', 'pass');
  void f.offsetWidth;
  f.classList.add(kind);
}

function scoreCard(kind) {
  const card = state.cards[state.idx];
  if (!card) return;
  if (kind === 'correct') {
    // Remove it from rotation so a guessed card can't be scored twice — the
    // round clears only when the pool is genuinely empty (unique cards).
    state.correct.push(card.word);
    state.cards.splice(state.idx, 1);
    setText('#play-score', String(state.correct.length));
    flash('correct');
    if (state.cards.length === 0) { endRound('cleared'); return; }
    if (state.idx >= state.cards.length) state.idx = 0;
    renderCard();
  } else {
    state.passed.push(card.word);
    flash('pass');
    state.idx = (state.idx + 1) % state.cards.length;
    renderCard();
  }
}

function sample(arr, n) {
  const c = arr.slice();
  shuffle(c);
  return c.slice(0, Math.max(1, Math.min(n, c.length)));
}

function resetRound() {
  state.cards = sample(state.deckCards, state.cardsPerRound); // remaining pool
  state.idx = 0;
  state.correct = [];
  state.passed = [];
  setText('#play-score', '0');
  renderCard();
}

function startRound() {
  show('play');
  state.roundActive = true;
  state.endAt = performance.now() + state.seconds * 1000;
  tick();
  state.tickId = setInterval(tick, 200);
  acquireWakeLock();
}

function tick() {
  const rem = Math.max(0, Math.ceil((state.endAt - performance.now()) / 1000));
  setText('#play-timer', String(rem));
  if (rem <= 0) endRound('time');
}

function endRound(reason) {
  if (!state.roundActive) return;
  state.roundActive = false;
  clearInterval(state.tickId);
  state.tickId = null;
  releaseWakeLock();
  setText('#results-title', reason === 'cleared' ? 'Cleared!' : 'Time!');
  renderResults();
  show('results');
}

function renderResults() {
  setText('#results-score', String(state.correct.length));
  const fill = (ul, arr) => {
    if (!ul) return;
    ul.innerHTML = '';
    const uniq = [...new Set(arr)];
    if (!uniq.length) { const li = document.createElement('li'); li.textContent = '\u2014'; ul.appendChild(li); return; }
    uniq.forEach((w) => { const li = document.createElement('li'); li.textContent = w; ul.appendChild(li); });
  };
  fill($('#list-correct'), state.correct);
  fill($('#list-passed'), state.passed);
}

function runCountdown() {
  if (state.countdownActive) return; // ignore re-entrant Start / Play-again
  state.countdownActive = true;
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
  if (el) el.textContent = String(n);
  const id = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(id);
      if (el) el.textContent = 'GO';
      calibrating.then(() => setTimeout(() => { state.countdownActive = false; startRound(); }, 200));
      return;
    }
    if (el) el.textContent = String(n);
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
on('#btn-fs', 'click', (e) => { e.stopPropagation(); toggleFullscreen(); });
on('#btn-fs-home', 'click', () => toggleFullscreen());

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
on('#btn-start', 'click', async () => {
  if (state.countdownActive || state.roundActive) return;
  const btn = $('#btn-start');
  btn.disabled = true;
  const original = btn.textContent;
  try {
    // permission MUST be requested inside this user gesture (iOS)
    const perm = await requestMotionPermission();
    state.motion = perm;
    setText('#debug-motion', perm);
    toggleFullscreen(true); // hide browser chrome (no-op on iOS Safari)

    const meta = DECKS.find((d) => d.id === state.deckId) || DECKS[0];
    btn.textContent = 'Loading\u2026';
    const deck = await loadDeck(meta.url);
    await precacheDeck(deck, (d, t) => { btn.textContent = `Caching ${d}/${t}\u2026`; });
    state.deckCards = deck.cards.slice();

    setText('#motion-status', perm === 'granted'
      ? ''
      : (needsMotionPermission() ? 'Motion access not granted — tap-to-score fallback active.' : ''));
    runCountdown();
  } catch (err) {
    alert('Could not start: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
});

on('#btn-end', 'click', (e) => { e.stopPropagation(); endRound('time'); });
// in-game: re-zero the tilt baseline without leaving the round
on('#btn-zero', 'click', async (e) => {
  e.stopPropagation();
  tilt.start();
  await tilt.calibrate(600);
});
on('#btn-tune', 'click', (e) => { e.stopPropagation(); const d = $('#debug'); if (d) d.hidden = !d.hidden; });
on('#btn-again', 'click', () => { runCountdown(); });
on('#btn-home', 'click', () => {
  state.roundActive = false;
  tilt.stop();
  releaseWakeLock();
  renderHome();
  show('home');
});

// desktop / fallback: arrows simulate tilt
document.addEventListener('keydown', (e) => {
  if (!state.roundActive) return;
  if (e.key === 'ArrowUp') { e.preventDefault(); scoreCard('correct'); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); scoreCard('pass'); }
});

// ---- debug HUD -------------------------------------------------------------
on('#btn-debug', 'click', () => { const d = $('#debug'); if (d) d.hidden = !d.hidden; });
// settings panel (home)
on('#btn-settings', 'click', () => { renderHome(); const s = $('#settings'); if (s) s.hidden = !s.hidden; });
on('#btn-settings-close', 'click', () => { const s = $('#settings'); if (s) s.hidden = true; });
on('#debug-invert', 'change', (e) => { tilt.invert = e.target.checked; });
on('#debug-threshold', 'input', (e) => {
  tilt.threshold = Number(e.target.value);
  setText('#debug-thresh', e.target.value);
});
on('#debug-rezero', 'click', async (e) => {
  e.stopPropagation();
  const b = e.currentTarget;
  tilt.start();
  b.textContent = 'Hold still\u2026';
  await tilt.calibrate(700);
  b.textContent = 'Set neutral';
  setText('#debug-delta', '0.00');
});
setText('#debug-thresh', String(tilt.threshold));

// ---- install / PWA ---------------------------------------------------------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  const b = $('#btn-install'); if (b) b.hidden = false;
});
on('#btn-install', 'click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  const b = $('#btn-install'); if (b) b.hidden = true;
});

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
const standalone = navigator.standalone || window.matchMedia('(display-mode: standalone)').matches;
if (isIOS && !standalone) { const h = $('#ios-hint'); if (h) h.hidden = false; }

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// ---- init ------------------------------------------------------------------
state.cardsPerRound = store.get('cardsPerRound', 7);
if (!CARDS.includes(state.cardsPerRound)) state.cardsPerRound = 7;
renderHome();
const thrEl = $('#debug-threshold'); if (thrEl) thrEl.value = String(tilt.threshold);
setText('#debug-motion', needsMotionPermission() ? 'needs grant' : 'open');
