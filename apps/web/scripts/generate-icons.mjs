// Generates brand PNG icons programmatically (no binary assets in git needed beyond the output).
// Usage: node scripts/generate-icons.mjs
import { PNG } from 'pngjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(out, { recursive: true });

const INK = [29, 26, 22];
const IVORY = [251, 248, 242];
const GOLD = [184, 146, 58];

function render(size, { maskable }) {
  const png = new PNG({ width: size, height: size });
  const SS = 3; // supersampling
  const s = size * SS;
  // Safe zone: maskable icons keep content inside the central 80%.
  const scale = maskable ? 0.64 : 0.8;
  const cx = s / 2;
  const cy = s / 2 - s * 0.02;
  const R = (s * scale) / 2.9; // radius of the C arc centreline
  const stroke = s * scale * 0.085;
  const radiusBg = maskable ? 0 : s * 0.23;
  const buf = new Float32Array(size * size * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      let col = null;
      // Background rounded square (full-bleed for maskable)
      const inRect = (() => {
        if (radiusBg === 0) return true;
        const rx = Math.min(x, s - 1 - x),
          ry = Math.min(y, s - 1 - y);
        if (rx >= radiusBg || ry >= radiusBg) return true;
        const dx = radiusBg - rx,
          dy = radiusBg - ry;
        return dx * dx + dy * dy <= radiusBg * radiusBg;
      })();
      if (inRect) col = INK;
      // The "C": arc ring minus a gap on the right
      const dx = x - cx,
        dy = y - cy;
      const d = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx); // right = 0
      if (Math.abs(d - R) <= stroke / 2 && Math.abs(ang) > 0.62) col = IVORY;
      // round caps
      for (const sgn of [-1, 1]) {
        const ex = cx + R * Math.cos(sgn * 0.62),
          ey = cy + R * Math.sin(sgn * 0.62);
        if (Math.hypot(x - ex, y - ey) <= stroke / 2) col = IVORY;
      }
      // gold rule beneath
      const ruleY = cy + R + stroke * 1.6;
      if (Math.abs(y - ruleY) <= stroke * 0.18 && Math.abs(x - cx) <= R * 0.95) col = GOLD;
      const px = Math.floor(x / SS),
        py = Math.floor(y / SS);
      const i = (py * size + px) * 4;
      if (col) {
        buf[i] += col[0];
        buf[i + 1] += col[1];
        buf[i + 2] += col[2];
        buf[i + 3] += 1;
      }
    }
  }
  for (let i = 0; i < size * size; i++) {
    const n = buf[i * 4 + 3];
    const a = n / (SS * SS);
    png.data[i * 4] = n ? Math.round(buf[i * 4] / n) : 0;
    png.data[i * 4 + 1] = n ? Math.round(buf[i * 4 + 1] / n) : 0;
    png.data[i * 4 + 2] = n ? Math.round(buf[i * 4 + 2] / n) : 0;
    png.data[i * 4 + 3] = Math.round(a * 255);
  }
  return PNG.sync.write(png);
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
  ['favicon-32.png', 32, false],
];
for (const [name, size, maskable] of targets) {
  fs.writeFileSync(path.join(out, name), render(size, { maskable }));
  console.log('wrote', name);
}
