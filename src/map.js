// Edge grids -> tile indices.
//
// Finite map (rows x cols):
//   hEdges: (rows+1) x cols   hEdges[r][c] = TOP edge of cell (r,c)
//   vEdges: rows x (cols+1)   vEdges[r][c] = LEFT edge of cell (r,c)
// Looping map: rows x cols for both, neighbours read with % rows / % cols.
// Infinite map: no storage. Each edge colour is one bit of
//   hash(seed, x, y, horizontal|vertical) so chunks agree without sharing data.

import { mulberry32, hash4 } from './noise.js';

export function makeEdgeMap(rows, cols, seed, wrap) {
  const R = mulberry32(seed);
  const hRows = wrap ? rows : rows + 1, vCols = wrap ? cols : cols + 1;
  const h = new Uint8Array(hRows * cols), v = new Uint8Array(rows * vCols);
  for (let i = 0; i < h.length; i++) h[i] = R() < 0.5 ? 1 : 0; // fair coin per edge
  for (let i = 0; i < v.length; i++) v[i] = R() < 0.5 ? 1 : 0;
  return {
    kind: wrap ? 'loop' : 'finite', rows, cols,
    hEdge: (r, c) => h[(wrap ? ((r % rows) + rows) % rows : r) * cols + c],
    vEdge: (r, c) => v[r * vCols + (wrap ? ((c % cols) + cols) % cols : c)],
  };
}

export function makeInfiniteEdges(seed) {
  return {
    kind: 'infinite',
    hEdge: (r, c) => hash4(seed, c, r, 0x48) & 1,
    vEdge: (r, c) => hash4(seed, c, r, 0x56) & 1,
  };
}

/** The whole algorithm in one line: look up four edges, pack into 4 bits. */
export function wangIndex(map, r, c) {
  const top = map.hEdge(r, c);
  const bottom = map.hEdge(r + 1, c);
  const left = map.vEdge(r, c);
  const right = map.vEdge(r, c + 1);
  return top + 2 * right + 4 * bottom + 8 * left;
}

/** Cell -> tile index for a mode. Returns { atlas: 'wang'|'variant'|'naive', index }. */
export function cellTile(mode, map, r, c, seed) {
  if (mode === 'wang') return { atlas: 'wang', index: wangIndex(map, r, c) };
  if (mode === 'single') return { atlas: 'wang', index: 0 };
  const h = hash4(seed, c, r, 0x77);
  if (mode === 'variants') return { atlas: 'variant', index: h & 3 };
  return { atlas: 'naive', index: h & 15 };
}
