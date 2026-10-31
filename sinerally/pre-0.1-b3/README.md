# SineRally – math-world offroad (merged release: engine + comic graphics)
Run: `python3 -m http.server 8000 --bind 0.0.0.0` in this folder, open http://localhost:8000 (or http://<PC-LAN-IP>:8000 on a phone on the same Wi-Fi). Live: https://leck-games.github.io/sinerally/
Controls: WASD/arrows drive, Space handbrake/drift, Shift boost, Q/E pitch in the air, R reset, G cycle GFX, F fps/debug.
Touch: left joystick steer (+ up/down = air pitch), GAS/BRAKE/BOOST/DRIFT buttons, optional Tilt toggle (landscape).
URL options: `?q=low|med|high` force GFX level, `?dbg` debug overlay, `?auto=1|drift|boost` self-driving test mode.

## Merged build (this version)
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
