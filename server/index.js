import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import express from 'express';
import { ROOT, getConfig, saveLocalConfig } from './config.js';
import { Library } from './library.js';
import { cleanAnalysis, TYPES } from './schema.js';
import { computeStats, synthesiseTaste, writeExports } from './taste.js';
import { bundlePrompt, styleToMarkdown, tasteToMarkdown } from './prompts.js';
import { SECTIONS, FACETS, MEDIA, KIT_ROLES, INBOX, sectionOf } from './sections.js';
import { PLAYBOOKS, buildTokens, tokensToCss, tokensToJson } from './playbooks.js';
import crypto from 'node:crypto';
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
    autoOrganize: c.autoOrganize,
    sharp: hasSharp(),
    types: TYPES,
    sections: SECTIONS,
    inbox: INBOX,
    facets: FACETS,
    media: MEDIA.map((id) => ({ id, label: PLAYBOOKS[id].label, verb: PLAYBOOKS[id].verb })),
    kitRoles: KIT_ROLES,
    skill: {
      project: path.join(ROOT, '.claude', 'skills', 'inspo', 'SKILL.md'),
      install: 'npm run skill:install',
    },
    mcp: {
      command: process.execPath,
      args: [mcpServer],
      claudeCode: `claude mcp add inspo --scope user -- "${process.execPath}" "${mcpServer}"`,
    },
    files: {
      taste: path.join(c.dataDir, 'TASTE.md'),
      active: path.join(c.dataDir, 'ACTIVE.md'),
      styles: path.join(c.dataDir, 'styles'),
      index: path.join(c.dataDir, 'INDEX.md'),
      kits: path.join(c.dataDir, 'kits'),
    },
  };
}

// ---- Library -------------------------------------------------------------

app.get('/api/library', wrap(async (_req, res) => {
  const data = library.store.read();
  const styles = library.store.list().map((s) => ({ ...s, sectionId: sectionOf(s) }));
  res.json({ styles, kits: library.store.listKits(), taste: data.taste, stats: computeStats(styles), config: publicConfig(), queue: library.analyzer.waiting.length + library.analyzer.active.size });
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
  if (typeof req.body.instructions === 'string') patch.instructions = req.body.instructions.slice(0, 4000);
  if (Object.keys(patch).some((k) => !['favorite', 'pinned', 'notes', 'instructions'].includes(k))) {
    patch.editedAt = new Date().toISOString();
    const current = library.store.get(req.params.id);
    if (current?.status !== 'ready' && patch.styleName) patch.status = 'ready';
    if (current && !current.source) patch.source = 'manual';
  }
  const style = await library.store.update(req.params.id, patch);
  if (style.collection === INBOX && style.status === 'ready') library.maybeFile(style.id);
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

// Builds an execution brief from styles or a kit, optionally for a medium and with content.
function briefFor({ ids, kitId, medium, content, task }) {
  const data = library.store.read();
  let kit = null;
  let styles;
  if (kitId) {
    kit = data.kits[kitId];
    if (!kit) throw Object.assign(new Error('Kit not found'), { status: 404 });
    styles = kit.parts.map((p) => data.styles[p.styleId]).filter(Boolean);
    medium = medium || kit.medium;
  } else {
    styles = (Array.isArray(ids) ? ids : []).map((id) => data.styles[id]).filter(Boolean);
  }
  if (!styles.length) throw Object.assign(new Error('No styles selected'), { status: 400 });
  if (medium && !PLAYBOOKS[medium]) medium = null;
  const parts = styles.map((s) => ({ style: s, role: kit?.parts.find((p) => p.styleId === s.id)?.role || null }));
  const tokens = buildTokens(parts);
  return {
    prompt: bundlePrompt(styles, { taste: data.taste, task, medium, content, kit }),
    css: tokensToCss(tokens),
    json: tokensToJson(tokens),
  };
}

app.post('/api/prompt', wrap(async (req, res) => {
  res.json(briefFor(req.body || {}));
}));

// ---- Kits ------------------------------------------------------------------

function cleanKit(body, prev = {}) {
  const kit = { ...prev };
  if (typeof body.name === 'string') kit.name = body.name.trim().slice(0, 80) || 'Untitled kit';
  if (typeof body.description === 'string') kit.description = body.description.trim().slice(0, 600);
  if (typeof body.notes === 'string') kit.notes = body.notes.trim().slice(0, 2000);
  if ('medium' in body) kit.medium = MEDIA.includes(body.medium) ? body.medium : null;
  if (Array.isArray(body.parts)) {
    const seen = new Set();
    kit.parts = body.parts
      .filter((p) => p && typeof p.styleId === 'string' && !seen.has(p.styleId) && seen.add(p.styleId))
      .map((p) => ({ styleId: p.styleId, role: KIT_ROLES.includes(p.role) ? p.role : 'primary' }))
      .slice(0, 12);
  }
  kit.parts ||= [];
  kit.updatedAt = new Date().toISOString();
  return kit;
}

app.post('/api/kits', wrap(async (req, res) => {
  const id = crypto.randomBytes(6).toString('hex');
  const kit = await library.store.mutate((data) => {
    data.kits[id] = { id, createdAt: new Date().toISOString(), ...cleanKit({ name: 'Untitled kit', ...req.body }) };
    return data.kits[id];
  });
  library.scheduleExports();
  res.json(kit);
}));

app.patch('/api/kits/:id', wrap(async (req, res) => {
  const kit = await library.store.mutate((data) => {
    const prev = data.kits[req.params.id];
    if (!prev) throw Object.assign(new Error('Kit not found'), { status: 404 });
    data.kits[req.params.id] = cleanKit(req.body, prev);
    return data.kits[req.params.id];
  });
  library.scheduleExports();
  res.json(kit);
}));

app.delete('/api/kits/:id', wrap(async (req, res) => {
  await library.store.mutate((data) => { delete data.kits[req.params.id]; });
  library.scheduleExports();
  res.json({ ok: true });
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
  writeExports(library.dataDir, library.store.list(), taste, library.store.listKits());
  res.json(taste);
}));

// ---- Settings ---------------------------------------------------------------

app.get('/api/settings', (_req, res) => res.json(publicConfig()));

app.post('/api/settings', wrap(async (req, res) => {
  const { libraryDir, apiKey, model, autoAnalyze, autoOrganize } = req.body;
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
  if (typeof autoOrganize === 'boolean') patch.autoOrganize = autoOrganize;
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
