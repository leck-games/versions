// Low-poly models built in code, merged into single vertex-coloured geometries (one draw call each).
import * as THREE from 'three';
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), V = new THREE.Vector3(), S = new THREE.Vector3();
export function P(geo, col, pos = [0, 0, 0], rot = [0, 0, 0], scl = [1, 1, 1], cp = 0) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(M4.compose(V.set(...pos), Q.setFromEuler(E.set(...rot)), S.set(...scl)));
  g.computeVertexNormals(); // flat normals (non-indexed)
  const c = new THREE.Color(col), n = g.attributes.position.count;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
  g.setAttribute('cp', new THREE.BufferAttribute(new Float32Array(n).fill(cp), 1));
  return g;
}
export function merge(parts) {
  const names = ['position', 'normal', 'color', 'cp'], out = new THREE.BufferGeometry();
  for (const nm of names) {
    const sz = parts[0].attributes[nm].itemSize, len = parts.reduce((a, p) => a + p.attributes[nm].array.length, 0), arr = new Float32Array(len);
    let o = 0; for (const p of parts) { arr.set(p.attributes[nm].array, o); o += p.attributes[nm].array.length; }
    out.setAttribute(nm, new THREE.BufferAttribute(arr, sz));
  }
  out.computeBoundingSphere(); return out;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d), cyl = (a, b, h, s = 6) => new THREE.CylinderGeometry(a, b, h, s), cone = (r, h, s = 6) => new THREE.ConeGeometry(r, h, s);
const ico = (r, d = 0) => new THREE.IcosahedronGeometry(r, d);
// ---- trees (white-ish foliage tinted per instance via instanceColor) ----
export function treeVariants() {
  const T = 0x7a4a2a;
  const pine = merge([P(cyl(.35, .55, 3), T, [0, 1.5, 0]), P(cone(3.2, 4.5, 7), 0x2f8f3c, [0, 4.5, 0]), P(cone(2.5, 3.8, 7), 0x3aa046, [0, 6.6, 0], [0, .4, 0]), P(cone(1.7, 3, 7), 0x48b552, [0, 8.6, 0], [0, .8, 0])]);
  const round = merge([P(cyl(.4, .6, 4), T, [0, 2, 0]), P(cyl(.18, .25, 2), T, [.8, 3.5, 0], [0, 0, -.7]), P(ico(2.6), 0x5cb83a, [0, 5.6, 0]), P(ico(1.8), 0x75c944, [1.6, 4.7, .6]), P(ico(1.6), 0x4ea832, [-1.4, 5, -.5])]);
  const poplar = merge([P(cyl(.3, .45, 2.5), T, [0, 1.25, 0]), P(ico(1, 0), 0x3f9c3a, [0, 6, 0], [0, 0, 0], [1.6, 4.6, 1.6]), P(ico(1, 0), 0x56b546, [0, 8, 0], [0, .5, 0], [1.1, 2.6, 1.1])]);
  const bush = merge([P(ico(1.4), 0x4f9e30, [0, .9, 0]), P(ico(1.1), 0x68b83c, [1.1, .7, .3]), P(ico(.9), 0x3f8f2a, [-.9, .6, -.4])]);
  return [pine, round, poplar, bush];
}
export function rockVariants() {
  const a = merge([P(new THREE.DodecahedronGeometry(2.2), 0xa49aa8, [0, .8, 0], [0, 0, 0], [1.3, .9, 1.1]), P(new THREE.DodecahedronGeometry(1.2), 0x8c8296, [1.8, .3, .6], [.5, .3, 0])]);
  const b = merge([P(ico(1.6), 0xb3a58f, [0, 1.6, 0], [.3, 0, .2], [1, 2, 1]), P(ico(1.1), 0x9f9380, [1.2, .7, 0], [0, 1, 0], [1, 1.3, 1])]);
  return [a, b];
}
// ---- saguaro cactus + dead desert shrub (dunes / canyon regions of the engine world) ----
export function cactusVariants() {
  const G = 0x4fa04a, G2 = 0x3d8a3c, F = 0xffd23c;
  const sag = merge([P(cyl(.42, .5, 5, 7), G, [0, 2.5, 0]), P(new THREE.SphereGeometry(.42, 7, 4, 0, 6.3, 0, 1.6), G, [0, 5, 0]),
    P(cyl(.26, .3, 1.3, 6), G2, [.75, 2.2, 0], [0, 0, 1.57]), P(cyl(.26, .3, 1.9, 6), G2, [1.35, 3.0, 0]), P(new THREE.SphereGeometry(.26, 6, 3, 0, 6.3, 0, 1.6), G2, [1.35, 3.95, 0]),
    P(cyl(.24, .28, 1.0, 6), G2, [-.62, 3.1, 0], [0, 0, -1.57]), P(cyl(.24, .28, 1.4, 6), G2, [-1.1, 3.7, 0]), P(new THREE.SphereGeometry(.24, 6, 3, 0, 6.3, 0, 1.6), G2, [-1.1, 4.4, 0]),
    P(ico(.18), F, [0, 5.45, 0])]);
  const D = 0x8a6a48;
  const shrub = merge([P(cyl(.08, .14, 1.6, 4), D, [0, .8, 0], [0, 0, .3]), P(cyl(.07, .1, 1.4, 4), D, [.3, .7, .2], [.5, 0, -.6]), P(cyl(.07, .1, 1.3, 4), D, [-.3, .7, -.1], [-.4, 0, .7]),
    P(ico(.7), 0x9a9a52, [0, 1.5, 0], [0, 0, 0], [1.2, .7, 1.2]), P(ico(.5), 0xa8a860, [.5, 1.1, .3], [0, 0, 0], [1, .7, 1])]);
  return [sag, shrub];
}
// ---- buggy: body (merged) + 4 wheels ----
export function buggy() {
  const O = 0xff6a1a, D = 0x5a5a66, Y = 0xffd23c, W = 0xf4efe0, B = 0x3a3a46;
  const tube = (a, b, r = .06) => { const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b), mid = va.clone().add(vb).multiplyScalar(.5), len = va.distanceTo(vb);
    const g = cyl(r, r, len, 5); g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize())); g.translate(mid.x, mid.y, mid.z); return P(g, B); };
  const parts = [
    P(box(1.5, .28, 3.4), D, [0, .62, 0]),                         // floor pan
    P(box(1.7, .45, 1.3), O, [0, .9, 1.25]), P(box(1.4, .3, .7), O, [0, .85, 2.1], [-.35, 0, 0]),   // nose
    P(box(.35, .45, 2.0), O, [-.85, .9, -.2]), P(box(.35, .45, 2.0), O, [.85, .9, -.2]),            // side pods
    P(box(1.2, .5, 1.0), O, [0, 1.05, -1.35]), P(box(1.0, .2, .8), Y, [0, 1.38, -1.35]), P(cyl(.12, .12, .6, 6), 0x999aa5, [-.35, 1.2, -1.95], [Math.PI / 2, 0, 0]), P(cyl(.12, .12, .6, 6), 0x999aa5, [.35, 1.2, -1.95], [Math.PI / 2, 0, 0]),  // engine + exhausts
    P(box(1.9, .1, .55), Y, [0, 2.05, -1.65]), P(box(.08, .5, .3), B, [-.7, 1.8, -1.6]), P(box(.08, .5, .3), B, [.7, 1.8, -1.6]),     // wing
    P(box(.7, .7, .15), 0x3060c0, [0, 1.3, -.55], [-.15, 0, 0]), P(box(.7, .15, .7), 0x3060c0, [0, .9, -.25]),  // seat
    P(ico(.32, 1), Y, [0, 1.75, -.35]), P(box(.42, .12, .1), B, [0, 1.75, -.08]), P(box(.65, .45, .45), 0x2c7a3a, [0, 1.3, -.35]),  // driver
    P(box(.3, .2, .1), Y, [-.55, 1.1, 1.93]), P(box(.3, .2, .1), Y, [.55, 1.1, 1.93]), P(box(1.75, .14, .2), W, [0, .74, 2.35]),   // lights, bumper
    tube([-.65, .8, .6], [-.55, 2.0, .2]), tube([.65, .8, .6], [.55, 2.0, .2]), tube([-.55, 2.0, .2], [.55, 2.0, .2]),
    tube([-.65, .8, -1.0], [-.55, 2.0, -.9]), tube([.65, .8, -1.0], [.55, 2.0, -.9]), tube([-.55, 2.0, -.9], [.55, 2.0, -.9]),
    tube([-.55, 2.0, .2], [-.55, 2.0, -.9]), tube([.55, 2.0, .2], [.55, 2.0, -.9]), tube([-.55, 2.0, .2], [.55, 2.0, -.9]),
    tube([-.65, .8, .6], [-.7, 1.1, 1.6]), tube([.65, .8, .6], [.7, 1.1, 1.6]),
    tube([-.6, .7, 1.4], [-1.1, .65, 1.45], .07), tube([.6, .7, 1.4], [1.1, .65, 1.45], .07), tube([-.6, .7, -1.4], [-1.1, .65, -1.45], .07), tube([.6, .7, -1.4], [1.1, .65, -1.45], .07),
    P(box(.05, .05, .05), O, [0, 0, 0]),
  ];
  const body = merge(parts);
  const wheel = merge([P(cyl(.68, .68, .55, 10), 0x26262c, [0, 0, 0], [0, 0, Math.PI / 2]), P(cyl(.4, .4, .58, 6), 0xe8e4d8, [0, 0, 0], [0, 0, Math.PI / 2]),
    ...[0, 1, 2, 3, 4].map(i => P(box(.6, .14, .3), 0x3a3a44, [0, Math.cos(i * 1.256) * .66, Math.sin(i * 1.256) * .66], [i * 1.256, 0, 0]))]);
  const flame = merge([P(cone(.28, 1.6, 6), 0xff7a1a, [0, 0, 0], [-Math.PI / 2, 0, 0]), P(cone(.15, 1.0, 6), 0xfff3a0, [0, 0, .2], [-Math.PI / 2, 0, 0])]);
  return { body, wheel, flame };
}
// ---- race furniture for one track: gates with banners, flags, tyre stacks, chevron signs ----
export function trackProps(cps, heightFn) {
  // c.ang = track heading (atan2(dx, dz)); the gate's cross-bar runs along the lateral axis (cos ang, -sin ang), i.e. perpendicular
  // to the racing line. Posts stand vertical on their own ground height; banners roll with the cross-slope (no floating posts).
  const parts = [], gates = [];
  cps.forEach((c, i) => {
    const a = c.ang, ca = Math.cos(a), sa = Math.sin(a);
    const xz = (lx, lz) => [c.x + lx * ca + lz * sa, c.z - lx * sa + lz * ca];
    const gy = (lx, lz) => { const [x, z] = xz(lx, lz); return heightFn(x, z); };
    const yc = heightFn(c.x, c.z), yl = Math.min(gy(-11, 0), yc + 1.5), yr = Math.min(gy(11, 0), yc + 1.5), ym = (yl + yr) / 2;
    const roll = Math.max(-0.175, Math.min(0.175, Math.atan2(yr - yl, 22) * 0.5)), yAt = lx => ym + lx * Math.tan(roll); // banner follows half the cross-slope (max 10°)
    const at = (lx, ly, lz, y0) => { const [x, z] = xz(lx, lz); return [x, (y0 ?? yAt(lx)) + ly, z]; };
    const pc = i === 0 ? 0xffffff : 0xffcf2a;
    // vertical posts stand on their own ground (sunk 1.2 m) and reach up to the banner ends
    for (const s of [-11, 11]) { const yb = s < 0 ? yl : yr, top = yAt(s) + 7.5, hgt = top - (yb - 1.2); parts.push(P(box(1.1, hgt, 1.1), 0x333340, at(s, 0, 0, yb - 1.2 + hgt / 2), [0, a, 0])); parts.push(P(cyl(.9, 1.1, .7, 8), 0x22222a, at(s * 1.18, .35, 0, gy(s * 1.18, 0)))); parts.push(P(cyl(.9, 1.1, .7, 8), 0xff3b3b, at(s * 1.18, 1.05, 0, gy(s * 1.18, 0)))); }
    if (i === 0) { for (let k = 0; k < 12; k++) for (let r = 0; r < 2; r++) parts.push(P(box(1.85, .8, .3), (k + r) % 2 ? 0x111111 : 0xffffff, at(-10.2 + k * 1.85, 6.6 + r * .8, 0), [0, a, roll])); }
    else parts.push(P(box(22, 1.6, .3), pc, at(0, 6.8, 0), [0, a, roll], [1, 1, 1], i));
    for (const s of [-12.5, 12.5]) { const y0 = gy(s, 2); parts.push(P(cyl(.08, .08, 5, 4), 0x333340, at(s, 2.5, 2, y0))); parts.push(P(box(.05, 1, 1.6), i === 0 ? 0x2a6cff : 0xff3b3b, at(s, 4.4, 2.8, y0), [0, a, 0])); }
    gates.push({ i, x: c.x, z: c.z, ang: a, l: xz(-11, 0), r: xz(11, 0), roll });
    // chevron sign halfway to next gate, outside the curve, facing the drivers
    const n = cps[(i + 1) % cps.length], mx = (c.x + n.x) / 2, mz = (c.z + n.z) / 2, na = n.ang;
    const off = 14, ox = mx + Math.cos(c.ang) * off, oz = mz - Math.sin(c.ang) * off, yy = heightFn(ox, oz);
    const sgA = Math.atan2(Math.sin(a) + Math.sin(na), Math.cos(a) + Math.cos(na));
    parts.push(P(cyl(.12, .12, 2.5, 4), 0x333340, [ox, yy + 1.25, oz])); parts.push(P(box(3, 1.2, .15), 0xffd23c, [ox, yy + 2.9, oz], [0, sgA, 0]));
  });
  const g = merge(parts); g.userData.gates = gates; return g;
}
// ---- trophy truck: metres, ground y=0, wheel centres (+-1.05, .64, +1.65/-1.6) ----
export function truck() {
  const T = 0x1fa3a0, D = 0x2b2f3a, Y = 0xffd23c, W = 0xf4efe0, G = 0x9fd8ff;
  const parts = [
    P(box(1.8, .35, 4.6), D, [0, .78, 0]),                                                   // frame
    P(box(2.0, .55, 1.7), T, [0, 1.15, 1.55]), P(box(1.9, .25, .5), T, [0, 1.05, 2.45], [-.4, 0, 0]),   // hood + nose
    P(box(1.95, .9, 1.5), T, [0, 1.75, .05]), P(box(1.7, .6, .1), G, [0, 1.85, .82], [-.35, 0, 0]),    // cab + windscreen
    P(box(1.96, .5, .1), G, [0, 1.85, -.7]), P(box(.06, .45, 1.1), G, [1.0, 1.85, .05]), P(box(.06, .45, 1.1), G, [-1.0, 1.85, .05]),
    P(box(2.0, .1, 1.6), D, [0, 2.24, .0]),                                                   // roof
    P(box(1.6, .22, .25), Y, [0, 2.4, .45]), ...[-.6, -.2, .2, .6].map(x => P(box(.28, .2, .08), W, [x, 2.4, .6])), // light bar
    P(box(2.0, .5, 1.9), T, [0, 1.1, -1.55]), P(box(1.7, .12, 1.7), D, [0, 1.36, -1.55]),      // bed
    P(cyl(.45, .45, .35, 10), 0x26262c, [0, 1.6, -1.8], [0, 0, Math.PI / 2], [1, 1, 1]),        // spare tyre
    P(box(2.2, .3, .25), W, [0, .82, 2.55]), P(box(.12, .55, .12), W, [-.6, 1.05, 2.6]), P(box(.12, .55, .12), W, [.6, 1.05, 2.6]), // bull bar
    P(box(.35, .22, .1), Y, [-.7, 1.25, 2.42]), P(box(.35, .22, .1), Y, [.7, 1.25, 2.42]),     // headlights
    P(box(.5, .12, 2.0), Y, [1.01, 1.3, .9]), P(box(.5, .12, 2.0), Y, [-1.01, 1.3, .9]),       // racing stripes (side)
    P(box(2.2, .3, .9), D, [0, .95, 1.65]), P(box(2.2, .3, .9), D, [0, .95, -1.6]),           // fenders
  ];
  const wheel = merge([P(cyl(.68, .68, .7, 10), 0x26262c, [0, 0, 0], [0, 0, Math.PI / 2]), P(cyl(.38, .38, .72, 6), 0xd0d4dc, [0, 0, 0], [0, 0, Math.PI / 2]),
    ...[0, 1, 2, 3, 4, 5].map(i => P(box(.74, .16, .3), 0x3a3a44, [0, Math.cos(i * 1.047) * .66, Math.sin(i * 1.047) * .66], [i * 1.047, 0, 0]))]);
  const flame = merge([P(cone(.3, 1.6, 6), 0xff7a1a, [0, 0, 0], [-Math.PI / 2, 0, 0]), P(cone(.16, 1.0, 6), 0xfff3a0, [0, 0, .2], [-Math.PI / 2, 0, 0])]);
  return { body: merge(parts), wheel, flame };
}
// ---- quad bike: metres, ground y=0, wheel centres (+-.78, .49, +1.08/-1.02) ----
export function quad() {
  const R = 0xe8303a, D = 0x2b2f3a, Y = 0xffd23c, K = 0x1b1b22;
  const parts = [
    P(box(.8, .3, 2.2), D, [0, .62, 0]),                                                      // frame
    P(box(1.5, .14, .8), R, [0, .98, 1.0], [-.12, 0, 0]), P(box(1.5, .14, .8), R, [0, .98, -1.0], [.12, 0, 0]),   // fenders
    P(box(.7, .45, 1.1), R, [0, 1.0, .35]), P(box(.55, .2, .9), K, [0, 1.28, -.25]),            // tank + seat
    P(cyl(.04, .04, 1.0, 5), K, [0, 1.42, .72], [0, 0, Math.PI / 2]), P(cyl(.05, .05, .5, 5), K, [0, 1.22, .62], [.3, 0, 0]),   // bars
    P(box(.8, .14, .3), Y, [0, .85, 1.55]), P(box(.25, .14, .06), 0xfff3c0, [-.2, 1.0, 1.42]), P(box(.25, .14, .06), 0xfff3c0, [.2, 1.0, 1.42]), // bumper + lights
    P(box(.5, .6, .35), 0x2a6cff, [0, 1.65, -.15], [-.25, 0, 0]), P(ico(.24, 1), Y, [0, 2.12, .0]), P(box(.3, .1, .1), K, [0, 2.12, .2]),  // rider
    P(box(.14, .5, .14), 0x2a6cff, [-.32, 1.55, .3], [-1.0, 0, -.2]), P(box(.14, .5, .14), 0x2a6cff, [.32, 1.55, .3], [-1.0, 0, .2]),     // arms
    P(box(.8, .2, .3), D, [0, .9, -1.45]), P(cyl(.07, .07, .5, 6), 0x999aa5, [.3, .85, -1.5], [Math.PI / 2, 0, 0]),                        // rack + exhaust
  ];
  const wheel = merge([P(cyl(.68, .68, .8, 10), 0x26262c, [0, 0, 0], [0, 0, Math.PI / 2]), P(cyl(.34, .34, .82, 6), 0xffd23c, [0, 0, 0], [0, 0, Math.PI / 2]),
    ...[0, 1, 2, 3, 4, 5].map(i => P(box(.84, .14, .26), 0x3a3a44, [0, Math.cos(i * 1.047) * .66, Math.sin(i * 1.047) * .66], [i * 1.047, 0, 0]))]);
  const flame = merge([P(cone(.2, 1.2, 6), 0xff7a1a, [0, 0, 0], [-Math.PI / 2, 0, 0]), P(cone(.11, .8, 6), 0xfff3a0, [0, 0, .15], [-Math.PI / 2, 0, 0])]);
  return { body: merge(parts), wheel, flame };
}
// ---- FUEL-style jerrycan collectible (~1 m tall, shown scaled up) ----
export function fuelCan() {
  return merge([P(box(.7, 1.0, .35), 0xff3b2a, [0, .5, 0]), P(box(.72, .12, .37), 0xffd23c, [0, .5, 0]), P(box(.3, .12, .1), 0x222222, [-.1, 1.06, 0]),
    P(cyl(.07, .07, .22, 5), 0xffd23c, [.22, 1.1, 0], [0, 0, -.5])]);
}
// ---- vista beacon: tall comic marker post with flag ----
export function beacon() {
  return merge([P(cyl(.3, .45, 14, 6), 0x333340, [0, 7, 0]), P(box(.12, 2.4, 4), 0xffd23c, [0, 12.6, 2.1]), P(box(.13, .8, 4), 0xff3b2a, [0, 12.6, 2.1]),
    P(ico(.9, 0), 0xff6a1a, [0, 14.5, 0]), P(cyl(2.2, 2.6, .6, 8), 0x8a8478, [0, .3, 0])]);
}
