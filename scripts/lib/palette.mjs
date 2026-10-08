import fs from 'node:fs';
export function readPalette(file = 'src/tokens.css') {
  const css = fs.readFileSync(file, 'utf8');
  const out = [];
  const re = /(--c-[\w-]+):\s*(#[0-9a-fA-F]{6});\s*\/\*\s*(\S+)\s+(.+?)@(\d+),(\d+)\s*\*\//g;
  let m;
  while ((m = re.exec(css))) out.push({ name: m[1], hex: m[2].toLowerCase(), kind: m[3], file: m[4].trim(), x: +m[5], y: +m[6] });
  return out;
}
export const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
