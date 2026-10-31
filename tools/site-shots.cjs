// node tools/site-shots.cjs [baseUrl]  -> shots/versions_site_{top,project,mobile}.png + basic UI checks
const path=require('path');let P;try{P=require('puppeteer-core')}catch(e){P=require('/workspace/scratch/ptest/node_modules/puppeteer-core')}
const base=process.argv[2]||'http://127.0.0.1:18950/';const out=path.join(__dirname,'..','shots');
(async()=>{const b=await P.launch({executablePath:'/usr/bin/google-chrome',headless:'new',args:['--no-sandbox']});let fail=0;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fail++};
const p=await b.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.setViewport({width:1280,height:900});const r=await p.goto(base,{waitUntil:'networkidle0'});ok(r.status()===200,'site 200');
await p.waitForSelector('.card');const n=await p.$$eval('.card',a=>a.length);ok(n>=25,'cards '+n);
ok(await p.$$eval('section.proj',a=>a.length)>=5,'project groups');
ok(await p.$eval('#hero',e=>/V0\.1/.test(e.textContent)),'hero shows V0.1');
const imgs=await p.$$eval('.thumb img',a=>a.filter(i=>i.complete&&i.naturalWidth>0).length);console.log('  thumbs loaded (visible)',imgs);
await p.screenshot({path:out+'/versions_site_top.png'});
await p.type('#q','compass');await new Promise(r=>setTimeout(r,300));const vis=await p.$$eval('.card:not(.hide)',a=>a.length);ok(vis>0&&vis<n,'search filters ('+vis+')');
await p.$eval('#q',e=>{e.value='';e.dispatchEvent(new Event('input'))});
await p.click('.chip[data-id="sinerally"]');await new Promise(r=>setTimeout(r,200));
ok(await p.$$eval('section.proj',a=>a.filter(s=>s.style.display!=='none').length)===1,'chip filter');
await p.select('#sort','old');await new Promise(r=>setTimeout(r,200));
ok(await p.$eval('#p-sinerally .card h3',e=>/PROTOTYPE/.test(e.textContent)),'sort oldest first');
await p.select('#sort','new');await p.$eval('#p-sinerally details.log',d=>d.open=true);
ok(await p.$$eval('#p-sinerally .log li',a=>a.length)>20,'changelog lists commits');
await p.evaluate(()=>document.querySelector('#p-sinerally .grid .card:nth-child(4)').scrollIntoView());await new Promise(r=>setTimeout(r,500));
await p.screenshot({path:out+'/versions_site_project.png'});
const m=await b.newPage();await m.setViewport({width:390,height:844,deviceScaleFactor:2,isMobile:true,hasTouch:true});
await m.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1');
await m.goto(base,{waitUntil:'networkidle0'});await m.waitForSelector('.card');await new Promise(r=>setTimeout(r,500));
ok(await m.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'mobile: no horizontal scroll');
await m.screenshot({path:out+'/versions_site_mobile.png'});
ok(errs.length===0,'no page errors '+errs.join('|'));await b.close();console.log(fail?'FAILED '+fail:'ALL OK');process.exit(fail?1:0)})();
