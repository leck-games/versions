// Attachment picker UI: one row per vehicle mount point, one choice per mount (or none).
import { listAttachments, validate } from './index.js';
export function renderPicker({ container, vehicle, selected, onChange }) {
  let cur = validate(vehicle, selected);
  function draw() {
    container.innerHTML = '';
    const mounts = Object.keys(vehicle.mounts);
    if (!mounts.length) { container.textContent = 'No mount points on this vehicle.'; return; }
    for (const m of mounts) {
      const row = document.createElement('div'); row.className = 'arow';
      const lab = document.createElement('span'); lab.className = 'alab'; lab.textContent = m.toUpperCase(); row.appendChild(lab);
      const opts = [{ id: null, name: 'NONE' }, ...listAttachments().filter(a => a.mounts.includes(m))];
      const here = cur.find(id => listAttachments().find(a => a.id === id).mounts.includes(m)) || null;
      for (const a of opts) {
        const b = document.createElement('button'); b.textContent = a.name; b.title = a.blurb || ''; b.dataset.id = a.id || 'none'; b.className = (a.id === here) ? 'on' : '';
        b.onclick = () => { cur = cur.filter(id => id !== here); if (a.id) cur.push(a.id); cur = validate(vehicle, cur); draw(); onChange && onChange(cur.slice()); };
        row.appendChild(b);
      }
      container.appendChild(row);
      const a = listAttachments().find(a => a.id === here); if (a) { const d = document.createElement('div'); d.className = 'adesc'; d.textContent = a.blurb; container.appendChild(d); }
    }
  }
  draw(); return { get selected() { return cur.slice(); }, redraw: draw };
}
