// Vehicle definition = plain data. physics: fields of physics/DEFAULTS (missing fields fall back to the defaults = this buggy).
export default {
  id: 'buggy', name: 'BUGGY', blurb: 'Rear-engined 4x4 rally buggy. All-rounder.', sound: 'v6-buggy',
  stats: { top: 195, accel: 3, grip: 3, weight: 2 },
  physics: { mass: 1500, vmax: 50, enginePos: [0, 0.3, -1.3] },
  visual: { model: 'buggy', scale: [0.85, 0.9, 0.97], wc: 0.68, z: 0.02, wheelScale: 1.22, flame: [0, 1.2, -2.5], color: 0xff6a1a },
  mounts: { front: [0, -0.15, 2.25], roof: [0, 1.05, -0.35], rear: [0, 0.15, -2.15] },
  defaultAttachments: [],
};
