// example-simple-engine.js — a minimal third-party Sine Rally engine sound plugin (API v1, see PLUGIN_API.md).
// Two detuned oscillators at the firing frequency through a throttle-controlled low-pass, plus a noise pop for
// backfires. Self-contained single file (no imports), so it also works when loaded from a local file or by URL.
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const CYL = { v8: 8, twin: 2, single: 1 };

export default {
  id: 'example-simple', name: 'Simple oscillator engine (example)', apiVersion: 1, version: '1.0.0',
  presets: [{ id: 'v8', name: 'Saw V8' }, { id: 'twin', name: 'Square twin' }, { id: 'single', name: 'Buzzy single' }],
  defaultPreset: 'v8', vehiclePresets: { buggy: 'twin', truck: 'v8', quad: 'single' },

  create(ctx, destination, options = {}) {
    let cyl = CYL[options.preset] || 8;
    const out = ctx.createGain(); out.gain.value = 0; out.connect(destination);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4; lp.connect(out);
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'sawtooth'; b.type = 'square'; b.detune.value = -1210; // b ≈ one octave lower, slightly detuned
    const bg = ctx.createGain(); bg.gain.value = 0.5;
    a.connect(lp); b.connect(bg).connect(lp); a.start(); b.start();
    const nb = ctx.createBuffer(1, ctx.sampleRate * 0.08, ctx.sampleRate), d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (d.length * 0.2));
    let dip = 0;
    return {
      get preset() { return Object.keys(CYL).find(k => CYL[k] === cyl); },
      setPreset(id) { if (CYL[id]) cyl = CYL[id]; },
      update(t, dt) {                       // called once per frame: keep it cheap, only automate params
        const now = ctx.currentTime, f = Math.max(20, t.rpm / 60 * cyl / 2);
        a.frequency.setTargetAtTime(f, now, 0.02); b.frequency.setTargetAtTime(f, now, 0.02);
        lp.frequency.setTargetAtTime(300 + 2500 * t.throttle + f * 2 + (t.nitro ? 1500 : 0), now, 0.03);
        dip = Math.max(0, dip - dt);
        const g = t.paused ? 0 : (0.08 + 0.17 * t.throttle) * (t.ignition === 0 || dip > 0 ? 0.35 : 1);
        out.gain.setTargetAtTime(g, now, 0.03);
      },
      event(name, data) {
        if (name === 'shift') dip = 0.12;
        if (name === 'backfire') {
          const s = ctx.createBufferSource(), g = ctx.createGain();
          s.buffer = nb; g.gain.value = 0.3 + 0.5 * clamp(data.strength || 0.5, 0, 1);
          s.connect(g).connect(destination); s.start();
        }
      },
      dispose() { try { a.stop(); b.stop(); } catch (e) { } out.disconnect(); }
    };
  }
};
