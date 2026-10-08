// One-off: downloads latin subsets of the two families into src/fonts/.
import fs from 'node:fs';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36';
const css = await (await fetch('https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500;600&display=swap', { headers: { 'user-agent': UA } })).text();
const blocks = css.split('/* ').slice(1).filter(b => b.startsWith('latin */'));
for (const b of blocks) {
  const fam = /font-family: '([^']+)'/.exec(b)[1], w = /font-weight: (\d+)/.exec(b)[1], u = /url\(([^)]+)\)/.exec(b)[1];
  const name = `${fam.toLowerCase().replace(/\s+/g, '-')}-${w}.woff2`;
  fs.writeFileSync('src/fonts/' + name, Buffer.from(await (await fetch(u)).arrayBuffer()));
  console.log(name);
}
