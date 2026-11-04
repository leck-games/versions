// HIGH/ULTRA vehicle shadow: the car/plane silhouette rendered from the sun into a small render target (512 / 1024),
// projected onto a terrain-draped grid around the shadow footprint (multiply blend, halftone-dotted soft edge, alpha untouched so
// the post pass ink edges are unaffected). LOW/MED keep the cheap dotted blob decal.
import * as THREE from 'three';
import { U } from './terrain/comic.js';
export function createVehicleShadow(renderer, scene, heightAt) {
  const N = 17, geo = new THREE.BufferGeometry(), pos = new Float32Array(N * N * 3), idx = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) { const a = j * N + i; idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1); }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setIndex(idx);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 400), shScene = new THREE.Scene(), M = new THREE.Matrix4();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFar: U.uFar, uFogY: U.uFogY, uPx: U.uPx, uNight: U.uNight, tS: { value: null }, uM: { value: M }, uK: { value: 0.55 }, uTexel: { value: 1 / 512 } },
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.DstColorFactor, blendDst: THREE.ZeroFactor,
    blendEquationAlpha: THREE.AddEquation, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    vertexShader: `varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }`,
    fragmentShader: `uniform sampler2D tS; uniform mat4 uM; uniform float uK, uTexel, uFar, uFogY, uPx, uNight; varying vec3 vW;
      void main(){ vec4 pc = uM * vec4(vW, 1.); vec2 uv = pc.xy / pc.w * 0.5 + 0.5; if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) discard;
        float a = 0.; for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) a += step(0.01, texture2D(tS, uv + vec2(float(i), float(j)) * uTexel * 1.5).a);
        a /= 9.; if (a < 0.05) discard;
        vec2 g = fract(gl_FragCoord.xy / (uPx * 4.)) - 0.5; float k = a > 0.85 ? 1. : step(length(g), a * 0.75); // halftone penumbra
        vec3 d = vW - cameraPosition; d.y *= uFogY; float f = 1. - smoothstep(uFar * 0.15, uFar * 0.6, length(d));
        float s = uK * k * f * (1. - 0.5 * uNight); gl_FragColor = vec4(vec3(1. - s) * vec3(0.92, 0.95, 1.08), 1.); }` });
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.visible = false; scene.add(mesh);
  let rt = null, size = 0;
  function setSize(s) { if (s === size) return; size = s; if (rt) { rt.dispose(); rt = null; }
    if (s) { rt = new THREE.WebGLRenderTarget(s, s, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true }); mat.uniforms.tS.value = rt.texture; mat.uniforms.uTexel.value = 1 / s; }
    mesh.visible = !!s; }
  const sun = new THREE.Vector3(), clr = new THREE.Color();
  // obj: model group (rendered alone), p: body centre, R: half extent of the silhouette, maxH: hide above this height over ground
  function update(obj, p, R, maxH = 150) {
    if (!size || !obj) { mesh.visible = false; return false; }
    sun.copy(U.uSun.value); if (sun.y < 0.12) sun.y = 0.12; sun.normalize();
    const gy = heightAt(p.x, p.z), agl = p.y - gy; if (agl > maxH) { mesh.visible = false; return false; }
    const cx = p.x - sun.x * agl / sun.y, cz = p.z - sun.z * agl / sun.y;
    cam.left = cam.bottom = -R; cam.right = cam.top = R; cam.position.set(p.x + sun.x * 120, p.y + sun.y * 120, p.z + sun.z * 120); cam.lookAt(p.x, p.y, p.z); cam.updateProjectionMatrix(); cam.updateMatrixWorld();
    const parent = obj.parent; shScene.add(obj);
    const prevRT = renderer.getRenderTarget(), prevA = renderer.getClearAlpha(); renderer.getClearColor(clr);
    renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(shScene, cam);
    renderer.setRenderTarget(prevRT); renderer.setClearColor(clr, prevA);
    if (parent) parent.add(obj);
    M.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    const E = R * (1 + 0.6 * Math.min(1, Math.hypot(sun.x, sun.z) / sun.y)) + 1; // footprint stretches at low sun
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = cx + (i / (N - 1) * 2 - 1) * E, z = cz + (j / (N - 1) * 2 - 1) * E, k = (j * N + i) * 3;
      pos[k] = x; pos[k + 1] = heightAt(x, z) + 0.07; pos[k + 2] = z; }
    geo.attributes.position.needsUpdate = true; mesh.visible = true; return true;
  }
  return { setSize, update, hide() { mesh.visible = false; }, get size() { return size; }, mesh };
}
