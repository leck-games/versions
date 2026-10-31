// SineRally — merged release: ENGINE (rigid-body 4x4 vehicle.js, multi-region world.js, road graph roads.js,
// GPU grass grass.js, near/far ring-buffer terrain, gauges) + GRAPHICS (comic/Borderlands-style shading from shaders.js:
// ink outlines, cel bands, hatching, posterize/halftone/grain, code-built buggy, puffs, skids, comic sky & HUD).
import * as THREE from 'three';
import * as W from './world.js';
import { Vehicle, CFG, VEHICLES } from './vehicle.js';
import { createEngineAudio } from './engine-audio.js'; // engine sound plugin host (PLUGIN_API.md); talks to plugins only via the API
import { createRoads } from './roads.js';
import { createGrass } from './grass.js';
import { U, gridTerrainMat, waterMat, objMat, skyMat, puffMat, decalMat, postMat, roadMat, precipMat } from './shaders.js';
import { treeVariants, rockVariants, cactusVariants, buggy, truck, quad as quadModel, fuelCan, beacon, trackProps } from './models.js';
const { WATER, nearTrack, trackPoint, hash2, sample, surfaceOf, colourOf, grassDensity, normal, height, ground, SURF } = W;
const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
// ---------- renderer + quality (GFX toggle). The comic post pass (ink edges, palette) now runs on EVERY level, Low included;
// Low only drops resolution, halftone/grain and draw distance. Phones default to Med; dynamic resolution holds 30 fps. ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight); document.body.prepend(renderer.domElement);
const QUAL = { Low: { pr: 1, post: true, fx: 1, sr: 200, hatch: 1.15, grass: 7000 }, Med: { pr: 1.5, post: true, fx: 1, sr: 250, hatch: 1.1, grass: 11000 }, High: { pr: 2, post: true, fx: 1, sr: 300, hatch: 1, grass: 16000 } };
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
const hulls = [];
function applyQuality() {
  const q = QUAL[qName], pr = Math.min(devicePixelRatio, q.pr) * dynS;
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); U.uPx.value = pr; U.uHatch.value = q.hatch; post.uniforms.uFx.value = q.fx;
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr); rt.setSize(w, h); post.uniforms.uRes.value.set(w, h); post.uniforms.uThick.value = Math.max(1.6, pr * 1.4);
  hulls.forEach(m => m.visible = !q.post); if (q.sr !== lastSr) { scx = 1e9; lastSr = q.sr; } $('tQ').textContent = 'GFX: ' + qName; window.__pr = pr;
  if (grass) grass.mesh.geometry.instanceCount = q.grass;
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
// ---------- sky ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMat()); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);

// ---------- terrain: ring-buffer grids (near 4 m with grass texture, far 16 m); only new rows/cols are sampled ----------
const SO = { h: 0, hn: 0, deck: 0, road: 0, rtype: 0, dom: 0, riv: 0, rd: 0 }, nv = [0, 0, 0], cv = [0, 0, 0];
const SWT = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; // per surface: sand, rock, snow, dirt weights
class Grid {
  constructor(N, step, mat, withTex) {
    const n = this.n = N + 1; this.N = N; this.step = step;
    this.H = new Float32Array(n * n); this.NRM = new Float32Array(n * n * 3); this.COL = new Float32Array(n * n * 3); this.SW = new Float32Array(n * n * 4);
    this.gi0 = this.gj0 = null;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * n * 3); this.nor = new Float32Array(n * n * 3); this.col = new Float32Array(n * n * 3); this.sw = new Float32Array(n * n * 4);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3)); g.setAttribute('sw', new THREE.BufferAttribute(this.sw, 4));
    const idx = new (n * n > 65535 ? Uint32Array : Uint16Array)(N * N * 6); let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { // same split as PlaneGeometry (grass shader relies on it)
      const a = j * n + i, b = (j + 1) * n + i, c = (j + 1) * n + i + 1, d = j * n + i + 1;
      idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    if (withTex) { this.tdata = new Float32Array(n * n * 4); this.tex = new THREE.DataTexture(this.tdata, n, n, THREE.RGBAFormat, THREE.FloatType); this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter; this.tex.needsUpdate = true; }
  }
  ri(g) { const n = this.n; return ((g % n) + n) % n; }
  compute(gi, gj) {
    const s = this.step, x = gi * s, z = gj * s, k = this.ri(gj) * this.n + this.ri(gi);
    sample(x, z, SO); normal(x, z, nv); const surf = surfaceOf(x, z, SO, nv[1]); colourOf(x, z, SO, nv[1], surf, cv);
    const j = 0.94 + 0.12 * hash2(gi, gj, 3); // per-vertex tint jitter
    this.H[k] = SO.h; this.NRM.set(nv, k * 3); this.COL[k * 3] = cv[0] * j; this.COL[k * 3 + 1] = cv[1] * j; this.COL[k * 3 + 2] = cv[2] * j;
    this.SW.set(SWT[surf], k * 4);
    if (this.tdata) {
      const d = grassDensity(x, z, SO, nv[1], surf), o = k * 4;
      this.tdata[o] = SO.h; this.tdata[o + 1] = d;
      this.tdata[o + 2] = Math.min(255, cv[0] * 0.9 * 255 | 0) * 256 + Math.min(255, cv[1] * 1.08 * 255 | 0); this.tdata[o + 3] = Math.min(255, cv[2] * 0.85 * 255 | 0);
    }
  }
  update(px, pz, force) {
    const N = this.N, n = this.n, s = this.step, gi0 = Math.round(px / s) - N / 2, gj0 = Math.round(pz / s) - N / 2;
    if (!force && gi0 === this.gi0 && gj0 === this.gj0) return false;
    const o0 = this.gi0, p0 = this.gj0, fresh = o0 === null || force;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const gi = gi0 + i, gj = gj0 + j;
      if (fresh || gi < o0 || gi > o0 + N || gj < p0 || gj > p0 + N) this.compute(gi, gj);
    }
    this.gi0 = gi0; this.gj0 = gj0;
    let v = 0;
    for (let j = 0; j < n; j++) { const rj = this.ri(gj0 + j) * n; for (let i = 0; i < n; i++, v++) {
      const k = rj + this.ri(gi0 + i), v3 = v * 3, k3 = k * 3;
      this.pos[v3] = (gi0 + i) * s; this.pos[v3 + 1] = this.H[k]; this.pos[v3 + 2] = (gj0 + j) * s;
      this.nor[v3] = this.NRM[k3]; this.nor[v3 + 1] = this.NRM[k3 + 1]; this.nor[v3 + 2] = this.NRM[k3 + 2];
      this.col[v3] = this.COL[k3]; this.col[v3 + 1] = this.COL[k3 + 1]; this.col[v3 + 2] = this.COL[k3 + 2];
      const v4 = v * 4, k4 = k * 4; this.sw[v4] = this.SW[k4]; this.sw[v4 + 1] = this.SW[k4 + 1]; this.sw[v4 + 2] = this.SW[k4 + 2]; this.sw[v4 + 3] = this.SW[k4 + 3];
    } }
    const a = this.geo.attributes; a.position.needsUpdate = a.normal.needsUpdate = a.color.needsUpdate = a.sw.needsUpdate = true;
    if (this.tex) this.tex.needsUpdate = true;
    return true;
  }
}
const NEAR_N = SMALL ? 112 : 128, NEAR_S = 4, FAR_N = SMALL ? 80 : 96, FAR_S = 16;
const uNear = { value: new THREE.Vector3() };
const far = new Grid(FAR_N, FAR_S, gridTerrainMat({ far: true, uNear }), false), near = new Grid(NEAR_N, NEAR_S, gridTerrainMat(), true);
U.uFar.value = FAR_N * FAR_S / 2 + 40; // atmospheric fade reaches the horizon colour at the far-grid edge
// water: comic shore foam/depth bands, drawn on the terrain grids (depth = -terrain height)
const waterN = new THREE.Mesh(near.geo, waterMat()); waterN.frustumCulled = false; scene.add(waterN);
const waterF = new THREE.Mesh(far.geo, waterMat({ far: true, uNear })); waterF.frustumCulled = false; scene.add(waterF);
// roads: comic-lit textured ribbons; asphalt drawn after/above dirt so trails never paint over highways
const roads = createRoads(scene, (kind, tex) => {
  if (tex) { tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true; }
  return kind === 'asphalt' ? roadMat(tex, { offset: -4 }) : kind === 'dirt' ? roadMat(tex, { offset: -2 }) : roadMat(null, { col: 0xb4aca0 });
});
let grass = null; grass = createGrass(scene, near, { count: 16000, tile: 72 });

// ---------- scenery: engine region rules (hash per 14 m cell, cached) -> graphics models (instanced, hull outlines) ----------
const SC = 14, cellCache = new Map();
function inst(geo, mat, max, hullW) {
  const m = new THREE.InstancedMesh(geo, mat, max); m.frustumCulled = false; m.count = 0; scene.add(m);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
  if (hullW) { const h = new THREE.InstancedMesh(geo, objMat({ hull: hullW, wind: mat.uniforms.uWind.value }), max); h.instanceMatrix = m.instanceMatrix; h.frustumCulled = false; h.count = 0; scene.add(h); hulls.push(h); m.userData.hull = h; }
  return m;
}
const treeM = treeVariants().map((g, i) => inst(g, objMat({ wind: 0.035 }), i === 0 ? 1500 : 900, 0.12)); // pine, round, poplar, bush
const rockM = rockVariants().map(g => inst(g, objMat({ hatch: 1.2 }), 500, 0.12));
const cactM = cactusVariants().map(g => inst(g, objMat({ wind: 0.01 }), 400, 0.08)); // saguaro, shrub
const allM = [...treeM, ...rockM, ...cactM];
const Mx = new THREE.Matrix4(), Qt = new THREE.Quaternion(), Vt = new THREE.Vector3(), St = new THREE.Vector3(), Et = new THREE.Euler(), Cc = new THREE.Color();
const forest = (x, z) => 0.5 + 0.5 * Math.sin(x * 0.0021 + Math.cos(z * 0.0017) * 2) * Math.cos(z * 0.0025 + Math.sin(x * 0.0013));
function cellObj(ci, cj) {
  const key = ci * 1e5 + cj; let o = cellCache.get(key); if (o !== undefined) return o;
  o = null;
  const h = hash2(ci, cj, 9), x = (ci + hash2(ci, cj, 7)) * SC, z = (cj + hash2(ci, cj, 8)) * SC;
  sample(x, z, SO);
  if (SO.h > WATER + 1.2 && SO.road < 0.05 && SO.rd > 2.5) {
    normal(x, z, nv); const ny = nv[1], f = forest(x, z), s = 0.7 + hash2(ci, cj, 6) * 0.8, v = hash2(ci, cj, 5), d = SO.dom, R = W.REG;
    let m = null, col = 1;
    if (d === R.ALPINE) { if (SO.h < W.snowLine(x, z) - 8 && ny > 0.8 && h < 0.15 + 0.5 * f) m = v < 0.85 ? 0 : 2; else if (h > 0.9) m = 4 + (v < 0.7 ? 0 : 1); }
    else if (d === R.HILLS) { if (ny > 0.82 && h < 0.08 + 0.45 * f * f) m = h < 0.22 * f ? (v < 0.6 ? 1 : 2) : 0; else if (h > 0.95) m = 4 + (v < 0.6 ? 0 : 1); else if (h > 0.93 && ny > 0.85) m = 3; }
    else if (d === R.PLAINS) { if (ny > 0.9 && h < 0.04 + 0.2 * f * f * f) m = v < 0.5 ? 1 : v < 0.75 ? 2 : 3; else if (h > 0.985) m = 4 + (v < 0.5 ? 0 : 1); else if (h > 0.965) m = 3; }
    else if (d === R.DUNES) { if (h > 0.975 && ny > 0.8) m = v < 0.6 ? 6 : 7; else if (h < 0.015) m = 5; }
    else { if (h > 0.88) m = 4 + (v < 0.5 ? 0 : 1); else if (h < 0.04 && ny > 0.85) m = v < 0.5 ? 6 : 7; }
    if (m !== null) o = { m, x, z, y: SO.h, s, h, v, red: d === R.CANYON || d === R.DUNES, key };
  }
  if (cellCache.size > 60000) cellCache.clear();
  cellCache.set(key, o); return o;
}
let scx = 1e9, scz = 1e9; const colliders = []; // solid rocks: x,z,r
// breakable scenery (trees, bushes, cacti): x,z,r,key,model. Hit = instantly gone (hash id in a Set, for the session), small speed loss.
let brk = []; const gone = new Set(), smashes = [];
function updateScenery(px, pz) {
  const cx = Math.round(px / 28), cz = Math.round(pz / 28); if (cx === scx && cz === scz) return; scx = cx; scz = cz;
  allM.forEach(m => m.count = 0); colliders.length = 0; brk = [];
  const SR = QUAL[qName].sr, r = Math.ceil(SR / SC), ox = Math.floor(px / SC), oz = Math.floor(pz / SC);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (i * i + j * j > r * r) continue; const o = cellObj(ox + i, oz + j); if (!o || gone.has(o.key)) continue;
    const m = allM[o.m]; if (m.count >= m.instanceMatrix.count) continue; const s = o.s, t = 0.85 + 0.25 * o.v;
    if (o.m === 4 || o.m === 5) { // rocks: canyon/dune rocks are big and red
      const big = o.red ? 1.8 : 1; Qt.setFromEuler(Et.set(o.h * 9, o.h * 30, o.h * 3)); Mx.compose(Vt.set(o.x, o.y - 0.4, o.z), Qt, St.set(s * big, s * big * (o.red ? 1.3 : 1), s * big));
      Cc.setRGB(o.red ? 1.35 * t : t, o.red ? 0.85 * t : t, o.red ? 0.62 * t : t * 0.97); colliders.push(o.x, o.z, 2.2 * s * big);
    } else {
      Qt.setFromEuler(Et.set(0, o.h * 40, 0)); Mx.compose(Vt.set(o.x, o.y - 0.3, o.z), Qt, St.set(s, s * (0.85 + o.h * 0.6), s));
      Cc.setRGB(t, t * (0.95 + 0.1 * Math.sin(o.h * 70)), t * 0.95); brk.push(o.x, o.z, o.m === 6 ? 0.6 : o.m === 7 || o.m === 3 ? 0.5 : 0.8 * s, o.key, o.m);
    }
    const k = m.count++; m.setMatrixAt(k, Mx); m.setColorAt(k, Cc);
  }
  for (const m of allM) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; if (m.userData.hull) m.userData.hull.count = m.count; }
}
function checkBreak() { // called per physics step
  const p = veh.p, v = veh.v;
  for (let i = 0; i < brk.length; i += 5) {
    const dx = p.x - brk[i], dz = p.z - brk[i + 1], r = brk[i + 2] + 1.3; if (dx * dx + dz * dz > r * r) continue;
    if (p.y - ground(brk[i], brk[i + 1]) > 7) continue;
    const m = brk[i + 4], k = m <= 2 ? 0.92 : m === 6 ? 0.95 : 0.98; v.x *= k; v.z *= k; // trees cost ~8% speed, bushes almost nothing
    gone.add(brk[i + 3]); smashes.push([brk[i], brk[i + 1], m]); brk.splice(i, 5); i -= 5; scx = 1e9;
  }
}

// ---------- vehicle (engine physics) + buggy visuals (graphics models) ----------
let vName = localStorage.getItem('sinerally_veh'); if (!VEHICLES[vName]) vName = 'buggy';
const veh = new Vehicle(VEHICLES[vName]);
veh.assist.stab = localStorage.getItem('sinerally_stab') ? localStorage.getItem('sinerally_stab') === '1' : isTouch; // stability assist: default on for phones
veh.assist.tc = localStorage.getItem('sinerally_tc') !== '0';
// per-vehicle visual fit: model scale, model wheel-centre height (model units), flame position; physics wheel centres come from cfg
const VIS = { buggy: { mk: buggy, s: [0.85, 0.9, 0.97], wc: 0.68, z: 0.02, flame: [0, 1.2, -2.5] }, truck: { mk: truck, s: [1, 1, 1], wc: 0.64, z: 0.02, flame: [0, 1.0, -2.6] },
  quad: { mk: quadModel, s: [1, 1, 1], wc: 0.49, z: 0.03, flame: [0, 0.85, -1.75] } };
const carMat = objMat({ hatch: 0.5 }), flameMat = objMat({ unlit: true });
const car = new THREE.Group(); scene.add(car);
const body = new THREE.Group(); car.add(body);
const wheelMeshes = [0, 1, 2, 3].map(() => { const g = new THREE.Group(); scene.add(g); return g; });
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), decalMat(0x203040, true)); scene.add(shadow);
let VIS_UP = 0, flame = null;
function buildCar() {
  const c = veh.c, V = VIS[vName], B = V.B || (V.B = V.mk()), VIS_R = c.wheelR * 1.22; VIS_UP = VIS_R - c.wheelR;
  const ywc = c.hard[0][1] - (c.rest - c.mass * c.g / 4 / c.k); // static wheel-centre height in the body frame
  body.clear(); body.scale.set(...V.s); body.position.set(0, ywc + VIS_UP - V.wc * V.s[1], V.z);
  body.add(new THREE.Mesh(B.body, carMat)); flame = new THREE.Mesh(B.flame, flameMat); flame.position.set(...V.flame); body.add(flame);
  wheelMeshes.forEach(g => { g.clear(); const w = new THREE.Mesh(B.wheel, carMat); w.scale.setScalar(VIS_R / 0.68); g.add(w); });
  shadow.userData.w = c.dims[0] * 1.5; shadow.userData.l = c.dims[2] * 1.05;
}
buildCar();
function setVehicle(n) { if (!VEHICLES[n]) return; vName = n; localStorage.setItem('sinerally_veh', n); const x = veh.p.x, z = veh.p.z, yaw = veh.yaw; veh.setCfg(VEHICLES[n]); buildCar(); spawn(x, z, yaw); msg(VEHICLES[n].name); }
function spawn(x, z, yaw = 0) { for (let k = 0; k < 200 && height(x, z) < WATER + 2; k++) { x += 37; z += 23; } veh.spawn(x, z, yaw); }
{ const t = nearTrack(0, 0), p = trackPoint(t, 0), q = trackPoint(t, 0.02); spawn(p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1])); }

// ---------- dust puffs (comic, 1 draw call) ----------
const PN = 220, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pSize = new Float32Array(PN), pVel = new Float32Array(PN * 3), pAge = new Float32Array(PN).fill(9), pLife = new Float32Array(PN).fill(1), pS0 = new Float32Array(PN);
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
const puffs = new THREE.Points(pGeo, puffMat()); puffs.frustumCulled = false; scene.add(puffs); let pNext = 0;
const PUFFC = [[.82, .82, .84], [.95, .78, .55], [.86, .9, .7], [.98, .9, .62], [.82, .76, .74], [.97, .98, 1], [.62, .5, .38]]; // per surface
function emit(x, y, z, vx, vy, vz, size, life, col) { const i = pNext; pNext = (pNext + 1) % PN; pPos.set([x, y, z], i * 3); pVel.set([vx, vy, vz], i * 3); pCol.set(col, i * 3); pAge[i] = 0; pLife[i] = life; pS0[i] = size; }
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
const key = {}; addEventListener('keydown', e => { key[e.code] = 1; if (e.code === 'KeyR') reset(); if (e.code === 'KeyF') toggleDbg(); if (e.code === 'KeyG') cycleQ(); });
addEventListener('keyup', e => key[e.code] = 0);
const touch = { steer: 0, pitch: 0, gas: 0, brk: 0, bst: 0, drf: 0 }; let tilt = false, tiltSteer = 0;
if (isTouch) { $('joy').style.display = 'block'; ['bGas', 'bBrk', 'bBst', 'bDrf'].forEach(b => $(b).style.display = 'flex'); }
const joy = $('joy'), knob = $('knob'); let joyId = null;
joy.addEventListener('touchstart', e => { joyId = e.changedTouches[0].identifier; joyMove(e); e.preventDefault(); }, { passive: false });
joy.addEventListener('touchmove', e => { joyMove(e); e.preventDefault(); }, { passive: false });
const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; touch.steer = touch.pitch = 0; knob.style.transform = ''; } };
joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);
function joyMove(e) { for (const t of e.changedTouches) if (t.identifier === joyId) { const r = joy.getBoundingClientRect(); const cl = v => Math.max(-1, Math.min(1, v));
  const dx = cl((t.clientX - r.left - r.width / 2) / 55), dy = cl((t.clientY - r.top - r.height / 2) / 55); touch.steer = dx; touch.pitch = -dy; knob.style.transform = `translate(${dx * 45}px,${dy * 45}px)`; } }
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
function reset() { const n = [0, 0, 0]; let x = veh.p.x, z = veh.p.z, yaw = veh.yaw; for (let k = 0; k < 40; k++) { normal(x, z, n); if (n[1] > 0.9 && height(x, z) > WATER + 2) break; x += 6 * Math.sin(yaw + k); z += 6 * Math.cos(yaw + k); } spawn(x, z, yaw); }
const inp = { gas: 0, brake: 0, steer: 0, hand: 0, boost: 0, pitch: 0 };
const auto = QS.get('auto'); // test driver: ?auto=1|drift|boost drives itself (headless tests / screenshots)
let simT = 0, steerSm = 0;
function readInput(dt) {
  let s = (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0) - touch.steer - (tilt ? tiltSteer : 0);
  // touch/tilt: response curve (fine control around centre) + extra speed sensitivity; everything is smoothed
  let kb = (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0), tc = -touch.steer - (tilt ? tiltSteer : 0);
  tc = Math.sign(tc) * Math.pow(Math.min(1, Math.abs(tc)), 1.5) / (1 + Math.abs(veh.v.dot(veh.fwd)) * 0.012);
  const tgt = Math.max(-1, Math.min(1, kb + tc));
  if (kb) steerSm += Math.max(-5 * dt, Math.min(5 * dt, tgt - steerSm)); else steerSm += (tgt - steerSm) * Math.min(1, 12 * dt);
  inp.steer = Math.abs(steerSm) < 1e-3 ? 0 : steerSm; void s;
  inp.gas = key.KeyW || key.ArrowUp || touch.gas ? 1 : 0; inp.brake = key.KeyS || key.ArrowDown || touch.brk ? 1 : 0;
  inp.hand = key.Space || touch.drf ? 1 : 0; inp.boost = key.ShiftLeft || key.ShiftRight || touch.bst ? 1 : 0;
  inp.pitch = Math.max(-1, Math.min(1, (key.KeyE ? 1 : 0) - (key.KeyQ ? 1 : 0) + touch.pitch));
  if (auto) { inp.gas = 1; inp.steer = 0.35 * Math.sin(simT * 0.5) + (auto === 'drift' && simT % 6 > 4.5 ? 0.9 : 0); inp.hand = auto === 'drift' && simT % 6 > 4.5 ? 1 : 0; inp.boost = auto === 'boost' ? 1 : 0; }
}

// ---------- race: comic gates/props merged per loop track ----------
const NCP = 8, propMat = objMat({ gate: true, hatch: 0.8 }); let propMesh = null, propHull = null;
let curTrack = null, race = null, cps = []; const best = JSON.parse(localStorage.getItem('sinerally_best') || '{}');
function cpPos(t, i) { const th = i / NCP * Math.PI * 2, p = trackPoint(t, th), q = trackPoint(t, th + 0.01); return { x: p[0], z: p[1], ang: Math.atan2(q[0] - p[0], q[1] - p[1]) }; }
function buildGates(t) {
  curTrack = t; cps = Array.from({ length: NCP }, (_, i) => cpPos(t, i));
  if (propMesh) { scene.remove(propMesh); propMesh.geometry.dispose(); scene.remove(propHull); hulls.splice(hulls.indexOf(propHull), 1); }
  const g = trackProps(cps, ground); propMesh = new THREE.Mesh(g, propMat); scene.add(propMesh);
  propHull = new THREE.Mesh(g, objMat({ hull: 0.08 })); propHull.visible = !QUAL[qName].post; scene.add(propHull); hulls.push(propHull);
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
    const hw = e.type === W.HWY ? 4 : e.type === W.LOOP ? 3.5 : 2;
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
// ---------- HUD gauge (comic ink): tacho arc, gear, rpm, surface ----------
const gc = $('gauge').getContext('2d');
function gauge() {
  const Wd = 200, Hd = 120, cx = 100, cy = 104, R = 82; gc.clearRect(0, 0, Wd, Hd);
  const a0 = Math.PI * 0.95, a1 = Math.PI * 2.05, GM = veh.c.redline + 1000, rf = Math.min(1, veh.rpm / GM), red = veh.c.redline / GM;
  gc.lineCap = 'butt'; gc.lineWidth = 20; gc.strokeStyle = '#111'; gc.beginPath(); gc.arc(cx, cy, R, a0 - 0.03, a1 + 0.03); gc.stroke();
  gc.lineWidth = 13; gc.strokeStyle = '#fff8e0'; gc.beginPath(); gc.arc(cx, cy, R, a0, a1); gc.stroke();
  gc.strokeStyle = '#e8453c'; gc.beginPath(); gc.arc(cx, cy, R, a0 + (a1 - a0) * red, a1); gc.stroke();
  gc.strokeStyle = veh.rpm > veh.c.up ? '#ff3a1a' : '#ff8a1a'; gc.beginPath(); gc.arc(cx, cy, R, a0, a0 + (a1 - a0) * rf); gc.stroke();
  gc.strokeStyle = '#111'; gc.lineWidth = 2; for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; gc.beginPath(); gc.moveTo(cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7)); gc.lineTo(cx + Math.cos(a) * (R + 7), cy + Math.sin(a) * (R + 7)); gc.stroke(); }
  gc.textAlign = 'center'; gc.lineJoin = 'round'; gc.fillStyle = '#ffd23c'; gc.strokeStyle = '#111';
  const ink = (t, x, y, f, lw) => { gc.font = f; gc.lineWidth = lw; gc.fillStyle = '#111'; gc.fillText(t, x + 3, y + 3); gc.strokeText(t, x, y); gc.fillStyle = '#ffd23c'; gc.fillText(t, x, y); };
  ink(veh.gear < 0 ? 'R' : String(veh.gear), cx, cy - 14, 'italic 900 46px "Arial Black",system-ui', 5);
  gc.fillStyle = '#fff'; gc.font = 'italic 900 11px "Arial Black",system-ui'; gc.lineWidth = 3;
  const lbl = (t, x, y) => { gc.strokeText(t, x, y); gc.fillText(t, x, y); };
  lbl((veh.rpm / 1000).toFixed(1) + 'K RPM', cx - 56, cy + 12); lbl(W.SURF_NAMES[veh.wheels[2].surf].toUpperCase(), cx + 56, cy + 12);
}


// ---------- day/night cycle (12 min) + dynamic weather (affects grip, fog distance, palette) ----------
const BASE_FAR = U.uFar.value, CYCLE = 720, TIMES = { Day: 0.4, Sunset: 0.715, Night: 0.97 };
let timeMode = localStorage.getItem('sinerally_time') || 'Auto', tod = +(QS.get('tod') || 0.36); if (QS.get('tod')) timeMode = 'Fixed';
const WXP = { clear: { far: 1, grip: 1, dark: 1, hz: null }, rain: { far: 0.5, grip: 0.8, dark: 0.68, hz: new THREE.Color(0x7d8aa0) },
  fog: { far: 0.34, grip: 0.96, dark: 0.85, hz: new THREE.Color(0xc9d0d6) }, dust: { far: 0.3, grip: 0.9, dark: 0.82, hz: new THREE.Color(0xd99a5c) } };
let wxMode = QS.get('wx') || localStorage.getItem('sinerally_wx') || 'Auto'; const wx = { clear: 1, rain: 0, fog: 0, dust: 0 }; let wxTarget = 'clear';
if (WXP[wxMode]) { for (const k in wx) wx[k] = k === wxMode ? 1 : 0; }
const C_DAY_H = new THREE.Color(0xd9f1ff), C_DAY_Z = new THREE.Color(0x1f74e0), C_DUSK_H = new THREE.Color(0xffad6e), C_DUSK_Z = new THREE.Color(0x4f4aa8),
  C_NIGHT_H = new THREE.Color(0x1d2b4e), C_NIGHT_Z = new THREE.Color(0x060a1c), L_DAY = new THREE.Color(1, 1, 1), L_DUSK = new THREE.Color(1.12, 0.8, 0.6), L_NIGHT = new THREE.Color(0.34, 0.4, 0.68);
const sunV = new THREE.Vector3(), tmpC = new THREE.Color();
const precipN = 1400, prPos = new Float32Array(precipN * 6), prTail = new Float32Array(precipN * 2), prSeed = new Float32Array(precipN * 2);
for (let i = 0; i < precipN; i++) { const x = Math.random(), y = Math.random(), z = Math.random(), sd = Math.random(); prPos.set([x, y, z, x, y, z], i * 6); prTail.set([0, 1], i * 2); prSeed.set([sd, sd], i * 2); }
const prGeo = new THREE.BufferGeometry(); prGeo.setAttribute('position', new THREE.BufferAttribute(prPos, 3)); prGeo.setAttribute('tail', new THREE.BufferAttribute(prTail, 1)); prGeo.setAttribute('seed', new THREE.BufferAttribute(prSeed, 1));
const precip = new THREE.LineSegments(prGeo, precipMat()); precip.frustumCulled = false; precip.renderOrder = 5; scene.add(precip);
const sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function atmosphere(dt) {
  if (timeMode === 'Auto') tod = (tod + dt / CYCLE) % 1; else if (TIMES[timeMode] !== undefined) tod = TIMES[timeMode];
  const a = (tod - 0.25) * Math.PI * 2, el = Math.sin(a);
  const day = sstep(-0.1, 0.22, el), night = 1 - sstep(-0.22, 0.0, el), dusk = day * (1 - sstep(0.05, 0.42, el));
  if (el > -0.08) sunV.set(Math.cos(a) * 0.85, Math.max(el, 0.2), 0.5); else sunV.set(-Math.cos(a) * 0.85, Math.max(-el, 0.45), -0.5); // moon light at night
  U.uSun.value.copy(sunV.normalize());
  const L = U.uLight.value.copy(L_NIGHT).lerp(L_DAY, day).lerp(L_DUSK, dusk);
  const H = U.uHorizon.value.copy(C_NIGHT_H).lerp(C_DAY_H, day).lerp(C_DUSK_H, dusk), Z = U.uZenith.value.copy(C_NIGHT_Z).lerp(C_DAY_Z, day).lerp(C_DUSK_Z, dusk * 0.8);
  // weather: auto picks a state per 150 s slot (dust only in deserts/canyons, no rain there)
  if (wxMode === 'Auto') { const slot = Math.floor(simT / 150), h = hash2(slot, 3, 31), d = SO.dom, dry = d === W.REG.DUNES || d === W.REG.CANYON;
    wxTarget = h < 0.5 ? 'clear' : h < 0.68 ? (dry ? 'dust' : 'rain') : h < 0.84 ? 'fog' : (dry ? 'dust' : 'clear'); } else if (WXP[wxMode]) wxTarget = wxMode;
  let far = 0, grip = 0, dark = 0; for (const k in wx) { wx[k] += ((k === wxTarget ? 1 : 0) - wx[k]) * Math.min(1, dt * 0.2); far += wx[k] * WXP[k].far; grip += wx[k] * WXP[k].grip; dark += wx[k] * WXP[k].dark;
    if (WXP[k].hz && wx[k] > 0.001) { tmpC.copy(WXP[k].hz).multiply(L); H.lerp(tmpC, wx[k] * 0.85); Z.lerp(tmpC, wx[k] * 0.6); } }
  L.multiplyScalar(dark); U.uFar.value = BASE_FAR * far * (1 - night * 0.25); veh.gripMul = grip; U.uNight.value = night; U.uRain.value = wx.rain;
  U.uHeadK.value = Math.max(sstep(0.25, 0.7, night), sstep(0.4, 0.9, wx.fog + wx.dust + wx.rain) * 0.6); U.uAmb.value = 0.6 + 0.4 * day;
  const pm = precip.material.uniforms; if (wx.rain >= wx.dust) { pm.uCol.value.set(0xc8d8ff); pm.uVel.value.set(3, -30, 1.5); pm.uLen.value = 0.045; pm.uBox.value = 36; pm.uAmt.value = wx.rain; }
  else { pm.uCol.value.set(0xe8b878); pm.uVel.value.set(16, -1.5, 7); pm.uLen.value = 0.12; pm.uBox.value = 30; pm.uAmt.value = wx.dust * 0.9; }
  precip.visible = pm.uAmt.value > 0.02; sky.material.uniforms.uNight.value = night;
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
    cansGot.add(c.key); localStorage.setItem('sinerally_cans', JSON.stringify([...cansGot])); cans.splice(k, 1); veh.boost = 1; fire('pickup', { total: cansGot.size });
    msg('FUEL +1  (' + cansGot.size + ')'); for (let q = 0; q < 16; q++) { const a = q / 16 * 6.28; emit(c.x, c.y + 1.5, c.z, Math.cos(a) * 5, 3, Math.sin(a) * 5, 1.1, 0.6, [1, 0.85, 0.2]); } } }
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
  for (const pass of [0, 1]) for (const e of wmPaths) { const hw = (e.type === W.HWY ? 3 : e.type === W.LOOP ? 2.5 : 1.5) * Math.min(2, devicePixelRatio);
    c.strokeStyle = pass === 0 ? '#111' : e.type === W.HWY ? '#e8e4d8' : e.type === W.LOOP ? '#ff8a1a' : '#c8955a'; c.lineWidth = pass === 0 ? hw + 3 : hw; c.beginPath();
    const n = e.loop ? 48 : 12; for (let i = 0; i <= n; i++) { W.pathPoint(e, i / n, false); const x = P.X(W.PP.x), y = P.Y(W.PP.z); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  const ci = Math.floor(mapC[0] / VC), cj = Math.floor(mapC[1] / VC), R = Math.ceil(mapSpan / VC / 2) + 1; c.font = `900 ${12 * Math.min(2, devicePixelRatio)}px "Arial Black",system-ui`; c.textAlign = 'center';
  for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) { const v = vistaCell(ci + i, cj + j); if (!v) continue; const x = P.X(v.x), y = P.Y(v.z), f = vFound[v.key], r = 8 * Math.min(2, devicePixelRatio);
    c.fillStyle = f ? '#ffd23c' : '#fff8'; c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.moveTo(x, y - r); c.lineTo(x + r, y); c.lineTo(x, y + r); c.lineTo(x - r, y); c.closePath(); c.fill(); c.stroke();
    c.lineWidth = 4; c.strokeText(f ? v.name : '?', x, y - r - 5); c.fillStyle = '#fff'; c.fillText(f ? v.name : '?', x, y - r - 5); }
  if (wp) { const x = P.X(wp.x), y = P.Y(wp.z), r = 10 * Math.min(2, devicePixelRatio); c.fillStyle = '#e8453c'; c.strokeStyle = '#111'; c.lineWidth = 3; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y, r * 0.4, 0, 7); c.fill(); }
  { const x = P.X(veh.p.x), y = P.Y(veh.p.z), yw = veh.yaw, r = 14 * Math.min(2, devicePixelRatio); c.save(); c.translate(x, y); c.rotate(-yw); c.fillStyle = '#ff6a1a'; c.strokeStyle = '#111'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(0, -r); c.lineTo(-r * 0.7, r * 0.7); c.lineTo(0, r * 0.35); c.lineTo(r * 0.7, r * 0.7); c.closePath(); c.fill(); c.stroke(); c.restore(); }
  $('mInfo').textContent = `${(mapSpan / 1000).toFixed(1)} km · vistas ${Object.keys(vFound).length} · fuel ${cansGot.size}`;
}
mcv.addEventListener('click', e => { const P = mapProject(), dpr = mcv.width / innerWidth, x = e.clientX * dpr, y = e.clientY * dpr;
  setWp({ x: mapC[0] - (x - P.Wp / 2) / P.S, z: mapC[1] - (y - P.Hp / 2) / P.S }); });
// ---------- menu (☰): vehicle, assists, time, weather, graphics ----------
function buildMenu() {
  const rows = [['VEHICLE', ['buggy', 'truck', 'quad'], () => vName, setVehicle],
    ['STABILITY ASSIST', ['On', 'Off'], () => veh.assist.stab ? 'On' : 'Off', v => { veh.assist.stab = v === 'On'; localStorage.setItem('sinerally_stab', veh.assist.stab ? '1' : '0'); }],
    ['TRACTION CONTROL', ['On', 'Off'], () => veh.assist.tc ? 'On' : 'Off', v => { veh.assist.tc = v === 'On'; localStorage.setItem('sinerally_tc', veh.assist.tc ? '1' : '0'); }],
    ['TIME OF DAY', ['Auto', 'Day', 'Sunset', 'Night'], () => timeMode, v => { timeMode = v; localStorage.setItem('sinerally_time', v); }],
    ['WEATHER', ['Auto', 'clear', 'rain', 'fog', 'dust'], () => wxMode, v => { wxMode = v; localStorage.setItem('sinerally_wx', v); }],
    ['GRAPHICS', ['Low', 'Med', 'High'], () => qName, setQual]];
  const el = $('mRows'); el.innerHTML = '';
  for (const [label, opts, get, set] of rows) { const r = document.createElement('div'); r.className = 'mrow'; r.innerHTML = `<span>${label}</span>`;
    for (const o of opts) { const b = document.createElement('button'); b.className = 'sb' + (get() === o ? ' sel' : ''); b.textContent = o.toUpperCase(); b.onclick = () => { set(o); buildMenu(); }; r.appendChild(b); } el.appendChild(r); }
}
function openMenu(o) { $('menu').style.display = o ? 'block' : 'none'; if (o) { buildMenu(); audio.buildMenu($('mSnd')); } else sndBtn(); }
$('tMenu').onclick = () => openMenu($('menu').style.display !== 'block'); $('mnClose').onclick = () => openMenu(false);
$('mini').addEventListener('click', () => openMap(true)); $('mClose').onclick = () => openMap(false); $('mClr').onclick = () => setWp(null);
$('mZin').onclick = () => { mapSpan = Math.max(1500, mapSpan / 2); openMap(true); }; $('mZout').onclick = () => { mapSpan = Math.min(20000, mapSpan * 2); openMap(true); };
addEventListener('keydown', e => { if (e.code === 'KeyM' || e.code === 'Tab') { openMap(!mapOpen); e.preventDefault(); } if (e.code === 'Escape') { openMap(false); openMenu(false); } if (e.code === 'KeyV') setVehicle(vName === 'buggy' ? 'truck' : vName === 'truck' ? 'quad' : 'buggy'); });
// ---------- telemetry + event hooks for a later audio module (read-only; see MERGE_NOTES.md) ----------
const listeners = {}; function fire(type, data) { (listeners[type] || []).forEach(f => { try { f(data); } catch (e) { console.warn(e); } }); }
const TEL = { rpm: 0, idle: 0, redline: 0, throttle: 0, brake: 0, boost: false, nitro: 1, gear: 1, gears: 6, shifting: false, load: 0, speed: 0, fwdSpeed: 0, grounded: 0, air: 0,
  surface: 'grass', wheels: [0, 1, 2, 3].map(() => ({ contact: false, surface: 'grass', slipRatio: 0, slipAngle: 0, load: 0 })), vehicle: 'buggy', soundPreset: 'boxer4', paused: false };
function updateTelemetry(boosting) {
  const t = TEL, c = veh.c; t.rpm = veh.rpm; t.idle = c.idle; t.redline = c.redline; t.throttle = veh.thr || 0; t.brake = veh.brk || 0; t.boost = boosting; t.nitro = veh.boost;
  t.gear = veh.gear; t.gears = c.gears.length; t.shifting = veh.shift > 0; t.load = veh.load || 0; t.speed = veh.v.length(); t.fwdSpeed = veh.v.dot(veh.fwd); t.grounded = veh.grounded; t.air = veh.air;
  t.surface = W.SURF_NAMES[veh.wheels[2].surf]; t.vehicle = vName; t.soundPreset = c.soundPreset; t.paused = mapOpen;
  veh.wheels.forEach((wh, i) => { const o = t.wheels[i]; o.contact = wh.contact; o.surface = W.SURF_NAMES[wh.surf]; o.slipRatio = wh.sl; o.slipAngle = wh.sa; o.load = wh.load; });
}
const roProxy = o => new Proxy(o, { set() { return false; }, get(t, k) { const v = t[k]; return v && typeof v === 'object' ? roProxy(v) : v; } });
window.SR = Object.freeze({ telemetry: roProxy(TEL), on(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }, off(type, fn) { const l = listeners[type]; if (l) l.splice(l.indexOf(fn) >>> 0, 1); } });
// engine sound: the host only reads window.SR (telemetry + events), the plugin only sees the API v1 telemetry
const audio = createEngineAudio({ sr: window.SR });
const sndBtn = () => { $('tSnd').textContent = audio.muted ? '🔇' : '🔊'; };
$('tSnd').onclick = () => { if (!audio.running) { audio.unlock(); audio.setMuted(false); } else audio.setMuted(!audio.muted); sndBtn(); }; sndBtn(); // first tap = enable sound

// ---------- loop ----------
const camPos = new THREE.Vector3(veh.p.x, veh.p.y + 6, veh.p.z - 12), look = new THREE.Vector3(), camDir = new THREE.Vector3(0, 0, 1);
const tv = new THREE.Vector3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0), RV = new THREE.Vector3();
let last = performance.now(), acc = 0, fpsT = 0, frames = 0, fps = 0, shake = 0, tFrame = 0;
const STEP = 1 / 120, stats = { fps: 0, physMs: 0, frameMs: 0, minFps: 999 };
function updateWorld(force) {
  const px = veh.p.x, pz = veh.p.z;
  far.update(px, pz, force); near.update(px, pz, force);
  uNear.value.set((near.gi0 + NEAR_N / 2) * NEAR_S, (near.gj0 + NEAR_N / 2) * NEAR_S, NEAR_N * NEAR_S / 2);
  roads.update(px, pz, force); updateScenery(px, pz);
}
applyQuality(); updateWorld(true);
function frame(now) {
  requestAnimationFrame(frame); const t0 = performance.now(); let dt = Math.min(0.1, (now - last) / 1000); last = now; tFrame += dt; U.uTime.value = tFrame; renderer.info.reset();
  dynRes(dt);
  if (mapOpen) { drawMap(); audio.frame(dt, true); last = now; return; } // world map pauses the game
  readInput(dt);
  acc += dt; let steps = 0; const tp = performance.now();
  while (acc >= STEP && steps < 12) { simT += STEP; veh.step(STEP, inp); veh.collideCircles(colliders); checkBreak(); acc -= STEP; steps++; }
  if (steps === 12) acc = 0;
  stats.physMs = performance.now() - tp;
  for (const e of veh.events.splice(0)) {
    if (e[0] === 'land') { shake = Math.min(1, e[1] / 14); if (e[2] > 1) msg('AIR ' + e[2].toFixed(1) + 's!');
      if (e[1] > 4) { const s = veh.wheels[2].surf; for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28; emit(veh.p.x + Math.cos(a) * 1.6, veh.p.y - 0.7, veh.p.z + Math.sin(a) * 1.6, Math.cos(a) * 7, 0.8, Math.sin(a) * 7, 1.6, 0.7, PUFFC[s]); } } }
    else if (e[0] === 'crash') shake = Math.min(1, e[1] / 12); else if (e[0] === 'recover') msg('RECOVERED');
    fire(e[0], { value: e[1], extra: e[2] });
  }
  for (const [x, z, m] of smashes.splice(0)) { // breakable hit: instant despawn + a burst of leaves/splinters
    const gy = ground(x, z), col = m <= 3 ? [0.35, 0.62, 0.25] : m === 6 ? [0.42, 0.62, 0.3] : [0.62, 0.55, 0.32], n = m <= 2 ? 14 : 8;
    for (let k = 0; k < n; k++) { const a = Math.random() * 6.28; emit(x + Math.cos(a), gy + 1 + Math.random() * (m <= 2 ? 5 : 1.5), z + Math.sin(a), Math.cos(a) * 4 + veh.v.x * 0.3, 2 + Math.random() * 3, Math.sin(a) * 4 + veh.v.z * 0.3, 1 + Math.random(), 0.8, k % 3 ? col : [0.5, 0.36, 0.22]); }
    shake = Math.max(shake, m <= 2 ? 0.25 : 0.08); fire('smash', { kind: m <= 3 ? 'tree' : m === 6 ? 'cactus' : 'shrub', x, z });
  }
  atmosphere(dt); tickCans(tFrame); tickVistas();
  U.uHeadP.value.copy(veh.p).addScaledVector(veh.fwd, 2).addScaledVector(veh.up, 0.8); U.uHeadD.value.copy(veh.fwd).addScaledVector(veh.up, -0.12).normalize();
  precip.position.copy(camera.position);
  updateWorld(false); raceUpdate(dt);
  // car visuals: buggy body on the rigid body frame, wheels from the raycast suspension
  car.position.copy(veh.p); car.quaternion.copy(veh.q); veh.basis();
  const sp = veh.v.length(), boosting = !!inp.boost && veh.boost > 0;
  for (let i = 0; i < 4; i++) { const wh = veh.wheels[i], m = wheelMeshes[i]; m.position.copy(wh.pos).addScaledVector(veh.up, VIS_UP);
    tq.setFromAxisAngle(AY, wh.steer); tq2.setFromAxisAngle(AX, wh.rot); m.quaternion.copy(veh.q).multiply(tq).multiply(tq2);
    if (wh.contact) {
      const slip = Math.abs(wh.sl) > 0.15 || Math.abs(wh.sa) > 0.12, loose = [1, 3, 5, 6].includes(wh.surf);
      if ((loose && (slip || sp > 14) && Math.random() < 0.35 + Math.min(0.4, sp * 0.01)) || (slip && sp > 8 && Math.random() < 0.25))
        emit(wh.pos.x, wh.pos.y - 0.2, wh.pos.z, -veh.v.x * 0.15 + (Math.random() - .5) * 3, 0.5 + Math.random() * 1.2, -veh.v.z * 0.15 + (Math.random() - .5) * 3,
          0.6 + Math.random() * 0.7 + (slip ? 0.5 : 0), 0.45 + Math.random() * 0.35, PUFFC[wh.surf]);
    }
    if (i >= 2) { const on = wh.contact && wh.surf !== SURF.SNOW && (Math.abs(wh.sa) > 0.15 || Math.abs(wh.sl) > 0.2) && sp > 4;
      const gy = wh.pos.y - veh.c.wheelR + (wh.surf === SURF.ASPHALT ? 0.2 : wh.surf === SURF.DIRT ? 0.12 : 0.05);
      skid(i - 2, wh.pos.x, gy, wh.pos.z, veh.left.x, veh.left.z, on); }
  }
  updatePuffs(dt);
  flame.visible = boosting; flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
  { const gy = ground(veh.p.x, veh.p.z); shadow.position.set(veh.p.x, gy + 0.1, veh.p.z); shadow.rotation.y = veh.yaw; const sh = Math.max(0.3, 1 - (veh.p.y - 1.1 - gy) * 0.08); shadow.scale.set(sh * shadow.userData.w, 1, sh * shadow.userData.l); shadow.visible = veh.up.y > 0.3; }
  // chase camera: follows velocity direction when moving fast, heading otherwise; FOV kick on boost
  tv.set(veh.fwd.x, 0, veh.fwd.z); if (veh.v.dot(veh.fwd) < -3) tv.negate(); tv.normalize();
  if (sp > 6 && veh.grounded) { RV.set(veh.v.x, 0, veh.v.z).normalize(); tv.lerp(RV, 0.35).normalize(); }
  camDir.lerp(tv, Math.min(1, (veh.grounded ? 4 : 1.2) * dt)).normalize();
  const back = 8.5 + sp * 0.05, cx = veh.p.x - camDir.x * back, cz = veh.p.z - camDir.z * back;
  const tgt = tv.set(cx, Math.max(veh.p.y + 3.2, ground(cx, cz) + 2), cz);
  camPos.lerp(tgt, Math.min(1, 6 * dt)); camera.position.copy(camPos);
  if (shake > 0) { camera.position.x += (Math.random() - .5) * shake * 0.8; camera.position.y += (Math.random() - .5) * shake * 0.8; shake = Math.max(0, shake - dt * 2.5); }
  look.set(veh.p.x, veh.p.y + 1.3, veh.p.z); camera.lookAt(look);
  camera.fov += ((boosting ? 80 : 64 + Math.min(12, sp * 0.15)) - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  post.uniforms.uBoost.value += ((boosting ? 1 : 0) - post.uniforms.uBoost.value) * Math.min(1, 6 * dt);
  grass.update(tFrame, veh.p.x + camDir.x * 18, veh.p.z + camDir.z * 18);
  $('spd').textContent = Math.abs(Math.round(veh.v.dot(veh.fwd) * 3.6)); $('bar').style.width = (veh.boost * 100) + '%';
  $('air').textContent = veh.air > 0.5 ? 'AIR ' + veh.air.toFixed(1) + 's!' : '';
  if (msgT > 0 && (msgT -= dt) <= 0) $('msg').textContent = '';
  minimap(Math.atan2(camDir.x, camDir.z)); gauge(); tickWp(Math.atan2(camDir.x, camDir.z)); updateTelemetry(boosting); audio.frame(dt);
  if (!QS.has('nopost')) { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(postScene, postCam); }
  else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  stats.frameMs = performance.now() - t0;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = stats.fps = frames / fpsT; window.__fps = fps; if (tFrame > 3) stats.minFps = Math.min(stats.minFps, fps); frames = 0; fpsT = 0;
    if (dbg) { sample(veh.p.x, veh.p.z, SO); $('dbg').textContent = `${fps.toFixed(0)} fps  GFX ${qName}  cpu ${stats.frameMs.toFixed(1)}ms (phys ${stats.physMs.toFixed(1)})\ncalls ${renderer.info.render.calls} tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k\n${veh.p.x.toFixed(0)},${veh.p.z.toFixed(0)} y${veh.p.y.toFixed(0)} ${W.REG_NAMES[SO.dom]}\ngear ${veh.gear} rpm ${veh.rpm.toFixed(0)} wheels ${veh.grounded}`; } }
}
requestAnimationFrame(frame);
window.__st = { veh, stats, inp, W, audio, get q() { return qName; }, setQ(q) { qName = q; applyQuality(); }, get x() { return veh.p.x; }, get z() { return veh.p.z; }, get y() { return veh.p.y; }, teleport(x, z, yaw = 0) { spawn(x, z, yaw); updateWorld(true); updateCans(true); },
  gone, get brk() { return brk; }, setVehicle, get vName() { return vName; }, openMap, setWp, get wx() { return wx; }, set tod(v) { tod = v; timeMode = 'Fixed'; }, get dynS() { return dynS; } };
