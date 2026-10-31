// Flat-world top-speed measurement (Node): straight line, full throttle, optional endless nitro. Used by unit.mjs [10].
import * as THREE from '../lib/three.module.js';
import * as PH from '../physics/index.js';
import { createRig } from '../host/rig.js';
export const flatWorld = () => ({ heightAt: () => 0, surfaceAt: () => 'asphalt', normalAt: (x, z, o) => (o.x = 0, o.y = 1, o.z = 0, o) });
export function topSpeed(id, attach, mode = 'arcade', boost = false, secs = 80) {
  const rig = createRig({ THREE, world: flatWorld() }); rig.setVehicle(id, attach); rig.setMode(mode); const s = rig.state, dt = 1 / 120;
  let top = 0;
  for (let i = 0, n = Math.round(secs / dt); i < n; i++) {
    const yaw = PH.yawOf(s); if (boost) s.nitro = 1; s.heat.temp = 80; // isolate aero/governor from heat derate
    rig.step({ gas: 1, steer: Math.max(-1, Math.min(1, -(s.p.x * 0.05 + Math.sin(yaw) * 1.5))), boost: boost ? 1 : 0 }, dt);
    if (i * dt > secs - 15) top = Math.max(top, Math.hypot(s.v.x, s.v.z) * 3.6);
  }
  return top;
}
// CLI: node tests/topspeed.mjs  -> measured tops (km/h) for vtop / arcade.vtop / vtopBoost in vehicles/defs
if (import.meta.url === new URL(process.argv[1], 'file://').href) {
  const { listVehicles } = await import('../vehicles/index.js');
  for (const v of listVehicles()) { const n = topSpeed(v.id, [], 'normal'), a = topSpeed(v.id, [], 'arcade'), nb = topSpeed(v.id, [], 'normal', true), ab = topSpeed(v.id, [], 'arcade', true);
    console.log(`${v.id.padEnd(9)} normal ${n.toFixed(1)} (nitro ${nb.toFixed(1)})  arcade ${a.toFixed(1)} (nitro ${ab.toFixed(1)})  -> vtop ${(n / 3.6).toFixed(2)} arcade.vtop ${(a / 3.6).toFixed(2)} vtopBoost ${((nb / n + ab / a) / 2).toFixed(3)}`); }
}
