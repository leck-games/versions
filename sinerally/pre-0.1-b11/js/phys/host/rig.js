// Host glue (no DOM): binds physics state + a vehicle def + attachment instances. Used by the test page and the Node tests.
// This is the part the main game copies (see MERGE_NOTES.md).
import * as PH from '../physics/index.js';
import { getVehicle } from '../vehicles/index.js';
import { getAttachment, validate, applyMods } from '../attachments/index.js';
export function createRig({ THREE, world, emit = () => {} }) {
  const rig = { THREE, world, vehicle: null, state: null, attach: [], inst: [], root: new THREE.Group(), mounts: {} };
  const host = {
    THREE, get state() { return rig.state; }, get world() { return world; }, emit: (t, d) => emit(t, d),
    mount: name => rig.mounts[name] || rig.root,
    treeHp: t => PH.treeHp(rig.state, t),
    damageTree: (t, amt, cause) => PH.damageTree(rig.state, world, t, amt, cause),
    addLogs: n => { const c = rig.state.cargo, got = Math.max(0, Math.min(n, c.capacity - c.logs)); c.logs += got; return got; },
  };
  rig.host = host;
  const ext = { onTreeContact: (C, s) => { for (const i of rig.inst) if (i.onCollision) i.onCollision(C, s); } };
  rig.setVehicle = (id, attach) => {
    const keep = rig.state; rig.vehicle = getVehicle(id);
    const s = PH.createState(rig.vehicle.physics); if (keep) PH.setMode(s, keep.mode); else if (rig.mode) PH.setMode(s, rig.mode);
    if (keep) { PH.spawn(s, world, keep.p.x, keep.p.z, PH.yawOf(keep)); } else PH.spawn(s, world, 0, 0, 0);
    rig.state = s;
    for (const k in rig.mounts) rig.root.remove(rig.mounts[k]); rig.mounts = {};
    for (const [k, p] of Object.entries(rig.vehicle.mounts)) { const g = new THREE.Group(); g.name = 'mount:' + k; g.position.set(p[0], p[1], p[2]); rig.root.add(g); rig.mounts[k] = g; }
    rig.setAttachments(attach || rig.vehicle.defaultAttachments || []);
    return rig.vehicle;
  };
  rig.setAttachments = ids => {
    for (const i of rig.inst) i.dispose(); rig.inst = [];
    rig.attach = validate(rig.vehicle, ids); const m = applyMods(rig.attach), s = rig.state;
    s.mods.mass = m.mass; s.mods.cdA = m.cdA; s.mods.coolMul = m.coolMul; s.mods.topMul = m.topMul; s.mods.reach = m.reach; s.cargo.capacity = m.capacity; s.cargo.logs = Math.min(s.cargo.logs, m.capacity);
    for (const id of rig.attach) rig.inst.push(Object.assign(getAttachment(id).create(rig.vehicle, host), { id }));
    return rig.attach;
  };
  rig.step = (inp, dt) => { PH.step(rig.state, inp, dt, world, ext); for (const i of rig.inst) i.update(dt); PH.drainEvents(rig.state, emit); };
  rig.setMode = mode => { rig.mode = PH.setMode(rig.state, mode); return rig.mode; };
  rig.unload = () => { const n = rig.state.cargo.logs; rig.state.cargo.logs = 0; emit('cargo:unload', { logs: n }); return n; };
  return rig;
}
