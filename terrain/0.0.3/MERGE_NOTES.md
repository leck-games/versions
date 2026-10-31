# Merge notes (terrain module → leck-games/sinerally)

I did not touch the game repo. The plan for merging:

1. **Files**:
   - Copy `terrain/*` into `js/terrain/`. `terrain/world.js` is the game's `js/world.js` plus a biome layer (exports `BIOME`, `BIOME_NAMES`, `moisture`, `heat`, `clump`, `biomeWeights` and `biomeOf`).
   - `sample()` now also fills `o.bg/o.bs/o.bf`, and grass colour and density blend by biome.
   - **Heights, roads and rivers are unchanged**, so the existing physics stays valid. Replace `js/world.js` with it, or re-export from it.
2. **Rendering**:
   - Replace the game's ground grids, grass, roads and tree scatter with `T.setup(scene)` and call `T.update(dt, {camera, focus: car.pos, viewHeight})` once per frame.
   - The old breakable-scenery Set for trees can go: trees now have HP, and removal persists through `persistKey`. Bushes, cacti and rocks could keep the old path or move to species.
   - The comic shaders share the uniform object `U` (sun, fog, horizon, time). Point the game's sky/time and post code at `T.uniforms`, or copy values into it. The post pass in `test/post.js` is the game's own `postMat` without boost.
   - Post reads the normal code from colour alpha. Alpha 0 (grass, rain, smoke) gets only faint ink.
3. **Physics contract**:
   - Each step, physics calls `T.queryTrees(car.x, car.z, r)`.
   - It decides damage from speed and angle (the rule in MODULE_API.md is in the stub car in `test/main.js`) and emits `'tree:damage'` / `'tree:destroyed'` on the shared bus.
   - Use `T.surfaceAt()` for grip: it already includes wet and rain.
4. **Engine/sound contract**: the engine module emits `'engine:hot' {position, intensity}` while overheating and `'engine:overheat' {position, temp}` at the limit.
5. **Bus**: anything with `on(type, fn)` / `off` works, and `emit` is optional. An `EventTarget` with `CustomEvent` works too, since `detail` is unwrapped.
6. **Settings**: tie `small` to the game's Low/Med on phones. Map the game's `?wx=` and `?tod=` to `T.setRain` / `T.setTimeOfDay`.
7. **Watch out for**:
   - `flat` is a reserved word in GLSL ES 3.
   - In r160 use `attr.clearUpdateRanges()` + `addUpdateRange()`, not `updateRange`.

## Update: wider roads
- Highways are 2× wider (24 m) and dirt trails/loops 1.5× wider (10.8 m / 24 m), via `ROAD_HW` in world.js. No API changes.
- Game side: scale any hard-coded road widths (minimap/map line widths) using `ROAD_HW`. Rocks keep using `road`/`rd`, so they stay off the wider roads automatically.
- Bridges probe ±hw for water. Loop distance is now perpendicular. `test/roads.mjs` was added. The e2e road-ignite probe now picks a point well inside the road bed.
