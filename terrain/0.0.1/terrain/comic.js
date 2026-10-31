// Comic / Borderlands-style shading for the terrain module: banded cel light, hatching, halftone, ink rim, fog.
// Adds environment hooks shared by every terrain material: cloud shadows (halftone), wet ground + puddles,
// fire state (burnt / burning / smoulder) read from the fire window texture.
// Every material writes a normal code into alpha for the host's ink-edge post pass (alpha 0 = grass).
import * as THREE from 'three';
const dtex = (w, h, data, type = THREE.UnsignedByteType) => { const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, type); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
export const U = {
  uSun: { value: new THREE.Vector3(0.45, 0.75, 0.35).normalize() },
  uHorizon: { value: new THREE.Color(0xd9f1ff) }, uZenith: { value: new THREE.Color(0x1f74e0) },
  uPx: { value: 1 }, uHatch: { value: 1 }, uFar: { value: 800 }, uTime: { value: 0 },
  uLight: { value: new THREE.Color(1, 1, 1) }, uAmb: { value: 1 }, uRim: { value: 1 }, uHeadK: { value: 0 },
  uHeadP: { value: new THREE.Vector3() }, uHeadD: { value: new THREE.Vector3(0, 0, 1) }, uNight: { value: 0 }, uRain: { value: 0 },
  // environment (weather.js / fire.js keep these current)
  uWind: { value: new THREE.Vector3(1, 0, 4) },                 // dir.x, dir.z, speed m/s
  uClimT: { value: dtex(2, 2, new Uint8Array(16)) }, uClimO: { value: new THREE.Vector4(-1e5, -1e5, 2e5, 0) }, // forest-climate map window
  uCloudOff: { value: new THREE.Vector3(0, 0, -2) },            // advected offset xz, coverage bias
  uCloudK: { value: 1 }, uCloudH: { value: 260 }, uCanR: { value: new THREE.Vector2(250, 330) },
  uWetT: { value: dtex(2, 2, new Uint8Array(16)) }, uWetO: { value: new THREE.Vector4(-1e5, -1e5, 2e5, 0) },
  uFireT: { value: dtex(2, 2, new Uint8Array(16)) }, uFireO: { value: new THREE.Vector4(-1e5, -1e5, 1, 0) }, // origin xz, size, valid
  uFlash: { value: 0 },
};
// JS twin of the GLSL cloud noise (keep in sync) -> used for rain at a point, fire extinguish, cloud placement
const S = Math.sin, C = Math.cos;
export function cnoise(u, v) {
  return 0.5 * S(u * 0.0021 + 1.7 * S(v * 0.0013)) * C(v * 0.0019 - 1.3 * S(u * 0.0011)) + 0.3 * S((u + v) * 0.0043 + 2.0 * C(u * 0.0023)) * C((u - v) * 0.0037) + 0.2 * S(u * 0.0091 + v * 0.0067 + 2.0 * S(v * 0.005));
}
export const GLSL_ENV = /* glsl */`
uniform vec3 uWind, uCloudOff; uniform float uCloudK, uCloudH, uFlash; uniform sampler2D uClimT, uWetT, uFireT; uniform vec4 uClimO, uWetO, uFireO;
float cnoise(vec2 p){ float u = p.x, v = p.y;
  return 0.5*sin(u*0.0021 + 1.7*sin(v*0.0013))*cos(v*0.0019 - 1.3*sin(u*0.0011)) + 0.3*sin((u+v)*0.0043 + 2.0*cos(u*0.0023))*cos((u-v)*0.0037) + 0.2*sin(u*0.0091 + v*0.0067 + 2.0*sin(v*0.005)); }
float climF(vec2 xz){ return texture2D(uClimT, clamp((xz - uClimO.xy) / uClimO.z, 0.0, 1.0)).r; }
float cloudRaw(vec2 xz){ return cnoise(xz - uCloudOff.xy) + 0.9 * climF(xz) - 0.75 + uCloudOff.z; }
float cloudCov(vec2 xz){ return smoothstep(0.0, 0.25, cloudRaw(xz)); }
float rainAmt(vec2 xz){ float c = climF(xz); return smoothstep(0.3, 0.55, cloudRaw(xz)) * smoothstep(0.2, 0.5, c + max(uCloudOff.z, 0.0) * 0.6); }
float wetAt(vec2 xz){ vec2 uv = (xz - uWetO.xy) / uWetO.z; if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return 0.; return texture2D(uWetT, uv).r; }
vec3 fireAt(vec2 xz){ vec2 d = xz - uFireO.xy; if (uFireO.w < 0.5 || d.x < 0. || d.y < 0. || d.x >= uFireO.z || d.y >= uFireO.z) return vec3(0.); return texture2D(uFireT, xz / uFireO.z).rgb; }
`;
export const COMIC = /* glsl */`
uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; uniform float uPx; uniform float uHatch; uniform float uFar; uniform float uTime;
uniform vec3 uLight; uniform float uAmb, uRim, uHeadK, uNight, uRain; uniform vec3 uHeadP, uHeadD;
` + GLSL_ENV + /* glsl */`
vec3 headLight(vec3 al, vec3 N, vec3 wpos){
  vec3 d = wpos - uHeadP; float r = length(d); d /= max(r, 0.001);
  float c = dot(d, uHeadD); float cone = smoothstep(0.86, 0.9, c); float fall = 1.0 - smoothstep(25.0, 75.0, r);
  float lam = clamp(dot(N, -d) * 0.6 + 0.4, 0.0, 1.0);
  float k = cone * fall * lam; k = k > 0.6 ? 1.0 : (k > 0.25 ? 0.6 : (k > 0.05 ? 0.3 : 0.0));
  return al * vec3(1.0, 0.92, 0.7) * k * 1.1;
}
float cloudShadow(vec3 w){ // halftone-edged cloud shadow mask 0..1
  if (uCloudK < 0.01) return 0.;
  vec2 q = w.xz + uSun.xz / max(uSun.y, 0.25) * (uCloudH - w.y);
  float s = cloudCov(q);
  vec2 g = fract(gl_FragCoord.xy / (uPx * 5.)) - 0.5;
  float dots = step(length(g), smoothstep(0.15, 0.75, s) * 0.72);
  return max(step(0.75, s), dots) * uCloudK;
}
float hatchLine(float c, float w){ float d = abs(fract(c) - 0.5) * 2.0; return 1.0 - smoothstep(w, w + 0.12, 1.0 - d); }
vec3 fogMix(vec3 col, vec3 wpos, float k){ float dist = length(wpos - cameraPosition); float f = smoothstep(uFar * 0.2 * k, uFar * k, dist); return mix(col, uHorizon, f * f); }
vec3 comicL(vec3 albedo, vec3 N, vec3 wpos, float hatchK, float shade){
  vec3 V = normalize(cameraPosition - wpos);
  float l = (dot(N, uSun) * 0.5 + 0.5) * (1.0 - 0.45 * shade);
  float band = l > 0.62 ? 1.04 : (l > 0.42 ? 0.74 : 0.5);
  vec3 al = mix(vec3(dot(albedo, vec3(.299,.587,.114))), albedo, 1.12);
  vec3 col = al * band * (uLight + uFlash);
  col = mix(col, col * vec3(0.62, 0.70, 1.25), smoothstep(1.0, 0.5, band) * 0.75);
  col += al * 0.10 * clamp(N.y, 0.0, 1.0) * uAmb;
  col += uHeadK * headLight(al, N, wpos);
  float dist = length(wpos - cameraPosition);
  float hf = uHatch * hatchK * (1.0 - smoothstep(90.0, 380.0, dist));
  if (hf > 0.001) {
    vec2 fc = gl_FragCoord.xy / (uPx * 3.5);
    float w1 = clamp((0.66 - l) * 1.6, 0.0, 0.55), w2 = clamp((0.46 - l) * 1.8, 0.0, 0.55);
    float h = max(hatchLine((fc.x + fc.y) * 0.5, 1.0 - w1) * step(0.001, w1), hatchLine((fc.x - fc.y) * 0.5, 1.0 - w2) * step(0.001, w2));
    col = mix(col, col * 0.3, h * hf);
  }
  float ndv = dot(N, V);
  col = mix(col, vec3(0.04, 0.03, 0.05), (1.0 - smoothstep(0.06, 0.11, ndv)) * (1.0 - smoothstep(0.7, 0.9, abs(N.y))) * (1.0 - smoothstep(40.0, 160.0, dist)) * uRim);
  return col;
}
vec3 comic(vec3 albedo, vec3 N, vec3 wpos, float hatchK){ return fogMix(comicL(albedo, N, wpos, hatchK, cloudShadow(wpos)), wpos, 1.0); }
float ncode(vec3 N){ vec3 v = normalize(mat3(viewMatrix) * N); return 0.08 + 0.84 * (0.5 + 0.5 * dot(v, vec3(0.42, 0.55, 0.72))); }
// wet ground: darker, bluer, flat spots become puddles mirroring the sky (ink-rimmed)
vec3 wetShade(vec3 c, vec3 N, vec3 w, float wet){
  if (wet < 0.02) return c;
  c = mix(c, c * vec3(.55,.6,.7), wet * 0.8);
  float p = sin(w.x*0.21 + sin(w.z*0.17)*2.) * sin(w.z*0.23 + sin(w.x*0.13)*2.);
  float th = 0.75 - wet * 0.45, flt = step(0.965, N.y);
  float pud = step(th, p) * flt * step(0.3, wet);
  float rim = (step(th - 0.06, p) - step(th, p)) * flt * step(0.3, wet);
  float rip = step(0.85, fract(length(fract(w.xz * 0.35) - 0.5) * 3.0 - uTime * 1.5)) * uRain;
  vec3 sky = mix(uHorizon, uZenith, 0.4 + 0.2 * sin(w.x * 0.05)) * 0.85;
  c = mix(c, mix(sky, vec3(.9,.95,1.), rip * 0.5), pud);
  return mix(c, c * 0.35, rim);
}
`;
// ---------------- terrain (ring-buffer grids): biome vertex colours + procedural comic detail + env ----------------
export function gridTerrainMat({ far = false, uNear = null } = {}) {
  return new THREE.ShaderMaterial({ uniforms: far ? { ...U, uNear } : U, vertexColors: true, defines: far ? { FAR: 1 } : {},
    vertexShader: `attribute vec4 sw; attribute float cw; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec4 vS; varying float vCw;
      #ifdef FAR
        uniform vec3 uNear;
      #endif
      void main(){ vec3 p = position;
        #ifdef FAR
          vec2 dd = abs(p.xz - uNear.xy); float m = max(dd.x, dd.y); p.y -= 8.0 * clamp((uNear.z - 10.0 - m) / 10.0, 0.0, 1.0);
        #endif
        vW = p; vN = normal; vC = color; vS = sw; vCw = cw; gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); }`,
    fragmentShader: COMIC + `uniform vec2 uCanR; varying vec3 vW; varying vec3 vN; varying vec3 vC; varying vec4 vS; varying float vCw;
      void main(){
        vec3 N = normalize(vN); float x = vW.x, z = vW.z, h = vW.y;
        vec3 c = vC;
        float gW = clamp(1. - vS.x - vS.y - vS.z - vS.w, 0., 1.);
        float pat = sin(x*0.09 + sin(z*0.07)*2.) * sin(z*0.08 + sin(x*0.05)*2.);
        float spk = sin(x*1.7 + sin(z*1.3)) * sin(z*1.9 + sin(x*1.1));
        vec3 m = vec3(1.);
        m = mix(m, mix(vec3(1.), vec3(.84,.92,.74), step(0.35, pat)) * mix(1., 1.18, step(0.93, spk)), gW);
        float rip = sin(x*2.2 + z*1.1 + sin(z*0.3)*3.);
        m = mix(m, vec3(mix(1.04, .88, smoothstep(0.7, 0.9, rip))), vS.x);
        float sb = h * 0.55 + sin(x*0.03) * 2.5 + cos(z*0.025) * 2.5;
        vec3 st = vec3(mix(1.06, .9, step(0.5, fract(sb * 0.5))));
        st = mix(st, vec3(.55,.5,.5), smoothstep(0.88, 0.97, fract(sb)));
        st = mix(st, vec3(1.15,1.1,1.0), step(0.8, fract(sb*0.23)) * 0.7);
        m = mix(m, st, vS.y);
        m = mix(m, mix(vec3(1.), vec3(.84,.9,1.05), step(0.6, sin(x*0.3+z*0.2+sin(z*0.1)*3.))), vS.z);
        float dk = step(0.6, sin(x*0.4 + z*0.33 + sin(z*0.2)*2.));
        m = mix(m, vec3(mix(1.0, .88, dk) * mix(1., 1.14, step(0.9, spk))), vS.w);
        c *= m;
        float wet0 = 1. - smoothstep(0.0, 0.8, h); c = mix(c, c * vec3(.7,.75,.8), wet0);
        c = wetShade(c, N, vW, wetAt(vW.xz) * (1. - vS.y * 0.5));
        // fire state: burnt ground (charcoal + ash speckle + inked edge), burning (glowing bands), smoulder (night embers)
        vec3 fs = fireAt(vW.xz); vec3 glow = vec3(0.);
        #ifndef FAR
        if (fs.r + fs.g + fs.b > 0.01) {
          float b = fs.r + 0.25 * sin(x * 0.7 + sin(z * 0.6) * 2.) * 0.2;
          vec3 ch = mix(vec3(.13,.11,.10), vec3(.22,.2,.19), step(0.55, pat));
          ch = mix(ch, vec3(.5,.48,.46), step(0.86, spk) * 0.8);
          c = mix(c, ch, step(0.5, b));
          c = mix(c, vec3(.03,.02,.02), (step(0.4, b) - step(0.5, b)));
          float fl = 0.5 + 0.5 * sin(uTime * 9. + x * 1.3 + z * 0.7);
          float burn = fs.g;
          glow += mix(vec3(1.,.35,.05), vec3(1.,.8,.2), step(0.6, burn * (0.7 + 0.3 * fl))) * step(0.15, burn) * 0.9;
          glow += vec3(1.,.3,.05) * step(0.88, spk + fs.b * 0.25 + 0.1 * fl) * step(0.2, fs.b) * (0.4 + 0.8 * uNight);
        }
        #endif
        // distant forest: cel canopy blobs (trees are only instanced out to the impostor range)
        float can = vCw * smoothstep(uCanR.x, uCanR.y, length(vW.xz - cameraPosition.xz)) * (1. - step(0.5, fs.r));
        if (can > 0.01) {
          float t1 = sin(x*0.31 + sin(z*0.27)*2.3) * sin(z*0.29 + sin(x*0.23)*2.1), t2 = sin(x*0.11 - z*0.07 + sin(z*0.05)*3.);
          vec3 cc = mix(vec3(.10,.26,.12), vec3(.24,.44,.16), step(0.15, t1 + 0.25 * t2));
          cc = mix(cc, vec3(.36,.56,.2), step(0.7, t1) * 0.8); cc = mix(cc, vec3(.03,.06,.04), step(t1 + 0.2 * t2, -0.72));
          c = mix(c, cc, can); N = normalize(mix(N, vec3(0., 1., 0.), can));
        }
        vec3 col = comic(c, N, vW, 1.0) + glow;
        gl_FragColor = vec4(col, ncode(N));
      }` });
}
export function waterMat({ far = false, uNear = null } = {}) {
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
        c = mix(c, vec3(1.), step(0.985, sp));
        c = mix(c, vec3(.97,1.,1.), foam);
        c *= (uLight + uFlash) * (1. - 0.35 * cloudShadow(vW)); c += uHeadK * headLight(c, vec3(0.,1.,0.), vW);
        gl_FragColor = vec4(fogMix(c, vW, 1.0), ncode(vec3(0.,1.,0.)) + foam * 0.04);
      }` });
}
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
        c = wetShade(c, N, vW, wetAt(vW.xz));
        gl_FragColor = vec4(comic(c, N, vW, hk), ncode(N)); }` });
}
// sky: posterized gradient, comic sun/moon/stars; overcast darkening from local cloud cover (uRain)
export function skyMat() {
  return new THREE.ShaderMaterial({ uniforms: U, side: THREE.BackSide, depthWrite: false,
    vertexShader: `varying vec3 vD; void main(){ vD = position; gl_Position = (projectionMatrix * modelViewMatrix * vec4(position,1.)).xyww; }`,
    fragmentShader: `uniform vec3 uSun, uHorizon, uZenith, uLight; uniform float uTime, uNight, uRain, uFlash; varying vec3 vD;
      float h31(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main(){
        vec3 d = normalize(vD); float y = max(d.y, 0.);
        float t = floor(pow(y, 0.55) * 6. + 0.5) / 6.;
        vec3 c = mix(uHorizon, uZenith, t);
        float s = dot(d, uSun) * (1. - uNight);
        if (uNight > 0.01) {
          vec3 g = floor(d * 140.); float st = step(0.996, h31(g)) * smoothstep(0.02, 0.2, d.y);
          c = mix(c, vec3(1., .97, .85), st * uNight * (1. - uRain));
          float mo = dot(d, uSun);
          c = mix(c, vec3(.06,.05,.08), step(0.9975, mo) * uNight);
          c = mix(c, vec3(.95,.95,.85) - step(0.9993, dot(d, normalize(uSun + vec3(.02,.02,0.)))) * 0.25, step(0.998, mo) * uNight);
        }
        float sk = 1. - uRain * 0.85;
        c = mix(c, vec3(1.,.95,.7), step(0.96, s) * 0.35 * sk);
        c = mix(c, vec3(1.,.98,.85), step(0.99, s) * 0.5 * sk);
        c = mix(c, vec3(.08,.06,.08), step(0.9965, s) * (1. - step(0.9975, s)) * sk);
        c = mix(c, vec3(1.,.93,.45), step(0.9975, s) * sk);
        c += uFlash * 0.5;
        gl_FragColor = vec4(c, 1.0);
      }` });
}
// rain streaks wrapped in a box around the camera, each streak masked by rain under the clouds at its xz
export function precipMat() {
  return new THREE.ShaderMaterial({ uniforms: { ...U, uCol: { value: new THREE.Color(0xc8d8ff) }, uVel: { value: new THREE.Vector3(0, -30, 0) }, uBox: { value: 40 }, uLen: { value: 0.045 } },
    transparent: true, depthWrite: false,
    vertexShader: GLSL_ENV + `uniform vec3 uVel; uniform float uBox, uLen, uTime; attribute float tail; attribute float seed;
      void main(){
        vec3 p = position * uBox + uVel * uTime * (0.8 + 0.4 * fract(seed * 7.13));
        p = mod(p - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5 + cameraPosition;
        p -= uVel * uLen * tail;
        if (seed > rainAmt(p.xz) * 1.05) p = vec3(0., -1e5, 0.);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.);
      }`,
    fragmentShader: `uniform vec3 uCol, uLight; uniform float uFlash; void main(){ gl_FragColor = vec4(uCol * max(uLight + uFlash, vec3(.35)), 0.6); }` });
}
