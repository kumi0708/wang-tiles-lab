import { generateTexture, THEMES } from './texture.js';
import { buildTileset, edgesOf, TOP, RIGHT, BOTTOM, LEFT, MIDDLE } from './wang.js';
import { makeEdgeMap, makeInfiniteEdges, cellTile } from './map.js';
import { seedFrom } from './noise.js';
import { drawMap, drawAtlas, drawTileInspect, drawSource, seamStats, REGION_COLORS } from './render.js';
import { STRINGS } from './i18n.js';

const $ = (id) => document.getElementById(id);
const state = {
  lang: 'ja', theme: 'meadow', texSeed: 'sprout', mapSeed: '1', T: 64,
  mode: 'wang', mapKind: 'loop', size: 14, zoom: 0,
  ov: { edges: false, index: false, grid: false, wrapLines: true },
  smart: true, mincut: true, selected: 6, insRegions: true, insCuts: true, energy: false,
};
// restore from URL hash (shareable state)
try { Object.assign(state, JSON.parse(decodeURIComponent(location.hash.slice(1)) || '{}')); } catch { /* ignore */ }

let tex = null, set = null, map = null;
const cam = { x: 0, y: 0 };
const cache = new Map();
const t = (k) => STRINGS[state.lang][k] ?? k;

// ------------------------------------------------------------- build pipeline
async function rebuild(what = 'all') {
  $('loading').hidden = false;
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  if (what === 'all') {
    const key = `${state.theme}|${state.texSeed}`;
    tex = cache.get(key) || generateTexture(state.theme, seedFrom(state.texSeed + state.theme));
    cache.set(key, tex);
  }
  if (what !== 'map') set = buildTileset(tex, state.T, seedFrom(state.texSeed), { smart: state.smart, minCut: state.mincut });
  const ms = seedFrom('edges:' + state.mapSeed);
  map = state.mapKind === 'infinite' ? makeInfiniteEdges(ms) : makeEdgeMap(state.size, state.size, ms, state.mapKind === 'loop');
  $('loading').hidden = true;
  centerCamera();
  drawAll();
}

function centerCamera() {
  const vp = $('viewport').getBoundingClientRect();
  const z = 2 ** state.zoom;
  if (state.mapKind === 'infinite') { cam.x = -vp.width / z / 2; cam.y = -vp.height / z / 2; return; }
  const W = state.size * state.T;
  cam.x = W / 2 - vp.width / z / 2; cam.y = W / 2 - vp.height / z / 2;
}

// ------------------------------------------------------------- drawing
const mapCanvas = $('map');
let lastCells = [];
function drawMain() {
  if (!set) return;
  const vp = $('viewport').getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  mapCanvas.width = Math.round(vp.width * dpr); mapCanvas.height = Math.round(vp.height * dpr);
  const ctx = mapCanvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = THEMES[state.theme].bg; ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
  // subtle checker outside finite maps
  const z = 2 ** state.zoom * dpr;
  lastCells = drawMap(ctx, set, map, state.mode, { x: cam.x, y: cam.y, zoom: z, w: mapCanvas.width, h: mapCanvas.height }, state.ov, seedFrom('cells:' + state.mapSeed));
  if (state.mapKind === 'finite') {
    const x = (-cam.x) * z, y = (-cam.y) * z, s = state.size * state.T * z;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(x, y, s, s);
  }
  // highlight selected-tile occurrences
  if (state.mode === 'wang' && hover) {
    const k = lastCells.find((c) => c.r === hover.r && c.c === hover.c);
    if (k) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.strokeRect(k.x + 1, k.y + 1, k.w - 2, k.h - 2); }
  }
}

function drawSide() {
  const a = $('atlas').getContext('2d');
  a.fillStyle = '#0b0d17'; a.fillRect(0, 0, 320, 320);
  drawAtlas(a, set, 0, 0, 320, { selected: state.selected });

  const ins = $('inspect'); const ic = ins.getContext('2d');
  ic.clearRect(0, 0, 256, 256);
  drawTileInspect(ic, set, state.selected, 0, 0, 256, { regions: state.insRegions, cuts: state.insCuts, bars: true });
  const e = edgesOf(state.selected);
  const v = (n, name, w) => `<span class="c${n}">${name} ${n}</span>${w ? `×${w}` : ''}`;
  $('formula').innerHTML = `${v(e.top, 'top')} + 2×${v(e.right, 'right')} + 4×${v(e.bottom, 'bottom')} + 8×${v(e.left, 'left')}<br>= ${e.top} + ${2 * e.right} + ${4 * e.bottom} + ${8 * e.left} = <b>${state.selected}</b>`;
  const names = [t('r_top') + ` (H${e.top})`, t('r_right') + ` (V${e.right})`, t('r_bottom') + ` (H${e.bottom})`, t('r_left') + ` (V${e.left})`, t('r_mid') + ` (M${state.selected})`];
  $('legend').innerHTML = names.map((n, i) => `<div><i style="background:${REGION_COLORS[i]}"></i>${n}</div>`).join('') + `<div style="margin-top:6px">${t('cutNote')}</div>`;

  const s = $('source').getContext('2d');
  drawSource(s, tex, set, 0, 0, 320, { energy: state.energy });

  // HUD stats (computed on a bounded window so infinite mode stays cheap)
  const n = state.mapKind === 'infinite' ? 16 : state.size;
  const st = seamStats(set, map, state.mode, n, n, seedFrom('cells:' + state.mapSeed));
  const used = st.usage.filter((u) => u > 0).length;
  const good = st.ratio < 1.35;
  $('hud').innerHTML = [
    `<div class="pill ${good ? 'good' : 'bad'}">${t('seam')}<b>${st.ratio.toFixed(2)}×</b></div>`,
    state.mode === 'wang' ? `<div class="pill ${st.mismatch ? 'bad' : 'good'}">${t('edgeCheck')}<b>${st.logical - st.mismatch}/${st.logical}</b></div>` : '',
    state.mode === 'wang' ? `<div class="pill">${t('uniq')}<b>${used}/16</b></div>` : '',
    `<div class="pill">${t('modeLabel')}<b>${t('m_' + (state.mode === 'variants' ? 'var' : state.mode))}</b></div>`,
  ].join('');
}

function drawAll() { drawMain(); drawSide(); syncUI(); }

// ------------------------------------------------------------- UI wiring
function seg(id, key, onChange, cast = (v) => v) {
  $(id).addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    state[key] = cast(b.dataset.v); onChange();
  });
}
seg('mode', 'mode', () => { drawAll(); save(); });
seg('mapKind', 'mapKind', () => { rebuild('map'); save(); });
seg('tileSize', 'T', () => { rebuild('tiles'); save(); }, Number);

function syncUI() {
  for (const [id, key] of [['mode', 'mode'], ['mapKind', 'mapKind'], ['tileSize', 'T']]) {
    for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', String(state[key]) === b.dataset.v);
  }
  for (const b of $('themes').querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === state.theme);
  $('sizeRow').style.display = state.mapKind === 'infinite' ? 'none' : '';
  $('sizeOut').textContent = `${state.size} × ${state.size}`;
  $('zoomOut').textContent = `${(2 ** state.zoom).toFixed(2)}×`;
  $('size').value = state.size; $('zoom').value = state.zoom;
  $('texSeed').value = state.texSeed; $('mapSeed').value = state.mapSeed;
  $('ovEdges').checked = state.ov.edges; $('ovIndex').checked = state.ov.index; $('ovGrid').checked = state.ov.grid; $('ovWrap').checked = state.ov.wrapLines;
  $('smart').checked = state.smart; $('mincut').checked = state.mincut;
  $('insRegions').checked = state.insRegions; $('insCuts').checked = state.insCuts; $('energy').checked = state.energy;
}

function applyLang() {
  document.documentElement.lang = state.lang;
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n);
  $('lang').textContent = state.lang === 'ja' ? 'English' : '日本語';
  for (const b of $('themes').querySelectorAll('button')) b.querySelector('span').textContent = THEMES[b.dataset.v].label[state.lang];
}
$('lang').onclick = () => { state.lang = state.lang === 'ja' ? 'en' : 'ja'; applyLang(); drawSide(); save(); };

// theme buttons with live thumbnails
for (const k of Object.keys(THEMES)) {
  const b = document.createElement('button'); b.dataset.v = k;
  const c = document.createElement('canvas'); c.width = c.height = 96;
  b.append(c, Object.assign(document.createElement('span'), { textContent: THEMES[k].label[state.lang] }));
  b.onclick = () => { state.theme = k; rebuild('all'); save(); };
  $('themes').append(b);
}
function thumbs() {
  for (const b of $('themes').querySelectorAll('button')) {
    const k = b.dataset.v; const key = `${k}|${state.texSeed}`;
    const tx = cache.get(key) || generateTexture(k, seedFrom(state.texSeed + k), 512);
    cache.set(key, tx);
    b.querySelector('canvas').getContext('2d').drawImage(tx.canvas, 0, 0, 192, 192, 0, 0, 96, 96);
  }
}

const rnd = () => Math.random().toString(36).slice(2, 8);
$('texSeed').onchange = (e) => { state.texSeed = e.target.value; rebuild('all'); save(); };
$('mapSeed').onchange = (e) => { state.mapSeed = e.target.value; rebuild('map'); save(); };
$('texDice').onclick = () => { state.texSeed = rnd(); rebuild('all'); save(); };
$('mapDice').onclick = () => { state.mapSeed = String((Math.random() * 1e6) | 0); rebuild('map'); save(); };
$('size').oninput = (e) => { state.size = +e.target.value; rebuild('map'); save(); };
$('zoom').oninput = (e) => { setZoom(+e.target.value); save(); };
const bindCheck = (id, fn) => { $(id).onchange = (e) => { fn(e.target.checked); save(); }; };
bindCheck('ovEdges', (v) => { state.ov.edges = v; drawMain(); });
bindCheck('ovIndex', (v) => { state.ov.index = v; drawMain(); });
bindCheck('ovGrid', (v) => { state.ov.grid = v; drawMain(); });
bindCheck('ovWrap', (v) => { state.ov.wrapLines = v; drawMain(); });
bindCheck('smart', (v) => { state.smart = v; rebuild('tiles'); });
bindCheck('mincut', (v) => { state.mincut = v; rebuild('tiles'); });
bindCheck('insRegions', (v) => { state.insRegions = v; drawSide(); });
bindCheck('insCuts', (v) => { state.insCuts = v; drawSide(); });
bindCheck('energy', (v) => { state.energy = v; drawSide(); });

$('atlas').onclick = (e) => {
  const r = e.target.getBoundingClientRect();
  const i = Math.floor(((e.clientY - r.top) / r.height) * 4) * 4 + Math.floor(((e.clientX - r.left) / r.width) * 4);
  state.selected = Math.max(0, Math.min(15, i)); drawSide(); save();
};
$('dl').onclick = () => {
  const a = document.createElement('a'); a.download = `wang-${state.theme}-${state.T}px.png`; a.href = set.atlas.toDataURL('image/png'); a.click();
};

function setZoom(z, cx, cy) {
  const vp = $('viewport').getBoundingClientRect();
  cx ??= vp.width / 2; cy ??= vp.height / 2;
  const z0 = 2 ** state.zoom, z1 = 2 ** z;
  const wx = cam.x + cx / z0, wy = cam.y + cy / z0;
  state.zoom = Math.max(-2, Math.min(2, z));
  cam.x = wx - cx / 2 ** state.zoom; cam.y = wy - cy / 2 ** state.zoom;
  void z1; drawMain(); syncUI();
}

// pan / zoom / hover / click
let drag = null, hover = null;
const vpEl = $('viewport');
vpEl.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: false }; vpEl.setPointerCapture(e.pointerId); vpEl.classList.add('drag'); });
vpEl.addEventListener('pointermove', (e) => {
  const r = vpEl.getBoundingClientRect(), z = 2 ** state.zoom;
  if (drag) {
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    cam.x = drag.cx - dx / z; cam.y = drag.cy - dy / z; drawMain(); $('tip').hidden = true; return;
  }
  const wx = cam.x + (e.clientX - r.left) / z, wy = cam.y + (e.clientY - r.top) / z;
  const c = Math.floor(wx / state.T), rr = Math.floor(wy / state.T);
  hover = { r: rr, c };
  const inside = state.mapKind !== 'finite' || (c >= 0 && rr >= 0 && c < state.size && rr < state.size);
  const tip = $('tip');
  if (!inside) { tip.hidden = true; return; }
  const rc = state.mapKind === 'loop' ? [((rr % state.size) + state.size) % state.size, ((c % state.size) + state.size) % state.size] : [rr, c];
  const ti = cellTile(state.mode, map, rc[0], rc[1], seedFrom('cells:' + state.mapSeed));
  const ed = edgesOf(ti.index);
  tip.hidden = false;
  tip.style.left = Math.min(r.width - 190, e.clientX - r.left + 14) + 'px';
  tip.style.top = Math.min(r.height - 80, e.clientY - r.top + 14) + 'px';
  tip.innerHTML = `cell (${rr}, ${c}) → <b>${ti.atlas === 'wang' ? '#' + ti.index : ti.atlas + ' ' + ti.index}</b>` +
    (state.mode === 'wang' ? `<br>T<span class="c${ed.top}">${ed.top}</span> R<span class="c${ed.right}">${ed.right}</span> B<span class="c${ed.bottom}">${ed.bottom}</span> L<span class="c${ed.left}">${ed.left}</span>` : '');
  drawMain();
});
vpEl.addEventListener('pointerleave', () => { $('tip').hidden = true; hover = null; drawMain(); });
vpEl.addEventListener('pointerup', (e) => {
  vpEl.classList.remove('drag');
  if (drag && !drag.moved && state.mode === 'wang' && hover) {
    const rc = state.mapKind === 'loop' ? [((hover.r % state.size) + state.size) % state.size, ((hover.c % state.size) + state.size) % state.size] : [hover.r, hover.c];
    if (state.mapKind !== 'finite' || (rc[0] >= 0 && rc[1] >= 0 && rc[0] < state.size && rc[1] < state.size)) {
      state.selected = cellTile('wang', map, rc[0], rc[1], 0).index; drawSide(); save();
    }
  }
  drag = null;
});
vpEl.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = vpEl.getBoundingClientRect();
  setZoom(state.zoom - e.deltaY * 0.0015, e.clientX - r.left, e.clientY - r.top); save();
}, { passive: false });
window.addEventListener('resize', () => drawMain());

let saveT = 0;
function save() { clearTimeout(saveT); saveT = setTimeout(() => history.replaceState(null, '', '#' + encodeURIComponent(JSON.stringify(state))), 200); }

applyLang();
syncUI();
rebuild('all').then(() => setTimeout(thumbs, 50));
void [TOP, RIGHT, BOTTOM, LEFT, MIDDLE];
