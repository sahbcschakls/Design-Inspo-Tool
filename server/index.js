import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { ROOT, getConfig, saveLocalConfig } from './config.js';
import { Library } from './library.js';
import { cleanAnalysis, TYPES } from './schema.js';
import { computeStats, synthesiseTaste, writeExports } from './taste.js';
import { bundlePrompt, styleToMarkdown, tasteToMarkdown } from './prompts.js';
import { hasSharp } from './images.js';

const app = express();
app.use(express.json({ limit: '2mb' }));

let library = null;
const clients = new Set();
let broadcastTimer = null;
let libraryFileWatch = null;

function broadcast(event = 'library') {
  clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(() => {
    for (const res of clients) res.write(`event: ${event}\ndata: ${Date.now()}\n\n`);
  }, 150);
}

async function openLibrary() {
  if (library) {
    await library.stop();
    if (libraryFileWatch) fs.unwatchFile(libraryFileWatch);
  }
  library = new Library(getConfig);
  library.store.on('change', () => broadcast());
  // The MCP server writes to the same library.json from another process.
  libraryFileWatch = library.store.file;
  fs.watchFile(libraryFileWatch, { interval: 1000 }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs) {
      broadcast();
      library.scheduleExports();
    }
  });
  await library.start();
  console.log(`[inspo] watching ${library.dir}`);
}

const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong' });
  });

function publicConfig() {
  const c = getConfig();
  const mcpServer = path.join(ROOT, 'mcp', 'server.js');
  return {
    libraryDir: c.libraryDir,
    dataDir: c.dataDir,
    aiEnabled: c.aiEnabled,
    hasApiKey: Boolean(c.apiKey),
    apiKeyHint: c.apiKey ? `…${c.apiKey.slice(-4)}` : '',
    model: c.model,
    autoAnalyze: c.autoAnalyze,
    sharp: hasSharp(),
    types: TYPES,
    mcp: {
      command: process.execPath,
      args: [mcpServer],
      claudeCode: `claude mcp add inspo --scope user -- "${process.execPath}" "${mcpServer}"`,
    },
    files: {
      taste: path.join(c.dataDir, 'TASTE.md'),
      active: path.join(c.dataDir, 'ACTIVE.md'),
      styles: path.join(c.dataDir, 'styles'),
    },
  };
}

// ---- Library -------------------------------------------------------------

app.get('/api/library', wrap(async (_req, res) => {
  const data = library.store.read();
  const styles = library.store.list();
  res.json({ styles, taste: data.taste, stats: computeStats(styles), config: publicConfig(), queue: library.analyzer.waiting.length + library.analyzer.active.size });
}));

app.get('/api/styles/:id', wrap(async (req, res) => {
  const style = library.store.get(req.params.id);
  if (!style) return res.status(404).json({ error: 'Not found' });
  res.json({ ...style, markdown: styleToMarkdown(style) });
}));

app.patch('/api/styles/:id', wrap(async (req, res) => {
  const patch = cleanAnalysis(req.body);
  if ('favorite' in req.body) patch.favorite = Boolean(req.body.favorite);
  if ('pinned' in req.body) patch.pinned = Boolean(req.body.pinned);
  if (Object.keys(patch).some((k) => !['favorite', 'pinned', 'notes'].includes(k))) {
    patch.editedAt = new Date().toISOString();
    const current = library.store.get(req.params.id);
    if (current?.status !== 'ready' && patch.styleName) patch.status = 'ready';
    if (current && !current.source) patch.source = 'manual';
  }
  const style = await library.store.update(req.params.id, patch);
  library.scheduleExports();
  res.json(style);
}));

app.post('/api/styles/:id/analyze', wrap(async (req, res) => {
  const config = getConfig();
  if (!config.aiEnabled) return res.status(400).json({ error: 'Add an Anthropic API key in Settings, or analyse via Claude over MCP.' });
  const style = library.store.get(req.params.id);
  if (!style) return res.status(404).json({ error: 'Not found' });
  await library.store.update(style.id, { status: 'pending', error: null });
  library.analyzer.enqueue(style.id);
  res.json({ ok: true });
}));

app.post('/api/analyze-pending', wrap(async (_req, res) => {
  if (!getConfig().aiEnabled) return res.status(400).json({ error: 'Add an Anthropic API key in Settings first.' });
  res.json({ queued: library.queuePending({ includeErrors: true, force: true }) });
}));

app.delete('/api/styles/:id', wrap(async (req, res) => {
  await library.trash(req.params.id);
  res.json({ ok: true });
}));

app.post('/api/styles/:id/reveal', wrap(async (req, res) => {
  const style = library.store.get(req.params.id);
  if (!style) return res.status(404).json({ error: 'Not found' });
  const file = library.filePath(style);
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', ['-R', file]]
    : process.platform === 'win32' ? ['explorer.exe', [`/select,${file}`]]
    : ['xdg-open', [path.dirname(file)]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  res.json({ ok: true });
}));

app.post('/api/upload', express.raw({ type: () => true, limit: '60mb' }), wrap(async (req, res) => {
  const name = String(req.query.name || '');
  if (!req.body?.length) return res.status(400).json({ error: 'Empty file' });
  res.json({ ok: true, ...library.saveUpload(name, req.body, req.query.collection) });
}));

// ---- Claude handoff --------------------------------------------------------

app.post('/api/active', wrap(async (req, res) => {
  const { id, pinned } = req.body;
  if (id === '*' && pinned === false) {
    await library.store.mutate((data) => { for (const s of Object.values(data.styles)) s.pinned = false; });
  } else {
    await library.store.update(id, { pinned: Boolean(pinned) });
  }
  library.scheduleExports();
  res.json({ ok: true });
}));

app.post('/api/prompt', wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  const styles = ids.map((id) => library.store.get(id)).filter(Boolean);
  if (!styles.length) return res.status(400).json({ error: 'No styles selected' });
  const { taste } = library.store.read();
  res.json({ prompt: bundlePrompt(styles, { taste, task: req.body.task }) });
}));

app.get('/api/taste.md', wrap(async (_req, res) => {
  const styles = library.store.list();
  res.type('text/markdown').send(tasteToMarkdown(library.store.read().taste, computeStats(styles)));
}));

app.post('/api/taste/rebuild', wrap(async (_req, res) => {
  const config = getConfig();
  if (!config.aiEnabled) return res.status(400).json({ error: 'Add an Anthropic API key in Settings, or ask Claude to run "rebuild_taste_profile" over MCP.' });
  const taste = await synthesiseTaste(library.store.list(), config);
  await library.store.mutate((data) => { data.taste = taste; });
  writeExports(library.dataDir, library.store.list(), taste);
  res.json(taste);
}));

// ---- Settings ---------------------------------------------------------------

app.get('/api/settings', (_req, res) => res.json(publicConfig()));

app.post('/api/settings', wrap(async (req, res) => {
  const { libraryDir, apiKey, model, autoAnalyze } = req.body;
  const before = getConfig();
  const patch = {};
  if (typeof libraryDir === 'string' && libraryDir.trim()) {
    const resolved = path.resolve(libraryDir.trim().replace(/^~(?=$|[\\/])/, process.env.HOME || process.env.USERPROFILE || '~'));
    fs.mkdirSync(resolved, { recursive: true });
    patch.libraryDir = resolved;
  }
  if (typeof apiKey === 'string') patch.apiKey = apiKey.trim();
  if (typeof model === 'string') patch.model = model.trim();
  if (typeof autoAnalyze === 'boolean') patch.autoAnalyze = autoAnalyze;
  const after = saveLocalConfig(patch);
  if (after.libraryDir !== before.libraryDir) await openLibrary();
  else if (after.aiEnabled && after.autoAnalyze) library.queuePending();
  broadcast();
  res.json(publicConfig());
}));

// ---- Live updates & files --------------------------------------------------

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(res); });
});

app.get('/media/:id', (req, res) => {
  const style = library.store.get(req.params.id);
  if (!style) return res.sendStatus(404);
  res.sendFile(library.filePath(style), { dotfiles: 'allow' }, (err) => err && !res.headersSent && res.sendStatus(404));
});

app.get('/thumbs/:id', (req, res) => {
  const style = library.store.get(req.params.id);
  if (!style) return res.sendStatus(404);
  const thumb = library.thumbPath(style.id);
  const file = fs.existsSync(thumb) ? thumb : library.filePath(style);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(file, { dotfiles: 'allow' }, (err) => err && !res.headersSent && res.sendStatus(404));
});

app.use(express.static(path.join(ROOT, 'public')));

await openLibrary();
const { port } = getConfig();
app.listen(port, '127.0.0.1', () => {
  console.log(`\n  ◐ Inspo Library running at http://localhost:${port}\n`);
});
