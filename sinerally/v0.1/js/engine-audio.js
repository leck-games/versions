// engine-audio.js — Sine Rally's host for Engine Sound Plugins (API v1, see PLUGIN_API.md).
// The host owns the AudioContext (iOS unlock on a user gesture), the master gain / mute / pause duck and a safety
// limiter, and turns the game's read-only window.SR telemetry + events into the plugin telemetry contract.
// Plugins are loaded only by URL (dynamic import); this file imports nothing from any plugin and plugins import
// nothing from the game. Any plugin failure falls back to the default plugin, and failing that, to silence.
export const HOST_API_VERSION = 1;
export const BUILTIN = [
  { id: 'enginesim', label: 'ENGINE SIM', url: new URL('../plugins/enginesim/plugin.js', import.meta.url).href },
  { id: 'example-simple', label: 'SIMPLE (EXAMPLE)', url: new URL('../plugins/example-simple-engine.js', import.meta.url).href },
];
const DEFAULT_ID = 'enginesim', LS = 'sinerally_snd1', LS_FILE = 'sinerally_snd1_file', MAX_FILE = 256 * 1024;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out after ' + ms / 1000 + ' s')), ms))]);

export function createEngineAudio({ sr, log = console } = {}) {
  let st = { plugin: DEFAULT_ID, url: '', fileName: '', presets: {}, volume: 0.7, muted: false };
  try { Object.assign(st, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { }
  const save = () => { try { localStorage.setItem(LS, JSON.stringify(st)); } catch (e) { } };
  let ctx = null, master = null, limiter = null, bus = null, desc = null, inst = null, active = null, token = 0;
  let status = 'Tap anywhere to enable sound.', error = '', loading = false, menuEl = null, errCount = 0, paused = false;
  const stats = { updates: 0, events: 0, updMs: 0, loads: 0, fallbacks: 0 };
  const queue = []; // game events are queued and delivered after the telemetry for that frame is built
  const T = { time: 0, rpm: 0, idleRpm: 900, redlineRpm: 7000, rpmNorm: 0, throttle: 0, brake: 0, load: 0, nitro: false, nitroStrength: 0,
    nitroTank: 1, gear: 1, gearCount: 6, shifting: false, limiter: false, ignition: 1, speed: 0, fwdSpeed: 0, speedKmh: 0,
    grounded: 4, airborne: false, airTime: 0, surface: 'dirt', slip: 0, vehicle: 'buggy', vehiclePreset: undefined, engineTemp: undefined, paused: false };
  const prev = { thr: 0, gear: 1, nitro: false, limiter: false, vehicle: null, bfT: 0, upT: 0 };

  // ---------- game events -> plugin events ----------
  const on = (type, fn) => sr && sr.on(type, fn);
  on('shift', d => queue.push(['shift', { dir: d.value }]));
  on('land', d => queue.push(['land', { impact: d.value, airTime: d.extra || 0 }]));
  on('crash', d => queue.push(['crash', { impact: d.value }]));
  on('scrape', d => queue.push(['scrape', { impact: d.value }]));
  on('recover', () => queue.push(['recover', {}]));

  // ---------- AudioContext (host-owned) ----------
  function unlock() { // call synchronously inside a user gesture
    try {
      // iOS: route Web Audio as media playback (plays with the silent switch on). Must be set inside the gesture, BEFORE the context exists.
      try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { }
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) { status = 'No WebAudio in this browser.'; return; }
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); }
        limiter = ctx.createDynamicsCompressor(); // safety limiter so a loud third-party plugin can't blast the speakers
        limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
        master = ctx.createGain(); master.gain.value = 0; master.connect(limiter); limiter.connect(ctx.destination);
        applyGain(true);
      }
      if (ctx.state !== 'running') ctx.resume().catch(() => { });
      const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0);
      if (!active && !loading && st.plugin !== 'off') activate(st.plugin);
    } catch (e) { log.warn('[audio] unlock failed', e); }
  }
  const gesture = (e) => { if (e.target && e.target.closest && e.target.closest('[data-snd-own]')) return; if (!ctx || ctx.state !== 'running') unlock(); };
  for (const ev of ['touchend', 'pointerup', 'click', 'keydown', 'pointerdown', 'touchstart']) addEventListener(ev, gesture, { capture: true, passive: true });
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => { }); else ctx.resume().catch(() => { }); });
  function applyGain(now) {
    if (!master) return;
    const g = st.muted || paused ? 0 : st.volume;
    if (now) master.gain.value = g; else master.gain.setTargetAtTime(g, ctx.currentTime, 0.05);
  }

  // ---------- loading / validation / fallback ----------
  const TEXT_PLAIN_HOSTS = /^https:\/\/(raw|gist)\.githubusercontent\.com\//; // serve text/plain: go straight to Blob
  async function blobImport(url) {
    const r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    const bl = URL.createObjectURL(new Blob([await r.text()], { type: 'text/javascript' }));
    try { return await import(bl); } finally { URL.revokeObjectURL(bl); }
  }
  async function importModule(url) {
    if (TEXT_PLAIN_HOSTS.test(url)) return blobImport(url); // single-file plugins only
    try { return await import(url); }
    catch (e) { if (!/^https:/.test(url)) throw e; return blobImport(url); } // e.g. other servers with a wrong MIME type
  }
  function validate(mod) {
    const d = mod && mod.default && typeof mod.default === 'object' ? mod.default : mod;
    if (!d || typeof d.create !== 'function') throw new Error('module has no create() export');
    if (d.apiVersion !== HOST_API_VERSION) throw new Error('apiVersion ' + d.apiVersion + ' not supported (host speaks ' + HOST_API_VERSION + ')');
    if (typeof d.id !== 'string' || !d.id) throw new Error('module has no id');
    return d;
  }
  function specUrl(id) {
    const b = BUILTIN.find(p => p.id === id); if (b) return b.url;
    if (id === 'custom-url') return st.url;
    if (id === 'custom-file') {
      const src = localStorage.getItem(LS_FILE); if (!src) throw new Error('no saved local script');
      return URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    }
    throw new Error('unknown plugin ' + id);
  }
  function teardown() {
    const i = inst, b = bus; inst = null; desc = null; active = null; bus = null;
    try { i && i.dispose && i.dispose(); } catch (e) { log.warn('[audio] dispose failed', e); }
    try { b && b.disconnect(); } catch (e) { } // whatever the plugin left connected is cut off here
  }
  async function activate(id, isFallback = false) {
    const my = ++token; teardown(); errCount = 0;
    if (id === 'off') { st.plugin = 'off'; save(); status = 'Engine sound off.'; render(); return true; }
    if (!ctx) { st.plugin = id; save(); status = 'Tap anywhere to enable sound.'; render(); return false; }
    loading = true; status = 'Loading ' + id + '…'; render();
    let url = null;
    try {
      url = specUrl(id);
      const d = validate(await withTimeout(importModule(url), 10000, 'import'));
      if (my !== token) return false;
      const b = ctx.createGain(); b.connect(master);
      const veh = (sr && sr.telemetry.vehicle) || T.vehicle || 'buggy'; prev.vehicle = veh; // a vehicle switch racing the async load is caught by frame()
      const opts = { apiVersion: HOST_API_VERSION, preset: presetFor(d, veh), vehicle: veh, vehiclePreset: sr ? sr.telemetry.soundPreset : undefined, host: 'sinerally' };
      let i;
      try { i = await withTimeout(Promise.resolve(d.create(ctx, b, opts)), 10000, 'create()'); }
      catch (e) { b.disconnect(); throw e; }
      if (!i || typeof i.update !== 'function') { try { i && i.dispose && i.dispose(); } catch (_) { } b.disconnect(); throw new Error('create() did not return { update() }'); }
      if (my !== token) { try { i.dispose && i.dispose(); } catch (_) { } b.disconnect(); return false; }
      desc = d; inst = i; bus = b; active = id; stats.loads++;
      st.plugin = id; save(); error = isFallback ? error : '';
      status = (d.name || d.id) + (d.version ? ' v' + d.version : '');
      log.info('[audio] plugin active:', d.id, d.version || '');
      notify('active'); return true;
    } catch (e) {
      if (my !== token) return false;
      const msg = (e && e.message) || String(e);
      log.warn('[audio] plugin "' + id + '" failed: ' + msg);
      error = 'Plugin "' + id + '" failed: ' + msg;
      if (id !== DEFAULT_ID) { stats.fallbacks++; loading = false; return activate(DEFAULT_ID, true).then(() => false); }
      status = 'No engine sound (default plugin failed).';
      return false;
    } finally {
      if (my === token) { loading = false; render(); }
      if (id === 'custom-file' && url) URL.revokeObjectURL(url);
    }
  }
  function fail(where, e) { // runtime errors inside a plugin: tolerate a few, then fall back
    log.warn('[audio] plugin ' + where + ' threw:', e);
    if (++errCount >= 5 && active) { const was = active; error = 'Plugin "' + was + '" kept throwing (' + ((e && e.message) || e) + ')'; if (was !== DEFAULT_ID) { stats.fallbacks++; activate(DEFAULT_ID, true); } else { teardown(); status = 'Engine sound stopped.'; render(); } }
  }
  function presetFor(d, veh) {
    const list = d && Array.isArray(d.presets) ? d.presets : null; if (!list || !list.length) return undefined;
    const has = id => id && list.some(x => x.id === id);
    const vp = sr && sr.telemetry.vehicle === veh ? sr.telemetry.soundPreset : undefined; // vehicle's own default sound preset id
    const p = [(st.presets[d.id] || {})[veh], vp, (d.vehiclePresets || {})[veh], d.defaultPreset].find(has);
    return list.some(x => x.id === p) ? p : list[0].id;
  }
  function setPreset(pid) {
    if (!desc) return; (st.presets[desc.id] || (st.presets[desc.id] = {}))[T.vehicle] = pid; save();
    if (inst.setPreset) { try { inst.setPreset(pid); } catch (e) { fail('setPreset', e); } notify('preset'); render(); } else activate(active);
  }

  // ---------- per-frame telemetry ----------
  function event(name, data) { if (!inst || !inst.event) return; stats.events++; try { inst.event(name, data); } catch (e) { fail('event(' + name + ')', e); } }
  function frame(dt, isPaused = false) {
    if (isPaused !== paused) { paused = isPaused; applyGain(); event('pause', { on: paused }); }
    if (!sr) return;
    const s = sr.telemetry, t = T;
    t.time += dt; t.rpm = s.rpm; t.idleRpm = s.idle || 900; t.redlineRpm = s.redline || 7000;
    t.rpmNorm = clamp((s.rpm - t.idleRpm) / Math.max(1, t.redlineRpm - t.idleRpm), 0, 1.2);
    t.throttle = clamp(s.throttle, 0, 1); t.brake = clamp(s.brake, 0, 1); t.load = clamp(s.load, -1, 1);
    t.nitro = !!s.boost; t.nitroStrength += ((t.nitro ? 1 : 0) - t.nitroStrength) * Math.min(1, dt * (t.nitro ? 12 : 6)); t.nitroTank = s.nitro;
    t.gear = s.gear; t.gearCount = s.gears || 6; t.shifting = !!s.shifting;
    t.limiter = s.rpm >= t.redlineRpm - 30 && t.throttle > 0.3;
    t.ignition = t.limiter || (t.shifting && prev.upT > 0) ? 0 : 1; // 0 = ignition cut (limiter bounce, upshift cut)
    t.speed = s.speed; t.fwdSpeed = s.fwdSpeed; t.speedKmh = s.speed * 3.6;
    t.grounded = s.grounded; t.airborne = s.grounded === 0; t.airTime = s.air; t.surface = s.surface; t.vehicle = s.vehicle; t.paused = paused;
    t.vehiclePreset = s.soundPreset || undefined; // the vehicle's 'default sound preset id' (vehicle module), optional
    const temp = s['engine:temp'] !== undefined ? s['engine:temp'] : s.engineTemp; t.engineTemp = typeof temp === 'number' ? temp : undefined; // °C, optional (physics module)
    if (test.on) { // sound-editor test bench: synthetic rev / nitro while the editor is open (car input is paused)
      const tgt = test.rev ? t.idleRpm + (t.redlineRpm - t.idleRpm) * 0.93 : t.idleRpm; test.rpm += (tgt - test.rpm) * Math.min(1, dt * (test.rev ? 2.4 : 1.8));
      t.rpm = test.rpm; t.rpmNorm = clamp((t.rpm - t.idleRpm) / Math.max(1, t.redlineRpm - t.idleRpm), 0, 1.2);
      t.throttle = test.rev ? 1 : 0; t.load = test.rev ? 0.5 : -0.2; t.nitro = !!test.nitro; t.nitroStrength = t.nitro ? 1 : 0; t.limiter = false; t.ignition = 1; t.shifting = false;
    }
    let sl = 0; const w = s.wheels; for (let i = 0; i < 4; i++) { const o = w[i]; if (o.contact) sl = Math.max(sl, Math.abs(o.slipRatio), Math.abs(o.slipAngle) * 2.5); } t.slip = clamp(sl, 0, 1);
    // derived events
    if (t.vehicle !== prev.vehicle) {
      if (prev.vehicle !== null) { event('vehicle', { id: t.vehicle }); if (desc) { const p = presetFor(desc, t.vehicle); if (p && inst.setPreset) try { inst.setPreset(p); } catch (e) { fail('setPreset', e); } notify('vehicle'); render(); } }
      prev.vehicle = t.vehicle;
    }
    prev.upT = Math.max(0, prev.upT - dt); prev.bfT = Math.max(0, prev.bfT - dt);
    for (const [n, d] of queue.splice(0)) {
      if (n === 'shift') { d.to = t.gear; d.from = t.gear - d.dir; if (d.dir > 0) { prev.upT = 0.2; if (t.rpmNorm > 0.55) backfire(0.5); } }
      event(n, d);
    }
    if (prev.thr > 0.5 && t.throttle < 0.1 && t.rpmNorm > 0.55) backfire(t.rpmNorm);
    if (t.nitro !== prev.nitro) event('nitro', { on: t.nitro });
    if (t.limiter !== prev.limiter) { event('limiter', { on: t.limiter }); if (t.limiter) backfire(0.8); }
    prev.thr = t.throttle; prev.gear = t.gear; prev.nitro = t.nitro; prev.limiter = t.limiter;
    if (!inst || paused) return;
    const t0 = performance.now();
    try { inst.update(t, dt); stats.updates++; errCount = 0; } catch (e) { fail('update', e); }
    stats.updMs += (performance.now() - t0 - stats.updMs) * 0.05;
  }
  function backfire(strength) { if (prev.bfT > 0) return; prev.bfT = 0.25; event('backfire', { strength: clamp(strength, 0, 1) }); }

  // ---------- ☰ menu section ----------
  function render() {
    const el = menuEl; if (!el || !el.isConnected) return; el.innerHTML = '';
    const row = (label) => { const r = document.createElement('div'); r.className = 'mrow'; if (label) r.innerHTML = `<span>${label}</span>`; el.appendChild(r); return r; };
    const btn = (r, text, sel, fn) => { const b = document.createElement('button'); b.className = 'sb' + (sel ? ' sel' : ''); b.textContent = text; b.onclick = () => { unlock(); fn(); }; r.appendChild(b); return b; };
    const h = document.createElement('h3'); h.textContent = 'ENGINE SOUND'; h.style.marginTop = '10px'; el.appendChild(h);
    const cur = active || st.plugin;
    let r = row('SOUND PLUGIN');
    for (const p of BUILTIN) btn(r, p.label, cur === p.id, () => activate(p.id));
    if (st.url) btn(r, 'CUSTOM URL', cur === 'custom-url', () => activate('custom-url'));
    if (st.fileName && localStorage.getItem(LS_FILE)) btn(r, 'FILE: ' + st.fileName.slice(0, 18).toUpperCase(), cur === 'custom-file', () => activate('custom-file'));
    btn(r, 'OFF', cur === 'off', () => activate('off'));
    if (desc && Array.isArray(desc.presets) && desc.presets.length) {
      r = row('PRESET (' + String(T.vehicle).toUpperCase() + ')');
      const s = document.createElement('select'); s.className = 'sb'; s.id = 'sndPreset';
      const curP = (inst && inst.preset) || presetFor(desc, T.vehicle);
      for (const p of desc.presets) { const o = document.createElement('option'); o.value = p.id; o.textContent = p.name || p.id; o.selected = p.id === curP; s.appendChild(o); }
      s.onchange = () => setPreset(s.value); s.addEventListener('keydown', e => e.stopPropagation()); r.appendChild(s);
    }
    r = row('VOLUME');
    const v = document.createElement('input'); v.type = 'range'; v.min = 0; v.max = 1; v.step = 0.05; v.value = st.volume; v.id = 'sndVol';
    v.oninput = () => { st.volume = +v.value; save(); applyGain(); }; v.addEventListener('keydown', e => e.stopPropagation()); r.appendChild(v);
    btn(r, st.muted ? '🔇 UNMUTE' : '🔊 MUTE', st.muted, () => { setMuted(!st.muted); });
    r = row('CUSTOM SCRIPT');
    const u = document.createElement('input'); u.type = 'url'; u.placeholder = 'https://…/my-engine.js'; u.value = st.url; u.id = 'sndUrl';
    u.style.cssText = 'width:200px;font:12px monospace;padding:5px;border:3px solid #111;-webkit-user-select:text;user-select:text';
    u.addEventListener('keydown', e => e.stopPropagation()); r.appendChild(u);
    btn(r, 'LOAD URL', false, () => loadUrl(u.value.trim()));
    const f = document.createElement('input'); f.type = 'file'; f.accept = '.js,.mjs,text/javascript'; f.style.display = 'none'; f.id = 'sndFile';
    f.onchange = () => { if (f.files[0]) loadFile(f.files[0]); }; r.appendChild(f);
    btn(r, 'LOAD .JS FILE', false, () => f.click());
    const info = document.createElement('div'); info.id = 'sndStatus'; info.style.cssText = 'font:bold 11px monospace;max-width:520px;white-space:normal';
    info.innerHTML = `<div>${esc(ctx ? (loading ? status : (active ? '▶ ' + status : status)) : 'Tap anywhere to enable sound.')}${ctx ? ' · ' + ctx.state : ''}</div>` +
      (error ? `<div style="color:#c0201a">⚠ ${esc(error)}</div>` : '') +
      `<div style="opacity:.7">Custom scripts run with full page privileges – only load code you trust. Maker docs: PLUGIN_API.md</div>`;
    el.appendChild(info);
    for (const f of extras) { try { f(el, row, btn); } catch (e) { log.warn('[audio] menu extra', e); } }
  }
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function loadUrl(url) {
    let ok = false; try { const p = new URL(url); ok = p.protocol === 'https:' || (p.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(p.hostname)); } catch (e) { }
    if (!ok) { error = 'Enter an https:// URL to an ES module (.js).'; render(); return Promise.resolve(false); }
    st.url = url; save(); return activate('custom-url');
  }
  async function loadFile(file) {
    if (file.size > MAX_FILE) { error = 'File too large (max 256 KB).'; render(); return false; }
    const src = await file.text();
    try { localStorage.setItem(LS_FILE, src); } catch (e) { error = 'Could not store the file: ' + e.message; render(); return false; }
    st.fileName = file.name; save(); return activate('custom-file');
  }
  const listeners = new Set(), extras = [], test = { on: false, rev: false, nitro: false, rpm: 0 };
  function notify(kind) { for (const f of listeners) { try { f(kind, inst, desc); } catch (e) { log.warn('[audio] listener', e); } } }
  function setMuted(m) { st.muted = !!m; save(); applyGain(); render(); }
  return {
    get running() { return !!ctx && ctx.state === 'running'; },
    unlock, frame, activate, loadUrl, loadFile, setMuted, setPreset, stats, telemetry: T,
    buildMenu(el) { menuEl = el; render(); }, rerender: () => render(),
    onChange(f) { listeners.add(f); return () => listeners.delete(f); }, // f(kind: 'active'|'preset'|'vehicle', instance, descriptor)
    addMenuExtra(f) { extras.push(f); }, // f(el, row(label), btn(row, text, sel, fn)) appended to the ENGINE SOUND section
    setTest(o) { if (o.on && !test.on) test.rpm = (sr && sr.telemetry.rpm) || T.idleRpm; Object.assign(test, o); }, get test() { return test; },
    get muted() { return st.muted; }, get active() { return active; }, get plugin() { return desc; }, get instance() { return inst; },
    get ctx() { return ctx; }, get error() { return error; }, get status() { return status; },
  };
}
