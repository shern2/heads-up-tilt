# Heads Up Tilt

A tilt-driven, pass-the-phone party game. One static PWA for iOS + Android, no build step, no backend.

Hold the phone flat against your forehead, screen facing out. Tilt **forward** = correct, tilt **back** = pass. Tap to start/stop a round.

## Run locally

ES modules need HTTP (not `file://`):

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

On desktop there is no motion sensor, so use the keyboard: **↑** = correct, **↓** = pass. Open the ⚙ HUD to tune threshold/invert.

## Deploy

Static files hosted on GitHub Pages (HTTPS is required for the motion sensor).

## Deck format

`decks/<name>.json`:

```json
{
  "name": "Animals",
  "cards": [
    { "word": "Elephant", "image": "assets/cards/elephant.svg" }
  ]
}
```

`image` is optional; a card without it renders text-only. Images are pre-cached (fetch + decode) before a round, so gameplay never stalls on a decode.

## How tilt works

`tilt.js` reads `devicemotion.accelerationIncludingGravity` and measures the signed angle between gravity and the **screen plane**: `atan2(g.z, hypot(g.x, g.y))`, in degrees. At the forehead-neutral pose this is ~0 and antisymmetric in the nod angle, so forward and back give opposite signs (projecting onto screen-up fails here — it sits at an extremum, making both directions look the same). It is independent of UI rotation and gimbal-free. A low-pass filter plus threshold hysteresis and a per-flip cooldown kill double-fires. A neutral baseline is captured once per session on the calibrate screen.

- **iOS Safari / PWA**: `DeviceMotionEvent.requestPermission()` is requested from the Start tap (required). HTTPS required.
- **Android Chrome**: no prompt.

## Testing

Playwright (Chromium), driven by `python3 -m http.server` via the config's `webServer`:

```sh
npm install
npx playwright install chromium
npm test
```

Covers: home render + deck/hand options, the no-blank-on-skew guarantee, the settings panel (cards per round, persisted), the countdown → play flow, keyboard scoring, stop-on-clear, end/Play again/Home, deck shape (Animals/Food with images, Actions word-only), and the tilt math itself (vertical ≈ 0, flat = ±90, forward/back give opposite signs; plus a calibration + fire test using synthetic `devicemotion`).

CI: `.github/workflows/test.yml` runs the suite on push to `main` and on PRs.

## Scope

v1: pass-the-phone local play, JSON decks, pre-cached images, wake lock, PWA install. Each round samples 7 cards from the full deck. Not in v1: offline, accounts, shared/remote decks, speech recognition, store apps.
