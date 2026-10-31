# Sine Rally · Engine Sound Plugin API (apiVersion 1)

An engine sound plugin is **one plain ES module**. It never imports anything from the game, and the game never imports
anything from it. All communication goes through the contract below. The game is the **host**:

| Host (game, `js/engine-audio.js`) | Plugin (your module) |
|---|---|
| creates/unlocks the `AudioContext` on a user gesture (iOS) | builds its own nodes and connects them to `destination` only |
| master volume, mute, duck while paused, safety limiter | never touches `ctx.destination`, never suspends/resumes/closes `ctx` |
| builds a telemetry object every rendered frame (~30 fps on phones) | `update(telemetry, dt)`: map telemetry → audio params |
| turns game events into plugin events | `event(name, data)`: one-shots (pops, thumps…) |
| validates, times out, catches errors, falls back | `dispose()`: stop sources, disconnect |

Working examples: [`plugins/example-simple-engine.js`](plugins/example-simple-engine.js) (~45 lines) and the full
Engine Sim plugin [`plugins/enginesim/plugin.js`](plugins/enginesim/plugin.js) (vendored from
[leck-games/sinerally-enginesim](https://github.com/leck-games/sinerally-enginesim), which uses the same file in its
standalone page).

## 1. Module shape
```js
export default {                       // (named exports with the same names also work)
  id: 'my-engine',                     // required, string, unique
  name: 'My engine',                   // shown in the menu
  apiVersion: 1,                       // required, must equal the host's version (1) or the plugin is rejected
  version: '1.0.0',                    // optional, your own version
  presets: [{ id: 'v8', name: 'V8' }], // optional: shows a preset picker in the menu
  defaultPreset: 'v8',                 // optional
  vehiclePresets: { buggy: 'v8', truck: 'v8', quad: 'v8' }, // optional per-vehicle defaults
  create(ctx, destination, options) {  // may be async (return a Promise); 10 s timeout
    // ctx: the host's running AudioContext. destination: an AudioNode (a per-plugin GainNode) – connect here.
    // options: { apiVersion: 1, preset, vehicle, vehiclePreset, host: 'sinerally' }
    return {
      update(t, dt) { },               // required. t = telemetry (below), dt = seconds since last frame
      event(name, data) { },           // optional
      setPreset(id) { },               // optional: live preset switch (otherwise the host re-creates the plugin)
      get preset() { return 'v8'; },   // optional: current preset id (menu highlight)
      setConfig(patch, opts) { },      // optional: live engine-config edit (enables the in-game sound EDITOR, §1a)
      getConfig() { return {}; },      // optional: current config, JSON-safe copy (required together with setConfig)
      getVisualState() { },            // optional: firing-lights state for the editor
      dispose() { },                   // optional but strongly recommended
    };
  }
};
```
Preset choice when the plugin is created or the vehicle changes: the user's saved choice for this plugin + vehicle →
the vehicle's own default sound preset id (`vehiclePreset`, if your `presets` contain it) → your `vehiclePresets[vehicle]`
→ `defaultPreset` → the first preset.

## 1a. Optional: live config editing (`setConfig` / `getConfig`)
Additive to API v1 (`apiVersion` stays 1). If the instance has **both** `setConfig` and `getConfig`, the game shows
☰ → ENGINE SOUND → **EDIT**; otherwise the editor is hidden.
- `getConfig()` → a JSON-safe object (copy). The host saves it per vehicle (`localStorage` `sinerally_sndcfg1`), in
  named slots, and as exported JSON, and later hands it back with `setConfig(saved, { replace: true })`.
- `setConfig(patch, { replace })` → merge `patch` into the current config (or replace it), apply it live (no audible
  restart if you can help it) and return the new derived config. Must tolerate partial/unknown fields. Called at most
  ~20×/s while a slider is dragged.
- `getVisualState()` (optional) → `{ now, crank, cycle, rpm, lastFire: number[], lastKind: number[] }` (times in
  `ctx` seconds as heard; `lastKind` 1 = misfire); drives the editor's firing-lights strip. Called once per frame only
  while the editor is open.
- Module export `configSchema` (optional) describes the fields so the host can build controls: `{ maxCylinders, layouts,
  shapes, bankAngles, limiters, induction: [[value,label],…], countsFor(layout), crankOptions(cfg),
  defaultFiringOrder(cfg), parseFiringOrder(str, n), firingIntervals(cfg), cycleOf(cfg) }`. The game's editor speaks
  the Engine Sim schema (`layout`, `cylinders`, `bankAngle`, `crank`, `stroke`, `firingOrder`, `cyl[]` {vol, tone,
  shape, runner, misfire, rough, fire}, `exhaust`, `exhaustVol`, `mufflerTone`, `crossover`, `runnerReso`, `intakeVol`,
  `mechVol`, `induction`, `inductionVol`, `pops`, `limiter`, `idleRpm`, `redline`, `displacement`, `master`); a
  plugin without `configSchema` gets a generic JSON editor (export/import only).

## 2. Telemetry (`update(t, dt)`)
`t` is **one object reused every frame** (mutated in place) – read it, don't keep a reference or store it.

| field | type / unit | meaning |
|---|---|---|
| `time` | s | host clock (sum of dt) |
| `rpm` | rev/min | engine speed |
| `idleRpm`, `redlineRpm` | rev/min | current vehicle's idle and redline |
| `rpmNorm` | 0..1.2 | `(rpm − idle) / (redline − idle)` – use this to map onto your own engine's range |
| `throttle`, `brake` | 0..1 | driver input after assists (traction control may cut throttle) |
| `load` | −1..1 | drive torque / available torque; < 0 = engine braking (currently ~0..1 in-game) |
| `nitro` | bool | boost firing this frame |
| `nitroStrength` | 0..1 | smoothed `nitro` (fade in ~0.1 s, out ~0.2 s) |
| `nitroTank` | 0..1 | boost tank fill |
| `gear`, `gearCount` | int | current gear (1..n), number of gears |
| `shifting` | bool | a shift is in progress (clutch open) |
| `limiter` | bool | at the rev limiter with throttle |
| `ignition` | 0 or 1 | 0 = spark cut (limiter bounce or upshift cut) |
| `speed`, `fwdSpeed` | m/s | |v|, signed forward speed |
| `speedKmh` | km/h | `speed × 3.6` |
| `grounded` | 0..4 | wheels in contact |
| `airborne`, `airTime` | bool, s | all wheels off the ground, seconds airborne |
| `surface` | string | `asphalt` `dirt` `grass` `sand` `rock` `snow` `mud` |
| `slip` | 0..1 | max tyre slip over the contact wheels (for screech/scrub layers) |
| `vehicle` | string | `buggy` `truck` `quad` (more may come – handle unknown ids) |
| `vehiclePreset` | string \| undefined | the vehicle's default sound preset id (from the vehicle module) |
| `engineTemp` | °C \| undefined | engine temperature, **optional**: present when the host has a heat model (Sine Rally: always, since the 2026-10-28 physics merge) |
| `paused` | bool | game paused (world map). The host ducks the master and **skips `update()`** while paused |

Treat every field as possibly missing in future hosts (`typeof x === 'number'` before using optional ones).

## 3. Events (`event(name, data)`)
Delivered right before `update()` of the same frame.

| name | data | when |
|---|---|---|
| `shift` | `{ dir: ±1, from, to }` | gear change |
| `backfire` | `{ strength: 0..1 }` | host-derived: throttle lift at high rpm, upshift at high rpm, hitting the limiter (max 4/s) |
| `limiter` | `{ on }` | limiter state change |
| `nitro` | `{ on }` | boost start/stop |
| `land` | `{ impact: m/s, airTime: s }` | wheels back on the ground |
| `crash` | `{ impact: m/s }` | hit a solid object |
| `scrape` | `{ impact: m/s }` | body scrape |
| `recover` | `{}` | car reset / rollover recovery |
| `vehicle` | `{ id }` | vehicle switched (the host also calls `setPreset()` with that vehicle's preset) |
| `pause` | `{ on }` | pause state change |

Unknown event names must be ignored – new ones may be added without bumping `apiVersion`.

## 4. Lifecycle
1. First user gesture (tap/click/key) → host creates/resumes the `AudioContext` and plays a silent buffer (iOS unlock).
2. `import(url)` → validate (`create` is a function, `apiVersion === 1`, `id` is a string) → `create()` (10 s timeout) →
   must return an object with `update()`.
3. Every rendered frame: events, then `update(t, dt)`. Not called while paused.
4. Switching plugin/off, or a failure → `dispose()`; the per-plugin bus is disconnected anyway, so a forgotten node is
   silent, but still costs CPU until you stop it.
5. **Failures**: import error, bad `apiVersion`, `create()` throwing/timing out, or 5 consecutive throws from
   `update()`/`event()`/`setPreset()` → the host disposes the plugin, shows the error in the menu and falls back to the
   default Engine Sim plugin (if that fails too: silence). The game keeps running.
6. The host owns `visibilitychange` (suspend/resume). Don't add your own.

## 5. Performance (target: iPhone 12, iOS Safari, ~30 fps)
- `update()` runs on the main thread every frame: keep it **well under 0.5 ms**. No allocation per frame (no new
  objects/arrays/closures, no `new` nodes), no DOM access, no `console.log`.
- Only automate `AudioParam`s with `setTargetAtTime(value, ctx.currentTime, 0.02–0.05)` – smooth at 30 fps.
- Creating nodes per event is fine for short one-shots (a few per second), not per frame.
- Heavy synthesis belongs in an `AudioWorklet` (see Engine Sim). Post at most one message per frame to it. Keep a
  ScriptProcessor fallback only for old browsers.
- Keep the node count small (tens, not hundreds). Avoid `ConvolverNode` with long IRs on phones.
- Output level: aim for peaks around −6 dBFS; the host limiter only catches overs.

## 6. Loading your plugin in the game
☰ menu → **ENGINE SOUND** → **CUSTOM SCRIPT**:
- **LOAD URL**: an `https://` URL to your `.js` (http is allowed only for `localhost`/`127.0.0.1`). The server must
  send a JavaScript MIME type and allow CORS – GitHub Pages and jsDelivr
  (`https://cdn.jsdelivr.net/gh/<user>/<repo>@<tag>/plugin.js`) both work. `raw.githubusercontent.com` serves
  `text/plain`; the host then falls back to fetch + Blob import, which works for **single-file** plugins only.
- **LOAD .JS FILE**: pick a local file; it is imported from a Blob URL and stored (≤ 256 KB) so it reloads next time.
  Blob modules have no base URL: **no relative `import`s and no relative `addModule()` URLs** – bundle into one file,
  or inline your worklet code as a Blob URL.
- The choice, volume, mute and per-vehicle preset are saved in `localStorage` (`sinerally_snd1`).

## 7. Testing
- Locally: `python3 -m http.server 8000` in the game folder, open `http://localhost:8000/`, click once, ☰ → ENGINE
  SOUND → LOAD URL `http://localhost:8000/path/to/your-plugin.js`. Errors appear in the menu and the console
  (`[audio] …`).
- Console helpers: `__st.audio.stats` (`updates`, `events`, `updMs` = average update cost in ms, `fallbacks`),
  `__st.audio.telemetry`, `__st.audio.error`, `__st.audio.instance`. `?auto=1` makes the car drive itself.
- Headless: `node tools/test-sound.cjs http://127.0.0.1:18931/` (puppeteer-core + Chrome) checks load, update calls,
  presets, URL + file loading, fallbacks for `tools/fixtures/*` (bad apiVersion, syntax error, throwing update, 404)
  and console errors.
- Without the game: write a tiny page that creates an `AudioContext` on click, calls `create(ctx, ctx.destination, {})`
  and feeds `update()` a fake telemetry object from a slider.

## 8. Security
**A custom script runs with the full privileges of the game page** (same origin): it can read/modify the game's
`localStorage` (saves, settings), the DOM, and make network requests. There is no sandbox. Only load code you trust or
have read. The game never loads plugins from URL parameters, so a link cannot inject a plugin; a custom plugin is only
loaded after the user picks it in the menu (and then again on later visits until switched away).

## 9. Versioning
`apiVersion` changes only for breaking changes (renamed/removed fields or methods, changed units). New telemetry fields
and new event names are additive and keep `apiVersion: 1`.
