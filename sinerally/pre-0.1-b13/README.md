# SineRally UI – Sine Rally with a fully customizable touch HUD
Fork of the finished [Sine Rally](https://github.com/leck-games/sinerally) (frozen at b93c3b6) plus a HUD layout editor.
Live: **https://leck-games.github.io/sinerally-ui/** (installs as its own home-screen app "Sine Rally UI").

## Trees: one comic LOD at every distance (2026-10-30)
Trees now use the cel-shaded impostor cards (2 triangles per tree) at every distance; the high-poly near meshes are gone. The look matches
near and far, and the GPU saves about 138k triangles in a forest (Med: 289k → 151k, High: 320k → 183k; spawn about 150k / 180k). HP, damage
lean and tint, trunk cracks, fire/char, harvesting, collisions and labels are unchanged (they come from tree data, not the meshes).
`?treelod=mesh` brings back the old near meshes for comparison. The vendored terrain change is in `tools/terrain-local.patch`, which `tools/sync-terrain.sh` re-applies.
Shots: `shots/trees_lod_{before,after}_{close,distant}.png`, `shots/trees_lod_before_after.png`.

## UI redesign (2026-10-29) — less clutter, touch-first
- **Corner group (top right):** ☰ opens the menu, ⚙ opens the **quick tray** (RESET/RUNWAY · GRAPHICS · HANDLING · HUD mode ·
  TILT · FPS · SOUND · MAP). The tray closes on any tap outside it or after 8 s, and opens towards the screen centre wherever you move the corner.
- **Context-aware HUD:** the race bar only shows while racing or near the start gate (never in a plane), fuel-can counter only
  once you carry cans, BOOST hides on planes without afterburner, the rudder sits in a column at the left edge.
- **Tabbed menu** (full safe-area sheet, 40 px+ tabs, every pane scrolls): DRIVE/FLY · VEHICLE · SOUND · GRAPHICS ·
  CONTROLS & HUD (HUD mode, tilt, plane pitch, ✥ EDIT HUD LAYOUT) · WORLD (time, weather, map, garage). Esc closes it.
- **Design tokens** in `index.html :root` (`--ink --paper --y --o --g --r --b`, `--fs-*`, `--tap`, `--gap`, safe-area `--sl/--sr/--st/--sb`).
- Test: `node tools/test-redesign.cjs` (844×390: no HUD overlap car/plane incl. worst case, tray, every tab reachable +
  scrolls, engine editor parity, live preview, per-vehicle persistence car+plane, layout v1→v2 migration, no console errors).

## Layout editor (☰ → CONTROLS & HUD → ✥ EDIT HUD LAYOUT, or key U)
- Opening the editor **pauses the game**. Every HUD element gets a dashed handle: **drag** to move (touch or mouse),
  **pinch** (two fingers, selected element) or **− / +** or mouse wheel to resize (0.5–2.5×). Arrow keys nudge (Shift = 8 px).
- Per element: opacity slider, HIDE/SHOW, DEFAULT POS. The ☰ ⚙ corner group can be moved/scaled/faded but not hidden
  (so you can't lock yourself out).
- SNAP: 8 px grid inside the safe area + snapping to safe-area edges and the screen centre. ALL: global opacity + scale.
- PRESET: DEFAULT, LEFT-HANDED (mirrored), CLEAN (minimal look) · ⇋ MIRROR (swap sides of the current layout) · ⟲ RESET.
- SLOTS 1–3: save/load your own layouts. JSON EXPORT (copies to clipboard) / IMPORT (paste) to share layouts.
- Stored in `localStorage.srui_layout` (versioned, `v:2`; v1 layouts from before the redesign are migrated: the old
  TOP BAR / UI MODE / ARC entries are dropped, everything else is kept); positions are offsets from viewport anchors
  (left/centre/right × top/middle/bottom of the safe area) so layouts survive rotation and other screen sizes.
- Works with UI modes FULL / MINIMAL / NONE (I key / UI MODE button): your hidden flags are respected in every mode.
- Test: `python3 -m http.server 18941 --bind 127.0.0.1` then `node tools/test-ui.cjs` (iPhone 12 landscape, synthetic touch).

## Planes (✈) — 2026-10-29
Three flyable aircraft with an arcade-friendly flight model (lift / drag / stall / thrust, rate-based controls, auto-coordination):
- **BUSH CUB** – slow, forgiving STOL taildragger with tundra tyres; lands on dirt strips and meadows.
- **STUNT X** – aerobatic monoplane, huge roll rate, inverted-capable, loops allowed.
- **SINE JET** – fast, needs paved runways, afterburner (Shift / BURN).

Procedural airfields (paved + dirt strips, windsocks, hangars) are generated in the math world and shown on the minimap
(nearest field + distance). Landing gear rides the terrain; **crashes**: trees ("HIT A TREE"), nose-in/prop strike, hard landings,
gear collapse, water. After a crash the plane auto-resets to the nearest suitable runway. Works with ARCADE and NORMAL handling
(NORMAL = less auto-levelling, real stalls). Chase camera, fog + draw distance stretch with altitude, prop/jet sound via the
engine-sound plugin host. Flight HUD (attitude, IAS, ALT, VS, heading), throttle slider and rudder buttons are registered in the
layout editor (✈ FLIGHT HUD / ✈ THROTTLE / ✈ RUDDER).

Switching: ☰ → VEHICLE → **✈ PLANES** tab (3D preview), or ☰ → ✈ FLY A PLANE / 🚗 DRIVE CAR, or key **P**; **V** cycles planes.
In the plane menu: RESET TO RUNWAY, AIR START, ✈ <airfield> to teleport to a field. The choice persists (`sinerally_craft`).

| | Keyboard | Touch (iPhone landscape) |
|---|---|---|
| Roll | A / D or ← / → | joystick left/right (or tilt) |
| Pitch | ↑ nose down, ↓ nose up | joystick up/down (☰ PLANE PITCH: Stick / Inverted) |
| Throttle | W / S | THR+ / THR− buttons, throttle slider |
| Rudder | Q / E | ◀R / R▶ |
| Wheel brake | Space | BRAKE |
| Afterburner (jet) | Shift | BURN |

## Graphics quality (⚙ → GRAPHICS, or ☰ → GRAPHICS) — LOW · MED · HIGH · ULTRA
MED is the phone default. The choice is stored in `localStorage.sinerally_q3`; URL override `?q=low|med|high|ultra`
(`&dyn=0` turns off the dynamic-resolution fallback).

| | LOW | MED | HIGH | ULTRA |
|---|---|---|---|---|
| pixel ratio (cap) | 1 | 1.5 | 2 | 3 |
| HD road textures (asphalt grain, cracks, patches, lane paint wear, dirt ruts, anisotropic filtering) | – | – | 512×1024 | 1024×2048 |
| terrain micro-detail | – | – | 0.7 | 1.0 |
| grass blades | 7k | 11k | 16k | 24k |
| projected vehicle/plane shadow | – | – | 512 | 1024 |
| draw distance (terrain grid; applied on reload) | 1× | 1× | ~1.12× | ~1.3× |

Tests (headless Chrome, 844×390, serve the repo on :18941; test-update uses :18931):
`node tools/test-plane.cjs` (23 checks), `node tools/test-gfx.cjs` (11 checks + fps/triangles per level → `shots/gfx_perf.json`),
`node tools/test-ui.cjs` (35 checks incl. plane HUD), `node tools/test-update.cjs` (20 checks).


---
# SineRally – math-world offroad free-roam (FUEL-style)
Run: `python3 -m http.server 8000 --bind 0.0.0.0` in this folder, open http://localhost:8000 (or http://<PC-LAN-IP>:8000 on a phone on the same Wi-Fi). Live: https://leck-games.github.io/sinerally/

**Keys:** WASD/arrows drive · Space handbrake/drift · Shift boost · H arcade/normal handling · I cycle UI (full/minimal/none) · Q/E pitch in the air · R reset · M or Tab world map · V next vehicle · U edit UI layout · Shift+U unload logs · G cycle GFX · F fps/debug · Esc close map/menu/editor.
**Touch:** left joystick steer (+ up/down = air pitch), GAS/BRAKE/BOOST/DRIFT, ☰ menu (car selector, attachments, assists, time, weather, graphics, garage, engine sound + EDIT), tap the minimap for the world map, optional Tilt.
**URL options:** `?q=low|med|high` force GFX · `?dyn=0` disable dynamic resolution · `?tod=0..1` fix time of day (0.5 = noon) · `?wx=clear|rain|storm|fog|dust` · `?auto=1|drift|boost` self-driving test · `?dbg` · `?nopost` (debug).

## Update: harvester melt · wider roads · arcade handling · UI modes (2026-10-28)
- **Harvester head** (front mount; TIMBERWOLF default, also fits the BUGGY): instantly melts every tree, bush, cactus and
  **rock** in its path at any speed. You lose no speed and take no damage. Trees give 1 log per HP (up to the rack/head
  capacity). The old 25 km/h cut limit is gone. **Not melted:** terrain (hills, cliffs, banks), landmarks and beacons,
  fuel cans, bridges and water. Melted rocks stay gone (`localStorage.sinerally_rocks_gone`; ☰ → GARAGE → REGROW TREES &
  ROCKS brings them back). Penalty: **−10 % top speed** (shown in the picker). Physics caps v_max at 0.9× the same car
  without the head; the physics test checks the ratio per car (0.899–0.902).
- **Roads:** paved road half-width 6 → 12 m (hwy and loop now have 4 lanes, ~24 m wide). Dirt trails 3.6 → 5.4 m (×1.5).
  The surface mask, markings, bridges, minimap and world map all use the same widths.
- **Handling: ARCADE (default) vs NORMAL** (NORMAL is the former SIM model). ARCADE has NFS-Carbon/Trackmania-style
  assisted grip, easy drift entry with a held drift angle, counter-steer assist and drift → nitro. Each car keeps its own
  feel. Switch it while driving: ⚙ quick tray → HANDLING, ☰ → DRIVE, or key **H**. The choice is saved
  (`sinerally_handling`, `?handling=normal`). Touch steering has its own curve for each mode.
- **UI modes**: ⚙ quick tray → HUD, ☰ → CONTROLS & HUD, or key **I** cycles **FULL → MINIMAL** (driving essentials, small minimap, ARC
  button) **→ NONE** (everything hidden; the touch zones still work invisibly; a faint button brings the UI back). The
  mode is saved (`sinerally_ui`). Controls that don't apply hide themselves: UNLOAD n appears only with logs on board,
  and the temperature bar only when the engine is warm. Everything respects safe-area insets.
- **BOOST** touch button is bottom-left, under the left thumb next to the joystick (moved right). DRIFT takes BOOST's
  old slot. Shift still boosts.
- Tests: `node tools/test-update.cjs` (844×390 touch, 20 checks, screenshots `shots/upd_*.png`),
  `node tools/shot-road.cjs before|after`.

## Physics + Terrain merge (2026-10-28)
The two standalone modules are now part of the game, vendored unchanged with their contracts:
- **`js/phys/`** ← sinerally-physics (`tools/sync-physics.sh`, `js/phys/VERSION`, contract `js/phys/MODULE_API.md`):
  120 Hz rig (`createRig` / `rig.step`), 5 cars – BUGGY, TRUCK, QUAD, SINE GT (hyper), TIMBERWOLF (forester) – and
  attachments (bull bar, roof lights, log rack, harvester head). ☰ → car selector with 3D preview and attachment picker;
  choice saved (`srp_vehicle`, `srp_attach_<id>`). Engine temperature gauge with HOT / OVERHEAT / ENGINE CUT, damage,
  ☰ → GARAGE (repair, unload, regrow trees, put out fires). Harvester: crawl into a tree (<12 km/h) to fell it, 12 logs per rack, Shift+U unloads.
- **`js/terrain/`** ← sinerally-terrain (`tools/sync-terrain.sh`, `js/terrain/VERSION`, contract `js/terrain/MODULE_API.md`):
  biomes (forest, grassland, savanna, desert, alpine…), ground rings + GPU grass (keeps the 7996819 engine-build grass look),
  trees with **3 HP** (damage from impact speed/angle: ≤30 km/h none, 200 km/h head-on −2, ≥300 km/h through), HP labels on
  damaged/nearby trees, **grass fire** (an overheating engine ignites dry grass; rain/storm puts it out; forest, road and water
  don't burn), **forest weather** (spatial rain heavier in forests, storms) and the day/night sky. One weather system – the
  game's menu/`?wx=`/`?tod=` map onto `T.setRain` / `T.setTimeOfDay`; fog/dust are an overlay on top (no second rain).
- **One event bus** (`js/phys/host/bus.js`): physics, terrain and game publish on it; everything is forwarded to `SR.on`
  so sound plugins can hear `tree:damage`, `tree:destroyed`, `engine:hot`, `engine:overheat`, `harvester:*`, `crash`, `land`… .
- Kept: sound plugin host, world map, vistas/landmarks, fuel cans, day/night, comic post pass on all GFX levels, iOS
  home-screen metas, launcher link. Removed (replaced by the modules): `js/vehicle.js`, `js/grass.js`, `js/roads.js`.
- **Engine editor** (parity with the [Engine Sim demo](https://leck-games.github.io/sinerally-enginesim/)): ☰ → SOUND →
  **🎛 OPEN ENGINE EDITOR**. Demo engine diagram (vendored `viz.js`, tap a cylinder to edit it) + firing timeline; presets;
  layout / cylinders / bank angle / crank / 4- or 2-stroke / firing order (+ DEFAULT ORDER, RECOMPUTE ANGLES, `#n@angle°`
  readout with intervals); per cylinder vol, tone, shape, runner, misfire, rough, fire slot, angle + position (custom layout),
  APPLY TO ALL, CLEAR MISFIRES; displacement, idle, redline, limiter, inertia, induction, pops; master, exhaust vol,
  muffler, runner reso, single/dual exhaust, crossover, intake/mech/induction vol, light-sync offset; car mass + final
  drive; JSON export (raw config — pastes straight into the demo) / import (demo or game JSON); RENDER 6 s WAV.
  **PREVIEW: BENCH** (car paused, hold REV / NITRO) or **DRIVE** (the panel moves between the touch controls, edits are
  live while you drive or fly; ▾ shrinks it to a 36 px firing-lights strip). Auto-saved per vehicle — every car and every
  plane has its own config — in `localStorage.sinerally_sndcfg1`; RESET returns to the preset. Only shown if the active
  plugin has `setConfig/getConfig` (PLUGIN_API.md §1a); other plugins and the fallback are unchanged (API v1).
- `tools/sync-enginesim.sh` vendors plugin + `viz.js` from engine-sim and re-applies `tools/enginesim-local.patch` (plane presets).
- Tests (serve on :18931): `node tools/test-merge.cjs` (merge e2e + `shots/merge_*.png`), `node tools/test-terrain.cjs`
  (terrain e2e adapted to the game), `node tools/test-sound.cjs`; physics unit tests live in sinerally-physics (`node tests/unit.mjs`).

## Engine sound (plugin API v1)
- **Engine sound is back, as a plugin.** The game hosts *Engine Sound Plugins*: plain ES modules with
  `create(ctx, destination, options) → { update(telemetry, dt), event(name, data), dispose() }`. Maker docs:
  [`PLUGIN_API.md`](PLUGIN_API.md); module overview: [`MODULE_API.md`](MODULE_API.md).
- Built in: **Engine Sim** (`plugins/enginesim/`, vendored from
  [sinerally-enginesim](https://github.com/leck-games/sinerally-enginesim), 11 presets, AudioWorklet) and a ~45-line
  **example** (`plugins/example-simple-engine.js`).
- **☰ menu → ENGINE SOUND:** pick plugin, preset (remembered per vehicle; defaults buggy Boxer-4, truck V8, quad dirt
  bike), volume, mute, or load your own script by **https URL** or **local .js file**. Bad scripts fall back to Engine Sim
  with the error shown. 🔊 top button: first tap enables sound, then toggles mute. Settings in `localStorage`.
- ⚠ Custom scripts run with full page privileges – only load code you trust.
- Test: `node tools/test-sound.cjs` (see PLUGIN_API.md §7). Screenshots: `shots/sound_*.png`.

## Free-roam release
- **Comic style everywhere, including Low on phones:** every level now runs the ink post pass (depth + normal edges, posterize,
  halftone/grain) with harder 3-step cel bands, blue-violet shadow tint, stronger hatching, a silhouette ink rim on objects and
  a punchier palette. Edges fade with distance so the horizon stays clean. See `shots/next_1_style_before_after.png`.
- **GFX levels:** Low (pixel ratio 1, 7k grass), Med (1.5, 11k, **phone default**), High (2, desktop default). Dynamic
  resolution scales the render 0.5–1× to hold 30 fps on touch devices (50 on desktop) and steps the level down if needed
  unless you picked one yourself (saved in `sinerally_q3`).
- **Breakable scenery** *(superseded: trees now have HP, see the 2026-10-28 merge)*: trees, bushes, small props and cacti vanish instantly when hit (ink puff, small slowdown: trees 8 %,
  cacti 5 %, shrubs 2 %). Broken ones are stored as hash ids in a `Set` and stay gone. Big rocks stay solid.
- **Handling:** speed-sensitive, smoothed touch steering; stability assist (default on for touch) and traction control
  (menu); fixed the 1st-gear hold under wheelspin; terminal-speed drag and fall drag; softer landings; per-step force clamp
  so a wheel wedged on a cliff can't fling the car.
- **3 vehicles:** buggy, truck (heavy, grippy), quad (light, fast) – menu or V, saved. *(now 5, see the 2026-10-28 merge)*
- **Day/night** (12 min cycle, or fixed Day/Sunset/Night) with moonlight and headlights; **weather** (clear, rain, fog,
  dust) that changes grip and view distance.
- **Fuel cans** scattered across the world refill boost; collected cans are saved in localStorage.
- **Vistas:** a landmark beacon on the highest spot of each 1.2 km cell. Discover them by driving close; they show on the
  minimap and world map, and discovered vistas can be teleported to from the world map.
- **World map** (M/Tab or tap the minimap): hillshade map with roads and vistas, zoom, tap to set a waypoint (HUD arrow +
  distance); physics pause while it is open.
- **Audio:** see *Engine sound* above. The vehicle exposes read-only telemetry at `window.SR.telemetry` (see `MERGE_NOTES.md`).
- Screenshots: `shots/next_*.png`.

## Merged build (previous version – `js/vehicle.js`, `js/grass.js`, `js/roads.js` were replaced by the modules on 2026-10-28)
One build = the engine pass (from leck-games/sinerally-engine) rendered entirely with the comic/Borderlands shading:
- **Physics** (`js/vehicle.js`): 120 Hz rigid-body 4x4 – raycast spring/damper suspension per wheel, slip-ratio/slip-angle
  tyre model with per-surface grip (asphalt, dirt, grass, sand, rock, snow, mud), 6-speed auto gearbox with torque curve,
  handbrake drift, boost, air pitch control, rollover assist, tree/rock collisions.
- **World** (`js/world.js`): 20×20 km, five blended regions (hills, plains, dunes, canyon, alpine with snow line), rivers,
  highway/trail road graph with bridges (`js/roads.js`), sine race loops with checkpoint gates.
- **Terrain**: near ring-buffer grid (4 m) + far grid (16 m, ~770 m view radius) – only new rows/columns are sampled per move.
  Both use `gridTerrainMat` (cel bands, hatching, ink normal codes) with per-surface comic detail (grass patches,
  sand ripples, rock strata, snow drifts, dirt clods). Water (shore foam / depth bands) is drawn on both grids.
- **Roads/bridges**: textured ribbons with comic lighting; asphalt is lifted and polygon-offset above trails so trails no
  longer paint over highways at crossings. Highways no longer dam narrow rivers at grade crossings (the road profile now
  sub-samples between 30 m stations to detect water and raises bridges there).
- **Grass** (`js/grass.js`): GPU-instanced clumps on a toroidal tile, cel-toned, wind-animated; the post pass draws only
  faint ink on blades (alpha code 0) so fields don't turn into scribbles. Count scales with GFX level.
- **Scenery**: engine region rules (alpine pines, hills/plains broadleaf + poplars + bushes, dune cacti/shrubs, big red
  canyon rocks) placed with the graphics build's models (4 trees, 2 rocks, 2 cacti), instanced with hull outlines.
- **Car**: the code-built buggy (steering front wheels, roll cage, boost flame) is driven by the vehicle physics: body on
  the rigid-body frame, wheels at the raycast suspension positions/spin/steer. Dust puffs per surface colour, skid marks
  from rear-tyre slip (on decks too), landing puff ring + camera shake, FOV kick + speed lines on boost.
- **HUD**: comic speed/boost/air, inked minimap with roads, new comic tacho gauge (gear, rpm, surface under the tyres).
- **GFX toggle** (button / G): Low (phone default: pr 1, no post, hull outlines, 7k grass), Med (pr 1.25, post pass),
  High (desktop default: pr 1.5, post, 16k grass, longer scenery radius). Saved in localStorage (`sinerally_q2`).
- Low-mode colour fix: the WebGL canvas alpha carries the ink normal code; the canvas now has a black backing so Low
  (no post pass) shows exact colours instead of blending with the page background.
- Screenshots: `shots/merged_*.png`.

## Earlier notes (pre-merge)
### Original math engine (v1)
- `height(x,z)` = continental low-frequency sines (`hLow`) + 6 octaves of `a·sin(u+p)·cos(0.83v−p)` along rotated axes (u,v), with domain warping (x,z offset by sines), + cubed ridge field for mountains. No heightmap is stored anywhere.
- Tracks: the world is cut into 3 km lattice cells; each cell gets one closed polar curve `r(θ)=R(1+0.22 sin(kθ+p1)+0.12 sin((k+1)θ+p2))`, parameters from a sine hash of the cell index → unlimited tracks. Distance to the curve (radial) gives weight w (smoothstep); height blends toward smooth `hLow` so tracks are flattened dirt roads.
- Normals: central finite differences of `height`. Colour/biome: water/sand/grass/rock/snow from height, slope (normal.y) and extra sine fields; dirt where w>0.
- Rendering: a 144×144 grid (8 m spacing, ~1.15 km) snaps to the player and its vertices are recomputed from `height()`; fog hides the edge. Trees/rocks: hash per 14 m cell → 3 InstancedMeshes. ~11 draw calls total.
- Physics uses the same `height()`: 4 wheel samples → ground plane, spring/damper, ballistic flight off crests (airtime refills boost), lateral grip (low when drifting), tree/rock circle collisions.
- Race: 8 gates on the nearest track (white = start). Drive through start → checkpoints in order → back to start. Best laps in localStorage (`sinerally_best`). World is ±10 km (rising rim beyond).

## Comic / cel-shaded rendering (v2)
- `js/shaders.js` – every material is a custom ShaderMaterial sharing one `COMIC` GLSL chunk:
  3-band cel lighting with a hard terminator and cool shadow tint, screen-space hatching / crosshatching
  in shadows, atmospheric tint toward the horizon colour (no grey fog).
- Terrain shader: grass patches, sand ripples, sandstone strata, sine snow line, dirt tracks with tyre ruts
  (from `trackSD`, the signed distance to the nearest sine track). Water shader: shore foam rings and depth
  colour derived from the same `height()` function, toon specular glints.
- Sky: posterized gradient, inked sun, procedural flat clouds with outlines.
- Post pass (Med/High): ink outlines from depth Laplacian + normal-code edges, slight posterize, saturation,
  halftone dots in darks, paper grain, speed lines on boost, vignette.
- `js/models.js` – code-built low-poly buggy (roll cage, steering wheels with suspension travel), tree and
  rock variants, gates / tyre stacks / signs along tracks. Scenery sways in the wind.
- Quality toggle: `GFX` button or `G` key cycles Low / Med / High (saved in localStorage).
  Low = pixel ratio 1, no post pass, inverted-hull outlines; Med (mobile default) = 1.25, post pass;
  High (desktop default) = 1.5, post pass, longer scenery radius. ~17 draw calls.
- Tracks now blend into the terrain with embankments that widen with cut depth (no sheer canyon walls).
