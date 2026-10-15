#!/usr/bin/env node
// WCAG 2.x contrast ratios for the design tokens in packages/ui/src/styles/tokens.css.
// Usage: node scripts/contrast-check.mjs   (exit 1 if any REQUIRED pair fails)
import fs from 'node:fs';
const css = fs.readFileSync(new URL('../packages/ui/src/styles/tokens.css', import.meta.url), 'utf8');
const hex = {};
for (const m of css.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) hex[m[1]] = m[2];
hex.white = '#ffffff';
const lum = (h) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const [x, y] = [lum(hex[a]), lum(hex[b])].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// [foreground, background, minimum, required?]  4.5 = normal text, 3 = large text / UI component
const BGS = ['ivory-50', 'ivory-100', 'ivory-200', 'ivory-300'];
const pairs = [];
for (const fg of ['ink-900', 'ink-700', 'ink-600', 'ink-500', 'gold-700', 'gold-600', 'red-700', 'red-600', 'blue-700', 'blue-600', 'green-700', 'green-600'])
  for (const bg of BGS) pairs.push([fg, bg, fg === 'gold-600' ? 3 : 4.5, true]); // gold-600 is used for icons only (3:1)
pairs.push(['ink-400', 'ivory-50', 4.5, false], ['gold-500', 'ivory-50', 4.5, false], ['red-500', 'ivory-50', 4.5, false], ['blue-500', 'ivory-50', 4.5, false]);
for (const t of ['gold', 'red', 'blue', 'green'])
  for (const fg of [`${t}-700`]) pairs.push([fg, `${t}-50`, 4.5, true]);
pairs.push(['gold-700', 'gold-100', 4.5, true], ['red-700', 'red-100', 4.5, true], ['blue-700', 'blue-100', 4.5, true]);
pairs.push(['white', 'blue-600', 4.5, true], ['white', 'red-600', 4.5, true], ['white', 'gold-600', 4.5, false], ['white', 'gold-700', 4.5, true], ['white', 'ink-900', 4.5, true], ['white', 'green-600', 4.5, true]);
pairs.push(['ink-900', 'gold-500', 4.5, true], ['ink-900', 'gold-300', 4.5, true]);
// Non-text UI (focus ring, control borders) >= 3:1
pairs.push(['blue-600', 'ivory-50', 3, true], ['blue-600', 'ivory-100', 3, true], ['control-border', 'ivory-50', 3, true], ['ink-400', 'ivory-50', 3, false], ['gold-500', 'ivory-50', 3, false]);
let fail = 0;
console.log('fg'.padEnd(12), 'bg'.padEnd(10), 'ratio', ' min  result');
for (const [fg, bg, min, req] of pairs) {
  const r = ratio(fg, bg); const ok = r >= min;
  if (!ok && req) fail++;
  console.log(fg.padEnd(12), bg.padEnd(10), r.toFixed(2).padStart(5), String(min).padStart(4), ok ? ' PASS' : req ? ' FAIL' : ' fail (informational: not used for text/required UI)');
}
console.log(fail ? `\n${fail} required pair(s) FAIL` : '\nAll required pairs pass');
process.exit(fail ? 1 : 0);
