// Engine heat model (pure). Temperature in °C.
//   gain/s = gen * throttle * (rpm/redline)^2 * (0.4 + 0.6*max(0,load)) * massFactor
//          + nitro (while nitro fires) + limiter (while the engine sits on the rev limiter: 1.5 °C/s rising +0.5 per s, max +6.5)
//   loss/s = (T - ambient) * (coolIdle + coolAir * speed) * coolMul * (1 - 0.5*damage)   (only 15 % below the thermostat)
// At or above `hot` the physics emits periodic engine:hot (every hotEvery s). At or above `overheat`: torque derated to `derate`, nitro disabled. At `max` the engine cuts until T < max - 15.
export const HEAT = { ambient: 25, start: 70, thermostat: 88, hot: 105, overheat: 118, max: 140, gen: 6.5, nitro: 6, limiter: 1.5, limiterRamp: 0.5,
  coolIdle: 0.015, coolAir: 0.0009, derate: 0.65, hotEvery: 0.5 };
export function heatStep(h, H, dt, o) { // o: { thr, rpmFrac, load, nitro, limiter, speed, massFactor, coolMul, damage }
  h.limT = o.limiter ? h.limT + dt : 0;
  let gain = H.gen * o.thr * o.rpmFrac * o.rpmFrac * (0.4 + 0.6 * Math.max(0, o.load)) * o.massFactor;
  if (o.nitro) gain += H.nitro;
  if (h.limT > 0.3) gain += H.limiter + Math.min(10, h.limT) * H.limiterRamp;
  let k = (H.coolIdle + H.coolAir * o.speed) * o.coolMul * (1 - 0.5 * o.damage);
  if (h.temp < H.thermostat) k *= 0.15;
  h.temp += (gain - (h.temp - H.ambient) * k) * dt;
  if (h.temp < H.ambient) h.temp = H.ambient;
  if (h.temp > H.max) h.temp = H.max;
  if (h.temp >= H.max) h.cut = true; else if (h.temp < H.max - 15) h.cut = false;
}
