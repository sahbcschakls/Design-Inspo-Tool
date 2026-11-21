# Inspo

A visual design library that also does the execution. Dump references into a folder (Pinterest saves, screenshots, websites, your own work). Each one becomes a **style**: palette, type, layout, tokens and do/avoid rules. Styles combine into **kits** aimed at a medium, and any kit or style turns into a finished deliverable (Figma frames, a web page, app screens, a slide deck, a poster, illustrations) once you add the content.

```
 _inbox/ ──▶ Claude reads it ──▶ style card, filed into a section ──▶ kits ──▶ "use my Pitch deck kit for this outline"
  + .md instructions        web · mobile · presentation · illustration · typography · misc        ──▶ finished deck / page / screen / graphic
```

## Quick start

Requires [Node.js 18.17+](https://nodejs.org).

```bash
npm install
cp .env.example .env          # set INSPO_DIR to your inspo folder (and optionally ANTHROPIC_API_KEY)
npm start                     # → http://localhost:4545
npm run skill:install         # makes the "inspo" skill available in every Claude Code project
```

Then connect the MCP server (the **Connect Claude** tab shows the exact command for your machine):

```bash
claude mcp add inspo --scope user -- node /absolute/path/to/this/repo/mcp/server.js
```

## The folder

On start the app creates this structure inside your inspo folder:

```
Inspo/
  _inbox/              ← dump anything here
    hero.png
    hero.md            ← optional: "url: https://…" + instructions ("take the illustration style only")
    links.txt          ← optional: one URL per line, "| instructions" after it
  web/  mobile/  presentation/  illustration/  typography/  misc/
  .inspo/              ← generated: library.json, INDEX.md, styles/, kits/, playbooks/, TASTE.md, ACTIVE.md
```

Once a reference in `_inbox` is analysed, it is filed into its section folder together with its instructions file. You can also save straight into a section folder, or drag images onto the app (they go into the section you're viewing, or the inbox).

## Three ways it gets processed

1. **In the app, automatically.** Add an Anthropic API key in Settings. New images are analysed as they arrive and filed out of the inbox.
2. **From Claude Code or Claude Desktop.** Say *"process my inspo inbox"*. The skill captures any links, reads each image and its instructions, saves the styles, files them, and suggests kits. No API key needed.
3. **By hand.** Edit any card in the app.

## Using it

- **Gallery.** Sections in the sidebar (number keys `0`–`6` jump between them). Each section opens with a hero built from that section's own palette. Filter by what's worth borrowing (typography, illustration, layout…), type, colour, mood or keyword. Cards tilt under the cursor; click one for the full art direction.
- **⌘K.** Jump to any style, kit, section or action.
- **Kits.** Combine styles with roles: *primary*, *layout*, *typography*, *color*, *illustration*, *imagery*, *iconography*, *components*, *texture*, *motion*. Example: "Pitch deck" = Forest Editorial Deck (primary) + Sunny Blob Spot Art (illustration) + Heavy Condensed Specimen (typography).
- **Execute.** On a kit, a style, or your active styles. Pick a medium, paste the content, and copy a brief that contains the art direction, merged design tokens (CSS variables / JSON) and a step-by-step playbook for that medium. In Claude Code you can skip the copying: *"use my Pitch deck kit to make slides from this outline"*.
- **Taste.** A profile of what you consistently like across the library, which Claude applies by default.

## Claude integration

| Piece | What it gives Claude |
| --- | --- |
| **Skill** (`.claude/skills/inspo`) | The workflow: ingest the inbox, file references, curate kits, execute per medium, self-check against the style. Active automatically inside this repo; `npm run skill:install` makes it global. |
| **MCP server** (`mcp/server.js`) | `get_execution_brief`, `list_kits`, `save_kit`, `search_styles` (by section/facet), `get_style`, `list_unanalyzed`, `save_style_analysis`, `get_design_brief`, `save_taste_profile`, `set_style_active` |
| **CLI** (`npm run inspo -- <cmd>`) | The same operations without MCP: `where`, `pending`, `save`, `search`, `kits`, `kit`, `brief`, `export` |
| **Markdown exports** (`.inspo/`) | `INDEX.md` (one line per style), `styles/*.md`, `kits/*.md`, `playbooks/*.md`, `TASTE.md`, `ACTIVE.md` for any tool that can read files |

Capturing links needs Playwright once: `npm i -D playwright && npx playwright install chromium`, then `npm run capture -- <url> "instructions"` (Pinterest pins save the pin image; other sites save a screenshot; add `--full` for a full-page shot).

## Hosting the web view (Vercel)

The app itself runs on your computer, because it reads and watches your folder. To browse the library from anywhere, publish a **read-only web view**: the same gallery, sections, search, ⌘K, kits and Execute, built from a snapshot of your library. Briefs and tokens are generated in the browser.

1. Import this repository at [vercel.com/new](https://vercel.com/new). `vercel.json` already sets the build (no settings to change, no environment variables). The first deploy shows demo data.
2. Publish your own library from your computer:

   ```bash
   npm run site:export      # snapshots INSPO_DIR into site/ (add --ready to skip unanalysed items)
   npm run site:preview     # optional: check it at http://localhost:4646
   git add site && git commit -m "Update inspo snapshot" && git push
   ```

   Every push redeploys automatically.

The snapshot contains your images (resized), style analyses, notes and kits, but no paths from your computer and no API key. A Vercel deployment is public unless you turn on **Deployment Protection** in the project settings, so do that if the library should stay private.

## Why a folder rather than Figma as the source of truth

The folder plus `library.json` is what Claude reads and writes reliably: plain files, versionable, readable without any connector. Figma is a better *output* than a database. Use the `figma` medium to execute kits into a Figma file, or ask Claude to lay out a kit as a moodboard page there. If you keep a Figma file of inspo, export frames into `_inbox/` and they join the library like anything else.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `INSPO_DIR` | `./library` | Your inspo folder (`~` supported) |
| `ANTHROPIC_API_KEY` | — | Enables automatic analysis in the app |
| `INSPO_MODEL` | `claude-opus-5-5` | Model for analysis and taste |
| `AUTO_ANALYZE` | `true` | Analyse new images as they arrive |
| `AUTO_ORGANIZE` | `true` | File analysed inbox items into their section folder |
| `PORT` | `4545` | Web UI port |

Settings saved in the app go to `config.local.json` (git-ignored). The server only listens on `127.0.0.1`. `sharp` (optional) provides thumbnails and colour extraction.

## Project layout

```
server/   index.js (API + SSE) · library.js (folder watcher) · organize.js (inbox + sidecars) · analyzer.js (Claude vision)
          sections.js (sections, facets, media, kit roles) · playbooks.js (per-medium execution + tokens)
          prompts.js (briefs, kits, index) · taste.js (stats, taste, exports) · schema.js · images.js · store.js · config.js
mcp/      server.js
scripts/  inspo.js (CLI) · capture.js (links → inbox) · install-skill.js · export-site.js / build-site.js / preview-site.js (web view)
site/     the published snapshot (data, thumbs, media) · vercel.json builds it into dist/
public/   index.html · styles.css · app.js (no build step)
.claude/skills/inspo/   SKILL.md · references/analysis-guide.md
```
