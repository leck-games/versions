// Plane selector (PLANES tab of the vehicle menu): live 3D preview in a small second renderer, created on open, disposed on close.
// Uses plain Lambert vertex-colour materials (the comic objMat writes ink codes into alpha, which a stand-alone canvas can't use).
import * as THREE from 'three';
import { PLANES, getPlane, buildPlane } from './plane.js';
const bar = (v, max = 5) => { const n = Math.max(1, Math.round(v * max)); return '<i class="pips">' + '\u25A0'.repeat(n) + '<u>' + '\u25A0'.repeat(max - n) + '</u></i>'; };
export function openPlaneSelector({ container, current, onPick, size = [300, 170] }) {
  container.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'vsel'; container.appendChild(wrap);
  const cv = document.createElement('canvas'); cv.className = 'vprev'; wrap.appendChild(cv);
  const info = document.createElement('div'); info.className = 'vinfo'; wrap.appendChild(info);
  const list = document.createElement('div'); list.className = 'vlist'; wrap.appendChild(list);
  let r = null; try { r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); r.setPixelRatio(Math.min(2, devicePixelRatio || 1)); r.setSize(size[0], size[1], false); } catch (e) { cv.style.display = 'none'; }
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(35, size[0] / size[1], 0.1, 200);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6a5a40, 1.6)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(3, 6, 4); scene.add(dl);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true }), fmat = new THREE.MeshBasicMaterial({ color: 0xffa040 });
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 })); ground.rotation.x = -Math.PI / 2; scene.add(ground);
  let built = null, sel = current, raf = 0, ang = 0.7, alive = true;
  function show(id) {
    const d = getPlane(id); sel = d.id;
    if (built) { scene.remove(built.group); built.dispose(); }
    built = buildPlane(d, mat, fmat); scene.add(built.group);
    const gy = Math.min(...d.gear.map(g => g[1])) - 0.05, R = Math.max(d.span, d.dims[2]); ground.position.y = gy; ground.scale.setScalar(R * 0.55);
    cam.position.set(0, gy + R * 0.42, R * 1.35); cam.lookAt(0, gy + 0.8, 0);
    const s = d.stats || {};
    info.innerHTML = `<b>${d.name}</b> <small>${d.kind}. ${d.blurb}</small><div class="stats">${d.m} kg &nbsp; span ${d.span} m${d.AB ? ' &nbsp; AFTERBURNER' : ''}<br>SPEED ${bar(s.speed)} CLIMB ${bar(s.climb)}<br>AGILITY ${bar(s.agility)} DIRT ${bar(s.rough)}</div><div class="mnt">sound: ${d.sound}</div>`;
    [...list.children].forEach(b => b.classList.toggle('on', b.dataset.id === d.id));
  }
  for (const d of PLANES) { const b = document.createElement('button'); b.textContent = '✈ ' + d.name; b.dataset.id = d.id; b.onclick = () => { show(d.id); onPick && onPick(d.id); }; list.appendChild(b); }
  show(current);
  const loop = () => { if (!alive) return; ang += 0.012; if (built) { built.group.rotation.y = ang; if (built.prop) built.prop.rotation.z += 0.5; } if (r) r.render(scene, cam); raf = requestAnimationFrame(loop); }; loop();
  return { get selected() { return sel; }, show, close() { alive = false; cancelAnimationFrame(raf); if (built) built.dispose(); ground.geometry.dispose(); mat.dispose(); fmat.dispose(); if (r) { r.dispose(); r.forceContextLoss && r.forceContextLoss(); } container.innerHTML = ''; } };
}
