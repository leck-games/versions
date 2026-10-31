// SineRally UI — race-start markers: a pulsing comic ring on the ground around every race start gate plus a tall additive
// light pillar so a start can be found from far away (and from planes). Pillars beyond the camera's far plane are drawn
// pulled in along the view ray (same angular size), so they stay visible at any distance. One small pool, rebuilt only
// when the set of nearby tracks changes.
import * as THREE from 'three';
const R0 = 10.6, R1 = 13.4, SEG = 72; // ring band (the loop road is 24 m wide: the ring spans it, the start gate stands in it)
const VS = `varying vec2 vUv; varying vec3 vN; varying vec3 vW; void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const RING_FS = `uniform float uT; uniform vec3 uC; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ float v = vUv.y, u = vUv.x; float ink = step(v, .14) + step(.86, v);
  float chev = step(.5, fract(u * 24. - uT * .7 + abs(v - .5) * 1.2)); // marching chevrons around the ring
  float pulse = .75 + .25 * sin(uT * 4.);
  vec3 c = mix(uC * (1.05 + .25 * pulse), vec3(1., .97, .82), chev * .55);
  gl_FragColor = vec4(mix(c, vec3(.07,.06,.06), clamp(ink,0.,1.)), .96); }`;
const HALO_FS = `uniform float uT; uniform vec3 uC; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ float r = vUv.y; // 0 inner (6 m) .. 1 outer (22 m)
  float band = exp(-pow((r - .38) / .12, 2.)) * (.55 + .25 * sin(uT * 4.));
  float rip = fract(uT * .45); float ripple = exp(-pow((r - rip) / .05, 2.)) * (1. - rip);
  gl_FragColor = vec4(uC * (band + ripple * .9), 1.); }`;
const BEAM_FS = `uniform float uT; uniform vec3 uC; uniform float uNear; varying vec2 vUv; varying vec3 vN; varying vec3 vW;
void main(){ vec3 V = normalize(cameraPosition - vW); float core = pow(abs(dot(normalize(vN), V)), 2.);
  float h = vUv.y; float bands = step(.5, fract(h * 36. - uT * .9));
  float a = pow(1. - h, 1.4) * (.25 + .75 * core) * (.72 + .28 * bands) * uNear;
  gl_FragColor = vec4(uC * a * 1.25, 1.); }`;
function ringGeo(cx, cz, heightAt, r0, r1, lift) { // flat band draped on the terrain (sampled per vertex)
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= SEG; i++) { const a = i / SEG * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (const [r, v] of [[r0, 0], [r1, 1]]) { const x = cx + ca * r, z = cz + sa * r; pos.push(x, heightAt(x, z) + lift, z); uv.push(i / SEG, v); } }
  for (let i = 0; i < SEG; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(pos.length).map((_, k) => k % 3 === 1 ? 1 : 0), 3)); g.setIndex(idx); g.computeBoundingSphere(); return g;
}
export function createRaceRings({ scene, heightAt, color = 0xffa41c, max = 12 }) {
  const C = new THREE.Color(color), uT = { value: 0 };
  const mk = (fs, add, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: Object.assign({ uT, uC: { value: C } }, extra), transparent: true, depthWrite: false,
    blending: add ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: false });
  const ringMat = mk(RING_FS, false), haloMat = mk(HALO_FS, true);
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 16, 1, true); beamGeo.translate(0, 0.5, 0);
  const pool = [], byId = new Map(), group = new THREE.Group(); group.name = 'raceRings'; scene.add(group);
  let key = '';
  function set(list) { // list: [{ id, x, z }] race starts near the player
    const k = list.map(s => s.id).join('|'); if (k === key) return; key = k;
    for (const r of pool) { group.remove(r.ring, r.halo, r.beam); r.ring.geometry.dispose(); r.halo.geometry.dispose(); r.beam.material.dispose(); }
    pool.length = 0; byId.clear();
    for (const s of list.slice(0, max)) {
      const ring = new THREE.Mesh(ringGeo(s.x, s.z, heightAt, R0, R1, 0.35), ringMat), halo = new THREE.Mesh(ringGeo(s.x, s.z, heightAt, 6, 22, 0.25), haloMat);
      const beam = new THREE.Mesh(beamGeo, mk(BEAM_FS, true, { uNear: { value: 1 } })); beam.material.side = THREE.FrontSide;
      ring.renderOrder = 3; halo.renderOrder = 4; beam.renderOrder = 5; ring.frustumCulled = halo.frustumCulled = beam.frustumCulled = false;
      const r = { id: s.id, x: s.x, z: s.z, y: heightAt(s.x, s.z), ring, halo, beam, hidden: false }; pool.push(r); byId.set(s.id, r); group.add(ring, halo, beam);
    }
  }
  function update(dt, camera, hideId) {
    uT.value += dt; const cp = camera.position, maxD = camera.far * 0.82;
    for (const r of pool) {
      const hide = r.id === hideId; r.hidden = hide; r.ring.visible = r.halo.visible = !hide;
      const dx = r.x - cp.x, dz = r.z - cp.z, d = Math.hypot(dx, dz, r.y - cp.y);
      const H = 320, rad = Math.max(2.4, d * 0.0035); // wider with distance: never thinner than ~2-3 px
      r.beam.visible = !hide; r.beam.material.uniforms.uNear.value = Math.min(1, Math.max(0.12, (d - 12) / 70)); // inside the ring: faint, doesn't white out the view
      if (d > maxD) { const k = maxD / d; r.beam.position.set(cp.x + dx * k, cp.y + (r.y - cp.y) * k, cp.z + dz * k); r.beam.scale.set(rad * k, H * k, rad * k); }
      else { r.beam.position.set(r.x, r.y - 1, r.z); r.beam.scale.set(rad, H, rad); }
    }
  }
  return { set, update, get rings() { return pool.map(r => ({ id: r.id, x: r.x, z: r.z, y: r.y, visible: r.ring.visible, beam: r.beam.visible, r0: R0, r1: R1 })); }, R0, R1 };
}
