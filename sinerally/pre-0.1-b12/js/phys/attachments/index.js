// ATTACHMENTS MODULE. Contract (MODULE_API.md):
//   attachment = { id, name, blurb, mounts: ['front'|'roof'|'rear'], mods?: {mass, capacity, cdA, coolMul, topMul, reach}, melts?, create(vehicle, host) -> instance }
//   instance   = { update(dt), onCollision(contact), dispose(), object? }
//   host       = { THREE, state, mount(name) -> Object3D, emit(type, data), damageTree(tree, hp, cause) -> remaining, treeHp(tree), addLogs(n) -> accepted }
// One attachment per mount point. Static `mods` are summed by the host (applyMods) into physics state.mods / state.cargo.
import harvester from './harvester.js';
import bullbar from './bullbar.js';
import lograck from './lograck.js';
import rooflights from './rooflights.js';
const REG = new Map();
export function registerAttachment(a) { for (const k of ['id', 'name', 'mounts', 'create']) if (!a[k]) throw new Error('attachment missing ' + k); REG.set(a.id, a); return a; }
[harvester, bullbar, lograck, rooflights].forEach(registerAttachment);
export const listAttachments = () => [...REG.values()];
export const getAttachment = id => REG.get(id);
// attachments that fit a vehicle def (mount point exists)
export const compatible = vehicle => listAttachments().filter(a => a.mounts.some(m => vehicle.mounts && vehicle.mounts[m]));
// sanitize a selection: known ids, mount available, one attachment per mount
export function validate(vehicle, ids) {
  const used = new Set(), out = [];
  for (const id of ids || []) { const a = REG.get(id); if (!a) continue; const m = a.mounts.find(m => vehicle.mounts[m] && !used.has(m)); if (!m) continue; used.add(m); out.push(id); }
  return out;
}
// sum static mods -> { mass, capacity, cdA, coolMul, topMul, reach }
export function applyMods(ids) {
  const r = { mass: 0, capacity: 0, cdA: 0, coolMul: 1, topMul: 1, reach: 0 };
  for (const id of ids) { const m = (REG.get(id) || {}).mods || {}; r.mass += m.mass || 0; r.capacity += m.capacity || 0; r.cdA += m.cdA || 0; r.coolMul *= m.coolMul || 1;
    r.topMul *= m.topMul || 1; r.reach = Math.max(r.reach, m.reach || 0); }
  return r;
}
// true when a mounted attachment destroys scenery on front contact (harvester): hosts use it for their own colliders (rocks)
export const melts = ids => (ids || []).some(id => (REG.get(id) || {}).melts);
