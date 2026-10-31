// Comic / "Borderlands-ish" shading: banded cel light, hard terminator, screen-space hatching,
// atmospheric tint. Every material writes a normal code into alpha for the ink edge pass.
import * as THREE from 'three';
export const U = {
  uSun: { value: new THREE.Vector3(0.45, 0.75, 0.35).normalize() },
  uHorizon: { value: new THREE.Color(0xd9f1ff) }, uZenith: { value: new THREE.Color(0x1f74e0) },
  uPx: { value: 1 }, uHatch: { value: 1 }, uFar: { value: 560 }, uTime: { value: 0 },
};
export const COMIC = /* glsl */`
uniform vec3 uSun; uniform vec3 uHorizon; uniform float uPx; uniform float uHatch; uniform float uFar; uniform float uTime;
float hatchLine(float c, float w){ float d = abs(fract(c) - 0.5) * 2.0; return 1.0 - smoothstep(w, w + 0.12, 1.0 - d); }
vec3 comic(vec3 albedo, vec3 N, vec3 wpos, float hatchK){
  float l = dot(N, uSun) * 0.5 + 0.5;               // half-lambert
  float band = l > 0.58 ? 1.0 : (l > 0.38 ? 0.76 : 0.56); // 3 hard steps
  vec3 col = albedo * band;
  col = mix(col, col * vec3(0.72, 0.78, 1.18), (1.0 - band) * 0.9);   // cool shadows
  col += albedo * 0.12 * clamp(N.y, 0.0, 1.0);        // sky fill
  float dist = length(wpos - cameraPosition);
  float hf = uHatch * hatchK * (1.0 - smoothstep(40.0, 200.0, dist));
  if (hf > 0.001) {
    vec2 fc = gl_FragCoord.xy / (uPx * 4.0);
    float w1 = clamp((0.62 - l) * 1.4, 0.0, 0.5), w2 = clamp((0.42 - l) * 1.6, 0.0, 0.5);
    float h = max(hatchLine((fc.x + fc.y) * 0.5, 1.0 - w1) * step(0.001, w1), hatchLine((fc.x - fc.y) * 0.5, 1.0 - w2) * step(0.001, w2));
    col = mix(col, col * 0.35, h * hf);
  }
  float f = smoothstep(uFar * 0.2, uFar, dist);
  return mix(col, uHorizon, f * f * 0.95);
}
float ncode(vec3 N){ vec3 v = normalize(mat3(viewMatrix) * N); return 0.08 + 0.84 * (0.5 + 0.5 * dot(v, vec3(0.42, 0.55, 0.72))); }
`;
// ---------------- terrain ----------------
export function terrainMat() {
  return new THREE.ShaderMaterial({ uniforms: U,
    vertexShader: `attribute vec2 trk; varying vec3 vW; varying vec3 vN; varying vec2 vT;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normal; vT = trk; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMIC + `varying vec3 vW; varying vec3 vN; varying vec2 vT;
      void main(){
        vec3 N = normalize(vN); float x = vW.x, z = vW.z, h = vW.y, sl = N.y;
        float f = 0.5 + 0.5 * sin(x*0.004 + cos(z*0.003)*2.) * cos(z*0.0045);
        float pat = sin(x*0.09 + sin(z*0.07)*2.) * sin(z*0.08 + sin(x*0.05)*2.);    // painterly grass patches
        float spk = sin(x*1.7 + sin(z*1.3)) * sin(z*1.9 + sin(x*1.1));              // small speckle
        vec3 grass = mix(vec3(.33,.68,.17), vec3(.62,.80,.22), f);
        grass = mix(grass, grass * vec3(.82,.9,.7), step(0.35, pat));
        grass = mix(grass, vec3(.85,.9,.35), step(0.93, spk) * 0.6);
        // sand with ripples
        float rip = sin(x*2.2 + z*1.1 + sin(z*0.3)*3.);
        vec3 sand = mix(vec3(.98,.86,.52), vec3(.86,.70,.40), smoothstep(0.7, 0.9, rip));
        // rock strata: horizontal bands in world height (triplanar-consistent)
        float sb = h * 0.55 + sin(x*0.03) * 2.5 + cos(z*0.025) * 2.5;
        vec3 rock = mix(vec3(.82,.56,.36), vec3(.70,.44,.30), step(0.5, fract(sb * 0.5)));
        rock = mix(rock, vec3(.42,.27,.20), smoothstep(0.88, 0.97, fract(sb)));
        rock = mix(rock, vec3(.92,.76,.52), step(0.8, fract(sb*0.23)) * 0.7);
        rock = mix(rock, vec3(.62,.55,.58), smoothstep(110., 150., h) * 0.6);
        grass = mix(grass, vec3(.28,.55,.30), smoothstep(85., 130., h));  // alpine grass
        // snow
        float snowL = 140. + 25. * sin(x*0.002) * cos(z*0.0023) + 6. * sin(x*0.05 + z*0.04);
        vec3 snow = mix(vec3(.97,.99,1.), vec3(.80,.88,1.), step(0.6, sin(x*0.3+z*0.2+sin(z*0.1)*3.)));
        float sandW = 1. - smoothstep(1.6, 3.2, h + 0.8 * sin(x*0.05) * cos(z*0.06));
        float rockW = 1. - smoothstep(0.74, 0.82, sl);
        float snowW = smoothstep(snowL - 2., snowL + 2., h) * smoothstep(0.55, 0.65, sl);
        vec3 c = mix(grass, sand, sandW);
        c = mix(c, rock, rockW); c = mix(c, snow, snowW);
        // painted dirt track with tyre ruts
        float tw = vT.x, ad = abs(vT.y);
        if (tw > 0.01) {
          vec3 dirt = mix(vec3(.80,.55,.30), vec3(.70,.45,.25), step(0.6, sin(x*0.4 + z*0.33 + sin(z*0.2)*2.)));
          dirt = mix(dirt, vec3(.92,.72,.45), step(0.9, spk) * 0.7);
          float rut = max(1. - smoothstep(0.25, 0.45, abs(ad - 2.4)), 1. - smoothstep(0.25, 0.45, abs(ad - 4.8)));
          dirt = mix(dirt, vec3(.46,.28,.16), rut * 0.85);
          float edge = smoothstep(8.2, 8.8, ad) * (1. - smoothstep(9.6, 10.4, ad));
          dirt = mix(dirt, vec3(.36,.22,.12), edge * 0.8);
          c = mix(c, dirt, smoothstep(0.35, 0.6, tw));
        }
        float wet = 1. - smoothstep(0.0, 0.8, h); c = mix(c, c * vec3(.7,.75,.8), wet);
        gl_FragColor = vec4(comic(c, N, vW, 1.0), ncode(N));
      }` });
}
// water shares the terrain grid; position.y = terrain height -> depth & shore foam from height()
export function waterMat() {
  return new THREE.ShaderMaterial({ uniforms: U,
    vertexShader: `uniform float uTime; varying vec3 vW; varying float vD;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vD = -w.y; w.y = 0.05 * sin(w.x*0.2 + uTime) ; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMIC + `varying vec3 vW; varying float vD;
      void main(){
        if (vD < -0.3) discard;
        float d = max(vD, 0.);
        vec3 c = mix(vec3(.35,.88,.92), vec3(.10,.42,.82), smoothstep(0.5, 8., d));
        c = mix(c, vec3(.05,.28,.65), smoothstep(10., 30., d));
        float ring = step(0.82, fract(d * 0.6 - uTime * 0.25 + 0.15 * sin(vW.x*0.08 + vW.z*0.05))) * (1. - smoothstep(1.5, 3.5, d));
        float foam = max(1. - smoothstep(0.25, 0.45, d), ring);
        vec3 N = normalize(vec3(0.15*sin(vW.x*0.13 + uTime*1.3) + 0.1*sin(vW.z*0.21 - uTime), 1., 0.15*cos(vW.z*0.11 + uTime*1.1)));
        vec3 V = normalize(cameraPosition - vW); float sp = dot(reflect(-uSun, N), V);
        c = mix(c, vec3(1.), step(0.985, sp));          // toon specular glints
        c = mix(c, vec3(.97,1.,1.), foam);
        float dist = length(vW - cameraPosition); float f = smoothstep(uFar*0.2, uFar, dist);
        gl_FragColor = vec4(mix(c, uHorizon, f*f*0.95), ncode(vec3(0.,1.,0.)) + foam * 0.04);
      }` });
}
// ---------------- objects (vertex coloured, optional instancing, wind, unlit, hull) ----------------
export function objMat({ wind = 0, unlit = false, hull = 0, gate = false, hatch = 1 } = {}) {
  const defs = {}; if (unlit) defs.UNLIT = 1; if (hull) defs.HULL = 1; if (gate) defs.GATE = 1;
  const m = new THREE.ShaderMaterial({ uniforms: { ...U, uWind: { value: wind }, uHull: { value: hull }, uDone: { value: 0 }, uHK: { value: hatch } }, defines: defs, vertexColors: true,
    side: hull ? THREE.BackSide : THREE.FrontSide,
    vertexShader: `uniform float uWind, uHull, uTime, uDone; attribute float cp; varying vec3 vW; varying vec3 vN; varying vec3 vC;
      void main(){
        mat4 m = modelMatrix;
        #ifdef USE_INSTANCING
          m = m * instanceMatrix;
        #endif
        vec3 p = position;
        #ifdef HULL
          p += normal * uHull;
        #endif
        vec4 w = m * vec4(p, 1.);
        if (uWind > 0.) { float k = max(position.y - 2., 0.) * uWind; w.x += sin(uTime*1.6 + m[3].x*0.15 + m[3].z*0.1) * k; w.z += cos(uTime*1.3 + m[3].z*0.12) * k * 0.6; }
        vW = w.xyz; vN = normalize(mat3(m) * normal); vC = color;
        #ifdef USE_INSTANCING_COLOR
          vC *= instanceColor;
        #endif
        #ifdef GATE
          if (cp > 0.5 && cp < uDone + 0.5) vC = vec3(.25,.85,.35);
        #endif
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: COMIC + `uniform float uHK; varying vec3 vW; varying vec3 vN; varying vec3 vC;
      void main(){
        #ifdef HULL
          gl_FragColor = vec4(0.05,0.04,0.06, 0.02); return;
        #endif
        vec3 N = normalize(vN);
        if (!gl_FrontFacing) N = -N;
        #ifdef UNLIT
          gl_FragColor = vec4(vC, ncode(N)); return;
        #endif
        gl_FragColor = vec4(comic(vC, N, vW, uHK), ncode(N));
      }` });
  return m;
}
// ---------------- sky: comic gradient, sun with ink ring, procedural flat clouds ----------------
export function skyMat() {
  return new THREE.ShaderMaterial({ uniforms: U, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = (projectionMatrix * modelViewMatrix * vec4(position,1.)).xyww; }`,
    fragmentShader: `uniform vec3 uSun, uHorizon, uZenith; uniform float uTime; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD); float y = max(d.y, 0.);
        float t = floor(pow(y, 0.55) * 6. + 0.5) / 6.;                 // posterized gradient bands
        vec3 c = mix(uHorizon, uZenith, t);
        float s = dot(d, uSun);
        c = mix(c, vec3(1.,.95,.7), step(0.96, s) * 0.35);
        c = mix(c, vec3(1.,.98,.85), step(0.99, s) * 0.5);
        c = mix(c, vec3(.08,.06,.08), step(0.9965, s) * (1. - step(0.9975, s)));
        c = mix(c, vec3(1.,.93,.45), step(0.9975, s));
        if (d.y > 0.01) {
          vec2 uv = d.xz / (d.y + 0.12) * 1.2 + vec2(uTime * 0.01, 0.);
          float cl = sin(uv.x*1.3 + sin(uv.y*0.9)*1.5) * sin(uv.y*1.1 + sin(uv.x*0.7)) + 0.45 * sin(uv.x*3.1 + uv.y*2.3) + 0.25 * sin(uv.x*6.3 - uv.y*5.1);
          vec2 uv2 = uv - uSun.xz * 0.15;
          float cl2 = sin(uv2.x*1.3 + sin(uv2.y*0.9)*1.5) * sin(uv2.y*1.1 + sin(uv2.x*0.7)) + 0.45 * sin(uv2.x*3.1 + uv2.y*2.3) + 0.25 * sin(uv2.x*6.3 - uv2.y*5.1);
          float fade = smoothstep(0.01, 0.12, d.y);
          vec3 cc = mix(vec3(.80,.84,.98), vec3(1.), step(cl2, cl - 0.05));
          float m = step(0.62, cl) * fade;
          c = mix(c, cc, m);
          c = mix(c, vec3(.08,.06,.1), (step(0.6, cl) - step(0.64, cl)) * fade);
        }
        gl_FragColor = vec4(c, 1.0);
      }` });
}
// ---------------- particles (dust puffs) ----------------
export function puffMat() {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uScale: { value: 200 } }, vertexColors: true,
    vertexShader: `uniform float uScale, uPx; attribute float size; varying vec3 vC; varying vec3 vW;
      void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.); vW = (modelMatrix*vec4(position,1.)).xyz; gl_PointSize = min(size * uScale / -mv.z, 70. * uPx); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: COMIC + `varying vec3 vC; varying vec3 vW;
      void main(){ vec2 p = gl_PointCoord * 2. - 1.; float sd = fract(vW.x * 0.37 + vW.z * 0.21) * 6.28;
        float a = atan(p.y, p.x); float lump = 0.78 + 0.13 * sin(a * 5. + sd) + 0.07 * sin(a * 9. - sd * 2.);
        float r = dot(p,p) / (lump * lump); if (r > 1.) discard;
        vec2 g = fract(gl_FragCoord.xy / (uPx * 4.)) - 0.5; if (r > 0.55 && length(g) > 0.62 * (1. - r) + 0.12) discard;
        vec3 N = normalize(vec3(p.x, -p.y, sqrt(1. - r))); N = normalize(inverse(mat3(viewMatrix)) * N);
        float l = dot(N, uSun); vec3 c = vC * (l > 0.1 ? 1.0 : 0.8); float dist = length(vW - cameraPosition); float f = smoothstep(uFar*0.2, uFar, dist);
        gl_FragColor = vec4(mix(c, uHorizon, f*f), ncode(N)); }` });
}
// ---------------- flat dark decal (skids, blob shadow) ----------------
export function decalMat(col, dots = false) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uCol: { value: new THREE.Color(col) } }, defines: dots ? { DOTS: 1 } : {},
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMIC + `uniform vec3 uCol; varying vec2 vUv; varying vec3 vW;
      void main(){
        #ifdef DOTS
          vec2 p = vUv * 2. - 1.; float r = length(p); if (r > 1.) discard;
          vec2 g = fract(gl_FragCoord.xy / (uPx * 5.)) - 0.5; if (length(g) > 0.5 * (1. - r * 0.8) + 0.08) discard;
        #endif
        float dist = length(vW - cameraPosition); float f = smoothstep(uFar*0.2, uFar, dist);
        gl_FragColor = vec4(mix(uCol, uHorizon, f*f), ncode(vec3(0.,1.,0.)) ); }` });
}
// ---------------- post: ink edges (depth laplacian + normal code), posterize, halftone, grain, speed lines ----------------
export function postMat() {
  return new THREE.ShaderMaterial({ depthTest: false, depthWrite: false,
    uniforms: { tCol: { value: null }, tDep: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uN: { value: 0.5 }, uF: { value: 1200 },
      uThick: { value: 1 }, uTime: U.uTime, uBoost: { value: 0 }, uFx: { value: 1 }, uPx: U.uPx },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,
    fragmentShader: `uniform sampler2D tCol, tDep; uniform vec2 uRes; uniform float uN, uF, uThick, uTime, uBoost, uFx, uPx; varying vec2 vUv;
      float lin(vec2 uv){ float z = texture2D(tDep, uv).x * 2. - 1.; return 2. * uN * uF / (uF + uN - z * (uF - uN)); }
      float h21(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 px = uThick / uRes;
        vec4 c0 = texture2D(tCol, vUv);
        float dc = lin(vUv), dl = lin(vUv - vec2(px.x,0.)), dr = lin(vUv + vec2(px.x,0.)), dd = lin(vUv - vec2(0.,px.y)), du = lin(vUv + vec2(0.,px.y));
        // laplacian of inverse depth is ~0 on planes -> robust silhouettes/creases
        float ic = 1./dc; float lap = abs(1./dl + 1./dr + 1./dd + 1./du - 4. * ic) / ic;
        float mn = min(min(dl, dr), min(dd, du));
        float ed = smoothstep(0.02, 0.06, lap);
        float a0 = c0.a, al = texture2D(tCol, vUv - vec2(px.x,0.)).a, ar = texture2D(tCol, vUv + vec2(px.x,0.)).a, ad = texture2D(tCol, vUv - vec2(0.,px.y)).a, au = texture2D(tCol, vUv + vec2(0.,px.y)).a;
        float na = max(max(abs(al - a0), abs(ar - a0)), max(abs(ad - a0), abs(au - a0)));
        float en = smoothstep(0.04, 0.08, na);
        float e = max(ed, en) * (1. - smoothstep(250., 600., dc));
        vec3 c = c0.rgb;
        float L = dot(c, vec3(.299,.587,.114));
        c = mix(vec3(L), c, 1.18);                                       // saturate
        c = mix(c, floor(c * 7. + 0.5) / 7., 0.35);                       // slight posterize
        if (uFx > 0.5) {
          vec2 g = gl_FragCoord.xy / (uPx * 4.); g = mat2(.707,-.707,.707,.707) * g; vec2 f = fract(g) - 0.5;
          float dotm = step(length(f), (1. - L) * 0.55) * smoothstep(0.55, 0.25, L);
          c *= 1. - 0.12 * dotm;                                          // halftone in darks
          c *= 0.96 + 0.08 * h21(floor(gl_FragCoord.xy / uPx) + floor(uTime * 12.)); // paper grain
        }
        c = mix(c, vec3(.06,.04,.07), e);
        vec2 p = vUv - 0.5; p.x *= uRes.x / uRes.y; float r = length(p);
        if (uBoost > 0.01) {
          float ang = atan(p.y, p.x); float id = floor(ang * 38.);
          float ln = step(0.7, h21(vec2(id, floor(uTime * 14.)))) * smoothstep(0.32, 0.8, r) * (1. - smoothstep(0.35, 0.5, abs(fract(ang * 38.) - 0.5) * 2.));
          c = mix(c, vec3(1.), ln * uBoost * 0.7);
        }
        c *= 1. - 0.25 * smoothstep(0.55, 1.0, r);                        // vignette
        gl_FragColor = vec4(c, 1.);
      }` });
}
