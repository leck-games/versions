// Rigid-body vehicle: inertia tensor, 4 raycast wheels (spring/damper + anti-roll bars),
// simplified Pacejka "magic formula" tyres (slip ratio / slip angle, friction circle),
// surface grip, engine torque curve + automatic gearbox, handbrake, air control, rollover recovery.
import * as THREE from 'three';
import { ground, sample, surfaceOf, SURF_PARAMS, WATER, OUT } from './world.js';

const V3 = () => new THREE.Vector3();
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
// magic formula: D sin(C atan(Bx - E(Bx - atan Bx)))
const MF = (x, B, Cc, E) => { const bx = B * x; return Math.sin(Cc * Math.atan(bx - E * (bx - Math.atan(bx)))); };

export const CFG = {
  g: 12.5, mass: 1500, dims: [2.0, 1.5, 4.4], inertiaScale: 1.25,
  wheelR: 0.46, rest: 0.6, k: 50000, cBump: 3600, cReb: 5200, arbF: 16000, arbR: 11000, bumpStop: 0.85,
  wheelI: 1.6, // incl. drivetrain share
  hard: [[0.98, -0.12, 1.42], [-0.98, -0.12, 1.42], [0.98, -0.12, -1.38], [-0.98, -0.12, -1.38]], // x=left,y=up,z=fwd (FL,FR,RL,RR)
  forceLift: 0.55, // apply tyre forces this fraction of the way up towards the CoM (anti-tip, arcade-friendly)
  lonB: 11, lonC: 1.5, lonE: 0.1, latB: 10, latC: 1.4, latE: -0.3,
  torque: [[0, 300], [1000, 330], [2000, 420], [3500, 540], [5000, 520], [6500, 430], [7200, 330]],
  idle: 900, redline: 7000, gears: [3.5, 2.3, 1.65, 1.26, 1.0, 0.82], rev: 3.3, final: 3.6, eff: 0.85,
  up: 6000, down: 2900, shiftT: 0.22, split: 0.45, // front torque share (4x4)
  brakeF: 3000, brakeR: 2000, hand: 6000, maxSteer: 0.6, steerSpeed: 0.035, steerRate: 3.2,
  cdA: 1.1, airPitch: 9000, airRoll: 3600, airYaw: 2500, boostPush: 5000, boostTorque: 1.5,
  assistGround: 2.2, assistAir: 1.2, // righting torque per kg per rad (roughly)
  name: 'BUGGY', soundPreset: 'boxer4', vmax: 50, // above vmax (m/s) extra drag kicks in (terminal speed cap)
};
// selectable vehicles (FUEL-style garage): same model, different physical parameters
const scaleTq = (t, k) => t.map(([r, v]) => [r, v * k]);
export const VEHICLES = {
  buggy: CFG,
  truck: { ...CFG, name: 'TRUCK', soundPreset: 'muscleV8', mass: 2300, dims: [2.2, 1.9, 5.0], wheelR: 0.52, rest: 0.7, k: 76000, cBump: 5600, cReb: 8000, arbF: 26000, arbR: 18000,
    wheelI: 2.6, hard: [[1.05, -0.1, 1.65], [-1.05, -0.1, 1.65], [1.05, -0.1, -1.6], [-1.05, -0.1, -1.6]], torque: scaleTq(CFG.torque, 1.65),
    gears: [3.3, 2.15, 1.55, 1.2, 0.95, 0.78], final: 3.9, brakeF: 4600, brakeR: 3200, hand: 9000, maxSteer: 0.55, steerRate: 2.6, steerSpeed: 0.04,
    cdA: 1.6, airPitch: 13000, airRoll: 5500, airYaw: 3800, boostPush: 7400, vmax: 46, split: 0.5 },
  quad: { ...CFG, name: 'QUAD', soundPreset: 'dirtbike', mass: 820, dims: [1.6, 1.3, 3.0], wheelR: 0.4, rest: 0.5, k: 30000, cBump: 2200, cReb: 3100, arbF: 8000, arbR: 5000,
    wheelI: 0.9, hard: [[0.78, -0.08, 1.08], [-0.78, -0.08, 1.08], [0.78, -0.08, -1.02], [-0.78, -0.08, -1.02]], torque: scaleTq(CFG.torque, 0.66),
    idle: 1100, redline: 8500, up: 7400, down: 3600, torqueRpm: 1.2, gears: [3.1, 2.1, 1.55, 1.2, 0.98], final: 3.4, brakeF: 1800, brakeR: 1200, hand: 3400,
    maxSteer: 0.68, steerRate: 4.2, steerSpeed: 0.03, cdA: 0.75, airPitch: 5200, airRoll: 2100, airYaw: 1500, boostPush: 3000, vmax: 52, split: 0.4 },
};

export class Vehicle {
  constructor(cfg = CFG) {
    this.assist = { stab: true, tc: true }; this.gripMul = 1; this.spinT = 0; this.holdT = 0; this.tcCut = 1; this.slipD = 0;
    this.setCfg(cfg);
    this.gear = 1; this.rpm = this.c.idle; this.shift = 0; this.steer = 0; this.air = 0; this.airMax = 0; this.boost = 1;
    this.grounded = 0; this.flipT = 0; this.landing = 0; this.revT = 0; this.vy0 = 0; this.events = [];
    this._a = V3(); this._b = V3(); this._c = V3(); this._d = V3(); this._e = V3(); this._n = [0, 0, 0];
  }
  setCfg(cfg) {
    const c = this.c = cfg, m = c.mass, [w, h, l] = c.dims, s = c.inertiaScale;
    this.Ib = [s * m / 12 * (h * h + l * l), s * m / 12 * (w * w + l * l), s * m / 12 * (w * w + h * h)]; // about left(x), up(y), fwd(z)
    this.p = V3(); this.v = V3(); this.q = new THREE.Quaternion(); this.w = V3();
    this.left = V3(); this.up = V3(); this.fwd = V3();
    this.F = V3(); this.T = V3();
    this.wheels = c.hard.map((hp, i) => ({ hp: new THREE.Vector3(...hp), front: i < 2, omega: 0, rot: 0, comp: 0, prevComp: 0, contact: false, load: 0,
      sl: 0, sa: 0, surf: 2, pos: V3(), steer: 0, Fx: 0, Fy: 0, n: V3(), cp: V3() }));
  }
  spawn(x, z, yaw) {
    this.p.set(x, ground(x, z) + 1.4, z); this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    this.q.setFromAxisAngle(this._a.set(0, 1, 0), yaw); this.gear = 1; this.flipT = 0; this.air = 0;
    for (const wh of this.wheels) { wh.omega = 0; wh.comp = wh.prevComp = 0; }
  }
  get yaw() { this.basis(); return Math.atan2(this.fwd.x, this.fwd.z); }
  basis() { this.left.set(1, 0, 0).applyQuaternion(this.q); this.up.set(0, 1, 0).applyQuaternion(this.q); this.fwd.set(0, 0, 1).applyQuaternion(this.q); }
  engineTorque(rpm) { const t = this.c.torque; rpm /= (this.c.torqueRpm || 1); if (rpm >= t[t.length - 1][0]) return t[t.length - 1][1]; for (let i = 1; i < t.length; i++) if (rpm < t[i][0]) { const a = t[i - 1], b = t[i]; return a[1] + (b[1] - a[1]) * (rpm - a[0]) / (b[0] - a[0]); } return 0; }
  ratio() { return this.gear < 0 ? -this.c.rev : this.c.gears[this.gear - 1]; }
  // world-space force at world point
  applyF(f, pt) { this.F.add(f); this._e.subVectors(pt, this.p); this.T.add(this._d.crossVectors(this._e, f)); }
  groundNormal(x, z, out) { const e = 0.6, n = this._n; const hx = ground(x + e, z) - ground(x - e, z), hz = ground(x, z + e) - ground(x, z - e); return out.set(-hx, 2 * e, -hz).normalize(); }

  step(dt, inp) {
    const c = this.c, m = c.mass; this.basis(); const { left, up, fwd, v, w, p } = this;
    this.F.set(0, -c.g * m, 0); this.T.set(0, 0, 0);
    const fwdSpeed = v.dot(fwd), speed = v.length();
    // ---- inputs / gear logic ----
    let thr = inp.gas, brk = inp.brake;
    if (this.gear > 0 && brk > 0 && !thr && fwdSpeed < 1.0 && this.grounded) { this.revT += dt; if (this.revT > 0.25) { this.gear = -1; this.revT = 0; } }
    else if (this.gear < 0 && thr > 0 && fwdSpeed > -1.0) { this.gear = 1; }
    else this.revT = 0;
    if (this.gear < 0) { const t = thr; thr = brk; brk = t; }
    // steering: speed-sensitive, smoothed, with counter-steer assist
    const vs = Math.max(0, Math.abs(fwdSpeed));
    let target = inp.steer * c.maxSteer / (1 + vs * c.steerSpeed);
    if (this.grounded >= 2 && vs > 4 && fwdSpeed > 0) { const beta = Math.atan2(v.dot(left), fwdSpeed); target += clamp(beta, -0.5, 0.5) * 0.55 * (inp.hand ? 0.5 : 1); }
    target = clamp(target, -c.maxSteer, c.maxSteer);
    this.steer += clamp(target - this.steer, -c.steerRate * dt, c.steerRate * dt);
    // ---- engine ----
    const drivenOmega = (this.wheels[0].omega + this.wheels[1].omega) * 0.5 * c.split + (this.wheels[2].omega + this.wheels[3].omega) * 0.5 * (1 - c.split);
    const gr = this.ratio() * c.final, wheelRpm = Math.abs(drivenOmega * gr) * 60 / 6.2832;
    this.rpm += (Math.min(c.redline + 150, Math.max(c.idle + thr * 900 * (vs < 3 ? 1 : 0), wheelRpm)) - this.rpm) * Math.min(1, dt * 20);
    let Te = 0;
    if (this.shift > 0) this.shift -= dt;
    else if (this.rpm < c.redline) Te = thr * this.engineTorque(this.rpm) * (inp.boost ? c.boostTorque : 1);
    // traction control: cut torque when the driven wheels spin (slip ratio measured last step)
    const tcT = this.assist.tc ? clamp(1 - (this.slipD - 0.16) * 2.2, 0.35, 1) : 1; this.tcCut += (tcT - this.tcCut) * Math.min(1, dt * 12);
    if (Te > 0 && fwdSpeed > -1) Te *= this.tcCut;
    this.thr = thr; this.brk = brk; this.load = clamp(Te / Math.max(1, this.engineTorque(this.rpm) * (inp.boost ? c.boostTorque : 1)), -1, 1); // telemetry
    if (!thr) Te = -(30 + this.rpm * 0.012) * (this.rpm > c.idle + 200 ? 1 : 0); // engine braking
    const driveTotal = Te * gr * c.eff;
    // auto gearbox
    // auto gearbox: decisions use road-speed rpm so wheelspin / locked handbrake don't cause hunting
    const rpmAt = g => Math.abs(fwdSpeed) / c.wheelR * c.gears[g - 1] * c.final * 9.549;
    // wheelspin fix: if the engine sits above the shift point for >0.6 s (spinning on grass/sand) shift up anyway,
    // then hold the gear for a moment; downshifts also need the *engine* rpm to be low, so spin never causes hunting.
    if (this.holdT > 0) this.holdT -= dt;
    this.spinT = this.rpm > c.up && thr ? this.spinT + dt : 0;
    if (this.grounded >= 2 && this.shift <= 0 && this.gear > 0) {
      if (this.rpm > c.up && this.gear < c.gears.length && thr && (rpmAt(this.gear) > c.up * 0.92 || (this.spinT > 0.6 && fwdSpeed > 2))) { this.gear++; this.shift = c.shiftT; this.holdT = 1.0; this.spinT = 0; this.events.push(['shift', 1]); }
      else if (this.gear > 1 && this.holdT <= 0 && rpmAt(this.gear) < c.down && this.rpm < c.down + 900 && rpmAt(this.gear - 1) < c.up - 400) { this.gear--; this.shift = c.shiftT * 0.6; this.events.push(['shift', -1]); }
    }
    // ---- wheels ----
    let ng = 0, slipMax = 0; const hold = !thr && !brk && speed < 0.7;
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i];
      const hpw = this._a.copy(wh.hp).applyQuaternion(this.q).add(p); // hardpoint world
      // raycast along -up: solve hp.y - up.y*s = ground(hp - up*s)
      const maxS = c.rest + c.wheelR; let s = 0, hit = false;
      if (up.y > 0.2) {
        s = (hpw.y - ground(hpw.x, hpw.z)) / up.y;
        for (let it = 0; it < 2; it++) { const gx = hpw.x - up.x * s, gz = hpw.z - up.z * s; s = (hpw.y - ground(gx, gz)) / up.y; }
        hit = s < maxS;
      }
      wh.prevComp = wh.comp;
      wh.steer = wh.front ? this.steer : 0;
      if (!hit) { wh.comp = Math.max(0, wh.comp - dt * 4); wh.contact = false; wh.load = 0; wh.pos.copy(hpw).addScaledVector(up, -(c.rest + c.wheelR * 0) ); wh.omega += (wh.front ? c.split : 1 - c.split) * 0.5 * driveTotal / c.wheelI * dt; wh.omega *= 1 - 0.4 * dt; if (inp.hand && !wh.front) wh.omega = 0;
        const om = c.redline / 9.549 / Math.abs(gr); if (Math.abs(wh.omega) > om) wh.omega = Math.sign(wh.omega) * om; continue; }
      ng++; wh.contact = true; wh.comp = Math.min(c.rest, maxS - s);
      wh.pos.copy(hpw).addScaledVector(up, -(s - c.wheelR));
      const cp = wh.cp.copy(hpw).addScaledVector(up, -s);
      sample(cp.x, cp.z); const o = OUT, onDeck = o.deck > o.h - 0.05 && o.deck > -1e8;
      const n = this.groundNormal(cp.x, cp.z, wh.n);
      wh.surf = onDeck ? 0 : surfaceOf(cp.x, cp.z, o, n.y);
    }
    // anti-roll bars + suspension
    const comps = this.wheels.map(w => w.contact ? w.comp : 0);
    const arb = [(comps[0] - comps[1]) * c.arbF, -(comps[0] - comps[1]) * c.arbF, (comps[2] - comps[3]) * c.arbR, -(comps[2] - comps[3]) * c.arbR];
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i]; if (!wh.contact) continue;
      const sp = this.surfP = SURF_PARAMS[wh.surf], n = wh.n;
      const cv = (wh.comp - wh.prevComp) / dt;
      let Fs = c.k * wh.comp + (cv > 0 ? c.cBump : c.cReb) * cv + arb[i];
      if (wh.comp > c.rest * c.bumpStop) Fs += 12 * c.k * (wh.comp - c.rest * c.bumpStop) + 4 * c.cBump * Math.max(0, cv);
      Fs = Math.max(0, Fs);
      const Fz = Fs * Math.max(0.2, up.dot(n)); wh.load = Fz;
      // contact frame
      const hd = this._b.copy(fwd).multiplyScalar(Math.cos(wh.steer)).addScaledVector(left, Math.sin(wh.steer));
      hd.addScaledVector(n, -hd.dot(n)).normalize();
      const lt = this._c.crossVectors(n, hd);
      const app = this._d.copy(wh.cp).lerp(p, c.forceLift); // force application point
      const r = this._e.subVectors(wh.cp, p), vc = this._a.crossVectors(w, r).add(v);
      const vLong = vc.dot(hd), vLat = vc.dot(lt);
      const mu = sp.mu * this.gripMul, B = c.lonB * sp.bs, R = c.wheelR, den = Math.max(Math.abs(vLong), 3);
      // drive + brake torques
      let Td = (wh.front ? c.split : 1 - c.split) * 0.5 * driveTotal;
      let Tb = brk * (wh.front ? c.brakeF : c.brakeR) + (hold ? 1500 : 0);
      if (inp.hand && !wh.front) { Tb = Math.max(Tb, c.hand); Td = 0; }
      // implicit longitudinal tyre/wheel update (stable at low speed)
      const kap = (wh.omega * R - vLong) / den, F0 = mu * Fz * MF(kap, B, c.lonC, c.lonE);
      const dF = mu * Fz * (MF(kap + 0.01, B, c.lonC, c.lonE) - MF(kap - 0.01, B, c.lonC, c.lonE)) / 0.02 * R / den;
      const Ieff = c.wheelI + dt * R * Math.max(0, dF);
      let om = wh.omega + dt * (Td - R * F0) / Ieff;
      // ABS on foot brake (not handbrake)
      if (Tb > 0) { const dw = Tb * dt / Ieff * (kap < -0.25 && !(inp.hand && !wh.front) ? 0.35 : 1); om = Math.abs(om) <= dw ? 0 : om - Math.sign(om) * dw; }
      wh.omega = om;
      const kap2 = (om * R - vLong) / den;
      let Fx = mu * Fz * MF(kap2, B, c.lonC, c.lonE);
      const alpha = Math.atan(vLat / Math.max(Math.abs(vLong), 2.5));
      let Fy = -mu * Fz * MF(alpha, c.latB * sp.bs, c.latC, c.latE);
      // friction circle
      const lim = mu * Fz, mag = Math.hypot(Fx, Fy); if (mag > lim) { Fx *= lim / mag; Fy *= lim / mag; }
      // rolling resistance
      Fx -= Math.tanh(vLong * 2) * sp.roll * Fz;
      wh.sl = kap2; wh.sa = alpha; if (Td > 0 && kap2 > slipMax) slipMax = kap2; wh.Fx = Fx; wh.Fy = Fy;
      const f = this._a.copy(hd).multiplyScalar(Fx).addScaledVector(lt, Fy);
      this.applyF(f, app);
      this.applyF(f.copy(up).multiplyScalar(Fs), wh.cp);
    }
    this.grounded = ng; this.slipD = ng ? slipMax : 0;
    // ---- body contacts (penalty) so roofs/bumpers don't sink into the ground ----
    const gy = ground(p.x, p.z);
    if (p.y - gy < 4) for (const lp of BODY) {
      const wp = this._b.set(lp[0], lp[1], lp[2]).applyQuaternion(this.q).add(p), g = ground(wp.x, wp.z), pen = g - wp.y;
      if (pen <= 0) continue;
      const n = this.groundNormal(wp.x, wp.z, this._c), r = this._e.subVectors(wp, p), vp = this._a.crossVectors(w, r).add(v), vn = vp.dot(n);
      const Fn = Math.max(0, 140000 * Math.min(pen, 0.6) - 9000 * vn);
      const f = this._d.copy(n).multiplyScalar(Fn); vp.addScaledVector(n, -vn); const vt = vp.length();
      if (vt > 0.01) f.addScaledVector(vp, -Math.min(0.55 * Fn, 4000 * vt) / vt);
      this.F.add(f); this.T.add(this._a.crossVectors(r, f));
      if (pen > 0.6) p.y += (pen - 0.6);
      if (vn < -6) this.events.push(['scrape', -vn]);
    }
    // ---- aero, water, boost ----
    this.F.addScaledVector(v, -0.5 * 1.2 * c.cdA * speed);
    // terminal-speed caps: extra drag above vmax (no 300+ km/h cliff dives) and a vertical 'parachute' drag when falling fast
    if (speed > c.vmax) this.F.addScaledVector(v, -m * 0.006 * (speed - c.vmax));
    if (v.y < -22) this.F.y += m * 0.03 * (v.y + 22) * (v.y + 22);
    const depth = WATER + 0.5 - p.y;
    if (depth > 0) { const d = Math.min(depth, 1.6); this.F.addScaledVector(v, -(500 + 90 * speed) * d); this.F.y += m * c.g * 0.35 * d / 1.6; this.T.addScaledVector(w, -2500 * d); }
    if (inp.boost && this.boost > 0) { this.F.addScaledVector(fwd, c.boostPush); this.boost = Math.max(0, this.boost - dt * 0.3); }
    else this.boost = Math.min(1, this.boost + dt * (this.air > 0.4 ? 0.3 : 0.06));
    // ---- stability assist (arcade, FUEL-like): righting torque towards world-up, stronger on the ground ----
    { const k = (ng > 0 ? c.assistGround : c.assistAir) * (this.assist.stab ? 1.6 : 1), ax = this._a.crossVectors(up, this._b.set(0, 1, 0));
      // keep pitch freedom in the air (player controls it), assist mostly roll
      if (ng === 0) ax.addScaledVector(left, -ax.dot(left) * 0.85);
      this.T.addScaledVector(ax, k * m);
      if (this.assist.stab && ng > 0 && !inp.hand) this.T.addScaledVector(up, -w.dot(up) * m * 0.5); } // yaw damping: fewer surprise spins
    // ---- air control (pitch/roll/yaw) ----
    if (ng === 0) {
      this.air += dt; this.airMax = Math.max(this.airMax, this.air);
      const pitch = clamp(inp.pitch, -1, 1), roll = inp.steer;
      this.T.addScaledVector(left, pitch * c.airPitch).addScaledVector(fwd, -roll * c.airRoll * (inp.hand ? 1 : 0.6)).addScaledVector(up, roll * c.airYaw * (inp.hand ? 0 : 1));
      this.T.addScaledVector(w, -400);
    } else {
      if (this.air > 0.35) { const imp = Math.max(0, -this.vy0); this.landing = imp; this.events.push(['land', imp, this.air]);
        if (imp > 9) { const k = clamp(1 - (imp - 9) * 0.04, 0.45, 1); if (v.y < 0) v.y *= k; w.multiplyScalar(k); } } // soft cliff landings
      this.air = 0;
    }
    this.vy0 = v.y;
    // ---- integrate (semi-implicit Euler) ----
    { const a = this.F.length() / m, amax = 60 * c.g; if (a > amax) this.F.multiplyScalar(amax / a); } // clamp impulsive spikes (wedged wheels on cliff walls) to 60 g
    v.addScaledVector(this.F, dt / m);
    const tb = this._a.set(this.T.dot(left) / this.Ib[0], this.T.dot(up) / this.Ib[1], this.T.dot(fwd) / this.Ib[2]);
    w.addScaledVector(left, tb.x * dt).addScaledVector(up, tb.y * dt).addScaledVector(fwd, tb.z * dt);
    w.multiplyScalar(1 - 0.05 * dt);
    if (w.lengthSq() > 400) w.setLength(20);
    p.addScaledVector(v, dt);
    const dq = this._q || (this._q = new THREE.Quaternion());
    dq.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(this.q);
    this.q.x += dq.x; this.q.y += dq.y; this.q.z += dq.z; this.q.w += dq.w; this.q.normalize();
    // hard floor safety
    const g2 = ground(p.x, p.z); if (p.y < g2 - 0.3) { p.y = g2 + 0.2; if (v.y < 0) v.y = 0; }
    // wheel visual rotation
    for (const wh of this.wheels) wh.rot += wh.omega * dt;
    // ---- rollover auto-recover ----
    if (up.y < 0.35 && (speed < 4 || this.grounded === 0 && this.air > 4 || up.y < 0)) { this.flipT += dt; if (this.flipT > (speed < 4 ? 2.5 : 3.5)) this.recover(); } else this.flipT = 0;
  }
  recover() {
    this.basis(); const yaw = Math.atan2(this.fwd.x, this.fwd.z);
    this.p.y = ground(this.p.x, this.p.z) + 1.6; this.v.set(0, 0, 0); this.w.set(0, 0, 0);
    this.q.setFromAxisAngle(this._a.set(0, 1, 0), yaw); this.flipT = 0; this.events.push(['recover']);
  }
  collideCircles(col) { // rocks: x,z,r triples
    const p = this.p, v = this.v;
    for (let i = 0; i < col.length; i += 3) {
      const dx = p.x - col[i], dz = p.z - col[i + 1], r = col[i + 2] + 1.4, d2 = dx * dx + dz * dz;
      if (d2 > r * r || p.y - ground(col[i], col[i + 1]) > 7) continue;
      const d = Math.sqrt(d2) || 1, nx = dx / d, nz = dz / d; p.x = col[i] + nx * r; p.z = col[i + 1] + nz * r;
      const vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= 1.5 * vn * nx; v.z -= 1.5 * vn * nz; v.x *= 0.7; v.z *= 0.7; this.w.y += (Math.random() - 0.5) * 2; if (vn < -6) this.events.push(['crash', -vn]); }
    }
  }
}
const BODY = [];
for (const x of [-1, 1]) for (const z of [-2.2, 2.2]) BODY.push([x, -0.3, z]);
for (const x of [-0.9, 0.9]) for (const z of [-1.5, 1.2]) BODY.push([x, 0.85, z]);
BODY.push([0, 0.95, 0]);
