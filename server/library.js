// Binds one references folder to a Store, a file watcher and an Analyzer.
// Files are identified by content hash, so renaming or moving an image inside the
// folder keeps its analysis.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import chokidar from 'chokidar';
import { Store } from './store.js';
import { Analyzer } from './analyzer.js';
import { isImage, probe, makeThumb, extractPalette } from './images.js';
import { writeExports } from './taste.js';

const hashFile = (file) =>
  new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    fs.createReadStream(file).on('data', (d) => hash.update(d)).on('end', () => resolve(hash.digest('hex').slice(0, 16))).on('error', reject);
  });

const toPosix = (p) => p.split(path.sep).join('/');

export class Library {
  constructor(getConfig) {
    this.getConfig = getConfig;
    const { libraryDir, dataDir } = getConfig();
    this.dir = libraryDir;
    this.dataDir = dataDir;
    this.thumbDir = path.join(dataDir, 'thumbs');
    fs.mkdirSync(this.thumbDir, { recursive: true });
    this.store = new Store(dataDir);
    this.analyzer = new Analyzer({
      store: this.store,
      libraryDir: this.dir,
      getConfig,
      onExportsChanged: () => this.scheduleExports(),
    });
    this.byPath = new Map(); // relative path -> id
    this.slots = 4; // concurrent ingests (hashing + thumbnails)
    this.slotWaiters = [];
    this.ready = false;
    this.exportTimer = null;
  }

  thumbPath(id) {
    return path.join(this.thumbDir, `${id}.webp`);
  }

  filePath(style) {
    return path.join(this.dir, style.file);
  }

  async start() {
    // Anything left "analyzing" by a previous crash goes back to the queue.
    await this.store.mutate((data) => {
      for (const s of Object.values(data.styles)) {
        if (s.status === 'analyzing') s.status = 'pending';
        this.byPath.set(s.file, s.id);
      }
    });

    this.watcher = chokidar.watch(this.dir, {
      ignored: (p) => path.basename(p).startsWith('.') && p !== this.dir,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 600, pollInterval: 100 },
      depth: 6,
    });
    const seen = new Set();
    this.watcher
      .on('add', (file) => { seen.add(file); this.ingest(file).catch((e) => console.error('[inspo] ingest failed', file, e.message)); })
      .on('change', (file) => this.ingest(file, { changed: true }).catch(() => {}))
      .on('unlink', (file) => this.markMissing(file))
      .on('ready', async () => {
        this.ready = true;
        // Files deleted while the app was closed.
        await this.store.mutate((data) => {
          for (const s of Object.values(data.styles)) {
            if (!fs.existsSync(path.join(this.dir, s.file))) s.missing = true;
          }
        });
        this.queuePending();
        this.scheduleExports();
      });
  }

  async stop() {
    this.analyzer.stop();
    await this.watcher?.close();
  }

  async ingest(absFile, opts) {
    if (!isImage(absFile)) return;
    if (this.slots === 0) await new Promise((resolve) => this.slotWaiters.push(resolve));
    else this.slots--;
    try {
      await this.#ingest(absFile, opts);
    } finally {
      const next = this.slotWaiters.shift();
      if (next) next();
      else this.slots++;
    }
  }

  async #ingest(absFile, { changed = false } = {}) {
    if (!fs.existsSync(absFile)) return;
    const rel = toPosix(path.relative(this.dir, absFile));
    const stat = fs.statSync(absFile);
    if (!stat.size) return;
    const id = await hashFile(absFile);
    const parts = rel.split('/');
    const collection = parts.length > 1 ? parts[0] : null;

    const isNew = await this.store.mutate((data) => {
      const prevId = this.byPath.get(rel);
      if (changed && prevId && prevId !== id && data.styles[prevId]) {
        // File edited in place: carry user metadata over to the new hash.
        const { notes, favorite, pinned, addedAt } = data.styles[prevId];
        delete data.styles[prevId];
        data.styles[id] = { id, notes, favorite, pinned, addedAt, status: 'pending' };
      }
      const existing = data.styles[id];
      this.byPath.set(rel, id);
      if (existing && existing.fileName) {
        // Same pixels saved twice: keep the original entry where it is.
        if (existing.file !== rel && !existing.missing && fs.existsSync(path.join(this.dir, existing.file))) return false;
        // Known image — moved/renamed, or restored after deletion.
        Object.assign(existing, { file: rel, fileName: path.basename(rel), collection, missing: false, size: stat.size });
        return false;
      }
      data.styles[id] = {
        status: 'pending',
        favorite: false,
        pinned: false,
        notes: '',
        tags: [],
        ...existing,
        id,
        file: rel,
        fileName: path.basename(rel),
        collection,
        size: stat.size,
        addedAt: existing?.addedAt || new Date(stat.birthtimeMs || stat.mtimeMs || Date.now()).toISOString(),
        missing: false,
      };
      return true;
    });

    const style = this.store.get(id);
    const needsThumb = !fs.existsSync(this.thumbPath(id));
    if (isNew || needsThumb || !style.width) {
      const [meta, localColors] = await Promise.all([probe(absFile), style.localColors?.length ? style.localColors : extractPalette(absFile)]);
      const thumb = needsThumb ? await makeThumb(absFile, this.thumbPath(id)) : true;
      await this.store.update(id, { ...meta, localColors, hasThumb: thumb });
    }
    if (isNew && this.ready) this.maybeAnalyze(id);
  }

  async markMissing(absFile) {
    const rel = toPosix(path.relative(this.dir, absFile));
    const id = this.byPath.get(rel);
    if (!id) return;
    this.byPath.delete(rel);
    // Give a rename/move a moment to re-add the same hash under a new path.
    setTimeout(() => {
      this.store.mutate((data) => {
        const s = data.styles[id];
        if (s && s.file === rel && !fs.existsSync(absFile)) s.missing = true;
      }).then(() => this.scheduleExports()).catch(() => {});
    }, 1500);
  }

  maybeAnalyze(id) {
    const config = this.getConfig();
    if (config.aiEnabled && config.autoAnalyze) this.analyzer.enqueue(id);
  }

  queuePending({ includeErrors = false, force = false } = {}) {
    const config = this.getConfig();
    if (!config.aiEnabled || (!config.autoAnalyze && !force)) return 0;
    let n = 0;
    for (const s of this.store.list()) {
      if (s.status === 'pending' || (includeErrors && s.status === 'error')) {
        this.analyzer.enqueue(s.id);
        n++;
      }
    }
    return n;
  }

  scheduleExports() {
    clearTimeout(this.exportTimer);
    this.exportTimer = setTimeout(() => {
      try {
        const data = this.store.read();
        writeExports(this.dataDir, this.store.list(), data.taste);
      } catch (e) {
        console.error('[inspo] failed to write exports', e.message);
      }
    }, 800);
  }

  // Saves an uploaded file into the folder; the watcher picks it up from there.
  saveUpload(name, buffer, collection) {
    const id = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
    const existing = this.store.get(id);
    if (existing && !existing.missing) return { duplicate: true, file: existing.file, id };
    const safeName = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || `reference-${Date.now()}.png`;
    if (!isImage(safeName)) throw Object.assign(new Error('Only image files can be added.'), { status: 400 });
    const safeCollection = collection ? path.basename(collection).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') : '';
    const dir = safeCollection && !safeCollection.startsWith('.') ? path.join(this.dir, safeCollection) : this.dir;
    fs.mkdirSync(dir, { recursive: true });
    let target = path.join(dir, safeName);
    const { name: stem, ext } = path.parse(safeName);
    for (let i = 2; fs.existsSync(target); i++) target = path.join(dir, `${stem}-${i}${ext}`);
    fs.writeFileSync(target, buffer);
    return { file: toPosix(path.relative(this.dir, target)), id };
  }

  // "Remove" moves the file to <folder>/.inspo/trash so nothing is lost by accident.
  async trash(id) {
    const style = this.store.get(id);
    if (!style) throw Object.assign(new Error('Style not found'), { status: 404 });
    const src = this.filePath(style);
    if (fs.existsSync(src)) {
      const trashDir = path.join(this.dataDir, 'trash');
      fs.mkdirSync(trashDir, { recursive: true });
      fs.renameSync(src, path.join(trashDir, `${Date.now()}-${style.fileName}`));
    }
    await this.store.mutate((data) => { delete data.styles[id]; });
    fs.rmSync(this.thumbPath(id), { force: true });
    this.scheduleExports();
  }
}
