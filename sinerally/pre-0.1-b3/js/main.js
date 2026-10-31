// SineRally — merged release: ENGINE (rigid-body 4x4 vehicle.js, multi-region world.js, road graph roads.js,
// GPU grass grass.js, near/far ring-buffer terrain, gauges) + GRAPHICS (comic/Borderlands-style shading from shaders.js:
// ink outlines, cel bands, hatching, posterize/halftone/grain, code-built buggy, puffs, skids, comic sky & HUD).
import * as THREE from 'three';
import * as W from './world.js';
import { Vehicle, CFG } from './vehicle.js';
import { createRoads } from './roads.js';
import { createGrass } from './grass.js';
import { U, gridTerrainMat, waterMat, objMat, skyMat, puffMat, decalMat, postMat, roadMat } from './shaders.js';
import { treeVariants, rockVariants, cactusVariants, buggy, trackProps } from './models.js';
const { WATER, nearTrack, trackPoint, hash2, sample, surfaceOf, colourOf, grassDensity, normal, height, ground, SURF } = W;
const $ = id => document.getElementById(id);
const QS = new URLSearchParams(location.search);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
// ---------- renderer + quality (GFX toggle: Low default on phones) ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight); document.body.prepend(renderer.domElement);
const QUAL = { Low: { pr: 1, post: false, sr: 200, hatch: 0.7, grass: 7000 }, Med: { pr: 1.25, post: true, sr: 250, hatch: 1, grass: 11000 }, High: { pr: 1.5, post: true, sr: 300, hatch: 1, grass: 16000 } };
const qArg = (QS.get('q') || '').toLowerCase(), qMap = { low: 'Low', med: 'Med', high: 'High' };
let qName = qMap[qArg] || localStorage.getItem('sinerally_q2') || (isTouch ? 'Low' : 'High'); if (!QUAL[qName]) qName = isTouch ? 'Low' : 'High';
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
  const q = QUAL[qName], pr = Math.min(devicePixelRatio, q.pr);
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); U.uPx.value = pr; U.uHatch.value = q.hatch;
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr); rt.setSize(w, h); post.uniforms.uRes.value.set(w, h); post.uniforms.uThick.value = Math.max(1.2, pr * 1.1);
  hulls.forEach(m => m.visible = !q.post); scx = 1e9; $('tQ').textContent = 'GFX: ' + qName;
  if (grass) grass.mesh.geometry.instanceCount = q.grass;
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', () => applyQuality());
function cycleQ() { qName = qName === 'Low' ? 'Med' : qName === 'Med' ? 'High' : 'Low'; localStorage.setItem('sinerally_q2', qName); applyQuality(); }
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
    if (m !== null) o = { m, x, z, y: SO.h, s, h, v, red: d === R.CANYON || d === R.DUNES };
  }
  if (cellCache.size > 60000) cellCache.clear();
  cellCache.set(key, o); return o;
}
let scx = 1e9, scz = 1e9; const colliders = [];
function updateScenery(px, pz) {
  const cx = Math.round(px / 28), cz = Math.round(pz / 28); if (cx === scx && cz === scz) return; scx = cx; scz = cz;
  allM.forEach(m => m.count = 0); colliders.length = 0;
  const SR = QUAL[qName].sr, r = Math.ceil(SR / SC), ox = Math.floor(px / SC), oz = Math.floor(pz / SC);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (i * i + j * j > r * r) continue; const o = cellObj(ox + i, oz + j); if (!o) continue;
    const m = allM[o.m]; if (m.count >= m.instanceMatrix.count) continue; const s = o.s, t = 0.85 + 0.25 * o.v;
    if (o.m === 4 || o.m === 5) { // rocks: canyon/dune rocks are big and red
      const big = o.red ? 1.8 : 1; Qt.setFromEuler(Et.set(o.h * 9, o.h * 30, o.h * 3)); Mx.compose(Vt.set(o.x, o.y - 0.4, o.z), Qt, St.set(s * big, s * big * (o.red ? 1.3 : 1), s * big));
      Cc.setRGB(o.red ? 1.35 * t : t, o.red ? 0.85 * t : t, o.red ? 0.62 * t : t * 0.97); colliders.push(o.x, o.z, 2.2 * s * big);
    } else {
      Qt.setFromEuler(Et.set(0, o.h * 40, 0)); Mx.compose(Vt.set(o.x, o.y - 0.3, o.z), Qt, St.set(s, s * (0.85 + o.h * 0.6), s));
      Cc.setRGB(t, t * (0.95 + 0.1 * Math.sin(o.h * 70)), t * 0.95); colliders.push(o.x, o.z, o.m === 6 ? 0.6 : o.m === 7 || o.m === 3 ? 0 : 0.8 * s);
    }
    const k = m.count++; m.setMatrixAt(k, Mx); m.setColorAt(k, Cc);
  }
  for (const m of allM) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; if (m.userData.hull) m.userData.hull.count = m.count; }
  for (let i = colliders.length - 3; i >= 0; i -= 3) if (colliders[i + 2] === 0) colliders.splice(i, 3); // bushes/shrubs: drive-through
}

// ---------- vehicle (engine physics) + buggy visuals (graphics models) ----------
const veh = new Vehicle();
const B = buggy(), carMat = objMat({ hatch: 0.5 });
const car = new THREE.Group(); scene.add(car);
const body = new THREE.Group(); car.add(body);
// buggy model space: ground at y=0, wheel centres (+-1.15, 0.68, +-1.45). Physics: CoM origin, wheel centres ~(+-0.98, -0.63, +1.42/-1.38), r 0.46.
const VIS_R = 0.56, VIS_UP = VIS_R - CFG.wheelR; // slightly larger visual tyres, raised so the contact patch matches
body.scale.set(0.85, 0.9, 0.97); body.position.set(0, -0.626 + VIS_UP - 0.68 * 0.9, 0.02);
const bodyMesh = new THREE.Mesh(B.body, carMat); body.add(bodyMesh);
const bodyHull = new THREE.Mesh(B.body, objMat({ hull: 0.05 })); body.add(bodyHull); hulls.push(bodyHull);
const wheelMeshes = veh.wheels.map(() => { const g = new THREE.Group(), w = new THREE.Mesh(B.wheel, carMat); w.scale.setScalar(VIS_R / 0.68); g.add(w);
  const h = new THREE.Mesh(B.wheel, objMat({ hull: 0.05 })); w.add(h); hulls.push(h); scene.add(g); return g; });
const flame = new THREE.Mesh(B.flame, objMat({ unlit: true })); flame.position.set(0, 1.2, -2.5); body.add(flame);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 4.6).rotateX(-Math.PI / 2), decalMat(0x203040, true)); scene.add(shadow);
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
let simT = 0;
function readInput() {
  let s = (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0) - touch.steer - (tilt ? tiltSteer : 0);
  inp.steer = Math.max(-1, Math.min(1, s));
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
    const n = e.loop ? 64 : 16; for (let i = 0; i <= n; i++) { W.pathPoint(e, i / n, false); const x = (W.PP.x - px) * sc, y = (W.PP.z - pz) * sc; i ? mc.lineTo(-x, y) : mc.moveTo(-x, y); } mc.stroke();
  }
  const s = cps[0]; let sx = -(s.x - px) * sc, sz = (s.z - pz) * sc; const d = Math.hypot(sx, sz); if (d > 55) { sx *= 55 / d; sz *= 55 / d; }
  mc.fillStyle = '#fff'; mc.strokeStyle = '#111'; mc.lineWidth = 2; mc.beginPath(); mc.arc(sx, sz, 6, 0, 7); mc.fill(); mc.stroke(); mc.restore();
  mc.fillStyle = '#ff6a1a'; mc.strokeStyle = '#111'; mc.lineWidth = 2; mc.beginPath(); mc.moveTo(Wd / 2, Wd / 2 - 8); mc.lineTo(Wd / 2 - 6, Wd / 2 + 6); mc.lineTo(Wd / 2 + 6, Wd / 2 + 6); mc.closePath(); mc.fill(); mc.stroke();
  mc.fillStyle = '#fff'; mc.font = 'bold 11px sans-serif'; mc.textAlign = 'center'; mc.fillText(Math.round(Math.hypot(s.x - px, s.z - pz)) + ' m', Wd / 2, Wd - 10);
}
// ---------- HUD gauge (comic ink): tacho arc, gear, rpm, surface ----------
const gc = $('gauge').getContext('2d');
function gauge() {
  const Wd = 200, Hd = 120, cx = 100, cy = 104, R = 82; gc.clearRect(0, 0, Wd, Hd);
  const a0 = Math.PI * 0.95, a1 = Math.PI * 2.05, rf = Math.min(1, veh.rpm / 8000), red = CFG.redline / 8000;
  gc.lineCap = 'butt'; gc.lineWidth = 20; gc.strokeStyle = '#111'; gc.beginPath(); gc.arc(cx, cy, R, a0 - 0.03, a1 + 0.03); gc.stroke();
  gc.lineWidth = 13; gc.strokeStyle = '#fff8e0'; gc.beginPath(); gc.arc(cx, cy, R, a0, a1); gc.stroke();
  gc.strokeStyle = '#e8453c'; gc.beginPath(); gc.arc(cx, cy, R, a0 + (a1 - a0) * red, a1); gc.stroke();
  gc.strokeStyle = veh.rpm > CFG.up ? '#ff3a1a' : '#ff8a1a'; gc.beginPath(); gc.arc(cx, cy, R, a0, a0 + (a1 - a0) * rf); gc.stroke();
  gc.strokeStyle = '#111'; gc.lineWidth = 2; for (let i = 0; i <= 8; i++) { const a = a0 + (a1 - a0) * i / 8; gc.beginPath(); gc.moveTo(cx + Math.cos(a) * (R - 7), cy + Math.sin(a) * (R - 7)); gc.lineTo(cx + Math.cos(a) * (R + 7), cy + Math.sin(a) * (R + 7)); gc.stroke(); }
  gc.textAlign = 'center'; gc.lineJoin = 'round'; gc.fillStyle = '#ffd23c'; gc.strokeStyle = '#111';
  const ink = (t, x, y, f, lw) => { gc.font = f; gc.lineWidth = lw; gc.fillStyle = '#111'; gc.fillText(t, x + 3, y + 3); gc.strokeText(t, x, y); gc.fillStyle = '#ffd23c'; gc.fillText(t, x, y); };
  ink(veh.gear < 0 ? 'R' : String(veh.gear), cx, cy - 14, 'italic 900 46px "Arial Black",system-ui', 5);
  gc.fillStyle = '#fff'; gc.font = 'italic 900 11px "Arial Black",system-ui'; gc.lineWidth = 3;
  const lbl = (t, x, y) => { gc.strokeText(t, x, y); gc.fillText(t, x, y); };
  lbl((veh.rpm / 1000).toFixed(1) + 'K RPM', cx - 56, cy + 12); lbl(W.SURF_NAMES[veh.wheels[2].surf].toUpperCase(), cx + 56, cy + 12);
}

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
  readInput();
  acc += dt; let steps = 0; const tp = performance.now();
  while (acc >= STEP && steps < 12) { simT += STEP; veh.step(STEP, inp); veh.collideCircles(colliders); acc -= STEP; steps++; }
  if (steps === 12) acc = 0;
  stats.physMs = performance.now() - tp;
  for (const e of veh.events.splice(0)) {
    if (e[0] === 'land') { shake = Math.min(1, e[1] / 14); if (e[2] > 1) msg('AIR ' + e[2].toFixed(1) + 's!');
      if (e[1] > 4) { const s = veh.wheels[2].surf; for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28; emit(veh.p.x + Math.cos(a) * 1.6, veh.p.y - 0.7, veh.p.z + Math.sin(a) * 1.6, Math.cos(a) * 7, 0.8, Math.sin(a) * 7, 1.6, 0.7, PUFFC[s]); } } }
    else if (e[0] === 'crash') shake = Math.min(1, e[1] / 12); else if (e[0] === 'recover') msg('RECOVERED');
  }
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
      const gy = wh.pos.y - CFG.wheelR + (wh.surf === SURF.ASPHALT ? 0.2 : wh.surf === SURF.DIRT ? 0.12 : 0.05);
      skid(i - 2, wh.pos.x, gy, wh.pos.z, veh.left.x, veh.left.z, on); }
  }
  updatePuffs(dt);
  flame.visible = boosting; flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
  { const gy = ground(veh.p.x, veh.p.z); shadow.position.set(veh.p.x, gy + 0.1, veh.p.z); shadow.rotation.y = veh.yaw; const sh = Math.max(0.3, 1 - (veh.p.y - 1.1 - gy) * 0.08); shadow.scale.set(sh, 1, sh); shadow.visible = veh.up.y > 0.3; }
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
  minimap(Math.atan2(camDir.x, camDir.z)); gauge();
  if (QUAL[qName].post) { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(postScene, postCam); }
  else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  stats.frameMs = performance.now() - t0;
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = stats.fps = frames / fpsT; window.__fps = fps; if (tFrame > 3) stats.minFps = Math.min(stats.minFps, fps); frames = 0; fpsT = 0;
    if (dbg) { sample(veh.p.x, veh.p.z, SO); $('dbg').textContent = `${fps.toFixed(0)} fps  GFX ${qName}  cpu ${stats.frameMs.toFixed(1)}ms (phys ${stats.physMs.toFixed(1)})\ncalls ${renderer.info.render.calls} tris ${(renderer.info.render.triangles / 1000).toFixed(0)}k\n${veh.p.x.toFixed(0)},${veh.p.z.toFixed(0)} y${veh.p.y.toFixed(0)} ${W.REG_NAMES[SO.dom]}\ngear ${veh.gear} rpm ${veh.rpm.toFixed(0)} wheels ${veh.grounded}`; } }
}
requestAnimationFrame(frame);
window.__st = { veh, stats, inp, W, get q() { return qName; }, setQ(q) { qName = q; applyQuality(); }, get x() { return veh.p.x; }, get z() { return veh.p.z; }, get y() { return veh.p.y; }, teleport(x, z, yaw = 0) { spawn(x, z, yaw); updateWorld(true); } };
