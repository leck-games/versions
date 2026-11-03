// SineHighway — endless procedural highway world.
// One continuous two-lane road (heading random walk with bounded curvature, integrated in 256 m chunks that are generated
// ahead of the player and disposed behind), gentle hills from a smooth profile with a grade cap (~11 %), biomes that change
// every few km (400 m blends), terrain that always yields to the road (cut/fill bed, tunnel ridges, gorges under bridges).
// Deterministic by seed (?seed=). FLOATING ORIGIN: every exported function takes/returns LOCAL coordinates (world - origin);
// shiftOrigin(dx, dz) moves the origin (the game shifts all of its state by the same amount).
const S = Math.sin, C = Math.cos, A = Math.abs, mn = Math.min, mx = Math.max, fl = Math.floor, PI = Math.PI;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sst = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const WATER = 0, WORLD = Infinity;
const QS = typeof location !== 'undefined' && location.search ? new URLSearchParams(location.search) : null;
export const SEED = (QS && parseInt(QS.get('seed'))) || 66;

// ---------------- origin ----------------
let OX = 0, OZ = 0;
export function shiftOrigin(dx, dz) { OX += dx; OZ += dz; }
export function origin() { return { x: OX, z: OZ }; }
export function setOrigin(x, z) { OX = x; OZ = z; }

// ---------------- hashes ----------------
export function h32(a, b, c) { // integer hash -> [0,1), robust for big ints
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul((b | 0) + 0x3c6ef372, 0x165667b1) ^ Math.imul((c | 0) + SEED * 7919, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function hash(i, j, k) { const s = S(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return s - fl(s); }
export function hash2(i, j, k) { return hash(i, j, k); }
const PH = []; for (let i = 0; i < 16; i++) PH.push(h32(i, 91, 3) * 2 * PI);

// ---------------- surfaces ----------------
export const SURF = { ASPHALT: 0, DIRT: 1, GRASS: 2, SAND: 3, ROCK: 4, SNOW: 5, MUD: 6 };
export const SURF_NAMES = ['asphalt', 'dirt', 'grass', 'sand', 'rock', 'snow', 'mud'];
export const SURF_PARAMS = [
  { mu: 1.10, roll: 0.012, bs: 1.0 }, { mu: 0.84, roll: 0.028, bs: 0.75 }, { mu: 0.74, roll: 0.045, bs: 0.7 }, { mu: 0.68, roll: 0.10, bs: 0.55 },
  { mu: 0.92, roll: 0.020, bs: 0.9 }, { mu: 0.50, roll: 0.050, bs: 0.6 }, { mu: 0.52, roll: 0.15, bs: 0.5 },
];

// ---------------- biomes + segments ----------------
export const BIOME = { PRAIRIE: 0, DESERT: 1, FOREST: 2, MOUNTAINS: 3, COAST: 4 };
export const BIOME_NAMES = ['prairie', 'desert', 'forest', 'mountains', 'coast'];
export const BIOME_TITLES = ['Prairie', 'Red Rock Desert', 'Pine Forest', 'Snowy Mountains', 'Coast'];
export const REG = BIOME, REG_NAMES = BIOME_NAMES; // compat
export const NB = 5, BLEND = 200;                  // +-200 m blend around each boundary
// E: base road elevation, Ah: hill amplitude, K: curviness
const BP = [{ E: 22, Ah: 6, K: 0.35 }, { E: 40, Ah: 9, K: 0.55 }, { E: 30, Ah: 13, K: 0.95 }, { E: 82, Ah: 20, K: 1.45 }, { E: 12, Ah: 4, K: 1.05 }];
const SEG = [];   // {s0, s1, b, side, m}
const FEAT = [];  // {type:'tun'|'br', s0, s1, c, hl, water, D, w0, w1, depthFloor}
let cyc = 0, cycQ = [];
function nextBiome_(prev) {
  if (!cycQ.length) {
    const p = [0, 1, 2, 3, 4]; for (let i = 4; i > 0; i--) { const j = fl(h32(cyc, i, 17) * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
    if (cyc === 0) { const k = p.indexOf(0); [p[0], p[k]] = [p[k], p[0]]; }
    else if (p[0] === prev) { [p[0], p[1]] = [p[1], p[0]]; }
    cyc++; cycQ = p;
  }
  return cycQ.shift();
}
function pushSeg() {
  const k = SEG.length;
  if (!k) { SEG.push({ s0: -1e7, s1: 3200, b: nextBiome_(-1), side: 1, m: 1600, k: 0 }); genFeat(SEG[0]); return; }
  const p = SEG[k - 1], len = 3000 + 3000 * h32(k, 7, 1), b = nextBiome_(p.b);
  const sg = { s0: p.s1, s1: p.s1 + len, b, side: h32(k, 8, 2) < 0.5 ? -1 : 1, m: p.s1 + len / 2, k };
  SEG.push(sg); genFeat(sg);
}
function ensureSeg(s) { while (!SEG.length || SEG[SEG.length - 1].s1 < s + 3000) pushSeg(); }
function segIdx(s) { ensureSeg(s); let lo = 0, hi = SEG.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (SEG[m].s0 <= s) lo = m; else hi = m - 1; } return lo; }
export function segmentAt(s) { const g = SEG[segIdx(s)]; return { b: g.b, s0: Math.max(0, g.s0), s1: g.s1, k: g.k, side: g.side, name: BIOME_NAMES[g.b], title: BIOME_TITLES[g.b] }; }
export function nextBiome(s) { const i = segIdx(s), g = SEG[i + 1] || (ensureSeg(SEG[i].s1 + 1), SEG[i + 1]); return { b: g.b, s: g.s0, name: BIOME_NAMES[g.b], title: BIOME_TITLES[g.b] }; }
export function boundaries(s0, s1) { segIdx(s1); return SEG.filter(g => g.s0 > s0 && g.s0 < s1).map(g => ({ s: g.s0, b: g.b, prev: SEG[g.k - 1].b })); }
const BWS = new Float32Array(NB);
export function biomeAtS(s, out = BWS) { // weights of the 5 biomes along the route
  const i = segIdx(s), g = SEG[i]; out.fill(0);
  if (i > 0 && s - g.s0 < BLEND) { const t = sst(g.s0 - BLEND, g.s0 + BLEND, s); out[g.b] += t; out[SEG[i - 1].b] += 1 - t; }
  else if (g.s1 - s < BLEND) { const t = sst(g.s1 - BLEND, g.s1 + BLEND, s), n = SEG[i + 1]; out[g.b] += 1 - t; out[n.b] += t; }
  else out[g.b] = 1;
  return out;
}
export function biomeIndexAtS(s) { biomeAtS(s); let b = 0; for (let i = 1; i < NB; i++) if (BWS[i] > BWS[b]) b = i; return b; }
function param(s, key) { // cosine interpolation between segment midpoints (smooth: keeps the grade bounded)
  const i = segIdx(s), g = SEG[i]; let a, b;
  if (s < g.m) { if (i === 0) return BP[g.b][key]; a = SEG[i - 1]; b = g; } else { b = SEG[i + 1]; a = g; }
  const u = (s - a.m) / (b.m - a.m), w = (1 - C(PI * clamp(u, 0, 1))) / 2; return BP[a.b][key] + (BP[b.b][key] - BP[a.b][key]) * w;
}
// features (tunnels in mountains / some forest; bridges over rivers, dry canyons and coastal inlets)
function genFeat(g) {
  const lo = Math.max(1500, g.s0 + BLEND + 250), hi = g.s1 - BLEND - 250; let s = lo, n = 0;
  while (s < hi) {
    const r = h32(g.k, n, 11), r2 = h32(g.k, n, 12); n++;
    let f = null;
    if (g.b === BIOME.MOUNTAINS && r < 0.55) f = { type: 'tun', hl: 70 + 70 * r2 };
    else if (g.b === BIOME.FOREST && r < 0.16) f = { type: 'tun', hl: 60 + 40 * r2 };
    else if (g.b === BIOME.FOREST && r < 0.4) f = { type: 'br', kind: 'river' };
    else if (g.b === BIOME.PRAIRIE && r < 0.18) f = { type: 'br', kind: 'river' };
    else if (g.b === BIOME.DESERT && r < 0.3) f = { type: 'br', kind: 'canyon' };
    else if (g.b === BIOME.COAST && r < 0.32) f = { type: 'br', kind: 'inlet' };
    else if (g.b === BIOME.MOUNTAINS && r < 0.75) f = { type: 'br', kind: 'gorge' };
    if (f) {
      if (f.type === 'tun') { f.c = s + f.hl; f.s0 = f.c - f.hl; f.s1 = f.c + f.hl; }
      else { f.w0 = f.kind === 'river' ? 7 + 6 * r2 : f.kind === 'inlet' ? 14 + 10 * r2 : 6 + 5 * r2; f.D = f.kind === 'canyon' ? 22 + 10 * r2 : f.kind === 'gorge' ? 30 : 0;
        f.c = s + 60; f.mp = h32(g.k, n, 13) * 6.28; }
      if (f.s1 && f.s1 > hi) break;
      FEAT.push(f); s += (f.type === 'tun' ? 2 * f.hl : 150) + 500 + 700 * h32(g.k, n, 14);
    } else s += 500 + 500 * r2;
  }
}
function featExt(f) { // bridge extents (lazy: needs the road profile)
  if (f.type !== 'br' || f.s0 !== undefined) return f;
  const B = yProf(f.c); f.floor = f.D ? B - f.D : WATER - 3; const D = B - f.floor; f.w1 = f.w0 + 4 + D * (f.kind === 'canyon' ? 0.35 : 0.8);
  f.s0 = f.c - f.w1 - 14; f.s1 = f.c + f.w1 + 14; return f;
}
function featNear(s, r, out) { segIdx(s + r); out.length = 0; for (let i = FEAT.length - 1; i >= 0; i--) { const f = FEAT[i]; if (f.c < s - r - 400) break; if (A(f.c - s) < r + (f.hl || 0) + 200) out.push(featExt(f)); } return out; }
export function featuresIn(s0, s1) { segIdx(s1 + 500); return FEAT.filter(f => featExt(f).s1 > s0 && f.s0 < s1); }

// ---------------- route centreline ----------------
export const CH = 256, DS = 2, NPC = CH / DS;
export const ROAD_HW = 6, TUN_W = 2.6, TUN_H = 7.5;
const MAXH = 1.15;
function theta(s) {
  if (s < 0) s = 0;
  const k = param(s, 'K'), g = 0.55 * S(s / 1300 + PH[0]) + 0.3 * S(s / 470 + PH[1]) + k * (0.26 * S(s / 130 + PH[2]) + 0.12 * S(s / 61 + PH[3]));
  return MAXH * Math.tanh(g);
}
function yProf(s) {
  const E = param(s, 'E'), Ah = param(s, 'Ah'), y = E + Ah * (0.6 * S(s / 700 + PH[4]) + 0.4 * S(s / 260 + PH[5]));
  return y < 4 ? 4 - 0.5 * (4 - y) / (1 + (4 - y)) : y; // never below the sea
}
const SX = [0], SZ = [0];        // chunk start positions (global, kept forever: 2 doubles per 256 m)
const CHK = new Map();           // live chunk arrays
let focusK = 0;
function integrate(k) {
  const X = new Float64Array(NPC + 1), Z = new Float64Array(NPC + 1), T = new Float32Array(NPC + 1), Y = new Float32Array(NPC + 1);
  let x = SX[k], z = SZ[k];
  for (let i = 0; i <= NPC; i++) {
    const s = k * CH + i * DS; X[i] = x; Z[i] = z; T[i] = theta(s); Y[i] = yProf(s);
    if (i < NPC) { const th = theta(s + DS / 2); x += S(th) * DS; z += C(th) * DS; }
  }
  return { X, Z, T, Y, xe: x, ze: z };
}
function chunk(k) {
  let c = CHK.get(k); if (c) return c;
  while (SX.length <= k) { const j = SX.length - 1, cc = CHK.get(j) || integrate(j); if (!CHK.has(j) && j >= focusK - 8) CHK.set(j, cc); SX.push(cc.xe); SZ.push(cc.ze); }
  c = integrate(k); CHK.set(k, c);
  if (SX.length === k + 1) { SX.push(c.xe); SZ.push(c.ze); }
  if (CHK.size > 64) for (const key of CHK.keys()) if (key < focusK - 10 || key > focusK + 30) CHK.delete(key);
  return c;
}
export function setFocus(s) { focusK = fl(Math.max(0, s) / CH); for (let k = focusK - 2; k <= focusK + 10; k++) if (k >= 0) chunk(k); for (const key of CHK.keys()) if (key < focusK - 10 || key > focusK + 30) CHK.delete(key); }
export function chunkStats() { return { live: CHK.size, starts: SX.length, focus: focusK }; }
const T0 = theta(0), S0 = S(T0), C0 = C(T0);
const RP = { x: 0, z: 0, tx: 0, tz: 1, y: 0, th: 0 };
function posG(s) { // global position on the centreline
  if (s < 0) { RP.x = S0 * s; RP.z = C0 * s; RP.tx = S0; RP.tz = C0; RP.th = T0; RP.y = yProf(0); return RP; }
  const k = fl(s / CH), c = chunk(k), f = (s - k * CH) / DS, i = mn(NPC - 1, fl(f)), u = f - i;
  RP.x = c.X[i] + (c.X[i + 1] - c.X[i]) * u; RP.z = c.Z[i] + (c.Z[i + 1] - c.Z[i]) * u; const th = c.T[i] + (c.T[i + 1] - c.T[i]) * u;
  RP.th = th; RP.tx = S(th); RP.tz = C(th); RP.y = c.Y[i] + (c.Y[i + 1] - c.Y[i]) * u; return RP;
}
export function roadY(s) { return posG(s).y; }
export function curvature(s) { return (theta(s + 2) - theta(s - 2)) / 4; }
export function bankOf(s) { return clamp(curvature(s) * 10, -0.045, 0.045); }
function szOf(Zg) { // route parameter where the centreline crosses this global z (z is strictly increasing along s)
  if (Zg <= 0) return Zg / C0;
  while (SZ[SZ.length - 1] <= Zg) chunk(SX.length - 1);
  let lo = 0, hi = SZ.length - 2; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (SZ[m] <= Zg) lo = m; else hi = m - 1; }
  const c = chunk(lo), Z = c.Z; let a = 0, b = NPC; while (b - a > 1) { const m = (a + b) >> 1; if (Z[m] <= Zg) a = m; else b = m; }
  return lo * CH + (a + (Zg - Z[a]) / (Z[a + 1] - Z[a] || 1)) * DS;
}
const PRJ = { s: 0, d: 0 };
function projectG(Xg, Zg, s) { // nearest centreline point (Newton from the z-projection)
  if (s === undefined) s = szOf(Zg);
  for (let it = 0; it < 6; it++) { posG(s); const ds = clamp((Xg - RP.x) * RP.tx + (Zg - RP.z) * RP.tz, -80, 80); s += ds; if (A(ds) < 0.002) break; }
  posG(s); PRJ.s = s; PRJ.d = -(Xg - RP.x) * RP.tz + (Zg - RP.z) * RP.tx; return PRJ;
}
export function project(x, z) { const p = projectG(x + OX, z + OZ); return { s: p.s, d: p.d }; }
// road point in LOCAL coordinates (roads/props/autopilot)
export const PP = { x: 0, z: 0, tx: 0, tz: 1, y: 0, bank: 0, curv: 0, tun: 0, bridge: false, b: 0 };
const FN = [];
export function routePoint(s, out = PP) {
  posG(s); out.x = RP.x - OX; out.z = RP.z - OZ; out.tx = RP.tx; out.tz = RP.tz; out.y = RP.y; out.curv = curvature(s); out.bank = clamp(out.curv * 10, -0.045, 0.045);
  out.tun = 0; out.bridge = false; featNear(s, 0, FN);
  for (const f of FN) { if (f.type === 'tun' && s > f.s0 && s < f.s1) out.tun = mn(s - f.s0, f.s1 - s) + 0.01; if (f.type === 'br' && s > f.s0 && s < f.s1) out.bridge = true; }
  out.b = biomeIndexAtS(s); return out;
}
export const pathPoint = (e, s) => routePoint(s);

// ---------------- natural terrain ----------------
function n1(x, z) { return S(x * 0.0061 + 1.1 * S(z * 0.0043 + PH[6])) * C(z * 0.0057 - 0.9 * S(x * 0.0037)); }
function n2(x, z) { return S(x * 0.021 + 1.3 * C(z * 0.017)) * C(z * 0.019 + S(x * 0.013 + PH[7])); }
function ridged(x, z) { return 1 - A(S(x * 0.0062 + 1.7 * S(z * 0.0041 + PH[8])) * C(z * 0.0055 - 1.3 * S(x * 0.0031))); }
function mesa(x, z) { return 0.5 + 0.5 * (0.6 * S(x * 0.0047 + 1.3 * S(z * 0.0031 + PH[9])) * C(z * 0.0043 - 1.1 * S(x * 0.0029)) + 0.4 * S((x + z) * 0.0061 + PH[10])); }
export function clump(x, z) { x += OX; z += OZ; return 0.5 + 0.5 * S(x * 0.0071 + C(z * 0.0053) * 2) * C(z * 0.0083 + S(x * 0.0047)); }
export function patch(x, z) { x += OX; z += OZ; return 0.5 + 0.5 * S(x * 0.013 + 1.7 * C(z * 0.011)) * C(z * 0.017 + 0.8 * S(x * 0.007)); }
const BWT = new Float32Array(NB);
function relief(b, X, Z, v, av, side, B) { // height above the local road base for one biome
  const g = sst(12, 80, av), a = n1(X, Z), c = n2(X, Z);
  switch (b) {
    case 0: return g * (4.5 * a + 1.5 * c) + 0.04 * mx(0, av - 150) * (0.5 + 0.5 * a);
    case 1: { const m = mesa(X, Z), e = sst(60, 150, av), st = 30 * sst(0.56, 0.6, m) + 24 * sst(0.72, 0.75, m) + 14 * sst(0.84, 0.86, m);
      return g * (2.5 * a + 1.2 * c) + e * st + 0.02 * mx(0, av - 200); }
    case 2: return g * (12 * a + 4 * c) + 0.12 * mx(0, av - 70) * (0.55 + 0.45 * a);
    case 3: { const r = ridged(X, Z), e = sst(25, 110, av);
      return g * (8 * a + 3 * c) + mn(300, e * (0.55 * (av - 25) * (0.7 + 0.3 * a) + 55 * r * r + 10 * c)); }
    default: { const sea = side * v; // sea on the side*v > 0 side
      if (sea > 0) return -sst(28, 140, sea) * (B + 6 + 0.04 * mx(0, sea - 140)) + g * 2 * c * sst(140, 40, sea);
      return g * (6 * a + 2 * c) + 0.2 * mx(0, -sea - 50) * (0.6 + 0.4 * a); }
  }
}
const FNS = [];
export const OUT = { h: 0, hn: 0, deck: -1e9, road: 0, rtype: 0, dom: 0, riv: 1e9, rd: 1e9, bg: 0, bs: 0, bf: 0, bm: 0, bc: 0, rb: 0, rdd: 1e9, tun: -1e9, ttype: 0, ts: 0, thw: 0, tdep: 0, tnx: 0, tnz: 0, tH: 0, s: 0, d: 0, B: 0, rel: 0, sea: 0 };
export const HWY = 0, TRAIL = 1, LOOP = 2;
const hw = ROAD_HW, F = hw + TUN_W;
export function sample(x, z, o = OUT) {
  const X = x + OX, Z = z + OZ, sz = szOf(Z); posG(sz);
  const B = RP.y, v = X - RP.x, av = A(v) * RP.tz;   // ~perpendicular distance from the centreline
  biomeAtS(sz, BWT); const g = SEG[segIdx(sz)], side = g.b === 4 ? g.side : (BWT[4] > 0 ? (SEG[g.k + 1] && SEG[g.k + 1].b === 4 ? SEG[g.k + 1].side : SEG[g.k - 1].side) : 1);
  let rel = 0, dom = 0; for (let b = 0; b < NB; b++) { if (BWT[b] > 0.001) rel += BWT[b] * relief(b, X, Z, v, av, side, B); if (BWT[b] > BWT[dom]) dom = b; }
  let hn = B + rel; o.riv = 1e9; o.sea = BWT[4] * sst(28, 140, side * v);
  // features: tunnel ridges + gorges
  featNear(sz, 300, FNS);
  for (const f of FNS) {
    if (f.type === 'tun') { const u = A(sz - f.c), lat = 1 - 0.5 * sst(150, 600, av), top = B + (TUN_H + 14) * lat * (1 - sst(f.hl - 4, f.hl + 48, u)); if (top > hn) hn = top; }
    else { const mea = 26 * S(v * 0.006 + f.mp) * sst(20, 160, av), u = A(sz - f.c - mea), floor = f.D ? mn(f.floor, B - f.D) : f.floor, k = 1 - sst(f.w0, f.w1, u);
      if (k > 0) { const t = floor + (hn - floor) * (1 - k); if (t < hn) hn = t; }
      if (!f.D) o.riv = mn(o.riv, mx(0, u - f.w0)); }
  }
  let h = hn, deck = -1e9, tun = -1e9, rd = 1e9, road = 0, rb = 0, rdd = 1e9, s = sz, d = v;
  o.ts = 0; o.thw = 0; o.tdep = 0; o.tnx = 0; o.tnz = 0; o.tH = 0; o.ttype = 0;
  if (av < hw + 130) {
    projectG(X, Z, sz); s = PRJ.s; d = PRJ.d; const ad = A(d), yy = RP.y, tx = RP.tx, tz = RP.tz, bk = bankOf(s), hb = yy + clamp(d, -hw, hw) * bk;
    let inT = null, onB = false; for (const f of FNS) { if (f.type === 'tun' && s > f.s0 - 0.5 && s < f.s1 + 0.5) inT = f; if (f.type === 'br' && s > f.s0 && s < f.s1) onB = true; }
    rd = ad - hw; rdd = rd; rb = hb;
    road = ad < hw + 0.5 ? 1 : sst(hw + 2.5, hw + 0.5, ad);
    if (inT && ad < F + 12) {
      if (ad < F) { tun = hb; o.ts = d; o.thw = F; o.tdep = mn(s - inT.s0, inT.s1 - s); o.tnx = -tz; o.tnz = tx; o.tH = TUN_H; }
      const cover = yy + TUN_H + 1.8, w = ad < F + 1.5 ? 1 : sst(F + 12, F + 1.5, ad); if (h < cover) h = h + (cover - h) * w;
    } else if (onB && hn < hb) {
      if (ad < hw + 1.2) deck = hb;
    } else {
      const core = hw + 1.5, blend = mn(90, 8 + 1.3 * A(hn - hb)), w = ad < core ? 1 : sst(core + blend, core, ad);
      h = hn + (hb - hn) * w;
    }
  }
  o.h = h; o.hn = hn; o.deck = deck; o.tun = tun; o.road = road; o.rtype = HWY; o.rd = rd; o.rb = rb; o.rdd = rdd; o.dom = dom; o.s = s; o.d = d; o.B = B; o.rel = h - B;
  o.bg = BWT[0]; o.bs = BWT[1]; o.bf = BWT[2]; o.bm = BWT[3]; o.bc = BWT[4];
  return o;
}
let REFY = -1e9;
export function setRef(y) { REFY = y; }
export function height(x, z) { return sample(x, z).h; }
export function naturalHeight(x, z) { return sample(x, z).hn; }
export function ground(x, z) { sample(x, z); return OUT.deck > OUT.h ? OUT.deck : OUT.h; }
export const inTunnel = o => o.tun > -1e8 && REFY < o.tun + o.tH + 1.5;
export function groundRef(x, z) { sample(x, z); return inTunnel(OUT) ? OUT.tun : OUT.deck > OUT.h ? OUT.deck : OUT.h; }
export function heightRef(x, z) { sample(x, z); return inTunnel(OUT) ? OUT.tun : OUT.h; }
export function roadGround(x, z) { sample(x, z); return OUT.tun > -1e8 ? OUT.tun : OUT.deck > OUT.h ? OUT.deck : OUT.h; }
export function normal(x, z, out, fn = height) {
  const e = 1, hx = fn(x + e, z) - fn(x - e, z), hz = fn(x, z + e) - fn(x, z - e), l = Math.hypot(hx, 2 * e, hz);
  out[0] = -hx / l; out[1] = 2 * e / l; out[2] = -hz / l; return out;
}
export function biomeWeights(x, z, out = BWT) { const sz = szOf(z + OZ); biomeAtS(sz, out); return out; }
export function biomeOf(o) { return o.dom; }
export function snowLine(x, z) { return 1e9; }
// dithered dominant biome (patchy transitions instead of a hard line)
function biomePick(x, z, o) {
  const n = 0.5 + 0.35 * S((x + OX) * 0.05 + 2 * C((z + OZ) * 0.043)) * C((z + OZ) * 0.061) + 0.15 * hash(fl(x + OX), fl(z + OZ), 9);
  const w = [o.bg, o.bs, o.bf, o.bm, o.bc]; let b1 = 0, b2 = -1; for (let i = 1; i < NB; i++) if (w[i] > w[b1]) b1 = i;
  for (let i = 0; i < NB; i++) if (i !== b1 && (b2 < 0 || w[i] > w[b2])) b2 = i;
  return w[b2] > 0.02 && w[b2] / (w[b1] + w[b2]) > n * 0.98 ? b2 : b1;
}
export function surfaceOf(x, z, o, ny) {
  if (o.road > 0.5) return SURF.ASPHALT;
  const b = biomePick(x, z, o), p = patch(x, z);
  if (o.h < WATER + 0.4) return o.sea > 0.3 || b === 4 ? SURF.SAND : SURF.MUD;
  switch (b) {
    case 0: return ny < 0.7 ? SURF.ROCK : p > 0.86 ? SURF.DIRT : SURF.GRASS;
    case 1: return ny < 0.66 ? SURF.ROCK : p > 0.55 ? SURF.SAND : p < 0.18 ? SURF.GRASS : SURF.DIRT;
    case 2: return ny < 0.68 ? SURF.ROCK : p > 0.9 ? SURF.DIRT : o.riv < 6 ? SURF.MUD : SURF.GRASS;
    case 3: return ny < 0.74 ? SURF.ROCK : (o.rel > 5 || p > 0.32 || o.B > 70) ? SURF.SNOW : SURF.GRASS;
    default: return o.sea > 0.2 && o.h < 3.2 ? SURF.SAND : ny < 0.7 ? SURF.ROCK : p > 0.8 ? SURF.SAND : SURF.GRASS;
  }
}
export function surfaceAt(x, z, ny) { sample(x, z); return surfaceOf(x, z, OUT, ny); }
export function grassDensity(x, z, o, ny, surf) {
  if (surf !== SURF.GRASS) return 0;
  const k = o.bg * 1.0 + o.bs * 0.3 + o.bf * 0.8 + o.bm * 0.55 + o.bc * 0.7;
  return k * sst(0.7, 0.85, ny) * sst(hw + 2, hw + 5, o.rd);
}
export function colourOf(x, z, o, ny, surf, out) {
  const X = x + OX, Z = z + OZ, v = 0.5 + 0.5 * S(X * 0.004 + C(Z * 0.003) * 2) * C(Z * 0.0045), p = patch(x, z);
  let r, g, b;
  switch (surf) {
    case SURF.ASPHALT: r = .28; g = .28; b = .3; break;
    case SURF.DIRT: { const k = o.bs; r = .62 + .18 * k; g = .5 - .04 * k; b = .35 - .07 * k; break; }
    case SURF.GRASS: {
      const P = [.74 + .08 * v, .7 + .06 * v, .34], D = [.74, .62, .36], Fo = [.2 + .06 * v, .42 + .08 * v, .18], M = [.32 + .08 * v, .56 + .06 * v, .3], Co = [.42 + .1 * v, .64 + .06 * v, .3 + .04 * p];
      const w = [o.bg, o.bs, o.bf, o.bm, o.bc], cs = [P, D, Fo, M, Co]; r = g = b = 0;
      for (let i = 0; i < NB; i++) { r += cs[i][0] * w[i]; g += cs[i][1] * w[i]; b += cs[i][2] * w[i]; }
      const wet = sst(40, 5, o.riv) * 0.5; r += (.3 - r) * wet; g += (.6 - g) * wet; b += (.24 - b) * wet; break; }
    case SURF.SAND: if (o.bs > 0.5) { r = .92; g = .66 + .05 * v; b = .44; } else { r = .94; g = .87; b = .66; } break;
    case SURF.ROCK:
      if (o.bs > 0.3) { const s = 0.5 + 0.5 * S(o.h * 0.9 + S(X * 0.01) * 1.5); r = .72 + .14 * s; g = .36 + .1 * s; b = .24 + .05 * s; }
      else if (o.bc > 0.5) { r = .62 + .05 * v; g = .58; b = .52; }
      else { r = .54 + .06 * v; g = .53 + .05 * v; b = .58; } break;
    case SURF.SNOW: r = .95; g = .97; b = 1; break;
    default: r = .42; g = .35; b = .26;
  }
  out[0] = r; out[1] = g; out[2] = b; return out;
}
export function colour(x, z, y, ny, out) { sample(x, z); return colourOf(x, z, OUT, ny, surfaceOf(x, z, OUT, ny), out); }
