import fs from 'node:fs';
import { visibleText, contentBigrams, h } from './lib/text.mjs';
const fx = new Set(JSON.parse(fs.readFileSync('scripts/fixtures/ref-bigrams.json', 'utf8')).hashes);
const shared = [...contentBigrams(visibleText(fs.readFileSync(process.argv[2] || 'src/index.html', 'utf8')))].filter(g => fx.has(h(g)));
console.log(shared.length, shared.join(' | '));
