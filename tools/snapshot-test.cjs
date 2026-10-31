// Headless smoke test + thumbnails for every snapshot in versions.json.
//   node tools/snapshot-test.cjs [baseUrl] [--thumbs] [--only id/slug,...]
// baseUrl defaults to a local server on :18950 (python3 -m http.server 18950 in the repo root).
// Pass = page loads (HTTP 200), no uncaught page errors, a canvas or the app root is on screen.
// Writes tools/smoke.json (local runs) and, with --thumbs, thumbs/<project>-<slug>.png (converted to jpg by build-versions/thumbs step).
const fs = require('fs'), path = require('path');
const puppeteer = require(process.env.PUPPETEER || '/workspace/scratch/ptest/node_modules/puppeteer-core');
const ROOT = path.join(__dirname, '..'); const args = process.argv.slice(2);
const base = (args.find(a => /^https?:/.test(a)) || 'http://127.0.0.1:18950/').replace(/\/?$/, '/');
const thumbs = args.includes('--thumbs'); const oi = args.indexOf('--only'); const only = oi >= 0 ? args[oi + 1].split(',') : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const V = JSON.parse(fs.readFileSync(path.join(ROOT, 'versions.json')));
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const res = {}; let fails = 0;
  for (const p of V.projects) for (const v of p.versions) { const key = p.id + '/' + v.slug; if (only && !only.includes(key)) continue;
    const pg = await b.newPage(); await pg.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
    const errs = [], cerr = [], bad = [];
    pg.on('pageerror', e => errs.push(String(e.message || e).slice(0, 200)));
    pg.on('console', m => { if (m.type() === 'error') cerr.push(m.text().slice(0, 200)); });
    pg.on('response', r => { const u = r.url(); if (r.status() >= 400 && u.startsWith(base) && !/favicon/.test(u)) bad.push(r.status() + ' ' + u.slice(base.length)); });
    let status = 0; try { const r = await pg.goto(base + v.path, { waitUntil: 'load', timeout: 60000 }); status = r.status(); } catch (e) { errs.push('goto: ' + e.message); }
    await sleep(7000);
    const st = await pg.evaluate(() => { const c = [...document.querySelectorAll('canvas')].filter(c => c.offsetWidth > 100);
      return { canvas: c.length, title: document.title, sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), ns: Object.keys(localStorage).filter(k => !k.startsWith('vm:')).length, body: document.body.innerText.length }; }).catch(e => ({ err: e.message }));
    const ok = status === 200 && !errs.length && !bad.length && (st.canvas > 0 || st.body > 40) && !st.sw && st.ns === 0;
    if (!ok) fails++;
    res[key] = { ok, status, title: st.title, canvas: st.canvas, pageErrors: errs.slice(0, 3), consoleErrors: cerr.slice(0, 3), http: bad.slice(0, 3), unscopedKeys: st.ns, tested: new Date().toISOString() };
    console.log((ok ? 'PASS ' : 'FAIL ') + key, JSON.stringify(res[key]).slice(0, 400));
    if (thumbs) { fs.mkdirSync(path.join(ROOT, 'thumbs'), { recursive: true }); await pg.screenshot({ path: path.join(ROOT, 'thumbs', p.id + '-' + v.slug + '.png') }); }
    await pg.close(); }
  await b.close();
  if (base.includes('127.0.0.1')) fs.writeFileSync(path.join(ROOT, 'tools', 'smoke.json'), JSON.stringify(Object.assign(fs.existsSync(path.join(ROOT, 'tools', 'smoke.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'smoke.json'))) : {}, res), null, 1));
  console.log(fails ? fails + ' FAILED' : 'ALL PASS'); process.exit(fails ? 1 : 0); })();
