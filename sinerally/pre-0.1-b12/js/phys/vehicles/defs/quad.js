const T = [[0, 300], [1000, 330], [2000, 420], [3500, 540], [5000, 520], [6500, 430], [7200, 330]].map(([r, v]) => [r, v * 0.66]);
export default {
  id: 'quad', name: 'QUAD', blurb: 'Light and twitchy ATV. Bounces off trees.', sound: 'single-quad',
  stats: { top: 207, accel: 4, grip: 2, weight: 1 },
  physics: { vtop: 57.62, vtopBoost: 1.169, arcade: { vtop: 57.85, yawMax: 2.6, yawK: 10, inRate: 10, latG: 1.4, align: 2.6, driftAngle: 0.7, driftTurn: 1.15 }, mass: 820, dims: [1.6, 1.3, 3.0], wheelR: 0.4, rest: 0.5, k: 30000, cBump: 2200, cReb: 3100, arbF: 8000, arbR: 5000,
    wheelI: 0.9, hard: [[0.78, -0.08, 1.08], [-0.78, -0.08, 1.08], [0.78, -0.08, -1.02], [-0.78, -0.08, -1.02]], torque: T,
    idle: 1100, redline: 8500, up: 7400, down: 3600, torqueRpm: 1.2, gears: [3.1, 2.1, 1.55, 1.2, 0.98], final: 3.4, brakeF: 1800, brakeR: 1200, hand: 3400,
    maxSteer: 0.68, steerRate: 4.2, steerSpeed: 0.03, cdA: 0.75, airPitch: 5200, airRoll: 2100, airYaw: 1500, boostPush: 3000, vmax: 52, split: 0.4, enginePos: [0, 0.2, 0] },
  visual: { model: 'quad', scale: [1, 1, 1], wc: 0.49, z: 0.03, wheelScale: 1.22, flame: [0, 0.85, -1.75], color: 0xe8303a },
  mounts: { front: [0, -0.05, 1.6], rear: [0, 0.35, -1.45] },
  defaultAttachments: [],
};
