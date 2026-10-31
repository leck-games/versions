const T = [[0, 300], [1000, 330], [2000, 420], [3500, 540], [5000, 520], [6500, 430], [7200, 330]].map(([r, v]) => [r, v * 1.65]);
export default {
  id: 'truck', name: 'TRUCK', blurb: 'Heavy, grippy pickup. Shrugs off small trees.', sound: 'v8-truck',
  stats: { top: 188, accel: 2, grip: 4, weight: 4 },
  physics: { mass: 2300, dims: [2.2, 1.9, 5.0], wheelR: 0.52, rest: 0.7, k: 76000, cBump: 5600, cReb: 8000, arbF: 26000, arbR: 18000,
    wheelI: 2.6, hard: [[1.05, -0.1, 1.65], [-1.05, -0.1, 1.65], [1.05, -0.1, -1.6], [-1.05, -0.1, -1.6]], torque: T,
    gears: [3.3, 2.15, 1.55, 1.2, 0.95, 0.78], final: 3.9, brakeF: 4600, brakeR: 3200, hand: 9000, maxSteer: 0.55, steerRate: 2.6, steerSpeed: 0.04,
    cdA: 1.6, airPitch: 13000, airRoll: 5500, airYaw: 3800, boostPush: 7400, vmax: 46, split: 0.5, enginePos: [0, 0.5, 1.8] },
  visual: { model: 'truck', scale: [1, 1, 1], wc: 0.64, z: 0.02, wheelScale: 1.22, flame: [0, 1.0, -2.6], color: 0x1fa3a0 },
  mounts: { front: [0, -0.05, 2.6], roof: [0, 1.45, 0.1], rear: [0, 0.35, -1.6] },
  defaultAttachments: [],
};
