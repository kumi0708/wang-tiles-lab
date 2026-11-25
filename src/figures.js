// Renders one README figure per page load: figures.html?fig=<name>
// scripts/capture.mjs screenshots each one with headless Chrome.
import { generateTexture, THEMES } from './texture.js';
import { buildTileset, edgesOf, TOP, RIGHT, BOTTOM, LEFT, MIDDLE } from './wang.js';
import { makeEdgeMap, makeInfiniteEdges, wangIndex } from './map.js';
import { seedFrom, mod } from './noise.js';
import { drawMap, drawAtlas, drawTileInspect, drawSource, drawEdgeBars, seamStats, roundRect, EDGE_COLORS, REGION_COLORS } from './render.js';
import { FIGURES } from './figure-list.js';

const params = new URLSearchParams(location.search);
const name = params.get('fig') || 'hero';
const [W, H] = name === 'pan' ? [Number(params.get('w') || 480), Number(params.get('h') || 270)] : FIGURES[name] || [1200, 600];
const canvas = document.getElementById('c');
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');

const TEX_SEED = 'sprout', T = 64;
const FONT = '"Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const texCache = {}, setCache = {};
const texOf = (theme) => (texCache[theme] ??= generateTexture(theme, seedFrom(TEX_SEED + theme)));
const setOf = (theme, opts = {}) => (setCache[theme + JSON.stringify(opts)] ??= buildTileset(texOf(theme), T, seedFrom(TEX_SEED), opts));
const mapSeed = seedFrom('edges:1'), cellSeed = seedFrom('cells:1');

// ------------------------------------------------------------ helpers
function background() {
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, '#0d1020'); g.addColorStop(1, '#0a0c16');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const r = ctx.createRadialGradient(W * 0.1, -H * 0.2, 0, W * 0.1, -H * 0.2, W * 0.7);
  r.addColorStop(0, 'rgba(124,242,156,0.10)'); r.addColorStop(1, 'rgba(124,242,156,0)');
  ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
  const r2 = ctx.createRadialGradient(W, 0, 0, W, 0, W * 0.6);
  r2.addColorStop(0, 'rgba(46,196,255,0.10)'); r2.addColorStop(1, 'rgba(46,196,255,0)');
  ctx.fillStyle = r2; ctx.fillRect(0, 0, W, H);
}
function text(s, x, y, { size = 18, weight = 600, color = '#e8ebf7', align = 'left', font = FONT, base = 'alphabetic' } = {}) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(s, x, y);
  return ctx.measureText(s).width;
}
function heading(ja, en, x = 40, y = 52) {
  text(ja, x, y, { size: 28, weight: 800 });
  text(en, x, y + 28, { size: 16, weight: 500, color: '#9aa3c2' });
}
function panel(x, y, w, h, fn, r = 14) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#000'; roundRect(ctx, x, y, w, h, r); ctx.fill();
  ctx.restore();
  ctx.save(); roundRect(ctx, x, y, w, h, r); ctx.clip(); fn(); ctx.restore();
  ctx.save(); ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.lineWidth = 1; roundRect(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r); ctx.stroke(); ctx.restore();
}
function pill(s, x, y, { bg = 'rgba(10,12,22,0.78)', color = '#fff', size = 14, align = 'left', font = FONT, weight = 700 } = {}) {
  ctx.font = `${weight} ${size}px ${font}`;
  const w = ctx.measureText(s).width + size * 1.2, h = size * 1.9;
  const X = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  ctx.fillStyle = bg; roundRect(ctx, X, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = color; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(s, X + size * 0.6, y + h / 2 + 1);
  return w;
}
function arrow(x0, y0, x1, y1, color = 'rgba(255,255,255,0.8)', w = 3) {
  ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  const a = Math.atan2(y1 - y0, x1 - x0), L = 10 + w * 2;
  ctx.beginPath(); ctx.moveTo(x1 + Math.cos(a) * 2, y1 + Math.sin(a) * 2);
  ctx.lineTo(x1 - Math.cos(a - 0.45) * L, y1 - Math.sin(a - 0.45) * L);
  ctx.lineTo(x1 - Math.cos(a + 0.45) * L, y1 - Math.sin(a + 0.45) * L); ctx.closePath(); ctx.fill();
  ctx.restore();
}
const loopMap = (n, seed = mapSeed) => makeEdgeMap(n, n, seed, true);
const view = (x, y, zoom, w, h) => ({ x, y, zoom, w, h });

/** draw a map into a panel-local area (translate so drawMap's (0,0) = panel origin) */
function mapInto(set, map, mode, px, py, w, h, zoom, ov = {}, ox = 0, oy = 0) {
  ctx.save(); ctx.translate(px, py);
  drawMap(ctx, set, map, mode, view(ox, oy, zoom, w, h), ov, cellSeed);
  ctx.restore();
}

/** The full T x T image of one ingredient patch of a tile (edge k or middle). */
function patchCanvas(theme, set, i, k) {
  const tex = texOf(theme), S = tex.size, e = edgesOf(i), sp = set.spots;
  const c = document.createElement('canvas'); c.width = c.height = T;
  const g = c.getContext('2d'); const img = g.createImageData(T, T);
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) {
    let sx, sy;
    if (k === TOP) { sx = sp.h[e.top].x + x; sy = sp.h[e.top].y + y; }
    else if (k === BOTTOM) { sx = sp.h[e.bottom].x + x; sy = sp.h[e.bottom].y + y - T; }
    else if (k === LEFT) { sx = sp.v[e.left].x + x; sy = sp.v[e.left].y + y; }
    else if (k === RIGHT) { sx = sp.v[e.right].x + x - T; sy = sp.v[e.right].y + y; }
    else { sx = set.tiles[i].mid.x + x; sy = set.tiles[i].mid.y + y; }
    const si = (mod(sy, S) * S + mod(sx, S)) * 4, di = (y * T + x) * 4;
    img.data[di] = tex.data[si]; img.data[di + 1] = tex.data[si + 1]; img.data[di + 2] = tex.data[si + 2];
    const inRegion = set.tiles[i].region[y * T + x] === k;
    img.data[di + 3] = 255;
    if (!inRegion) { img.data[di] *= 0.28; img.data[di + 1] *= 0.28; img.data[di + 2] *= 0.28; }
  }
  g.putImageData(img, 0, 0);
  return c;
}
function drawCanvasScaled(src, x, y, w, h, smooth = false) {
  ctx.imageSmoothingEnabled = smooth; ctx.drawImage(src, x, y, w, h); ctx.imageSmoothingEnabled = true;
}
function tileCanvas(set, i, list = 'tiles') {
  const c = document.createElement('canvas'); c.width = c.height = T;
  c.getContext('2d').putImageData(new ImageData(set[list][i].pixels, T, T), 0, 0);
  return c;
}

// ------------------------------------------------------------ figures
const F = {};

F.hero = () => {
  const themes = Object.keys(THEMES);
  const n = themes.length, slant = 90, pw = (W + slant) / n;
  themes.forEach((th, i) => {
    const x0 = i * pw - slant / 2;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x0 + slant, 0); ctx.lineTo(x0 + pw + slant, 0); ctx.lineTo(x0 + pw, H); ctx.lineTo(x0, H); ctx.closePath();
    ctx.clip();
    drawMap(ctx, setOf(th), makeInfiniteEdges(mapSeed + i), 'wang', view(i * 700, 0, 1, W, H), {}, cellSeed);
    ctx.restore();
    ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.65)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(x0 + slant, 0); ctx.lineTo(x0, H); ctx.stroke(); ctx.restore();
    pill(`${THEMES[th].label.ja} · ${THEMES[th].label.en}`, x0 + pw / 2 + slant * 0.1, H - 52, { align: 'center', size: 15 });
  });
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(5,7,14,0.0)'); g.addColorStop(0.32, 'rgba(5,7,14,0.55)'); g.addColorStop(0.68, 'rgba(5,7,14,0.55)'); g.addColorStop(1, 'rgba(5,7,14,0)');
  ctx.fillStyle = g; ctx.fillRect(0, H * 0.18, W, H * 0.6);
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 20;
  text('Wang Tiles Lab', W / 2, H / 2 - 10, { size: 84, weight: 900, align: 'center' });
  text('16枚のエッジ一致タイルで、グリッド感のない地面を', W / 2, H / 2 + 44, { size: 26, weight: 700, align: 'center', color: '#e2ffe9' });
  text('2-colour edge Wang tiles · procedural textures · min-error boundary cuts · infinite hashed maps', W / 2, H / 2 + 80, { size: 17, weight: 500, align: 'center', color: '#b9c3e6' });
  ctx.restore();
};

F.problem = () => {
  background();
  heading('なぜWangタイル？ — 同じテクスチャ・4つの並べ方', 'Same source texture, four ways to fill a 12×12 looping map');
  const set = setOf('meadow'), map = loopMap(12);
  const modes = [
    ['naive', '① そのまま切り抜き', 'Naive crops', '継ぎ目が見える / seams show'],
    ['single', '② 1枚を繰り返し', 'One tile repeated', 'グリッドが見える / grid shows'],
    ['variants', '③ ランダム変種', 'Random variants', '縁が同じ / edges repeat'],
    ['wang', '④ Wangタイル', 'Wang tiles (16)', 'つながる / seamless'],
  ];
  const m = 40, gap = 20, pw = (W - m * 2 - gap * 3) / 4, py = 110, ph = H - py - 30;
  modes.forEach(([mode, ja, en, note], i) => {
    const x = m + i * (pw + gap);
    const st = seamStats(set, map, mode, 12, 12, cellSeed);
    panel(x, py, pw, ph, () => {
      mapInto(set, map, mode, x, py, pw, ph, 0.62, {}, 40, 40);
      const g = ctx.createLinearGradient(0, py, 0, py + 90); g.addColorStop(0, 'rgba(5,7,14,0.85)'); g.addColorStop(1, 'rgba(5,7,14,0)');
      ctx.fillStyle = g; ctx.fillRect(x, py, pw, 90);
      text(ja, x + 16, py + 32, { size: 21, weight: 800 });
      text(en, x + 16, py + 56, { size: 14, weight: 600, color: '#c9d1ee' });
      const good = st.ratio < 1.35;
      pill(note, x + 14, py + ph - 84, { size: 14 });
      pill(`seam jump ${st.ratio.toFixed(2)}×`, x + 14, py + ph - 46, { bg: good ? 'rgba(20,90,50,0.92)' : 'rgba(120,30,30,0.92)', size: 14, font: MONO });
    });
  });
};

F.atlas = () => {
  background();
  heading('16枚のタイルシート（index順）', 'The 4×4 sheet in index order — orange bar = colour 0, blue bar = colour 1');
  const set = setOf('meadow');
  const s = 720, x = (W - s) / 2, y = 120;
  panel(x - 14, y - 14, s + 28, s + 28, () => { ctx.fillStyle = '#0b0d17'; ctx.fillRect(x - 14, y - 14, s + 28, s + 28); drawAtlas(ctx, set, x, y, s); });
  const ly = y + s + 44;
  ctx.fillStyle = EDGE_COLORS[0]; ctx.fillRect(x, ly - 14, 26, 10);
  text('colour 0', x + 34, ly - 4, { size: 15, font: MONO });
  ctx.fillStyle = EDGE_COLORS[1]; ctx.fillRect(x + 150, ly - 14, 26, 10);
  text('colour 1', x + 184, ly - 4, { size: 15, font: MONO });
  text('col = i % 4,  row = ⌊i / 4⌋', x + s, ly - 4, { size: 15, font: MONO, align: 'right', color: '#9aa3c2' });
};

F.bitmask = () => {
  background();
  heading('4つのエッジ → 4ビット → タイル番号', 'Four edge colours pack into a 4-bit index');
  const set = setOf('meadow'), i = 6, e = edgesOf(i);
  const s = 300, x = 150, y = 150;
  panel(x, y, s, s, () => drawTileInspect(ctx, set, i, x, y, s, { bars: true }), 6);
  const lab = (t, X, Y, al, c) => pill(t, X, Y, { align: al, size: 15, font: MONO, bg: c === 0 ? 'rgba(255,159,28,0.95)' : 'rgba(46,196,255,0.95)', color: '#0b0d17' });
  lab(`top = ${e.top}   (×1)`, x + s / 2, y - 50, 'center', e.top);
  lab(`bottom = ${e.bottom}   (×4)`, x + s / 2, y + s + 22, 'center', e.bottom);
  lab(`left = ${e.left}`, x - 20, y + s / 2 - 30, 'right', e.left);
  text('(×8)', x - 70, y + s / 2 + 26, { size: 15, font: MONO, color: '#9aa3c2', align: 'center' });
  lab(`right = ${e.right}`, x + s + 20, y + s / 2 - 30, 'left', e.right);
  text('(×2)', x + s + 70, y + s / 2 + 26, { size: 15, font: MONO, color: '#9aa3c2', align: 'center' });

  const rx = 700;
  text('index = top + 2·right + 4·bottom + 8·left', rx, 190, { size: 26, weight: 700, font: MONO });
  text(`      = ${e.top} + 2·${e.right} + 4·${e.bottom} + 8·${e.left}  =  ${i}`, rx, 232, { size: 26, weight: 700, font: MONO, color: '#7cf29c' });
  const bits = [['bit 3', 'left', e.left], ['bit 2', 'bottom', e.bottom], ['bit 1', 'right', e.right], ['bit 0', 'top', e.top]];
  bits.forEach(([b, n, v], k) => {
    const bx = rx + k * 120, by = 280;
    ctx.fillStyle = v ? 'rgba(46,196,255,0.18)' : 'rgba(255,159,28,0.16)'; roundRect(ctx, bx, by, 108, 110, 12); ctx.fill();
    ctx.strokeStyle = v ? EDGE_COLORS[1] : EDGE_COLORS[0]; ctx.lineWidth = 2; roundRect(ctx, bx, by, 108, 110, 12); ctx.stroke();
    text(String(v), bx + 54, by + 62, { size: 44, weight: 800, font: MONO, align: 'center' });
    text(`${b} · ${n}`, bx + 54, by + 94, { size: 13, font: MONO, align: 'center', color: '#c9d1ee' });
  });
  text(`0b${e.left}${e.bottom}${e.right}${e.top} = ${i}`, rx + 500, 345, { size: 24, weight: 800, font: MONO, color: '#7cf29c' });
  text(`atlas: col = ${i} % 4 = ${i % 4},  row = ⌊${i} / 4⌋ = ${Math.floor(i / 4)}`, rx, 440, { size: 20, font: MONO, color: '#c9d1ee' });
  text('2⁴ = 16 通りすべてにちょうど1枚 → 探索・バックトラック不要', rx, 488, { size: 19, weight: 700 });
  text('exactly one tile for every combination: no search, no fallback', rx, 516, { size: 15, color: '#9aa3c2' });
};

F['edge-arrays'] = () => {
  background();
  heading('セルではなく「辺」を保存する', 'Store the edges, not the cells: hEdges[(rows+1)×cols], vEdges[rows×(cols+1)]');
  const rows = 3, cols = 4, map = makeEdgeMap(rows, cols, seedFrom('fig-edges'), false);
  const cs = 104, gx = 60, gy = 150, hr = 1, hc = 2;
  // grid cells
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const sel = r === hr && c === hc;
    ctx.fillStyle = sel ? 'rgba(124,242,156,0.16)' : 'rgba(255,255,255,0.04)';
    ctx.fillRect(gx + c * cs + 6, gy + r * cs + 6, cs - 12, cs - 12);
    text(`(${r},${c})`, gx + c * cs + cs / 2, gy + r * cs + cs / 2 + 6, { size: 14, font: MONO, align: 'center', color: sel ? '#7cf29c' : '#6f789a' });
  }
  const bw = 10;
  for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) {
    const v = map.hEdge(r, c), hl = (r === hr || r === hr + 1) && c === hc;
    ctx.fillStyle = EDGE_COLORS[v]; ctx.globalAlpha = hl ? 1 : 0.75;
    ctx.fillRect(gx + c * cs + 12, gy + r * cs - bw / 2, cs - 24, bw);
    if (hl) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(gx + c * cs + 12, gy + r * cs - bw / 2, cs - 24, bw); }
    ctx.globalAlpha = 1;
  }
  for (let r = 0; r < rows; r++) for (let c = 0; c <= cols; c++) {
    const v = map.vEdge(r, c), hl = r === hr && (c === hc || c === hc + 1);
    ctx.fillStyle = EDGE_COLORS[v]; ctx.globalAlpha = hl ? 1 : 0.75;
    ctx.fillRect(gx + c * cs - bw / 2, gy + r * cs + 12, bw, cs - 24);
    if (hl) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(gx + c * cs - bw / 2, gy + r * cs + 12, bw, cs - 24); }
    ctx.globalAlpha = 1;
  }
  text(`hEdges: ${rows + 1} × ${cols}`, gx, gy + rows * cs + 50, { size: 16, font: MONO, color: '#c9d1ee' });
  text(`vEdges: ${rows} × ${cols + 1}`, gx + 230, gy + rows * cs + 50, { size: 16, font: MONO, color: '#c9d1ee' });
  // explanation in the middle
  const t = map.hEdge(hr, hc), b = map.hEdge(hr + 1, hc), l = map.vEdge(hr, hc), rr = map.vEdge(hr, hc + 1);
  const idx = wangIndex(map, hr, hc);
  const mx = 540; let my = 175;
  const line = (s, c = '#e8ebf7') => { text(s, mx, my, { size: 16, font: MONO, color: c }); my += 30; };
  line(`cell (${hr},${hc}):`, '#7cf29c');
  line(`top    = hEdges[${hr}][${hc}]   = ${t}`);
  line(`bottom = hEdges[${hr + 1}][${hc}]   = ${b}`);
  line(`left   = vEdges[${hr}][${hc}]   = ${l}`);
  line(`right  = vEdges[${hr}][${hc + 1}]   = ${rr}`);
  my += 8;
  line(`index  = ${t} + 2·${rr} + 4·${b} + 8·${l} = ${idx}`, '#7cf29c');
  my += 16;
  text('隣のセルは同じ辺を読む → 必ず一致', mx, my, { size: 17, weight: 700 }); my += 26;
  text('neighbours read the same edge, so they always agree', mx, my, { size: 14, color: '#9aa3c2' });
  // rendered result
  const set = setOf('meadow'), rx = W - 40 - cols * 70, ry = 150, z = 70 / T;
  arrow(mx + 380, 300, rx - 20, 300);
  panel(rx, ry, cols * 70, rows * 70, () => mapInto(set, map, 'wang', rx, ry, cols * 70, rows * 70, z, { edges: true, index: true }));
  ctx.strokeStyle = '#7cf29c'; ctx.lineWidth = 3; ctx.strokeRect(rx + hc * 70, ry + hr * 70, 70, 70);
};

F['edges-map'] = () => {
  background();
  heading('エッジ色を可視化したマップ', 'Left: every tile with its edge colours and index · Right: the same map as the player sees it');
  const set = setOf('meadow'), map = loopMap(16);
  const pw = (W - 120) / 2, py = 110, ph = H - py - 30;
  panel(40, py, pw, ph, () => mapInto(set, map, 'wang', 40, py, pw, ph, 0.9, { edges: true, index: true, grid: true }, 32, 32));
  panel(80 + pw, py, pw, ph, () => mapInto(set, map, 'wang', 80 + pw, py, pw, ph, 0.9, {}, 32, 32));
};

F.source = () => {
  background();
  heading('元テクスチャとスポット選び', 'One seamless 512² source · H0/H1 = horizontal edge colours, V0/V1 = vertical, purple = per-tile middles');
  const tex = texOf('meadow'), set = setOf('meadow');
  const s = Math.min((W - 120) / 2, H - 140), y = 120;
  panel(40, y, s, s, () => drawSource(ctx, tex, set, 40, y, s, { midLabels: false }));
  panel(W - 40 - s, y, s, s, () => drawSource(ctx, tex, set, W - 40 - s, y, s, { energy: true, mids: false }));
  pill('source texture (seamless)', 56, y + s - 46, { size: 14 });
  pill('busy-ness: |∇L| + |L − mean|  → edges from dark = plain areas', W - 24 - s, y + s - 46, { size: 14 });
};

F.construction = () => {
  background();
  const i = 6, set = setOf('meadow');
  heading(`タイル #${i} の組み立て`, 'Four edge strips (from the edge-colour spots) + one middle patch → stitched along min-error cuts');
  const parts = [[TOP, 'top · H' + edgesOf(i).top], [RIGHT, 'right · V' + edgesOf(i).right], [BOTTOM, 'bottom · H' + edgesOf(i).bottom], [LEFT, 'left · V' + edgesOf(i).left], [MIDDLE, 'middle · M' + i]];
  const s = 176, gap = 26, y = 150;
  let x = 40;
  parts.forEach(([k, label]) => {
    const pc = patchCanvas('meadow', set, i, k);
    panel(x, y, s, s, () => drawCanvasScaled(pc, x, y, s, s), 8);
    ctx.fillStyle = REGION_COLORS[k]; ctx.fillRect(x, y + s + 14, 14, 14);
    text(label, x + 22, y + s + 26, { size: 15, font: MONO });
    x += s + gap;
    if (k !== MIDDLE) text('+', x - gap / 2, y + s / 2 + 10, { size: 30, weight: 800, align: 'center', color: '#9aa3c2' });
  });
  arrow(x - 6, y + s / 2, x + 30, y + s / 2);
  x += 46;
  panel(x, y, s, s, () => drawTileInspect(ctx, set, i, x, y, s, { regions: true, cuts: true, regionAlpha: 0.55 }), 8);
  text('regions + cuts', x, y + s + 26, { size: 15, font: MONO });
  x += s + gap;
  arrow(x - 16, y + s / 2, x + 14, y + s / 2);
  x += 30;
  panel(x, y, s, s, () => drawTileInspect(ctx, set, i, x, y, s, {}), 8);
  text(`tile #${i}`, x, y + s + 26, { size: 15, font: MONO, color: '#7cf29c' });
  text('暗くなっている部分は使わない。各帯の深さは「帯と中央パッチの色差が最小」になるようDPで決める。', 40, H - 80, { size: 17, weight: 600 });
  text('Dimmed pixels are discarded. Each strip\'s depth along the edge is chosen by dynamic programming to minimise the colour difference with the middle.', 40, H - 52, { size: 14, color: '#9aa3c2' });
};

F.continuity = () => {
  background();
  heading('なぜ継ぎ目が消えるのか', 'Both tiles cut their side of the shared edge from the SAME spot in the source');
  const theme = 'meadow', set = setOf(theme), tex = texOf(theme), S = tex.size;
  const color = 1, spot = set.spots.h[color], k = 3.4, s = T * k, y = 150;
  // source crop around the spot: rows spot.y - T .. spot.y + T
  const crop = document.createElement('canvas'); crop.width = T; crop.height = T * 2;
  const cg = crop.getContext('2d'); const img = cg.createImageData(T, T * 2);
  for (let yy = 0; yy < T * 2; yy++) for (let xx = 0; xx < T; xx++) {
    const si = (mod(spot.y - T + yy, S) * S + mod(spot.x + xx, S)) * 4, di = (yy * T + xx) * 4;
    img.data[di] = tex.data[si]; img.data[di + 1] = tex.data[si + 1]; img.data[di + 2] = tex.data[si + 2]; img.data[di + 3] = 255;
  }
  cg.putImageData(img, 0, 0);
  const x0 = 60;
  panel(x0, y, s, s * 2 - 120 > 0 ? s * 2 : s * 2, () => {}, 8);
  ctx.save(); roundRect(ctx, x0, y, s, s * 2, 8); ctx.clip(); drawCanvasScaled(crop, x0, y, s, s * 2); ctx.restore();
  // just show the strips that are used: half above the line and half below
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x0, y, s, s / 2); ctx.fillRect(x0, y + s * 1.5, s, s / 2);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(x0 - 10, y + s); ctx.lineTo(x0 + s + 10, y + s); ctx.stroke();
  pill(`spot H${color} (row y)`, x0 + s / 2, y + s - 15, { align: 'center', size: 13, font: MONO, bg: EDGE_COLORS[color], color: '#0b0d17' });
  text('source', x0, y - 14, { size: 15, font: MONO, color: '#9aa3c2' });

  // tile A (bottom = 1) above tile B (top = 1) — matched
  const A = 4 /* bottom=1 */, B = 1 /* top=1 */, Bbad = 0 /* top=0 */;
  const pair = (px, top, bot, title, ok) => {
    panel(px, y, s, s * 2, () => { drawCanvasScaled(tileCanvas(set, top), px, y, s, s); drawCanvasScaled(tileCanvas(set, bot), px, y + s, s, s); }, 8);
    text(title, px, y - 14, { size: 15, font: MONO, color: '#9aa3c2' });
    pill(`#${top}  (bottom=${edgesOf(top).bottom})`, px + 10, y + 10, { size: 13, font: MONO });
    pill(`#${bot}  (top=${edgesOf(bot).top})`, px + 10, y + s * 2 - 40, { size: 13, font: MONO });
    pill(ok ? '✓ 同じ色 → 連続' : '✗ 違う色 → 継ぎ目', px + s / 2, y + s * 2 + 18, { align: 'center', size: 15, bg: ok ? 'rgba(20,110,60,0.95)' : 'rgba(140,30,30,0.95)' });
  };
  const x1 = x0 + s + 140, x2 = x1 + s + 120;
  arrow(x0 + s + 20, y + s * 0.75, x1 - 20, y + s * 0.75);
  arrow(x0 + s + 20, y + s * 1.25, x1 - 20, y + s * 1.25);
  pair(x1, A, B, 'neighbours (matched)', true);
  pair(x2, A, Bbad, 'forced mismatch', false);
  const tx = x2 + s + 50; let ty = 220;
  for (const [s1, c] of [['上のタイルの下帯 = スポットの', '#e8ebf7'], ['「上半分」(y−32 … y−1)', '#e8ebf7'], ['下のタイルの上帯 = スポットの', '#e8ebf7'], ['「下半分」(y … y+31)', '#e8ebf7'], ['', ''], ['→ 境界をまたいで元画像が', '#7cf29c'], ['   そのまま続く', '#7cf29c'], ['', ''], ['Upper tile: rows y−32…y−1', '#9aa3c2'], ['Lower tile: rows y…y+31', '#9aa3c2'], ['= one continuous patch', '#9aa3c2']]) {
    text(s1, tx, ty, { size: 16, weight: 700, color: c }); ty += 28;
  }
};

F.mincut = () => {
  background();
  heading('最小誤差境界カット（Image Quilting）', 'Straight cut vs. dynamic-programming cut along the path of least colour difference');
  const theme = 'forest', i = 9;
  const straight = setOf(theme, { minCut: false }), cut = setOf(theme, {});
  const s = 270, y = 130, gap = 30;
  const items = [[straight, true, '直線カット (領域)', 'straight cut — regions'], [straight, false, '直線カット (結果)', 'straight cut — result'], [cut, true, '最小誤差カット (領域)', 'min-error cut — regions'], [cut, false, '最小誤差カット (結果)', 'min-error cut — result']];
  items.forEach(([set, reg, ja, en], k) => {
    const x = 40 + k * (s + gap) + (k >= 2 ? 30 : 0);
    panel(x, y, s, s, () => drawTileInspect(ctx, set, i, x, y, s, { regions: reg, cuts: reg, regionAlpha: 0.45 }), 8);
    text(ja, x, y + s + 32, { size: 17, weight: 700 });
    text(en, x, y + s + 56, { size: 14, color: '#9aa3c2', font: MONO });
  });
  ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(40 + 2 * (s + gap) + 2, y); ctx.lineTo(40 + 2 * (s + gap) + 2, y + s + 60); ctx.stroke();
};

F.smart = () => {
  background();
  heading('エッジは「平坦な場所」から切る', 'Random spots (left) put busy detail on every edge → a new grid appears. Plain spots (right) hide it.');
  const theme = 'meadow', map = loopMap(20, seedFrom('smart'));
  const pw = (W - 120) / 2, py = 110, ph = H - py - 30;
  const a = setOf(theme, { smart: false }), b = setOf(theme, {});
  panel(40, py, pw, ph, () => mapInto(a, map, 'wang', 40, py, pw, ph, 0.7, {}, 20, 20));
  panel(80 + pw, py, pw, ph, () => mapInto(b, map, 'wang', 80 + pw, py, pw, ph, 0.7, {}, 20, 20));
  pill('random spots · ランダム', 56, py + 16, { size: 15 });
  pill('plain spots · 平坦な場所', 96 + pw, py + 16, { size: 15 });
};

F.themes = () => {
  background();
  heading('5つの手続き型テーマ', 'Every texture is generated in the browser from seamless noise + vector details, then cut into 16 Wang tiles');
  const themes = Object.keys(THEMES), m = 40, gap = 18, pw = (W - m * 2 - gap * 4) / 5, y = 110;
  themes.forEach((th, i) => {
    const x = m + i * (pw + gap), set = setOf(th);
    panel(x, y, pw, pw, () => mapInto(set, makeInfiniteEdges(mapSeed), 'wang', x, y, pw, pw, 0.75, {}, 0, 0));
    pill(`${THEMES[th].label.ja} · ${THEMES[th].label.en}`, x + 10, y + 10, { size: 14 });
    const ay = y + pw + 18, as = pw;
    panel(x, ay, as, as * 0.62, () => {
      ctx.fillStyle = '#0b0d17'; ctx.fillRect(x, ay, as, as);
      drawAtlas(ctx, set, x + 8, ay + 8, as * 0.62 - 16, { labels: false, gap: 3 });
      drawCanvasScaled(texOf(th).canvas, x + as * 0.62, ay + 8, as * 0.38 - 8, as * 0.38 - 8, true);
      text('16 tiles', x + 14, ay + as * 0.62 - 14, { size: 0.1 });
    });
    text('atlas', x + 8, ay + as * 0.62 + 22, { size: 13, font: MONO, color: '#9aa3c2' });
    text('source', x + as * 0.62, ay + as * 0.62 + 22, { size: 13, font: MONO, color: '#9aa3c2' });
  });
};

F.loop = () => {
  background();
  heading('ループするマップ', 'rows×cols edge arrays + modulo: hEdges[(r+1) % rows], vEdges[(c+1) % cols] → a torus. Dashed = period');
  const map = loopMap(6, seedFrom('loop')), set = setOf('desert');
  const py = 110, ph = H - py - 30;
  panel(40, py, W - 80, ph, () => mapInto(set, map, 'wang', 40, py, W - 80, ph, 0.8, { wrapLines: true }, -40, -30));
};

F.infinite = () => {
  background();
  heading('無限マップ：エッジをハッシュで計算', 'edge bit = hash(seed, x, y, H|V) & 1 — chunks agree on shared edges without sharing any data');
  const set = setOf('snow'), map = makeInfiniteEdges(mapSeed);
  const px = 40, py = 110, pw = W - 80, ph = H - py - 30, z = 0.55, chunk = 8;
  const ox = -3 * T, oy = -2 * T;
  panel(px, py, pw, ph, () => {
    mapInto(set, map, 'wang', px, py, pw, ph, z, {}, ox, oy);
    ctx.save(); ctx.translate(px, py);
    ctx.strokeStyle = 'rgba(20,40,90,0.85)'; ctx.setLineDash([10, 7]); ctx.lineWidth = 2.5;
    const step = chunk * T * z;
    const sx = (-ox * z) % step, sy = (-oy * z) % step;
    for (let x = sx; x < pw; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ph); ctx.stroke(); }
    for (let y = sy; y < ph; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(pw, y); ctx.stroke(); }
    ctx.setLineDash([]);
    for (let x = sx - step, cx = Math.floor(ox / (chunk * T)) - (sx > 0 ? 1 : 0); x < pw; x += step, cx++) {
      for (let y = sy - step, cy = Math.floor(oy / (chunk * T)) - (sy > 0 ? 1 : 0); y < ph; y += step, cy++) {
        if (x + 10 < 0 || y + 10 < 0) continue;
        pill(`chunk (${cx + 1}, ${cy + 1})`, x + 10, y + 10, { size: 13, font: MONO, bg: 'rgba(20,30,60,0.75)' });
      }
    }
    ctx.restore();
  });
};

// pan frames for the README GIF: figures.html?fig=pan&f=<frame>
F.pan = () => {
  const f = Number(params.get('f') || 0);
  const set = setOf(params.get('theme') || 'meadow');
  drawMap(ctx, set, makeInfiniteEdges(mapSeed), 'wang', view(f * 6, f * 3, 1, W, H), {}, cellSeed);
};

(F[name] || F.hero)();
document.title = 'ready';
void [cellSeed];
