import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
const dir = 'brand';
for (const f of fs.readdirSync(dir)) {
  const b = fs.readFileSync(path.join(dir, f));
  const isPng = b.slice(1, 4).toString() === 'PNG';
  const isJpg = b[0] === 0xff && b[1] === 0xd8;
  console.log('\n== ' + f, b.length, 'bytes', isPng ? 'PNG' : isJpg ? 'JPEG' : 'unknown', 'magic', b.slice(0, 8).toString('hex'));
  if (isPng) {
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    console.log('IHDR', { w, h, bitDepth: b[24], colourType: b[25], interlace: b[28] });
  }
  const { data, info } = await sharp(b).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, n = info.width * info.height;
  console.log('decoded', info.width, info.height, 'channels', ch);
  if (ch === 4) {
    const hist = new Array(8).fill(0); let zeroBlack = 0, zero = 0;
    for (let i = 0; i < n; i++) {
      const a = data[i * 4 + 3]; hist[a >> 5]++;
      if (a === 0) { zero++; if (!data[i*4] && !data[i*4+1] && !data[i*4+2]) zeroBlack++; }
    }
    console.log('alpha hist (32-wide bins)', hist.join(','), 'alpha0', zero, 'alpha0&pureBlackRGB', zeroBlack);
  }
  // k-means on opaque pixels, sampled
  const px = [];
  const step = Math.max(1, Math.floor(n / 40000));
  for (let i = 0; i < n; i += step) {
    if (ch === 4 && data[i * 4 + 3] < 200) continue;
    px.push([data[i * ch], data[i * ch + 1], data[i * ch + 2], i]);
  }
  let K = 6, cs = Array.from({ length: K }, (_, k) => px[Math.floor((k + 0.5) * px.length / K)].slice(0, 3));
  for (let it = 0; it < 25; it++) {
    const s = cs.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let bi = 0, bd = 1e9;
      cs.forEach((c, k) => { const d = (c[0]-p[0])**2 + (c[1]-p[1])**2 + (c[2]-p[2])**2; if (d < bd) { bd = d; bi = k; } });
      s[bi][0] += p[0]; s[bi][1] += p[1]; s[bi][2] += p[2]; s[bi][3]++;
    }
    cs = s.map((v, k) => v[3] ? [v[0]/v[3], v[1]/v[3], v[2]/v[3]] : cs[k]);
  }
  const out = cs.map(c => {
    let bi = null, bd = 1e9, cnt = 0;
    for (const p of px) { const d = (c[0]-p[0])**2 + (c[1]-p[1])**2 + (c[2]-p[2])**2; if (d < bd) { bd = d; bi = p; } }
    for (const p of px) { let dm = 1e9; /* membership */ }
    const i = bi[3], x = i % info.width, y = Math.floor(i / info.width);
    return { snapped: '#' + [bi[0], bi[1], bi[2]].map(v => v.toString(16).padStart(2, '0')).join(''), x, y };
  });
  console.log('kmeans snapped', JSON.stringify(out));
}
