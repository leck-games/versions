// Sine Rally PHYSICS MODULE — self-contained, no imports from the game, no THREE, runs in browsers and Node.
// Rigid body + 4 raycast wheels (spring/damper + anti-roll bars), Pacejka-style tyres (slip ratio / slip angle,
// friction circle), torque curve + auto gearbox, nitro, air control, stability assist, engine heat, car damage,
// tree collisions with HP. Contract: see MODULE_API.md.
//
//   const s = createState(params)              // params: vehicle physics data (vehicles module: def.physics)
//   spawn(s, world, x, z, yaw)
//   step(s, input, dt, world, ext?)            // dt = 1/120 recommended; mutates s; pushes events into s.events
//   drainEvents(s, (type, data) => bus.emit(type, data))
//
// worldQuery (provided by the host / terrain module):
//   heightAt(x, z) -> m                 required (include bridge decks)
//   surfaceAt(x, z) -> name|index|{mu,roll,bs}   optional (default grass)
//   normalAt(x, z, out) -> {x,y,z}      optional (default: finite differences of heightAt)
//   queryTrees(x, z, r, out[]) -> [{id, x, z, r, hp}]   optional; trees whose trunk circle may touch the disc
//   damageTree(id, hpRemoved, cause) -> remaining       optional; host-side store update (else physics keeps an overlay)
//   waterLevel: number                  optional
import { resolveSurface, SURFACES } from './surfaces.js';
import { TREE, treeDamage, breakLossPerHp } from './trees.js';
import { HEAT, heatStep } from './heat.js';
export { SURFACES, TREE, treeDamage, breakLossPerHp, HEAT };
export const API_VERSION = 1;

// ---------- tiny vector / quaternion helpers on {x,y,z(,w)} ----------
const V = (x = 0, y = 0, z = 0) => ({ x, y, z });
const set = (o, x, y, z) => (o.x = x, o.y = y, o.z = z, o);
const cpy = (o, a) => (o.x = a.x, o.y = a.y, o.z = a.z, o);
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const addS = (o, a, s) => (o.x += a.x * s, o.y += a.y * s, o.z += a.z * s, o);
const len = a => Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
const norm = o => { const l = len(o) || 1; o.x /= l; o.y /= l; o.z /= l; return o; };
const cross = (o, a, b) => { const x = a.y * b.z - a.z * b.y, y = a.z * b.x - a.x * b.z, z = a.x * b.y - a.y * b.x; o.x = x; o.y = y; o.z = z; return o; };
const rot = (o, x, y, z, q) => { const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z, iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
  o.x = ix * q.w - iw * q.x - iy * q.z + iz * q.y; o.y = iy * q.w - iw * q.y - iz * q.x + ix * q.z; o.z = iz * q.w - iw * q.z - ix * q.y + iy * q.x; return o; };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const MF = (x, B, C, E) => { const bx = B * x; return Math.sin(C * Math.atan(bx - E * (bx - Math.atan(bx)))); }; // magic formula (D=1)

// ---------- parameters (defaults = the main game's buggy) ----------
export const DEFAULTS = {
  g: 12.5, mass: 1500, dims: [2.0, 1.5, 4.4], inertiaScale: 1.25,
  wheelR: 0.46, rest: 0.6, k: 50000, cBump: 3600, cReb: 5200, arbF: 16000, arbR: 11000, bumpStop: 0.85, wheelI: 1.6,
  hard: [[0.98, -0.12, 1.42], [-0.98, -0.12, 1.42], [0.98, -0.12, -1.38], [-0.98, -0.12, -1.38]], // x=left,y=up,z=fwd (FL,FR,RL,RR)
  forceLift: 0.55, lonB: 11, lonC: 1.5, lonE: 0.1, latB: 10, latC: 1.4, latE: -0.3,
  torque: [[0, 300], [1000, 330], [2000, 420], [3500, 540], [5000, 520], [6500, 430], [7200, 330]], torqueRpm: 1,
  idle: 900, redline: 7000, gears: [3.5, 2.3, 1.65, 1.26, 1.0, 0.82], rev: 3.3, final: 3.6, eff: 0.85,
  up: 6000, down: 2900, shiftT: 0.22, split: 0.45,
  brakeF: 3000, brakeR: 2000, hand: 6000, maxSteer: 0.6, steerSpeed: 0.035, steerRate: 3.2,
  cdA: 1.1, airPitch: 9000, airRoll: 3600, airYaw: 2500, boostPush: 5000, boostTorque: 1.5,
  nitroDrain: 0.3, nitroRegen: 0.06, nitroAirRegen: 0.3,
  assistGround: 2.2, assistAir: 1.2, vmax: 50, // above vmax (m/s) extra drag (terminal speed cap)
  enginePos: [0, 0.3, -1.3], // engine/exhaust in body frame (heat events position)
  heat: HEAT, damageK: 0.12, // car damage per km/h of normal impact speed into a tree that survives (scaled by its remaining HP / 3)
  treeE: 0.25, treeFriction: 0.5,
};
export function resolveParams(p = {}) { const r = { ...DEFAULTS, ...p }; r.heat = { ...HEAT, ...(p.heat || {}) }; return r; }

export function createState(params) {
  const s = {
    P: resolveParams(params), p: V(), v: V(), q: { x: 0, y: 0, z: 0, w: 1 }, w: V(), left: V(1, 0, 0), up: V(0, 1, 0), fwd: V(0, 0, 1),
    gear: 1, rpm: 900, shift: 0, steer: 0, air: 0, airMax: 0, nitro: 1, grounded: 0, flipT: 0, revT: 0, vy0: 0, holdT: 0, spinT: 0,
    tcCut: 1, slipD: 0, thr: 0, brk: 0, load: 0, boosting: false, limiter: false, time: 0,
    assist: { stab: true, tc: true }, gripMul: 1,
    heat: { temp: 70, limT: 0, over: false, hotT: 0, cut: false },
    damage: 0, // 0..100 car damage (derates torque up to 35 %, radiator cooling up to 50 %)
    cargo: { logs: 0, capacity: 0, logMass: 60 },
    mods: { mass: 0, cdA: 0, treeDamageMul: 1, carDamageMul: 1, coolMul: 1 }, // set by host from attachments
    treeCD: {}, treeHp: {}, events: [], wheels: [],
    F: V(), T: V(), _a: V(), _b: V(), _c: V(), _d: V(), _e: V(), _f: V(), _n: V(),
  };
  setParams(s, params); s.heat.temp = s.P.heat.start; return s;
}
export function setParams(s, params) {
  s.P = resolveParams(params); s.rpm = s.P.idle;
  s.wheels = s.P.hard.map((hp, i) => ({ hp, front: i < 2, omega: 0, rot: 0, comp: 0, prevComp: 0, contact: false, load: 0,
    sl: 0, sa: 0, surf: 'grass', pos: V(), steer: 0, Fx: 0, Fy: 0, n: V(0, 1, 0), cp: V() }));
}
export const massOf = s => s.P.mass + s.mods.mass + s.cargo.logs * s.cargo.logMass;
function basis(s) { rot(s.left, 1, 0, 0, s.q); rot(s.up, 0, 1, 0, s.q); rot(s.fwd, 0, 0, 1, s.q); }
export function yawOf(s) { basis(s); return Math.atan2(s.fwd.x, s.fwd.z); }
export function spawn(s, world, x, z, yaw = 0) {
  set(s.p, x, world.heightAt(x, z) + 1.4, z); set(s.v, 0, 0, 0); set(s.w, 0, 0, 0);
  s.q.x = 0; s.q.y = Math.sin(yaw / 2); s.q.z = 0; s.q.w = Math.cos(yaw / 2);
  s.gear = 1; s.flipT = 0; s.air = 0; for (const wh of s.wheels) { wh.omega = 0; wh.comp = wh.prevComp = 0; } basis(s);
}
export function engineTorque(P, rpm) { const t = P.torque; rpm /= (P.torqueRpm || 1); if (rpm >= t[t.length - 1][0]) return t[t.length - 1][1];
  for (let i = 1; i < t.length; i++) if (rpm < t[i][0]) { const a = t[i - 1], b = t[i]; return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]); } return 0; }
const ratio = s => s.gear < 0 ? -s.P.rev : s.P.gears[s.gear - 1];
function applyF(s, f, pt) { addS(s.F, f, 1); const r = set(s._e, pt.x - s.p.x, pt.y - s.p.y, pt.z - s.p.z); const t = cross(s._f, r, f); addS(s.T, t, 1); }
function groundNormal(world, x, z, out) {
  if (world.normalAt) return world.normalAt(x, z, out);
  const e = 0.6, hx = world.heightAt(x + e, z) - world.heightAt(x - e, z), hz = world.heightAt(x, z + e) - world.heightAt(x, z - e);
  return norm(set(out, -hx, 2 * e, -hz));
}
const emit = (s, type, data = {}) => { s.events.push({ type, ...data }); };
export function drainEvents(s, fn) { const ev = s.events; s.events = []; for (const e of ev) { const { type, ...d } = e; fn(type, d); } return ev.length; }
const BODY = []; for (const x of [-1, 1]) for (const z of [-2.2, 2.2]) BODY.push([x, -0.3, z]);
for (const x of [-0.9, 0.9]) for (const z of [-1.5, 1.2]) BODY.push([x, 0.85, z]); BODY.push([0, 0.95, 0]);

// ---------- main step ----------
// input: { gas 0..1, brake 0..1, steer -1..1 (+ = left), hand 0|1, boost 0|1, pitch -1..1 }
// ext (optional, host glue for attachments): { onTreeContact(contact, state) }
export function step(s, inp, dt, world, ext) {
  const c = s.P, m = massOf(s), mf = m / c.mass; basis(s); s.time += dt;
  const { left, up, fwd, v, w, p } = s, sw = c.dims[0], sh = c.dims[1], sl = c.dims[2], k12 = c.inertiaScale * m / 12;
  const Ib = [k12 * (sh * sh + sl * sl), k12 * (sw * sw + sl * sl), k12 * (sw * sw + sh * sh)];
  set(s.F, 0, -c.g * m, 0); set(s.T, 0, 0, 0);
  const fwdSpeed = dot(v, fwd), speed = len(v), H = c.heat;
  // inputs / reverse logic
  let thr = inp.gas || 0, brk = inp.brake || 0;
  if (s.gear > 0 && brk > 0 && !thr && fwdSpeed < 1.0 && s.grounded) { s.revT += dt; if (s.revT > 0.25) { s.gear = -1; s.revT = 0; } }
  else if (s.gear < 0 && thr > 0 && fwdSpeed > -1.0) s.gear = 1; else s.revT = 0;
  if (s.gear < 0) { const t = thr; thr = brk; brk = t; }
  // steering: speed-sensitive, smoothed, counter-steer assist
  const vs = Math.max(0, Math.abs(fwdSpeed));
  let target = (inp.steer || 0) * c.maxSteer / (1 + vs * c.steerSpeed);
  if (s.grounded >= 2 && vs > 4 && fwdSpeed > 0) target += clamp(Math.atan2(dot(v, left), fwdSpeed), -0.5, 0.5) * 0.55 * (inp.hand ? 0.5 : 1);
  target = clamp(target, -c.maxSteer, c.maxSteer); s.steer += clamp(target - s.steer, -c.steerRate * dt, c.steerRate * dt);
  // engine
  const W = s.wheels, drivenOmega = (W[0].omega + W[1].omega) * 0.5 * c.split + (W[2].omega + W[3].omega) * 0.5 * (1 - c.split);
  const gr = ratio(s) * c.final, wheelRpm = Math.abs(drivenOmega * gr) * 60 / 6.2832;
  const revIn = thr > 0 && brk > 0.5 && vs < 2 && s.gear > 0; s.revving = revIn; // gas+brake standing still = clutch in, free-revving (hits the limiter -> heat)
  s.rpm += (Math.min(c.redline + 150, revIn ? c.redline + 150 : Math.max(c.idle + thr * 900 * (vs < 3 ? 1 : 0), wheelRpm)) - s.rpm) * Math.min(1, dt * (revIn ? 4 : 20));
  const over = s.heat.temp >= H.overheat, nitroOn = !!inp.boost && s.nitro > 0 && !over && !s.heat.cut;
  const tqMul = (nitroOn ? c.boostTorque : 1) * (over ? H.derate : 1) * (1 - 0.35 * s.damage / 100) * (s.heat.cut ? 0 : 1);
  let Te = 0; if (s.shift > 0) s.shift -= dt; else if (s.rpm < c.redline) Te = thr * engineTorque(c, s.rpm) * tqMul;
  s.limiter = thr > 0 && s.rpm >= c.redline - 60;
  const tcT = s.assist.tc ? clamp(1 - (s.slipD - 0.16) * 2.2, 0.35, 1) : 1; s.tcCut += (tcT - s.tcCut) * Math.min(1, dt * 12);
  if (Te > 0 && fwdSpeed > -1) Te *= s.tcCut;
  if (revIn) Te = 0;
  s.thr = thr; s.brk = brk; s.load = clamp(Te / Math.max(1, engineTorque(c, s.rpm) * tqMul), -1, 1); s.boosting = nitroOn;
  if (!thr) Te = -(30 + s.rpm * 0.012) * (s.rpm > c.idle + 200 ? 1 : 0); // engine braking
  const driveTotal = Te * gr * c.eff;
  // auto gearbox (decisions on road-speed rpm; wheelspin upshift after 0.6 s; hold after upshift)
  const rpmAt = g => Math.abs(fwdSpeed) / c.wheelR * c.gears[g - 1] * c.final * 9.549;
  if (s.holdT > 0) s.holdT -= dt; s.spinT = s.rpm > c.up && thr ? s.spinT + dt : 0;
  if (s.grounded >= 2 && s.shift <= 0 && s.gear > 0) {
    if (s.rpm > c.up && s.gear < c.gears.length && thr && (rpmAt(s.gear) > c.up * 0.92 || (s.spinT > 0.6 && fwdSpeed > 2))) { s.gear++; s.shift = c.shiftT; s.holdT = 1.0; s.spinT = 0; emit(s, 'shift', { value: s.gear }); }
    else if (s.gear > 1 && s.holdT <= 0 && rpmAt(s.gear) < c.down && s.rpm < c.down + 900 && rpmAt(s.gear - 1) < c.up - 400) { s.gear--; s.shift = c.shiftT * 0.6; emit(s, 'shift', { value: s.gear }); }
  }
  // wheels: raycast along -up
  let ng = 0, slipMax = 0; const hold = !thr && !brk && speed < 0.7, hpw = s._a;
  for (let i = 0; i < 4; i++) {
    const wh = W[i]; rot(hpw, wh.hp[0], wh.hp[1], wh.hp[2], s.q); addS(hpw, p, 1);
    const maxS = c.rest + c.wheelR; let sd = 0, hit = false;
    if (up.y > 0.2) { sd = (hpw.y - world.heightAt(hpw.x, hpw.z)) / up.y;
      for (let it = 0; it < 2; it++) sd = (hpw.y - world.heightAt(hpw.x - up.x * sd, hpw.z - up.z * sd)) / up.y; hit = sd < maxS; }
    wh.prevComp = wh.comp; wh.steer = wh.front ? s.steer : 0;
    if (!hit) { wh.comp = Math.max(0, wh.comp - dt * 4); wh.contact = false; wh.load = 0; addS(cpy(wh.pos, hpw), up, -c.rest);
      wh.omega += (wh.front ? c.split : 1 - c.split) * 0.5 * driveTotal / c.wheelI * dt; wh.omega *= 1 - 0.4 * dt; if (inp.hand && !wh.front) wh.omega = 0;
      const om = c.redline / 9.549 / Math.abs(gr); if (Math.abs(wh.omega) > om) wh.omega = Math.sign(wh.omega) * om; continue; }
    ng++; wh.contact = true; wh.comp = Math.min(c.rest, maxS - sd);
    addS(cpy(wh.pos, hpw), up, -(sd - c.wheelR)); addS(cpy(wh.cp, hpw), up, -sd);
    groundNormal(world, wh.cp.x, wh.cp.z, wh.n); wh.surf = world.surfaceAt ? world.surfaceAt(wh.cp.x, wh.cp.z) : 'grass';
  }
  const cm = W.map(q => q.contact ? q.comp : 0), arb = [(cm[0] - cm[1]) * c.arbF, -(cm[0] - cm[1]) * c.arbF, (cm[2] - cm[3]) * c.arbR, -(cm[2] - cm[3]) * c.arbR];
  const kM = Math.sqrt(mf); // heavier load (cargo) -> stiffer effective spring so ride height holds
  for (let i = 0; i < 4; i++) {
    const wh = W[i]; if (!wh.contact) continue;
    const sp = resolveSurface(wh.surf), n = wh.n, cv = (wh.comp - wh.prevComp) / dt;
    let Fs = c.k * kM * wh.comp + (cv > 0 ? c.cBump : c.cReb) * kM * cv + arb[i];
    if (wh.comp > c.rest * c.bumpStop) Fs += 12 * c.k * (wh.comp - c.rest * c.bumpStop) + 4 * c.cBump * Math.max(0, cv);
    Fs = Math.max(0, Fs); const Fz = Fs * Math.max(0.2, dot(up, n)); wh.load = Fz;
    const hd = s._b; set(hd, fwd.x * Math.cos(wh.steer) + left.x * Math.sin(wh.steer), fwd.y * Math.cos(wh.steer) + left.y * Math.sin(wh.steer), fwd.z * Math.cos(wh.steer) + left.z * Math.sin(wh.steer));
    addS(hd, n, -dot(hd, n)); norm(hd); const lt = cross(s._c, n, hd);
    const app = s._d; set(app, wh.cp.x + (p.x - wh.cp.x) * c.forceLift, wh.cp.y + (p.y - wh.cp.y) * c.forceLift, wh.cp.z + (p.z - wh.cp.z) * c.forceLift);
    const r = set(s._e, wh.cp.x - p.x, wh.cp.y - p.y, wh.cp.z - p.z), vc = addS(cross(s._f, w, r), v, 1);
    const vLong = dot(vc, hd), vLat = dot(vc, lt), mu = sp.mu * s.gripMul, B = c.lonB * sp.bs, R = c.wheelR, den = Math.max(Math.abs(vLong), 3);
    let Td = (wh.front ? c.split : 1 - c.split) * 0.5 * driveTotal, Tb = brk * (wh.front ? c.brakeF : c.brakeR) * Math.sqrt(mf) + (hold ? 1500 * mf : 0);
    if (inp.hand && !wh.front) { Tb = Math.max(Tb, c.hand); Td = 0; }
    const kap = (wh.omega * R - vLong) / den, F0 = mu * Fz * MF(kap, B, c.lonC, c.lonE);
    const dF = mu * Fz * (MF(kap + 0.01, B, c.lonC, c.lonE) - MF(kap - 0.01, B, c.lonC, c.lonE)) / 0.02 * R / den;
    const Ieff = c.wheelI + dt * R * Math.max(0, dF); let om = wh.omega + dt * (Td - R * F0) / Ieff;
    if (Tb > 0) { const dw = Tb * dt / Ieff * (kap < -0.25 && !(inp.hand && !wh.front) ? 0.35 : 1); om = Math.abs(om) <= dw ? 0 : om - Math.sign(om) * dw; } // ABS-ish
    wh.omega = om; const kap2 = (om * R - vLong) / den;
    let Fx = mu * Fz * MF(kap2, B, c.lonC, c.lonE); const alpha = Math.atan(vLat / Math.max(Math.abs(vLong), 2.5));
    let Fy = -mu * Fz * MF(alpha, c.latB * sp.bs, c.latC, c.latE);
    const lim = mu * Fz, mag = Math.hypot(Fx, Fy); if (mag > lim) { Fx *= lim / mag; Fy *= lim / mag; }
    Fx -= Math.tanh(vLong * 2) * sp.roll * Fz;
    wh.sl = kap2; wh.sa = alpha; if (Td > 0 && kap2 > slipMax) slipMax = kap2; wh.Fx = Fx; wh.Fy = Fy;
    const f = s._a; set(f, hd.x * Fx + lt.x * Fy, hd.y * Fx + lt.y * Fy, hd.z * Fx + lt.z * Fy); applyF(s, f, app);
    set(f, up.x * Fs, up.y * Fs, up.z * Fs); applyF(s, f, wh.cp);
  }
  s.grounded = ng; s.slipD = ng ? slipMax : 0;
  // body contact penalties (roof / bumpers)
  const gy = world.heightAt(p.x, p.z);
  if (p.y - gy < 4) for (const lp of BODY) {
    const wp = addS(rot(s._b, lp[0], lp[1], lp[2], s.q), p, 1), pen = world.heightAt(wp.x, wp.z) - wp.y; if (pen <= 0) continue;
    const n = groundNormal(world, wp.x, wp.z, s._c), r = set(s._e, wp.x - p.x, wp.y - p.y, wp.z - p.z), vp = addS(cross(s._a, w, r), v, 1), vn = dot(vp, n);
    const Fn = Math.max(0, 140000 * mf * Math.min(pen, 0.6) - 9000 * mf * vn), f = set(s._d, n.x * Fn, n.y * Fn, n.z * Fn);
    addS(vp, n, -vn); const vt = len(vp); if (vt > 0.01) addS(f, vp, -Math.min(0.55 * Fn, 4000 * mf * vt) / vt);
    addS(s.F, f, 1); addS(s.T, cross(s._a, r, f), 1); if (pen > 0.6) p.y += pen - 0.6; if (vn < -6) emit(s, 'scrape', { value: -vn });
  }
  // aero, terminal-speed cap, water, nitro
  addS(s.F, v, -0.5 * 1.2 * (c.cdA + s.mods.cdA) * speed);
  if (speed > c.vmax) addS(s.F, v, -m * 0.006 * (speed - c.vmax));
  if (v.y < -22) s.F.y += m * 0.03 * (v.y + 22) * (v.y + 22);
  if (world.waterLevel !== undefined) { const depth = world.waterLevel + 0.5 - p.y; if (depth > 0) { const d = Math.min(depth, 1.6); addS(s.F, v, -(500 + 90 * speed) * d * mf); s.F.y += m * c.g * 0.35 * d / 1.6; addS(s.T, w, -2500 * d); } }
  if (nitroOn) { addS(s.F, fwd, c.boostPush * mf); s.nitro = Math.max(0, s.nitro - dt * c.nitroDrain); }
  else if (!inp.boost) s.nitro = Math.min(1, s.nitro + dt * (s.air > 0.4 ? c.nitroAirRegen : c.nitroRegen));
  // stability assist + air control
  { const kk = (ng > 0 ? c.assistGround : c.assistAir) * (s.assist.stab ? 1.6 : 1), ax = cross(s._a, up, set(s._b, 0, 1, 0));
    if (ng === 0) addS(ax, left, -dot(ax, left) * 0.85); addS(s.T, ax, kk * m);
    if (s.assist.stab && ng > 0 && !inp.hand) addS(s.T, up, -dot(w, up) * m * 0.5); }
  if (ng === 0) { s.air += dt; s.airMax = Math.max(s.airMax, s.air); const pitch = clamp(inp.pitch || 0, -1, 1), roll = inp.steer || 0;
    addS(s.T, left, pitch * c.airPitch * mf); addS(s.T, fwd, -roll * c.airRoll * mf * (inp.hand ? 1 : 0.6)); addS(s.T, up, roll * c.airYaw * mf * (inp.hand ? 0 : 1)); addS(s.T, w, -400 * mf); }
  else { if (s.air > 0.35) { const imp = Math.max(0, -s.vy0); emit(s, 'land', { value: imp, air: s.air });
      if (imp > 9) { const kk = clamp(1 - (imp - 9) * 0.04, 0.45, 1); if (v.y < 0) v.y *= kk; set(w, w.x * kk, w.y * kk, w.z * kk); } } s.air = 0; }
  s.vy0 = v.y;
  // integrate (semi-implicit Euler), 60 g force clamp
  { const a = len(s.F) / m, amax = 60 * c.g; if (a > amax) { const k = amax / a; set(s.F, s.F.x * k, s.F.y * k, s.F.z * k); } }
  addS(v, s.F, dt / m);
  const tl = dot(s.T, left) / Ib[0], tu = dot(s.T, up) / Ib[1], tf = dot(s.T, fwd) / Ib[2];
  addS(w, left, tl * dt); addS(w, up, tu * dt); addS(w, fwd, tf * dt); set(w, w.x * (1 - 0.05 * dt), w.y * (1 - 0.05 * dt), w.z * (1 - 0.05 * dt));
  const wl = len(w); if (wl > 20) set(w, w.x * 20 / wl, w.y * 20 / wl, w.z * 20 / wl);
  addS(p, v, dt);
  { const q = s.q, ax = w.x * dt * 0.5, ay = w.y * dt * 0.5, az = w.z * dt * 0.5; // q += 0.5*(w,0)*q*dt
    const dx = ax * q.w + ay * q.z - az * q.y, dy = ay * q.w + az * q.x - ax * q.z, dz = az * q.w + ax * q.y - ay * q.x, dw = -ax * q.x - ay * q.y - az * q.z;
    q.x += dx; q.y += dy; q.z += dz; q.w += dw; const l = Math.hypot(q.x, q.y, q.z, q.w); q.x /= l; q.y /= l; q.z /= l; q.w /= l; }
  const g2 = world.heightAt(p.x, p.z); if (p.y < g2 - 0.3) { p.y = g2 + 0.2; if (v.y < 0) v.y = 0; }
  for (const wh of W) wh.rot += wh.omega * dt;
  // trees
  if (world.queryTrees) collideTrees(s, dt, world, ext, m, Ib[1]);
  // heat
  updateHeat(s, dt, mf, speed);
  // rollover auto-recover
  if (up.y < 0.35 && (speed < 4 || s.grounded === 0 && s.air > 4 || up.y < 0)) { s.flipT += dt; if (s.flipT > (speed < 4 ? 2.5 : 3.5)) recover(s, world); } else s.flipT = 0;
}

function updateHeat(s, dt, mf, speed) {
  const c = s.P, H = c.heat, h = s.heat;
  heatStep(h, H, dt, { thr: s.thr, rpmFrac: Math.min(1.05, s.rpm / c.redline), load: s.load, nitro: s.boosting, limiter: s.limiter, speed,
    massFactor: Math.min(2.5, mf), coolMul: s.mods.coolMul, damage: s.damage / 100 });
  if (!h.over && h.temp >= H.overheat) { h.over = true; emit(s, 'engine:overheat', { position: enginePos(s), temp: h.temp }); }
  else if (h.over && h.temp < H.overheat - 8) { h.over = false; emit(s, 'engine:cooled', { temp: h.temp }); }
  if (h.temp >= H.hot) { h.hotT -= dt; if (h.hotT <= 0) { h.hotT = H.hotEvery; emit(s, 'engine:hot', { position: enginePos(s), temp: h.temp, intensity: clamp((h.temp - H.hot) / (H.max - H.hot), 0.05, 1) }); } }
  else h.hotT = 0;
}
export function enginePos(s) { const e = s.P.enginePos, o = rot(V(), e[0], e[1], e[2], s.q); return [s.p.x + o.x, s.p.y + o.y, s.p.z + o.z].map(r => Math.round(r * 100) / 100); }
export function recover(s, world) {
  basis(s); const yaw = Math.atan2(s.fwd.x, s.fwd.z); s.p.y = world.heightAt(s.p.x, s.p.z) + 1.6; set(s.v, 0, 0, 0); set(s.w, 0, 0, 0);
  s.q.x = 0; s.q.y = Math.sin(yaw / 2); s.q.z = 0; s.q.w = Math.cos(yaw / 2); s.flipT = 0; basis(s); emit(s, 'recover');
}

// ---------- trees: oriented car box (XZ) vs trunk circles ----------
const treeBuf = [];
export function treeHp(s, t) { const o = s.treeHp[t.id]; return o === undefined ? t.hp : Math.min(o, t.hp); }
// Remove HP from a tree (used by impacts and by attachments, e.g. the harvester). Emits tree:damage / tree:destroyed.
export function damageTree(s, world, t, amount, cause = 'impact', extra = {}) {
  const hp = treeHp(s, t); if (hp <= 0 || amount <= 0) return hp;
  const removed = Math.min(hp, amount); let remaining = Math.round((hp - removed) * 100) / 100; if (remaining < 0.05) remaining = 0;
  s.treeHp[t.id] = remaining; if (world.damageTree) world.damageTree(t.id, hp - remaining, cause);
  emit(s, 'tree:damage', { id: t.id, hp: Math.round((hp - remaining) * 100) / 100, remaining, cause, x: t.x, z: t.z, ...extra });
  if (remaining <= 0) emit(s, 'tree:destroyed', { id: t.id, x: t.x, z: t.z, cause, ...extra });
  return remaining;
}
function collideTrees(s, dt, world, ext, m, Iy) {
  const c = s.P, p = s.p, v = s.v, hw = c.dims[0] / 2, hl = c.dims[2] / 2;
  for (const id in s.treeCD) if ((s.treeCD[id] -= dt) <= 0) delete s.treeCD[id];
  treeBuf.length = 0; const trees = world.queryTrees(p.x, p.z, hl + hw + 1.5, treeBuf); if (!trees || !trees.length) return;
  let fx = s.fwd.x, fz = s.fwd.z; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl; const lx = fz, lz = -fx; // horizontal fwd / left
  for (const t of trees) {
    const hp0 = treeHp(s, t); if (hp0 <= 0) continue;
    if (p.y - world.heightAt(t.x, t.z) > 6) continue; // jumped over
    const dx = t.x - p.x, dz = t.z - p.z, u = dx * lx + dz * lz, f = dx * fx + dz * fz; // tree centre in car frame
    const cu = clamp(u, -hw, hw), cf = clamp(f, -hl, hl);
    let nx, nz, dist; // n: from tree towards car
    const px = p.x + cu * lx + cf * fx, pz = p.z + cu * lz + cf * fz; // closest point on box
    dist = Math.hypot(px - t.x, pz - t.z);
    if (dist > t.r + 0.08) continue;
    if (dist > 1e-4) { nx = (px - t.x) / dist; nz = (pz - t.z) / dist; }
    else { const ou = hw - Math.abs(u), of = hl - Math.abs(f); if (ou < of) { const sg = u > 0 ? -1 : 1; nx = sg * lx; nz = sg * lz; dist = -ou; } else { const sg = f > 0 ? -1 : 1; nx = sg * fx; nz = sg * fz; dist = -of; } }
    const pen = t.r - dist, rx = px - p.x, rz = pz - p.z;
    const vcx = v.x - s.w.y * rz, vcz = v.z + s.w.y * rx; // contact point velocity (yaw only)
    const vn = vcx * nx + vcz * nz, vh = Math.hypot(v.x, v.z), kmh = vh * 3.6, angle = vh > 0.1 ? clamp(-vn / vh, 0, 1) : 0;
    const zone = cf > hl * 0.6 ? 'front' : cf < -hl * 0.6 ? 'rear' : 'side', impact = !s.treeCD[t.id] && vn < -0.5;
    const C = { tree: t, id: t.id, x: t.x, z: t.z, speedKmh: kmh, normalKmh: Math.max(0, -vn) * 3.6, angle, zone, impact, hp: hp0,
      dmg: impact ? treeDamage(kmh, angle) * s.mods.treeDamageMul : 0, mode: 'impact', carDamageMul: s.mods.carDamageMul };
    if (ext && ext.onTreeContact) ext.onTreeContact(C, s);
    if (C.mode !== 'impact') C.dmg = 0;
    let remaining = hp0;
    if (impact) { s.treeCD[t.id] = 0.4; if (C.dmg > 0.005) remaining = damageTree(s, world, t, C.dmg, 'impact', { speed: kmh, angle, zone }); }
    if (remaining <= 0) { // broke through: no push-out, small speed loss
      const loss = clamp((hp0) * breakLossPerHp(kmh), 0, 0.5); v.x *= 1 - loss; v.z *= 1 - loss;
      addDamage(s, (hp0) * 1.5 * C.carDamageMul, 'tree'); continue;
    }
    // solid: push out + impulse (restitution, friction, yaw)
    if (pen > 0) { p.x += nx * pen; p.z += nz * pen; }
    if (vn < 0) {
      const e = C.mode === 'harvest' ? 0 : c.treeE, rxn = rz * nx - rx * nz, j = -(1 + e) * vn / (1 / m + rxn * rxn / Iy);
      v.x += nx * j / m; v.z += nz * j / m; s.w.y += rxn * j / Iy;
      const tx = -nz, tz = nx, vt = vcx * tx + vcz * tz, rxt = rz * tx - rx * tz, jt = clamp(-vt / (1 / m + rxt * rxt / Iy), -c.treeFriction * j, c.treeFriction * j);
      v.x += tx * jt / m; v.z += tz * jt / m; s.w.y += rxt * jt / Iy;
      if (impact) { if (-vn > 6) emit(s, 'crash', { value: -vn });
        if (C.normalKmh > 15 && C.mode === 'impact') addDamage(s, c.damageK * C.normalKmh * (remaining / TREE.maxHp) * C.carDamageMul, 'tree');
        emit(s, 'tree:hit', { id: t.id, speed: kmh, angle, zone, remaining, mode: C.mode }); }
    }
  }
}
export function addDamage(s, amt, cause) { if (amt < 0.05) return; const before = s.damage; s.damage = Math.min(100, s.damage + amt);
  emit(s, 'vehicle:damage', { amount: Math.round((s.damage - before) * 10) / 10, total: Math.round(s.damage * 10) / 10, cause }); }
export function repair(s) { s.damage = 0; s.heat.temp = Math.min(s.heat.temp, s.P.heat.start); s.heat.over = false; s.heat.cut = false; }

// ---------- telemetry (same fields as main game's SR.telemetry + heat/damage/cargo) ----------
export function telemetry(s, t = { wheels: [{}, {}, {}, {}] }) {
  const c = s.P; t.rpm = s.rpm; t.idle = c.idle; t.redline = c.redline; t.throttle = s.thr; t.brake = s.brk; t.boost = s.boosting; t.nitro = s.nitro;
  t.gear = s.gear; t.shifting = s.shift > 0; t.load = s.load; t.speed = len(s.v); t.fwdSpeed = dot(s.v, s.fwd); t.grounded = s.grounded; t.air = s.air;
  const sf = x => typeof x === 'object' ? x.name : typeof x === 'number' ? Object.keys(SURFACES)[x] : x;
  t.surface = sf(s.wheels[2].surf); t.temp = s.heat.temp; t.overheat = s.heat.over; t.limiter = s.limiter; t.damage = s.damage;
  t.mass = massOf(s); t.logs = s.cargo.logs; t.capacity = s.cargo.capacity;
  if (!t.wheels) t.wheels = [];
  s.wheels.forEach((wh, i) => { const o = t.wheels[i] || (t.wheels[i] = {}); o.contact = wh.contact; o.surface = sf(wh.surf); o.slipRatio = wh.sl; o.slipAngle = wh.sa; o.load = wh.load; });
  return t;
}
