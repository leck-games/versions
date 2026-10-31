// Fire: cellular automaton on a toroidal 96x96 window of 3 m cells (288 m) around the focus point.
// Fuel comes from terrain dryness (dry grassland / dry savanna only; 0 on forest, wet ground, water, roads, rock, sand).
// Wind biases spread (exp of alignment), slope helps uphill, strong wind throws embers (spotting), rain/wetness kills it.
// Burnt cells persist in a compact sparse Set of global cell keys -> blackened ground stays when you come back.
// FX: one Points draw call: comic flame sprites, rising smoke puffs, embers (glow at night); burning trees get flames too.
import * as THREE from 'three';
import { U, COMIC } from './comic.js';

export const FIRE_CELL = 3;
const N = 96, NN = N * N, STEP = 0.2, BURN_T = 9, MAXB = 1600;
const gkey = (gi, gj) => (gi + 4000) * 8192 + (gj + 4000);
const h21 = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

export function createFire({ fuelAt, heightAt, rainAt, wetAt, wind, trees, emit = () => {} }) {
  const fuel = new Float32Array(NN).fill(-1), hgt = new Float32Array(NN), heat = new Float32Array(NN), tleft = new Float32Array(NN), smoul = new Float32Array(NN);
  const burnt = new Uint8Array(NN), sgi = new Int32Array(NN).fill(-1e9), sgj = new Int32Array(NN).fill(-1e9);
  const burntSet = new Set();                    // persistent: global keys of burnt cells
  let active = [], smoulder = [], gi0 = null, gj0 = null, acc = 0, rnd = 1;
  const rand = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  const tdata = new Uint8Array(NN * 4); const tex = new THREE.DataTexture(tdata, N, N, THREE.RGBAFormat); tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.minFilter = tex.magFilter = THREE.LinearFilter; tex.needsUpdate = true;
  U.uFireT.value = tex;
  const md = v => ((v % N) + N) % N, slot = (gi, gj) => md(gj) * N + md(gi);
  const inWin = (gi, gj) => gi0 !== null && gi >= gi0 && gi < gi0 + N && gj >= gj0 && gj < gj0 + N;
  function ensure(gi, gj) { // slot belongs to (gi,gj)? (re)initialise lazily
    const s = slot(gi, gj);
    if (sgi[s] !== gi || sgj[s] !== gj) { sgi[s] = gi; sgj[s] = gj; fuel[s] = -1; heat[s] = 0; tleft[s] = 0; smoul[s] = 0; burnt[s] = burntSet.has(gkey(gi, gj)) ? 1 : 0; tdata[s * 4] = burnt[s] * 255; tdata[s * 4 + 1] = 0; tdata[s * 4 + 2] = 0; tdata[s * 4 + 3] = 255; tex.needsUpdate = true; }
    return s;
  }
  function fuelOf(s, gi, gj) { if (fuel[s] < 0) { const x = (gi + 0.5) * FIRE_CELL, z = (gj + 0.5) * FIRE_CELL; fuel[s] = fuelAt(x, z); hgt[s] = heightAt(x, z); } return fuel[s]; }
  function recenter(px, pz) {
    const ci = Math.floor(px / FIRE_CELL), cj = Math.floor(pz / FIRE_CELL);
    if (gi0 !== null && Math.abs(ci - (gi0 + N / 2)) < 14 && Math.abs(cj - (gj0 + N / 2)) < 14) return;
    gi0 = ci - N / 2; gj0 = cj - N / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { // reassign slots now outside the window
      const s = j * N + i, gi = gi0 + md(i - gi0), gj = gj0 + md(j - gj0);
      if (sgi[s] !== gi || sgj[s] !== gj) { if (heat[s] > 0 && sgi[s] > -1e8) burntSet.add(gkey(sgi[s], sgj[s])); ensure(gi, gj); }
    }
    active = active.filter(s => heat[s] > 0 && inWin(sgi[s], sgj[s]));
    smoulder = smoulder.filter(s => smoul[s] > 0 && inWin(sgi[s], sgj[s]));
    U.uFireO.value.set(gi0 * FIRE_CELL, gj0 * FIRE_CELL, N * FIRE_CELL, 1);
    tex.needsUpdate = true;
  }
  function igniteCell(gi, gj, cause) {
    if (!inWin(gi, gj) || active.length >= MAXB) return false;
    const s = ensure(gi, gj); if (burnt[s] || heat[s] > 0) return false;
    const x = (gi + 0.5) * FIRE_CELL, z = (gj + 0.5) * FIRE_CELL;
    const f = fuelOf(s, gi, gj) * (1 - Math.min(1, wetAt(x, z) * 1.6)); if (f < 0.06) return false;
    heat[s] = 0.25; tleft[s] = BURN_T * (0.7 + 0.6 * h21(gi, gj)) * (0.6 + 0.4 * f); active.push(s);
    if (cause) emit('fire:ignite', { x, z, cause });
    return true;
  }
  // public: ignite at a world point (radius in m). Returns number of cells lit (0 = nothing to burn here).
  function ignite(x, z, { radius = 2, cause = 'api' } = {}) {
    recenter(x, z); const ci = Math.floor(x / FIRE_CELL), cj = Math.floor(z / FIRE_CELL), r = Math.max(0, Math.ceil(radius / FIRE_CELL)); let n = 0;
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) if (i * i + j * j <= r * r + 0.5 && igniteCell(ci + i, cj + j, n === 0 ? cause : null)) n++;
    return n;
  }
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  function step(dt) {
    const wd = wind(), ws = wd.speed, wx = wd.x, wz = wd.z, next = [];
    let changed = false;
    for (const s of active) {
      if (heat[s] <= 0) continue; changed = true;
      const gi = sgi[s], gj = sgj[s], x = (gi + 0.5) * FIRE_CELL, z = (gj + 0.5) * FIRE_CELL, rn = rainAt(x, z);
      heat[s] = Math.min(1, heat[s] + dt * 0.9) - rn * dt * 0.9;
      tleft[s] -= dt * (1 + ws * 0.02);
      if (heat[s] <= 0.04 || tleft[s] <= 0) { // burnt out (or drowned by rain)
        heat[s] = 0; burnt[s] = 1; burntSet.add(gkey(gi, gj)); smoul[s] = rn > 0.2 ? 0.25 : 1; smoulder.push(s); continue;
      }
      next.push(s);
      const hs = heat[s];
      for (const [di, dj] of NB) {
        const ni = gi + di, nj = gj + dj; if (!inWin(ni, nj)) continue;
        const t = ensure(ni, nj); if (burnt[t] || heat[t] > 0) continue;
        const f = fuelOf(t, ni, nj); if (f < 0.06) continue;
        const dl = Math.hypot(di, dj), al = (di * wx + dj * wz) / dl;
        const wf = Math.exp(al * ws * 0.2) * (ws > 1 ? 1 : 1), sl = 1 + Math.max(-0.5, Math.min(1, (hgt[t] - hgt[s]) / FIRE_CELL)) * 1.2;
        const rate = 0.22 * hs * f * wf * sl / dl * (1 - Math.min(1, rn * 3));
        if (rand() < 1 - Math.exp(-rate * dt) && next.length + 1 < MAXB) { if (igniteCell(ni, nj, null)) next.push(active.pop()); }
      }
      if (ws > 6 && rand() < 0.004 * ws * dt * hs) { // spotting: embers carried downwind
        const k = 3 + rand() * ws * 0.35, ni = Math.round(gi + wx * k + (rand() - 0.5) * 2), nj = Math.round(gj + wz * k + (rand() - 0.5) * 2);
        if (igniteCell(ni, nj, null)) next.push(active.pop());
      }
      if (trees && rand() < 0.3 * dt / STEP * 0.5) { // nearby burnable trees catch
        for (const t of trees.queryTrees(x, z, 3.5)) if (!t.burning && !t.charred && fuelAt(t.pos.x, t.pos.z) > 0.06) trees.igniteTree(t.id);
      }
    }
    active = next;
    for (const s of active) { tdata[s * 4] = Math.min(220, 70 + (1 - tleft[s] / BURN_T) * 150) | 0; tdata[s * 4 + 1] = heat[s] * 255 | 0; }
    const sm = [];
    for (const s of smoulder) { smoul[s] -= dt / 45; if (smoul[s] > 0) sm.push(s); else smoul[s] = 0; tdata[s * 4] = 255; tdata[s * 4 + 1] = 0; tdata[s * 4 + 2] = Math.max(0, smoul[s]) * 255 | 0; changed = true; }
    smoulder = sm;
    if (changed) tex.needsUpdate = true;
  }
  // ---------- FX ----------
  const FL = 900, SM = 480, EM = 320, MAXP = FL + SM + EM;
  let pts = null; const pPos = new Float32Array(MAXP * 3), pAtt = new Float32Array(MAXP * 4); // size, seed, kind, base-height
  function setup(scene) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage)); g.setAttribute('att', new THREE.BufferAttribute(pAtt, 4).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0); g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e7);
    const mat = new THREE.ShaderMaterial({ uniforms: { ...U, uScale: { value: 600 } },
      vertexShader: /* glsl */`uniform float uScale, uTime, uPx, uNight; uniform vec3 uWind; attribute vec4 att; varying vec4 vA; varying float vPh; varying vec3 vW;
        void main(){ vec3 p = position; float kind = att.z, sd = att.y, sz = att.x, ph = 0.;
          if (kind > 0.5 && kind < 1.5) { ph = fract(uTime * (0.09 + 0.05 * fract(sd * 7.)) + sd); float H = 22. + 18. * fract(sd * 3.1);
            p.y += ph * H; p.xz += uWind.xy * (ph * H) * (0.25 + 0.05 * uWind.z) + vec2(sin(sd * 40. + uTime * 0.7), cos(sd * 31. + uTime * 0.6)) * ph * 3.; sz *= 0.6 + 1.6 * ph; }
          else if (kind > 1.5) { ph = fract(uTime * (0.25 + 0.2 * fract(sd * 5.)) + sd); p.y += ph * 14.; p.xz += uWind.xy * ph * 6. + vec2(sin(sd * 50. + uTime * 4.), cos(sd * 37. + uTime * 3.)) * 1.2; sz *= (1. - ph) * (1. + uNight); }
          else { sz *= 0.85 + 0.25 * sin(uTime * 9. + sd * 20.); p.y += sz * 0.35; }
          vA = att; vPh = ph; vW = p;
          vec4 mv = viewMatrix * vec4(p, 1.); gl_PointSize = clamp(sz * uScale / -mv.z, kind > 1.5 ? 1.5 * uPx : 0., 240. * uPx); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: COMIC + /* glsl */`varying vec4 vA; varying float vPh; varying vec3 vW;
        void main(){ vec2 p = gl_PointCoord * 2. - 1.; float y = 1. - gl_PointCoord.y; float kind = vA.z, sd = vA.y; vec3 c; float code = 0.5;
          if (kind < 0.5) { // comic flame: wobbling teardrop, 3 hard colour bands, dark ink rim
            float wob = 0.16 * sin(y * 8. - uTime * 11. + sd * 30.) * y;
            float top = 0.78 + 0.18 * sin(uTime * 13. + sd * 50.);
            float w = 0.8 * pow(max(0., 1. - y / top), 0.65) * smoothstep(0., 0.2, y + 0.06);
            float d = abs(p.x - wob) / max(w, 1e-3); if (d > 1. || y > top) discard;
            float k = d + y * 0.6;
            c = k < 0.55 ? vec3(1., .95, .55) : k < 0.95 ? vec3(1., .62, .12) : vec3(.92, .2, .05);
            c = mix(c, vec3(.25, .04, .02), step(0.88, d)); code = 0.93;
          } else if (kind < 1.5) { // smoke puff: lumpy disc, 2-tone, halftone dissolve with age
            float a = atan(p.y, p.x), lump = 0.8 + 0.12 * sin(a * 5. + sd * 9.) + 0.06 * sin(a * 9. - sd * 5.), r = length(p) / lump; if (r > 1.) discard;
            vec2 g = fract(gl_FragCoord.xy / (uPx * 4.)) - 0.5; if (length(g) > (1. - smoothstep(0.45, 1., vPh)) * 0.75 * (1.15 - r * 0.6)) discard;
            float lit = step(0.0, -p.y * 0.6 + p.x * 0.3 + 0.1);
            c = mix(vec3(.28,.27,.27), vec3(.5,.49,.48), lit) * (uLight * 0.8 + 0.2); c = mix(c, vec3(.08,.07,.07), step(0.86, r));
            c = mix(c, vec3(1., .45, .1), (1. - smoothstep(0.05, 0.22, vPh)) * 0.6 * (0.3 + uNight)); c = fogMix(c, vW, 1.4); code = 0.0;
          } else { float r = length(p); if (r > 1.) discard; c = mix(vec3(1., .9, .4), vec3(1., .35, .05), r) * (1.3 + uNight); code = 0.0; }
          gl_FragColor = vec4(c, code); }` });
    pts = new THREE.Points(g, mat); pts.frustumCulled = false; pts.renderOrder = 3; scene.add(pts);
    return [pts];
  }
  function fx(camera, viewH) {
    if (!pts) return; pts.material.uniforms.uScale.value = viewH / (2 * Math.tan(camera.fov * Math.PI / 360));
    let nf = 0, ns = FL, ne = FL + SM;
    const add = (k, x, y, z, sz, sd, kind) => { pPos[k * 3] = x; pPos[k * 3 + 1] = y; pPos[k * 3 + 2] = z; pAtt[k * 4] = sz; pAtt[k * 4 + 1] = sd; pAtt[k * 4 + 2] = kind; };
    const cx = camera.position.x, cz = camera.position.z;
    for (const s of active) {
      const gi = sgi[s], gj = sgj[s], x = (gi + 0.5) * FIRE_CELL, z = (gj + 0.5) * FIRE_CELL, hs = heat[s], sd = h21(gi, gj), y = hgt[s];
      const far = Math.hypot(x - cx, z - cz) > 140;
      if (nf < FL) { add(nf++, x + (sd - 0.5) * 2, y, z + (h21(gj, gi) - 0.5) * 2, 2.2 + 2.6 * hs, sd, 0); }
      if (!far && nf < FL && hs > 0.5) add(nf++, x + (h21(gi, 7) - 0.5) * 2.4, y, z + (h21(7, gj) - 0.5) * 2.4, 1.6 + 1.8 * hs, h21(gj, 3), 0);
      if ((gi * 7 + gj * 3) % 5 === 0) for (let q = 0; q < 2 && ns < FL + SM; q++) add(ns++, x, y + 1, z, 5 + 3 * sd, fractS(sd + q * 0.5), 1);
      if (!far && ne < MAXP && sd < 0.35) add(ne++, x, y + 1.5, z, 0.35, h21(gi + 3, gj), 2);
    }
    for (const t of trees ? trees.burningList() : []) {
      const sd = h21(t.x, t.z), hh = t.h * (1 - t.b * 0.3);
      for (let q = 0; q < 5 && nf < FL; q++) { const a = q * 2.4 + sd * 6, rr = hh * 0.18; add(nf++, t.x + Math.cos(a) * rr, t.y + hh * (0.35 + 0.13 * q), t.z + Math.sin(a) * rr, 2.6 + hh * 0.22, fractS(sd + q * 0.21), 0); }
      for (let q = 0; q < 4 && ns < FL + SM; q++) add(ns++, t.x, t.y + hh, t.z, 7, fractS(sd + q * 0.25), 1);
      for (let q = 0; q < 3 && ne < MAXP; q++) add(ne++, t.x, t.y + hh * 0.6, t.z, 0.4, fractS(sd + q * 0.33), 2);
    }
    for (let i = 0; i < smoulder.length && ne < MAXP; i += 3) { const s = smoulder[i]; if (smoul[s] < 0.3) continue; const gi = sgi[s], gj = sgj[s]; add(ne++, (gi + 0.5) * FIRE_CELL, hgt[s] + 0.2, (gj + 0.5) * FIRE_CELL, 0.3, h21(gi, gj + 5), 2); }
    // compact: flames [0,nf) smoke [FL,ns) embers [FL+SM,ne) -> move into one contiguous range
    let w = nf; for (let k = FL; k < ns; k++, w++) copy(k, w); for (let k = FL + SM; k < ne; k++, w++) copy(k, w);
    pts.geometry.setDrawRange(0, w); pts.geometry.attributes.position.needsUpdate = pts.geometry.attributes.att.needsUpdate = true;
    counts.flames = nf; counts.smoke = ns - FL; counts.embers = ne - FL - SM;
  }
  const counts = { flames: 0, smoke: 0, embers: 0 };
  function copy(a, b) { if (a === b) return; for (let i = 0; i < 3; i++) pPos[b * 3 + i] = pPos[a * 3 + i]; for (let i = 0; i < 4; i++) pAtt[b * 4 + i] = pAtt[a * 4 + i]; }
  const fractS = v => v - Math.floor(v);
  function update(dt, focus, camera, viewH) {
    recenter(focus.x, focus.z); acc += dt;
    let n = 0; while (acc >= STEP && n++ < 3) { acc -= STEP; step(STEP); }
    fx(camera, viewH);
  }
  function stateAt(x, z) {
    const gi = Math.floor(x / FIRE_CELL), gj = Math.floor(z / FIRE_CELL);
    if (!inWin(gi, gj)) return { burning: false, burnt: burntSet.has(gkey(gi, gj)), intensity: 0 };
    const s = ensure(gi, gj); return { burning: heat[s] > 0, burnt: !!burnt[s], intensity: heat[s], fuel: fuelOf(s, gi, gj) };
  }
  return {
    ignite, update, setup, stateAt,
    stats: () => ({ burning: active.length, burntCells: burntSet.size, smoulder: smoulder.length, ...counts }),
    burningCells: () => active.map(s => ({ x: (sgi[s] + 0.5) * FIRE_CELL, z: (sgj[s] + 0.5) * FIRE_CELL, heat: heat[s] })),
    extinguishAll() { for (const s of active) { heat[s] = 0; burnt[s] = 1; burntSet.add(gkey(sgi[s], sgj[s])); } active = []; },
    save: () => [...burntSet], load(a) { (a || []).forEach(k => burntSet.add(k)); gi0 = null; sgi.fill(-1e9); },
    clearBurnt() { burntSet.clear(); gi0 = null; sgi.fill(-1e9); },
  };
}
