// power-ui.js — VEHICLE → ⚙ ENGINE / POWER sub-panel: per-build power curve editor (canvas with draggable rpm nodes,
// peak power up to 10 000 hp (+kW), redline, idle, presets, turbo lag, reset to stock). Data/physics live in power.js.
import * as PW from './power.js';
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const LN = Math.log(PW.HP_MAX / PW.HP_MIN);
const hpToS = hp => Math.round(1000 * Math.log(hp / PW.HP_MIN) / LN), sToHp = s => Math.round(PW.HP_MIN * Math.exp(s / 1000 * LN));
const fmt = n => Math.round(n).toLocaleString('en-US');

/**
 * @param {{container:HTMLElement, def:object, state:object, onChange:Function, onBack:Function}} o
 * state = live physics state (rpm marker + where the curve is applied); def = vehicle def (id, name)
 */
export function openPowerPanel({ container, def, getState, onChange = () => {}, onBack = () => {} }) {
  const stockP = () => getState().__stockP || getState().P;
  const stock = () => PW.stockOf(stockP());
  let cfg = PW.norm(PW.get(def.id) || stock(), stock()), drag = -1, hover = -1;
  const el = document.createElement('div'); el.className = 'pw'; container.innerHTML = ''; container.appendChild(el);
  el.innerHTML = `<div class="pw-h"><button class="sb" data-a="back">‹ BACK</button><b>ENGINE / POWER · ${def.name.toUpperCase()}</b><button class="sb" data-a="reset">RESET TO STOCK</button></div>
<div class="pw-pre"></div>
<div class="pw-main"><canvas class="pw-cv" width="760" height="330"></canvas><div class="pw-side"><div class="pw-read"></div><div class="pw-sl"></div></div></div><div class="mnote pw-note">Drag the dots to shape the torque curve (rpm 0 → redline). The curve is scaled so its peak equals PEAK POWER. Saved per build.</div>`;
  const cv = el.querySelector('canvas'), g = cv.getContext('2d'), read = el.querySelector('.pw-read'), pre = el.querySelector('.pw-pre'), sl = el.querySelector('.pw-sl');
  const commit = () => { PW.set(def.id, cfg); onChange(cfg); draw(); readout(); presets(); if (sl.__ru) sl.__ru(); };
  // presets
  function presets() {
    pre.innerHTML = ''; const cur = PW.get(def.id) ? cfg.preset : 'stock';
    for (const [k, p] of [['stock', { name: 'STOCK' }], ...Object.entries(PW.PRESETS)]) {
      const b = document.createElement('button'); b.className = 'sb' + (cur === k ? ' sel' : ''); b.textContent = p.name; b.dataset.p = k;
      b.onclick = () => {
        if (k === 'stock') { const hp = cfg.hp; cfg = Object.assign(stock(), { hp, preset: 'stock' }); }
        else cfg = PW.norm(Object.assign({}, cfg, { nodes: p.nodes.slice(), idle: p.idle || stock().idle, redline: p.redline || stock().redline, spool: p.spool || 0, preset: k }), stock());
        sliders(); commit();
      };
      pre.appendChild(b);
    }
    if (cur === 'custom') { const s = document.createElement('small'); s.textContent = 'CUSTOM'; pre.appendChild(s); }
    const t = document.createElement('button'); t.className = 'sb pw-spool' + (cfg.spool ? ' sel' : ''); t.textContent = cfg.spool ? '🌀 TURBO LAG: ON' : '🌀 TURBO LAG: OFF';
    t.onclick = () => { cfg.spool = cfg.spool ? 0 : 1; commit(); }; pre.appendChild(t);
  }
  // sliders (range + numeric entry)
  function sliders() {
    sl.innerHTML = '';
    const row = (key, label, min, max, step, val, unit, toS = v => v, fromS = v => v) => {
      const r = document.createElement('div'); r.className = 'pw-r';
      r.innerHTML = `<span>${label}</span><input type="range" min="${toS(min)}" max="${toS(max)}" step="${step}" value="${toS(val)}"><input type="number" min="${min}" max="${max}" value="${val}" inputmode="numeric"><small>${unit}</small>`;
      const [rg, nb] = r.querySelectorAll('input');
      const setV = v => { cfg[key] = v; cfg = PW.norm(cfg, stock()); if (cfg.preset === 'stock') cfg.preset = 'custom'; nb.value = cfg[key]; rg.value = toS(cfg[key]); commit(); };
      rg.oninput = () => setV(fromS(+rg.value)); nb.onchange = () => setV(+nb.value);
      sl.appendChild(r); return r;
    };
    row('hp', 'PEAK POWER', PW.HP_MIN, PW.HP_MAX, 1, cfg.hp, 'hp', hpToS, sToHp);
    row('redline', 'REDLINE', PW.RED_MIN, PW.RED_MAX, 50, cfg.redline, 'rpm');
    row('idle', 'IDLE', PW.IDLE_MIN, PW.IDLE_MAX, 25, cfg.idle, 'rpm');
    // throttle ramp in ms: 0 = AUTO (slower pedal for more hp) — the number box then shows what AUTO resolves to (greyed)
    const rr = row('resp', 'THROTTLE', 0, PW.RESP_MAX, 10, cfg.resp, 'ms'), nb = rr.querySelector('input[type=number]'), un = rr.querySelector('small');
    rr.title = 'Throttle response: time from 0 to full throttle. 0 = AUTO (by peak power)';
    const ru = () => { const a = !cfg.resp; un.textContent = a ? 'AUTO' : 'ms'; nb.placeholder = Math.round(PW.autoResp(cfg.hp) * 1000); if (a) nb.value = ''; };
    ru(); sl.__ru = ru;
  }
  // graph
  const PAD = { l: 50, r: 54, t: 26, b: 34 }; // top margin = legend row (Nm · peak · hp) above the plot, never on the curve
  const W = cv.width, H = cv.height, gx = r => PAD.l + (W - PAD.l - PAD.r) * r / (cfg.redline * 1.04), gy = (v, mx) => H - PAD.b - (H - PAD.t - PAD.b) * v / mx;
  function draw() {
    const t = PW.table(cfg), pk = PW.peakOf(t, cfg.redline), st = getState(), live = st && st.__power ? st.rpm : st && st.rpm;
    g.clearRect(0, 0, W, H); g.fillStyle = '#fff6d8'; g.fillRect(0, 0, W, H);
    g.font = 'bold 18px monospace'; g.lineWidth = 2;
    // grid + axes
    g.strokeStyle = '#0002'; g.fillStyle = '#5a4a2a';
    const stepR = cfg.redline > 9000 ? 2000 : 1000;
    for (let r = 0; r <= cfg.redline * 1.04; r += stepR) { const x = gx(r); g.beginPath(); g.moveTo(x, PAD.t); g.lineTo(x, H - PAD.b); g.stroke(); g.textAlign = 'center'; g.fillText((r / 1000) + 'k', x, H - 10); }
    g.fillStyle = '#0001'; g.fillRect(gx(0), PAD.t, gx(cfg.idle) - gx(0), H - PAD.t - PAD.b); // below idle
    g.fillStyle = '#e8302a33'; g.fillRect(gx(cfg.redline), PAD.t, gx(cfg.redline * 1.04) - gx(cfg.redline), H - PAD.t - PAD.b);
    g.strokeStyle = '#e8302a'; g.lineWidth = 3; g.beginPath(); g.moveTo(gx(cfg.redline), PAD.t); g.lineTo(gx(cfg.redline), H - PAD.b); g.stroke();
    // torque (filled orange) + power (blue)
    const k = t[0][1] / cfg.nodes[0], mxT = k * 1.08, mxP = pk.hp * 1.08, N = 120; // torque axis in node units (dots follow the finger)
    g.beginPath(); g.moveTo(gx(0), gy(0, 1));
    for (let i = 0; i <= N; i++) { const r = cfg.redline * i / N; g.lineTo(gx(r), gy(PW.tq(t, r), mxT)); }
    g.lineTo(gx(cfg.redline), gy(0, 1)); g.closePath(); g.fillStyle = '#ff6a1a55'; g.fill();
    g.beginPath(); for (let i = 0; i <= N; i++) { const r = cfg.redline * i / N, y = gy(PW.tq(t, r), mxT); i ? g.lineTo(gx(r), y) : g.moveTo(gx(r), y); } g.strokeStyle = '#d84a0a'; g.lineWidth = 4; g.stroke();
    g.beginPath(); for (let i = 0; i <= N; i++) { const r = cfg.redline * i / N, y = gy(PW.tq(t, r) * r / PW.K_HP, mxP); i ? g.lineTo(gx(r), y) : g.moveTo(gx(r), y); } g.strokeStyle = '#1a7ad8'; g.lineWidth = 4; g.stroke();
    // peak-power marker
    g.setLineDash([8, 6]); g.strokeStyle = '#1a7ad8'; g.lineWidth = 2; g.beginPath(); g.moveTo(gx(pk.rpm), PAD.t); g.lineTo(gx(pk.rpm), H - PAD.b); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#1a7ad8'; g.beginPath(); g.arc(gx(pk.rpm), gy(pk.hp, mxP), 7, 0, 7); g.fill();
    g.textAlign = gx(pk.rpm) > W - 170 ? 'right' : 'left'; g.font = 'bold 16px monospace'; g.fillText(`${fmt(pk.hp)} hp @ ${fmt(pk.rpm)}`, gx(pk.rpm) + (g.textAlign === 'right' ? -8 : 8), PAD.t - 8);
    // axis labels
    g.textAlign = 'left'; g.fillStyle = '#d84a0a'; g.fillText('Nm', 4, PAD.t - 8); g.font = 'bold 14px monospace'; g.fillText(fmt(k), 2, gy(k, mxT) + 5);
    g.textAlign = 'right'; g.fillStyle = '#1a7ad8'; g.fillText('hp', W - 4, PAD.t - 8);
    // nodes
    cfg.nodes.forEach((v, i) => { const r = cfg.redline * i / (PW.N - 1), x = gx(r), y = gy(PW.tq(t, r), mxT);
      g.beginPath(); g.arc(x, y, drag === i ? 15 : 12, 0, 7); g.fillStyle = drag === i ? '#ffd23c' : '#fff'; g.fill(); g.lineWidth = 4; g.strokeStyle = '#111'; g.stroke(); });
    // live rpm
    if (live > 0) { const x = gx(Math.min(live, cfg.redline * 1.04)); g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, H - PAD.b); g.lineTo(x, H - PAD.b - 16); g.stroke(); g.fillStyle = '#111'; g.textAlign = 'center'; g.font = 'bold 14px monospace'; g.fillText('▲', x, H - PAD.b + 13); }
    return pk;
  }
  function readout() {
    const t = PW.table(cfg), pk = PW.peakOf(t, cfg.redline), i = drag >= 0 ? drag : hover;
    let at = '';
    if (i >= 0) { const r = cfg.redline * i / (PW.N - 1), nm = PW.tq(t, r); at = `<div class="pw-at">@ ${fmt(r)} rpm<br><b>${fmt(nm * r / PW.K_HP)}</b> hp · <b>${fmt(nm)}</b> Nm</div>`; }
    read.innerHTML = `<div class="pw-big">${fmt(cfg.hp)}<small> hp</small></div><div class="pw-kw">${fmt(cfg.hp / PW.HP_PER_KW)} kW</div>
<div>peak @ <b>${fmt(pk.rpm)}</b> rpm</div><div>torque <b>${fmt(pk.nm)}</b> Nm @ ${fmt(pk.nmRpm)}</div><div>stock ${fmt(stock().hp)} hp</div>${at}`;
  }
  // dragging (pointer + touch friendly: nearest node by x, generous hit area)
  const toLocal = e => { const b = cv.getBoundingClientRect(); return [(e.clientX - b.left) * W / b.width, (e.clientY - b.top) * H / b.height]; };
  const nearest = x => { let bi = 0, bd = 1e9; for (let i = 0; i < PW.N; i++) { const d = Math.abs(gx(cfg.redline * i / (PW.N - 1)) - x); if (d < bd) { bd = d; bi = i; } } return bi; };
  const setFromY = (i, y) => { const v = clamp((H - PAD.b - y) / (H - PAD.t - PAD.b) * 1.08, 0.05, 1);
    const n = cfg.nodes.slice(); n[i] = +v.toFixed(3); cfg.nodes = n; cfg.preset = 'custom'; };
  cv.addEventListener('pointerdown', e => { e.preventDefault(); const [x, y] = toLocal(e); drag = nearest(x); try { cv.setPointerCapture(e.pointerId); } catch (_) { } setFromY(drag, y); commit(); });
  cv.addEventListener('pointermove', e => { const [x, y] = toLocal(e); if (drag >= 0) { setFromY(drag, y); commit(); } else { const h = nearest(x); if (h !== hover) { hover = h; readout(); } } });
  const up = () => { if (drag >= 0) { drag = -1; draw(); readout(); } };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('lostpointercapture', up);
  cv.addEventListener('pointerleave', () => { if (drag < 0 && hover >= 0) { hover = -1; readout(); } });
  el.querySelector('[data-a=back]').onclick = () => { stop(); onBack(); };
  el.querySelector('[data-a=reset]').onclick = () => { PW.clear(def.id); cfg = stock(); onChange(null); sliders(); draw(); readout(); presets(); };
  // live rpm marker while open
  let raf = 0, lastT = 0; const loop = t => { if (!el.isConnected) return; raf = requestAnimationFrame(loop); if (t - lastT > 80 && drag < 0) { lastT = t; draw(); } };
  raf = requestAnimationFrame(loop); const stop = () => cancelAnimationFrame(raf);
  presets(); sliders(); draw(); readout();
  return { el, get cfg() { return cfg; }, close: stop, setNode(i, v) { const n = cfg.nodes.slice(); n[i] = v; cfg.nodes = n; cfg.preset = 'custom'; commit(); } };
}
