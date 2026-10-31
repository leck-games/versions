// Comic / "Borderlands-ish" shading: banded cel light, hard terminator, screen-space hatching,
// atmospheric tint. Every material writes a normal code into alpha for the ink edge pass.
import * as THREE from 'three';
// Shared uniforms: owned by the vendored terrain module (its weather writes sky / fog / light / rain). Same keys as before.
import { U } from './terrain/comic.js';
export { U };
export const COMIC = /* glsl */`
uniform vec3 uSun; uniform vec3 uHorizon; uniform float uPx; uniform float uHatch; uniform float uFar; uniform float uTime;
uniform vec3 uLight; uniform float uAmb, uRim, uHeadK; uniform vec3 uHeadP, uHeadD;
vec3 headLight(vec3 al, vec3 N, vec3 wpos){ // two-beam cone from the car, hard comic falloff
  vec3 d = wpos - uHeadP; float r = length(d); d /= max(r, 0.001);
  float c = dot(d, uHeadD); float cone = smoothstep(0.86, 0.9, c); float fall = 1.0 - smoothstep(25.0, 75.0, r);
  float lam = clamp(dot(N, -d) * 0.6 + 0.4, 0.0, 1.0);
  float k = cone * fall * lam; k = k > 0.6 ? 1.0 : (k > 0.25 ? 0.6 : (k > 0.05 ? 0.3 : 0.0));
  return al * vec3(1.0, 0.92, 0.7) * k * 1.1;
}
float hatchLine(float c, float w){ float d = abs(fract(c) - 0.5) * 2.0; return 1.0 - smoothstep(w, w + 0.12, 1.0 - d); }
vec3 comic(vec3 albedo, vec3 N, vec3 wpos, float hatchK){
  vec3 V = normalize(cameraPosition - wpos);
  float l = dot(N, uSun) * 0.5 + 0.5;               // half-lambert
  float band = l > 0.62 ? 1.04 : (l > 0.42 ? 0.74 : 0.5); // 3 hard steps, strong contrast
  vec3 al = mix(vec3(dot(albedo, vec3(.299,.587,.114))), albedo, 1.12); // punchier palette
  vec3 col = al * band * uLight;
  col = mix(col, col * vec3(0.62, 0.70, 1.25), smoothstep(1.0, 0.5, band) * 0.75);   // cool, saturated shadows
  col += al * 0.10 * clamp(N.y, 0.0, 1.0) * uAmb;    // sky fill
  col += uHeadK * headLight(al, N, wpos);           // vehicle headlights (night)
  float dist = length(wpos - cameraPosition);
  float hf = uHatch * hatchK * (1.0 - smoothstep(90.0, 380.0, dist));
  if (hf > 0.001) {
    vec2 fc = gl_FragCoord.xy / (uPx * 3.5);
    float w1 = clamp((0.66 - l) * 1.6, 0.0, 0.55), w2 = clamp((0.46 - l) * 1.8, 0.0, 0.55);
    float h = max(hatchLine((fc.x + fc.y) * 0.5, 1.0 - w1) * step(0.001, w1), hatchLine((fc.x - fc.y) * 0.5, 1.0 - w2) * step(0.001, w2));
    col = mix(col, col * 0.3, h * hf);
  }
  // ink rim: grazing surfaces (hill silhouettes, object outlines) go black - works without the post pass
  float ndv = dot(N, V);
  col = mix(col, vec3(0.04, 0.03, 0.05), (1.0 - smoothstep(0.06, 0.11, ndv)) * (1.0 - smoothstep(0.7, 0.9, abs(N.y))) * (1.0 - smoothstep(40.0, 160.0, dist)) * uRim); // not on flat ground
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
export function waterMat({ far = false, uNear = null } = {}) { // far: engine far grid, discarded where the near grid has water
  return new THREE.ShaderMaterial({ uniforms: far ? { ...U, uNear } : U,
    vertexShader: `uniform float uTime; varying vec3 vW; varying float vD;
      void main(){ vec4 w = modelMatrix * vec4(position,1.); vD = -w.y; w.y = 0.05 * sin(w.x*0.2 + uTime) ; vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    defines: far ? { FAR: 1 } : {},
    fragmentShader: COMIC + `varying vec3 vW; varying float vD;
      #ifdef FAR
        uniform vec3 uNear;
      #endif
      void main(){
        if (vD < -0.3) discard;
        #ifdef FAR
          vec2 dd = abs(vW.xz - uNear.xy); if (max(dd.x, dd.y) < uNear.z - 2.) discard;
        #endif
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
        c *= uLight; c += uHeadK * headLight(c, vec3(0.,1.,0.), vW);
        gl_FragColor = vec4(mix(c, uHorizon, f*f*0.95), ncode(vec3(0.,1.,0.)) + foam * 0.04);
      }` });
}
// ---------------- objects (vertex coloured, optional instancing, wind, unlit, hull) ----------------
export function objMat({ wind = 0, unlit = false, hull = 0, gate = false, hatch = 1, tint = null } = {}) { // tint: flat colour instead of the vertex colour (physics attachments)
  const defs = {}; if (unlit) defs.UNLIT = 1; if (hull) defs.HULL = 1; if (gate) defs.GATE = 1; if (tint) defs.TINT = 1;
  const m = new THREE.ShaderMaterial({ uniforms: { ...U, uWind: { value: wind }, uHull: { value: hull }, uDone: { value: 0 }, uHK: { value: hatch }, uTint: { value: new THREE.Color(tint || 0xffffff) } }, defines: defs, vertexColors: true,
    side: hull ? THREE.BackSide : THREE.FrontSide,
    vertexShader: `uniform float uWind, uHull, uTime, uDone; uniform vec3 uTint; attribute float cp; varying vec3 vW; varying vec3 vN; varying vec3 vC;
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
        #ifdef TINT
          vC = uTint;
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
    fragmentShader: `uniform vec3 uSun, uHorizon, uZenith, uLight; uniform float uTime, uNight, uRain; varying vec3 vD;
      float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vD); float y = max(d.y, 0.);
        float t = floor(pow(y, 0.55) * 6. + 0.5) / 6.;                 // posterized gradient bands
        vec3 c = mix(uHorizon, uZenith, t);
        float s = dot(d, uSun) * (1. - uNight);
        if (uNight > 0.01) { // stars (comic crosses) + ink-ringed moon opposite the sun direction
          vec3 g = floor(d * 140.); float st = step(0.996, h31(g)) * smoothstep(0.02, 0.2, d.y);
          c = mix(c, vec3(1., .97, .85), st * uNight * (1. - uRain));
          float mo = dot(d, uSun);
          c = mix(c, vec3(.06,.05,.08), step(0.9975, mo) * uNight);
          c = mix(c, vec3(.95,.95,.85) - step(0.9993, dot(d, normalize(uSun + vec3(.02,.02,0.)))) * 0.25, step(0.998, mo) * uNight);
        }
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
          vec3 cc = mix(vec3(.80,.84,.98), vec3(1.), step(cl2, cl - 0.05)) * uLight;
          cc = mix(cc, vec3(.45,.48,.55) * uLight, uRain);
          float m = step(0.62 - uRain * 0.9, cl) * fade;
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
        float l = dot(N, uSun); vec3 c = vC * (l > 0.1 ? 1.0 : 0.8) * uLight; float dist = length(vW - cameraPosition); float f = smoothstep(uFar*0.2, uFar, dist);
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
        float ed = smoothstep(0.012, 0.035, lap);
        float a0 = c0.a, al = texture2D(tCol, vUv - vec2(px.x,0.)).a, ar = texture2D(tCol, vUv + vec2(px.x,0.)).a, ad = texture2D(tCol, vUv - vec2(0.,px.y)).a, au = texture2D(tCol, vUv + vec2(0.,px.y)).a;
        float na = max(max(abs(al - a0), abs(ar - a0)), max(abs(ad - a0), abs(au - a0)));
        float en = smoothstep(0.03, 0.06, na);
        float e = max(ed, en) * (1. - 0.8 * smoothstep(90., 450., dc));
        float amin = min(min(min(al, ar), min(ad, au)), a0); e *= mix(1., 0.04, step(amin, 0.03)); // grass (alpha 0) gets only faint ink
        vec3 c = c0.rgb;
        float L = dot(c, vec3(.299,.587,.114));
        c = mix(vec3(L), c, 1.18);                                      // saturate
        float gk = step(a0, 0.03);                                       // grass pixel (alpha 0): keep its smooth engine-style gradient
        c = mix(c, floor(c * 6. + 0.5) / 6., 0.5 * (1. - gk));           // slight posterize (not on grass)
        if (uFx > 0.5) {
          vec2 g = gl_FragCoord.xy / (uPx * 4.); g = mat2(.707,-.707,.707,.707) * g; vec2 f = fract(g) - 0.5;
          float dotm = step(length(f), (1. - L) * 0.55) * smoothstep(0.55, 0.25, L);
          c *= 1. - 0.12 * dotm * (1. - gk);                              // halftone in darks (not on grass)
          c *= 0.96 + 0.08 * h21(floor(gl_FragCoord.xy / uPx) + floor(uTime * 12.)); // paper grain
        }
        c = mix(c, vec3(.02,.015,.03), min(1., e * 1.3));
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

// ---------------- engine terrain (merged build): region vertex colours + procedural comic detail ----------------
// attributes: color = region/surface albedo from world.colourOf(), sw = (sand, rock, snow, dirt) surface weights.
// FAR variant sinks vertices lying under the near grid (uNear = centre.xz, half-size).
export function gridTerrainMat({ far = false, uNear = null } = {}) {
  return new THREE.ShaderMaterial({ uniforms: far ? { ...U, uNear } : U, vertexColors: true, defines: far ? { FAR: 1 } : {},
    vertexShader: `attribute vec4 sw; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec4 vS;
      #ifdef FAR
        uniform vec3 uNear;
      #endif
      void main(){ vec3 p = position;
        #ifdef FAR
          vec2 dd = abs(p.xz - uNear.xy); float m = max(dd.x, dd.y); p.y -= 8.0 * clamp((uNear.z - 10.0 - m) / 10.0, 0.0, 1.0);
        #endif
        vW = p; vN = normal; vC = color; vS = sw; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: COMIC + `varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec4 vS;
      void main(){
        vec3 N = normalize(vN); float x = vW.x, z = vW.z, h = vW.y;
        vec3 c = vC;
        float gW = clamp(1. - vS.x - vS.y - vS.z - vS.w, 0., 1.);
        float pat = sin(x*0.09 + sin(z*0.07)*2.) * sin(z*0.08 + sin(x*0.05)*2.);      // painterly grass patches
        float spk = sin(x*1.7 + sin(z*1.3)) * sin(z*1.9 + sin(x*1.1));                // speckle
        vec3 m = vec3(1.);
        m = mix(m, mix(vec3(1.), vec3(.84,.92,.74), step(0.35, pat)) * mix(1., 1.18, step(0.93, spk)), gW);
        float rip = sin(x*2.2 + z*1.1 + sin(z*0.3)*3.);                                   // sand ripples
        m = mix(m, vec3(mix(1.04, .88, smoothstep(0.7, 0.9, rip))), vS.x);
        float sb = h * 0.55 + sin(x*0.03) * 2.5 + cos(z*0.025) * 2.5;                     // rock strata
        vec3 st = vec3(mix(1.06, .9, step(0.5, fract(sb * 0.5))));
        st = mix(st, vec3(.55,.5,.5), smoothstep(0.88, 0.97, fract(sb)));
        st = mix(st, vec3(1.15,1.1,1.0), step(0.8, fract(sb*0.23)) * 0.7);
        m = mix(m, st, vS.y);
        m = mix(m, mix(vec3(1.), vec3(.84,.9,1.05), step(0.6, sin(x*0.3+z*0.2+sin(z*0.1)*3.))), vS.z);   // snow drifts
        float dk = step(0.6, sin(x*0.4 + z*0.33 + sin(z*0.2)*2.));                        // dirt clods
        m = mix(m, vec3(mix(1.0, .88, dk) * mix(1., 1.14, step(0.9, spk))), vS.w);
        c *= m;
        float wet = 1. - smoothstep(0.0, 0.8, h); c = mix(c, c * vec3(.7,.75,.8), wet);
        gl_FragColor = vec4(comic(c, N, vW, 1.0), ncode(N));
      }` });
}
// textured road ribbons (asphalt / dirt) and flat-shaded bridge pieces, comic lit
export function roadMat(map, { offset = -2, col = 0x9a9aa2 } = {}) {
  return new THREE.ShaderMaterial({ uniforms: { ...U, map: { value: map }, uCol: { value: new THREE.Color(col) } }, defines: map ? { MAP: 1 } : {},
    polygonOffset: !!map, polygonOffsetFactor: offset, polygonOffsetUnits: offset * 2,
    vertexShader: `varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: COMIC + `uniform sampler2D map; uniform vec3 uCol; varying vec3 vW; varying vec3 vN; varying vec2 vUv;
      void main(){ vec3 N = normalize(vN);
        #ifdef MAP
          vec3 c = texture2D(map, vUv).rgb; float hk = 0.5;
        #else
          vec3 c = uCol; float hk = 1.2;
        #endif
        gl_FragColor = vec4(comic(c, N, vW, hk), ncode(N)); }` });
}

// ---------------- weather particles: rain streaks / dust specks wrapped in a box around the camera (1 draw call) ----------------
export function precipMat() {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uCol: { value: new THREE.Color(0xc8d8ff) }, uVel: { value: new THREE.Vector3(0, -26, 0) }, uBox: { value: 40 }, uLen: { value: 0.06 }, uAmt: { value: 0 } },
    transparent: true, depthWrite: false,
    vertexShader: `uniform vec3 uVel; uniform float uBox, uLen, uTime, uAmt; attribute float tail; attribute float seed;
      void main(){
        vec3 p = position * uBox + uVel * uTime * (0.8 + 0.4 * fract(seed * 7.13));
        p = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5 + cameraPosition;
        p -= uVel * uLen * tail;
        if (seed > uAmt) p = vec3(0., -1e5, 0.);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `uniform vec3 uCol, uLight; void main(){ gl_FragColor = vec4(uCol * max(uLight, vec3(.35)), 0.55); }` });
}
