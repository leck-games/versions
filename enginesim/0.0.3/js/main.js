// main.js — standalone demo. It is a *host* for the Engine Sound Plugin API v1 (plugin.js), the same
// module Sine Rally vendors, plus the tuning UI (ConfigPanel) and the diagram (EngineViz).
import { EngineSim } from './engine-sim.js';
import * as enginePlugin from './plugin.js';
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
let started = false, ctx = null, master = null, plugin = null;
function unlockCtx() { // host-side iOS unlock: must run synchronously inside the gesture
  try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { } // iOS 16.4+: play with the silent switch on
  if (!ctx) { const AC = window.AudioContext || window.webkitAudioContext; try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { ctx = new AC(); } }
  if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) { } }
  try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { }
}
function ensureAudio() {
  unlockCtx();
  if (!started) {
    started = true;
    master = ctx.createGain(); master.connect(ctx.destination);
    enginePlugin.create(ctx, master, { engine: sim, rpmMode: 'absolute', forceScriptProcessor: qs.has('sp') }).then((inst) => {
      plugin = inst;
      overlay.classList.add('gone');
      status.textContent = sim.mode === 'worklet' ? 'AudioWorklet' : 'ScriptProcessor';
    }).catch((err) => { console.error(err); status.textContent = 'Audio error: ' + err.message; started = false; });
  }
}
document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend().catch(() => { }); else ctx.resume().catch(() => { }); });
overlay.addEventListener('pointerdown', (e) => { e.preventDefault(); ensureAudio(); });
// any later gesture re-unlocks (iOS may 'interrupt' the context after calls / Siri / backgrounding)
window.addEventListener('pointerdown', () => { if (ctx && ctx.state !== 'running') unlockCtx(); }, true);
if (qs.has('autostart')) ensureAudio();

// ---------------- panel toggle ----------------
function togglePanel(force) { document.body.classList.toggle('panel-open', force); }
document.getElementById('cfg-btn').addEventListener('click', () => togglePanel());
document.getElementById('panel-close').addEventListener('click', () => togglePanel(false));

// ---------------- loop ----------------
let last = performance.now(), tel = null;
function frame(t) {
  const dt = Math.min(0.05, Math.max(0, (t - last) / 1000)); last = t;
  tel = sim.motor.step(dt, input);
  if (plugin) plugin.update({ // API v1 telemetry, built from the demo's own gas/brake/nitro motor model
    rpm: tel.rpm, idleRpm: sim.config.idleRpm, redlineRpm: sim.config.redline, throttle: tel.throttle, brake: input.brake ? 1 : 0,
    load: tel.load, nitro: !!tel.nitro, nitroStrength: tel.nitro ? 1 : 0, nitroTank: tel.nitroTank, gear: tel.gear === 'N' ? 0 : tel.gear,
    shifting: tel.shifting, limiter: tel.limiter, ignition: tel.spark, turbo: tel.boost, speed: tel.speedKmh / 3.6, paused: false
  }, dt);
  const vis = sim.getVisualState();
  if (!started || sim.mode === 'none') { vis.rpm = tel.rpm; }
  viz.draw(sim.config, vis, tel);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.engineSim = sim;
window.__app = { sim, viz, panel, input, get plugin() { return plugin; }, get tel() { return tel; } };
