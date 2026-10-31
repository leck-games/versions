// Headless test: node test/e2e.mjs [baseURL]   (run from a dir where `playwright-core` is installed; uses system Chrome + SwiftShader)
import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(process.cwd() + '/');
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://localhost:8137/';
const OUT = new URL('../shots/', import.meta.url).pathname; fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const results = []; const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
async function open(q = '', vp = { width: 1280, height: 720 }) {
  const p = await b.newPage({ viewport: vp }); p.errs = [];
  p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text().slice(0, 300)); }); p.on('pageerror', e => p.errs.push('pageerror: ' + e.message));
  await p.goto(BASE + '?clean&' + q, { waitUntil: 'load' }); await p.waitForFunction(() => window.__tt, null, { timeout: 60000 }); await p.waitForTimeout(800);
  await p.evaluate(() => __tt.pause(true)); return p;
}
const ev = (p, f, a) => p.evaluate(f, a);
const shot = async (p, n) => { await p.screenshot({ path: OUT + n }); console.log('  shot ' + n); };

// ---------- 1. logic: fire only where fuel; rain extinguishes ----------
{
  const p = await open('biome=grassland&rain=off');
  const r = await ev(p, () => {
    const { T, W } = __tt; T.setRain('off'); T.snapWeather(); T.setWind(0.6, 7);
    const out = {}; const find = n => T.findBiome(n, 0, 0);
    // grassland
    const g = find('grassland'); __tt.setCam(g.x, T.heightAt(g.x, g.z) + 40, g.z + 60); out.gLit = T.ignite(g.x, g.z, { radius: 4 }); __tt.sim(15); out.gBurn = T.stats().fire.burning + T.stats().fire.burntCells;
    out.nonFuel = T.burningCells().filter(c => T.fuelAt(c.x, c.z) <= 0).length;
    // forest
    const f = find('forest'); __tt.setCam(f.x, T.heightAt(f.x, f.z) + 40, f.z); __tt.sim(0.5); T.extinguishAll();
    out.fLit = T.ignite(f.x, f.z, { radius: 6 }); __tt.sim(8); out.fBurn = T.burningCells().filter(c => Math.hypot(c.x - f.x, c.z - f.z) < 60).length;
    // road + water: search around grassland
    let road = null, water = null; const o = {};
    for (let i = 0; i < 40000 && (!road || !water); i++) { const a = i * 2.39996, rr = 4 * Math.sqrt(i); const x = g.x + Math.cos(a) * rr, z = g.z + Math.sin(a) * rr; W.sample(x, z, o);
      if (!road && o.road > 0.6 && o.rd < -2) road = { x, z }; if (!water && o.h < -0.5) water = { x, z }; }
    out.road = road; out.water = water;
    if (road) { __tt.setCam(road.x, T.heightAt(road.x, road.z) + 30, road.z); __tt.sim(0.3); out.roadLit = T.ignite(road.x, road.z, { radius: 0.5 }); out.roadFuel = T.fuelAt(road.x, road.z); }
    if (water) { __tt.setCam(water.x, 30, water.z); __tt.sim(0.3); out.waterLit = T.ignite(water.x, water.z, { radius: 2 }); }
    // rain puts it out
    T.setRain('storm'); T.snapWeather(); let fx = g.x, fz = g.z;
    for (let i = 0; i < 20000; i++) { const a = i * 2.39996, rr = 4 * Math.sqrt(i); fx = g.x + Math.cos(a) * rr; fz = g.z + Math.sin(a) * rr; if (T.fuelAt(fx, fz) > 0.6 && T.rainAt(fx, fz) > 0.6 && !T.fireAt(fx, fz).burnt) break; }
    T.setRain('off'); T.snapWeather(); __tt.setCam(fx, T.heightAt(fx, fz) + 40, fz + 60); __tt.sim(1); out.reLit = T.ignite(fx, fz, { radius: 4 }); __tt.sim(4); out.beforeRain = T.stats().fire.burning;
    T.setRain('storm'); T.snapWeather(); out.rainHere = +T.rainAt(fx, fz).toFixed(2); __tt.sim(12); out.afterRain = T.stats().fire.burning;
    out.relightWet = T.ignite(g.x + 40, g.z + 10, { radius: 3 });
    T.setRain('off'); T.snapWeather();
    return out;
  });
  console.log(JSON.stringify(r));
  ok('grassland fire spreads', r.gLit > 0 && r.gBurn > r.gLit * 3, `lit ${r.gLit} -> ${r.gBurn} cells after 15s`);
  ok('no burning cells on non-fuel', r.nonFuel === 0);
  ok('forest does not ignite/spread', r.fLit === 0 && r.fBurn === 0, `lit ${r.fLit}, burning ${r.fBurn}`);
  ok('road does not ignite', !r.road || r.roadLit === 0, r.road ? `fuel ${r.roadFuel}` : 'no road found');
  ok('water does not ignite', !r.water || r.waterLit === 0, r.water ? '' : 'no water found');
  ok('rain extinguishes fire', r.beforeRain > 0 && r.afterRain === 0 && r.rainHere > 0.5, `${r.beforeRain} burning -> ${r.afterRain} after 12 s storm (rain ${r.rainHere}); re-ignite wet ground: ${r.relightWet} cells`);
  ok('console clean (logic page)', p.errs.length === 0, p.errs.slice(0, 3).join(' | '));
  await p.close();
}
// ---------- 2. tree HP via bus (stub physics) + drive-through ----------
{
  const p = await open('biome=grassland&rain=off');
  const r = await ev(p, () => {
    const { T, bus, S } = __tt; const out = {};
    const g = T.findBiome('forest', 0, 0); __tt.setCam(g.x, T.heightAt(g.x, g.z) + 3, g.z); __tt.sim(0.5);
    const ts = T.queryTrees(g.x, g.z, 40).filter(t => t.hp > 0); out.n = ts.length; const t = ts[0];
    bus.emit('tree:damage', { id: t.id, amount: 1, dir: { x: 1, z: 0 } }); out.hp1 = T.getTree(t.id).hp;
    bus.emit('tree:damage', { id: t.id, amount: 1 }); out.hp2 = T.getTree(t.id).hp;
    bus.emit('tree:damage', { id: t.id, amount: 1 }); bus.emit('tree:destroyed', { id: t.id }); out.gone = !T.queryTrees(t.pos.x, t.pos.z, 1).some(q => q.id === t.id);
    out.rule = [60, 150, 200, 250, 301, 350].map(v => __tt.treeHit(null, v, 1)).concat([__tt.treeHit(null, 150, 0)]);
    // drive the stub car at 350 km/h into a dense forest line
    __tt.setMode('drive'); S.car.x = g.x; S.car.z = g.z; S.car.h = 0.3; S.car.v = 350 / 3.6; const before = T.resetTrees && 0;
    let removed = 0; const off = () => {}; const h = () => removed++; bus.on('tree:removed', h);
    for (let i = 0; i < 45; i++) { S.car.v = 350 / 3.6; __tt.step(1, 1 / 30); }
    out.fastRemoved = removed; out.fastDist = Math.hypot(S.car.x - g.x, S.car.z - g.z);
    // slow: 60 km/h into a tree -> damaged, not removed, car stopped
    const t2 = T.queryTrees(S.car.x, S.car.z, 60).filter(q => q.hp === 3)[0];
    const ang = Math.atan2(t2.pos.x - S.car.x, t2.pos.z - S.car.z); S.car.x = t2.pos.x - Math.sin(ang) * 6; S.car.z = t2.pos.z - Math.cos(ang) * 6; S.car.h = ang;
    removed = 0; S.car.v = 60 / 3.6; for (let i = 0; i < 25; i++) { __tt.step(1, 1 / 30); if ((T.getTree(t2.id)?.hp ?? 0) < 3) break; }
    out.slowHp = T.getTree(t2.id)?.hp ?? 0; out.slowRemoved = removed;
    return out;
  });
  console.log(JSON.stringify(r));
  ok('tree HP 3->2->1->gone via bus', r.hp1 === 2 && r.hp2 === 1 && r.gone);
  ok('stub HP rule', r.rule[5] === 3 && r.rule[4] === 3 && r.rule[2] < 3 && r.rule[6] < r.rule[1], 'head-on dmg@60/150/200/250/301/350, side@150 = ' + r.rule.join(','));
  ok('>300 km/h zooms through trees', r.fastRemoved > 0, `${r.fastRemoved} trees removed over ${r.fastDist.toFixed(0)} m`);
  ok('60 km/h damages but keeps tree', r.slowHp > 0 && r.slowHp < 3 && r.slowRemoved === 0, `hp ${r.slowHp}`);
  ok('console clean (HP page)', p.errs.length === 0, p.errs.slice(0, 3).join(' | '));
  await p.close();
}
// ---------- 3. screenshots ----------
const scenes = JSON.parse(fs.readFileSync(new URL('./shots.json', import.meta.url)));
for (const sc of scenes) {
  const p = await open(sc.q || '');
  await ev(p, sc.setup);
  await shot(p, sc.name);
  if (p.errs.length) ok('console clean ' + sc.name, false, p.errs[0]);
  await p.close();
}
// ---------- 4. fps (software renderer!) ----------
for (const [label, q, vp] of [['desktop 1280x720', '', { width: 1280, height: 720 }], ['iPhone12-size 390x844 q=low', 'q=low', { width: 390, height: 844 }]]) {
  const p = await open('biome=forest&' + q, vp); await ev(p, () => __tt.pause(false)); await p.waitForTimeout(6000);
  const f = await ev(p, () => ({ fps: __tt.fps(), calls: __tt.info().calls, tris: __tt.info().triangles }));
  ok('fps ' + label + ' (SwiftShader software GL)', true, `${f.fps.toFixed(1)} fps, ${f.calls} draw calls, ${f.tris} tris`);
  if (p.errs.length) ok('console clean fps ' + label, false, p.errs[0]);
  await p.close();
}
fs.writeFileSync(OUT + 'results.json', JSON.stringify(results, null, 1));
await b.close();
console.log(results.filter(r => !r.pass).length ? 'SOME FAILED' : 'ALL PASS');
