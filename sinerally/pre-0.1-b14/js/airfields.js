// airfields.js — SineRally UI: procedural runways + airfield props for the planes (js/plane.js).
// The world module (terrain/world.js) sites and flattens the fields (W.AF); this file paints them:
// a textured runway quad (piano keys, heading numbers, centre dashes, aim blocks / dirt strip ruts + edge markers),
// hangar, windsock, tower, fuel tank, and the solids planes can hit. Also minimap / world-map drawing helpers.
import * as THREE from 'three';
import { roadMat } from './terrain/comic.js';
import { P, merge } from './models.js';

const DEG = 180 / Math.PI;
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// Runway canvas: x = across (left -> right for a pilot rolling toward +s), y = along (canvas top = +s end)
function paintRunway(a, scale) {
  const Wm = a.W * 2, Lm = a.L * 2, W = Math.round(128 * scale * (a.paved ? 2 : 1)), H = Math.round(1024 * scale * (a.paved ? 2 : 1.25));
  const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const ppx = W / Wm, ppy = H / Lm, X = t => (t + a.W) * ppx, Y = s => (a.L - s) * ppy; // t here = metres to the right of the centre line
  const r = rng(a.id.length * 977 + Math.round(a.x));
  if (a.paved) {
    g.fillStyle = '#4a4b50'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 1600 * scale; i++) { const v = 60 + r() * 30 | 0; g.fillStyle = `rgba(${v},${v},${v + 4},0.35)`; g.fillRect(r() * W, r() * H, 1 + r() * 3 * scale, 1 + r() * 9 * scale); }
    g.fillStyle = 'rgba(40,40,44,0.35)';                    // darker wheel-path band down the middle
    g.fillRect(X(-a.W * 0.35), 0, a.W * 0.7 * ppx, H);
    for (const end of [-1, 1]) for (let k = 0; k < 26; k++) { // rubber deposits around the touchdown zones
      const s = end * (a.L - 120 - r() * 260), t = (r() - 0.5) * 5;
      g.fillStyle = `rgba(22,22,24,${0.15 + r() * 0.25})`; g.fillRect(X(t - 1.2), Y(s) - 30 * ppy, 0.5 * ppx + 1, (25 + r() * 40) * ppy);
      g.fillRect(X(t + 1.2), Y(s) - 30 * ppy, 0.5 * ppx + 1, (25 + r() * 40) * ppy);
    }
    g.fillStyle = '#f2f2ec';
    g.fillRect(X(-a.W + 1), 0, 0.9 * ppx, H); g.fillRect(X(a.W - 1.9), 0, 0.9 * ppx, H); // edge lines
    for (let s = -a.L + 80; s < a.L - 80; s += 50) g.fillRect(X(-0.45), Y(s + 30), 0.9 * ppx, 30 * ppy); // centre dashes
    const hdg = ((Math.atan2(a.dx, a.dz) * DEG) % 360 + 360) % 360, num = n => String(((Math.round(n / 10) + 35) % 36) + 1).padStart(2, '0');
    for (const end of [-1, 1]) {
      g.save(); g.translate(W / 2, H / 2); if (end > 0) g.rotate(Math.PI); g.translate(-W / 2, -H / 2); // paint the -s end; the +s end is the same, rotated
      const keys = 8, kw = (a.W * 2 - 6) / (keys * 2);
      for (let k = 0; k < keys * 2; k++) if (k !== keys - 1 && k !== keys) g.fillRect(X(-a.W + 3 + k * kw + kw * 0.2), Y(-a.L + 36), kw * 0.6 * ppx, 30 * ppy);
      g.fillRect(X(-a.W + 1), Y(-a.L + 4), (a.W * 2 - 2) * ppx, 1.5 * ppy);          // threshold bar
      g.font = `bold ${Math.round(18 * ppy * 1.0)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.save(); g.translate(X(0), Y(-a.L + 44)); g.scale(ppx / ppy * 1.6, 1); g.fillText(num(end < 0 ? hdg : hdg + 180), 0, 0); g.restore();
      for (const sd of [-1, 1]) g.fillRect(X(sd * a.W * 0.42 - 2), Y(-a.L + 190), 4 * ppx, 45 * ppy); // aiming point blocks
      for (const sd of [-1, 1]) for (const d of [300, 450]) for (let b = 0; b < 2; b++) g.fillRect(X(sd * (a.W * 0.42 - 1.5 + b * 2.2) - 0.5), Y(-a.L + d), 1.2 * ppx, 22 * ppy); // TDZ bars
      g.restore();
    }
  } else {
    g.fillStyle = '#8a6a44'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 2600 * scale; i++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(110,84,52,0.4)` : v < 0.8 ? `rgba(150,120,80,0.35)` : `rgba(80,110,50,0.45)`; const sz = 1 + r() * 5 * scale; g.fillRect(r() * W, r() * H, sz, sz * (1 + r() * 3)); }
    for (let i = 0; i < 90; i++) { const t = (r() < 0.5 ? -1 : 1) * (a.W * (0.65 + r() * 0.35)), s = (r() - 0.5) * 2 * a.L; // grass tufts toward the edges
      g.fillStyle = `rgba(${70 + r() * 30 | 0},${100 + r() * 30 | 0},${40 + r() * 20 | 0},0.6)`; g.beginPath(); g.ellipse(X(t), Y(s), (1 + r() * 3) * ppx, (3 + r() * 14) * ppy, 0, 0, 7); g.fill(); }
    g.fillStyle = 'rgba(70,50,30,0.55)';                    // worn ruts
    for (const t of [-1.8, 1.8, -3.4, 3.4]) g.fillRect(X(t - 0.35), 0, 0.7 * ppx, H);
    for (const end of [-1, 1]) {                             // whitewashed threshold chevrons
      g.save(); g.translate(W / 2, H / 2); if (end > 0) g.rotate(Math.PI); g.translate(-W / 2, -H / 2);
      g.strokeStyle = '#f0ece0'; g.lineWidth = 1.6 * ppx;
      for (let k = 0; k < 2; k++) { g.beginPath(); g.moveTo(X(-a.W + 2), Y(-a.L + 6 + k * 10)); g.lineTo(X(0), Y(-a.L + 18 + k * 10)); g.lineTo(X(a.W - 2), Y(-a.L + 6 + k * 10)); g.stroke(); }
      g.restore();
    }
  }
  const tex = new THREE.CanvasTexture(c); tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true; return tex;
}

function stripGeo(a, y) { // quad in the runway frame: world = c + d*s + n*t with n = (dz, -dx); u runs left->right for a pilot facing +s
  const n = [a.dz, -a.dx], pts = [], uv = [];
  const corner = (s, t) => [a.x + a.dx * s + n[0] * t, y, a.z + a.dz * s + n[1] * t];
  const SEG = 8; // a few segments along so the long quad is fine under fog/precision
  for (let i = 0; i <= SEG; i++) { const s = -a.L + 2 * a.L * i / SEG; pts.push(...corner(s, a.W), ...corner(s, -a.W)); uv.push(0, i / SEG, 1, i / SEG); }
  const idx = []; for (let i = 0; i < SEG; i++) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pts.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3)); g.setIndex(idx);
  // winding: make sure the face points up
  g.computeBoundingSphere(); const p = g.attributes.position.array; const ax = p[3] - p[0], az = p[5] - p[2], bx = p[6] - p[0], bz = p[8] - p[2];
  if (az * bx - ax * bz < 0) { for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; } g.setIndex(idx); }
  return g;
}

/** Build all airfields. opts: { scene, AF, heightAt, objMat (vertex-colour comic material), removeTreesNear(x, z, r) } */
export function createAirfields({ scene, AF, heightAt, mat, clearTrees }) {
  const group = new THREE.Group(); group.name = 'airfields'; scene.add(group);
  const solids = [], fields = [], sock = [];
  let scale = 1;
  for (const a of AF) {
    const tex = paintRunway(a, scale), m = roadMat(tex, { offset: -3 }); m.uniforms.uHD.value = 0;
    const strip = new THREE.Mesh(stripGeo(a, a.h + 0.05), m); strip.name = 'runway:' + a.id; strip.frustumCulled = true; group.add(strip);
    const n = [a.dz, -a.dx], at = (s, t) => [a.x + a.dx * s + n[0] * t, a.z + a.dz * s + n[1] * t];
    const yaw = Math.atan2(a.dx, a.dz), parts = [];
    const ground = (x, z, r) => { let lo = 1e9; for (let i = 0; i < 9; i++) { const ang = i / 8 * 6.283, rr = i ? r : 0; lo = Math.min(lo, heightAt(x + Math.cos(ang) * rr, z + Math.sin(ang) * rr)); } return lo; };
    const place = (s, t, r, name, h, build) => { const [x, z] = at(s, t), y = ground(x, z, r); clearTrees && clearTrees(x, z, r + 4); solids.push({ x, y, z, r, h, name }); build(x, y, z); return [x, y, z]; };
    const rot = [0, yaw, 0];
    // hangar (right side of the field, door facing the runway)
    const hg = a.paved ? { w: 30, d: 24, h: 9, roof: 0xb83a2e } : { w: 18, d: 14, h: 6, roof: 0x8f9aa2 };
    place(a.paved ? -a.L * 0.15 : a.L * 0.25, -(a.W + 30 + hg.d / 2), Math.max(hg.w, hg.d) * 0.55, 'HANGAR', hg.h + hg.w * 0.25, (x, y, z) => {
      const local = [];
      local.push(P(new THREE.BoxGeometry(hg.w, hg.h + 3, hg.d), 0xd8d0b8, [0, (hg.h - 3) / 2, 0]));
      local.push(P(new THREE.CylinderGeometry(hg.w / 2, hg.w / 2, hg.d + 0.6, 14, 1, false, -Math.PI / 2, Math.PI), hg.roof, [0, hg.h, 0], [-Math.PI / 2, 0, 0], [1, 1, 0.5]));
      local.push(P(new THREE.BoxGeometry(hg.w * 0.8, hg.h * 0.85, 0.3), 0x3c4048, [0, hg.h * 0.42, hg.d / 2 + 0.1])); // door (faces +z local)
      local.push(P(new THREE.BoxGeometry(hg.w * 0.5, 1.4, 0.35), 0xf2e6b0, [0, hg.h + hg.w * 0.12, hg.d / 2 + 0.2])); // sign board
      const geo = merge(local); geo.rotateY(Math.atan2(n[0], n[1])); geo.translate(x, y, z); parts.push(geo);
    });
    // windsock near the -s threshold, left side
    place(-a.L + 110, a.W + 18, 1.2, 'WINDSOCK', 7, (x, y, z) => {
      parts.push(merge([P(new THREE.CylinderGeometry(0.12, 0.16, 7, 6), 0xdddddd, [x, y + 3.5, z])]));
      const s = merge([P(new THREE.ConeGeometry(0.75, 3.2, 8, 1, true), 0xff7a1a, [0, 0, 1.6], [Math.PI / 2, 0, 0]),
                      P(new THREE.CylinderGeometry(0.62, 0.66, 0.6, 8, 1, true), 0xffffff, [0, 0, 1.0], [Math.PI / 2, 0, 0])]);
      const ms = new THREE.Mesh(s, mat); ms.position.set(x, y + 6.7, z); group.add(ms); sock.push(ms);
    });
    if (a.paved) {
      place(a.L * 0.25, -(a.W + 40), 4, 'TOWER', 19, (x, y, z) => parts.push(merge([
        P(new THREE.CylinderGeometry(2.2, 3, 16, 8), 0xe8e2d0, [x, y + 8, z]),
        P(new THREE.CylinderGeometry(4.2, 3.4, 3.2, 8), 0x2b4a6a, [x, y + 17.6, z]),
        P(new THREE.CylinderGeometry(4.6, 4.6, 0.6, 8), 0xb83a2e, [x, y + 19.5, z]),
        P(new THREE.CylinderGeometry(0.1, 0.1, 3, 4), 0x444444, [x, y + 21, z]),
        P(new THREE.SphereGeometry(0.35, 6, 4), 0xff3020, [x, y + 22.6, z], [0, 0, 0], [1, 1, 1], 1)])));
      for (const sd of [-1, 1]) for (let k = 0; k < 8; k++) { // approach lights
        const [x, z] = at(sd * (a.L + 25 + k * 30), 0), y = heightAt(x, z);
        parts.push(merge([P(new THREE.BoxGeometry(0.3, 1.2, 0.3), 0x666666, [x, y + 0.6, z]), P(new THREE.BoxGeometry(5, 0.35, 0.5), 0xfff1a0, [x, y + 1.3, z], rot, [1, 1, 1], 1)]));
      }
    } else {
      place(a.L * 0.25 + 26, -(a.W + 22), 2, 'FUEL TANK', 4, (x, y, z) => parts.push(merge([
        P(new THREE.CylinderGeometry(1.6, 1.6, 5, 10), 0xd8c25a, [x, y + 2.6, z], [0, yaw, Math.PI / 2]),
        P(new THREE.BoxGeometry(0.4, 1.4, 4), 0x555555, [x, y + 0.7, z], rot)])));
      for (const sd of [-1, 1]) for (let s = -a.L; s <= a.L + 1; s += a.L / 5) { // white edge marker boxes
        const [x, z] = at(s, sd * (a.W + 1.5)), y = heightAt(x, z);
        parts.push(P(new THREE.BoxGeometry(1.6, 0.45, 0.5), 0xf4f0e6, [x, y + 0.2, z], rot));
      }
    }
    const geo = merge(parts.map(p => p.index ? p.toNonIndexed() : p)), mesh = new THREE.Mesh(geo, mat); mesh.name = 'airfield:' + a.id; group.add(mesh);
    fields.push({ a, strip, mesh, tex });
  }
  function setDetail(level, aniso = 4) { // runway canvases: 1x at LOW/MED, 2x at HIGH, 4x at ULTRA
    const sc = level >= 2 ? 4 : level >= 1 ? 2 : 1; if (sc === scale) { for (const f of fields) f.tex.anisotropy = aniso; return; }
    scale = sc; for (const f of fields) { f.tex.dispose(); f.tex = paintRunway(f.a, sc); f.tex.anisotropy = aniso; f.strip.material.uniforms.map.value = f.tex; }
  }
  let wt = 0;
  return {
    group, solids, fields, setDetail,
    get texSize() { const t = fields[0] && fields[0].tex.image; return t ? t.width + 'x' + t.height : '-'; },
    update(dt, wind = [0.6, 0.3]) { wt += dt; for (const s of sock) { s.rotation.y = Math.atan2(wind[0], wind[1]) + Math.sin(wt * 1.3) * 0.15; s.rotation.x = 0.35 + Math.sin(wt * 2.1) * 0.06; } },
    /** Push a ground vehicle out of the airfield buildings (circle vs circle). */
    collide(p, v, rr = 1.6) {
      for (const o of solids) { const dx = p.x - o.x, dz = p.z - o.z, d = Math.hypot(dx, dz), m = o.r + rr; if (d >= m || d < 1e-4 || p.y > o.y + o.h) continue;
        const nx = dx / d, nz = dz / d; p.x = o.x + nx * m; p.z = o.z + nz * m; const vn = v.x * nx + v.z * nz; if (vn < 0) { v.x -= nx * vn * 1.4; v.z -= nz * vn * 1.4; } }
    },
    /** Draw the runways on a 2-D map; proj(x, z) -> [px, py], k = px per metre. */
    draw(g, proj, k, labels = false) {
      for (const { a } of fields) {
        const [x0, y0] = proj(a.x - a.dx * a.L, a.z - a.dz * a.L), [x1, y1] = proj(a.x + a.dx * a.L, a.z + a.dz * a.L);
        g.lineCap = 'butt'; g.strokeStyle = '#111'; g.lineWidth = Math.max(4, a.W * 2 * k + 3); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.strokeStyle = a.paved ? '#5a5b62' : '#a8824e'; g.lineWidth = Math.max(2.5, a.W * 2 * k); g.stroke();
        g.strokeStyle = '#fff'; g.lineWidth = 1; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
        if (labels) { const [cx, cy] = proj(a.x, a.z); g.font = 'bold 12px sans-serif'; g.textAlign = 'center'; g.fillStyle = '#111'; g.fillText('✈ ' + a.name, cx + 1, cy - 9); g.fillStyle = '#fff'; g.fillText('✈ ' + a.name, cx, cy - 10); }
      }
    },
    dispose() { for (const f of fields) { f.tex.dispose(); f.strip.geometry.dispose(); f.strip.material.dispose(); f.mesh.geometry.dispose(); } scene.remove(group); }
  };
}
