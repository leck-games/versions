# Merge notes

## Physics + Terrain modules — merged (2026-10-28)
Followed `sinerally-physics/MERGE_NOTES.md` and `sinerally-terrain/MERGE_NOTES.md`. Both modules are **vendored, never
edited here** (re-sync with `tools/sync-physics.sh [../sinerally-physics]` / `tools/sync-terrain.sh [../sinerally-terrain]`;
source commits in `js/phys/VERSION`, `js/terrain/VERSION`). The standalone repos/builds are untouched.
- **Physics** (`js/phys/`): `js/vehicle.js` is gone; `createRig({THREE, world, emit})` + `rig.step(input, 1/120)` in the
  fixed 120 Hz loop, `PH.drainEvents` → bus, `PH.telemetry(state, SR.telemetry)` (adds `temp overheat limiter damage
  mass logs capacity`; the host maps `temp` → `engineTemp`). Visual car = `buildVehicle()` + `setWheel()`; attachments mount on
  `rig.root`. Selector/picker (`openSelector`, `renderPicker`) live in the ☰ menu; keys `srp_vehicle`, `srp_attach_<id>` kept.
  Rocks stay game-side colliders (`collideRocks` after each rig step).
- **World adapter:** `js/world.js` re-exports `js/terrain/world.js` (heights/roads/rivers unchanged + biomes). The physics
  worldQuery uses `T.heightAt/normalAt/surfaceAt` (wet + rain grip) and `T.queryTrees`; `damageTree(id, removedHp, cause)` keeps the
  fractional physics HP in the game (`hpMap`) and writes integer HP to `T.setTreeHP` (0 → removed, persisted via
  `persistKey: 'sinerally_terrain1'`). The old breakable-tree Set is gone.
- **Terrain rendering:** `js/grass.js`, `js/roads.js` and the game's ground grids/tree scatter were replaced by
  `T.setup(scene)` + `T.update(dt, {camera, focus, viewHeight})`. `js/shaders.js` re-exports the module's shared uniform
  object `U`, so every game material (car, cans, vistas, water, post) follows the module's sky/light/fog. `small` = touch or Low.
- **Weather:** a single system – the module's. Menu/`?wx=` → `T.setRain('auto'|'on'|'storm'|'off')` (+ `T.snapWeather()`
  on explicit picks), `?tod=`/TIME → `T.setTimeOfDay`. The game's fog/dust modes only multiply the fog/far uniforms after
  `T.update`; the old game rain was removed.
- **Heat → fire:** bus `engine:hot` / `engine:overheat` → `T.engineHot` / `T.engineOverheat` at the car position.
- **Bus:** one `createBus()` (`js/phys/host/bus.js`) shared by physics, terrain (`emit`) and game; a `'*'` listener
  forwards every event to `SR.on` (`shift` keeps the old ±1 direction value plus `gear`; `land.extra` = air time).
- **Tree labels:** DOM pool, max 10, only damaged/just-hit trees and the 3 nearest intact ones within 14 m.
- **Camera:** the boom shortens in front of trunks and drops under crowns in dense forest.

## Engine sound editor (2026-10-28)
`js/sound-editor.js`, mounted by the host's ENGINE SOUND section. Uses only the optional plugin methods
`setConfig/getConfig/getVisualState` + `configSchema` (PLUGIN_API.md §1a, apiVersion still 1); hidden otherwise. Storage
`sinerally_sndcfg1` = `{ v: {plugin: {vehicle: cfg}}, named: {name: cfg} }`. While open, `main.js` zeroes car input.
Engine Sim 1.1.0 (sinerally-enginesim@447c965): rotary 1–16 rotors.

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
- Vehicles: `soundPreset` (since 2026-10-28: the vehicle def's `sound` id from `js/phys/vehicles/defs/`; Engine Sim maps vehicle ids via its `vehiclePresets`: buggy `boxer4`, truck `muscleV8`, quad `dirtbike`, hyper `v12`, forester `inline6`) → `SR.telemetry.soundPreset`.
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
t.vehicle                        // 'buggy' | 'truck' | 'quad' | 'hyper' | 'forester'
t.paused                         // true while the world map is open (physics paused) – mute/duck here

SR.on(type, fn) / SR.off(type, fn)   // one-shot events
// 'shift'   {value: newGear}            'land'    {value: impact speed m/s}
// 'crash'   {value: impact speed m/s}   'scrape'  {value: normal speed m/s}
// 'recover' {}                          (since 2026-10-28 all bus events too: tree:damage, tree:destroyed, engine:hot, …)
// 'pickup'  {total}  (fuel can)         'discover' {name, x, z} (vista)
```

Hook point for the merge: a module that imports nothing from the game, waits for `window.SR`, and polls `SR.telemetry`
in its own rAF / AudioWorklet message loop. Source: `updateTelemetry()` and `window.SR` near the end of `js/main.js`;
since 2026-10-28 the fields are filled by `PH.telemetry()` (`js/phys/physics/`; `js/vehicle.js` no longer exists).


## 2026-10-28 update (harvester melt, wider roads, arcade handling, UI modes)
- Physics `5dfd424` (synced): attachment `melts(ids)`, harvester `mods.topMul 0.9` + `reach`; `PH.setMode(s,'arcade'|'normal')`
  / `rig.setMode` (kept across `setVehicle`); `s.drift` while drifting. Terrain `0b2e409` (synced): `ROAD_HW` hwy 12, trail 5.4, loop 12.
- Game side: the rock colliders are now `[x,z,r,key]`. `collideRocks` melts rocks in the front cone when `melts(rig.attach)`
  (no push/loss/damage, emits `rock:melted`). `rockGone` is persisted. Map/minimap road widths are scaled. Tree HP labels
  now sort by game-side HP, so a damaged tree keeps its label.
- New HUD: `#tHand` (ARC/NRM), `#tUi` (UI mode), `#bUnl` (auto-hidden UNLOAD n); body classes `ui-min` / `ui-none`; BOOST is bottom-left.
- Test hooks `__st`: `handling`, `setHandling`, `ui`, `setUi`, `cycleUi`, `rockGone`, `rocks`, `collideRocks`.
