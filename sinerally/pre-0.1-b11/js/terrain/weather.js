// Weather + sky: wind, drifting cloud field (instanced cumulus blobs with flat bases + overcast stratus deck),
// rain cells only under rain clouds (mostly over forest via a climate map), rain shafts, local rain streaks,
// cloud shadows (in every terrain shader), wet ground grid, fog/darkening under rain, lightning, time of day.
// Same analytic cloud noise in JS + GLSL, so cpu queries (rainAt for fire, wetness) match what you see.
import * as THREE from 'three';
import { U, COMIC, cnoise, skyMat, precipMat } from './comic.js';
import { biomeWeights } from './world.js';

const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const BIAS = { off: -2, auto: null, on: 0.45, storm: 1.25 };
const CN = 64, CSZ = 4096, WN = 48, WS = 40, LAT = 100, CR = 1450;
const C_DAY_H = new THREE.Color(0xd9f1ff), C_DAY_Z = new THREE.Color(0x1f74e0), C_DUSK_H = new THREE.Color(0xffad6e), C_DUSK_Z = new THREE.Color(0x4f4aa8),
  C_NIGHT_H = new THREE.Color(0x1d2b4e), C_NIGHT_Z = new THREE.Color(0x060a1c), L_DAY = new THREE.Color(1, 1, 1), L_DUSK = new THREE.Color(1.12, 0.8, 0.6), L_NIGHT = new THREE.Color(0.34, 0.4, 0.68),
  C_RAIN = new THREE.Color(0x7d8aa0);
const h1 = (a, b, k) => { const s = Math.sin(a * 127.1 + b * 311.7 + k * 74.7) * 43758.5453; return s - Math.floor(s); };

export function createWeather({ heightAt, emit = () => {} } = {}) {
  const st = { mode: 'auto', bias: -0.05, windDir: 0.6, windSpeed: 5, gust: 0, tod: 0.36, todAuto: false, cycle: 600, t: 0, off: [0, 0], lightning: true, localRain: 0, localCov: 0, baseFar: 800 };
  // ---- climate map (forest-ness drives cloud/rain likelihood); built in slices, CPU copy for rainAt ----
  const climA = new Float32Array(CN * CN), climB = new Float32Array(CN * CN), climBytes = new Uint8Array(CN * CN * 4);
  const climTex = new THREE.DataTexture(climBytes, CN, CN, THREE.RGBAFormat); climTex.minFilter = climTex.magFilter = THREE.LinearFilter; climTex.wrapS = climTex.wrapT = THREE.ClampToEdgeWrapping;
  U.uClimT.value = climTex;
  let climO = null, climJob = null; const BW = new Float32Array(6);
  const climVal = (x, z) => { biomeWeights(x, z, BW); return Math.min(1, BW[2] + 0.55 * BW[5]); };
  function climStart(cx, cz, sync) {
    const ox = Math.round(cx / 512) * 512 - CSZ / 2, oz = Math.round(cz / 512) * 512 - CSZ / 2;
    climJob = { ox, oz, row: 0 }; if (sync) while (climJob) climStep(CN);
  }
  function climStep(rows) {
    const j = climJob, d = CSZ / CN;
    for (let r = 0; r < rows && j.row < CN; r++, j.row++) for (let i = 0; i < CN; i++) climB[j.row * CN + i] = climVal(j.ox + (i + 0.5) * d, j.oz + (j.row + 0.5) * d);
    if (j.row >= CN) { climA.set(climB); for (let k = 0; k < CN * CN; k++) { climBytes[k * 4] = climA[k] * 255; climBytes[k * 4 + 3] = 255; } climTex.needsUpdate = true;
      climO = { ox: j.ox, oz: j.oz }; U.uClimO.value.set(j.ox, j.oz, CSZ, 1); climJob = null; }
  }
  function climAt(x, z) { // bilinear like the GPU (texel centres)
    if (!climO) return climVal(x, z);
    const d = CSZ / CN, fx = Math.max(0, Math.min(CN - 1.001, (x - climO.ox) / d - 0.5)), fz = Math.max(0, Math.min(CN - 1.001, (z - climO.oz) / d - 0.5));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * CN + i;
    return (climA[k] * (1 - u) + climA[k + 1] * u) * (1 - v) + (climA[k + CN] * (1 - u) + climA[k + CN + 1] * u) * v;
  }
  const rawAt = (x, z) => cnoise(x - st.off[0], z - st.off[1]) + 0.9 * climAt(x, z) - 0.75 + st.bias;
  const coverageAt = (x, z) => sst(0, 0.25, rawAt(x, z));
  const rainAt = (x, z) => { const c = climAt(x, z); return sst(0.3, 0.55, rawAt(x, z)) * sst(0.2, 0.5, c + Math.max(st.bias, 0) * 0.6); };
  // ---- wet ground grid ----
  const wet = new Float32Array(WN * WN), wetBytes = new Uint8Array(WN * WN * 4), rowT = new Float32Array(WN);
  const wetTex = new THREE.DataTexture(wetBytes, WN, WN, THREE.RGBAFormat); wetTex.minFilter = wetTex.magFilter = THREE.LinearFilter; U.uWetT.value = wetTex;
  let wo = null, wrow = 0;
  function wetRecenter(cx, cz) {
    const nx = Math.round(cx / WS) * WS - WN * WS / 2, nz = Math.round(cz / WS) * WS - WN * WS / 2;
    const old = wo ? wet.slice() : null, di = wo ? (nx - wo.ox) / WS : 0, dj = wo ? (nz - wo.oz) / WS : 0;
    for (let j = 0; j < WN; j++) for (let i = 0; i < WN; i++) {
      const oi = i + di, oj = j + dj, k = j * WN + i;
      if (old && oi >= 0 && oj >= 0 && oi < WN && oj < WN) wet[k] = old[oj * WN + oi];
      else { const r = rainAt(nx + (i + 0.5) * WS, nz + (j + 0.5) * WS); wet[k] = r > 0.08 ? Math.min(1, 0.4 + r) : 0; }
      wetBytes[k * 4] = wet[k] * 255; wetBytes[k * 4 + 3] = 255;
    }
    wo = { ox: nx, oz: nz }; U.uWetO.value.set(nx, nz, WN * WS, 1); wetTex.needsUpdate = true;
  }
  function wetStep(rows) {
    for (let r = 0; r < rows; r++, wrow = (wrow + 1) % WN) {
      const dt = Math.min(5, st.t - rowT[wrow]); rowT[wrow] = st.t; if (dt <= 0) continue;
      for (let i = 0; i < WN; i++) { const k = wrow * WN + i, rr = rainAt(wo.ox + (i + 0.5) * WS, wo.oz + (wrow + 0.5) * WS);
        wet[k] = rr > 0.05 ? Math.min(1, wet[k] + rr * dt / 18) : Math.max(0, wet[k] - dt / 160); wetBytes[k * 4] = wet[k] * 255; }
    }
    wetTex.needsUpdate = true;
  }
  function wetAt(x, z) {
    if (!wo) return 0; const fx = (x - wo.ox) / WS - 0.5, fz = (z - wo.oz) / WS - 0.5;
    if (fx < 0 || fz < 0 || fx >= WN - 1 || fz >= WN - 1) return 0;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * WN + i;
    return (wet[k] * (1 - u) + wet[k + 1] * u) * (1 - v) + (wet[k + WN] * (1 - u) + wet[k + WN + 1] * u) * v;
  }
  // ---- meshes ----
  let sky, precip, cum, strat, shafts, bolt, cumN = 0, shN = 0;
  const CMAX = 1500, SMAX = 160;
  function setup(scene) {
    sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 24, 12), skyMat()); sky.frustumCulled = false; sky.renderOrder = -1; scene.add(sky);
    // cumulus blobs
    const bg = new THREE.InstancedBufferGeometry(); const ig = new THREE.IcosahedronGeometry(1, 1);
    bg.setAttribute('position', ig.attributes.position); bg.setAttribute('normal', ig.attributes.normal);
    const cP = new THREE.InstancedBufferAttribute(new Float32Array(CMAX * 4), 4).setUsage(THREE.DynamicDrawUsage), cS = new THREE.InstancedBufferAttribute(new Float32Array(CMAX * 3), 3).setUsage(THREE.DynamicDrawUsage);
    bg.setAttribute('iPos', cP); bg.setAttribute('iScl', cS); bg.instanceCount = 0; bg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const cm = new THREE.ShaderMaterial({ uniforms: U,
      vertexShader: /* glsl */`attribute vec4 iPos; attribute vec3 iScl; uniform vec3 uCloudOff; varying vec3 vW, vN; varying float vDark;
        void main(){ vec3 p = position; p.y = max(p.y, -0.25); vec3 n = normal; if (position.y < -0.24) n = vec3(0., -1., 0.);
          vec3 w = vec3(iPos.x + uCloudOff.x, iPos.y, iPos.z + uCloudOff.y) + p * iScl; vW = w; vN = normalize(n / iScl); vDark = iPos.w;
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: COMIC + /* glsl */`varying vec3 vW, vN; varying float vDark;
        void main(){ vec3 N = normalize(vN); float l = dot(N, uSun) * 0.5 + 0.5;
          vec3 hi = mix(vec3(1., 1., 1.), vec3(.62,.65,.72), vDark), mid = mix(vec3(.80,.84,.93), vec3(.47,.5,.58), vDark), lo = mix(vec3(.62,.67,.82), vec3(.33,.35,.42), vDark);
          vec3 c = l > 0.64 ? hi : l > 0.42 ? mid : lo; if (N.y < -0.9) c = lo * 0.85;
          vec2 g = fract(gl_FragCoord.xy / (uPx * 5.)) - 0.5; float band = step(0.42, l) * (1. - step(0.64, l));
          c = mix(c, c * 0.82, step(length(g), 0.28) * band);
          c *= mix(vec3(1.), uLight, 0.9) + uFlash * 0.8; c += vec3(1., .5, .3) * uNight * 0.0;
          float dist = length(vW - cameraPosition); c = mix(c, uHorizon, smoothstep(500., 1600., dist) * 0.75);
          gl_FragColor = vec4(c, ncode(N)); }` });
    cum = { mesh: new THREE.Mesh(bg, cm), g: bg, P: cP, S: cS }; cum.mesh.frustumCulled = false; scene.add(cum.mesh);
    // stratus/overcast deck (seen from below where it rains hard)
    const sg = new THREE.PlaneGeometry(3600, 3600, 1, 1).rotateX(Math.PI / 2);
    const sm = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide,
      vertexShader: `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: COMIC + `varying vec3 vW; void main(){ float r = cloudRaw(vW.xz); if (r < 0.34) discard;
        vec3 c = r > 0.62 ? vec3(.36,.38,.45) : r > 0.46 ? vec3(.46,.49,.56) : vec3(.58,.61,.68); c = mix(c, vec3(.1,.1,.13), step(r, 0.37));
        c *= mix(vec3(1.), uLight, 0.9) + uFlash; float dist = length(vW.xz - cameraPosition.xz); c = mix(c, uHorizon * 0.8, smoothstep(600., 1700., dist) * 0.8);
        if (dist > 1750.) discard; gl_FragColor = vec4(c, 0.3); }` });
    strat = new THREE.Mesh(sg, sm); strat.frustumCulled = false; scene.add(strat);
    // rain shafts: camera-facing hatched curtains under rain clouds
    const qg = new THREE.InstancedBufferGeometry(); qg.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, 1, 1, 0, -1, 1, 0], 3)); qg.setIndex([0, 1, 2, 0, 2, 3]);
    const sA = new THREE.InstancedBufferAttribute(new Float32Array(SMAX * 4), 4).setUsage(THREE.DynamicDrawUsage), sB = new THREE.InstancedBufferAttribute(new Float32Array(SMAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    qg.setAttribute('iA', sA); qg.setAttribute('iB', sB); qg.instanceCount = 0; qg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const qm = new THREE.ShaderMaterial({ uniforms: U, side: THREE.DoubleSide,
      vertexShader: /* glsl */`attribute vec4 iA, iB; uniform vec3 uCloudOff, uWind; varying vec2 vUv; varying float vR, vSd; varying vec3 vW;
        void main(){ vec3 c = vec3(iA.x + uCloudOff.x, 0., iA.y + uCloudOff.y); vec3 toC = cameraPosition - c; vec3 R = normalize(vec3(toC.z, 0., -toC.x));
          float y = mix(iB.x, iB.y, position.y); vec3 w = c + R * position.x * iA.z; w.y = y; w.xz += uWind.xy * (1. - position.y) * (8. + uWind.z * 3.);
          vUv = vec2(position.x, position.y); vR = iA.w; vSd = iB.z; vW = w; gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.); }`,
      fragmentShader: COMIC + /* glsl */`varying vec2 vUv; varying float vR, vSd; varying vec3 vW;
        void main(){ float dist = length(vW.xz - cameraPosition.xz);
          float edge = 1. - vUv.x * vUv.x; float dens = 0.62 * vR * edge * edge * (0.55 + 0.45 * vUv.y) * smoothstep(0., 0.25, vUv.y) * smoothstep(1.0, 0.85, vUv.y) * smoothstep(90., 220., dist);
          vec2 fc = gl_FragCoord.xy / uPx; float hatch = fract((fc.x * 0.9 + fc.y * 0.25 + uTime * 40. + vSd * 50.) / 7.);
          float g = fract(sin(dot(floor(fc / 2.), vec2(12.9, 78.2))) * 43758.5);
          if (hatch > 0.32 || g > dens * 1.1) discard;
          vec3 c = vec3(.5,.55,.66) * (mix(vec3(1.), uLight, 0.9) + uFlash); c = mix(c, uHorizon, smoothstep(700., 1600., dist) * 0.6);
          gl_FragColor = vec4(c, 0.0); }` });
    shafts = { mesh: new THREE.Mesh(qg, qm), g: qg, A: sA, B: sB }; shafts.mesh.frustumCulled = false; scene.add(shafts.mesh);
    // near rain streaks
    const n = 1400, pos = new Float32Array(n * 6), tail = new Float32Array(n * 2), seed = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const x = Math.random(), y = Math.random(), z = Math.random(), sd = Math.random(); pos.set([x, y, z, x, y, z], i * 6); tail.set([0, 1], i * 2); seed.set([sd, sd], i * 2); }
    const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pg.setAttribute('tail', new THREE.BufferAttribute(tail, 1)); pg.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
    precip = new THREE.LineSegments(pg, precipMat()); precip.frustumCulled = false; precip.renderOrder = 5; scene.add(precip);
    // lightning bolt ribbon
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(26 * 3), 3)); const idx = []; for (let i = 0; i < 12; i++) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2); lg.setIndex(idx);
    bolt = new THREE.Mesh(lg, new THREE.ShaderMaterial({ side: THREE.DoubleSide, vertexShader: 'void main(){ gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }', fragmentShader: 'void main(){ gl_FragColor = vec4(1., 1., .82, .97); }' }));
    bolt.frustumCulled = false; bolt.visible = false; scene.add(bolt);
    return [sky, cum.mesh, strat, shafts.mesh, precip, bolt];
  }
  function clouds(cx, cz) {
    if (!cum) return; const H = U.uCloudH.value; let n = 0, s = 0;
    const qx = cx - st.off[0], qz = cz - st.off[1], i0 = Math.floor((qx - CR) / LAT), i1 = Math.floor((qx + CR) / LAT), j0 = Math.floor((qz - CR) / LAT), j1 = Math.floor((qz + CR) / LAT);
    const P = cum.P.array, S = cum.S.array, A = shafts.A.array, B = shafts.B.array;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const lx = (i + 0.2 + 0.6 * h1(i, j, 1)) * LAT, lz = (j + 0.2 + 0.6 * h1(i, j, 2)) * LAT;
      const dx = lx - qx, dz = lz - qz; if (dx * dx + dz * dz > CR * CR) continue;
      const wx = lx + st.off[0], wz = lz + st.off[1], raw = rawAt(wx, wz); if (raw < -0.04 + 0.12 * h1(i, j, 3)) continue;
      const size = 0.45 + 0.6 * sst(-0.04, 0.5, raw), rn = rainAt(wx, wz), dark = Math.min(1, rn * 1.3 + sst(0.2, 0.6, raw) * 0.35), nb = 1 + Math.floor(h1(i, j, 4) * 3) + (raw > 0.3 ? 2 : 0);
      for (let b = 0; b < nb && n < CMAX; b++) {
        const r = (26 + 22 * h1(i, j, 10 + b)) * size * (b === 0 ? 1.25 : 1), a = h1(i, j, 20 + b) * 6.283, d = b === 0 ? 0 : (20 + 25 * h1(i, j, 30 + b)) * size;
        const sy = r * (0.6 + 0.5 * size + 0.4 * rn) * (b === 0 ? 1.2 : 0.9), base = H - 30 * rn;
        P[n * 4] = lx + Math.cos(a) * d; P[n * 4 + 1] = base + 0.25 * sy; P[n * 4 + 2] = lz + Math.sin(a) * d; P[n * 4 + 3] = dark;
        S[n * 3] = r * 1.35; S[n * 3 + 1] = sy; S[n * 3 + 2] = r * 1.2; n++;
      }
      if (rn > 0.3 && s < SMAX && h1(i, j, 6) < 0.3 + 0.5 * rn) { const gy = heightAt ? heightAt(wx, wz) : 0;
        A[s * 4] = lx; A[s * 4 + 1] = lz; A[s * 4 + 2] = 26 + 30 * size; A[s * 4 + 3] = Math.min(1, rn * 1.1); B[s * 4] = gy - 8; B[s * 4 + 1] = H - 30 * rn + 5; B[s * 4 + 2] = h1(i, j, 5); s++; }
    }
    cum.g.instanceCount = cumN = n; cum.P.needsUpdate = cum.S.needsUpdate = true; shafts.g.instanceCount = shN = s; shafts.A.needsUpdate = shafts.B.needsUpdate = true;
  }
  const lastC = { x: 0, z: 0 }; let cloudT = 0, boltT = 6, boltLife = 0, flash = 0; const sunV = new THREE.Vector3(), tmpC = new THREE.Color();
  function strike(cx, cz) {
    let best = null, br = 0.55; for (let k = 0; k < 8; k++) { const a = Math.random() * 6.283, d = 250 + Math.random() * 800, x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d, r = rainAt(x, z); if (r > br) { br = r; best = [x, z]; } }
    if (!best) return; const [x, z] = best, gy = heightAt ? heightAt(x, z) : 0, top = U.uCloudH.value - 20, p = bolt.geometry.attributes.position.array;
    let bx = x, bz = z; for (let i = 0; i <= 12; i++) { const y = top + (gy - top) * i / 12, w = 3 * (1 - i / 14); if (i > 0 && i < 12) { bx += (Math.random() - 0.5) * 24; bz += (Math.random() - 0.5) * 24; } else if (i === 12) { bx = x; bz = z; }
      p.set([bx - w, y, bz, bx + w, y, bz], i * 6); }
    bolt.geometry.attributes.position.needsUpdate = true; bolt.visible = true; boltLife = 0.32; flash = 0.9;
    emit('weather:lightning', { x, y: gy, z });
  }
  function update(dt, cam, camera) {
    st.t += dt; const cx = cam.x, cz = cam.z; lastC.x = cx; lastC.z = cz;
    // wind + cloud advection
    st.gust = 1 + 0.25 * Math.sin(st.t * 0.7) * Math.sin(st.t * 0.23 + 1);
    const ws = st.windSpeed * st.gust, dx = Math.cos(st.windDir), dz = Math.sin(st.windDir); U.uWind.value.set(dx, dz, ws);
    const cs = Math.max(2.5, st.windSpeed * 1.5); st.off[0] += dx * cs * dt; st.off[1] += dz * cs * dt;
    const tb = BIAS[st.mode] ?? (-0.05 + 0.2 * Math.sin(st.t / 120)); st.bias += (tb - st.bias) * Math.min(1, dt * 0.25);
    U.uCloudOff.value.set(st.off[0], st.off[1], st.bias);
    // climate + wetness windows
    if (!climO && !climJob) climStart(cx, cz, true);
    else if (!climJob && (Math.abs(cx - climO.ox - CSZ / 2) > 600 || Math.abs(cz - climO.oz - CSZ / 2) > 600)) climStart(cx, cz, false);
    if (climJob) climStep(8);
    if (!wo || Math.abs(cx - wo.ox - WN * WS / 2) > 480 || Math.abs(cz - wo.oz - WN * WS / 2) > 480) wetRecenter(cx, cz); else wetStep(6);
    cloudT -= dt; if (cloudT <= 0) { cloudT = 0.1; clouds(cx, cz); }
    if (strat) strat.position.set(Math.round(cx / 50) * 50, U.uCloudH.value + 75, Math.round(cz / 50) * 50);
    // local conditions at the camera
    const rC = rainAt(cx, cz), cC = coverageAt(cx, cz); st.localRain += (rC - st.localRain) * Math.min(1, dt * 0.8); st.localCov += (cC - st.localCov) * Math.min(1, dt * 0.8);
    // lightning (needs a heavy rain cell nearby)
    if (bolt) { boltLife -= dt; if (boltLife <= 0) bolt.visible = false; else bolt.visible = Math.sin(boltLife * 90) > -0.3;
      boltT -= dt; if (boltT <= 0) { boltT = 4 + Math.random() * 9; if (st.lightning && st.mode !== 'off') strike(cx, cz); } }
    flash = Math.max(0, flash - dt * 3.5); U.uFlash.value = flash * (0.6 + 0.4 * Math.sin(st.t * 60) ** 2) * 0.6;
    // time of day + atmosphere (ported from the game, plus local cloud/rain darkening and rain fog)
    if (st.todAuto) st.tod = (st.tod + dt / st.cycle) % 1;
    const a = (st.tod - 0.25) * Math.PI * 2, el = Math.sin(a);
    const day = sst(-0.1, 0.22, el), night = 1 - sst(-0.22, 0.0, el), dusk = day * (1 - sst(0.05, 0.42, el));
    if (el > -0.08) sunV.set(Math.cos(a) * 0.85, Math.max(el, 0.2), 0.5); else sunV.set(-Math.cos(a) * 0.85, Math.max(-el, 0.45), -0.5);
    U.uSun.value.copy(sunV.normalize());
    const L = U.uLight.value.copy(L_NIGHT).lerp(L_DAY, day).lerp(L_DUSK, dusk);
    const Hc = U.uHorizon.value.copy(C_NIGHT_H).lerp(C_DAY_H, day).lerp(C_DUSK_H, dusk), Z = U.uZenith.value.copy(C_NIGHT_Z).lerp(C_DAY_Z, day).lerp(C_DUSK_Z, dusk * 0.8);
    const R = st.localRain, Cv = st.localCov; tmpC.copy(C_RAIN).multiply(L);
    Hc.lerp(tmpC, Math.min(1, R * 0.9 + Cv * 0.25)); Z.lerp(tmpC, Math.min(1, R * 0.7 + Cv * 0.3));
    L.multiplyScalar(1 - 0.18 * Cv - 0.22 * R);
    U.uFar.value = st.baseFar * (1 - 0.55 * R) * (1 - night * 0.25); U.uNight.value = night; U.uRain.value = Math.max(R, Cv * 0.5);
    U.uHeadK.value = Math.max(sst(0.25, 0.7, night), sst(0.3, 0.8, R) * 0.6); U.uAmb.value = 0.6 + 0.4 * day; U.uCloudK.value = st.mode === 'off' ? 0 : 1 - 0.6 * R;
    if (sky && camera) sky.position.copy(camera.position);
    if (precip) { const pm = precip.material.uniforms; pm.uVel.value.set(dx * ws * 0.5, -30, dz * ws * 0.5); pm.uBox.value = 36; precip.visible = R > 0.02 || st.mode === 'storm'; }
  }
  return {
    setup, update, rainAt, coverageAt, wetAt, climAt,
    wind: () => ({ x: Math.cos(st.windDir), z: Math.sin(st.windDir), speed: st.windSpeed * st.gust, dir: st.windDir }),
    setWind(dir, speed) { if (dir !== undefined && dir !== null) st.windDir = dir; if (speed !== undefined) st.windSpeed = Math.max(0, speed); },
    setRain(mode) { if (!(mode in BIAS)) throw new Error('rain mode: off|auto|on|storm'); st.mode = mode; },
    setTimeOfDay(t, auto = false) { st.tod = ((t % 1) + 1) % 1; st.todAuto = auto; },
    setLightning(on) { st.lightning = !!on; }, strike: () => strike(lastC.x, lastC.z),
    set baseFar(v) { st.baseFar = v; }, get state() { return { ...st, clouds: cumN, shafts: shN }; },
    snapBias() { st.bias = BIAS[st.mode] ?? st.bias; U.uCloudOff.value.z = st.bias; },
  };
}
