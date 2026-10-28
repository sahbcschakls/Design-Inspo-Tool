// Turns styles and the taste profile into Markdown that Claude can act on directly.

const list = (items, bullet = '-') => (items || []).filter(Boolean).map((i) => `${bullet} ${i}`).join('\n');

export function styleColors(style) {
  if (style.colors?.length) return style.colors;
  return (style.localColors || []).map((c) => ({ hex: c.hex.toUpperCase(), name: '', role: `${Math.round(c.share * 100)}% of image` }));
}

export function styleToMarkdown(style, { level = 2 } = {}) {
  const h = '#'.repeat(level);
  const out = [];
  out.push(`${h} ${style.styleName || style.fileName}${style.type ? ` — ${style.type}` : ''}`);
  out.push(`Reference: \`${style.file}\` (id: ${style.id})`);
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

export function bundlePrompt(styles, { taste, task } = {}) {
  const parts = [];
  parts.push(
    styles.length === 1
      ? 'Design using the following visual style from my inspiration library. Treat it as the art direction: match its palette, typography, layout and details closely, but create something original — do not copy the reference literally.'
      : `Design using the following ${styles.length} visual styles from my inspiration library as art direction. Blend them coherently (the first is the primary direction unless I say otherwise); create something original rather than copying any reference literally.`
  );
  if (taste?.promptPreamble) parts.push(`\nMy general taste: ${taste.promptPreamble}`);
  parts.push('');
  styles.forEach((s) => parts.push(styleToMarkdown(s, { level: 2 }), ''));
  if (task) parts.push(`---\nTask: ${task}`);
  return parts.join('\n').trim() + '\n';
}
