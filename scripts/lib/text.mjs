import crypto from 'node:crypto';
export const STOP = new Set('a an and are as at be but by can for from has have how if in into is it its of on or so than that the their then there these they this to up was we what when where which who will with without you your not no only more most one each any all per via out off over under about after before'.split(' '));
export function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&mdash;|&middot;|&rarr;/g, ' ').replace(/&rsquo;|&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/g, ' ');
}
export function words(text) {
  return text.toLowerCase().replace(/['\u2019]/g, '').split(/[^a-z0-9$]+/).filter(Boolean);
}
// bigrams where at least one side is a content word (pure function-word pairs are unavoidable in any English prose)
export function contentBigrams(text) {
  const w = words(text), out = new Set();
  for (let i = 0; i < w.length - 1; i++) if (!(STOP.has(w[i]) && STOP.has(w[i + 1]))) out.add(w[i] + ' ' + w[i + 1]);
  return out;
}
export const h = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);
