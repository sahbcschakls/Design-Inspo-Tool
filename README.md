# Inspo Library

A local inspiration library for your design references. Point it at a folder on your computer and drop images in. Each one becomes a catalogued **style card**: style name, type, short description, colour palette, typography, layout notes, design tokens and do/avoid rules. Claude then builds a **taste profile** from the whole library.

The main feature is the **Add to Claude** button. Tap it on any card and that style becomes live art direction for Claude through MCP. After that you can ask Claude for “a pricing page” and it already knows how you want it to look. You don't need to paste references or explain your taste.

```
 your folder ──watch──▶ Inspo Library (localhost:4545) ──MCP──▶ Claude Desktop / Claude Code
  └─ drop images          cards · filters · taste · tray          get_design_brief, search_styles…
```

## Quick start

Requirements: [Node.js 18.17+](https://nodejs.org).

```bash
git clone <this repo> inspo-library
cd inspo-library
npm install
cp .env.example .env      # then edit INSPO_DIR (and optionally ANTHROPIC_API_KEY)
npm start
```

Open **http://localhost:4545**. You can also change the folder and API key later in **Settings** inside the app.

## Adding references

You can add references in any of these ways:

- **Save images into your folder.** Sub-folders become **collections** (e.g. `Inspo/Web`, `Inspo/Posters`).
- **Drag and drop** images anywhere on the page, **paste** a screenshot (Ctrl/⌘+V), or click **＋ Add references**.

Supported formats are JPG, PNG, WebP, GIF, AVIF, SVG, TIFF and HEIC. Images are identified by their content, so renaming or moving a file inside the folder keeps its analysis, and an exact duplicate is skipped.

## How references get analysed

There are two options. Use whichever suits you:

1. **Automatically, with an API key.** Add an Anthropic API key in Settings (or `ANTHROPIC_API_KEY` in `.env`). Every new image is sent to Claude, which returns a structured style analysis. The default model is Claude Opus 5.5, and you can switch models in Settings. Requests use server-side refusal fallback (`fallbacks: "default"`), so a rare safety decline is retried on a fallback model instead of failing.
2. **Through Claude Desktop or Claude Code, with no API key.** Connect the MCP server (below) and say *“analyse my new references and save them to my inspo library”*. Claude looks at each image and saves the analysis itself.

You can also edit any card by hand: name, type, colours, fonts, keywords and prompt.

## Connecting Claude (MCP)

The **Connect Claude** tab inside the app shows these commands with the exact paths for your machine, ready to copy.

**Claude Desktop:** go to Settings → Developer → Edit Config and add:

```json
{
  "mcpServers": {
    "inspo": {
      "command": "node",
      "args": ["/absolute/path/to/inspo-library/mcp/server.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add inspo --scope user -- node /absolute/path/to/inspo-library/mcp/server.js
```

Restart Claude. The server tells Claude to call `get_design_brief` before any design work.

| Tool | What it does |
| --- | --- |
| `get_design_brief` | Returns your active styles (the ones you pressed **Add to Claude** on) with images, plus your taste profile |
| `get_design_taste` | Returns the synthesised taste profile |
| `search_styles` / `get_style` | Find a style by keyword, colour, font, type or collection and pull its full art direction plus image |
| `set_style_active` | Activate or deactivate a style from the chat |
| `list_unanalyzed` / `save_style_analysis` | Let Claude catalogue new references without an API key |
| `save_taste_profile` | Let Claude write your taste profile without an API key |

Resources `inspo://taste` and `inspo://active`, and the prompt `design-with-my-taste`, are also available.

**Without MCP:** **Add to Claude** also copies the full brief to your clipboard, so you can paste it into claude.ai or any other tool. The library also keeps Markdown files up to date in `<folder>/.inspo/`:

- `TASTE.md`: your taste profile
- `ACTIVE.md`: the brief for your currently active styles
- `styles/*.md`: one file per style

In Claude Code you can reference these directly, e.g. `@~/Pictures/Inspo/.inspo/ACTIVE.md`.

## The app

- **Library:** a masonry grid of cards showing the image, catalogue number, type, style name, description, palette (click a swatch to copy its hex), typography, keywords, **Add to Claude** and copy-prompt buttons. You can sort by newest, oldest, name, type, recently analysed, favourites or colour, and filter by collection, type, colour family, mood, keyword, favourites, active styles, or references still needing analysis. Search covers names, tags, hex codes and fonts. Card size has S, M and L options.
- **Detail view:** click a card to see the full image (zoomable) with an overview, palette, a typography specimen (loads Google Fonts alternatives), layout and composition notes, tokens, signature details, principles, do/avoid, the prompt, and your own notes (Claude sees these too). From here you can edit, re-analyse, show the file in its folder, or remove it (the file is moved to `.inspo/trash`, never deleted). Use ← → to step through cards.
- **Taste:** shows your recurring palette, signature traits, colour, type and layout tendencies, always/never rules, what you collect, and your vocabulary.
- **Tray:** when styles are active, a floating bar shows them with **Copy brief** and **Clear** buttons.
- Light and dark themes, live updates when the folder changes, and it works on phone-sized screens.

## Where data lives

Everything stays on your computer:

- `<folder>/.inspo/library.json` holds all analysis and metadata. It travels with the folder.
- `<folder>/.inspo/thumbs/` holds the generated thumbnails.
- `config.local.json` (in this project) holds settings saved from the app, including your API key. It is git-ignored.

The web server only listens on `127.0.0.1`.

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `INSPO_DIR` | `./library` | Your references folder (`~` is supported) |
| `ANTHROPIC_API_KEY` | — | Enables automatic analysis |
| `INSPO_MODEL` | `claude-opus-5-5` | Model used for analysis and taste |
| `AUTO_ANALYZE` | `true` | Analyse new images as they arrive |
| `PORT` | `4545` | Web UI port |

`sharp` is an optional dependency used for thumbnails, colour extraction and resizing. If it fails to install on your platform the app still runs. It just serves original images and skips the local colour extraction.

## Project layout

```
server/   index.js (HTTP API + SSE) · library.js (folder watcher) · analyzer.js (Claude vision)
          taste.js (stats, taste synthesis, Markdown exports) · prompts.js · schema.js · images.js · store.js
mcp/      server.js (MCP server for Claude Desktop / Claude Code)
public/   index.html · styles.css · app.js (no build step)
```
