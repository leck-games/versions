// Node test (no browser): road widths, masks and bridges from the pure world math.   node test/roads.mjs
import * as W from '../terrain/world.js';
let fails = 0; const ok = (name, pass, info = '') => { if (!pass) fails++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? '  ' + info : '')); };
const o = {}, med = a => { const b = [...a].sort((x, y) => x - y); return b.length ? b[b.length >> 1] : NaN; };
const paths = W.pathsNear(0, 0, 9000), kinds = { [W.HWY]: 'hwy', [W.TRAIL]: 'trail', [W.LOOP]: 'loop' };
const widths = { hwy: [], trail: [], loop: [] }, mask = { hwy: [], trail: [], loop: [] }; let bridges = 0, deckFull = 0, riverKept = 0, riverPts = 0;
for (const e of paths) {
  const k = kinds[e.type];
  for (let t = 0.15; t < 0.86; t += 0.07) {
    const P = W.pathPoint(e, t); if (P.bridge || Math.max(Math.abs(P.x), Math.abs(P.z)) > W.WORLD - 50) continue; const x = P.x, z = P.z, nx = -P.tz, nz = P.tx; let a = 0, b = 0;
    W.sample(x, z, o); if (o.rtype !== e.type || o.rd > 0) continue;
    while (a < 40) { W.sample(x + nx * (a + 0.05), z + nz * (a + 0.05), o); if (o.rd > 0 || o.rtype !== e.type) break; a += 0.05; }
    while (b < 40) { W.sample(x - nx * (b + 0.05), z - nz * (b + 0.05), o); if (o.rd > 0 || o.rtype !== e.type) break; b += 0.05; }
    if (a >= 40 || b >= 40) continue; widths[k].push(a + b);
    // masks just outside the edge: shoulder 0.5..2.5 m, trees/rocks need road < 0.02 && rd > 3 (trees.js / game rocks), fuel needs road <= 0.15
    W.sample(x + nx * (e.hw - 0.3), z + nz * (e.hw - 0.3), o); const inRoad = o.road === 1;
    W.sample(x + nx * (e.hw + 3.3), z + nz * (e.hw + 3.3), o); const treeOk = o.road < 0.02 && o.rd > 3;
    mask[k].push(inRoad && treeOk ? 1 : 0);
  }
  if (e.loop || !e.br) continue;
  for (let i = 0; i <= e.M; i++) if (e.br[i]) {
    const P = W.pathPoint(e, i / e.M); bridges++; const x = P.x, z = P.z, nx = -P.tz, nz = P.tx;
    let full = true; for (const s of [-1, -0.5, 0, 0.5, 1]) { W.sample(x + nx * s * (e.hw - 0.2), z + nz * s * (e.hw - 0.2), o); if (!(o.deck > -1e8)) full = false; } deckFull += full ? 1 : 0;
    if (Math.max(Math.abs(x), Math.abs(z)) > W.WORLD - 50) continue; // world rim raises everything
    W.sample(x, z, o); if (i > 1 && i < e.M - 1 && o.hn < W.WATER) /* road-graph junctions (i=0/M) keep their raised node pad */ { riverPts++; if (o.h < W.WATER) riverKept++; }
  }
}
console.log('half-widths v1', JSON.stringify(W.ROAD_HW_V1), ' v2', JSON.stringify(W.ROAD_HW));
for (const k of ['hwy', 'trail', 'loop']) {
  const m = med(widths[k]), want = 2 * W.ROAD_HW[k], was = 2 * W.ROAD_HW_V1[k];
  ok(`${k} width ${was} m -> ${want} m`, Math.abs(m - want) < 0.6, `measured median ${m.toFixed(2)} m over ${widths[k].length} cross-sections (x${(m / was).toFixed(2)})`);
  ok(`${k} masks follow the width (road=1 inside, tree/rock-free shoulder)`, mask[k].length > 5 && mask[k].reduce((p, q) => p + q, 0) / mask[k].length > 0.9, `${mask[k].reduce((p, q) => p + q, 0)}/${mask[k].length}`);
}
ok('highways ~2x, dirt ~1.5x', W.ROAD_HW.hwy / W.ROAD_HW_V1.hwy === 2 && W.ROAD_HW.trail / W.ROAD_HW_V1.trail === 1.5 && W.ROAD_HW.loop / W.ROAD_HW_V1.loop === 1.5);
ok('bridge decks span the full road width', bridges > 0 && deckFull / bridges > 0.97, `${deckFull}/${bridges} bridge profile points`);
ok('roads do not fill rivers (water stays under bridges)', riverPts > 0 && riverKept / riverPts > 0.97, `${riverKept}/${riverPts} wet points under decks`);
console.log(fails ? `${fails} FAILED` : 'road tests passed'); process.exit(fails ? 1 : 0);
