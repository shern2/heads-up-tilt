// Tilt reader — signed out-of-plane angle of gravity vs the screen plane.
//
// Why this signal: at the forehead-neutral pose the screen is vertical, so the
// "screen-up" projection of gravity sits at its extremum — tilting either
// direction decreases it, which makes forward and back indistinguishable (both
// read positive). Instead we measure the angle between gravity and the SCREEN
// PLANE: atan2(g.z, hypot(g.x,g.y)). That is ~0 at neutral, linear near it, and
// ANTISYMMETRIC in the nod angle — forward and back give opposite signs. It is
// also independent of UI rotation (the screen normal is the device z-axis
// whatever the orientation), so no landscape axis-picking and no gimbal lock.
//
// Units: degrees. threshold/release are tilt angles.

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

export class TiltReader {
  constructor(opts = {}) {
    this.threshold = opts.threshold ?? 30;   // deg to fire
    this.release   = opts.release   ?? 12;   // deg to re-arm
    this.cooldown  = opts.cooldown  ?? 350;  // ms between flips
    this.smoothing = opts.smoothing ?? 0.25; // low-pass factor
    this.invert    = opts.invert    ?? false; // flips correct/pass mapping

    this.baseline = null;
    this.smooth = null;
    this.armed = true;
    this.lastFire = 0;
    this.lastDelta = 0;
    this.onTilt = null;    // (kind:'correct'|'pass', deltaDeg)
    this.onSample = null;  // (deltaDeg, smoothedDeg) for the debug HUD
    this._samples = null;
    this._bound = this._onMotion.bind(this);
    this.running = false;
  }

  _read(e) {
    const g = e.accelerationIncludingGravity || e.acceleration;
    if (!g || g.x == null) return null;
    const inPlane = Math.hypot(g.x, g.y);
    // Negated so that tilting the top edge forward/down (screen toward the
    // floor) is + and reads as 'correct'; tilting back (screen toward the sky)
    // is - and reads as 'pass'.
    return -Math.atan2(g.z || 0, inPlane) * 180 / Math.PI;
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
