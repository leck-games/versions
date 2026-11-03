// engine-config.js — engine layouts, firing orders, crank-angle derivation, presets.
import { SHAPE_ID } from './engine-dsp.js';

export const SHAPES = [
  ['thump', 'Thump (deep, round)'], ['bark', 'Bark (punchy)'], ['crack', 'Crack (sharp)'],
  ['brap', 'Brap (2-stroke saw)'], ['soft', 'Soft (smooth sine)']
];
export const LAYOUTS = [
  ['inline', 'Inline'], ['v', 'V'], ['boxer', 'Boxer / Flat'], ['single', 'Single'],
  ['rotary', 'Rotary (Wankel-ish)'], ['custom', 'Custom']
];
export const BANK_ANGLES = [15, 45, 54, 60, 72, 75, 90, 110, 120, 135, 180];
export const LIMITERS = [['hard', 'Hard cut (bounce)'], ['soft', 'Soft (random cut)'], ['pops', 'Pops & bangs']];
export const INDUCTION = [['none', 'Naturally aspirated'], ['turbo', 'Turbo (whine + BOV)'], ['super', 'Supercharger (whine)']];

/** Max cylinders / rotors for every layout (the DSP and the firing lights track 16). */
export const MAX_CYL = 16;
const range = (a, b, s = 1) => { const r = []; for (let i = a; i <= b; i += s) r.push(i); return r; };
export function countsFor(layout) {
  switch (layout) {
    case 'inline': return range(2, MAX_CYL);
    case 'v': return range(2, MAX_CYL, 2);       // two equal banks
    case 'boxer': return range(2, MAX_CYL, 2);   // opposed pairs
    case 'single': return [1];
    case 'rotary': return range(1, MAX_CYL);     // 1–16 rotors, each fires once per eccentric-shaft rev, phased 360°/n
    default: return range(1, MAX_CYL);
  }
}

export function crankOptions(cfg) {
  const { layout, cylinders: n } = cfg;
  if (layout === 'inline' && n === 2) return [['360', '360° (parallel twin)'], ['180', '180°'], ['270', '270° (crossplane twin)']];
  if (layout === 'v' && n === 8) return [['cross', 'Cross-plane'], ['flat', 'Flat-plane']];
  if (layout === 'v') return [['common', 'Common pin (odd-fire)'], ['even', 'Split pin (even-fire)']];
  return [['even', 'Even fire']];
}

// Rotary: one firing per rotor per eccentric-shaft revolution, so the cycle is 360° of e-shaft and n rotors are
// phased 360°/n apart (firingIntervals -> even). 2-strokes also fire every 360°.
export function cycleOf(cfg) { return (cfg.layout === 'rotary' || cfg.stroke === 2) ? 360 : 720; }

export function defaultFiringOrder(cfg) {
  const { layout, cylinders: n, crank } = cfg;
  const seq = Array.from({ length: n }, (_, i) => i + 1);
  if (layout === 'inline') {
    return ({ 3: [1, 2, 3], 4: [1, 3, 4, 2], 5: [1, 2, 4, 5, 3], 6: [1, 5, 3, 6, 2, 4] })[n] || seq;
  }
  if (layout === 'v') {
    if (n === 8) return crank === 'flat' ? [1, 5, 3, 7, 4, 8, 2, 6] : [1, 8, 4, 3, 6, 5, 7, 2];
    if (n === 10) return [1, 6, 5, 10, 2, 7, 3, 8, 4, 9];
    if (n === 12) return [1, 7, 5, 11, 3, 9, 6, 12, 2, 8, 4, 10];
    return seq; // V2, V6 (alternating numbering)
  }
  if (layout === 'boxer') return ({ 4: [1, 3, 2, 4], 6: [1, 6, 2, 4, 3, 5] })[n] || seq;
  return seq;
}

// Geometry: per cylinder {angle (deg from vertical, -left/+right), pos (along crank), bank}
export function layoutGeometry(cfg) {
  const { layout, cylinders: n } = cfg;
  const a = cfg.bankAngle / 2;
  const g = [];
  for (let i = 0; i < n; i++) {
    let bank = 0, pos = i, angle = 0;
    if (layout === 'v') {
      const half = (n === 2 || n === 6 || (n === 8 && cfg.crank !== 'flat')); // alternating (GM-style) numbering
      if (n === 2) { bank = i; pos = i * 0.45; }
      else if (half) { bank = i % 2; pos = Math.floor(i / 2) + bank * 0.45; }
      else { const h = n / 2; bank = i < h ? 0 : 1; pos = (i % h) + bank * 0.45; }
      angle = bank ? a : -a;
    } else if (layout === 'boxer') {
      if (n === 2) { bank = i; pos = i * 0.45; }
      else if (n === 4) { bank = i % 2 === 0 ? 1 : 0; pos = Math.floor(i / 2) + (bank ? 0 : 0.45); }
      else { const h = n / 2; bank = i < h ? 0 : 1; pos = (i % h) + bank * 0.45; }
      angle = bank ? 90 : -90;
    } else if (layout === 'custom') {
      const c = cfg.cyl[i] || {};
      angle = c.angle ?? 0; pos = c.pos ?? i;
      bank = angle > 1 ? 1 : 0;
    }
    g.push({ angle, pos, bank });
  }
  return g;
}

// Firing intervals (deg) between consecutive cylinders in firing order; sums to the cycle.
export function firingIntervals(cfg) {
  const n = cfg.cylinders, cycle = cycleOf(cfg), I = cycle / n;
  const even = Array(n).fill(I);
  if (n === 1) return [cycle];
  const four = cycle === 720;
  if (cfg.layout === 'inline' && n === 2 && four) {
    return ({ '360': [360, 360], '180': [180, 540], '270': [270, 450] })[cfg.crank] || [360, 360];
  }
  if (cfg.layout === 'v' && cfg.crank !== 'even') {
    const al = cfg.bankAngle;
    if (n === 2) return four ? [360 + al, 360 - al] : [Math.max(5, Math.min(355, al)), 360 - Math.max(5, Math.min(355, al))];
    if (!four) return even;
    const x = Math.max(5, Math.min(2 * I - 5, al % (2 * I) || 2 * I - 5));
    return Array.from({ length: n }, (_, k) => (k % 2 === 0 ? x : 2 * I - x));
  }
  return even;
}

export function parseFiringOrder(str, n) {
  const nums = String(str).split(/[^0-9]+/).filter(Boolean).map(Number);
  if (nums.length !== n) return null;
  const seen = new Set(nums);
  if (seen.size !== n) return null;
  for (let i = 1; i <= n; i++) if (!seen.has(i)) return null;
  return nums;
}

export const DEFAULT_CYL = { vol: 1, tone: 120, shape: 'bark', runner: 45, misfire: 0, rough: 0.15 };

export const DEFAULT_CAR = { mass: 1450, gears: [3.2, 2.15, 1.55, 1.18, 0.95, 0.78], final: 3.6, wheelR: 0.33 };

export const BASE_CONFIG = {
  name: 'Custom', layout: 'v', cylinders: 8, bankAngle: 90, crank: 'cross', stroke: 4,
  firingOrder: null, manualFire: false, cyl: [],
  displacement: 5.0, idleRpm: 750, redline: 6500, limiter: 'hard', inertia: 0.25,
  exhaustVol: 1, mufflerTone: 0.5, exhaust: 'dual', crossover: 0.2, runnerReso: 0.45,
  intakeVol: 0.5, mechVol: 0.4, induction: 'none', inductionVol: 0.7, pops: 0.3, master: 0.8,
  car: DEFAULT_CAR
};

export const clone = (o) => JSON.parse(JSON.stringify(o));

// Normalise + derive geometry and fire angles. Returns a NEW config object.
export function deriveEngine(input) {
  const cfg = Object.assign(clone(BASE_CONFIG), clone(input));
  cfg.car = Object.assign(clone(DEFAULT_CAR), cfg.car || {});
  if (cfg.layout === 'single') cfg.cylinders = 1;
  cfg.cylinders = Math.round(+cfg.cylinders) || 1;
  const counts = countsFor(cfg.layout);
  if (!counts.includes(cfg.cylinders)) cfg.cylinders = counts.includes(4) ? 4 : counts[Math.min(counts.length - 1, 2)];
  const n = cfg.cylinders;
  const copts = crankOptions(cfg).map(o => o[0]);
  if (!copts.includes(cfg.crank)) cfg.crank = copts[0];
  // per-cylinder array
  const cyl = (cfg.cyl || []).slice(0, n);
  while (cyl.length < n) cyl.push(Object.assign({}, cyl[cyl.length - 1] || DEFAULT_CYL, { fire: undefined, angle: undefined, pos: undefined }));
  cfg.cyl = cyl.map(c => Object.assign({}, DEFAULT_CYL, c));
  // firing order
  if (!cfg.firingOrder || !parseFiringOrder(cfg.firingOrder.join('-'), n)) cfg.firingOrder = defaultFiringOrder(cfg);
  // geometry
  const geo = layoutGeometry(cfg);
  geo.forEach((g, i) => { cfg.cyl[i].angle = g.angle; cfg.cyl[i].pos = g.pos; cfg.cyl[i].bank = g.bank; });
  // fire angles
  const cycle = cycleOf(cfg);
  const manualOk = cfg.manualFire && cfg.cyl.every(c => typeof c.fire === 'number' && isFinite(c.fire));
  if (!manualOk) {
    cfg.manualFire = false;
    const iv = firingIntervals(cfg);
    let acc = 0;
    cfg.firingOrder.forEach((num, k) => { cfg.cyl[num - 1].fire = Math.round(acc * 100) / 100; acc += iv[k]; });
  } else cfg.cyl.forEach(c => { c.fire = ((c.fire % cycle) + cycle) % cycle; });
  cfg.cycle = cycle;
  return cfg;
}

// Flatten to what EngineDSP needs.
export function toDspConfig(cfg) {
  return {
    cycle: cfg.cycle || cycleOf(cfg),
    stroke: cfg.layout === 'rotary' ? 'rotary' : cfg.stroke,
    cyl: cfg.cyl.map(c => {
      const a = c.angle || 0;
      const side = a > 1 ? 1 : a < -1 ? -1 : 0;
      return {
        fire: c.fire, vol: +c.vol, tone: +c.tone, shape: SHAPE_ID[c.shape] ?? 1, runner: +c.runner,
        misfire: +c.misfire, rough: +c.rough,
        wL: side < 0 ? 1 : side > 0 ? 0 : 0.707, wR: side > 0 ? 1 : side < 0 ? 0 : 0.707
      };
    }),
    displacement: +cfg.displacement, idleRpm: +cfg.idleRpm, redline: +cfg.redline,
    exhaustVol: +cfg.exhaustVol, mufflerTone: +cfg.mufflerTone, dual: cfg.exhaust === 'dual', crossover: +cfg.crossover,
    runnerReso: +cfg.runnerReso, intakeVol: +cfg.intakeVol, mechVol: cfg.layout === 'rotary' ? 0 : +cfg.mechVol,
    induction: cfg.induction, inductionVol: +cfg.inductionVol, pops: +cfg.pops, master: +cfg.master
  };
}

const C = (o) => Object.assign({}, DEFAULT_CYL, o);
const rep = (n, f) => Array.from({ length: n }, (_, i) => f(i));

export const PRESETS = {
  muscleV8: {
    name: 'American V8 Muscle', layout: 'v', cylinders: 8, bankAngle: 90, crank: 'cross', stroke: 4,
    cyl: rep(8, i => C({ shape: 'thump', tone: 82 + (i % 3) * 6, runner: 70 + (i % 4) * 12, rough: 0.3, misfire: 0.004, vol: 1 })),
    displacement: 6.2, idleRpm: 700, redline: 6500, limiter: 'hard', inertia: 0.32,
    exhaustVol: 1.1, mufflerTone: 0.62, exhaust: 'dual', crossover: 0.12, runnerReso: 0.5,
    intakeVol: 0.45, mechVol: 0.35, induction: 'none', pops: 0.35, master: 0.9,
    car: { mass: 1650, gears: [2.97, 2.07, 1.43, 1.0, 0.84, 0.56], final: 3.73, wheelR: 0.34 }
  },
  flatV8: {
    name: 'Flat-plane V8 (scream)', layout: 'v', cylinders: 8, bankAngle: 90, crank: 'flat', stroke: 4,
    cyl: rep(8, i => C({ shape: 'bark', tone: 170 + (i % 2) * 10, runner: 38, rough: 0.08 })),
    displacement: 4.5, idleRpm: 1000, redline: 9000, limiter: 'hard', inertia: 0.15,
    exhaustVol: 1, mufflerTone: 0.72, exhaust: 'dual', crossover: 0.25, runnerReso: 0.45,
    intakeVol: 0.7, mechVol: 0.45, induction: 'none', pops: 0.25, master: 1.35,
    car: { mass: 1450, gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], final: 4.44, wheelR: 0.34 }
  },
  inline6: {
    name: 'Inline-6 (silky)', layout: 'inline', cylinders: 6, stroke: 4,
    cyl: rep(6, i => C({ shape: 'soft', tone: 150, runner: 48, rough: 0.06 })),
    displacement: 3.0, idleRpm: 750, redline: 7200, limiter: 'soft', inertia: 0.2,
    exhaustVol: 1, mufflerTone: 0.55, exhaust: 'single', crossover: 0, runnerReso: 0.5,
    intakeVol: 0.6, mechVol: 0.4, induction: 'turbo', inductionVol: 0.5, pops: 0.15, master: 0.78,
    car: { mass: 1500, gears: [4.11, 2.32, 1.54, 1.18, 1.0, 0.85], final: 3.15, wheelR: 0.33 }
  },
  boxer4: {
    name: 'Boxer-4 Rumble', layout: 'boxer', cylinders: 4, stroke: 4,
    cyl: [C({ shape: 'thump', tone: 110, runner: 40, rough: 0.2 }), C({ shape: 'thump', tone: 105, runner: 190, rough: 0.2 }),
          C({ shape: 'thump', tone: 112, runner: 55, rough: 0.2 }), C({ shape: 'thump', tone: 100, runner: 210, rough: 0.2 })],
    displacement: 2.5, idleRpm: 800, redline: 7000, limiter: 'hard', inertia: 0.18,
    exhaustVol: 1.1, mufflerTone: 0.6, exhaust: 'single', crossover: 0, runnerReso: 0.55,
    intakeVol: 0.5, mechVol: 0.4, induction: 'turbo', inductionVol: 0.8, pops: 0.3, master: 0.71,
    car: { mass: 1450, gears: [3.64, 2.24, 1.52, 1.13, 0.92, 0.75], final: 3.9, wheelR: 0.33 }
  },
  inline4: {
    name: 'Inline-4 Tuner', layout: 'inline', cylinders: 4, stroke: 4,
    cyl: rep(4, () => C({ shape: 'crack', tone: 260, runner: 32, rough: 0.12 })),
    displacement: 2.0, idleRpm: 950, redline: 8600, limiter: 'pops', inertia: 0.11,
    exhaustVol: 1, mufflerTone: 0.88, exhaust: 'single', crossover: 0, runnerReso: 0.4,
    intakeVol: 0.75, mechVol: 0.55, induction: 'turbo', inductionVol: 1, pops: 0.7, master: 0.72,
    car: { mass: 1200, gears: [3.27, 2.13, 1.52, 1.15, 0.92, 0.74], final: 4.3, wheelR: 0.31 }
  },
  v12: {
    name: 'V12 (60°)', layout: 'v', cylinders: 12, bankAngle: 60, crank: 'even', stroke: 4,
    cyl: rep(12, i => C({ shape: 'soft', tone: 210 + (i % 2) * 8, runner: 42, rough: 0.04 })),
    displacement: 6.5, idleRpm: 900, redline: 8500, limiter: 'soft', inertia: 0.22,
    exhaustVol: 1, mufflerTone: 0.7, exhaust: 'dual', crossover: 0.3, runnerReso: 0.45,
    intakeVol: 0.75, mechVol: 0.4, induction: 'none', pops: 0.15, master: 1.4,
    car: { mass: 1600, gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], final: 4.1, wheelR: 0.34 }
  },
  dirtbike: {
    name: 'Single-cyl Dirt Bike (450 4T)', layout: 'single', cylinders: 1, stroke: 4,
    cyl: [C({ shape: 'bark', tone: 170, runner: 85, rough: 0.25, misfire: 0.01 })],
    displacement: 0.45, idleRpm: 1700, redline: 11000, limiter: 'hard', inertia: 0.035,
    exhaustVol: 1.2, mufflerTone: 0.75, exhaust: 'single', runnerReso: 0.55,
    intakeVol: 0.6, mechVol: 0.5, induction: 'none', pops: 0.5, master: 0.73,
    car: { mass: 190, gears: [2.4, 1.9, 1.6, 1.35, 1.15], final: 9.5, wheelR: 0.33 }
  },
  twoStroke: {
    name: '2-Stroke 125 (ring-ding)', layout: 'single', cylinders: 1, stroke: 2,
    cyl: [C({ shape: 'brap', tone: 330, runner: 115, rough: 0.35, misfire: 0.02 })],
    displacement: 0.125, idleRpm: 1600, redline: 12500, limiter: 'hard', inertia: 0.02,
    exhaustVol: 1.2, mufflerTone: 0.9, exhaust: 'single', runnerReso: -0.65,
    intakeVol: 0.7, mechVol: 0.15, induction: 'none', pops: 0.2, master: 0.52,
    car: { mass: 160, gears: [2.6, 1.95, 1.6, 1.38, 1.2, 1.08], final: 8.2, wheelR: 0.33 }
  },
  rotary: {
    name: 'Rotary 2-rotor (brap)', layout: 'rotary', cylinders: 2,
    cyl: rep(2, () => C({ shape: 'brap', tone: 230, runner: 30, rough: 0.18 })),
    displacement: 1.3, idleRpm: 950, redline: 9000, limiter: 'pops', inertia: 0.12,
    exhaustVol: 1, mufflerTone: 0.85, exhaust: 'single', runnerReso: 0.35,
    intakeVol: 0.6, mechVol: 0, induction: 'none', pops: 0.6, master: 0.53,
    car: { mass: 1250, gears: [3.48, 2.02, 1.39, 1.0, 0.72], final: 4.1, wheelR: 0.32 }
  },
  vtwin: {
    name: 'Big V-Twin (45° potato)', layout: 'v', cylinders: 2, bankAngle: 45, crank: 'common', stroke: 4,
    cyl: rep(2, () => C({ shape: 'thump', tone: 70, runner: 95, rough: 0.35, misfire: 0.01 })),
    displacement: 1.8, idleRpm: 850, redline: 5600, limiter: 'hard', inertia: 0.1,
    exhaustVol: 1.2, mufflerTone: 0.55, exhaust: 'single', runnerReso: 0.5,
    intakeVol: 0.5, mechVol: 0.45, induction: 'none', pops: 0.4, master: 0.54,
    car: { mass: 380, gears: [3.0, 2.1, 1.6, 1.3, 1.1, 0.95], final: 3.2, wheelR: 0.32 }
  },
  v10odd: {
    name: 'V10 90° odd-fire', layout: 'v', cylinders: 10, bankAngle: 90, crank: 'common', stroke: 4,
    cyl: rep(10, () => C({ shape: 'bark', tone: 190, runner: 40, rough: 0.1 })),
    displacement: 5.2, idleRpm: 900, redline: 8700, limiter: 'hard', inertia: 0.2,
    exhaustVol: 1, mufflerTone: 0.75, exhaust: 'dual', crossover: 0.2, runnerReso: 0.45,
    intakeVol: 0.7, mechVol: 0.45, induction: 'none', pops: 0.25, master: 1.13,
    car: { mass: 1550, gears: [3.13, 2.1, 1.56, 1.24, 1.03, 0.86, 0.73], final: 4.4, wheelR: 0.34 }
  },
  // aircraft (SineRally UI planes): direct-drive aero engines with open stacks, low rpm range; the turbine is a smooth
  // many-cylinder whine with the turbo whistle standing in for the compressor
  aeroFlat4: {
    name: 'Aero Flat-4 (bush plane)', layout: 'boxer', cylinders: 4, stroke: 4,
    cyl: [C({ shape: 'thump', tone: 72, runner: 60, rough: 0.28, misfire: 0.006 }), C({ shape: 'thump', tone: 68, runner: 150, rough: 0.28 }),
          C({ shape: 'thump', tone: 75, runner: 70, rough: 0.28 }), C({ shape: 'thump', tone: 66, runner: 170, rough: 0.28 })],
    displacement: 5.2, idleRpm: 650, redline: 2700, limiter: 'soft', inertia: 0.5,
    exhaustVol: 1.25, mufflerTone: 0.38, exhaust: 'dual', crossover: 0.1, runnerReso: 0.6,
    intakeVol: 0.35, mechVol: 0.55, induction: 'none', pops: 0.2, master: 0.85,
    car: { mass: 560, gears: [1], final: 1, wheelR: 0.4 }
  },
  aeroFlat6: {
    name: 'Aero Flat-6 (aerobatic)', layout: 'boxer', cylinders: 6, stroke: 4,
    cyl: rep(6, i => C({ shape: 'bark', tone: 95 + (i % 3) * 5, runner: 55 + (i % 2) * 40, rough: 0.18 })),
    displacement: 8.9, idleRpm: 750, redline: 2900, limiter: 'soft', inertia: 0.45,
    exhaustVol: 1.3, mufflerTone: 0.5, exhaust: 'dual', crossover: 0.2, runnerReso: 0.55,
    intakeVol: 0.5, mechVol: 0.45, induction: 'none', pops: 0.35, master: 0.85,
    car: { mass: 820, gears: [1], final: 1, wheelR: 0.3 }
  },
  turbine: {
    name: 'Jet turbine (whine)', layout: 'inline', cylinders: 16, stroke: 2,
    cyl: rep(16, () => C({ shape: 'soft', tone: 420, runner: 20, rough: 0.02 })),
    displacement: 2.0, idleRpm: 3000, redline: 9500, limiter: 'soft', inertia: 0.9,
    exhaustVol: 0.7, mufflerTone: 0.95, exhaust: 'single', crossover: 0, runnerReso: 0.2,
    intakeVol: 1.0, mechVol: 0.1, induction: 'turbo', inductionVol: 1.6, pops: 0, master: 0.7,
    car: { mass: 4500, gears: [1], final: 1, wheelR: 0.33 }
  }
};

export const PRESET_ORDER = ['muscleV8', 'flatV8', 'inline6', 'boxer4', 'inline4', 'v12', 'dirtbike', 'twoStroke', 'rotary', 'vtwin', 'v10odd', 'aeroFlat4', 'aeroFlat6', 'turbine'];

export function preset(key) { return deriveEngine(PRESETS[key] || PRESETS.muscleV8); }
