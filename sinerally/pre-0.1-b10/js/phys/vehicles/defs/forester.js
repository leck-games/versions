// TIMBERWOLF: forestry/utility truck. Slow, very heavy, low gearing, three mount points; ships with harvester + log rack.
export default {
  id: 'forester', name: 'TIMBERWOLF', blurb: 'Forestry truck. Mount the harvester head and log rack.', sound: 'diesel-forester',
  stats: { top: 146, accel: 1, grip: 5, weight: 5 },
  physics: { vtop: 40.42, vtopBoost: 1.211, arcade: { vtop: 41.48, yawMax: 1.2, yawK: 4, inRate: 4.5, latG: 1.0, align: 1.5, driftAngle: 0.45, driftTurn: 0.7, antiRoll: 4, driftMin: 9 }, mass: 3200, dims: [2.4, 2.4, 5.8], inertiaScale: 1.3, wheelR: 0.62, rest: 0.75, k: 105000, cBump: 8200, cReb: 11000, arbF: 36000, arbR: 30000,
    wheelI: 4.0, hard: [[1.12, -0.25, 1.85], [-1.12, -0.25, 1.85], [1.12, -0.25, -1.75], [-1.12, -0.25, -1.75]],
    torque: [[0, 900], [800, 1150], [1400, 1500], [2200, 1550], [3200, 1350], [4000, 1050], [4600, 800]], idle: 700, redline: 4200,
    gears: [4.4, 2.9, 2.0, 1.45, 1.1], final: 4.8, up: 3700, down: 1700, shiftT: 0.3, split: 0.5,
    brakeF: 7000, brakeR: 5200, hand: 12000, maxSteer: 0.6, steerSpeed: 0.05, steerRate: 2.4, lonB: 10, latB: 9,
    cdA: 2.2, boostPush: 9000, airPitch: 16000, airRoll: 8000, airYaw: 5000, vmax: 32, enginePos: [0, 0.6, 2.2], heat: { gen: 4.6 } },
  visual: { model: 'forester', scale: [1, 1, 1], wc: 0.66, z: 0, wheelScale: 1.12, flame: [0.95, 3.0, 1.6], color: 0x3f8f3a },
  mounts: { front: [0, -0.25, 3.0], roof: [0, 2.0, 0.8], rear: [0, 0.3, -1.6] },
  defaultAttachments: ['harvester', 'lograck'],
};
