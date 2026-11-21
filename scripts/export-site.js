#!/usr/bin/env node
// Snapshots your library into site/ so it can be hosted as a read-only web view
// (e.g. on Vercel). Commit site/ and push; the host rebuilds from it.
//
//   npm run site:export            export the library in INSPO_DIR
//   npm run site:export -- --ready only include analysed references
//
// Writes site/data/library.json, site/thumbs/<id>.webp and site/media/<id>.webp.
// Absolute paths from your computer are left out.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, getConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { sectionOf } from '../server/sections.js';
import { staticConfig } from '../server/webview.js';
import { computeStats } from '../server/taste.js';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.error('sharp is required for the export (npm install).');
  process.exit(1);
}

const onlyReady = process.argv.includes('--ready');
const config = getConfig();
const store = new Store(config.dataDir);
const out = path.join(ROOT, 'site');
fs.rmSync(out, { recursive: true, force: true });
for (const d of ['data', 'thumbs', 'media']) fs.mkdirSync(path.join(out, d), { recursive: true });

const data = store.read();
const styles = store.list().filter((s) => !onlyReady || s.status === 'ready');
const kept = [];
let done = 0;
for (const s of styles) {
  const src = path.join(config.libraryDir, s.file);
  if (!fs.existsSync(src)) continue;
  try {
    const img = () => sharp(src, { animated: false }).rotate();
    await img().resize({ width: 720, withoutEnlargement: true }).webp({ quality: 78 }).toFile(path.join(out, 'thumbs', `${s.id}.webp`));
    await img().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(path.join(out, 'media', `${s.id}.webp`));
  } catch (e) {
    console.warn(`skipped ${s.file}: ${e.message}`);
    continue;
  }
  const { error, ...rest } = s;
  kept.push({ ...rest, hasThumb: true, sectionId: sectionOf(s) });
  process.stdout.write(`\r${++done}/${styles.length} images`);
}
process.stdout.write('\n');

const ids = new Set(kept.map((s) => s.id));
const kits = store.listKits().map((k) => ({ ...k, parts: k.parts.filter((p) => ids.has(p.styleId)) }));
const snapshot = {
  exportedAt: new Date().toISOString(),
  demo: false,
  styles: kept,
  kits,
  taste: data.taste,
  stats: computeStats(kept),
  queue: 0,
  config: staticConfig(config),
};
if (process.argv.includes('--demo')) snapshot.demo = true;
fs.writeFileSync(path.join(out, 'data', 'library.json'), JSON.stringify(snapshot));
const mb = (dir) => fs.readdirSync(dir).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0) / 1e6;
console.log(`Exported ${kept.length} references and ${kits.length} kits to site/ (${(mb(path.join(out, 'thumbs')) + mb(path.join(out, 'media'))).toFixed(1)} MB of images).`);
console.log('Commit site/ and push: the hosted web view rebuilds from it.');
