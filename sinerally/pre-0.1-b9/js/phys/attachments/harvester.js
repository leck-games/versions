// Tree harvester head (front mount): melts anything in its path at any speed. Every tree / bush / cactus the head (or the
// car's front) touches loses all its HP at once and is gone — no speed loss, no car damage, no push-out — and drops logs into
// cargo at 1 log per HP (capped by capacity; when full the head still cuts, it just stops collecting and emits harvester:full).
// Penalty: mods.topMul 0.9 -> physics caps top speed at 90 % of the same vehicle without the head (see MODULE_API.md).
// Hosts with their own colliders (rocks etc.) check `melts` on the attachment def to destroy them on front contact too.
export default {
  id: 'harvester', name: 'HARVESTER HEAD', blurb: 'Melts trees, bushes & rocks in its path instantly, any speed. 1 log per HP. -10% top speed.', mounts: ['front'],
  mods: { mass: 180, capacity: 3, topMul: 0.9, reach: 0.9 }, // capacity = logs the head itself can hold; reach = cutter beyond the bumper (m)
  melts: true,
  params: { spin: 40 },
  create(vehicle, host) {
    const T = host.THREE, g = new T.Group(), P = this.params;
    const dark = new T.MeshLambertMaterial({ color: 0x2b2f3a }), yel = new T.MeshLambertMaterial({ color: 0xffd23c }), steel = new T.MeshLambertMaterial({ color: 0xc8ccd4 });
    const arm = new T.Mesh(new T.BoxGeometry(0.25, 0.25, 0.9), yel); arm.position.set(0, 0.35, 0.2); arm.rotation.x = 0.5; g.add(arm);
    const head = new T.Mesh(new T.BoxGeometry(1.1, 0.7, 0.45), yel); head.position.set(0, 0.0, 0.65); g.add(head);
    const jaw = new T.Mesh(new T.BoxGeometry(1.3, 0.12, 0.5), dark); jaw.position.set(0, -0.3, 0.85); g.add(jaw);
    const saw = new T.Mesh(new T.CylinderGeometry(0.42, 0.42, 0.05, 14), steel); saw.position.set(0, -0.42, 0.95); g.add(saw);
    const teeth = new T.Mesh(new T.BoxGeometry(0.9, 0.06, 0.06), dark); saw.add(teeth);
    host.mount('front').add(g);
    let full = false, activeT = 0;
    return {
      object: g,
      get active() { return activeT > 0; },
      onCollision(C) {
        if (C.zone !== 'front') return;
        C.mode = 'melt'; activeT = 0.4; const s = host.state, hp = Math.round(C.hp);
        if (s.cargo.logs >= s.cargo.capacity) { if (!full) { full = true; host.emit('harvester:full', { logs: s.cargo.logs }); } }
        else { full = false; const got = host.addLogs(hp); if (got > 0) host.emit('harvester:log', { id: C.id, logs: got, total: s.cargo.logs }); }
        host.emit('harvester:cut', { id: C.id, remaining: 0, speed: C.speedKmh });
      },
      update(dt) { activeT -= dt; saw.rotation.y += dt * (activeT > 0 ? P.spin : P.spin * 0.25); },
      dispose() { g.parent && g.parent.remove(g); g.traverse(o => o.geometry && o.geometry.dispose()); [dark, yel, steel].forEach(m => m.dispose()); },
    };
  },
};
