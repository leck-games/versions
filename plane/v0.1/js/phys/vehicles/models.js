// Vehicle visuals (code-built low-poly models, vertex-coloured, one draw call per part). Uses THREE via the importmap.
// Every builder returns { body, wheel, flame } geometries; model units = metres, ground y = 0, wheel mesh radius 0.68.
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
const wheelGeo = (w, hub) => merge([P(cyl(.68, .68, w, 12), 0x26262c, [0, 0, 0], [0, 0, Math.PI / 2]), P(cyl(.4, .4, w + .02, 6), hub, [0, 0, 0], [0, 0, Math.PI / 2]),
  ...[0, 1, 2, 3, 4, 5].map(i => P(box(w + .04, .14, .28), 0x3a3a44, [0, Math.cos(i * 1.047) * .66, Math.sin(i * 1.047) * .66], [i * 1.047, 0, 0]))]);
const flameGeo = (r = .26) => merge([P(cone(r, 1.6, 6), 0xff7a1a, [0, 0, 0], [-Math.PI / 2, 0, 0]), P(cone(r * .55, 1.0, 6), 0xfff3a0, [0, 0, .2], [-Math.PI / 2, 0, 0])]);
// ---- SINE GT hypercar: wheel centres (+-.92, .36, +1.45/-1.40) ----
export function hyper() {
  const R = 0xe8302a, K = 0x1b1b22, Y = 0xffd23c, G = 0x7fc8ff, W = 0xf4efe0;
  const parts = [
    P(box(1.9, .32, 4.4), K, [0, .32, 0]),                                              // floor
    P(box(1.95, .36, 1.6), R, [0, .55, 1.45]), P(box(1.85, .18, 1.0), R, [0, .52, 2.35], [-.18, 0, 0]),   // nose
    P(box(1.3, .42, 1.7), G, [0, .88, -.05], [.06, 0, 0]), P(box(1.36, .1, 1.1), R, [0, 1.1, -.25]),       // canopy + roof
    P(box(.3, .42, 2.2), R, [-.92, .62, -.5]), P(box(.3, .42, 2.2), R, [.92, .62, -.5]),                  // side pods
    P(box(.25, .25, .6), K, [-.98, .66, -.3]), P(box(.25, .25, .6), K, [.98, .66, -.3]),                  // intakes
    P(box(1.9, .5, 1.4), R, [0, .65, -1.6]), P(box(1.7, .1, .9), K, [0, .92, -1.5]),                      // rear deck
    P(box(2.1, .07, .5), Y, [0, 1.3, -2.05]), P(box(.06, .45, .3), K, [-.6, 1.08, -2.0]), P(box(.06, .45, .3), K, [.6, 1.08, -2.0]), // wing
    P(box(1.5, .12, .08), 0xff3020, [0, .72, -2.32]), P(box(.4, .12, .08), W, [-.65, .62, 2.6]), P(box(.4, .12, .08), W, [.65, .62, 2.6]), // lights
    P(cyl(.1, .1, .4, 6), 0x999aa5, [-.25, .5, -2.3], [Math.PI / 2, 0, 0]), P(cyl(.1, .1, .4, 6), 0x999aa5, [.25, .5, -2.3], [Math.PI / 2, 0, 0]),
    P(box(.5, .06, 4.2), Y, [0, .74, .1]),                                                               // stripe
  ];
  return { body: merge(parts), wheel: wheelGeo(.6, 0xd0d4dc), flame: flameGeo(.22) };
}
// ---- TIMBERWOLF forestry truck: wheel centres (+-1.12, .66, +1.85/-1.75) ----
export function forester() {
  const G = 0x3f8f3a, D = 0x2b2f3a, Y = 0xffd23c, W = 0xf4efe0, Gl = 0x9fd8ff, Or = 0xff8a1a;
  const parts = [
    P(box(1.9, .5, 5.6), D, [0, 1.05, 0]),                                                  // chassis
    P(box(2.2, .9, 1.4), G, [0, 1.65, 2.2]), P(box(2.1, .3, .4), G, [0, 1.35, 2.95], [-.3, 0, 0]),   // hood
    P(box(2.2, 1.5, 1.6), G, [0, 2.3, .8]), P(box(1.9, .8, .1), Gl, [0, 2.55, 1.62], [-.12, 0, 0]),  // cab + windscreen
    P(box(.06, .7, 1.2), Gl, [1.11, 2.5, .8]), P(box(.06, .7, 1.2), Gl, [-1.11, 2.5, .8]),
    P(box(2.3, .12, 1.8), D, [0, 3.1, .8]), P(box(1.4, .5, .5), Or, [0, 3.2, -.0]),          // roof + beacon box
    P(box(2.3, .25, 3.0), D, [0, 1.45, -1.6]),                                                // flatbed
    ...[-1.05, 1.05].flatMap(x => [-2.9, -1.6, -.3].map(z => P(box(.12, 1.2, .12), Y, [x, 2.1, z]))), // stakes
    P(box(2.3, 1.3, .12), Y, [0, 2.1, .05]),                                                  // headboard
    P(box(2.4, .35, 1.0), D, [0, 1.25, 1.85]), P(box(2.4, .35, 1.0), D, [0, 1.25, -1.75]),     // fenders
    P(box(.3, .2, .08), W, [-.75, 1.85, 2.92]), P(box(.3, .2, .08), W, [.75, 1.85, 2.92]),     // headlights
    P(cyl(.1, .12, 1.6, 6), 0x999aa5, [.95, 2.6, 1.6]),                                       // stack
  ];
  return { body: merge(parts), wheel: wheelGeo(.75, Y), flame: flameGeo(.3) };
}
export const MODELS = { buggy, truck, quad, hyper, forester };
