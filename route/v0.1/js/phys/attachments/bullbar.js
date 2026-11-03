// Front ram / bull bar: front tree impacts do x1.5 tree damage and x0.35 car damage. +45 kg.
export default {
  id: 'bullbar', name: 'BULL BAR', blurb: 'Front hits: 1.5x tree damage, 0.35x car damage.', mounts: ['front'],
  mods: { mass: 45 }, params: { treeMul: 1.5, carMul: 0.35 },
  create(vehicle, host) {
    const T = host.THREE, g = new T.Group(), m = new T.MeshLambertMaterial({ color: 0xd8dde6 });
    const w = vehicle.physics.dims ? vehicle.physics.dims[0] : 2;
    for (const y of [-0.05, 0.35]) { const b = new T.Mesh(new T.BoxGeometry(w * 0.95, 0.12, 0.12), m); b.position.set(0, y, 0.15); g.add(b); }
    for (const x of [-w * 0.3, w * 0.3]) { const b = new T.Mesh(new T.BoxGeometry(0.12, 0.6, 0.12), m); b.position.set(x, 0.15, 0.2); g.add(b); }
    const ram = new T.Mesh(new T.BoxGeometry(w * 0.6, 0.3, 0.12), m); ram.position.set(0, 0.15, 0.3); g.add(ram);
    host.mount('front').add(g); const P = this.params;
    return {
      object: g,
      onCollision(C) { if (C.zone === 'front' && C.mode === 'impact' && C.impact) { C.dmg *= P.treeMul; C.carDamageMul *= P.carMul; } },
      update() {},
      dispose() { g.parent && g.parent.remove(g); g.traverse(o => o.geometry && o.geometry.dispose()); m.dispose(); },
    };
  },
};
