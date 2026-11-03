// Sine Rally — TERRAIN GENERATOR MODULE (public entry). See MODULE_API.md.
// Pure-math world (sine sums) + biomes, ring-buffer ground, instanced trees with HP, cellular fire, forest weather, sky.
import * as THREE from 'three';
import * as W from './world.js';
import { U } from './comic.js';
import { createGround } from './ground.js';
import { createTrees, SPECIES } from './trees.js';
import { createFire, FIRE_CELL } from './fire.js';
import { createWeather } from './weather.js';

const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const BASE_DRY = [0.84, 0.95, 0.24, 0.38, 0.5]; // prairie, desert, forest, mountains, coast

export { W as world, U as uniforms, SPECIES };
export function createTerrain({ bus = null, small = false, grassCount, persistKey = null, nearN, farN, treeNearR } = {}) {
  const listeners = new Map();
  const emit = (type, detail) => { (listeners.get(type) || []).forEach(f => { try { f(detail); } catch (e) { console.error(e); } }); if (bus) (bus.emit || bus.fire || (() => {})).call(bus, type, detail); };
  const on = (type, f) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(f); return () => off(type, f); };
  const off = (type, f) => { const a = listeners.get(type); if (a) { const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); } };
  const SO = {}, SOf = {}, nv = [0, 0, 0];
  const heightAt = (x, z) => W.ground(x, z);
  const normalAt = (x, z, out = [0, 0, 0]) => W.normal(x, z, out, W.heightRef); // HILLS: tunnel floor when the reference (vehicle) is inside a tube
  const TI = { floor: 0, s: 0, hw: 0, nx: 0, nz: 0, H: 0, depth: 0, type: 0 };
  function tunnelAt(x, z) { const o = W.sample(x, z, SO); if (!W.inTunnel(o)) return null; TI.floor = o.tun; TI.s = o.ts; TI.hw = o.thw; TI.nx = o.tnx; TI.nz = o.tnz; TI.H = o.tH; TI.depth = o.tdep; TI.type = o.ttype; return TI; }
  const weather = createWeather({ heightAt, emit });
  // dryness 0..1: biome base, wetter near rivers / low ground, minus current wetness (rain)
  function drynessOf(o, x, z, wet) {
    let dry = (o.bg * BASE_DRY[0] + o.bs * BASE_DRY[1] + o.bf * BASE_DRY[2] + o.bm * BASE_DRY[3] + o.bc * BASE_DRY[4]) / Math.max(1e-3, o.bg + o.bs + o.bf + o.bm + o.bc);
    dry *= 0.35 + 0.65 * sst(4, 45, o.riv); if (o.h < 1.5) dry *= 0.3;
    dry += 0.04 * Math.sin(x * 0.021 + Math.cos(z * 0.017) * 2);
    return Math.max(0, Math.min(1, dry * (1 - 0.85 * wet)));
  }
  // static fuel (without rain): only dry grassland + savanna grass; never on roads, water/mud, rock, sand, snow, forest
  function fuelAt(x, z) {
    const o = W.sample(x, z, SOf); if (o.road > 0.15 || o.h < W.WATER + 0.6 || o.riv < 6 || o.deck > -1e8) return 0;
    const g = o.bg + 0.4 * o.bs; if (g < 0.25) return 0;
    const surf = W.surfaceOf(x, z, o, 0.9); if (surf !== W.SURF.GRASS && surf !== W.SURF.DIRT) return 0;
    return Math.min(1, g * 1.2) * sst(0.55, 0.75, drynessOf(o, x, z, 0)) * (surf === W.SURF.DIRT ? 0.35 : 1);
  }
  function surfaceAt(x, z, out = {}) {
    const o = W.sample(x, z, SO); const tin = W.inTunnel(o), tfl = o.tun, tty = o.ttype; normalAt(x, z, nv); W.sample(x, z, SO); const surf = tin ? (tty === W.HWY ? W.SURF.ASPHALT : W.SURF.DIRT) : W.surfaceOf(x, z, o, nv[1]), wet = tin ? 0 : weather.wetAt(x, z), b = W.biomeOf(o), P = W.SURF_PARAMS[surf];
    const f = fire.stateAt(x, z);
    out.biome = b; out.biomeName = W.BIOME_NAMES[b]; out.surface = surf; out.surfaceName = W.SURF_NAMES[surf];
    out.dryness = drynessOf(o, x, z, wet); out.wet = wet; out.grip = P.mu * (1 - 0.25 * wet) * (f.burning ? 0.95 : 1); out.roll = P.roll; out.bs = P.bs;
    out.road = tin ? 1 : o.road; out.water = !tin && o.h < W.WATER ? W.WATER - o.h : 0; out.height = tin ? tfl : o.deck > o.h ? o.deck : o.h; out.normal = [nv[0], nv[1], nv[2]];
    out.burning = f.burning; out.burnt = f.burnt; out.rain = weather.rainAt(x, z); out.weights = { prairie: o.bg, desert: o.bs, forest: o.bf, mountains: o.bm, coast: o.bc };
    return out;
  }
  const trees = createTrees({ fuelAt, heightAt, emit, ...(treeNearR != null ? { nearR: treeNearR } : {}) });
  const fire = createFire({ fuelAt, heightAt, rainAt: weather.rainAt, wetAt: weather.wetAt, wind: weather.wind, trees, emit });
  // ---- engine heat ignition + physics tree events ----
  function engineHot(d = {}) { const p = d.position || d; const k = Math.max(0, Math.min(1, d.intensity ?? 0.5)); if (Math.random() < k * 0.3) return fire.ignite(p.x, p.z, { radius: 1, cause: 'engine:hot' }); return 0; }
  function engineOverheat(d = {}) { const p = d.position || d; return fire.ignite(p.x, p.z, { radius: 2 + Math.min(4, Math.max(0, ((d.temp ?? 120) - 110) / 15)), cause: 'engine:overheat' }); }
  function onDamage(d) { if (!d) return; if (d.hp !== undefined) trees.setTreeHP(d.id, Math.min(d.hp, trees.getTree(d.id)?.hp ?? 3)); else trees.damageTree(d.id, d.amount ?? 1, { dir: d.dir }); }
  const unsub = [];
  if (bus && bus.on) {
    const sub = (t, f) => { const h = e => f(e && e.detail !== undefined ? e.detail : e); bus.on(t, h); unsub.push(() => bus.off && bus.off(t, h)); };
    sub('engine:hot', engineHot); sub('engine:overheat', engineOverheat); sub('tree:damage', onDamage); sub('tree:destroyed', d => trees.removeTree(d.id));
  }
  // ---- persistence (removed trees, HP, burnt cells) ----
  if (persistKey) try { const s = JSON.parse(localStorage.getItem(persistKey) || 'null'); if (s) { trees.load(s.trees); fire.load(s.burnt); } } catch (e) { }
  let saveT = 0;
  // ---- render ----
  let ground = null, scene = null, meshes = [];
  function setup(sc) {
    scene = sc; ground = createGround(sc, { small, grassCount, nearN, farN }); weather.baseFar = ground.farDist;
    meshes = [...ground.meshes, ...trees.setup(sc), ...fire.setup(sc), ...weather.setup(sc)];
    return meshes;
  }
  const camDir = new THREE.Vector3();
  let viewH = 720;
  function update(dt, { camera, focus, viewHeight } = {}) {
    dt = Math.min(0.1, Math.max(0, dt)); U.uTime.value += dt; if (viewHeight) viewH = viewHeight;
    const cp = camera ? camera.position : focus, fp = focus || cp;
    if (ground) ground.update(fp.x, fp.z);
    weather.update(dt, cp, camera);
    if (camera) camera.getWorldDirection(camDir); else camDir.set(0, 0, -1);
    trees.update(dt, cp, camDir, weather.rainAt);
    fire.update(dt, fp, camera || { position: cp, fov: 65 }, viewH);
    if (persistKey && (saveT += dt) > 5) { saveT = 0; try { localStorage.setItem(persistKey, JSON.stringify({ trees: trees.save(), burnt: fire.save() })); } catch (e) { } }
  }
  // find nearest point of a biome (spiral search on a coarse grid)
  function findBiome(name, x0 = 0, z0 = 0, { minW = 0.85, maxR = 9000 } = {}) {
    const b = typeof name === 'number' ? name : W.BIOME_NAMES.indexOf(name); if (b < 0) throw new Error('unknown biome ' + name);
    const BWt = new Float32Array(5), o = {};
    for (let r = 0; r <= maxR; r += 60) { const n = Math.max(1, Math.round(2 * Math.PI * r / 60));
      for (let k = 0; k < n; k++) { const a = k / n * 2 * Math.PI, x = x0 + Math.cos(a) * r, z = z0 + Math.sin(a) * r; W.biomeWeights(x, z, BWt);
        if (BWt[b] >= minW) { W.sample(x, z, o); if (o.h > 2 && o.road < 0.05 && o.riv > 20) return { x, z }; } } }
    return null;
  }
  return {
    heightAt, normalAt, surfaceAt, fuelAt, groundAt: W.groundRef, roadGroundAt: W.roadGround, setRef: W.setRef, tunnelAt, dryness: (x, z) => drynessOf(W.sample(x, z, SO), x, z, weather.wetAt(x, z)),
    biomeAt: (x, z) => W.BIOME_NAMES[W.biomeOf(W.sample(x, z, SO))], findBiome,
    // floating origin: world.js origin moves by (dx,dz); every cached world-space thing re-expresses itself in the new local frame.
    // Fire is a toroidal 3 m window that cannot shift by 720 m exactly, so active fires/scorch are cleared on a rebase.
    shiftOrigin(dx, dz, cx = 0, cz = 0) {
      W.shiftOrigin(dx, dz); const o = W.origin(); U.uOrg.value.set(o.x, o.z);
      if (ground) ground.shift(dx, dz); trees.shift(dx, dz, cx, cz); weather.shift(dx, dz); fire.extinguishAll(); fire.clearBurnt();
      emit('origin:shift', { dx, dz, origin: o });
    },
    origin: W.origin,
    queryTrees: trees.queryTrees, damageTree: trees.damageTree, removeTree: trees.removeTree, setTreeHP: trees.setTreeHP, getTree: trees.getTree, igniteTree: trees.igniteTree, resetTrees: trees.reset,
    ignite: (x, z, o) => fire.ignite(x, z, o), fireAt: fire.stateAt, burningCells: fire.burningCells, extinguishAll: fire.extinguishAll, clearBurnt: fire.clearBurnt,
    engineHot, engineOverheat,
    setWind: weather.setWind, wind: weather.wind, setRain: weather.setRain, setTimeOfDay: weather.setTimeOfDay, setLightning: weather.setLightning, strike: weather.strike,
    rainAt: weather.rainAt, coverageAt: weather.coverageAt, wetAt: weather.wetAt, snapWeather: weather.snapBias,
    setup, update, on, off, uniforms: U, FIRE_CELL,
    setRoadDetail: (lvl, aniso) => ground ? ground.roads.setDetail(lvl, aniso) : 0, get roadStats() { return ground ? ground.roads.hdStats : null; }, get ground() { return ground; },
    stats: () => ({ trees: trees.stats(), fire: fire.stats(), weather: (({ mode, bias, tod, localRain, localCov, clouds, shafts, windSpeed }) => ({ mode, bias: +bias.toFixed(2), tod, localRain: +localRain.toFixed(2), localCov: +localCov.toFixed(2), clouds, shafts, windSpeed }))(weather.state) }),
    save: () => ({ trees: trees.save(), burnt: fire.save() }), load(s) { if (s) { trees.load(s.trees); fire.load(s.burnt); } },
    dispose() { unsub.forEach(f => f()); meshes.forEach(m => { scene && scene.remove(m); m.geometry && m.geometry.dispose(); m.material && m.material.dispose && m.material.dispose(); }); },
  };
}
