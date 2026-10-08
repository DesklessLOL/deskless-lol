import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { validate, handleFromUrl } from './lib/register.mjs';
import { readPalette, hexToRgb } from './lib/palette.mjs';

const MARK = 'brand/LOGO DESKLESS PNG...png';

const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const ICON_GH = '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
const ICON_COPY = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h8"></path></svg>';

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function social(reg, key, label, icon) {
  const r = reg[key];
  if (r.state === 'stated') {
    const handle = handleFromUrl(r.url);
    return `        <a class="social" data-record="${key}" data-state="stated" data-spot href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${label}: ${esc(handle)}">${icon}</a>`;
  }
  return `        <span class="social is-inert" data-record="${key}" data-state="${r.state}" role="img" aria-label="${label}, not announced yet">${icon}</span>`;
}

function caStrip(reg) {
  const r = reg.ca;
  if (r.state === 'stated') {
    return `  <div class="ca" data-record="ca" data-state="stated"><div class="ca-inner wrap">
    <span class="ca-label">Contract address</span>
    <button type="button" class="ca-btn" id="ca-btn" data-spot aria-label="Copy contract address"><span class="ca-value" id="ca-value">${esc(r.value)}</span><span class="ca-action">${ICON_COPY}<span class="ca-action-text">Copy</span></span></button>
  </div></div>`;
  }
  return `  <div class="ca" data-record="ca" data-state="${r.state}"><div class="ca-inner wrap">
    <span class="ca-label">Contract address</span>
    <button type="button" class="ca-btn is-inert" id="ca-btn" disabled aria-disabled="true"><span class="ca-value" id="ca-value">Not announced yet</span><span class="ca-action"><span class="ca-action-text">Locked</span></span></button>
  </div></div>`;
}

function prng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function shards(count, seed, prefix, sizeRange, colors) {
  const rnd = prng(seed); const html = []; const css = [];
  for (let i = 1; i <= count; i++) {
    const n = 5 + Math.floor(rnd() * 3);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.5, rad = 0.38 + rnd() * 0.12;
      pts.push(`${(50 + Math.cos(a) * rad * 100).toFixed(1)}% ${(50 + Math.sin(a) * rad * 100).toFixed(1)}%`);
    }
    const size = Math.round(sizeRange[0] + rnd() * (sizeRange[1] - sizeRange[0]));
    // keep shards off the centre where the mark sits
    const ang = rnd() * Math.PI * 2, dist = 36 + rnd() * 14;
    const l = (50 + Math.cos(ang) * dist).toFixed(1), t = (50 + Math.sin(ang) * dist).toFixed(1);
    html.push(`<i class="shard ${prefix}${i}"></i>`);
    css.push(`.${prefix}${i}{--clip:${pts.join(',')};--s:${size}px;--l:calc(${l}% - ${size / 2}px);--t:calc(${t}% - ${size / 2}px);--shard:var(${colors[i % colors.length]})}`);
  }
  return { html: html.join(''), css: css.join('\n') };
}

async function makeFavicon(palette) {
  // Trace: crop the mark to its alpha bounding box, box-average onto a real 32x32 pixel grid,
  // snap each covered cell to the nearest palette tone by luminance, merge horizontal runs into rects.
  const src = sharp(MARK).ensureAlpha();
  const { data: full, info } = await src.raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = 0, y1 = 0;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (full[(y * info.width + x) * 4 + 3] > 128) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1, side = Math.max(w, h);
  const GRID = 32, PAD = 3, inner = GRID - PAD * 2;
  const cell = side / inner;
  const lum = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const tones = palette.filter(p => ['q', 'k'].includes(p.kind[0]) || p.kind.startsWith('q')).map(p => ({ hex: p.hex, l: lum(hexToRgb(p.hex)) }));
  const ink = palette.find(p => p.name === '--c-ink-0').hex;
  const cells = [];
  for (let cy = 0; cy < inner; cy++) {
    const row = [];
    for (let cx = 0; cx < inner; cx++) {
      let a = 0, l = 0, n = 0, tot = 0;
      const sx0 = x0 + (cx * cell - (side - w) / 2), sy0 = y0 + (cy * cell - (side - h) / 2);
      for (let y = Math.floor(sy0); y < Math.ceil(sy0 + cell); y++) for (let x = Math.floor(sx0); x < Math.ceil(sx0 + cell); x++) {
        tot++;
        if (x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
        const i = (y * info.width + x) * 4, al = full[i + 3] / 255;
        a += al; if (al > 0) { l += lum([full[i], full[i + 1], full[i + 2]]) * al; n += al; }
      }
      if (a / tot < 0.5 || !n) { row.push(null); continue; }
      const L = l / n;
      row.push(tones.reduce((b, t) => Math.abs(t.l - L) < Math.abs(b.l - L) ? t : b).hex);
    }
    cells.push(row);
  }
  const rects = [];
  cells.forEach((row, cy) => {
    let cx = 0;
    while (cx < row.length) {
      if (!row[cx]) { cx++; continue; }
      let e = cx; while (e + 1 < row.length && row[e + 1] === row[cx]) e++;
      rects.push(`<rect x="${cx + PAD}" y="${cy + PAD}" width="${e - cx + 1}" height="1" fill="${row[cx]}"/>`);
      cx = e + 1;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" shape-rendering="crispEdges"><rect width="32" height="32" rx="6" fill="${ink}"/>${rects.join('')}</svg>\n`;
}

let markPre = null;
async function resizeMark(size) {
  // The transparent PNG holds pure black RGB in alpha-0 regions. Premultiply once in JS, then resize in premultiplied
  // space (raw.premultiplied tells sharp to unpremultiply on output) so no dark fringe bleeds into soft edges.
  if (!markPre) {
    const { data, info } = await sharp(MARK).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const pre = Buffer.from(data);
    for (let i = 0; i < pre.length; i += 4) { const a = pre[i + 3] / 255; pre[i] = Math.round(pre[i] * a); pre[i + 1] = Math.round(pre[i + 1] * a); pre[i + 2] = Math.round(pre[i + 2] * a); }
    markPre = { pre, w: info.width, h: info.height };
  }
  return sharp(markPre.pre, { raw: { width: markPre.w, height: markPre.h, channels: 4, premultiplied: true } }).resize(size, size, { kernel: 'lanczos3' });
}

export async function build({ register, out = 'dist', assetsFrom = null }) {
  const errs = validate(register);
  if (errs.length) throw new Error('register invalid:\n  ' + errs.join('\n  '));
  const palette = readPalette();
  const P = n => palette.find(p => p.name === n).hex;

  fs.rmSync(out, { recursive: true, force: true });
  for (const d of ['', 'img', 'fonts']) fs.mkdirSync(path.join(out, d), { recursive: true });

  // images (variant builds in the gates reuse the already-built dist assets; the register never touches them)
  if (assetsFrom) {
    fs.cpSync(`${assetsFrom}/img`, `${out}/img`, { recursive: true });
    fs.copyFileSync(`${assetsFrom}/favicon.svg`, `${out}/favicon.svg`);
  } else {
  await (await resizeMark(1280)).png({ compressionLevel: 9 }).toFile(`${out}/img/mark-1280.png`);
  await (await resizeMark(1280)).webp({ quality: 88, alphaQuality: 100 }).toFile(`${out}/img/mark-1280.webp`);
  await (await resizeMark(640)).webp({ quality: 88, alphaQuality: 100 }).toFile(`${out}/img/mark-640.webp`);
  await (await resizeMark(96)).png().toFile(`${out}/img/mark-96.png`);
  const bg = hex => ({ r: hexToRgb(hex)[0], g: hexToRgb(hex)[1], b: hexToRgb(hex)[2], alpha: 1 });
  const touch = await (await resizeMark(140)).png().toBuffer();
  await sharp({ create: { width: 180, height: 180, channels: 4, background: bg(P('--c-ink-0')) } }).composite([{ input: touch, gravity: 'center' }]).png().toFile(`${out}/img/apple-touch-icon.png`);
  const og = await (await resizeMark(560)).png().toBuffer();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: bg(P('--c-ink-0')) } }).composite([{ input: og, gravity: 'center' }]).png().toFile(`${out}/img/og.png`);
  fs.writeFileSync(`${out}/favicon.svg`, await makeFavicon(palette));
  }

  // static files
  for (const f of fs.readdirSync('src/fonts')) fs.copyFileSync(`src/fonts/${f}`, `${out}/fonts/${f}`);
  fs.copyFileSync('src/tokens.css', `${out}/tokens.css`);
  fs.copyFileSync('src/app.js', `${out}/app.js`);
  fs.copyFileSync('src/boot.js', `${out}/boot.js`);
  const far = shards(9, 11, 'sf', [10, 26], ['--c-k1', '--c-k2', '--c-ink-3']);
  const near = shards(7, 29, 'sn', [18, 44], ['--c-k3', '--c-k4', '--c-k5', '--c-k6']);
  fs.writeFileSync(`${out}/styles.css`, fs.readFileSync('src/styles.css', 'utf8') + '\n/* generated shard layout */\n' + far.css + '\n' + near.css + '\n');

  // html
  const ca = register.ca;
  const rpcOrigin = new URL(register.rpc.value).origin, dexOrigin = new URL(register.dex.value).origin;
  const caNotice = ca.state === 'stated'
    ? ['Official contract address', 'This is the address pinned in the strip above. Compare it character by character with whatever you are about to paste into your signer.']
    : ['No contract address yet', 'None has been published. The strip pinned at the top of the site will show the full address, ready to copy, the moment one is. Until it appears there, treat every address you meet elsewhere as unverified.'];
  const subs = {
    'register': JSON.stringify(register).replace(/</g, '\\u003c'),
    'theme-color': P('--c-ink-0'),
    'socials': social(register, 'x', 'X', ICON_X) + '\n' + social(register, 'github', 'GitHub', ICON_GH),
    'ca': caStrip(register),
    'ca-state': ca.state,
    'ca-notice-head': caNotice[0],
    'ca-notice-body': caNotice[1],
    'domain': esc(register.domain.value),
    'chain': esc(register.chain.value),
    'shards-far': far.html,
    'shards-near': near.html
  };
  let html = fs.readFileSync('src/index.html', 'utf8');
  html = html.replace(/@@([a-z-]+)@@/g, (m, k) => { if (!(k in subs)) throw new Error('unfilled placeholder ' + m); return subs[k]; });
  fs.writeFileSync(`${out}/index.html`, html);

  fs.writeFileSync(`${out}/_headers`, [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    `  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' ${rpcOrigin} ${dexOrigin}; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    '',
    '/fonts/*',
    '  Cache-Control: public, max-age=31536000, immutable',
    '/img/*',
    '  Cache-Control: public, max-age=86400',
    ''
  ].join('\n'));
  fs.writeFileSync(`${out}/robots.txt`, 'User-agent: *\nAllow: /\n');
  return { out };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const register = JSON.parse(fs.readFileSync(process.env.REGISTER || 'src/register.json', 'utf8'));
  build({ register, out: process.env.OUT || 'dist' }).then(r => console.log('built ->', r.out), e => { console.error(e.message); process.exit(1); });
}
