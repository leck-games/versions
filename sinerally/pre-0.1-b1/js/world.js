// Pure-math world: every height, colour, track and tree is a function of (x,z).
export const WATER = 0, WORLD = 10000; // drivable +-10 km (20x20 km)
const S = Math.sin, C = Math.cos;
// octave table: amplitude, frequency, direction angle, phase
const OCT = [];
for (let i = 0; i < 6; i++) { const a = i * 1.27 + 0.3; OCT.push([70 / Math.pow(2.05, i), 0.0016 * Math.pow(2.03, i), C(a), S(a), i * 2.1]); }
export function hLow(x, z) { // large-scale continents (used as smooth track bed)
  return 25 + 45 * S(x * 0.00031 + 1.0) * C(z * 0.00027 - 0.4) + 30 * S((x + z) * 0.0005);
}
function hRaw(x, z) {
  const wx = x + 60 * S(z * 0.0023 + 0.7), wz = z + 60 * C(x * 0.0019 - 0.3); // domain warp
  let h = hLow(x, z);
  for (const [a, f, dx, dz, p] of OCT) {
    const u = (wx * dx + wz * dz) * f, v = (wz * dx - wx * dz) * f;
    h += a * S(u + p) * C(v * 0.83 - p);
  }
  const r = Math.max(0, S(x * 0.0007 + 2) * C(z * 0.00061 + 1)); // mountain ridges
  h += 160 * r * r * r * (0.7 + 0.3 * S(wx * 0.011) * C(wz * 0.013));
  return h;
}
// --- tracks: one closed parametric sine curve per 3km lattice cell ---
const CELL = 3000;
function hash(i, j, k = 0) { const s = S(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); }
export function trackOf(ci, cj) {
  const cx = (ci + 0.5) * CELL + (hash(ci, cj, 1) - 0.5) * 900, cz = (cj + 0.5) * CELL + (hash(ci, cj, 2) - 0.5) * 900;
  return { id: ci + ',' + cj, cx, cz, R: 280 + hash(ci, cj, 3) * 300, p1: hash(ci, cj, 4) * 6.28, p2: hash(ci, cj, 5) * 6.28, k: 2 + Math.floor(hash(ci, cj, 6) * 3) };
}
export function trackR(t, th) { return t.R * (1 + 0.22 * S(t.k * th + t.p1) + 0.12 * S((t.k + 1) * th + t.p2)); }
export function trackPoint(t, th) { const r = trackR(t, th); return [t.cx + r * C(th), t.cz + r * S(th)]; }
const tcache = new Map();
export function nearTrack(x, z) {
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL), key = ci * 100000 + cj;
  let t = tcache.get(key); if (!t) { t = trackOf(ci, cj); tcache.set(key, t); }
  return t;
}
const HW = 9, BLEND = 22; // half width, blend radius
export function trackW(x, z) { // 1 on track, smooth falloff
  const t = nearTrack(x, z), dx = x - t.cx, dz = z - t.cz;
  const d = Math.abs(Math.hypot(dx, dz) - trackR(t, Math.atan2(dz, dx)));
  if (d > BLEND) return 0; if (d < HW) return 1;
  const s = 1 - (d - HW) / (BLEND - HW); return s * s * (3 - 2 * s);
}
export function height(x, z) {
  const h = hRaw(x, z), w = trackW(x, z);
  let y = w > 0 ? h + (Math.max(hLow(x, z), 3) - h) * w : h;
  const e = Math.max(Math.abs(x), Math.abs(z)) - WORLD; // world rim walls of mountains
  if (e > 0) y += e * 0.6;
  return y;
}
export function normal(x, z, out) {
  const e = 1.0, hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e);
  const l = Math.hypot(hx, 2 * e, hz); out[0] = -hx / l; out[1] = 2 * e / l; out[2] = -hz / l; return out;
}
// biome colour from height, slope and extra sine fields
export function colour(x, z, y, ny, out) {
  const tw = trackW(x, z), f = 0.5 + 0.5 * S(x * 0.004 + C(z * 0.003) * 2) * C(z * 0.0045);
  let r, g, b;
  const snow = 140 + 25 * S(x * 0.002) * C(z * 0.0023);
  if (y < WATER + 2.5) { r = .95; g = .86; b = .55; }
  else if (y > snow && ny > 0.6) { r = .96; g = .98; b = 1; }
  else if (ny < 0.78 || y > snow - 25) { r = .58; g = .55; b = .6; }
  else { r = .35 + .25 * f; g = .72 + .1 * f; b = .25; }
  if (tw > 0) { const dr = .72, dg = .52, db = .32, w = Math.min(1, tw * 1.4); r += (dr - r) * w; g += (dg - g) * w; b += (db - b) * w; }
  out[0] = r; out[1] = g; out[2] = b;
}
export function hash2(i, j, k) { return hash(i, j, k); }
