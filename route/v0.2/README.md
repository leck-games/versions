# SineHighway V0.2

(Formerly **Sine Rally Route**; the repo moved from `leck-games/sinerally-route` to `leck-games/sinehighway`, and old GitHub links redirect.)

An endless, curvy, Route-66-style two-lane road through changing biomes. It is a fork of
[leck-games/sinerally-ui](https://github.com/leck-games/sinerally-ui). The fork keeps the ui history; the upstream repo and the frozen
[leck-games/sinerally](https://github.com/leck-games/sinerally) are untouched.

- **Play:** https://leck-games.github.io/sinehighway/ (Three.js r160, plain ES modules, no build step).
- **All builds:** https://leck-games.github.io/versions/
- **Version:** set in `js/version.js`, which drives the page title and the menu tag "SineHighway V0.2".

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
- **Gearbox (V0.2):**
  - **Auto** (default): holding the throttle shifts up gear by gear to the **top gear and stays there**. It also does this at the drag/speed-limit equilibrium and on long grades, where the old box stopped in 3rd–5th. Downshifts happen only after lifting off, when braking, or when the engine is about to lug below idle (a stall guard). Normal shift points and acceleration are unchanged.
  - **Manual:** ☰ → CONTROLS & HUD → GEARBOX [Auto | Manual], saved as `srroute_gearbox`.
    - On touch, a quick swipe **up** or **down** on the gas pedal shifts up or down (32 px within 300 ms). Your finger keeps holding the throttle. One swipe changes one gear.
    - On a keyboard, **X** shifts up and **Z** shifts down (on a German QWERTZ keyboard the Z key is labelled **Y**).
    - There are no automatic shifts in Manual. The rev limiter holds at redline, and a downshift that would over-rev is refused.
    - Braking to a stop drops to 1st, so the engine never stalls. At a standstill, shifting down from 1st selects **R**, and shifting up from R selects 1st. Holding the brake at a standstill still reverses, as before.
    - The HUD gear readout flashes and enlarges on each shift, and a blue **M** marks manual mode. The engine sound follows the shift events.
    - The autopilot always uses the auto box.
- **Autopilot:** ⚙ tray → AUTO, key **O**, or `?auto=1`. It steers by pure pursuit on the right-lane centre with a curvature speed limit.

## Controls
WASD/arrows to drive · Space drift · Shift boost · **X / Z** gear up / down (manual gearbox) · **R** reset to road · **O** autopilot · H handling · V next vehicle · G graphics · F FPS · I HUD mode · U edit HUD.
On touch screens, use the on-screen pedals and stick (iPhone landscape). With the manual gearbox, swipe up or down on the gas pedal to shift. ☰ opens the menu.

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
| `gearbox=auto\|manual` | gearbox mode for this load (overrides the saved setting) |

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
| `js/phys/` | vendored physics + vehicles + attachments. One local change is kept in `tools/physics-local.patch` (the gearbox), and `tools/sync-physics.sh` re-applies it |
| `js/engine-audio.js`, `plugins/`, `js/sound-editor.js`, `js/power*.js` | engine sound plugin host (see `PLUGIN_API.md`), sound editor, power curves |

The event bus is `window.SR`: `SR.on('biome', fn)` receives `{ biome, title, s }`, and `SR.telemetry` holds speed and rpm data for the sound plugins.
Settings are stored under the `srroute_*` localStorage keys, separate from sinerally-ui on the shared github.io origin. The prefix was kept through the rename to SineHighway, so existing settings carry over.

## Tests (headless Chrome, swiftshader)
`bash tools/run-tests.sh`. This needs `google-chrome` and `puppeteer-core`; `CHROME` and `PPTR` override their paths (see `tools/lib.cjs`).
| Test | Checks |
|---|---|
| `tools/test-gearbox.cjs` | Node physics (`tools/gearbox-sim.mjs`): every vehicle × arcade/normal × stock/10000 hp held at full throttle for 65 s on the flat and on 6% and 10% climbs reaches top gear with no downshift after it. Braking steps down to 1st. At 20 hp there is no hunting. Manual checks: no auto shifts, the limiter, the over-rev guard, and R. In the browser: the GEARBOX row is saved and persists, touch swipes on the pedal shift while the throttle stays held, slow drift does not shift, the X/Z keys work, and auto mode is unchanged |
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
- Holding top gear gives a stock top speed about 5–10% lower on the flat than the old box, which stayed in 3rd–5th near redline. That is the trade-off of holding the highest gear. 10000 hp builds are unchanged.
- 20 hp builds accelerate very slowly (2nd–3rd after 2 min) and cannot climb a 10% grade.
- Settings from earlier sinerally-ui sessions are not migrated, because this fork uses new storage keys.

The previous sinerally-ui README (its full feature history) is kept as `README-sinerally-ui.md`. `MERGE_NOTES.md`, `MODULE_API.md` and `PLUGIN_API.md` describe the inherited modules.
