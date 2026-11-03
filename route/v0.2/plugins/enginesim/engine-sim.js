// engine-sim.js — public API. Wraps EngineDSP in an AudioWorklet (ScriptProcessor fallback),
// optionally drives it from the built-in MotorModel, and exposes latency-compensated
// firing events for visualisation.
import { EngineDSP } from './engine-dsp.js';
import { deriveEngine, toDspConfig, preset, clone } from './engine-config.js';
import { MotorModel } from './motor.js';

const WORKLET_URL = new URL('./engine-dsp.js', import.meta.url);

export class EngineSim {
  /**
   * @param {object} [opts]
   * @param {object} [opts.config]  full or partial engine config (see engine-config.js); default American V8
   * @param {AudioContext} [opts.context]  reuse an existing context (e.g. the game's)
   * @param {AudioNode} [opts.destination] where to connect (default context.destination)
   * @param {boolean} [opts.forceScriptProcessor]
   */
  constructor(opts = {}) {
    this.config = deriveEngine(opts.config || preset('muscleV8'));
    this.motor = new MotorModel(this.config);
    this.ctx = opts.context || null;
    this.dest = opts.destination || null;
    this.forceSP = !!opts.forceScriptProcessor;
    this.node = null; this.out = null; this.mode = 'none';
    this.params = { rpm: this.config.idleRpm, throttle: 0, load: 0, nitro: 0, spark: 1, boost: 0 };
    this.pending = []; this.history = [];
    this.lastFire = new Float64Array(16).fill(-1e9); this.lastKind = new Int8Array(16);
    this.report = { t: 0, crank: 0, rpm: this.config.idleRpm, cycle: this.config.cycle };
    this.stats = { peak: 0, nan: 0, msgs: 0 };
    this.visualOffset = 0; // seconds, user tweak for bluetooth etc.
    this.volume = 1; this.listeners = new Set();
    this._starting = null;
    this.manageContext = opts.manageContext !== false; // false = host owns suspend/resume (plugin mode)
  }

  // ---- lifecycle -------------------------------------------------------------------------
  /** Call synchronously inside a user gesture (tap/click/key). Creates/resumes the context (iOS unlock). */
  unlock() {
    // iOS 16.4+: 'playback' puts Web Audio on the media channel so the Ring/Silent switch doesn't mute it.
    // Set it inside the gesture, before the context is created/resumed.
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { }
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { this.ctx = new AC(); }
    }
    if (this.ctx.state !== 'running') { try { this.ctx.resume(); } catch (e) { } }
    try { // classic iOS unlock: play a 1-sample silent buffer inside the gesture
      const b = this.ctx.createBuffer(1, 1, 22050), s = this.ctx.createBufferSource();
      s.buffer = b; s.connect(this.ctx.destination); s.start(0);
    } catch (e) { }
    return this.ctx;
  }

  /** Build the audio graph (async: loads the worklet module). Safe to call repeatedly. */
  start() {
    if (this._starting) return this._starting;
    if (!this.ctx) this.unlock();
    this._starting = this._build();
    return this._starting;
  }

  async _build() {
    const ctx = this.ctx;
    this.out = ctx.createGain(); this.out.gain.value = this.volume;
    this.out.connect(this.dest || ctx.destination);
    const dspCfg = toDspConfig(this.config);
    if (!this.forceSP && ctx.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        await ctx.audioWorklet.addModule(WORKLET_URL.href);
        this.node = new AudioWorkletNode(ctx, 'engine-sim', {
          numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
          processorOptions: { cfg: dspCfg, params: this.params, postEvery: 2 }
        });
        this.node.port.onmessage = (e) => this._onMsg(e.data);
        this.node.connect(this.out);
        this.mode = 'worklet';
      } catch (err) { console.warn('[EngineSim] AudioWorklet failed, falling back to ScriptProcessor', err); this.node = null; }
    }
    if (!this.node) {
      const sr = ctx.sampleRate, size = 1024;
      this.dsp = new EngineDSP(sr, dspCfg); this.dsp.setParams(this.params);
      const sp = ctx.createScriptProcessor(size, 1, 2);
      sp.onaudioprocess = (e) => {
        const ob = e.outputBuffer, L = ob.getChannelData(0), R = ob.numberOfChannels > 1 ? ob.getChannelData(1) : new Float32Array(L.length);
        const t0 = (e.playbackTime || (ctx.currentTime + size / sr));
        const f0 = Math.round(t0 * sr);
        this.dsp.process(L, R, L.length, f0);
        const d = this.dsp;
        this._onMsg({ type: 'ev', ev: d.events, frame: f0 + L.length, crank: d.crankDeg(), rpm: d.s.rpm, cycle: d.cycle, peak: d.peak, nan: d.nan });
        d.events = []; d.peak = 0;
      };
      // ScriptProcessor needs an input connection on some WebKit builds
      const silent = ctx.createConstantSource ? ctx.createConstantSource() : null;
      if (silent) { silent.offset.value = 0; silent.connect(sp); silent.start(); }
      sp.connect(this.out);
      this.node = sp; this.mode = 'scriptprocessor';
    }
    if (this.manageContext && !this._vis) {
      this._vis = () => {
        if (!this.ctx) return;
        if (document.hidden) this.ctx.suspend().catch(() => { }); else this.ctx.resume().catch(() => { });
      };
      document.addEventListener('visibilitychange', this._vis);
    }
    return this;
  }

  _onMsg(m) {
    if (m.type !== 'ev') return;
    const sr = this.ctx.sampleRate, ev = m.ev;
    for (let i = 0; i < ev.length; i += 3) this.pending.push({ cyl: ev[i], t: ev[i + 1] / sr, kind: ev[i + 2] });
    this.report.t = m.frame / sr; this.report.crank = m.crank; this.report.rpm = m.rpm; this.report.cycle = m.cycle;
    this.stats.peak = Math.max(this.stats.peak * 0.995, m.peak); this.stats.nan = m.nan; this.stats.msgs++;
  }

  _post(msg) {
    if (!this.node) return;
    if (this.mode === 'worklet') this.node.port.postMessage(msg);
    else if (this.dsp) { if (msg.type === 'config') this.dsp.setConfig(msg.cfg); else if (msg.type === 'params') this.dsp.setParams(msg.p); }
  }

  // ---- configuration ---------------------------------------------------------------------
  /** Replace or patch the engine config. Pass {..., cyl:[...]} etc. Returns the derived config. */
  setConfig(patch, { replace = false } = {}) {
    const merged = replace ? clone(patch) : Object.assign(clone(this.config), clone(patch));
    this.config = deriveEngine(merged);
    this.motor.setConfig(this.config);
    this._post({ type: 'config', cfg: toDspConfig(this.config) });
    this.lastFire.fill(-1e9);
    return this.config;
  }
  getConfig() { return clone(this.config); }
  loadPreset(key) { return this.setConfig(preset(key), { replace: true }); }

  // ---- driving ---------------------------------------------------------------------------
  /**
   * External telemetry mode (e.g. from Sine Rally's vehicle). All fields optional.
   * @param {{rpm?:number, throttle?:number, load?:number, nitro?:number|boolean, spark?:number, boost?:number}} p
   */
  update(p) {
    const q = this.params;
    if (p.rpm !== undefined) q.rpm = Math.max(0, +p.rpm);
    if (p.throttle !== undefined) q.throttle = +p.throttle;
    if (p.load !== undefined) q.load = +p.load;
    if (p.nitro !== undefined) q.nitro = p.nitro ? 1 : 0;
    if (p.spark !== undefined) q.spark = +p.spark;
    if (p.boost !== undefined) q.boost = +p.boost;
    this._post({ type: 'params', p: q });
  }

  /** Built-in model mode: just GAS / BRAKE / NITRO. Returns motor telemetry (rpm, gear, speedKmh, ...). */
  drive(inp, dt) {
    const o = this.motor.step(dt, inp);
    this.update(o);
    return o;
  }

  setVolume(v) { this.volume = v; if (this.out) this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02); }

  // ---- visual sync -----------------------------------------------------------------------
  /** Context time of the sample currently leaving the speaker. */
  heardTime() {
    const c = this.ctx; if (!c) return 0;
    const fallback = c.currentTime - (c.outputLatency || 0) - (c.baseLatency || 0);
    if (c.getOutputTimestamp) {
      const ts = c.getOutputTimestamp();
      if (ts && ts.contextTime > 0 && ts.performanceTime > 0) {
        const t = ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
        if (Math.abs(t - fallback) < 0.25) return t - this.visualOffset;
      }
    }
    return fallback - this.visualOffset;
  }

  /** Call once per animation frame. Returns per-cylinder flash state, crank angle and recent firing history. */
  getVisualState() {
    const now = this.heardTime();
    const p = this.pending;
    let k = 0;
    while (k < p.length && p[k].t <= now) {
      const e = p[k++];
      if (e.cyl < 16) {
        if (e.kind !== 2) { this.lastFire[e.cyl] = e.t; this.lastKind[e.cyl] = e.kind; }
        this.history.push(e);
        for (const fn of this.listeners) fn(e);
      }
    }
    if (k) p.splice(0, k);
    if (p.length > 4000) p.splice(0, p.length - 4000);
    while (this.history.length && this.history[0].t < now - 3) this.history.shift();
    const r = this.report;
    const dtc = Math.max(-0.2, Math.min(0.2, now - r.t));
    const cycle = r.cycle || this.config.cycle;
    const crank = (((r.crank + r.rpm * 6 * dtc) % cycle) + cycle) % cycle;
    return { now, crank, cycle, rpm: r.rpm, lastFire: this.lastFire, lastKind: this.lastKind, history: this.history, mode: this.mode };
  }

  /** Subscribe to firing events (fired when the event is *heard*, i.e. after output latency). */
  onFire(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  dispose() {
    try { this._post({ type: 'stop' }); this.node && this.node.disconnect(); this.out && this.out.disconnect(); } catch (e) { }
    this.node = null; this._starting = null;
  }

  // ---- offline rendering -----------------------------------------------------------------
  /**
   * Synchronous offline render on the calling thread (no AudioContext needed).
   * drive(t) -> {gas,brake,nitro} uses the MotorModel; telemetry(t) -> {rpm,throttle,...} bypasses it.
   */
  static renderOffline({ config, seconds = 3, sampleRate = 44100, drive, telemetry, neutral = false, block = 128 } = {}) {
    const cfg = deriveEngine(config || preset('muscleV8'));
    const dsp = new EngineDSP(sampleRate, toDspConfig(cfg));
    const motor = new MotorModel(cfg); motor.setNeutral(neutral);
    const N = Math.floor(seconds * sampleRate);
    const L = new Float32Array(N), R = new Float32Array(N);
    let fires = 0, pops = 0; const trace = [];
    for (let f = 0; f < N; f += block) {
      const n = Math.min(block, N - f), t = f / sampleRate;
      let p;
      if (telemetry) p = telemetry(t);
      else { p = motor.step(n / sampleRate, drive ? drive(t) : { gas: 0 }); }
      dsp.setParams(p);
      dsp.process(L.subarray(f, f + n), R.subarray(f, f + n), n, f);
      for (let i = 2; i < dsp.events.length; i += 3) { if (dsp.events[i] === 0) fires++; else if (dsp.events[i] === 2) pops++; }
      dsp.events = [];
      if (f % (block * 64) === 0) trace.push({ t: +t.toFixed(2), rpm: Math.round(p.rpm), gear: p.gear });
    }
    return { left: L, right: R, sampleRate, stats: EngineSim.analyze(L, R, sampleRate), fires, pops, nanEvents: dsp.nan, trace };
  }

  /** Render through the real AudioWorklet in an OfflineAudioContext (browser only). script = keyframes [{t,rpm,throttle,...}] */
  static async renderOfflineWorklet({ config, seconds = 2, sampleRate = 44100, params, script } = {}) {
    const cfg = deriveEngine(config || preset('muscleV8'));
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, Math.floor(seconds * sampleRate), sampleRate);
    await ctx.audioWorklet.addModule(WORKLET_URL.href);
    const node = new AudioWorkletNode(ctx, 'engine-sim', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { cfg: toDspConfig(cfg), params: params || { rpm: cfg.idleRpm * 2, throttle: 0.5, load: 0.5 }, script, postEvery: 1000000 }
    });
    node.connect(ctx.destination);
    const buf = await ctx.startRendering();
    const L = buf.getChannelData(0), R = buf.getChannelData(1);
    return { left: L, right: R, sampleRate, stats: EngineSim.analyze(L, R, sampleRate) };
  }

  static analyze(L, R, sr) {
    let peak = 0, sum = 0, nan = 0, clip = 0, n = L.length;
    for (let i = 0; i < n; i++) {
      const a = L[i], b = R[i];
      if (a !== a || b !== b) { nan++; continue; }
      const x = Math.max(Math.abs(a), Math.abs(b));
      if (x > peak) peak = x; if (x >= 0.999) clip++;
      sum += a * a + b * b;
    }
    return { peak: +peak.toFixed(4), rms: +Math.sqrt(sum / (2 * n)).toFixed(4), nan, clip, seconds: +(n / sr).toFixed(2) };
  }

  /** 16-bit PCM stereo WAV */
  static encodeWav(L, R, sr) {
    const n = L.length, buf = new ArrayBuffer(44 + n * 4), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 4, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 4, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      v.setInt16(o, Math.max(-1, Math.min(1, L[i])) * 32767, true); v.setInt16(o + 2, Math.max(-1, Math.min(1, R[i])) * 32767, true); o += 4;
    }
    return buf;
  }
}

export { MotorModel, deriveEngine, preset };
