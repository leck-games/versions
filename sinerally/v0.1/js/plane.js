// SineRally planes: three flyable aircraft with an arcade-friendly flight model (lift / drag / stall / thrust, rate-based controls with
// auto-trim), spring-damper landing gear on the terrain height field, crash detection (hard landing, prop/wing strike, trees, buildings,
// water) and runway spawns. The state object is duck-compatible with the car state (p, v, q, fwd, up, left, P, heat, nitro, damage ...)
// so the shell's HUD / camera / map code keeps working. Body frame like the cars: x = left, y = up, z = forward.
import * as THREE from 'three';
import { P as part, merge } from './models.js';

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (a, b, h, s = 8) => new THREE.CylinderGeometry(a, b, h, s), cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
const RX = Math.PI / 2;
const DEG = Math.PI / 180;

// ---------- aircraft definitions ----------
// m mass kg, S wing area m², span m, CLa lift slope /rad, CL0, aStall rad, CLmax, CD0, K induced, T0 static thrust N (prop: falls to 0 at vProp m/s),
// AB afterburner N (jet), rates rad/s at full authority (roll p, pitch q, yaw r), vRef m/s for full control authority, resp 1/s,
// gear: contact points [x,y,z] (bottom of tyre), steer index, brake mask; hull: crash points; crashV max sink at touchdown
export const PLANES = [
  { id: 'cub', name: 'BUSH CUB', kind: 'Bush plane · taildragger', blurb: 'Slow, forgiving STOL bush plane with tundra tyres. Lands on dirt strips and meadows.',
    sound: 'aeroFlat4', m: 560, S: 16.6, span: 10.7, CL0: 0.25, CLa: 4.9, aStall: 15 * DEG, CLmax: 1.55, CD0: 0.038, K: 0.06, T0: 2700, vProp: 72, AB: 0,
    rates: [2.0, 1.3, 0.9], dihedral: 0.5, vRef: 30, resp: 5, crashV: 6.5, dims: [10.7, 2.2, 6.9], prop: [0, 0.1, 3.05], idle: 650, redline: 2700, spool: 3,
    gear: [[1.0, -1.62, 1.1], [-1.0, -1.62, 1.1], [0, -0.62, -4.05]], steer: 2, brakes: [0, 1],
    hull: [[0, 0.1, 3.2], [0, 1.05, -4.2], [5.3, 1.0, 0.4], [-5.3, 1.0, 0.4], [0, 1.25, 0.4], [0, -0.45, 0.3], [1.6, 0.05, -4.1], [-1.6, 0.05, -4.1]],
    stats: { speed: 0.35, climb: 0.6, agility: 0.5, rough: 1 }, cols: [0xf2c230, 0x1a1a1a, 0xe8453c] },
  { id: 'stunt', name: 'STUNT X', kind: 'Aerobatic · taildragger', blurb: 'Light aerobatic monoplane: huge roll rate, inverted-capable, twitchy. Paved or firm dirt.',
    sound: 'aeroFlat6', m: 820, S: 10.7, span: 7.4, CL0: 0.05, CLa: 5.0, aStall: 17 * DEG, CLmax: 1.4, CD0: 0.03, K: 0.07, T0: 6800, vProp: 105, AB: 0,
    rates: [4.6, 2.0, 1.2], dihedral: 0.05, vRef: 45, resp: 8, crashV: 4.5, dims: [7.4, 2.0, 6.2], prop: [0, 0.05, 2.75], idle: 750, redline: 2900, spool: 4,
    gear: [[1.15, -1.36, 0.85], [-1.15, -1.36, 0.85], [0, -0.52, -3.0]], steer: 2, brakes: [0, 1],
    hull: [[0, 0.05, 2.9], [0, 1.2, -3.1], [3.7, -0.25, 0.1], [-3.7, -0.25, 0.1], [0, 0.95, -0.2], [0, -0.5, 0.2], [1.35, 0.1, -3.0], [-1.35, 0.1, -3.0]],
    stats: { speed: 0.6, climb: 0.85, agility: 1, rough: 0.5 }, cols: [0xe8453c, 0xf4f0e6, 0x1a1a1a] },
  { id: 'jet', name: 'SINE JET', kind: 'Jet trainer · tricycle', blurb: 'Fast jet trainer with afterburner (BOOST). Needs the paved runway at SINE FIELD.',
    sound: 'turbine', m: 4500, S: 19, span: 9.4, CL0: 0.1, CLa: 4.3, aStall: 18 * DEG, CLmax: 1.35, CD0: 0.024, K: 0.09, T0: 19000, vProp: 0, AB: 13000,
    rates: [3.4, 1.4, 0.7], dihedral: 0.2, vRef: 85, resp: 5, crashV: 4.0, dims: [9.4, 3.2, 11.2], prop: null, idle: 900, redline: 4200, spool: 0.9,
    gear: [[1.35, -1.6, -0.55], [-1.35, -1.6, -0.55], [0, -1.6, 3.5]], steer: 2, brakes: [0, 1],
    hull: [[0, -0.1, 5.6], [0, 2.4, -5.0], [4.7, -0.2, -1.4], [-4.7, -0.2, -1.4], [0, 1.0, 1.4], [0, -0.85, 0.5], [2.1, 0.1, -5.0], [-2.1, 0.1, -5.0], [0, -0.2, -5.4]],
    stats: { speed: 1, climb: 1, agility: 0.7, rough: 0 }, cols: [0x8ab8e8, 0xf4f0e6, 0x2a2a2a] },
];
export const getPlane = id => PLANES.find(p => p.id === id) || PLANES[0];

// ---------- models (merged vertex-coloured geometry + separate prop / afterburner) ----------
export function buildPlane(def, mat, flameMat) {
  const g = new THREE.Group(), pr = [];
  const [c1, c2, c3] = def.cols, BLK = 0x1a1a1a, GL = 0x7fc8f0, TYRE = 0x222226, GREY = 0x8a8f99;
  const wheel = (x, y, z, r, w) => pr.push(part(cyl(r, r, w, 10), TYRE, [x, y + r, z], [0, 0, RX]), part(cyl(r * 0.45, r * 0.45, w * 1.05, 6), GREY, [x, y + r, z], [0, 0, RX]));
  if (def.id === 'cub') {
    pr.push(part(box(1.05, 1.35, 2.3), c1, [0, 0.15, 0.7]), part(cyl(0.68, 0.16, 4.2, 4), c1, [0, 0.25, -2.4], [-RX, Math.PI / 4, 0], [1, 1, 1.15]),
      part(box(1.0, 1.0, 0.9), BLK, [0, 0.1, 2.3]), part(cone(0.22, 0.4, 8), 0xdddddd, [0, 0.1, 2.95], [RX, 0, 0]),
      part(box(1.08, 0.55, 1.5), GL, [0, 0.45, 0.7]), part(box(0.9, 0.5, 0.6), GL, [0, 0.55, 1.65], [-0.5, 0, 0]),
      part(box(10.7, 0.14, 1.6), c1, [0, 1.0, 0.45]), part(box(0.5, 0.15, 1.62), BLK, [5.0, 1.0, 0.45]), part(box(0.5, 0.15, 1.62), BLK, [-5.0, 1.0, 0.45]),
      part(box(0.06, 0.06, 2.9), BLK, [1.6, 0.3, 0.6], [0, 0, 1.0]), part(box(0.06, 0.06, 2.9), BLK, [-1.6, 0.3, 0.6], [0, 0, -1.0]),
      part(box(0.08, 1.3, 1.0), c3, [0, 0.85, -4.1], [-0.25, 0, 0]), part(box(3.4, 0.08, 0.9), c1, [0, 0.35, -4.0]),
      part(box(1.12, 0.12, 4.6), c3, [0, -0.15, -0.9]), // comic racing stripe
      part(box(0.07, 1.0, 0.07), BLK, [0.75, -0.75, 1.1], [0, 0, 0.35]), part(box(0.07, 1.0, 0.07), BLK, [-0.75, -0.75, 1.1], [0, 0, -0.35]),
      part(box(0.06, 0.35, 0.06), BLK, [0, -0.4, -4.05]));
    wheel(1.0, -1.62, 1.1, 0.4, 0.3); wheel(-1.0, -1.62, 1.1, 0.4, 0.3); wheel(0, -0.62, -4.05, 0.12, 0.08);
  } else if (def.id === 'stunt') {
    pr.push(part(cyl(0.6, 0.55, 2.6, 8), c1, [0, 0.05, 0.9], [RX, 0, 0]), part(cyl(0.55, 0.12, 3.4, 8), c1, [0, 0.15, -1.9], [-RX, 0, 0]),
      part(cone(0.25, 0.45, 8), c2, [0, 0.05, 2.45], [RX, 0, 0]),
      part(ico(0.55, 1), GL, [0, 0.55, -0.2], [0, 0, 0], [1, 0.8, 1.9]),
      part(box(7.4, 0.14, 1.5), c1, [0, -0.3, 0.2]), part(box(1.2, 0.15, 1.52), c2, [2.7, -0.3, 0.2]), part(box(1.2, 0.15, 1.52), c2, [-2.7, -0.3, 0.2]),
      part(box(0.6, 0.15, 1.52), c2, [1.2, -0.3, 0.2]), part(box(0.6, 0.15, 1.52), c2, [-1.2, -0.3, 0.2]),
      part(box(0.08, 1.2, 0.9), c2, [0, 0.75, -3.1], [-0.3, 0, 0]), part(box(0.1, 0.4, 0.5), c1, [0, 1.0, -3.2]), part(box(2.6, 0.08, 0.75), c2, [0, 0.2, -3.0]),
      part(box(0.3, 0.75, 0.6), c2, [1.15, -0.95, 0.85]), part(box(0.3, 0.75, 0.6), c2, [-1.15, -0.95, 0.85]), // wheel spats
      part(box(0.06, 0.3, 0.06), BLK, [0, -0.35, -3.0]));
    wheel(1.15, -1.36, 0.85, 0.3, 0.2); wheel(-1.15, -1.36, 0.85, 0.3, 0.2); wheel(0, -0.52, -3.0, 0.1, 0.07);
  } else {
    pr.push(part(cyl(0.75, 0.8, 6.0, 8), c1, [0, 0.1, 0.4], [RX, 0, 0]), part(cone(0.75, 2.2, 8), c2, [0, 0.1, 4.5], [RX, 0, 0]), part(cone(0.18, 0.5, 8), BLK, [0, 0.1, 5.6], [RX, 0, 0]),
      part(cyl(0.78, 0.55, 2.8, 8), c1, [0, 0.15, -3.9], [-RX, 0, 0]), part(cyl(0.58, 0.5, 0.4, 8), 0x333338, [0, 0.15, -5.45], [-RX, 0, 0]),
      part(ico(0.6, 1), GL, [0, 0.85, 1.8], [0, 0, 0], [0.95, 0.75, 3.4]),
      part(box(1.0, 0.9, 1.6), c2, [1.0, -0.1, 1.2]), part(box(1.0, 0.9, 1.6), c2, [-1.0, -0.1, 1.2]), part(box(0.8, 0.7, 0.2), BLK, [1.0, -0.1, 2.0]), part(box(0.8, 0.7, 0.2), BLK, [-1.0, -0.1, 2.0]),
      part(box(4.4, 0.16, 2.6), c1, [2.4, -0.2, -1.1], [0, 0.42, 0]), part(box(4.4, 0.16, 2.6), c1, [-2.4, -0.2, -1.1], [0, -0.42, 0]),
      part(box(0.9, 0.18, 1.0), c3, [4.3, -0.2, -2.0]), part(box(0.9, 0.18, 1.0), c3, [-4.3, -0.2, -2.0]),
      part(box(0.12, 2.2, 1.6), c1, [0, 1.6, -4.4], [-0.5, 0, 0]), part(box(0.14, 0.5, 0.9), c3, [0, 2.4, -5.0]),
      part(box(1.8, 0.1, 1.2), c1, [1.2, 0.25, -4.6], [0, 0.4, 0]), part(box(1.8, 0.1, 1.2), c1, [-1.2, 0.25, -4.6], [0, -0.4, 0]),
      part(box(1.62, 0.15, 3.0), c2, [0, -0.62, 0.0]), // belly stripe
      part(box(0.1, 1.0, 0.1), GREY, [0, -1.05, 3.5]), part(box(0.1, 1.0, 0.1), GREY, [1.35, -1.05, -0.55]), part(box(0.1, 1.0, 0.1), GREY, [-1.35, -1.05, -0.55]));
    wheel(1.35, -1.6, -0.55, 0.33, 0.25); wheel(-1.35, -1.6, -0.55, 0.33, 0.25); wheel(0, -1.6, 3.5, 0.26, 0.18);
  }
  const body = new THREE.Mesh(merge(pr), mat); g.add(body);
  let prop = null, flame = null;
  if (def.prop) { const n = def.id === 'stunt' ? 3 : 2, bl = [];
    for (let i = 0; i < n; i++) bl.push(part(box(0.16, def.id === 'stunt' ? 0.95 : 1.0, 0.05), BLK, [0, 0.5, 0], [0, 0, 0]).applyMatrix4(new THREE.Matrix4().makeRotationZ(i * 2 * Math.PI / n)));
    for (let i = 0; i < n; i++) bl.push(part(box(0.17, 0.12, 0.06), 0xf2c230, [0, 0.95, 0]).applyMatrix4(new THREE.Matrix4().makeRotationZ(i * 2 * Math.PI / n))); // yellow tips
    prop = new THREE.Mesh(merge(bl), mat); prop.position.set(...def.prop); g.add(prop); }
  else { flame = new THREE.Mesh(merge([part(cone(0.5, 2.6, 8), 0xffa040, [0, 0, -1.3], [-RX, 0, 0]), part(cone(0.3, 1.6, 8), 0xfff0a0, [0, 0, -0.8], [-RX, 0, 0])]), flameMat || mat);
    flame.position.set(0, 0.15, -5.6); flame.visible = false; g.add(flame); }
  return { group: g, prop, flame, dispose() { body.geometry.dispose(); if (prop) prop.geometry.dispose(); if (flame) flame.geometry.dispose(); } };
}

// ---------- physics ----------
const V3 = () => new THREE.Vector3();
const _a = V3(), _b = V3(), _c = V3(), _F = V3(), _T = V3(), _r = V3(), _vp = V3(), _wf = V3(), _wl = V3(), _n = V3(), _w = V3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export function createPlaneState(def) {
  const s = { kind: 'plane', def, p: V3(), v: V3(), q: new THREE.Quaternion(), fwd: V3().set(0, 0, 1), up: V3().set(0, 1, 0), left: V3().set(1, 0, 0), w: V3(),
    P: { dims: def.dims, redline: def.redline, up: def.redline * 0.97, idle: def.idle, gears: [1], wheelR: 0.3, mass: def.m, heat: { start: 70, ambient: 20, hot: 200, overheat: 250, max: 260 } },
    wheels: [], cargo: { capacity: 0, logs: 0 }, heat: { temp: 70, over: false, cut: false }, nitro: 1, damage: 0, air: 0, grounded: 0, gear: 1, rpm: def.idle, assist: { stab: true, tc: true },
    boosting: false, gripMul: 1, thr: 0, thrA: 0, ias: 0, alt: 0, agl: 0, vs: 0, alpha: 0, beta: 0, stall: false, crashed: false, crashT: 0, cause: '', crashes: 0, landings: 0, flights: 0,
    onGround: false, gearN: 0, airT: 0, maxAgl: 0, propA: 0, lastSink: 0, bank: 0, pitch: 0, hdg: 0, steps: 0, t: 0 };
  return s;
}
function basis(s) { s.fwd.set(0, 0, 1).applyQuaternion(s.q); s.up.set(0, 1, 0).applyQuaternion(s.q); s.left.set(1, 0, 0).applyQuaternion(s.q); }
const toWorld = (s, b, out) => out.set(0, 0, 0).addScaledVector(s.left, b[0]).addScaledVector(s.up, b[1]).addScaledVector(s.fwd, b[2]);
// place on the runway threshold (end = 0 / 1), facing down the runway, resting on its gear
export function spawnRunway(s, af, end = 0, groundAt) {
  const sg = end ? -1 : 1, d = s.def, len = af.L - 25;
  const x = af.x - af.dx * sg * len, z = af.z - af.dz * sg * len, yaw = Math.atan2(af.dx * sg, af.dz * sg);
  // rest pitch from the gear geometry (taildraggers sit nose-up)
  const gm = d.gear[0], gt = d.gear[2], pitch = Math.atan((gt[1] - gm[1]) / (gm[2] - gt[2])); // nose up = positive (0 for tricycle gear)
  s.q.setFromEuler(new THREE.Euler(-pitch, yaw, 0, 'YXZ')); basis(s);
  let lo = 1e9; for (const g of d.gear) { toWorld(s, g, _a); lo = Math.min(lo, _a.y); }
  s.p.set(x, groundAt(x, z) - lo + 0.03, z); reset(s); return s;
}
export function spawnAir(s, x, z, y, yaw, speed) { s.q.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ')); basis(s); s.p.set(x, y, z); reset(s); s.v.copy(s.fwd).multiplyScalar(speed); s.thr = s.thrA = 0.7; s.onGround = false; return s; }
function reset(s) { s.v.set(0, 0, 0); s.ias = 0; s.vs = 0; s.rpm = 0; s.w.set(0, 0, 0); s.crashed = false; s.crashT = 0; s.cause = ''; s.thr = s.thrA = 0; s.damage = 0; s.air = 0; s.airT = 0; s.maxAgl = 0; s.stall = false; s.onGround = true; s.gearN = 3; s.grounded = 3; }

// one fixed step. inp: { pitch -1..1 (+ nose up), roll -1..1 (+ right), yaw -1..1 (+ right), thr 0..1, brake 0..1, boost bool }
// env: { groundAt(x,z), waterLevel, trees(x,z,r) -> [{id,x,z,r}], treeTop(id) -> height, hitTree(id, dir), solids: [{x,z,r,h}], arcade bool, emit(type, data) }
export function stepPlane(s, inp, dt, env) {
  const d = s.def; s.t += dt; s.steps++;
  if (s.crashed) { s.crashT += dt; s.v.multiplyScalar(Math.max(0, 1 - 4 * dt)); s.w.multiplyScalar(0.9); s.thrA = 0; s.rpm = 0; s.boosting = false; return; }
  basis(s);
  const arcade = env.arcade, m = d.m, g = 9.81;
  // engine spool + throttle
  s.thr = clamp(inp.thr, 0, 1); s.thrA += (s.thr - s.thrA) * Math.min(1, d.spool * dt);
  s.boosting = !!(inp.boost && d.AB && s.thrA > 0.5);
  const V = s.v.length(), u = s.v.dot(s.fwd), wv = s.v.dot(s.up), sv = s.v.dot(s.left);
  const rho = 1.225 * Math.exp(-Math.max(0, s.p.y) / 9000), rr = rho / 1.225, qd = 0.5 * rho * V * V;
  const alpha = V > 1 ? Math.atan2(-wv, Math.max(0.5, Math.abs(u))) : 0, beta = V > 1 ? Math.atan2(sv, Math.max(0.5, Math.abs(u))) : 0;
  s.alpha = alpha; s.beta = beta; s.ias = V * Math.sqrt(rr);
  // ---- forces ----
  _F.set(0, -m * g, 0);
  const aS = d.aStall * (arcade ? 1.25 : 1), aa = Math.abs(alpha);
  let CL; if (aa <= aS) CL = d.CL0 + d.CLa * alpha; else { const over = Math.min(1, (aa - aS) / 0.35); CL = Math.sign(alpha) * (d.CL0 + d.CLa * aS) * (1 - 0.45 * over) * (aa > 0.9 ? Math.cos(aa) * 2 : 1); }
  CL = clamp(CL, -d.CLmax, d.CLmax * (arcade ? 1.15 : 1));
  s.stall = !s.onGround && aa > aS && V > 3;
  if (V > 0.5) {
    const vh = _a.copy(s.v).divideScalar(V);
    const ld = _b.crossVectors(vh, s.left); if (ld.lengthSq() > 1e-6) { ld.normalize(); _F.addScaledVector(ld, qd * d.S * CL); }
    const brk = !s.onGround && inp.brake > 0 ? 0.08 * inp.brake : 0; // air brake in flight
    const CD = d.CD0 + d.K * CL * CL + (s.stall ? 0.25 : 0) + brk + Math.abs(Math.sin(beta)) * 0.3;
    _F.addScaledVector(vh, -qd * d.S * CD);
    _F.addScaledVector(s.left, -qd * d.S * 0.9 * Math.sin(beta)); // side force from sideslip (fuselage + fin)
  }
  let thrust = d.vProp ? d.T0 * s.thrA * Math.max(0.08, 1 - Math.max(0, u) / d.vProp) * rr : (d.T0 * s.thrA + (s.boosting ? d.AB : 0)) * Math.pow(rr, 0.7);
  thrust *= clamp((3500 - s.p.y) / 1000, 0, 1); // soft service ceiling (the world is 3.5 km tall enough)
  _F.addScaledVector(s.fwd, thrust);
  // ---- rotation: rate targets (authority grows with dynamic pressure) + auto-trim toward 1 g + weathervane ----
  const auth = clamp(qd / (0.5 * 1.225 * d.vRef * d.vRef), 0, 1.25), authC = arcade ? Math.max(auth, s.onGround ? 0 : 0.3) : auth;
  const bank = Math.atan2(s.left.y, s.up.y), pitchA = Math.asin(clamp(s.fwd.y, -1, 1)); s.bank = bank; s.pitch = pitchA;
  let pI = clamp(inp.pitch, -1, 1), rI = clamp(inp.roll, -1, 1), yI = clamp(inp.yaw, -1, 1);
  let pT = pI * d.rates[1], rT = rI * d.rates[0], yT = yI * d.rates[2];
  if (!s.onGround && V > 4) {
    // auto-trim: hold the alpha that gives 1 g (scaled by bank) -> releasing the stick flies straight
    const CLreq = clamp(m * g * Math.cos(Math.min(1.2, Math.abs(bank))) / Math.max(1, qd * d.S), -0.3, d.CLmax * 0.8), aTrim = clamp((CLreq - d.CL0) / d.CLa, -0.05, aS * 0.8);
    pT += (aTrim - alpha) * (arcade ? 3 : 2.2) * Math.min(1, auth * 1.5) * (s.up.y > 0 ? 1 : 0.3);
    // weathervane (fin): nose follows the airflow
    yT += -beta * 3.5 * Math.min(1, auth * 1.5) * (arcade ? 1.6 : 1);
    if (arcade) {
      if (Math.abs(rI) < 0.15) rT += clamp(-bank * 1.6, -1.5, 1.5);          // auto-level wings
      if (Math.abs(pI) < 0.15 && Math.abs(bank) < 0.6) pT += clamp(-pitchA * 0.5, -0.3, 0.3); // ease back to level flight
      yT += -Math.sin(bank) * 0.5;                                              // auto-coordinated turns (nose into the turn)
      if (alpha > aS * 0.82) pT = Math.min(pT, (aS * 0.82 - alpha) * 6);      // stall protection (alpha limiter)
      const vS1 = Math.sqrt(2 * m * g / (rho * d.S * d.CLmax)), low = clamp((vS1 * 1.45 - V) / (vS1 * 0.5), 0, 1); // low-energy protection:
      if (d.id !== 'stunt' && pitchA > 0.7) pT = Math.min(pT, (1.05 - pitchA) * 3);                                  // no accidental loops (stunt plane excepted)
      if (d.id !== 'stunt' && pitchA < -0.7) pT = Math.max(pT, (-1.05 - pitchA) * 3);
      if (low > 0 && pitchA > 0.05) pT = Math.min(pT, pT * (1 - low) - pitchA * 1.2 * low);                       // nose comes down before a stall
      if (alpha < -aS * 0.7) pT = Math.max(pT, (-aS * 0.7 - alpha) * 6);
    } else {
      if (Math.abs(rI) < 0.15 && s.up.y > 0) rT += -Math.sin(bank) * d.dihedral;      // dihedral: gentle natural wings-level tendency
      yT += rI * -0.12 * d.rates[2];                                            // adverse yaw (needs rudder)
      if (d.vProp) yT += s.thrA * (1 - Math.min(1, auth)) * 0.12;               // P-factor/torque at high power, low speed (yaws left)
      if (s.stall) { rT += Math.sin(s.t * 1.7 + d.m) * 1.6 + Math.sign(s.w.z || 1) * 0.6; pT -= 0.6; } // wing drop + nose drop
    }
  }
  // ground handling: stick X steers the tail/nose wheel too (touch-friendly taxi), wings held level by the gear
  const steer = clamp(yI + (s.onGround ? rI * 0.8 : 0), -1, 1) * (35 * DEG) * (1 - clamp(V / 30, 0, 0.75));
  const authR = s.onGround ? Math.max(auth, 0) : authC;
  // body rates: w.x about left (+ = nose down), w.y about up (+ = nose left), w.z about fwd (+ = roll right)
  const tgx = -pT * Math.min(1, authR + (s.onGround ? 0 : 0.0)), tgy = -yT * Math.min(1, authR * 1.2 + 0.05), tgz = rT * Math.min(1, authR);
  const k = Math.min(1, d.resp * dt) * (s.onGround ? Math.max(0.15, auth) : (arcade ? 1 : 0.85));
  _w.set(0, 0, 0); // angular acceleration from gear (body frame), filled below
  // ---- landing gear (spring-damper per wheel, friction, brakes, steering) ----
  let nC = 0, sink = 0, hard = false, side = 0;
  const I = [m * (d.dims[2] * d.dims[2]) / 14, m * (d.dims[2] * d.dims[2] + d.dims[0] * d.dims[0]) / 16, m * (d.dims[0] * d.dims[0]) / 20]; // pitch(x), yaw(y), roll(z)
  const ww = _c.set(0, 0, 0).addScaledVector(s.left, s.w.x).addScaledVector(s.up, s.w.y).addScaledVector(s.fwd, s.w.z); // world angular velocity
  const kS = m * 140, cS = m * 14, nG = d.gear.length;
  for (let i = 0; i < nG; i++) {
    toWorld(s, d.gear[i], _r); const gx = s.p.x + _r.x, gy = s.p.y + _r.y, gz = s.p.z + _r.z;
    const h = env.groundAt(gx, gz), pen = h - gy; if (pen <= 0) continue;
    if (h < env.waterLevel - 0.3) { crash(s, env, 'DITCHED IN WATER'); return; }
    nC++; _n.set(0, 1, 0);
    _vp.crossVectors(ww, _r).add(s.v); const vn = _vp.y;
    if (-vn > d.crashV && !s.onGround) hard = true; sink = Math.max(sink, -vn);
    const Fn = Math.max(0, kS * Math.min(pen, 0.6) - cS * vn / nG * 3);
    // wheel directions (steered wheel rotated about the normal)
    _wf.copy(s.fwd); _wf.y = 0; if (_wf.lengthSq() < 1e-6) _wf.set(0, 0, 1); _wf.normalize();
    if (i === d.steer && steer) _wf.applyAxisAngle(_n, -steer);
    _wl.crossVectors(_n, _wf);
    const vl = _vp.dot(_wf), vs = _vp.dot(_wl); side = Math.max(side, Math.abs(vs));
    const mu = 0.9, latC = m * 6 / nG;
    const Flat = clamp(-vs * latC, -mu * Fn, mu * Fn);
    const brake = d.brakes.includes(i) ? clamp(inp.brake, 0, 1) : 0;
    const Flong = -Math.sign(vl) * Math.min(Math.abs(vl) * m * 4 / nG, (0.02 + brake * 0.55) * Fn);
    _T.set(0, Fn, 0).addScaledVector(_wf, Flong).addScaledVector(_wl, Flat);
    _F.add(_T);
    const tq = _b.crossVectors(_r, _T); // world torque -> body angular accel
    _w.x += tq.dot(s.left) / I[0]; _w.y += tq.dot(s.up) / I[1]; _w.z += tq.dot(s.fwd) / I[2];
  }
  if (nC) { s.w.multiplyScalar(1 - Math.min(1, 1.5 * dt)); } // tyre scrub
  const wasGround = s.onGround; s.onGround = nC > 0; s.gearN = nC; s.grounded = nC;
  if (hard && V > 3) { crash(s, env, 'HARD LANDING ' + sink.toFixed(1) + ' m/s'); return; }
  if (side > 14) { crash(s, env, 'GEAR COLLAPSED'); return; }
  // rate control: on the ground only pitch/roll *requests* act as torques, the gear holds the rest
  s.w.x += (tgx - s.w.x) * k; s.w.y += (tgy - s.w.y) * k * (s.onGround ? 0.6 : 1); s.w.z += (tgz - s.w.z) * k;
  s.w.x += _w.x * dt; s.w.y += _w.y * dt; s.w.z += _w.z * dt;
  // arcade: velocity follows the nose (less mush in turns), never in a stall
  if (arcade && !s.onGround && V > 8 && !s.stall) { const sp = V; _a.copy(s.v).lerp(_b.copy(s.fwd).multiplyScalar(sp), 1 - Math.exp(-0.9 * Math.min(1, auth) * dt)); s.v.copy(_a.setLength(sp)); }
  // integrate
  s.v.addScaledVector(_F, dt / m); s.p.addScaledVector(s.v, dt);
  const wx = _c.set(0, 0, 0).addScaledVector(s.left, s.w.x).addScaledVector(s.up, s.w.y).addScaledVector(s.fwd, s.w.z);
  _q.set(wx.x * dt * 0.5, wx.y * dt * 0.5, wx.z * dt * 0.5, 0).multiply(s.q); s.q.set(s.q.x + _q.x, s.q.y + _q.y, s.q.z + _q.z, s.q.w + _q.w).normalize();
  basis(s);
  // hull strikes (prop, wingtips, tail, canopy, belly)
  for (const hp of d.hull) { toWorld(s, hp, _r); const x = s.p.x + _r.x, y = s.p.y + _r.y, z = s.p.z + _r.z; if (y < env.groundAt(x, z) - 0.05) {
    crash(s, env, hp === d.hull[0] ? (d.prop ? 'PROP STRIKE' : 'NOSE IN') : Math.abs(hp[0]) > 2.5 ? 'WINGTIP STRIKE' : 'BELLY / TAIL STRIKE'); return; } }
  // trees + buildings (every 4th step)
  if ((s.steps & 3) === 0) {
    const R = d.span * 0.5;
    if (env.trees) for (const t of env.trees(s.p.x, s.p.z, R + 4)) { const dx = t.x - s.p.x, dz = t.z - s.p.z, dist = Math.hypot(dx, dz);
      // wings are thin: inside the span only if the tree is roughly abeam of the wing line
      const along = Math.abs(dx * s.fwd.x + dz * s.fwd.z) / Math.max(0.2, Math.hypot(s.fwd.x, s.fwd.z));
      if (dist < (t.r || 1) * 0.8 + R && (along < 2.5 + (t.r || 1) || dist < 2.5 + (t.r || 1) * 0.6)) { const top = env.treeTop ? env.treeTop(t) : 8; if (s.p.y - env.groundAt(t.x, t.z) < top) { if (env.hitTree) env.hitTree(t, s); crash(s, env, 'HIT A TREE'); return; } } }
    if (env.solids) for (const o of env.solids) { const dist = Math.hypot(o.x - s.p.x, o.z - s.p.z); if (dist < o.r + R * 0.6 && s.p.y - o.y < o.h) { crash(s, env, 'HIT ' + (o.name || 'A BUILDING')); return; } }
  }
  if (s.p.y < env.waterLevel - 0.5) { crash(s, env, 'DITCHED IN WATER'); return; }
  // bookkeeping: altitude, vertical speed, air time, landings, rpm
  const gyc = env.groundAt(s.p.x, s.p.z); s.alt = s.p.y; s.agl = s.p.y - gyc; s.vs = s.v.y; s.hdg = (Math.atan2(s.fwd.x, s.fwd.z) / DEG + 360) % 360;
  if (!s.onGround) { s.airT += dt; s.air = s.airT; s.maxAgl = Math.max(s.maxAgl, s.agl); if (wasGround && s.airT < 0.05) {} }
  if (s.onGround && !wasGround) { if (s.airT > 2 && s.maxAgl > 4) { s.landings++; env.emit && env.emit('plane:land', { sink, air: s.airT, grade: sink < 1.2 ? 'BUTTER' : sink < 2.5 ? 'SMOOTH' : 'FIRM' }); } s.airT = 0; s.air = 0; s.maxAgl = 0; }
  if (!s.onGround && wasGround === true && s.ias > 8) { s.flights++; env.emit && env.emit('plane:takeoff', { ias: s.ias }); }
  s.lastSink = sink;
  const spool = d.vProp ? clamp(s.thrA * 0.82 + Math.max(0, u) / d.vProp * 0.25, 0, 1.05) : clamp(s.thrA + (s.boosting ? 0.08 : 0), 0, 1.05);
  s.rpm = d.idle + (d.redline - d.idle) * spool; s.heat.temp = 70 + s.thrA * 40;
  s.nitro = d.AB ? Math.max(0, Math.min(1, s.nitro + (s.boosting ? -0.08 : 0.04) * dt)) : 1; if (s.nitro <= 0.01) s.boosting = false;
}
function crash(s, env, cause) { s.crashed = true; s.crashT = 0; s.cause = cause; s.crashes++; s.damage = 100; s.onGround = false; const sp = s.v.length();
  env.emit && env.emit('plane:crash', { cause, speed: sp, x: s.p.x, y: s.p.y, z: s.p.z }); s.v.multiplyScalar(0.15); }
