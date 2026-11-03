# Sine Rally Route V0.1

An endless, curvy, Route-66-style two-lane road through changing biomes. It is a fork of
[leck-games/sinerally-ui](https://github.com/leck-games/sinerally-ui). The fork keeps the ui history; the upstream repo and the frozen
[leck-games/sinerally](https://github.com/leck-games/sinerally) are untouched.

- **Play:** https://leck-games.github.io/sinerally-route/ (Three.js r160, plain ES modules, no build step).
- **All builds:** https://leck-games.github.io/versions/
- **Version:** set in `js/version.js`, which drives the page title and the menu tag "Sine Rally Route V0.1".

## What it is
- **One endless road:** procedural and deterministic by seed (`?seed=`, default 66). There is no world edge, rim, city grid or side road. The world is the route.
  - The route is a z-monotonic chain of arcs and straights: heading ≤ 66°, minimum radius ≈140 m, two lanes with a centre line and shoulders.
  - **Grades** are capped at 10% (12% hard cap; measured max is about 6% over 60 km).
  - Deep cuts become **tunnels**, with portals, light strips and walls the car collides with. Deep fills and water become **bridges** (deck, rails, piers).
  - Terrain always yields to the road: the ground is graded to the road bed with smooth shoulders, carved at tunnel mouths and kept clear under bridges.
- **Chunked streaming:**
  - The road, ground, trees and props are built in 256 m chunks around the car.
  - Chunks behind the car are disposed of (geometry, materials and instances).
  - A 60 km run peaks at about 21 live chunks.
- **Floating origin:**
  - All rendering and physics run in local coordinates.
  - When the car is more than 1080 m from the origin, the whole world (car, camera, chunks, particles and props) is shifted by a 720 m grid step in one frame.
  - Tested: 50+ km with 33 rebases, no camera jump, and the error kept at float32 precision.
- **Biomes:** a new biome every ≈3–6 km, blended over ±200 m. The biomes come in seeded, shuffled cycles of all five, with no biome repeating back to back. The route starts in prairie. Each biome has its own terrain shape, ground tint, tree mix and sky/fog/sun:
  - **Prairie:** rolling grass and sparse broadleaf trees.
  - **Red-rock desert:** flat sand with **mesas** and buttes, **cactus impostors** and rocks.
  - **Forest:** dense conifers and broadleaf trees.
  - **Snowy mountains:** high relief, snow on the high ground and slopes, and conifers. This biome has the most tunnels and bridges.
  - **Coast:** low dunes, sea on one side and **palm impostors**.
- **Sparse props:**
  - Delineator posts.
  - **Mile markers** every mile.
  - A biome welcome sign at each boundary.
  - The occasional **diner** or **gas station** on a pull-out.
  - Everything is instanced or merged per chunk, so the GPU cost stays low.
- **HUD:**
  - The **route strip** (top centre) shows km driven, the current biome, and the next biome with its distance. A progress bar runs through the current biome.
  - An "ENTERING …" banner shows at each boundary.
  - The map, minimap, compass and checkpoints were removed.
  - Kept: cars and the vehicle picker, attachments, the power panel, the sound editor and plugins, the HUD layout editor, and settings (graphics, time, weather, sky, handling, assists).
- **Autopilot:** ⚙ tray → AUTO, key **O**, or `?auto=1`. It steers by pure pursuit on the right-lane centre with a curvature speed limit.

## Controls
WASD/arrows to drive · Space drift · Shift boost · **R** reset to road · **O** autopilot · H handling · V next vehicle · G graphics · F FPS · I HUD mode · U edit HUD.
On touch screens, use the on-screen pedals and stick (iPhone landscape). ☰ opens the menu.

## URL parameters
| Param | Meaning |
|---|---|
| `q=low\|med\|high\|ultra` | graphics quality (default: Med on touch, High on desktop) |
| `dyn=0` | disable dynamic resolution |
| `seed=N` | route seed (default 66) |
| `s=M` | start at route distance M metres |
| `auto=1` | start with the autopilot on (`apv=` sets the autopilot target speed, m/s) |
| `wx=clear\|…`, `tod=0..1`, `sky=` | weather, fixed time of day, sky preset |
| `car=id`, `handling=arcade\|normal` | vehicle and handling mode |

## Performance (iPhone 12 Safari target)
- Measured headless at q=high: 25–40 draw calls and 100–185k triangles in every biome.
- Each quality tier has a budget that `tools/test-perf.cjs` enforces: Low ≤ 80 calls / 250k triangles, Med ≤ 90 / 350k, High ≤ 120 / 500k.
- Trees are instanced comic LODs, and cactus and palms are camera-facing impostors.
- Props are merged per chunk, and the shadows are a single cheap vehicle blob plus a baked look.
- Dynamic resolution (Auto) is still active on touch devices.

## Architecture
| File | Role |
|---|---|
| `js/terrain/world.js` | **Route + world function:** seeded route segments (arcs/straights), `routePoint(s)`, `project(x,z)` (local → route s/d), the vertical profile with grade cap, tunnel/bridge features (`featuresIn`), biome layout (`biomeAt`, `biomeWeights`, `BLEND = 200`), `sample(x,z)` height/surface/colour, floating `origin` + `rebase` |
| `js/terrain/index.js`, `ground.js`, `roads.js`, `trees.js`, `weather.js` | chunk streamer (256 m chunks along the route, dispose behind), ground mesh, road/tunnel/bridge meshes, trees + impostors, biome sky/fog |
| `js/props.js` | delineators, mile markers, biome signs, diners/gas stations (merged per chunk) |
| `js/main.js` | game shell: renderer, quality tiers, camera, physics host, autopilot, rebase hook, route strip HUD, menus, test hooks (`window.__st`) |
| `js/phys/` | vendored physics + vehicles + attachments (unchanged) |
| `js/engine-audio.js`, `plugins/`, `js/sound-editor.js`, `js/power*.js` | engine sound plugin host (see `PLUGIN_API.md`), sound editor, power curves |

The event bus is `window.SR`: `SR.on('biome', fn)` receives `{ biome, title, s }`, and `SR.telemetry` holds speed and rpm data for the sound plugins.
Settings are stored under the `srroute_*` localStorage keys, separate from sinerally-ui on the shared github.io origin.

## Tests (headless Chrome, swiftshader)
`bash tools/run-tests.sh`. This needs `google-chrome` and `puppeteer-core`; `CHROME` and `PPTR` override their paths (see `tools/lib.cjs`).
| Test | Checks |
|---|---|
| `tools/test-road.cjs` | 60 km at 1 m steps: position/heading continuity, grade ≤ 12% over 20 m, curve radius, lane surface = road, project round-trip, tunnels + bridges exist, chunk disposal, determinism (same seed equal, other seed differs) |
| `tools/test-drive.cjs` | autopilot drives 50+ km (fast fixed-step sim, then rendered): never off the road, no stuck, no crash, all 5 biomes visited |
| `tools/test-rebase.cjs` | rendered drive through the rebase at the start and at 60 km: no camera jump, s continuous, local coords bounded, float32 precision |
| `tools/test-biomes.cjs` | boundaries over 80 km, all biomes, segment lengths, weights sum to 1, 50/50 at the boundary, pure biome ±220 m away, rendered crossing (event, banner, sky shift) |
| `tools/test-perf.cjs` | default URL loads with the right version and no console errors, plus draw-call/triangle budgets and an fps sanity check for low/med/high in every biome |

Screenshots: `node tools/shots.cjs` writes to `shots/` (gitignored).

## Known issues
- Headless fps under swiftshader is only about 4–9 (a software GPU). The real-device number needs checking on an iPhone 12, but the scene budget is small (≤ 40 draw calls, < 190k triangles).
- The odometer counts only real driving; teleports with `?s=` or R-reset are not counted.
- Mountain valley floors near a coast boundary can show green grass during the blend.
- Settings from earlier sinerally-ui sessions are not migrated, because this fork uses new storage keys.

The previous sinerally-ui README (its full feature history) is kept as `README-sinerally-ui.md`. `MERGE_NOTES.md`, `MODULE_API.md` and `PLUGIN_API.md` describe the inherited modules.
