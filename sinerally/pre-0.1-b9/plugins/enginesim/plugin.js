// plugin.js — Sine Rally Engine Sound Plugin (API v1) wrapping EngineSim.
// This file + engine-sim.js, engine-dsp.js, engine-config.js, motor.js are the whole plugin.
// It is the single source of truth: the standalone demo (main.js) hosts it, and the game vendors
// a copy of these five files (see MERGE_NOTES.md). Imports nothing from any host.
import { EngineSim } from './engine-sim.js';
import {
  PRESETS, PRESET_ORDER, preset, SHAPES, LAYOUTS, BANK_ANGLES, LIMITERS, INDUCTION, MAX_CYL,
  countsFor, crankOptions, defaultFiringOrder, parseFiringOrder, firingIntervals, cycleOf
} from './engine-config.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

export const id = 'enginesim';
export const name = 'Engine Sim (cylinder pulse synth)';
export const apiVersion = 1;
export const version = '1.1.0';
export const presets = PRESET_ORDER.map((k) => ({ id: k, name: PRESETS[k].name }));
export const defaultPreset = 'muscleV8';
/** Suggested preset per host vehicle id (hosts may ignore). */
export const vehiclePresets = { buggy: 'boxer4', truck: 'muscleV8', quad: 'dirtbike', hyper: 'v12', forester: 'inline6' };

/**
 * Optional (API v1 extension): describes the config that setConfig()/getConfig() speak, so a host can build an
 * editor without importing anything from the plugin. Pure data + pure functions over a config object.
 */
export const configSchema = {
  maxCylinders: MAX_CYL, shapes: SHAPES, layouts: LAYOUTS, bankAngles: BANK_ANGLES, limiters: LIMITERS, induction: INDUCTION,
  countsFor, crankOptions, defaultFiringOrder, parseFiringOrder, firingIntervals, cycleOf
};

/**
 * @param {BaseAudioContext} ctx  host-owned, already unlocked (running) context
 * @param {AudioNode} destination host-owned input node; connect only here
 * @param {object} [options] { preset, vehicle, rpmMode: 'remap'|'absolute', engine (EngineSim to adopt; standalone tuner) }
 */
export async function create(ctx, destination, options = {}) {
  const pk = [options.preset, options.vehiclePreset, vehiclePresets[options.vehicle], defaultPreset].find((k) => k && PRESETS[k]);
  const sim = options.engine instanceof EngineSim ? options.engine : new EngineSim({ config: preset(pk) });
  sim.ctx = ctx; sim.dest = destination; sim.manageContext = false; // the host owns unlock/suspend
  if (options.forceScriptProcessor) sim.forceSP = true;
  await sim.start();
  const remap = options.rpmMode !== 'absolute';
  let cutT = 0, presetId = options.engine ? null : pk, spool = 0;
  return {
    engine: sim,          // plugin-specific extra (the standalone tuner uses it); not part of API v1
    get preset() { return presetId; },
    setPreset(key) { if (!PRESETS[key]) return false; sim.loadPreset(key); presetId = key; return true; },
    /** Optional: patch (or {replace:true} swap) the engine config live. Returns the derived config (a copy). */
    setConfig(patch, opts = {}) {
      if (!patch || typeof patch !== 'object') return sim.getConfig();
      sim.setConfig(patch, { replace: !!opts.replace }); presetId = opts.preset || null; return sim.getConfig();
    },
    /** Optional: the current derived config (a JSON-safe copy). */
    getConfig() { return sim.getConfig(); },
    /** Optional: firing-light state for the current animation frame {now, crank, cycle, rpm, lastFire[], lastKind[]}. */
    getVisualState() { return sim.getVisualState(); },
    update(t, dt) {
      const c = sim.config;
      let rpm = num(t.rpm, c.idleRpm);
      if (remap && t.redlineRpm > t.idleRpm) {   // map the host engine's rev range onto the preset's
        const x = (rpm - t.idleRpm) / (t.redlineRpm - t.idleRpm);
        rpm = c.idleRpm + x * (c.redline - c.idleRpm);
      }
      cutT = Math.max(0, cutT - num(dt, 0));
      const thr = clamp(num(t.throttle, 0), 0, 1);
      let spark = clamp(num(t.ignition, t.limiter ? 0 : 1), 0, 1);
      if (cutT > 0) spark = Math.min(spark, 0.15);
      if (typeof t.engineTemp === 'number' && t.engineTemp > 120) spark = Math.min(spark, 0.9); // overheating: occasional misfires
      let boost = t.turbo;
      if (typeof boost !== 'number') {            // host has no turbo model: spool a simple one ourselves
        const target = c.induction === 'none' ? 0 : thr * clamp(rpm / c.redline * 1.4 - 0.2, 0, 1);
        spool += (target - spool) * Math.min(1, num(dt, 0) * (target > spool ? 2 : 4)); boost = spool;
      }
      sim.update({
        rpm: Math.max(0, rpm), throttle: cutT > 0 ? 0 : thr,
        load: cutT > 0 ? 0 : clamp(num(t.load, thr), 0, 1),
        nitro: !!t.nitro && num(t.nitroStrength, 1) > 0.05, spark, boost
      });
    },
    event(type, data) {
      if (type === 'backfire') cutT = Math.max(cutT, 0.06 + 0.08 * clamp(num(data && data.strength, 0.5), 0, 1));
    },
    dispose() { sim.dispose(); }
  };
}

export default { id, name, apiVersion, version, presets, defaultPreset, vehiclePresets, configSchema, create };
