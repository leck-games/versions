// PLANE EDITION: far-terrain LOD rings (8-15 km view from the air).
// Two extra ring-buffer grids (48 m and 240 m steps) sampled from the SAME math world as the near/far grids
// (Grid.compute -> world.sample), so heights at shared vertices are identical. Each ring discards its fragments
// inside the next-finer ring (with a one-step overlap where it is also sunk below), so there are no cracks and no
// double surfaces. Plus: a simplified road ribbon along the route, low-poly tree-clump impostors on forest cells,
// and water on both rings. Steps divide the floating-origin rebase step (720 m), so Grid.shift stays integral.
import * as THREE from 'three';
import { Grid } from './ground.js';
import { U, COMIC, waterMat } from './comic.js';
import { routePoint, project, ROAD_HW } from './world.js';

function lodMat(uIn, sink, margin) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uIn, uSink: { value: sink }, uMg: { value: margin } }, vertexColors: true,
    vertexShader: `attribute float cw; uniform vec3 uIn; uniform float uSink, uMg; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vCw;
      void main(){ vec3 p = position; vec2 dd = abs(p.xz - uIn.xy); float m = max(dd.x, dd.y);
        p.y -= uSink * clamp((uIn.z - m) / uMg, 0.0, 1.0);
        vW = p; vN = normal; vC = color; vCw = cw; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: COMIC + `uniform vec3 uIn; uniform float uMg; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying float vCw;
      void main(){
        vec2 dd = abs(vW.xz - uIn.xy); if (max(dd.x, dd.y) < uIn.z - uMg) discard;
        vec3 N = normalize(vN), c = vC; float x = vW.x + uOrg.x, z = vW.z + uOrg.y;
        float pat = sin(x*0.011 + sin(z*0.009)*2.) * sin(z*0.010 + sin(x*0.007)*2.);
        c *= mix(1., 0.9, step(0.4, pat));
        float can = vCw;
        if (can > 0.01) { float t1 = sin(x*0.05 + sin(z*0.043)*2.3) * sin(z*0.047 + sin(x*0.037)*2.1);
          vec3 cc = mix(vec3(.10,.26,.12), vec3(.22,.42,.16), step(0.1, t1)); c = mix(c, cc, can); N = normalize(mix(N, vec3(0., 1., 0.), can * 0.6)); }
        float wet0 = 1. - smoothstep(0.0, 0.8, vW.y); c = mix(c, c * vec3(.7,.75,.8), wet0);
        gl_FragColor = vec4(comic(c, N, vW, 1.0), ncode(N));
      }` });
}
function ribbonMat(uIn) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uIn },
    vertexShader: `attribute float side; attribute vec2 nrm; varying vec3 vW;
      void main(){ vec3 p = position; float d = length(p.xz - cameraPosition.xz); p.xz += nrm * side * ${ROAD_HW.toFixed(1)} * max(1.0, d / 900.0);
        p.y += 0.6 + d * 0.0012; vW = p; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: COMIC + `uniform vec3 uIn; varying vec3 vW;
      void main(){ vec2 dd = abs(vW.xz - uIn.xy); if (max(dd.x, dd.y) < uIn.z - 24.) discard;
        gl_FragColor = vec4(comic(vec3(.42,.42,.46), vec3(0.,1.,0.), vW, 1.0), ncode(vec3(0.,1.,0.))); }` });
}

// quality 0..3 (Low/Med/High/Ultra): grid sizes; Med ~8.6 km, Ultra ~15 km
const Q = [{ mid: 64, ult: 48, clumps: 1800 }, { mid: 80, ult: 72, clumps: 3000 }, { mid: 96, ult: 96, clumps: 4500 }, { mid: 112, ult: 128, clumps: 6000 }];

export function createFarLod(scene, ground, quality = 1) {
  const q = Q[Math.max(0, Math.min(3, quality))];
  const uInM = { value: new THREE.Vector3(0, 0, 1) }, uInU = { value: new THREE.Vector3(0, 0, 1) };
  const mid = new Grid(scene, q.mid, 48, lodMat(uInM, 6, 48), false), ult = new Grid(scene, q.ult, 240, lodMat(uInU, 25, 240), false);
  const wM = new THREE.Mesh(mid.geo, waterMat({ far: true, uNear: uInM })), wU = new THREE.Mesh(ult.geo, waterMat({ far: true, uNear: uInU }));
  for (const m of [mid.mesh, ult.mesh, wM, wU]) { m.frustumCulled = false; scene.add(m); }
  mid.mesh.renderOrder = ult.mesh.renderOrder = 1;
  // road ribbon (route centreline +-RIB_L, 32 m steps)
  const RIB_L = 16000, RIB_S = 32, RN = Math.round(2 * RIB_L / RIB_S) + 1;
  const rp = new Float32Array(RN * 2 * 3), rn = new Float32Array(RN * 2 * 2), rs = new Float32Array(RN * 2), ri = [];
  for (let i = 0; i < RN; i++) { rs[i * 2] = -1; rs[i * 2 + 1] = 1; if (i < RN - 1) { const a = i * 2; ri.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }
  const rg = new THREE.BufferGeometry(); rg.setAttribute('position', new THREE.BufferAttribute(rp, 3)); rg.setAttribute('nrm', new THREE.BufferAttribute(rn, 2)); rg.setAttribute('side', new THREE.BufferAttribute(rs, 1)); rg.setIndex(ri);
  const uRib = { value: new THREE.Vector3(0, 0, 1) };
  const ribbon = new THREE.Mesh(rg, ribbonMat(uRib)); ribbon.frustumCulled = false; scene.add(ribbon);
  let ribS = null;
  function buildRibbon(s0) {
    ribS = s0; const P = {};
    for (let i = 0; i < RN; i++) { const p = routePoint(s0 - RIB_L + i * RIB_S, P), nx = p.tz, nz = -p.tx;
      for (let k = 0; k < 2; k++) { const o = (i * 2 + k); rp[o * 3] = p.x; rp[o * 3 + 1] = p.tun ? p.y - 30 : p.y; rp[o * 3 + 2] = p.z; rn[o * 2] = nx; rn[o * 2 + 1] = nz; } }
    rg.attributes.position.needsUpdate = rg.attributes.nrm.needsUpdate = true;
  }
  // tree-clump impostors: low-poly cone pairs on forest cells of the mid + ultra rings (outside the far grid)
  const cone = new THREE.ConeGeometry(1, 1, 5, 1); cone.translate(0, 0.5, 0);
  const cl = new THREE.InstancedMesh(cone, new THREE.ShaderMaterial({ uniforms: U, vertexShader: `varying vec3 vW; varying vec3 vN; varying float vK;
      void main(){ vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.); vW = w.xyz; vN = normalize(mat3(modelMatrix * instanceMatrix) * normal); vK = fract(instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.007); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMIC + `varying vec3 vW; varying vec3 vN; varying float vK; void main(){ vec3 N = normalize(vN); vec3 c = mix(vec3(.09,.24,.11), vec3(.2,.38,.14), step(0.5, vK)); gl_FragColor = vec4(comic(c, N, vW, 1.0), ncode(N)); }` }), q.clumps);
  cl.frustumCulled = false; scene.add(cl);
  const M4 = new THREE.Matrix4();
  function buildClumps() {
    let c = 0; const fz = uInM.value, n = mid.n;
    const add = (g, gi0, gj0) => { const s = g.step;
      for (let j = 0; j < g.n && c < q.clumps; j++) for (let i = 0; i < g.n && c < q.clumps; i++) {
        const k = g.rz(gj0 + j) * g.n + g.rx(gi0 + i), w = g.CW[k]; if (w < 0.45) continue;
        const x = (gi0 + i) * s, z = (gj0 + j) * s; if (Math.max(Math.abs(x - fz.x), Math.abs(z - fz.y)) < fz.z + 8) continue;
        if (g === ult && Math.max(Math.abs(x - uInU.value.x), Math.abs(z - uInU.value.y)) < uInU.value.z) continue;
        const hgi = gi0 + i + g.goi, hgj = gj0 + j + g.goj, hh = Math.abs(Math.sin(hgi * 12.9898 + hgj * 78.233) * 43758.5453) % 1;
        if (hh > (s > 100 ? 0.9 : 0.55)) continue;
        const sc = (s > 100 ? 55 : 20) * (0.7 + 0.6 * hh), ox = (hh - 0.5) * s * 0.6, oz = ((hh * 7.3) % 1 - 0.5) * s * 0.6;
        M4.makeScale(sc * 0.8, sc * (1.1 + 0.4 * w), sc * 0.8).setPosition(x + ox, g.H[k] - 2, z + oz); cl.setMatrixAt(c++, M4);
      } };
    add(mid, mid.gi0, mid.gj0); add(ult, ult.gi0, ult.gj0);
    cl.count = c; cl.instanceMatrix.needsUpdate = true; void n;
  }
  let enabled = true, clumpAt = null;
  const st = { range: q.ult * 240 / 2, midRange: q.mid * 48 / 2, tris: 0, draws: 6, lastMs: 0 };
  const api = {
    meshes: [mid.mesh, ult.mesh, wM, wU, ribbon, cl], mid, ult, stats: st,
    get range() { return st.range; },
    setVisible(v) { enabled = v; for (const m of api.meshes) m.visible = v; },
    get visible() { return enabled; },
    shift(dx, dz) { mid.shift(dx, dz); ult.shift(dx, dz); ribS = null; clumpAt = null; },
    update(px, pz, force) {
      const t0 = performance.now(), F = ground.far;
      const a = mid.update(px, pz, force), b = ult.update(px, pz, force);
      uInM.value.set((F.gi0 + F.N / 2) * F.step, (F.gj0 + F.N / 2) * F.step, F.N * F.step / 2);
      uInU.value.set((mid.gi0 + mid.N / 2) * mid.step, (mid.gj0 + mid.N / 2) * mid.step, mid.N * mid.step / 2);
      uRib.value.copy(uInM.value);
      const s = project(px, pz).s; if (ribS === null || Math.abs(s - ribS) > 2000) buildRibbon(s);
      if (a || b || clumpAt === null || force) { if (clumpAt === null || force || Math.hypot(px - clumpAt.x, pz - clumpAt.z) > 150) { buildClumps(); clumpAt = { x: px, z: pz }; } }
      st.tris = (q.mid * q.mid + q.ult * q.ult) * 2 * 2 + (RN - 1) * 2 + cl.count * 10; st.clumps = cl.count;
      st.lastMs = performance.now() - t0; return a || b;
    },
  };
  return api;
}
