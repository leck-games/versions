// Sine Rally Route — endless Route-66-style road through prairie, red-rock desert, pine forest, snowy mountains and coast.
// Game shell (comic renderer, route strip HUD, props, autopilot, floating origin, sound plugin host) + vendored modules: js/terrain/
// (endless chunked route, biomes, trees with HP, grass fire, weather, day/night sky) and js/phys/ (rigid-body step, vehicles, attachments, heat).
// Everything talks through ONE event bus (`bus`): physics heat -> terrain fire, physics tree contacts -> terrain tree store,
// terrain grip/wet -> physics surfaceAt, and every event is forwarded to window.SR for the sound plugin (PLUGIN_API.md).
import * as THREE from 'three';
import * as W from './world.js';
import { NAME as GAME_NAME, VERSION as GAME_VERSION, VERSIONS_URL } from './version.js'; // 'Sine Rally Route V0.1'
import { createEngineAudio } from './engine-audio.js'; // engine sound plugin host (PLUGIN_API.md); talks to plugins only via the API
import { createSoundEditor } from './sound-editor.js';
import * as PWR from './power.js';
import { openPowerPanel } from './power-ui.js';
import { createUiEditor } from './ui-editor.js'; // SineRally UI: HUD layout editor (☰ → EDIT UI, key U)
import { U, objMat, puffMat, decalMat, postMat, precipMat } from './shaders.js';
import { rockVariants } from './models.js';
import { createTerrain } from './terrain/index.js';
import * as PH from './phys/physics/index.js';
import { createRig } from './phys/host/rig.js';
import { createBus } from './phys/host/bus.js';
import { buildVehicle } from './phys/vehicles/build.js';
import { listVehicles, getVehicle, DEFAULT_VEHICLE } from './phys/vehicles/index.js';
import { openSelector } from './phys/vehicles/selector.js';
import { renderPicker } from './phys/attachments/picker.js';
import { melts } from './phys/attachments/index.js';
import { createProps } from './props.js'; // Sine Rally Route: delineators, mile markers, biome signs, diners / gas stations
let audio = null; // engine sound host (created after the telemetry block)
import { createVehicleShadow } from './vshadow.js';
const { WATER, hash2, sample, surfaceOf, colourOf, normal, height, ground } = W;
const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
const store = { get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };
// ---------- event plumbing: SR listeners (sound plugin, tests) + the shared module bus ----------
const listeners = {}; function fire(type, data) { (listeners[type] || []).forEach(f => { try { f(data); } catch (e) { console.warn(e); } }); }
const bus = createBus(); const evLog = []; let lastGear = 1;
bus.on('*', (d, type) => { // forward everything to SR (game event names: shift = direction, land = {value, extra: airTime})
  evLog.push(type); if (evLog.length > 400) evLog.splice(0, 100);
  if (type === 'shift') { const g = d.value, dir = Math.sign(g - lastGear) || 1; lastGear = g; fire('shift', { value: dir, gear: g }); }
  else if (type === 'land') fire('land', { value: d.value, extra: d.air });
  else fire(type, d);
});
// ---------- renderer + quality (GFX toggle). The comic post pass (ink edges, palette) now runs on EVERY level, Low included;
// Low only drops resolution, halftone/grain and draw distance. Phones default to Med; dynamic resolution holds 30 fps. ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight); document.body.prepend(renderer.domElement);
// rd = road texture detail (0 classic, 1 HD 512x1024, 2 HD 1024x2048 + normal/roughness, max anisotropy), det = terrain micro-detail,
// sh = projected vehicle shadow map size (0 = blob), farN/nearN = terrain grid sizes (draw distance; applied at load), farK = extra fog distance
const QUAL = { Low: { pr: 1, post: true, fx: 1, sr: 200, hatch: 1.15, grass: 7000, trees: 0, rd: 0, det: 0, sh: 0, farK: 1 },
  Med: { pr: 1.5, post: true, fx: 1, sr: 250, hatch: 1.1, grass: 11000, trees: 1, rd: 0, det: 0, sh: 0, farK: 1 },
  High: { pr: 2, post: true, fx: 1, sr: 300, hatch: 1, grass: 16000, trees: 2, rd: 1, det: 0.7, sh: 512, farK: 1.08, farN: 112 },
  Ultra: { pr: 3, post: true, fx: 1, sr: 380, hatch: 1, grass: 24000, trees: 2, rd: 2, det: 1, sh: 1024, farK: 1.12, farN: 128, nearN: 160 } };
const Q_ORDER = ['Low', 'Med', 'High', 'Ultra'];
const qArg = (QS.get('q') || '').toLowerCase(), qMap = { low: 'Low', med: 'Med', medium: 'Med', high: 'High', ultra: 'Ultra' };
let qName = qMap[qArg] || localStorage.getItem('srroute_q3') || (isTouch ? 'Med' : 'High'); if (!QUAL[qName]) qName = isTouch ? 'Med' : 'High'; // default stays Med on phones (iPhone 12 safe)
const qLoad = qName; // grid sizes (draw distance) are fixed to the level chosen at load
let qLocked = !!(qMap[qArg] || localStorage.getItem('srroute_q3')); // user choice: dyn-res never changes the level then
let mapOpen = false; const DYN = QS.get('dyn') !== '0'; let dynS = 1, lastSr = 0; // dynamic resolution scale 0.5..1
const SMALL = isTouch || qName === 'Low'; // terrain grid sizes are fixed at load (phones: smaller grids)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.4, 1700 * (qName === 'Ultra' ? 1.3 : qName === 'High' ? 1.12 : 1)); const CAM_FAR = camera.far;
const depthTex = new THREE.DepthTexture(1, 1); depthTex.type = THREE.UnsignedIntType;
const rt = new THREE.WebGLRenderTarget(1, 1, { depthTexture: depthTex, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
const post = postMat(); post.uniforms.tCol.value = rt.texture; post.uniforms.tDep.value = depthTex; post.uniforms.uN.value = camera.near; post.uniforms.uF.value = camera.far;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); quad.frustumCulled = false; postScene.add(quad);
let vshadow = null; // created below (projected vehicle shadow at HIGH/ULTRA)
function applyQuality() {
  const q = QUAL[qName], pr = Math.min(devicePixelRatio, q.pr) * dynS;
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); U.uPx.value = pr; U.uHatch.value = q.hatch; post.uniforms.uFx.value = q.fx;
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr); rt.setSize(w, h); post.uniforms.uRes.value.set(w, h); post.uniforms.uThick.value = Math.max(1.6, pr * 1.4);
  if (q.sr !== lastSr) { scx = 1e9; lastSr = q.sr; } if (typeof quickLabels === 'function' && audio) quickLabels(); window.__pr = pr;
  if (grassMesh) grassMesh.geometry.instanceCount = Math.min(q.grass, grassMax);
  if (T.setRoadDetail) T.setRoadDetail(q.rd, q.rd ? renderer.capabilities.getMaxAnisotropy() : 4); U.uDet.value = q.det; if (vshadow) vshadow.setSize(q.sh);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', () => applyQuality());
function setQual(n) { if (!QUAL[n]) return; qName = n; qLocked = true; dynS = 1; localStorage.setItem('srroute_q3', qName); applyQuality();
  if ((QUAL[n].farN || 0) !== (QUAL[qLoad].farN || 0) && typeof msg === 'function') msg('GFX ' + n.toUpperCase() + (QUAL[n].farN > (QUAL[qLoad].farN || 0) ? ' · RELOAD FOR FULL DRAW DISTANCE' : '')); }
function cycleQ() { setQual(Q_ORDER[(Q_ORDER.indexOf(qName) + 1) % Q_ORDER.length]); }
let dynT = 0, dynFr = 0, slowN = 0;
function dynRes(dt) { // every second: scale render resolution to hold the target frame rate; at the floor, step quality down (unless user-chosen)
  if (!DYN) return; dynT += dt; dynFr++; if (dynT < 1) return; const f = dynFr / dynT; dynT = 0; dynFr = 0; if (tFrame < 4 || mapOpen) return;
  const tgt = isTouch ? 30 : 50; let s = dynS;
  if (f < tgt - 2) s = Math.max(0.5, s * Math.max(0.8, f / tgt)); else if (f > tgt * 1.45 && s < 1) s = Math.min(1, s * 1.08);
  if (Math.abs(s - dynS) > 0.03) { dynS = s; applyQuality(); }
  if (dynS <= 0.52 && f < tgt * 0.8) { if (++slowN >= 4 && !qLocked && qName !== 'Low') { qName = Q_ORDER[Math.max(0, Q_ORDER.indexOf(qName) - 1)]; dynS = 0.85; slowN = 0; applyQuality(); } } else slowN = 0;
}
// ---------- terrain module (vendored js/terrain): ground rings, GPU grass, trees with HP, grass fire, weather + sky ----------
// It gets an emit-only bus (no on()), so the game routes physics events into it explicitly (fractional tree HP lives here).
const grassMax = qName === 'Ultra' ? QUAL.Ultra.grass : QUAL.High.grass; // instance buffer size is fixed at load (Ultra density needs a reload from lower levels)
const T = createTerrain({ bus: { emit: (t, d) => bus.emit(t, d) }, small: SMALL, grassCount: grassMax, persistKey: null, /* endless route: trees regrow from the seed */
  farN: QUAL[qName].farN && !(isTouch && qName === 'High') ? QUAL[qName].farN : undefined, nearN: QUAL[qName].nearN,
  treeNearR: new URLSearchParams(location.search).get('treelod') === 'mesh' ? undefined : 0 }); // trees: the comic impostor LOD at every distance (no high-poly near meshes); ?treelod=mesh = old near meshes
const tMeshes = T.setup(scene) || [];
const grassMesh = tMeshes.find(m => m && m.geometry && m.geometry.attributes && m.geometry.attributes.off) || null;
const SO = { h: 0, hn: 0, deck: 0, road: 0, rtype: 0, dom: 0, riv: 0, rd: 0 }, nv = [0, 0, 0], cv = [0, 0, 0];
const Mx = new THREE.Matrix4(), Qt = new THREE.Quaternion(), Vt = new THREE.Vector3(), St = new THREE.Vector3(), Et = new THREE.Euler(), Cc = new THREE.Color();

// ---------- world adapter: the physics worldQuery contract on top of the terrain module ----------
const SURF_POOL = Array.from({ length: 16 }, () => ({ name: 'grass', mu: 1, roll: 0, bs: 0, wet: 0, si: 2 })); let surfI = 0; const TS = {};
let gripTest = 1; /* tests: grip multiplier (__st.gripTest) */ let wxGrip = 1; // fog/dust overlay grip (rain/wet grip is already in T.surfaceAt)
const hpMap = new Map(); // fractional tree HP (terrain stores whole segments 0..3)
const nArr = [0, 0, 0];
const world = {
  heightAt: (x, z) => T.groundAt(x, z), // HILLS: tunnel floor while the vehicle is inside a tube (reference set before each step)
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) { T.normalAt(x, z, nArr); out.x = nArr[0]; out.y = nArr[1]; out.z = nArr[2]; return out; },
  surfaceAt(x, z) { T.surfaceAt(x, z, TS); const o = SURF_POOL[surfI = (surfI + 1) & 15]; o.name = TS.surfaceName; o.si = TS.surface; o.mu = TS.grip * wxGrip; o.roll = TS.roll; o.bs = TS.bs; o.wet = TS.wet; return o; },
  waterLevel: WATER,
  queryTrees(x, z, r, out) {
    const a = T.queryTrees(x, z, r), res = out || []; if (out) out.length = 0; const tin = T.tunnelAt(x, z), ty = tin ? tin.floor + tin.H : 1e9;
    for (const t of a) { if (t.pos.y > ty) continue; /* trees on the hill above a tunnel */ const h = hpMap.has(t.id) ? hpMap.get(t.id) : t.hp; if (h <= 0) continue; res.push({ id: t.id, x: t.pos.x, z: t.pos.z, r: t.radius, hp: h }); }
    return res;
  },
  damageTree(id, removed, cause) {
    const t = T.getTree(id); if (!t) return 0; const cur = hpMap.has(id) ? hpMap.get(id) : t.hp, rem = cur - removed;
    if (rem <= 0.05) { hpMap.delete(id); T.removeTree(id); return 0; }
    hpMap.set(id, rem); T.setTreeHP(id, Math.max(1, Math.ceil(rem - 1e-6))); return rem;
  },
};

// ---------- rocks (game scenery rules, hash per 14 m GLOBAL cell, so they survive floating-origin shifts): solid colliders + instanced comic rocks ----------
const SC = 14, cellCache = new Map();
function inst(geo, mat, max) {
  const m = new THREE.InstancedMesh(geo, mat, max); m.frustumCulled = false; m.count = 0; scene.add(m);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3); return m;
}
const rockM = rockVariants().map(g => inst(g, objMat({ hatch: 1.2 }), 500));
function cellObj(ci, cj) { // ci,cj: global cell indices; cached objects hold LOCAL positions (cache cleared on every origin shift)
  const key = ci + ':' + cj; let o = cellCache.get(key); if (o !== undefined) return o;
  o = null; const O = W.origin();
  const h = hash2(ci, cj, 9), x = (ci + hash2(ci, cj, 7)) * SC - O.x, z = (cj + hash2(ci, cj, 8)) * SC - O.z;
  sample(x, z, SO);
  const s = 0.7 + hash2(ci, cj, 6) * 0.8, big0 = SO.dom === W.BIOME.DESERT ? 1.8 : 1;
  if (SO.h > WATER + 1.2 && SO.road < 0.05 && SO.rd > 2.2 * s * big0 + 1.5 && !(SO.tun > -1e8)) { // the whole collider stays off the asphalt
    const v = hash2(ci, cj, 5), d = SO.dom, B = W.BIOME;
    const thr = d === B.MOUNTAINS ? 0.9 : d === B.FOREST ? 0.95 : d === B.PRAIRIE ? 0.985 : d === B.DESERT ? 0.9 : 0.95;
    if (h > thr) o = { m: v < 0.6 ? 0 : 1, x, z, y: SO.h, s, h, v, red: d === B.DESERT, key };
  }
  if (cellCache.size > 60000) cellCache.clear();
  cellCache.set(key, o); return o;
}
let scx = 1e9, scz = 1e9; const colliders = []; // solid rocks: x,z,r,key (r<0 = melted this scan)
const rockGone = new Set(store.get('srr_rocks_gone', [])); // rocks melted by a harvester head stay gone (persisted; ☰ WORLD → REGROW restores)
function meltRock(key) { rockGone.add(key); if (rockGone.size > 4000) rockGone.delete(rockGone.values().next().value); store.set('srr_rocks_gone', [...rockGone]); scx = 1e9; }
function updateScenery(px, pz) {
  const cx = Math.round(px / 28), cz = Math.round(pz / 28); if (cx === scx && cz === scz) return; scx = cx; scz = cz;
  rockM.forEach(m => m.count = 0); colliders.length = 0; const O = W.origin();
  const SR = QUAL[qName].sr, r = Math.ceil(SR / SC), ox = Math.floor((px + O.x) / SC), oz = Math.floor((pz + O.z) / SC);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (i * i + j * j > r * r) continue; const o = cellObj(ox + i, oz + j); if (!o || rockGone.has(o.key)) continue;
    const m = rockM[o.m]; if (m.count >= m.instanceMatrix.count) continue; const s = o.s, t = 0.85 + 0.25 * o.v, big = o.red ? 1.8 : 1;
    Qt.setFromEuler(Et.set(o.h * 9, o.h * 30, o.h * 3)); Mx.compose(Vt.set(o.x, o.y - 0.4, o.z), Qt, St.set(s * big, s * big * (o.red ? 1.3 : 1), s * big));
    Cc.setRGB(o.red ? 1.35 * t : t, o.red ? 0.85 * t : t, o.red ? 0.62 * t : t * 0.97); colliders.push(o.x, o.z, 2.2 * s * big, o.key);
    const k = m.count++; m.setMatrixAt(k, Mx); m.setColorAt(k, Cc);
  }
  for (const m of rockM) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
}
const props = createProps({ scene, T });
function tunnelWalls(s) { // HILLS: tube side walls (the terrain is a hill above, so only the lateral walls need a collider)
  const ti = T.tunnelAt(s.p.x, s.p.z); if (!ti) return; const lim = ti.hw + 1.25, over = Math.abs(ti.s) - lim; if (over <= 0) return;
  const sg = Math.sign(ti.s), nx = ti.nx * sg, nz = ti.nz * sg; s.p.x -= nx * over; s.p.z -= nz * over;
  const vn = s.v.x * nx + s.v.z * nz; if (vn > 0) { s.v.x -= 1.3 * vn * nx; s.v.z -= 1.3 * vn * nz; s.v.x *= 0.985; s.v.z *= 0.985; if (vn > 6) { bus.emit('crash', { value: vn, cause: 'wall' }); PH.addDamage(s, vn * 0.3, 'wall'); } }
}
function collideRocks(s) { // circle push-out + bounce on the physics state (after each 120 Hz step)
  const p = s.p, v = s.v, rr = (s.P.dims ? Math.max(s.P.dims[0], s.P.dims[2]) * 0.4 : 1.4), melt = melts(rig.attach);
  const fl = Math.hypot(s.fwd.x, s.fwd.z) || 1, fx = s.fwd.x / fl, fz = s.fwd.z / fl, ext = melt ? 1.2 + Math.max(0, v.x * fx + v.z * fz) * STEP : 0;
  for (let i = 0; i < colliders.length; i += 4) {
    if (colliders[i + 2] < 0) continue;
    const dx = p.x - colliders[i], dz = p.z - colliders[i + 1], r = colliders[i + 2] + rr + ext, d2 = dx * dx + dz * dz; if (d2 > r * r || d2 < 1e-6) continue;
    if (Math.abs(p.y - T.heightAt(colliders[i], colliders[i + 1])) > colliders[i + 2] * 1.4 + 1) continue; // above it, or under it in a tunnel
    if (melt) { const d = Math.sqrt(d2); if (-(dx * fx + dz * fz) / d > 0.35) { // rock ahead of the cutter: gone at once — no push, no speed loss, no damage, no FX
      bus.emit('rock:melted', { key: colliders[i + 3], x: colliders[i], z: colliders[i + 1], r: colliders[i + 2], speed: Math.hypot(v.x, v.z) * 3.6 }); meltRock(colliders[i + 3]); colliders[i + 2] = -1; continue; }
      if (d > r - ext) continue; } // the extra cutter reach only applies to the front
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d; p.x += nx * (r - d); p.z += nz * (r - d);
    const vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= 1.4 * vn * nx; v.z -= 1.4 * vn * nz; if (vn < -5) { bus.emit('crash', { value: -vn, cause: 'rock' }); PH.addDamage(s, -vn * 0.4, 'rock'); } }
  }
  for (const b of props.solids) { // diners / gas stations: solid
    const dx = p.x - b.x, dz = p.z - b.z, r = b.r + rr, d2 = dx * dx + dz * dz; if (d2 > r * r || d2 < 1e-6 || Math.abs(p.y - b.y) > 9) continue;
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d; p.x += nx * (r - d); p.z += nz * (r - d);
    const vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= 1.4 * vn * nx; v.z -= 1.4 * vn * nz; if (vn < -5) { bus.emit('crash', { value: -vn, cause: 'building' }); PH.addDamage(s, -vn * 0.4, 'building'); } }
  }
}

// ---------- vehicle (physics module rig) + visuals (vehicle module models, comic materials) ----------
const rig = createRig({ THREE, world, emit: (t, d) => bus.emit(t, d) });
// handling model (physics module): ARCADE (default, NFS-Carbon/Trackmania-style) or NORMAL (the previous model); ☰ HANDLING, HUD ARC/NRM, key H
let hMode = ({ arcade: 'arcade', normal: 'normal' })[QS.get('handling') || localStorage.getItem('srroute_handling') || store.get('srroute_p_handling', 'arcade')] || 'arcade';
const carMat = objMat({ hatch: 0.5 }), flameMat = objMat({ unlit: true });
const carRoot = new THREE.Group(); scene.add(carRoot);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), decalMat(0x203040, true)); scene.add(shadow);
let vis = null, flameOrig = null, veh = null, vDef = null;
vshadow = createVehicleShadow(renderer, scene, (x, z) => T.groundAt(x, z));
const assist = { stab: localStorage.getItem('srroute_stab') ? localStorage.getItem('srroute_stab') === '1' : isTouch, tc: localStorage.getItem('srroute_tc') !== '0' };
const cmatCache = new Map();
function comicify(root) { // attachments ship standard three.js materials: swap them for cached comic objMats (tint = their colour)
  root.traverse(o => {
    if (!o.isMesh || !o.material || Array.isArray(o.material) || o.material.isShaderMaterial || o.material.transparent) return;
    const m = o.material; let c = cmatCache.get(m.uuid);
    if (!c) { c = objMat({ tint: m.color ? m.color.getHex() : 0xffffff, unlit: !!m.isMeshBasicMaterial, hatch: 0.6 }); cmatCache.set(m.uuid, c); }
    o.material = c;
  });
}
function loadAttach(id) { return store.get('srroute_p_attach_' + id, getVehicle(id).defaultAttachments || []); }
function useVehicle(id, attach) {
  id = getVehicle(id).id; const a = attach || loadAttach(id);
  if (vis) { vis.group.remove(rig.root); carRoot.remove(vis.group); if (flameOrig) vis.flame.material = flameOrig; vis.dispose(); }
  rig.setVehicle(id, a); veh = rig.state; vDef = rig.vehicle; veh.assist.stab = assist.stab; veh.assist.tc = assist.tc; lastGear = veh.gear; PWR.apply(veh, vDef); // per-build power curve (VEHICLE → ENGINE / POWER)
  vis = buildVehicle(THREE, vDef, carMat); flameOrig = vis.flame.material; vis.flame.material = flameMat;
  vis.group.add(rig.root); carRoot.add(vis.group); comicify(rig.root);
  const d = veh.P.dims || [2, 1.5, 4.4]; shadow.userData.w = d[0] * 1.5; shadow.userData.l = d[2] * 1.05;
  store.set('srroute_p_vehicle', id); store.set('srroute_p_attach_' + id, rig.attach); localStorage.setItem('srroute_veh', id);
  return vDef;
}
function setVehicle(id) { if (id === vDef?.id) return; const x = veh.p.x, z = veh.p.z, yaw = PH.yawOf(veh); useVehicle(id); spawn(x, z, yaw); msg(vDef.name); }
function setAttachments(ids) { rig.setAttachments(ids); comicify(rig.root); store.set('srroute_p_attach_' + vDef.id, rig.attach); return rig.attach; }
function spawn(x, z, yaw = 0) { T.setRef(-1e9); PH.spawn(veh, world, x, z, yaw); T.setRef(veh.p.y); lastGear = veh.gear; } // route spawns are always on the road (tunnel floors included)
const fwdSpeed = () => veh.v.x * veh.fwd.x + veh.v.y * veh.fwd.y + veh.v.z * veh.fwd.z;
{ let id = QS.get('car') || store.get('srroute_p_vehicle', null) || localStorage.getItem('srroute_veh') || DEFAULT_VEHICLE; if (!listVehicles().some(v => v.id === id)) id = DEFAULT_VEHICLE; useVehicle(id); rig.setMode(hMode); }
// spawn on the right lane of the endless route (?s= metres along the route, default 600 m)
const ROUTE_S0 = Math.max(0, +(QS.get('s') || 600));
function lanePoint(s, d = 3) { const p = W.routePoint(s); return { x: p.x - p.tz * d, z: p.z + p.tx * d, yaw: Math.atan2(p.tx, p.tz), y: p.y }; }
{ const p = lanePoint(ROUTE_S0); spawn(p.x, p.z, p.yaw); }

// ---------- dust puffs (comic, 1 draw call) ----------
const PN = 220, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pSize = new Float32Array(PN), pVel = new Float32Array(PN * 3), pAge = new Float32Array(PN).fill(9), pLife = new Float32Array(PN).fill(1), pS0 = new Float32Array(PN);
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
const puffs = new THREE.Points(pGeo, puffMat()); puffs.frustumCulled = false; scene.add(puffs); let pNext = 0;
const PUFFC = [[.82, .82, .84], [.95, .78, .55], [.86, .9, .7], [.98, .9, .62], [.82, .76, .74], [.97, .98, 1], [.62, .5, .38]]; // per surface
function puff(x, y, z, vx, vy, vz, size, life, col) { const i = pNext; pNext = (pNext + 1) % PN; pPos.set([x, y, z], i * 3); pVel.set([vx, vy, vz], i * 3); pCol.set(col, i * 3); pAge[i] = 0; pLife[i] = life; pS0[i] = size; }
function updatePuffs(dt) {
  for (let i = 0; i < PN; i++) { if (pAge[i] > pLife[i]) { pSize[i] = 0; continue; } pAge[i] += dt; const k = pAge[i] / pLife[i];
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt; pVel[i * 3 + 1] += 0.5 * dt; pVel[i * 3] *= 1 - 2 * dt; pVel[i * 3 + 2] *= 1 - 2 * dt;
    pSize[i] = pS0[i] * Math.sin(Math.min(1, k) * Math.PI) * (0.6 + k); }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
}
// ---------- skid marks (ring buffer; from rear-tyre slip of the physics model) ----------
const SKN = 600, skPos = new Float32Array(SKN * 18), skGeo = new THREE.BufferGeometry(); skGeo.setAttribute('position', new THREE.BufferAttribute(skPos, 3));
const skids = new THREE.Mesh(skGeo, decalMat(0x4a3424)); skids.frustumCulled = false; scene.add(skids); let skNext = 0; const skPrev = [null, null];
function skid(w, x, y, z, rx, rz, on) {
  if (!on) { skPrev[w] = null; return; } const p = skPrev[w]; skPrev[w] = [x, y, z];
  if (!p || Math.hypot(x - p[0], z - p[2]) > 6) return; const hw = 0.24, o = skNext * 18;
  const a = [p[0] - rx * hw, p[1], p[2] - rz * hw], b = [p[0] + rx * hw, p[1], p[2] + rz * hw], c = [x - rx * hw, y, z - rz * hw], d = [x + rx * hw, y, z + rz * hw];
  skPos.set([...a, ...c, ...b, ...b, ...c, ...d], o); skNext = (skNext + 1) % SKN; skGeo.attributes.position.needsUpdate = true;
}
// ---------- input ----------
const key = {}; addEventListener('keydown', e => { key[e.code] = 1; if (uied && uied.open) return; if (e.code === 'KeyR') reset(); if (e.code === 'KeyF') toggleDbg(); if (e.code === 'KeyG') cycleQ(); });
addEventListener('keyup', e => key[e.code] = 0);
const touch = { steer: 0, pitch: 0, gas: 0, brk: 0, bst: 0, drf: 0 }; let tilt = false, tiltSteer = 0;
if (isTouch) { $('joy').style.display = 'block'; ['bGas', 'bBrk', 'bBst', 'bDrf'].forEach(b => $(b).style.display = 'flex'); }
const joy = $('joy'), knob = $('knob'); let joyId = null;
joy.addEventListener('touchstart', e => { joyId = e.changedTouches[0].identifier; joyMove(e); e.preventDefault(); }, { passive: false });
joy.addEventListener('touchmove', e => { joyMove(e); e.preventDefault(); }, { passive: false });
const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; touch.steer = touch.pitch = 0; knob.style.transform = ''; } };
joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);
function joyMove(e) { for (const t of e.changedTouches) if (t.identifier === joyId) { const r = joy.getBoundingClientRect(); const cl = v => Math.max(-1, Math.min(1, v));
  const k = 55 * (r.width / (joy.offsetWidth || r.width)), dx = cl((t.clientX - r.left - r.width / 2) / k), dy = cl((t.clientY - r.top - r.height / 2) / k); touch.steer = dx; touch.pitch = -dy; knob.style.transform = `translate(${dx * 45}px,${dy * 45}px)`; } }
[['bGas', 'gas'], ['bBrk', 'brk'], ['bBst', 'bst'], ['bDrf', 'drf']].forEach(([id, k]) => {
  const el = $(id); el.addEventListener('touchstart', e => { touch[k] = 1; el.classList.add('on'); e.preventDefault(); }, { passive: false });
  const up = () => { touch[k] = 0; el.classList.remove('on'); }; el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
});
$('tTilt').onclick = async () => {
  if (!tilt && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch (e) { return; } }
  tilt = !tilt; msg('TILT STEERING ' + (tilt ? 'ON' : 'OFF')); if (audio) quickLabels();
};
addEventListener('deviceorientation', e => { const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0; const v = a === 90 ? e.beta : a === -90 || a === 270 ? -e.beta : e.gamma; tiltSteer = Math.max(-1, Math.min(1, (v || 0) / 25)); });
$('tReset').onclick = () => reset(); $('tDbg').onclick = () => toggleDbg(); $('tQ').onclick = () => cycleQ();
let dbg = QS.has('dbg'); function toggleDbg() { dbg = !dbg; if (!dbg) $('dbg').textContent = ''; if (audio) quickLabels(); }
function reset() { if (editor.benching) return; const s = Math.max(0, W.project(veh.p.x, veh.p.z).s), p = lanePoint(s); spawn(p.x, p.z, p.yaw); msg('BACK ON ROUTE 66'); } // snap to the right lane, facing along the route
const inp = { gas: 0, brake: 0, steer: 0, hand: 0, boost: 0, pitch: 0 };
const auto = QS.get('auto'); // test driver: ?auto=1|drift|boost drives itself (headless tests / screenshots)
let simT = 0, steerSm = 0;
function readInput(dt) {
  let s = (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0) - touch.steer - (tilt ? tiltSteer : 0);
  // touch/tilt: response curve (fine control around centre) + extra speed sensitivity; everything is smoothed
  let kb = (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0), tc = -touch.steer - (tilt ? tiltSteer : 0);
  // ARCADE: the physics already scales steering with speed, so touch keeps a gentler curve + little extra damping and reacts faster (iPhone thumbs)
  const arc = hMode === 'arcade', TS = arc ? { pw: 1.3, k: 0.004, sm: 16, kr: 7 } : { pw: 1.5, k: 0.012, sm: 12, kr: 5 };
  tc = Math.sign(tc) * Math.pow(Math.min(1, Math.abs(tc)), TS.pw) / (1 + Math.abs(fwdSpeed()) * TS.k);
  const tgt = Math.max(-1, Math.min(1, kb + tc));
  if (kb) steerSm += Math.max(-TS.kr * dt, Math.min(TS.kr * dt, tgt - steerSm)); else steerSm += (tgt - steerSm) * Math.min(1, TS.sm * dt);
  inp.steer = Math.abs(steerSm) < 1e-3 ? 0 : steerSm; void s;
  inp.gas = key.KeyW || key.ArrowUp || touch.gas ? 1 : 0; inp.brake = key.KeyS || key.ArrowDown || touch.brk ? 1 : 0;
  inp.hand = key.Space || touch.drf ? 1 : 0; inp.boost = key.ShiftLeft || key.ShiftRight || touch.bst ? 1 : 0;
  inp.pitch = Math.max(-1, Math.min(1, (key.KeyE ? 1 : 0) - (key.KeyQ ? 1 : 0) + touch.pitch));
  if (autoOn) autopilot(dt);
  if (window.__st && window.__st.drive) window.__st.drive(inp, dt); // tests: in-frame autopilot (tools/test-rim.cjs)
}
// autopilot (?auto=1, or AUTO in the ⚙ tray): pure pursuit on the right-lane centre + curvature speed limit (tests drive 50+ km with it)
let autoOn = !!auto && auto !== '0'; const AP = { v: +(QS.get('apv') || 25), d: 0, vmax: 0 };
function autopilot(dt) {
  const sp = Math.max(0, fwdSpeed()), pr = W.project(veh.p.x, veh.p.z), s = pr.s, Ld = Math.max(12, 0.9 * sp);
  const t = lanePoint(s + Ld), yaw = PH.yawOf(veh); let e = Math.atan2(t.x - veh.p.x, t.z - veh.p.z) - yaw; e = Math.atan2(Math.sin(e), Math.cos(e));
  let km = 0; for (let d = 0; d <= 120; d += 10) km = Math.max(km, Math.abs(W.curvature(s + d)));
  const vmax = Math.min(AP.v, Math.sqrt(6 / Math.max(km, 1e-4))); AP.d = pr.d; AP.vmax = vmax;
  inp.steer = Math.max(-1, Math.min(1, 2.5 * e)); inp.gas = sp < vmax ? 1 : 0; inp.brake = sp > vmax + 3 ? 1 : 0; inp.hand = 0; inp.boost = auto === 'boost' && sp < vmax - 6 ? 1 : 0;
  void dt;
}
// HUD toast: a compact pill under the route strip. kind 'big' 1.6 s, info 1.5 s.
// Fade in/out is opacity-only (CSS), so a scale set in the HUD layout editor (transform) is never overridden.
let msgT = 0; const MSG_DUR = { race: 1.2, big: 1.6, info: 1.5 };
function msg(s, kind = 'info', cls = '') { const m = $('msg'), d = MSG_DUR[kind] || 1.5; m.textContent = s; m.classList.remove('show', 't-race', 't-big', 't-info', 'fast', 'slow'); m.classList.add('t-' + kind); if (cls) m.classList.add(cls); // keep the layout editor's uie / uie-h classes m.style.setProperty('--dur', d + 's');
  void m.offsetWidth; m.classList.add('show'); msgT = performance.now() + d * 1000; } // wall-clock, matches the CSS fade even when frames are slow
// ---------- route strip (top HUD): km driven, current biome, next biome + distance, a -1..+9 km bar coloured per biome ----------
const MILE = 1609.344, BIOME_COL = ['#d9b45a', '#c8553a', '#2f7a46', '#eef3f8', '#3a9ad0'];
const rc = $('route').getContext('2d'); let routeT = 0, odo = 0, sCur = ROUTE_S0, sMax = ROUTE_S0, lastBiome = -1;
function routeHud(dt) {
  if ((routeT -= dt) > 0) return; routeT = 0.1;
  const c = rc, Wd = 420, Hd = 58; c.clearRect(0, 0, Wd, Hd);
  const seg = W.segmentAt(sCur), nx = W.nextBiome(sCur), a = sCur - 1000, b = sCur + 9000, x0 = 10, x1 = Wd - 10, by = 38, bh = 11, X = s => x0 + (s - a) / (b - a) * (x1 - x0);
  c.fillStyle = '#111'; c.fillRect(x0 - 3, by - 3, x1 - x0 + 6, bh + 6);
  for (let q = Math.max(0, a), n = 0; q < b && n < 20; n++) { const g = W.segmentAt(q), u = X(Math.max(q, a)), v = X(Math.min(g.s1, b)); c.fillStyle = BIOME_COL[g.b]; c.fillRect(u, by, v - u, bh); if (g.s1 < b) { c.fillStyle = '#111'; c.fillRect(v - 1, by - 3, 2, bh + 6); } q = g.s1 + 0.01; }
  if (a < 0) { c.fillStyle = '#111'; c.fillRect(x0, by, X(0) - x0, bh); }
  c.fillStyle = 'rgba(17,17,17,.75)'; for (let m = Math.ceil(Math.max(0, a) / MILE); m * MILE < b; m++) { const u = X(m * MILE); c.fillRect(u - 0.5, by + bh - 4, 1.5, 4); }
  const cx = X(sCur); c.fillStyle = '#ff6a1a'; c.strokeStyle = '#111'; c.lineWidth = 2; c.beginPath(); c.moveTo(cx, by + 2); c.lineTo(cx - 6, by - 8); c.lineTo(cx + 6, by - 8); c.closePath(); c.fill(); c.stroke();
  c.lineJoin = 'round'; c.textBaseline = 'alphabetic';
  const ink = (t, x, y, px, col, al) => { c.font = `italic 900 ${px}px "Arial Black",system-ui`; c.textAlign = al; c.lineWidth = 4; c.strokeStyle = '#111'; c.strokeText(t, x, y); c.fillStyle = col; c.fillText(t, x, y); };
  const fit = (t, px, w) => { c.font = `italic 900 ${px}px "Arial Black",system-ui`; const m = c.measureText(t).width; return m > w ? Math.max(8, px * w / m) : px; };
  const kmT = (odo / 1000).toFixed(1) + ' KM', nxT = 'NEXT ' + nx.title.toUpperCase() + ' ' + Math.max(0, (nx.s - sCur) / 1000).toFixed(1) + ' KM';
  ink(kmT, 10, 24, 20, '#ffd23c', 'left'); const kw = c.measureText(kmT).width + 22;
  const npx = fit(nxT, 11, (Wd - kw) * 0.55); ink(nxT, Wd - 10, 22, npx, '#fff', 'right'); const nw = c.measureText(nxT).width + 18; // the three labels never overlap
  const tt = seg.title.toUpperCase(), tw = Wd - 10 - nw - kw; ink(tt, kw + tw / 2, 22, fit(tt, 13, tw), '#fff', 'center');
  if (seg.b !== lastBiome) { if (lastBiome >= 0) msg('ENTERING ' + seg.title.toUpperCase(), 'big'); lastBiome = seg.b; fire('biome', { biome: seg.name, title: seg.title, s: sCur }); }
}
// ---------- HUD gauge (comic ink): tacho arc, gear, rpm, surface + engine temperature bar (physics heat) ----------
const gc = $('gauge').getContext('2d');
function gauge() {
  const Wd = 200, Hd = 120, cx = 100, cy = 104, R = 82, P = veh.P; gc.clearRect(0, 0, Wd, Hd);
  const a0 = Math.PI * 0.95, a1 = Math.PI * 2.05, GM = P.redline + 1000, rf = Math.min(1, veh.rpm / GM), red = P.redline / GM;
  gc.lineCap = 'butt'; gc.lineWidth = 20; gc.strokeStyle = '#111'; gc.beginPath(); gc.arc(cx, cy, R, a0 - 0.03, a1 + 0.03); gc.stroke();
  gc.lineWidth = 13; gc.strokeStyle = '#fff8e0'; gc.beginPath(); gc.arc(cx, cy, R, a0, a1); gc.stroke();
  gc.strokeStyle = '#e8453c'; gc.beginPath(); gc.arc(cx, cy, R, a0 + (a1 - a0) * red, a1); gc.stroke();
  gc.strokeStyle = veh.rpm > P.up ? '#ff3a1a' : '#ff8a1a'; gc.beginPath(); gc.arc(cx, cy, R, a0, a0 + (a1 - a0) * rf); gc.stroke();
  gc.strokeStyle = '#111'; gc.lineWidth = 2; for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; gc.beginPath(); gc.moveTo(cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7)); gc.lineTo(cx + Math.cos(a) * (R + 7), cy + Math.sin(a) * (R + 7)); gc.stroke(); }
  gc.textAlign = 'center'; gc.lineJoin = 'round'; gc.fillStyle = '#ffd23c'; gc.strokeStyle = '#111';
  const ink = (t, x, y, f, lw, col = '#ffd23c') => { gc.font = f; gc.lineWidth = lw; gc.fillStyle = '#111'; gc.fillText(t, x + 3, y + 3); gc.strokeText(t, x, y); gc.fillStyle = col; gc.fillText(t, x, y); };
  ink(veh.gear < 0 ? 'R' : String(veh.gear), cx, cy - 14, 'italic 900 46px "Arial Black",system-ui', 5);
  gc.fillStyle = '#fff'; gc.font = 'italic 900 11px "Arial Black",system-ui'; gc.lineWidth = 3;
  const lbl = (t, x, y) => { gc.strokeText(t, x, y); gc.fillText(t, x, y); };
  lbl((veh.rpm / 1000).toFixed(1) + 'K RPM', cx - 56, cy + 12); lbl(String(TEL.surface || '').toUpperCase(), cx + 56, cy + 12);
  // temperature: small inked bar under the gear (blue -> yellow -> red), HOT / OVERHEAT tag
  const H = P.heat, tk = Math.max(0, Math.min(1, (veh.heat.temp - H.ambient) / (H.max - H.ambient))), hot = veh.heat.temp >= H.hot;
  const warm = veh.heat.temp >= H.ambient + 0.6 * (H.hot - H.ambient); TEL.tempShown = warm; // auto-hide: the bar only appears once the engine is warm
  if (warm) { const bx = cx - 30, by = cy - 6, bw = 60; gc.fillStyle = '#111'; gc.fillRect(bx - 2, by - 2, bw + 4, 9);
  gc.fillStyle = veh.heat.temp >= H.overheat ? '#ff3a1a' : hot ? '#ffb020' : '#4fb8ff'; gc.fillRect(bx, by, bw * tk, 5); }
  if (hot) ink(veh.heat.cut ? 'ENGINE CUT' : veh.heat.over ? 'OVERHEAT' : 'HOT', cx, 16, 'italic 900 13px "Arial Black",system-ui', 3, veh.heat.over ? '#ff5030' : '#ffd23c');
}

// ---------- tree HP labels (max ~10 near the car, pooled DOM) + pop text + bursts (physics/terrain events) ----------
const labelsEl = $('labels'), hpLabs = [], recentHit = new Map(); const MAXLAB = isTouch ? 8 : 10;
for (let i = 0; i < MAXLAB; i++) { const d = document.createElement('div'); d.className = 'hp'; d.innerHTML = '<div class="segs"><div class="seg"><i></i></div><div class="seg"><i></i></div><div class="seg"><i></i></div></div><span></span>'; d.style.display = 'none'; labelsEl.appendChild(d); hpLabs.push(d); }
const pv = new THREE.Vector3();
function project(x, y, z) { pv.set(x, y, z).project(camera); if (pv.z > 1 || pv.z < -1) return null; return [(pv.x * 0.5 + 0.5) * innerWidth, (-pv.y * 0.5 + 0.5) * innerHeight]; }
let labT = 0, labTrees = []; let treeHpOn = localStorage.getItem('srroute_treehp') === 'on'; // tree HP hidden by default; toggle in ☰ → CONTROLS
function setTreeHp(on) { treeHpOn = !!on; localStorage.setItem('srroute_treehp', on ? 'on' : 'off'); if (!on) for (const d of hpLabs) d.style.display = 'none'; }
function updateLabels(dt) {
  if (!treeHpOn) return;
  labT -= dt; const now = performance.now();
  if (labT <= 0) { labT = 0.12; const all = world.queryTrees(veh.p.x, veh.p.z, 32); for (const t of all) { t.d = Math.hypot(t.x - veh.p.x, t.z - veh.p.z); if (hpMap.has(t.id)) t.hp = hpMap.get(t.id); }
    all.sort((a, b) => ((b.hp < 3 || recentHit.has(b.id)) - (a.hp < 3 || recentHit.has(a.id))) || a.d - b.d); let full = 0; labTrees = all.filter(t => t.hp < 3 || recentHit.has(t.id) || (t.d < 14 && full++ < 3)).slice(0, MAXLAB); } // damaged/hit trees + the 3 nearest intact ones
  for (let i = 0; i < MAXLAB; i++) { const d = hpLabs[i], t = labTrees[i]; let sp = null;
    if (t) { const tr = T.getTree(t.id); if (!tr) { d.style.display = 'none'; continue; } t.hp = hpMap.has(t.id) ? hpMap.get(t.id) : tr.hp; sp = project(t.x, tr.pos.y + Math.min(tr.height, 6) * 0.55 + 1, t.z); }
    if (!sp) { d.style.display = 'none'; continue; }
    d.style.display = 'block'; d.style.left = sp[0] + 'px'; d.style.top = Math.max(70, sp[1]) + 'px'; const h = t.hp, segs = d.firstChild.children, hit = (recentHit.get(t.id) || 0) > now; // label clamped below the top HUD row
    for (let k = 0; k < 3; k++) { const f = Math.max(0, Math.min(1, h - k)); segs[k].firstChild.style.width = (f * 100) + '%'; segs[k].firstChild.style.background = h > 2 ? '#7fe07f' : h > 1 ? '#ffd23c' : '#ff8a1a'; }
    d.classList.toggle('hit', hit); d.lastChild.textContent = h.toFixed(1) + '/3 HP'; d.style.opacity = t.d > 24 && !hit ? 0.6 : 1;
  }
}
function popText(txt, x, y, z, col) {
  const sp = project(x, y, z); if (!sp) return; const d = document.createElement('div'); d.className = 'ptxt'; d.textContent = txt; if (col) d.style.color = col;
  d.style.left = sp[0] + 'px'; d.style.top = sp[1] + 'px'; labelsEl.appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'translate(-50%,-180%) scale(1.15)'; d.style.opacity = 0; }); setTimeout(() => d.remove(), 950);
}
function burst(x, y, z, n, col, spd = 4) { for (let k = 0; k < n; k++) { const a = Math.random() * 6.28; puff(x + Math.cos(a), y + Math.random() * 3, z + Math.sin(a), Math.cos(a) * spd + veh.v.x * 0.2, 2 + Math.random() * 3, Math.sin(a) * spd + veh.v.z * 0.2, 1 + Math.random(), 0.8, k % 3 ? col : [0.5, 0.36, 0.22]); } }
// physics -> terrain: engine heat ignites dry grass under the car; tree contacts already went through world.damageTree
bus.on('engine:hot', d => { const p = d.position; T.engineHot({ position: { x: p[0], z: p[2] }, intensity: d.intensity }); });
bus.on('engine:overheat', d => { const p = d.position; T.engineOverheat({ position: { x: p[0], z: p[2] }, temp: d.temp }); msg('OVERHEAT!'); for (let k = 0; k < 10; k++) puff(p[0], p[1] + 0.5, p[2], (Math.random() - .5) * 2, 2 + Math.random() * 2, (Math.random() - .5) * 2, 1.4, 1.2, [0.35, 0.33, 0.32]); });
bus.on('engine:cooled', () => msg('ENGINE COOLED'));
bus.on('tree:damage', d => { recentHit.set(d.id, performance.now() + 1600); labT = 0; const y = T.heightAt(d.x, d.z);
  if (d.cause !== 'harvest') { if (treeHpOn) popText('-' + d.hp.toFixed(1) + ' HP', d.x, y + 4, d.z); burst(d.x, y, d.z, 6, [0.35, 0.62, 0.25]); shake = Math.max(shake, 0.15); } });
bus.on('tree:destroyed', d => { if (d.cause === 'harvest') return; const y = T.heightAt(d.x, d.z); popText('SMASH!', d.x, y + 5, d.z, '#ffd23c'); burst(d.x, y, d.z, 14, [0.35, 0.62, 0.25], 5); shake = Math.max(shake, 0.25); });
bus.on('harvester:log', d => popText('+' + d.logs + ' LOG', veh.p.x, veh.p.y + 2.5, veh.p.z, '#ffd23c'));
bus.on('harvester:full', () => msg('LOG RACK FULL'));
bus.on('cargo:unload', d => msg('UNLOADED ' + (d && d.logs != null ? d.logs + ' LOGS' : '')));
bus.on('vehicle:damage', d => { if (d && d.total >= 99) msg('WRECKED — REPAIR IN ☰'); });
bus.on('land', d => { shake = Math.min(1, d.value / 14); if (d.air > 1) msg('AIR ' + d.air.toFixed(1) + 's!');
  if (d.value > 4) { const si = surfIdx(veh.wheels[2].surf); for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28; puff(veh.p.x + Math.cos(a) * 1.6, veh.p.y - 0.7, veh.p.z + Math.sin(a) * 1.6, Math.cos(a) * 7, 0.8, Math.sin(a) * 7, 1.6, 0.7, PUFFC[si]); } } });
bus.on('crash', d => shake = Math.max(shake, Math.min(1, d.value / 12)));
bus.on('recover', () => msg('RECOVERED'));
const surfIdx = s => typeof s === 'object' && s ? (s.si ?? 2) : Math.max(0, W.SURF_NAMES.indexOf(s));

// ---------- day/night + weather: ONE system (terrain weather owns sky, rain, wet ground, lightning, uFar/uNight/uRain).
// The game only adds its fog/dust overlay on top (no second rain), and maps its menu / ?wx= / ?tod= onto T.setRain / T.setTimeOfDay.
const TIMES = { Day: 0.4, Sunset: 0.715, Night: 0.97 };
let timeMode = localStorage.getItem('srroute_time') || 'Auto', tod = +(QS.get('tod') || 0.36); if (QS.get('tod')) timeMode = 'Fixed';
const WXP = { fog: { far: 0.34, grip: 0.96, dark: 0.85, hz: new THREE.Color(0xc9d0d6) }, dust: { far: 0.3, grip: 0.9, dark: 0.82, hz: new THREE.Color(0xd99a5c) } };
const WX_MODES = ['Auto', 'clear', 'rain', 'storm', 'fog', 'dust'];
let wxMode = QS.get('wx') || localStorage.getItem('srroute_wx') || 'Auto'; if (!WX_MODES.includes(wxMode)) wxMode = 'Auto';
const wx = { fog: 0, dust: 0 }; if (WXP[wxMode]) wx[wxMode] = 1;
function applyTime() { if (timeMode === 'Auto') T.setTimeOfDay(tod, true); else T.setTimeOfDay(TIMES[timeMode] ?? tod, false); }
function applyWx() { T.setRain(wxMode === 'Auto' ? 'auto' : wxMode === 'rain' ? 'on' : wxMode === 'storm' ? 'storm' : 'off'); }
applyTime(); applyWx(); T.snapWeather();
const precipN = 900, prPos = new Float32Array(precipN * 6), prTail = new Float32Array(precipN * 2), prSeed = new Float32Array(precipN * 2);
for (let i = 0; i < precipN; i++) { const x = Math.random(), y = Math.random(), z = Math.random(), sd = Math.random(); prPos.set([x, y, z, x, y, z], i * 6); prTail.set([0, 1], i * 2); prSeed.set([sd, sd], i * 2); }
const prGeo = new THREE.BufferGeometry(); prGeo.setAttribute('position', new THREE.BufferAttribute(prPos, 3)); prGeo.setAttribute('tail', new THREE.BufferAttribute(prTail, 1)); prGeo.setAttribute('seed', new THREE.BufferAttribute(prSeed, 1));
const dustFx = new THREE.LineSegments(prGeo, precipMat()); dustFx.frustumCulled = false; dustFx.renderOrder = 5; scene.add(dustFx); // dust streaks only (rain = terrain)
{ const pm = dustFx.material.uniforms; pm.uCol.value.set(0xe8b878); pm.uVel.value.set(16, -1.5, 7); pm.uLen.value = 0.12; pm.uBox.value = 30; }
// SKY presets (one select in WORLD): grade the time-of-day sky the terrain weather computes — horizon/zenith tint (fades out at night),
// haze band + sun glow strength, fog distance, sun/glow colour, high cirrus. The sun position itself always follows TIME OF DAY.
const SKY_P = { FUEL: { h: 0xf4dcb4, hk: 0.4, z: 0x3b7fd0, zk: 0.3, haze: 0.8, far: 0.92, cir: 1 },
  Clear: { haze: 0.3, far: 1, cir: 0.5 },
  Hazy: { h: 0xeee3cc, hk: 0.55, z: 0x86a9cc, zk: 0.5, haze: 1, far: 0.7, cir: 0.25 },
  Golden: { h: 0xffbf86, hk: 0.55, z: 0x5a70bc, zk: 0.35, haze: 0.9, far: 0.88, cir: 1, sun: 0xff9a48, sk: 0.45, l: [1.06, 0.94, 0.8] } };
let skyMode = QS.get('sky') || localStorage.getItem('srroute_sky') || 'FUEL'; if (!SKY_P[skyMode]) skyMode = 'FUEL';
const skyC = {}; for (const k in SKY_P) { const P = SKY_P[k]; skyC[k] = { h: P.h != null ? new THREE.Color(P.h) : null, z: P.z != null ? new THREE.Color(P.z) : null, sun: P.sun != null ? new THREE.Color(P.sun) : null }; }
function skyGrade() { const P = SKY_P[skyMode], C = skyC[skyMode], d = 1 - U.uNight.value;
  if (C.h) U.uHorizon.value.lerp(C.h, P.hk * d); if (C.z) U.uZenith.value.lerp(C.z, P.zk * d); if (C.sun) U.uSunCol.value.lerp(C.sun, P.sk * d);
  if (P.l) U.uLight.value.multiply(tmpC.setRGB(1 + (P.l[0] - 1) * d, 1 + (P.l[1] - 1) * d, 1 + (P.l[2] - 1) * d));
  U.uHaze.value = P.haze; U.uCirrus.value = qName === 'Low' ? 0 : P.cir * (qName === 'Med' ? 0.85 : 1); return P.far; }
const tmpC = new THREE.Color(); let domT = 0, dryHere = false;
function atmosphere(dt) { // runs after T.update(): overlay fog/dust on the terrain weather's uniforms
  if ((domT -= dt) <= 0) { domT = 1; sample(veh.p.x, veh.p.z, SO); dryHere = SO.dom === W.BIOME.DESERT || SO.dom === W.BIOME.PRAIRIE; }
  let tgt = WXP[wxMode] ? wxMode : null;
  if (wxMode === 'Auto') { const slot = Math.floor(simT / 150), h = hash2(slot, 3, 31); tgt = h < 0.55 ? null : h < 0.72 ? (dryHere ? 'dust' : null) : h < 0.86 ? 'fog' : (dryHere ? 'dust' : null); }
  let far = skyGrade() * biomeSky(), grip = 1, dark = 1; const L = U.uLight.value, H = U.uHorizon.value, Z = U.uZenith.value;
  for (const k in wx) { wx[k] += ((k === tgt ? 1 : 0) - wx[k]) * Math.min(1, dt * 0.2); const P = WXP[k], w = wx[k];
    far *= 1 + (P.far - 1) * w; grip *= 1 + (P.grip - 1) * w; dark *= 1 + (P.dark - 1) * w;
    if (w > 0.001) { tmpC.copy(P.hz).multiply(L); H.lerp(tmpC, w * 0.85); Z.lerp(tmpC, w * 0.6); } }
  L.multiplyScalar(dark); U.uFar.value *= far * QUAL[qName].farK; wxGrip = grip; veh.gripMul = gripTest;
  U.uHeadK.value = Math.max(U.uHeadK.value, (wx.fog + wx.dust) * 0.6);
  const pm = dustFx.material.uniforms; pm.uAmt.value = wx.dust * 0.9; dustFx.visible = pm.uAmt.value > 0.02; dustFx.position.copy(camera.position);
}
// biome sky: horizon / zenith tint + fog distance blended along the route with the biome weights (fades out at night)
const BSKY = [[0xf2dcb0, 0x3f86d6, 1], [0xf6c890, 0x4a8ad0, 1.05], [0xcfe0d0, 0x4f7fb8, 0.8], [0xe0e8f2, 0x2f6fd0, 1.15], [0xe6f0f4, 0x58a0e0, 0.95]].map(([h, z, f]) => ({ h: new THREE.Color(h), z: new THREE.Color(z), f }));
const bH = new THREE.Color(), bZ = new THREE.Color();
function biomeSky() { const w = W.biomeAtS(sCur), d = 1 - U.uNight.value; bH.setRGB(0, 0, 0); bZ.setRGB(0, 0, 0); let f = 0;
  for (let i = 0; i < W.NB; i++) { const k = w[i]; if (!k) continue; const B = BSKY[i]; bH.r += B.h.r * k; bH.g += B.h.g * k; bH.b += B.h.b * k; bZ.r += B.z.r * k; bZ.g += B.z.g * k; bZ.b += B.z.b * k; f += B.f * k; }
  U.uHorizon.value.lerp(bH, 0.45 * d); U.uZenith.value.lerp(bZ, 0.35 * d); return f || 1; }
// ---------- menu (☰): tabbed sheet — DRIVE/FLY · VEHICLE · SOUND · GRAPHICS · CONTROLS/HUD · WORLD ----------
let selector = null, mTab = 'drive';
const TABS = { drive: () => 'DRIVE', vehicle: () => 'VEHICLE', sound: () => 'ENGINE SOUND', gfx: () => 'GRAPHICS', hud: () => 'CONTROLS & HUD', world: () => 'WORLD' };
const mk = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
function segRows(el, rows) { // [label, options, get, set, note?] → a row of toggle buttons
  for (const [label, opts, get, set, note] of rows) { const r = mk('div', 'mrow'); r.appendChild(mk('span', '', label));
    for (const o of opts) { const b = mk('button', 'sb' + (get() === o ? ' sel' : ''), String(o).toUpperCase()); b.onclick = () => { set(o); buildMenu(); }; r.appendChild(b); }
    el.appendChild(r); if (note) el.appendChild(mk('div', 'mnote', note)); } }
function actRow(el, title, acts) { el.appendChild(mk('div', 'msec', title)); const g = mk('div', 'mrow');
  for (const [t, f, cls] of acts) { const b = mk('button', 'sb' + (cls ? ' ' + cls : ''), t); b.onclick = () => { f(); if (menuOpen) buildMenu(); }; g.appendChild(b); } el.appendChild(g); return g; }
function buildMenu() {
  $('mtDrive').textContent = 'DRIVE';
  const d = $('mRows'); d.innerHTML = '';
  const acts = [['⟲ RESET TO ROAD', () => { reset(); openMenu(false); }], ['🔧 REPAIR', () => { PH.repair(veh); msg('REPAIRED'); }], [autoOn ? '🤖 AUTOPILOT: ON' : '🤖 AUTOPILOT: OFF', () => setAuto(!autoOn)]];
  if (veh.cargo.capacity > 0) acts.push(['UNLOAD LOGS (' + veh.cargo.logs + ')', () => rig.unload()]);
  actRow(d, 'CAR', acts); d.appendChild(mk('div', 'msec', 'HANDLING & ASSISTS'));
  segRows(d, [['HANDLING', ['Arcade', 'Normal'], () => hMode === 'arcade' ? 'Arcade' : 'Normal', v => setHandling(v.toLowerCase())],
    ['STABILITY ASSIST', ['On', 'Off'], () => assist.stab ? 'On' : 'Off', v => { assist.stab = veh.assist.stab = v === 'On'; localStorage.setItem('srroute_stab', assist.stab ? '1' : '0'); }],
    ['TRACTION CONTROL', ['On', 'Off'], () => assist.tc ? 'On' : 'Off', v => { assist.tc = veh.assist.tc = v === 'On'; localStorage.setItem('srroute_tc', assist.tc ? '1' : '0'); }]]);
  d.appendChild(mk('div', 'msec', 'ROUTE'));
  { const g = W.segmentAt(sCur), n = W.nextBiome(sCur); d.appendChild(mk('div', 'mnote', `${(odo / 1000).toFixed(1)} km driven · route km ${(sCur / 1000).toFixed(1)} · ${g.title} → ${n.title} in ${((n.s - sCur) / 1000).toFixed(1)} km · seed ${W.SEED} (?seed=)`)); }
  d.appendChild(mk('div', 'msec', 'STATUS'));
  d.appendChild(mk('div', 'mnote', `${vDef.name} · damage ${veh.damage.toFixed(0)}% · engine ${veh.heat.temp.toFixed(0)}°C${veh.cargo.capacity ? ` · logs ${veh.cargo.logs}/${veh.cargo.capacity}` : ''}`));
  // GRAPHICS
  const g = $('mGfx'); g.innerHTML = '';
  segRows(g, [['QUALITY', Q_ORDER, () => qName, setQual, 'LOW = fastest · MED = default on phones · HIGH = sharp road textures + shadows · ULTRA = max textures, draw distance, grass (reload for full distance).'],
    ['FPS / DEBUG', ['Off', 'On'], () => dbg ? 'On' : 'Off', v => { if ((v === 'On') !== dbg) toggleDbg(); }]]);
  g.appendChild(mk('div', 'mnote', 'Dynamic resolution keeps the frame rate up' + (DYN ? ' (on).' : ' (off: ?dyn=0).')));
  // CONTROLS & HUD
  const hu = $('mHud'); hu.innerHTML = '';
  const e1 = mk('button', 'sb mbig', '✥ EDIT HUD LAYOUT'); e1.id = 'mEditUi'; e1.style.cssText = 'background:var(--o);color:#fff'; e1.onclick = () => { openMenu(false); uied.openEd(); };
  const r0 = mk('div', 'mrow'); r0.appendChild(e1); hu.appendChild(r0); hu.appendChild(mk('div', 'mnote', 'Drag, scale, hide or fade every HUD element; save presets and slots. Keyboard: U.'));
  segRows(hu, [['TREE HP', ['Off', 'On'], () => treeHpOn ? 'On' : 'Off', v => setTreeHp(v === 'On'), 'HP bars and damage numbers over trees. Off by default.']]);
  segRows(hu, [['HUD MODE', ['Full', 'Minimal', 'None'], () => uiMode[0].toUpperCase() + uiMode.slice(1), v => setUi(v.toLowerCase()), 'NONE keeps only a faint ☰ ⚙ corner (and the touch controls). Keyboard: I.'],
    ['TILT STEERING', ['Off', 'On'], () => tilt ? 'On' : 'Off', v => { if ((v === 'On') !== tilt) $('tTilt').onclick(); }]]);
  hu.appendChild(mk('div', 'msec', 'KEYBOARD'));
  hu.appendChild(mk('div', 'mnote', 'WASD/arrows · Space drift · Shift boost · R reset to road · O autopilot · H handling · V next vehicle · G graphics · F FPS · I HUD mode · U edit HUD · Shift+U unload.'));
  // WORLD
  const w = $('mWorld'); w.innerHTML = '';
  segRows(w, [['TIME OF DAY', ['Auto', 'Day', 'Sunset', 'Night'], () => timeMode, v => { timeMode = v; localStorage.setItem('srroute_time', v); applyTime(); }],
    ['WEATHER', WX_MODES, () => wxMode, v => { wxMode = v; localStorage.setItem('srroute_wx', v); applyWx(); }]]);
  { const r = mk('div', 'mrow'); r.appendChild(mk('span', '', 'SKY')); const se = document.createElement('select'); se.id = 'mSky'; se.className = 'msel';
    for (const k in SKY_P) { const o = document.createElement('option'); o.value = k; o.textContent = k.toUpperCase(); se.appendChild(o); } se.value = skyMode;
    se.onchange = () => { skyMode = se.value; localStorage.setItem('srroute_sky', skyMode); }; r.appendChild(se); w.appendChild(r); }
  actRow(w, 'SCENERY', [['🌲 REGROW TREES & ROCKS', () => { T.resetTrees(); props.clearTrees(); hpMap.clear(); rockGone.clear(); store.set('srr_rocks_gone', []); scx = 1e9; msg('SCENERY REGROWN'); }], ['🔥 PUT OUT FIRES', () => { T.extinguishAll(); }]]);
}
function showTab(t) { if (!TABS[t]) t = 'drive'; mTab = t;
  document.querySelectorAll('#mTabs .mtab').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll('#mPanes .mpane').forEach(p => p.classList.toggle('on', p.dataset.pane === t)); $('mTitle').textContent = TABS[t]();
  if (t === 'vehicle') { if (!selector) vehRow(); } else if (selector) { selector.close(); selector = null; $('mVeh').innerHTML = ''; } // the 3D preview only runs on its tab
  if (t === 'sound') audio.buildMenu($('mSnd')); $('mPanes').scrollTop = 0; }
document.querySelectorAll('#mTabs .mtab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
let vSub = null; // VEHICLE → CARS sub-menu: null | 'power'
let vTab = null; // VEHICLE tab: 'car' | 'plane' (defaults to the current craft)
function vehRow() { // VEHICLE: CARS (physics module's selector) + ⚙ ENGINE / POWER, a second small WebGL canvas closed with the menu
  const mv = $('mVeh'); if (selector) { selector.close(); selector = null; }
  mv.innerHTML = '';
  if (vSub === 'power') { $('mAtt').innerHTML = ''; // ⚙ ENGINE / POWER sub-panel (‹ BACK returns to the car list)
    openPowerPanel({ container: mv, def: vDef, getState: () => rig.state, onChange: c => { PWR.apply(rig.state, vDef, c); }, onBack: () => { vSub = null; vehRow(); } }); $('mPanes').scrollTop = 0; return; }
  const box = document.createElement('div'); mv.appendChild(box);
  const small = innerHeight < 500, size = small ? [200, 113] : [240, 136];
  selector = openSelector({ THREE, container: box, current: vDef.id, size, onPick: id => { setVehicle(id); attRow(); buildMenu(); powRow(); } }); powRow(); attRow();
  function powRow() { let r = $('vPow'); if (!r) { r = mk('div', 'mrow'); r.id = 'vPow'; mv.appendChild(r); } r.innerHTML = '';
    const c = rig.state.__power ? rig.state.__power.cfg : null, hp = c ? c.hp : PWR.stockOf(rig.state.__stockP || rig.state.P).hp;
    const b = mk('button', 'sb mbig' + (c ? ' sel' : ''), `⚙ ENGINE / POWER · ${hp.toLocaleString('en-US')} hp${c ? '' : ' (stock)'} ▸`); b.id = 'vPowBtn'; b.onclick = () => { vSub = 'power'; vehRow(); }; r.appendChild(b); }
}
function attRow() { const ma = $('mAtt'); ma.innerHTML = '<div class="msec">ATTACHMENTS · ' + vDef.name + '</div>'; const c = document.createElement('div'); ma.appendChild(c);
  renderPicker({ container: c, vehicle: vDef, selected: rig.attach, onChange: ids => { setAttachments(ids); buildMenu(); } }); }
let menuOpen = false;
function openMenu(o, tab) { menuOpen = !!o; $('menu').classList.toggle('on', menuOpen); $('tMenu').classList.toggle('sel', menuOpen); if (menuOpen) quick(false);
  if (menuOpen) { vTab = null; vSub = null; buildMenu(); showTab(tab || mTab); } else { if (selector) { selector.close(); selector = null; } $('mVeh').innerHTML = ''; sndBtn(); } }
$('tMenu').onclick = () => openMenu(!menuOpen); $('mnClose').onclick = () => openMenu(false);
// ---------- ⚙ quick-settings tray: RESET · GFX · ARC/NRM · HUD mode · TILT · FPS · SOUND · MAP (closes on an outside tap or after 8 s) ----------
let qOpen = false, qT = 0;
function quick(o) { qOpen = o == null ? !qOpen : !!o; $('qtray').classList.toggle('on', qOpen); $('tQuick').classList.toggle('sel', qOpen); qT = 8;
  if (qOpen) { const r = $('corner').getBoundingClientRect(); $('corner').classList.toggle('left', r.left < innerWidth / 2 - 60); $('corner').classList.toggle('up', r.top > innerHeight / 2); quickLabels(); } }
function quickLabels() { const L = (id, big, small, on) => { const e = $(id); e.innerHTML = big + '<small>' + small + '</small>'; e.classList.toggle('on', !!on); };
  L('tQ', qName.toUpperCase(), 'GRAPHICS'); L('tHand', hMode === 'arcade' ? 'ARC' : 'NRM', 'HANDLING'); L('tUi', uiMode === 'full' ? '◉ FULL' : uiMode === 'minimal' ? '◐ MIN' : '○ NONE', 'HUD');
  L('tTilt', tilt ? 'ON' : 'OFF', 'TILT', tilt); L('tDbg', dbg ? 'ON' : 'OFF', 'FPS', dbg); L('tSnd', audio && audio.muted ? '🔇 OFF' : '🔊 ON', 'SOUND'); L('tReset', '⟲', 'RESET'); L('tAuto', autoOn ? 'ON' : 'OFF', 'AUTO', autoOn); }
$('tQuick').onclick = () => quick();
addEventListener('pointerdown', e => { if (qOpen && !$('corner').contains(e.target)) quick(false); }, true);
$('qtray').addEventListener('click', () => { qT = 8; setTimeout(quickLabels, 0); });
function setAuto(on) { autoOn = !!on; if (!autoOn) { inp.gas = inp.brake = 0; inp.steer = 0; steerSm = 0; } msg('AUTOPILOT ' + (autoOn ? 'ON' : 'OFF')); if (audio) quickLabels(); }
$('tAuto').onclick = () => setAuto(!autoOn);
addEventListener('keydown', e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'Escape') { if (editor.open || uied.open) { editor.close(); uied.close(); } else openMenu(!menuOpen); quick(false); }
  if (uied && uied.open) { if (e.code === 'KeyU') uied.close(); return; } // layout editor open: game keys paused
  if (e.code === 'KeyO') setAuto(!autoOn);
  if (e.code === 'KeyV') { const l = listVehicles(), i = l.findIndex(v => v.id === vDef.id); setVehicle(l[(i + 1) % l.length].id); }
  if (e.code === 'KeyU') { if (e.shiftKey) rig.unload(); else uied.openEd(); } /* U = EDIT UI (unload: Shift+U) */ if (e.code === 'KeyH') setHandling(hMode === 'arcade' ? 'normal' : 'arcade'); if (e.code === 'KeyI') cycleUi(); });
// ---------- HUD toggles: handling ARC/NRM, UI hide (FULL → MINIMAL → NONE), unload (only with logs) ----------
function setHandling(m) { hMode = m === 'normal' ? 'normal' : 'arcade'; rig.setMode(hMode); localStorage.setItem('srroute_handling', hMode); store.set('srroute_p_handling', hMode);
  $('tHand').classList.toggle('nrm', hMode === 'normal'); steerSm = 0; if (typeof quickLabels === 'function' && audio) quickLabels(); return hMode; }
let uied = null; // layout editor (created below, after the sound editor)
const UI_MODES = ['full', 'minimal', 'none']; let uiMode = UI_MODES.includes(localStorage.getItem('srroute_ui')) ? localStorage.getItem('srroute_ui') : 'full', unlShown = null;
function setUi(m) { uiMode = UI_MODES.includes(m) ? m : 'full'; localStorage.setItem('srroute_ui', uiMode); document.body.classList.toggle('ui-min', uiMode === 'minimal'); document.body.classList.toggle('ui-none', uiMode === 'none');
  $('tUi').title = 'HUD: ' + uiMode.toUpperCase() + ' (I)'; if (audio) quickLabels(); if (uied) uied.applyAll(); return uiMode; }
function cycleUi() { return setUi(UI_MODES[(UI_MODES.indexOf(uiMode) + 1) % 3]); }
$('tUi').onclick = () => { cycleUi(); msg('HUD ' + uiMode.toUpperCase()); }; $('tHand').onclick = () => { setHandling(hMode === 'arcade' ? 'normal' : 'arcade'); msg(hMode.toUpperCase() + ' HANDLING'); };
$('bUnl').onclick = () => rig.unload(); setUi(uiMode); setHandling(hMode);
// ---------- telemetry + event hooks (read-only window.SR; see PLUGIN_API.md / MERGE_NOTES.md) ----------
const TEL = { rpm: 0, idle: 0, redline: 0, throttle: 0, brake: 0, boost: false, nitro: 1, gear: 1, gears: 6, shifting: false, load: 0, speed: 0, fwdSpeed: 0, grounded: 0, air: 0,
  surface: 'grass', wheels: [0, 1, 2, 3].map(() => ({ contact: false, surface: 'grass', slipRatio: 0, slipAngle: 0, load: 0 })), vehicle: 'buggy', vehiclePreset: '', soundPreset: '', engineTemp: 70,
  temp: 70, overheat: false, limiter: false, damage: 0, mass: 0, logs: 0, capacity: 0, paused: false };
function updateTelemetry() {
  PH.telemetry(veh, TEL); TEL.gears = veh.P.gears.length; TEL.vehicle = vDef.id; TEL.soundPreset = TEL.vehiclePreset = vDef.sound || ''; TEL.engineTemp = veh.heat.temp; TEL.paused = mapOpen || !!(uied && uied.open);
}
const roProxy = o => new Proxy(o, { set() { return false; }, get(t, k) { const v = t[k]; return v && typeof v === 'object' ? roProxy(v) : v; } });
window.SR = Object.freeze({ telemetry: roProxy(TEL), on(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }, off(type, fn) { const l = listeners[type]; if (l) l.splice(l.indexOf(fn) >>> 0, 1); } });
// engine sound: the host only reads window.SR (telemetry + events), the plugin only sees the API v1 telemetry
audio = createEngineAudio({ sr: window.SR });
// optional engine sound editor (☰ → ENGINE SOUND → EDIT): only shown when the active plugin has setConfig/getConfig
const editor = createSoundEditor({ audio, onOpenChange: o => { if (o) { openMenu(false); quick(false); } } });
const editorOpen = () => editor.open;
uied = createUiEditor({ onOpenChange: o => { if (o) { openMenu(false); editor.close(); } else last = performance.now(); }, onUiRestore: () => setUi(uiMode) });
const sndBtn = () => quickLabels();
$('tSnd').onclick = () => { if (!audio.running) { audio.unlock(); audio.setMuted(false); } else audio.setMuted(!audio.muted); sndBtn(); }; sndBtn(); // first tap = enable sound

if (isTouch) document.body.classList.add('touch');

// ---------- loop ----------
const camPos = new THREE.Vector3(veh.p.x, veh.p.y + 6, veh.p.z - 12), look = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, 1);
const tv = new THREE.Vector3(), RV = new THREE.Vector3(), camTrees = []; let camBack = 8, camLow = 0;
let last = performance.now(), acc = 0, fpsT = 0, frames = 0, fps = 0, shake = 0, tFrame = 0;
let pwSpool = 0; const STEP = 1 / 120, stats = { fps: 0, physMs: 0, frameMs: 0, minFps: 999 };
const focus = { x: 0, y: 0, z: 0 };
function updateWorld(force) { updateScenery(veh.p.x, veh.p.z); if (force) scx = 1e9, updateScenery(veh.p.x, veh.p.z); }
// ---------- floating origin: when the car is > 1080 m from the local origin, shift EVERYTHING by a multiple of 720 m
// (physics state + wheels, camera, dust, skids, rocks, props, terrain/roads/trees/grass via T.shiftOrigin). Keeps float32 precision for 50+ km.
const REBASE_R = 1080, REBASE_STEP = 720; let rebases = 0, odoX = veh.p.x, odoZ = veh.p.z;
function rebase() {
  const px = veh.p.x, pz = veh.p.z; if (Math.abs(px) < REBASE_R && Math.abs(pz) < REBASE_R) return false;
  const dx = Math.round(px / REBASE_STEP) * REBASE_STEP, dz = Math.round(pz / REBASE_STEP) * REBASE_STEP; if (!dx && !dz) return false;
  const pre = W.project(px, pz), vx = veh.v.x, vz = veh.v.z, cgx = camPos.x - px, cgz = camPos.z - pz;
  veh.p.x -= dx; veh.p.z -= dz;
  for (const wh of veh.wheels) { if (wh.pos) { wh.pos.x -= dx; wh.pos.z -= dz; } if (wh.cp) { wh.cp.x -= dx; wh.cp.z -= dz; } }
  camPos.x -= dx; camPos.z -= dz; look.x -= dx; look.z -= dz; camera.position.x -= dx; camera.position.z -= dz; camera.updateMatrixWorld();
  for (let i = 0; i < PN; i++) { pPos[i * 3] -= dx; pPos[i * 3 + 2] -= dz; } pGeo.attributes.position.needsUpdate = true;
  for (let i = 0; i < skPos.length; i += 3) { skPos[i] -= dx; skPos[i + 2] -= dz; } skGeo.attributes.position.needsUpdate = true;
  for (const p of skPrev) if (p) { p[0] -= dx; p[2] -= dz; }
  odoX -= dx; odoZ -= dz;
  T.shiftOrigin(dx, dz, veh.p.x, veh.p.z); // world.js origin + terrain rings/roads/trees/grass/fire + uOrg
  cellCache.clear(); scx = 1e9; colliders.length = 0; props.shift(); updateScenery(veh.p.x, veh.p.z);
  { const post = W.project(veh.p.x, veh.p.z), e = Math.max(Math.abs(post.s - pre.s), Math.abs(post.d - pre.d), Math.abs(veh.v.x - vx) + Math.abs(veh.v.z - vz), Math.abs(camPos.x - veh.p.x - cgx) + Math.abs(camPos.z - veh.p.z - cgz));
    stats.rebaseErr = Math.max(stats.rebaseErr || 0, e); }
  vis.group.position.set(veh.p.x, veh.p.y, veh.p.z); rebases++; fire('origin:shift', { dx, dz, origin: W.origin() });
  return true;
}
applyQuality(); updateWorld(true);
function frame(now) {
  requestAnimationFrame(frame); const t0 = performance.now(); let dt = Math.min(0.1, (now - last) / 1000); last = now; tFrame += dt; renderer.info.reset();
  dynRes(dt);
  if (uied.open) { audio.frame(dt, true); last = now; return; } // UI layout editor pauses the game (last frame stays on screen)
  readInput(dt);
  if (editor.benching) { inp.gas = inp.brake = inp.boost = 0; inp.steer = 0; inp.hand = 1; } // sound editor open: car input paused (audio keeps running)
  acc += dt; let steps = 0; const tp = performance.now();
  while (acc >= STEP && steps < 12) { simT += STEP; T.setRef(veh.p.y); const g0 = inp.gas; inp.gas = PWR.throttle(veh, STEP, g0); rig.step(inp, STEP); inp.gas = g0; pwSpool = PWR.tick(veh, STEP, inp.gas); collideRocks(veh); tunnelWalls(veh); acc -= STEP; steps++; }
  if (steps === 12) acc = 0;
  stats.physMs = performance.now() - tp;
  rebase();
  { const d = Math.hypot(veh.p.x - odoX, veh.p.z - odoZ); if (d < 50) odo += d; odoX = veh.p.x; odoZ = veh.p.z; } // odometer (teleports / resets do not count)
  sCur = Math.max(0, W.project(veh.p.x, veh.p.z).s); if (sCur > sMax) sMax = sCur; W.setFocus(sCur); props.update(sCur);
  updateWorld(false); if (qOpen && (qT -= dt) <= 0) quick(false);
  U.uHeadP.value.set(veh.p.x, veh.p.y, veh.p.z).addScaledVector(veh.fwd, 2).addScaledVector(veh.up, 0.8); U.uHeadD.value.set(veh.fwd.x, veh.fwd.y, veh.fwd.z).addScaledVector(veh.up, -0.12).normalize();
  const sp = Math.hypot(veh.v.x, veh.v.y, veh.v.z), boosting = veh.boosting;
  // car visuals: vehicle model on the rigid-body frame, wheels from the raycast suspension, attachments on rig.root (child of the model group)
  vis.group.position.set(veh.p.x, veh.p.y, veh.p.z); vis.group.quaternion.set(veh.q.x, veh.q.y, veh.q.z, veh.q.w);
  const wr = veh.P.wheelR;
  for (let i = 0; i < veh.wheels.length; i++) { const wh = veh.wheels[i]; vis.setWheel(i, wh.comp, wh.steer, wh.rot);
    const si = surfIdx(wh.surf);
    if (wh.contact) {
      const slip = Math.abs(wh.sl) > 0.15 || Math.abs(wh.sa) > 0.12, loose = si === 1 || si === 3 || si === 5 || si === 6;
      if ((loose && (slip || sp > 14) && Math.random() < 0.35 + Math.min(0.4, sp * 0.01)) || (slip && sp > 8 && Math.random() < 0.25))
        puff(wh.pos.x, wh.pos.y - 0.2, wh.pos.z, -veh.v.x * 0.15 + (Math.random() - .5) * 3, 0.5 + Math.random() * 1.2, -veh.v.z * 0.15 + (Math.random() - .5) * 3,
          0.6 + Math.random() * 0.7 + (slip ? 0.5 : 0), 0.45 + Math.random() * 0.35, PUFFC[si] || PUFFC[2]);
    }
    if (i >= 2 && i < 4) { const on = wh.contact && si !== 5 && (Math.abs(wh.sa) > 0.15 || Math.abs(wh.sl) > 0.2) && sp > 4;
      const gy = wh.pos.y - wr + (si === 0 ? 0.2 : si === 1 ? 0.12 : 0.05);
      skid(i - 2, wh.pos.x, gy, wh.pos.z, veh.left.x, veh.left.z, on); }
  }
  comicify(rig.root);
  updatePuffs(dt);
  vis.flame.visible = boosting; vis.flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
  { const gy = T.groundAt(veh.p.x, veh.p.z); shadow.position.set(veh.p.x, gy + 0.1, veh.p.z); shadow.rotation.y = PH.yawOf(veh); const sh = Math.max(0.3, 1 - (veh.p.y - 1.1 - gy) * 0.08); shadow.scale.set(sh * shadow.userData.w, 1, sh * shadow.userData.l); shadow.visible = veh.up.y > 0.3; const d = veh.P.dims || [2, 1.5, 4.4]; if (vshadow.size && vshadow.update(vis.group, veh.p, Math.max(d[0], d[2]) * 0.62 + 0.4)) shadow.visible = false; }
  // chase camera: follows velocity direction when moving fast, heading otherwise; FOV kick on boost
  const dims = veh.P.dims || [2, 1.5, 4.4];
  tv.set(veh.fwd.x, 0, veh.fwd.z); if (fwdSpeed() < -3) tv.negate(); tv.normalize();
  if (sp > 6 && veh.grounded) { RV.set(veh.v.x, 0, veh.v.z).normalize(); tv.lerp(RV, 0.35).normalize(); }
  camDir.lerp(tv, Math.min(1, (veh.grounded ? 4 : 1.2) * dt)).normalize();
  let back = 6.5 + dims[2] * 0.45 + sp * 0.05, low = 0;
  { // don't park the chase camera inside a tree: shorten the boom in front of the nearest trunk/canopy on the camera ray
    const ts = world.queryTrees(veh.p.x - camDir.x * back * 0.5, veh.p.z - camDir.z * back * 0.5, back * 0.5 + 3, camTrees);
    for (const t of ts) { const dx = t.x - veh.p.x, dz = t.z - veh.p.z, tt = -(dx * camDir.x + dz * camDir.z), lat = Math.abs(dx * camDir.z - dz * camDir.x);
      const tr = T.getTree(t.id), cr = tr ? Math.max(1.4, Math.min(3.2, tr.height * 0.26)) : 1.5;
      if (tt > 0 && tt < back + cr && lat < cr) back = Math.min(back, Math.max(3.2, tt - cr * 0.8));
      if (tt > -1 && tt < back + cr + 1.5 && lat < cr + 1.5) low = 1; } } // crowns around the boom: drop the camera below them (crowns start ~2.6 m up)
  camBack += (back - camBack) * Math.min(1, (back < camBack ? 10 : 2) * dt); back = camBack; camLow += (low - camLow) * Math.min(1, 3 * dt);
  const cx = veh.p.x - camDir.x * back, cz = veh.p.z - camDir.z * back;
  const ch = 2.2 + dims[1] * 0.67, tin = T.tunnelAt(veh.p.x, veh.p.z), tgt = tin ? tv.set(cx, Math.min(veh.p.y + ch, tin.floor + tin.H - 1.2), cz) // in a tunnel: under the roof
    : tv.set(cx, Math.max(veh.p.y + ch + (1.1 - ch) * camLow, T.groundAt(cx, cz) + 2 - 0.6 * camLow), cz);
  camPos.lerp(tgt, Math.min(1, 6 * dt)); camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake * 0.8; camera.position.y += (Math.random() - .5) * shake * 0.8; shake = Math.max(0, shake - dt * 2.5); }
  look.set(veh.p.x, veh.p.y + 1.3, veh.p.z); camera.lookAt(look);
  camera.fov += ((boosting ? 80 : 64 + Math.min(12, sp * 0.15)) - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  if (window.__st.camHook) window.__st.camHook(camera); // tests / screenshots: custom camera (e.g. low shot across the RIM banking)
  focus.x = veh.p.x; focus.y = veh.p.y; focus.z = veh.p.z;
  T.update(dt, { camera, focus, viewHeight: rt.height }); atmosphere(dt); // terrain weather/sky/fire/trees, then the game's fog/dust overlay
  post.uniforms.uBoost.value += ((boosting ? 1 : 0) - post.uniforms.uBoost.value) * Math.min(1, 6 * dt);
  $('spd').textContent = Math.abs(Math.round(fwdSpeed() * 3.6)); $('bar').style.width = (veh.nitro * 100) + '%';
  $('air').textContent = veh.air > 0.5 ? 'AIR ' + veh.air.toFixed(1) + 's!' : '';
  $('carinfo').textContent = (veh.damage >= 1 ? 'DMG ' + veh.damage.toFixed(0) + '%  ' : '') + (veh.cargo.capacity ? 'LOGS ' + veh.cargo.logs + '/' + veh.cargo.capacity : '');
  { const show = veh.cargo.capacity > 0 && veh.cargo.logs > 0; if (show !== unlShown) { unlShown = show; $('bUnl').style.display = show ? 'block' : 'none'; } if (show) $('bUnl').textContent = 'UNLOAD ' + veh.cargo.logs; }
  if (msgT > 0 && performance.now() >= msgT) { msgT = 0; $('msg').textContent = ''; $('msg').classList.remove('show'); }
  updateTelemetry(); routeHud(dt); gauge(); updateLabels(dt); audio.hostTurbo = veh.__power && veh.__power.cfg.spool ? pwSpool : undefined; audio.frame(dt);
  if (!QS.has('nopost')) { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(postScene, postCam); }
  else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  stats.frameMs = performance.now() - t0;
  { const g = Math.hypot(camera.position.x - veh.p.x, camera.position.z - veh.p.z); if (tFrame > 2 && stats.camG != null) stats.camJump = Math.max(stats.camJump || 0, Math.abs(g - stats.camG)); stats.camG = g; }
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = stats.fps = frames / fpsT; window.__fps = fps; if (tFrame > 3) stats.minFps = Math.min(stats.minFps, fps); frames = 0; fpsT = 0;
    if (dbg) { sample(veh.p.x, veh.p.z, SO); const ts = T.stats ? T.stats() : {}, O = W.origin(); $('dbg').textContent = `${fps.toFixed(0)} fps  GFX ${qName}  cpu ${stats.frameMs.toFixed(1)}ms (phys ${stats.physMs.toFixed(1)})\ncalls ${renderer.info.render.calls} tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k\nroute ${(sCur / 1000).toFixed(2)} km · local ${veh.p.x.toFixed(0)},${veh.p.z.toFixed(0)} y${veh.p.y.toFixed(0)} · origin ${O.x},${O.z} (${rebases}×) ${W.BIOME_NAMES[SO.dom]}\n${vDef.id} gear ${veh.gear} rpm ${veh.rpm.toFixed(0)} ${veh.heat.temp.toFixed(0)}°C wheels ${veh.grounded}${autoOn ? ' AUTO' : ''}${ts.fire && ts.fire.burning ? ' fire ' + ts.fire.burning : ''}`; } }
}
// tests: run physics + autopilot + floating origin + route streaming WITHOUT rendering (50+ km drives in seconds of wall time)
function simFast(sec) {
  const n = Math.round(sec / STEP), r = { maxD: 0, maxLocal: 0, minSpeed: 1e9, offroad: 0, tunnels: 0, bridges: 0, rebases0: rebases, s0: sCur, odo0: odo, maxY: -1e9, minY: 1e9, airs: 0, crashes: 0, stuck: 0 };
  const offCrash = bus.on('crash', () => r.crashes++); let lastS = sCur, stuckT = 0;
  for (let i = 0; i < n; i++) {
    simT += STEP; if (autoOn) autopilot(STEP); T.setRef(veh.p.y); const g0 = inp.gas; inp.gas = PWR.throttle(veh, STEP, g0); rig.step(inp, STEP); inp.gas = g0; pwSpool = PWR.tick(veh, STEP, inp.gas); collideRocks(veh); tunnelWalls(veh);
    if (i % 12) continue; // 10 Hz bookkeeping, like a slow frame
    rebase(); { const d = Math.hypot(veh.p.x - odoX, veh.p.z - odoZ); if (d < 50) odo += d; odoX = veh.p.x; odoZ = veh.p.z; }
    const pr = W.project(veh.p.x, veh.p.z); sCur = Math.max(0, pr.s); if (sCur > sMax) sMax = sCur; W.setFocus(sCur); props.update(sCur); updateWorld(false);
    const ad = Math.abs(pr.d); r.maxD = Math.max(r.maxD, ad); if (ad > W.ROAD_HW + 0.5) r.offroad++; r.maxLocal = Math.max(r.maxLocal, Math.abs(veh.p.x), Math.abs(veh.p.z));
    const sp = fwdSpeed(); if (simT > 5) r.minSpeed = Math.min(r.minSpeed, sp); r.maxY = Math.max(r.maxY, veh.p.y); r.minY = Math.min(r.minY, veh.p.y);
    if (T.tunnelAt(veh.p.x, veh.p.z)) r.tunnels++; if (W.routePoint(sCur).bridge) r.bridges++;
    if ((stuckT += 0.1) > 10) { if (sCur - lastS < 20) { r.stuck++; const p = lanePoint(sCur + 30); spawn(p.x, p.z, p.yaw); } lastS = sCur; stuckT = 0; }
    if (i % 600 === 0) { camPos.set(veh.p.x, veh.p.y + 5, veh.p.z - 10); camera.position.copy(camPos); look.set(veh.p.x, veh.p.y, veh.p.z); camera.lookAt(look); camera.updateMatrixWorld(); focus.x = veh.p.x; focus.y = veh.p.y; focus.z = veh.p.z; T.update(0.5, { camera, focus, viewHeight: rt.height }); }
  }
  offCrash(); r.km = (odo - r.odo0) / 1000; r.ds = sCur - r.s0; r.rebases = rebases - r.rebases0; r.damage = veh.damage; r.origin = W.origin(); r.rebaseErr = stats.rebaseErr || 0; r.chunks = W.chunkStats();
  return r;
}
requestAnimationFrame(frame);
// release identity from js/version.js (title, menu tag, versions link)
document.title = GAME_NAME; { const t = document.getElementById('verTag'); if (t) t.textContent = 'V' + GAME_VERSION; const v = document.getElementById('versionsLink'); if (v) v.href = VERSIONS_URL; }
window.__st = { version: GAME_NAME, renderer, U, get msgText() { return $("msg") ? $("msg").textContent : ""; }, PWR, get gripTest() { return gripTest; }, set gripTest(v) { gripTest = v; }, get vSub() { return vSub; }, openPower: () => { openMenu(true, 'vehicle'); vSub = 'power'; vehRow(); }, msg, get msgT() { return msgT ? Math.max(0, msgT - performance.now()) / 1000 : 0; }, get veh() { return veh; }, get state() { return veh; }, rig, T, PH, bus, world, hpMap, evLog, stats, inp, W, audio, editor, TEL, scene,
  get q() { return qName; }, setQ(q) { qName = q; applyQuality(); }, get x() { return veh.p.x; }, get z() { return veh.p.z; }, get y() { return veh.p.y; },
  place(x, z, yaw = 0) { spawn(x, z, yaw); }, teleport(x, z, yaw = 0) { spawn(x, z, yaw); updateWorld(true); }, toBiome(name, yaw = 0) { const p = T.findBiome(name, veh.p.x, veh.p.z); if (p) this.teleport(p.x, p.z, yaw); return p; },
  toS(s, d = 3) { const p = lanePoint(Math.max(0, s), d); spawn(p.x, p.z, p.yaw); camPos.set(veh.p.x - Math.sin(p.yaw) * 10, veh.p.y + 4, veh.p.z - Math.cos(p.yaw) * 10); odoX = veh.p.x; odoZ = veh.p.z; rebase(); odoX = veh.p.x; odoZ = veh.p.z; sCur = Math.max(0, W.project(veh.p.x, veh.p.z).s); W.setFocus(sCur); props.update(sCur); updateWorld(true); return p; },
  lanePoint, rebase, simFast, get rebases() { return rebases; }, get origin() { return W.origin(); }, props,
  get route() { const g = W.segmentAt(sCur), n = W.nextBiome(sCur), pr = W.project(veh.p.x, veh.p.z); return { s: sCur, sMax, km: odo / 1000, d: pr.d, biome: g.name, title: g.title, next: n.name, nextS: n.s, weights: Array.from(W.biomeAtS(sCur)) }; },
  get auto() { return autoOn; }, set auto(v) { autoOn = !!v; }, setAuto, get ap() { return AP; }, set odo(v) { odo = v; },
  setVehicle, useVehicle, setAttachments, get vName() { return vDef.id; }, openMenu, get wx() { return wx; }, setWx(m, snap = true) { wxMode = m; applyWx(); if (snap) T.snapWeather(); }, set tod(v) { tod = v; timeMode = 'Fixed'; applyTime(); },
  get dynS() { return dynS; }, get rinfo() { const r = renderer.info.render; return { tris: r.triangles, calls: r.calls, pr: renderer.getPixelRatio(), grass: grassMesh ? grassMesh.geometry.instanceCount : 0, det: U.uDet.value, sh: vshadow ? vshadow.size : 0, far: camera.far, qLoad, road: T.roadStats }; }, get QUAL() { return QUAL; }, vshadow, get camera() { return camera; }, get labels() { return labTrees; }, get handling() { return hMode; }, setHandling, get ui() { return uiMode; }, setUi, cycleUi, get uied() { return uied; }, rockGone, get rocks() { return colliders; }, collideRocks };
