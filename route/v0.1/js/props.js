// Sine Rally Route: sparse roadside props along the endless route — delineator posts, mile markers, "ENTERING <biome>" signs,
// US-66 shields and the occasional diner / gas station. Everything is placed from the route parameter s (deterministic by seed),
// in local (floating-origin) coordinates, and rebuilt when the car has moved ~150 m along the route or the origin shifts.
import * as THREE from 'three';
import * as W from './world.js';
import { P, merge } from './models.js';
import { U, COMIC, objMat } from './shaders.js';

const MILE = 1609.344, AHEAD = 1400, BEHIND = 250;
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (a, b, h, s = 6) => new THREE.CylinderGeometry(a, b, h, s);

// textured sign faces (canvas) through the comic shader so fog, light and ink edges match the rest of the world
function signMat(tex) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, map: { value: tex }, uHK: { value: 0.35 } },
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec2 vUv; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMIC + `uniform sampler2D map; uniform float uHK; varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N; vec3 c = texture2D(map, vUv).rgb; gl_FragColor = vec4(comic(c, N, vW, uHK), ncode(N)); }` });
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const INK = '#141414';
function greenSign(lines, w = 512, h = 192) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, w, h); g.fillStyle = '#1f6b3a'; g.fillRect(8, 8, w - 16, h - 16);
    g.strokeStyle = '#f4f4f0'; g.lineWidth = 6; g.strokeRect(18, 18, w - 36, h - 36);
    g.fillStyle = '#f4f4f0'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach(([t, px, y]) => { g.font = `900 ${px}px "Arial Black", Arial, sans-serif`; let s = px; while (g.measureText(t).width > w - 60 && s > 10) g.font = `900 ${s -= 2}px "Arial Black", Arial, sans-serif`; g.fillText(t, w / 2, y * h); });
  });
}
function shieldTex() {
  return canvasTex(256, 256, (g) => {
    g.fillStyle = '#1b1b1b'; g.fillRect(0, 0, 256, 256);
    const sh = (k, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(128, 236 - k); g.bezierCurveTo(40 + k, 200, 20 + k, 140, 26 + k, 60); g.lineTo(26 + k, 20 + k);
      g.quadraticCurveTo(80, 36 + k, 128, 20 + k); g.quadraticCurveTo(176, 36 + k, 230 - k, 20 + k); g.lineTo(230 - k, 60); g.bezierCurveTo(236 - k, 140, 216 - k, 200, 128, 236 - k); g.fill(); };
    sh(0, '#f6f0dc'); sh(10, INK); sh(16, '#f6f0dc');
    g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 34px "Arial Black", Arial'; g.fillText('US', 128, 62);
    g.fillRect(48, 82, 160, 6); g.font = '900 96px "Arial Black", Arial'; g.fillText('66', 128, 150);
  });
}
function bizTex(kind) {
  return canvasTex(512, 160, (g) => {
    const diner = kind === 'diner'; g.fillStyle = diner ? '#d8342a' : '#f2f2f2'; g.fillRect(0, 0, 512, 160); g.strokeStyle = diner ? '#ffe9a8' : '#1d4fa8'; g.lineWidth = 10; g.strokeRect(10, 10, 492, 140);
    g.fillStyle = diner ? '#ffe9a8' : '#1d4fa8'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 86px "Arial Black", Arial';
    g.fillText(diner ? 'DINER' : 'GAS', 256, 84);
  });
}

export function createProps({ scene, T }) {
  const postMat = objMat({ hatch: 0.6 }), bldMat = objMat({ hatch: 0.9 });
  const root = new THREE.Group(); root.name = 'routeProps'; scene.add(root);
  // delineator posts: white post, amber reflector (instanced, 1 draw call)
  const delGeo = merge([P(box(0.12, 1.0, 0.12), 0xf2f2ee, [0, 0.5, 0]), P(box(0.13, 0.18, 0.13), 0xff9a1a, [0, 0.85, 0])]);
  const MAXD = 140, dels = new THREE.InstancedMesh(delGeo, postMat, MAXD); dels.frustumCulled = false; dels.count = 0; root.add(dels);
  const poleGeo = merge([P(cyl(0.07, 0.07, 1, 6), 0x9a9aa0, [0, 0.5, 0])]);
  const faceGeo = new THREE.PlaneGeometry(1, 1);
  const tex = new Map(), mats = new Map();
  const matFor = (key, make) => { let m = mats.get(key); if (!m) { const t = make(); tex.set(key, t); m = signMat(t); mats.set(key, m); } return m; };
  const welcomeMat = b => matFor('w' + b, () => greenSign([['ENTERING', 44, 0.3], [W.BIOME_TITLES[b].toUpperCase(), 72, 0.66]]));
  const mileMat = n => matFor('m' + n, () => canvasTex(128, 192, g => { g.fillStyle = '#f4f4f0'; g.fillRect(0, 0, 128, 192); g.fillStyle = '#1f6b3a'; g.fillRect(6, 6, 116, 180);
    g.fillStyle = '#f4f4f0'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 34px "Arial Black", Arial'; g.fillText('MILE', 64, 50); g.font = `900 ${n > 99 ? 46 : 64}px "Arial Black", Arial`; g.fillText(String(n), 64, 126); }));
  const shieldMat = () => matFor('shield', shieldTex);
  const bizMat = k => matFor('b' + k, () => bizTex(k));
  // buildings (merged once, one mesh per placed building)
  const diner = merge([P(box(16, 4.2, 9), 0xe9e4d6, [0, 2.1, 0]), P(box(16.4, 0.9, 9.4), 0xc9302a, [0, 3.9, 0]), P(box(15, 1.3, 0.2), 0x30485a, [0, 2.2, -4.55]),
    P(box(16.8, 0.35, 9.8), 0xd8d2c4, [0, 4.45, 0]), P(box(2, 2.4, 0.2), 0x7a3a24, [5.5, 1.2, -4.56]), P(box(0.3, 7, 0.3), 0x7a7a80, [-9.5, 3.5, -6]),
    P(box(26, 0.12, 22), 0x55555c, [0, 0.03, -5]), P(box(4, 0.8, 4), 0x9a9aa0, [0, -0.4, 0], [0, 0, 0], [4, 4, 2.2])]);
  const gas = merge([P(box(12, 0.6, 8), 0xf2f2f2, [0, 5.2, -6]), P(box(12.2, 0.3, 8.2), 0x1d4fa8, [0, 4.85, -6]), ...[[-5, -3], [5, -3], [-5, -9], [5, -9]].map(([x, z]) => P(box(0.4, 4.9, 0.4), 0xdcdcdc, [x, 2.45, z])),
    ...[-2.2, 2.2].map(x => P(box(0.8, 1.6, 0.6), 0xc9302a, [x, 0.8, -6])), P(box(9, 3.6, 6), 0xe0d8c4, [0, 1.8, 5]), P(box(9.2, 0.4, 6.2), 0x1d4fa8, [0, 3.7, 5]),
    P(box(7, 1.2, 0.2), 0x30485a, [0, 2, 1.95]), P(box(0.3, 7.5, 0.3), 0x7a7a80, [-9, 3.75, -12]), P(box(28, 0.12, 26), 0x55555c, [0, 0.03, -3]), P(box(4, 0.8, 4), 0x9a9aa0, [0, -0.4, 4], [0, 0, 0], [3, 4, 2])]);
  const pool = []; let used = 0;
  function mesh(geo, mat) { let m = pool[used]; if (!m) { m = new THREE.Mesh(geo, mat); m.frustumCulled = true; root.add(m); pool.push(m); } m.geometry = geo; m.material = mat; m.visible = true; used++; return m; }
  const PT = { x: 0, z: 0, tx: 0, tz: 1, y: 0, curv: 0, bank: 0, tun: 0, bridge: false, b: 0 };
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(), E = new THREE.Euler(), YA = new THREE.Vector3(0, 1, 0);
  const solids = []; // {x,z,r} building colliders (local coords)
  const placed = []; // debug / tests: what is in the window
  let lastS = -1e9, dirty = true;
  const side = (p, d) => [p.x - p.tz * d, p.z + p.tx * d]; // d > 0: right of travel
  const clearOf = s => { const f = W.featuresIn(s - 90, s + 90); return !f.length; };
  function sign(mat, s, d, w, h, top) { // panel facing oncoming traffic on posts
    W.routePoint(s, PT); if (PT.tun || PT.bridge) return null; const [x, z] = side(PT, d), y = T.heightAt(x, z), yaw = Math.atan2(-PT.tx, -PT.tz);
    const f = mesh(faceGeo, mat); f.position.set(x, y + top - h / 2, z); f.rotation.set(0, yaw, 0); f.scale.set(w, h, 1);
    for (const o of w > 1.5 ? [-w * 0.32, w * 0.32] : [0]) { const p = mesh(poleGeo, postMat); p.position.set(x + Math.cos(yaw) * o, y - 0.3, z - Math.sin(yaw) * o); p.rotation.set(0, 0, 0); p.scale.set(1, top - h + 0.4, 1); }
    // back panel so the sign has a body from behind
    const b = mesh(faceGeo, postMat); b.position.set(x - Math.sin(yaw) * 0.04, y + top - h / 2, z - Math.cos(yaw) * 0.04); b.rotation.set(0, yaw + Math.PI, 0); b.scale.set(w, h, 1);
    return { x, z, y };
  }
  function rebuild(sCur) {
    used = 0; dels.count = 0; solids.length = 0; placed.length = 0; const s0 = Math.max(0, sCur - BEHIND), s1 = sCur + AHEAD;
    // delineators every 50 m, both sides (not in tunnels or on bridge decks, which have their own walls/rails)
    for (let s = Math.ceil(s0 / 50) * 50; s < s1 && dels.count < MAXD - 1; s += 50) {
      W.routePoint(s, PT); if (PT.tun || PT.bridge) continue; const yaw = Math.atan2(PT.tx, PT.tz);
      for (const d of [-(W.ROAD_HW + 1.1), W.ROAD_HW + 1.1]) { const [x, z] = side(PT, d), y = Math.min(T.heightAt(x, z), PT.y + 0.6);
        M.compose(V.set(x, y - 0.1, z), Q.setFromAxisAngle(YA, yaw), S.set(1, 1, 1)); dels.setMatrixAt(dels.count++, M); } }
    dels.instanceMatrix.needsUpdate = true;
    // mile markers (right side)
    for (let n = Math.max(1, Math.ceil(s0 / MILE)); n * MILE < s1; n++) if (sign(mileMat(n), n * MILE, W.ROAD_HW + 1.6, 0.55, 0.85, 1.9)) placed.push({ kind: 'mile', s: n * MILE, n });
    // ENTERING <biome> before every boundary
    for (const bd of W.boundaries(s0 - 300, s1 + 300)) { const s = bd.s - 260; if (s < s0 || s > s1) continue; if (sign(welcomeMat(bd.b), s, W.ROAD_HW + 3.2, 4.6, 1.75, 4.2)) placed.push({ kind: 'welcome', s, b: bd.b }); }
    // US 66 shields: every ~2.4 km, by hash
    for (let k = Math.floor(s0 / 2400); k * 2400 < s1; k++) { const s = k * 2400 + 300 + 900 * W.hash2(k, W.SEED, 61); if (s < s0 || s > s1) continue; if (sign(shieldMat(), s, W.ROAD_HW + 1.8, 0.9, 0.9, 2.6)) placed.push({ kind: 'shield', s }); }
    // diners / gas stations: at most one per 2 km cell, away from tunnels/bridges and biome boundaries, only on fairly flat ground
    for (let k = Math.floor(s0 / 2000); k * 2000 < s1 + 2000; k++) {
      const h = W.hash2(k, W.SEED, 71); if (h > 0.6 || k < 1) continue; const s = k * 2000 + 300 + 1400 * W.hash2(k, W.SEED, 72); if (s < s0 - 50 || s > s1) continue;
      if (!clearOf(s)) continue; const nb = W.boundaries(s - 300, s + 300); if (nb.length) continue;
      W.routePoint(s, PT); if (PT.tun || PT.bridge || Math.abs(PT.curv) > 0.004) continue;
      const kind = W.hash2(k, W.SEED, 73) < 0.5 ? 'diner' : 'gas', dir = W.hash2(k, W.SEED, 74) < 0.5 ? 1 : -1, off = W.ROAD_HW + (kind === 'gas' ? 17 : 15);
      const [x, z] = side(PT, dir * off), th = Math.atan2(-dir * PT.tz, dir * PT.tx), c = Math.cos(th), sn = Math.sin(th); // local -z (front, parking) faces the road
      const L = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
      let lo = 1e9, hi = -1e9; for (const [a, b] of [[-12, -12], [12, -12], [-12, 12], [12, 12], [0, 0]]) { const q = L(a, b), hh = T.heightAt(q[0], q[1]); lo = Math.min(lo, hh); hi = Math.max(hi, hh); }
      if (hi - lo > 3.5 || lo < W.WATER + 1) continue;
      const by = (lo + hi) / 2 - 0.1, m = mesh(kind === 'diner' ? diner : gas, bldMat); m.position.set(x, by, z); m.rotation.set(0, th, 0); m.scale.set(1, 1, 1);
      const sp = L(...(kind === 'diner' ? [-9.5, -6] : [-9, -12])), py = mesh(faceGeo, bizMat(kind)); // pylon sign by the road, facing oncoming traffic
      py.position.set(sp[0], by + 6.4, sp[1]); py.rotation.set(0, Math.atan2(-PT.tx, -PT.tz), 0); py.scale.set(4.2, 1.3, 1);
      const cols = kind === 'diner' ? [[-4, 0, 4.9], [4, 0, 4.9], [-9.5, -6, 0.4]] : [[0, 5, 5.2], [-5, -3, 0.5], [5, -3, 0.5], [-5, -9, 0.5], [5, -9, 0.5], [-2.2, -6, 0.7], [2.2, -6, 0.7], [-9, -12, 0.4]];
      for (const [lx, lz, r] of cols) { const q = L(lx, lz); solids.push({ x: q[0], z: q[1], r, y: by }); }
      if (T.queryTrees) for (const t of T.queryTrees(x, z, 22)) T.removeTree(t.id);
      placed.push({ kind, s, x, z, side: dir });
    }
    for (let i = used; i < pool.length; i++) pool[i].visible = false;
    lastS = sCur; dirty = false;
  }
  return {
    update(sCur) { if (dirty || Math.abs(sCur - lastS) > 150) rebuild(sCur); },
    shift() { dirty = true; }, // positions are local: rebuild after a floating-origin shift
    solids, get placed() { return placed; }, get stats() { return { meshes: used, delineators: dels.count, textures: tex.size }; },
    clearTrees() { for (const p of placed) if (p.x != null) for (const t of T.queryTrees(p.x, p.z, 22)) T.removeTree(t.id); },
  };
}
