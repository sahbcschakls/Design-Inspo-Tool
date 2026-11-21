# Running Inspo with Claude Cowork

Two downloads:

- **`inspo-tool.zip`**: the whole app (web gallery, MCP server, CLI, skill, scripts).
- **`inspo-skill.zip`**: just the `inspo` skill, ready to upload to Claude.

## 1 · Put the files in place (once)

1. Unzip `inspo-tool.zip` somewhere permanent, e.g. `~/Apps/Design-Inspo-Tool`.
2. Pick or create your inspo folder, e.g. `~/Pictures/Inspo`. This is where your references live.
3. In the Claude app go to **Settings → Capabilities → Skills → Upload skill** and choose `inspo-skill.zip`.

## 2 · Start a Cowork session

Give Cowork access to **both folders**, the app folder and your inspo folder, then paste this as your first message (edit the two paths):

```
Set up my Inspo design library.
App folder: ~/Apps/Design-Inspo-Tool
Inspo folder: ~/Pictures/Inspo

1. In the app folder run `npm install`, then create `.env` from `.env.example` with INSPO_DIR set to my inspo folder.
2. Run `node scripts/inspo.js where` and show me the paths.
3. Make sure my inspo folder has _inbox/ plus web/, mobile/, presentation/, illustration/, typography/ and misc/ (create any that are missing).
4. Then use the inspo skill to process my inbox: analyse each reference, follow any same-named .md instructions, save the styles, file them into their sections, and suggest kits.
```

After that, everyday requests are short:

- "Process my inspo inbox."
- "Find me typography I've saved for presentations."
- "Make a Pitch deck kit from Forest Editorial (primary), Sunny Blob (illustration) and Heavy Condensed (typography)."
- "Use my Pitch deck kit to build slides from this outline: …"

## 3 · See the visual gallery

Cowork works on files but doesn't show you web pages, so run the gallery yourself in a terminal in the app folder:

```bash
npm start
```

Then open http://localhost:4545. It updates live as Cowork adds styles and kits.

## Requirements and fallbacks

- **Node.js 18.17+** has to be available where the commands run. If Cowork can't run `npm install` or `node`, run steps 1–2 of the message yourself in a terminal, and Cowork can still work through the skill.
- **Automatic analysis without Cowork** (optional): put an Anthropic API key in `.env` (`ANTHROPIC_API_KEY=`). The gallery then analyses new references by itself as they arrive.
- **Links** (websites, Pinterest): put them in `_inbox/links.txt`, one per line. Capturing them needs Playwright once: `npm i -D playwright && npx playwright install chromium`.
- **Claude Desktop / Claude Code MCP** (optional, live tools instead of the CLI): `claude mcp add inspo --scope user -- node ~/Apps/Design-Inspo-Tool/mcp/server.js`
- **Hosted web view** (optional): `npm run site:export`, commit `site/`, push. See README.
