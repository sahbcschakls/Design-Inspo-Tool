# How to analyse a reference into a style

Write the JSON below for each image. It is the same shape the app's automatic analysis and the MCP `save_style_analysis` tool use.

```json
{
  "styleName": "Swiss Grid Brutalism",
  "type": "Presentation",
  "section": "presentation",
  "facets": ["layout", "typography"],
  "bestFor": ["presentation", "web"],
  "description": "One or two sentences (≤35 words) on what makes it distinctive.",
  "summary": "60–120 words: the feel, why it works, how it is built.",
  "tags": ["5–10", "lowercase", "keywords"],
  "mood": ["confident", "austere"],
  "colors": [{ "hex": "#111111", "name": "Ink", "role": "text" }],
  "typography": [{ "family": "Neue Haas Grotesk", "category": "sans-serif", "role": "headline", "weight": "Bold 700", "notes": "tight tracking, all caps", "alternatives": ["Inter Tight", "Archivo"] }],
  "layout": "Grid, structure, spacing rhythm, hierarchy.",
  "composition": "Balance, focal points, imagery treatment, negative space.",
  "visualElements": ["signature details: textures, borders, shapes, effects"],
  "tokens": { "cornerRadius": "0px", "spacing": "8pt base, generous outer margins", "borders": "1px hairlines", "shadows": "none", "texture": "flat", "motion": "snappy cuts" },
  "principles": ["3–6 defining principles"],
  "doUse": ["3–6 concrete dos"],
  "avoid": ["3–5 things that would break it"],
  "promptSnippet": "80–160 words addressed to a designer/AI: how to design something new in this style, with hex codes, type pairing, layout, details, mood. Never mention 'the image'."
}
```

## Field rules

- **type** (one of): Web Design, Landing Page, Mobile App, Dashboard, UI Component, Presentation, Branding, Logo, Typography, Poster, Editorial, Packaging, Illustration, Photography, 3D, Motion, Iconography, Pattern, Other.
- **section**: web · mobile · presentation · illustration · typography · misc. Pick where the user would look for it, not just what it depicts (an illustrated slide → presentation, unless the instructions say it's kept for the illustration).
- **facets**: what is worth *borrowing* (1–4): layout, typography, color, illustration, imagery, iconography, components, texture, motion, data-viz. Curator instructions narrow this.
- **bestFor**: figma, web, app, presentation, graphic, illustration.
- **colors**: 3–8, dominant first, real sampled hex values. The CLI/MCP shows "measured colours" — use them to ground your picks.
- **typography**: be honest when unsure ("closest match"). Always give free (Google Fonts) alternatives.
- For **illustration**-led references, the summary and visualElements must cover line weight, shape language, shading, texture, perspective, colour usage and level of detail — enough to draw a new piece in the same hand.
- For **typography**-led references, cover the scale ratio, case, tracking, leading, weight contrast and pairing logic.
