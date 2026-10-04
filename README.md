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

`tilt.js` reads `devicemotion.accelerationIncludingGravity` and projects gravity onto the screen's "up" axis, so it is orientation-agnostic and gimbal-free (Euler `beta`/`gamma` gimbal-lock at ±90°, exactly where a landscape phone sits on a forehead). A low-pass filter plus threshold hysteresis and a per-flip cooldown kill double-fires. A neutral baseline is captured once per session on the calibrate screen.

- **iOS Safari / PWA**: `DeviceMotionEvent.requestPermission()` is requested from the Start tap (required). HTTPS required.
- **Android Chrome**: no prompt.

## Scope

v1: pass-the-phone local play, JSON decks, pre-cached images, wake lock, PWA install. Not in v1: offline, accounts, shared/remote decks, speech recognition, store apps.
