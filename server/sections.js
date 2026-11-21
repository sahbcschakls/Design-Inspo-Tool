// The library's navigation model: sections (where a reference lives), facets (what
// a reference is good for borrowing) and media (what you can execute a style into).

export const SECTIONS = [
  { id: 'web', label: 'Web', folder: 'web', glyph: '◧', blurb: 'Sites, landing pages, dashboards and UI on big screens.' },
  { id: 'mobile', label: 'Mobile', folder: 'mobile', glyph: '▯', blurb: 'Apps, flows and components on small screens.' },
  { id: 'presentation', label: 'Presentation', folder: 'presentation', glyph: '▭', blurb: 'Decks, slides, pitch and keynote layouts.' },
  { id: 'illustration', label: 'Illustration', folder: 'illustration', glyph: '✿', blurb: 'Drawn, painted, 3D and iconographic image-making.' },
  { id: 'typography', label: 'Typography', folder: 'typography', glyph: 'Aa', blurb: 'Type specimens, lettering, pairings and hierarchy.' },
  { id: 'misc', label: 'Miscellaneous', folder: 'misc', glyph: '✳', blurb: 'Branding, posters, packaging, photography and everything else.' },
];
export const SECTION_IDS = SECTIONS.map((s) => s.id);
export const INBOX = '_inbox';

// Folder names people actually use, mapped to a section.
const FOLDER_ALIASES = {
  web: 'web', website: 'web', websites: 'web', sites: 'web', landing: 'web', dashboard: 'web', dashboards: 'web', ui: 'web',
  mobile: 'mobile', app: 'mobile', apps: 'mobile', ios: 'mobile', android: 'mobile',
  presentation: 'presentation', presentations: 'presentation', slides: 'presentation', deck: 'presentation', decks: 'presentation', ppt: 'presentation', keynote: 'presentation',
  illustration: 'illustration', illustrations: 'illustration', illo: 'illustration', icons: 'illustration', '3d': 'illustration',
  typography: 'typography', type: 'typography', typo: 'typography', fonts: 'typography', lettering: 'typography',
  misc: 'misc', miscellaneous: 'misc', other: 'misc', branding: 'misc', posters: 'misc',
};

const TYPE_TO_SECTION = {
  'Web Design': 'web', 'Landing Page': 'web', Dashboard: 'web', 'UI Component': 'web',
  'Mobile App': 'mobile',
  Presentation: 'presentation',
  Illustration: 'illustration', '3D': 'illustration', Iconography: 'illustration', Pattern: 'illustration',
  Typography: 'typography', Logo: 'misc',
};

export function sectionFromFolder(folder) {
  if (!folder) return null;
  return FOLDER_ALIASES[String(folder).toLowerCase().replace(/^\d+[-_. ]*/, '').trim()] || null;
}

// Explicit choice > folder the file sits in > what Claude thinks it is > misc.
// Files still in the inbox report "inbox" until they are filed.
export function sectionOf(style) {
  if (style.collection === INBOX && style.status !== 'ready') return 'inbox';
  if (SECTION_IDS.includes(style.section)) return style.section;
  return sectionFromFolder(style.collection) || TYPE_TO_SECTION[style.type] || 'misc';
}

export const FACETS = ['layout', 'typography', 'color', 'illustration', 'imagery', 'iconography', 'components', 'texture', 'motion', 'data-viz'];

export const MEDIA = ['figma', 'web', 'app', 'presentation', 'graphic', 'illustration'];

export const KIT_ROLES = ['primary', 'layout', 'typography', 'color', 'illustration', 'imagery', 'iconography', 'components', 'texture', 'motion'];
