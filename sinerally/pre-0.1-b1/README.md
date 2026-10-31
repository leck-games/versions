# SineRally – math-world offroad prototype
Run: `python3 -m http.server 8000 --bind 0.0.0.0` in this folder, open http://localhost:8000 (or http://<PC-LAN-IP>:8000 on a phone on the same Wi-Fi).
Controls: WASD/arrows drive, Space drift (handbrake), Shift boost, R reset, F fps/debug. Touch: left joystick steer, GAS/BRAKE/BOOST/DRIFT buttons, optional Tilt toggle (landscape).

## Math engine (js/world.js)
- `height(x,z)` = continental low-frequency sines (`hLow`) + 6 octaves of `a·sin(u+p)·cos(0.83v−p)` along rotated axes (u,v), with domain warping (x,z offset by sines), + cubed ridge field for mountains. No heightmap is stored anywhere.
- Tracks: the world is cut into 3 km lattice cells; each cell gets one closed polar curve `r(θ)=R(1+0.22 sin(kθ+p1)+0.12 sin((k+1)θ+p2))`, parameters from a sine hash of the cell index → unlimited tracks. Distance to the curve (radial) gives weight w (smoothstep); height blends toward smooth `hLow` so tracks are flattened dirt roads.
- Normals: central finite differences of `height`. Colour/biome: water/sand/grass/rock/snow from height, slope (normal.y) and extra sine fields; dirt where w>0.
- Rendering: a 144×144 grid (8 m spacing, ~1.15 km) snaps to the player and its vertices are recomputed from `height()`; fog hides the edge. Trees/rocks: hash per 14 m cell → 3 InstancedMeshes. ~11 draw calls total.
- Physics uses the same `height()`: 4 wheel samples → ground plane, spring/damper, ballistic flight off crests (airtime refills boost), lateral grip (low when drifting), tree/rock circle collisions.
- Race: 8 gates on the nearest track (white = start). Drive through start → checkpoints in order → back to start. Best laps in localStorage (`sinerally_best`). World is ±10 km (rising rim beyond).
