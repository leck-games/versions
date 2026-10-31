# Sine Rally · Engine Sim

A standalone, procedural **engine sound simulator** with a live engine diagram, built for
[Sine Rally](https://leck-games.github.io/sinerally/). No build step: plain `index.html` + ES modules.

**Live:** https://leck-games.github.io/sinerally-enginesim/

Tap **TAP TO START ENGINE** (needed for iPhone audio), then drive with **GAS / BRAKE / NITRO**.

## Controls
| Action | Touch | Keyboard |
|---|---|---|
| Gas | green button (multi-touch) | `W` / `↑` |
| Brake | red button | `S` / `↓` |
| Nitro | blue button | `Shift` / `Space` |
| Neutral rev mode on/off | Tune → Car | `N` |
| Open the Tune panel | ⚙ TUNE | `C` |
| Select a cylinder | tap it in the diagram or on its chip | |

URL options: `?preset=flatV8` (any preset key), `?autostart=1` (desktop/testing), `?sp=1` (force ScriptProcessor).

## What's simulated
**Sound (WebAudio, AudioWorklet with a ScriptProcessor fallback)**
- The crank angle is advanced every sample. Each cylinder fires at its own crank angle, which creates a combustion pulse (thump / bark / crack / brap / soft). The pulse has its own volume, pitch/timbre, roughness and misfire chance.
- Each pulse goes into its own **exhaust runner**, a feedback delay line whose length comes from the runner length in cm. From there it goes to the **bank collectors** (single or dual exhaust, with an X-pipe crossover), then the **muffler** (low-pass plus 2 resonators and a tailpipe comb), and finally a soft clipper.
- Also: block thump, intake roar, valvetrain ticks, turbo whine + blow-off valve, supercharger whine, nitro hiss + whoosh with harder combustion, afterfire pops on lift-off, and limiter pops.
- Unequal firing (cross-plane V8 burble, V-twin potato, odd-fire V10, boxer rumble) comes straight out of the crank geometry. It is not faked.

**Engine layouts:** inline 2–6, V2/V6/V8/V10/V12 (bank angle 15–180°, cross- or flat-plane V8, common-pin odd-fire or split-pin even-fire), boxer 2/4/6, single, rotary (2/3 rotors), **Custom** (1–16 cylinders, each with its own tilt and crank position).
Firing orders can be edited, and each layout has a default (I4 1-3-4-2, cross V8 1-8-4-3-6-5-7-2, I6 1-5-3-6-2-4, …). Fire angles are worked out from layout + crank + order. You can also drag any single cylinder's fire angle by hand. 2-stroke/4-stroke toggle.

**Visualization:** an isometric engine with moving pistons/rotors, a light on each cylinder that flashes **exactly when that cylinder is heard firing** (offset by the audio output latency), a combustion flash in the chamber, a firing timeline over 2 cycles, a crank-angle dial with every cylinder's fire angle marked, a tachometer with redline and shift lights, gear, km/h, a nitro tank, and LIMITER / NITRO / SHIFT badges. Misfires show red; nitro tints the flashes cyan.

**Motor model (gas/brake/nitro only):** a torque curve scaled by displacement and induction, friction and pumping losses, idle air control, flywheel inertia, a slipping launch clutch, car mass, aero and rolling drag, a 6- or 7-speed automatic (gear ratios per preset) with an ignition-cut upshift and a blipped downshift, brakes, and a nitro tank that drains and refills. Three limiter styles: hard-cut bounce, soft, and pops & bangs. All of these can be heard and seen.

## Presets
American V8 Muscle · Flat-plane V8 · Inline-6 · Boxer-4 Rumble (unequal headers) · Inline-4 Tuner (turbo) · V12 60° · Single-cyl Dirt Bike · 2-Stroke 125 · Rotary 2-rotor · Big V-Twin 45° · V10 90° odd-fire.

## Files
```
index.html, css/style.css
js/engine-dsp.js     DSP core (pure JS) + AudioWorklet processor registration (same file)
js/engine-config.js  layouts, firing orders, crank-angle derivation, presets
js/motor.js          gas/brake/nitro → rpm, gear, speed, load, spark cut
js/engine-sim.js     EngineSim: public API (audio graph, iOS unlock, visual sync, offline render)
js/viz.js            canvas diagram/gauges     js/ui.js  tune panel     js/main.js  app wiring
tools/render-wavs.mjs   node: render every preset offline, check for NaN/clipping/silence, --save WAVs
tools/test-browser.cjs  headless Chrome test (errors, worklet renders, screenshots)
samples/*.wav, shots/*.png
```

## API (short)
```js
import { EngineSim } from './js/engine-sim.js';
const sim = new EngineSim();            // default: American V8 (or { config: preset('flatV8') })
button.onclick = () => { sim.unlock(); sim.start(); };           // unlock() must run inside the tap
// A) built-in model
const tel = sim.drive({ gas: true, brake: false, nitro: false }, dt); // → {rpm, gear, speedKmh, limiter, ...}
// B) external telemetry (e.g. a game's vehicle)
sim.update({ rpm, throttle, load, nitro, spark, boost });
sim.loadPreset('flatV8'); sim.setConfig({ cylinders: 6, layout: 'inline' });
const vis = sim.getVisualState(); // per-cylinder lastFire times, crank angle, history (latency-compensated)
```
See **MERGE_NOTES.md** for the full API and how to plug it into Sine Rally.

## Testing
```
node tools/render-wavs.mjs [--save]       # offline DSP render of every preset (Node, no browser)
python3 -m http.server 18923 & node tools/test-browser.cjs http://127.0.0.1:18923/
```

## Known limitations
- **iOS:** audio only starts after a tap. On iOS 17+ `navigator.audioSession.type = 'playback'` makes it play with the ring/silent switch on; older iOS stays muted while the switch is on. When the tab is backgrounded or a call interrupts, the context is suspended; the next tap resumes it.
- Light sync uses `getOutputTimestamp()` / `outputLatency`. Safari reports these less accurately, and Bluetooth adds 100–250 ms that the browser often doesn't report. Use *Tune → Exhaust & Sound → Light sync offset* to correct it.
- At high rpm on 8–16 cylinders, the screen refreshes only 60 (or 120) times a second while the engine fires hundreds of times a second. So each light shows a short decaying glow rather than a single crisp frame per firing, and the timeline strip shows every event.
- This is a stylised physical model, not a CFD exhaust simulation. Changing config while a pulse is playing can click once.
- 16 cylinders at 48 kHz uses roughly 2–4% of one core on desktop. On an older iPhone, keep the cylinder count sensible if other audio is running.
