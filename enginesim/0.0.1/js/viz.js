// viz.js — comic-style canvas: engine diagram with per-cylinder firing lights + pistons,
// firing timeline, tachometer, crank-angle dial, gear/speed, nitro gauge.
const BANK_COL = ['#ff6a1a', '#1ac8ff', '#ffd21a'];
const BANK_DARK = ['#b8420a', '#0a7fb0', '#b89300'];
const INK = '#111';
const FONT = (px) => `italic 900 ${px}px "Arial Black", Impact, system-ui, sans-serif`;
const D2R = Math.PI / 180;

function bankIdx(angle) { return angle > 1 ? 1 : angle < -1 ? 0 : 2; }

export class EngineViz {
  constructor(canvas) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.selected = 0; this.hits = []; this.onSelect = null;
    this.W = 0; this.H = 0; this.dpr = 1;
    canvas.addEventListener('pointerdown', (e) => {
      const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      for (let i = this.hits.length - 1; i >= 0; i--) {
        const h = this.hits[i];
        if (Math.hypot(x - h.x, y - h.y) < h.r) { this.selected = h.i; this.onSelect && this.onSelect(h.i); break; }
      }
    });
  }

  resize() {
    const r = this.cv.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
    if (w !== this.cv.width || h !== this.cv.height) { this.cv.width = w; this.cv.height = h; }
    this.W = r.width; this.H = r.height; this.dpr = dpr;
  }

  text(s, x, y, px, fill = '#fff', align = 'center', lw) {
    const g = this.g; g.font = FONT(px); g.textAlign = align; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = lw ?? Math.max(2, px * 0.18); g.strokeStyle = INK;
    g.strokeText(s, x, y); g.fillStyle = fill; g.fillText(s, x, y);
  }

  panel(x, y, w, h, fill = '#fff8e0') {
    const g = this.g;
    g.fillStyle = INK; g.fillRect(x + 4, y + 4, w, h);
    g.fillStyle = fill; g.fillRect(x, y, w, h);
    g.lineWidth = 3; g.strokeStyle = INK; g.strokeRect(x, y, w, h);
  }

  draw(cfg, vis, tel) {
    this.resize();
    const g = this.g, W = this.W, H = this.H;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const land = W > H * 1.15;
    let diag, tach, dial, nos;
    if (land) {
      const gw = W * 0.4, gx = W - gw;
      diag = { x: 8, y: 8, w: W - gw - 16, h: H - 16 };
      const tr = Math.min(gw * 0.42, H * 0.3);
      tach = { x: gx + gw / 2, y: 12 + tr + 6, r: tr };
      const dr = Math.min(gw * 0.2, (H - (tach.y + tr)) * 0.38);
      dial = { x: gx + gw * 0.3, y: Math.min(H - dr - 14, tach.y + tr + dr + 22), r: Math.max(22, dr) };
      nos = { x: gx + gw * 0.62, y: dial.y - 12, w: gw * 0.3, h: 20 };
    } else {
      diag = { x: 8, y: 8, w: W - 16, h: H * 0.56 - 12 };
      const tr = Math.min(W * 0.27, H * 0.19);
      tach = { x: 14 + tr, y: H * 0.56 + 10 + tr, r: tr };
      const dr = Math.min(W * 0.17, H * 0.12);
      dial = { x: W - 14 - dr - 10, y: H * 0.56 + 14 + dr, r: dr };
      nos = { x: W * 0.6, y: dial.y + dr + 18, w: W * 0.36, h: 18 };
    }
    this.drawDiagram(cfg, vis, tel, diag);
    this.drawTach(cfg, vis, tel, tach);
    this.drawDial(cfg, vis, dial);
    this.drawNos(tel, nos);
  }

  drawDiagram(cfg, vis, tel, R) {
    const g = this.g;
    this.panel(R.x, R.y, R.w, R.h, '#fff3cf');
    const tlH = Math.max(40, Math.min(70, R.h * 0.2));
    const area = { x: R.x + 10, y: R.y + 34, w: R.w - 20, h: R.h - tlH - 50 };
    // title
    this.text(cfg.name.toUpperCase(), R.x + 12, R.y + 17, Math.min(18, R.w / 22), '#ffd21a', 'left', 4);
    const fo = cfg.firingOrder.join('-');
    g.font = FONT(11); g.textAlign = 'right'; g.fillStyle = INK;
    g.fillText(`${cfg.layout === 'rotary' ? 'ROTARY' : cfg.stroke + '-STROKE'} · FO ${fo.length > 30 ? fo.slice(0, 30) + '…' : fo}`, R.x + R.w - 10, R.y + 18);

    const cyls = cfg.cyl, n = cyls.length;
    const now = vis.now, rpm = Math.max(vis.rpm, 100);
    const cycleSec = vis.cycle / (rpm * 6);
    const tau = Math.max(0.006, Math.min(0.07, cycleSec * 0.3));
    const crank = vis.crank;
    const rotary = cfg.layout === 'rotary';
    // geometry in engine units
    const maxA = Math.max(...cyls.map(c => Math.abs(c.angle)));
    // pick a depth axis that doesn't line up with any bank direction
    const [DX, DY] = rotary ? [1.25, -0.2] : maxA < 8 ? [0.78, -0.42] : maxA < 70 ? [0.95 + 0.6 * Math.sin(maxA * D2R), -0.2] : [0.78, -0.42];
    const parts = cyls.map((c, i) => {
      const b = c.angle * D2R, d = [Math.sin(b), -Math.cos(b)], q = [Math.cos(b), Math.sin(b)];
      const P = [c.pos * DX, c.pos * DY];
      return { i, c, d, q, P, bank: bankIdx(c.angle) };
    });
    // bbox
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const ext = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const p of parts) {
      for (const r of [0, 1.6]) for (const s of [-0.34, 0.34]) ext(p.P[0] + p.d[0] * r + p.q[0] * s, p.P[1] + p.d[1] * r + p.q[1] * s);
      ext(p.P[0] - 0.3, p.P[1] - 0.3); ext(p.P[0] + 0.3, p.P[1] + 0.3);
    }
    const sc = Math.min(area.w / (x1 - x0), area.h / (y1 - y0), 160);
    const ox = area.x + (area.w - (x1 - x0) * sc) / 2 - x0 * sc, oy = area.y + (area.h - (y1 - y0) * sc) / 2 - y0 * sc;
    const X = (x) => ox + x * sc, Y = (y) => oy + y * sc;
    // crankshaft
    const ps = parts.map(p => p.c.pos), pmin = Math.min(...ps), pmax = Math.max(...ps);
    g.lineCap = 'round';
    g.strokeStyle = INK; g.lineWidth = Math.max(6, sc * 0.16);
    g.beginPath(); g.moveTo(X(pmin * DX - 0.35 * DX), Y(pmin * DY - 0.35 * DY)); g.lineTo(X(pmax * DX + 0.35 * DX), Y(pmax * DY + 0.35 * DY)); g.stroke();
    g.strokeStyle = '#8a8a8a'; g.lineWidth = Math.max(3, sc * 0.09); g.stroke();
    this.hits = [];
    const order = parts.slice().sort((a, b) => b.c.pos - a.c.pos || (a.d[1] - b.d[1]));
    const nitro = tel && tel.nitro;
    const overlay = [];
    for (const p of order) {
      const { i, c, d, q, P } = p;
      const age = now - vis.lastFire[i], kind = vis.lastKind[i];
      const I = age >= 0 ? Math.exp(-age / tau) : 0;
      const col = BANK_COL[p.bank], dark = BANK_DARK[p.bank];
      const pt = (r, s) => [X(P[0] + d[0] * r + q[0] * s), Y(P[1] + d[1] * r + q[1] * s)];
      const quad = (r0, r1, hw, fill, lw = 3) => {
        const a = pt(r0, -hw), b = pt(r0, hw), e = pt(r1, hw), f = pt(r1, -hw);
        g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.lineTo(...e); g.lineTo(...f); g.closePath();
        g.fillStyle = fill; g.fill(); if (lw) { g.lineWidth = lw; g.strokeStyle = INK; g.stroke(); }
      };
      const phi = ((crank - c.fire) % 360) * D2R; // 0 = TDC of this cylinder
      if (rotary) {
        const C = pt(0.62, 0);
        g.beginPath(); g.ellipse(C[0], C[1], 0.5 * sc, 0.42 * sc, 0, 0, Math.PI * 2);
        g.fillStyle = col; g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
        const rot = phi / 3;
        g.beginPath();
        for (let k = 0; k < 3; k++) { const a = rot + k * 2.0944 - Math.PI / 2; const px = C[0] + Math.cos(a) * 0.36 * sc, py = C[1] + Math.sin(a) * 0.36 * sc; k ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.closePath(); g.fillStyle = '#d9d9d9'; g.fill(); g.stroke();
        if (I > 0.05) { g.globalAlpha = Math.min(1, I * 1.2); g.fillStyle = '#ffb21a'; g.beginPath(); g.arc(C[0], C[1] - 0.3 * sc, 0.16 * sc, 0, 7); g.fill(); g.globalAlpha = 1; }
      } else {
        // bore
        quad(0.12, 0.92, 0.27, col);
        quad(0.12, 0.92, 0.1, dark, 0); // shade stripe
        // piston via slider-crank (r=0.18, l=0.5)
        const r = 0.18, l = 0.5;
        const sp = r * Math.cos(phi) + Math.sqrt(l * l - r * r * Math.sin(phi) ** 2);
        const pin = [P[0] + (d[0] * Math.cos(phi) - q[0] * Math.sin(phi)) * r, P[1] + (d[1] * Math.cos(phi) - q[1] * Math.sin(phi)) * r];
        // combustion flash in chamber
        if (I > 0.04) {
          const fl = kind === 1 ? '#7a1010' : nitro ? '#7ff4ff' : '#ffb21a';
          g.globalAlpha = Math.min(1, I * 1.3); quad(sp + 0.1, 0.92, 0.25, fl, 0); g.globalAlpha = 1;
        }
        g.strokeStyle = INK; g.lineWidth = Math.max(3, sc * 0.06);
        const pp = pt(sp, 0);
        g.beginPath(); g.moveTo(X(pin[0]), Y(pin[1])); g.lineTo(...pp); g.stroke();
        quad(sp - 0.07, sp + 0.1, 0.24, '#d9d9d9', 2.5);
        g.fillStyle = INK; g.beginPath(); g.arc(X(pin[0]), Y(pin[1]), Math.max(2.5, sc * 0.045), 0, 7); g.fill();
        // head
        quad(0.92, 1.06, 0.31, '#555');
      }
      // spark light + label: deferred so they are never hidden behind another bank
      const L = pt(rotary ? 1.18 : 1.16, 0), lr = Math.max(7, sc * 0.13);
      const lab = rotary ? pt(0.3, 0) : pt(1.46, 0);
      overlay.push(() => {
        if (I > 0.02) {
          g.globalAlpha = Math.min(0.85, I);
          g.fillStyle = kind === 1 ? '#ff2d2d' : nitro ? '#9ffcff' : '#fff36b';
          g.beginPath(); g.arc(L[0], L[1], lr * (1.5 + 1.2 * I), 0, 7); g.fill(); g.globalAlpha = 1;
        }
        g.beginPath(); g.arc(L[0], L[1], lr, 0, 7);
        g.fillStyle = I > 0.15 ? (kind === 1 ? '#ff2d2d' : nitro ? '#e6ffff' : '#fff9c0') : '#3a2a1a';
        g.fill(); g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
        this.text(String(i + 1), lab[0], lab[1], Math.max(11, Math.min(22, sc * 0.26)), '#fff', 'center', 3.5);
        if (i === this.selected) {
          g.setLineDash([6, 4]); g.lineWidth = 3; g.strokeStyle = '#ff2d7a';
          g.beginPath(); g.arc(L[0], L[1], lr + 6, 0, 7); g.stroke(); g.setLineDash([]);
        }
      });
      this.hits.push({ i, x: lab[0], y: lab[1], r: Math.max(18, sc * 0.4) }, { i, x: L[0], y: L[1], r: lr + 8 });
    }
    for (const f of overlay) f();
    // timeline
    this.drawTimeline(cfg, vis, { x: R.x + 10, y: R.y + R.h - tlH - 8, w: R.w - 20, h: tlH }, cycleSec);
    // badges
    let by = R.y + 44;
    const badge = (s, col) => { this.text(s, R.x + R.w - 14, by, 22, col, 'right', 5); by += 28; };
    if (tel) {
      if (tel.limiter) badge('LIMITER!', '#ff2d2d');
      if (tel.nitro) badge('NITRO!!', '#5ef0ff');
      if (tel.shiftFlash > 0.25) badge(tel.shiftDir > 0 ? 'SHIFT ▲' : 'BLIP ▼', '#3ddc4a');
    }
  }

  drawTimeline(cfg, vis, R, cycleSec) {
    const g = this.g;
    g.fillStyle = '#1b1b1b'; g.fillRect(R.x, R.y, R.w, R.h);
    g.lineWidth = 3; g.strokeStyle = INK; g.strokeRect(R.x, R.y, R.w, R.h);
    const win = Math.max(0.03, Math.min(1.5, cycleSec * 2));
    // cycle boundaries grid
    g.fillStyle = '#ffffff22';
    for (let k = 1; k < 2; k++) g.fillRect(R.x + R.w * (1 - k / 2), R.y, 2, R.h);
    const h = vis.history, now = vis.now;
    const lane = R.h - 16;
    let lastX = -1e9;
    for (let k = h.length - 1; k >= 0; k--) {
      const e = h[k]; const age = now - e.t; if (age > win) break; if (age < 0) continue;
      const x = R.x + R.w - (age / win) * R.w;
      const c = cfg.cyl[e.cyl]; if (!c) continue;
      const bi = bankIdx(c.angle);
      if (e.kind === 2) { this.text('✸', x, R.y + 10, 14, '#ffef5a', 'center', 2); continue; }
      g.fillStyle = e.kind === 1 ? '#ff2d2d' : BANK_COL[bi];
      const hh = e.kind === 1 ? lane * 0.4 : lane;
      g.fillRect(x - 2, R.y + R.h - 4 - hh, 5, hh);
      if (Math.abs(lastX - x) > 15 && e.kind === 0) { g.font = FONT(10); g.textAlign = 'center'; g.fillStyle = '#fff'; g.fillText(String(e.cyl + 1), x, R.y + 9); lastX = x; }
    }
    g.font = FONT(9); g.textAlign = 'left'; g.fillStyle = '#ffffff99';
    g.fillText('FIRING TIMELINE · 2 CYCLES', R.x + 6, R.y + R.h - 8);
  }

  drawTach(cfg, vis, tel, T) {
    const g = this.g, { x, y, r } = T;
    const red = cfg.redline, max = Math.ceil(red * 1.15 / 1000) * 1000;
    const a0 = 135 * D2R, sweep = 270 * D2R;
    const ang = (v) => a0 + Math.min(1.04, v / max) * sweep;
    const lim = tel && tel.limiter;
    g.fillStyle = INK; g.beginPath(); g.arc(x + 5, y + 5, r, 0, 7); g.fill();
    g.fillStyle = lim && (performance.now() % 160 < 80) ? '#ff5a5a' : '#fff8e0';
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.lineWidth = 4; g.strokeStyle = INK; g.stroke();
    // red zone
    g.lineWidth = r * 0.12; g.strokeStyle = '#ff2d2d'; g.lineCap = 'butt';
    g.beginPath(); g.arc(x, y, r * 0.86, ang(red), ang(max)); g.stroke();
    // ticks
    for (let v = 0; v <= max; v += 500) {
      const a = ang(v), big = v % 1000 === 0;
      g.lineWidth = big ? 3.5 : 2; g.strokeStyle = INK;
      g.beginPath(); g.moveTo(x + Math.cos(a) * r * (big ? 0.74 : 0.8), y + Math.sin(a) * r * (big ? 0.74 : 0.8));
      g.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92); g.stroke();
      if (big && (max <= 10000 || v % 2000 === 0)) {
        g.font = FONT(Math.max(9, r * 0.13)); g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(v / 1000), x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
      }
    }
    // shift lights
    const rpm = tel ? tel.rpm : vis.rpm;
    const nL = 7;
    for (let k = 0; k < nL; k++) {
      const thr = red * (0.72 + 0.04 * k);
      const on = rpm >= thr;
      const lx = x - r * 0.42 + (k / (nL - 1)) * r * 0.84, ly = y - r * 0.28;
      g.beginPath(); g.arc(lx, ly, Math.max(3, r * 0.045), 0, 7);
      g.fillStyle = on ? (k < 3 ? '#3ddc4a' : k < 5 ? '#ffd21a' : '#ff2d2d') : '#444'; g.fill();
      g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke();
    }
    // needle (shows heard rpm)
    const na = ang(vis.rpm > 0 ? vis.rpm : rpm);
    g.lineCap = 'round';
    g.strokeStyle = INK; g.lineWidth = 9;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(na) * r * 0.86, y + Math.sin(na) * r * 0.86); g.stroke();
    g.strokeStyle = '#ff6a1a'; g.lineWidth = 4.5; g.stroke();
    g.fillStyle = INK; g.beginPath(); g.arc(x, y, r * 0.09, 0, 7); g.fill();
    // readouts
    const gear = tel ? String(tel.gear) : 'N';
    this.text(gear, x, y + r * 0.3, r * 0.42, tel && tel.shifting ? '#3ddc4a' : '#ffd21a', 'center', 6);
    this.text(`${Math.round(tel ? tel.speedKmh : 0)} KM/H`, x, y + r * 0.66, Math.max(10, r * 0.15), '#fff', 'center', 4);
    g.font = FONT(Math.max(9, r * 0.11)); g.fillStyle = INK; g.textAlign = 'center';
    g.fillText(`${Math.round(rpm)} RPM`, x, y - r * 0.13);
  }

  drawDial(cfg, vis, D) {
    const g = this.g, { x, y, r } = D, cyc = vis.cycle || 720;
    g.fillStyle = INK; g.beginPath(); g.arc(x + 4, y + 4, r, 0, 7); g.fill();
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); g.lineWidth = 3.5; g.strokeStyle = INK; g.stroke();
    const A = (deg) => -Math.PI / 2 + (deg / cyc) * Math.PI * 2;
    g.strokeStyle = '#ffffff55'; g.lineWidth = 1.5;
    for (let d = 0; d < cyc; d += 90) { const a = A(d); g.beginPath(); g.moveTo(x + Math.cos(a) * r * 0.78, y + Math.sin(a) * r * 0.78); g.lineTo(x + Math.cos(a) * r * 0.95, y + Math.sin(a) * r * 0.95); g.stroke(); }
    const now = vis.now, cycleSec = cyc / (Math.max(vis.rpm, 100) * 6), tau = Math.max(0.006, Math.min(0.07, cycleSec * 0.3));
    cfg.cyl.forEach((c, i) => {
      const a = A(c.fire), I = Math.exp(-Math.max(0, now - vis.lastFire[i]) / tau);
      const px = x + Math.cos(a) * r * 0.78, py = y + Math.sin(a) * r * 0.78;
      g.beginPath(); g.arc(px, py, Math.max(3, r * 0.09) * (1 + I * 0.6), 0, 7);
      g.fillStyle = I > 0.2 ? '#fff36b' : BANK_COL[bankIdx(c.angle)]; g.fill(); g.lineWidth = 1.5; g.strokeStyle = INK; g.stroke();
      if (cfg.cyl.length <= 12 && r > 40) { g.font = FONT(8); g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(String(i + 1), x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55); }
    });
    const a = A(vis.crank);
    g.lineCap = 'round'; g.strokeStyle = '#ff2d7a'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9); g.stroke();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill();
    this.text(`${Math.round(vis.crank)}°`, x, y + r + 12, 12, '#fff', 'center', 3);
    this.text(`CRANK ${cyc}°`, x, y - r - 10, 11, '#ffd21a', 'center', 3);
  }

  drawNos(tel, R) {
    if (!tel) return;
    const g = this.g;
    this.text('NOS', R.x - 4, R.y + R.h / 2, 13, '#5ef0ff', 'right', 3.5);
    g.save(); g.translate(R.x, R.y); g.transform(1, 0, -0.35, 1, 0, 0);
    g.fillStyle = INK; g.fillRect(4, 4, R.w, R.h);
    g.fillStyle = '#ffffff88'; g.fillRect(0, 0, R.w, R.h);
    g.fillStyle = tel.nitro ? '#e6ffff' : '#1ac8ff'; g.fillRect(0, 0, R.w * tel.nitroTank, R.h);
    g.lineWidth = 3; g.strokeStyle = INK; g.strokeRect(0, 0, R.w, R.h);
    g.restore();
  }
}
