import { test, expect } from '@playwright/test';

// Pure mapping of gravity -> tilt angle (degrees). Deterministic, no timers.
test('tilt math: vertical ~0, flat +/-90, distinct forward/back signs', async ({ page }) => {
  await page.goto('/index.html');
  const r = await page.evaluate(async () => {
    const { TiltReader } = await import('/tilt.js');
    const t = new TiltReader();
    const read = (x, y, z) => {
      const v = Math.round(t._read({ accelerationIncludingGravity: { x, y, z }, acceleration: { x: 0, y: 0, z: 0 } }));
      return v === 0 ? 0 : v; // normalise -0 to 0
    };
    return {
      vertical: read(0, 9.8, 0),   // screen plane contains gravity
      flatUp: read(0, 0, 9.8),     // screen facing sky
      flatDown: read(0, 0, -9.8),  // screen facing floor
      forward: read(0, 9.0, -5.2), // top edge forward/down
      back: read(0, 9.0, 5.2),     // top edge back/up
    };
  });

  expect(r.vertical).toBe(0);
  expect(r.flatUp).toBe(-90);
  expect(r.flatDown).toBe(90);
  // forward and back must be OPPOSITE signs — the bug that made both read green
  expect(r.forward).toBeGreaterThan(0);
  expect(r.back).toBeLessThan(0);
  expect(Math.sign(r.forward)).not.toBe(Math.sign(r.back));
});

test('tilt fires correct then pass after calibration', async ({ page }) => {
  await page.goto('/index.html');
  const fired = await page.evaluate(async () => {
    const { TiltReader } = await import('/tilt.js');
    const t = new TiltReader({ threshold: 20, release: 8, smoothing: 1, cooldown: 0 });
    const fire = (x, y, z) => {
      const e = new Event('devicemotion');
      e.accelerationIncludingGravity = { x, y, z };
      e.acceleration = { x: 0, y: 0, z: 0 };
      window.dispatchEvent(e);
    };

    const out = [];
    t.start();
    const cal = t.calibrate(200);
    const iv = setInterval(() => fire(0, 9.8, 0), 10); // hold neutral during calibration
    await cal;
    clearInterval(iv);

    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    t.onTilt = (kind) => out.push(kind);
    for (let i = 0; i < 20; i++) fire(0, 8.8, -5.5);  // forward/down -> correct
    await wait(50);                                   // let the cooldown clear
    for (let i = 0; i < 40; i++) fire(0, 9.8, 0);     // return to neutral to re-arm
    await wait(50);
    for (let i = 0; i < 20; i++) fire(0, 8.8, 5.5);   // back/up -> pass
    return out;
  });

  expect(fired).toContain('correct');
  expect(fired).toContain('pass');
});
