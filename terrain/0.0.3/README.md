# Sine Rally · Terrain generator module (standalone test build)

Live test page: https://leck-games.github.io/sinerally-terrain/. Run locally with `python3 -m http.server 8137` and open http://localhost:8137/.

This is the terrain module of Sine Rally as its own ES module (`terrain/`) with a test harness (`index.html`, `test/`). It uses Three.js r160 from `vendor/` and has no build step.
- **World**: the game's pure sine-sum world. It adds a biome layer (dry grassland, savanna, forest, plus the game's desert, canyon and alpine) without changing any heights.
- **Trees**: placed by hash per biome, with 6 species. Each tree has 3 HP, shown as lean, cracks and tint. Trees burn, scorch and char, and at 0 HP they despawn for good.
  - Rendering: up to 110 m as instanced meshes, up to 330 m as impostor cards, and beyond that the far terrain paints a cel canopy.
- **Fire**: inspired by Far Cry 2. It spreads only through dry grass, driven by wind (with spotting) and slope.
  - It starts from the `engine:hot` / `engine:overheat` events or from the API.
  - Rain puts it out, and burnt ground persists.
  - Fire is drawn with comic flames, smoke puffs, embers and a glow at night.
- **Forest weather**: inspired by MSFS, in a Borderlands comic style.
  - Clouds: cumulus fields, a stratus deck, halftone cloud shadows.
  - Rain: rain cells with shaft curtains, rain streaks, wet ground and puddles.
  - Atmosphere: fog, lightning, a day/night cycle.
- **Comic look**: cel bands, hatching, halftone and an ink post pass ported from the game.

## Test page
- **Camera and movement**:
  - FLY mode: WASD/arrows, E/Q up/down, Shift fast, drag to look.
  - DRIVE mode: a stub car with W/S throttle and A/D steer. It hits trees using the 3-HP rule, and above 300 km/h it zooms through.
  - Touch pad on phones.
- **Controls**:
  - biome teleports
  - wind direction and speed
  - IGNITE (at the aim point), HOT ENGINE (`engine:hot` every 0.5 s), OVERHEAT
  - rain auto/on/storm/off, lightning
  - time slider and cycle
  - HIT TREE / BURN TREE / RESET
- **Overlays**: fps, draw-call and status overlay; event log.
- **URL params**:
  - `?clean` hides the UI
  - `q=low` uses phone settings
  - `tod=0..1` sets the time of day
  - `rain=auto|on|storm|off`
  - `biome=forest|grassland|…`
  - `mode=drive`
  - `persist` keeps removed trees and burnt ground in localStorage
- `window.__tt` exposes test hooks.

## Tests
Run `node test/e2e.mjs`. It needs `playwright-core` and Chrome, and the server on :8137. It runs headless Chrome with SwiftShader and checks:
- the console stays clean
- grass fire spreads (13 → 267 cells in 15 s), and no cell burns without fuel
- forest, road and water don't ignite
- a storm puts fire out (27 → 0), and wet ground won't relight
- the HP bus sequence goes 3 → 2 → 1 → gone
- the speed/angle rule table
- at 350 km/h the car zooms through (39 trees removed over 145 m), and at 60 km/h it damages a tree without removing it

It then renders `test/shots.json` into `shots/` and measures fps. Results are in `shots/results.json`.

Screenshots: `shots/01-forest-clouds-rain.png`, `02-cloud-shadows`, `03-grassland-fire`, `04-burnt-ground`, `05-burning-trees-night`, `06-tree-hp-states`, `07-test-page-ui`.

## Road widths (v2)
Roads were widened. Half-widths live in `terrain/world.js` as `ROAD_HW` (the old values are in `ROAD_HW_V1`):

| road | old full width | new full width | factor |
|---|---|---|---|
| paved highway | 12 m | 24 m (2 lanes each way, lane dashes) | 2× |
| dirt trail | 7.2 m | 10.8 m | 1.5× |
| dirt race loop | 16 m (about 14.7 m drivable) | 24 m | 1.5× |

- Everything derives from `e.hw`: the mesh ribbon, grade flattening (`hw + 1.5` core), the shoulder fade (`hw+0.5 … hw+2.5`), bank, bridge deck, rails and piers, and the tree/rock/grass/fuel masks.
- Bridges now also probe the water at both road edges (±hw), so a river under one edge of a wide road gets a bridge, not a fill.
- Race loops now measure the perpendicular distance (it used to be radial), so the drivable width matches the mesh. `trackW()` scales with the loop width.
- Junction pads at road-graph nodes are unchanged; a node in water still gets a small raised pad.

Run `node test/roads.mjs` (Node only, no browser). It measures the median width over about 2,700 cross-sections, checks that the masks follow the width, that bridge decks span the full width, and that water stays under the decks.

## Performance (honest)
All numbers come from SwiftShader **software** rendering on a CPU-only server. They are **not** device numbers:
- 1280×720: about 10.6 fps, 18 draw calls, about 375k tris
- 390×844 with `q=low`: about 11.6 fps, 17 draw calls, about 333k tris

It has not been measured on an iPhone 12. The design aims for 30 fps on that phone:
- the main buffers are instanced, with roughly 20 draw calls
- per-frame CPU work is capped (fire runs at most 3 steps per frame; clouds rebuild only every few metres or seconds)
- grass and grid density are lower when `small` is set

If the phone is short of 30 fps, the first levers are the triangle count (near-grid resolution, the number of tree LODs) and a dynamic pixel ratio.

## Known issues
- The fire window is about 288 m around the focus. Fires further than about 144 m from the car are dropped when the window recentres. Burnt ground is kept.
- Rain cells are deliberately patchy, so even `storm` leaves a few dry spots.
- Puddles also appear in some dry-weather forest scenes, because the wetness from earlier rain dries slowly.
- A faint line can show where the far terrain grid meets the sky.
- Lean and cracks are subtle beyond about 30 m.
- `extinguishAll()` clears ground fire only. Trees that are already burning keep burning until they char or the rain puts them out.
