#!/usr/bin/env node
// Builds the read-only web view into dist/ (no dependencies needed, so it runs on
// any static host's build step). Data comes from site/, written by `npm run site:export`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { staticConfig, EMPTY_STATS } from '../server/webview.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(ROOT, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), dist, { recursive: true });

// Brief and token builders are plain ES modules shared with the server; the web view runs them in the browser.
fs.mkdirSync(path.join(dist, 'lib'), { recursive: true });
for (const f of ['prompts.js', 'sections.js', 'playbooks.js']) fs.copyFileSync(path.join(ROOT, 'server', f), path.join(dist, 'lib', f));

const site = path.join(ROOT, 'site');
if (fs.existsSync(path.join(site, 'data', 'library.json'))) {
  for (const d of ['data', 'thumbs', 'media']) if (fs.existsSync(path.join(site, d))) fs.cpSync(path.join(site, d), path.join(dist, d), { recursive: true });
} else {
  console.warn('No site/data/library.json yet: run `npm run site:export` locally and commit site/. Building an empty web view.');
  fs.mkdirSync(path.join(dist, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'data', 'library.json'), JSON.stringify({ exportedAt: null, styles: [], kits: [], taste: null, stats: EMPTY_STATS, queue: 0, config: staticConfig() }));
}

const index = path.join(dist, 'index.html');
fs.writeFileSync(index, fs.readFileSync(index, 'utf8').replace('<script type="module" src="/app.js">', '<script>window.INSPO_STATIC = true;</script>\n  <script type="module" src="/app.js">'));
console.log('Built the web view into dist/');
