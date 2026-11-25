// Render every README figure with headless Chrome: node scripts/capture.mjs [figName...]
// Needs the dev server running (node scripts/serve.mjs 8791).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FIGURES } from '../src/figure-list.js';

const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = process.env.BASE || 'http://localhost:8791';
const out = fileURLToPath(new URL('../assets/readme/', import.meta.url));
mkdirSync(out, { recursive: true });

export function shot(url, file, w, h) {
  execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--window-size=${w},${h}`, '--virtual-time-budget=20000', `--screenshot=${file}`, url], { stdio: 'ignore' });
}

const only = process.argv.slice(2);
for (const [name, [w, h]] of Object.entries(FIGURES)) {
  if (only.length && !only.includes(name)) continue;
  const t = Date.now();
  shot(`${BASE}/figures.html?fig=${name}`, `${out}${name}.png`, w, h);
  console.log(`${name}.png  ${w}x${h}  ${Date.now() - t}ms`);
}
