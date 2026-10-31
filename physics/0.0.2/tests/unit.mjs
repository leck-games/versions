// Headless unit/integration tests (Node >= 18): node tests/unit.mjs   (MODE=normal node tests/unit.mjs for the NORMAL handling model)
import * as THREE from '../lib/three.module.js';
import * as PH from '../physics/index.js';
import { listVehicles } from '../vehicles/index.js';
import { createStubWorld } from '../world/stub-world.js';
import { createRig } from '../host/rig.js';
import { pilot, kmh } from './sim.mjs';
import { topSpeed, flatWorld } from './topspeed.mjs';
const MODE = process.env.MODE || 'arcade';
console.log('handling mode: ' + MODE.toUpperCase());
let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log('  ok   ' + msg); } else { fails++; console.log('  FAIL ' + msg); } };
const DT = 1 / 120;
function rigFor(id, attach, world = createStubWorld()) {
  const ev = []; const rig = createRig({ THREE, world, emit: (type, d) => ev.push({ type, t: rig.state ? rig.state.time : 0, ...d }) });
  rig.setVehicle(id, attach); rig.setMode(MODE); rig.ev = ev; return rig;
}
const drive = (rig, secs, fn) => { for (let i = 0, n = Math.round(secs / DT); i < n; i++) { const s = rig.state; rig.step(fn(s, s.time), DT); if (rig.stop && rig.stop(s)) break; } };

// 1 ---- tree HP curve
console.log('\n[1] tree damage curve  treeDamage(kmh, angle)  (angle = normal fraction of impact velocity: 1 head-on, 0 grazing)');
const angles = [0, 0.25, 0.5, 0.75, 1], speeds = [20, 30, 50, 80, 100, 120, 150, 180, 200, 220, 250, 280, 300, 350];
console.log('  km/h | ' + angles.map(a => ('a=' + a).padStart(6)).join(' '));
for (const v of speeds) console.log('  ' + String(v).padStart(4) + ' | ' + angles.map(a => PH.treeDamage(v, a).toFixed(2).padStart(6)).join(' '));
ok(angles.every(a => PH.treeDamage(300, a) === 3 && PH.treeDamage(350, a) === 3), '>= 300 km/h removes all 3 HP at any angle');
ok(Math.abs(PH.treeDamage(200, 1) - 2) < 1e-9, 'head-on 200 km/h = 2 HP');
ok(PH.treeDamage(30, 1) === 0 && PH.treeDamage(20, 1) === 0, 'slow taps (<= 30 km/h) do 0');
let mono = true; for (const a of angles) for (let v = 0; v < 400; v += 1) if (PH.treeDamage(v + 1, a) < PH.treeDamage(v, a) - 1e-9) mono = false;
for (let v = 0; v < 400; v += 5) for (let i = 1; i < angles.length; i++) if (PH.treeDamage(v, angles[i]) < PH.treeDamage(v, angles[i - 1]) - 1e-9) mono = false;
ok(mono, 'monotonic in speed and angle');
let cont = true; for (const a of angles) for (const v of [200, 300]) if (Math.abs(PH.treeDamage(v + 0.01, a) - PH.treeDamage(v - 0.01, a)) > 0.01) cont = false;
ok(cont, 'continuous at 200 and 300 km/h (smooth interpolation)');

// 2 ---- 300 km/h pass-through
console.log('\n[2] SINE GT + nitro through gate tree g1 (x=0, z=700)');
{ const r = rigFor('hyper', []); let pre = 0;
  drive(r, 16, s => { pre = kmh(s); return pilot(s, 0, { boost: 1 }); });
  const d = r.ev.find(e => e.type === 'tree:damage' && e.id === 'g1'), x = r.ev.find(e => e.type === 'tree:destroyed' && e.id === 'g1');
  const hitI = r.ev.indexOf(d);
  console.log(`  impact ${d && d.speed.toFixed(1)} km/h, removed ${d && d.hp}, remaining ${d && d.remaining}; car now z=${r.state.p.z.toFixed(0)} ${kmh(r.state).toFixed(0)} km/h`);
  ok(d && d.speed >= 300, 'hit at >= 300 km/h'); ok(d && d.hp === 3 && x, 'all 3 HP removed, tree:destroyed emitted');
  ok(hitI >= 0 && !r.ev.some(e => e.type === 'tree:hit' && e.id === 'g1'), 'no solid hit (car zoomed through)');
  ok(r.state.p.z > 900, 'car continued past the gate');
  ok(r.world.queryTrees(0, 700, 3).every(t => t.id !== 'g1'), 'destroyed tree stays gone (worldQuery no longer returns it)');
  // speed loss measured in a controlled single-step test
  const r2 = rigFor('hyper', []); const s = r2.state; PH.spawn(s, r2.world, 0, 690, 0); drive(r2, 0.3, () => ({}));
  s.v.z = 310 / 3.6; s.v.x = 0; for (const w of s.wheels) w.omega = s.v.z / s.P.wheelR; s.gear = 7; const v0 = kmh(s);
  drive(r2, 0.3, s => pilot(s, 0, { boost: 1 })); const v1 = kmh(s), lost = (v0 - v1) / v0;
  console.log(`  controlled: ${v0.toFixed(0)} -> ${v1.toFixed(0)} km/h over 0.3 s incl. drag (${(lost * 100).toFixed(1)} %)`);
  ok(lost < 0.06 && r2.ev.some(e => e.type === 'tree:destroyed' && e.id === 'g1'), 'minimal speed loss (< 6 %) at 310 km/h');
}

// 3 ---- below 200: solid tree, bounce/stop, partial HP
console.log('\n[3] buggy head-on into gate tree g1 at ~190 km/h, then a 60 km/h tap on practice tree');
{ const r = rigFor('buggy', []); r.stop = s => r.ev.some(e => e.type === 'tree:hit');
  drive(r, 30, s => pilot(s, 0));
  const d = r.ev.find(e => e.type === 'tree:damage'), h = r.ev.find(e => e.type === 'tree:hit');
  console.log(`  impact ${d && d.speed.toFixed(0)} km/h removed ${d && d.hp} HP remaining ${d && d.remaining}; car speed after ${kmh(r.state).toFixed(0)} km/h, damage ${r.state.damage.toFixed(1)}`);
  ok(d && d.hp > 1.5 && d.hp < 2.1 && d.remaining > 0, '~2 HP removed, tree survives');
  ok(h && kmh(r.state) < 60, 'tree stays solid: car bounced/stopped');
  ok(r.state.damage > 3, 'car took damage scaled to remaining HP');
  const r2 = rigFor('buggy', []); PH.spawn(r2.state, r2.world, -2.5, 40, 0); r2.stop = s => r2.ev.some(e => e.type === 'tree:hit');
  drive(r2, 10, s => ({ ...pilot(s, -2.5), gas: kmh(s) < 60 ? 1 : 0 }));
  const d2 = r2.ev.find(e => e.type === 'tree:damage'), h2 = r2.ev.find(e => e.type === 'tree:hit');
  console.log(`  60 km/h tap: ${h2 ? h2.speed.toFixed(0) : '-'} km/h removed ${d2 ? d2.hp : 0} remaining ${d2 ? d2.remaining : 3}`);
  ok(h2 && d2 && d2.hp < 0.5 && d2.remaining > 2.5, 'slow hit removes a little HP only');
}

// 4 ---- 250 km/h interpolation (SINE GT without nitro reaches ~250 before the gate)
console.log('\n[4] SINE GT without nitro, ~250 km/h into g1');
{ const r = rigFor('hyper', []); r.stop = s => r.ev.some(e => e.type === 'tree:damage');
  drive(r, 30, s => ({ ...pilot(s, 0), gas: kmh(s) < 250 ? 1 : 0 })); const d = r.ev.find(e => e.type === 'tree:damage');
  console.log(`  impact ${d && d.speed.toFixed(0)} km/h removed ${d && d.hp} (curve says ${d && PH.treeDamage(d.speed, d.angle).toFixed(2)})`);
  ok(d && Math.abs(d.hp - Math.min(3, PH.treeDamage(d.speed, d.angle))) < 0.02, 'impact HP matches the curve');
}

// 5 ---- harvester
console.log('\n[5] TIMBERWOLF + harvester + log rack, crawling into practice tree (x=-2.5, z=90)');
{ const r = rigFor('forester', ['harvester', 'lograck']); const s = r.state; PH.spawn(s, r.world, -2.5, 60, 0); const m0 = PH.massOf(s);
  r.stop = s => r.ev.some(e => e.type === 'tree:destroyed');
  drive(r, 40, s => ({ ...pilot(s, -2.5), gas: kmh(s) < 12 ? 0.6 : 0 }));
  const x = r.ev.find(e => e.type === 'tree:destroyed'), dmg = r.ev.filter(e => e.type === 'tree:damage');
  console.log(`  ${dmg.length} tree:damage events, causes: ${[...new Set(dmg.map(e => e.cause))]}; logs ${s.cargo.logs}/${s.cargo.capacity}; mass ${m0} -> ${PH.massOf(s)} kg; car damage ${s.damage.toFixed(1)}`);
  ok(x && x.cause === 'harvest', 'tree felled by the harvester (cause harvest)');
  ok(s.cargo.logs === 3, '3 logs added to cargo (1 per HP)');
  ok(PH.massOf(s) === m0 + 3 * s.cargo.logMass, 'log mass added to physics mass');
  ok(s.damage === 0 && !r.ev.some(e => e.type === 'crash'), 'no smash, no car damage');
  ok(r.ev.some(e => e.type === 'harvester:log'), 'harvester:log events');
  // full cargo -> still melts the tree, just no more logs
  s.cargo.logs = s.cargo.capacity; const n0 = r.ev.length; PH.spawn(s, r.world, 2.5, 60, 0); r.stop = null;
  drive(r, 12, s => ({ ...pilot(s, 2.5), gas: kmh(s) < 12 ? 0.6 : 0 }));
  const after = r.ev.slice(n0);
  ok(after.some(e => e.type === 'harvester:full') && after.some(e => e.type === 'tree:destroyed') && s.cargo.logs === s.cargo.capacity, 'cargo full -> harvester:full, tree still melted, logs capped');
}

// 6 ---- bull bar
console.log('\n[6] bull bar vs none: truck at ~120 km/h into g1');
{ const res = {};
  for (const a of [[], ['bullbar']]) { const r = rigFor('truck', a); PH.spawn(r.state, r.world, 0, 560, 0); r.stop = s => r.ev.some(e => e.type === 'tree:hit' || e.type === 'tree:destroyed');
    drive(r, 30, s => ({ ...pilot(s, 0), gas: kmh(s) < 120 ? 1 : 0 })); const d = r.ev.find(e => e.type === 'tree:damage');
    res[a[0] || 'none'] = { tree: d ? d.hp : 0, car: r.state.damage, kmh: d ? d.speed : 0 }; }
  console.log('  ' + JSON.stringify(res, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v));
  ok(res.bullbar.tree > res.none.tree * 1.3, 'more tree damage with bull bar'); ok(res.bullbar.car < res.none.car * 0.6, 'less car damage with bull bar');
}

// 7 ---- heat
console.log('\n[7] heat: rev on the limiter standing still (gas + brake)');
{ const r = rigFor('buggy', []); drive(r, 14, () => ({ gas: 1, brake: 1 }));
  const hot = r.ev.filter(e => e.type === 'engine:hot'), ov = r.ev.find(e => e.type === 'engine:overheat');
  console.log(`  temp ${r.state.heat.temp.toFixed(1)} C, ${hot.length} engine:hot, overheat at t=${ov && ov.t.toFixed(1)} s ${ov && JSON.stringify(ov.position)}`);
  ok(hot.length >= 3 && hot.every(e => Array.isArray(e.position) && e.intensity > 0 && e.intensity <= 1), 'periodic engine:hot {position, intensity}');
  ok(ov && ov.temp >= PH.HEAT.overheat && ov.position.length === 3, 'engine:overheat {position, temp}');
  ok(r.state.heat.over, 'overheated state set (torque derate, nitro disabled)');
  drive(r, 40, () => ({})); ok(!r.state.heat.over && r.ev.some(e => e.type === 'engine:cooled'), 'cools at idle -> engine:cooled');
  const r2 = rigFor('buggy', []); drive(r2, 20, s => pilot(s, -9)); ok(r2.state.heat.temp < PH.HEAT.overheat, `normal full-throttle driving stays below overheat (${r2.state.heat.temp.toFixed(0)} C)`);
}

// 8 ---- all vehicles drive, no NaN
console.log('\n[8] every vehicle: 15 s full throttle on the strip');
for (const v of listVehicles()) { const r = rigFor(v.id, v.defaultAttachments); let max = 0; drive(r, 15, s => { max = Math.max(max, kmh(s)); return pilot(s, -9); });
  const s = r.state, fin = [s.p.x, s.p.y, s.p.z, s.v.x, s.q.w, s.heat.temp].every(Number.isFinite);
  ok(fin && max > 60 && s.p.z > 200 && s.up.y > 0.9, `${v.id.padEnd(9)} max ${max.toFixed(0)} km/h, z ${s.p.z.toFixed(0)}, upright, finite`); }

// 9 ---- harvester melt: any speed, no speed loss, no damage (control run = same world with that tree hidden)
console.log('\n[9] harvester melts trees at 10 and 150 km/h without losing speed');
const hideTree = (w, id) => ({ ...w, queryTrees: (x, z, r, out = []) => { const a = w.queryTrees(x, z, r, out).filter(t => t.id !== id); out.length = 0; out.push(...a); return out; } });
function meltRun(id, attach, x, z0, z1, target, hide) {
  const base = createStubWorld(); const tid = base.queryTrees(x, z1, 1).find(t => Math.abs(t.x - x) < 0.6 && Math.abs(t.z - z1) < 0.6).id;
  const r = rigFor(id, attach, hide ? hideTree(base, tid) : base); const s = r.state; PH.spawn(s, r.world, x, z0, 0); drive(r, 0.3, () => ({}));
  PH.yawOf(s); s.v.z = target / 3.6; s.v.x = 0; for (const w of s.wheels) w.omega = s.v.z / s.P.wheelR; s.gear = target > 100 ? 4 : 1;
  let at = null; r.stop = s => { if (s.p.z > z1 + 6) { at = kmh(s); return true; } return false; };
  drive(r, 20, s => ({ ...pilot(s, x), gas: kmh(s) < target ? 1 : 0 }));
  return { r, tid, at, dmg: r.state.damage };
}
for (const [id, kmhT, x, z0, z1] of [['forester', 10, -2.5, 80, 90], ['buggy', 150, 0, 640, 700]]) {
  const a = meltRun(id, ['harvester'], x, z0, z1, kmhT, false), b = meltRun(id, ['harvester'], x, z0, z1, kmhT, true);
  const dm = a.r.ev.filter(e => e.type === 'tree:damage' && e.id === a.tid), loss = (b.at - a.at) / b.at;
  console.log(`  ${id} @${kmhT}: tree ${a.tid} hp events ${dm.map(e => e.hp + '->' + e.remaining)}; ${a.at.toFixed(1)} km/h vs control ${b.at.toFixed(1)} (${(loss * 100).toFixed(2)} %), car damage ${a.dmg}, logs ${a.r.state.cargo.logs}`);
  ok(dm.length === 1 && dm[0].remaining === 0 && dm[0].cause === 'harvest' && a.r.ev.some(e => e.type === 'tree:destroyed' && e.id === a.tid), `${kmhT} km/h: all HP removed in one contact, tree:destroyed`);
  ok(loss < 0.01 && !a.r.ev.some(e => e.type === 'tree:hit' || e.type === 'crash') && a.dmg === 0, `${kmhT} km/h: no speed loss (< 1 %), no hit, no car damage`);
  ok(!a.r.world.queryTrees(x, z1, 2).some(t => t.id === a.tid), `${kmhT} km/h: melted tree stays gone`);
  ok(a.r.state.cargo.logs === 3, `${kmhT} km/h: 3 logs (1 per HP, capacity 3 without rack)`);
}

// 10 ---- top speed with / without the harvester, per vehicle (flat asphalt, 80 s full throttle, heat pinned)
console.log(`\n[10] top speed with / without harvester (${MODE}), km/h`);
console.log('  vehicle   |  bare  harvester  ratio |  nitro  nitro+harv  ratio');
for (const v of listVehicles()) {
  const a = topSpeed(v.id, [], MODE), b = topSpeed(v.id, ['harvester'], MODE), an = topSpeed(v.id, [], MODE, true), bn = topSpeed(v.id, ['harvester'], MODE, true);
  console.log(`  ${v.id.padEnd(9)} | ${a.toFixed(1).padStart(6)} ${b.toFixed(1).padStart(9)} ${(b / a).toFixed(3).padStart(6)} | ${an.toFixed(1).padStart(6)} ${bn.toFixed(1).padStart(10)} ${(bn / an).toFixed(3).padStart(6)}`);
  ok(b / a > 0.88 && b / a < 0.92 && bn / an > 0.88 && bn / an < 0.92, `${v.id}: harvester top speed ~-10 % (with and without nitro)`);
}

// 11 ---- slalom / bumpy flick test: no rollovers
console.log(`\n[11] slalom at 100 km/h (flat) and handbrake-flick slalom on bumps at 120 km/h (${MODE})`);
const bumpy = () => ({ heightAt: (x, z) => 0.35 * Math.sin(x * 0.45) * Math.sin(z * 0.37) + 0.75 * Math.sin(z * 0.11 + x * 0.07), surfaceAt: () => 'asphalt' });
const launch = (s, k, g = 3) => { PH.yawOf(s); s.v.x = s.fwd.x * k / 3.6; s.v.z = s.fwd.z * k / 3.6; for (const w of s.wheels) w.omega = k / 3.6 / s.P.wheelR; s.gear = g; };
for (const v of listVehicles()) {
  const res = [];
  for (const [w, k, hand] of [[flatWorld(), 100, false], [bumpy(), 120, true]]) {
    const r = rigFor(v.id, [], w); const s = r.state; drive(r, 0.5, () => ({})); launch(s, k); let minUp = 1, fin = true;
    drive(r, 14, s => { const t = s.time; minUp = Math.min(minUp, s.up.y); fin = fin && Number.isFinite(s.p.x); return { gas: 1, steer: Math.sign(Math.sin(t * Math.PI * (hand ? 1.25 : 1))), hand: hand && (t % 1.6) < 0.2 ? 1 : 0 }; });
    res.push({ minUp, rec: r.ev.filter(e => e.type === 'recover').length, fin });
  }
  console.log(`  ${v.id.padEnd(9)} flat min up.y ${res[0].minUp.toFixed(2)}, bumps min up.y ${res[1].minUp.toFixed(2)}, recovers ${res[0].rec + res[1].rec}`);
  if (MODE === 'arcade') ok(res.every(q => q.minUp > 0.75 && q.rec === 0 && q.fin), `${v.id}: no rollover (body stays within ~40 deg of upright)`);
  else ok(res.every(q => q.fin), `${v.id}: finite (NORMAL model, rollovers allowed)`);
}

// 12 ---- arcade drift holds its angle, keeps speed, fills nitro; counter-steer exits
console.log('\n[12] handbrake drift at 100 km/h: steer in, hold');
if (MODE !== 'arcade') console.log('  (arcade only, skipped in NORMAL)');
else for (const v of listVehicles()) {
  const r = rigFor(v.id, [], flatWorld()); const s = r.state; drive(r, 0.5, () => ({})); launch(s, 100); s.nitro = 0.2; const v0 = kmh(s), bs = [];
  let t0 = s.time; drive(r, 3, s => { const t = s.time - t0; if (t > 0.8) { PH.yawOf(s); bs.push(Math.atan2(s.v.x * s.left.x + s.v.z * s.left.z, s.v.x * s.fwd.x + s.v.z * s.fwd.z)); } return { gas: 1, steer: t < 0.15 ? 1 : 0.6, hand: t < 0.3 ? 1 : 0 }; });
  const mean = bs.reduce((a, b) => a + b, 0) / bs.length, sd = Math.sqrt(bs.reduce((a, b) => a + (b - mean) ** 2, 0) / bs.length), v1 = kmh(s), n1 = s.nitro, still = !!s.drift;
  t0 = s.time; drive(r, 2, s => ({ gas: 1, steer: -1 })); const ended = r.ev.some(e => e.type === 'drift:end');
  console.log(`  ${v.id.padEnd(9)} slip angle ${(Math.abs(mean) * 57.3).toFixed(1)} deg (sd ${(sd * 57.3).toFixed(1)}), ${v0.toFixed(0)} -> ${v1.toFixed(0)} km/h, nitro 0.20 -> ${n1.toFixed(2)}, counter-steer exit ${ended}`);
  ok(r.ev.some(e => e.type === 'drift:start') && still && Math.abs(mean) > 0.25 && sd < 0.06, `${v.id}: drift holds a steady angle (>14 deg, sd < 3.5 deg)`);
  ok(v1 > v0 * 0.8 && n1 > 0.3 && ended, `${v.id}: keeps speed, fills nitro, counter-steer ends it`);
}

// 13 ---- landing: drop from 4 m with 25 deg of roll
console.log(`\n[13] drop from 4 m with 25 deg roll at 60 km/h (${MODE})`);
for (const v of listVehicles()) {
  const r = rigFor(v.id, [], flatWorld()); const s = r.state; drive(r, 0.5, () => ({})); launch(s, 60);
  s.p.y += 4; const a = 0.22; const q = { x: 0, y: 0, z: Math.sin(a), w: Math.cos(a) }; s.q.x = q.x; s.q.y = q.y; s.q.z = q.z; s.q.w = q.w;
  let minUp = 1; drive(r, 4, s => { minUp = Math.min(minUp, s.up.y); return { gas: 0.5 }; });
  console.log(`  ${v.id.padEnd(9)} min up.y ${minUp.toFixed(2)}, final ${s.up.y.toFixed(3)}, ${kmh(s).toFixed(0)} km/h`);
  if (MODE === 'arcade') ok(s.up.y > 0.97 && !r.ev.some(e => e.type === 'recover'), `${v.id}: lands stable, upright`);
}

console.log(`\n${passes} passed, ${fails} failed`); process.exit(fails ? 1 : 0);
