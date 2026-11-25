// Shared canvas drawing used by both the app and the README figure page.
import { cellTile } from './map.js';
import { mod } from './noise.js';
import { TOP, RIGHT, BOTTOM, LEFT, MIDDLE, edgesOf } from './wang.js';

export const EDGE_COLORS = ['#ff9f1c', '#2ec4ff']; // colour 0 = orange, colour 1 = blue (as in the article)
export const REGION_COLORS = ['#ff5d73', '#ffd23f', '#3ddc97', '#4cc9f0', '#b388ff']; // top,right,bottom,left,middle

export function atlasFor(set, which) {
  return which === 'variant' ? set.variantAtlas : which === 'naive' ? set.naiveAtlas : set.atlas;
}

/** Visible cell range for a view. view = {x, y (world px of top-left), zoom, w, h}. */
export function visibleCells(set, view) {
  const s = set.T * view.zoom;
  return { s, c0: Math.floor(view.x / set.T), r0: Math.floor(view.y / set.T), c1: Math.ceil((view.x + view.w / view.zoom) / set.T), r1: Math.ceil((view.y + view.h / view.zoom) / set.T) };
}

function resolveCell(map, r, c) {
  if (map.kind === 'loop') return [mod(r, map.rows), mod(c, map.cols)];
  if (map.kind === 'finite' && (r < 0 || c < 0 || r >= map.rows || c >= map.cols)) return null;
  return [r, c];
}

export function drawMap(ctx, set, map, mode, view, ov = {}, seed = 0) {
  const { s, c0, r0, c1, r1 } = visibleCells(set, view);
  const T = set.T;
  ctx.imageSmoothingEnabled = view.zoom < 1;
  ctx.imageSmoothingQuality = 'high';
  const px = (c) => Math.round((c * T - view.x) * view.zoom);
  const py = (r) => Math.round((r * T - view.y) * view.zoom);
  const cells = [];
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const rc = resolveCell(map, r, c);
      if (!rc) continue;
      const t = cellTile(mode, map, rc[0], rc[1], seed);
      const a = atlasFor(set, t.atlas);
      const x = px(c), y = py(r), w = px(c + 1) - x, h = py(r + 1) - y;
      ctx.drawImage(a, (t.index % 4) * T, Math.floor(t.index / 4) * T, T, T, x, y, w, h);
      cells.push({ r, c, rc, t, x, y, w, h });
    }
  }
  if (map.kind === 'loop' && ov.wrapLines) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2;
    for (let c = Math.floor(c0 / map.cols) * map.cols; c <= c1; c += map.cols) { ctx.beginPath(); ctx.moveTo(px(c), 0); ctx.lineTo(px(c), view.h); ctx.stroke(); }
    for (let r = Math.floor(r0 / map.rows) * map.rows; r <= r1; r += map.rows) { ctx.beginPath(); ctx.moveTo(0, py(r)); ctx.lineTo(view.w, py(r)); ctx.stroke(); }
    ctx.restore();
  }
  if (ov.grid) {
    ctx.save();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
    for (const k of cells) ctx.strokeRect(k.x + 0.5, k.y + 0.5, k.w, k.h);
    ctx.restore();
  }
  if (ov.edges && mode === 'wang') for (const k of cells) drawEdgeBars(ctx, edgesOf(k.t.index), k.x, k.y, k.w);
  if (ov.index) {
    ctx.save();
    const fs = Math.max(9, Math.min(20, s * 0.28));
    ctx.font = `700 ${fs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const k of cells) {
      const label = String(k.t.index);
      ctx.fillStyle = 'rgba(8,10,20,0.62)';
      const tw = ctx.measureText(label).width + fs * 0.6;
      roundRect(ctx, k.x + k.w / 2 - tw / 2, k.y + k.h / 2 - fs * 0.7, tw, fs * 1.4, fs * 0.35); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(label, k.x + k.w / 2, k.y + k.h / 2 + 1);
    }
    ctx.restore();
  }
  return cells;
}

/** Coloured bars just inside each edge: orange = colour 0, blue = colour 1. */
export function drawEdgeBars(ctx, e, x, y, s, thick) {
  const t = thick ?? Math.max(2, s * 0.07), inset = Math.max(1, s * 0.12);
  ctx.save();
  const bar = (col, bx, by, bw, bh) => {
    ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = col; ctx.fillRect(bx, by, bw, bh);
  };
  bar(EDGE_COLORS[e.top], x + inset, y + 1, s - inset * 2, t);
  bar(EDGE_COLORS[e.bottom], x + inset, y + s - t - 1, s - inset * 2, t);
  bar(EDGE_COLORS[e.left], x + 1, y + inset, t, s - inset * 2);
  bar(EDGE_COLORS[e.right], x + s - t - 1, y + inset, t, s - inset * 2);
  ctx.restore();
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** 4x4 atlas with edge bars + index labels. Returns cell size. */
export function drawAtlas(ctx, set, x, y, size, opts = {}) {
  const T = set.T, gap = opts.gap ?? Math.round(size * 0.035), cs = (size - gap * 3) / 4;
  ctx.imageSmoothingEnabled = true;
  for (let i = 0; i < 16; i++) {
    const cx = x + (i % 4) * (cs + gap), cy = y + Math.floor(i / 4) * (cs + gap);
    ctx.drawImage(set.atlas, (i % 4) * T, Math.floor(i / 4) * T, T, T, cx, cy, cs, cs);
    if (opts.bars !== false) drawEdgeBars(ctx, edgesOf(i), cx, cy, cs);
    if (opts.labels !== false) {
      const fs = Math.max(10, cs * 0.2);
      ctx.font = `800 ${fs}px ui-monospace, Menlo, monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(8,10,20,0.65)';
      roundRect(ctx, cx + cs / 2 - fs, cy + cs / 2 - fs * 0.7, fs * 2, fs * 1.4, fs * 0.4); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.fillText(i, cx + cs / 2, cy + cs / 2 + 1);
    }
    if (opts.selected === i) {
      ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(cx - 2, cy - 2, cs + 4, cs + 4); ctx.restore();
    }
  }
  return { cs, gap };
}

/** Big view of one tile: optional region tint + cut lines. */
export function drawTileInspect(ctx, set, i, x, y, size, opts = {}) {
  const T = set.T, tile = set.tiles[i], k = size / T;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(set.atlas, (i % 4) * T, Math.floor(i / 4) * T, T, T, x, y, size, size);
  if (opts.regions) {
    ctx.save(); ctx.globalAlpha = opts.regionAlpha ?? 0.42;
    for (let py = 0; py < T; py++) for (let px = 0; px < T; px++) {
      ctx.fillStyle = REGION_COLORS[tile.region[py * T + px]];
      ctx.fillRect(x + px * k, y + py * k, Math.ceil(k), Math.ceil(k));
    }
    ctx.restore();
  }
  if (opts.cuts) {
    ctx.save(); ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1.5, k * 0.35); ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    for (let e = 0; e < 4; e++) {
      ctx.beginPath();
      let started = false;
      for (let u = 0; u < T; u++) {
        const v = tile.cuts[e][u];
        if (v > Math.min(u, T - 1 - u)) { started = false; continue; } // inside a corner: diagonal seam rules
        const [tx, ty] = e === TOP ? [u + 0.5, v] : e === BOTTOM ? [u + 0.5, T - v] : e === LEFT ? [v, u + 0.5] : [T - v, u + 0.5];
        if (!started) { ctx.moveTo(x + tx * k, y + ty * k); started = true; } else ctx.lineTo(x + tx * k, y + ty * k);
      }
      ctx.stroke();
    }
    ctx.setLineDash([k * 2, k * 2]); ctx.lineWidth = Math.max(1, k * 0.2); ctx.globalAlpha = 0.7;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + size, y + size); ctx.moveTo(x + size, y); ctx.lineTo(x, y + size); ctx.stroke();
    ctx.restore();
  }
  if (opts.bars) drawEdgeBars(ctx, tile.edges, x, y, size, Math.max(4, size * 0.03));
}

/** Source texture + chosen spots. */
export function drawSource(ctx, tex, set, x, y, size, opts = {}) {
  const S = tex.size, k = size / S, T = set.T;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tex.canvas, x, y, size, size);
  if (opts.energy) {
    const c = document.createElement('canvas'); c.width = S; c.height = S;
    const g = c.getContext('2d'); const img = g.createImageData(S, S);
    let max = 0; for (const v of set.spots.energy) if (v > max) max = v;
    for (let i = 0; i < S * S; i++) {
      const t = Math.min(1, set.spots.energy[i] / (max * 0.5));
      img.data[i * 4] = 255 * Math.min(1, t * 2); img.data[i * 4 + 1] = 255 * Math.max(0, t * 2 - 1) * 0.9; img.data[i * 4 + 2] = 60 * (1 - t); img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    ctx.drawImage(c, x, y, size, size);
  }
  ctx.save();
  ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
  const lw = Math.max(1.5, size / 300);
  const box = (bx, by, bw, bh, col, label, dash) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
      const X = x + (bx + dx) * k, Y = y + (by + dy) * k;
      ctx.setLineDash(dash || []);
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = lw + 2; ctx.strokeRect(X, Y, bw * k, bh * k);
      ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.strokeRect(X, Y, bw * k, bh * k);
      if (label) {
        const fs = Math.max(10, size / 42);
        ctx.font = `800 ${fs}px ui-monospace, Menlo, monospace`; ctx.textBaseline = 'top';
        ctx.fillStyle = col; const w = ctx.measureText(label).width + 6;
        ctx.fillRect(X, Y - fs - 4, w, fs + 4); ctx.fillStyle = '#0b0d17'; ctx.fillText(label, X + 3, Y - fs - 2);
      }
    }
  };
  if (opts.mids !== false) set.spots.mid.slice(0, 16).forEach((m, i) => box(m.x, m.y, T, T, 'rgba(179,136,255,0.95)', opts.midLabels ? `M${i}` : null, [4, 3]));
  set.spots.h.forEach((s, i) => {
    box(s.x, s.y - T / 2, T, T, EDGE_COLORS[i], `H${i}`);
    ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x + s.x * k, y + s.y * k); ctx.lineTo(x + (s.x + T) * k, y + s.y * k); ctx.stroke();
  });
  set.spots.v.forEach((s, i) => {
    box(s.x - T / 2, s.y, T, T, EDGE_COLORS[i], `V${i}`);
    ctx.setLineDash([]); ctx.strokeStyle = '#fff'; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(x + s.x * k, y + s.y * k); ctx.lineTo(x + s.x * k, y + (s.y + T) * k); ctx.stroke();
  });
  ctx.restore();
}

/**
 * Seam quality: mean colour jump across tile seams divided by the mean jump
 * between adjacent pixels anywhere inside the tiles. ~1.0 = invisible seams.
 */
export function seamStats(set, map, mode, rows, cols, seed) {
  const T = set.T;
  const get = (r, c) => {
    const rc = map.kind === 'loop' ? [mod(r, map.rows), mod(c, map.cols)] : [r, c];
    const t = cellTile(mode, map, rc[0], rc[1], seed);
    const list = t.atlas === 'variant' ? set.variants : t.atlas === 'naive' ? set.naive : set.tiles;
    return { px: list[t.index].pixels, t };
  };
  const d = (a, i, b, j) => Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
  let seam = 0, ns = 0, inner = 0, ni = 0, logical = 0, mismatch = 0;
  const usage = new Array(16).fill(0);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const A = get(r, c); usage[A.t.index]++;
    const Rt = c + 1 < cols ? get(r, c + 1) : null, Bt = r + 1 < rows ? get(r + 1, c) : null;
    for (let k = 0; k < T; k++) {
      if (Rt) { seam += d(A.px, (k * T + T - 1) * 4, Rt.px, (k * T) * 4); ns++; }
      if (Bt) { seam += d(A.px, ((T - 1) * T + k) * 4, Bt.px, k * 4); ns++; }
    }
    // baseline: typical jump between adjacent pixels anywhere inside the tile
    for (let y = 1; y < T; y += 3) for (let x = 1; x < T; x += 3) {
      inner += d(A.px, (y * T + x) * 4, A.px, (y * T + x - 1) * 4); ni++;
      inner += d(A.px, (y * T + x) * 4, A.px, ((y - 1) * T + x) * 4); ni++;
    }
    if (mode === 'wang') {
      const ea = edgesOf(A.t.index);
      if (Rt) { logical++; if (ea.right !== edgesOf(Rt.t.index).left) mismatch++; }
      if (Bt) { logical++; if (ea.bottom !== edgesOf(Bt.t.index).top) mismatch++; }
    }
  }
  return { ratio: seam / ns / (inner / ni), logical, mismatch, usage };
}
