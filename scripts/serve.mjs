// Local static server for dist/, applies the _headers CSP so the browser enforces what Cloudflare will.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || 'dist'), port = +(process.argv[3] || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain' };
const csp = (/Content-Security-Policy: (.*)/.exec(fs.readFileSync(path.join(root, '_headers'), 'utf8')) || [])[1];
http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  const h = { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' };
  if (csp) h['content-security-policy'] = csp;
  res.writeHead(200, h); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log('serving', root, 'on', port));
