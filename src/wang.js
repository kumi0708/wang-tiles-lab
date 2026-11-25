// Building a 2-colour edge Wang tileset (16 tiles) from one seamless texture.
//
//   index = top + 2*right + 4*bottom + 8*left        (each edge colour is 0 or 1)
//
// Construction (following the SpriteCook article):
//  * Pick 2 "spots" in the source for horizontal edge colours (H0, H1) and
//    2 for vertical edge colours (V0, V1) — preferably in plain, low-detail areas.
//  * A tile's TOP strip is copied from its top colour's spot starting at the
//    spot's row; the tile ABOVE copies its BOTTOM strip from the same spot,
//    ending just above that row. So the two neighbours continue the same
//    texture patch across their shared edge -> no visible seam.
//  * Same for LEFT / RIGHT with the vertical spots.
//  * Every tile gets its own MIDDLE patch from a different spot (variety).
//  * Each edge strip is stitched to the middle along a minimum-error boundary
//    cut (dynamic programming, Efros & Freeman 2001), then feathered by ~1px.

import { mulberry32, mod } from './noise.js';
import { makeCanvas } from './texture.js';

export const TOP = 0, RIGHT = 1, BOTTOM = 2, LEFT = 3, MIDDLE = 4;

export const edgesOf = (i) => ({ top: i & 1, right: (i >> 1) & 1, bottom: (i >> 2) & 1, left: (i >> 3) & 1 });
export const indexOf = (t, r, b, l) => t + 2 * r + 4 * b + 8 * l;

/** Busy-ness map: blurred gradient energy + deviation from the mean colour. */
function energyField(tex) {
  const { data, size: S } = tex;
  const lum = new Float32Array(S * S);
  let mean = 0;
  for (let i = 0; i < S * S; i++) {
    const v = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    lum[i] = v; mean += v;
  }
  mean /= S * S;
  const e = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = lum[y * S + x];
      const gx = lum[y * S + mod(x + 1, S)] - c;
      const gy = lum[mod(y + 1, S) * S + x] - c;
      e[y * S + x] = Math.abs(gx) + Math.abs(gy) + Math.abs(c - mean) * 0.9;
    }
  }
  // integral image with wrap is awkward; use a padded summed-area table
  const P = S * 2;
  const sat = new Float64Array((P + 1) * (P + 1));
  for (let y = 0; y < P; y++) {
    let row = 0;
    for (let x = 0; x < P; x++) {
      row += e[mod(y, S) * S + mod(x, S)];
      sat[(y + 1) * (P + 1) + x + 1] = sat[y * (P + 1) + x + 1] + row;
    }
  }
  const boxMean = (x0, y0, w, h) => {
    x0 = mod(x0, S); y0 = mod(y0, S);
    const x1 = x0 + w, y1 = y0 + h, W = P + 1;
    return (sat[y1 * W + x1] - sat[y0 * W + x1] - sat[y1 * W + x0] + sat[y0 * W + x0]) / (w * h);
  };
  return { e, boxMean };
}

/**
 * Choose source spots. Returns { h:[{x,y}...2], v:[...2], mid:[...16+], energy }.
 * smart=true -> edge spots come from the plainest regions (article's tip).
 */
export function chooseSpots(tex, T, seed, smart = true, middles = 20) {
  const S = tex.size;
  const R = mulberry32(seed ^ 0x5eed);
  const field = energyField(tex);
  const step = 8;
  const cands = [];
  for (let y = 0; y < S; y += step) for (let x = 0; x < S; x += step) {
    const jx = x + ((R() * step) | 0), jy = y + ((R() * step) | 0);
    cands.push({ x: jx, y: jy, hE: field.boxMean(jx, jy - T / 2, T, T), vE: field.boxMean(jx - T / 2, jy, T, T), mE: field.boxMean(jx, jy, T, T), r: R() });
  }
  const far = (p, list, d) => list.every((q) => {
    const dx = Math.min(Math.abs(p.x - q.x), S - Math.abs(p.x - q.x));
    const dy = Math.min(Math.abs(p.y - q.y), S - Math.abs(p.y - q.y));
    return Math.hypot(dx, dy) > d;
  });
  const pick = (sorted, n, taken, d) => {
    const out = [];
    for (const c of sorted) { if (out.length >= n) break; if (far(c, [...taken, ...out], d)) out.push(c); }
    return out;
  };
  const order = (key) => (smart ? [...cands].sort((a, b) => a[key] - b[key]) : [...cands].sort((a, b) => a.r - b.r));
  const h = pick(order('hE'), 2, [], T * 1.2);
  const v = pick(order('vE'), 2, h, T * 1.2);
  // middles: random, but skip the busiest 10% so single features don't pop out every 16 cells
  const sortedM = [...cands].sort((a, b) => a.mE - b.mE);
  const okM = (smart ? sortedM.slice(0, Math.floor(sortedM.length * 0.9)) : sortedM).sort((a, b) => a.r - b.r);
  const mid = pick(okM, middles, [...h, ...v], T * 0.7);
  return { h, v, mid, energy: field.e };
}

/** Sample the source with wrap-around. */
const sampler = (tex) => (x, y, out, o) => {
  const S = tex.size;
  const i = (mod(Math.round(y), S) * S + mod(Math.round(x), S)) * 4;
  out[o] = tex.data[i]; out[o + 1] = tex.data[i + 1]; out[o + 2] = tex.data[i + 2];
};

/**
 * Build one tile. edges = {top,right,bottom,left} in {0,1}; midSpot = {x,y}.
 * Returns { pixels: Uint8ClampedArray RGBA, region: Uint8Array, cuts: [4][T] }.
 */
export function buildTile(tex, spots, edges, midSpot, T, opts = {}) {
  const sample = sampler(tex);
  const cmin = Math.round(T * (opts.cmin ?? 0.14));
  const cmax = Math.round(T * (opts.cmax ?? 0.42));
  const feather = opts.feather ?? 1.25;
  const useCut = opts.minCut ?? true;
  const H = spots.h, V = spots.v;

  // edge patch sample for edge k at tile pixel (x,y)
  const edgePix = (k, x, y, out, o) => {
    if (k === TOP) { const s = H[edges.top]; sample(s.x + x, s.y + y, out, o); }
    else if (k === BOTTOM) { const s = H[edges.bottom]; sample(s.x + x, s.y + y - T, out, o); }
    else if (k === LEFT) { const s = V[edges.left]; sample(s.x + x, s.y + y, out, o); }
    else { const s = V[edges.right]; sample(s.x + x - T, s.y + y, out, o); }
  };
  const midPix = (x, y, out, o) => sample(midSpot.x + x, midSpot.y + y, out, o);
  // (u along edge, v depth) -> tile (x,y)
  const toXY = (k, u, v) => (k === TOP ? [u, v] : k === BOTTOM ? [u, T - 1 - v] : k === LEFT ? [v, u] : [T - 1 - v, u]);

  // --- minimum error boundary cut per edge (DP over u, choose depth c(u))
  const cuts = [];
  const a = new Uint8ClampedArray(3), b = new Uint8ClampedArray(3);
  for (let k = 0; k < 4; k++) {
    const nC = cmax - cmin + 1;
    const cost = new Float32Array(T * nC);
    const back = new Int8Array(T * nC);
    for (let u = 0; u < T; u++) {
      for (let j = 0; j < nC; j++) {
        const v = cmin + j;
        const [x, y] = toXY(k, u, v);
        edgePix(k, x, y, a, 0); midPix(x, y, b, 0);
        const err = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
        // corners belong to the diagonal seam anyway: make them free
        const corner = v > Math.min(u, T - 1 - u) ? 0.15 : 1;
        let best = 0, bi = 0;
        if (u > 0) {
          best = Infinity;
          for (let d = -1; d <= 1; d++) {
            const jj = j + d;
            if (jj < 0 || jj >= nC) continue;
            const c = cost[(u - 1) * nC + jj];
            if (c < best) { best = c; bi = d; }
          }
        }
        cost[u * nC + j] = err * corner + best;
        back[u * nC + j] = bi;
      }
    }
    let j = 0, bestC = Infinity;
    for (let jj = 0; jj < nC; jj++) if (cost[(T - 1) * nC + jj] < bestC) { bestC = cost[(T - 1) * nC + jj]; j = jj; }
    const cut = new Float32Array(T);
    for (let u = T - 1; u >= 0; u--) { cut[u] = cmin + j; j += back[u * nC + j]; }
    if (!useCut) cut.fill(Math.round((cmin + cmax) / 2));
    cuts.push(cut);
  }

  // --- compose
  const pixels = new Uint8ClampedArray(T * T * 4);
  const region = new Uint8Array(T * T);
  const e1 = new Uint8ClampedArray(3), e2 = new Uint8ClampedArray(3), m = new Uint8ClampedArray(3);
  for (let y = 0; y < T; y++) {
    for (let x = 0; x < T; x++) {
      const depth = [y, T - 1 - x, T - 1 - y, x]; // TOP, RIGHT, BOTTOM, LEFT
      const along = [x, y, x, y];
      let k1 = 0;
      for (let k = 1; k < 4; k++) if (depth[k] < depth[k1]) k1 = k;
      let k2 = -1;
      for (let k = 0; k < 4; k++) if (k !== k1 && (k2 < 0 || depth[k] < depth[k2])) k2 = k;
      const v1 = depth[k1], v2 = depth[k2];
      edgePix(k1, x, y, e1, 0);
      let er = e1[0], eg = e1[1], eb = e1[2];
      // feather the diagonal seam between two edge triangles (never on the outer row)
      if (v1 > 0 && v2 - v1 < 2.5) {
        edgePix(k2, x, y, e2, 0);
        const w = 0.5 - (v2 - v1) / 5; // 0.5 on diagonal -> 0
        er += (e2[0] - er) * w; eg += (e2[1] - eg) * w; eb += (e2[2] - eb) * w;
      }
      const c = cuts[k1][along[k1]];
      let t = (v1 - (c - feather)) / (2 * feather);
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      if (v1 === 0) t = 0;
      midPix(x, y, m, 0);
      const i = (y * T + x) * 4;
      pixels[i] = er + (m[0] - er) * t;
      pixels[i + 1] = eg + (m[1] - eg) * t;
      pixels[i + 2] = eb + (m[2] - eb) * t;
      pixels[i + 3] = 255;
      region[y * T + x] = t > 0.5 ? MIDDLE : k1;
    }
  }
  return { pixels, region, cuts };
}

/**
 * Build the full set.
 *  tiles[0..15]   : Wang tiles in index order
 *  variants[0..3] : all-0-edge tiles with different middles ("random variants" demo)
 *  naive[0..15]   : plain T x T crops (no edge matching) for comparison
 */
export function buildTileset(tex, T, seed, opts = {}) {
  const spots = chooseSpots(tex, T, seed, opts.smart ?? true);
  const tiles = [];
  for (let i = 0; i < 16; i++) tiles.push({ index: i, edges: edgesOf(i), mid: spots.mid[i], ...buildTile(tex, spots, edgesOf(i), spots.mid[i], T, opts) });
  const variants = [];
  for (let i = 0; i < 4; i++) {
    const mid = spots.mid[(16 + i) % spots.mid.length];
    variants.push({ index: 0, edges: edgesOf(0), mid, ...buildTile(tex, spots, edgesOf(0), mid, T, opts) });
  }
  const naive = spots.mid.slice(0, 16).map((s) => {
    const pixels = new Uint8ClampedArray(T * T * 4);
    const smp = sampler(tex);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { smp(s.x + x, s.y + y, pixels, (y * T + x) * 4); pixels[(y * T + x) * 4 + 3] = 255; }
    return { pixels, mid: s };
  });
  const toCanvas = (list) => {
    const c = makeCanvas(T * 4, T * Math.ceil(list.length / 4));
    const ctx = c.getContext('2d');
    list.forEach((t, i) => ctx.putImageData(new ImageData(t.pixels, T, T), (i % 4) * T, Math.floor(i / 4) * T));
    return c;
  };
  return { T, spots, tiles, variants, naive, atlas: toCanvas(tiles), variantAtlas: toCanvas(variants), naiveAtlas: toCanvas(naive) };
}
