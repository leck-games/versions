// Sine Rally — optional in-game ENGINE SOUND EDITOR (☰ → SOUND → ENGINE EDITOR). Parity with the Engine Sim demo tuner:
// presets, layout & firing (order, default order, recompute, per-cylinder fire angles, intervals), cylinders (incl. custom
// bank/tilt + crank position), engine, exhaust & sound (+ light-sync offset), car & gearbox, save/share (+ 6 s WAV render).
// Preview: BENCH (neutral rev test, car paused) or DRIVE (live: drive/fly normally while you tweak; ▾ shrinks the panel).
// Talks to the active sound plugin ONLY through the optional API-v1 extension methods documented in PLUGIN_API.md §1a:
//   descriptor.configSchema, instance.setConfig(patch, {replace}), instance.getConfig(), instance.getVisualState() (optional).
// If the active plugin lacks setConfig/getConfig/configSchema the EDIT toggle is simply not shown.
// Storage (localStorage 'sinerally_sndcfg1'): { v: {[pluginId]: {[vehicleId]: config}}, named: {[name]: config} }
const LS = 'sinerally_sndcfg1';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// optional plugin-specific diagram (drawn read-only from getConfig()/getVisualState(); falls back to the lights strip)
const VIZ = { enginesim: new URL('../plugins/enginesim/viz.js', import.meta.url).href };

export function createSoundEditor({ audio, onOpenChange = () => {}, log = console }) {
  let db = { v: {}, named: {}, vo: {} };
  try { Object.assign(db, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { }
  const persist = () => { try { localStorage.setItem(LS, JSON.stringify(db)); } catch (e) { } };
  let open = false, panel = null, cfg = null, selCyl = 0, saveT = 0, applyT = 0, pending = null, raf = 0, live = false, mini = false, viz = null, vizFor = null;
  const openSec = new Set();
  const inst = () => audio.instance, desc = () => audio.plugin;
  const supported = () => { const i = inst(), d = desc(); return !!(i && d && typeof i.setConfig === 'function' && typeof i.getConfig === 'function' && d.configSchema); };
  const veh = () => audio.telemetry.vehicle || 'buggy';
  const slot = (make) => { const d = desc(); if (!d) return null; const p = db.v[d.id] || (make ? (db.v[d.id] = {}) : null); return p; };
  const saved = () => { const p = slot(false); return p ? p[veh()] : null; };

  // re-apply the saved per-vehicle config whenever the plugin (re)activates or the vehicle changes; a preset pick clears it
  audio.onChange(kind => {
    if (!supported()) { if (open) close(); return; }
    if (kind === 'preset') { const p = slot(false); if (p && p[veh()]) { delete p[veh()]; persist(); } }
    else { const c = saved(); if (c) try { inst().setConfig(c, { replace: true }); } catch (e) { log.warn('[sound-editor] restore failed', e); } }
    applyOffset();
    if (open) { cfg = inst().getConfig(); render(); }
  });

  // ---- ☰ menu row ----
  audio.addMenuExtra((el, row, btn) => {
    if (!supported()) return;
    const r = row('EDITOR · ' + String(veh()).toUpperCase()); r.id = 'sndEditRow';
    const b = btn(r, open ? 'ENGINE EDITOR ◂ CLOSE' : '🎛 OPEN ENGINE EDITOR ▸', open, () => (open ? close() : openPanel())); b.id = 'sndEdit'; b.classList.add('mbig');
    if (saved()) { const tag = document.createElement('span'); tag.textContent = 'CUSTOM'; tag.style.cssText = 'font:bold 11px monospace;color:#c0201a'; r.appendChild(tag);
      btn(r, 'RESET TO PRESET', false, () => resetToPreset()); }
  });

  const eng = () => { const i = inst(); return i && i.engine && typeof i.engine === 'object' ? i.engine : null; }; // plugin-specific extra (Engine Sim)
  function applyOffset() { const e = eng(), d = desc(); if (e && 'visualOffset' in e && d && db.vo && typeof db.vo[d.id] === 'number') e.visualOffset = db.vo[d.id]; }
  function setPreview(l) { live = !!l; if (!live) mini = false; if (open) audio.setTest({ on: !live, rev: false, nitro: false }); if (panel) { panel.classList.toggle('live', live); panel.classList.toggle('mini', mini); } render(); }
  function resetToPreset() {
    const p = slot(false); if (p) { delete p[veh()]; persist(); }
    const d = desc(), i = inst(); if (!i) return;
    const pid = (i.preset) || (d.vehiclePresets || {})[veh()] || d.defaultPreset; if (pid && i.setPreset) i.setPreset(pid);
    cfg = i.getConfig(); audio.rerender(); if (open) render();
  }

  // ---- apply edits live (throttled: each setConfig rebuilds the DSP voice table) ----
  function apply(patch, rerender = false) {
    if (!supported()) return;
    pending = Object.assign(pending || {}, patch);
    const now = performance.now();
    const go = () => { const p = pending; pending = null; applyT = performance.now();
      try { cfg = inst().setConfig(p); } catch (e) { log.warn('[sound-editor] setConfig', e); cfg = inst().getConfig(); }
      clearTimeout(saveT); saveT = setTimeout(storeVehicle, 300); if (rerender) render(); else refreshInfo(); };
    if (rerender || now - applyT > 70) go(); else { clearTimeout(apply.t); apply.t = setTimeout(go, 70); }
  }
  function storeVehicle() { const p = slot(true); if (!p || !cfg) return; p[veh()] = strip(cfg); persist(); audio.rerender(); }
  const strip = c => { const o = JSON.parse(JSON.stringify(c)); delete o.cycle; if (Array.isArray(o.cyl)) o.cyl.forEach(k => { if (!o.manualFire) delete k.fire; if (o.layout !== 'custom') { delete k.angle; delete k.pos; } delete k.bank; }); return o; };

  // ---- panel ----
  function openPanel() {
    if (!supported()) return; audio.unlock && audio.unlock();
    cfg = inst().getConfig(); open = true; selCyl = Math.min(selCyl, (cfg.cylinders || 1) - 1);
    if (!panel) { panel = document.createElement('div'); panel.id = 'sndEd'; panel.setAttribute('data-snd-own', '');
      panel.addEventListener('keydown', e => e.stopPropagation()); panel.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
      document.body.appendChild(panel); }
    live = false; mini = false; panel.classList.remove('live', 'mini'); panel.style.display = 'block'; loadViz(); render(); onOpenChange(true); audio.setTest({ on: true, rev: false, nitro: false });
    cancelAnimationFrame(raf); raf = requestAnimationFrame(drawLights); audio.rerender();
  }
  function close() {
    if (!open) return; open = false; live = mini = false; if (panel) { panel.style.display = 'none'; panel.classList.remove('live', 'mini'); } cancelAnimationFrame(raf);
    audio.setTest({ on: false, rev: false, nitro: false }); onOpenChange(false); audio.rerender();
  }

  const S = () => desc().configSchema;
  function render() {
    if (!panel || !open) return; const sc = S(), c = cfg, n = c.cylinders, rot = c.layout === 'rotary';
    const unit = rot ? 'ROTOR' : 'CYL';
    const opt = (list, cur) => list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(l)}</option>`; }).join('');
    const sl = (k, label, min, max, step, v) => `<label class="se-r"><span>${label}</span><input type="range" data-k="${k}" min="${min}" max="${max}" step="${step}" value="${v}"><b data-v="${k}">${fmt(v, step)}</b></label>`;
    const sel = (k, label, list, cur) => `<label class="se-r"><span>${label}</span><select data-k="${k}">${opt(list, cur)}</select></label>`;
    const sec = (id, title, body) => `<details data-sec="${id}"${openSec.has(id) ? ' open' : ''}><summary>${title}</summary>${body}</details>`;
    const counts = sc.countsFor ? sc.countsFor(c.layout) : Array.from({ length: sc.maxCylinders || 16 }, (_, i) => i + 1);
    const cranks = sc.crankOptions ? sc.crankOptions(c) : [];
    const cy = c.cyl[selCyl] || c.cyl[0] || {};
    const chips = c.cyl.map((k, i) => `<button class="se-chip${i === selCyl ? ' on' : ''}${k.angle > 1 ? ' b1' : k.angle < -1 ? ' b0' : ''}" data-cyl="${i}">${i + 1}</button>`).join('');
    const d = desc(), i0 = inst(), presets = d.presets || [], curP = (i0 && i0.preset) || '';
    const order = c.firingOrder || [], iv = !c.manualFire && sc.firingIntervals ? sc.firingIntervals(c) : null, cyc = c.cycle || (sc.cycleOf ? sc.cycleOf(c) : 720);
    const seg = (k, label, list, cur) => `<div class="se-r se-seg"><span>${label}</span><div>${list.map(([v, l]) => `<button class="sb${String(v) === String(cur) ? ' sel' : ''}" data-seg="${k}" data-val="${esc(v)}">${esc(l)}</button>`).join('')}</div></div>`;
    const e = eng(), vo = e && 'visualOffset' in e ? Math.round(e.visualOffset * 1000) : null, car = c.car || null;
    panel.innerHTML = `
<div class="se-h"><b>ENGINE · ${esc(String(veh()).toUpperCase())}</b><span class="se-hb"><button class="sb" data-act="mini" title="${mini ? 'Expand' : 'Shrink and drive'}">${mini ? '▴' : '▾'}</button><button class="sb" data-act="close">✕</button></span></div>
<canvas class="se-lights${viz ? ' se-viz' : ''}"></canvas>
<div class="se-info" data-info></div>
<div class="se-test">${seg('preview', 'PREVIEW', [['bench', 'BENCH'], ['live', 'DRIVE ▸']], live ? 'live' : 'bench')}</div>
<div class="se-test">${live ? '<small>Drive or fly normally: every edit is live. ▾ shrinks this panel.</small>' : `<button class="sb" data-hold="rev">HOLD: REV</button><button class="sb" data-hold="nitro">HOLD: NITRO</button><small>neutral rev bench · tap a ${viz ? 'cylinder' : 'light'} to edit it</small>`}</div>
${sec('preset', '★ PRESETS', `<label class="se-r"><span>PRESET</span><select data-preset><option value="">— pick a preset —</option>${presets.map(p => `<option value="${esc(p.id)}"${p.id === curP && !saved() ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label><div class="se-note">Current: <b>${esc(c.name || 'Custom')}</b>${saved() ? ' (custom, saved for this vehicle)' : ''}</div>`)}
${sec('layout', '⚙ LAYOUT &amp; FIRING', sel('layout', 'LAYOUT', sc.layouts, c.layout) +
  sel('cylinders', rot ? 'ROTORS' : 'CYLINDERS', counts.map(v => [v, rot ? v + ' rotor' + (v > 1 ? 's' : '') : v]), n) +
  (c.layout === 'v' ? sel('bankAngle', 'BANK ANGLE', sc.bankAngles.map(a => [a, a + '°']), c.bankAngle) : '') +
  (cranks.length > 1 ? sel('crank', 'CRANK', cranks, c.crank) : '') +
  (rot ? '<div class="se-note">Rotary: each rotor fires once per e-shaft rev, phased 360°/n.</div>' : seg('stroke', 'CYCLE', [[4, '4-stroke'], [2, '2-stroke']], c.stroke)) +
  `<label class="se-r"><span>FIRING ORDER</span><input type="text" data-fo value="${esc(order.join('-'))}" spellcheck="false" autocomplete="off" inputmode="numeric"></label>` +
  `<div class="se-row"><button class="sb" data-act="deforder">DEFAULT ORDER</button><button class="sb" data-act="recompute">RECOMPUTE ANGLES</button></div>` +
  `<div class="se-note" data-fo-msg></div><div class="se-mono" data-fire>${order.map(k => `#${k}@${Math.round((c.cyl[k - 1] || {}).fire || 0)}°`).join('  ')}<br>${iv ? 'Intervals: ' + iv.map(x => Math.round(x)).join(' / ') : '(manual fire angles)'} · cycle ${cyc}°</div>`)}
${sec('cyl', '🔥 ' + unit + 'S', `<div class="se-chips">${chips}</div>
  <div class="se-sub">EDITING ${unit} #${selCyl + 1}${typeof cy.fire === 'number' ? ' · fires @ ' + Math.round(cy.fire) + '°' : ''}</div>` +
  sl('c.vol', 'VOLUME', 0, 2, 0.01, cy.vol) + sl('c.tone', 'PITCH Hz', 40, 400, 1, cy.tone) + sel('c.shape', 'PULSE', sc.shapes, cy.shape) +
  sl('c.runner', 'RUNNER cm', 10, 250, 1, cy.runner) + sl('c.misfire', 'MISFIRE', 0, 0.5, 0.005, cy.misfire) + sl('c.rough', 'ROUGHNESS', 0, 1, 0.01, cy.rough) +
  sl('c.fire', `FIRE ° (/${cyc})`, 0, cyc - 1, 1, Math.round(cy.fire || 0)) +
  (c.layout === 'custom' ? sl('c.angle', 'BANK / TILT °', -90, 90, 1, cy.angle || 0) + sl('c.pos', 'CRANK POS', 0, 15, 0.5, cy.pos || 0) : '') +
  `<div class="se-row"><button class="sb" data-act="cylall">APPLY TO ALL</button><button class="sb" data-act="nomis">CLEAR MISFIRES</button></div>`)}
${sec('eng', '🛠 ENGINE', sl('displacement', 'DISPLACE L', 0.1, 8.5, 0.05, c.displacement) + sl('idleRpm', 'IDLE rpm', 400, 2500, 10, c.idleRpm) +
  sl('redline', 'REDLINE rpm', 2500, 20000, 100, c.redline) + sel('limiter', 'LIMITER', sc.limiters, c.limiter) + sl('inertia', 'FLYWHEEL', 0.03, 1, 0.01, c.inertia) +
  sel('induction', 'INDUCTION', sc.induction, c.induction) + sl('pops', 'AFTERFIRE', 0, 1, 0.01, c.pops))}
${sec('exh', '🔊 EXHAUST &amp; SOUND', sl('master', 'MASTER', 0, 1.6, 0.01, c.master) + sl('exhaustVol', 'EXHAUST', 0, 2, 0.01, c.exhaustVol) +
  sl('mufflerTone', 'MUFFLER', 0, 1, 0.01, c.mufflerTone) + sl('runnerReso', 'RESONANCE', -0.9, 0.9, 0.01, c.runnerReso) +
  seg('exhaust', 'EXHAUST', [['single', 'Single'], ['dual', 'Dual (per bank)']], c.exhaust) + sl('crossover', 'X-PIPE', 0, 1, 0.01, c.crossover) +
  sl('intakeVol', 'INTAKE', 0, 1.5, 0.01, c.intakeVol) + sl('mechVol', 'VALVETRAIN', 0, 1.5, 0.01, c.mechVol) + sl('inductionVol', 'TURBO/BLOWER', 0, 1.5, 0.01, c.inductionVol) +
  (vo !== null ? sl('visualOffset', 'LIGHT SYNC ms', -150, 250, 1, vo) + '<div class="se-note">Lights already compensate output latency; Bluetooth headphones may need +100…200 ms.</div>' : ''))}
${car ? sec('car', '🚗 CAR &amp; GEARBOX', sl('car.mass', 'CAR MASS kg', 150, 3000, 10, car.mass) + sl('car.final', 'FINAL DRIVE', 2, 12, 0.05, car.final) +
  `<div class="se-note">Gears: ${(car.gears || []).join(' / ')}. Used by the WAV render and the standalone demo; in-game the rpm comes from the game's own drivetrain. BENCH = the demo's “Neutral rev”, DRIVE = “Drive”.</div>`) : ''}
${sec('save', '💾 SAVE / SHARE', `<div class="se-row"><input type="text" data-name placeholder="name" maxlength="24"><button class="sb" data-act="save">SAVE AS</button></div>
  <div class="se-row">${Object.keys(db.named).map(k => `<span class="se-named"><button class="sb" data-load="${esc(k)}">${esc(k)}</button><button class="sb" data-del="${esc(k)}">✕</button></span>`).join('') || '<small>no saved sounds yet</small>'}</div>
  <div class="se-row"><button class="sb" data-act="export">EXPORT JSON</button><button class="sb" data-act="import">IMPORT</button>${e && e.constructor && e.constructor.renderOffline ? '<button class="sb" data-act="wav">RENDER 6 s WAV</button>' : ''}<button class="sb" data-act="reset">RESET TO PRESET</button></div>
  <textarea data-json rows="3" placeholder="paste a config JSON (game or demo export), then IMPORT" spellcheck="false"></textarea>`)}`;
    wire(); refreshInfo();
  }
  const fmt = (v, step) => step >= 1 ? Math.round(v) : (+v).toFixed(step < 0.01 ? 3 : step < 0.1 ? 2 : 1);
  function refreshInfo() { const el = panel && panel.querySelector('[data-info]'); if (!el || !cfg) return;
    el.textContent = `${(cfg.name || 'custom')} · ${cfg.layout} ${cfg.cylinders}${cfg.layout === 'rotary' ? ' rotor' : ''} · ${(+cfg.displacement).toFixed(1)} L · redline ${cfg.redline}`; }

  function wire() {
    panel.querySelectorAll('details').forEach(d => d.addEventListener('toggle', () => { d.open ? openSec.add(d.dataset.sec) : openSec.delete(d.dataset.sec); }));
    panel.querySelectorAll('[data-k]').forEach(inp => {
      const k = inp.dataset.k, isRange = inp.type === 'range';
      const handler = () => {
        let v = inp.value; if (isRange || /^(cylinders|bankAngle|stroke)$/.test(k)) v = +v;
        if (isRange) { const b = panel.querySelector(`[data-v="${k}"]`); if (b) b.textContent = fmt(v, +inp.step); }
        if (k === 'visualOffset') { const e = eng(), d = desc(); if (e) e.visualOffset = v / 1000; db.vo = db.vo || {}; db.vo[d.id] = v / 1000; persist(); return; }
        if (k.startsWith('car.')) return apply({ car: Object.assign({}, cfg.car, { [k.slice(4)]: v }) }, !isRange);
        if (k.startsWith('c.')) { const f = k.slice(2), cyl = cfg.cyl.map(o => ({ ...o })); cyl[selCyl][f] = v; const p = { cyl }; if (f === 'fire') p.manualFire = true; return apply(p, !isRange); }
        const patch = { [k]: v };
        if (k === 'layout' || k === 'cylinders' || k === 'crank' || k === 'bankAngle' || k === 'stroke') { patch.firingOrder = null; patch.manualFire = false; }
        if (k === 'cylinders') selCyl = Math.min(selCyl, v - 1);
        apply(patch, !isRange);
      };
      inp.addEventListener(isRange ? 'input' : 'change', handler);
    });
    panel.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => { const k = b.dataset.seg, raw = b.dataset.val, v = /^-?\d+(\.\d+)?$/.test(raw) ? +raw : raw;
      if (k === 'preview') return setPreview(v === 'live');
      const p = { [k]: v }; if (k === 'stroke') p.manualFire = false; apply(p, true); });
    const ps = panel.querySelector('[data-preset]'); if (ps) ps.addEventListener('change', () => { if (!ps.value) return; selCyl = 0; audio.setPreset(ps.value); cfg = inst().getConfig(); openSec.add('preset'); render(); });
    const fo = panel.querySelector('[data-fo]');
    if (fo) fo.addEventListener('change', () => { const sc = S(), arr = sc.parseFiringOrder ? sc.parseFiringOrder(fo.value, cfg.cylinders) : null;
      const m = panel.querySelector('[data-fo-msg]'); if (!arr) { if (m) m.textContent = `invalid: use each of 1–${cfg.cylinders} once, e.g. ${(sc.defaultFiringOrder ? sc.defaultFiringOrder(cfg) : []).join('-')}`; m && (m.style.color = '#c0201a'); return; }
      apply({ firingOrder: arr, manualFire: false }, true); });
    panel.querySelectorAll('[data-cyl]').forEach(b => b.onclick = () => { selCyl = +b.dataset.cyl; openSec.add('cyl'); render(); });
    panel.querySelectorAll('[data-hold]').forEach(b => { const k = b.dataset.hold;
      const dn = e => { e.preventDefault(); audio.unlock && audio.unlock(); audio.setTest({ on: true, [k]: true }); b.classList.add('sel'); };
      const up = () => { audio.setTest({ [k]: false }); b.classList.remove('sel'); };
      b.addEventListener('pointerdown', dn); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up); });
    const cv = panel.querySelector('.se-lights');
    if (viz) { viz.cv = cv; viz.g = cv.getContext('2d'); // EngineViz hit-test: tap a cylinder in the diagram to edit it
      cv.addEventListener('pointerdown', e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        for (let k = viz.hits.length - 1; k >= 0; k--) { const h = viz.hits[k]; if (Math.hypot(x - h.x, y - h.y) < h.r) { selCyl = h.i; openSec.add('cyl'); render(); break; } } }); }
    else cv.addEventListener('click', e => { const r = cv.getBoundingClientRect(), n = cfg.cylinders, i = clamp(Math.floor((e.clientX - r.left) / r.width * n), 0, n - 1); selCyl = i; openSec.add('cyl'); render(); });
    panel.querySelectorAll('[data-act]').forEach(b => b.onclick = () => act(b.dataset.act));
    panel.querySelectorAll('[data-load]').forEach(b => b.onclick = () => loadCfg(db.named[b.dataset.load]));
    panel.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { delete db.named[b.dataset.del]; persist(); render(); });
  }
  function loadCfg(c) { if (!c || !supported()) return false; try { cfg = inst().setConfig(c, { replace: true }); } catch (e) { log.warn(e); return false; } selCyl = 0; storeVehicle(); render(); return true; }
  function act(a) {
    const ta = panel.querySelector('[data-json]');
    if (a === 'close') return close();
    if (a === 'mini') { mini = !mini; if (mini && !live) return setPreview(true); panel.classList.toggle('mini', mini); return render(); }
    if (a === 'deforder') { const sc = S(); return apply({ firingOrder: sc.defaultFiringOrder ? sc.defaultFiringOrder(cfg) : null, manualFire: false }, true); }
    if (a === 'recompute') return apply({ manualFire: false }, true);
    if (a === 'nomis') return apply({ cyl: cfg.cyl.map(o => ({ ...o, misfire: 0 })) }, true);
    if (a === 'wav') return renderWav(panel.querySelector('[data-act=wav]'));
    if (a === 'cylall') { const src = cfg.cyl[selCyl]; return apply({ cyl: cfg.cyl.map(o => ({ ...o, vol: src.vol, tone: src.tone, shape: src.shape, runner: src.runner, misfire: src.misfire, rough: src.rough })) }, true); }
    if (a === 'save') { const nm = (panel.querySelector('[data-name]').value || '').trim().slice(0, 24) || ('sound ' + (Object.keys(db.named).length + 1)); db.named[nm] = strip(cfg); persist(); openSec.add('save'); return render(); }
    if (a === 'export') { ta.value = JSON.stringify(strip(cfg), null, 1); /* raw config: pastes straight into the Engine Sim demo too */ ta.select(); try { navigator.clipboard && navigator.clipboard.writeText(ta.value).catch(() => {}); } catch (e) { } return; }
    if (a === 'import') { try { const o = JSON.parse(ta.value); const c = o && o.config ? o.config : o; if (!c || typeof c !== 'object' || !c.layout) throw new Error('no config'); loadCfg(c); } catch (e) { ta.value = 'invalid JSON: ' + e.message; } return; }
    if (a === 'reset') return resetToPreset();
  }

  function loadViz() { const d = desc(), url = d && VIZ[d.id]; if (!url || vizFor === url) return; vizFor = url;
    import(url).then(m => { if (!m.EngineViz) return; const tmp = document.createElement('canvas'); viz = new m.EngineViz(tmp); if (open) render(); }).catch(e => { log.warn('[sound-editor] diagram unavailable', e); }); }
  function renderWav(btn) { const e = eng(), E = e && e.constructor; if (!E || !E.renderOffline || !E.encodeWav) return; if (btn) btn.textContent = 'RENDERING…';
    setTimeout(() => { try { const r = E.renderOffline({ config: inst().getConfig(), seconds: 6, drive: t => ({ gas: t > 0.6 && t < 4.6 ? 1 : 0, nitro: t > 3 && t < 4.2 }) });
      const blob = new Blob([E.encodeWav(r.left, r.right, r.sampleRate)], { type: 'audio/wav' }), a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (cfg.name || 'engine').replace(/\W+/g, '_') + '.wav'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); lastWav = blob.size; } catch (err) { log.warn('[sound-editor] wav', err); }
      if (btn) btn.textContent = 'RENDER 6 s WAV'; }, 30); }
  let lastWav = 0;
  // ---- firing-lights strip (one light per cylinder / rotor; red = misfire or cut) ----
  function drawLights() {
    if (!open) return; raf = requestAnimationFrame(drawLights);
    const cv = panel.querySelector('.se-lights'); if (!cv || !cfg) return;
    const vs0 = inst() && inst().getVisualState ? inst().getVisualState() : null;
    if (viz && vs0 && !mini) { try { const T = audio.telemetry; viz.selected = selCyl; viz.resize(); const g = viz.g; g.setTransform(viz.dpr, 0, 0, viz.dpr, 0, 0); g.clearRect(0, 0, viz.W, viz.H);
      viz.drawDiagram(Object.assign({}, cfg, { name: cfg.name || 'Custom', firingOrder: cfg.firingOrder || [] }), vs0, { nitro: !!T.nitro, limiter: !!T.limiter, rpm: vs0.rpm, gear: T.gear, speedKmh: (T.speed || 0) * 3.6, shifting: !!T.shifting, shiftFlash: 0, nitroTank: 1 }, { x: 2, y: 2, w: viz.W - 4, h: viz.H - 4 }); return; } catch (e) { viz = null; render(); return; } }
    const w = cv.clientWidth | 0; if (w && cv.width !== w * 2) { cv.width = w * 2; cv.height = 68; }
    const g = cv.getContext('2d'), W = cv.width, H = cv.height, n = cfg.cylinders, i0 = inst();
    const vs = vs0, nitro = audio.telemetry.nitro;
    g.fillStyle = '#1b130c'; g.fillRect(0, 0, W, H);
    const cw = W / n, r = Math.min(cw * 0.36, H * 0.36);
    for (let i = 0; i < n; i++) {
      const age = vs ? vs.now - vs.lastFire[i] : 9, kind = vs ? vs.lastKind[i] : 0, I = Math.exp(-Math.max(0, age) / 0.045);
      const x = cw * (i + 0.5), y = H / 2;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = I > 0.12 ? (kind === 1 ? '#ff2d2d' : nitro ? '#bffcff' : `rgba(255,${200 + (I * 50) | 0},${(60 + I * 120) | 0},1)`) : '#3a2a1a'; g.fill();
      g.lineWidth = i === selCyl ? 5 : 2; g.strokeStyle = i === selCyl ? '#fff' : '#000'; g.stroke();
      if (cw > 22) { g.fillStyle = I > 0.12 ? '#000' : '#bba'; g.font = `bold ${Math.min(20, r)}px monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x, y + 1); }
    }
  }

  return {
    get open() { return open; }, rerender() { if (open && inst()) { cfg = inst().getConfig(); render(); } }, get live() { return live; }, get benching() { return open && !live; }, get mini() { return mini; }, setPreview, get lastWav() { return lastWav; }, get hasViz() { return !!viz; }, supported, openPanel, close, toggle: () => (open ? close() : openPanel()),
    get config() { return cfg; }, apply: (p, r = true) => apply(p, r), load: loadCfg, get db() { return db; },
    setSelected(i) { selCyl = i; render(); }, openSection(id) { openSec.add(id); render(); },
  };
}
