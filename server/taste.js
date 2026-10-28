// Library-wide statistics, the Claude-synthesised taste profile, and the Markdown
// files written into <folder>/.inspo/ so Claude Code can @-reference them.
import fs from 'node:fs';
import path from 'node:path';
import { styleColors, styleToMarkdown, tasteToMarkdown, bundlePrompt } from './prompts.js';
import { createClient, withFallback } from './claude.js';

function count(values) {
  const map = new Map();
  for (const v of values) {
    if (!v) continue;
    const key = String(v).trim();
    map.set(key, (map.get(key) || 0) + 1);
  }
  return [...map.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

export function computeStats(styles) {
  const analysed = styles.filter((s) => s.status === 'ready');
  const swatches = [];
  for (const s of styles) {
    styleColors(s).slice(0, 6).forEach((c, i) => swatches.push({ hex: c.hex.toUpperCase(), name: c.name, weight: 1 / (i + 1) }));
  }
  const palette = [];
  for (const c of swatches) {
    const [r, g, b] = rgb(c.hex);
    const twin = palette.find((p) => Math.hypot(p.r - r, p.g - g, p.b - b) < 36);
    if (twin) {
      twin.weight += c.weight;
      if (!twin.name && c.name) twin.name = c.name;
    } else palette.push({ hex: c.hex, name: c.name, r, g, b, weight: c.weight });
  }
  palette.sort((a, b) => b.weight - a.weight);

  return {
    total: styles.length,
    analysed: analysed.length,
    pending: styles.filter((s) => s.status === 'pending' || s.status === 'analyzing').length,
    pinned: styles.filter((s) => s.pinned).length,
    types: count(styles.map((s) => s.type)),
    collections: count(styles.map((s) => s.collection)),
    tags: count(styles.flatMap((s) => s.tags || [])),
    moods: count(styles.flatMap((s) => s.mood || [])),
    fonts: count(styles.flatMap((s) => (s.typography || []).map((t) => t.family))),
    palette: palette.slice(0, 16).map(({ hex, name, weight }) => ({ hex, name, weight: Math.round(weight * 100) / 100 })),
  };
}

const TASTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'signatureTraits', 'palette', 'typography', 'layout', 'alwaysDo', 'neverDo', 'promptPreamble'],
  properties: {
    headline: { type: 'string', description: 'A punchy 4–10 word line naming this person\'s taste.' },
    summary: { type: 'string', description: '80–140 words describing their aesthetic sensibility across the library.' },
    signatureTraits: { type: 'array', items: { type: 'string' }, description: '4–8 recurring traits.' },
    palette: { type: 'string', description: 'Their colour tendencies, with hex codes where useful.' },
    typography: { type: 'string', description: 'Their type tendencies and favoured pairings.' },
    layout: { type: 'string', description: 'Layout and composition tendencies.' },
    alwaysDo: { type: 'array', items: { type: 'string' }, description: '4–7 rules to always follow when designing for them.' },
    neverDo: { type: 'array', items: { type: 'string' }, description: '3–6 things they consistently avoid.' },
    promptPreamble: { type: 'string', description: 'A 60–120 word instruction to give any designer/AI before designing for this person.' },
  },
};

export async function synthesiseTaste(styles, config) {
  const analysed = styles.filter((s) => s.status === 'ready');
  if (analysed.length < 2) throw new Error('Analyse at least two references before building a taste profile.');
  const stats = computeStats(analysed);
  const digest = analysed
    .map((s) => `### ${s.styleName} (${s.type})${s.favorite ? ' ★ favourite' : ''}\n${s.description}\nTags: ${(s.tags || []).join(', ')} | Mood: ${(s.mood || []).join(', ')}\nColours: ${(s.colors || []).map((c) => c.hex).join(' ')}\nType: ${(s.typography || []).map((t) => `${t.family} (${t.role})`).join(', ')}\nPrinciples: ${(s.principles || []).join('; ')}${s.notes ? `\nUser notes: ${s.notes}` : ''}`)
    .join('\n\n');

  const client = createClient(config);
  const response = await client.beta.messages.create({
    model: config.model,
    max_tokens: 16000,
    ...withFallback(config.model),
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: TASTE_SCHEMA } },
    system: 'You are a perceptive creative director. You study a designer\'s curated inspiration library and articulate their personal taste so that future design work can match it without further explanation. Be specific and opinionated; prefer concrete, actionable observations over generic praise. Favourites signal stronger preference.',
    messages: [{
      role: 'user',
      content: `Here are the analysed references in my inspiration library (${analysed.length} items).\n\nAggregate stats: types ${stats.types.map((t) => `${t.name}×${t.count}`).join(', ')}; top keywords ${stats.tags.slice(0, 15).map((t) => t.name).join(', ')}; recurring colours ${stats.palette.slice(0, 10).map((c) => c.hex).join(' ')}.\n\n${digest}\n\nSynthesise my design taste.`,
    }],
  });
  if (response.stop_reason === 'refusal') throw new Error('Claude declined to build the taste profile.');
  const text = response.content.find((b) => b.type === 'text')?.text;
  if (!text) throw new Error(`No taste profile returned (stop reason: ${response.stop_reason}).`);
  return { ...JSON.parse(text), builtAt: new Date().toISOString(), basedOn: analysed.length, model: response.model };
}

const slug = (s) => String(s || 'style').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'style';

// Writes TASTE.md, ACTIVE.md and one Markdown file per style into <folder>/.inspo/.
export function writeExports(dataDir, styles, taste) {
  const stats = computeStats(styles);
  const exportDir = path.join(dataDir, 'styles');
  fs.mkdirSync(exportDir, { recursive: true });

  fs.writeFileSync(path.join(dataDir, 'TASTE.md'), tasteToMarkdown(taste, stats));

  const active = styles.filter((s) => s.pinned);
  fs.writeFileSync(
    path.join(dataDir, 'ACTIVE.md'),
    active.length
      ? bundlePrompt(active, { taste })
      : '# Active styles\n\nNo styles are active. Click "Add to Claude" on a card in the Inspo Library to activate one.\n'
  );

  const keep = new Set();
  for (const s of styles.filter((x) => x.status === 'ready')) {
    const name = `${slug(s.styleName)}-${s.id.slice(0, 6)}.md`;
    keep.add(name);
    fs.writeFileSync(path.join(exportDir, name), styleToMarkdown(s, { level: 1 }) + '\n');
  }
  for (const f of fs.readdirSync(exportDir)) {
    if (f.endsWith('.md') && !keep.has(f)) fs.rmSync(path.join(exportDir, f), { force: true });
  }
}
