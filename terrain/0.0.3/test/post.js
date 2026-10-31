// Comic post pass (ported from the game's shaders.js postMat): depth-Laplacian + normal-code ink edges,
// saturation, light posterize, halftone darks, paper grain, vignette. Alpha 0 (grass/rain/smoke) gets only faint ink.
import * as THREE from 'three';
import { U } from '../terrain/comic.js';
export function postMat() {
  return new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
    uniforms: { tCol: { value: null }, tDep: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uN: { value: 0.5 }, uF: { value: 1200 }, uThick: { value: 1 }, uTime: U.uTime, uFx: { value: 1 }, uPx: U.uPx, uFar: U.uFar },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D tCol, tDep; uniform vec2 uRes; uniform float uN, uF, uThick, uTime, uFx, uPx, uFar; varying vec2 vUv;
      float lin(vec2 uv){ float z = texture2D(tDep, uv).x * 2. - 1.; return 2. * uN * uF / (uF + uN - z * (uF - uN)); }
      float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 px = uThick / uRes; vec4 c0 = texture2D(tCol, vUv);
        float dc = lin(vUv), dl = lin(vUv - vec2(px.x,0.)), dr = lin(vUv + vec2(px.x,0.)), dd = lin(vUv - vec2(0.,px.y)), du = lin(vUv + vec2(0.,px.y));
        float ic = 1./dc; float lap = abs(1./dl + 1./dr + 1./dd + 1./du - 4. * ic) / ic;
        float ed = smoothstep(0.012, 0.035, lap);
        float a0 = c0.a, al = texture2D(tCol, vUv - vec2(px.x,0.)).a, ar = texture2D(tCol, vUv + vec2(px.x,0.)).a, ad = texture2D(tCol, vUv - vec2(0.,px.y)).a, au = texture2D(tCol, vUv + vec2(0.,px.y)).a;
        float na = max(max(abs(al - a0), abs(ar - a0)), max(abs(ad - a0), abs(au - a0)));
        float e = max(ed, smoothstep(0.03, 0.06, na)) * (1. - 0.8 * smoothstep(90., 450., dc)) * (1. - smoothstep(0.4 * uFar, 0.85 * uFar, min(dc, min(min(dl, dr), min(dd, du)))));
        float amin = min(min(min(al, ar), min(ad, au)), a0); e *= mix(1., 0.04, step(amin, 0.03));
        vec3 c = c0.rgb; float L = dot(c, vec3(.299,.587,.114));
        float gk = step(a0, 0.03); // alpha-0 pixel (grass/rain/smoke): keep its smooth gradient, no posterize/halftone
        c = mix(vec3(L), c, 1.18); c = mix(c, floor(c * 6. + 0.5) / 6., 0.5 * (1. - gk));
        if (uFx > 0.5) { vec2 g = gl_FragCoord.xy / (uPx * 4.); g = mat2(.707,-.707,.707,.707) * g; vec2 f = fract(g) - 0.5;
          c *= 1. - 0.12 * step(length(f), (1. - L) * 0.55) * smoothstep(0.55, 0.25, L) * (1. - gk);
          c *= 0.96 + 0.08 * h21(floor(gl_FragCoord.xy / uPx) + floor(uTime * 12.)); }
        c = mix(c, vec3(.02,.015,.03), min(1., e * 1.3));
        vec2 p = vUv - 0.5; p.x *= uRes.x / uRes.y; c *= 1. - 0.25 * smoothstep(0.55, 1.0, length(p));
        gl_FragColor = vec4(c, 1.);
      }` });
}
