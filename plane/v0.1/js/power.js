// power.js — per-build engine POWER CURVE (VEHICLE → ⚙ ENGINE / POWER). Game-side only: it overrides the vendored
// physics params of the current vehicle state (torque table, idle, redline, shift points) and never edits js/phys/.
// Curve = 8 nodes (normalised torque 0.05..1) at evenly spaced rpm 0..redline; scaled so the PEAK POWER is exactly `hp`.
// Stored per vehicle id in localStorage 'shplane_power1' ({ [id]: { hp, idle, redline, nodes[8], preset, spool } }).
const KEY = 'shplane_power1';
export const N = 8, HP_MAX = 10000, HP_MIN = 20;
export const RED_MIN = 2500, RED_MAX = 16000, IDLE_MIN = 400, IDLE_MAX = 2500;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
export const RESP_MAX = 1000;
export const HP_PER_KW = 1.341022, K_HP = 7120.9; // hp = T[Nm] * rpm / 7120.9
export const PRESETS = {
  na:       { name: 'NA', nodes: [0.55, 0.66, 0.78, 0.88, 0.96, 1, 0.94, 0.8] },
  turbo:    { name: 'TURBO', nodes: [0.32, 0.42, 0.86, 1, 1, 0.97, 0.9, 0.76], spool: 1 },
  diesel:   { name: 'DIESEL', nodes: [0.62, 0.9, 1, 0.97, 0.86, 0.72, 0.58, 0.45], idle: 700, redline: 4500 },
  electric: { name: 'ELECTRIC', nodes: [1, 1, 1, 1, 0.78, 0.62, 0.53, 0.46], idle: 400, redline: 12000 },
  rotary:   { name: 'ROTARY', nodes: [0.45, 0.55, 0.66, 0.76, 0.86, 0.95, 1, 0.94], idle: 1000, redline: 9500 },
};
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { store = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { } };

// physics-compatible torque lookup (same as js/phys engineTorque)
export function tq(table, rpm, torqueRpm = 1) {
  rpm /= torqueRpm || 1; const t = table; if (rpm >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 1; i < t.length; i++) if (rpm < t[i][0]) { const a = t[i - 1], b = t[i]; return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]); }
  return t[0][1];
}
export function peakOf(table, redline, torqueRpm = 1) { // {hp, rpm, nm, nmRpm} on 0..redline
  let hp = 0, rpm = 0, nm = 0, nmRpm = 0;
  for (let i = 0; i <= 400; i++) { const r = redline * i / 400, t = tq(table, r, torqueRpm), h = t * r / K_HP; if (h > hp) { hp = h; rpm = r; } if (t > nm) { nm = t; nmRpm = r; } }
  return { hp, rpm, nm, nmRpm };
}
/** Stock config derived from a vehicle def (its physics params merged on the physics DEFAULTS). */
export function stockOf(P) {
  const red = P.redline, tr = P.torqueRpm || 1, raw = [];
  for (let i = 0; i < N; i++) raw.push(tq(P.torque, red * i / (N - 1), tr));
  const mx = Math.max(...raw), pk = peakOf(P.torque, red, tr);
  return { hp: Math.round(pk.hp), idle: P.idle, redline: red, nodes: raw.map(v => +(v / mx).toFixed(3)), preset: 'stock', spool: 0, resp: 0 };
}
export function norm(c, stock) {
  const s = stock || { hp: 400, idle: 900, redline: 7000, nodes: PRESETS.na.nodes };
  const o = Object.assign({}, s, c || {});
  o.hp = clamp(Math.round(num(+o.hp, s.hp)), HP_MIN, HP_MAX);
  o.redline = clamp(Math.round(num(+o.redline, s.redline)), RED_MIN, RED_MAX);
  o.idle = clamp(Math.round(num(+o.idle, s.idle)), IDLE_MIN, Math.min(IDLE_MAX, o.redline - 1500));
  const n = Array.isArray(o.nodes) && o.nodes.length === N ? o.nodes : s.nodes;
  o.nodes = n.map(v => clamp(num(+v, 0.5), 0.05, 1));
  o.spool = o.spool ? 1 : 0;
  o.resp = clamp(Math.round(num(+o.resp, 0)), 0, RESP_MAX); // throttle ramp in ms, 0 = AUTO (by hp)
  return o;
}
/** Torque table in Nm (physics format) whose peak power over 0..redline equals cfg.hp. */
export function table(cfg) {
  const red = cfg.redline, base = cfg.nodes.map((v, i) => [red * i / (N - 1), v]);
  base.push([red * 1.08, cfg.nodes[N - 1]]);
  const k = cfg.hp / Math.max(1e-6, peakOf(base, red).hp);
  return base.map(([r, v]) => [Math.round(r), +(v * k).toFixed(2)]);
}
export const get = id => store[id] || null;
export function set(id, cfg) { store[id] = cfg; save(); }
export function clear(id) { delete store[id]; save(); }
export function all() { return JSON.parse(JSON.stringify(store)); }

/**
 * Apply the saved (or given) curve to a live physics state for vehicle def `def` (no-op = stock).
 * Keeps a pristine copy of the stock params on the state the first time so repeated applies/resets are exact.
 */
export function apply(state, def, cfg = get(def.id)) {
  const P = state.P; if (!state.__stockP) state.__stockP = { torque: P.torque, torqueRpm: P.torqueRpm, idle: P.idle, redline: P.redline, up: P.up, down: P.down, vmax: P.vmax, vtop: P.vtop, arcade: P.arcade };
  const S = state.__stockP; Object.assign(P, S);
  state.__power = null;
  if (!cfg) return null;
  const c = norm(cfg, stockOf(S)), k = c.redline / S.redline;
  P.torque = table(c); P.torqueRpm = 1; P.idle = c.idle; P.redline = c.redline;
  P.up = Math.round(S.up * k); P.down = Math.max(c.idle + 300, Math.round(S.down * k));
  // more power: let the terminal-speed drag start later (still a hard aero wall, so 10 000 hp tops out ~100 m/s)
  const hp0 = peakOf(S.torque, S.redline, S.torqueRpm).hp, r = Math.max(1, c.hp / Math.max(1, hp0));
  P.vmax = Math.min(S.vmax * Math.min(1.6, Math.cbrt(r)), Math.max(S.vmax, 90));
  state.__power = { cfg: c, base: P.torque.map(p => p.slice()), spool: c.spool ? 0 : 1 };
  return c;
}
/** AUTO throttle ramp (seconds 0 → full) for a peak power: ~0.1 s up to ~500 hp, rising (log) to ~0.7 s at 10 000 hp. */
export function autoResp(hp) { const x = clamp(Math.log(Math.max(1, hp) / 500) / Math.log(HP_MAX / 500), 0, 1); return 0.1 + 0.6 * x; }
/** Current apply / lift ramp times (s) for a live state: custom ms from the build, else AUTO by its peak hp. Lift-off is ~2.5x faster. */
export function respOf(state) {
  const pw = state.__power; let hp;
  if (pw) { if (pw.cfg.resp) return { up: pw.cfg.resp / 1000, down: Math.max(0.04, pw.cfg.resp / 2500) }; hp = pw.cfg.hp; }
  else { const S = state.__stockP || state.P; if (state.__hp0 === undefined || state.__hp0k !== S.torque) { state.__hp0 = peakOf(S.torque, S.redline, S.torqueRpm || 1).hp; state.__hp0k = S.torque; } hp = state.__hp0; }
  const up = autoResp(hp); return { up, down: Math.max(0.04, up * 0.4) };
}
/**
 * Throttle ramp (game-side, per physics step): a binary key / touch button becomes a progressive pedal so big power
 * comes in over ~0.1–0.8 s instead of instantly. Linear pedal travel with a soft (eased) onset for traction; lifting
 * is faster than applying. Engine inertia: the last 30 % of travel is slower while the revs are low.
 */
export function throttle(state, dt, gas) {
  const tgt = clamp(gas, 0, 1), r = respOf(state); let x = state.__thrX || 0;
  if (tgt > x) { const lowRev = state.P && state.P.redline ? clamp(state.rpm / state.P.redline / 0.35, 0.6, 1) : 1; x = Math.min(tgt, x + dt / r.up * (x > 0.7 ? lowRev : 1)); }
  else x = Math.max(tgt, x - dt / r.down);
  state.__thrX = x;
  return x <= 0 ? 0 : x >= 1 ? 1 : x * x * (2 - x); // eased onset (slope 0 → 1 at full), exact 0 / 1 at the ends
}
/**
 * Per-frame (game-side): turbo lag + a wheel over-rev guard for big power.
 * Spool scales the torque table in place (min 45 % off-boost); the guard keeps grounded driven-wheel omega near the
 * redline for the current gear so 10 000 hp just spins the tyres instead of winding them to absurd speeds.
 */
export function tick(state, dt, gas) {
  const pw = state.__power; if (!pw) return 0;
  const P = state.P;
  if (pw.cfg.spool) {
    const x = state.rpm / P.redline, tgt = clamp(gas, 0, 1) * clamp(x * 1.6 - 0.25, 0, 1);
    pw.spool += (tgt - pw.spool) * Math.min(1, dt * (tgt > pw.spool ? 1.6 : 3.5));
    const m = 0.45 + 0.55 * pw.spool; for (let i = 0; i < P.torque.length; i++) P.torque[i][1] = pw.base[i][1] * m;
  }
  const g = state.gear < 0 ? -(P.rev || 3.3) : P.gears[Math.max(0, state.gear - 1)] || 1;
  const vf = state.v.x * state.fwd.x + state.v.y * state.fwd.y + state.v.z * state.fwd.z;
  const om = Math.max(P.redline * 1.08 / 9.549 / Math.abs(g * P.final), Math.abs(vf) / P.wheelR * 1.15 + 2); // never brakes a coasting wheel
  for (const w of state.wheels) { if (!isFinite(w.omega)) w.omega = 0; else if (Math.abs(w.omega) > om) w.omega = Math.sign(w.omega) * om; }
  return pw.cfg.spool ? pw.spool : 0;
}
