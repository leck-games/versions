// Test-build terrain + tree-field STUB implementing the physics worldQuery contract (pure, no THREE; runs in Node).
// A real terrain module (trees, fire, weather) replaces this; physics only sees the worldQuery interface.
//  - gentle sine hills, flattened around a 4.4 km asphalt "speed strip" along +z (|x| < 12)
//  - tree "gates" across the strip (3 trees at x = -6, 0, 6) every 800 m from z = 700 for 300 km/h pass-through tests
//  - a practice row at z = 90 (slow hits), a dense forest block at x = 40..260 (harvesting), sparse trees elsewhere
const S = Math.sin, C = Math.cos;
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const hash = (i, j, k = 0) => { const h = S(i * 127.1 + j * 311.7 + k * 74.7) * 43758.5453; return h - Math.floor(h); };
export const STRIP = { hw: 12, z0: -250, z1: 4400 };
export const CELL = 9;
export function createStubWorld(opts = {}) {
  const maxHp = opts.maxHp || 3;
  const hp = new Map(); // id -> hp (only trees that were damaged)
  const listeners = new Set();
  function hills(x, z) { return 2.2 * S(x * 0.021 + 0.5) * C(z * 0.017) + 1.1 * S(x * 0.047 + z * 0.031) + 0.6 * C(x * 0.09 - z * 0.071) + 3 * S(x * 0.004) * S(z * 0.003 + 1); }
  function stripW(x, z) { return (1 - smooth(STRIP.hw, STRIP.hw + 30, Math.abs(x))) * (1 - smooth(STRIP.z1, STRIP.z1 + 40, z)) * smooth(STRIP.z0 - 40, STRIP.z0, z); }
  function heightAt(x, z) { const w = stripW(x, z); return hills(x, z) * (1 - w); }
  function surfaceAt(x, z) {
    const ax = Math.abs(x);
    if (ax < STRIP.hw && z > STRIP.z0 && z < STRIP.z1) return 'asphalt';
    if (ax < STRIP.hw + 4 && z > STRIP.z0 && z < STRIP.z1) return 'dirt';
    const d = S(x * 0.031 + 1.3 * C(z * 0.02)) * C(z * 0.027 + 0.7 * S(x * 0.013));
    return d > 0.72 ? 'dirt' : d < -0.85 ? 'sand' : 'grass';
  }
  function dryAt(x, z) { return 0.5 + 0.5 * S(x * 0.008 + 2) * C(z * 0.006); } // 0..1 (for a fire module; unused by physics)
  // ---- trees ----
  const gates = []; let n = 0;
  for (let gz = 700; gz < STRIP.z1 - 100; gz += 800) for (const gx of [-6, 0, 6]) gates.push({ id: 'g' + (n++), x: gx, z: gz, r: 0.45, s: 1 });
  for (const gx of [-7, -2.5, 2.5, 7]) gates.push({ id: 'p' + (n++), x: gx, z: 90, r: 0.42, s: 0.9 }); // practice row
  const cache = new Map();
  function cellTree(i, j) {
    const key = i + '_' + j; let t = cache.get(key); if (t !== undefined) return t;
    const cx = (i + 0.5) * CELL, cz = (j + 0.5) * CELL; let p;
    if (Math.abs(cx) < STRIP.hw + 14 && cz > STRIP.z0 - 60 && cz < STRIP.z1 + 60) p = 0; // keep the strip + shoulders clear
    else if (cx > 40 && cx < 260 && cz > -150 && cz < 450) p = 0.62; // forest block
    else if (Math.hypot(cx, cz) < 30) p = 0;
    else p = 0.13;
    t = null;
    if (hash(i, j) < p) { const x = cx + (hash(i, j, 1) - 0.5) * CELL * 0.6, z = cz + (hash(i, j, 2) - 0.5) * CELL * 0.6, s = 0.8 + 0.5 * hash(i, j, 3);
      t = { id: 'c' + key, x, z, r: 0.32 + 0.16 * s, s, kind: hash(i, j, 4) < 0.5 ? 0 : 1 }; }
    if (cache.size > 200000) cache.clear(); cache.set(key, t); return t;
  }
  const hpOf = id => hp.has(id) ? hp.get(id) : maxHp;
  function forEachTree(x, z, r, fn) { // includes destroyed? no
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const t = cellTree(i, j); if (t && hpOf(t.id) > 0) fn(t); }
    for (const t of gates) if (Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && hpOf(t.id) > 0) fn(t);
  }
  const R = { id: '', x: 0, z: 0, r: 0, hp: 0 };
  function queryTrees(x, z, r, out = []) { forEachTree(x, z, r + 1, t => out.push({ id: t.id, x: t.x, z: t.z, r: t.r, hp: hpOf(t.id) })); return out; }
  function damageTree(id, removed, cause) { const v = Math.max(0, Math.round((hpOf(id) - removed) * 100) / 100); hp.set(id, v < 0.05 ? 0 : v); for (const f of listeners) f(id, hp.get(id), cause); return hp.get(id); }
  function regrow() { hp.clear(); for (const f of listeners) f(null, maxHp, 'regrow'); }
  void R;
  return { heightAt, surfaceAt, queryTrees, damageTree, dryAt, waterLevel: undefined,
    // renderer helpers (not part of worldQuery)
    forEachTree, hpOf, maxHp, regrow, onTreeChange: f => listeners.add(f), gates, hills };
}
