// Terrain module standalone test build. Stub camera/car only — the real physics module replaces the stub HP rule.
import * as THREE from 'three';
import { createTerrain, uniforms as U, world as W } from '../terrain/index.js';
import { COMIC } from '../terrain/comic.js';
import { postMat } from './post.js';

const Q = new URLSearchParams(location.search);
const touch = matchMedia('(pointer:coarse)').matches; if (touch) document.body.classList.add('touch');
if (Q.has('clean')) document.body.classList.add('clean');
const small = touch || Q.get('q') === 'low';

// ---- tiny event bus (same shape the game uses: on/off/emit) ----
const bus = { m: new Map(), on(t, f) { (this.m.get(t) || this.m.set(t, []).get(t)).push(f); }, off(t, f) { const a = this.m.get(t); if (a) a.splice(a.indexOf(f) >>> 0, 1); }, emit(t, d) { (this.m.get(t) || []).slice().forEach(f => f(d)); } };
const logEl = document.getElementById('log'), logs = [];
const log = s => { logs.unshift(s); logs.length = Math.min(logs.length, 8); logEl.textContent = logs.join('\n'); };
['tree:damaged', 'tree:removed', 'tree:burning', 'tree:burnt', 'tree:extinguished', 'fire:ignite', 'fire:out', 'weather:lightning'].forEach(t => bus.on(t, d => log(t + ' ' + (d && d.id !== undefined ? d.id : d && d.cells !== undefined ? d.cells : ''))));

// ---- renderer like the game: RT with depth texture -> comic post quad ----
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio || 1, small ? 1.5 : 2); renderer.setPixelRatio(1);
document.body.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, 1, 0.4, 1700);
const rt = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1), type: THREE.UnsignedByteType });
const post = postMat(); post.uniforms.tCol.value = rt.texture; post.uniforms.tDep.value = rt.depthTexture; post.uniforms.uN.value = camera.near; post.uniforms.uF.value = camera.far;
const pScene = new THREE.Scene(), pCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
pScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), post));
const RS = small ? 0.75 : 1;
function resize() {
  const w = innerWidth, h = innerHeight, k = DPR * RS; renderer.setSize(w, h); renderer.setPixelRatio(k);
  rt.setSize(Math.floor(w * k), Math.floor(h * k)); post.uniforms.uRes.value.set(Math.floor(w * k), Math.floor(h * k));
  U.uPx.value = Math.max(1, k); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// ---- terrain module ----
const T = createTerrain({ bus, small, persistKey: Q.has('persist') ? 'sinerally-terrain-test' : null });
T.setup(scene);

// ---- stub car (comic box) ----
function objMat(hex) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uCol: { value: new THREE.Color().setHex(hex, THREE.LinearSRGBColorSpace) } },
    vertexShader: `varying vec3 vN, vW; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMIC + `uniform vec3 uCol; varying vec3 vN, vW; void main(){ vec3 N = normalize(vN); gl_FragColor = vec4(comic(uCol, N, vW, 1.), ncode(N)); }` });
}
const car = new THREE.Group();
const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 4.2), objMat(0xe4572e)); body.position.y = 0.75; car.add(body);
const cab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.55, 2.0), objMat(0x2e3a59)); cab.position.set(0, 1.35, -0.2); car.add(cab);
const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10); wg.rotateZ(Math.PI / 2); const wm = objMat(0x1a1a1a);
[[-0.95, 1.4], [0.95, 1.4], [-0.95, -1.4], [0.95, -1.4]].forEach(([x, z]) => { const w = new THREE.Mesh(wg, wm); w.position.set(x, 0.42, z); car.add(w); });
car.visible = false; scene.add(car);

// ---- camera state ----
const S = { t: 0, mode: 'fly', x: 0, y: 40, z: 0, yaw: 0.6, pitch: -0.18, car: { x: 0, z: 0, h: 0, v: 0 }, hot: false, hotT: 0, cd: new Map() };
const keys = new Set();
addEventListener('keydown', e => { keys.add(e.code); if (e.code === 'KeyF') ignite(); });
addEventListener('keyup', e => keys.delete(e.code));
document.querySelectorAll('#pad button').forEach(b => { const k = b.dataset.k; b.addEventListener('pointerdown', e => { e.stopPropagation(); keys.add(k); }); ['pointerup', 'pointerleave', 'pointercancel'].forEach(t => b.addEventListener(t, () => keys.delete(k))); });
let drag = null;
renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
addEventListener('pointerup', () => drag = null);
addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (S.mode === 'fly') { S.yaw -= dx * 0.005; S.pitch = Math.max(-1.45, Math.min(1.2, S.pitch - dy * 0.005)); } else S.orbit = (S.orbit || 0) - dx * 0.006; });

function placeCar(x, z, h) { S.car.x = x; S.car.z = z; S.car.h = h ?? S.yaw; S.car.v = 0; }
function setMode(m) { S.mode = m; car.visible = m === 'drive'; document.getElementById('mFly').classList.toggle('on', m === 'fly'); document.getElementById('mDrive').classList.toggle('on', m === 'drive');
  if (m === 'drive') placeCar(S.x, S.z, S.yaw); }
document.getElementById('mFly').onclick = () => { if (S.mode === 'drive') { S.x = S.car.x; S.z = S.car.z; S.y = T.heightAt(S.x, S.z) + 25; } setMode('fly'); };
document.getElementById('mDrive').onclick = () => setMode('drive');
document.getElementById('uiH').onclick = () => document.getElementById('ui').classList.toggle('min');

// ---- stub physics HP rule (physics module owns this in the game) ----
// >300 km/h: all 3 HP gone, car zooms through. <=200: 1..2 HP by speed*angle (tree survives a single hit). 200..300: 2..3 by speed*angle.
function treeHit(t, kmh, hitCos) {
  if (kmh > 300) return 3;
  const head = 0.3 + 0.7 * Math.max(0, hitCos); // glancing blows do less
  if (kmh < 15) return 0;
  if (kmh <= 200) return Math.max(1, Math.min(2, Math.round(kmh / 100 * head)));
  return Math.min(3, Math.round(2 + (kmh - 200) / 100 * head));
}
function carPhysics(dt) {
  const c = S.car, f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const st = (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) - (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0);
  const surf = T.surfaceAt(c.x, c.z), vmax = 100 * (keys.has('ShiftLeft') ? 1.3 : 1); // m/s (~360 km/h with shift)
  c.v += (f * 22 * surf.grip - c.v * 0.12 * (1 - surf.grip * 0.5)) * dt; c.v = Math.max(-15, Math.min(vmax, c.v));
  c.h += st * dt * 1.6 * Math.min(1, Math.abs(c.v) / 8) * Math.sign(c.v || 1) / (1 + Math.abs(c.v) / 60);
  const dx = Math.sin(c.h), dz = Math.cos(c.h);
  const nx = c.x + dx * c.v * dt, nz = c.z + dz * c.v * dt, kmh = Math.abs(c.v) * 3.6;
  let blocked = false;
  for (const t of T.queryTrees((c.x + nx) / 2, (c.z + nz) / 2, 2.2 + Math.abs(c.v * dt))) {
    if (t.hp <= 0 || (S.cd.get(t.id) || 0) > S.t) continue;
    const tx = t.pos.x - c.x, tz = t.pos.z - c.z, d = Math.hypot(tx, tz) || 1;
    const cos = (tx * dx + tz * dz) / d; if (cos < 0.2 && d > 1.3) continue;
    S.cd.set(t.id, S.t + 0.6);
    const dmg = treeHit(t, kmh, cos), hp = Math.max(0, t.hp - dmg);
    if (dmg > 0) bus.emit('tree:damage', { id: t.id, amount: dmg, dir: { x: dx, z: dz }, speed: kmh });
    if (hp <= 0) { bus.emit('tree:destroyed', { id: t.id, speed: kmh }); if (kmh <= 300) c.v *= 0.55; }
    else { blocked = true; c.v = -c.v * 0.25; }
    log(`hit ${t.species} @${kmh.toFixed(0)}km/h dmg ${dmg} -> hp ${hp}`);
  }
  if (!blocked) { c.x = nx; c.z = nz; }
  const y = T.heightAt(c.x, c.z), n = T.normalAt(c.x, c.z);
  car.position.set(c.x, y, c.z);
  car.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.h));
  const oy = c.h + Math.PI + (S.orbit || 0);
  const cx = c.x + Math.sin(oy) * 9, cz = c.z + Math.cos(oy) * 9;
  camera.position.set(cx, Math.max(T.heightAt(cx, cz) + 1.5, y + 3.6), cz); camera.lookAt(c.x, y + 1.4, c.z);
  S.x = c.x; S.z = c.z; S.kmh = kmh;
}
function flyCam(dt) {
  const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 120 : 30) * dt;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const r = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const u = (keys.has('KeyE') ? 1 : 0) - (keys.has('KeyQ') ? 1 : 0);
  if (touch && keys.size === 0) { /* idle */ }
  const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
  S.x += (fx * f - fz * r) * sp; S.z += (fz * f + fx * r) * sp; S.y += u * sp;
  S.y = Math.max(T.heightAt(S.x, S.z) + 1.6, S.y);
  camera.position.set(S.x, S.y, S.z); camera.rotation.set(S.pitch, S.yaw, 0, 'YXZ'); S.kmh = 0;
}
// point on the ground the camera looks at (march) — used for IGNITE
function aimPoint() {
  if (S.mode === 'drive') { const c = S.car; return { x: c.x + Math.sin(c.h) * 12, z: c.z + Math.cos(c.h) * 12 }; }
  const d = new THREE.Vector3(); camera.getWorldDirection(d); const p = camera.position.clone();
  for (let i = 0; i < 400; i++) { p.addScaledVector(d, 2); if (p.y < T.heightAt(p.x, p.z)) return { x: p.x, z: p.z }; }
  return { x: S.x + d.x * 30, z: S.z + d.z * 30 };
}
function ignite() { const p = aimPoint(); const n = T.ignite(p.x, p.z, { radius: 4, cause: 'test' }); log(`ignite ${T.biomeAt(p.x, p.z)} -> ${n} cells`); return n; }
const carPos = () => S.mode === 'drive' ? { x: S.car.x, z: S.car.z } : aimPoint();

// ---- UI wiring ----
const tp = document.getElementById('tp'), bcache = {};
['grassland', 'savanna', 'forest', 'desert', 'alpine', 'canyon'].forEach(b => { const e = document.createElement('button'); e.textContent = b; e.onclick = () => teleport(b); tp.appendChild(e); });
function teleport(b, alt = 26) {
  const p = bcache[b] || (bcache[b] = T.findBiome(b, 0, 0)); if (!p) { log('no ' + b + ' found'); return null; }
  S.x = p.x; S.z = p.z; S.y = T.heightAt(p.x, p.z) + alt; if (S.mode === 'drive') placeCar(p.x, p.z, S.car.h);
  T.snapWeather && T.snapWeather(); log('teleport ' + b + ` ${p.x | 0},${p.z | 0}`); return p;
}
const wDir = document.getElementById('wDir'), wSpd = document.getElementById('wSpd');
const setWind = () => { T.setWind(+wDir.value * Math.PI / 180, +wSpd.value); document.getElementById('wV').textContent = wSpd.value; };
wDir.oninput = wSpd.oninput = setWind; setWind();
document.getElementById('ign').onclick = ignite;
const hotB = document.getElementById('hot'); hotB.onclick = () => { S.hot = !S.hot; hotB.classList.toggle('on', S.hot); };
document.getElementById('ovh').onclick = () => { const p = carPos(); bus.emit('engine:overheat', { position: p, temp: 135 }); log('engine:overheat'); };
document.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { T.setRain(b.dataset.r); document.querySelectorAll('[data-r]').forEach(x => x.classList.toggle('on', x === b)); });
document.getElementById('bolt').onclick = () => T.strike();
const tod = document.getElementById('tod'), todA = document.getElementById('todA');
tod.oninput = () => { T.setTimeOfDay(+tod.value / 1000, false); todA.classList.remove('on'); };
todA.onclick = () => { const on = !todA.classList.contains('on'); todA.classList.toggle('on', on); T.setTimeOfDay(+tod.value / 1000, on); };
function nearestTree(r = 40) { const p = S.mode === 'drive' ? S.car : aimPoint(); let best = null, bd = 1e9;
  for (const t of T.queryTrees(p.x, p.z, r)) { if (t.hp <= 0) continue; const d = Math.hypot(t.pos.x - p.x, t.pos.z - p.z); if (d < bd) { bd = d; best = t; } } return best; }
document.getElementById('hit').onclick = () => { const t = nearestTree(); if (!t) return; const hp = t.hp - 1;
  bus.emit('tree:damage', { id: t.id, amount: 1, dir: { x: Math.sin(S.yaw), z: Math.cos(S.yaw) } }); if (hp <= 0) bus.emit('tree:destroyed', { id: t.id }); };
document.getElementById('burnT').onclick = () => { const t = nearestTree(); if (t) T.igniteTree(t.id); };
document.getElementById('clr').onclick = () => { T.extinguishAll(); T.clearBurnt(); T.resetTrees(); log('reset'); };

// ---- start params ----
if (Q.get('tod')) { T.setTimeOfDay(+Q.get('tod')); tod.value = +Q.get('tod') * 1000; }
if (Q.get('rain')) T.setRain(Q.get('rain'));
if (Q.get('biome')) teleport(Q.get('biome'));
else { const p = teleport('forest'); }
if (Q.get('mode') === 'drive') setMode('drive');

// ---- loop ----
const fpsEl = document.getElementById('fps'); let last = performance.now(), acc = 0, frames = 0, fps = 0, statT = 0;
renderer.info.autoReset = false;
function frame(dt, draw = true) {
  renderer.info.reset(); S.t += dt;
  if (S.mode === 'drive') carPhysics(dt); else flyCam(dt);
  if (S.hot && (S.hotT += dt) > 0.5) { S.hotT = 0; bus.emit('engine:hot', { position: carPos(), intensity: 0.9 }); }
  const night = U.uNight ? U.uNight.value : 0; U.uHeadK.value = S.mode === 'drive' ? night : 0;
  if (S.mode === 'drive') { U.uHeadP.value.set(S.car.x, car.position.y + 1, S.car.z); U.uHeadD.value.set(Math.sin(S.car.h), -0.12, Math.cos(S.car.h)).normalize(); }
  T.update(dt, { camera, focus: { x: S.x, y: S.y, z: S.z }, viewHeight: rt.height });
  if (!draw) return;
  renderer.setRenderTarget(rt); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(pScene, pCam);
}
function loop(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now; if (!S.paused) frame(dt);
  acc += dt; frames++; if (acc > 0.5) { fps = frames / acc; acc = 0; frames = 0; }
  if ((statT += dt) > 0.25) { statT = 0; const s = T.stats(), su = T.surfaceAt(S.x, S.z), ri = renderer.info.render;
    fpsEl.textContent = `${fps.toFixed(0)} fps  ${ri.calls} calls\n${su.biomeName} · ${su.surfaceName} · dry ${su.dryness.toFixed(2)} · grip ${su.grip.toFixed(2)}${S.kmh ? `\n${S.kmh.toFixed(0)} km/h` : ''}\ntrees ${s.trees.near}/${s.trees.impostors} · fire ${s.fire.burning}/${s.fire.burntCells}\nrain ${s.weather.localRain} · clouds ${s.weather.clouds}`; }
  requestAnimationFrame(loop);
}
requestAnimationFrame(t => { last = t; requestAnimationFrame(loop); });

// ---- hooks for headless tests ----
window.__tt = { T, U, W, S, bus, camera, renderer, scene, teleport, setMode, ignite, nearestTree, treeHit, log: () => logs.slice(),
  setCam(x, y, z, yaw, pitch) { S.x = x; S.y = y; S.z = z; if (yaw !== undefined) S.yaw = yaw; if (pitch !== undefined) S.pitch = pitch; },
  lookAt(x, y, z) { const dx = x - S.x, dy = y - S.y, dz = z - S.z; S.yaw = Math.atan2(-dx, -dz); S.pitch = Math.atan2(dy, Math.hypot(dx, dz)); },
  step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) frame(dt); },
  sim(sec, dt = 0.1) { for (let t = 0; t < sec; t += dt) frame(dt, false); frame(1 / 30); },
  pause(on = true) { S.paused = on; },
  fps: () => fps, info: () => ({ ...renderer.info.render }), errors: [] };
