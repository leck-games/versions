// VEHICLES MODULE: vehicle definitions as data + registry. No physics, no rendering here (see models.js / selector.js).
// Definition contract (MODULE_API.md):
//   { id, name, blurb, sound (sound-engine preset id), stats {top km/h, accel/grip/weight 1..5},
//     physics {..physics params..}, visual {model, scale[3], wc, z, wheelScale, flame[3], color},
//     mounts { front|roof|rear: [x,y,z] body frame (x=left, y=up, z=fwd, metres from CoM) }, defaultAttachments: [ids] }
import buggy from './defs/buggy.js';
import truck from './defs/truck.js';
import quad from './defs/quad.js';
import hyper from './defs/hyper.js';
import forester from './defs/forester.js';
const REG = new Map();
export function registerVehicle(def) {
  for (const k of ['id', 'name', 'physics', 'visual', 'mounts']) if (!def[k]) throw new Error('vehicle def missing ' + k);
  REG.set(def.id, def); return def;
}
[buggy, truck, quad, hyper, forester].forEach(registerVehicle);
export const DEFAULT_VEHICLE = 'buggy';
export const listVehicles = () => [...REG.values()];
export const getVehicle = id => REG.get(id) || REG.get(DEFAULT_VEHICLE);
