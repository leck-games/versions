// Headless browser test + screenshots: node tests/browser.mjs   (needs puppeteer-core + Chrome; CHROME=/path/to/chrome)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { serve } from './serve.mjs';
const PORT = +process.env.PORT || 18791, BASE = process.env.BASE || `http://localhost:${PORT}/`;
const srv = process.env.BASE ? null : await serve(PORT);
fs.mkdirSync(new URL('../shots/', import.meta.url), { recursive: true });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new',
  args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage(); await page.setViewport({ width: 844, height: 390, deviceScaleFactor: 2 }); // iPhone 12 landscape
const consoleErr = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') consoleErr.push(m.type() + ': ' + m.text()); }); page.on('pageerror', e => consoleErr.push('pageerror: ' + e.message));
let fails = 0; const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fails++; };
const shot = async n => { await new Promise(r => setTimeout(r, 300)); await page.screenshot({ path: `shots/${n}.png` }); console.log('  shot shots/' + n + '.png'); };
await page.goto(BASE + '?touch', { waitUntil: 'load' }); await page.waitForFunction('window.LAB && LAB.ready', { timeout: 20000 });
await page.evaluate(() => localStorage.clear());
ok(await page.evaluate(() => LAB.vehicles.length === 5), '5 vehicles registered');

// 1 car selector
await page.evaluate(() => { LAB.setVehicle('hyper', []); LAB.openMenu('car'); }); await new Promise(r => setTimeout(r, 900)); await shot('01-car-selector');
ok(await page.evaluate(() => document.querySelectorAll('.vlist button').length === 5 && !!document.querySelector('.vlist button.on[data-id=hyper]')), 'selector lists 5 cars, SINE GT selected');
// pick via UI click
await page.click('.vlist button[data-id=forester]'); await new Promise(r => setTimeout(r, 400));
ok(await page.evaluate(() => LAB.state && LAB.rig.vehicle.id === 'forester' && JSON.parse(localStorage.getItem('srp_vehicle')) === 'forester'), 'click selects TIMBERWOLF + persisted');
// 2 attachments picker
await page.click('.tabs [data-tab=parts]'); await new Promise(r => setTimeout(r, 300));
await page.click('#picker button[data-id=harvester]'); await page.click('#picker button[data-id=lograck]'); await page.click('#picker button[data-id=rooflights]');
await shot('02-attachments');
ok(await page.evaluate(() => JSON.stringify(LAB.rig.attach) === '["harvester","lograck","rooflights"]' && localStorage.getItem('srp_attach_forester') === JSON.stringify(LAB.rig.attach) && LAB.state.cargo.capacity === 15), 'picker mounts harvester + log rack + roof lights, persisted, capacity 15');
await page.reload({ waitUntil: 'load' }); await page.waitForFunction('window.LAB && LAB.ready');
ok(await page.evaluate(() => LAB.rig.vehicle.id === 'forester' && LAB.rig.attach.length === 3), 'selection restored after reload');

// 3 tree hit with HP display (buggy ~130 km/h into practice tree)
await page.evaluate(() => { LAB.closeMenu(); LAB.setVehicle('buggy', []); LAB.teleport(-2.5, -120, 0); LAB.until = s => LAB.events.some(e => e.type === 'tree:hit');
  const p = LAB.pilot(-2.5); LAB.sim(30, s => ({ ...p(s), gas: LAB.kmh() < 130 ? 1 : 0 })); LAB.sim(0.35, s => ({ brake: 1 })); });
const hit = await page.evaluate(() => LAB.events.find(e => e.type === 'tree:damage'));
console.log('  hit', JSON.stringify(hit));
await shot('03-tree-hit-hp');
ok(hit && hit.remaining > 0 && hit.remaining < 3, 'partial HP removed, tree survives');
ok(await page.evaluate(() => [...document.querySelectorAll('.hp')].some(e => e.style.display === 'block' && e.classList.contains('hit'))), 'HP label shown for hit tree');

// 4 temperature gauge (rev on the limiter)
await page.evaluate(() => { LAB.setVehicle('truck', ['rooflights']); LAB.teleport(0, -150, 0); LAB.sim(1, () => ({})); LAB.sim(13, () => ({ gas: 1, brake: 1 })); });
await shot('04-temp-gauge');
ok(await page.evaluate(() => LAB.events.some(e => e.type === 'engine:hot') && LAB.events.some(e => e.type === 'engine:overheat') && document.getElementById('tempWarn').textContent.length > 0), 'engine:hot + engine:overheat emitted, gauge warns');

// 5 harvester (forester crawling into practice tree)
await page.evaluate(() => { LAB.setVehicle('forester', ['harvester', 'lograck', 'rooflights']); LAB.teleport(2.5, 55, 0); const n0 = LAB.events.length;
  LAB.until = s => s.cargo.logs >= 2; const p = LAB.pilot(2.5); LAB.sim(40, s => ({ ...p(s), gas: LAB.kmh() < 12 ? 0.6 : 0 })); LAB.n0 = n0; });
await shot('05-harvester');
await page.evaluate(() => { LAB.until = s => LAB.events.slice(LAB.n0).some(e => e.type === 'tree:destroyed'); const p = LAB.pilot(2.5); LAB.sim(20, s => ({ ...p(s), gas: LAB.kmh() < 12 ? 0.6 : 0 })); });
const hv = await page.evaluate(() => ({ logs: LAB.state.cargo.logs, felled: LAB.events.slice(LAB.n0).find(e => e.type === 'tree:destroyed'), dmg: LAB.state.damage }));
console.log('  harvest', JSON.stringify(hv));
ok(hv.logs === 3 && hv.felled && hv.felled.cause === 'harvest' && hv.dmg === 0, 'harvester felled tree, 3 logs, no damage');
await shot('05b-harvester-felled');

// 5c harvester at speed: buggy + harvester at ~120 km/h through the practice row, tree vanishes, no speed loss
await page.evaluate(() => { LAB.world.regrow && LAB.world.regrow(); LAB.state.treeHp = {}; LAB.setVehicle('buggy', ['harvester']); LAB.teleport(-2.5, -60, 0); LAB.n0 = LAB.events.length;
  LAB.until = s => s.p.z > 86; const p = LAB.pilot(-2.5); LAB.sim(30, s => ({ ...p(s), gas: LAB.kmh() < 120 ? 1 : 0 })); LAB.v0 = LAB.kmh(); LAB.until = s => s.p.z > 100; LAB.sim(5, s => ({ ...p(s), gas: LAB.kmh() < 120 ? 1 : 0 })); });
const fast = await page.evaluate(() => ({ ev: LAB.events.slice(LAB.n0).find(e => e.type === 'tree:destroyed'), v0: LAB.v0, v1: LAB.kmh(), dmg: LAB.state.damage, hit: LAB.events.slice(LAB.n0).some(e => e.type === 'tree:hit') }));
console.log('  fast harvest', JSON.stringify(fast));
await shot('05c-harvester-120kmh');
ok(fast.ev && fast.ev.cause === 'harvest' && !fast.hit && fast.dmg === 0 && fast.v1 > fast.v0 * 0.97, 'harvester melts a tree at 120 km/h, no hit, no damage, no speed loss');

// 5d handling toggle: HUD button flips ARCADE <-> NORMAL, persisted
await page.evaluate(() => localStorage.removeItem('srp_handling')); await page.reload({ waitUntil: 'load' }); await page.waitForFunction('window.LAB && LAB.ready');
ok(await page.evaluate(() => LAB.state.mode === 'arcade' && document.getElementById('bMode').textContent === 'ARC'), 'ARCADE is the default (HUD shows ARC)');
await page.click('#bMode');
ok(await page.evaluate(() => LAB.state.mode === 'normal' && document.getElementById('bMode').textContent === 'NRM' && JSON.parse(localStorage.getItem('srp_handling')) === 'normal'), 'HUD button switches to NORMAL + persisted');
await page.reload({ waitUntil: 'load' }); await page.waitForFunction('window.LAB && LAB.ready');
ok(await page.evaluate(() => LAB.state.mode === 'normal'), 'NORMAL restored after reload');
await page.evaluate(() => { LAB.setVehicle('quad', []); }); ok(await page.evaluate(() => LAB.state.mode === 'normal'), 'mode kept across vehicle change');
await page.click('#bMode'); ok(await page.evaluate(() => LAB.state.mode === 'arcade'), 'and back to ARCADE');
// arcade drift screenshot
await page.evaluate(() => { LAB.setVehicle('buggy', []); LAB.teleport(-9, -200, 0); LAB.sim(6, s => ({ ...LAB.pilot(-9)(s), gas: LAB.kmh() < 100 ? 1 : 0 })); let t = 0;
  LAB.sim(1.4, s => { t += 1 / 120; return { gas: 1, steer: t < 0.15 ? 1 : 0.6, hand: t < 0.3 ? 1 : 0 }; }); });
const dr = await page.evaluate(() => ({ drift: !!LAB.state.drift, ev: LAB.events.filter(e => e.type === 'drift:start').length }));
await shot('05d-arcade-drift'); ok(dr.drift && dr.ev > 0, 'arcade handbrake drift engaged (drift:start)');

// 6 300 km/h pass-through
await page.evaluate(() => { LAB.setVehicle('hyper', []); LAB.teleport(0, 0, 0); const n0 = LAB.events.length; LAB.n0 = n0;
  LAB.until = s => s.p.z > 712; LAB.sim(30, LAB.pilot(0, { boost: 1 })); });
const pass = await page.evaluate(() => ({ ev: LAB.events.slice(LAB.n0).find(e => e.type === 'tree:destroyed' && e.id === 'g1'), kmh: LAB.kmh() }));
console.log('  pass', JSON.stringify(pass));
await shot('06-300kmh-pass-through');
ok(pass.ev && pass.ev.speed >= 300 && pass.kmh > 290, '>= 300 km/h smash-through, speed kept');

// 7 live loop runs (real rAF) with touch input for a moment
const f0 = await page.evaluate(() => LAB.frames); await page.evaluate(() => { LAB.input = { gas: 1 }; }); await new Promise(r => setTimeout(r, 1500));
ok(await page.evaluate(f0 => LAB.frames > f0 + 5, f0), 'render loop running');
ok(consoleErr.length === 0 && (await page.evaluate(() => LAB.errors.length)) === 0, 'no console errors/warnings' + (consoleErr.length ? ': ' + consoleErr.slice(0, 5).join(' | ') : ''));
await browser.close(); if (srv) srv.close();
console.log(fails ? `${fails} FAILED` : 'browser tests passed'); process.exit(fails ? 1 : 0);
