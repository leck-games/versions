// Tree harvester head (front mount): drive gently (< 25 km/h) into a tree with the head and it saws the tree down,
// removing HP at `rate` per second and adding one log to cargo per HP instead of smashing it.
export default {
  id: 'harvester', name: 'HARVESTER HEAD', blurb: 'Saw trees down gently (<25 km/h). 1 log per HP.', mounts: ['front'],
  mods: { mass: 180, capacity: 3 }, // capacity = logs the head itself can hold
  params: { maxKmh: 25, rate: 1.2 },
  create(vehicle, host) {
    const T = host.THREE, g = new T.Group(), P = this.params;
    const dark = new T.MeshLambertMaterial({ color: 0x2b2f3a }), yel = new T.MeshLambertMaterial({ color: 0xffd23c }), steel = new T.MeshLambertMaterial({ color: 0xc8ccd4 });
    const arm = new T.Mesh(new T.BoxGeometry(0.25, 0.25, 0.9), yel); arm.position.set(0, 0.35, 0.2); arm.rotation.x = 0.5; g.add(arm);
    const head = new T.Mesh(new T.BoxGeometry(1.1, 0.7, 0.45), yel); head.position.set(0, 0.0, 0.65); g.add(head);
    const jaw = new T.Mesh(new T.BoxGeometry(1.3, 0.12, 0.5), dark); jaw.position.set(0, -0.3, 0.85); g.add(jaw);
    const saw = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.05, 14), steel); saw.position.set(0, -0.42, 0.95); g.add(saw);
    const teeth = new T.Mesh(new T.BoxGeometry(0.9, 0.06, 0.06), dark); saw.add(teeth);
    host.mount('front').add(g);
    let target = null, seen = 0, acc = 0, full = false, active = false;
    return {
      object: g,
      get active() { return active; },
      onCollision(C) {
        if (C.zone !== 'front' || C.speedKmh > P.maxKmh) return;
        const s = host.state;
        if (s.cargo.logs >= s.cargo.capacity) { C.mode = 'solid'; if (!full) { full = true; host.emit('harvester:full', { logs: s.cargo.logs }); } return; }
        full = false; C.mode = 'harvest'; if (!target || target.id !== C.id) { target = C.tree; acc = 0; } seen = 0.25;
      },
      update(dt) {
        seen -= dt; active = !!target && seen > 0; saw.rotation.y += dt * (active ? 40 : 2);
        if (!active) { if (seen < -1) target = null; return; }
        const s = host.state; if (s.cargo.logs >= s.cargo.capacity) return;
        const before = host.treeHp(target); if (before <= 0) { target = null; return; }
        const rem = host.damageTree(target, Math.min(before, P.rate * dt), 'harvest');
        acc += before - rem; let logs = Math.floor(acc + 1e-6); if (rem <= 0) logs = Math.round(acc);
        if (logs > 0) { acc -= logs; const got = host.addLogs(logs); host.emit('harvester:log', { id: target.id, logs: got, total: s.cargo.logs }); }
        host.emit('harvester:cut', { id: target.id, remaining: rem });
        if (rem <= 0) { target = null; acc = 0; }
      },
      dispose() { g.parent && g.parent.remove(g); g.traverse(o => o.geometry && o.geometry.dispose()); [dark, yel, steel].forEach(m => m.dispose()); },
    };
  },
};
