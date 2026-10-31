import * as THREE from 'three';
import { height, normal, WATER, nearTrack, trackPoint, trackW, trackSD, hash2 } from './world.js';
import { U, terrainMat, waterMat, objMat, skyMat, puffMat, decalMat, postMat } from './shaders.js';
import { treeVariants, rockVariants, buggy, trackProps } from './models.js';
const $ = id => document.getElementById(id);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
// ---------- renderer + quality ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' }); renderer.info.autoReset = false;
renderer.setSize(innerWidth, innerHeight); document.body.prepend(renderer.domElement);
const QUAL = { Low: { pr: 1, post: false, sr: 170, hatch: 0.7 }, Med: { pr: 1.25, post: true, sr: 230, hatch: 1 }, High: { pr: 1.5, post: true, sr: 290, hatch: 1 } };
let qName = localStorage.getItem('sinerally_q') || (isTouch ? 'Med' : 'High'); if (!QUAL[qName]) qName = 'Med';
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 1200);
const depthTex = new THREE.DepthTexture(1, 1); depthTex.type = THREE.UnsignedIntType;
const rt = new THREE.WebGLRenderTarget(1, 1, { depthTexture: depthTex, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true });
const post = postMat(); post.uniforms.tCol.value = rt.texture; post.uniforms.tDep.value = depthTex; post.uniforms.uN.value = camera.near; post.uniforms.uF.value = camera.far;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post); quad.frustumCulled = false; postScene.add(quad);
function applyQuality() {
  const q = QUAL[qName], pr = Math.min(devicePixelRatio, q.pr);
  renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); U.uPx.value = pr; U.uHatch.value = q.hatch;
  const w = Math.floor(innerWidth * pr), h = Math.floor(innerHeight * pr); rt.setSize(w, h); post.uniforms.uRes.value.set(w, h); post.uniforms.uThick.value = Math.max(1.2, pr * 1.1);
  hulls.forEach(m => m.visible = !q.post); scx = 1e9; $('tQ').textContent = 'GFX: ' + qName; localStorage.setItem('sinerally_q', qName);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
addEventListener('resize', () => applyQuality());
// ---------- sky ----------
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMat()); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
// ---------- terrain: moving grid recentred on player, heights from height(x,z) ----------
const N = 144, STEP = 8;
const tgeo = new THREE.PlaneGeometry(N * STEP, N * STEP, N, N); tgeo.rotateX(-Math.PI / 2);
const tpos = tgeo.attributes.position, tnor = tgeo.attributes.normal, ttrk = new Float32Array(tpos.count * 2);
tgeo.setAttribute('trk', new THREE.BufferAttribute(ttrk, 2)); tgeo.deleteAttribute('uv');
const terrain = new THREE.Mesh(tgeo, terrainMat()); terrain.frustumCulled = false; scene.add(terrain);
const water = new THREE.Mesh(tgeo, waterMat()); water.frustumCulled = false; scene.add(water); // same grid, flattened in shader
const baseXZ = Float32Array.from({ length: tpos.count * 2 }, (_, i) => i & 1 ? tpos.getZ(i >> 1) : tpos.getX(i >> 1));
let gx = 1e9, gz = 1e9; const nv = [0, 0, 0];
function updateTerrain(px, pz) {
  const sx = Math.round(px / STEP) * STEP, sz = Math.round(pz / STEP) * STEP;
  if (sx === gx && sz === gz) return; gx = sx; gz = sz;
  terrain.position.set(sx, 0, sz); water.position.set(sx, 0, sz);
  for (let i = 0; i < tpos.count; i++) {
    const x = baseXZ[i * 2] + sx, z = baseXZ[i * 2 + 1] + sz;
    tpos.setY(i, height(x, z)); normal(x, z, nv); tnor.setXYZ(i, nv[0], nv[1], nv[2]);
    const w = trackW(x, z); ttrk[i * 2] = w; ttrk[i * 2 + 1] = w > 0 ? Math.max(-30, Math.min(30, trackSD(x, z))) : 30;
  }
  tpos.needsUpdate = tnor.needsUpdate = true; tgeo.attributes.trk.needsUpdate = true;
}
// ---------- scenery: instanced, placed by hash per cell; wind sway in vertex shader ----------
const SC = 14, TMAX = 700, RMAX = 300;
const hulls = [];
function inst(geo, mat, max, hullW) {
  const m = new THREE.InstancedMesh(geo, mat, max); m.frustumCulled = false; m.count = 0; scene.add(m);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3).fill(1), 3);
  if (hullW) { const h = new THREE.InstancedMesh(geo, objMat({ hull: hullW, wind: mat.uniforms.uWind.value }), max); h.instanceMatrix = m.instanceMatrix; h.frustumCulled = false; h.count = 0; scene.add(h); hulls.push(h); m.userData.hull = h; }
  return m;
}
const treeM = treeVariants().map(g => inst(g, objMat({ wind: 0.035 }), TMAX, 0.12));
const rockM = rockVariants().map(g => inst(g, objMat({ hatch: 1.2 }), RMAX, 0.12));
const Mx = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sv = new THREE.Vector3(), E = new THREE.Euler(), Cc = new THREE.Color();
let scx = 1e9, scz = 1e9; const colliders = [];
function put(m, x, y, z, ry, s, sy, rx = 0, tint = 1) { const i = m.count++; Q.setFromEuler(E.set(rx, ry, rx * .5)); Mx.compose(V.set(x, y, z), Q, Sv.set(s, sy, s)); m.setMatrixAt(i, Mx); m.setColorAt(i, Cc.setRGB(tint, tint * (0.95 + 0.1 * Math.sin(ry * 7)), tint * 0.95)); }
function updateScenery(px, pz) {
  const cx = Math.round(px / 40), cz = Math.round(pz / 40); if (cx === scx && cz === scz) return; scx = cx; scz = cz;
  const SR = QUAL[qName].sr; [...treeM, ...rockM].forEach(m => m.count = 0); colliders.length = 0;
  const r = Math.ceil(SR / SC), ox = Math.floor(px / SC), oz = Math.floor(pz / SC);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (i * i + j * j > r * r) continue; const ci = ox + i, cj = oz + j, h = hash2(ci, cj, 9);
    const x = (ci + hash2(ci, cj, 7)) * SC, z = (cj + hash2(ci, cj, 8)) * SC;
    const dens = 0.3 + 0.3 * Math.sin(x * 0.003) * Math.cos(z * 0.0037);
    if (h > dens && h < 0.9) continue;
    const y = height(x, z); if (y < WATER + 3 || trackW(x, z) > 0) continue;
    normal(x, z, nv); const s = 0.7 + hash2(ci, cj, 6) * 0.7, v = hash2(ci, cj, 5), tint = 0.85 + 0.25 * hash2(ci, cj, 4);
    if (h < dens && nv[1] > 0.82 && y < 125) {
      const k = y > 70 ? (v < 0.75 ? 0 : 3) : v < 0.3 ? 0 : v < 0.6 ? 1 : v < 0.8 ? 2 : 3, m = treeM[k];
      if (m.count >= TMAX) continue; put(m, x, y - 0.3, z, h * 40, s, s * (0.85 + h * 0.5), 0, tint); if (k < 3) colliders.push(x, z, 1.0 * s);
    } else if (h > 0.94) { const m = rockM[v < 0.6 ? 0 : 1]; if (m.count >= RMAX) continue; put(m, x, y - 0.4, z, h * 30, s, s, (nv[1] - 1) * 2, tint); colliders.push(x, z, 2.4 * s); }
  }
  for (const m of [...treeM, ...rockM]) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; if (m.userData.hull) m.userData.hull.count = m.count; }
}
// ---------- car ----------
const B = buggy(), carMat = objMat({ hatch: 0.5 });
const car = new THREE.Group(); scene.add(car);
const body = new THREE.Group(); car.add(body);
const bodyMesh = new THREE.Mesh(B.body, carMat); body.add(bodyMesh);
const bodyHull = new THREE.Mesh(B.body, objMat({ hull: 0.05 })); body.add(bodyHull); hulls.push(bodyHull);
const WOFF = [[-1.15, 1.45], [1.15, 1.45], [-1.15, -1.45], [1.15, -1.45]], WR = 0.68;
const wheels = WOFF.map(o => { const g = new THREE.Group(); g.position.set(o[0], WR, o[1]); const w = new THREE.Mesh(B.wheel, carMat); g.add(w); const h = new THREE.Mesh(B.wheel, objMat({ hull: 0.05 })); w.add(h); hulls.push(h); car.add(g); return g; });
const flame = new THREE.Mesh(B.flame, objMat({ unlit: true })); flame.position.set(0, 1.2, -2.5); body.add(flame);
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 4.8).rotateX(-Math.PI / 2), decalMat(0x203040, true)); scene.add(shadow);
const st = { x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0, air: 0, boost: 1, steer: 0, vl: 0, up: new THREE.Vector3(0, 1, 0) };
function spawn(x, z, yaw = 0) {
  for (let k = 0; k < 200 && height(x, z) < WATER + 2; k++) { x += 37; z += 23; }
  Object.assign(st, { x, z, y: height(x, z) + 2, vx: 0, vy: 0, vz: 0, yaw, yawRate: 0 });
}
{ const t = nearTrack(0, 0), p = trackPoint(t, 0.16), q = trackPoint(t, 0.18); spawn(p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1])); }
// ---------- input ----------
const key = {}; addEventListener('keydown', e => { key[e.code] = 1; if (e.code === 'KeyR') reset(); if (e.code === 'KeyF') toggleDbg(); if (e.code === 'KeyG') cycleQ(); });
addEventListener('keyup', e => key[e.code] = 0);
const touch = { steer: 0, gas: 0, brk: 0, bst: 0, drf: 0 }; let tilt = false, tiltSteer = 0;
if (isTouch) { $('joy').style.display = 'block'; ['bGas', 'bBrk', 'bBst', 'bDrf'].forEach(b => $(b).style.display = 'flex'); }
const joy = $('joy'), knob = $('knob'); let joyId = null;
joy.addEventListener('touchstart', e => { joyId = e.changedTouches[0].identifier; joyMove(e); e.preventDefault(); }, { passive: false });
joy.addEventListener('touchmove', e => { joyMove(e); e.preventDefault(); }, { passive: false });
const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; touch.steer = 0; knob.style.transform = ''; } };
joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);
function joyMove(e) { for (const t of e.changedTouches) if (t.identifier === joyId) { const r = joy.getBoundingClientRect(); let dx = (t.clientX - r.left - r.width / 2) / 55; dx = Math.max(-1, Math.min(1, dx)); touch.steer = dx; knob.style.transform = `translateX(${dx * 45}px)`; } }
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
function cycleQ() { qName = qName === 'Low' ? 'Med' : qName === 'Med' ? 'High' : 'Low'; applyQuality(); }
let dbg = false; function toggleDbg() { dbg = !dbg; if (!dbg) $('dbg').textContent = ''; }
function reset() { const n = [0, 0, 0]; let x = st.x, z = st.z; for (let k = 0; k < 40; k++) { normal(x, z, n); if (n[1] > 0.85 && height(x, z) > WATER + 2) break; x += 6 * Math.sin(st.yaw + k); z += 6 * Math.cos(st.yaw + k); } spawn(x, z, st.yaw); }
// ---------- physics (same height() as rendering) ----------
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), tmp = new THREE.Vector3(), UPY = new THREE.Vector3(0, 1, 0);
const G = 22; let landed = 0;
function physics(dt) {
  const steer = Math.max(-1, Math.min(1, (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0) - touch.steer - (tilt ? tiltSteer : 0)));
  st.steer += (steer - st.steer) * Math.min(1, 10 * dt);
  const gas = key.KeyW || key.ArrowUp || touch.gas ? 1 : 0, brk = key.KeyS || key.ArrowDown || touch.brk ? 1 : 0;
  const drift = key.Space || touch.drf, boosting = (key.ShiftLeft || key.ShiftRight || touch.bst) && st.boost > 0;
  const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw); let gmax = -1e9, gavg = 0; const wh = [];
  for (const [ox, oz] of WOFF) { const wx = st.x + ox * cy + oz * sy, wz = st.z - ox * sy + oz * cy, h = height(wx, wz); wh.push(h); gavg += h / 4; gmax = Math.max(gmax, h); }
  const hF = (wh[0] + wh[1]) / 2, hB = (wh[2] + wh[3]) / 2, hL = (wh[0] + wh[2]) / 2, hR = (wh[1] + wh[3]) / 2;
  fwd.set(sy, (hF - hB) / 2.9, cy).normalize(); right.set(cy, (hR - hL) / 2.3, -sy).normalize(); // local +x axis
  upv.crossVectors(fwd, right).normalize(); if (upv.y < 0) upv.negate();
  right.crossVectors(upv, fwd).normalize();
  const ground = Math.max(gavg, (gmax + gavg) / 2), inWater = ground < WATER - 0.6;
  const gap = st.y - ground, grounded = gap < 0.35;
  st.vy -= G * dt;
  const v = tmp.set(st.vx, st.vy, st.vz);
  if (grounded) {
    if (st.air > 0.5) landed = Math.min(1, st.air);
    st.air = 0;
    const comp = Math.max(0, 0.35 - gap), vn = v.dot(upv);
    v.addScaledVector(upv, (comp * 260 - vn * 9 * (vn < 0 ? 1 : 0.3)) * dt);
    if (gap < 0) { st.y = ground; const vn2 = v.dot(upv); if (vn2 < 0) v.addScaledVector(upv, -vn2 * 1.2); }
    let vf = v.dot(fwd), vl = v.dot(right);
    const maxV = boosting ? 58 : 42;
    if (gas) vf += (vf < maxV ? (boosting ? 34 : 20) : 0) * dt;
    if (brk) vf -= (vf > 0.5 ? 40 : 14) * dt; if (brk && vf < -14) vf = -14;
    if (!gas && !brk) vf *= 1 - 0.5 * dt;
    if (inWater) vf *= 1 - 1.6 * dt;
    const grip = drift ? 1.8 : 7.5; vl *= Math.max(0, 1 - grip * dt); st.vl = vl;
    const vn3 = v.dot(upv);
    v.set(0, 0, 0).addScaledVector(fwd, vf).addScaledVector(right, vl).addScaledVector(upv, vn3);
    const sp = Math.abs(vf), target = st.steer * Math.min(1, sp / 8) * (drift ? 2.3 : 1.5) / (1 + sp * 0.02) * Math.sign(vf || 1);
    st.yawRate += (target - st.yawRate) * Math.min(1, 8 * dt);
  } else { st.air += dt; st.vl = 0; st.yawRate *= 1 - 0.8 * dt; st.yawRate += st.steer * 0.6 * dt; }
  if (boosting) { st.boost = Math.max(0, st.boost - dt * 0.35); if (!grounded) v.addScaledVector(fwd, 12 * dt); }
  else st.boost = Math.min(1, st.boost + dt * (st.air > 0.4 ? 0.3 : 0.08));
  v.multiplyScalar(1 - 0.02 * dt);
  st.vx = v.x; st.vy = v.y; st.vz = v.z; st.yaw += st.yawRate * dt;
  st.x += st.vx * dt; st.y += st.vy * dt; st.z += st.vz * dt;
  const g2 = height(st.x, st.z); if (st.y < g2 - 0.2) { st.y = g2; if (st.vy < 0) st.vy = 0; }
  for (let i = 0; i < colliders.length; i += 3) { const dx = st.x - colliders[i], dz = st.z - colliders[i + 1], r = colliders[i + 2] + 1.2, d2 = dx * dx + dz * dz;
    if (d2 < r * r && st.y - height(colliders[i], colliders[i + 1]) < 7) { const d = Math.sqrt(d2) || 1, nx = dx / d, nz = dz / d; st.x = colliders[i] + nx * r; st.z = colliders[i + 1] + nz * r; const vn = st.vx * nx + st.vz * nz; if (vn < 0) { st.vx -= 1.6 * vn * nx; st.vz -= 1.6 * vn * nz; st.vx *= .6; st.vz *= .6; } } }
  st.up.lerp(grounded ? upv : UPY, Math.min(1, (grounded ? 10 : 1.2) * dt)).normalize();
  return { boosting, wh, grounded, drift, brk, gas };
}
// ---------- dust puffs (1 draw call) ----------
const PN = 180, pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 3), pSize = new Float32Array(PN), pVel = new Float32Array(PN * 3), pAge = new Float32Array(PN).fill(9), pLife = new Float32Array(PN).fill(1), pS0 = new Float32Array(PN);
const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
const puffs = new THREE.Points(pGeo, puffMat()); puffs.frustumCulled = false; scene.add(puffs); let pNext = 0;
function surfCol(x, z, y) { if (trackW(x, z) > 0.4) return [.95, .78, .55]; if (y < WATER + 0.3) return [.92, .97, 1]; if (y < WATER + 2.8) return [.98, .9, .62]; normal(x, z, nv); if (y > 135 && nv[1] > .6) return [.97, .98, 1]; if (nv[1] < .78) return [.75, .7, .72]; return [.92, .9, .72]; }
function emit(x, y, z, vx, vy, vz, size, life, col) {
  const i = pNext; pNext = (pNext + 1) % PN; pPos.set([x, y, z], i * 3); pVel.set([vx, vy, vz], i * 3); pCol.set(col, i * 3); pAge[i] = 0; pLife[i] = life; pS0[i] = size;
}
function updatePuffs(dt) {
  for (let i = 0; i < PN; i++) { if (pAge[i] > pLife[i]) { pSize[i] = 0; continue; } pAge[i] += dt; const k = pAge[i] / pLife[i];
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt; pVel[i * 3 + 1] += 0.5 * dt; pVel[i * 3] *= 1 - 2 * dt; pVel[i * 3 + 2] *= 1 - 2 * dt;
    pSize[i] = pS0[i] * Math.sin(Math.min(1, k) * Math.PI) * (0.6 + k); }
  pGeo.attributes.position.needsUpdate = pGeo.attributes.color.needsUpdate = pGeo.attributes.size.needsUpdate = true;
}
// ---------- skid marks (ring buffer, 1 draw call) ----------
const SKN = 500, skPos = new Float32Array(SKN * 18), skGeo = new THREE.BufferGeometry(); skGeo.setAttribute('position', new THREE.BufferAttribute(skPos, 3));
const skids = new THREE.Mesh(skGeo, decalMat(0x4a3424)); skids.frustumCulled = false; scene.add(skids); let skNext = 0; const skPrev = [null, null];
function skid(w, x, z, rx, rz, on) {
  if (!on) { skPrev[w] = null; return; } const y = height(x, z) + 0.06, p = skPrev[w]; skPrev[w] = [x, y, z];
  if (!p || Math.hypot(x - p[0], z - p[2]) > 6) return; const hw = 0.28, o = skNext * 18;
  const a = [p[0] - rx * hw, p[1], p[2] - rz * hw], b = [p[0] + rx * hw, p[1], p[2] + rz * hw], c = [x - rx * hw, y, z - rz * hw], d = [x + rx * hw, y, z + rz * hw];
  skPos.set([...a, ...c, ...b, ...b, ...c, ...d], o); skNext = (skNext + 1) % SKN; skGeo.attributes.position.needsUpdate = true;
}
// ---------- race: gates/props merged per track ----------
const NCP = 8, propMat = objMat({ gate: true, hatch: 0.8 }); let propMesh = null, propHull = null;
let curTrack = null, race = null; const best = JSON.parse(localStorage.getItem('sinerally_best') || '{}');
function cpPos(t, i) { const th = i / NCP * Math.PI * 2, p = trackPoint(t, th), q = trackPoint(t, th + 0.01); return { x: p[0], z: p[1], ang: Math.atan2(q[0] - p[0], q[1] - p[1]) }; }
let cps = [];
function buildGates(t) {
  curTrack = t; cps = Array.from({ length: NCP }, (_, i) => cpPos(t, i));
  if (propMesh) { scene.remove(propMesh); propMesh.geometry.dispose(); scene.remove(propHull); hulls.splice(hulls.indexOf(propHull), 1); }
  const g = trackProps(cps, height); propMesh = new THREE.Mesh(g, propMat); scene.add(propMesh);
  propHull = new THREE.Mesh(g, objMat({ hull: 0.08 })); propHull.visible = !QUAL[qName].post; scene.add(propHull); hulls.push(propHull);
}
let msgT = 0; function msg(s) { $('msg').textContent = s; $('msg').classList.remove('pop'); void $('msg').offsetWidth; $('msg').classList.add('pop'); msgT = 2; }
const fmt = t => (t / 60 | 0) + ':' + (t % 60).toFixed(2).padStart(5, '0');
function raceUpdate(dt) {
  const t = nearTrack(st.x, st.z); if (t !== curTrack) { buildGates(t); race = null; }
  const near = i => Math.hypot(st.x - cps[i].x, st.z - cps[i].z) < 13;
  if (!race) { if (near(0)) { race = { t: 0, next: 1 }; msg('GO!'); } }
  else { race.t += dt;
    if (race.next < NCP && near(race.next)) { race.next++; msg('CHECKPOINT ' + (race.next - 1) + '/' + (NCP - 1)); }
    else if (race.next === NCP && near(0)) { const b = best[t.id]; if (!b || race.t < b) { best[t.id] = race.t; localStorage.setItem('sinerally_best', JSON.stringify(best)); msg('NEW BEST ' + fmt(race.t)); } else msg('LAP ' + fmt(race.t)); race = { t: 0, next: 1 }; }
    if (Math.hypot(st.x - t.cx, st.z - t.cz) > t.R * 2.2) { race = null; msg('RACE ABANDONED'); } }
  propMat.uniforms.uDone.value = race ? race.next - 1 : 0;
  const b = best[t.id];
  $('race').innerHTML = race ? `LAP ${fmt(race.t)} · CP ${race.next - 1}/${NCP - 1}` + (b ? `<br><small>BEST ${fmt(b)}</small>` : '') : (b ? `TRACK ${t.id} · BEST ${fmt(b)}` : 'FREE ROAM · drive through the checkered gate to race');
}
// ---------- minimap ----------
const mc = $('mini').getContext('2d');
function minimap() {
  const W = 130, sc = 0.08; mc.clearRect(0, 0, W, W); mc.save(); mc.translate(W / 2, W / 2); mc.rotate(st.yaw + Math.PI);
  const t = curTrack; mc.lineCap = 'round';
  for (const [col, lw] of [['#111', 7], ['#e8a860', 4]]) { mc.strokeStyle = col; mc.lineWidth = lw; mc.beginPath();
    for (let i = 0; i <= 64; i++) { const p = trackPoint(t, i / 64 * Math.PI * 2), x = (p[0] - st.x) * sc, y = (p[1] - st.z) * sc; i ? mc.lineTo(-x, y) : mc.moveTo(-x, y); } mc.stroke(); }
  const s = cps[0]; let sx = -(s.x - st.x) * sc, sz = (s.z - st.z) * sc; const d = Math.hypot(sx, sz); if (d > 55) { sx *= 55 / d; sz *= 55 / d; }
  mc.fillStyle = '#fff'; mc.strokeStyle = '#111'; mc.lineWidth = 2; mc.beginPath(); mc.arc(sx, sz, 6, 0, 7); mc.fill(); mc.stroke(); mc.restore();
  mc.fillStyle = '#ff6a1a'; mc.beginPath(); mc.moveTo(W / 2, W / 2 - 8); mc.lineTo(W / 2 - 6, W / 2 + 6); mc.lineTo(W / 2 + 6, W / 2 + 6); mc.closePath(); mc.fill(); mc.stroke();
  mc.fillStyle = '#fff'; mc.font = 'bold 11px sans-serif'; mc.textAlign = 'center'; mc.fillText(Math.round(Math.hypot(s.x - st.x, s.z - st.z)) + ' m', W / 2, W - 10);
}
// ---------- loop ----------
applyQuality();
const camPos = new THREE.Vector3(st.x, st.y + 10, st.z - 15), look = new THREE.Vector3(), F = new THREE.Vector3(), R = new THREE.Vector3(), MB = new THREE.Matrix4(), L = new THREE.Vector3();
let last = performance.now(), acc = 0, fpsT = 0, frames = 0, fps = 0, emitAcc = 0, shake = 0;
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min(0.1, (now - last) / 1000); last = now; U.uTime.value = now / 1000; renderer.info.reset();
  acc += dt; let info; while (acc > 1 / 120) { info = physics(1 / 120); acc -= 1 / 120; } if (!info) return;
  updateTerrain(st.x, st.z); updateScenery(st.x, st.z); raceUpdate(dt);
  car.position.set(st.x, st.y, st.z);
  F.set(Math.sin(st.yaw), 0, Math.cos(st.yaw)); R.crossVectors(st.up, F).normalize(); F.crossVectors(R, st.up);
  car.quaternion.setFromRotationMatrix(MB.makeBasis(R, st.up, F));
  const sp = Math.hypot(st.vx, st.vz), spin = sp * dt / WR;
  // visible suspension travel + steering
  wheels.forEach((g, i) => { const o = WOFF[i]; L.set(o[0], WR, o[1]); car.localToWorld(L);
    const off = Math.max(-0.45, Math.min(0.3, (info.wh[i] + WR - L.y) / Math.max(0.5, st.up.y))); const tgt = info.grounded ? WR + off : WR - 0.35;
    g.position.y += (tgt - g.position.y) * Math.min(1, 20 * dt); if (i < 2) g.rotation.y = st.steer * 0.45; g.children[0].rotation.x += spin; });
  body.rotation.z = -st.vl * 0.006; body.rotation.x = -st.yawRate * 0; body.position.y = 0.05 * Math.sin(now * 0.03) * Math.min(1, sp / 30) * (info.grounded ? 1 : 0);
  flame.visible = info.boosting; flame.scale.set(1, 1, 0.7 + Math.random() * 0.6);
  shadow.position.set(st.x, height(st.x, st.z) + 0.08, st.z); shadow.rotation.y = st.yaw; const sh = Math.max(0.3, 1 - (st.y - shadow.position.y) * 0.08); shadow.scale.set(sh, 1, sh);
  // dust, skids
  emitAcc += dt * (info.grounded && sp > 3 ? Math.min(30, sp * 0.4 + (info.drift ? 15 : 0) + Math.abs(st.vl) * 1.5) : 0);
  if (landed) { for (let k = 0; k < 14; k++) { const a = k / 14 * 6.28; emit(st.x + Math.cos(a) * 1.5, st.y + 0.3, st.z + Math.sin(a) * 1.5, Math.cos(a) * 7, 0.8, Math.sin(a) * 7, 1.6, 0.7, surfCol(st.x, st.z, st.y)); } shake = landed * 0.6; landed = 0; }
  while (emitAcc > 1) { emitAcc--; const w = 2 + (Math.random() * 2 | 0); L.set(WOFF[w][0], 0.3, WOFF[w][1] - 0.3); car.localToWorld(L);
    emit(L.x, L.y, L.z, -st.vx * 0.15 + (Math.random() - .5) * 3 + R.x * st.vl * -.3, 0.5 + Math.random() * 1.2, -st.vz * 0.15 + (Math.random() - .5) * 3 + R.z * st.vl * -.3, 0.6 + Math.random() * 0.7 + Math.abs(st.vl) * 0.03, 0.45 + Math.random() * 0.35, surfCol(L.x, L.z, L.y)); }
  updatePuffs(dt);
  const sk = info.grounded && (Math.abs(st.vl) > 4 || (info.brk && sp > 8));
  for (let w = 0; w < 2; w++) { L.set(WOFF[w + 2][0], 0, WOFF[w + 2][1]); car.localToWorld(L); skid(w, L.x, L.z, R.x, R.z, sk); }
  // chase camera with FOV kick & landing shake
  const back = 9 + sp * 0.06; const tgt = tmp.set(st.x - F.x * back, Math.max(st.y + 4, height(st.x - F.x * back, st.z - F.z * back) + 2.5), st.z - F.z * back);
  camPos.lerp(tgt, Math.min(1, 5 * dt)); camera.position.copy(camPos); shake *= 1 - 6 * dt; camera.position.y += (Math.random() - .5) * shake;
  look.set(st.x, st.y + 1.5, st.z); camera.lookAt(look);
  camera.fov += ((info.boosting ? 80 : 64 + sp * 0.08) - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  sky.position.copy(camera.position);
  post.uniforms.uBoost.value += ((info.boosting ? 1 : 0) - post.uniforms.uBoost.value) * Math.min(1, 6 * dt);
  $('spd').textContent = Math.round(sp * 3.6); $('bar').style.width = (st.boost * 100) + '%';
  $('air').textContent = st.air > 0.5 ? 'AIR ' + st.air.toFixed(1) + 's!' : '';
  if (msgT > 0 && (msgT -= dt) <= 0) $('msg').textContent = '';
  minimap();
  if (QUAL[qName].post) { renderer.setRenderTarget(rt); renderer.render(scene, camera); renderer.setRenderTarget(null); renderer.render(postScene, postCam); }
  else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; window.__fps = fps;
    if (dbg) $('dbg').textContent = `${fps.toFixed(0)} fps  ${qName}\ncalls ${renderer.info.render.calls}\ntris ${renderer.info.render.triangles}\n${st.x.toFixed(0)},${st.z.toFixed(0)} y${st.y.toFixed(0)}`; }
}
requestAnimationFrame(frame);
window.__st = st;
