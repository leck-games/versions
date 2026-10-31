// Headless driving helpers (Node): straight-line autopilot on the stub world's asphalt strip.
import * as PH from '../physics/index.js';
import { getVehicle } from '../vehicles/index.js';
import { createStubWorld } from '../world/stub-world.js';
export function makeCar(id, world = createStubWorld()) { const s = PH.createState(getVehicle(id).physics); PH.spawn(s, world, 0, 0, 0); return { s, world }; }
// autopilot: hold x = lane, heading +z
export function pilot(s, lane = 0, o = {}) {
  const yaw = PH.yawOf(s), err = s.p.x - lane; // x is "left" at yaw 0
  const steer = Math.max(-1, Math.min(1, -(err * 0.08 + Math.sin(yaw) * 1.5 + s.w.y * 0.25) ));
  return { gas: 1, brake: 0, steer, hand: 0, boost: 0, ...o };
}
export function run(s, world, secs, inputFn, ext, onEvent, dt = 1 / 120) {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) { PH.step(s, inputFn(s, i * dt), dt, world, ext); PH.drainEvents(s, onEvent || (() => {})); }
}
export const kmh = s => Math.hypot(s.v.x, s.v.z) * 3.6;
