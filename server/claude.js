import Anthropic from '@anthropic-ai/sdk';

export function createClient(config) {
  return new Anthropic(config.apiKey ? { apiKey: config.apiKey } : {});
}

// Server-side refusal fallback: if a safety classifier declines, the API retries on
// Anthropic's recommended fallback model inside the same call. Not offered for Haiku.
export function withFallback(model) {
  if (/haiku/.test(model)) return {};
  return { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
}
