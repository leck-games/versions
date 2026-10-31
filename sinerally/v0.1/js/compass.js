// SineRally UI — FUEL-style heading compass (top HUD strip). The strip spans the camera's horizontal field of view:
// N/E/S/W letters + degree ticks scroll with the camera heading, and world markers (race starts, airfields, waypoint,
// next checkpoint, vistas, fuel cans) show with an icon + distance ONLY while they are inside the view angle; they fade
// out towards the strip edges and are hidden outside it. Pinned markers (next checkpoint, waypoint) are always drawn as a
// highlighted badge and stick to the strip edge with ◀/▶ when they are outside the view, so you never lose them. Map convention: north = +z, east = -x (matches the world map).
const D2R = Math.PI / 180, wrap = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
export const bearing = (dx, dz) => Math.atan2(-dx, dz); // 0 = N, +90° = E
const PRI = { wp: 0, cp: 1, race: 2, air: 3, vista: 4, fuel: 5 };
function icon(c, kind, x, y, s, extra) {
  c.lineWidth = 2; c.strokeStyle = '#111'; c.lineJoin = 'round';
  if (kind === 'race') { c.fillStyle = '#ff8a1a'; c.fillRect(x - 6, y - 7, 2, 14); c.strokeRect(x - 6, y - 7, 2, 14);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) { c.fillStyle = (i + j) % 2 ? '#111' : '#fff'; c.fillRect(x - 4 + i * 2.5, y - 7 + j * 2.5, 2.5, 2.5); } c.strokeRect(x - 4, y - 7, 10, 7.5); }
  else if (kind === 'air') { c.fillStyle = '#7fd0ff'; c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x + 1.6, y - 2); c.lineTo(x + 7, y + 1); c.lineTo(x + 7, y + 3); c.lineTo(x + 1.6, y + 1.5); c.lineTo(x + 1.2, y + 5); c.lineTo(x + 3.5, y + 7);
    c.lineTo(x - 3.5, y + 7); c.lineTo(x - 1.2, y + 5); c.lineTo(x - 1.6, y + 1.5); c.lineTo(x - 7, y + 3); c.lineTo(x - 7, y + 1); c.lineTo(x - 1.6, y - 2); c.closePath(); c.fill(); c.stroke(); }
  else if (kind === 'wp') { c.fillStyle = '#e8453c'; c.beginPath(); c.arc(x, y - 2.5, 5, Math.PI * 0.85, Math.PI * 2.15); c.lineTo(x, y + 7); c.closePath(); c.fill(); c.stroke(); c.fillStyle = '#fff'; c.beginPath(); c.arc(x, y - 2.5, 1.8, 0, 7); c.fill(); }
  else if (kind === 'fuel') { c.fillStyle = '#ffd23c'; c.fillRect(x - 5, y - 4, 10, 11); c.strokeRect(x - 5, y - 4, 10, 11); c.fillRect(x - 1, y - 7, 5, 3); c.strokeRect(x - 1, y - 7, 5, 3); }
  else if (kind === 'vista') { c.fillStyle = extra ? '#8ee08a' : '#fff'; c.beginPath(); c.moveTo(x - 8, y + 6); c.lineTo(x - 2, y - 6); c.lineTo(x + 1, y - 1); c.lineTo(x + 3, y - 4); c.lineTo(x + 8, y + 6); c.closePath(); c.fill(); c.stroke(); }
  else if (kind === 'cp') { c.fillStyle = '#ffcf2a'; c.fillRect(x - 7, y - 7, 14, 4); c.strokeRect(x - 7, y - 7, 14, 4); c.fillStyle = '#333'; c.fillRect(x - 7, y - 3, 2, 10); c.fillRect(x + 5, y - 3, 2, 10); c.strokeRect(x - 7, y - 3, 2, 10); c.strokeRect(x + 5, y - 3, 2, 10); }
}
const fmtD = d => d >= 1000 ? (d / 1000).toFixed(d >= 10000 ? 0 : 1) + 'km' : Math.round(d) + 'm';
export function createCompass(cv) {
  const c = cv.getContext('2d'); let W = 0, H = 0, dpr = 1;
  const state = { heading: 0, hfov: 0, shown: [], hidden: 0, total: 0 };
  function size() { const r = cv.getBoundingClientRect(); const w = Math.round(cv.clientWidth || r.width), h = Math.round(cv.clientHeight || r.height); dpr = Math.min(2, devicePixelRatio || 1);
    if (w && h && (w !== W || h !== H || cv.width !== Math.round(w * dpr))) { W = w; H = h; cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); } }
  // camera: THREE camera (world matrix up to date); markers: [{ kind, x, z, id?, label?, found? }]; px/pz: player position for distances
  function update(camera, px, pz, markers) {
    if (!cv.offsetWidth) { state.shown = []; state.inView = []; state.off = true; return state; } state.off = false;
    size(); if (!W) return state;
    const e = camera.matrixWorld.elements, fx = -e[8], fz = -e[10]; // camera forward (−Z column)
    const hd = bearing(fx, fz), hfov = 2 * Math.atan(Math.tan(camera.fov * D2R / 2) * camera.aspect), half = hfov / 2, k = W / hfov;
    state.heading = (hd / D2R + 360) % 360; state.hfov = hfov / D2R;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const sh = 20; // tick strip height
    c.fillStyle = 'rgba(17,17,17,.55)'; c.beginPath(); c.roundRect ? c.roundRect(0, 1, W, sh, 6) : c.rect(0, 1, W, sh); c.fill();
    c.textAlign = 'center'; c.textBaseline = 'middle';
    const step = 5; const a0 = Math.floor((state.heading - state.hfov / 2) / step) * step;
    for (let a = a0; a <= state.heading + state.hfov / 2 + step; a += step) {
      const x = W / 2 + wrap((a - state.heading) * D2R) * k, n = ((a % 360) + 360) % 360; if (x < -10 || x > W + 10) continue;
      const card = n % 90 === 0, inter = n % 45 === 0;
      if (card || inter) { const L = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][n / 45]; c.font = card ? '900 13px "Arial Black",system-ui' : '800 10px system-ui';
        c.lineWidth = 3; c.strokeStyle = '#111'; c.strokeText(L, x, 11.5); c.fillStyle = n === 0 ? '#ff6a1a' : card ? '#fff' : '#ffe9a8'; c.fillText(L, x, 11.5); }
      else { c.strokeStyle = 'rgba(255,248,224,.85)'; c.lineWidth = n % 15 === 0 ? 2 : 1; const h = n % 15 === 0 ? 7 : 4; c.beginPath(); c.moveTo(x, sh + 1 - h); c.lineTo(x, sh + 1); c.stroke(); }
    }
    c.fillStyle = '#ffd23c'; c.strokeStyle = '#111'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(W / 2 - 5, sh + 1); c.lineTo(W / 2 + 5, sh + 1); c.lineTo(W / 2, sh - 5); c.closePath(); c.fill(); c.stroke();
    // markers: in-view only (soft fade over the outer 25 % of the half-angle), nearest/most important first, no overlaps
    const list = [], pins = []; let hidden = 0;
    for (const m of markers) { const dx = m.x - px, dz = m.z - pz, d = Math.hypot(dx, dz); const rel = d < 1 ? 0 : wrap(bearing(dx, dz) - hd);
      const vis = Math.abs(rel) < half;
      if (m.pin) { const edge = vis && Math.abs(rel) < half * 0.76 ? null : rel < 0 ? 'L' : 'R', x = edge ? (edge === 'L' ? W * 0.14 : W * 0.86) : W / 2 + rel * k;
        pins.push({ kind: m.kind, id: m.id, label: m.label, d, rel: rel / D2R, x, edge, alpha: 1 }); continue; }
      if (!vis) { hidden++; continue; }
      const t = Math.abs(rel) / half, alpha = t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25);
      list.push({ kind: m.kind, id: m.id, label: m.label, found: m.found, d, rel: rel / D2R, x: W / 2 + rel * k, alpha }); }
    list.sort((a, b) => PRI[a.kind] - PRI[b.kind] || a.d - b.d);
    const placed = [], texts = [];
    // pinned (next checkpoint, waypoint): highlighted badge 'CP3 · 240m', clamped to the edge with ◀/▶ when outside the view
    pins.sort((a, b) => (b.kind === 'cp') - (a.kind === 'cp')); const y0 = sh + 11, spans = []; // the next checkpoint always wins its spot during a race
    c.font = '900 10px system-ui';
    for (const m of pins) { // lay out first so the badge owns its whole width: other markers under it are hidden
      m.txt = (m.edge === 'L' ? '◀ ' : '') + (m.label ? m.label + ' · ' : '') + fmtD(m.d) + (m.edge === 'R' ? ' ▶' : ''); m.tw = c.measureText(m.txt).width + 16;
      if (m.edge) m.x = m.edge === 'L' ? Math.max(W * 0.13 + m.tw / 2, m.x) : Math.min(W * 0.87 - m.tw / 2, m.x);
      const free = x => x - m.tw / 2 >= W * 0.1 && x + m.tw / 2 <= W * 0.9 && !spans.some(([a, b]) => x + m.tw / 2 + 4 > a && x - m.tw / 2 - 4 < b);
      const hit = spans.find(([a, b]) => m.x + m.tw / 2 + 4 > a && m.x - m.tw / 2 - 4 < b);
      if (hit) { const r = hit[1] + m.tw / 2 + 4, l = hit[0] - m.tw / 2 - 4, pr = m.x >= (hit[0] + hit[1]) / 2; // slide next to the badge it would cover (preferred side first)
        m.x = pr ? (free(r) ? r : l) : (free(l) ? l : r); }
      if (!free(m.x)) { m.alpha = 0; continue; }
      spans.push([m.x - m.tw / 2 - 8, m.x + m.tw / 2 + 8]); }
    const under = x => spans.some(([a, b]) => x > a - 6 && x < b + 6);
    for (const m of list) { if (under(m.x) || placed.some(p => Math.abs(p.x - m.x) < 15)) { m.alpha = 0; continue; } placed.push(m);
      c.globalAlpha = m.alpha; const y = sh + 11; icon(c, m.kind, m.x, y, 1, m.found);
      if (texts.some(tx => Math.abs(tx - m.x) < 30) || spans.some(([a, b]) => m.x + 18 > a && m.x - 18 < b)) continue; texts.push(m.x); // distance labels never overlap: the nearer/higher-priority one wins
      c.font = '800 9.5px system-ui'; c.lineWidth = 2.5; c.strokeStyle = '#111'; c.strokeText(fmtD(m.d), m.x, y + 13); c.fillStyle = '#fff'; c.fillText(fmtD(m.d), m.x, y + 13); }
    c.globalAlpha = 1; c.font = '900 10px system-ui';
    for (const m of pins) { if (!m.alpha) continue; // drawn last = always on top; one row: [icon CP2 · 141m] fits the 44px strip
      const bw = m.tw + 8, bh = 16, bx = m.x - bw / 2, by = sh + 4;
      c.fillStyle = m.kind === 'cp' ? '#ffd23c' : '#e8453c'; c.strokeStyle = '#111'; c.lineWidth = 1.5; c.beginPath(); c.roundRect ? c.roundRect(bx, by, bw, bh, 8) : c.rect(bx, by, bw, bh); c.fill(); c.stroke();
      c.save(); c.translate(bx + 11, by + bh / 2 + 1); c.scale(0.62, 0.62); icon(c, m.kind, 0, 0, 1); c.restore();
      c.font = '900 10px system-ui'; c.fillStyle = m.kind === 'cp' ? '#111' : '#fff'; c.fillText(m.txt, m.x + 8, by + bh / 2 + 0.5); }
    c.globalAlpha = 1;
    state.shown = list.filter(m => m.alpha > 0).map(m => ({ kind: m.kind, id: m.id, rel: +m.rel.toFixed(1), d: Math.round(m.d), alpha: +m.alpha.toFixed(2) }));
    state.inView = list.map(m => ({ kind: m.kind, id: m.id, rel: +m.rel.toFixed(1) }));
    state.pins = pins.map(m => ({ kind: m.kind, id: m.id, label: m.label, rel: +m.rel.toFixed(1), d: Math.round(m.d), edge: m.edge, x: Math.round(m.x), shown: m.alpha > 0 }));
    state.hidden = hidden; state.total = markers.length; return state;
  }
  return { update, state };
}
