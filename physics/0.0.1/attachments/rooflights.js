// Cosmetic roof light bar: alternating amber beacons (no physics effect).
export default {
  id: 'rooflights', name: 'ROOF LIGHTS', blurb: 'Flashing amber beacons. Cosmetic.', mounts: ['roof'],
  mods: { mass: 8 },
  create(vehicle, host) {
    const T = host.THREE, g = new T.Group(), bar = new T.MeshLambertMaterial({ color: 0x2b2f3a });
    const on = new T.MeshBasicMaterial({ color: 0xffb020 }), off = new T.MeshBasicMaterial({ color: 0x6a4a10 });
    const b = new T.Mesh(new T.BoxGeometry(1.3, 0.1, 0.3), bar); b.position.y = 0.05; g.add(b);
    const L = [-0.45, -0.15, 0.15, 0.45].map(x => { const m = new T.Mesh(new T.BoxGeometry(0.24, 0.2, 0.24), off); m.position.set(x, 0.2, 0); g.add(m); return m; });
    host.mount('roof').add(g); let t = 0;
    return {
      object: g, onCollision() {},
      update(dt) { t += dt; const ph = Math.floor(t * 6) % 2; L.forEach((m, i) => m.material = (i % 2) === ph ? on : off); },
      dispose() { g.parent && g.parent.remove(g); b.geometry.dispose(); L.forEach(m => m.geometry.dispose()); [bar, on, off].forEach(m => m.dispose()); },
    };
  },
};
