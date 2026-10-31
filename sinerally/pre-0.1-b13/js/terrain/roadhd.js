// HIGH/ULTRA road surfaces: procedural hi-res asphalt + dirt (colour map and normal/roughness map), generated once per level on demand.
// Asphalt tile = full 24 m highway width x 48 m; dirt tile = full trail width x (2x width). Pixels are square in metres on highways.
// Colour: aggregate + stones, repair patches (inked seams), cracks, worn lane paint, polished tyre tracks, crumbly edges.
// Normal/roughness: rg = tangent-space normal xy, b = roughness (paint + tyre tracks smoother, cracks/gravel rough).
function rng(seed) { return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296; }
function vgrid(gw, gh, r) { // tiling value noise on a gw x gh lattice; sample with (x, y) in lattice units
  const g = new Float32Array(gw * gh); for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => { const xi = Math.floor(x), yi = Math.floor(y); let fx = x - xi, fy = y - yi; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    const x0 = ((xi % gw) + gw) % gw, x1 = (x0 + 1) % gw, y0 = ((yi % gh) + gh) % gh, y1 = (y0 + 1) % gh;
    const a = g[y0 * gw + x0], b = g[y0 * gw + x1], c = g[y1 * gw + x0], d = g[y1 * gw + x1]; return a + (b - a) * fx + (c - a + (a - b + d - c) * fx) * fy; };
}
function mask(W, H, draw) { // vector features drawn with canvas 2D (white on black), returned as a Float32 0..1 array
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H); g.fillStyle = g.strokeStyle = '#fff'; draw(g);
  const d = g.getImageData(0, 0, W, H).data, m = new Float32Array(W * H); for (let i = 0; i < m.length; i++) m[i] = d[i * 4] / 255; return m;
}
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function finish(W, H, col, hgt, rough, bump) { // -> { col, nrm } RGBA byte arrays
  const C = new Uint8Array(W * H * 4), Nm = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, xl = x > 0 ? i - 1 : i, xr = x < W - 1 ? i + 1 : i, yu = y > 0 ? i - W : i + W * (H - 1), yd = y < H - 1 ? i + W : i - W * (H - 1);
    let nx = (hgt[xl] - hgt[xr]) * bump, ny = (hgt[yu] - hgt[yd]) * bump; const l = Math.hypot(nx, ny, 1); nx /= l; ny /= l;
    C[i * 4] = clamp01(col[i * 3]) * 255; C[i * 4 + 1] = clamp01(col[i * 3 + 1]) * 255; C[i * 4 + 2] = clamp01(col[i * 3 + 2]) * 255; C[i * 4 + 3] = 255;
    Nm[i * 4] = (nx * 0.5 + 0.5) * 255; Nm[i * 4 + 1] = (ny * 0.5 + 0.5) * 255; Nm[i * 4 + 2] = clamp01(rough[i]) * 255; Nm[i * 4 + 3] = 255;
  }
  return { col: C, nrm: Nm, w: W, h: H };
}
export function asphaltHD(W, H) { // 24 m x 48 m
  const r = rng(1234), ppm = W / 24, ny = H / 48, n6 = vgrid(4, 8, r), n1 = vgrid(24, 48, r), n03 = vgrid(80, 160, r), nw = vgrid(48, 96, r);
  const px = m => m * ppm, py = m => m * ny;
  // repair patches + cracks (inked seams), lane paint
  const patches = [];
  for (let k = 0; k < 7; k++) patches.push([1.5 + r() * 18, r() * 44, 1.2 + r() * 3.5, 1.5 + r() * 5]);
  const patch = mask(W, H, g => { for (const [x, y, w, h] of patches) g.fillRect(px(x), py(y), px(w), py(h)); });
  const seam = mask(W, H, g => { g.lineWidth = Math.max(1, ppm * 0.05); for (const [x, y, w, h] of patches) g.strokeRect(px(x), py(y), px(w), py(h)); });
  const crack = mask(W, H, g => { g.lineCap = 'round';
    for (let k = 0; k < 26; k++) { let x = r() * 24, y = r() * 48, a = r() * 6.28; g.lineWidth = Math.max(1, ppm * (0.025 + r() * 0.03)); g.beginPath(); g.moveTo(px(x), py(y));
      const n = 6 + r() * 14; for (let i = 0; i < n; i++) { a += (r() - 0.5) * 1.6; x += Math.cos(a) * 0.35; y += Math.sin(a) * 0.35; g.lineTo(px(x), py(y)); if (r() < 0.12) { g.stroke(); g.beginPath(); g.moveTo(px(x), py(y)); a += (r() - 0.5) * 2.5; } } g.stroke(); }
    // alligator cracking near the edges
    for (let k = 0; k < 10; k++) { const x0 = r() < 0.5 ? 0.4 + r() * 1.4 : 21.2 + r() * 2.4, y0 = r() * 46; g.lineWidth = Math.max(1, ppm * 0.03);
      for (let i = 0; i < 9; i++) { g.beginPath(); g.moveTo(px(x0 + r() * 1.4), py(y0 + r() * 2.5)); g.lineTo(px(x0 + r() * 1.4), py(y0 + r() * 2.5)); g.stroke(); } } });
  const white = mask(W, H, g => { g.fillRect(px(1.0), 0, px(0.3), H); g.fillRect(px(22.7), 0, px(0.3), H); // edge lines
    for (let y = 0; y < 48; y += 12) { g.fillRect(px(5.9), py(y), px(0.2), py(3)); g.fillRect(px(17.9), py(y), px(0.2), py(3)); } }); // lane dashes 3 m / 12 m
  const yellow = mask(W, H, g => { g.fillRect(px(11.62), 0, px(0.2), H); g.fillRect(px(12.18), 0, px(0.2), H); }); // double centre line
  const tracks = [2.9, 4.6, 8.0, 9.7, 14.3, 16.0, 19.4, 21.1];
  const col = new Float32Array(W * H * 3), hgt = new Float32Array(W * H), rough = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, mx = x / ppm, my = y / ny;
    const tone = (n6(mx / 6, my / 6) - 0.5) * 0.12 + (n1(mx, my) - 0.5) * 0.08, g = r();
    let v = 0.27 + tone + (g - 0.5) * 0.07, h = g * 0.5 + n03(mx / 0.3, my / 0.3) * 0.6, ro = 0.88;
    let cr = v, cg = v * 1.01, cb = v * 1.08;
    if (g > 0.955) { const s = 0.12 + r() * 0.12; cr += s; cg += s; cb += s * 0.9; h += 0.6; } else if (g < 0.04) { cr -= 0.07; cg -= 0.07; cb -= 0.07; h -= 0.3; }
    // polished tyre tracks: darker + smoother
    let tk = 0; for (const t of tracks) { const d = (mx - t) / 0.42; tk = Math.max(tk, Math.exp(-d * d)); }
    tk *= 0.75 + 0.25 * n1(mx * 2, my * 0.5); cr -= 0.05 * tk; cg -= 0.05 * tk; cb -= 0.045 * tk; ro -= 0.32 * tk; h -= 0.25 * tk * g;
    // oil stain down the middle of each lane
    for (const lc of [3.75, 8.85, 15.15, 20.25]) { const d = Math.abs(mx - lc); if (d < 0.6) { const o = (1 - d / 0.6) * Math.max(0, n1(mx * 1.5, my * 0.7) - 0.45) * 1.6; cr -= 0.08 * o; cg -= 0.08 * o; cb -= 0.07 * o; ro -= 0.2 * o; } }
    // repair patches: darker newer asphalt, finer grain, inked seam
    const pa = patch[i]; if (pa > 0) { cr = cr * (1 - pa) + (0.2 + (g - 0.5) * 0.04) * pa; cg = cg * (1 - pa) + (0.205 + (g - 0.5) * 0.04) * pa; cb = cb * (1 - pa) + (0.225 + (g - 0.5) * 0.04) * pa; h += 0.3 * pa; ro -= 0.08 * pa; }
    const se = seam[i]; cr -= 0.13 * se; cg -= 0.13 * se; cb -= 0.13 * se; h -= 0.8 * se;
    // paint: worn by noise and tyre tracks, slightly raised, smooth
    const wear = clamp01((nw(mx * 2, my * 2) - 0.25) * 2.2) * (1 - 0.55 * tk) * (g > 0.12 ? 1 : 0.4);
    const pw = white[i] * wear, pyl = yellow[i] * wear;
    if (pw > 0) { cr += (0.9 - cr) * pw; cg += (0.9 - cg) * pw; cb += (0.88 - cb) * pw; h += 0.5 * pw; ro -= 0.45 * pw; }
    if (pyl > 0) { cr += (0.95 - cr) * pyl; cg += (0.74 - cg) * pyl; cb += (0.16 - cb) * pyl; h += 0.5 * pyl; ro -= 0.45 * pyl; }
    // cracks (ink-dark grooves) after the paint so they cut through it
    const ck = crack[i]; cr -= 0.2 * ck; cg -= 0.2 * ck; cb -= 0.2 * ck; h -= 1.4 * ck; ro += 0.1 * ck;
    // edge wear: crumbly lighter gravel + dirt at the very edge
    const ed = Math.min(mx, 24 - mx), rag = 0.28 + 0.35 * n1(mx * 3, my * 3);
    if (ed < rag) { const t = clamp01((rag - ed) / 0.12); cr += (0.5 - cr) * t; cg += (0.42 - cg) * t; cb += (0.33 - cb) * t; h -= 0.5 * t; ro = Math.max(ro, 0.95 * t + ro * (1 - t)); }
    else if (ed < 0.95) { const t = (0.95 - ed) / 0.7 * (g > 0.5 ? 1 : 0.5); cr += 0.06 * t; cg += 0.055 * t; cb += 0.04 * t; h += (g - 0.5) * t; }
    col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb; hgt[i] = h; rough[i] = ro;
  }
  return finish(W, H, col, hgt, rough, ppm / 40);
}
export function dirtHD(W, H) { // trail: u = 0..1 across (≈10.8 m), tile length = 2x width
  const r = rng(777), WM = 10.8, ppm = W / WM, LM = WM * H / W, n4 = vgrid(4, 8, r), n1 = vgrid(16, 32, r), n02 = vgrid(54, 108, r), nf = vgrid(108, 216, r);
  const px = m => m * ppm;
  const pebH = new Float32Array(W * H), pebC = new Float32Array(W * H);
  { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const n = Math.round(WM * LM * 9); for (let k = 0; k < n; k++) { const x = r() * WM, y = r() * LM, rad = px(0.02 + r() * r() * 0.07), s = 120 + r() * 135 | 0;
      const gr = g.createRadialGradient(px(x) - rad * 0.3, px(y) - rad * 0.3, 0, px(x), px(y), rad); gr.addColorStop(0, `rgb(${s},${s},${s})`); gr.addColorStop(1, `rgb(${s * 0.45 | 0},${s * 0.45 | 0},${s * 0.45 | 0})`);
      g.fillStyle = gr; g.beginPath(); g.arc(px(x), px(y), rad, 0, 7); g.fill(); }
    const d = g.getImageData(0, 0, W, H).data; for (let i = 0; i < W * H; i++) { pebC[i] = d[i * 4] / 255; pebH[i] = pebC[i] > 0 ? 0.3 + pebC[i] : 0; } }
  const col = new Float32Array(W * H * 3), hgt = new Float32Array(W * H), rough = new Float32Array(W * H);
  const ruts = [[0.275, 0.05], [0.725, 0.05]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x, u = x / W, mx = x / ppm, my = y / ppm, g = r();
    const tone = (n4(mx / 2.7, my / 2.7) - 0.5) * 0.14 + (n1(mx / 0.68, my / 0.68) - 0.5) * 0.1;
    let cr = 0.6 + tone + (g - 0.5) * 0.06, cg = 0.46 + tone * 0.9 + (g - 0.5) * 0.05, cb = 0.32 + tone * 0.7 + (g - 0.5) * 0.04;
    let h = n02(mx / 0.2, my / 0.2) * 0.8 + nf(mx / 0.1, my / 0.1) * 0.4 + g * 0.25, ro = 0.95;
    // ruts: compacted, darker, tread chevrons, wet mud spots
    let rt = 0; for (const [c, w] of ruts) { const d = (u - c) / w; rt = Math.max(rt, Math.exp(-d * d * 1.6)); }
    if (rt > 0.02) { cr -= 0.13 * rt; cg -= 0.11 * rt; cb -= 0.08 * rt; h -= 0.9 * rt;
      const lat = Math.abs(((u % 0.5) + 0.5) % 0.5 - 0.275) * WM; const tread = Math.sin((my + lat * 0.8) * 2 * Math.PI / 0.09) > 0.35 ? 1 : 0; h += 0.25 * tread * rt; cr -= 0.03 * tread * rt; cg -= 0.03 * tread * rt;
      const mud = clamp01((n1(mx / 0.9, my / 0.9) - 0.68) * 5) * rt; cr = cr * (1 - mud) + 0.27 * mud; cg = cg * (1 - mud) + 0.2 * mud; cb = cb * (1 - mud) + 0.15 * mud; ro -= 0.6 * mud; h -= 0.4 * mud; }
    // pebbles (not in the ruts, they get pushed out)
    const pb = pebC[i] * (1 - rt * 0.8); if (pb > 0) { cr += (pb * 0.85 - cr) * 0.85; cg += (pb * 0.8 - cg) * 0.85; cb += (pb * 0.72 - cb) * 0.85; h += pebH[i] * 1.5; ro -= 0.15; }
    // grass: centre strip + encroaching edges (tufts with dark blade strokes)
    const gm = Math.max(1 - Math.abs(u - 0.5) / 0.055, (0.1 - u) / 0.08, (u - 0.9) / 0.08) + (n1(mx / 0.5, my / 0.5) - 0.5) * 0.9;
    if (gm > 0.25) { const t = clamp01((gm - 0.25) * 3), bl = Math.sin(mx * 160 + Math.sin(my * 90) * 3) > 0.6 ? 0.75 : 1; cr = cr * (1 - t) + 0.36 * bl * t; cg = cg * (1 - t) + 0.52 * bl * t; cb = cb * (1 - t) + 0.22 * bl * t; h += 0.5 * t * g; }
    col[i * 3] = cr; col[i * 3 + 1] = cg; col[i * 3 + 2] = cb; hgt[i] = h; rough[i] = ro;
  }
  return { ...finish(W, H, col, hgt, rough, ppm / 45), vs: 14 / LM };
}
