// Config for the hosted read-only web view. Pure module (no Node or npm imports) so the
// static build can run without installing dependencies.
import { TYPES } from './schema.js';
import { SECTIONS, FACETS, MEDIA, KIT_ROLES, INBOX } from './sections.js';
import { PLAYBOOKS } from './playbooks.js';

const FOLDER = '<your inspo folder>';

export function staticConfig({ model = 'claude-opus-5-5', autoOrganize = true } = {}) {
  return {
    static: true,
    libraryDir: FOLDER,
    dataDir: `${FOLDER}/.inspo`,
    aiEnabled: false,
    hasApiKey: false,
    model,
    autoAnalyze: false,
    autoOrganize,
    sharp: true,
    types: TYPES,
    sections: SECTIONS,
    inbox: INBOX,
    facets: FACETS,
    media: MEDIA.map((id) => ({ id, label: PLAYBOOKS[id].label, verb: PLAYBOOKS[id].verb })),
    kitRoles: KIT_ROLES,
    skill: { project: '.claude/skills/inspo/SKILL.md', install: 'npm run skill:install' },
    mcp: { command: 'node', args: ['/path/to/inspo/mcp/server.js'], claudeCode: 'claude mcp add inspo --scope user -- node /path/to/inspo/mcp/server.js' },
    files: { taste: `${FOLDER}/.inspo/TASTE.md`, active: `${FOLDER}/.inspo/ACTIVE.md`, styles: `${FOLDER}/.inspo/styles`, index: `${FOLDER}/.inspo/INDEX.md`, kits: `${FOLDER}/.inspo/kits` },
  };
}

export const EMPTY_STATS = { total: 0, analysed: 0, pending: 0, pinned: 0, types: [], sections: [], facets: [], collections: [], tags: [], moods: [], fonts: [], palette: [] };
