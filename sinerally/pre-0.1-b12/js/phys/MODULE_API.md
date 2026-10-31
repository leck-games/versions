# Sine Rally module API (v1)

Three independent ES modules plus host glue. No build step. `physics/` has no imports outside itself and does not use THREE, so it runs in browsers and Node.

```
physics/      pure simulation        index.js  trees.js  heat.js  surfaces.js
vehicles/     data + models + UI     index.js  defs/*.js  models.js  build.js  selector.js
attachments/  bolt-on parts          index.js  harvester.js bullbar.js lograck.js rooflights.js  picker.js
host/         glue used by test page rig.js (no DOM)  bus.js  main.js (test page only)
world/        stub-world.js          flat test world: speed strip, gate trees, forest
```

## physics/index.js

```js
import * as PH from './physics/index.js';
const s = PH.createState(vehicleDef.physics);     // merges into PH.DEFAULTS; heat into PH.HEAT
PH.spawn(s, world, x, z, yaw);
PH.step(s, input, dt, world, ext?);                // mutates s. Use dt = 1/120 (host substeps a fixed 120 Hz loop)
PH.drainEvents(s, (type, data) => bus.emit(type, data));
PH.telemetry(s, out?)                              // rpm idle redline throttle brake boost nitro gear shifting load speed fwdSpeed
                                                   // grounded air surface wheels[4]{contact surface slipRatio slipAngle load}
                                                   // temp overheat limiter damage mass logs capacity
```

`input`: `{ gas 0..1, brake 0..1, steer -1..1 (+ = left), hand 0/1, boost 0/1, pitch -1..1 (air) }`.
Standing still with gas + brake > 0.5 free-revs the engine onto the limiter. It makes no drive torque but heats the engine, which is the quick way to test heat.

`world` (worldQuery, provided by the terrain module):

| member | required | notes |
|---|---|---|
| `heightAt(x,z)` | yes | ground height in metres, bridge decks included |
| `surfaceAt(x,z)` | no | name, index, or `{mu, roll, bs}`. See `SURFACES` |
| `normalAt(x,z,out)` | no | defaults to finite differences |
| `queryTrees(x,z,r,out)` | no | pushes `{id,x,z,r,hp}` for trunks near the disc |
| `damageTree(id,hpRemoved,cause)` | no | host store update; returns remaining HP. Without it, physics keeps its own overlay in `s.treeHp` |
| `waterLevel` | no | number |

`ext.onTreeContact(C, s)` is called for each new trunk contact before it is resolved. `C = {tree, id, x, z, speedKmh, normalKmh, angle, zone:'front'|'rear'|'side', impact, hp, dmg, mode, carDamageMul}`. A hook may change `mode` (`'impact'` default, `'harvest'` = no bounce and no damage, `'melt'` = remove all remaining HP at once with no bounce, no speed loss and no car damage (the harvester uses this), `'solid'` = no tree damage), `dmg` (HP to remove) and `carDamageMul`.

Other exports: `API_VERSION, DEFAULTS, HEAT, SURFACES, TREE, treeDamage(kmh, angle), breakLossPerHp(kmh), treeHp(s,t), damageTree(s,world,t,hp,cause), addDamage, repair, recover(s,world), massOf, enginePos, engineTorque, resolveParams, setParams, yawOf, ARCADE, MODES, setMode(s, 'arcade'|'normal'), topRef(P, mode, nitro)`.

### Handling modes (`s.mode`, default `'arcade'`)
`PH.setMode(s, 'arcade' | 'normal')` switches at any time, even mid-drive. **NORMAL** is the original tyre model (it used to be called SIM). **ARCADE** keeps the same tyres and adds assists tuned by `ARCADE` (a vehicle def can override any key in `physics.arcade`):
- grip ×`grip` 1.3, lateral ×`latB`; steering lock ×`maxSteer`, which gets less lock with speed (`steerSpeed`) and a faster rack (`steerRate`). Steering input is rate-limited (`inRate`).
- Yaw assist: when grounded, yaw rate is driven to `steer · min(yawMax, latG·g / v)` with gain `yawK`. Velocity is pulled onto the heading at `align`/s, so there is little understeer.
- Drifts: enter with handbrake + steer (|steer| > 0.2) or brake + hard steer (> 0.5) above `driftMin`·1.4 m/s. The controller then holds a slip angle up to `driftAngle` rad; steering sets the angle and `driftTurn` sets how tightly the car carves. Lateral grip ×`driftGrip`, and the speed floor loses only `driftLoss`/s. Drifting fills nitro at `driftNitro`/s. Counter-steer, brake, low speed, or a long jump ends the drift. Events are `drift:start {dir, speed}` and `drift:end {time, angle}`. Over crests the yaw rate is damped, so the car holds its angle instead of spinning.
- Stability: anti-roll toward the averaged ground normal ×`antiRoll`, plus roll/pitch damping (`rollDamp`). Tyre force lift is capped at `forceLift`. Downforce is `down · v²`. In the air the car self-levels (`airLevel`) and air pitch/yaw is ×`airPitch`/`airYaw`. Landings damp spin and bounce (`landDamp`). Torque ×`torque`, shift time ×`shiftT`.
- Per-vehicle feel (`vehicles/defs/*.js physics.arcade`): the quad is twitchy (yawK 10, yawMax 2.6, inRate 10), the truck heavier (yawMax 1.6, yawK 5), the SINE GT grippy and fast (grip 1.4, latG 1.6, down 0.0035), and the TIMBERWOLF heavy (yawMax 1.2, yawK 4, antiRoll 4).
- The tree HP rules and the 300 km/h pass-through are identical in both modes (unit tests run in both: `MODE=normal node tests/unit.mjs`).

### Top-speed governor (`s.mods.topMul`, set from attachment `mods.topMul`)
`topRef(P, mode, nitro)` is the measured flat-road top speed of the bare vehicle: `P.vtop` (normal) or `P.arcade.vtop` (arcade), in m/s, ×`P.vtopBoost` with nitro. These are measured by `tests/topspeed.mjs`; re-measure after changing power, drag or gearing. With `topMul < 1`, drive torque fades between 0.99 and 1.01 × `topMul·topRef`, nitro push stops, and above that a drag term holds the cap (also downhill). The harvester sets `topMul 0.9`, which gives -10% (measured -9.8% to -10.1% for every vehicle, with and without nitro).

### Tree rules (`physics/trees.js`, `TREE = {maxHp 3, tapKmh 30, refKmh 200, fullKmh 300, refHp 2, glanceMin .2, exp 1.3}`)
- Speed is horizontal car speed. Angle is the share of the velocity along the contact normal (1 = head-on, 0 = scraping past).
- At 200 km/h or less: `dmg = 2 · ((v−30)/(200−30))^1.3 · (0.2 + 0.8·angle)`. A 200 km/h head-on hit removes 2 HP, a 200 km/h glancing hit 0.4 HP, and anything under 30 km/h removes 0.
- From 200 to 300 km/h, damage is smoothstep-blended from the 200 km/h value up to 3 HP, so the curve has no jump. At 300 km/h or more it always removes 3 HP, whatever the angle.
- If HP is left after the hit, the tree stays solid (bounce e = 0.25). Car damage = `0.12 · normalKmh · remaining/3` %.
- At 0 HP the car passes through and the tree despawns permanently. The car loses `hp0 · breakLossPerHp(v)` of its speed (≈1% per HP at 300 km/h or more, 6% per HP at 200 km/h or less) and takes `1.5 · hp0` % damage.
- HP is fractional (2 decimals). The UI shows one decimal.

### Heat (`physics/heat.js`)
`HEAT = {ambient 25, start 70, thermostat 88, hot 105, overheat 118, max 140, gen 6.5, nitro 6, limiter 1.5(+0.5/s), coolIdle .015, coolAir .0009, derate .65, hotEvery .5}`. Heat comes from throttle × (rpm/redline)² × load × mass factor, plus nitro, plus time on the limiter. Cooling comes from airflow (speed) and the radiator above the thermostat.
- At `hot` or above (105 °C), `engine:hot` fires every 0.5 s.
- At `overheat` (118 °C), `engine:overheat` fires once. Torque drops to ×0.65 and nitro is disabled.
- At `max` (140 °C) the engine cuts out until the temperature falls below 125 °C.
- When it drops back below `hot`, `engine:cooled` fires.

### Events (`{type, ...data}` in `s.events`)
| type | data |
|---|---|
| `tree:hit` | id speed angle zone remaining mode |
| `tree:damage` | id hp remaining cause x z speed angle zone |
| `tree:destroyed` | id x z cause speed angle zone |
| `engine:hot` | position[3] temp intensity 0.05..1 |
| `engine:overheat` | position temp |
| `engine:cooled` | temp |
| `vehicle:damage` | amount total cause |
| `crash` | value |
| `drift:start` / `drift:end` | dir speed / time angle (arcade) |
| `land`, `scrape`, `shift`, `recover` | (sound / FX hooks) |

Tree `damage`/`destroyed` events from a melt carry `cause:'harvest', melt:true`. Attachments emit `harvester:cut {id, remaining}`, `harvester:log {id, logs, total}` and `harvester:full {logs}`. The rig emits `cargo:unload {logs}`.

## vehicles/

```js
import { listVehicles, getVehicle, registerVehicle, DEFAULT_VEHICLE } from './vehicles/index.js';
import { buildVehicle } from './vehicles/build.js';   // (THREE, def, mat?) -> {group, body, wheels, flame, setWheel(i,comp,steer,rot), dispose}
import { openSelector } from './vehicles/selector.js'; // ({THREE, container, current, onPick}) -> {close()}, with a 3D preview and stats
```

A def is plain data: `{id, name, blurb, sound, stats{top, accel, grip, weight}, physics{…PH params}, visual{model, scale, wc, z, wheelScale, flame, color}, mounts{front|roof|rear: [x,y,z]}, defaultAttachments[]}`.

| id | name | kg | top km/h (measured, flat) | mounts |
|---|---|---|---|---|
| buggy | BUGGY | 1500 | 195 (arcade 198) | front roof rear |
| truck | TRUCK | 2300 | 188 (arcade 192) | front roof rear |
| quad | QUAD | 820 | 207 (arcade 208) | front rear |
| hyper | SINE GT | 1250 | 293 (arcade 296; 341 with nitro) | front roof |
| forester | TIMBERWOLF | 3200 | 146 (arcade 149) | front roof rear (harvester + log rack by default; with them 131 / arcade 134) |

## attachments/

```js
import { listAttachments, getAttachment, registerAttachment, compatible, validate, applyMods, melts } from './attachments/index.js'; // melts(ids) -> true if any part melts scenery
import { renderPicker } from './attachments/picker.js'; // ({container, vehicle, selected, onChange(ids)})
```

An attachment is `{id, name, blurb, mounts[], mods{mass, cdA, coolMul, capacity, topMul, reach}, melts?, create(vehicleDef, host) -> {object, onCollision?(C), update(dt), dispose()}}`.
`host = {THREE, state, world, emit, mount(name) -> THREE.Group, treeHp(t), damageTree(t, hp, cause), addLogs(n)}`. `validate` allows at most one attachment per mount and drops any that don't fit.

| id | mount | effect |
|---|---|---|
| harvester | front | Melts any tree (bush, cactus) it touches at any speed: every front contact (the cutter reaches `mods.reach` 0.9 m ahead of the bumper and sweeps the distance covered each step) uses `mode:'melt'`, which removes all HP at once with no bounce, no speed loss and no car damage. Logs: 1 per HP up to capacity, then `harvester:full` and the tree still melts. `mods {mass 180, capacity 3, topMul 0.9, reach 0.9}`, so -10% top speed. `melts: true` tells the host to melt other scenery (the game uses this for rocks) |
| bullbar | front | Front impacts do ×1.5 tree damage and ×0.35 car damage. +45 kg |
| lograck | rear | Holds 12 logs (60 kg each), shown as stacked logs. +90 kg |
| rooflights | roof | Flashing beacons (cosmetic). +8 kg |

## host/rig.js

`createRig({THREE, world, emit}) -> {state, vehicle, attach, inst, root, mounts, host, setVehicle(id, attachIds?), setAttachments(ids), setMode(mode), step(input, dt), unload()}`. `setVehicle` keeps the current handling mode. `root` is the attachment parent and gets the vehicle body transform each frame.
Test page persistence: `localStorage.srp_vehicle`, `srp_attach_<vehicleId>` and `srp_handling` (JSON).
