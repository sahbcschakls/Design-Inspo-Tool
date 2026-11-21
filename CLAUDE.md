# Inspo: notes for Claude

- This repo is the Inspo app (Express server, MCP server, CLI, no-build front end). The user's actual library lives in the folder set by `INSPO_DIR` / `config.local.json`; run `node scripts/inspo.js where` to find it.
- For anything about the user's references, styles, kits, taste, or executing designs "in my style", follow the `inspo` skill in `.claude/skills/inspo/SKILL.md`.
- Shared logic lives in `server/` and is imported by `mcp/server.js` and `scripts/inspo.js`. Change behaviour there, not in three places.
- Sections, facets, media and kit roles are defined once in `server/sections.js`. Medium playbooks and token generation are in `server/playbooks.js`.
- Never hand-edit `<library>/.inspo/library.json`; use the API, MCP tools or the CLI so writes stay serialised.
- Run `npm start` and open http://localhost:4545 to see UI changes. The front end is plain ES modules in `public/`.
