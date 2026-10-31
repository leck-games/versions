# Merge notes: Engine Sim → Sine Rally

This project is a standalone repo, so it can be developed without touching the game. When it's time to merge, the
only files the game needs are:

```
js/engine-dsp.js      (DSP + AudioWorklet processor 'engine-sim'; it must be served as its own file)
js/engine-config.js   (presets / layout maths)
js/motor.js           (optional: only if the game wants the built-in gas/brake/nitro model)
js/engine-sim.js      (the API)
js/viz.js             (optional: engine diagram / tach / lights on a <canvas>)
```
`ui.js`, `main.js`, `index.html` and `css/` belong to the standalone demo and the tuning UI.

## 1. Audio context
Reuse the game's existing AudioContext so there is only one iOS unlock and one output:
```js
import { EngineSim, preset } from './engine/engine-sim.js';
const engine = new EngineSim({ context: gameAudioCtx, destination: gameMasterGain, config: preset('muscleV8') });
// inside the game's existing "tap to start" handler (synchronously!):
engine.unlock();            // with a shared ctx: resume + silent buffer + audioSession 'playback'
await engine.start();       // loads ./engine-dsp.js next to engine-sim.js (import.meta.url-relative)
```
- The worklet URL is `new URL('./engine-dsp.js', import.meta.url)`. Keep the two files in the same folder. On GitHub Pages
  `.js` is served as `text/javascript`, so it works there.
- `start()` adds a `visibilitychange` listener that suspends/resumes the ctx. If the game already does this, either
  one is fine (calling it twice is harmless).
- `forceScriptProcessor: true` (or `?sp=1` in the demo) forces the fallback path, for debugging.

## 2. Driving the sound from the game's vehicle (recommended)
Call this every frame (or every physics tick) with the car's own state:
```js
engine.update({
  rpm:      car.engineRpm,              // number, the crank speed you want to hear
  throttle: car.throttle,               // 0..1 (pedal after traction control etc.)
  load:     car.engineLoad,             // 0..1 (≈ torque demand; 0 on overrun → pops/burble)
  nitro:    car.nitroActive,            // bool
  spark:    car.limiterCut ? 0 : 1,     // 0 = ignition cut (limiter/shift cut), 1 = normal
  boost:    car.boost ?? 0,             // 0..1 turbo/blower spool, if the game has it
});
```
If the game has no gearbox or rpm, you can use the built-in model instead:
```js
const tel = engine.drive({ gas: input.gas ? 1 : 0, brake: input.brake ? 1 : 0, nitro: input.nitro }, dt);
// tel = { rpm, gear, speedKmh, limiter, shifting, nitroTank, torque, redline, ... }
```
`engine.motor.setNeutral(true)` turns on free-revving (garage / menu screen).

Sine Rally mapping idea: the game already has GAS/BRAKE/NITRO, so `drive()` can be used directly at first. Later, feed
the game's own speed into rpm through a gear ratio and call `update()`.

## 3. Config / presets
```js
engine.loadPreset('flatV8');                 // keys: muscleV8 flatV8 inline6 boxer4 inline4 v12 dirtbike twoStroke rotary vtwin v10odd
engine.setConfig({ cylinders: 6, layout: 'v', bankAngle: 60 });  // patch; fire angles are re-derived
engine.setConfig(savedJson, { replace: true });                  // JSON from the demo's "Export JSON"
engine.getConfig();
engine.setVolume(0.8);
```
A car-select screen could store one exported JSON per car. The demo's Tune panel is the editor for them.

## 4. Lights / visual sync
```js
const vis = engine.getVisualState();   // call once per rAF
// vis.lastFire[cyl] = context time the cylinder was last *heard* firing (latency-compensated)
// vis.lastKind[cyl] 0 = fire, 1 = misfire/cut ; vis.crank (deg), vis.cycle (720/360), vis.rpm, vis.history
const glow = Math.exp(-(vis.now - vis.lastFire[i]) / 0.03);
engine.onFire(e => { /* {cyl, t, kind}: kind 2 = afterfire pop; good for exhaust-flame particles */ });
```
- `onFire` listeners run from inside `getVisualState()`, so keep calling it every frame.
- `engine.visualOffset` (seconds) adds extra correction for Bluetooth headphones and similar.
- To draw the full engine panel in a HUD: `new EngineViz(canvas).draw(engine.getConfig(), vis, tel)`.
  It needs a telemetry-shaped `tel` (rpm, gear, speedKmh, nitroTank, limiter, shiftFlash, shiftDir, redline).

## 5. Things to watch when merging
- The game's current engine sound (in `/workspace/sinerally` and `/workspace/sinerally-engine`) should be muted or removed
  when this one is active, or they'll double up.
- Loudness: output RMS is about 0.15–0.23 when driving, and a soft clipper caps peaks. Route it through the game's
  master gain and set `setVolume()` to fit the mix.
- Changing config re-creates the DSP voices. Don't call `setConfig` every frame; use `update()` for anything that changes continuously.
- Offline rendering (`EngineSim.renderOffline` in Node/browser, `renderOfflineWorklet` in browser) is handy for
  regression tests. See `tools/render-wavs.mjs` and `tools/test-browser.cjs`.
