// Tilt reader — derives a single screen-relative pitch scalar from gravity.
//
// Why devicemotion (accelerationIncludingGravity) instead of deviceorientation
// beta/gamma: Euler angles gimbal-lock around gamma = +/-90 (exactly where a
// phone sits in landscape on a forehead). The gravity vector has no such
// singularity, so we project it onto the screen's "up" axis and threshold the
// delta from a calibrated neutral. Orientation-agnostic and gimbal-free.

// ---- iOS permission (must be called from a user gesture) -------------------
export function needsMotionPermission() {
  return typeof DeviceMotionEvent !== 'undefined' &&
         typeof DeviceMotionEvent.requestPermission === 'function';
}

export async function requestMotionPermission() {
  if (!needsMotionPermission()) return 'granted';
  try { return await DeviceMotionEvent.requestPermission(); }
  catch { return 'denied'; }
}

// ---- Which device axis points "up" on screen, per rotation angle -----------
function screenUpAxis(angle) {
  switch ((((angle % 360) + 360) % 360)) {
    case 90:  return [-1, 0, 0];
    case 180: return [0, -1, 0];
    case 270: return [1, 0, 0];
    default:  return [0, 1, 0]; // 0 / portrait
  }
}

function currentAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return window.orientation || 0;
}

export class TiltReader {
  constructor(opts = {}) {
    // threshold/release are in m/s^2 of gravity projected along screen-up.
    // 3.0 m/s^2 ~= 18 deg of tilt; 1.2 ~= 7 deg re-arm.
    this.threshold = opts.threshold ?? 3.0;
    this.release   = opts.release   ?? 1.2;
    this.cooldown  = opts.cooldown  ?? 350;   // ms between flips
    this.smoothing = opts.smoothing ?? 0.3;   // low-pass factor
    this.invert    = opts.invert    ?? false; // flips correct/pass mapping

    this.baseline = null;
    this.smooth = null;
    this.armed = true;
    this.lastFire = 0;
    this.lastDelta = 0;
    this.onTilt = null;    // (kind:'correct'|'pass', delta)
    this.onSample = null;  // (delta, smoothed) for the debug HUD
    this._samples = null;
    this._bound = this._onMotion.bind(this);
    this.running = false;
  }

  _read(e) {
    const g = e.accelerationIncludingGravity || e.acceleration;
    if (!g || g.x == null) return null;
    const [ux, uy, uz] = screenUpAxis(currentAngle());
    return g.x * ux + g.y * uy + g.z * uz;
  }

  _onMotion(e) {
    const raw = this._read(e);
    if (raw == null) return;
    if (this._samples) { this._samples.push(raw); return; }

    const v = this.invert ? -raw : raw;
    if (this.smooth == null) this.smooth = v;
    this.smooth += this.smoothing * (v - this.smooth);
    if (this.baseline == null) return;

    const delta = this.smooth - this.baseline;
    this.lastDelta = delta;
    if (this.onSample) this.onSample(delta, this.smooth);

    const now = performance.now();
    if (this.armed) {
      if (delta > this.threshold) this._fire('correct', now);
      else if (delta < -this.threshold) this._fire('pass', now);
    } else if (Math.abs(delta) < this.release && now - this.lastFire > this.cooldown) {
      this.armed = true;
    }
  }

  _fire(kind, now) {
    this.armed = false;
    this.lastFire = now;
    if (this.onTilt) this.onTilt(kind, this.lastDelta);
  }

  // Capture a neutral baseline (median of samples over `ms`). Call while still.
  async calibrate(ms = 900) {
    this._samples = [];
    await new Promise(r => setTimeout(r, ms));
    const s = this._samples; this._samples = null;
    if (!s || !s.length) { this.baseline = null; return null; }
    s.sort((a, b) => a - b);
    const med = s[Math.floor(s.length / 2)];
    this.baseline = this.invert ? -med : med;
    this.smooth = this.baseline;
    this.armed = true;
    return this.baseline;
  }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('devicemotion', this._bound);
  }

  stop() {
    this.running = false;
    window.removeEventListener('devicemotion', this._bound);
  }
}
