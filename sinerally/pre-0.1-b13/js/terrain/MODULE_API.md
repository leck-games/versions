# Sine Rally terrain module: API

`terrain/` is a standalone ES module. It needs Three.js r160 via the import-map name `three`, has no build step and no other dependencies.
The whole world is computed from sine sums in `terrain/world.js`, so every height, biome, surface and tree is a function of (x, z).

```js
import { createTerrain, world, uniforms, SPECIES } from './terrain/index.js';
const T = createTerrain({ bus, small: isPhone, grassCount, persistKey: 'sinerally-terrain' /* or null */ });
scene.add(...T.setup(scene)) // setup() already adds its meshes and also returns them
T.update(dt, { camera, focus: carPosition, viewHeight: canvasHeightPx });  // once per frame
```

## Queries (pure, cheap, safe to call from physics)
| call | returns |
|---|---|
| `heightAt(x,z)` | ground height in m (bridge decks included). Same numbers as the game's `world.ground`. |
| `normalAt(x,z,out=[])` | unit normal `[nx,ny,nz]` |
| `surfaceAt(x,z,out={})` | `{biome, biomeName, surface, surfaceName, dryness 0..1, wet 0..1, grip, roll, bs, road, water, height, normal, burning, burnt, rain, weights:{grassland,savanna,forest}}`. Rain or wetness reduces `grip` by up to 25%. |
| `fuelAt(x,z)` | 0..1 ground fuel. Above 0 only in dry grassland or savanna grass, never on roads, water, rock, sand, snow or forest floor. |
| `dryness(x,z)`, `biomeAt(x,z)`, `findBiome(name,x0,z0)` | dryness, biome name, nearest dry-land point of that biome |
| `queryTrees(x,z,r)` | `[{id, pos:{x,y,z}, radius, height, hp, maxHp:3, species, burning, charred, burn}]`. Trees are hashed on a 6 m grid, `id` is a stable integer and removed trees are left out. |
| `getTree(id)` | the same record, or `null` once removed |
| `fireAt(x,z)` | `{burning, burnt, intensity, fuel}` |
| `rainAt(x,z)`, `coverageAt(x,z)`, `wetAt(x,z)` | 0..1 rain intensity, cloud cover, ground wetness |

## Tree HP (physics owns the rules)
Every tree has 3 HP. The terrain module only displays the state: lean (toward the hit direction), trunk cracks with pale splinters, and a sick leaf tint for each HP lost.
At 0 HP the tree despawns and stays gone. Removed IDs are kept in a Set and persisted when `persistKey` is set.
- `damageTree(id, amount=1, {dir:{x,z}})` returns the new HP. `setTreeHP(id, hp)`, `removeTree(id)`, `igniteTree(id)`, `resetTrees()`.
- Bus input, emitted by physics:
  - `'tree:damage' {id, amount, dir}` or `{id, hp}`
  - `'tree:destroyed' {id}`
- Rule used by the stub car in the test build (`test/main.js` `treeHit`). Physics should own the real version:
  - above 300 km/h: 3 damage, so the car zooms through
  - below 15 km/h: 0
  - up to 200 km/h: `clamp(round(kmh/100 * head), 1, 2)`
  - 200–300 km/h: `min(3, round(2 + (kmh-200)/100 * head))`
  - `head = 0.3 + 0.7·max(0, cos(angle between velocity and the direction to the tree))`

## Fire
- Toroidal 96×96 grid of 3 m cells (about 288 m window) centred on `focus`. Cells use a cellular-automaton spread biased by wind and slope, plus ember spotting in strong wind.
- Fire burns only where `fuelAt > 0`, which means dry grassland and savanna only. Rain and wet ground slow it and put it out.
- Burnt cells persist: they are saved, they stay out of the fire grid and the ground shader shows them charred.
- Trees in or next to burning cells catch fire, scorch, then char. Forest-floor cells never carry fire, but `igniteTree` sets a single tree on fire.
- Ignite with:
  - `ignite(x,z,{radius,cause})`, which returns the number of cells lit (0 means nothing burnable there)
  - bus `'engine:hot' {position:{x,z}, intensity 0..1}`: a chance to start a small fire on each event
  - bus `'engine:overheat' {position, temp}`: always lights a 2–6 m patch if there is fuel
- `extinguishAll()`, `clearBurnt()`, `burningCells()`.

## Weather and time
- `setRain('auto'|'on'|'storm'|'off')`, `setWind(dirRad, speedMs)`, `wind()`, `setTimeOfDay(0..1, autoCycle)` (0.5 = noon), `setLightning(bool)`, `strike()`, `snapWeather()` (skips the ease-in).
- Clouds and rain come from one analytic noise field (`cnoise`) shared by JS and GLSL, weighted by a climate map. Forest is cloudy and rainy, grassland is mostly dry.
- What the weather renders:
  - instanced cumulus
  - a stratus deck under heavy rain
  - halftone cloud shadows on ground, trees and grass
  - hatched rain-shaft curtains
  - near-camera rain streaks
  - wet ground (darker, glossy puddles)
  - fog that thickens with rain and night
  - lightning bolts and flashes

## Events emitted (`T.on(type, fn)` / `T.off`, and on `bus` if it has `emit`)
`fire:ignite {x,z,cause}` · `tree:burning|tree:burnt|tree:extinguished|tree:removed {id}` · `weather:lightning {x,y,z}`

## Roads
- `ROAD_HW = {hwy:12, trail:5.4, loop:12}` gives the half-widths in metres (v1 was `{6, 3.6, 8}`; exported as `ROAD_HW_V1`).
- `sample(x,z).road` is 1 inside `hw + 0.5` and fades to 0 at `hw + 2.5`. `.rd` is the distance past the edge (negative on the road). `.rtype` is HWY=1, TRAIL=2 or LOOP=3.
- Trees and bushes spawn only where `road < 0.02 && rd > 3`, game rocks only where `road < 0.05 && rd > 2.5`, and fire fuel needs `road <= 0.15`. Bridges set `deck` within `hw + 1.2`.

## Misc
- `uniforms` (shared `U`): shaders of other modules can read the same sun, fog, wetness and fire state.
- `world` is the raw sine world. `stats()`, `save()` / `load(state)` and `dispose()` are also available, and `FIRE_CELL` = 3.
