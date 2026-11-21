---
name: inspo
description: The user's personal design inspiration library ("inspo"), a visual guide of curated styles, kits and taste. Use it whenever the user (1) drops new references or links into their inspo folder / _inbox and wants them processed, catalogued or turned into styles, (2) asks to search or browse their inspo, styles, kits or taste, (3) asks to build anything visual "in my style", "using my inspo", "with my <name> kit/style", or names a style or kit — slides/decks/presentations, Figma designs, web pages, apps, posters, social graphics, illustrations — or (4) wants to create or update a kit, rebuild their taste, or tidy the library. Triggers: inspo, inspiration library, moodboard, my style, my kit, my taste, process inbox, new references, design reference, art direction.
---

# Inspo — the visual guide that does the execution

The library turns references (images, screenshots, Pinterest pins, websites, the user's own work) into **styles**: structured art direction with palette, type, layout, tokens and do/avoid rules. Styles combine into **kits** (e.g. "Pitch deck" = layout from A, illustrations from B, type from C). Every task ends in an **execution brief**: art direction + merged tokens + a medium playbook + the user's content. The goal is that the user brings only content and context, and you deliver finished work.

## 0 · Find the library

Prefer the MCP server named `inspo` (tools: `get_execution_brief`, `search_styles`, `get_style`, `list_kits`, `save_kit`, `list_unanalyzed`, `save_style_analysis`, `get_design_brief`, `save_taste_profile`, `set_style_active`).

No MCP? Use the CLI from the app folder (it shares the same data):

```bash
node <app>/scripts/inspo.js where      # prints app, library, inbox and data paths
```

`<app>` is this repository (the folder that holds `server/`, `mcp/`, `scripts/`). If the skill was installed globally, the paths are listed at the bottom of this file.

Folder layout of the library:

```
<library>/
  _inbox/                 ← user dumps anything here (+ optional same-name .md/.txt with instructions or URL)
  web/ mobile/ presentation/ illustration/ typography/ misc/   ← filed references, one folder per section
  .inspo/                 ← generated: library.json, INDEX.md, styles/*.md, kits/*.md, playbooks/*.md, TASTE.md, ACTIVE.md
```

Never hand-edit `.inspo/library.json`; go through MCP, the CLI, or the app API.

## 1 · Ingest: process the inbox

When the user says they dropped new inspo, or asks to process / catalogue / "make styles from" new references:

1. **Links first.** If the inbox has a `links.txt`/`links.md`, or the user pasted URLs, capture them:
   `npm --prefix <app> run capture -- <url> "instructions"` (Pinterest pins grab the pin image; sites get a screenshot; `--full` for full page). If Playwright is missing, tell the user the one-line install from the script's error.
2. **List what's waiting:** MCP `list_unanalyzed` (returns images) or `node <app>/scripts/inspo.js pending` (returns paths — open each image with the Read tool).
3. **Read the sidecar instructions** shown for each item. They override defaults. "Take the illustration style only" means the style must describe the illustration language in depth, set `facets: ["illustration"]`, and say in `avoid`/`principles` what to ignore.
4. **Analyse each image** following `references/analysis-guide.md`. Be concrete: sampled hex values, best-guess typefaces + free alternatives, measurable layout notes.
5. **Save:** MCP `save_style_analysis`, or write the JSON to a temp file and run `node <app>/scripts/inspo.js save <id> <file.json>`. Saving files the reference out of `_inbox` into its section folder with its sidecar.
6. **Manage the rest.** After a batch:
   - If several new styles clearly belong together for one medium (e.g. three slides from the same deck), propose or create a **kit** (`save_kit` / `inspo.js kit`).
   - If a new style duplicates an existing one, say so and suggest merging (keep the better one, move notes over).
   - If ≥ 5 styles were added, offer to rebuild the taste profile (`save_taste_profile`).
   - Report back in a short table: file → style name → section → facets → kit.

## 2 · Find: search and recommend

Map the request to a section (`web`, `mobile`, `presentation`, `illustration`, `typography`, `misc`) and facets (`layout`, `typography`, `color`, `illustration`, `imagery`, `iconography`, `components`, `texture`, `motion`, `data-viz`). Search with MCP `search_styles` (query + section/facet) or `inspo.js search <words> --section x --facet y`, or grep `.inspo/INDEX.md`. Show 3–6 options by name with one line each; don't dump full style files unless asked.

## 3 · Execute: do the actual work

This is the point of the tool. When the user asks for a deliverable in their style:

1. **Resolve the direction.** A named kit → use it. Named styles → use them. Nothing named → pick the best kit for the medium, else the active styles (`get_design_brief`), else search and pick 1–3 styles yourself and say which you chose.
2. **Pick the medium:** `figma`, `web`, `app`, `presentation`, `graphic`, `illustration`.
3. **Get the brief:** MCP `get_execution_brief {kit|styles, medium, content}` or `node <app>/scripts/inspo.js brief --kit "<name>" --medium <m> --content-file <f>` then Read the listed reference images.
4. **Build the finished thing** following the brief's playbook, with the right tool for the medium:
   - **presentation** → the session's Slides artifact type if available, otherwise the pptx skill (or Google Slides when asked).
   - **figma** → Figma MCP (load `figma-use` first); create variables from TOKENS before drawing.
   - **web / app** → code in the user's stack with the TOKENS as CSS variables / theme. For a one-off page, an HTML artifact.
   - **graphic / illustration** → canvas skill / SVG / HTML; image models only for photographic or painterly parts.
5. **Self-check against the style** before handing over: palette proportions, type pairing and scale, density, signature details, and every `avoid` rule. Fix misses, then deliver.
6. Missing content? Ask once for it, briefly, listing exactly what you need (e.g. "slide titles + 1 line each"). Otherwise never ask for things the library already answers.

## 4 · Curate: kits and taste

- **Kit** = name + medium + 1–12 styles with roles (`primary`, `layout`, `typography`, `color`, `illustration`, `imagery`, `iconography`, `components`, `texture`, `motion`) + optional rules. Suggest kits when you notice the user repeatedly combining the same styles.
- **Taste** = the cross-library profile. Rebuild by reading INDEX.md and the style files, then `save_taste_profile`. Favourites (★) weigh more.

## Rules

- Original work only: use references as art direction, never trace or reproduce them.
- Respect curator instructions and the user's notes over your own reading of an image.
- Keep reports short; the user browses the visual library in the app (`npm start` → http://localhost:4545).
