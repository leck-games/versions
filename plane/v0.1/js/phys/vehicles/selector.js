// Car selector UI with a live 3D preview (second small WebGL renderer, created on open, disposed on close to save memory on iPhone).
import { listVehicles } from './index.js';
import { buildVehicle } from './build.js';
const bar = (n, max = 5) => '<i class="pips">' + '\u25A0'.repeat(n) + '<u>' + '\u25A0'.repeat(max - n) + '</u></i>';
export function openSelector({ THREE, container, current, onPick, size = [300, 170] }) {
  container.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'vsel'; container.appendChild(wrap);
  const cv = document.createElement('canvas'); cv.className = 'vprev'; wrap.appendChild(cv);
  const info = document.createElement('div'); info.className = 'vinfo'; wrap.appendChild(info);
  const list = document.createElement('div'); list.className = 'vlist'; wrap.appendChild(list);
  let r = null; try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.setSize(size[0], size[1], false); } catch (e) { cv.style.display = 'none'; }
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, size[0] / size[1], 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a40, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(3, 6, 4); scene.add(dl);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(4, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  let built = null, sel = current, raf = 0, ang = 0.7, alive = true;
  function show(id) {
    sel = id; const v = listVehicles().find(v => v.id === id) || listVehicles()[0];
    if (built) { scene.remove(built.group); built.dispose(); }
    built = buildVehicle(THREE, v); scene.add(built.group);
    const P = { rest: 0.6, mass: 1500, k: 50000, wheelR: 0.46, hard: [[0, -0.12]], ...v.physics }; const gy = P.hard[0][1] - (P.rest - P.mass * 12.5 / 4 / P.k) - P.wheelR; ground.position.y = gy;
    const L = (P.dims || [2, 1.5, 4.4])[2]; cam.position.set(0, gy + L * 0.45, L * 1.45); cam.lookAt(0, gy + 0.6, 0);
    const st = v.stats || {};
    info.innerHTML = `<b>${v.name}</b> <small>${v.blurb || ''}</small><div class="stats">TOP ${st.top || '?'}${st.topNitro ? '/' + st.topNitro + ' N2O' : ''} km/h &nbsp; ${(P.mass)} kg<br>ACCEL ${bar(st.accel || 3)} GRIP ${bar(st.grip || 3)} WEIGHT ${bar(st.weight || 3)}</div><div class="mnt">mounts: ${Object.keys(v.mounts).join(', ') || 'none'} &middot; sound: ${v.sound}</div>`;
    [...list.children].forEach(b => b.classList.toggle('on', b.dataset.id === id));
  }
  for (const v of listVehicles()) { const b = document.createElement('button'); b.textContent = v.name; b.dataset.id = v.id; b.onclick = () => { show(v.id); onPick && onPick(v.id); }; list.appendChild(b); }
  show(current);
  const loop = () => { if (!alive) return; ang += 0.012; if (built) built.group.rotation.y = ang; if (r) r.render(scene, cam); raf = requestAnimationFrame(loop); }; loop();
  return { get selected() { return sel; }, show, close() { alive = false; cancelAnimationFrame(raf); if (built) built.dispose(); ground.geometry.dispose(); if (r) { r.dispose(); r.forceContextLoss && r.forceContextLoss(); } container.innerHTML = ''; } };
}
