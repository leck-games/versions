// SINE GT: the only stock car that can pass 300 km/h (needs nitro on the flat; ~285 km/h without).
export default {
  id: 'hyper', name: 'SINE GT', blurb: 'Mid-engined hypercar. 300+ km/h with nitro: zoom through trees.', sound: 'v12-hyper',
  stats: { top: 293, topNitro: 330, accel: 5, grip: 4, weight: 2 },
  physics: { vtop: 81.47, vtopBoost: 1.164, arcade: { vtop: 82.21, grip: 1.4, latG: 1.6, yawMax: 2.1, yawK: 8, align: 3.0, down: 0.0035, driftAngle: 0.5, driftTurn: 1.05 }, mass: 1250, dims: [2.0, 1.15, 4.6], inertiaScale: 1.15, wheelR: 0.36, rest: 0.34, k: 62000, cBump: 4200, cReb: 6000, arbF: 22000, arbR: 16000,
    wheelI: 1.3, hard: [[0.92, -0.02, 1.45], [-0.92, -0.02, 1.45], [0.92, -0.02, -1.4], [-0.92, -0.02, -1.4]], forceLift: 0.5,
    torque: [[0, 380], [1500, 470], [3000, 620], [5000, 720], [7000, 700], [8500, 600], [9000, 480]], idle: 1000, redline: 8800,
    gears: [3.0, 2.1, 1.6, 1.28, 1.05, 0.88, 0.76], final: 3.3, up: 8200, down: 4200, shiftT: 0.12, split: 0.35, eff: 0.88,
    brakeF: 4200, brakeR: 3000, hand: 5200, maxSteer: 0.55, steerSpeed: 0.055, steerRate: 3.6, latB: 11.5,
    cdA: 0.8, boostPush: 9000, boostTorque: 1.6, nitroDrain: 0.1, vmax: 78, airPitch: 7000, airRoll: 3000, airYaw: 2200,
    enginePos: [0, 0.4, -1.2], heat: { gen: 6.5, nitro: 4.5 } },
  visual: { model: 'hyper', scale: [1, 1, 1], wc: 0.36, z: 0, wheelScale: 1.12, flame: [0, 0.5, -2.6], color: 0xe8302a },
  mounts: { front: [0, -0.2, 2.35], roof: [0, 0.75, -0.25] },
  defaultAttachments: [],
};
