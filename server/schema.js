// The shape of one analysed reference. Used for Claude's structured output,
// the MCP save tool, and for validating edits from the UI.

export const TYPES = [
  'Web Design', 'Landing Page', 'Mobile App', 'Dashboard', 'UI Component',
  'Branding', 'Logo', 'Typography', 'Poster', 'Editorial', 'Packaging',
  'Illustration', 'Photography', '3D', 'Motion', 'Iconography', 'Pattern', 'Other',
];

const str = (description) => ({ type: 'string', description });
const strList = (description) => ({ type: 'array', items: { type: 'string' }, description });

export const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'styleName', 'type', 'description', 'summary', 'tags', 'mood', 'colors', 'typography',
    'layout', 'composition', 'visualElements', 'tokens', 'principles', 'doUse', 'avoid', 'promptSnippet',
  ],
  properties: {
    styleName: str('An evocative, specific 2–4 word name for this visual style, e.g. "Swiss Grid Brutalism", "Soft Chrome Y2K", "Quiet Luxury Editorial". Title Case.'),
    type: { type: 'string', enum: TYPES, description: 'What kind of design artefact this is.' },
    description: str('One or two sentences (max ~35 words) capturing what makes this reference distinctive.'),
    summary: str('A richer paragraph (60–120 words) explaining the style, its feel, and why it works.'),
    tags: strList('5–10 lowercase style keywords, e.g. "brutalist", "grain", "monochrome", "oversized type".'),
    mood: strList('2–5 single-word moods, e.g. "confident", "playful", "calm".'),
    colors: {
      type: 'array',
      description: '3–8 key colours, most dominant first.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['hex', 'name', 'role'],
        properties: {
          hex: str('Hex colour, e.g. #1A1A1A'),
          name: str('Short evocative colour name, e.g. "Ink", "Tomato".'),
          role: str('How it is used: background, surface, text, primary, accent, highlight, border…'),
        },
      },
    },
    typography: {
      type: 'array',
      description: 'Typefaces visible (0–4). Empty array if there is no text.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['family', 'category', 'role', 'weight', 'notes', 'alternatives'],
        properties: {
          family: str('Best identification of the typeface (or closest match).'),
          category: str('serif, sans-serif, monospace, display, script, slab…'),
          role: str('headline, body, caption, UI, logo…'),
          weight: str('e.g. "Light 300", "Black 900", "Regular + Bold".'),
          notes: str('Treatment: tracking, case, size contrast, italics, etc.'),
          alternatives: strList('1–3 freely available (e.g. Google Fonts) alternatives.'),
        },
      },
    },
    layout: str('Grid, structure, spacing rhythm and hierarchy.'),
    composition: str('Balance, focal points, imagery treatment, use of negative space.'),
    visualElements: strList('Signature details: textures, borders, shapes, effects, imagery, iconography.'),
    tokens: {
      type: 'object',
      additionalProperties: false,
      required: ['cornerRadius', 'spacing', 'borders', 'shadows', 'texture', 'motion'],
      properties: {
        cornerRadius: str('e.g. "0px sharp", "pill 999px", "soft 12–16px".'),
        spacing: str('Density and spacing scale.'),
        borders: str('Border treatment.'),
        shadows: str('Elevation and shadow treatment.'),
        texture: str('Grain, gradients, noise, flat…'),
        motion: str('Implied motion/interaction feel, or "n/a".'),
      },
    },
    principles: strList('3–6 design principles that define this style.'),
    doUse: strList('3–6 concrete things to do when designing in this style.'),
    avoid: strList('3–5 things that would break this style.'),
    promptSnippet: str('A self-contained instruction (80–160 words) addressed to a designer or AI, describing how to design something new in this exact style: palette with hex codes, type pairing, layout, details, and mood. Do not mention "the image" or "the reference".'),
  },
};

const asString = (v, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const asList = (v, max = 20) => (Array.isArray(v) ? v.map((x) => asString(String(x), 200)).filter(Boolean).slice(0, max) : []);
const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normaliseHex(hex) {
  const m = String(hex || '').trim().match(HEX);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return `#${h.toUpperCase()}`;
}

// Cleans an analysis object from Claude or from a user edit. Only known keys pass.
export function cleanAnalysis(input = {}) {
  const out = {};
  if ('styleName' in input) out.styleName = asString(input.styleName, 80);
  if ('type' in input) out.type = TYPES.includes(input.type) ? input.type : asString(input.type, 40) || 'Other';
  for (const key of ['description', 'summary', 'layout', 'composition', 'promptSnippet', 'notes']) {
    if (key in input) out[key] = asString(input[key], key === 'description' ? 400 : 4000);
  }
  for (const key of ['visualElements', 'principles', 'doUse', 'avoid']) {
    if (key in input) out[key] = asList(input[key]);
  }
  if ('tags' in input) out.tags = asList(input.tags).map((t) => t.toLowerCase());
  if ('mood' in input) out.mood = asList(input.mood, 8).map((t) => t.toLowerCase());
  if ('colors' in input && Array.isArray(input.colors)) {
    out.colors = input.colors
      .map((c) => ({ hex: normaliseHex(c?.hex), name: asString(c?.name, 40), role: asString(c?.role, 40) }))
      .filter((c) => c.hex)
      .slice(0, 12);
  }
  if ('typography' in input && Array.isArray(input.typography)) {
    out.typography = input.typography
      .map((t) => ({
        family: asString(t?.family, 80),
        category: asString(t?.category, 40),
        role: asString(t?.role, 40),
        weight: asString(t?.weight, 60),
        notes: asString(t?.notes, 400),
        alternatives: asList(t?.alternatives, 4),
      }))
      .filter((t) => t.family)
      .slice(0, 6);
  }
  if ('tokens' in input && input.tokens && typeof input.tokens === 'object') {
    out.tokens = {};
    for (const key of ['cornerRadius', 'spacing', 'borders', 'shadows', 'texture', 'motion']) {
      out.tokens[key] = asString(input.tokens[key], 200);
    }
  }
  return out;
}
