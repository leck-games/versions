# Merge notes

## Audio / engine-sim (not in this repo yet)
Audio was deliberately **dropped** from this build. Sound and the engine simulation are built by a separate worker in their own
project and will be merged later. The game contains **no WebAudio code**. Instead, it exposes a clean read-only hook:

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
