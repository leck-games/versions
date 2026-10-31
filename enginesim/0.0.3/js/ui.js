// ui.js — config panel (presets, layout, firing order, per-cylinder editor, globals).
import {
  SHAPES, LAYOUTS, BANK_ANGLES, LIMITERS, INDUCTION, countsFor, crankOptions,
  defaultFiringOrder, parseFiringOrder, firingIntervals, PRESETS, PRESET_ORDER, clone
} from './engine-config.js';
import { EngineSim } from './engine-sim.js';

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
};

export class ConfigPanel {
  /** @param {HTMLElement} root  @param {EngineSim} sim  @param {{onSelect?:Function, getSelected:Function, setSelected:Function}} hooks */
  constructor(root, sim, hooks) {
    this.root = root; this.sim = sim; this.hooks = hooks;
    this.open = { preset: true, layout: true, cyl: true, engine: false, sound: false, car: false, share: false };
    this.render();
  }
  get cfg() { return this.sim.config; }

  /** structural change → apply + full re-render */
  apply(patch) { this.sim.setConfig(patch); this.render(); }
  /** live slider change → apply without re-render */
  live(patch) { this.sim.setConfig(patch); }

  section(key, title, ...kids) {
    const d = h('details', { class: 'sec', open: this.open[key] }, h('summary', {}, title), h('div', { class: 'sec-body' }, ...kids));
    d.addEventListener('toggle', () => { this.open[key] = d.open; });
    return d;
  }

  select(label, value, options, onchange) {
    const s = h('select', { onchange: (e) => onchange(e.target.value) },
      options.map(([v, t]) => h('option', { value: v, selected: String(v) === String(value) }, t)));
    return h('label', { class: 'row' }, h('span', {}, label), s);
  }

  slider(label, value, min, max, step, fmt, oninput) {
    const out = h('b', {}, fmt(value));
    const inp = h('input', { type: 'range', min, max, step, value });
    inp.addEventListener('input', () => { const v = +inp.value; out.textContent = fmt(v); oninput(v); });
    return h('label', { class: 'row slider' }, h('span', {}, label, ' ', out), inp);
  }

  render() {
    const c = this.cfg, sel = Math.min(this.hooks.getSelected(), c.cylinders - 1);
    const st = this.root.scrollTop;
    this.root.textContent = '';
    const pct = (v) => Math.round(v * 100) + '%';

    // ---------- presets
    const presetSel = this.select('Preset', '', [['', '— pick a preset —'], ...PRESET_ORDER.map(k => [k, PRESETS[k].name])], (k) => {
      if (!k) return; this.sim.loadPreset(k); this.hooks.setSelected(0); this.render();
    });
    this.root.append(this.section('preset', '★ PRESETS', presetSel,
      h('p', { class: 'hint' }, 'Current: ', h('b', {}, c.name))));

    // ---------- layout
    const kids = [];
    kids.push(this.select('Layout', c.layout, LAYOUTS, (v) => {
      const patch = { layout: v, firingOrder: null, manualFire: false, name: 'Custom' };
      if (v === 'custom') patch.cylinders = c.cylinders; // keep current geometry as starting point
      this.apply(patch);
    }));
    kids.push(this.select('Cylinders', c.cylinders, countsFor(c.layout).map(n => [n, c.layout === 'rotary' ? `${n} rotor${n > 1 ? 's' : ''}` : n]), (v) => this.apply({ cylinders: +v, firingOrder: null, manualFire: false })));
    if (c.layout === 'v') kids.push(this.select('Bank angle', c.bankAngle, BANK_ANGLES.map(a => [a, a + '°']), (v) => this.apply({ bankAngle: +v, manualFire: false })));
    const co = crankOptions(c);
    if (co.length > 1) kids.push(this.select('Crank', c.crank, co, (v) => this.apply({ crank: v, firingOrder: null, manualFire: false })));
    if (c.layout !== 'rotary') kids.push(h('div', { class: 'row seg' }, h('span', {}, 'Cycle'),
      ...[4, 2].map(s => h('button', { class: c.stroke === s ? 'on' : '', onclick: () => this.apply({ stroke: s, manualFire: false }) }, `${s}-stroke`))));
    // firing order
    const fo = h('input', { type: 'text', value: c.firingOrder.join('-'), inputmode: 'numeric', spellcheck: 'false' });
    const msg = h('span', { class: 'hint' });
    const commit = () => {
      const p = parseFiringOrder(fo.value, c.cylinders);
      if (!p) { msg.textContent = `✗ need each of 1–${c.cylinders} exactly once`; fo.classList.add('bad'); return; }
      this.apply({ firingOrder: p, manualFire: false });
    };
    fo.addEventListener('change', commit);
    fo.addEventListener('keydown', (e) => { if (e.key === 'Enter') commit(); e.stopPropagation(); });
    kids.push(h('label', { class: 'row' }, h('span', {}, 'Firing order'), fo));
    kids.push(h('div', { class: 'row btns' },
      h('button', { onclick: () => this.apply({ firingOrder: defaultFiringOrder(this.cfg), manualFire: false }) }, 'Default order'),
      h('button', { onclick: () => this.apply({ manualFire: false }) }, 'Recompute angles')), msg);
    const order = c.firingOrder;
    const iv = c.manualFire ? null : firingIntervals(c);
    kids.push(h('p', { class: 'hint mono' },
      order.map((n, k) => `#${n}@${Math.round(c.cyl[n - 1].fire)}°`).join('  '),
      iv ? h('br') : null, iv ? 'Intervals: ' + iv.map(x => Math.round(x)).join(' / ') : ' (manual fire angles)'));
    this.root.append(this.section('layout', '⚙ LAYOUT & FIRING', ...kids));

    // ---------- cylinders
    const chips = h('div', { class: 'chips' }, c.cyl.map((cy, i) => h('button', {
      class: 'chip' + (i === sel ? ' on' : '') + (cy.angle > 1 ? ' b1' : cy.angle < -1 ? ' b0' : ''),
      onclick: () => { this.hooks.setSelected(i); this.render(); }
    }, String(i + 1))));
    const cy = c.cyl[sel];
    const setCyl = (k, v, rerender = false) => {
      const cyl = clone(this.cfg.cyl); cyl[sel][k] = v;
      const patch = { cyl };
      if (k === 'fire') patch.manualFire = true;
      rerender ? this.apply(patch) : this.live(patch);
    };
    const cylKids = [chips, h('p', { class: 'hint' }, 'Tap a chip or a cylinder in the diagram. Editing ', h('b', {}, `cylinder #${sel + 1}`), '.'),
      this.slider('Volume', cy.vol, 0, 2, 0.01, pct, (v) => setCyl('vol', v)),
      this.slider('Pitch / timbre', cy.tone, 40, 400, 1, (v) => v + ' Hz', (v) => setCyl('tone', v)),
      this.select('Pulse shape', cy.shape, SHAPES, (v) => setCyl('shape', v, true)),
      this.slider('Runner length', cy.runner, 10, 250, 1, (v) => v + ' cm', (v) => setCyl('runner', v)),
      this.slider('Misfire chance', cy.misfire, 0, 0.5, 0.005, pct, (v) => setCyl('misfire', v)),
      this.slider('Roughness', cy.rough, 0, 1, 0.01, pct, (v) => setCyl('rough', v)),
      this.slider(`Fire angle (of ${c.cycle}°)`, Math.round(cy.fire), 0, c.cycle - 1, 1, (v) => v + '°', (v) => setCyl('fire', v))];
    if (c.layout === 'custom') {
      cylKids.push(this.slider('Bank / tilt', cy.angle, -90, 90, 1, (v) => v + '°', (v) => setCyl('angle', v)));
      cylKids.push(this.slider('Position on crank', cy.pos, 0, 15, 0.5, (v) => String(v), (v) => setCyl('pos', v)));
    }
    cylKids.push(h('div', { class: 'row btns' },
      h('button', { class: 'hot', onclick: () => {
        const cur = this.cfg.cyl, src = cur[sel];
        this.apply({ cyl: cur.map(x => Object.assign({}, x, { vol: src.vol, tone: src.tone, shape: src.shape, runner: src.runner, misfire: src.misfire, rough: src.rough })) });
      } }, 'Apply to all'),
      h('button', { onclick: () => this.apply({ cyl: this.cfg.cyl.map(x => Object.assign({}, x, { misfire: 0 })) }) }, 'Clear misfires')));
    this.root.append(this.section('cyl', '🔥 CYLINDERS', ...cylKids));

    // ---------- engine globals
    const lv = (k, v) => this.live({ [k]: v });
    this.root.append(this.section('engine', '🛠 ENGINE',
      this.slider('Displacement', c.displacement, 0.1, 8.5, 0.05, (v) => v.toFixed(2) + ' L', (v) => lv('displacement', v)),
      this.slider('Idle', c.idleRpm, 400, 2500, 10, (v) => v + ' rpm', (v) => lv('idleRpm', v)),
      this.slider('Redline', c.redline, 2500, 20000, 100, (v) => v + ' rpm', (v) => lv('redline', v)),
      this.select('Limiter', c.limiter, LIMITERS, (v) => this.apply({ limiter: v })),
      this.slider('Flywheel inertia', c.inertia, 0.03, 1, 0.01, (v) => v.toFixed(2) + ' kg·m²', (v) => lv('inertia', v)),
      this.select('Induction', c.induction, INDUCTION, (v) => this.apply({ induction: v })),
      this.slider('Afterfire pops', c.pops, 0, 1, 0.01, pct, (v) => lv('pops', v))));

    // ---------- sound
    this.root.append(this.section('sound', '🔊 EXHAUST & SOUND',
      this.slider('Master volume', c.master, 0, 1.6, 0.01, pct, (v) => lv('master', v)),
      this.slider('Exhaust volume', c.exhaustVol, 0, 2, 0.01, pct, (v) => lv('exhaustVol', v)),
      this.slider('Muffler tone (dark→bright)', c.mufflerTone, 0, 1, 0.01, pct, (v) => lv('mufflerTone', v)),
      this.slider('Runner resonance', c.runnerReso, -0.9, 0.9, 0.01, (v) => v.toFixed(2), (v) => lv('runnerReso', v)),
      h('div', { class: 'row seg' }, h('span', {}, 'Exhaust'),
        ...[['single', 'Single'], ['dual', 'Dual (per bank)']].map(([v, t]) => h('button', { class: c.exhaust === v ? 'on' : '', onclick: () => this.apply({ exhaust: v }) }, t))),
      this.slider('Crossover (X-pipe)', c.crossover, 0, 1, 0.01, pct, (v) => lv('crossover', v)),
      this.slider('Intake noise', c.intakeVol, 0, 1.5, 0.01, pct, (v) => lv('intakeVol', v)),
      this.slider('Valvetrain', c.mechVol, 0, 1.5, 0.01, pct, (v) => lv('mechVol', v)),
      this.slider('Turbo / blower', c.inductionVol, 0, 1.5, 0.01, pct, (v) => lv('inductionVol', v)),
      this.slider('Light sync offset', Math.round(this.sim.visualOffset * 1000), -150, 250, 1, (v) => v + ' ms', (v) => { this.sim.visualOffset = v / 1000; }),
      h('p', { class: 'hint' }, 'Lights already compensate the reported output latency. Bluetooth headphones may need +100…200 ms.')));

    // ---------- car
    const neutral = this.sim.motor.neutral;
    this.root.append(this.section('car', '🚗 CAR & GEARBOX',
      h('div', { class: 'row seg' }, h('span', {}, 'Mode'),
        h('button', { class: !neutral ? 'on' : '', onclick: () => { this.sim.motor.setNeutral(false); this.render(); } }, 'Drive (auto)'),
        h('button', { class: neutral ? 'on' : '', onclick: () => { this.sim.motor.setNeutral(true); this.render(); } }, 'Neutral rev')),
      this.slider('Car mass', c.car.mass, 150, 3000, 10, (v) => v + ' kg', (v) => this.live({ car: Object.assign({}, this.cfg.car, { mass: v }) })),
      this.slider('Final drive', c.car.final, 2, 6, 0.05, (v) => v.toFixed(2), (v) => this.live({ car: Object.assign({}, this.cfg.car, { final: v }) })),
      h('p', { class: 'hint' }, `Gears: ${c.car.gears.join(' / ')} · press N to toggle neutral`)));

    // ---------- share
    const ta = h('textarea', { rows: 4, spellcheck: 'false', placeholder: 'Paste a config JSON here and press Import' });
    ta.addEventListener('keydown', (e) => e.stopPropagation());
    this.root.append(this.section('share', '💾 SAVE / SHARE',
      h('div', { class: 'row btns' },
        h('button', { onclick: () => { ta.value = JSON.stringify(this.sim.getConfig(), null, 1); ta.select(); try { navigator.clipboard.writeText(ta.value); } catch (e) { } } }, 'Export JSON'),
        h('button', { onclick: () => { try { this.sim.setConfig(JSON.parse(ta.value), { replace: true }); this.render(); } catch (e) { ta.value = 'Invalid JSON: ' + e.message; } } }, 'Import'),
        h('button', { onclick: (e) => this.downloadWav(e.target) }, 'Render 6 s WAV'))
      , ta));
    this.root.scrollTop = st;
  }

  downloadWav(btn) {
    btn.textContent = 'Rendering…';
    setTimeout(() => {
      const r = EngineSim.renderOffline({ config: this.sim.getConfig(), seconds: 6, drive: (t) => ({ gas: t > 0.6 && t < 4.6 ? 1 : 0, nitro: t > 3 && t < 4.2 }) });
      const blob = new Blob([EngineSim.encodeWav(r.left, r.right, r.sampleRate)], { type: 'audio/wav' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = (this.cfg.name || 'engine').replace(/\W+/g, '_') + '.wav'; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      btn.textContent = 'Render 6 s WAV';
    }, 30);
  }
}
