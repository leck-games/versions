// Ground rendering: near/far ring-buffer terrain grids (math world sampled per vertex, nothing stored on disk),
// water on the same grids, road ribbons, GPU-instanced grass (burnt grass collapses to black stubble).
import * as THREE from 'three';
import { sample, normal, surfaceOf, colourOf, grassDensity, hash2, clump } from './world.js';
import { U, COMIC, GLSL_ENV, gridTerrainMat, waterMat, roadMat } from './comic.js';
import { createRoads } from './roads.js';

const SWT = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 0], [1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]; // sand, rock, snow, dirt
const SO = { h: 0 }, nv = [0, 1, 0], cv = [0, 0, 0];
class Grid {
  constructor(scene, N, step, mat, withTex) {
    const n = this.n = N + 1; this.N = N; this.step = step;
    this.H = new Float32Array(n * n); this.NRM = new Float32Array(n * n * 3); this.COL = new Float32Array(n * n * 3); this.SW = new Float32Array(n * n * 4); this.CW = new Float32Array(n * n);
    this.gi0 = this.gj0 = null;
    const g = this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * n * 3); this.nor = new Float32Array(n * n * 3); this.col = new Float32Array(n * n * 3); this.sw = new Float32Array(n * n * 4); this.cw = new Float32Array(n * n);
    g.setAttribute('cw', new THREE.BufferAttribute(this.cw, 1));
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3)); g.setAttribute('sw', new THREE.BufferAttribute(this.sw, 4));
    const idx = new (n * n > 65535 ? Uint32Array : Uint16Array)(N * N * 6); let q = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * n + i, b = (j + 1) * n + i, c = (j + 1) * n + i + 1, d = j * n + i + 1; idx[q++] = a; idx[q++] = b; idx[q++] = d; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false; scene.add(this.mesh);
    if (withTex) { this.tdata = new Float32Array(n * n * 4); this.tex = new THREE.DataTexture(this.tdata, n, n, THREE.RGBAFormat, THREE.FloatType); this.tex.minFilter = this.tex.magFilter = THREE.NearestFilter; this.tex.needsUpdate = true; }
  }
  ri(g) { const n = this.n; return ((g % n) + n) % n; }
  compute(gi, gj) {
    const s = this.step, x = gi * s, z = gj * s, k = this.ri(gj) * this.n + this.ri(gi);
    sample(x, z, SO); normal(x, z, nv); const surf = surfaceOf(x, z, SO, nv[1]); colourOf(x, z, SO, nv[1], surf, cv);
    const j = 0.94 + 0.12 * hash2(gi, gj, 3);
    this.H[k] = SO.h; this.NRM.set(nv, k * 3); this.COL[k * 3] = cv[0] * j; this.COL[k * 3 + 1] = cv[1] * j; this.COL[k * 3 + 2] = cv[2] * j;
    this.SW.set(SWT[surf], k * 4);
    // far-forest canopy weight (ground shader paints a cel canopy beyond the tree impostor range)
    this.CW[k] = (SO.h < 0.5 || SO.road > 0.05 || SO.riv < 8 || surf === 4 || surf === 5) ? 0 : Math.min(1, Math.max(0, (SO.bf * (0.42 + 0.5 * clump(x, z)) - 0.3) / 0.4));
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
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const gi = gi0 + i, gj = gj0 + j; if (fresh || gi < o0 || gi > o0 + N || gj < p0 || gj > p0 + N) this.compute(gi, gj); }
    this.gi0 = gi0; this.gj0 = gj0;
    let v = 0;
    for (let j = 0; j < n; j++) { const rj = this.ri(gj0 + j) * n; for (let i = 0; i < n; i++, v++) {
      const k = rj + this.ri(gi0 + i), v3 = v * 3, k3 = k * 3;
      this.pos[v3] = (gi0 + i) * s; this.pos[v3 + 1] = this.H[k]; this.pos[v3 + 2] = (gj0 + j) * s;
      this.nor[v3] = this.NRM[k3]; this.nor[v3 + 1] = this.NRM[k3 + 1]; this.nor[v3 + 2] = this.NRM[k3 + 2];
      this.col[v3] = this.COL[k3]; this.col[v3 + 1] = this.COL[k3 + 1]; this.col[v3 + 2] = this.COL[k3 + 2];
      const v4 = v * 4, k4 = k * 4; this.sw[v4] = this.SW[k4]; this.sw[v4 + 1] = this.SW[k4 + 1]; this.sw[v4 + 2] = this.SW[k4 + 2]; this.sw[v4 + 3] = this.SW[k4 + 3]; this.cw[v] = this.CW[k];
    } }
    const a = this.geo.attributes; a.position.needsUpdate = a.normal.needsUpdate = a.color.needsUpdate = a.sw.needsUpdate = a.cw.needsUpdate = true;
    if (this.tex) this.tex.needsUpdate = true;
    return true;
  }
}
function createGrass(scene, grid, { count = 12000, tile = 72 } = {}) {
  const pos = [], uvs = [];
  for (let b = 0; b < 3; b++) {
    const a = b * 2.1 + 0.3, ox = Math.cos(a * 1.7) * 0.18, oz = Math.sin(a * 1.3) * 0.18, dx = Math.cos(a) * 0.09, dz = Math.sin(a) * 0.09, lean = 0.12 * (b - 1);
    pos.push(ox - dx, 0, oz - dz, ox + dx, 0, oz + dz, ox + lean, 1 - 0.15 * b, oz + lean * 0.5); uvs.push(0, 0, 1, 0, 0.5, 1);
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  const off = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) { off[i * 4] = Math.random() * tile; off[i * 4 + 1] = Math.random() * tile; off[i * 4 + 2] = Math.random(); off[i * 4 + 3] = Math.random() * 6.283; }
  geo.setAttribute('off', new THREE.InstancedBufferAttribute(off, 4)); geo.instanceCount = count; geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, uTex: { value: grid.tex }, uN: { value: grid.n }, uStep: { value: grid.step }, uTile: { value: tile }, uCenter: { value: new THREE.Vector2() } },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      precision highp float; precision highp sampler2D;
      attribute vec4 off; uniform sampler2D uTex; uniform float uN, uStep, uTile, uTime; uniform vec2 uCenter;
      ` + GLSL_ENV + /* glsl */`
      varying vec3 vCol; varying float vY; varying vec3 vW; varying vec2 vF;
      vec4 tx(float gi, float gj) { return texelFetch(uTex, ivec2(int(mod(gi, uN)), int(mod(gj, uN))), 0); }
      void main() {
        vec2 w = off.xy + uTile * floor((uCenter - off.xy) / uTile + 0.5);
        float dist = length(w - uCenter);
        vec2 g = w / uStep, gi = floor(g), f = g - gi;
        vec4 a = tx(gi.x, gi.y), b = tx(gi.x, gi.y + 1.0), c = tx(gi.x + 1.0, gi.y + 1.0), d = tx(gi.x + 1.0, gi.y);
        vec4 s = (f.x + f.y < 1.0) ? a + (d - a) * f.x + (b - a) * f.y : c + (b - c) * (1.0 - f.x) + (d - c) * (1.0 - f.y);
        float dens = s.y;
        float fade = smoothstep(uTile * 0.5, uTile * 0.32, dist);
        float keep = step(off.z, dens) * fade;
        vec3 fs = fireAt(w); float burnt = step(0.5, fs.r);
        float hgt = (0.45 + 0.55 * off.z) * (0.55 + 0.6 * dens) * keep * mix(1.0, 0.16, burnt) * (1.0 - 0.5 * fs.g);
        float cs = cos(off.w), sn = sin(off.w);
        vec3 p = position; p.xz = mat2(cs, -sn, sn, cs) * p.xz * (0.9 + 0.6 * off.z);
        float ws = 0.06 + 0.03 * uWind.z;
        float sway = sin(uTime * (1.4 + 0.12 * uWind.z) + dot(w, uWind.xy) * 0.21 + w.x * 0.05) * ws + ws * 0.8;
        p.x += sway * uWind.x * p.y * p.y; p.z += sway * uWind.y * p.y * p.y;
        p *= hgt;
        vec3 wp = vec3(w.x + p.x, s.x + p.y - 0.05, w.y + p.z);
        vec2 gn = floor(g + 0.5); vec4 cn = tx(gn.x, gn.y); float pc = cn.z; vec3 base = vec3(floor(pc / 256.0), mod(pc, 256.0), cn.w) / 255.0;
        vY = position.y; vW = wp; vF = vec2(burnt, fs.g);
        vCol = base * (0.92 + 0.16 * off.z);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: COMIC + /* glsl */`
      varying vec3 vCol; varying float vY; varying vec3 vW; varying vec2 vF;
      void main() {
        float t = vY < 0.33 ? 0.74 : (vY < 0.72 ? 0.9 : 1.1);
        vec3 al = mix(vCol, vec3(.1,.08,.07), vF.x);
        vec3 c = comic(al * t, vec3(0., 1., 0.), vW, 0.0);
        c = mix(c, mix(vec3(1.,.35,.05), vec3(1.,.85,.25), step(0.6, vY)), step(0.2, vF.y));
        gl_FragColor = vec4(c, 0.);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; scene.add(mesh);
  return { mesh, update(cx, cz) { mat.uniforms.uCenter.value.set(cx, cz); } };
}
export function createGround(scene, { small = false, grassCount } = {}) {
  const NEAR_N = small ? 112 : 128, NEAR_S = 4, FAR_N = small ? 80 : 96, FAR_S = 16;
  const uNear = { value: new THREE.Vector3() };
  const far = new Grid(scene, FAR_N, FAR_S, gridTerrainMat({ far: true, uNear }), false), near = new Grid(scene, NEAR_N, NEAR_S, gridTerrainMat(), true);
  const farDist = FAR_N * FAR_S / 2 + 40;
  const waterN = new THREE.Mesh(near.geo, waterMat()); waterN.frustumCulled = false; scene.add(waterN);
  const waterF = new THREE.Mesh(far.geo, waterMat({ far: true, uNear })); waterF.frustumCulled = false; scene.add(waterF);
  const roads = createRoads(scene, (kind, tex) => {
    if (tex) { tex.colorSpace = THREE.NoColorSpace; tex.needsUpdate = true; }
    return kind === 'asphalt' ? roadMat(tex, { offset: -4 }) : kind === 'dirt' ? roadMat(tex, { offset: -2 }) : roadMat(null, { col: 0xb4aca0 });
  });
  const grass = createGrass(scene, near, { count: grassCount ?? (small ? 11000 : 16000), tile: 72 });
  return {
    near, far, farDist, roads, grass, meshes: [near.mesh, far.mesh, waterN, waterF, ...roads.meshes, grass.mesh],
    update(px, pz, force) {
      near.update(px, pz, force); far.update(px, pz, force);
      uNear.value.set((near.gi0 + near.N / 2) * near.step, (near.gj0 + near.N / 2) * near.step, near.N * near.step / 2);
      roads.update(px, pz, force); grass.update(px, pz);
    },
  };
}
