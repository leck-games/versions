// Build a THREE.Group for a vehicle def in the PHYSICS body frame (x = left, y = up, z = fwd, origin = centre of mass).
// Returns { group, body, wheels[4] (in physics wheel order FL, FR, RL, RR), flame, setWheel(i, comp, steer, rot) }.
import { MODELS } from './models.js';
const G = 12.5;
export function buildVehicle(THREE, def, mat) {
  const P = { mass: 1500, k: 50000, rest: 0.6, wheelR: 0.46, hard: [[0.98, -0.12, 1.42], [-0.98, -0.12, 1.42], [0.98, -0.12, -1.38], [-0.98, -0.12, -1.38]], ...def.physics };
  const V = def.visual, M = MODELS[V.model](), s = V.scale || [1, 1, 1];
  const m = mat || new THREE.MeshLambertMaterial({ vertexColors: true });
  const group = new THREE.Group(), body = new THREE.Mesh(M.body, m);
  const visR = P.wheelR * (V.wheelScale || 1.22), sag = P.mass * G / 4 / P.k, ywc = P.hard[0][1] - (P.rest - sag); // static wheel centre (body frame)
  body.scale.set(s[0], s[1], s[2]); body.position.set(0, ywc + (visR - P.wheelR) - V.wc * s[1], V.z || 0); group.add(body);
  const wheels = P.hard.map((h, i) => { const piv = new THREE.Group(), w = new THREE.Mesh(M.wheel, m); w.scale.setScalar(visR / 0.68); piv.add(w); piv.position.set(h[0], ywc, h[2]); group.add(piv); return piv; });
  const flame = new THREE.Mesh(M.flame, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 })); flame.position.fromArray(V.flame); flame.visible = false; group.add(flame);
  function setWheel(i, comp, steer, rot) { const h = P.hard[i], piv = wheels[i]; piv.position.y = h[1] - P.rest + comp + (visR - P.wheelR); piv.rotation.set(0, steer, 0); piv.children[0].rotation.x = rot; }
  return { group, body, wheels, flame, setWheel, material: m, dispose() { M.body.dispose(); M.wheel.dispose(); M.flame.dispose(); flame.material.dispose(); if (!mat) m.dispose(); } };
}
