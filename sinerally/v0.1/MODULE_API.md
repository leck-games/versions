# Sine Rally · Module APIs

The game is being split into independent modules (Terrain generator, Sound engine, Physics model,
Vehicles/Attachments). Each module has a small, versioned, host-agnostic contract; modules don't import each other's
internals. Sections for the other modules are added by their owners.

## Sound engine (Engine Sound Plugin API v1)
- **Contract:** [`PLUGIN_API.md`](PLUGIN_API.md) – a plugin is one ES module
  `{ id, name, apiVersion: 1, presets?, defaultPreset?, vehiclePresets?, create(ctx, destination, options) → { update(t, dt), event?(name, data), setPreset?(id), preset?, dispose?() } }`.
- **Host-agnostic:** a plugin only receives a WebAudio `AudioContext`, an output `AudioNode` and a plain telemetry object
  (units in PLUGIN_API.md §2). Nothing Sine-Rally-specific is required; the standalone
  [engine sim page](https://leck-games.github.io/sinerally-enginesim/) hosts the same plugin file with its own car model.
- **Host in this game:** `js/engine-audio.js` (`createEngineAudio({ sr })`) – owns the context unlock, master
  gain/mute/limiter, plugin loading/validation/fallback, and maps `window.SR` telemetry + events to the contract.
- **Inputs from other modules (all optional, read from `window.SR.telemetry`):**
  | source module | field on `SR.telemetry` | → plugin telemetry |
  |---|---|---|
  | Physics | `rpm`, `idle`, `redline`, `throttle`, `brake`, `load`, `gear`, `gears`, `shifting`, `boost`, `nitro`, `speed`, `fwdSpeed`, `grounded`, `air`, `surface`, `wheels[]` | `rpm`, `idleRpm`, `redlineRpm`, …, `slip` |
  | Physics | `engine:temp` (°C, or `engineTemp`) | `engineTemp` (undefined if absent) |
  | Vehicles | `vehicle` (id), `soundPreset` (the vehicle's default sound preset id) | `vehicle`, `vehiclePreset`, `options.vehiclePreset` |
  | Physics events via `SR.on` | `shift`, `land`, `crash`, `scrape`, `recover` | plugin `event()`s |
- **Vehicle default sound preset:** a vehicle definition may set `soundPreset: '<preset id>'` (current: buggy `boxer4`,
  truck `muscleV8`, quad `dirtbike` – Engine Sim ids). Used when the user hasn't picked a preset for that vehicle and the
  active plugin has that id; otherwise the plugin's own `vehiclePresets`/`defaultPreset` apply.
- **Version:** host `HOST_API_VERSION = 1`; plugins with another `apiVersion` are rejected (fallback to Engine Sim).

## Physics model + Vehicles/Attachments (vendored `js/phys/`, merged 2026-10-28)
- **Contract:** [`js/phys/MODULE_API.md`](js/phys/MODULE_API.md) (copied verbatim from sinerally-physics; source commit in
  `js/phys/VERSION`, re-sync with `tools/sync-physics.sh`). Never edit `js/phys/` here.
- **Host in this game:** `js/main.js` – `createRig({ THREE, world, emit: bus.emit })`, `rig.step(input, 1/120)` in the fixed
  120 Hz loop, `PH.telemetry(rig.state, SR.telemetry)` once per frame, `openSelector` / `renderPicker` in the ☰ menu.
- **worldQuery the game provides:** `heightAt`, `normalAt`, `surfaceAt` (from Terrain), `queryTrees(x, z, r, out)` → `{id, x, z, r, hp}`,
  `damageTree(id, removedHp, cause)` → writes integer HP to Terrain (`T.setTreeHP`). Rocks are game-side colliders (`[x,z,r,key]`); with an attachment where `melts(ids)` is true they are melted
  (bus `rock:melted {key,x,z,r,speed}`, persisted). Handling: `rig.setMode('arcade'|'normal')`, game default arcade.
- **Events out (bus):** `shift land crash scrape recover tree:hit engine:hot engine:overheat engine:cooled
  harvester:cut|log|full cargo:unload vehicle:damage rock:melted` (temperature is in telemetry, `engineTemp` for plugins).

## Terrain generator (vendored `js/terrain/`, merged 2026-10-28)
- **Contract:** [`js/terrain/MODULE_API.md`](js/terrain/MODULE_API.md) (verbatim from sinerally-terrain; `js/terrain/VERSION`,
  `tools/sync-terrain.sh`). Never edit `js/terrain/` here.
- **Host in this game:** `createTerrain({ bus, small, grassCount, persistKey: 'sinerally_terrain1' })`, `T.setup(scene)`,
  `T.update(dt, { camera, focus, viewHeight })` once per frame. `js/world.js` re-exports `js/terrain/world.js`;
  `js/shaders.js` re-exports the module's shared uniforms `U`.
- **Game → Terrain:** `T.setRain` / `T.snapWeather` / `T.setTimeOfDay` (menu, `?wx=`, `?tod=`), `T.engineHot` /
  `T.engineOverheat` (from physics heat events), `T.setTreeHP`, `T.resetTrees`, `T.extinguishAll` (☰ → GARAGE).
- **Terrain → game:** `queryTrees`, `getTree`, `surfaceAt` (wet/rain grip), `rainAt`, `stats()`, events `tree:damage`,
  `tree:destroyed`, `tree:removed`, `tree:burning|burnt|extinguished`, `fire:ignite` on the same bus.

## Shared event bus
One `createBus()` (`js/phys/host/bus.js`: `on/off/emit`, `'*'` listeners get `(data, type)`) is used by all modules. The game
forwards every bus event to `window.SR.on(type, fn)` for sound plugins (see MERGE_NOTES.md).

## Sound editor extension (optional, apiVersion stays 1)
`setConfig(patch, {replace})`, `getConfig()`, `getVisualState()` + descriptor `configSchema` – see PLUGIN_API.md §1a.
The game shows ☰ → ENGINE SOUND → EDIT only if the active plugin implements them.
