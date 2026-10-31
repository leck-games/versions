// Minimal host event bus (the main game's SR.on/emit equivalent).
export function createBus() {
  const L = new Map();
  return {
    on(type, fn) { if (!L.has(type)) L.set(type, new Set()); L.get(type).add(fn); return () => L.get(type).delete(fn); },
    emit(type, data) { for (const k of [type, '*']) { const s = L.get(k); if (s) for (const f of s) f(data, type); } },
  };
}
