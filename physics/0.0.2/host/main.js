// Physics Lab host: renders the stub world, drives the physics module, mounts vehicles + attachments, shows HUD/menus.
import * as THREE from 'three';
import * as PH from '../physics/index.js';
import { listVehicles, getVehicle, DEFAULT_VEHICLE } from '../vehicles/index.js';
import { buildVehicle } from '../vehicles/build.js';
import { openSelector } from '../vehicles/selector.js';
import { renderPicker } from '../attachments/picker.js';
import { createStubWorld, STRIP } from '../world/stub-world.js';
import { createRig } from './rig.js';
import { createBus } from './bus.js';

const $ = id => document.getElementById(id), QS = new URLSearchParams(location.search);
const errors = []; const showErr = m => { errors.push(m); const e = $('err'); e.style.display = 'block'; e.textContent = errors.slice(-4).join('\n'); };
addEventListener('error', e => showErr('JS: ' + e.message)); addEventListener('unhandledrejection', e => showErr('Promise: ' + (e.reason && e.reason.message || e.reason)));
const isTouch = QS.has('touch') || ('ontouchstart' in window && navigator.maxTouchPoints > 0); if (isTouch) document.body.classList.add('touch');
const store = { get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } } };

// ---------- renderer / scene ----------
const renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: false, powerPreference: 'high-performance' });
const DPR = Math.min(devicePixelRatio || 1, QS.has('hd') ? 2 : 1.5); renderer.setPixelRatio(DPR);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0x8fd0ff); scene.fog = new THREE.Fog(0x8fd0ff, 90, 260);
const camera = new THREE.PerspectiveCamera(62, 1, 0.3, 600);
scene.add(new THREE.HemisphereLight(0xffffff, 0x5a6a40, 1.25)); const sun = new THREE.DirectionalLight(0xffffff, 1.9); sun.position.set(-40, 80, 30); scene.add(sun);
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const grad = new THREE.DataTexture(new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat); grad.minFilter = grad.magFilter = THREE.NearestFilter; grad.needsUpdate = true;
const toon = (o = {}) => new THREE.MeshToonMaterial({ gradientMap: grad, ...o });
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide });
outlineMat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = position + normal * 0.045;'); };

// ---------- world ----------
const world = createStubWorld();
const bus = createBus();
const SURF_COL = { asphalt: [0.36, 0.37, 0.42], dirt: [0.72, 0.55, 0.34], grass: [0.45, 0.72, 0.3], sand: [0.92, 0.83, 0.55], rock: [0.55, 0.55, 0.58] };
const TN = 110, TS = 330; // terrain grid
const tGeo = new THREE.PlaneGeometry(TS, TS, TN, TN); tGeo.rotateX(-Math.PI / 2); tGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(tGeo.attributes.position.count * 3), 3));
const terrain = new THREE.Mesh(tGeo, toon({ vertexColors: true })); scene.add(terrain);
const tBase = tGeo.attributes.position.array.slice(); let tCx = 1e9, tCz = 1e9;
function updateTerrain(x, z) {
  const step = TS / TN, cx = Math.round(x / step) * step, cz = Math.round(z / step) * step; tCx = cx; tCz = cz;
  const pos = tGeo.attributes.position.array, col = tGeo.attributes.color.array;
  for (let i = 0; i < pos.length; i += 3) { const wx = tBase[i] + cx, wz = tBase[i + 2] + cz; pos[i] = wx; pos[i + 2] = wz; pos[i + 1] = world.heightAt(wx, wz);
    const c = SURF_COL[world.surfaceAt(wx, wz)] || SURF_COL.grass, n = 0.94 + 0.06 * Math.sin(wx * 0.7) * Math.cos(wz * 0.9); col[i] = c[0] * n; col[i + 1] = c[1] * n; col[i + 2] = c[2] * n;
    if (Math.abs(Math.abs(wx) - STRIP.hw + 0.5) < 0.5 && wz > STRIP.z0 && wz < STRIP.z1) { col[i] = col[i + 1] = col[i + 2] = 0.95; } }
  tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true; tGeo.computeVertexNormals(); tGeo.computeBoundingSphere();
}
// trees (instanced): trunk + crown (conifer / round)
const TMAX = 2600, trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 3.2, 6); trunkGeo.translate(0, 1.6, 0);
const coneGeo = new THREE.ConeGeometry(1.7, 4.6, 7); coneGeo.translate(0, 5.0, 0); const ballGeo = new THREE.IcosahedronGeometry(1.9, 0); ballGeo.translate(0, 4.6, 0);
const trunks = new THREE.InstancedMesh(trunkGeo, toon({ color: 0x7a4e2a }), TMAX), cones = new THREE.InstancedMesh(coneGeo, toon({ color: 0xffffff }), TMAX), balls = new THREE.InstancedMesh(ballGeo, toon({ color: 0xffffff }), TMAX);
for (const m of [trunks, cones, balls]) { m.count = 0; m.frustumCulled = false; m.setColorAt(0, new THREE.Color(1, 1, 1)); scene.add(m); }
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _e = new THREE.Euler();
const HPC = [new THREE.Color(0x8a3a1a), new THREE.Color(0xe07a20), new THREE.Color(0xc8c030), new THREE.Color(0x3f9a3a)];
const hpColor = hp => { const f = Math.max(0, Math.min(3, hp)), i = Math.min(2, Math.floor(f)); return _c.copy(HPC[i]).lerp(HPC[i + 1], f - i); };
const shake = {}; let treesDirty = true, tvx = 1e9, tvz = 1e9;
function updateTrees(x, z) {
  tvx = x; tvz = z; let nt = 0, nc = 0, nb = 0;
  world.forEachTree(x, z, 165, t => {
    if (nt >= TMAX) return; const hp = PH.treeHp(rig.state, { id: t.id, hp: world.hpOf(t.id) }); if (hp <= 0) return;
    const y = world.heightAt(t.x, t.z), sk = shake[t.id] ? Math.sin(shake[t.id] * 40) * shake[t.id] * 0.5 : 0;
    _e.set(sk, 0, sk * 0.6); _q.setFromEuler(_e); _s.set(t.s * (t.r / 0.4), t.s, t.s * (t.r / 0.4)); _p.set(t.x, y - 0.2, t.z); _m.compose(_p, _q, _s); trunks.setMatrixAt(nt++, _m);
    _s.set(t.s, t.s, t.s); _m.compose(_p, _q, _s); const M = t.kind === 1 ? balls : cones, j = t.kind === 1 ? nb++ : nc++; M.setMatrixAt(j, _m); M.setColorAt(j, hpColor(hp));
  });
  trunks.count = nt; cones.count = nc; balls.count = nb;
  for (const m of [trunks, cones, balls]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  treesDirty = false;
}
world.onTreeChange(() => { treesDirty = true; });

// ---------- particles (chips, debris, smoke) ----------
const PMAX = 220, pGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25), parts = new THREE.InstancedMesh(pGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), PMAX);
parts.count = 0; parts.frustumCulled = false; parts.setColorAt(0, new THREE.Color(1, 1, 1)); scene.add(parts); const P = [];
function burst(x, y, z, n, col, spd = 6, size = 1, life = 1.2, grav = 1) { for (let i = 0; i < n && P.length < PMAX; i++) P.push({ x, y, z, vx: (Math.random() - 0.5) * spd, vy: Math.random() * spd * 0.9 + 1, vz: (Math.random() - 0.5) * spd, t: life * (0.6 + Math.random() * 0.6), s: size * (0.5 + Math.random()), c: new THREE.Color(col), g: grav, r: Math.random() * 6 }); }
function updateParts(dt) {
  let n = 0; for (let i = P.length - 1; i >= 0; i--) { const q = P[i]; q.t -= dt; if (q.t <= 0) { P.splice(i, 1); continue; } }
  for (const q of P) { q.vy -= 12.5 * q.g * dt; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; const gy = world.heightAt(q.x, q.z); if (q.y < gy) { q.y = gy; q.vy *= -0.3; q.vx *= 0.6; q.vz *= 0.6; }
    const s = q.g < 0.5 ? q.s * (1 + (1.5 - q.t) * 2) : q.s; _e.set(q.r + q.t * 3, q.r, 0); _q.setFromEuler(_e); _s.set(s, s, s); _p.set(q.x, q.y, q.z); _m.compose(_p, _q, _s); parts.setMatrixAt(n, _m); parts.setColorAt(n, q.c); n++; }
  parts.count = n; parts.instanceMatrix.needsUpdate = true; if (parts.instanceColor) parts.instanceColor.needsUpdate = true;
}

// ---------- vehicle + attachments ----------
const carRoot = new THREE.Group(); scene.add(carRoot); let vis = null, outline = null;
const shadow = new THREE.Mesh(new THREE.CircleGeometry(1, 20), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: 0.28, depthWrite: false })); shadow.rotation.x = -Math.PI / 2; scene.add(shadow);
const carMat = toon({ vertexColors: true });
const rig = createRig({ THREE, world, emit: (t, d) => bus.emit(t, d) });
function useVehicle(id, attach) {
  id = getVehicle(id).id; if (vis) { carRoot.remove(vis.group); vis.dispose(); }
  const a = attach || store.get('srp_attach_' + id, getVehicle(id).defaultAttachments || []);
  rig.setVehicle(id, a); vis = buildVehicle(THREE, rig.vehicle, carMat);
  outline = new THREE.Mesh(vis.body.geometry, outlineMat); vis.body.add(outline);
  vis.group.add(rig.root); carRoot.add(vis.group);
  const d = rig.vehicle.physics.dims || [2, 1.5, 4.4]; shadow.scale.set(d[0] * 0.75, d[2] * 0.6, 1);
  store.set('srp_vehicle', id); store.set('srp_attach_' + id, rig.attach); treesDirty = true; refreshHudStatic(); return rig.vehicle;
}
function setAttachments(ids) { rig.setAttachments(ids); store.set('srp_attach_' + rig.vehicle.id, rig.attach); refreshHudStatic(); return rig.attach; }

// ---------- HUD ----------
const evlog = []; const EVC = t => t.startsWith('tree') ? 'tree' : t.startsWith('engine') ? 'heat' : t.startsWith('harv') || t.startsWith('cargo') ? 'harv' : '';
const fmt = (t, d) => t + ' ' + JSON.stringify(d, (k, v) => k === 'type' || k === 'x' || k === 'z' ? undefined : typeof v === 'number' ? Math.round(v * 100) / 100 : Array.isArray(v) && v.length === 3 ? '[' + v.map(n => Math.round(n)).join(',') + ']' : v).replace(/"/g, '');
const QUIET = new Set(['harvester:cut', 'shift', 'land', 'scrape']); let lastHot = 0;
const LOGGED = []; // all events (tests)
bus.on('*', (d, t) => { LOGGED.push({ type: t, ...d }); if (LOGGED.length > 3000) LOGGED.splice(0, 1000);
  if (QUIET.has(t)) return; if (t === 'engine:hot') { if (performance.now() - lastHot < 2000) return; lastHot = performance.now(); }
  const key = t + (d.id || ''), row = `<div class="${EVC(t)}">${fmt(t, d)}</div>`; if (evlog.key === key) evlog[0] = row; else evlog.unshift(row); evlog.key = key; evlog.length = Math.min(evlog.length, 4); $('evlog').innerHTML = evlog.join(''); });
function refreshHudStatic() { $('carName').textContent = rig.vehicle.name; $('parts').textContent = rig.attach.length ? rig.attach.map(id => id.toUpperCase()).join(' + ') : 'no attachments'; }
const tel = {};
function updateHud() {
  const s = rig.state, kmh = Math.hypot(s.v.x, s.v.z) * 3.6; PH.telemetry(s, tel);
  $('spd').textContent = Math.round(kmh); $('gear').textContent = s.gear < 0 ? 'R' : s.gear;
  $('rpmBar').firstChild.style.width = Math.min(100, s.rpm / s.P.redline * 100) + '%'; $('rpmBar').firstChild.style.background = s.limiter ? '#e8302a' : '#7fe07f';
  $('nitroBar').firstChild.style.width = s.nitro * 100 + '%';
  const H = s.P.heat, T = s.heat.temp, f = Math.max(0, Math.min(1, (T - 40) / (H.max - 40)));
  $('needle').style.transform = `rotate(${-84 + Math.min(1, Math.max(0, f)) * 168}deg)`; $('tempTxt').innerHTML = Math.round(T) + '&deg;C';
  const w = $('tempWarn'); w.textContent = s.heat.cut ? 'ENGINE CUT' : s.heat.over ? 'OVERHEAT!' : T >= H.hot ? 'HOT' : s.limiter ? 'LIMITER' : ''; w.className = s.heat.over ? 'over' : '';
  $('dmgBar').firstChild.style.width = s.damage + '%'; $('dmgTxt').textContent = Math.round(s.damage) + '%';
  $('logs').textContent = s.cargo.logs + '/' + s.cargo.capacity; $('mass').textContent = Math.round(PH.massOf(s));
}
// tree HP labels (nearest trees + recently hit)
const LBL = [], recent = new Map(); for (let i = 0; i < 10; i++) { const d = document.createElement('div'); d.className = 'hp'; d.innerHTML = '<div class="segs"><span class="seg"><i></i></span><span class="seg"><i></i></span><span class="seg"><i></i></span></div><span class="n"></span>'; d.style.display = 'none'; $('labels').appendChild(d); LBL.push(d); }
const _v = new THREE.Vector3(), qbuf = [];
function updateLabels() {
  const s = rig.state; qbuf.length = 0; world.queryTrees(s.p.x, s.p.z, 32, qbuf);
  const list = qbuf.map(t => ({ t, hp: PH.treeHp(s, t), d: Math.hypot(t.x - s.p.x, t.z - s.p.z) - (recent.has(t.id) ? 100 : 0) })).filter(o => o.hp > 0).sort((a, b) => a.d - b.d).slice(0, LBL.length);
  LBL.forEach((el, i) => { const o = list[i]; if (!o) { el.style.display = 'none'; return; }
    _v.set(o.t.x, world.heightAt(o.t.x, o.t.z) + 4.6, o.t.z).project(camera); if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { el.style.display = 'none'; return; }
    el.style.display = 'block'; el.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = Math.max(118, (1 - _v.y) / 2 * innerHeight) + 'px';
    el.className = 'hp' + (recent.has(o.t.id) ? ' hit' : ''); const segs = el.firstChild.children;
    for (let k = 0; k < 3; k++) { const f = Math.max(0, Math.min(1, o.hp - k)); segs[k].firstChild.style.width = f * 100 + '%'; segs[k].firstChild.style.background = o.hp > 2 ? '#7fe07f' : o.hp > 1 ? '#ffd23c' : '#ff6a3a'; }
    el.lastChild.textContent = o.hp.toFixed(1) + '/3 HP'; });
}
function popText(x, y, z, txt, col = '#ff5030') { _v.set(x, y, z).project(camera); if (_v.z > 1) return; const d = document.createElement('div'); d.className = 'pop'; d.textContent = txt; d.style.color = col;
  d.style.left = ((_v.x + 1) / 2 * innerWidth) + 'px'; d.style.top = ((1 - _v.y) / 2 * innerHeight) + 'px'; $('labels').appendChild(d);
  requestAnimationFrame(() => { d.style.transform = 'translate(-50%,-260%)'; d.style.opacity = '0'; }); setTimeout(() => d.remove(), 1000); }
// event reactions
bus.on('tree:damage', d => { recent.set(d.id, 3); shake[d.id] = 0.6; treesDirty = true; const y = world.heightAt(d.x, d.z);
  if (d.cause === 'harvest') return; // melt: no chips, no shake
  burst(d.x, y + 1.5, d.z, 10, 0xc89a5a, 7, 0.6);
  if (d.cause !== 'harvest') popText(d.x, y + 6, d.z, '-' + d.hp.toFixed(1) + ' HP'); });
bus.on('tree:destroyed', d => { if (d.cause === 'harvest') { delete shake[d.id]; treesDirty = true; return; } /* harvester melt: vanish instantly, no animation */ const y = world.heightAt(d.x, d.z); burst(d.x, y + 2, d.z, 22, 0x7a4e2a, 12, 1.2, 1.6); burst(d.x, y + 4, d.z, 18, 0x3f9a3a, 10, 1.4, 1.4); popText(d.x, y + 7, d.z, d.cause === 'harvest' ? 'FELLED!' : 'SMASH!', '#ffd23c'); treesDirty = true; });
bus.on('harvester:log', d => { const s = rig.state; popText(s.p.x, s.p.y + 3, s.p.z, '+' + d.logs + ' LOG', '#ffd23c'); });
bus.on('engine:hot', d => burst(d.position[0], d.position[1] + 0.5, d.position[2], 1 + Math.round(d.intensity * 3), 0x888888, 1.5, 0.8, 1.4, 0.05));
bus.on('engine:overheat', d => { burst(d.position[0], d.position[1] + 0.5, d.position[2], 8, 0x555555, 3, 0.9, 1.6, 0.05); });

// ---------- input ----------
const key = {}; addEventListener('keydown', e => { key[e.code] = 1; if (e.code === 'KeyR') resetCar(); if (e.code === 'KeyM') toggleMenu(); });
addEventListener('keyup', e => key[e.code] = 0);
const touch = { steer: 0, pitch: 0, gas: 0, brk: 0, bst: 0, drf: 0 };
const joy = $('joy'), knob = $('knob'); let joyId = null;
joy.addEventListener('touchstart', e => { joyId = e.changedTouches[0].identifier; joyMove(e); e.preventDefault(); }, { passive: false });
joy.addEventListener('touchmove', e => { joyMove(e); e.preventDefault(); }, { passive: false });
const joyEnd = e => { for (const t of e.changedTouches) if (t.identifier === joyId) { joyId = null; touch.steer = touch.pitch = 0; knob.style.transform = ''; } };
joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);
function joyMove(e) { for (const t of e.changedTouches) if (t.identifier === joyId) { const r = joy.getBoundingClientRect(), cl = v => Math.max(-1, Math.min(1, v));
  const dx = cl((t.clientX - r.left - r.width / 2) / 55), dy = cl((t.clientY - r.top - r.height / 2) / 55); touch.steer = dx; touch.pitch = -dy; knob.style.transform = `translate(${dx * 45}px,${dy * 45}px)`; } }
[['bGas', 'gas'], ['bBrk', 'brk'], ['bBst', 'bst'], ['bDrf', 'drf']].forEach(([id, k]) => { const el = $(id);
  el.addEventListener('touchstart', e => { touch[k] = 1; el.classList.add('on'); e.preventDefault(); }, { passive: false });
  const up = () => { touch[k] = 0; el.classList.remove('on'); }; el.addEventListener('touchend', up); el.addEventListener('touchcancel', up);
  el.addEventListener('mousedown', () => { touch[k] = 1; }); el.addEventListener('mouseup', up); el.addEventListener('mouseleave', up); });
const inp = { gas: 0, brake: 0, steer: 0, hand: 0, boost: 0, pitch: 0 }; let steerSm = 0;
function readInput(dt) {
  const s = rig.state, kb = (key.KeyA || key.ArrowLeft ? 1 : 0) - (key.KeyD || key.ArrowRight ? 1 : 0);
  let tc = -touch.steer; tc = Math.sign(tc) * Math.pow(Math.min(1, Math.abs(tc)), 1.5) / (1 + Math.abs(s.v.x * s.fwd.x + s.v.z * s.fwd.z) * 0.012);
  const tgt = Math.max(-1, Math.min(1, kb + tc));
  if (kb) steerSm += Math.max(-5 * dt, Math.min(5 * dt, tgt - steerSm)); else steerSm += (tgt - steerSm) * Math.min(1, 12 * dt);
  inp.steer = Math.abs(steerSm) < 1e-3 ? 0 : steerSm;
  inp.gas = key.KeyW || key.ArrowUp || touch.gas ? 1 : 0; inp.brake = key.KeyS || key.ArrowDown || touch.brk ? 1 : 0;
  inp.hand = key.Space || touch.drf ? 1 : 0; inp.boost = key.ShiftLeft || key.ShiftRight || touch.bst ? 1 : 0;
  inp.pitch = Math.max(-1, Math.min(1, (key.KeyE ? 1 : 0) - (key.KeyQ ? 1 : 0) + touch.pitch));
  return LAB.input ? Object.assign({}, inp, typeof LAB.input === 'function' ? LAB.input(s) : LAB.input) : inp;
}

// ---------- menu ----------
let selector = null, picker = null, paused = false;
function showTab(tab) {
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  for (const t of ['car', 'parts', 'lab']) $('tab-' + t).classList.toggle('hidden', t !== tab);
  if (tab === 'car' && !selector) selector = openSelector({ THREE, container: $('tab-car'), current: rig.vehicle.id, onPick: id => useVehicle(id) });
  if (tab !== 'car' && selector) { selector.close(); selector = null; }
  if (tab === 'parts') picker = renderPicker({ container: $('picker'), vehicle: rig.vehicle, selected: rig.attach, onChange: ids => setAttachments(ids) });
}
function openMenu(tab = 'car') { $('menu').classList.remove('hidden'); paused = true; showTab(tab); }
function closeMenu() { $('menu').classList.add('hidden'); paused = false; if (selector) { selector.close(); selector = null; } }
function toggleMenu() { $('menu').classList.contains('hidden') ? openMenu() : closeMenu(); }
document.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$('bDrive').onclick = closeMenu; $('bMenu').onclick = () => openMenu(); $('bReset').onclick = () => resetCar();
$('bUnload').onclick = () => rig.unload(); $('bRepair').onclick = () => PH.repair(rig.state); $('bRegrow').onclick = () => { rig.state.treeHp = {}; world.regrow(); };
let infN2O = false; $('bInfN2O').onclick = () => { infN2O = !infN2O; $('bInfN2O').textContent = 'INFINITE N2O: ' + (infN2O ? 'ON' : 'OFF'); };
const setHandling = m => { rig.setMode(m); store.set('srp_handling', m); $('bMode').textContent = m === 'normal' ? 'NRM' : 'ARC'; $('bHandling').textContent = 'HANDLING: ' + (m === 'normal' ? 'NORMAL' : 'ARCADE'); };
$('bMode').onclick = $('bHandling').onclick = () => setHandling(rig.state.mode === 'normal' ? 'arcade' : 'normal');
$('bStab').onclick = () => { const a = rig.state.assist; a.stab = !a.stab; $('bStab').textContent = 'STABILITY: ' + (a.stab ? 'ON' : 'OFF'); };
const TP = { strip: [0, -200, 0], practice: [-2.5, 50, 0], forest: [28, 150, Math.PI / 2] };
document.querySelectorAll('[data-tp]').forEach(b => b.onclick = () => { teleport(...TP[b.dataset.tp]); closeMenu(); });
function teleport(x, z, yaw = 0) { PH.spawn(rig.state, world, x, z, yaw); camSnap = true; }
function resetCar() { PH.recover(rig.state, world); camSnap = true; }

// ---------- camera + render sync ----------
let camSnap = true; const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
function syncVisuals(dt) {
  const s = rig.state; vis.group.position.set(s.p.x, s.p.y, s.p.z); vis.group.quaternion.set(s.q.x, s.q.y, s.q.z, s.q.w);
  s.wheels.forEach((w, i) => vis.setWheel(i, w.comp, w.steer, w.rot)); vis.flame.visible = s.boosting; if (s.boosting) vis.flame.scale.setScalar(0.8 + Math.random() * 0.5);
  const gy = world.heightAt(s.p.x, s.p.z); shadow.position.set(s.p.x, gy + 0.06, s.p.z); shadow.rotation.z = Math.atan2(s.fwd.x, s.fwd.z); shadow.material.opacity = Math.max(0, 0.3 - (s.p.y - gy) * 0.03);
  const L = (rig.vehicle.physics.dims || [2, 1.5, 4.4])[2], fl = Math.hypot(s.fwd.x, s.fwd.z) || 1, kmh = Math.hypot(s.v.x, s.v.z) * 3.6;
  const back = 4.2 + L * 0.9 + kmh * 0.008, tx = s.p.x - s.fwd.x / fl * back, tz = s.p.z - s.fwd.z / fl * back, ty = Math.max(world.heightAt(tx, tz) + 1.5, s.p.y + 1.6 + L * 0.28);
  if (camSnap) { camPos.set(tx, ty, tz); camLook.set(s.p.x, s.p.y + 1, s.p.z); camSnap = false; }
  camPos.x += s.v.x * dt; camPos.y += s.v.y * dt; camPos.z += s.v.z * dt; camLook.x += s.v.x * dt; camLook.y += s.v.y * dt; camLook.z += s.v.z * dt; // carry with car, lag only on turns
  const k = Math.min(1, dt * 6); camPos.x += (tx - camPos.x) * k; camPos.y += (ty - camPos.y) * k; camPos.z += (tz - camPos.z) * k;
  camLook.x += (s.p.x - camLook.x) * Math.min(1, dt * 12); camLook.y += (s.p.y + 1 - camLook.y) * Math.min(1, dt * 12); camLook.z += (s.p.z - camLook.z) * Math.min(1, dt * 12);
  camera.position.copy(camPos); camera.lookAt(camLook); camera.fov = 60 + Math.min(22, kmh * 0.07); camera.updateProjectionMatrix();
  sun.position.set(s.p.x - 40, s.p.y + 80, s.p.z + 30); sun.target.position.set(s.p.x, s.p.y, s.p.z); sun.target.updateMatrixWorld();
  if (Math.hypot(s.p.x - tCx, s.p.z - tCz) > 24) updateTerrain(s.p.x, s.p.z);
  for (const id in shake) { shake[id] -= dt; treesDirty = true; if (shake[id] <= 0) delete shake[id]; }
  if (treesDirty || Math.hypot(s.p.x - tvx, s.p.z - tvz) > 20) updateTrees(s.p.x, s.p.z);
  for (const [id, t] of recent) { if (t - dt <= 0) recent.delete(id); else recent.set(id, t - dt); }
}
const DT = 1 / 120; let acc = 0, last = performance.now(), frames = 0, hudT = 0;
function simStep(input) { if (infN2O) rig.state.nitro = 1; rig.step(input, DT); }
function frame(now) {
  requestAnimationFrame(frame); const dt = Math.min(0.1, (now - last) / 1000); last = now; frames++;
  if (!paused) { acc += dt; const input = readInput(dt); let n = 0; while (acc >= DT && n < 14) { simStep(input); acc -= DT; n++; } if (n >= 14) acc = 0; }
  render(dt);
}
function render(dt = 1 / 30) { syncVisuals(dt); updateParts(dt); renderer.render(scene, camera); hudT += dt; if (hudT > 0.066 || dt === 0) { hudT = 0; updateHud(); updateLabels(); } }

// ---------- test hooks ----------
const LAB = window.LAB = {
  PH, rig, world, bus, events: LOGGED, errors, get state() { return rig.state; }, input: null,
  setVehicle: (id, a) => useVehicle(id, a), setHandling, setAttachments, teleport, openMenu, closeMenu, showTab, vehicles: listVehicles().map(v => v.id),
  // synchronous sim (no rendering) then one render: for deterministic headless screenshots
  sim(secs, fn) { for (let i = 0, n = Math.round(secs / DT); i < n; i++) { const s = rig.state; simStep(fn ? fn(s) : readInput(DT)); if (LAB.until && LAB.until(s)) { LAB.until = null; break; } } acc = 0; camSnap = true; render(1 / 30); render(0); return PH.telemetry(rig.state); },
  pilot(lane = 0, o = {}) { return s => { const yaw = PH.yawOf(s); const st = Math.max(-1, Math.min(1, -((s.p.x - lane) * 0.08 + Math.sin(yaw) * 1.5 + s.w.y * 0.25))); return { gas: 1, brake: 0, steer: st, hand: 0, boost: 0, ...o }; }; },
  kmh: () => Math.hypot(rig.state.v.x, rig.state.v.z) * 3.6, render: () => render(0), get frames() { return frames; }, ready: false,
};
useVehicle(QS.get('car') || store.get('srp_vehicle', DEFAULT_VEHICLE)); setHandling(QS.get('mode') || store.get('srp_handling', 'arcade'));
updateTerrain(0, 0); render(0); requestAnimationFrame(frame); LAB.ready = true;
if (QS.has('menu')) openMenu(QS.get('menu') || 'car');
