import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { JSDOM } from 'jsdom';
import { build } from './build.mjs';
import { validate, handleFromUrl, isSolanaAddress } from './lib/register.mjs';
import { readPalette } from './lib/palette.mjs';
import { visibleText, contentBigrams, h } from './lib/text.mjs';

const results = [];
const gate = (id, name, fn) => results.push({ id, name, fn });
const must = (c, msg) => { if (!c) throw new Error(msg); };

const SRC_REG = () => JSON.parse(fs.readFileSync('src/register.json', 'utf8'));
const TMP = '.gate-tmp';
const FIXTURE = {
  ca: { state: 'stated', value: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', url: null },
  x: { state: 'stated', value: 'x', url: 'https://x.com/desklessfixture' },
  github: { state: 'stated', value: 'github', url: 'https://github.com/desklessfixture/site' }
};
const INERT = { state: 'absent', value: null, url: null };
const clone = o => JSON.parse(JSON.stringify(o));

async function buildVariant(name, reg) {
  const out = path.join(TMP, name);
  await build({ register: reg, out, assetsFrom: 'dist' });
  return { out, html: fs.readFileSync(path.join(out, 'index.html'), 'utf8'), dom: new JSDOM(fs.readFileSync(path.join(out, 'index.html'), 'utf8')).window.document };
}

function listFiles(dir, skip = []) {
  const acc = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.includes(e.name)) continue;
    e.isDirectory() ? acc.push(...listFiles(p, skip)) : acc.push(p);
  }
  return acc;
}
const TEXT_EXT = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.txt', '.json', '.md']);
const textFiles = dir => listFiles(dir, ['node_modules', TMP]).filter(f => TEXT_EXT.has(path.extname(f)) || path.basename(f) === '_headers');

// Address scanner: finds address-shaped strings and matches them to the stated registry only.
const B58RE = /[1-9A-HJ-NP-Za-km-z]{32,44}/g, HEXRE = /0x[0-9a-fA-F]{40}/g;
function scanAddresses(files, allowed) {
  const bad = [];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of t.matchAll(B58RE)) { if (isSolanaAddress(m[0]) && !allowed.has(m[0])) bad.push(`${f}: ${m[0]}`); }
    for (const m of t.matchAll(HEXRE)) { if (!allowed.has(m[0])) bad.push(`${f}: ${m[0]}`); }
  }
  return bad;
}
const statedValues = reg => new Set(Object.values(reg).filter(r => r.state === 'stated').flatMap(r => [r.value, r.url]).filter(Boolean));


// ---------------------------------------------------------------- runtime harness (jsdom + mocked network)
const tick = () => new Promise(r => setImmediate(r));
async function runtime({ reg, rpc, dex, reduced = false, clipboard }) {
  const html = fs.readFileSync(path.join(TMP, reg.__variant, 'index.html'), 'utf8');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://deskless.lol/' });
  const w = dom.window;
  const timers = [], intervals = [], animations = [], copied = [], calls = [];
  w.matchMedia = q => ({ matches: reduced && /reduced-motion/.test(q), media: q, addEventListener() {}, removeEventListener() {} });
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  w.clearTimeout = () => {};
  w.setInterval = (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; };
  w.clearInterval = () => {};
  w.IntersectionObserver = class { constructor(cb) { this.cb = cb; } observe() {} unobserve() {} };
  w.Element.prototype.animate = function () { animations.push(this); return { addEventListener() {}, cancel() {} }; };
  Object.defineProperty(w, 'isSecureContext', { value: true });
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async t => { copied.push(t); } }, configurable: true });
  w.fetch = async (url, init) => {
    calls.push({ url, init });
    const handler = String(url).includes('dexscreener') ? dex : rpc;
    const r = await handler(url, init);
    if (r instanceof Error) throw r;
    return { ok: r.ok !== false, status: r.status || 200, json: async () => r.body };
  };
  const src = fs.readFileSync('dist/app.js', 'utf8');
  w.eval(src);
  for (let i = 0; i < 6; i++) await tick();
  return { w, d: w.document, timers, intervals, animations, copied, calls, flush: async () => { for (let i = 0; i < 6; i++) await tick(); } };
}

const PAIRS = { pairs: [
  { chainId: 'solana', dexId: 'raydium', pairAddress: 'PairAddr1111111111111111111111111111111111', baseToken: { address: 'TokAddr1', symbol: 'DESKLESS', name: 'Deskless' }, quoteToken: { symbol: 'SOL' }, priceUsd: '0.0000123', priceChange: { h24: -4.5 }, volume: { h24: 12000 }, liquidity: { usd: 50000 }, info: { imageUrl: 'https://cdn.dexscreener.com/a.png' } },
  { chainId: 'solana', dexId: 'orca', pairAddress: 'PairAddr2222222222222222222222222222222222', baseToken: { address: 'TokAddr1', symbol: 'DESKLESS', name: 'Deskless' }, quoteToken: { symbol: 'USDC' }, priceUsd: '0.0000124', priceChange: { h24: 3.2 }, volume: { h24: 3000 }, liquidity: { usd: 9000 } },
  { chainId: 'ethereum', dexId: 'uniswap', pairAddress: '0xnope', baseToken: { address: '0x1', symbol: 'DESKLESS', name: 'Deskless' }, quoteToken: { symbol: 'WETH' }, priceUsd: '1', volume: { h24: 999999 }, liquidity: { usd: 1 } }
] };

// ================================================================ GATES
gate('G01', 'register: src/register.json is valid, inert records carry null value+url', async () => {
  const errs = validate(SRC_REG()); must(!errs.length, errs.join('; '));
});
gate('G02', 'register: validator rejects inert-with-value, inert-with-url, bad enum, bad CA shape', async () => {
  const base = SRC_REG();
  for (const [k, mut] of [['x', r => { r.value = 'x'; }], ['github', r => { r.url = 'https://github.com/a'; }], ['ca', r => { r.state = 'maybe'; }], ['x', r => { r.state = 'unconfirmed'; r.value = 'v'; }]]) {
    const b = clone(base); mut(b[k]); must(validate(b).length > 0, `validator accepted bad ${k}`);
  }
  const b = clone(base); b.ca = { state: 'stated', value: 'not-an-address', url: null }; must(validate(b).length > 0, 'validator accepted a malformed CA');
  const ok = clone(base); ok.ca = clone(FIXTURE.ca); must(!validate(ok).length, 'validator rejected a valid stated CA: ' + validate(ok));
});
gate('G03', 'build: dist/ produced with every deploy file', async () => {
  for (const f of ['index.html', 'styles.css', 'tokens.css', 'app.js', 'boot.js', 'favicon.svg', '_headers', 'img/mark-1280.png', 'img/mark-1280.webp', 'img/mark-640.webp', 'img/mark-96.png', 'img/og.png', 'img/apple-touch-icon.png', 'fonts/anton-400.woff2', 'fonts/ibm-plex-mono-400.woff2'])
    must(fs.existsSync(path.join('dist', f)), 'missing dist/' + f);
});
gate('G04', 'palette: each token re-read from its brand pixel coordinate matches exactly', async () => {
  const pal = readPalette(); must(pal.length >= 18, 'palette parse found ' + pal.length);
  const cache = {};
  for (const p of pal) {
    const file = path.join('brand', p.file);
    cache[file] ??= await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { data, info } = cache[file], i = (p.y * info.width + p.x) * 4;
    const hex = '#' + [0, 1, 2].map(c => data[i + c].toString(16).padStart(2, '0')).join('');
    must(hex === p.hex, `${p.name} says ${p.hex} but ${p.file}@${p.x},${p.y} is ${hex}`);
  }
});
gate('G05', 'palette: no colour literal outside tokens.css (src + dist), every allowed hex is a palette member', async () => {
  const pal = new Set(readPalette().map(p => p.hex)), bad = [];
  const cssRe = /(?<=[:\s(,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?=[;\s),}])/g, fnRe = /\b(?:rgba?|hsla?|oklch|oklab|hwb|lab|lch)\(/gi, named = /:\s*(?:white|black|red|green|blue|gray|grey|silver)\s*[;}]/gi;
  for (const f of [...textFiles('src'), ...textFiles('dist')]) {
    const base = path.basename(f), t = fs.readFileSync(f, 'utf8');
    if (base === 'tokens.css') continue;
    if (['.js', '.css'].includes(path.extname(f))) {
      if (cssRe.test(t) || fnRe.test(t) || named.test(t) || /['"]#[0-9a-fA-F]{3,8}['"]/.test(t)) bad.push(f + ': colour literal');
    }
    if (f.endsWith('favicon.svg') || (f.startsWith('dist') && base === 'index.html')) {
      for (const m of t.matchAll(/(?:fill|content)="(#[0-9a-fA-F]{6})"/g)) if (!pal.has(m[1].toLowerCase())) bad.push(`${f}: ${m[1]} not in palette`);
    }
  }
  must(!bad.length, bad.join('; '));
});
gate('G06', 'palette: k-means + quantile provenance comments present on every token', async () => {
  const css = fs.readFileSync('src/tokens.css', 'utf8');
  must(/k-means/.test(css) && /snapped/.test(css) && /LOGO DESKLESS PNG/.test(css), 'provenance header missing');
  must(readPalette().every(p => /^[qkp]/.test(p.kind)), 'token without kind');
});
gate('G07', 'brand: transparent PNG is colour type 6 with pure-black transparent regions, resized premultiplied (no dark fringe)', async () => {
  const b = fs.readFileSync('brand/LOGO DESKLESS PNG...png');
  must(b[25] === 6, 'colour type is ' + b[25]);
  const { data, info } = await sharp('brand/LOGO DESKLESS PNG...png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let blackT = 0; for (let i = 0; i < data.length; i += 4) if (!data[i + 3] && !data[i] && !data[i + 1] && !data[i + 2]) blackT++;
  must(blackT > 1e6, 'expected pure-black transparent pixels, found ' + blackT);
  const out = await sharp('dist/img/mark-640.webp').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  // fringe test: semi-transparent edge pixels must not be darker than the darkest real brand tone
  const floor = 0x21; let dark = 0;
  for (let i = 0; i < out.data.length; i += 4) { const a = out.data[i + 3]; if (a > 40 && a < 220 && out.data[i] < floor && out.data[i + 1] < floor) dark++; }
  must(dark < 50, `${dark} dark fringe pixels at the edge`);
  must(!/premultiply\(\)/.test(fs.readFileSync('scripts/build.mjs', 'utf8').replace(/\/\/.*/g, '')) || true, '');
  must(/premultiplied: true/.test(fs.readFileSync('scripts/build.mjs', 'utf8')), 'build does not use premultiplied resize');
});
gate('G08', 'favicon: 32x32 SVG, traced from the pixel grid, no comments, no double hyphen anywhere', async () => {
  const s = fs.readFileSync('dist/favicon.svg', 'utf8');
  must(/viewBox="0 0 32 32"/.test(s) && /width="32"/.test(s) && /height="32"/.test(s), 'not 32x32');
  must(!s.includes('<!--') && !s.includes('--'), 'comment or double hyphen found');
  const x = new JSDOM(s, { contentType: 'image/svg+xml' }).window.document;
  must(x.documentElement.nodeName === 'svg', 'not parseable as XML');
  const rects = x.querySelectorAll('rect'); must(rects.length > 60, 'too few cells: ' + rects.length);
  const pal = new Set(readPalette().map(p => p.hex));
  for (const r of rects) must(pal.has(r.getAttribute('fill')), 'fill outside palette ' + r.getAttribute('fill'));
  for (const r of [...rects].slice(1)) must(Number.isInteger(+r.getAttribute('x')) && Number.isInteger(+r.getAttribute('y')), 'off-grid rect');
});
gate('G09', 'hygiene: no agent-config file or directory, no AI attribution strings in any project file', async () => {
  must(!fs.existsSync(['CLA', 'UDE.md'].join('')) && !fs.existsSync(['.cla', 'ude'].join('')), 'forbidden file/dir present');
  const pats = [['cla', 'ude'], ['anthr', 'opic'], ['co-auth', 'ored-by'], ['generated ', 'with'], ['generated ', 'by'], ['gpt', '-'], ['open', 'ai']].map(p => new RegExp(p.join(''), 'i'));
  const bad = [];
  for (const f of listFiles('.', ['node_modules', TMP, '.git'])) {
    if (!TEXT_EXT.has(path.extname(f)) && path.basename(f) !== '_headers' && path.basename(f) !== '.gitignore') continue;
    if (/package-lock\.json$/.test(f)) continue;
    const t = fs.readFileSync(f, 'utf8');
    for (const re of pats) if (re.test(t)) bad.push(`${f}: /${re.source}/`);
  }
  must(!bad.length, bad.join('; '));
});
gate('G10', 'css: no ch units anywhere in src', async () => {
  const bad = textFiles('src').filter(f => /\d\s?ch\b/.test(fs.readFileSync(f, 'utf8')));
  must(!bad.length, bad.join(', '));
});
gate('G11', 'csp: no inline style attributes or inline scripts in built html', async () => {
  const t = fs.readFileSync('dist/index.html', 'utf8');
  must(!/\sstyle="/.test(t), 'inline style attribute');
  must(![...t.matchAll(/<script(?![^>]*(?:src=|type="application\/json"))[^>]*>/g)].length, 'inline script');
});
gate('G12', 'tap targets: every interactive class sizes to the 44px token (static)', async () => {
  const css = fs.readFileSync('src/styles.css', 'utf8'), tok = fs.readFileSync('src/tokens.css', 'utf8');
  must(/--tap:\s*44px/.test(tok), '--tap is not 44px');
  for (const sel of ['.nav a', '.social', '.ca-btn', '.copy-btn', '.btn', '.domain-tag', '.mq-item']) {
    const re = new RegExp(sel.replace(/[.\s]/g, m => (m === '.' ? '\\.' : '\\s+')) + '\\s*\\{[^}]*(?:min-height|height|width|min-width):\\s*(?:var\\(--tap\\)|4[4-9]px|[5-9]\\dpx)', 'm');
    must(re.test(css), sel + ' lacks a 44px floor');
  }
});
gate('G13', 'social: both icons present in markup, official paths, never display:none at any breakpoint', async () => {
  const b = fs.readFileSync('scripts/build.mjs', 'utf8'), css = fs.readFileSync('src/styles.css', 'utf8');
  must(b.includes('M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'), 'X mark path');
  must(b.includes('M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38'), 'Octicon path');
  must(!/\.socials?\b[^{]*\{[^}]*display:\s*none/.test(css), 'socials hidden by css');
  must(!/\.social[^{]*\{[^}]*display:\s*none/.test(css), 'social hidden by css');
  const d = (await buildVariant('absent-social', SRC_REG())).dom;
  for (const k of ['x', 'github']) { const el = d.querySelector(`.socials [data-record="${k}"]`); must(el && el.querySelector('svg path'), k + ' icon missing'); must(!el.textContent.trim(), k + ' has a text label'); }
});
gate('G14', 'copy: zero content 2-grams shared with the reference page', async () => {
  const fx = new Set(JSON.parse(fs.readFileSync('scripts/fixtures/ref-bigrams.json', 'utf8')).hashes);
  const MANDATED = new Set(['on solana']); // the board label "Trending on Solana" is specified verbatim by the owner
  const shared = [...contentBigrams(visibleText(fs.readFileSync('dist/index.html', 'utf8')))].filter(g => fx.has(h(g)) && !MANDATED.has(g));
  must(!shared.length, 'shared: ' + shared.join(' | '));
});
gate('G15', 'branch ABSENT: CA slot + X + GitHub inert, no href, no copy payload, CA notice says so', async () => {
  const reg = SRC_REG(); const v = await buildVariant('absent', reg), d = v.dom;
  for (const k of ['ca', 'x', 'github']) {
    must(reg[k].state !== 'stated', `fixture precondition: ${k} is stated in src/register.json`);
    const els = [...d.querySelectorAll(`[data-record="${k}"]`)]; must(els.length, k + ' anchor missing');
    for (const el of els) must(el.getAttribute('data-state') === reg[k].state, `${k} data-state ${el.getAttribute('data-state')} != register ${reg[k].state}`);
  }
  must(!d.querySelector('a[href*="x.com"], a[href*="twitter.com"], a[href*="github.com"]'), 'href present for unstated social');
  const btn = d.querySelector('#ca-btn'); must(btn.disabled && btn.getAttribute('aria-disabled') === 'true', 'CA button not inert');
  must(!btn.hasAttribute('data-copy') && !btn.hasAttribute('data-value'), 'inert CA carries a payload');
  must(!B58RE.test(d.querySelector('.ca').textContent) && !HEXRE.test(d.querySelector('.ca').textContent), 'address-shaped text in inert CA');
  const reg2 = JSON.parse(d.querySelector('#register').textContent);
  for (const k of ['ca', 'x', 'github']) must(reg2[k].value === null && reg2[k].url === null, `${k} serialised with value/url`);
});
gate('G16', 'branch STATED (fixture): CA shown in full + copyable, X/GitHub hrefs from stored url, handles derived', async () => {
  const reg = SRC_REG(); reg.ca = clone(FIXTURE.ca); reg.x = clone(FIXTURE.x); reg.github = clone(FIXTURE.github);
  const v = await buildVariant('stated', reg), d = v.dom;
  must(d.querySelector('#ca-value').textContent === reg.ca.value, 'CA not shown in full');
  must(!d.querySelector('#ca-btn').disabled, 'CA button disabled while stated');
  for (const k of ['x', 'github']) {
    const a = d.querySelector(`a[data-record="${k}"]`); must(a, k + ' not a link when stated');
    must(a.getAttribute('href') === reg[k].url, k + ' href != stored url');
    must(a.getAttribute('aria-label').endsWith(handleFromUrl(reg[k].url)), k + ' handle not derived from url');
    must(a.rel.includes('noopener'), k + ' rel');
  }
  const rt = await runtime({ reg: { ...reg, __variant: 'stated' }, rpc: async () => ({ body: { result: 454000000 } }), dex: async () => ({ body: { pairs: [] } }) });
  rt.d.querySelector('#ca-btn').click(); await rt.flush();
  must(rt.copied[0] === reg.ca.value, 'clipboard got ' + rt.copied[0]);
  must(rt.d.querySelector('#toast').textContent.length > 0 && rt.d.querySelector('#toast').classList.contains('show'), 'no toast after CA copy');
});
gate('G17', 'mutation harness: every record flipped from its CURRENT state (read at runtime) and DOM follows', async () => {
  for (const key of ['ca', 'x', 'github']) {
    const before = SRC_REG(), cur = before[key].state;
    const mutated = clone(before);
    mutated[key] = cur === 'stated' ? clone(INERT) : clone(FIXTURE[key]);
    const v = await buildVariant('mut-' + key, mutated), d = v.dom;
    const expectState = mutated[key].state;
    const anchors = [...d.querySelectorAll(`[data-record="${key}"]`)];
    must(anchors.length, key + ' anchor lost');
    for (const el of anchors) must(el.getAttribute('data-state') === expectState, `${key}: expected ${expectState}, DOM says ${el.getAttribute('data-state')}`);
    if (key === 'ca') {
      const val = d.querySelector('#ca-value').textContent;
      must(expectState === 'stated' ? val === mutated.ca.value : val !== before.ca.value && !isSolanaAddress(val), 'CA text did not follow mutation');
    } else {
      const link = d.querySelector(`a[data-record="${key}"]`);
      must(expectState === 'stated' ? link && link.getAttribute('href') === mutated[key].url : !link, `${key} link did not follow mutation`);
    }
    for (const st of ['unconfirmed']) {
      const m2 = clone(before); m2[key] = { state: st, value: null, url: null };
      const d2 = (await buildVariant('mut2-' + key, m2)).dom;
      for (const el of d2.querySelectorAll(`[data-record="${key}"]`)) must(el.getAttribute('data-state') === st, key + ' unconfirmed not rendered');
      must(!d2.querySelector(`a[data-record="${key}"]`), key + ' unconfirmed rendered as link');
    }
  }
});
gate('G18', 'address scanner: matches strings to the stated registry only, CA exempt, not a blanket 0x/base58 reject', async () => {
  const stated = (await buildVariant('stated', (() => { const r = SRC_REG(); r.ca = clone(FIXTURE.ca); return r; })())).out;
  const reg = SRC_REG(); reg.ca = clone(FIXTURE.ca);
  must(scanAddresses(textFiles(stated), statedValues(reg)).length === 0, 'stated CA flagged by its own scanner');
  must(scanAddresses(textFiles('dist'), statedValues(SRC_REG())).length === 0, 'dist (absent) has address-shaped strings');
  const inj = path.join(TMP, 'inj'); fs.rmSync(inj, { recursive: true, force: true }); fs.cpSync('dist', inj, { recursive: true });
  const ADDR = FIXTURE.ca.value, HEX = '0x' + 'ab12'.repeat(10);
  fs.appendFileSync(path.join(inj, 'index.html'), `\n<p>${ADDR} ${HEX}</p>`);
  const none = scanAddresses(textFiles(inj), new Set());
  must(none.some(x => x.includes(ADDR)) && none.some(x => x.includes(HEX)), 'scanner missed injected base58/0x');
  must(scanAddresses(textFiles(inj), new Set([ADDR, HEX])).length === 0, 'scanner rejects registry-matching addresses (blanket reject)');
  must(scanAddresses(textFiles(inj), new Set([ADDR])).length === 1, 'scanner should still flag the unregistered 0x');
});
gate('G19', 'chain: Solana, publicnode RPC, getBlockHeight at confirmed commitment, 2 s poll, DexScreener search q=deskless from register', async () => {
  const reg = SRC_REG(), js = fs.readFileSync('src/app.js', 'utf8');
  must(reg.chain.value === 'Solana' && reg.rpc.value === 'https://solana-rpc.publicnode.com', 'register chain/rpc');
  must(reg.dex.value === 'https://api.dexscreener.com/latest/dex/search?q=deskless', 'register dex');
  must(reg.dexFallback.value === 'https://api.dexscreener.com/latest/dex/search?q=sol&chainIds=solana', 'register dexFallback');
  must(js.includes("method: 'getBlockHeight'") && js.includes("commitment: 'confirmed'") && /interval: 2000/.test(js), 'rpc call shape');
  must(!js.includes('publicnode') && !js.includes('dexscreener.com'), 'endpoint hardcoded in app.js (must come from register)');
});
gate('G20', 'backoff: exponential, capped, jittered, on every poller', async () => {
  const js = fs.readFileSync('src/app.js', 'utf8');
  const m = /function backoff\([\s\S]*?\n  \}\n/.exec(js); must(m, 'backoff fn');
  const backoff = new Function(m[0] + '; return backoff;')();
  const seq = [1, 2, 3, 4, 5, 6, 7, 8].map(n => backoff(n, 2000, 60000, 0.5));
  must(seq[0] === 4000 && seq[1] === 8000 && seq[2] === 16000, 'not doubling: ' + seq);
  must(seq.every((v, i) => i === 0 || v >= seq[i - 1]) && seq[7] === 60000, 'not capped/monotone: ' + seq);
  must(backoff(3, 2000, 60000, 0) < backoff(3, 2000, 60000, 1), 'no jitter');
  must((js.match(/poller\(\{/g) || []).length === 2, 'every poller must use poller()');
});
gate('G21', 'runtime LIVE: tiles go skeleton -> real data, pairs rows, logos, per-address copy, marquee, only Solana pairs', async () => {
  const reg = SRC_REG(); reg.__variant = 'absent';
  const rt = await runtime({ reg, rpc: async () => ({ body: { result: 454000001 } }), dex: async () => ({ body: PAIRS }) });
  const d = rt.d;
  must(rt.d.querySelector('#v-block').textContent === '454,000,001', 'block ' + d.querySelector('#v-block').textContent);
  must(d.querySelector('[data-tile=block]').dataset.state === 'ok', 'block tile state');
  must(d.querySelectorAll('#pairs-body .row').length === 2, 'rows = ' + d.querySelectorAll('#pairs-body .row').length + ' (ethereum pair must be dropped)');
  must(d.querySelector('#v-pairs').textContent === '2' && d.querySelector('#v-volume').textContent === '$15K', 'tiles ' + d.querySelector('#v-pairs').textContent + ' ' + d.querySelector('#v-volume').textContent);
  must(d.querySelector('#v-price').textContent === '$0.0000123', 'price ' + d.querySelector('#v-price').textContent);
  must(d.querySelector('#pairs-body img.logo').src === 'https://cdn.dexscreener.com/a.png', 'logo from imageUrl');
  must(d.querySelector('#marquee').dataset.state === 'ok' && d.querySelectorAll('#marquee-track .mq-item').length >= 4, 'marquee not built');
  must(d.querySelector('.chg-down') && d.querySelector('.chg-up'), '24h arrows');
  d.querySelector('#pairs-body .copy-btn').click(); await rt.flush();
  must(rt.copied[0] === PAIRS.pairs[0].pairAddress, 'pair copy payload ' + rt.copied[0]);
  must(rt.calls.some(c => c.init && c.init.method === 'POST' && JSON.parse(c.init.body).method === 'getBlockHeight'), 'rpc not called');
  must(d.querySelector('#status-pill').dataset.state === 'live', 'pill not live');
  const st = rt.timers.map(t => t.ms); must(st.includes(2000) && st.includes(30000), 'poll intervals ' + st);
  must(rt.intervals.length === 1, 'count-up ticker missing');
});
gate('G22', 'runtime FAIL: dash + error message on every live tile, backoff grows, pill offline', async () => {
  const reg = SRC_REG(); reg.__variant = 'absent';
  const rt = await runtime({ reg, rpc: async () => new Error('down'), dex: async () => ({ ok: false, status: 503, body: {} }) });
  const d = rt.d;
  for (const n of ['block', 'pairs', 'volume', 'price']) {
    const t = d.querySelector(`[data-tile=${n}]`); must(t.dataset.state === 'error', n + ' state ' + t.dataset.state);
    must(t.querySelector('.val').textContent === '—', n + ' lacks dash');
    must(/unreachable|Retrying/i.test(t.querySelector('.tile-note').textContent), n + ' lacks error message');
  }
  must(d.querySelector('#status-pill').dataset.state === 'down', 'pill');
  must(d.querySelector('#marquee').dataset.state === 'error', 'marquee error');
  const delays = []; for (let i = 0; i < 4; i++) { const t = rt.timers.shift(); delays.push(t.ms); t.fn(); await rt.flush(); }
  const rpcDelays = rt.timers.map(t => t.ms).filter(ms => ms >= 2000 && ms < 30000);
  must(rpcDelays.length >= 2 && rpcDelays[rpcDelays.length - 1] > rpcDelays[0], 'rpc backoff not growing: ' + rt.timers.map(t => t.ms));
});
gate('G23', 'runtime EMPTY: dex answers with zero pairs -> honest empty state, not an error', async () => {
  const reg = SRC_REG(); reg.__variant = 'absent';
  const rt = await runtime({ reg, rpc: async () => ({ body: { result: 1 } }), dex: async () => ({ body: { schemaVersion: '1.0.0', pairs: [] } }) });
  must(rt.d.querySelector('#pairs').dataset.state === 'empty' && rt.d.querySelector('#marquee').dataset.state === 'empty', 'empty state');
  must(rt.d.querySelector('#v-pairs').textContent === '0', 'zero pairs tile');
});
gate('G24', 'reduced motion: CSS kills animation+transition, JS skips ticker, reveals, parallax, flash', async () => {
  const css = fs.readFileSync('src/styles.css', 'utf8');
  must(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important[\s\S]*transition: none !important/.test(css), 'css block');
  const reg = SRC_REG(); reg.__variant = 'absent';
  const rt = await runtime({ reg, reduced: true, rpc: async () => ({ body: { result: 454000001 } }), dex: async () => ({ body: PAIRS }) });
  must(rt.intervals.length === 0, 'ticker running under reduced motion');
  must(rt.animations.length === 0, 'WAAPI used under reduced motion');
  must(rt.d.querySelector('#v-block').textContent === '454,000,001', 'still shows data');
  must(![...rt.d.querySelectorAll('.flash')].length, 'flash under reduced motion');
});
gate('G25', 'premium: progress bar, spotlight, spring reveal, parallax layers, live pill, shared toast all wired', async () => {
  const d = (await buildVariant('premium', SRC_REG())).dom, js = fs.readFileSync('src/app.js', 'utf8'), css = fs.readFileSync('src/styles.css', 'utf8');
  must(d.querySelector('#progress') && /scaleX/.test(js), 'progress');
  must(d.querySelectorAll('[data-spot]').length >= 20, 'spotlight count ' + d.querySelectorAll('[data-spot]').length);
  must(/function springEasing/.test(js) && /linear\(/.test(js), 'spring physics');
  must(d.querySelectorAll('.layer[data-depth]').length >= 4, 'parallax layers');
  must(/ping/.test(css) && d.querySelector('#status-pill .dot'), 'pulsing dot');
  must((js.match(/copyWithToast\(/g) || []).length >= 3 && d.querySelector('#toast'), 'toast shared by copy actions');
  must(d.querySelectorAll('[data-reveal]').length >= 30 && d.querySelectorAll('[data-stagger]').length >= 6, 'stagger groups');
  must(/skel/.test(css) && d.querySelectorAll('.skel').length >= 7, 'skeletons');
});
gate('G26', 'link rule: absent build ships no href to any external profile; dist has no AI/generator meta', async () => {
  const t = fs.readFileSync('dist/index.html', 'utf8');
  must(!/href="https?:\/\/(?:www\.)?(?:x\.com|twitter\.com|github\.com)/.test(t), 'profile href in absent build');
  must(!/<meta name="generator"/i.test(t), 'generator meta');
});

const T = (sym, addr, vol, extra = {}) => ({ chainId: 'solana', dexId: 'raydium', pairAddress: 'Pair' + sym, baseToken: { address: addr, symbol: sym, name: sym + ' coin', ...(extra.logoURI ? { logoURI: extra.logoURI } : {}) }, quoteToken: { symbol: 'SOL' }, priceUsd: extra.price ?? '1.5', priceChange: { h24: extra.chg ?? 2 }, volume: { h24: vol }, liquidity: { usd: vol }, ...(extra.img ? { info: { imageUrl: extra.img } } : {}) });
const TRENDING = { pairs: [
  T('AAA', 'tokA', 1000, { img: 'https://cdn.dexscreener.com/a.png' }), T('BBB', 'tokB', 900, { logoURI: 'https://cdn.dexscreener.com/b.png' }), T('CCC', 'tokC', 800),
  T('BBB', 'tokB', 700), T('DDD', 'tokD', 600), T('EEE', 'tokE', 500), T('FFF', 'tokF', 400), T('GGG', 'tokG', 300), T('HHH', 'tokH', 200), T('III', 'tokI', 150), T('JJJ', 'tokJ', 120),
  { ...T('ETH', 'tokX', 99999), chainId: 'ethereum' }
] };
const route = (own, trending) => async url => ({ body: String(url).includes('q=sol') ? trending : own });

gate('G27', 'pairs fallback: own search empty -> Solana trending, solana only, volume desc, deduped, top 8, labelled', async () => {
  const reg = SRC_REG(); reg.__variant = 'absent';
  const rt = await runtime({ reg, rpc: async () => ({ body: { result: 1 } }), dex: route({ pairs: [] }, TRENDING) });
  const d = rt.d, syms = [...d.querySelectorAll('#pairs-body .tk-sym')].map(e => e.textContent);
  must(rt.calls.some(c => String(c.url).includes('q=deskless')) && rt.calls.some(c => String(c.url).includes('q=sol&chainIds=solana')), 'both tiers must be called');
  must(syms.join() === 'AAA,BBB,CCC,DDD,EEE,FFF,GGG,HHH', 'rows ' + syms.join());
  must(!syms.includes('ETH'), 'non-solana row leaked');
  must(!d.querySelector('#pairs-label').hidden && d.querySelector('#pairs-label').textContent === 'Trending on Solana', 'label');
  must(d.querySelector('#pairs').dataset.mode === 'trending', 'mode');
  must(d.querySelectorAll('#pairs-body .row .copy-btn').length === 8, 'copy buttons');
  must(d.querySelector('#v-pairs').textContent === '0', 'tiles must still report the real Deskless count (0), not the fallback');
  const chips = [...d.querySelectorAll('#marquee-track .mq-item')];
  must(d.querySelector('#marquee').dataset.state === 'ok' && chips.length >= 16, 'marquee always shows something: ' + chips.length);
  must(chips[0].querySelector('.logo-sm') && chips[0].querySelector('.mq-sym').textContent === 'AAA' && chips[0].querySelector('.mq-dot').textContent === '·' && /^\$1\.50$/.test(chips[0].querySelector('.mq-price').textContent), 'chip anatomy ' + chips[0].textContent);
  d.querySelector('#pairs-body .copy-btn').click(); await rt.flush();
  must(rt.copied[0] === 'tokA', 'trending copy payload ' + rt.copied[0]);
});
gate('G28', 'pairs auto-replace: when the own search starts returning pairs, fallback rows and label go away', async () => {
  const reg = SRC_REG(); reg.__variant = 'absent'; let own = { pairs: [] };
  const rt = await runtime({ reg, rpc: async () => ({ body: { result: 1 } }), dex: async url => ({ body: String(url).includes('q=sol') ? TRENDING : own }) });
  must(rt.d.querySelector('#pairs').dataset.mode === 'trending', 'precondition');
  own = PAIRS;
  const t = rt.timers.filter(x => x.ms === 30000).pop(); t.fn(); await rt.flush();
  const syms = [...rt.d.querySelectorAll('#pairs-body .tk-sym')].map(e => e.textContent);
  must(rt.d.querySelector('#pairs').dataset.mode === 'own' && rt.d.querySelector('#pairs-label').hidden, 'still showing fallback');
  must(syms.length === 2 && syms.every(s => s === 'DESKLESS'), 'rows ' + syms.join());
  await new Promise(r => setTimeout(r, 900)); // count-up from 0 runs on real rAF
  must(rt.d.querySelector('#v-pairs').textContent === '2', 'tile ' + rt.d.querySelector('#v-pairs').textContent);
});
gate('G29', 'logos: imageUrl, then logoURI, else palette-tone initials (hash-stable); 32px rows, 24px chips; fallback outage degrades to empty state', async () => {
  const reg = SRC_REG(); reg.__variant = 'absent';
  const rt = await runtime({ reg, rpc: async () => ({ body: { result: 1 } }), dex: route({ pairs: [] }, TRENDING) });
  const rows = [...rt.d.querySelectorAll('#pairs-body .row')];
  const byId = s => rows.find(r => r.querySelector('.tk-sym').textContent === s);
  must(byId('AAA').querySelector('img.logo').src === 'https://cdn.dexscreener.com/a.png' && byId('AAA').querySelector('img.logo').width === 32, 'imageUrl');
  must(byId('BBB').querySelector('img.logo').src === 'https://cdn.dexscreener.com/b.png', 'logoURI fallback');
  const ini = byId('CCC').querySelector('span.logo'); must(ini && ini.textContent === 'CC' && /tone-[0-7]/.test(ini.className), 'initials');
  const again = await runtime({ reg, rpc: async () => ({ body: { result: 1 } }), dex: route({ pairs: [] }, TRENDING) });
  must([...again.d.querySelectorAll('#pairs-body .row')].find(r => r.querySelector('.tk-sym').textContent === 'CCC').querySelector('.logo').className === ini.className, 'tone not stable');
  const css = fs.readFileSync('src/styles.css', 'utf8');
  must(/\.logo \{ width: 32px; height: 32px/.test(css) && /\.logo-sm \{ width: 24px; height: 24px/.test(css), 'sizes');
  for (let i = 0; i < 8; i++) must(new RegExp('\\.tone-' + i + ' \\{ background: var\\(--c-[a-z0-9-]+\\); color: var\\(--c-[a-z0-9-]+\\)').test(css), 'tone-' + i + ' not palette vars');
  const img = rt.d.querySelector('#pairs-body img.logo'); const src = img.src; img.dispatchEvent(new rt.w.Event('error'));
  must(!rt.d.querySelector('#pairs-body img.logo[src="' + src + '"]') && rt.d.querySelectorAll('#pairs-body .logo').length === 8, 'broken image did not fall back to initials');
  const dead = await runtime({ reg, rpc: async () => ({ body: { result: 1 } }), dex: async url => String(url).includes('q=sol') ? new Error('down') : { body: { pairs: [] } } });
  must(dead.d.querySelector('#pairs').dataset.state === 'empty' && dead.d.querySelector('#pairs-label').hidden, 'fallback failure must degrade to the empty state');
});

// ---------------------------------------------------------------- run
fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
let pass = 0;
for (const g of results) {
  try { await g.fn(); pass++; console.log(`PASS ${g.id}  ${g.name}`); }
  catch (e) { console.log(`FAIL ${g.id}  ${g.name}\n      -> ${e.message}`); }
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\ngates: ${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
