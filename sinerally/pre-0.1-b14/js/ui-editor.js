// SineRally UI — touch HUD layout editor (☰ → CONTROLS → EDIT HUD LAYOUT, key U).
// Every HUD element gets a handle: drag (touch/mouse) to move, pinch / +/- / wheel to resize (0.5–2.5×), per-element
// opacity + hide, 8 px grid + safe-area edge snapping, global opacity/scale, mirror (left-handed), presets, 3 save slots,
// JSON export/import. Positions are stored against viewport anchors (left/centre/right × top/middle/bottom, inside the
// safe area) so a layout survives rotation and size changes. Elements that were never moved keep their CSS position.
export const LAYOUT_VERSION = 2; // v2 (redesign): the top bar + UI/ARC corner buttons became one ☰ ⚙ corner group; v1 layouts are migrated
const KEY = 'srui_layout', SLOT = n => 'srui_slot_' + n;
// [id, label, kind] kind: 'm' movable, 's' sub-button of the top bar (hide/opacity only); flags: e = essential (never hidden)
export const ELEMENTS = [
  ['spdgrp', 'SPEEDO', 'm'], ['race', 'RACE', 'm'], ['mini', 'MINIMAP', 'm'], ['cans', 'FUEL', 'm'], ['wp', 'WAYPOINT', 'm'], ['compass', 'COMPASS', 'm'],
  ['corner', '☰ ⚙ MENU + QUICK', 'm', 'e'],
  ['dbg', 'DEBUG', 'm'], ['gauge', 'GAUGE+TEMP', 'm'], ['joy', 'JOYSTICK', 'm'], ['bBst', 'BOOST', 'm'], ['bDrf', 'DRIFT', 'm'],
  ['bGas', 'GAS', 'm'], ['bBrk', 'BRAKE', 'm'], ['bUnl', 'UNLOAD', 'm'],
  ['pAtt', '✈ FLIGHT HUD', 'm'], ['pThr', '✈ THROTTLE', 'm'], ['pRud', '✈ RUDDER', 'm']]; // plane HUD (shown in plane mode; always editable here)
const META = Object.fromEntries(ELEMENTS.map(([id, label, kind, f]) => [id, { id, label, kind, ess: f === 'e', flex: id === 'corner' || /^(b(Gas|Brk|Bst|Drf)|pRud)$/.test(id) }]));
const NOTX = new Set(['gauge', 'wp', 'race', 'compass']); // their CSS centres them with translateX(-50%): dropped once they are placed explicitly
const clamp = (v, a, b) => Math.max(a, Math.min(b, v)), r1 = v => Math.round(v * 100) / 100;
const blank = () => ({ v: LAYOUT_VERSION, g: { o: 1, s: 1 }, snap: true, flip: false, el: {} });
export const PRESETS = {
  default: () => blank(),
  lefty: null, // computed: default layout mirrored (needs the live default positions)
  clean: () => ({ v: LAYOUT_VERSION, g: { o: 0.9, s: 1 }, snap: true, flip: false, el: {
    dbg: { h: 1 }, cans: { h: 1 }, wp: { o: 0.8 },
    mini: { s: 0.8, o: 0.85 }, gauge: { s: 0.85, o: 0.85 }, race: { o: 0.8 }, corner: { o: 0.6 },
    joy: { o: 0.55 }, bGas: { o: 0.55 }, bBrk: { o: 0.55 }, bBst: { o: 0.55 }, bDrf: { o: 0.55 }, pThr: { o: 0.6 }, pRud: { o: 0.55 }, pAtt: { s: 0.9, o: 0.85 } } })
};
// v1 → v2: element ids that no longer exist (topbtns + its sub-buttons, tUi, tHand) are dropped, everything else is kept as is
const V1_GONE = ['topbtns', 'tMenu', 'tReset', 'tQ', 'tTilt', 'tDbg', 'tSnd', 'tUi', 'tHand'];
export function migrate(raw) { if (raw && raw.v === 1) { const el = Object.assign({}, raw.el); for (const k of V1_GONE) delete el[k]; return Object.assign({}, raw, { v: 2, el }); } return raw; }
// sanitise anything that came from storage / import into a valid layout (old versions migrated, unknown ids and junk dropped, numbers clamped)
export function normalize(raw) {
  if (typeof raw === 'string') raw = JSON.parse(raw);
  if (!raw || typeof raw !== 'object') throw new Error('not a layout');
  raw = migrate(raw);
  if (raw.v !== LAYOUT_VERSION) throw new Error('unsupported layout version ' + raw.v);
  const L = blank(), num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
  if (raw.g) { L.g.o = clamp(num(raw.g.o, 1), 0.1, 1); L.g.s = clamp(num(raw.g.s, 1), 0.5, 2); }
  L.snap = raw.snap !== false; L.flip = !!raw.flip;
  for (const [id, e] of Object.entries(raw.el || {})) {
    const m = META[id]; if (!m || !e || typeof e !== 'object') continue; const o = {};
    if (m.kind === 'm' && Array.isArray(e.x) && Array.isArray(e.y) && /^[lcr]$/.test(e.x[0]) && /^[tmb]$/.test(e.y[0])) {
      o.x = [e.x[0], r1(num(e.x[1], 0))]; o.y = [e.y[0], r1(num(e.y[1], 0))]; o.w0 = r1(num(e.w0, 40)); o.h0 = r1(num(e.h0, 30)); }
    if (m.kind === 'm' && e.s !== undefined) o.s = r1(clamp(num(e.s, 1), 0.5, 2.5));
    if (e.o !== undefined) o.o = r1(clamp(num(e.o, 1), 0.1, 1));
    if (e.h && !m.ess) o.h = 1;
    if (Object.keys(o).length) L.el[id] = o;
  }
  return L;
}
export function createUiEditor({ onOpenChange = () => { }, onUiRestore = () => { }, onNotice = () => { } } = {}) {
  const $ = id => document.getElementById(id), node = id => $(id);
  let L = blank(), open = false, sel = 'joy', panel = null, layer = null, collapsed = false, saved = {};
  try { const s = localStorage.getItem(KEY); if (s) L = normalize(s); } catch (e) { console.warn('ui layout ignored:', e.message); L = blank(); }
  // safe-area insets via a probe element (env() is only readable through CSS)
  const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  function anchors() { const cs = getComputedStyle(probe), W = innerWidth, H = innerHeight;
    const sl = parseFloat(cs.paddingLeft) || 0, sr = parseFloat(cs.paddingRight) || 0, st = parseFloat(cs.paddingTop) || 0, sb = parseFloat(cs.paddingBottom) || 0;
    return { W, H, l: sl, c: W / 2, r: W - sr, t: st, m: H / 2, b: H - sb }; }
  const ent = id => L.el[id] || (L.el[id] = {});
  const scaleOf = id => META[id].kind === 'm' ? clamp((L.el[id] && L.el[id].s) || 1, 0.5, 2.5) * L.g.s : 1;
  // place one element: CSS left/top so its *visual* (scaled about its centre) box sits at the stored anchor offsets
  function place(id) {
    const m = META[id], el = node(id); if (!el) return; const e = L.el[id] || {};
    el.classList.add('uie'); el.classList.toggle('uie-sub', m.kind === 's'); el.classList.toggle('uie-f', m.flex);
    el.style.setProperty('--uo', e.o !== undefined ? e.o : 1);
    el.classList.toggle('uie-h', !!e.h && !m.ess);
    if (m.kind !== 'm') return;
    const S = scaleOf(id); el.style.scale = S === 1 ? '' : String(S); el.style.transformOrigin = S === 1 && !e.x ? '' : '50% 50%';
    if (!e.x) { for (const k of ['position', 'left', 'top', 'right', 'bottom', 'margin']) el.style[k] = ''; if (NOTX.has(id)) el.style.transform = ''; return; }
    const W0 = el.offsetWidth || e.w0 || 40, H0 = el.offsetHeight || e.h0 || 30; if (el.offsetWidth) { e.w0 = W0; e.h0 = H0; }
    const A = anchors(), vw = W0 * S, vh = H0 * S;
    const vx = e.x[0] === 'l' ? A.l + e.x[1] : e.x[0] === 'r' ? A.r + e.x[1] - vw : A.c + e.x[1] - vw / 2;
    const vy = e.y[0] === 't' ? A.t + e.y[1] : e.y[0] === 'b' ? A.b + e.y[1] - vh : A.m + e.y[1] - vh / 2;
    Object.assign(el.style, { position: 'fixed', right: 'auto', bottom: 'auto', margin: '0', left: (vx - W0 * (1 - S) / 2).toFixed(1) + 'px', top: (vy - H0 * (1 - S) / 2).toFixed(1) + 'px' });
    if (NOTX.has(id)) el.style.transform = 'none';
  }
  function applyAll() { document.documentElement.style.setProperty('--ugo', L.g.o); for (const [id] of ELEMENTS) place(id); if (open) drawHandles(); }
  // visual box -> anchored entry (anchor = the third of the screen the box centre is in; offset of the matching edge)
  function setBox(id, vx, vy, vw, vh) {
    const A = anchors(), e = ent(id), cx = vx + vw / 2, cy = vy + vh / 2, el = node(id);
    e.x = cx < A.W / 3 ? ['l', r1(vx - A.l)] : cx > A.W * 2 / 3 ? ['r', r1(vx + vw - A.r)] : ['c', r1(cx - A.c)];
    e.y = cy < A.H / 3 ? ['t', r1(vy - A.t)] : cy > A.H * 2 / 3 ? ['b', r1(vy + vh - A.b)] : ['m', r1(cy - A.m)];
    if (el && el.offsetWidth) { e.w0 = el.offsetWidth; e.h0 = el.offsetHeight; }
    place(id);
  }
  function snapBox(vx, vy, vw, vh) {
    if (!L.snap) return [vx, vy]; const A = anchors(), E = 10, g = v => Math.round(v / 8) * 8;
    let x = A.l + g(vx - A.l), y = A.t + g(vy - A.t);
    if (Math.abs(vx - A.l) < E) x = A.l; else if (Math.abs(vx + vw - A.r) < E) x = A.r - vw; else if (Math.abs(vx + vw / 2 - A.c) < 6) x = A.c - vw / 2;
    if (Math.abs(vy - A.t) < E) y = A.t; else if (Math.abs(vy + vh - A.b) < E) y = A.b - vh;
    return [x, y];
  }
  const rectOf = id => node(id).getBoundingClientRect();
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (e) { } }
  function setLayout(nl, save = true) { L = normalize(JSON.parse(JSON.stringify(nl))); applyAll(); if (save) persist(); if (open) render(); }
  // mirror: every movable element's box flipped around the vertical centre line (anchors l<->r); the ⚙ tray opens towards the screen centre on its own
  function mirror(save = true) {
    const boxes = {};
    for (const [id, , kind] of ELEMENTS) { if (kind !== 'm') continue; const e = L.el[id];
      if (e && e.x) boxes[id] = { x: [{ l: 'r', r: 'l', c: 'c' }[e.x[0]], -e.x[1]] };
      else { const r = rectOf(id); if (!r.width && !r.height) continue; const A = anchors(); boxes[id] = { box: [A.W - r.right, r.top, r.width, r.height] }; } }
    for (const [id, b] of Object.entries(boxes)) { if (b.x) { ent(id).x = b.x; place(id); } else setBox(id, ...b.box); }
    L.flip = !L.flip; applyAll(); if (save) persist(); if (open) render();
  }
  function preset(name) {
    if (name === 'lefty') { const keep = { ...L, el: {} }; setLayout(blank(), false); const was = open; if (!was) forceShow(true); mirror(false); if (!was) forceShow(false); persist(); if (open) render(); return L; }
    setLayout(PRESETS[name](), true); return L;
  }
  const forceShow = on => { document.body.classList.toggle('uied', on); };
  // ---------- edit mode ----------
  const PH = { dbg: 'FPS · DEBUG' }; // placeholder text for elements that are empty while driving
  function openEd() {
    if (open) return; open = true; onOpenChange(true);
    document.body.classList.remove('ui-min', 'ui-none'); forceShow(true);
    saved = {}; for (const [id, t] of Object.entries(PH)) { const el = node(id); if (el && !el.textContent) { saved[id] = el.textContent; el.textContent = t; } }
    applyAll(); build(); layer.style.display = panel.style.display = 'block'; render(); drawHandles();
  }
  function closeEd() {
    if (!open) return; open = false; persist(); layer.style.display = panel.style.display = 'none';
    for (const [id, t] of Object.entries(saved)) node(id).textContent = t; forceShow(false); onUiRestore(); applyAll(); onOpenChange(false);
  }
  function build() {
    if (layer) return;
    layer = document.createElement('div'); layer.id = 'uiedL'; document.body.appendChild(layer);
    panel = document.createElement('div'); panel.id = 'uiedP'; document.body.appendChild(panel);
    // ---- drag / pinch on handles (touch) ----
    let drag = null, pinch = null;
    const startDrag = (id, px, py, tid) => { sel = id; const r = rectOf(id); drag = { id, tid, px, py, vx: r.left, vy: r.top, vw: r.width, vh: r.height, moved: false }; render(); drawHandles(); };
    const moveDrag = (px, py) => { if (!drag) return; const dx = px - drag.px, dy = py - drag.py; if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true; if (!drag.moved) return;
      const [x, y] = snapBox(drag.vx + dx, drag.vy + dy, drag.vw, drag.vh); setBox(drag.id, x, y, drag.vw, drag.vh); drawHandles(); };
    const endDrag = () => { if (drag) { if (drag.moved) persist(); drag = null; render(); } };
    const dist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    layer.addEventListener('touchstart', e => { e.preventDefault();
      if (e.touches.length >= 2 && META[sel].kind === 'm') { drag = null; pinch = { d0: dist(e.touches[0], e.touches[1]) || 1, s0: (L.el[sel] && L.el[sel].s) || 1 }; return; }
      const t = e.changedTouches[0], h = t.target.closest && t.target.closest('.uih'); if (h) { if (META[h.dataset.id].kind === 'm') startDrag(h.dataset.id, t.clientX, t.clientY, t.identifier); else { sel = h.dataset.id; render(); drawHandles(); } } }, { passive: false });
    // move/end listen on document: drawHandles() rebuilds handle nodes, and touches keep targeting the detached node
    document.addEventListener('touchmove', e => { if (!open || !(drag || pinch)) return; e.preventDefault();
      if (pinch && e.touches.length >= 2) { setScale(sel, pinch.s0 * dist(e.touches[0], e.touches[1]) / pinch.d0, false); return; }
      if (drag) for (const t of e.changedTouches) if (t.identifier === drag.tid) moveDrag(t.clientX, t.clientY); }, { passive: false });
    const tend = e => { if (pinch && e.touches.length < 2) { pinch = null; persist(); render(); } if (drag && [...e.changedTouches].some(t => t.identifier === drag.tid)) endDrag(); };
    document.addEventListener('touchend', tend); document.addEventListener('touchcancel', tend);
    // ---- mouse ----
    layer.addEventListener('mousedown', e => { const h = e.target.closest('.uih'); if (!h) return; e.preventDefault(); if (META[h.dataset.id].kind === 'm') startDrag(h.dataset.id, e.clientX, e.clientY, 'mouse'); else { sel = h.dataset.id; render(); drawHandles(); } });
    addEventListener('mousemove', e => { if (drag && drag.tid === 'mouse') moveDrag(e.clientX, e.clientY); });
    addEventListener('mouseup', () => { if (drag && drag.tid === 'mouse') endDrag(); });
    layer.addEventListener('wheel', e => { const h = e.target.closest('.uih'); if (!h || META[h.dataset.id].kind !== 'm') return; e.preventDefault(); sel = h.dataset.id; setScale(sel, ((L.el[sel] && L.el[sel].s) || 1) * (e.deltaY < 0 ? 1.08 : 1 / 1.08)); }, { passive: false });
    // ---- panel: drag by its header, collapse ----
    let pd = null;
    const pStart = (x, y, t) => { if (!t.closest('.ue-h') || t.closest('button')) return false; const r = panel.getBoundingClientRect(); pd = { x, y, l: r.left, t: r.top }; return true; };
    const pMove = (x, y) => { if (!pd) return; Object.assign(panel.style, { left: clamp(pd.l + x - pd.x, 0, innerWidth - 60) + 'px', top: clamp(pd.t + y - pd.y, 0, innerHeight - 30) + 'px', transform: 'none' }); };
    panel.addEventListener('touchstart', e => { const t = e.changedTouches[0]; if (pStart(t.clientX, t.clientY, e.target)) e.preventDefault(); }, { passive: false });
    panel.addEventListener('touchmove', e => { if (pd) { const t = e.changedTouches[0]; pMove(t.clientX, t.clientY); e.preventDefault(); } }, { passive: false });
    panel.addEventListener('touchend', () => { pd = null; });
    panel.addEventListener('mousedown', e => { pStart(e.clientX, e.clientY, e.target); });
    addEventListener('mousemove', e => pMove(e.clientX, e.clientY)); addEventListener('mouseup', () => { pd = null; });
    panel.addEventListener('click', onClick); panel.addEventListener('input', onInput);
    addEventListener('keydown', e => { if (!open || /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '')) return; const st = e.shiftKey ? 8 : 1;
      const d = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] }[e.code];
      if (d && META[sel].kind === 'm') { const r = rectOf(sel); setBox(sel, r.left + d[0], r.top + d[1], r.width, r.height); persist(); drawHandles(); e.preventDefault(); e.stopImmediatePropagation(); }
      if (e.code === 'Equal' || e.code === 'NumpadAdd') step(sel, 0.1); if (e.code === 'Minus' || e.code === 'NumpadSubtract') step(sel, -0.1); }, true);
  }
  function setScale(id, s, save = true) { if (META[id].kind !== 'm') return; const e = ent(id), r = rectOf(id), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    e.s = r1(clamp(s, 0.5, 2.5)); place(id); if (e.x) { const r2 = rectOf(id); setBox(id, cx - r2.width / 2, cy - r2.height / 2, r2.width, r2.height); }
    if (save) persist(); drawHandles(); renderSel(); }
  const step = (id, d) => setScale(id, ((L.el[id] && L.el[id].s) || 1) + d);
  // handle nodes are reused (keyed by id), never rebuilt: a touch keeps targeting the node it started on,
  // and touchmove/touchend from a detached node would never reach the editor.
  const hNodes = {}; let safeN = null;
  function drawHandles() {
    if (!layer) return; const A = anchors();
    if (!safeN) { safeN = document.createElement('div'); safeN.className = 'ue-safe'; layer.appendChild(safeN); }
    Object.assign(safeN.style, { left: A.l + 'px', top: A.t + 'px', width: (A.r - A.l) + 'px', height: (A.b - A.t) + 'px' });
    const list = ELEMENTS.map(([id]) => ({ id, r: rectOf(id) })).filter(o => o.r.width || o.r.height).sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height);
    const seen = new Set();
    list.forEach(({ id, r }, z) => { const m = META[id], e = L.el[id] || {}, w = Math.max(28, r.width), hh = Math.max(24, r.height); seen.add(id);
      let n = hNodes[id]; if (!n) { n = hNodes[id] = document.createElement('div'); n.dataset.id = id; n.appendChild(document.createElement('i')); layer.appendChild(n); }
      n.className = `uih${id === sel ? ' sel' : ''}${m.kind === 's' ? ' sub' : ''}${e.h ? ' hid' : ''}`;
      Object.assign(n.style, { display: '', zIndex: 1 + z, left: (r.left + r.width / 2 - w / 2).toFixed(1) + 'px', top: (r.top + r.height / 2 - hh / 2).toFixed(1) + 'px', width: w.toFixed(1) + 'px', height: hh.toFixed(1) + 'px' });
      const t = m.label + (e.h ? ' (hidden)' : ''); if (n.firstChild.textContent !== t) n.firstChild.textContent = t; });
    for (const id in hNodes) if (!seen.has(id)) hNodes[id].style.display = 'none';
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function slotInfo(n) { try { const s = JSON.parse(localStorage.getItem(SLOT(n))); return s && s.t ? new Date(s.t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; } catch (e) { return ''; } }
  function render() {
    if (!panel || !open) return; panel.classList.toggle('col', collapsed);
    panel.innerHTML = `<div class="ue-h"><b>✥ EDIT UI</b><span class="ue-hint">drag · pinch · game paused</span><button class="sb" data-a="col">${collapsed ? '▸' : '▾'}</button><button class="sb ue-done" data-a="done">✓ DONE</button></div>
<div class="ue-body"><div class="ue-sel" id="ueSel"></div>
<div class="ue-chips">${ELEMENTS.map(([id, label]) => `<button class="ue-chip${id === sel ? ' on' : ''}${L.el[id] && L.el[id].h ? ' off' : ''}" data-sel="${id}">${label}</button>`).join('')}</div>
<div class="ue-row"><span>ALL</span>opacity<input type="range" min="0.1" max="1" step="0.05" value="${L.g.o}" data-g="o"><b>${Math.round(L.g.o * 100)}%</b>scale<input type="range" min="0.5" max="2" step="0.05" value="${L.g.s}" data-g="s"><b>${Math.round(L.g.s * 100)}%</b><button class="sb${L.snap ? ' sel' : ''}" data-a="snap">SNAP ${L.snap ? 'ON' : 'OFF'}</button></div>
<div class="ue-row"><span>PRESET</span><button class="sb" data-p="default">DEFAULT</button><button class="sb" data-p="lefty">LEFT-HANDED</button><button class="sb" data-p="clean">CLEAN</button><button class="sb" data-a="mirror">⇋ MIRROR</button><button class="sb" data-a="reset">⟲ RESET</button></div>
<div class="ue-row"><span>SLOTS</span>${[1, 2, 3].map(n => `<i class="ue-slot"><b>${n}</b><button class="sb" data-save="${n}">SAVE</button><button class="sb" data-load="${n}"${slotInfo(n) ? '' : ' disabled'}>LOAD</button><small>${esc(slotInfo(n) || 'empty')}</small></i>`).join('')}</div>
<div class="ue-row"><span>JSON</span><button class="sb" data-a="export">EXPORT</button><button class="sb" data-a="import">IMPORT</button><small id="ueMsg"></small></div>
<textarea id="ueJson" rows="2" spellcheck="false" placeholder="layout JSON: EXPORT copies it here (+ clipboard); paste one and tap IMPORT"></textarea></div>`;
    renderSel();
  }
  function renderSel() {
    const s = panel && panel.querySelector('#ueSel'); if (!s) return; const m = META[sel], e = L.el[sel] || {}, o = e.o !== undefined ? e.o : 1;
    s.innerHTML = `<b class="ue-name">${m.label}</b>` + (m.kind === 'm' ? `<button class="sb" data-a="minus">−</button><b class="ue-pct">${Math.round(((e.s) || 1) * 100)}%</b><button class="sb" data-a="plus">+</button>` : '<small>moves with its group</small>')
      + `opacity<input type="range" min="0.1" max="1" step="0.05" value="${o}" data-o="1"><b>${Math.round(o * 100)}%</b>`
      + (m.ess ? '<small>always shown</small>' : `<button class="sb${e.h ? ' sel' : ''}" data-a="hide">${e.h ? '◌ SHOW' : '◉ HIDE'}</button>`)
      + (e.x ? '<button class="sb" data-a="unpos">⌂ DEFAULT POS</button>' : '');
  }
  function note(t) { const m = panel && panel.querySelector('#ueMsg'); if (m) m.textContent = t; onNotice(t); }
  function onInput(ev) { const t = ev.target;
    if (t.dataset.g) { L.g[t.dataset.g] = +t.value; t.nextElementSibling.textContent = Math.round(t.value * 100) + '%'; applyAll(); persist(); }
    if (t.dataset.o) { ent(sel).o = +t.value; t.nextElementSibling.textContent = Math.round(t.value * 100) + '%'; place(sel); persist(); } }
  function onClick(ev) {
    const b = ev.target.closest('button'); if (!b) return; const a = b.dataset.a;
    if (b.dataset.sel) { sel = b.dataset.sel; render(); drawHandles(); return; }
    if (b.dataset.p) { preset(b.dataset.p); note('preset ' + b.textContent); drawHandles(); return; }
    if (b.dataset.save) { try { localStorage.setItem(SLOT(b.dataset.save), JSON.stringify({ t: Date.now(), layout: L })); } catch (e) { } render(); note('saved to slot ' + b.dataset.save); return; }
    if (b.dataset.load) { loadSlot(+b.dataset.load); note('slot ' + b.dataset.load + ' loaded'); return; }
    if (a === 'done') return closeEd();
    if (a === 'col') { collapsed = !collapsed; return render(); }
    if (a === 'snap') { L.snap = !L.snap; persist(); return render(); }
    if (a === 'mirror') { mirror(); drawHandles(); return note('mirrored'); }
    if (a === 'reset') { setLayout(blank()); drawHandles(); return note('reset to default'); }
    if (a === 'plus' || a === 'minus') return step(sel, a === 'plus' ? 0.1 : -0.1);
    if (a === 'hide') { const e = ent(sel); e.h = e.h ? 0 : 1; if (!e.h) delete e.h; place(sel); persist(); render(); return drawHandles(); }
    if (a === 'unpos') { const e = ent(sel); delete e.x; delete e.y; place(sel); persist(); render(); return drawHandles(); }
    if (a === 'export') { const s = exportJson(), ta = panel.querySelector('#ueJson'); ta.value = s; ta.select();
      let copied = false; try { copied = document.execCommand && document.execCommand('copy'); } catch (e) { }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(s).then(() => note('copied to clipboard'), () => note(copied ? 'copied' : 'select + copy the text'));
      else note(copied ? 'copied' : 'select + copy the text'); return; }
    if (a === 'import') { const s = panel.querySelector('#ueJson').value.trim(); try { importJson(s); drawHandles(); note('imported'); } catch (e) { note('import failed: ' + e.message); } }
  }
  function loadSlot(n) { const s = JSON.parse(localStorage.getItem(SLOT(n)) || 'null'); if (!s || !s.layout) return false; setLayout(s.layout); drawHandles(); return true; }
  const exportJson = () => JSON.stringify(L);
  function importJson(s) { setLayout(normalize(s)); return L; }
  // keep placed elements put when their content (text) changes size, and on rotation / resize
  let lastSz = {};
  setInterval(() => { for (const [id, e] of Object.entries(L.el)) { if (!e.x) continue; const el = node(id); if (!el) continue; const k = el.offsetWidth + 'x' + el.offsetHeight; if (lastSz[id] !== k) { lastSz[id] = k; if (el.offsetWidth) place(id); } } }, 500);
  let rz = 0; const onResize = () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { applyAll(); setTimeout(applyAll, 300); }); };
  addEventListener('resize', onResize); addEventListener('orientationchange', onResize);
  applyAll();
  return { get open() { return open; }, openEd, close: closeEd, toggle: () => (open ? closeEd() : openEd()), get layout() { return JSON.parse(JSON.stringify(L)); },
    setLayout, preset, mirror, reset: () => setLayout(blank()), exportJson, importJson, loadSlot,
    saveSlot: n => localStorage.setItem(SLOT(n), JSON.stringify({ t: Date.now(), layout: L })), select: id => { sel = id; render(); drawHandles(); }, applyAll, anchors, setScale, get selected() { return sel; } };
}
