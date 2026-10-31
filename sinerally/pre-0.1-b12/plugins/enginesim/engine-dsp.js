// engine-dsp.js — pure-JS procedural engine synthesizer.
// Runs unchanged in three places:
//   * inside an AudioWorkletGlobalScope (auto-registers the 'engine-sim' processor at the bottom)
//   * on the main thread as a ScriptProcessor fallback / synchronous offline renderer
//   * in Node (tools/render-wavs.mjs) for regression renders
// No DOM / WebAudio dependencies in the EngineDSP class itself.

const TAU = 6.283185307179586;
export const SHAPE_ID = { thump: 0, bark: 1, crack: 2, brap: 3, soft: 4 };
const SHAPE_NOISE = [0.05, 0.12, 0.30, 0.40, 0.03];
const SHAPE_TONAL = [0.50, 0.65, 0.55, 0.85, 0.40];

function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }

function envShape(id, u) {
  let e;
  switch (id) {
    case 0: { const s = Math.sin(Math.PI * u); e = s * s; break; }          // thump: smooth, long
    case 1: e = u < 0.06 ? u / 0.06 : Math.exp(-(u - 0.06) * 5.5); break;    // bark: punchy
    case 2: e = u < 0.02 ? u / 0.02 : Math.exp(-(u - 0.02) * 9); break;      // crack: sharp click
    case 3: { const v = 1 - u; e = u < 0.015 ? u / 0.015 : v * v; break; }   // brap: saw-ish
    default: e = Math.sin(Math.PI * u);                                      // soft: half sine
  }
  return u > 0.85 ? e * (1 - u) * 6.6667 : e;
}

// RBJ biquad, transposed direct form II
class BQ {
  constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
  set(type, f, q, sr) {
    f = clamp(f, 10, sr * 0.45);
    const w = TAU * f / sr, c = Math.cos(w), s = Math.sin(w), al = s / (2 * q);
    let b0, b1, b2; const a0 = 1 + al, a1 = -2 * c, a2 = 1 - al;
    if (type === 'lp') { b0 = (1 - c) / 2; b1 = 1 - c; b2 = b0; }
    else if (type === 'hp') { b0 = (1 + c) / 2; b1 = -(1 + c); b2 = b0; }
    else { b0 = al; b1 = 0; b2 = -al; } // bp, 0 dB peak
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  p(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  reset() { this.z1 = this.z2 = 0; }
}

const DMASK = 4095; // delay line length 4096 (enough for 3 m runners at 96 kHz)

function makeBank() {
  return {
    cbuf: new Float32Array(DMASK + 1), clp: 0, tbuf: new Float32Array(DMASK + 1),
    mlp: new BQ(), mlp2: new BQ(), r1: new BQ(), r2: new BQ(), hp: new BQ(),
    pop: 0, popT: 0, popDelay: 0, popAmp: 0, popPending: false, popLp: new BQ()
  };
}

export class EngineDSP {
  constructor(sampleRate, cfg) {
    this.sr = sampleRate;
    this.seed = 0x12345678;
    this.thetaAbs = 0; this.base = 0; this.nextIdx = 0; this.nextAbs = 0;
    this.w = 0; // shared write index for delay lines
    this.cyl = []; this.order = [];
    this.banks = [makeBank(), makeBank()];
    this.p = { rpm: 800, throttle: 0, load: 0, nitro: 0, spark: 1, boost: 0 };
    this.s = { rpm: 800, thr: 0, load: 0, nitro: 0, boost: 0, spark: 1 };
    this.events = [];           // flat [cyl, frame, kind, ...] kind 0=fire 1=misfire/cut 2=pop
    this.peak = 0; this.nan = 0;
    this.script = null;          // optional keyframes for offline rendering
    this.frame = 0;
    // shared filters
    this.thumpLp = new BQ(); this.intBp = new BQ(); this.intLp = new BQ();
    this.tickBp = new BQ(); this.tickBp2 = new BQ();
    this.hissHp = new BQ(); this.whooshBp = new BQ(); this.bovBp = new BQ(); this.turbBp = new BQ();
    this.dcL = 0; this.dcR = 0; this.dcXL = 0; this.dcXR = 0;
    this.tickPh = 0; this.tickEnv = 0; this.tickAmp = 0;
    this.chainPh = 0; this.turboPh = 0; this.turboPh2 = 0; this.superPh = 0;
    this.whooshEnv = 0; this.whooshF = 3000; this.bovEnv = 0; this.prevThrT = 0; this.prevNitroT = 0;
    this.intakeKick = 0;
    this.blockCount = 0;
    this.thumpLp.set('lp', 170, 0.7, sampleRate);
    this.tickBp.set('bp', 4300, 2.2, sampleRate);
    this.tickBp2.set('bp', 1900, 3, sampleRate);
    this.hissHp.set('hp', 2800, 0.7, sampleRate);
    this.bovBp.set('bp', 2600, 0.8, sampleRate);
    if (cfg) this.setConfig(cfg);
  }

  rnd() { // xorshift32 -> [0,1)
    let x = this.seed; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.seed = x;
    return (x >>> 0) / 4294967296;
  }
  noise() { return this.rnd() * 2 - 1; }

  // cfg = dsp config from engine-config.toDspConfig()
  setConfig(cfg) {
    const sr = this.sr;
    const oldCycle = this.cycle || cfg.cycle;
    const phase = ((this.thetaAbs % oldCycle) + oldCycle) % oldCycle;
    this.cfg = cfg;
    this.cycle = cfg.cycle;
    const n = cfg.cyl.length;
    const cyl = [];
    for (let i = 0; i < n; i++) {
      const c = cfg.cyl[i];
      const prev = this.cyl[i];
      const D = clamp(Math.round((c.runner / 100) / 480 * sr), 2, (DMASK >> 1) - 2);
      cyl.push({
        fire: ((c.fire % this.cycle) + this.cycle) % this.cycle,
        vol: c.vol, shape: c.shape | 0, tonal: SHAPE_TONAL[c.shape | 0], noise: SHAPE_NOISE[c.shape | 0],
        tinc: TAU * c.tone / sr, misfire: c.misfire, rough: c.rough,
        wL: c.wL, wR: c.wR, bank: c.wR > c.wL ? 1 : 0,
        D, D2: D * 2, fb: -clamp(cfg.runnerReso, -0.92, 0.92), lpa: 1 - Math.exp(-TAU * 2500 / sr),
        buf: prev ? prev.buf : new Float32Array(DMASK + 1), lp: 0,
        active: false, t: 0, dur: 1, amp: 0, ph: 0, nit: 0
      });
    }
    this.cyl = cyl;
    this.order = cyl.map((c, i) => ({ a: c.fire, i })).sort((a, b) => a.a - b.a);
    // collector / tailpipe delays
    this.Dc = clamp(Math.round(0.0011 * sr), 2, DMASK - 2);
    const tone = clamp(cfg.mufflerTone, 0, 1);
    this.Dt = clamp(Math.round((0.0022 + 0.0016 * (1 - tone)) * sr), 2, DMASK - 2);
    this.tfb = 0.18 + 0.32 * tone;
    for (const b of this.banks) {
      b.r1.set('bp', 95 + 40 * tone, 2.5, sr);
      b.r2.set('bp', 240 + 160 * tone, 3, sr);
      b.hp.set('hp', 28, 0.7, sr);
      b.popLp.set('lp', 2600, 0.7, sr);
    }
    this.setMuffler(0);
    this.n = n;
    const dispPerCyl = cfg.displacement / Math.max(1, n);
    this.durDeg = (110 + 90 * clamp(dispPerCyl / 0.9, 0, 1.3)) * Math.sqrt(this.cycle / 720);
    this.ampScale = 0.55 / Math.pow(Math.max(1, n), 0.38) * (0.75 + 0.25 * clamp(dispPerCyl / 0.6, 0.2, 1.6));
    this.valveRate = cfg.stroke === 2 ? 0.5 : (cfg.stroke === 'rotary' ? 0 : 1);
    // re-sync firing pointer
    this.thetaAbs = phase % this.cycle; this.base = 0;
    this.nextIdx = this.order.findIndex(o => o.a > this.thetaAbs);
    if (this.nextIdx < 0) { this.nextIdx = 0; this.base = this.cycle; }
    this.nextAbs = this.base + this.order[this.nextIdx].a;
  }

  setMuffler(nitro) {
    const tone = clamp(this.cfg.mufflerTone, 0, 1);
    const f = (450 + 5200 * Math.pow(tone, 1.4)) * (1 + 0.35 * nitro);
    for (const b of this.banks) { b.mlp.set('lp', f, 0.75, this.sr); b.mlp2.set('lp', f * 1.6, 0.6, this.sr); }
  }

  setParams(p) { Object.assign(this.p, p); }

  applyScript(t) {
    const k = this.script; if (!k || !k.length) return;
    let i = 0; while (i < k.length - 1 && k[i + 1].t <= t) i++;
    const a = k[i], b = k[Math.min(i + 1, k.length - 1)];
    const u = b.t > a.t ? clamp((t - a.t) / (b.t - a.t), 0, 1) : 0;
    for (const key of ['rpm', 'throttle', 'load', 'nitro', 'spark', 'boost']) {
      if (a[key] !== undefined) this.p[key] = a[key] + ((b[key] ?? a[key]) - a[key]) * u;
    }
  }

  crankDeg() { return ((this.thetaAbs % this.cycle) + this.cycle) % this.cycle; }

  fire(ci, frame) {
    const c = this.cyl[ci], s = this.s, cfg = this.cfg, sr = this.sr;
    const rpm = s.rpm, idle = cfg.idleRpm;
    const sparkOk = this.rnd() < s.spark;
    const misfire = this.rnd() < c.misfire;
    const combust = sparkOk && !misfire;
    const overrun = s.thr < 0.06 && rpm > idle * 1.6;
    let amp;
    if (combust) {
      amp = c.vol * (0.30 + 0.70 * s.thr) * (0.75 + 0.25 * s.load) * (1 + 0.65 * s.nitro) * (1 + 0.25 * s.boost);
      amp *= 1 + c.rough * (this.rnd() - 0.5) * 1.2;
      if (overrun) amp *= 0.55;
    } else amp = c.vol * 0.07;
    c.amp = amp * this.ampScale;
    c.dur = Math.max(2, clamp(this.durDeg / (Math.max(rpm, 200) * 6), 0.0011, 0.036) * sr * (combust ? 1 : 0.6));
    c.t = -Math.floor(this.rnd() * c.rough * 0.0007 * sr); // timing jitter
    c.ph = 0; c.active = true; c.nit = s.nitro;
    this.events.push(ci, frame, combust ? 0 : 1);
    this.intakeKick += c.amp * 0.6 * (0.2 + s.thr);
    // afterfire pops: overrun / cut / misfire dump unburnt mixture into a hot exhaust
    const pops = cfg.pops;
    if (pops > 0 && (overrun || !combust) && rpm > idle * 1.8) {
      const chance = pops * (combust ? 0.05 : (s.spark < 0.5 ? 0.35 : 0.15));
      const b = this.banks[c.bank];
      if (!b.popPending && b.pop <= 0 && this.rnd() < chance) {
        b.popPending = true; b.popDelay = Math.floor((0.002 + this.rnd() * 0.02) * sr);
        b.popAmp = (0.5 + this.rnd() * 0.9) * (0.6 + 0.4 * pops);
        this.events.push(ci, frame + b.popDelay, 2);
      }
    }
  }

  // Fill L and R (Float32Array, length n). frame0 = absolute frame index of L[0].
  process(outL, outR, n, frame0) {
    const sr = this.sr, cfg = this.cfg, s = this.s, p = this.p;
    if (frame0 === undefined) frame0 = this.frame;
    if (this.script) this.applyScript(frame0 / sr);
    // ---- per-block parameter smoothing targets
    const kR = 1 - Math.exp(-1 / (0.012 * sr)), kT = 1 - Math.exp(-1 / (0.02 * sr));
    const nitroT = p.nitro > 0.5 ? 1 : 0;
    const thrT = clamp(p.throttle, 0, 1);
    // nitro onset whoosh + BOV detection (per block)
    if (nitroT && !this.prevNitroT) { this.whooshEnv = 1; this.whooshF = 3800; }
    if (this.prevThrT > 0.5 && thrT < 0.2 && s.boost > 0.3 && cfg.induction === 'turbo') this.bovEnv = Math.min(1, s.boost * 1.2);
    this.prevNitroT = nitroT; this.prevThrT = thrT;
    s.spark = clamp(p.spark, 0, 1);
    s.boost += (clamp(p.boost, 0, 1) - s.boost) * Math.min(1, n / (0.05 * sr));
    s.load += (clamp(p.load, 0, 1) - s.load) * Math.min(1, n / (0.03 * sr));
    const rpmN = clamp(s.rpm / cfg.redline, 0, 1.3);
    // block-rate filter updates
    this.intBp.set('bp', 160 + 950 * rpmN + 350 * s.thr, 1.3, sr);
    this.intLp.set('lp', 500 + 2500 * s.thr, 0.7, sr);
    if (cfg.induction === 'turbo') this.turbBp.set('bp', 900 + 3500 * s.boost, 1.2, sr);
    if (this.whooshEnv > 0.001) { this.whooshF = Math.max(450, this.whooshF * Math.pow(0.03, n / sr)); this.whooshBp.set('bp', this.whooshF, 1.6, sr); }
    if ((this.blockCount++ & 7) === 0) this.setMuffler(s.nitro);

    const cyl = this.cyl, nc = cyl.length, dual = cfg.dual, xo = clamp(cfg.crossover, 0, 1) * 0.5;
    const b0 = this.banks[0], b1 = this.banks[1];
    const Dc = this.Dc, Dt = this.Dt, tfb = this.tfb, cfb = -0.3;
    const clpa = 1 - Math.exp(-TAU * 3000 / sr);
    const exV = cfg.exhaustVol, inV = cfg.intakeVol, meV = cfg.mechVol, idV = cfg.inductionVol;
    const master = cfg.master;
    const tickDecay = Math.exp(-1 / (0.0006 * sr));
    const valveRate = this.valveRate;
    const nitroK = nitroT > s.nitro ? 1 - Math.exp(-1 / (0.02 * sr)) : 1 - Math.exp(-1 / (0.12 * sr));
    const whooshDecay = Math.exp(-1 / (0.18 * sr)), bovDecay = Math.exp(-1 / (0.16 * sr));
    const turbo = cfg.induction === 'turbo', sup = cfg.induction === 'super';
    let peak = this.peak;
    for (let i = 0; i < n; i++) {
      // smooth params
      s.rpm += (p.rpm - s.rpm) * kR;
      s.thr += (thrT - s.thr) * kT;
      s.nitro += (nitroT - s.nitro) * nitroK;
      const rpm = s.rpm < 0 ? 0 : s.rpm;
      // crank
      this.thetaAbs += rpm * 6 / sr; // deg per sample
      let guard = 0;
      while (this.thetaAbs >= this.nextAbs && guard++ < 32) {
        this.fire(this.order[this.nextIdx].i, frame0 + i);
        if (++this.nextIdx >= nc) { this.nextIdx = 0; this.base += this.cycle; }
        this.nextAbs = this.base + this.order[this.nextIdx].a;
      }
      // cylinders -> runners -> banks
      const w = this.w;
      let raw = 0, inL = 0, inR = 0;
      for (let k = 0; k < nc; k++) {
        const c = cyl[k];
        let x = 0;
        if (c.active) {
          if (c.t >= 0) {
            const u = c.t / c.dur;
            if (u >= 1) c.active = false;
            else {
              c.ph += c.tinc; if (c.ph > TAU) c.ph -= TAU;
              x = c.amp * envShape(c.shape, u) * (1 + c.tonal * Math.sin(c.ph) + c.noise * (1 + c.nit) * (this.rnd() * 2 - 1));
            }
          }
          c.t++;
        }
        raw += x;
        const buf = c.buf;
        c.lp += c.lpa * (buf[(w - c.D2) & DMASK] - c.lp);
        buf[w & DMASK] = x + c.fb * c.lp + 1e-20;
        const ro = buf[(w - c.D) & DMASK];
        inL += ro * c.wL; inR += ro * c.wR;
      }
      let eL, eR;
      if (dual) {
        const l = inL * (1 - xo) + inR * xo, r = inR * (1 - xo) + inL * xo;
        eL = this.bank(b0, l, w, Dc, Dt, cfb, clpa, tfb);
        eR = this.bank(b1, r, w, Dc, Dt, cfb, clpa, tfb);
      } else {
        eL = eR = this.bank(b0, inL + inR, w, Dc, Dt, cfb, clpa, tfb);
      }
      this.w = (w + 1) & 0x3fffffff;
      // engine block thump (dry, low)
      const th = this.thumpLp.p(raw) * 0.9;
      // intake: noise + pulse kicks through a moving bandpass
      this.intakeKick *= 0.995;
      const iIn = this.noise() * (0.015 + 0.10 * s.thr * (0.3 + rpmN)) + this.intakeKick * (this.rnd() * 2 - 1) * 0.5 + raw * 0.15 * s.thr;
      const intake = this.intLp.p(this.intBp.p(iIn)) * inV * 1.6;
      // valvetrain ticks + chain whine
      let mech = 0;
      if (meV > 0) {
        if (valveRate > 0) {
          this.tickPh += rpm / 60 * nc * valveRate / sr;
          if (this.tickPh >= 1) { this.tickPh -= 1; this.tickEnv = 1; this.tickAmp = 0.5 + 0.5 * this.rnd(); }
        }
        this.tickEnv *= tickDecay;
        const tn = this.noise() * this.tickEnv * this.tickAmp;
        this.chainPh += TAU * rpm / 60 * 19 / sr; if (this.chainPh > TAU) this.chainPh -= TAU;
        mech = (this.tickBp.p(tn) * 0.5 + this.tickBp2.p(tn) * 0.25 + Math.sin(this.chainPh) * 0.004) * meV * (0.25 + 0.9 * rpmN);
      }
      // forced induction
      let ind = 0;
      if (turbo) {
        const f = 1300 + 8200 * s.boost;
        this.turboPh += TAU * f / sr; if (this.turboPh > TAU) this.turboPh -= TAU;
        this.turboPh2 += TAU * f * 0.497 / sr; if (this.turboPh2 > TAU) this.turboPh2 -= TAU;
        const b2 = s.boost * s.boost;
        ind = (Math.sin(this.turboPh) * 0.018 + Math.sin(this.turboPh2) * 0.006) * b2 * (0.35 + 0.65 * s.thr)
            + this.turbBp.p(this.noise()) * 0.05 * b2 * s.thr;
        if (this.bovEnv > 0.001) {
          this.bovEnv *= bovDecay;
          const flutter = 0.6 + 0.4 * Math.sin(TAU * 17 * this.bovEnv * 4);
          ind += this.bovBp.p(this.noise()) * this.bovEnv * 0.22 * flutter;
        }
      } else if (sup) {
        this.superPh += TAU * rpm * 0.21 / sr; if (this.superPh > TAU) this.superPh -= TAU;
        const sv = Math.sin(this.superPh);
        ind = (sv * 0.7 + Math.sin(this.superPh * 2) * 0.3 + sv * sv * sv * 0.2) * 0.02 * rpmN * (0.25 + 0.75 * s.thr);
      }
      ind *= idV;
      // nitrous: steady hiss + onset whoosh
      let nos = 0;
      if (s.nitro > 0.001) nos = this.hissHp.p(this.noise()) * s.nitro * 0.09;
      if (this.whooshEnv > 0.001) { this.whooshEnv *= whooshDecay; nos += this.whooshBp.p(this.noise()) * this.whooshEnv * 0.35; }
      // mix
      let L = (eL * exV + th * exV * 0.6 + intake * 0.9 + mech + ind + nos) * master;
      let R = (eR * exV + th * exV * 0.6 + intake * 1.1 + mech * 0.8 + ind + nos) * master;
      // DC block
      this.dcL = L - this.dcXL + 0.9985 * this.dcL; this.dcXL = L; L = this.dcL;
      this.dcR = R - this.dcXR + 0.9985 * this.dcR; this.dcXR = R; R = this.dcR;
      // soft clip (rational tanh approximation, hard-limited to +-1)
      L = L > 3 ? 1 : L < -3 ? -1 : L * (27 + L * L) / (27 + 9 * L * L);
      R = R > 3 ? 1 : R < -3 ? -1 : R * (27 + R * R) / (27 + 9 * R * R);
      if (L !== L || R !== R) { this.nan++; L = R = 0; this.resetState(); }
      L *= 0.97; R *= 0.97;
      const aL = L < 0 ? -L : L, aR = R < 0 ? -R : R;
      if (aL > peak) peak = aL; if (aR > peak) peak = aR;
      outL[i] = L; outR[i] = R;
    }
    this.peak = peak;
    this.frame = frame0 + n;
    if (this.thetaAbs > 1e7) { const sub = Math.floor(this.base / this.cycle) * this.cycle; this.thetaAbs -= sub; this.base -= sub; this.nextAbs -= sub; }
  }

  bank(b, x, w, Dc, Dt, cfb, clpa, tfb) {
    // collector: short feedback comb (merge reflections)
    b.clp += clpa * (b.cbuf[(w - Dc) & DMASK] - b.clp);
    const cs = x + cfb * b.clp + 1e-20;
    b.cbuf[w & DMASK] = cs;
    let y = cs;
    // afterfire pop injected at the collector
    if (b.popPending) { if (--b.popDelay <= 0) { b.popPending = false; b.pop = 1; b.popT = 0; } }
    if (b.pop > 0) {
      const u = b.popT++ / (0.009 * this.sr);
      if (u >= 1) b.pop = 0;
      else y += b.popLp.p((u < 0.03 ? u / 0.03 : Math.exp(-(u - 0.03) * 6)) * (this.rnd() * 2 - 1 + 0.6) * b.popAmp * 0.9);
    }
    // muffler: lowpass body + two chamber resonators
    const m = b.mlp2.p(b.mlp.p(y));
    const res = b.r1.p(y) * 0.9 + b.r2.p(y) * 0.45;
    let o = m * 0.8 + res;
    // tailpipe comb
    const t = o + tfb * b.tbuf[(w - Dt) & DMASK] + 1e-20;
    b.tbuf[w & DMASK] = t * 0.92;
    return b.hp.p(t) * 1.4;
  }

  resetState() {
    for (const c of this.cyl) { c.buf.fill(0); c.lp = 0; c.active = false; }
    for (const b of this.banks) { b.cbuf.fill(0); b.tbuf.fill(0); b.clp = 0; for (const f of [b.mlp, b.mlp2, b.r1, b.r2, b.hp, b.popLp]) f.reset(); }
    for (const f of [this.thumpLp, this.intBp, this.intLp, this.tickBp, this.tickBp2, this.hissHp, this.whooshBp, this.bovBp, this.turbBp]) f.reset();
    this.dcL = this.dcR = this.dcXL = this.dcXR = 0;
  }
}

// ---------------------------------------------------------------------------
// AudioWorklet registration (only when loaded via audioWorklet.addModule)
if (typeof registerProcessor === 'function' && typeof AudioWorkletProcessor !== 'undefined') {
  class EngineSimProcessor extends AudioWorkletProcessor {
    constructor(options) {
      super();
      const o = (options && options.processorOptions) || {};
      this.dsp = new EngineDSP(sampleRate, o.cfg);
      if (o.params) this.dsp.setParams(o.params);
      if (o.script) this.dsp.script = o.script;
      this.post = o.postEvery || 2; this.blocks = 0; this.alive = true;
      this.port.onmessage = (e) => {
        const m = e.data;
        if (m.type === 'config') this.dsp.setConfig(m.cfg);
        else if (m.type === 'params') this.dsp.setParams(m.p);
        else if (m.type === 'script') this.dsp.script = m.script;
        else if (m.type === 'stop') this.alive = false;
      };
    }
    process(inputs, outputs) {
      const out = outputs[0];
      if (!out || !out[0]) return this.alive;
      const L = out[0], R = out[1] || null;
      if (R) this.dsp.process(L, R, L.length, currentFrame);
      else { if (!this.tmp || this.tmp.length !== L.length) this.tmp = new Float32Array(L.length); this.dsp.process(L, this.tmp, L.length, currentFrame); }
      if (++this.blocks >= this.post) {
        this.blocks = 0;
        const d = this.dsp;
        this.port.postMessage({ type: 'ev', ev: d.events, frame: currentFrame + L.length, crank: d.crankDeg(), rpm: d.s.rpm, cycle: d.cycle, peak: d.peak, nan: d.nan });
        d.events = []; d.peak = 0;
      }
      return this.alive;
    }
  }
  registerProcessor('engine-sim', EngineSimProcessor);
}
