// motor.js — tiny engine + car model driven only by GAS, BRAKE, NITRO.
// Produces the telemetry EngineSim.update() consumes: rpm, throttle, load, nitro, spark, boost.
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

export class MotorModel {
  constructor(cfg) {
    this.rpm = cfg.idleRpm; this.v = 0; this.gear = 1; this.neutral = false;
    this.locked = false; this.shiftT = 0; this.shiftDir = 0; this.shiftFrom = 1;
    this.cutT = 0; this.boost = 0; this.nitroTank = 1; this.limiterT = 0; this.shiftFlashT = 0;
    this.time = 0; this.out = {};
    this.setConfig(cfg);
  }

  setConfig(cfg) {
    this.cfg = cfg;
    const ind = cfg.induction === 'turbo' ? 1.4 : cfg.induction === 'super' ? 1.3 : 1;
    const spec = cfg.stroke === 2 ? 150 : cfg.layout === 'rotary' ? 120 : 100; // Nm per litre
    this.Tpeak = Math.max(8, cfg.displacement * spec * ind / (cfg.induction === 'none' ? 1 : 1.25));
    this.I = Math.max(0.01, +cfg.inertia);
    const ng = cfg.car.gears.length;
    if (this.gear > ng) this.gear = ng;
  }

  torqueCurve(rpm) { // normalised 0..1, peak ~0.65 redline
    const x = clamp(rpm / this.cfg.redline, 0, 1.2);
    return clamp(0.45 + 1.692 * x - 1.302 * x * x, 0.2, 1);
  }

  ratio(g) { const c = this.cfg.car; return c.gears[clamp(g, 1, c.gears.length) - 1] * c.final; }
  rpmFromSpeed(v, g) { return v / this.cfg.car.wheelR * this.ratio(g) * 60 / TAU; }

  startShift(dir) {
    this.shiftFrom = this.gear;
    this.gear = clamp(this.gear + dir, 1, this.cfg.car.gears.length);
    if (this.gear === this.shiftFrom) return;
    this.shiftDir = dir; this.shiftT = dir > 0 ? 0.22 : 0.28; this.shiftFlashT = 0.6; this.locked = false;
  }

  setNeutral(on) { this.neutral = !!on; this.locked = false; this.shiftT = 0; }

  // inp: {gas 0..1, brake 0..1, nitro bool}
  step(dt, inp) {
    dt = clamp(dt, 0, 0.1);
    const N = Math.max(1, Math.ceil(dt / (1 / 480)));
    const h = dt / N;
    for (let i = 0; i < N; i++) this.sub(h, inp);
    this.time += dt;
    this.limiterT = Math.max(0, this.limiterT - dt);
    this.shiftFlashT = Math.max(0, this.shiftFlashT - dt);
    const o = this.out;
    o.rpm = this.rpm; o.throttle = this.thrEff; o.load = this.load; o.nitro = this.nitroOn ? 1 : 0;
    o.spark = this.spark; o.boost = this.boost; o.gear = this.neutral ? 'N' : this.gear;
    o.speedKmh = this.v * 3.6; o.shifting = this.shiftT > 0; o.limiter = this.limiterT > 0;
    o.nitroTank = this.nitroTank; o.shiftFlash = this.shiftFlashT; o.shiftDir = this.shiftDir;
    o.torque = this.Te; o.redline = this.cfg.redline;
    return o;
  }

  sub(h, inp) {
    const c = this.cfg, car = c.car, red = c.redline, idle = c.idleRpm;
    const gas = clamp(+inp.gas || 0, 0, 1), brake = clamp(+inp.brake || 0, 0, 1);
    // nitrous tank
    this.nitroOn = !!inp.nitro && this.nitroTank > 0.005;
    if (this.nitroOn) this.nitroTank = Math.max(0, this.nitroTank - h * 0.14);
    else this.nitroTank = Math.min(1, this.nitroTank + h * 0.06);
    // idle air control keeps it running
    const idleThr = clamp(0.06 + (idle - this.rpm) / 300, 0, 0.45);
    let thr = Math.max(gas, idleThr);
    // limiter
    let spark = 1;
    if (this.cutT > 0) { this.cutT -= h; spark = 0; }
    else if (c.limiter === 'soft') {
      if (this.rpm > red - 150) { spark = clamp((red + 150 - this.rpm) / 300, 0, 1); if (spark < 0.95) this.limiterT = 0.15; }
      if (this.rpm > red + 200) { this.cutT = 0.03; spark = 0; }
    } else if (this.rpm >= red) {
      this.cutT = c.limiter === 'pops' ? 0.085 : 0.045; spark = 0; this.limiterT = 0.2;
    }
    // shift sequencing
    const shifting = this.shiftT > 0;
    if (shifting) {
      this.shiftT -= h;
      if (this.shiftDir > 0) { thr = 0; spark = 0; }          // upshift: ignition cut
      else { thr = Math.max(thr, 0.55); }                    // downshift: throttle blip
    }
    // boost spool
    const x = this.rpm / red;
    if (c.induction === 'turbo') {
      const target = clamp(thr * (x * 1.5 - 0.2), 0, 1) * (spark > 0 ? 1 : 0.6);
      this.boost += (target - this.boost) * h * (target > this.boost ? 1.4 : 2.6);
    } else if (c.induction === 'super') this.boost = clamp(thr * x * 1.1, 0, 1);
    else this.boost = 0;
    const indGain = c.induction === 'none' ? 1 : (c.induction === 'turbo' ? 1 + 0.6 * this.boost : 1 + 0.4 * this.boost);
    // engine torque
    const Tp = this.Tpeak;
    let Te = Tp * this.torqueCurve(this.rpm) * thr * indGain * spark;
    if (this.nitroOn && spark > 0) Te = Te * 1.5 + Tp * 0.25 * Math.max(thr, 0.3);
    const Tf = Tp * (0.04 + 0.11 * x) * (1 - 0.4 * thr);
    Te -= Tf;
    this.Te = Te;
    // resistances
    const v = this.v;
    const resist = 0.015 * car.mass * 9.81 * clamp(v / 0.3, 0, 1) + 0.42 * v * v;
    const brakeF = brake * car.mass * 9.81 * 0.95 * clamp(v / 0.1, 0, 1);
    const kRpm = 60 / TAU;
    if (this.neutral || shifting) {
      if (shifting) {
        const target = Math.max(idle, this.rpmFromSpeed(v, this.gear));
        const k = 1 - Math.exp(-h / (this.shiftDir > 0 ? 0.07 : 0.05));
        this.rpm += (target - this.rpm) * k;
        if (this.shiftT <= 0) { this.shiftT = 0; this.locked = this.rpmFromSpeed(v, this.gear) > idle * 0.9; }
      } else this.rpm += Te / this.I * h * kRpm;
      this.v = Math.max(0, v - (resist + brakeF) / car.mass * h);
    } else {
      const G = this.ratio(this.gear), r = car.wheelR, eff = 0.9;
      const rw = this.rpmFromSpeed(v, this.gear);
      if (this.locked) {
        const mEff = car.mass + this.I * (G / r) * (G / r);
        const a = (Te * G / r * eff - resist - brakeF) / mEff;
        this.v = Math.max(0, v + a * h);
        this.rpm = this.rpmFromSpeed(this.v, this.gear);
        if (this.rpm < idle * 0.85) this.locked = false;
      } else {
        // slipping clutch / torque converter
        // torque-converter-ish: capacity grows with engine speed above idle, tapers as slip closes
        const cap = clamp((this.rpm - idle * 0.85) / (0.4 * red), 0, 1.3);
        const Tc = Tp * 1.15 * cap * cap * clamp((this.rpm - rw) / 250, -1, 1) + (this.rpm - rw) * Tp / 4000;
        this.rpm += (Te - Tc) / this.I * h * kRpm;
        const a = (Tc * G / r * eff - resist - brakeF) / car.mass;
        this.v = Math.max(0, v + a * h);
        const rw2 = this.rpmFromSpeed(this.v, this.gear);
        if (Math.abs(this.rpm - rw2) < 80 && rw2 >= idle * 0.95) this.locked = true;
        if (this.gear > 1 && rw2 < idle) this.gear--; // silently fall back towards 1st when stopped
      }
      // automatic gearbox
      if (this.shiftT <= 0 && this.locked) {
        const ng = car.gears.length;
        const up = red * (0.6 + 0.37 * gas);
        const down = Math.max(idle * 1.5, red * (0.26 + 0.27 * gas));
        if (this.gear < ng && this.rpm > up && gas > 0.05) this.startShift(+1);
        else if (this.gear > 1 && this.rpm < down) this.startShift(-1);
      }
    }
    this.rpm = clamp(this.rpm, idle * 0.6, red * 1.12);
    this.thrEff = thr; this.spark = spark;
    this.load = clamp(thr * (this.neutral ? 0.55 : 1) * (Te > 0 ? 1 : 0.4), 0, 1);
  }
}
