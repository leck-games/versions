// Trees: hashed per 6 m cell from biome weights (no storage), species per biome, 3 HP each (physics decides damage),
// damage shown as lean + trunk cracks + leaf tint, burn progress scorches -> charred dead trunk. HP==0 -> despawn, stays gone.
// Rendering: near LOD = low-poly instanced meshes (one draw per species) with vertex-shader wind sway;
// far LOD = camera-facing impostor cards with per-species comic silhouettes (one draw call).
import * as THREE from 'three';
import { sample, biomeWeights, clump, hash2, WATER, snowLine, REG } from './world.js';
import { U, COMIC } from './comic.js';

export const SPECIES = ['conifer', 'broadleaf', 'acacia', 'scrub', 'cactus', 'dead'];
const SP = { CONIFER: 0, BROAD: 1, ACACIA: 2, SCRUB: 3, CACTUS: 4, DEAD: 5 };
const RADIUS = [0.45, 0.55, 0.35, 0.9, 0.45, 0.4];       // trunk collision radius at scale 1
const TC = 6;                                             // placement cell (m)
const KEY = (ci, cj) => (ci + 32768) * 65536 + (cj + 32768);
const unkey = id => [Math.floor(id / 65536) - 32768, (id % 65536) - 32768];
const BWl = new Float32Array(6), SOt = {};

// ---------- geometry ----------
function partsGeo(parts) {
  const P = [], N = [], Cc = [], F = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const [g0, col, fol, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1]] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0; m.compose(v.set(...pos), q.setFromEuler(e.set(...rot)), new THREE.Vector3(...scl)); g.applyMatrix4(m); g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array; c3(col);
    for (let i = 0; i < p.length; i += 3) { P.push(p[i], p[i + 1], p[i + 2]); N.push(n[i], n[i + 1], n[i + 2]); Cc.push(cc.r, cc.g, cc.b); F.push(fol); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(Cc, 3)); g.setAttribute('fol', new THREE.Float32BufferAttribute(F, 1));
  g.computeBoundingBox(); return g;
}
const cc = new THREE.Color(); const c3 = h => cc.setHex(h, THREE.LinearSRGBColorSpace);
const cyl = (r0, r1, h, s = 6) => new THREE.CylinderGeometry(r1, r0, h, s, 1).translate(0, h / 2, 0);
const cone = (r, h, s = 7) => new THREE.ConeGeometry(r, h, s).translate(0, h / 2, 0);
const ico = (r, d = 1) => new THREE.IcosahedronGeometry(r, d);
function speciesGeos() {
  const BARK = 0x6b4a32, DBARK = 0x4a3324;
  return [
    partsGeo([[cyl(0.36, 0.2, 3.4), BARK, 0], [cone(2.7, 4.4), 0x2e6b3a, 1, [0, 2.6, 0]], [cone(2.15, 3.8), 0x377a40, 1, [0, 4.9, 0], [0, 0.4, 0]], [cone(1.55, 3.2), 0x43894a, 1, [0, 7.0, 0], [0, 0.9, 0]], [cone(0.8, 1.8), 0x4c9550, 1, [0, 9.0, 0]]]),
    partsGeo([[cyl(0.46, 0.28, 4.4), BARK, 0], [cyl(0.2, 0.12, 2.2), BARK, 0, [0, 3.2, 0], [0, 0, -0.7]], [cyl(0.2, 0.12, 2.0), BARK, 0, [0, 3.4, 0], [0.6, 0, 0.5]],
      [ico(2.6), 0x4f8f34, 1, [0, 6.1, 0], [0, 0, 0], [1, 0.85, 1]], [ico(1.85), 0x5c9c3a, 1, [1.6, 5.0, 0.4]], [ico(1.75), 0x47852f, 1, [-1.4, 5.3, -0.6]], [ico(1.5), 0x66a843, 1, [0.2, 7.6, -0.3]]]),
    partsGeo([[cyl(0.3, 0.16, 3.6), DBARK, 0, [0, 0, 0], [0.08, 0, 0.05]], [cyl(0.14, 0.09, 2.2), DBARK, 0, [0.1, 3.0, 0], [0, 0, -0.75]], [cyl(0.14, 0.09, 2.1), DBARK, 0, [0, 3.1, 0], [0.7, 0, 0.6]],
      [ico(1, 1), 0x7b8a35, 1, [0.3, 4.7, 0.1], [0, 0, 0], [4.3, 0.75, 3.6]], [ico(1, 1), 0x8a9a3c, 1, [1.4, 5.1, 0.7], [0, 0, 0], [2.4, 0.55, 2.2]], [ico(1, 1), 0x6f7d30, 1, [-1.3, 4.9, -0.8], [0, 0, 0], [2.2, 0.5, 2.0]]]),
    partsGeo([[ico(0.95, 0), 0x8f9440, 1, [0, 0.55, 0], [0, 0, 0], [1.2, 0.7, 1.1]], [ico(0.75, 0), 0xa0a048, 1, [0.7, 0.5, 0.3], [0.4, 0, 0], [1, 0.8, 1]], [ico(0.7, 0), 0x7f8838, 1, [-0.6, 0.45, -0.4], [0, 0.5, 0], [1, 0.8, 1]], [ico(0.55, 0), 0xa8aa52, 1, [0.1, 1.15, 0.1]]]),
    partsGeo([[cyl(0.38, 0.34, 4.2, 8), 0x3f8a48, 1], [ico(0.36, 1), 0x3f8a48, 1, [0, 4.2, 0]], [cyl(0.22, 0.22, 1.0, 6), 0x47964f, 1, [0.35, 1.7, 0], [0, 0, -1.57]], [cyl(0.22, 0.2, 1.5, 6), 0x47964f, 1, [1.2, 1.7, 0]],
      [cyl(0.2, 0.2, 0.8, 6), 0x47964f, 1, [-0.3, 2.4, 0], [0, 0, 1.57]], [cyl(0.2, 0.18, 1.2, 6), 0x47964f, 1, [-1.05, 2.4, 0]]]),
    partsGeo([[cyl(0.34, 0.12, 6.6, 6), 0x1c1714, 0], [cyl(0.1, 0.04, 2.0, 4), 0x1c1714, 0, [0, 3.2, 0], [0, 0, -0.9]], [cyl(0.09, 0.03, 1.7, 4), 0x1c1714, 0, [0, 4.4, 0], [0.8, 0, 0.7]], [cyl(0.08, 0.03, 1.4, 4), 0x1c1714, 0, [0, 5.2, 0], [-0.7, 0, 0.2]]]),
  ];
}
const NEAR_VS = /* glsl */`
  attribute vec3 color; attribute float fol; attribute vec4 iPos, iPar; attribute vec3 iCol;
  uniform float uH, uSway; varying vec3 vW, vN, vC, vL; varying float vF, vHP, vBurn;
  ` + 'uniform vec3 uWind; uniform float uTime;' + /* glsl */`
  void main(){
    float sc = iPar.x, hp = iPar.y, burn = iPar.z, la = iPar.w;
    vec3 p = position * sc, n = normal;
    float c = cos(iPos.w), s = sin(iPos.w); mat2 R = mat2(c, -s, s, c); p.xz = R * p.xz; n.xz = R * n.xz;
    float hn = clamp(position.y / uH, 0., 1.);
    float lean = (1. - hp) * 0.5; vec2 ld = vec2(cos(la), sin(la));
    p.xz += ld * p.y * sin(lean); p.y *= cos(lean);
    float ph = uTime * (1.0 + 0.07 * uWind.z) + iPos.x * 0.13 + iPos.z * 0.11;
    float sw = (sin(ph) * 0.55 + sin(ph * 2.3 + 1.0) * 0.22 + 0.5) * (0.25 + 0.075 * uWind.z) * uSway;
    p.xz += uWind.xy * sw * hn * hn * sc * (1.0 - burn * 0.7);
    if (burn > 0.0) p *= mix(1.0, 0.82 + 0.18 * (1.0 - hn), fol * burn); // foliage curls while burning
    vec3 w = iPos.xyz + p;
    vW = w; vN = n; vC = mix(color, color * iCol, fol); vL = position; vF = fol; vHP = hp; vBurn = burn;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  }`;
const NEAR_FS = COMIC + /* glsl */`
  varying vec3 vW, vN, vC, vL; varying float vF, vHP, vBurn;
  void main(){
    vec3 N = normalize(vN); if (!gl_FrontFacing) N = -N;
    vec3 al = vC; float dmg = 1. - vHP;
    if (dmg > 0.01) {
      if (vF < 0.5) { // trunk cracks: jagged ink zig-zags + pale splintered wood, more with each HP lost
        float a = atan(vL.z, vL.x);
        float zz = abs(fract(vL.y * 1.6 + 0.25 * sin(a * 3.0)) - 0.5);
        float cr = abs(sin(a * 2.0 + vL.y * 0.9 + 3.0 * zz)) ;
        float lines = step(cr, 0.07 + 0.1 * dmg) * step(vL.y, 1.0 + 4.0 * dmg);
        al = mix(al, vec3(.86,.72,.48), step(cr, 0.16 + 0.1 * dmg) * step(vL.y, 1.0 + 4.0 * dmg) * 0.8);
        al = mix(al, vec3(.04,.03,.03), lines);
      } else al = mix(al, al * vec3(1.25, 1.0, 0.45), dmg * 0.7);
    }
    float b = vBurn;
    al = mix(al, vec3(.09,.07,.06), smoothstep(0.05, 0.9, b) * (0.55 + 0.45 * vF));
    vec3 col = comic(al, N, vW, 0.7);
    if (b > 0.01 && b < 0.999) { // glowing embers in the crown / along the trunk while burning
      float fl = 0.5 + 0.5 * sin(uTime * 12. + vL.y * 3. + vL.x * 5.);
      float spot = step(0.62 - 0.25 * b, fract(sin(dot(floor(vL * 2.2), vec3(12.9, 78.2, 37.7))) * 43758.5));
      col += mix(vec3(1., .3, .05), vec3(1., .85, .3), fl) * spot * (0.7 + 0.6 * uNight);
    }
    gl_FragColor = vec4(col, ncode(N));
  }`;
// impostor silhouettes in card space (u in -1..1, v 0..1); returns >0 inside: 1 = foliage, 0.5 = trunk
const IMP_FS = COMIC + /* glsl */`
  varying vec2 vUv; varying vec3 vW, vC, vR; varying float vSp, vHP, vBurn;
  float circ(vec2 p, vec2 c, float r){ return step(length(p - c), r); }
  void main(){
    vec2 p = vUv; float sp = vSp, fo = 0., tr = 0.; vec2 cn = vec2(0.5, 0.6); float rr = 0.4;
    if (sp < 0.5) { tr = step(abs(p.x - .5), .045) * step(p.y, .3);
      for (int k = 0; k < 3; k++) { float y0 = .22 + .24 * float(k), hw = (.5 - .1 * float(k)) * (1. - (p.y - y0) / .36); fo = max(fo, step(y0, p.y) * step(abs(p.x - .5), hw)); }
      cn = vec2(.5, .5); rr = .45; }
    else if (sp < 1.5) { tr = step(abs(p.x - .5), .06) * step(p.y, .5);
      fo = max(max(circ(p, vec2(.5,.66), .3), circ(p, vec2(.3,.54), .2)), max(circ(p, vec2(.7,.54), .2), circ(p, vec2(.52,.86), .14))); }
    else if (sp < 2.5) { tr = step(abs(p.x - .5 - (p.y - .4) * .25 * sign(p.x - .5)), .04) * step(p.y, .74);
      vec2 q = (p - vec2(.5,.78)) / vec2(.5, .12); fo = step(dot(q,q), 1.); cn = vec2(.5,.78); }
    else if (sp < 3.5) { vec2 q = (p - vec2(.5,.42)) / vec2(.5, .4); fo = step(dot(q,q), 1. - .12 * sin(atan(q.y,q.x) * 5.)); cn = vec2(.5,.42); }
    else if (sp < 4.5) { fo = max(step(abs(p.x - .5), .09) * step(p.y, .95), max(step(abs(p.x - .78), .06) * step(.4, p.y) * step(p.y, .7), step(abs(p.x - .24), .06) * step(.5, p.y) * step(p.y, .78)));
      fo = max(fo, step(abs(p.y - .42), .05) * step(.5, p.x) * step(p.x, .8)); }
    else { tr = step(abs(p.x - .5), .06 * (1. - p.y * .6)) * step(p.y, .95) + step(abs(p.y - .5 - (p.x - .5)), .025) * step(.5, p.x) * step(p.x, .75); }
    if (fo + tr < 0.5) discard;
    float isF = step(0.5, fo);
    vec2 d = (p - cn) / rr; vec3 N = normalize(vR * d.x * 0.8 + vec3(0., 1., 0.) * (0.35 + d.y * 0.5) + normalize(cameraPosition - vW) * 0.6);
    vec3 al = isF > 0.5 ? vC : vec3(.42,.3,.2);
    if (sp > 4.5) al = vec3(.11,.09,.08);
    al = mix(al, al * vec3(1.25, 1.0, 0.45), (1. - vHP) * 0.7 * isF);
    al = mix(al, vec3(.09,.07,.06), smoothstep(0.05, 0.9, vBurn));
    vec3 col = comic(al, N, vW, 0.0);
    if (vBurn > 0.01 && vBurn < 0.999) col += vec3(1., .45, .1) * step(0.7, fract(sin(dot(floor(p * 9.), vec2(12.9, 78.2))) * 43758.5)) * 0.8;
    gl_FragColor = vec4(col, ncode(N) * 0.9 + 0.05);
  }`;
const IMP_VS = /* glsl */`
  attribute vec4 iPos, iPar; attribute vec3 iCol; attribute float iSp; uniform vec3 uWH[6]; uniform vec3 uFC[6];
  varying vec2 vUv; varying vec3 vW, vC, vR; varying float vSp, vHP, vBurn;
  uniform vec3 uWind; uniform float uTime;
  void main(){
    int k = int(iSp + 0.5); vec3 wh = uWH[0], fc = uFC[0];
    for (int i = 1; i < 6; i++) if (i == k) { wh = uWH[i]; fc = uFC[i]; }
    vec3 toC = cameraPosition - iPos.xyz; vec3 R = normalize(vec3(toC.z, 0., -toC.x));
    float sc = iPar.x, lean = (1. - iPar.y) * 0.5; vec2 ld = vec2(cos(iPar.w), sin(iPar.w));
    vec3 w = iPos.xyz + R * position.x * wh.x * sc + vec3(0., position.y * wh.y * sc * cos(lean), 0.);
    w.xz += ld * position.y * wh.y * sc * sin(lean);
    float sw = (sin(uTime + iPos.x * 0.13 + iPos.z * 0.11) * 0.55 + 0.5) * (0.25 + 0.075 * uWind.z) * wh.z;
    w.xz += uWind.xy * sw * position.y * position.y * sc;
    vUv = vec2(position.x + 0.5, position.y); vW = w; vC = iCol * fc; vR = R; vSp = iSp; vHP = iPar.y; vBurn = iPar.z;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.);
  }`;

export function createTrees({ fuelAt, heightAt, emit = () => {}, nearR = 110, farR = 330 } = {}) {
  const cells = new Map();          // id -> tree | null  (pure function of the world, cached)
  const hp = new Map(), removed = new Set(), burn = new Map(), burning = new Set(), leanDir = new Map();
  const SPH = [9.8, 8.6, 5.6, 1.6, 4.6, 6.6];  // geometry heights (set from geos when rendering)
  const BASECOL = [[0.9, 1.0, 0.92], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1], [1, 1, 1]];
  function evalCell(ci, cj) {
    const id = KEY(ci, cj); if (cells.has(id)) return cells.get(id);
    let t = null;
    const x0 = (ci + 0.5) * TC, z0 = (cj + 0.5) * TC; biomeWeights(x0, z0, BWl);
    const h1 = hash2(ci, cj, 51), cl = clump(x0, z0);
    const pF = BWl[2] * (0.42 + 0.5 * cl), pA = BWl[5] * 0.06, pAc = BWl[1] * 0.045, pS = BWl[0] * 0.05 + BWl[1] * 0.025, pL = BWl[0] * 0.008, pC = BWl[3] * 0.012;
    const tot = pF + pA + pAc + pS + pL + pC;
    if (h1 < tot) {
      let sp; const r = h1;
      if (r < pF) sp = hash2(ci, cj, 53) < 0.5 + 0.3 * Math.sin(x0 * 0.004 + z0 * 0.003) ? SP.CONIFER : SP.BROAD;
      else if (r < pF + pA) sp = SP.CONIFER; else if (r < pF + pA + pAc) sp = SP.ACACIA; else if (r < pF + pA + pAc + pS) sp = SP.SCRUB; else if (r < tot - pC) sp = SP.BROAD; else sp = SP.CACTUS;
      const x = (ci + 0.12 + 0.76 * hash2(ci, cj, 52)) * TC, z = (cj + 0.12 + 0.76 * hash2(ci, cj, 54)) * TC;
      const o = sample(x, z, SOt);
      const ok = o.h > WATER + 1.0 && o.road < 0.02 && o.rd > 3 && o.riv > 3 && !(o.dom === REG.ALPINE && o.h > snowLine(x, z) - 10) && !(o.dom === REG.CANYON);
      if (ok) {
        const s = sp === SP.SCRUB ? 0.8 + 0.7 * hash2(ci, cj, 55) : sp === SP.ACACIA ? 0.85 + 0.45 * hash2(ci, cj, 55) : 0.75 + 0.6 * hash2(ci, cj, 55);
        const v = 0.85 + 0.3 * hash2(ci, cj, 56), dry = sp === SP.SCRUB || sp === SP.ACACIA ? 1 : 0;
        t = { id, x, z, y: o.h - 0.15, sp, s, rot: hash2(ci, cj, 57) * 6.283, tint: [v * (1 + 0.15 * dry * (hash2(ci, cj, 58) - 0.3)), v, v * (0.9 + 0.2 * hash2(ci, cj, 59))], lean: hash2(ci, cj, 60) * 6.283 };
      }
    }
    cells.set(id, t); return t;
  }
  function live(t) { return t && !removed.has(t.id); }
  function view(t) {
    const b = burn.get(t.id) || 0, charred = b >= 1;
    return { id: t.id, pos: { x: t.x, y: t.y, z: t.z }, radius: RADIUS[charred ? SP.DEAD : t.sp] * t.s, height: SPH[t.sp] * t.s * (charred ? 0.75 : 1), hp: hp.get(t.id) ?? 3, maxHp: 3,
      species: SPECIES[t.sp], burning: burning.has(t.id), charred, burn: b };
  }
  // queryTrees({x,z,r}) | ({minX,minZ,maxX,maxZ}) | (x,z,r)
  function queryTrees(a, b, c) {
    let x0, z0, x1, z1, cx, cz, r = -1;
    if (typeof a === 'number') { cx = a; cz = b; r = c; } else if (a && a.r !== undefined) { cx = a.x; cz = a.z; r = a.r; } else { x0 = a.minX; z0 = a.minZ; x1 = a.maxX; z1 = a.maxZ; }
    if (r >= 0) { x0 = cx - r; x1 = cx + r; z0 = cz - r; z1 = cz + r; }
    const out = [], i0 = Math.floor((x0 - 3) / TC), i1 = Math.floor((x1 + 3) / TC), j0 = Math.floor((z0 - 3) / TC), j1 = Math.floor((z1 + 3) / TC);
    if ((i1 - i0) * (j1 - j0) > 40000) throw new Error('queryTrees: area too large');
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const t = evalCell(i, j); if (!live(t)) continue; const rad = RADIUS[t.sp] * t.s;
      if (r >= 0) { const d = Math.hypot(t.x - cx, t.z - cz); if (d > r + rad) continue; } else if (t.x + rad < x0 || t.x - rad > x1 || t.z + rad < z0 || t.z - rad > z1) continue;
      out.push(view(t));
    }
    return out;
  }
  function find(id) { const [ci, cj] = unkey(id); const t = evalCell(ci, cj); return live(t) && t.id === id ? t : null; }
  let dirty = true;
  function removeTree(id) { if (removed.has(id)) return false; removed.add(id); burning.delete(id); hp.delete(id); dirty = true; emit('tree:removed', { id }); return true; }
  function setTreeHP(id, v) { const t = find(id); if (!t) return 0; v = Math.max(0, Math.min(3, Math.round(v))); if (v <= 0) { removeTree(id); return 0; } hp.set(id, v); dirty = true; return v; }
  function damageTree(id, amount = 1, opts = {}) {
    const t = find(id); if (!t) return 0;
    if (opts.dir) leanDir.set(id, Math.atan2(opts.dir.z ?? opts.dir[2] ?? 0, opts.dir.x ?? opts.dir[0] ?? 0));
    return setTreeHP(id, (hp.get(id) ?? 3) - amount);
  }
  function igniteTree(id) { const t = find(id); if (!t || burning.has(id) || (burn.get(id) || 0) >= 1 || t.sp === SP.CACTUS) return false; burning.add(id); dirty = true; emit('tree:burning', { id }); return true; }
  function getTree(id) { const t = find(id); return t ? view(t) : null; }
  // burning progress: ~20 s to charred; rain (rainAt>0.35) puts it out (scorch stays). Scrub burns away entirely.
  function tick(dt, rainAt) {
    for (const id of burning) {
      const t = find(id); if (!t) { burning.delete(id); continue; }
      const r = rainAt ? rainAt(t.x, t.z) : 0;
      if (r > 0.35) { burning.delete(id); dirty = true; emit('tree:extinguished', { id }); continue; }
      const b = Math.min(1, (burn.get(id) || 0) + dt / (t.sp === SP.SCRUB ? 9 : 20)); burn.set(id, b); dirty = true;
      if (b >= 1) { burning.delete(id); emit('tree:burnt', { id }); if (t.sp === SP.SCRUB) removeTree(id); }
    }
  }
  // ---------- rendering ----------
  let near = [], imp = null, lastBuild = { x: 1e9, z: 1e9, dx: 0, dz: 0, t: -1 }, nearCount = 0, impCount = 0, pending = false, time = 0;
  const NMAX = [1800, 1800, 500, 1100, 300, 700], IMAX = 9000;
  function attrs(g, max, withSp) {
    const a = { iPos: new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4), iPar: new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4), iCol: new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3) };
    if (withSp) a.iSp = new THREE.InstancedBufferAttribute(new Float32Array(max), 1);
    for (const k in a) { a[k].setUsage(THREE.DynamicDrawUsage); g.setAttribute(k, a[k]); } g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7); return a;
  }
  function setup(scene) {
    const geos = speciesGeos();
    geos.forEach((g0, k) => {
      SPH[k] = g0.boundingBox.max.y;
      const g = new THREE.InstancedBufferGeometry(); for (const n in g0.attributes) g.setAttribute(n, g0.attributes[n]);
      const a = attrs(g, NMAX[k]);
      const mat = new THREE.ShaderMaterial({ uniforms: { ...U, uH: { value: SPH[k] }, uSway: { value: k === 0 ? 0.6 : k === 4 || k === 5 ? 0.12 : k === 3 ? 0.5 : 1 } }, vertexShader: NEAR_VS, fragmentShader: NEAR_FS, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; scene.add(mesh); near.push({ mesh, g, a, n: 0 });
    });
    const W = [5.4, 6.6, 9.2, 3.2, 3.2, 2.4];
    const ig = new THREE.InstancedBufferGeometry(); ig.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1, 0], 3)); ig.setIndex([0, 1, 2, 0, 2, 3]);
    const ia = attrs(ig, IMAX, true);
    const im = new THREE.ShaderMaterial({ uniforms: { ...U, uWH: { value: SPH.map((h, k) => new THREE.Vector3(W[k], h * 1.04, k === 0 ? 0.6 : k >= 4 ? 0.1 : 1)) }, uFC: { value: [0x377a40, 0x558f37, 0x7b8a35, 0x8f9440, 0x3f8a48, 0x1c1714].map(h => new THREE.Color().setHex(h, THREE.LinearSRGBColorSpace)) } }, vertexShader: IMP_VS, fragmentShader: IMP_FS, side: THREE.DoubleSide });
    const imesh = new THREE.Mesh(ig, im); imesh.frustumCulled = false; scene.add(imesh); imp = { mesh: imesh, g: ig, a: ia };
    return [...near.map(n => n.mesh), imesh];
  }
  function put(a, i, t, sp, b) {
    const charred = b >= 1, k = i * 4, sc = charred && sp !== SP.DEAD ? t.s * SPH[t.sp] / SPH[SP.DEAD] * 0.8 : t.s;
    a.iPos.array[k] = t.x; a.iPos.array[k + 1] = t.y; a.iPos.array[k + 2] = t.z; a.iPos.array[k + 3] = t.rot;
    a.iPar.array[k] = sc; a.iPar.array[k + 1] = (hp.get(t.id) ?? 3) / 3; a.iPar.array[k + 2] = charred ? 1 : b; a.iPar.array[k + 3] = leanDir.has(t.id) ? leanDir.get(t.id) : t.lean;
    const c = BASECOL[t.sp]; a.iCol.array[i * 3] = t.tint[0] * c[0]; a.iCol.array[i * 3 + 1] = t.tint[1] * c[1]; a.iCol.array[i * 3 + 2] = t.tint[2] * c[2];
  }
  function rebuild(cx, cz, dx, dz, budgetMs) {
    const t0 = performance.now(); pending = false;
    for (const n of near) n.n = 0; let ni = 0;
    const R = farR, i0 = Math.floor((cx - R) / TC), i1 = Math.floor((cx + R) / TC), j0 = Math.floor((cz - R) / TC), j1 = Math.floor((cz + R) / TC), R2 = R * R, N2 = nearR * nearR;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const wx = (i + 0.5) * TC - cx, wz = (j + 0.5) * TC - cz, d2 = wx * wx + wz * wz; if (d2 > R2) continue;
      const id = KEY(i, j); let t;
      if (cells.has(id)) t = cells.get(id); else { if (performance.now() - t0 > budgetMs && d2 > 900) { pending = true; continue; } t = evalCell(i, j); }
      if (!live(t)) continue;
      const d = Math.sqrt(d2); if (d > 25 && (wx * dx + wz * dz) < -0.42 * d) continue; // behind camera
      const b = burn.get(t.id) || 0, sp = b >= 1 ? SP.DEAD : t.sp;
      if (d2 < N2 * (0.9 + 0.2 * hash2(i, j, 61))) { const L = near[sp]; if (L.n < NMAX[sp]) put(L.a, L.n++, t, sp, b); }
      else if (ni < IMAX) { put(imp.a, ni, t, sp, b); imp.a.iSp.array[ni] = sp; ni++; }
    }
    nearCount = 0;
    for (const L of near) { L.g.instanceCount = L.n; nearCount += L.n; for (const k in L.a) { L.a[k].needsUpdate = true; L.a[k].clearUpdateRanges(); L.a[k].addUpdateRange(0, Math.max(1, L.n * L.a[k].itemSize)); } }
    imp.g.instanceCount = impCount = ni; for (const k in imp.a) imp.a[k].needsUpdate = true;
  }
  function update(dt, camPos, camDir, rainAt) {
    time += dt; tick(dt, rainAt);
    if (!imp) return;
    const lb = lastBuild, len = Math.hypot(camDir.x, camDir.z) || 1, dx = camDir.x / len, dz = camDir.z / len;
    const moved = Math.hypot(camPos.x - lb.x, camPos.z - lb.z), turned = dx * lb.dx + dz * lb.dz < 0.96;
    if (moved > 8 || turned || pending || ((dirty || burning.size) && time - lb.t > 0.25)) {
      rebuild(camPos.x, camPos.z, dx, dz, lb.t < 0 ? 400 : 5); Object.assign(lb, { x: camPos.x, z: camPos.z, dx, dz, t: time }); dirty = false;
    }
  }
  function burningList() { const out = []; for (const id of burning) { const t = find(id); if (t) out.push({ id, x: t.x, y: t.y, z: t.z, h: SPH[t.sp] * t.s, b: burn.get(id) || 0, sp: t.sp }); } return out; }
  return {
    queryTrees, damageTree, removeTree, setTreeHP, getTree, igniteTree, burningList, setup, update,
    stats: () => ({ near: nearCount, impostors: impCount, cached: cells.size, removed: removed.size, burning: burning.size, damaged: hp.size }),
    save: () => ({ removed: [...removed], hp: [...hp], burn: [...burn].filter(([, b]) => b >= 1).map(([id]) => id) }),
    reset() { hp.clear(); removed.clear(); burn.clear(); burning.clear(); leanDir.clear(); dirty = true; },
    load(s) { if (!s) return; (s.removed || []).forEach(id => removed.add(id)); (s.hp || []).forEach(([id, v]) => hp.set(id, v)); (s.burn || []).forEach(id => burn.set(id, 1)); dirty = true; },
    isBurnable: t => t.species === 'scrub' || t.species === 'acacia' || t.species === 'broadleaf' || t.species === 'conifer',
  };
}
