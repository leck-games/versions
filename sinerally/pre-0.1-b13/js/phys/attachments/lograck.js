// Log rack / cargo rack (rear mount): +12 log capacity. Each log weighs cargo.logMass (60 kg) -> heavier car (physics massOf()).
export default {
  id: 'lograck', name: 'LOG RACK', blurb: 'Carries 12 logs. Every log adds 60 kg.', mounts: ['rear'],
  mods: { mass: 90, capacity: 12 },
  create(vehicle, host) {
    const T = host.THREE, g = new T.Group(), frame = new T.MeshLambertMaterial({ color: 0x2b2f3a }), wood = new T.MeshLambertMaterial({ color: 0x9a6a3c });
    const w = Math.min(2.2, (vehicle.physics.dims || [2])[0] * 0.95), L = 2.2;
    const base = new T.Mesh(new T.BoxGeometry(w, 0.1, L), frame); base.position.set(0, 0.5, -L / 2 + 0.6); g.add(base);
    for (const x of [-w / 2, w / 2]) for (const z of [0.4, -L + 0.8]) { const p = new T.Mesh(new T.BoxGeometry(0.08, 0.9, 0.08), frame); p.position.set(x, 0.95, z); g.add(p); }
    const logGeo = new T.CylinderGeometry(0.17, 0.17, L * 0.95, 7); logGeo.rotateX(Math.PI / 2);
    const logs = new T.InstancedMesh(logGeo, wood, 15); logs.count = 0; g.add(logs);
    const M = new T.Matrix4(); let shown = -1;
    host.mount('rear').add(g);
    return {
      object: g,
      onCollision() {},
      update() {
        const n = Math.min(15, host.state.cargo.logs); if (n === shown) return; shown = n;
        for (let i = 0; i < n; i++) { const row = Math.floor(i / 5), col = i % 5; M.makeTranslation((col - 2) * w / 5.2 + (row % 2) * 0.08, 0.72 + row * 0.3, -L / 2 + 0.6); logs.setMatrixAt(i, M); }
        logs.count = n; logs.instanceMatrix.needsUpdate = true;
      },
      dispose() { g.parent && g.parent.remove(g); base.geometry.dispose(); logGeo.dispose(); logs.dispose(); frame.dispose(); wood.dispose(); },
    };
  },
};
