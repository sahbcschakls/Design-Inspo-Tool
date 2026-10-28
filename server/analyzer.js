// Sends references to Claude (vision + structured output) and stores the result.
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { ANALYSIS_SCHEMA, cleanAnalysis } from './schema.js';
import { forClaude } from './images.js';
import { createClient, withFallback } from './claude.js';

const SYSTEM = `You are a senior art director cataloguing a designer's personal inspiration library.
For each reference you identify the visual style precisely enough that another designer (or an AI) could create new, original work in the same style without seeing the image.
Be concrete: real hex values sampled from the image, best-guess typeface identification with free alternatives, specific layout and detail observations. Avoid generic words like "modern" or "clean" unless qualified.
If several images are provided they are vertical slices of one tall screenshot, top to bottom.`;

export function analysisRequest(style, images, { notes } = {}) {
  const context = [
    `File: ${style.file}`,
    style.collection ? `Collection folder: ${style.collection}` : null,
    style.width ? `Size: ${style.width}×${style.height}px` : null,
    style.localColors?.length ? `Dominant pixel colours (measured): ${style.localColors.map((c) => c.hex).join(' ')}` : null,
    notes || style.notes ? `Designer's notes about this reference: ${notes || style.notes}` : null,
  ].filter(Boolean).join('\n');
  return [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } })),
    { type: 'text', text: `${context}\n\nAnalyse this design reference and catalogue its visual style.` },
  ];
}

export class Analyzer {
  constructor({ store, libraryDir, getConfig, onExportsChanged, concurrency = 2 }) {
    this.store = store;
    this.libraryDir = libraryDir;
    this.getConfig = getConfig;
    this.onExportsChanged = onExportsChanged;
    this.concurrency = concurrency;
    this.waiting = [];
    this.active = new Set();
    this.stopped = false;
  }

  enqueue(id) {
    if (this.waiting.includes(id) || this.active.has(id)) return;
    this.waiting.push(id);
    this.#pump();
  }

  stop() {
    this.stopped = true;
    this.waiting = [];
  }

  #pump() {
    while (!this.stopped && this.active.size < this.concurrency && this.waiting.length) {
      const id = this.waiting.shift();
      this.active.add(id);
      this.#run(id).finally(() => {
        this.active.delete(id);
        this.#pump();
      });
    }
  }

  async #run(id) {
    const config = this.getConfig();
    const style = this.store.get(id);
    if (!style || style.missing) return;
    if (!config.aiEnabled) {
      await this.store.update(id, { status: 'pending', error: null });
      return;
    }
    await this.store.update(id, { status: 'analyzing', error: null });
    try {
      const images = await forClaude(path.join(this.libraryDir, style.file));
      const client = createClient(config);
      const response = await client.beta.messages.create({
        model: config.model,
        max_tokens: 16000,
        ...withFallback(config.model),
        thinking: { type: 'adaptive' },
        output_config: { effort: 'medium', format: { type: 'json_schema', schema: ANALYSIS_SCHEMA } },
        system: SYSTEM,
        messages: [{ role: 'user', content: analysisRequest(style, images) }],
      });
      if (response.stop_reason === 'refusal') throw new Error('Claude declined to analyse this image.');
      if (response.stop_reason === 'max_tokens') throw new Error('The analysis was cut off — try again.');
      const text = response.content.find((b) => b.type === 'text')?.text;
      if (!text) throw new Error(`No analysis returned (stop reason: ${response.stop_reason}).`);
      const analysis = cleanAnalysis(JSON.parse(text));
      if (this.stopped) return;
      await this.store.update(id, {
        ...analysis,
        status: 'ready',
        error: null,
        source: 'claude-api',
        model: response.model,
        analyzedAt: new Date().toISOString(),
      });
      this.onExportsChanged?.();
    } catch (err) {
      if (this.stopped) return;
      let message = err?.message || String(err);
      if (err instanceof Anthropic.AuthenticationError) message = 'Invalid Anthropic API key — check Settings.';
      else if (err instanceof Anthropic.RateLimitError) message = 'Rate limited by the Anthropic API — retry in a minute.';
      else if (err instanceof Anthropic.APIConnectionError) message = 'Could not reach the Anthropic API — check your connection.';
      console.error(`[inspo] analysis failed for ${style.file}: ${message}`);
      await this.store.update(id, { status: 'error', error: message }).catch(() => {});
    }
  }
}
