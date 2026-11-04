// SineHighway: one fullscreen button (⛶) in the top-right corner group.
// - Real Fullscreen API where it exists (Android, desktop, iPad): tap -> fullscreen (+ landscape lock where allowed), button hides.
// - Rotating back to portrait exits fullscreen; the button comes back in landscape when not fullscreen
//   (also after leaving fullscreen by Esc / system gesture: fullscreenchange / webkitfullscreenchange).
// - Home-screen app (navigator.standalone / display-mode fullscreen|standalone): already fullscreen -> button never shown.
// - iPhone Safari has no element Fullscreen API (only <video>, WebKit bug 206854). Fallback: "pseudo fullscreen"
//   (scroll-to-hide trick, button hidden) plus a one-time dismissable hint "Add to Home Screen for true fullscreen".
export function initFullscreen({ btn, hint, storage = localStorage, win = window, doc = document } = {}) {
  const root = doc.documentElement;
  const mm = q => (win.matchMedia ? win.matchMedia(q).matches : false);
  const standalone = () => win.navigator.standalone === true || mm('(display-mode: fullscreen)') || mm('(display-mode: standalone)');
  const fsEl = () => doc.fullscreenElement || doc.webkitFullscreenElement || null;
  const canReal = () => !!((doc.fullscreenEnabled || doc.webkitFullscreenEnabled) && (root.requestFullscreen || root.webkitRequestFullscreen));
  const portrait = () => mm('(orientation: portrait)') || win.innerHeight > win.innerWidth;
  const st = { pseudo: false, requested: 0, exited: 0, hintShown: false };

  function update() {
    const show = !standalone() && !fsEl() && !st.pseudo && !portrait();
    btn.style.display = show ? '' : 'none';
    doc.body.classList.toggle('fs-pseudo', st.pseudo);
  }
  function showHint() {
    if (!hint || storage.getItem('shplane_fshint')) return;
    storage.setItem('shplane_fshint', '1'); st.hintShown = true;
    hint.style.display = 'flex';
    const close = () => { hint.style.display = 'none'; };
    hint.onclick = close; setTimeout(close, 7000);
  }
  async function enter() {
    if (canReal()) {
      st.requested++;
      try {
        const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen();
        btn.style.display = 'none';
        await p;
        try { await win.screen.orientation.lock('landscape'); } catch (e) { /* not supported / not allowed: ignore */ }
      } catch (e) { st.pseudo = false; }
    } else {
      st.pseudo = true;                       // iPhone Safari: best effort only
      win.scrollTo(0, 1); setTimeout(() => win.scrollTo(0, 0), 50);
      showHint();
    }
    update();
  }
  function exit() {
    if (fsEl()) { st.exited++; try { const p = doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen(); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
    st.pseudo = false;
    update();
  }
  let wasPortrait = portrait();
  function onLayout() {
    const p = portrait();
    if (p && !wasPortrait) exit();             // back to "normal" (portrait) mode -> fullscreen off
    wasPortrait = p; update();
  }
  btn.addEventListener('click', e => { e.stopPropagation(); enter(); });
  doc.addEventListener('fullscreenchange', update); doc.addEventListener('webkitfullscreenchange', update);
  win.addEventListener('resize', onLayout); win.addEventListener('orientationchange', () => setTimeout(onLayout, 60));
  if (win.matchMedia) { const q = win.matchMedia('(orientation: portrait)'); q.addEventListener ? q.addEventListener('change', onLayout) : 0; }
  if (win.screen && win.screen.orientation && win.screen.orientation.addEventListener) win.screen.orientation.addEventListener('change', onLayout);
  update();
  return { st, enter, exit, update, get visible() { return btn.style.display !== 'none'; }, get real() { return canReal(); }, get standalone() { return standalone(); }, get full() { return !!fsEl(); } };
}
