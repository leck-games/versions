// main.js — wires EngineSim + EngineViz + ConfigPanel + pedals/keyboard.
import { EngineSim } from './engine-sim.js';
import { preset, PRESET_ORDER } from './engine-config.js';
import { EngineViz } from './viz.js';
import { ConfigPanel } from './ui.js';

const qs = new URLSearchParams(location.search);
const startPreset = PRESET_ORDER.includes(qs.get('preset')) ? qs.get('preset') : 'muscleV8';
const sim = new EngineSim({ config: preset(startPreset), forceScriptProcessor: qs.has('sp') });
const viz = new EngineViz(document.getElementById('viz'));
let selected = 0;
const panel = new ConfigPanel(document.getElementById('panel-body'), sim, {
  getSelected: () => selected,
  setSelected: (i) => { selected = i; viz.selected = i; }
});
viz.onSelect = (i) => { selected = i; panel.render(); document.body.classList.add('panel-open'); panel.open.cyl = true; panel.render(); };

// ---------------- input ----------------
const input = { gas: false, brake: false, nitro: false };
const touchHeld = { gas: new Set(), brake: new Set(), nitro: new Set() };
const keyHeld = { gas: false, brake: false, nitro: false };
const sync = () => {
  for (const k of ['gas', 'brake', 'nitro']) {
    input[k] = keyHeld[k] || touchHeld[k].size > 0;
    const b = document.querySelector(`.pedal[data-k="${k}"]`); if (b) b.classList.toggle('down', input[k]);
  }
};
document.querySelectorAll('.pedal').forEach((b) => {
  const k = b.dataset.k;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); try { b.setPointerCapture(e.pointerId); } catch (_) { } touchHeld[k].add(e.pointerId); sync(); });
  const up = (e) => { touchHeld[k].delete(e.pointerId); sync(); };
  b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  b.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
});
const keyMap = { KeyW: 'gas', ArrowUp: 'gas', KeyS: 'brake', ArrowDown: 'brake', ShiftLeft: 'nitro', ShiftRight: 'nitro', Space: 'nitro' };
const typing = (e) => /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range';
window.addEventListener('keydown', (e) => {
  if (typing(e)) return;
  ensureAudio();
  const k = keyMap[e.code];
  if (k) { keyHeld[k] = true; sync(); e.preventDefault(); return; }
  if (e.code === 'KeyN') { sim.motor.setNeutral(!sim.motor.neutral); panel.render(); }
  if (e.code === 'KeyC') togglePanel();
});
window.addEventListener('keyup', (e) => { const k = keyMap[e.code]; if (k) { keyHeld[k] = false; sync(); } });
window.addEventListener('blur', () => { for (const k in keyHeld) keyHeld[k] = false; for (const k in touchHeld) touchHeld[k].clear(); sync(); });

// ---------------- audio unlock ----------------
const overlay = document.getElementById('start');
const status = document.getElementById('status');
let started = false;
function ensureAudio() {
  // must run synchronously inside the gesture for iOS
  sim.unlock();
  if (!started) {
    started = true;
    sim.start().then(() => {
      overlay.classList.add('gone');
      status.textContent = sim.mode === 'worklet' ? 'AudioWorklet' : 'ScriptProcessor';
    }).catch((err) => { console.error(err); status.textContent = 'Audio error: ' + err.message; started = false; });
  }
}
overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); });
// any later gesture re-unlocks (iOS may 'interrupt' the context after calls / Siri / backgrounding)
window.addEventListener('pointerdown', () => { if (sim.ctx && sim.ctx.state !== 'running') sim.unlock(); }, true);
if (qs.has('autostart')) ensureAudio();

// ---------------- panel toggle ----------------
function togglePanel(force) { document.body.classList.toggle('panel-open', force); }
document.getElementById('cfg-btn').addEventListener('click', () => togglePanel());
document.getElementById('panel-close').addEventListener('click', () => togglePanel(false));

// ---------------- loop ----------------
let last = performance.now(), tel = null;
function frame(t) {
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t;
  tel = sim.drive(input, dt);
  const vis = sim.getVisualState();
  if (!started || sim.mode === 'none') { vis.rpm = tel.rpm; }
  viz.draw(sim.config, vis, tel);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.engineSim = sim;
window.__app = { sim, viz, panel, input, get tel() { return tel; } };
