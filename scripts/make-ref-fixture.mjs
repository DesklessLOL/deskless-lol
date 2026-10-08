// Stores only sha1 prefixes of the reference page's content bigrams, never its text.
// usage: node scripts/make-ref-fixture.mjs <path-to-saved-reference.html>
import fs from 'node:fs';
import { visibleText, contentBigrams, h } from './lib/text.mjs';
const html = fs.readFileSync(process.argv[2], 'utf8');
const hashes = [...contentBigrams(visibleText(html))].map(h).sort();
fs.mkdirSync('scripts/fixtures', { recursive: true });
fs.writeFileSync('scripts/fixtures/ref-bigrams.json', JSON.stringify({ n: hashes.length, hashes }));
console.log('bigram hashes', hashes.length);
