import * as THREE from 'three';
import { height, normal, colour, WATER, nearTrack, trackPoint, trackR, trackW, hash2 } from './world.js';
const $ = id => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight); document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const FOG = new THREE.Color(0xbfe6ff); scene.fog = new THREE.Fog(FOG, 150, 560);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.5, 1200);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
// toon ramp
const ramp = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 180, 180, 180, 255, 255, 255, 255, 255]), 3, 1);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const toon = (c, o = {}) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp, ...o });
scene.add(new THREE.HemisphereLight(0xffffff, 0x88aa66, 1.1));
const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(0.5, 1, 0.3); scene.add(sun);
// sky gradient dome
const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 16, 8), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying float h;void main(){h=normalize(position).y;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: 'varying float h;void main(){vec3 a=vec3(.75,.9,1.),b=vec3(.25,.55,.95);gl_FragColor=vec4(mix(a,b,clamp(h*1.6,0.,1.)),1.);}' }));
scene.add(sky);
// ---------- terrain: moving grid recentred on player, heights from height(x,z) ----------
const N = 144, STEP = 8, HALF = N * STEP / 2;
const tgeo = new THREE.PlaneGeometry(N * STEP, N * STEP, N, N); tgeo.rotateX(-Math.PI / 2);
const tpos = tgeo.attributes.position, tcol = new Float32Array(tpos.count * 3), tnor = tgeo.attributes.normal;
tgeo.setAttribute('color', new THREE.BufferAttribute(tcol, 3));
const terrain = new THREE.Mesh(tgeo, toon(0xffffff, { vertexColors: true })); terrain.frustumCulled = false; scene.add(terrain);
const baseXZ = Float32Array.from({ length: tpos.count * 2 }, (_, i) => i & 1 ? tpos.getZ(i >> 1) : tpos.getX(i >> 1));
let gx = 1e9, gz = 1e9; const nv = [0, 0, 0], cv = [0, 0, 0];
function updateTerrain(px, pz) {
  const sx = Math.round(px / STEP) * STEP, sz = Math.round(pz / STEP) * STEP;
  if (sx === gx && sz === gz) return; gx = sx; gz = sz;
  terrain.position.set(sx, 0, sz);
  for (let i = 0; i < tpos.count; i++) {
    const x = baseXZ[i * 2] + sx, z = baseXZ[i * 2 + 1] + sz, y = height(x, z);
    tpos.setY(i, y); normal(x, z, nv); tnor.setXYZ(i, nv[0], nv[1], nv[2]);
    colour(x, z, y, nv[1], cv); tcol[i * 3] = cv[0]; tcol[i * 3 + 1] = cv[1]; tcol[i * 3 + 2] = cv[2];
  }
  tpos.needsUpdate = tnor.needsUpdate = true; tgeo.attributes.color.needsUpdate = true;
}
const water = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), toon(0x3aa7e8, { transparent: true, opacity: 0.8 }));
water.position.y = WATER; scene.add(water);
// ---------- scenery: instanced, placed by hash per 14m cell ----------
const MAXI = 1400, SC = 14, SR = 260;
const treeGeo = new THREE.ConeGeometry(3, 9, 6).translate(0, 7, 0), trunkGeo = new THREE.CylinderGeometry(.6, .8, 3, 5).translate(0, 1.5, 0), rockGeo = new THREE.DodecahedronGeometry(2.2, 0);
const trees = new THREE.InstancedMesh(treeGeo, toon(0x2f9a48), MAXI), trunks = new THREE.InstancedMesh(trunkGeo, toon(0x8a5a32), MAXI), rocks = new THREE.InstancedMesh(rockGeo, toon(0x9a95a5), 600);
[trees, trunks, rocks].forEach(m => { m.frustumCulled = false; scene.add(m); });
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), Sv = new THREE.Vector3(), E = new THREE.Euler();
let scx = 1e9, scz = 1e9; const colliders = [];
function updateScenery(px, pz) {
  const cx = Math.round(px / 40), cz = Math.round(pz / 40); if (cx === scx && cz === scz) return; scx = cx; scz = cz;
  let nt = 0, nr = 0; colliders.length = 0; const r = Math.ceil(SR / SC);
  const ox = Math.floor(px / SC), oz = Math.floor(pz / SC);
  for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) {
    if (i * i + j * j > r * r) continue; const ci = ox + i, cj = oz + j, h = hash2(ci, cj, 9);
    const x = (ci + hash2(ci, cj, 7)) * SC, z = (cj + hash2(ci, cj, 8)) * SC;
    const dens = 0.35 + 0.3 * Math.sin(x * 0.003) * Math.cos(z * 0.0037);
    if (h > dens + 0.15 && h > 0.5) continue;
    const y = height(x, z); if (y < WATER + 3 || trackW(x, z) > 0) continue;
    normal(x, z, nv); const s = 0.7 + hash2(ci, cj, 6) * 0.8;
    if (h < dens && nv[1] > 0.82 && y < 120 && nt < MAXI) {
      Q.setFromEuler(E.set(0, h * 20, 0)); M.compose(V.set(x, y - 0.5, z), Q, Sv.set(s, s * (0.8 + h), s));
      trees.setMatrixAt(nt, M); trunks.setMatrixAt(nt++, M); colliders.push(x, z, 1.5 * s);
    } else if (h > 0.93 && nr < 600) {
      Q.setFromEuler(E.set(h * 9, h * 30, h * 3)); M.compose(V.set(x, y, z), Q, Sv.set(s * 1.3, s, s * 1.2)); rocks.setMatrixAt(nr++, M); colliders.push(x, z, 2.4 * s);
    }
  }
  trees.count = trunks.count = nt; rocks.count = nr;
  trees.instanceMatrix.needsUpdate = trunks.instanceMatrix.needsUpdate = rocks.instanceMatrix.needsUpdate = true;
}
// ---------- car ----------
const car = new THREE.Group(); scene.add(car);
const body = new THREE.Group(); car.add(body);
const bm = new THREE.Mesh(new THREE.BoxGeometry(2, .7, 4).translate(0, .9, 0), toon(0xff4a3d)); body.add(bm);
const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, .6, 1.9).translate(0, 1.55, -.3), toon(0xfff2d0)); body.add(cab);
const wheelGeo = new THREE.CylinderGeometry(.55, .55, .45, 8).rotateZ(Math.PI / 2), wmat = toon(0x333344);
const WOFF = [[-1.05, 1.35], [1.05, 1.35], [-1.05, -1.35], [1.05, -1.35]], wheels = WOFF.map(o => { const w = new THREE.Mesh(wheelGeo, wmat); w.position.set(o[0], .55, o[1]); car.add(w); return w; });
const flame = new THREE.Mesh(new THREE.ConeGeometry(.35, 1.6, 6).rotateX(-Math.PI / 2).translate(0, .9, -2.6), new THREE.MeshBasicMaterial({ color: 0xffaa22 })); body.add(flame);
const st = { x: 0, z: 0, y: 0, vx: 0, vy: 0, vz: 0, yaw: 0, yawRate: 0, air: 0, boost: 1, up: new THREE.Vector3(0, 1, 0) };
function spawn(x, z, yaw = 0) {
  // find dry land near (x,z)
  for (let k = 0; k < 200 && height(x, z) < WATER + 2; k++) { x += 37; z += 23; }
  Object.assign(st, { x, z, y: height(x, z) + 2, vx: 0, vy: 0, vz: 0, yaw, yawRate: 0 });
}
{ const t = nearTrack(0, 0), p = trackPoint(t, 0), q = trackPoint(t, 0.02); spawn(p[0], p[1], Math.atan2(q[0] - p[0], q[1] - p[1])); }
// ---------- input ----------
const key = {}; addEventListener('keydown', e => { key[e.code] = 1; if (e.code === 'KeyR') reset(); if (e.code === 'KeyF') toggleDbg(); });
addEventListener('keyup', e => key[e.code] = 0);
const touch = { steer: 0, gas: 0, brk: 0, bst: 0, drf: 0 }; let tilt = false, tiltSteer = 0;
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) { $('joy').style.display = 'block'; ['bGas', 'bBrk', 'bBst', 'bDrf'].forEach(b => $(b).style.display = 'flex'); }
const joy = $('joy'), knob = $('knob'); let joyId = null;
joy.addEventListener('touchstart', e => { joyId = e.changedTouches[0].identifier; joyMove(e); e.preventDefault(); }, { passive: false });
joy.addEventListener('touchmove', e => { joyMove(e); e.preventDefault(); }, { passive: false });
const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; touch.steer = 0; knob.style.transform = ''; } };
joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);
function joyMove(e) { for (const t of e.changedTouches) if (t.identifier === joyId) { const r = joy.getBoundingClientRect(); let dx = (t.clientX - r.left - r.width / 2) / 55; dx = Math.max(-1, Math.min(1, dx)); touch.steer = dx; knob.style.transform = `translateX(${dx * 45}px)`; } }
[['bGas', 'gas'], ['bBrk', 'brk'], ['bBst', 'bst'], ['bDrf', 'drf']].forEach(([id, k]) => {
  const el = $(id); el.addEventListener('touchstart', e => { touch[k] = 1; e.preventDefault(); }, { passive: false });
  el.addEventListener('touchend', () => touch[k] = 0); el.addEventListener('touchcancel', () => touch[k] = 0);
});
$('tTilt').onclick = async () => {
  if (!tilt && typeof DeviceOrientationEvent !== 'undefined' && DeviceOrientationEvent.requestPermission) { try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') return; } catch (e) { return; } }
  tilt = !tilt; $('tTilt').textContent = 'Tilt: ' + (tilt ? 'on' : 'off');
};
addEventListener('deviceorientation', e => { const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0; const v = a === 90 ? e.beta : a === -90 || a === 270 ? -e.beta : e.gamma; tiltSteer = Math.max(-1, Math.min(1, (v || 0) / 25)); });
$('tReset').onclick = () => reset(); $('tDbg').onclick = () => toggleDbg();
let dbg = false; function toggleDbg() { dbg = !dbg; if (!dbg) $('dbg').textContent = ''; }
function reset() { const n = [0, 0, 0]; let x = st.x, z = st.z; for (let k = 0; k < 40; k++) { normal(x, z, n); if (n[1] > 0.85 && height(x, z) > WATER + 2) break; x += 6 * Math.sin(st.yaw + k); z += 6 * Math.cos(st.yaw + k); } spawn(x, z, st.yaw); }
// ---------- physics ----------
const n0 = [0, 0, 0], fwd = new THREE.Vector3(), right = new THREE.Vector3(), upv = new THREE.Vector3(), tmp = new THREE.Vector3();
const G = 22, RIDE = 0.0;
function physics(dt) {
  const steer = Math.max(-1, Math.min(1, (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0) - touch.steer - (tilt ? tiltSteer : 0)));
  const gas = key.KeyW || key.ArrowUp || touch.gas ? 1 : 0, brk = key.KeyS || key.ArrowDown || touch.brk ? 1 : 0;
  const drift = key.Space || touch.drf, boosting = (key.ShiftLeft || key.ShiftRight || touch.bst) && st.boost > 0;
  // 4-point suspension: sample ground at each wheel
  const sy = Math.sin(st.yaw), cy = Math.cos(st.yaw); let gmax = -1e9, gavg = 0; const wh = [];
  for (const [ox, oz] of WOFF) { const wx = st.x + ox * cy + oz * sy, wz = st.z - ox * sy + oz * cy, h = height(wx, wz); wh.push(h); gavg += h / 4; gmax = Math.max(gmax, h); }
  // plane normal from wheel contacts
  const hF = (wh[0] + wh[1]) / 2, hB = (wh[2] + wh[3]) / 2, hL = (wh[0] + wh[2]) / 2, hR = (wh[1] + wh[3]) / 2;
  fwd.set(sy, (hF - hB) / 2.7, cy).normalize(); right.set(-cy, (hR - hL) / 2.1, sy).normalize();
  upv.crossVectors(fwd, right).normalize(); if (upv.y < 0) upv.negate();
  right.crossVectors(upv, fwd).negate(); // keep orthonormal
  const ground = Math.max(gavg, (gmax + gavg) / 2), inWater = ground < WATER - 0.6;
  const gap = st.y - ground; const grounded = gap < 0.35;
  st.vy -= G * dt;
  const v = tmp.set(st.vx, st.vy, st.vz);
  if (grounded) {
    st.air = 0;
    // suspension spring + damper
    const comp = Math.max(0, 0.35 - gap); const vn = v.dot(upv);
    v.addScaledVector(upv, (comp * 260 - vn * 9 * (vn < 0 ? 1 : 0.3)) * dt);
    if (gap < 0) { st.y = ground; const vn2 = v.dot(upv); if (vn2 < 0) v.addScaledVector(upv, -vn2 * 1.2); }
    // local velocities
    const flat = new THREE.Vector3(sy, 0, cy);
    let vf = v.dot(fwd), vl = v.dot(right);
    const maxV = boosting ? 58 : 42;
    if (gas) vf += (vf < maxV ? (boosting ? 34 : 20) : 0) * dt;
    if (brk) vf -= (vf > 0.5 ? 40 : 14) * dt; if (brk && vf < -14) vf = -14;
    if (!gas && !brk) vf *= 1 - 0.5 * dt;
    if (inWater) vf *= 1 - 1.6 * dt;
    const grip = drift ? 1.8 : 7.5; vl *= Math.max(0, 1 - grip * dt);
    // rebuild velocity in plane, preserving normal component
    const vn3 = v.dot(upv);
    v.set(0, 0, 0).addScaledVector(fwd, vf).addScaledVector(right, vl).addScaledVector(upv, vn3);
    // steering: rate scales with speed, stronger yaw when drifting
    const sp = Math.abs(vf), target = steer * Math.min(1, sp / 8) * (drift ? 2.3 : 1.5) / (1 + sp * 0.02) * Math.sign(vf || 1);
    st.yawRate += (target - st.yawRate) * Math.min(1, 8 * dt);
  } else { st.air += dt; st.yawRate *= 1 - 0.8 * dt; st.yawRate += steer * 0.6 * dt; }
  if (boosting) { st.boost = Math.max(0, st.boost - dt * 0.35); if (!grounded) v.addScaledVector(fwd, 12 * dt); }
  else st.boost = Math.min(1, st.boost + dt * (st.air > 0.4 ? 0.3 : 0.08)); // airtime refills boost
  v.multiplyScalar(1 - 0.02 * dt);
  st.vx = v.x; st.vy = v.y; st.vz = v.z; st.yaw += st.yawRate * dt;
  st.x += st.vx * dt; st.y += st.vy * dt; st.z += st.vz * dt;
  const g2 = height(st.x, st.z); if (st.y < g2 - 0.2) { st.y = g2; if (st.vy < 0) st.vy = 0; }
  // tree / rock collisions
  for (let i = 0; i < colliders.length; i += 3) { const dx = st.x - colliders[i], dz = st.z - colliders[i + 1], r = colliders[i + 2] + 1.2, d2 = dx * dx + dz * dz;
    if (d2 < r * r && st.y - height(colliders[i], colliders[i + 1]) < 7) { const d = Math.sqrt(d2) || 1, nx = dx / d, nz = dz / d; st.x = colliders[i] + nx * r; st.z = colliders[i + 1] + nz * r; const vn = st.vx * nx + st.vz * nz; if (vn < 0) { st.vx -= 1.6 * vn * nx; st.vz -= 1.6 * vn * nz; st.vx *= .6; st.vz *= .6; } } }
  st.up.lerp(grounded ? upv : tmp.set(0, 1, 0), Math.min(1, (grounded ? 10 : 1.2) * dt)).normalize();
  return { boosting, wh, grounded };
}
// ---------- race: gates on nearest track ----------
const NCP = 8, gateGeo = new THREE.BoxGeometry(1, 7, 1).translate(0, 3.5, 0), barGeo = new THREE.BoxGeometry(22, 1.2, 1).translate(0, 7.3, 0);
const gates = new THREE.Group(); scene.add(gates); const gateMat = toon(0xffd23c), startMat = toon(0xffffff), doneMat = toon(0x55dd66);
let curTrack = null, race = null; const best = JSON.parse(localStorage.getItem('sinerally_best') || '{}');
function cpPos(t, i) { const th = i / NCP * Math.PI * 2, p = trackPoint(t, th), q = trackPoint(t, th + 0.01); return { x: p[0], z: p[1], ang: Math.atan2(q[0] - p[0], q[1] - p[1]) }; }
function buildGates(t) {
  gates.clear(); curTrack = t;
  for (let i = 0; i < NCP; i++) { const c = cpPos(t, i), y = height(c.x, c.z), g = new THREE.Group(), m = i ? gateMat : startMat;
    [-11, 11].forEach(o => { const p = new THREE.Mesh(gateGeo, m); p.position.x = o; g.add(p); }); g.add(new THREE.Mesh(barGeo, m));
    g.position.set(c.x, y, c.z); g.rotation.y = c.ang + Math.PI / 2 - Math.PI / 2; g.rotateY(Math.PI / 2 - Math.PI / 2); g.rotation.y = c.ang + Math.PI / 2; g.userData = c; gates.add(g); }
}
let msgT = 0; function msg(s) { $('msg').textContent = s; msgT = 2; }
const fmt = t => (t / 60 | 0) + ':' + (t % 60).toFixed(2).padStart(5, '0');
function raceUpdate(dt) {
  const t = nearTrack(st.x, st.z); if (t !== curTrack) { buildGates(t); race = null; }
  const near = i => { const c = gates.children[i].userData; return Math.hypot(st.x - c.x, st.z - c.z) < 13; };
  if (!race) { if (near(0)) { race = { t: 0, next: 1, lap: 0 }; msg('GO!'); gates.children.forEach((g, i) => i && g.children.forEach(m => m.material = gateMat)); } }
  else { race.t += dt;
    if (race.next < NCP && near(race.next)) { gates.children[race.next].children.forEach(m => m.material = doneMat); race.next++; msg('CP ' + (race.next - 1) + '/' + (NCP - 1)); }
    else if (race.next === NCP && near(0)) { const b = best[t.id]; if (!b || race.t < b) { best[t.id] = race.t; localStorage.setItem('sinerally_best', JSON.stringify(best)); msg('NEW BEST ' + fmt(race.t)); } else msg('LAP ' + fmt(race.t));
      race = { t: 0, next: 1 }; gates.children.forEach((g, i) => i && g.children.forEach(m => m.material = gateMat)); }
    if (Math.hypot(st.x - t.cx, st.z - t.cz) > t.R * 2.2) { race = null; msg('Race abandoned'); } }
  const b = best[t.id];
  $('race').innerHTML = race ? `LAP ${fmt(race.t)} · CP ${race.next - 1}/${NCP - 1}` + (b ? `<br>best ${fmt(b)}` : '') : (b ? `Track ${t.id} best ${fmt(b)}` : 'Free roam – drive into a white gate to race');
}
// ---------- minimap ----------
const mc = $('mini').getContext('2d');
function minimap() {
  const W = 130, sc = 0.08; mc.clearRect(0, 0, W, W); mc.save(); mc.translate(W / 2, W / 2); mc.rotate(st.yaw + Math.PI);
  const t = curTrack; mc.strokeStyle = '#c8955a'; mc.lineWidth = 3; mc.beginPath();
  for (let i = 0; i <= 64; i++) { const p = trackPoint(t, i / 64 * Math.PI * 2), x = (p[0] - st.x) * sc, y = (p[1] - st.z) * sc; i ? mc.lineTo(-x, y) : mc.moveTo(-x, y); } mc.stroke();
  const s = cpPos(t, 0); let sx = -(s.x - st.x) * sc, sz = (s.z - st.z) * sc; const d = Math.hypot(sx, sz); if (d > 55) { sx *= 55 / d; sz *= 55 / d; }
  mc.fillStyle = '#fff'; mc.beginPath(); mc.arc(sx, sz, 5, 0, 7); mc.fill(); mc.restore();
  mc.fillStyle = '#ff4a3d'; mc.beginPath(); mc.moveTo(W / 2, W / 2 - 7); mc.lineTo(W / 2 - 5, W / 2 + 5); mc.lineTo(W / 2 + 5, W / 2 + 5); mc.fill();
  mc.fillStyle = '#fff'; mc.font = 'bold 10px sans-serif'; mc.fillText(Math.round(Math.hypot(s.x - st.x, s.z - st.z)) + 'm', W / 2 - 14, W - 8);
}
// ---------- loop ----------
const camPos = new THREE.Vector3(st.x, st.y + 10, st.z - 15), look = new THREE.Vector3();
let last = performance.now(), acc = 0, fpsT = 0, frames = 0, fps = 0;
function frame(now) {
  requestAnimationFrame(frame); let dt = Math.min(0.1, (now - last) / 1000); last = now;
  acc += dt; let info; while (acc > 1 / 120) { info = physics(1 / 120); acc -= 1 / 120; } if (!info) return;
  updateTerrain(st.x, st.z); updateScenery(st.x, st.z); raceUpdate(dt);
  car.position.set(st.x, st.y, st.z);
  const f = new THREE.Vector3(Math.sin(st.yaw), 0, Math.cos(st.yaw)); const r = new THREE.Vector3().crossVectors(st.up, f).normalize(); f.crossVectors(r, st.up);
  car.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, st.up, f));
  const sp = Math.hypot(st.vx, st.vz);
  wheels.forEach((w, i) => { w.rotation.x += sp * dt / 0.55; if (i < 2) w.rotation.y = 0; });
  flame.visible = info.boosting; flame.scale.setScalar(0.8 + Math.random() * 0.5);
  // chase camera
  const back = 9 + sp * 0.06; const tgt = tmp.set(st.x - f.x * back, Math.max(st.y + 4, height(st.x - f.x * back, st.z - f.z * back) + 2.5), st.z - f.z * back);
  camPos.lerp(tgt, Math.min(1, 5 * dt)); camera.position.copy(camPos); look.set(st.x, st.y + 1.5, st.z); camera.lookAt(look);
  camera.fov += ((info.boosting ? 78 : 65) - camera.fov) * Math.min(1, 3 * dt); camera.updateProjectionMatrix();
  sky.position.copy(camera.position); water.position.set(gx, WATER, gz);
  $('speed').textContent = Math.round(sp * 3.6) + ' km/h  ' + '▮'.repeat(Math.round(st.boost * 8)) + (st.air > 0.5 ? '  AIR ' + st.air.toFixed(1) + 's' : '');
  if (msgT > 0 && (msgT -= dt) <= 0) $('msg').textContent = '';
  minimap(); renderer.render(scene, camera);
  frames++; fpsT += dt; if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; if (dbg) $('dbg').textContent = `${fps.toFixed(0)} fps\ncalls ${renderer.info.render.calls}\ntris ${renderer.info.render.triangles}\n${st.x.toFixed(0)},${st.z.toFixed(0)} y${st.y.toFixed(0)}`; }
}
requestAnimationFrame(frame);
window.__st = st;
