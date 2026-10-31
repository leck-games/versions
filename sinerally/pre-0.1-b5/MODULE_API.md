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
