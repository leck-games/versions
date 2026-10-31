// SineRally — merged release. Game shell (comic renderer, HUD, race gates, map, landmarks, fuel cans, sound plugin host)
// + vendored modules: js/terrain/ (sinerally-terrain: biomes, trees with HP, grass fire, forest weather/rain, day/night sky)
// and js/phys/ (sinerally-physics: rigid-body step, 5 vehicles, attachments, engine heat, tree damage).
// Everything talks through ONE event bus (`bus`): physics heat -> terrain fire, physics tree contacts -> terrain tree store,
// terrain grip/wet -> physics surfaceAt, and every event is forwarded to window.SR for the sound plugin (PLUGIN_API.md).
import * as THREE from 'three';
import * as W from './world.js';
import { createEngineAudio } from './engine-audio.js'; // engine sound plugin host (PLUGIN_API.md); talks to plugins only via the API
import { createSoundEditor } from './sound-editor.js';
import { createUiEditor } from './ui-editor.js'; // SineRally UI: HUD layout editor (☰ → EDIT UI, key U)
import { U, objMat, puffMat, decalMat, postMat, precipMat } from './shaders.js';
import { rockVariants, fuelCan, beacon, trackProps } from './models.js';
import { createTerrain } from './terrain/index.js';
import * as PH from './phys/physics/index.js';
import { createRig } from './phys/host/rig.js';
import { createBus } from './phys/host/bus.js';
import { buildVehicle } from './phys/vehicles/build.js';
import { listVehicles, getVehicle, DEFAULT_VEHICLE } from './phys/vehicles/index.js';
import { openSelector } from './phys/vehicles/selector.js';
import { renderPicker } from './phys/attachments/picker.js';
import { melts } from './phys/attachments/index.js';
const { WATER, nearTrack, trackPoint, hash2, sample, surfaceOf, colourOf, normal, height, ground } = W;
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
const QUAL = { Low: { pr: 1, post: true, fx: 1, sr: 200, hatch: 1.15, grass: 7000, trees: 0 }, Med: { pr: 1.5, post: true, fx: 1, sr: 250, hatch: 1.1, grass: 11000, trees: 1 }, High: { pr: 2, post: true, fx: 1, sr: 300, hatch: 1, grass: 16000, trees: 2 } };
const qArg = (QS.get('q') || '').toLowerCase(), qMap = { low: 'Low', med: 'Med', high: 'High' };
let qName = qMap[qArg] || localStorage.getItem('sinerally_q3') || (isTouch ? 'Med' : 'High'); if (!QUAL[qName]) qName = isTouch ? 'Med' : 'High';
let qLocked = !!(qMap[qArg] || localStorage.getItem('sinerally_q3')); // user choice: dyn-res never changes the level then
let mapOpen = false; const DYN = QS.get('dyn') !== '0'; let dynS = 1, lastSr = 0; // dynamic resolution scale 0.5..1
const SMALL = isTouch || qName === 'Low'; // terrain grid sizes are fixed at load (phones: smaller grids)
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.4, 1700);
const depthTex = new THREE.DepthTexture(1, 1); depthTex.type = THREE.UnsignedIntType;
const rt = new THREE.WebGLRenderTarget(1, 1, { depthTexture: depthTex, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
const post = postMat(); post.uniforms.tCol.value = rt.texture; post.uniforms.tDep.value = depthTex; post.uniforms.uN.value = camera.near; post.uniforms.uF.value = camera.far;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); quad.frustumCulled = false; postScene.add(quad);
function applyQuality() {
  const q = QUAL[qName], pr = Math.min(devicePixelRatio, q.pr) * dynS;
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); U.uPx.value = pr; U.uHatch.value = q.hatch; post.uniforms.uFx.value = q.fx;
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr); rt.setSize(w, h); post.uniforms.uRes.value.set(w, h); post.uniforms.uThick.value = Math.max(1.6, pr * 1.4);
  if (q.sr !== lastSr) { scx = 1e9; lastSr = q.sr; } $('tQ').textContent = 'GFX: ' + qName; window.__pr = pr;
  if (grassMesh) grassMesh.geometry.instanceCount = q.grass;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', () => applyQuality());
function setQual(n) { qName = n; qLocked = true; dynS = 1; localStorage.setItem('sinerally_q3', qName); applyQuality(); }
function cycleQ() { setQual(qName === 'Low' ? 'Med' : qName === 'Med' ? 'High' : 'Low'); }
let dynT = 0, dynFr = 0, slowN = 0;
function dynRes(dt) { // every second: scale render resolution to hold the target frame rate; at the floor, step quality down (unless user-chosen)
  if (!DYN) return; dynT += dt; dynFr++; if (dynT < 1) return; const f = dynFr / dynT; dynT = 0; dynFr = 0; if (tFrame < 4 || mapOpen) return;
  const tgt = isTouch ? 30 : 50; let s = dynS;
  if (f < tgt - 2) s = Math.max(0.5, s * Math.max(0.8, f / tgt)); else if (f > tgt * 1.45 && s < 1) s = Math.min(1, s * 1.08);
  if (Math.abs(s - dynS) > 0.03) { dynS = s; applyQuality(); }
  if (dynS <= 0.52 && f < tgt * 0.8) { if (++slowN >= 4 && !qLocked && qName !== 'Low') { qName = qName === 'High' ? 'Med' : 'Low'; dynS = 0.85; slowN = 0; applyQuality(); } } else slowN = 0;
}
// ---------- terrain module (vendored js/terrain): ground rings, GPU grass, trees with HP, grass fire, weather + sky ----------
// It gets an emit-only bus (no on()), so the game routes physics events into it explicitly (fractional tree HP lives here).
const T = createTerrain({ bus: { emit: (t, d) => bus.emit(t, d) }, small: SMALL, grassCount: QUAL.High.grass, persistKey: 'sinerally_terrain1' });
const tMeshes = T.setup(scene) || [];
const grassMesh = tMeshes.find(m => m && m.geometry && m.geometry.attributes && m.geometry.attributes.off) || null;
const SO = { h: 0, hn: 0, deck: 0, road: 0, rtype: 0, dom: 0, riv: 0, rd: 0 }, nv = [0, 0, 0], cv = [0, 0, 0];
const Mx = new THREE.Matrix4(), Qt = new THREE.Quaternion(), Vt = new THREE.Vector3(), St = new THREE.Vector3(), Et = new THREE.Euler(), Cc = new THREE.Color();

// ---------- world adapter: the physics worldQuery contract on top of the terrain module ----------
const SURF_POOL = Array.from({ length: 16 }, () => ({ name: 'grass', mu: 1, roll: 0, bs: 0, wet: 0, si: 2 })); let surfI = 0; const TS = {};
let wxGrip = 1; // fog/dust overlay grip (rain/wet grip is already in T.surfaceAt)
const hpMap = new Map(); // fractional tree HP (terrain stores whole segments 0..3)
const nArr = [0, 0, 0];
const world = {
  heightAt: (x, z) => T.heightAt(x, z),
  normalAt(x, z, out = { x: 0, y: 1, z: 0 }) { T.normalAt(x, z, nArr); out.x = nArr[0]; out.y = nArr[1]; out.z = nArr[2]; return out; },
  surfaceAt(x, z) { T.surfaceAt(x, z, TS); const o = SURF_POOL[surfI = (surfI + 1) & 15]; o.name = TS.surfaceName; o.si = TS.surface; o.mu = TS.grip * wxGrip; o.roll = TS.roll; o.bs = TS.bs; o.wet = TS.wet; return o; },
  waterLevel: WATER,
  queryTrees(x, z, r, out) {
    const a = T.queryTrees(x, z, r), res = out || []; if (out) out.length = 0;
    for (const t of a) { const h = hpMap.has(t.id) ? hpMap.get(t.id) : t.hp; if (h <= 0) continue; res.push({ id: t.id, x: t.pos.x, z: t.pos.z, r: t.radius, hp: h }); }
    return res;
  },
  damageTree(id, removed, cause) {
    const t = T.getTree(id); if (!t) return 0; const cur = hpMap.has(id) ? hpMap.get(id) : t.hp, rem = cur - removed;
    if (rem <= 0.05) { hpMap.delete(id); T.removeTree(id); return 0; }
    hpMap.set(id, rem); T.setTreeHP(id, Math.max(1, Math.ceil(rem - 1e-6))); return rem;
  },
};

// ---------- rocks (game scenery rules, hash per 14 m cell): solid colliders + instanced comic rocks ----------
const SC = 14, cellCache = new Map();
function inst(geo, mat, max) {
  const m = new THREE.InstancedMesh(geo, mat, max); m.frustumCulled = false; m.count = 0; scene.add(m);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3); return m;
}
const rockM = rockVariants().map(g => inst(g, objMat({ hatch: 1.2 }), 500));
function cellObj(ci, cj) {
  const key = ci * 1e5 + cj; let o = cellCache.get(key); if (o !== undefined) return o;
  o = null;
  const h = hash2(ci, cj, 9), x = (ci + hash2(ci, cj, 7)) * SC, z = (cj + hash2(ci, cj, 8)) * SC;
  sample(x, z, SO);
  if (SO.h > WATER + 1.2 && SO.road < 0.05 && SO.rd > 2.5) {
    const s = 0.7 + hash2(ci, cj, 6) * 0.8, v = hash2(ci, cj, 5), d = SO.dom, R = W.REG;
    const thr = d === R.ALPINE ? 0.9 : d === R.HILLS ? 0.95 : d === R.PLAINS ? 0.985 : d === R.DUNES ? 2 : 0.88;
    if (h > thr) o = { m: v < 0.6 ? 0 : 1, x, z, y: SO.h, s, h, v, red: d === R.CANYON || d === R.DUNES, key };
  }
  if (cellCache.size > 60000) cellCache.clear();
  cellCache.set(key, o); return o;
}
let scx = 1e9, scz = 1e9; const colliders = []; // solid rocks: x,z,r,key (r<0 = melted this scan)
const rockGone = new Set(store.get('sinerally_rocks_gone', [])); // rocks melted by a harvester head stay gone (persisted; ☰ GARAGE → REGROW restores)
function meltRock(key) { rockGone.add(key); if (rockGone.size > 4000) rockGone.delete(rockGone.values().next().value); store.set('sinerally_rocks_gone', [...rockGone]); scx = 1e9; }
function updateScenery(px, pz) {
  const cx = Math.round(px / 28), cz = Math.round(pz / 28); if (cx === scx && cz === scz) return; scx = cx; scz = cz;
  rockM.forEach(m => m.count = 0); colliders.length = 0;
  const SR = QUAL[qName].sr, r = Math.ceil(SR / SC), ox = Math.floor(px / SC), oz = Math.floor(pz / SC);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (i * i + j * j > r * r) continue; const o = cellObj(ox + i, oz + j); if (!o || rockGone.has(o.key)) continue;
    const m = rockM[o.m]; if (m.count >= m.instanceMatrix.count) continue; const s = o.s, t = 0.85 + 0.25 * o.v, big = o.red ? 1.8 : 1;
    Qt.setFromEuler(Et.set(o.h * 9, o.h * 30, o.h * 3)); Mx.compose(Vt.set(o.x, o.y - 0.4, o.z), Qt, St.set(s * big, s * big * (o.red ? 1.3 : 1), s * big));
    Cc.setRGB(o.red ? 1.35 * t : t, o.red ? 0.85 * t : t, o.red ? 0.62 * t : t * 0.97); colliders.push(o.x, o.z, 2.2 * s * big, o.key);
    const k = m.count++; m.setMatrixAt(k, Mx); m.setColorAt(k, Cc);
  }
  for (const m of rockM) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; }
}
function collideRocks(s) { // circle push-out + bounce on the physics state (after each 120 Hz step)
  const p = s.p, v = s.v, rr = (s.P.dims ? Math.max(s.P.dims[0], s.P.dims[2]) * 0.4 : 1.4), melt = melts(rig.attach);
  const fl = Math.hypot(s.fwd.x, s.fwd.z) || 1, fx = s.fwd.x / fl, fz = s.fwd.z / fl, ext = melt ? 1.2 + Math.max(0, v.x * fx + v.z * fz) * STEP : 0;
  for (let i = 0; i < colliders.length; i += 4) {
    if (colliders[i + 2] < 0) continue;
    const dx = p.x - colliders[i], dz = p.z - colliders[i + 1], r = colliders[i + 2] + rr + ext, d2 = dx * dx + dz * dz; if (d2 > r * r || d2 < 1e-6) continue;
    if (p.y - T.heightAt(colliders[i], colliders[i + 1]) > colliders[i + 2] * 1.4 + 1) continue;
    if (melt) { const d = Math.sqrt(d2); if (-(dx * fx + dz * fz) / d > 0.35) { // rock ahead of the cutter: gone at once — no push, no speed loss, no damage, no FX
      bus.emit('rock:melted', { key: colliders[i + 3], x: colliders[i], z: colliders[i + 1], r: colliders[i + 2], speed: Math.hypot(v.x, v.z) * 3.6 }); meltRock(colliders[i + 3]); colliders[i + 2] = -1; continue; }
      if (d > r - ext) continue; } // the extra cutter reach only applies to the front
    const d = Math.sqrt(d2), nx = dx / d, nz = dz / d; p.x += nx * (r - d); p.z += nz * (r - d);
    const vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= 1.4 * vn * nx; v.z -= 1.4 * vn * nz; if (vn < -5) { bus.emit('crash', { value: -vn, cause: 'rock' }); PH.addDamage(s, -vn * 0.4, 'rock'); } }
  }
}

// ---------- vehicle (physics module rig) + visuals (vehicle module models, comic materials) ----------
const rig = createRig({ THREE, world, emit: (t, d) => bus.emit(t, d) });
// handling model (physics module): ARCADE (default, NFS-Carbon/Trackmania-style) or NORMAL (the previous model); ☰ HANDLING, HUD ARC/NRM, key H
let hMode = ({ arcade: 'arcade', normal: 'normal' })[QS.get('handling') || localStorage.getItem('sinerally_handling') || store.get('srp_handling', 'arcade')] || 'arcade';
const carMat = objMat({ hatch: 0.5 }), flameMat = objMat({ unlit: true });
const carRoot = new THREE.Group(); scene.add(carRoot);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), decalMat(0x203040, true)); scene.add(shadow);
let vis = null, flameOrig = null, veh = null, vDef = null;
const assist = { stab: localStorage.getItem('sinerally_stab') ? localStorage.getItem('sinerally_stab') === '1' : isTouch, tc: localStorage.getItem('sinerally_tc') !== '0' };
const cmatCache = new Map();
function comicify(root) { // attachments ship standard three.js materials: swap them for cached comic objMats (tint = their colour)
  root.traverse(o => {
    if (!o.isMesh || !o.material || Array.isArray(o.material) || o.material.isShaderMaterial || o.material.transparent) return;
    const m = o.material; let c = cmatCache.get(m.uuid);
    if (!c) { c = objMat({ tint: m.color ? m.color.getHex() : 0xffffff, unlit: !!m.isMeshBasicMaterial, hatch: 0.6 }); cmatCache.set(m.uuid, c); }
    o.material = c;
  });
}
function loadAttach(id) { return store.get('srp_attach_' + id, getVehicle(id).defaultAttachments || []); }
function useVehicle(id, attach) {
  id = getVehicle(id).id; const a = attach || loadAttach(id);
  if (vis) { vis.group.remove(rig.root); carRoot.remove(vis.group); if (flameOrig) vis.flame.material = flameOrig; vis.dispose(); }
  rig.setVehicle(id, a); veh = rig.state; vDef = rig.vehicle; veh.assist.stab = assist.stab; veh.assist.tc = assist.tc; lastGear = veh.gear;
  vis = buildVehicle(THREE, vDef, carMat); flameOrig = vis.flame.material; vis.flame.material = flameMat;
  vis.group.add(rig.root); carRoot.add(vis.group); comicify(rig.root);
  const d = veh.P.dims || [2, 1.5, 4.4]; shadow.userData.w = d[0] * 1.5; shadow.userData.l = d[2] * 1.05;
  store.set('srp_vehicle', id); store.set('srp_attach_' + id, rig.attach); localStorage.setItem('sinerally_veh', id);
  return vDef;
}
function setVehicle(id) { if (id === vDef?.id) return; const x = veh.p.x, z = veh.p.z, yaw = PH.yawOf(veh); useVehicle(id); spawn(x, z, yaw); msg(vDef.name); }
function setAttachments(ids) { rig.setAttachments(ids); comicify(rig.root); store.set('srp_attach_' + vDef.id, rig.attach); return rig.attach; }
function spawn(x, z, yaw = 0) { for (let k = 0; k < 200 && height(x, z) < WATER + 2; k++) { x += 37; z += 23; } PH.spawn(veh, world, x, z, yaw); lastGear = veh.gear; }
const fwdSpeed = () => veh.v.x * veh.fwd.x + veh.v.y * veh.fwd.y + veh.v.z * veh.fwd.z;
{ let id = QS.get('car') || store.get('srp_vehicle', null) || localStorage.getItem('sinerally_veh') || DEFAULT_VEHICLE; if (!listVehicles().some(v => v.id === id)) id = DEFAULT_VEHICLE; useVehicle(id); rig.setMode(hMode); }
{ const t = nearTrack(0, 0), p = trackPoint(t, 0), q = trackPoint(t, 0.02); spawn(p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1])); }

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
  tilt = !tilt; $('tTilt').textContent = 'Tilt: ' + (tilt ? 'on' : 'off');
};
addEventListener('deviceorientation', e => { const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0; const v = a === 90 ? e.beta : a === -90 || a === 270 ? -e.beta : e.gamma; tiltSteer = Math.max(-1, Math.min(1, (v || 0) / 25)); });
$('tReset').onclick = () => reset(); $('tDbg').onclick = () => toggleDbg(); $('tQ').onclick = () => cycleQ();
let dbg = QS.has('dbg'); function toggleDbg() { dbg = !dbg; if (!dbg) $('dbg').textContent = ''; }
function reset() { if (editorOpen()) return; const n = [0, 0, 0]; let x = veh.p.x, z = veh.p.z, yaw = PH.yawOf(veh); for (let k = 0; k < 40; k++) { normal(x, z, n); if (n[1] > 0.9 && height(x, z) > WATER + 2) break; x += 6 * Math.sin(yaw + k); z += 6 * Math.cos(yaw + k); } spawn(x, z, yaw); }
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
  if (auto) { inp.gas = 1; inp.steer = 0.35 * Math.sin(simT * 0.5) + (auto === 'drift' && simT % 6 > 4.5 ? 0.9 : 0); inp.hand = auto === 'drift' && simT % 6 > 4.5 ? 1 : 0; inp.boost = auto === 'boost' ? 1 : 0; }
}

// ---------- race: comic gates/props merged per loop track ----------
const NCP = 8, propMat = objMat({ gate: true, hatch: 0.8 }); let propMesh = null;
let curTrack = null, race = null, cps = []; const best = JSON.parse(localStorage.getItem('sinerally_best') || '{}');
function cpPos(t, i) { const th = i / NCP * Math.PI * 2, p = trackPoint(t, th), q = trackPoint(t, th + 0.01); return { x: p[0], z: p[1], ang: Math.atan2(q[0] - p[0], q[1] - p[1]) }; }
function buildGates(t) {
  curTrack = t; cps = Array.from({ length: NCP }, (_, i) => cpPos(t, i));
  if (propMesh) { scene.remove(propMesh); propMesh.geometry.dispose(); }
  const g = trackProps(cps, T.heightAt); propMesh = new THREE.Mesh(g, propMat); scene.add(propMesh);
}
let msgT = 0; function msg(s) { $('msg').textContent = s; $('msg').classList.remove('pop'); void $('msg').offsetWidth; $('msg').classList.add('pop'); msgT = 2; }
const fmt = t => (t / 60 | 0) + ':' + (t % 60).toFixed(2).padStart(5, '0');
function raceUpdate(dt) {
  const px = veh.p.x, pz = veh.p.z, t = nearTrack(px, pz); if (t !== curTrack) { buildGates(t); race = null; }
  const nr = i => Math.hypot(px - cps[i].x, pz - cps[i].z) < 13;
  if (!race) { if (nr(0)) { race = { t: 0, next: 1 }; msg('GO!'); } }
  else { race.t += dt;
    if (race.next < NCP && nr(race.next)) { race.next++; msg('CHECKPOINT ' + (race.next - 1) + '/' + (NCP - 1)); }
    else if (race.next === NCP && nr(0)) { const b = best[t.id]; if (!b || race.t < b) { best[t.id] = race.t; localStorage.setItem('sinerally_best', JSON.stringify(best)); msg('NEW BEST ' + fmt(race.t)); } else msg('LAP ' + fmt(race.t)); race = { t: 0, next: 1 }; }
    if (Math.hypot(px - t.cx, pz - t.cz) > t.R * 2.2) { race = null; msg('RACE ABANDONED'); } }
  propMat.uniforms.uDone.value = race ? race.next - 1 : 0;
  const b = best[t.id];
  $('race').innerHTML = race ? `LAP ${fmt(race.t)} · CP ${race.next - 1}/${NCP - 1}` + (b ? `<br><small>BEST ${fmt(b)}</small>` : '') : (b ? `TRACK ${t.id} · BEST ${fmt(b)}` : 'FREE ROAM · drive through the checkered gate to race');
}
// ---------- minimap (comic: inked roads, loop, start gate) ----------
const mc = $('mini').getContext('2d'); let mapPaths = [], mapAt = [1e9, 1e9];
function minimap(yaw) {
  const Wd = 130, sc = 0.08, px = veh.p.x, pz = veh.p.z; mc.clearRect(0, 0, Wd, Wd); mc.save(); mc.beginPath(); mc.arc(Wd / 2, Wd / 2, Wd / 2, 0, 7); mc.clip(); mc.translate(Wd / 2, Wd / 2); mc.rotate(yaw + Math.PI); mc.lineCap = 'round';
  if (Math.hypot(px - mapAt[0], pz - mapAt[1]) > 150) { mapAt = [px, pz]; mapPaths = W.pathsNear(px, pz, 1100); }
  for (const pass of [0, 1]) for (const e of mapPaths) {
    const hw = e.type === W.HWY ? 7 : e.type === W.LOOP ? 5 : 3;
    mc.strokeStyle = pass === 0 ? '#111' : e.type === W.HWY ? '#5a5c66' : e.type === W.LOOP ? '#e8a860' : '#c8955a'; mc.lineWidth = pass === 0 ? hw + 3 : hw; mc.beginPath();
    const n = e.loop ? 64 : 16; for (let i = 0; i <= n; i++) { W.pathPoint(e, i / n, false); const x = (W.PP.x - px) * sc, y = (W.PP.z - pz) * sc; i ? mc.lineTo(x, y) : mc.moveTo(x, y); } mc.stroke();
  }
  const s = cps[0]; let sx = (s.x - px) * sc, sz = (s.z - pz) * sc; const d = Math.hypot(sx, sz); if (d > 55) { sx *= 55 / d; sz *= 55 / d; }
  mc.fillStyle = '#fff'; mc.strokeStyle = '#111'; mc.lineWidth = 2; mc.beginPath(); mc.arc(sx, sz, 6, 0, 7); mc.fill(); mc.stroke();
  const clampR = (x, y) => { const d = Math.hypot(x, y); return d > 58 ? [x * 58 / d, y * 58 / d] : [x, y]; };
  for (const v of vNear) { const [x, y] = clampR((v.x - px) * sc, (v.z - pz) * sc); mc.fillStyle = vFound[v.key] ? '#ffd23c' : '#fff'; mc.beginPath(); mc.moveTo(x, y - 6); mc.lineTo(x + 6, y); mc.lineTo(x, y + 6); mc.lineTo(x - 6, y); mc.closePath(); mc.fill(); mc.stroke(); }
  if (wp) { const [x, y] = clampR((wp.x - px) * sc, (wp.z - pz) * sc); mc.fillStyle = '#e8453c'; mc.beginPath(); mc.arc(x, y, 6, 0, 7); mc.fill(); mc.stroke(); }
  mc.restore();
  mc.fillStyle = '#ff6a1a'; mc.strokeStyle = '#111'; mc.lineWidth = 2; mc.beginPath(); mc.moveTo(Wd / 2, Wd / 2 - 8); mc.lineTo(Wd / 2 - 6, Wd / 2 + 6); mc.lineTo(Wd / 2 + 6, Wd / 2 + 6); mc.closePath(); mc.fill(); mc.stroke();
  mc.fillStyle = '#fff'; mc.font = 'bold 11px sans-serif'; mc.textAlign = 'center'; mc.fillText(Math.round(Math.hypot(s.x - px, s.z - pz)) + ' m', Wd / 2, Wd - 10);
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
let labT = 0, labTrees = [];
function updateLabels(dt) {
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
  if (d.cause !== 'harvest') { popText('-' + d.hp.toFixed(1) + ' HP', d.x, y + 4, d.z); burst(d.x, y, d.z, 6, [0.35, 0.62, 0.25]); shake = Math.max(shake, 0.15); } });
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
let timeMode = localStorage.getItem('sinerally_time') || 'Auto', tod = +(QS.get('tod') || 0.36); if (QS.get('tod')) timeMode = 'Fixed';
const WXP = { fog: { far: 0.34, grip: 0.96, dark: 0.85, hz: new THREE.Color(0xc9d0d6) }, dust: { far: 0.3, grip: 0.9, dark: 0.82, hz: new THREE.Color(0xd99a5c) } };
const WX_MODES = ['Auto', 'clear', 'rain', 'storm', 'fog', 'dust'];
let wxMode = QS.get('wx') || localStorage.getItem('sinerally_wx') || 'Auto'; if (!WX_MODES.includes(wxMode)) wxMode = 'Auto';
const wx = { fog: 0, dust: 0 }; if (WXP[wxMode]) wx[wxMode] = 1;
function applyTime() { if (timeMode === 'Auto') T.setTimeOfDay(tod, true); else T.setTimeOfDay(TIMES[timeMode] ?? tod, false); }
function applyWx() { T.setRain(wxMode === 'Auto' ? 'auto' : wxMode === 'rain' ? 'on' : wxMode === 'storm' ? 'storm' : 'off'); }
applyTime(); applyWx(); T.snapWeather();
const precipN = 900, prPos = new Float32Array(precipN * 6), prTail = new Float32Array(precipN * 2), prSeed = new Float32Array(precipN * 2);
for (let i = 0; i < precipN; i++) { const x = Math.random(), y = Math.random(), z = Math.random(), sd = Math.random(); prPos.set([x, y, z, x, y, z], i * 6); prTail.set([0, 1], i * 2); prSeed.set([sd, sd], i * 2); }
const prGeo = new THREE.BufferGeometry(); prGeo.setAttribute('position', new THREE.BufferAttribute(prPos, 3)); prGeo.setAttribute('tail', new THREE.BufferAttribute(prTail, 1)); prGeo.setAttribute('seed', new THREE.BufferAttribute(prSeed, 1));
const dustFx = new THREE.LineSegments(prGeo, precipMat()); dustFx.frustumCulled = false; dustFx.renderOrder = 5; scene.add(dustFx); // dust streaks only (rain = terrain)
{ const pm = dustFx.material.uniforms; pm.uCol.value.set(0xe8b878); pm.uVel.value.set(16, -1.5, 7); pm.uLen.value = 0.12; pm.uBox.value = 30; }
const tmpC = new THREE.Color(); let domT = 0, dryHere = false;
function atmosphere(dt) { // runs after T.update(): overlay fog/dust on the terrain weather's uniforms
  if ((domT -= dt) <= 0) { domT = 1; sample(veh.p.x, veh.p.z, SO); dryHere = SO.dom === W.REG.DUNES || SO.dom === W.REG.CANYON; }
  let tgt = WXP[wxMode] ? wxMode : null;
  if (wxMode === 'Auto') { const slot = Math.floor(simT / 150), h = hash2(slot, 3, 31); tgt = h < 0.55 ? null : h < 0.72 ? (dryHere ? 'dust' : null) : h < 0.86 ? 'fog' : (dryHere ? 'dust' : null); }
  let far = 1, grip = 1, dark = 1; const L = U.uLight.value, H = U.uHorizon.value, Z = U.uZenith.value;
  for (const k in wx) { wx[k] += ((k === tgt ? 1 : 0) - wx[k]) * Math.min(1, dt * 0.2); const P = WXP[k], w = wx[k];
    far *= 1 + (P.far - 1) * w; grip *= 1 + (P.grip - 1) * w; dark *= 1 + (P.dark - 1) * w;
    if (w > 0.001) { tmpC.copy(P.hz).multiply(L); H.lerp(tmpC, w * 0.85); Z.lerp(tmpC, w * 0.6); } }
  L.multiplyScalar(dark); U.uFar.value *= far; wxGrip = grip; veh.gripMul = 1;
  U.uHeadK.value = Math.max(U.uHeadK.value, (wx.fog + wx.dust) * 0.6);
  const pm = dustFx.material.uniforms; pm.uAmt.value = wx.dust * 0.9; dustFx.visible = pm.uAmt.value > 0.02; dustFx.position.copy(camera.position);
}
// ---------- FUEL-style collectibles: fuel cans scattered by hash (1 per ~90 m cell, 15%), collected set in localStorage ----------
const CAN_C = 90, cansGot = new Set(JSON.parse(localStorage.getItem('sinerally_cans') || '[]'));
const canMesh = new THREE.InstancedMesh(fuelCan(), objMat({ hatch: 0.4 }), 96); canMesh.frustumCulled = false; canMesh.count = 0; scene.add(canMesh);
let cans = [], canAt = [1e9, 1e9];
function canCell(i, j) { if (hash2(i, j, 21) > 0.15) return null; const x = (i + 0.15 + 0.7 * hash2(i, j, 22)) * CAN_C, z = (j + 0.15 + 0.7 * hash2(i, j, 23)) * CAN_C;
  sample(x, z, SO); if (SO.h < WATER + 1) return null; return { x, z, y: ground(x, z), key: i + ',' + j }; }
function updateCans(force) { const px = veh.p.x, pz = veh.p.z; if (!force && Math.hypot(px - canAt[0], pz - canAt[1]) < 40) return; canAt = [px, pz]; cans = [];
  const r = 5, ci = Math.floor(px / CAN_C), cj = Math.floor(pz / CAN_C);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) { const c = canCell(ci + i, cj + j); if (c && !cansGot.has(c.key) && cans.length < 96) cans.push(c); } }
function tickCans(t) {
  updateCans(false); const p = veh.p;
  for (let k = cans.length - 1; k >= 0; k--) { const c = cans[k]; if (Math.hypot(p.x - c.x, p.z - c.z) < 4 && Math.abs(p.y - c.y - 1) < 4.5) {
    cansGot.add(c.key); localStorage.setItem('sinerally_cans', JSON.stringify([...cansGot])); cans.splice(k, 1); veh.nitro = 1; fire('pickup', { total: cansGot.size });
    msg('FUEL +1  (' + cansGot.size + ')'); for (let q = 0; q < 16; q++) { const a = q / 16 * 6.28; puff(c.x, c.y + 1.5, c.z, Math.cos(a) * 5, 3, Math.sin(a) * 5, 1.1, 0.6, [1, 0.85, 0.2]); } } }
  canMesh.count = cans.length;
  cans.forEach((c, k) => { Qt.setFromEuler(Et.set(0, t * 2 + c.x, 0.15)); Mx.compose(Vt.set(c.x, c.y + 0.9 + 0.3 * Math.sin(t * 3 + c.z), c.z), Qt, St.set(1.8, 1.8, 1.8)); canMesh.setMatrixAt(k, Mx); });
  canMesh.instanceMatrix.needsUpdate = true; $('cans').textContent = '⛽ ' + cansGot.size;
}
// ---------- landmarks / vistas: the highest of 10 hashed samples per 1.2 km lattice cell; discovered within 70 m ----------
const VC = 1200, vCache = new Map(), vFound = JSON.parse(localStorage.getItem('sinerally_vistas') || '{}');
const SYL = ['Ka', 'Ro', 'Mi', 'Tor', 'Zan', 'Bel', 'Ur', 'Va', 'Ish', 'Kel', 'Dor', 'Ama', 'Sev', 'Lo', 'Gr', 'Nim'], SYL2 = ['dar', 'ven', 'ka', 'ris', 'mor', 'tan', 'lo', 'gar', 'wyn', 'zul', 'ock', 'ith'];
const VSUF = ['Ridge', 'Lookout', 'Dune', 'Mesa', 'Peak'];
function vistaCell(i, j) {
  const key = i + ':' + j; if (vCache.has(key)) return vCache.get(key); let b = null;
  for (let k = 0; k < 10; k++) { const x = (i + 0.15 + 0.7 * hash2(i * 13 + k, j, 41)) * VC, z = (j + 0.15 + 0.7 * hash2(i, j * 17 + k, 42)) * VC; sample(x, z, SO);
    if (SO.road < 0.05 && SO.rd > 6 && (!b || SO.h > b.y)) b = { x, z, y: SO.h, dom: SO.dom }; }
  if (b && b.y < WATER + 8) b = null;
  if (b) { b.key = key; b.name = SYL[(hash2(i, j, 43) * 16) | 0] + SYL2[(hash2(i, j, 44) * 12) | 0] + ' ' + VSUF[b.dom]; }
  vCache.set(key, b); return b;
}
const beaconMesh = new THREE.InstancedMesh(beacon(), objMat({ hatch: 0.6 }), 25); beaconMesh.frustumCulled = false; beaconMesh.count = 0; scene.add(beaconMesh);
beaconMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(75).fill(1), 3);
let vNear = [];
function tickVistas() {
  const ci = Math.floor(veh.p.x / VC), cj = Math.floor(veh.p.z / VC); vNear = [];
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const v = vistaCell(ci + i, cj + j); if (v) vNear.push(v); }
  beaconMesh.count = vNear.length;
  vNear.forEach((v, k) => { Mx.compose(Vt.set(v.x, v.y - 0.2, v.z), Qt.identity(), St.set(1, 1, 1)); beaconMesh.setMatrixAt(k, Mx); const f = vFound[v.key];
    beaconMesh.setColorAt(k, Cc.setRGB(f ? 0.55 : 1, f ? 1.1 : 1, f ? 0.6 : 1));
    if (!f && Math.hypot(veh.p.x - v.x, veh.p.z - v.z) < 70) { vFound[v.key] = { x: v.x, z: v.z, name: v.name }; localStorage.setItem('sinerally_vistas', JSON.stringify(vFound)); msg('VISTA: ' + v.name.toUpperCase()); fire('discover', { name: v.name, x: v.x, z: v.z }); } });
  beaconMesh.instanceMatrix.needsUpdate = true; beaconMesh.instanceColor.needsUpdate = true;
}
// ---------- waypoint (set on the world map) ----------
let wp = JSON.parse(localStorage.getItem('sinerally_wp') || 'null');
function setWp(p) { wp = p; localStorage.setItem('sinerally_wp', JSON.stringify(p)); }
function tickWp(yawCam) {
  const el = $('wp'); if (!wp) { el.style.display = 'none'; return; }
  const dx = wp.x - veh.p.x, dz = wp.z - veh.p.z, d = Math.hypot(dx, dz); if (d < 25) { setWp(null); msg('WAYPOINT REACHED'); return; }
  const rel = Math.atan2(dx, dz) - yawCam; el.style.display = 'block';
  $('wpA').style.transform = `rotate(${-rel}rad)`; $('wpD').textContent = d > 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m';
}
// ---------- fullscreen world map (tap the minimap / M): terrain colours + hillshade, roads, vistas, waypoint, teleport ----------
let mapSpan = 5000, mapC = [0, 0], mapRow = 0, wmPaths = null; const MG = 150;
const mapImg = document.createElement('canvas'); mapImg.width = mapImg.height = MG; const mic = mapImg.getContext('2d'), mid = mic.createImageData(MG, MG), mH = new Float32Array(MG * MG);
const mcv = $('mapc'), mx2 = mcv.getContext('2d');
function openMap(o) { mapOpen = o; $('map').style.display = o ? 'block' : 'none'; if (o) { mapC = [veh.p.x, veh.p.z]; mapRow = 0; wmPaths = W.pathsNear(mapC[0], mapC[1], mapSpan * 0.6); listVistas(); } }
function listVistas() { const l = $('mList'), vs = Object.values(vFound); l.innerHTML = vs.length ? '<b>TELEPORT</b>' : '<i>Find vistas (yellow beacons) to unlock teleports</i>';
  vs.forEach(v => { const b = document.createElement('button'); b.className = 'sb'; b.textContent = v.name; b.onclick = () => { openMap(false); window.__st.teleport(v.x + 12, v.z + 12); msg(v.name.toUpperCase()); }; l.appendChild(b); }); }
function mapProject() { const Wp = mcv.width, Hp = mcv.height, S = Math.max(Wp, Hp) / mapSpan; return { Wp, Hp, S, X: x => Wp / 2 - (x - mapC[0]) * S, Y: z => Hp / 2 - (z - mapC[1]) * S }; }
function drawMap() {
  const dpr = Math.min(2, devicePixelRatio); if (mcv.width !== Math.round(innerWidth * dpr)) { mcv.width = Math.round(innerWidth * dpr); mcv.height = Math.round(innerHeight * dpr); }
  for (let n = 0; n < 6 && mapRow < MG; n++, mapRow++) { // progressive: a few rows per frame
    const j = mapRow; for (let i = 0; i < MG; i++) { const x = mapC[0] - (i / (MG - 1) - 0.5) * mapSpan, z = mapC[1] - (j / (MG - 1) - 0.5) * mapSpan;
      sample(x, z, SO); normal(x, z, nv); const k = j * MG + i, o = k * 4; mH[k] = SO.h;
      if (SO.h < WATER) { const dd = Math.min(1, (WATER - SO.h) / 12); cv[0] = 0.3 - 0.2 * dd; cv[1] = 0.7 - 0.3 * dd; cv[2] = 0.9 - 0.1 * dd; } else colourOf(x, z, SO, nv[1], surfaceOf(x, z, SO, nv[1]), cv);
      const sh = SO.h < WATER ? 1 : Math.max(0.55, Math.min(1.25, 1 + (nv[0] * 0.6 + nv[2] * 0.6) * 1.6)); const pz = sh > 1.05 ? 1.12 : sh < 0.85 ? 0.72 : 0.92; // banded hillshade
      mid.data[o] = Math.min(255, cv[0] * pz * 255); mid.data[o + 1] = Math.min(255, cv[1] * pz * 255); mid.data[o + 2] = Math.min(255, cv[2] * pz * 255); mid.data[o + 3] = 255; } }
  mic.putImageData(mid, 0, 0);
  const P = mapProject(), c = mx2; c.fillStyle = '#f7e6b5'; c.fillRect(0, 0, P.Wp, P.Hp); c.imageSmoothingEnabled = false;
  c.drawImage(mapImg, P.X(mapC[0] + mapSpan / 2), P.Y(mapC[1] + mapSpan / 2), mapSpan * P.S, mapSpan * P.S);
  c.lineCap = 'round'; c.lineJoin = 'round';
  for (const pass of [0, 1]) for (const e of wmPaths) { const hw = (e.type === W.HWY ? 5.5 : e.type === W.LOOP ? 3.6 : 2.2) * Math.min(2, devicePixelRatio);
    c.strokeStyle = pass === 0 ? '#111' : e.type === W.HWY ? '#e8e4d8' : e.type === W.LOOP ? '#ff8a1a' : '#c8955a'; c.lineWidth = pass === 0 ? hw + 3 : hw; c.beginPath();
    const n = e.loop ? 48 : 12; for (let i = 0; i <= n; i++) { W.pathPoint(e, i / n, false); const x = P.X(W.PP.x), y = P.Y(W.PP.z); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  const ci = Math.floor(mapC[0] / VC), cj = Math.floor(mapC[1] / VC), R = Math.ceil(mapSpan / VC / 2) + 1; c.font = `900 ${12 * Math.min(2, devicePixelRatio)}px "Arial Black",system-ui`; c.textAlign = 'center';
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const v = vistaCell(ci + i, cj + j); if (!v) continue; const x = P.X(v.x), y = P.Y(v.z), f = vFound[v.key], r = 8 * Math.min(2, devicePixelRatio);
    c.fillStyle = f ? '#ffd23c' : '#fff8'; c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.fill(); c.stroke();
    c.lineWidth = 4; c.strokeText(f ? v.name : '?', x, y - r - 5); c.fillStyle = '#fff'; c.fillText(f ? v.name : '?', x, y - r - 5); }
  if (wp) { const x = P.X(wp.x), y = P.Y(wp.z), r = 10 * Math.min(2, devicePixelRatio); c.fillStyle = '#e8453c'; c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r * 0.4, 0, 7); c.fill(); }
  { const x = P.X(veh.p.x), y = P.Y(veh.p.z), yw = PH.yawOf(veh), r = 14 * Math.min(2, devicePixelRatio); c.save(); c.translate(x, y); c.rotate(-yw); c.fillStyle = '#ff6a1a'; c.strokeStyle = '#111'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -r); c.lineTo(-r * 0.7, r * 0.7); c.lineTo(0, r * 0.35); c.lineTo(r * 0.7, r * 0.7); c.closePath(); c.fill(); c.stroke(); c.restore(); }
  $('mInfo').textContent = `${(mapSpan / 1000).toFixed(1)} km · vistas ${Object.keys(vFound).length} · fuel ${cansGot.size}`;
}
mcv.addEventListener('click', e => { const P = mapProject(), dpr = mcv.width / innerWidth, x = e.clientX * dpr, y = e.clientY * dpr;
  setWp({ x: mapC[0] - (x - P.Wp / 2) / P.S, z: mapC[1] - (y - P.Hp / 2) / P.S }); });
// ---------- menu (☰): vehicle selector (3D preview), attachments, assists, time, weather, graphics, garage actions ----------
let selector = null;
function buildMenu() {
  const rows = [
    ['STABILITY ASSIST', ['On', 'Off'], () => assist.stab ? 'On' : 'Off', v => { assist.stab = veh.assist.stab = v === 'On'; localStorage.setItem('sinerally_stab', assist.stab ? '1' : '0'); }],
    ['TRACTION CONTROL', ['On', 'Off'], () => assist.tc ? 'On' : 'Off', v => { assist.tc = veh.assist.tc = v === 'On'; localStorage.setItem('sinerally_tc', assist.tc ? '1' : '0'); }],
    ['TIME OF DAY', ['Auto', 'Day', 'Sunset', 'Night'], () => timeMode, v => { timeMode = v; localStorage.setItem('sinerally_time', v); applyTime(); }],
    ['WEATHER', WX_MODES, () => wxMode, v => { wxMode = v; localStorage.setItem('sinerally_wx', v); applyWx(); }],
    ['GRAPHICS', ['Low', 'Med', 'High'], () => qName, setQual],
    ['HANDLING', ['Arcade', 'Normal'], () => hMode === 'arcade' ? 'Arcade' : 'Normal', v => setHandling(v.toLowerCase())],
    ['UI', ['Full', 'Minimal', 'None'], () => uiMode[0].toUpperCase() + uiMode.slice(1), v => setUi(v.toLowerCase())]];
  const el = $('mRows'); el.innerHTML = '';
  for (const [label, opts, get, set] of rows) { const r = document.createElement('div'); r.className = 'mrow'; r.innerHTML = `<span>${label}</span>`;
    for (const o of opts) { const b = document.createElement('button'); b.className = 'sb' + (get() === o ? ' sel' : ''); b.textContent = o.toUpperCase(); b.onclick = () => { set(o); buildMenu(); }; r.appendChild(b); } el.appendChild(r); }
  const g = document.createElement('div'); g.className = 'mrow'; g.innerHTML = '<span>GARAGE</span>';
  const act = (t, f) => { const b = document.createElement('button'); b.className = 'sb'; b.textContent = t; b.onclick = () => { f(); buildMenu(); }; g.appendChild(b); };
  act('REPAIR', () => { PH.repair(veh); msg('REPAIRED'); });
  if (veh.cargo.capacity > 0) act('UNLOAD LOGS (' + veh.cargo.logs + ')', () => rig.unload());
  act('REGROW TREES & ROCKS', () => { T.resetTrees(); hpMap.clear(); rockGone.clear(); store.set('sinerally_rocks_gone', []); scx = 1e9; msg('SCENERY REGROWN'); });
  act('PUT OUT FIRES', () => { T.extinguishAll(); });
  el.appendChild(g);
  const info = document.createElement('div'); info.className = 'mrow'; info.innerHTML = `<span>CAR</span><small style="font:bold 11px Arial">damage ${veh.damage.toFixed(0)}% · engine ${veh.heat.temp.toFixed(0)}°C${veh.cargo.capacity ? ` · logs ${veh.cargo.logs}/${veh.cargo.capacity}` : ''}</small>`; el.appendChild(info);
}
function vehRow() { // VEHICLE: the physics module's selector (second small WebGL canvas, closed with the menu) + ATTACHMENTS picker
  const mv = $('mVeh'); mv.style.display = 'block'; if (selector) selector.close();
  mv.innerHTML = ''; const h = document.createElement('div'); h.className = 'mrow'; h.innerHTML = '<span>VEHICLE</span>'; mv.appendChild(h); const box = document.createElement('div'); mv.appendChild(box);
  const small = innerHeight < 500; selector = openSelector({ THREE, container: box, current: vDef.id, size: small ? [200, 113] : [240, 136], onPick: id => { setVehicle(id); attRow(); buildMenu(); } });
  attRow();
}
function attRow() { const ma = $('mAtt'); ma.innerHTML = '<div class="mrow"><span>ATTACHMENTS · ' + vDef.name + '</span></div>'; const c = document.createElement('div'); ma.appendChild(c);
  renderPicker({ container: c, vehicle: vDef, selected: rig.attach, onChange: ids => { setAttachments(ids); buildMenu(); } }); }
let menuOpen = false;
function openMenu(o) { menuOpen = o; $('menu').style.display = o ? 'block' : 'none';
  if (o) { buildMenu(); vehRow(); audio.buildMenu($('mSnd')); } else { if (selector) { selector.close(); selector = null; } $('mVeh').style.display = 'none'; sndBtn(); } }
$('tMenu').onclick = () => openMenu(!menuOpen); $('mEditUi').onclick = () => { openMenu(false); uied.openEd(); }; // ☰ → EDIT UI (header button) $('mnClose').onclick = () => openMenu(false);
$('mini').addEventListener('click', () => openMap(true)); $('mClose').onclick = () => openMap(false); $('mClr').onclick = () => setWp(null);
$('mZin').onclick = () => { mapSpan = Math.max(1500, mapSpan / 2); openMap(true); }; $('mZout').onclick = () => { mapSpan = Math.min(20000, mapSpan * 2); openMap(true); };
addEventListener('keydown', e => { if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.code === 'KeyM' || e.code === 'Tab') { openMap(!mapOpen); e.preventDefault(); } if (e.code === 'Escape') { openMap(false); openMenu(false); editor.close(); if (uied) uied.close(); }
  if (uied && uied.open) { if (e.code === 'KeyU') uied.close(); return; } // layout editor open: game keys paused
  if (e.code === 'KeyV') { const l = listVehicles(), i = l.findIndex(v => v.id === vDef.id); setVehicle(l[(i + 1) % l.length].id); } if (e.code === 'KeyU') { if (e.shiftKey) rig.unload(); else uied.openEd(); } /* U = EDIT UI (unload moved to Shift+U) */ if (e.code === 'KeyH') setHandling(hMode === 'arcade' ? 'normal' : 'arcade'); if (e.code === 'KeyI') cycleUi(); });
// ---------- HUD toggles: handling ARC/NRM, UI hide (FULL → MINIMAL → NONE), unload (only with logs) ----------
function setHandling(m) { hMode = m === 'normal' ? 'normal' : 'arcade'; rig.setMode(hMode); localStorage.setItem('sinerally_handling', hMode); store.set('srp_handling', hMode);
  $('tHand').textContent = hMode === 'arcade' ? 'ARC' : 'NRM'; $('tHand').classList.toggle('nrm', hMode === 'normal'); steerSm = 0; return hMode; }
let uied = null; // layout editor (created below, after the sound editor)
const UI_MODES = ['full', 'minimal', 'none']; let uiMode = UI_MODES.includes(localStorage.getItem('sinerally_ui')) ? localStorage.getItem('sinerally_ui') : 'full', unlShown = null;
function setUi(m) { uiMode = UI_MODES.includes(m) ? m : 'full'; localStorage.setItem('sinerally_ui', uiMode); document.body.classList.toggle('ui-min', uiMode === 'minimal'); document.body.classList.toggle('ui-none', uiMode === 'none');
  $('tUi').textContent = uiMode === 'full' ? '◉' : uiMode === 'minimal' ? '◐' : '○'; $('tUi').title = 'UI: ' + uiMode.toUpperCase() + ' (I)'; if (uied) uied.applyAll(); return uiMode; }
function cycleUi() { return setUi(UI_MODES[(UI_MODES.indexOf(uiMode) + 1) % 3]); }
$('tUi').onclick = () => { cycleUi(); msg('UI ' + uiMode.toUpperCase()); }; $('tHand').onclick = () => { setHandling(hMode === 'arcade' ? 'normal' : 'arcade'); msg(hMode.toUpperCase() + ' HANDLING'); };
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
const audio = createEngineAudio({ sr: window.SR });
// optional engine sound editor (☰ → ENGINE SOUND → EDIT): only shown when the active plugin has setConfig/getConfig
const editor = createSoundEditor({ audio, onOpenChange: o => { if (o) openMenu(false); } });
const editorOpen = () => editor.open;
uied = createUiEditor({ onOpenChange: o => { if (o) { openMenu(false); openMap(false); editor.close(); } else last = performance.now(); }, onUiRestore: () => setUi(uiMode) });
const sndBtn = () => { $('tSnd').textContent = audio.muted ? '🔇' : '🔊'; };
$('tSnd').onclick = () => { if (!audio.running) { audio.unlock(); audio.setMuted(false); } else audio.setMuted(!audio.muted); sndBtn(); }; sndBtn(); // first tap = enable sound

// ---------- loop ----------
const camPos = new THREE.Vector3(veh.p.x, veh.p.y + 6, veh.p.z - 12), look = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, 1);
const tv = new THREE.Vector3(), RV = new THREE.Vector3(), camTrees = []; let camBack = 8, camLow = 0;
let last = performance.now(), acc = 0, fpsT = 0, frames = 0, fps = 0, shake = 0, tFrame = 0;
const STEP = 1 / 120, stats = { fps: 0, physMs: 0, frameMs: 0, minFps: 999 };
const focus = { x: 0, y: 0, z: 0 };
function updateWorld(force) { updateScenery(veh.p.x, veh.p.z); if (force) scx = 1e9, updateScenery(veh.p.x, veh.p.z); }
applyQuality(); updateWorld(true);
function frame(now) {
  requestAnimationFrame(frame); const t0 = performance.now(); let dt = Math.min(0.1, (now - last) / 1000); last = now; tFrame += dt; renderer.info.reset();
  dynRes(dt);
  if (mapOpen) { drawMap(); audio.frame(dt, true); last = now; return; } // world map pauses the game
  if (uied.open) { audio.frame(dt, true); last = now; return; } // UI layout editor pauses the game (last frame stays on screen)
  readInput(dt);
  if (editor.open) { inp.gas = inp.brake = inp.boost = 0; inp.steer = 0; inp.hand = 1; } // sound editor open: car input paused (audio keeps running)
  acc += dt; let steps = 0; const tp = performance.now();
  while (acc >= STEP && steps < 12) { simT += STEP; rig.step(inp, STEP); collideRocks(veh); acc -= STEP; steps++; }
  if (steps === 12) acc = 0;
  stats.physMs = performance.now() - tp;
  tickCans(tFrame); tickVistas(); updateWorld(false); raceUpdate(dt);
  U.uHeadP.value.set(veh.p.x, veh.p.y, veh.p.z).addScaledVector(veh.fwd, 2).addScaledVector(veh.up, 0.8); U.uHeadD.value.set(veh.fwd.x, veh.fwd.y, veh.fwd.z).addScaledVector(veh.up, -0.12).normalize();
  // car visuals: vehicle model on the rigid-body frame, wheels from the raycast suspension, attachments on rig.root (child of the model group)
  vis.group.position.set(veh.p.x, veh.p.y, veh.p.z); vis.group.quaternion.set(veh.q.x, veh.q.y, veh.q.z, veh.q.w);
  const sp = Math.hypot(veh.v.x, veh.v.y, veh.v.z), boosting = veh.boosting, wr = veh.P.wheelR;
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
  { const gy = T.heightAt(veh.p.x, veh.p.z); shadow.position.set(veh.p.x, gy + 0.1, veh.p.z); shadow.rotation.y = PH.yawOf(veh); const sh = Math.max(0.3, 1 - (veh.p.y - 1.1 - gy) * 0.08); shadow.scale.set(sh * shadow.userData.w, 1, sh * shadow.userData.l); shadow.visible = veh.up.y > 0.3; }
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
  const ch = 2.2 + dims[1] * 0.67, tgt = tv.set(cx, Math.max(veh.p.y + ch + (1.1 - ch) * camLow, T.heightAt(cx, cz) + 2 - 0.6 * camLow), cz);
  camPos.lerp(tgt, Math.min(1, 6 * dt)); camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake * 0.8; camera.position.y += (Math.random() - .5) * shake * 0.8; shake = Math.max(0, shake - dt * 2.5); }
  look.set(veh.p.x, veh.p.y + 1.3, veh.p.z); camera.lookAt(look);
  camera.fov += ((boosting ? 80 : 64 + Math.min(12, sp * 0.15)) - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  camera.updateMatrixWorld();
  focus.x = veh.p.x; focus.y = veh.p.y; focus.z = veh.p.z;
  T.update(dt, { camera, focus, viewHeight: rt.height }); atmosphere(dt); // terrain weather/sky/fire/trees, then the game's fog/dust overlay
  post.uniforms.uBoost.value += ((boosting ? 1 : 0) - post.uniforms.uBoost.value) * Math.min(1, 6 * dt);
  $('spd').textContent = Math.abs(Math.round(fwdSpeed() * 3.6)); $('bar').style.width = (veh.nitro * 100) + '%';
  $('air').textContent = veh.air > 0.5 ? 'AIR ' + veh.air.toFixed(1) + 's!' : '';
  $('carinfo').textContent = (veh.damage >= 1 ? 'DMG ' + veh.damage.toFixed(0) + '%  ' : '') + (veh.cargo.capacity ? 'LOGS ' + veh.cargo.logs + '/' + veh.cargo.capacity : '');
  { const show = veh.cargo.capacity > 0 && veh.cargo.logs > 0; if (show !== unlShown) { unlShown = show; $('bUnl').style.display = show ? 'block' : 'none'; } if (show) $('bUnl').textContent = 'UNLOAD ' + veh.cargo.logs; }
  if (msgT > 0 && (msgT -= dt) <= 0) $('msg').textContent = '';
  updateTelemetry(); minimap(Math.atan2(camDir.x, camDir.z)); gauge(); tickWp(Math.atan2(camDir.x, camDir.z)); updateLabels(dt); audio.frame(dt);
  if (!QS.has('nopost')) { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(postScene, postCam); }
  else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  stats.frameMs = performance.now() - t0;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = stats.fps = frames / fpsT; window.__fps = fps; if (tFrame > 3) stats.minFps = Math.min(stats.minFps, fps); frames = 0; fpsT = 0;
    if (dbg) { sample(veh.p.x, veh.p.z, SO); const ts = T.stats ? T.stats() : {}; $('dbg').textContent = `${fps.toFixed(0)} fps  GFX ${qName}  cpu ${stats.frameMs.toFixed(1)}ms (phys ${stats.physMs.toFixed(1)})\ncalls ${renderer.info.render.calls} tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k\n${veh.p.x.toFixed(0)},${veh.p.z.toFixed(0)} y${veh.p.y.toFixed(0)} ${W.REG_NAMES[SO.dom]} · ${TS.biomeName || ''}\n${vDef.id} gear ${veh.gear} rpm ${veh.rpm.toFixed(0)} ${veh.heat.temp.toFixed(0)}°C wheels ${veh.grounded}${ts.fire && ts.fire.burning ? ' fire ' + ts.fire.burning : ''}`; } }
}
requestAnimationFrame(frame);
window.__st = { get veh() { return veh; }, get state() { return veh; }, rig, T, PH, bus, world, hpMap, evLog, stats, inp, W, audio, editor, TEL, scene,
  get q() { return qName; }, setQ(q) { qName = q; applyQuality(); }, get x() { return veh.p.x; }, get z() { return veh.p.z; }, get y() { return veh.p.y; },
  teleport(x, z, yaw = 0) { spawn(x, z, yaw); updateWorld(true); updateCans(true); }, toBiome(name, yaw = 0) { const p = T.findBiome(name, veh.p.x, veh.p.z); if (p) this.teleport(p.x, p.z, yaw); return p; },
  setVehicle, useVehicle, setAttachments, get vName() { return vDef.id; }, openMap, openMenu, setWp, get wx() { return wx; }, setWx(m, snap = true) { wxMode = m; applyWx(); if (snap) T.snapWeather(); }, set tod(v) { tod = v; timeMode = 'Fixed'; applyTime(); },
  get dynS() { return dynS; }, get labels() { return labTrees; }, get handling() { return hMode; }, setHandling, get ui() { return uiMode; }, setUi, cycleUi, get uied() { return uied; }, rockGone, get rocks() { return colliders; }, collideRocks };
