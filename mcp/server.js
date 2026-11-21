#!/usr/bin/env node
// MCP server: gives Claude Desktop / Claude Code direct access to the inspiration
// library, so it can apply your taste and active styles without you pasting anything.
// It also lets Claude analyse new references itself (no API key needed).
import path from 'node:path';
import fs from 'node:fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { TYPES, cleanAnalysis } from '../server/schema.js';
import { styleToMarkdown, tasteToMarkdown, bundlePrompt, kitToMarkdown } from '../server/prompts.js';
import { SECTION_IDS, FACETS, MEDIA, KIT_ROLES, INBOX, sectionOf } from '../server/sections.js';
import { PLAYBOOKS } from '../server/playbooks.js';
import { fileFromInbox } from '../server/organize.js';
import crypto from 'node:crypto';
import { computeStats, writeExports } from '../server/taste.js';
import { preview } from '../server/images.js';

const config = getConfig();
const store = new Store(config.dataDir);

const text = (t) => ({ type: 'text', text: t });
const ready = () => store.list().filter((s) => s.status === 'ready');
const filePath = (s) => path.join(config.libraryDir, s.file);
const thumbPath = (s) => path.join(config.dataDir, 'thumbs', `${s.id}.webp`);
const refreshExports = () => {
  try { writeExports(config.dataDir, store.list(), store.read().taste, store.listKits()); } catch { /* best effort */ }
};

async function imageBlock(style, maxEdge) {
  const img = await preview(filePath(style), thumbPath(style), maxEdge);
  return img ? { type: 'image', data: img.data, mimeType: img.mimeType } : null;
}

function findStyle(ref) {
  const styles = store.list();
  const q = String(ref || '').trim().toLowerCase();
  return (
    styles.find((s) => s.id === ref || s.id.startsWith(q)) ||
    styles.find((s) => (s.styleName || '').toLowerCase() === q) ||
    styles.find((s) => (s.styleName || '').toLowerCase().includes(q) || s.fileName.toLowerCase().includes(q))
  );
}

const oneLine = (s) =>
  `- [${s.id}] ${s.styleName || s.fileName} — ${sectionOf(s)} / ${s.type || 'unanalysed'}${s.facets?.length ? ` · borrow: ${s.facets.join(', ')}` : ''}${s.pinned ? ' (ACTIVE)' : ''}${s.favorite ? ' ★' : ''}${s.description ? `: ${s.description}` : ''}`;

const server = new McpServer(
  { name: 'inspo-library', version: '0.1.0' },
  {
    instructions: `This server holds the user's personal design inspiration library and their synthesised design taste.
Before doing any visual, UI, web, brand, slide or graphic design work for this user, call get_design_brief: it returns the styles the user has marked active plus their overall taste. Follow it as art direction unless the user says otherwise; never ask the user for references they have already curated here.
Use search_styles / get_style to pull in specific references by name or keyword (e.g. "use my brutalist poster style").
Kits combine several styles with roles (layout from A, typography from B…) for one medium. To execute any design task in Figma, web/code, an app, a presentation, a graphic or an illustration, call get_execution_brief with the kit or style ids, the medium and the user's content: it returns art direction, design tokens and a step-by-step playbook for that medium.
The library is sectioned into web, mobile, presentation, illustration, typography and misc; new references are dumped into _inbox (optionally with a same-named .md holding instructions/URL). If list_unanalyzed returns references, look at each and catalogue it with save_style_analysis (it is then filed into its section folder automatically).`,
  }
);

server.registerTool(
  'get_design_brief',
  {
    title: 'Get my design brief',
    description: 'Returns the user\'s active styles (the ones they tapped "Add to Claude" on) with full art direction, plus their overall design taste. Call this first for any design task.',
    inputSchema: {
      include_images: z.boolean().optional().describe('Attach previews of the active reference images (default true).'),
    },
  },
  async ({ include_images = true }) => {
    const data = store.read();
    const active = store.list().filter((s) => s.pinned);
    const content = [];
    if (active.length) {
      content.push(text(bundlePrompt(active, { taste: data.taste })));
      if (include_images) {
        for (const s of active.slice(0, 6)) {
          const img = await imageBlock(s, 1024);
          if (img) content.push(text(`Reference image for "${s.styleName || s.fileName}":`), img);
        }
      }
    } else {
      content.push(text('No styles are currently active. Use the overall taste below, or search_styles for a specific direction.'));
    }
    content.push(text(tasteToMarkdown(data.taste, computeStats(store.list()))));
    return { content };
  }
);

server.registerTool(
  'get_design_taste',
  {
    title: 'Get my design taste',
    description: 'Returns the user\'s synthesised taste profile across their whole inspiration library: signature traits, palette, typography, layout tendencies, always/never rules.',
    inputSchema: {},
  },
  async () => ({ content: [text(tasteToMarkdown(store.read().taste, computeStats(store.list())))] })
);

server.registerTool(
  'search_styles',
  {
    title: 'Search styles',
    description: 'Lists styles in the inspiration library, optionally filtered by keyword (matches name, tags, mood, description, colours, fonts), type, or collection folder.',
    inputSchema: {
      query: z.string().optional().describe('Keywords, e.g. "brutalist", "warm editorial", "#ff5a00", "serif".'),
      type: z.enum(TYPES).optional(),
      collection: z.string().optional().describe('Sub-folder name.'),
      section: z.enum([...SECTION_IDS, 'inbox']).optional().describe('Library section.'),
      facet: z.enum(FACETS).optional().describe('Only styles worth borrowing this aspect from.'),
      limit: z.number().int().min(1).max(100).optional(),
    },
  },
  async ({ query, type, collection, section, facet, limit = 30 }) => {
    const words = (query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const scored = store.list()
      .filter((s) => (!type || s.type === type) && (!collection || (s.collection || '').toLowerCase() === collection.toLowerCase()))
      .filter((s) => (!section || sectionOf(s) === section) && (!facet || (s.facets || []).includes(facet)))
      .map((s) => {
        const hay = [s.styleName, s.type, s.description, s.summary, s.fileName, s.collection, sectionOf(s), ...(s.facets || []), s.instructions, ...(s.tags || []), ...(s.mood || []),
          ...(s.colors || []).flatMap((c) => [c.hex, c.name]), ...(s.typography || []).map((t) => t.family), s.notes].join(' ').toLowerCase();
        const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
        return { s, score };
      })
      .filter(({ score }) => !words.length || score > 0)
      .sort((a, b) => b.score - a.score || Number(b.s.favorite) - Number(a.s.favorite))
      .slice(0, limit);
    if (!scored.length) return { content: [text('No matching styles.')] };
    return { content: [text(`${scored.length} style(s):\n${scored.map(({ s }) => oneLine(s)).join('\n')}\n\nUse get_style with an id for full art direction.`)] };
  }
);

server.registerTool(
  'get_style',
  {
    title: 'Get a style',
    description: 'Full art direction for one style (palette, typography, layout, tokens, do/avoid, prompt), with the reference image.',
    inputSchema: {
      id: z.string().describe('Style id, id prefix, or style name.'),
      include_image: z.boolean().optional().describe('Attach the reference image (default true).'),
    },
  },
  async ({ id, include_image = true }) => {
    const style = findStyle(id);
    if (!style) return { content: [text(`No style matches "${id}". Try search_styles.`)], isError: true };
    const content = [text(styleToMarkdown(style, { level: 1 }))];
    if (include_image) {
      const img = await imageBlock(style, 1400);
      if (img) content.push(img);
    }
    return { content };
  }
);

server.registerTool(
  'set_style_active',
  {
    title: 'Activate / deactivate a style',
    description: 'Adds a style to (or removes it from) the user\'s active set — the same as tapping "Add to Claude" in the library.',
    inputSchema: { id: z.string(), active: z.boolean() },
  },
  async ({ id, active }) => {
    const style = findStyle(id);
    if (!style) return { content: [text(`No style matches "${id}".`)], isError: true };
    await store.update(style.id, { pinned: active });
    refreshExports();
    return { content: [text(`${style.styleName || style.fileName} is now ${active ? 'active' : 'inactive'}.`)] };
  }
);

server.registerTool(
  'list_unanalyzed',
  {
    title: 'List unanalysed references',
    description: 'Returns references that have not been catalogued yet, with their images, so you can analyse them and call save_style_analysis for each.',
    inputSchema: { limit: z.number().int().min(1).max(10).optional().describe('How many to return (default 4).') },
  },
  async ({ limit = 4 }) => {
    const pending = store.list().filter((s) => s.status !== 'ready').slice(0, limit);
    const remaining = store.list().filter((s) => s.status !== 'ready').length;
    if (!pending.length) return { content: [text('Every reference is already analysed.')] };
    const content = [text(`${remaining} reference(s) need analysis. Showing ${pending.length}. For each, study the image and call save_style_analysis with its id. Sample real hex colours, identify typefaces (with free alternatives), and write a promptSnippet that lets someone design in this style without seeing the image.`)];
    for (const s of pending) {
      content.push(text(`id: ${s.id} — file: ${s.file}${s.instructions ? ` — curator instructions: ${s.instructions}` : ''}${s.sourceUrl ? ` — source: ${s.sourceUrl}` : ''}${s.notes ? ` — user notes: ${s.notes}` : ''}${s.localColors?.length ? ` — measured colours: ${s.localColors.map((c) => c.hex).join(' ')}` : ''}`));
      const img = await imageBlock(s, 1400);
      if (img) content.push(img);
    }
    return { content };
  }
);

const colorShape = z.object({ hex: z.string(), name: z.string(), role: z.string() });
const typeShape = z.object({
  family: z.string(), category: z.string(), role: z.string(), weight: z.string().optional(),
  notes: z.string().optional(), alternatives: z.array(z.string()).optional(),
});

server.registerTool(
  'save_style_analysis',
  {
    title: 'Save a style analysis',
    description: 'Stores your analysis of one reference in the library (shows up on its card immediately).',
    inputSchema: {
      id: z.string(),
      styleName: z.string().describe('Evocative 2–4 word style name, Title Case.'),
      type: z.enum(TYPES),
      section: z.enum(SECTION_IDS).describe('web, mobile, presentation, illustration, typography or misc.'),
      facets: z.array(z.enum(FACETS)).describe('1–4 aspects worth borrowing from this reference.'),
      bestFor: z.array(z.enum(MEDIA)).describe('1–4 media this style executes well in.'),
      description: z.string().describe('1–2 sentences, max ~35 words.'),
      summary: z.string().describe('60–120 word paragraph.'),
      tags: z.array(z.string()).describe('5–10 lowercase keywords.'),
      mood: z.array(z.string()).describe('2–5 single-word moods.'),
      colors: z.array(colorShape).describe('3–8 key colours, dominant first.'),
      typography: z.array(typeShape).describe('0–4 typefaces.'),
      layout: z.string(),
      composition: z.string(),
      visualElements: z.array(z.string()),
      tokens: z.object({
        cornerRadius: z.string(), spacing: z.string(), borders: z.string(),
        shadows: z.string(), texture: z.string(), motion: z.string(),
      }),
      principles: z.array(z.string()),
      doUse: z.array(z.string()),
      avoid: z.array(z.string()),
      promptSnippet: z.string().describe('80–160 word self-contained art direction for designing in this style.'),
    },
  },
  async ({ id, ...analysis }) => {
    const style = findStyle(id);
    if (!style) return { content: [text(`No reference with id "${id}".`)], isError: true };
    await store.update(style.id, {
      ...cleanAnalysis(analysis),
      status: 'ready',
      error: null,
      source: 'claude-mcp',
      analyzedAt: new Date().toISOString(),
    });
    let filed = null;
    if (config.autoOrganize && style.collection === INBOX) filed = await fileFromInbox({ libraryDir: config.libraryDir, store, id: style.id }).catch(() => null);
    refreshExports();
    const left = store.list().filter((s) => s.status !== 'ready').length;
    return { content: [text(`Saved "${analysis.styleName}"${filed ? ` and filed it to ${filed}` : ''}. ${left ? `${left} reference(s) still need analysis.` : 'All references are analysed.'}`)] };
  }
);

server.registerTool(
  'save_taste_profile',
  {
    title: 'Save my taste profile',
    description: 'Stores a synthesised taste profile. To build one: call search_styles and get_style (include_image false) across the library, look for recurring patterns, then save. Favourites (★) signal stronger preference.',
    inputSchema: {
      headline: z.string(),
      summary: z.string(),
      signatureTraits: z.array(z.string()),
      palette: z.string(),
      typography: z.string(),
      layout: z.string(),
      alwaysDo: z.array(z.string()),
      neverDo: z.array(z.string()),
      promptPreamble: z.string().describe('60–120 word instruction to give any designer before designing for this user.'),
    },
  },
  async (taste) => {
    await store.mutate((data) => {
      data.taste = { ...taste, builtAt: new Date().toISOString(), basedOn: ready().length, model: 'claude (via MCP)' };
    });
    refreshExports();
    return { content: [text('Taste profile saved.')] };
  }
);

server.registerTool(
  'list_kits',
  {
    title: 'List kits',
    description: 'Kits are named combinations of styles with roles (primary, layout, typography, color, illustration…) aimed at one medium — e.g. "Pitch deck": layout from one reference, illustrations from another. Lists them all.',
    inputSchema: {},
  },
  async () => {
    const kits = store.listKits();
    if (!kits.length) return { content: [text('No kits yet. Create one with save_kit, or in the Kits tab of the library.')] };
    const styles = store.list();
    return { content: [text(kits.map((k) => kitToMarkdown(k, styles)).join('\n---\n'))] };
  }
);

server.registerTool(
  'save_kit',
  {
    title: 'Create or update a kit',
    description: 'Creates a kit (omit id) or replaces an existing one. A kit bundles 1–12 styles, each with a role saying which aspect to take from it.',
    inputSchema: {
      id: z.string().optional(),
      name: z.string(),
      medium: z.enum(MEDIA).optional(),
      description: z.string().optional(),
      notes: z.string().optional().describe('Extra rules, e.g. "always one illustration per slide".'),
      parts: z.array(z.object({ style: z.string().describe('Style id, prefix or name'), role: z.enum(KIT_ROLES) })),
    },
  },
  async ({ id, name, medium, description = '', notes = '', parts }) => {
    const resolved = [];
    for (const p of parts) {
      const st = findStyle(p.style);
      if (!st) return { content: [text(`No style matches "${p.style}".`)], isError: true };
      resolved.push({ styleId: st.id, role: p.role });
    }
    const kit = await store.mutate((data) => {
      const kitId = id && data.kits[id] ? id : crypto.randomBytes(6).toString('hex');
      const prev = data.kits[kitId] || { createdAt: new Date().toISOString() };
      data.kits[kitId] = { ...prev, id: kitId, name, medium: medium || null, description, notes, parts: resolved, updatedAt: new Date().toISOString() };
      return data.kits[kitId];
    });
    refreshExports();
    return { content: [text(`Saved kit "${kit.name}" (id ${kit.id}).`)] };
  }
);

server.registerTool(
  'get_execution_brief',
  {
    title: 'Get an execution brief',
    description: 'The main "do the work" tool. Assembles everything needed to execute a design task in one medium: art direction from a kit or styles, merged design tokens (CSS variables), the medium playbook (Figma, web, app, presentation, graphic, illustration), the user\'s content and the reference images. Call it, then build the deliverable.',
    inputSchema: {
      kit: z.string().optional().describe('Kit id or name.'),
      styles: z.array(z.string()).optional().describe('Style ids or names (when not using a kit). Defaults to the active styles.'),
      medium: z.enum(MEDIA).optional().describe('Defaults to the kit\'s medium.'),
      content: z.string().optional().describe('The actual content to lay out: copy, outline, data, slide notes…'),
      task: z.string().optional().describe('Overrides the default task line.'),
      include_images: z.boolean().optional().describe('Attach reference images (default true).'),
    },
  },
  async ({ kit: kitRef, styles: refs, medium, content, task, include_images = true }) => {
    const data = store.read();
    let kit = null;
    let styles = [];
    if (kitRef) {
      const q = kitRef.toLowerCase();
      kit = Object.values(data.kits).find((k) => k.id === kitRef || k.name.toLowerCase() === q) || Object.values(data.kits).find((k) => k.name.toLowerCase().includes(q));
      if (!kit) return { content: [text(`No kit matches "${kitRef}". Try list_kits.`)], isError: true };
      styles = kit.parts.map((p) => data.styles[p.styleId]).filter(Boolean);
      medium ||= kit.medium || undefined;
    } else if (refs?.length) {
      for (const r of refs) {
        const st = findStyle(r);
        if (!st) return { content: [text(`No style matches "${r}".`)], isError: true };
        styles.push(st);
      }
    } else {
      styles = store.list().filter((s) => s.pinned);
    }
    if (!styles.length) return { content: [text('Nothing to execute: pass a kit or styles, or activate styles in the library.')], isError: true };
    const out = [text(bundlePrompt(styles, { taste: data.taste, medium, content, task, kit }))];
    if (include_images) {
      for (const s of styles.slice(0, 6)) {
        const img = await imageBlock(s, 1024);
        if (img) out.push(text(`Reference: "${s.styleName || s.fileName}"`), img);
      }
    }
    if (medium && !PLAYBOOKS[medium]) out.push(text(`(No playbook for "${medium}".)`));
    return { content: out };
  }
);

server.registerResource(
  'design-taste',
  'inspo://taste',
  { title: 'My design taste', description: 'Synthesised taste profile', mimeType: 'text/markdown' },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: tasteToMarkdown(store.read().taste, computeStats(store.list())) }] })
);

server.registerResource(
  'active-styles',
  'inspo://active',
  { title: 'Active styles', description: 'Styles marked "Add to Claude"', mimeType: 'text/markdown' },
  async (uri) => {
    const active = store.list().filter((s) => s.pinned);
    const body = active.length ? bundlePrompt(active, { taste: store.read().taste }) : 'No active styles.';
    return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text: body }] };
  }
);

server.registerPrompt(
  'design-with-my-taste',
  {
    title: 'Design with my taste',
    description: 'Starts a design task using your active styles and taste.',
    argsSchema: { task: z.string().describe('What to design') },
  },
  ({ task }) => {
    const active = store.list().filter((s) => s.pinned);
    const data = store.read();
    const brief = active.length ? bundlePrompt(active, { taste: data.taste, task }) : `${tasteToMarkdown(data.taste, computeStats(store.list()))}\n---\nTask: ${task}`;
    return { messages: [{ role: 'user', content: { type: 'text', text: brief } }] };
  }
);

if (!fs.existsSync(config.libraryDir)) {
  console.error(`[inspo-mcp] Library folder not found: ${config.libraryDir}`);
}
await server.connect(new StdioServerTransport());
console.error(`[inspo-mcp] serving ${config.libraryDir}`);
