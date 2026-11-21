// Turns styles, kits and the taste profile into Markdown that Claude can act on directly.
import { sectionOf, SECTIONS } from './sections.js';
import { PLAYBOOKS, playbookMarkdown, buildTokens, tokensToCss } from './playbooks.js';

const list = (items, bullet = '-') => (items || []).filter(Boolean).map((i) => `${bullet} ${i}`).join('\n');

export function styleColors(style) {
  if (style.colors?.length) return style.colors;
  return (style.localColors || []).map((c) => ({ hex: c.hex.toUpperCase(), name: '', role: `${Math.round(c.share * 100)}% of image` }));
}

export function styleToMarkdown(style, { level = 2 } = {}) {
  const h = '#'.repeat(level);
  const out = [];
  out.push(`${h} ${style.styleName || style.fileName}${style.type ? ` — ${style.type}` : ''}`);
  out.push(`Reference: \`${style.file}\` (id: ${style.id}) · section: ${sectionOf(style)}${style.facets?.length ? ` · borrow its: ${style.facets.join(', ')}` : ''}${style.bestFor?.length ? ` · best for: ${style.bestFor.join(', ')}` : ''}`);
  if (style.sourceUrl) out.push(`Source: ${style.sourceUrl}`);
  if (style.description) out.push(`\n${style.description}`);
  if (style.summary) out.push(`\n${style.summary}`);

  const colors = styleColors(style);
  if (colors.length) {
    out.push(`\n**Palette**`);
    out.push(colors.map((c) => `- ${c.hex}${c.name ? ` ${c.name}` : ''}${c.role ? ` — ${c.role}` : ''}`).join('\n'));
  }
  if (style.typography?.length) {
    out.push(`\n**Typography**`);
    out.push(
      style.typography
        .map((t) => {
          const alts = t.alternatives?.length ? ` (free alternatives: ${t.alternatives.join(', ')})` : '';
          return `- ${t.role ? `${t.role}: ` : ''}${t.family}${t.category ? `, ${t.category}` : ''}${t.weight ? `, ${t.weight}` : ''}${t.notes ? ` — ${t.notes}` : ''}${alts}`;
        })
        .join('\n')
    );
  }
  if (style.layout) out.push(`\n**Layout:** ${style.layout}`);
  if (style.composition) out.push(`**Composition:** ${style.composition}`);
  if (style.tokens) {
    const t = style.tokens;
    const pairs = [['Corners', t.cornerRadius], ['Spacing', t.spacing], ['Borders', t.borders], ['Shadows', t.shadows], ['Texture', t.texture], ['Motion', t.motion]]
      .filter(([, v]) => v && v !== 'n/a');
    if (pairs.length) out.push(`**Tokens:** ${pairs.map(([k, v]) => `${k}: ${v}`).join(' · ')}`);
  }
  if (style.visualElements?.length) out.push(`\n**Signature details**\n${list(style.visualElements)}`);
  if (style.principles?.length) out.push(`\n**Principles**\n${list(style.principles)}`);
  if (style.doUse?.length) out.push(`\n**Do**\n${list(style.doUse)}`);
  if (style.avoid?.length) out.push(`\n**Avoid**\n${list(style.avoid)}`);
  if (style.mood?.length || style.tags?.length) out.push(`\n**Mood / tags:** ${[...(style.mood || []), ...(style.tags || [])].join(', ')}`);
  if (style.instructions) out.push(`\n**Curator instructions:** ${style.instructions}`);
  if (style.notes) out.push(`\n**My notes:** ${style.notes}`);
  if (style.promptSnippet) out.push(`\n**Direction**\n${style.promptSnippet}`);
  return out.join('\n');
}

export function tasteToMarkdown(taste, stats) {
  const out = ['# My design taste', ''];
  if (taste?.headline) out.push(`**${taste.headline}**`, '');
  if (taste?.summary) out.push(taste.summary, '');
  if (taste?.signatureTraits?.length) out.push('## Signature traits', list(taste.signatureTraits), '');
  if (taste?.palette || stats?.palette?.length) out.push('## Colour');
  if (taste?.palette) out.push(taste.palette, '');
  if (stats?.palette?.length) out.push(stats.palette.slice(0, 10).map((c) => `- ${c.hex}${c.name ? ` ${c.name}` : ''}`).join('\n'), '');
  if (taste?.typography) out.push('## Typography', taste.typography, '');
  if (stats?.fonts?.length) out.push(`Recurring typefaces: ${stats.fonts.slice(0, 8).map((f) => f.name).join(', ')}`, '');
  if (taste?.layout) out.push('## Layout & composition', taste.layout, '');
  if (taste?.alwaysDo?.length) out.push('## Always', list(taste.alwaysDo), '');
  if (taste?.neverDo?.length) out.push('## Never', list(taste.neverDo), '');
  if (stats) {
    const top = (arr) => arr.slice(0, 8).map((x) => `${x.name} (${x.count})`).join(', ');
    out.push('## Library at a glance');
    out.push(`- ${stats.total} references (${stats.analysed} analysed)`);
    if (stats.types.length) out.push(`- Types: ${top(stats.types)}`);
    if (stats.moods.length) out.push(`- Moods: ${top(stats.moods)}`);
    if (stats.tags.length) out.push(`- Keywords: ${top(stats.tags)}`);
    out.push('');
  }
  if (taste?.promptPreamble) out.push('## How to design for me', taste.promptPreamble, '');
  if (!taste) out.push('_No synthesised taste profile yet — rebuild it from the Taste tab once a few references are analysed._');
  return out.join('\n').trim() + '\n';
}

export function bundlePrompt(styles, { taste, task, medium, content, kit } = {}) {
  const parts = [];
  if (kit) {
    parts.push(`# Execution brief — kit "${kit.name}"`);
    if (kit.description) parts.push(kit.description);
    parts.push('Use this kit as the art direction. Each style below has a ROLE: take that aspect from it (e.g. "typography" means use its type system, not its colours). The primary style decides anything not covered by a role. Create something original; never copy a reference literally.');
    if (kit.notes) parts.push(`\n**Kit rules:** ${kit.notes}`);
  } else {
    parts.push(
      styles.length === 1
        ? 'Design using the following visual style from my inspiration library. Treat it as the art direction: match its palette, typography, layout and details closely, but create something original — do not copy the reference literally.'
        : `Design using the following ${styles.length} visual styles from my inspiration library as art direction. Blend them coherently (the first is the primary direction unless I say otherwise); create something original rather than copying any reference literally.`
    );
  }
  if (taste?.promptPreamble) parts.push(`\nMy general taste: ${taste.promptPreamble}`);
  parts.push('');
  const roles = kit ? new Map(kit.parts.map((p) => [p.styleId, p.role])) : null;
  styles.forEach((s) => {
    if (roles) parts.push(`> ROLE: **${roles.get(s.id) || 'primary'}**`);
    parts.push(styleToMarkdown(s, { level: 2 }), '');
  });
  if (medium || kit) {
    const tokens = buildTokens(styles.map((s) => ({ style: s, role: roles?.get(s.id) || null })));
    if (tokens.colors.length || tokens.fonts.length) {
      parts.push('## TOKENS', 'Use these values verbatim (map them to Figma variables, Tailwind theme, platform theme, or slide master as the medium requires).', '```css', tokensToCss(tokens), '```', '');
    }
  }
  if (medium && PLAYBOOKS[medium]) parts.push(playbookMarkdown(medium), '');
  if (content) parts.push('## CONTENT', content.trim(), '');
  if (task) parts.push(`---\nTask: ${task}`);
  else if (medium) parts.push(`---\nTask: ${PLAYBOOKS[medium].verb} using the CONTENT above${content ? '' : ' (ask me for the content if it is missing)'}. Follow the playbook; deliver the finished thing, not a plan.`);
  return parts.join('\n').trim() + '\n';
}

export function kitToMarkdown(kit, styles) {
  const byId = new Map(styles.map((s) => [s.id, s]));
  const out = [`# Kit: ${kit.name}`, ''];
  out.push(`Medium: ${PLAYBOOKS[kit.medium]?.label || kit.medium || 'any'} · id: ${kit.id}`);
  if (kit.description) out.push('', kit.description);
  if (kit.notes) out.push('', `**Rules:** ${kit.notes}`);
  out.push('', '## Parts');
  for (const p of kit.parts) {
    const s = byId.get(p.styleId);
    out.push(`- **${p.role}** ← ${s ? `${s.styleName || s.fileName} (id ${s.id})` : `missing style ${p.styleId}`}`);
  }
  out.push('', 'To execute: ask Claude to "use my <kit name> kit for <task>" — the inspo skill / MCP `get_execution_brief` assembles the full brief with tokens and the medium playbook.');
  return out.join('\n') + '\n';
}

// A compact catalogue of the whole library, one line per style. The skill greps this
// when the MCP server is not connected.
export function indexMarkdown(styles, kits = []) {
  const out = ['# Inspo library index', '', `${styles.length} references · ${kits.length} kits · generated ${new Date().toISOString()}`, ''];
  out.push('Each style has a full file in `styles/`; each kit in `kits/`; medium playbooks in `playbooks/`.', '');
  for (const sec of [{ id: 'inbox', label: 'Inbox (unfiled)' }, ...SECTIONS]) {
    const list = styles.filter((s) => sectionOf(s) === sec.id);
    if (!list.length) continue;
    out.push(`## ${sec.label} (${list.length})`);
    for (const s of list) {
      out.push(`- ${s.styleName || s.fileName} [${s.id}] — ${s.type || 'unanalysed'}${s.facets?.length ? ` · facets: ${s.facets.join(', ')}` : ''}${s.tags?.length ? ` · tags: ${s.tags.join(', ')}` : ''}${s.favorite ? ' ★' : ''}${s.pinned ? ' (ACTIVE)' : ''}`);
    }
    out.push('');
  }
  if (kits.length) {
    out.push('## Kits');
    for (const k of kits) out.push(`- ${k.name} [${k.id}] — ${k.medium || 'any medium'} · ${k.parts.length} styles${k.description ? ` · ${k.description}` : ''}`);
    out.push('');
  }
  return out.join('\n');
}
