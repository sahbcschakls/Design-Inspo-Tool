#!/usr/bin/env node
// Command-line access to the library: the fallback the inspo skill uses when the
// MCP server is not connected. Shares all logic with the web app and MCP server.
//
//   node scripts/inspo.js where                      paths for this machine
//   node scripts/inspo.js pending                    references waiting for analysis (with file paths)
//   node scripts/inspo.js save <id> <analysis.json>  store an analysis (then files it out of _inbox)
//   node scripts/inspo.js search [words…] [--section web] [--facet typography]
//   node scripts/inspo.js kits                       list kits
//   node scripts/inspo.js kit <kit.json>             create/update a kit {id?, name, medium, parts:[{style, role}]}
//   node scripts/inspo.js brief [--kit name] [--styles id,id] [--medium presentation] [--content-file f.md]
//   node scripts/inspo.js export                     rewrite the Markdown exports in .inspo/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, getConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { cleanAnalysis } from '../server/schema.js';
import { bundlePrompt, kitToMarkdown } from '../server/prompts.js';
import { writeExports } from '../server/taste.js';
import { fileFromInbox, readSidecar } from '../server/organize.js';
import { isImage } from '../server/images.js';
import { sectionOf, INBOX, KIT_ROLES, MEDIA } from '../server/sections.js';

const config = getConfig();
const store = new Store(config.dataDir);
const [cmd, ...rest] = process.argv.slice(2);
const flags = {};
const args = [];
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i] ?? true;
  else args.push(rest[i]);
}
const exportsNow = () => writeExports(config.dataDir, store.list(), store.read().taste, store.listKits());
const die = (msg) => { console.error(msg); process.exit(1); };
const find = (ref) => {
  const q = String(ref).toLowerCase();
  const all = store.list();
  return all.find((s) => s.id === ref || s.id.startsWith(q)) || all.find((s) => (s.styleName || '').toLowerCase() === q) || all.find((s) => (s.styleName || s.fileName).toLowerCase().includes(q));
};

// Registers images sitting in _inbox that the app has not seen yet (it may not be running).
async function registerInbox() {
  const dir = path.join(config.libraryDir, INBOX);
  if (!fs.existsSync(dir)) return 0;
  const files = fs.readdirSync(dir).filter((f) => isImage(f));
  let added = 0;
  await store.mutate((data) => {
    for (const f of files) {
      const abs = path.join(dir, f);
      const id = crypto.createHash('sha1').update(fs.readFileSync(abs)).digest('hex').slice(0, 16);
      if (data.styles[id]) continue;
      const side = readSidecar(abs);
      data.styles[id] = { id, file: `${INBOX}/${f}`, fileName: f, collection: INBOX, status: 'pending', favorite: false, pinned: false, notes: '', tags: [], size: fs.statSync(abs).size, addedAt: new Date().toISOString(), missing: false, ...side };
      added++;
    }
  });
  return added;
}

switch (cmd) {
  case 'where': {
    console.log(JSON.stringify({ app: ROOT, library: config.libraryDir, inbox: path.join(config.libraryDir, INBOX), data: config.dataDir, index: path.join(config.dataDir, 'INDEX.md'), apiKey: config.aiEnabled, autoOrganize: config.autoOrganize }, null, 2));
    break;
  }
  case 'pending': {
    await registerInbox();
    const list = store.list().filter((s) => s.status !== 'ready');
    if (!list.length) { console.log('Nothing waiting. (Is the app running? It registers new files in the folder.)'); break; }
    for (const s of list) {
      console.log(`${s.id}  ${path.join(config.libraryDir, s.file)}${s.instructions ? `\n    instructions: ${s.instructions.replace(/\n/g, ' ')}` : ''}${s.sourceUrl ? `\n    source: ${s.sourceUrl}` : ''}${s.localColors?.length ? `\n    measured colours: ${s.localColors.map((c) => c.hex).join(' ')}` : ''}`);
    }
    break;
  }
  case 'save': {
    const [ref, file] = args;
    const style = find(ref || '') || die(`No reference matches "${ref}".`);
    const analysis = cleanAnalysis(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (!analysis.styleName) die('analysis.json needs at least styleName.');
    await store.update(style.id, { ...analysis, status: 'ready', error: null, source: 'claude-code', analyzedAt: new Date().toISOString() });
    const filed = config.autoOrganize && style.collection === INBOX ? await fileFromInbox({ libraryDir: config.libraryDir, store, id: style.id }) : null;
    exportsNow();
    console.log(`Saved "${analysis.styleName}"${filed ? ` → ${filed}` : ''}`);
    break;
  }
  case 'search': {
    const words = args.join(' ').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = store.list()
      .filter((s) => (!flags.section || sectionOf(s) === flags.section) && (!flags.facet || (s.facets || []).includes(flags.facet)))
      .map((s) => {
        const hay = [s.styleName, s.type, s.description, s.fileName, sectionOf(s), ...(s.facets || []), ...(s.tags || []), ...(s.mood || []), ...(s.colors || []).map((c) => c.hex), ...(s.typography || []).map((t) => t.family)].join(' ').toLowerCase();
        return { s, score: words.filter((w) => hay.includes(w)).length };
      })
      .filter((x) => !words.length || x.score)
      .sort((a, b) => b.score - a.score);
    for (const { s } of hits) console.log(`${s.id}  ${sectionOf(s).padEnd(12)} ${s.styleName || s.fileName}${s.facets?.length ? `  [${s.facets.join(', ')}]` : ''}`);
    if (!hits.length) console.log('No matches.');
    break;
  }
  case 'kits': {
    const kits = store.listKits();
    console.log(kits.length ? kits.map((k) => kitToMarkdown(k, store.list())).join('\n---\n') : 'No kits yet.');
    break;
  }
  case 'kit': {
    const body = JSON.parse(fs.readFileSync(args[0], 'utf8'));
    const parts = (body.parts || []).map((p) => {
      const s = find(p.style || p.styleId) || die(`No style matches "${p.style || p.styleId}".`);
      return { styleId: s.id, role: KIT_ROLES.includes(p.role) ? p.role : 'primary' };
    });
    const kit = await store.mutate((data) => {
      const id = body.id && data.kits[body.id] ? body.id : crypto.randomBytes(6).toString('hex');
      data.kits[id] = { createdAt: new Date().toISOString(), ...data.kits[id], id, name: body.name || 'Untitled kit', medium: MEDIA.includes(body.medium) ? body.medium : null, description: body.description || '', notes: body.notes || '', parts, updatedAt: new Date().toISOString() };
      return data.kits[id];
    });
    exportsNow();
    console.log(`Saved kit "${kit.name}" (${kit.id})`);
    break;
  }
  case 'brief': {
    const data = store.read();
    let kit = null;
    let styles;
    if (flags.kit) {
      const q = String(flags.kit).toLowerCase();
      kit = Object.values(data.kits).find((k) => k.id === flags.kit || k.name.toLowerCase().includes(q)) || die(`No kit matches "${flags.kit}".`);
      styles = kit.parts.map((p) => data.styles[p.styleId]).filter(Boolean);
    } else if (flags.styles) {
      styles = String(flags.styles).split(',').map((r) => find(r.trim()) || die(`No style matches "${r}".`));
    } else styles = store.list().filter((s) => s.pinned);
    if (!styles.length) die('Nothing to brief: pass --kit or --styles, or activate styles in the app.');
    const content = flags['content-file'] ? fs.readFileSync(flags['content-file'], 'utf8') : flags.content;
    console.log(bundlePrompt(styles, { taste: data.taste, kit, medium: flags.medium || kit?.medium, content, task: flags.task }));
    console.log('\nReference images:\n' + styles.map((s) => `- ${path.join(config.libraryDir, s.file)}`).join('\n'));
    break;
  }
  case 'export': exportsNow(); console.log(`Exports written to ${config.dataDir}`); break;
  default:
    console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).map((l) => l.slice(3)).join('\n'));
}
