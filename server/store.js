// library.json lives inside the references folder (<folder>/.inspo/library.json),
// so the analysis travels with the folder. Both the web server and the MCP server
// write to it, so every mutation re-reads the file first and writes atomically.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const EMPTY = () => ({ version: 1, styles: {}, taste: null, updatedAt: null });

export class Store extends EventEmitter {
  constructor(dataDir) {
    super();
    this.dataDir = dataDir;
    this.file = path.join(dataDir, 'library.json');
    this.queue = Promise.resolve();
    fs.mkdirSync(dataDir, { recursive: true });
  }

  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { ...EMPTY(), ...data, styles: data.styles || {} };
    } catch {
      return EMPTY();
    }
  }

  #write(data) {
    data.updatedAt = new Date().toISOString();
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  // Serialised read-modify-write. `fn` may mutate `data` in place and return a value.
  mutate(fn) {
    const run = this.queue.then(async () => {
      const data = this.read();
      const result = await fn(data);
      this.#write(data);
      this.emit('change');
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }

  get(id) {
    return this.read().styles[id] || null;
  }

  update(id, patch) {
    return this.mutate((data) => {
      const current = data.styles[id];
      if (!current) throw Object.assign(new Error('Style not found'), { status: 404 });
      data.styles[id] = { ...current, ...patch };
      return data.styles[id];
    });
  }

  // Styles that still have a file on disk, newest first.
  list() {
    return Object.values(this.read().styles)
      .filter((s) => !s.missing)
      .sort((a, b) => (b.addedAt || '').localeCompare(a.addedAt || ''));
  }
}
