// Inbox handling. A reference can arrive with a sidecar file next to it
// (same name, .md or .txt) holding instructions and/or the URL it came from:
//
//   _inbox/hero-shot.png
//   _inbox/hero-shot.md   ->  "url: https://…  \n Use the type pairing, ignore the colours"
//
// Once a reference from _inbox is analysed it is filed into its section folder
// (web/, mobile/, presentation/…) together with its sidecar.
import fs from 'node:fs';
import path from 'node:path';
import { INBOX, SECTIONS, sectionOf } from './sections.js';

export const SIDECAR_EXTS = ['.md', '.txt'];
const toPosix = (p) => p.split(path.sep).join('/');

export function sidecarFor(absImage) {
  const { dir, name } = path.parse(absImage);
  for (const ext of SIDECAR_EXTS) {
    const f = path.join(dir, name + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

export function readSidecar(absImage) {
  const file = sidecarFor(absImage);
  if (!file) return { instructions: '', sourceUrl: '' };
  const raw = fs.readFileSync(file, 'utf8').slice(0, 6000);
  const url = raw.match(/https?:\/\/[^\s)>\]]+/i)?.[0] || '';
  const instructions = raw
    .split('\n')
    .filter((line) => !/^\s*(url|source|link)\s*:/i.test(line))
    .join('\n')
    .trim();
  return { instructions, sourceUrl: url };
}

// The image a sidecar belongs to, if any.
export function imageForSidecar(absSidecar, isImage) {
  const { dir, name } = path.parse(absSidecar);
  if (!fs.existsSync(dir)) return null;
  const match = fs.readdirSync(dir).find((f) => path.parse(f).name === name && isImage(f));
  return match ? path.join(dir, match) : null;
}

// Moves an analysed inbox reference (and its sidecar) into its section folder and
// updates the store so the watcher sees a move, not a new file.
export async function fileFromInbox({ libraryDir, store, id }) {
  const style = store.get(id);
  if (!style || style.status !== 'ready' || style.collection !== INBOX) return null;
  const section = SECTIONS.find((s) => s.id === sectionOf({ ...style, collection: null }));
  const targetDir = path.join(libraryDir, section?.folder || 'misc');
  const src = path.join(libraryDir, style.file);
  if (!fs.existsSync(src)) return null;
  fs.mkdirSync(targetDir, { recursive: true });
  const { name, ext } = path.parse(src);
  let target = path.join(targetDir, name + ext);
  for (let i = 2; fs.existsSync(target); i++) target = path.join(targetDir, `${name}-${i}${ext}`);
  const rel = toPosix(path.relative(libraryDir, target));
  await store.update(id, { file: rel, fileName: path.basename(rel), collection: section?.folder || 'misc', filedAt: new Date().toISOString() });
  const side = sidecarFor(src);
  fs.renameSync(src, target);
  if (side) fs.renameSync(side, path.join(targetDir, path.parse(target).name + path.extname(side)));
  return rel;
}
