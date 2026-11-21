// Execution playbooks: how to turn a style (or a kit of styles) into a finished
// deliverable in a given medium. These are appended to every execution brief so
// Claude knows not just *what it should look like* but *how to build it* there.

export const PLAYBOOKS = {
  figma: {
    label: 'Figma',
    verb: 'Design it in Figma',
    deliverable: 'A Figma page with named frames, auto-layout and local variables/styles.',
    steps: [
      'Create (or open) the target file and a page named after the task. Use the Figma MCP (`use_figma`, after loading the figma-use skill) when it is connected; otherwise output a frame-by-frame spec.',
      'Before drawing, create local variables from the TOKENS block: a `color` collection (one variable per palette entry, named by role), `type` text styles for each role in the type scale, and number variables for radius and spacing.',
      'Build every frame with auto-layout. Spacing and padding come from the spacing scale only; no magic numbers.',
      'Name layers semantically (Header / Hero / Card / CTA), group repeated items as components with variants, and keep one frame per screen or slide.',
      'Recreate signature details (grain, borders, shapes) as reusable components or effect styles, not one-off decorations.',
      'Finish with a screenshot check against the reference: palette proportions, type contrast and density should match the style.',
    ],
  },
  web: {
    label: 'Web / code',
    verb: 'Build it as a web page',
    deliverable: 'Production-ready HTML/CSS (or the project\'s framework) driven by design tokens.',
    steps: [
      'Paste the CSS custom properties from the TOKENS block into `:root` (or map them into the project\'s Tailwind/theme config) and use only those values.',
      'Load the free font alternatives from Google Fonts unless the project already licenses the originals.',
      'Lay out with CSS grid/flex following the layout notes; reproduce the spacing rhythm and the hierarchy (size contrast, weight, case, tracking).',
      'Implement signature details with CSS (borders, noise via SVG filter, gradients, blend modes) rather than images where possible.',
      'Respect the motion token: transitions and hover states should feel like the style, and honour `prefers-reduced-motion`.',
      'Make it responsive down to 360px and check contrast (WCAG AA) for every text/background pair you use.',
    ],
  },
  app: {
    label: 'Mobile app',
    verb: 'Design it as an app screen',
    deliverable: 'App screens (SwiftUI, React Native, Flutter or Figma frames at 390×844) built from tokens.',
    steps: [
      'Translate tokens into the platform theme: colours by role, a 5–7 step type scale, radius and spacing constants.',
      'Respect platform ergonomics: 44pt minimum touch targets, safe areas, thumb-reachable primary actions, native navigation patterns.',
      'Carry the style through components (buttons, cards, inputs, tab bar) rather than only the hero screen.',
      'Use the motion token for transitions and micro-interactions; keep them short (150–300ms).',
      'Deliver a small flow (3–5 screens) unless one screen is asked for, plus the empty and loading states.',
    ],
  },
  presentation: {
    label: 'Presentation',
    verb: 'Build it as a slide deck',
    deliverable: 'A 16:9 deck (Slides artifact, Google Slides or .pptx) with a consistent master and per-slide layouts.',
    steps: [
      'Set up the master first: 16:9 canvas, a 12-column grid with generous outer margins, background colour from the palette, footer/page-number treatment.',
      'Define the type scale for slides: display (60–96pt), title (36–48pt), body (18–24pt), caption (12–14pt) using the style\'s typefaces and treatments.',
      'Plan the narrative from the CONTENT: one idea per slide, title as a full-sentence takeaway, then choose a layout per slide (cover, section break, statement, two-column, image-led, data, quote, closing).',
      'Use the illustration/imagery direction for every visual so the deck feels drawn by one hand; reuse motifs across section breaks.',
      'Apply the palette by proportion (mostly background/neutral, one accent used sparingly for emphasis).',
      'Keep text short: no more than ~30 words on a content slide; move detail into speaker notes.',
      'Prefer the session\'s Slides artifact type when available; produce .pptx only when asked (use the pptx skill).',
    ],
  },
  graphic: {
    label: 'Graphic / social',
    verb: 'Make it as a graphic',
    deliverable: 'Posters, social posts, banners or ads exported as PNG/SVG at the requested sizes.',
    steps: [
      'Confirm the formats (e.g. 1080×1350 feed, 1080×1920 story, A3 poster) and design the largest first, then adapt.',
      'Build a strong focal point and hierarchy following the composition notes; type is image, not caption.',
      'Apply texture/effects from the tokens (grain, halftone, blur, duotone) consistently across every format.',
      'Use the canvas skill or HTML/SVG for vector output; use an image model only for photographic or painterly elements, guided by the imagery direction.',
      'Export each size and check legibility at thumbnail scale.',
    ],
  },
  illustration: {
    label: 'Illustration',
    verb: 'Draw it as an illustration',
    deliverable: 'Illustrations or spot art (SVG or generated image) matching the style\'s line, shape and colour language.',
    steps: [
      'Describe the visual language precisely: line weight and ending, shape vocabulary (geometric/organic), shading method, perspective, level of detail, character proportions.',
      'Restrict colour to the palette; note which colour is used for shadows and highlights.',
      'For vector work produce SVG (canvas skill); for painterly/3D work write an image-model prompt that includes the style\'s medium, texture and palette.',
      'Make a set, not a single image: keep stroke, scale and framing consistent so pieces sit together in a deck or site.',
    ],
  },
};

export function playbookMarkdown(medium) {
  const p = PLAYBOOKS[medium];
  if (!p) return '';
  return `## How to execute: ${p.label}\n**Deliverable:** ${p.deliverable}\n\n${p.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`;
}

// ---- Tokens ------------------------------------------------------------------

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function colorsOf(style) {
  if (style.colors?.length) return style.colors;
  return (style.localColors || []).map((c, i) => ({ hex: c.hex.toUpperCase(), name: `tone ${i + 1}`, role: '' }));
}

// Merges palettes and type from several styles into one token set. When a kit says
// "typography comes from B", B's fonts win the type slots, and so on.
export function buildTokens(parts) {
  const pick = (role) => parts.find((p) => p.role === role)?.style;
  const primary = pick('primary') || parts[0]?.style;
  const colorSrc = pick('color') || primary;
  const typeSrc = pick('typography') || primary;
  const shapeSrc = pick('components') || pick('layout') || primary;

  const colors = [];
  const used = new Set();
  for (const c of colorsOf(colorSrc || {})) {
    let name = slug(c.role || c.name) || `color-${colors.length + 1}`;
    if (used.has(name)) name = `${name}-${colors.length + 1}`;
    used.add(name);
    colors.push({ name, hex: c.hex, label: c.name, role: c.role });
  }
  const fonts = (typeSrc?.typography || []).map((t) => ({
    role: slug(t.role) || 'text',
    family: t.family,
    fallback: t.alternatives?.[0] || '',
    category: t.category,
    weight: t.weight,
    notes: t.notes,
  }));
  return { colors, fonts, shape: shapeSrc?.tokens || null, sources: { color: colorSrc?.styleName, type: typeSrc?.styleName, shape: shapeSrc?.styleName } };
}

export function tokensToCss(tokens) {
  const lines = [':root {'];
  for (const c of tokens.colors) lines.push(`  --color-${c.name}: ${c.hex};${c.label ? ` /* ${c.label} */` : ''}`);
  for (const f of tokens.fonts) {
    const generic = /serif/i.test(f.category) && !/sans/i.test(f.category) ? 'serif' : /mono/i.test(f.category) ? 'monospace' : 'sans-serif';
    const stack = [f.family, f.fallback].filter(Boolean).map((x) => `'${x}'`).join(', ');
    lines.push(`  --font-${f.role}: ${stack}, ${generic};`);
  }
  const t = tokens.shape;
  if (t) {
    if (t.cornerRadius) lines.push(`  /* radius: ${t.cornerRadius} */`);
    if (t.spacing) lines.push(`  /* spacing: ${t.spacing} */`);
    if (t.shadows) lines.push(`  /* shadows: ${t.shadows} */`);
  }
  lines.push('}');
  return lines.join('\n');
}

export function tokensToJson(tokens) {
  return JSON.stringify({
    color: Object.fromEntries(tokens.colors.map((c) => [c.name, { value: c.hex, description: c.label }])),
    font: Object.fromEntries(tokens.fonts.map((f) => [f.role, { value: f.family, fallback: f.fallback, weight: f.weight }])),
    shape: tokens.shape || {},
  }, null, 2);
}
