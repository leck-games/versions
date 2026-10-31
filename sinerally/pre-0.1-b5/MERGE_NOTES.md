# Merge notes

## Audio / engine-sim — merged as a plugin (2026-10-24)
- `js/engine-audio.js` is the **plugin host** (the only WebAudio code in the game): AudioContext unlock on the first
  gesture, master gain/mute/pause-duck + limiter, loading/validation/fallback, menu section, and the mapping from the
  `window.SR` hook below to the plugin telemetry contract (`PLUGIN_API.md`). `main.js` calls only
  `createEngineAudio({ sr: window.SR })`, `audio.frame(dt, paused)` and `audio.buildMenu(el)`.
- **Engine Sim is vendored**, not loaded cross-repo: `tools/sync-enginesim.sh` copies `plugin.js engine-sim.js
  engine-dsp.js engine-config.js motor.js` from `../engine-sim/js` into `plugins/enginesim/` and writes the source commit
  to `plugins/enginesim/VERSION`. Why: pinned, reviewed version (a push to the sim repo can't break the game); the
  AudioWorklet file must be served next to `engine-sim.js` from the same origin; works offline/locally; both repos
  are on `leck-games.github.io` anyway, so there is no CDN gain. The sim repo remains the single source of truth –
  never edit `plugins/enginesim/` here, change `js/plugin.js` there and re-sync.
- Vehicles: `soundPreset` in `js/vehicle.js` (buggy `boxer4`, truck `muscleV8`, quad `dirtbike`) → `SR.telemetry.soundPreset`.
  `SR.telemetry.gears` added. Optional `engine:temp` (°C) from the physics module is passed on as `engineTemp`.
- Plugins must not import game code; the game must not import plugin internals (only by URL through the host).

### Original hook (still the host's only input)
The game exposes a clean read-only hook:

```js
const t = window.SR.telemetry;   // live, read-only (Proxy: writes are ignored), updated every rendered frame
t.rpm, t.idle, t.redline         // engine rpm and the current vehicle's idle/redline rpm
t.throttle, t.brake              // 0..1 driver inputs after assists (traction control may cut throttle)
t.boost                          // bool: boost/nitro firing this frame
t.nitro                          // 0..1 boost tank
t.gear, t.shifting               // 1..n, true during a shift
t.load                           // -1..1 engine load (drive torque / available torque; negative = engine braking)
t.speed, t.fwdSpeed              // m/s (|v|, signed forward)
t.grounded, t.air                // wheels in contact (0..4), seconds airborne
t.surface                        // 'asphalt'|'dirt'|'grass'|'sand'|'rock'|'snow'|'mud' under the rear-left wheel
t.wheels[i]                      // i = 0 FL, 1 FR, 2 RL, 3 RR: { contact, surface, slipRatio, slipAngle (rad), load (N) }
t.vehicle                        // 'buggy' | 'truck' | 'quad'
t.paused                         // true while the world map is open (physics paused) – mute/duck here

SR.on(type, fn) / SR.off(type, fn)   // one-shot events
// 'shift'   {value: newGear}            'land'    {value: impact speed m/s}
// 'crash'   {value: impact speed m/s}   'scrape'  {value: normal speed m/s}
// 'recover' {}                          'smash'   {kind: 'tree'|'cactus'|'shrub', x, z}
// 'pickup'  {total}  (fuel can)         'discover' {name, x, z} (vista)
```

Hook point for the merge: a module that imports nothing from the game, waits for `window.SR`, and polls `SR.telemetry`
in its own rAF / AudioWorklet message loop. Source: `updateTelemetry()` and `window.SR` near the end of `js/main.js`;
`veh.thr / veh.brk / veh.load` are set in `Vehicle.step()` (`js/vehicle.js`).
