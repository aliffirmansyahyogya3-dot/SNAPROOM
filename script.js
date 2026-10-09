'use strict';
const $ = s => document.querySelector(s);
const vid = $('#vid'), out = $('#out');

/* ---- Frame config: add or edit entries here. deco: heart|star|blossom|dot|lines|film ---- */
const DEF = { m: 70, g: 36, r: 18, ratio: 1.4, title: '', bd: null, stamp: false };
const FRAMES = [
  { name: 'Classic White', bg: '#FFFFFF', ink: '#242124', accent: '#873D52', bd: '#E8E3E1', deco: 'dot' },
  { name: 'Blush Pink', bg: '#F4DDE3', ink: '#873D52', accent: '#873D52', deco: 'heart' },
  { name: 'Vintage Film', bg: '#1C1A18', ink: '#E9DCC3', accent: '#E9DCC3', deco: 'film', m: 96, r: 4 },
  { name: 'Midnight Black', bg: '#171518', ink: '#FFFFFF', accent: '#F4DDE3', deco: 'star' },
  { name: 'Cherry Blossom', bg: '#FCE9EE', ink: '#873D52', accent: '#E58BA3', deco: 'blossom' },
  { name: 'Minimal Beige', bg: '#EDE3D6', ink: '#4A3F35', accent: '#4A3F35', deco: 'lines', r: 0 },
  { name: 'Love Notes', bg: '#873D52', ink: '#FFFFFF', accent: '#F4DDE3', deco: 'heart', title: 'love notes' },
  { name: 'Retro Date Stamp', bg: '#F6EBD0', ink: '#B5502B', accent: '#B5502B', deco: 'dot', r: 6, stamp: true }
];
/* ---- Filters operate on pixels so they work in every browser and in the exported PNG ---- */
const FILTERS = {
  original: { l: 'Original' },
  grayscale: { l: 'Grayscale', f: (r, g, b) => { const y = .3 * r + .59 * g + .11 * b; return [y, y, y]; } },
  vintage: { l: 'Vintage', f: (r, g, b) => [.6 * (.393 * r + .769 * g + .189 * b) + .4 * r + 10, .6 * (.349 * r + .686 * g + .168 * b) + .4 * g + 5, .6 * (.272 * r + .534 * g + .131 * b) + .4 * b] },
  warm: { l: 'Warm', f: (r, g, b) => [r + 22, g + 6, b - 20] },
  cool: { l: 'Cool', f: (r, g, b) => [r - 16, g + 4, b + 22] },
  soft: { l: 'Soft Contrast', f: (r, g, b) => [(r - 128) * .85 + 142, (g - 128) * .85 + 142, (b - 128) * .85 + 142] }
};
const ERR = {
  wait: ['Waiting for camera…', 'SNAPROOM needs camera access to take your photos. Photos stay on your device.'],
  insecure: ['Secure connection needed', 'The camera only works on HTTPS or localhost. Open this page with https://.'],
  unsupported: ['Camera not supported', 'This browser cannot use a camera. Try a recent Chrome, Safari, Edge or Firefox.'],
  denied: ['Camera access blocked', 'Allow camera access in your browser settings, then press Try Again.'],
  none: ['No camera found', 'Connect a camera, then press Try Again.'],
  busy: ['Camera is in use', 'Close other apps or tabs using the camera, then press Try Again.'],
  fail: ['Camera could not start', 'Something went wrong while starting the camera. Please try again.']
};

/* ---- Single state object ---- */
const S = {
  view: 'landing', stream: null, cams: [], camIdx: 0, useDev: false, camOk: false, front: true, mirror: true, req: 0,
  frame: 0, count: 4, cd: 3, filter: 'original', date: true, name: true, deco: true, footer: 'snaproom',
  photos: [], draft: null, retake: null, busy: false, tok: 0, timer: 0, res: null, date0: new Date()
};
const clean = t => String(t).replace(/[\u0000-\u001f<>]/g, '').slice(0, 28);
const mirrorNow = () => S.mirror && S.front;

function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem('snaproom') || '{}');
    if (FRAMES[p.frame]) S.frame = p.frame;
    if ([2, 3, 4, 6].includes(p.count)) S.count = p.count;
    if ([3, 5, 10].includes(p.cd)) S.cd = p.cd;
    if (typeof p.footer === 'string') S.footer = clean(p.footer);
  } catch (e) { /* preferences are optional */ }
}
function savePrefs() {
  try { localStorage.setItem('snaproom', JSON.stringify({ frame: S.frame, count: S.count, cd: S.cd, footer: S.footer })); } catch (e) { /* ignore */ }
}

/* ---- Views ---- */
function showView(v) {
  if (v !== 'studio') { cancelSession(); stopCamera(); setMsg(null); }
  if (v === 'landing') S.retake = null;
  S.view = v;
  ['landing', 'studio', 'result'].forEach(n => { $('#v-' + n).hidden = n !== v; });
  window.scrollTo(0, 0);
  if (v === 'studio') { ui(); startCamera(); }
  if (v === 'result') { $('#thumbs').hidden = $('#gal2').hidden = true; feedback(''); renderResult(); }
}
function resetSession() {
  cancelSession(); S.photos = []; S.draft = null; S.retake = null; feedback('');
}
function newSession() {
  resetSession(); showView('landing');
  $('#frames').scrollIntoView();
}
function backFromStudio() {
  if (S.retake != null) { S.retake = null; showView('result'); } else { showView('landing'); $('#frames').scrollIntoView(); }
}

/* ---- Camera ---- */
function setMsg(k) {
  const m = $('#msg');
  if (!k) { m.hidden = true; return; }
  $('#msgT').textContent = ERR[k][0]; $('#msgP').textContent = ERR[k][1];
  $('#retry').hidden = k === 'wait'; m.hidden = false;
}
function camFail(k) { S.camOk = false; setMsg(k); ui(); }
function stopCamera() {
  S.req++;
  if (S.stream) S.stream.getTracks().forEach(t => t.stop());
  S.stream = null; vid.srcObject = null; S.camOk = false;
}
async function startCamera() {
  stopCamera();
  const req = ++S.req;
  if (!window.isSecureContext) return camFail('insecure');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return camFail('unsupported');
  setMsg('wait'); ui();
  try {
    const base = { width: { ideal: 1920 }, height: { ideal: 1080 } };
    const dev = S.cams[S.camIdx];
    const v = S.useDev && dev ? { ...base, deviceId: { exact: dev.deviceId } } : { ...base, facingMode: 'user' };
    let st;
    try { st = await navigator.mediaDevices.getUserMedia({ video: v, audio: false }); }
    catch (e) {
      if (e.name === 'OverconstrainedError' || e.name === 'ConstraintNotSatisfiedError') st = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      else throw e;
    }
    if (req !== S.req || S.view !== 'studio') { st.getTracks().forEach(t => t.stop()); return; }
    S.stream = st; vid.srcObject = st;
    await vid.play().catch(() => {});
    if (!vid.videoWidth) await new Promise(r => vid.addEventListener('loadeddata', r, { once: true }));
    if (req !== S.req) return;
    const set = st.getVideoTracks()[0].getSettings();
    S.front = set.facingMode !== 'environment';
    vid.classList.toggle('mir', mirrorNow());
    $('#stage').style.setProperty('--ar', (vid.videoWidth / vid.videoHeight).toFixed(4));
    S.cams = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    S.camIdx = Math.max(0, S.cams.findIndex(d => d.deviceId === set.deviceId));
    S.camOk = true; setMsg(null); ui();
  } catch (e) {
    if (req !== S.req) return;
    const n = e && e.name;
    camFail(n === 'NotAllowedError' || n === 'SecurityError' ? 'denied'
      : n === 'NotFoundError' || n === 'DevicesNotFoundError' ? 'none'
      : n === 'NotReadableError' || n === 'TrackStartError' || n === 'AbortError' ? 'busy' : 'fail');
  }
}
function switchCamera() {
  if (S.busy || S.cams.length < 2) return;
  S.useDev = true; S.camIdx = (S.camIdx + 1) % S.cams.length; startCamera();
}

/* ---- Photo session ---- */
function sleep(ms) { return new Promise(r => { S.res = r; S.timer = setTimeout(() => r(true), ms); }); }
function capturePhoto() {
  if (!S.camOk || !vid.videoWidth || vid.readyState < 2) return null;
  const c = document.createElement('canvas');
  c.width = vid.videoWidth; c.height = vid.videoHeight;
  const x = c.getContext('2d');
  if (mirrorNow()) { x.translate(c.width, 0); x.scale(-1, 1); }
  x.drawImage(vid, 0, 0);
  return c;
}
function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
async function startPhotoSession() {
  if (S.busy || !S.camOk) return;
  S.busy = true;
  const tok = ++S.tok, cdEl = $('#cd');
  const idx = S.retake != null ? [S.retake] : [...Array(S.count).keys()];
  const draft = S.retake != null ? S.photos.slice() : [];
  S.draft = draft; ui();
  for (const i of idx) {
    $('#status').textContent = `Taking photo ${i + 1} of ${S.count}`;
    for (let c = S.cd; c > 0; c--) {
      cdEl.textContent = c; restart(cdEl, 'pop');
      if (!(await sleep(1000)) || tok !== S.tok) return;
    }
    cdEl.textContent = '';
    const p = capturePhoto();
    if (!p) { S.busy = false; S.draft = null; ui(); $('#status').textContent = 'Could not capture. Please try again.'; return; }
    draft[i] = p; restart($('#flash'), 'go'); dots();
    if (!(await sleep(600)) || tok !== S.tok) return;
  }
  S.photos = draft; S.draft = null; S.retake = null; S.busy = false; S.date0 = new Date();
  stopCamera(); showView('result');
}
function cancelSession() {
  S.tok++; clearTimeout(S.timer); if (S.res) S.res(false); S.res = null;
  S.busy = false; S.draft = null; $('#cd').textContent = ''; ui();
}

/* ---- Rendering ---- */
function rr(x, px, py, w, h, r) {
  x.beginPath(); x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r); x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r); x.arcTo(px, py, px + w, py, r); x.closePath();
}
const cache = new WeakMap();
function cover(p, w, h) {
  const k = S.filter + w + 'x' + h, e = cache.get(p);
  if (e && e.k === k) return e.c;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d');
  const r = Math.max(w / p.width, h / p.height), sw = w / r, sh = h / r;
  x.drawImage(p, (p.width - sw) / 2, (p.height - sh) / 2, sw, sh, 0, 0, w, h);
  const fn = FILTERS[S.filter].f;
  if (fn) {
    const d = x.getImageData(0, 0, w, h), a = d.data;
    for (let i = 0; i < a.length; i += 4) { const o = fn(a[i], a[i + 1], a[i + 2]); a[i] = o[0]; a[i + 1] = o[1]; a[i + 2] = o[2]; }
    x.putImageData(d, 0, 0);
  }
  cache.set(p, { k, c });
  return c;
}
function shape(x, t, cx, cy, s, col) {
  x.fillStyle = col; x.beginPath();
  if (t === 'heart') {
    x.moveTo(cx, cy + s * .9); x.bezierCurveTo(cx - s * 1.4, cy - s * .1, cx - s * .6, cy - s * 1.1, cx, cy - s * .4);
    x.bezierCurveTo(cx + s * .6, cy - s * 1.1, cx + s * 1.4, cy - s * .1, cx, cy + s * .9);
  } else if (t === 'star') {
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? s * .45 : s; x.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  } else if (t === 'blossom') {
    for (let i = 0; i < 5; i++) { const a = i * 2 * Math.PI / 5; x.moveTo(cx + Math.cos(a) * s * .6 + s * .5, cy + Math.sin(a) * s * .6); x.arc(cx + Math.cos(a) * s * .6, cy + Math.sin(a) * s * .6, s * .5, 0, 7); }
  } else x.arc(cx, cy, s * .5, 0, 7);
  x.fill();
}
function renderStrip(cv, fi, photos, sc = 1) {
  const f = { ...DEF, ...FRAMES[fi] }, n = S.count, W = 1200, m = f.m, g = f.g;
  const pw = W - 2 * m, ph = Math.round(pw / f.ratio), top = m + (f.title ? 90 : 0), bot = 250;
  const H = top + n * ph + (n - 1) * g + bot, y0 = H - bot;
  cv.width = Math.round(W * sc); cv.height = Math.round(H * sc);
  const x = cv.getContext('2d');
  x.setTransform(sc, 0, 0, sc, 0, 0);
  x.fillStyle = f.bg; x.fillRect(0, 0, W, H);
  for (let i = 0; i < n; i++) {
    const y = top + i * (ph + g), p = photos && photos[i];
    x.save(); rr(x, m, y, pw, ph, f.r); x.clip();
    if (p) x.drawImage(cover(p, pw, ph), m, y);
    else { x.globalAlpha = .22; x.fillStyle = f.accent; x.fillRect(m, y, pw, ph); }
    x.restore();
    rr(x, m, y, pw, ph, f.r); x.lineWidth = 6; x.strokeStyle = f.bd || f.accent; x.stroke();
  }
  if (S.deco) {
    const t = f.deco;
    if (t === 'film') { x.fillStyle = f.ink; for (let y = 30; y < H - 30; y += 64) { x.fillRect(26, y, 30, 40); x.fillRect(W - 56, y, 30, 40); } }
    else if (t === 'lines') { x.strokeStyle = f.accent; x.lineWidth = 3; x.strokeRect(26, 26, W - 52, H - 52); }
    else {
      for (let i = 0; i < n; i++) { const cy = top + i * (ph + g) + ph / 2; shape(x, t, m / 2, cy, 15, f.accent); shape(x, t, W - m / 2, cy, 15, f.accent); }
      shape(x, t, m + 24, y0 + 80, 14, f.accent); shape(x, t, W - m - 24, y0 + 80, 14, f.accent);
    }
  }
  x.textAlign = 'center'; x.fillStyle = f.ink;
  if (f.title) { x.font = 'italic 600 54px Georgia,serif'; x.fillText(f.title, W / 2, m + 58); }
  const ft = S.footer.trim();
  if (ft) { x.font = '700 62px system-ui,-apple-system,"Segoe UI",sans-serif'; x.fillText(ft, W / 2, y0 + 92); }
  x.font = '500 32px system-ui,-apple-system,"Segoe UI",sans-serif'; x.globalAlpha = .85;
  let ly = y0 + 152;
  if (S.name) { x.fillText(FRAMES[fi].name.toUpperCase(), W / 2, ly); ly += 50; }
  if (S.date) {
    const d = S.date0.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    if (f.stamp) { x.save(); x.translate(W / 2, ly - 8); x.rotate(-.04); x.strokeStyle = f.ink; x.lineWidth = 4; x.strokeRect(-190, -34, 380, 56); x.fillText(d, 0, 5); x.restore(); }
    else x.fillText(d, W / 2, ly);
  }
  x.globalAlpha = 1;
}
const complete = () => S.photos.length === S.count && S.photos.every(Boolean);
function renderResult() {
  if (!complete()) return;
  renderStrip(out, S.frame, S.photos, 1);
  $('#rmeta').textContent = `${FRAMES[S.frame].name} · ${S.photos.length} photos · ${FILTERS[S.filter].l}`;
}

/* ---- Gallery & options ---- */
function renderGalleries() {
  ['#gal', '#gal2'].forEach(id => {
    $(id).replaceChildren(...FRAMES.map((f, i) => {
      const b = document.createElement('button'), c = document.createElement('canvas');
      const s = document.createElement('span'), k = document.createElement('i');
      b.type = 'button'; b.className = 'card'; b.dataset.i = i;
      renderStrip(c, i, null, .14);
      s.textContent = f.name; b.append(c, s, k);
      b.onclick = () => selectFrame(i);
      return b;
    }));
  });
  markFrame();
}
function markFrame() {
  document.querySelectorAll('.card').forEach(b => {
    const on = +b.dataset.i === S.frame;
    b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); b.lastChild.textContent = on ? '✓ Selected' : '';
  });
}
function selectFrame(i) {
  S.frame = i; markFrame(); savePrefs(); ui();
  if (S.view === 'result') renderResult();
}
function chips(id, vals, fmt, after) {
  const el = $(id);
  el.replaceChildren(...vals.map(v => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.dataset.v = v; b.textContent = fmt(v);
    b.onclick = () => { S[el.dataset.key] = isNaN(v) ? v : +v; sync(); savePrefs(); after(); };
    return b;
  }));
}
function sync() {
  document.querySelectorAll('.chips').forEach(el => el.querySelectorAll('.chip').forEach(b => {
    b.setAttribute('aria-pressed', String(S[el.dataset.key]) === b.dataset.v);
  }));
}
function dots() {
  const arr = S.draft || S.photos;
  $('#dots').replaceChildren(...Array.from({ length: S.count }, (_, i) => {
    const d = document.createElement('span'); d.className = 'd' + (arr[i] ? ' on' : ''); return d;
  }));
}
function ui() {
  const b = S.busy;
  $('#take').disabled = b || !S.camOk;
  $('#cancel').hidden = !b;
  $('#switch').disabled = b || !S.camOk || S.cams.length < 2;
  document.querySelectorAll('#v-studio .chip').forEach(c => { c.disabled = b || (S.retake != null && c.parentElement.id === 'cCount'); });
  $('#back').textContent = S.retake != null ? 'Back to Result' : 'Back to Frames';
  $('#frameInfo').textContent = `Frame: ${FRAMES[S.frame].name} · ` + (S.retake != null ? `Retaking photo ${S.retake + 1} of ${S.count}` : `${S.count} photos`);
  if (!b) $('#status').textContent = S.camOk ? 'Camera ready' : '';
  dots();
}
function feedback(t) { $('#fb').textContent = t; }

/* ---- Result actions ---- */
function showThumbs() {
  const t = $('#thumbs'); $('#gal2').hidden = true; t.hidden = !t.hidden;
  if (t.hidden) return;
  t.replaceChildren(...S.photos.map((p, i) => {
    const b = document.createElement('button'), c = document.createElement('canvas');
    b.type = 'button'; b.className = 'th'; b.setAttribute('aria-label', 'Retake photo ' + (i + 1));
    c.width = 168; c.height = Math.round(168 * p.height / p.width); c.getContext('2d').drawImage(p, 0, 0, c.width, c.height);
    b.append(c); b.onclick = () => { S.retake = i; showView('studio'); };
    return b;
  }));
}
function downloadPhotostrip() {
  if (!complete()) return feedback('Take all photos first.');
  try {
    renderStrip(out, S.frame, S.photos, 1);
    out.toBlob(blob => {
      if (!blob) return feedback('Export failed. Please try again.');
      const u = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = u; a.download = `snaproom-photostrip-${new Date().toLocaleDateString('en-CA')}.png`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      feedback('Downloaded your photostrip.');
    }, 'image/png');
  } catch (e) { feedback('Export failed. Please try again.'); }
}
function toggleZoom(on) { $('#pv').classList.toggle('zoom', on); }

/* ---- Init ---- */
function initApp() {
  loadPrefs();
  $('#oFooter').value = S.footer;
  chips('#cCount', [2, 3, 4, 6], v => v + ' photos', () => { renderGalleries(); ui(); });
  chips('#cCd', [3, 5, 10], v => v + 's', ui);
  chips('#cFilter', Object.keys(FILTERS), v => FILTERS[v].l, renderResult);
  sync(); renderGalleries(); ui(); setMsg(null);

  document.addEventListener('click', e => {
    const a = e.target.closest('[data-go],[data-start]');
    if (!a) return;
    e.preventDefault();
    $('#nav').classList.remove('open'); $('#burger').setAttribute('aria-expanded', 'false');
    if (a.hasAttribute('data-start')) { resetSession(); showView('studio'); return; }
    if (S.view !== 'landing') showView('landing');
    const t = document.getElementById(a.dataset.go);
    if (t) t.scrollIntoView({ behavior: 'smooth' });
  });
  $('#burger').onclick = () => { const o = $('#nav').classList.toggle('open'); $('#burger').setAttribute('aria-expanded', o); };
  $('#take').onclick = startPhotoSession;
  $('#cancel').onclick = cancelSession;
  $('#switch').onclick = switchCamera;
  $('#back').onclick = backFromStudio;
  $('#retry').onclick = startCamera;
  $('#oMirror').onchange = e => { S.mirror = e.target.checked; vid.classList.toggle('mir', mirrorNow()); };
  $('#dl').onclick = downloadPhotostrip;
  $('#retakeAll').onclick = () => { resetSession(); showView('studio'); };
  $('#retakeOne').onclick = showThumbs;
  $('#chFrame').onclick = () => { $('#thumbs').hidden = true; const g = $('#gal2'); g.hidden = !g.hidden; if (!g.hidden) g.scrollIntoView({ behavior: 'smooth' }); };
  $('#newSess').onclick = newSession;
  [['#oDate', 'date'], ['#oName', 'name'], ['#oDeco', 'deco']].forEach(([id, k]) => { $(id).onchange = e => { S[k] = e.target.checked; renderResult(); }; });
  $('#oFooter').oninput = e => { S.footer = clean(e.target.value); savePrefs(); renderResult(); };
  $('#pv').onclick = () => toggleZoom(!$('#pv').classList.contains('zoom'));
  $('#pv').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#pv').click(); } };
  document.addEventListener('keydown', e => { if (e.key === 'Escape') toggleZoom(false); });
  window.addEventListener('pagehide', stopCamera);
}
initApp();
