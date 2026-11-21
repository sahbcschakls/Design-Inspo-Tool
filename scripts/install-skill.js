#!/usr/bin/env node
// Installs the inspo skill for every Claude Code project on this machine:
// copies .claude/skills/inspo to ~/.claude/skills/inspo and appends this machine's paths.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, getConfig } from '../server/config.js';
import { INBOX } from '../server/sections.js';

const src = path.join(ROOT, '.claude', 'skills', 'inspo');
const dest = path.join(os.homedir(), '.claude', 'skills', 'inspo');
fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });
const c = getConfig();
fs.appendFileSync(path.join(dest, 'SKILL.md'), `
## Paths on this machine (written by \`npm run skill:install\`)

- App (\`<app>\`): \`${ROOT}\`
- Library: \`${c.libraryDir}\`
- Inbox: \`${path.join(c.libraryDir, INBOX)}\`
- Generated files: \`${c.dataDir}\` (INDEX.md, styles/, kits/, playbooks/, TASTE.md)

Re-run \`npm run skill:install\` in the app folder if you move the library.
`);
console.log(`Installed the inspo skill to ${dest}`);
console.log('Restart Claude Code (or start a new session) to pick it up. Claude Desktop: zip that folder and add it under Settings → Capabilities → Skills.');
