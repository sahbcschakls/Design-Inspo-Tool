#!/usr/bin/env node
// Serves dist/ the way the host does (including the /thumbs/:id → :id.webp rewrite),
// so you can check the web view before pushing.  npm run site:preview
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.svg': 'image/svg+xml' };
const port = Number(process.env.PORT || 4646);

http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel === '/') rel = '/index.html';
  let file = path.join(dist, path.normalize(rel));
  if (!file.startsWith(dist)) { res.writeHead(403).end(); return; }
  if (!fs.existsSync(file) && /^\/(thumbs|media)\//.test(rel)) file += '.webp';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`Web view preview at http://localhost:${port}`));
