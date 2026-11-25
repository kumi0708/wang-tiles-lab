// Deterministic randomness + periodic (seamless) noise helpers.
// Every texture in this project must tile seamlessly, so all noise
// functions take an integer `period` and wrap their lattice.

/** mulberry32: tiny, fast, seedable PRNG returning floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash of up to 4 ints -> uint32. Used for lattice noise and for infinite-world edges. */
export function hash4(a, b, c = 0, d = 0) {
  let h = 0x9e3779b9 ^ Math.imul(a | 0, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= Math.imul(b | 0, 0x27d4eb2f);
  h = Math.imul(h ^ (h >>> 15), 0x165667b1);
  h ^= Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca77);
  h ^= Math.imul(d | 0, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 13), 0x27d4eb2f);
  h ^= h >>> 16;
  return h >>> 0;
}

export const hashFloat = (a, b, c, d) => hash4(a, b, c, d) / 4294967296;

/** Turn any string or number into a 32-bit seed. */
export function seedFrom(value) {
  const s = String(value);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const mod = (a, n) => ((a % n) + n) % n;

/** Periodic value noise in [0,1]. x,y in lattice units, wraps every `period` cells. */
export function valueNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const x0 = mod(xi, period), y0 = mod(yi, period);
  const x1 = mod(xi + 1, period), y1 = mod(yi + 1, period);
  const v00 = hashFloat(x0, y0, seed, 1);
  const v10 = hashFloat(x1, y0, seed, 1);
  const v01 = hashFloat(x0, y1, seed, 1);
  const v11 = hashFloat(x1, y1, seed, 1);
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

/**
 * Seamless fractal noise over a square image of `size` pixels.
 * `freq` = number of lattice cells across the image at the first octave.
 */
export function fbm(px, py, size, freq, octaves, seed, gain = 0.5) {
  let amp = 1, sum = 0, norm = 0, f = freq;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise((px / size) * f, (py / size) * f, f, seed + o * 1013);
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Periodic Worley (cellular) noise. Returns [F1, F2] distances in cell units.
 * `cells` feature points per side, wraps around the image.
 */
export function worley(px, py, size, cells, seed) {
  const x = (px / size) * cells, y = (py / size) * cells;
  const xi = Math.floor(x), yi = Math.floor(y);
  let f1 = 9, f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const wx = mod(cx, cells), wy = mod(cy, cells);
      const fx = cx + hashFloat(wx, wy, seed, 7);
      const fy = cy + hashFloat(wx, wy, seed, 8);
      const d = Math.hypot(fx - x, fy - y);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return [f1, f2];
}

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smoothstep = (a, b, v) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export { lerp, mod };
