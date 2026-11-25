// Procedural, seamless source textures ("the meadow photo" of the article).
// Each theme paints a SIZE x SIZE image that wraps on all sides: a pixel
// layer from periodic noise, then vector details (blades, petals, leaves…)
// drawn with wrap-around so nothing gets cut at the border.

import { mulberry32, fbm, worley, smoothstep, clamp01, lerp } from './noise.js';

export function makeCanvas(w, h) {
  const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h);
  c.width = w; c.height = h;
  return c;
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/** Run `fn(x, y)` at every wrapped copy of (x, y) that could touch the image. */
function wrapped(S, x, y, r, fn) {
  const xs = [x], ys = [y];
  if (x < r) xs.push(x + S); if (x > S - r) xs.push(x - S);
  if (y < r) ys.push(y + S); if (y > S - r) ys.push(y - S);
  for (const X of xs) for (const Y of ys) fn(X, Y);
}

/** Paint a per-pixel base layer from a colour function. */
function pixelLayer(ctx, S, colorAt) {
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = colorAt(x, y);
      const i = (y * S + x) * 4;
      d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- themes

function meadow(ctx, S, seed) {
  const R = mulberry32(seed);
  const dark = hex('#24461a'), mid = hex('#3f7a26'), light = hex('#79b13c'), dry = hex('#a6a23f');
  const base = (x, y) => {
    const n = fbm(x, y, S, 4, 5, seed);
    const p = fbm(x, y, S, 3, 3, seed + 99);
    let c = n < 0.5 ? mix(dark, mid, smoothstep(0.2, 0.5, n)) : mix(mid, light, smoothstep(0.5, 0.8, n));
    c = mix(c, dry, smoothstep(0.58, 0.78, p) * 0.45);
    const g = (fbm(x, y, S, 64, 2, seed + 5) - 0.5) * 30;
    return [c[0] + g, c[1] + g, c[2] + g * 0.6];
  };
  pixelLayer(ctx, S, base);

  // grass blades: dark first, light last -> fake depth
  const blades = [];
  for (let i = 0; i < S * S / 26; i++) blades.push([R() * S, R() * S, R()]);
  blades.sort((a, b) => a[2] - b[2]);
  ctx.lineCap = 'round';
  for (const [x, y, depth] of blades) {
    const len = 4 + R() * 7, ang = -Math.PI / 2 + (R() - 0.5) * 1.1, bend = (R() - 0.5) * 4;
    const c = base(x | 0, y | 0);
    const k = 0.6 + depth * 0.75;
    const col = shade(c, k);
    wrapped(S, x, y, 14, (X, Y) => {
      ctx.strokeStyle = rgb(col, 0.9);
      ctx.lineWidth = 0.8 + R() * 0.9;
      ctx.beginPath();
      ctx.moveTo(X, Y);
      ctx.quadraticCurveTo(X + bend, Y - len * 0.6, X + Math.cos(ang) * len, Y + Math.sin(ang) * len);
      ctx.stroke();
    });
  }
  // clover
  for (let i = 0; i < 55; i++) {
    const x = R() * S, y = R() * S;
    wrapped(S, x, y, 8, (X, Y) => {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + R();
        ctx.fillStyle = rgb(hex('#2f6b22'), 0.95);
        ctx.beginPath(); ctx.arc(X + Math.cos(a) * 2.2, Y + Math.sin(a) * 2.2, 2.1, 0, 7); ctx.fill();
        ctx.fillStyle = rgb(hex('#5f9e3a'), 0.6);
        ctx.beginPath(); ctx.arc(X + Math.cos(a) * 2.2 - 0.5, Y + Math.sin(a) * 2.2 - 0.6, 1, 0, 7); ctx.fill();
      }
    });
  }
  // flowers in small clusters
  const palettes = [
    [hex('#fbfbf2'), hex('#f2c230')], [hex('#ffd84a'), hex('#c46a12')],
    [hex('#c9a2ff'), hex('#fff1a8')], [hex('#ff8fb6'), hex('#ffe07a')], [hex('#8fd0ff'), hex('#ffffff')],
  ];
  for (let c = 0; c < 70; c++) {
    const cx = R() * S, cy = R() * S, pal = palettes[(R() * palettes.length) | 0];
    const n = 2 + ((R() * 6) | 0);
    for (let f = 0; f < n; f++) {
      const x = cx + (R() - 0.5) * 22, y = cy + (R() - 0.5) * 22, r = 1.2 + R() * 1.1, rot = R() * 7;
      wrapped(S, x, y, 8, (X, Y) => {
        ctx.fillStyle = 'rgba(10,30,5,0.35)';
        ctx.beginPath(); ctx.arc(X + 1, Y + 1.5, r * 2.2, 0, 7); ctx.fill();
        for (let p = 0; p < 5; p++) {
          const a = rot + (p / 5) * Math.PI * 2;
          ctx.fillStyle = rgb(pal[0]);
          ctx.beginPath(); ctx.arc(X + Math.cos(a) * r * 1.2, Y + Math.sin(a) * r * 1.2, r, 0, 7); ctx.fill();
        }
        ctx.fillStyle = rgb(pal[1]);
        ctx.beginPath(); ctx.arc(X, Y, r * 0.7, 0, 7); ctx.fill();
      });
    }
  }
}

function forest(ctx, S, seed) {
  const R = mulberry32(seed);
  const soil = hex('#3a2616'), soilL = hex('#5e3e22'), moss = hex('#4f6f22'), mossL = hex('#86a13a');
  pixelLayer(ctx, S, (x, y) => {
    const n = fbm(x, y, S, 4, 5, seed);
    const m = fbm(x, y, S, 3, 4, seed + 31);
    let c = mix(soil, soilL, n);
    const mm = smoothstep(0.52, 0.7, m);
    c = mix(c, mix(moss, mossL, fbm(x, y, S, 32, 2, seed + 3)), mm);
    const g = (fbm(x, y, S, 128, 1, seed + 9) - 0.5) * 26;
    return [c[0] + g, c[1] + g, c[2] + g];
  });
  // twigs
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = R() * S, y = R() * S, a = R() * 7, l = 10 + R() * 22;
    wrapped(S, x, y, 34, (X, Y) => {
      ctx.strokeStyle = 'rgba(20,12,6,0.5)'; ctx.lineWidth = 2.2;
      ctx.beginPath(); ctx.moveTo(X + 1, Y + 1.5); ctx.lineTo(X + 1 + Math.cos(a) * l, Y + 1.5 + Math.sin(a) * l); ctx.stroke();
      ctx.strokeStyle = rgb(hex('#7a5532')); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); ctx.stroke();
    });
  }
  // fallen leaves
  const leafCols = ['#d9531e', '#f08a24', '#f6c445', '#b8321f', '#8c5a2b', '#e0a03a', '#9e2a1c'].map(hex);
  for (let i = 0; i < 1500; i++) {
    const x = R() * S, y = R() * S, a = R() * 7, L = 5 + R() * 6, W = L * (0.38 + R() * 0.2);
    const col = shade(leafCols[(R() * leafCols.length) | 0], 0.75 + R() * 0.35);
    wrapped(S, x, y, 14, (X, Y) => {
      ctx.save(); ctx.translate(X, Y); ctx.rotate(a);
      ctx.fillStyle = 'rgba(15,8,2,0.4)';
      leafPath(ctx, L, W, 1.2, 1.6); ctx.fill();
      const g = ctx.createLinearGradient(-L, -W, L, W);
      g.addColorStop(0, rgb(shade(col, 1.15))); g.addColorStop(1, rgb(shade(col, 0.8)));
      ctx.fillStyle = g; leafPath(ctx, L, W, 0, 0); ctx.fill();
      ctx.strokeStyle = rgb(shade(col, 0.6), 0.8); ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(-L, 0); ctx.lineTo(L, 0); ctx.stroke();
      ctx.restore();
    });
  }
}
function leafPath(ctx, L, W, ox, oy) {
  ctx.beginPath();
  ctx.moveTo(-L + ox, oy);
  ctx.quadraticCurveTo(ox, -W * 1.6 + oy, L + ox, oy);
  ctx.quadraticCurveTo(ox, W * 1.6 + oy, -L + ox, oy);
}

function desert(ctx, S, seed) {
  const R = mulberry32(seed);
  const sandD = hex('#b98a4e'), sand = hex('#ddb57a'), sandL = hex('#f3d9a4');
  pixelLayer(ctx, S, (x, y) => {
    const warp = fbm(x, y, S, 3, 4, seed) * 9;
    // ripple: integer frequencies keep it periodic
    const ph = ((x * 5 + y * 3) / S) * Math.PI * 2 * 3 + warp;
    const rip = Math.sin(ph) * 0.5 + 0.5;
    const ripSharp = Math.pow(rip, 3);
    const n = fbm(x, y, S, 4, 5, seed + 17);
    let c = mix(sandD, sand, smoothstep(0.25, 0.7, n));
    c = mix(c, sandL, ripSharp * 0.55);
    c = mix(c, sandD, (1 - rip) * 0.18);
    const g = (fbm(x, y, S, 128, 1, seed + 4) - 0.5) * 22;
    return [c[0] + g, c[1] + g, c[2] + g * 0.8];
  });
  // speckles
  for (let i = 0; i < 4000; i++) {
    const x = R() * S, y = R() * S;
    ctx.fillStyle = R() < 0.5 ? 'rgba(120,80,40,0.45)' : 'rgba(255,245,220,0.5)';
    ctx.fillRect(x, y, 1, 1);
  }
  // pebbles
  for (let i = 0; i < 90; i++) {
    const x = R() * S, y = R() * S, r = 1.2 + R() * 2.6, col = mix(hex('#8a6a4a'), hex('#c9b39a'), R());
    wrapped(S, x, y, 8, (X, Y) => {
      ctx.fillStyle = 'rgba(90,55,20,0.35)';
      ctx.beginPath(); ctx.ellipse(X + 1.2, Y + 1.4, r * 1.2, r * 0.8, 0, 0, 7); ctx.fill();
      ctx.fillStyle = rgb(col);
      ctx.beginPath(); ctx.ellipse(X, Y, r * 1.2, r * 0.85, 0, 0, 7); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath(); ctx.ellipse(X - r * 0.4, Y - r * 0.35, r * 0.45, r * 0.3, 0, 0, 7); ctx.fill();
    });
  }
  // dry shrubs
  ctx.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x = R() * S, y = R() * S;
    wrapped(S, x, y, 16, (X, Y) => {
      ctx.fillStyle = 'rgba(100,60,25,0.25)';
      ctx.beginPath(); ctx.ellipse(X + 2, Y + 2, 8, 4, 0, 0, 7); ctx.fill();
      for (let b = 0; b < 9; b++) {
        const a = -Math.PI / 2 + (R() - 0.5) * 2.6, l = 4 + R() * 7;
        ctx.strokeStyle = rgb(mix(hex('#6b4a28'), hex('#9a8a4a'), R())); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); ctx.stroke();
      }
    });
  }
}

function snow(ctx, S, seed) {
  const R = mulberry32(seed);
  const shadow = hex('#a9bcd9'), mid = hex('#dce7f5'), white = hex('#f9fcff');
  pixelLayer(ctx, S, (x, y) => {
    const n = fbm(x, y, S, 4, 5, seed);
    const drift = Math.sin(((x * 2 + y * 4) / S) * Math.PI * 2 * 2 + fbm(x, y, S, 3, 3, seed + 2) * 8) * 0.5 + 0.5;
    let c = mix(shadow, mid, smoothstep(0.2, 0.55, n));
    c = mix(c, white, smoothstep(0.5, 0.85, n) * 0.9);
    c = mix(c, shadow, Math.pow(1 - drift, 4) * 0.25);
    const g = (fbm(x, y, S, 128, 1, seed + 4) - 0.5) * 10;
    return [c[0] + g, c[1] + g, c[2] + g];
  });
  // little rocks with snow caps
  for (let i = 0; i < 22; i++) {
    const x = R() * S, y = R() * S, r = 2 + R() * 3;
    wrapped(S, x, y, 10, (X, Y) => {
      ctx.fillStyle = 'rgba(70,90,130,0.25)';
      ctx.beginPath(); ctx.ellipse(X + 2, Y + 2, r * 1.5, r, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#5b6273';
      ctx.beginPath(); ctx.ellipse(X, Y, r * 1.3, r * 0.9, 0, 0, 7); ctx.fill();
      ctx.fillStyle = '#f4f8ff';
      ctx.beginPath(); ctx.ellipse(X - 0.3, Y - r * 0.35, r * 1.2, r * 0.55, 0, 0, 7); ctx.fill();
    });
  }
  // twigs poking out
  ctx.lineCap = 'round';
  for (let i = 0; i < 18; i++) {
    const x = R() * S, y = R() * S;
    wrapped(S, x, y, 12, (X, Y) => {
      ctx.strokeStyle = '#4a3a30'; ctx.lineWidth = 1;
      for (let b = 0; b < 3; b++) {
        const a = -Math.PI / 2 + (R() - 0.5) * 1.8, l = 3 + R() * 6;
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(X + Math.cos(a) * l, Y + Math.sin(a) * l); ctx.stroke();
      }
    });
  }
  // sparkles
  for (let i = 0; i < 520; i++) {
    const x = R() * S, y = R() * S, big = R() < 0.12;
    ctx.fillStyle = big ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)';
    ctx.fillRect(x, y, 1, 1);
    if (big) {
      ctx.fillStyle = 'rgba(220,240,255,0.55)';
      ctx.fillRect(x - 1.5, y, 4, 1); ctx.fillRect(x, y - 1.5, 1, 4);
    }
  }
}

function lava(ctx, S, seed) {
  const R = mulberry32(seed);
  const rockD = hex('#151216'), rock = hex('#2e2830'), rockL = hex('#4a4048');
  const g0 = hex('#5c0a00'), g1 = hex('#e0400a'), g2 = hex('#ffb13b'), g3 = hex('#fff2b0');
  pixelLayer(ctx, S, (x, y) => {
    const [f1, f2] = worley(x, y, S, 7, seed);
    const [h1, h2] = worley(x, y, S, 18, seed + 3);
    const crack = f2 - f1, crack2 = h2 - h1;
    const n = fbm(x, y, S, 4, 5, seed + 1);
    const nx = fbm(x + 1, y, S, 8, 3, seed + 2) - fbm(x - 1, y, S, 8, 3, seed + 2);
    let c = mix(rockD, rock, n);
    c = mix(c, rockL, clamp01(nx * 8 + 0.2) * 0.5);
    c = mix(c, rockD, smoothstep(0.25, 0.0, f1) * 0.4);
    const heat = fbm(x, y, S, 3, 3, seed + 8);
    const glow = Math.exp(-crack * (26 - heat * 10)) + Math.exp(-crack2 * 40) * 0.35 * heat;
    const t = clamp01(glow * (0.6 + heat * 0.8));
    let lc = t < 0.33 ? mix(g0, g1, t / 0.33) : t < 0.7 ? mix(g1, g2, (t - 0.33) / 0.37) : mix(g2, g3, (t - 0.7) / 0.3);
    c = mix(c, lc, smoothstep(0.05, 0.4, t));
    return c;
  });
  // embers
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 160; i++) {
    const x = R() * S, y = R() * S, r = 1 + R() * 3;
    wrapped(S, x, y, 10, (X, Y) => {
      const g = ctx.createRadialGradient(X, Y, 0, X, Y, r * 2.5);
      g.addColorStop(0, 'rgba(255,200,90,0.7)'); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(X, Y, r * 2.5, 0, 7); ctx.fill();
    });
  }
  ctx.globalCompositeOperation = 'source-over';
}

export const THEMES = {
  meadow: { paint: meadow, label: { ja: '草原', en: 'Meadow' }, bg: '#162c10' },
  forest: { paint: forest, label: { ja: '秋の森', en: 'Autumn forest' }, bg: '#1c120a' },
  desert: { paint: desert, label: { ja: '砂漠', en: 'Desert' }, bg: '#4a321a' },
  snow: { paint: snow, label: { ja: '雪原', en: 'Snowfield' }, bg: '#3a4a66' },
  lava: { paint: lava, label: { ja: '溶岩', en: 'Lava field' }, bg: '#0c0809' },
};

/** Returns { canvas, data (Uint8ClampedArray RGBA), size } for a theme. */
export function generateTexture(theme, seed, size = 512) {
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  THEMES[theme].paint(ctx, size, seed);
  const data = ctx.getImageData(0, 0, size, size).data;
  return { canvas, data, size };
}
