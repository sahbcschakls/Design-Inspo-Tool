// Shared configuration for the web server and the MCP server.
// Precedence: config.local.json (written from the Settings panel) > .env > defaults.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_CONFIG = path.join(ROOT, 'config.local.json');

dotenv.config({ path: path.join(ROOT, '.env'), quiet: true });

export const DEFAULT_MODEL = 'claude-opus-5-5';

function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readLocal() {
  try {
    return JSON.parse(fs.readFileSync(LOCAL_CONFIG, 'utf8'));
  } catch {
    return {};
  }
}

export function getConfig() {
  const local = readLocal();
  const libraryDir = path.resolve(
    expandHome(local.libraryDir || process.env.INSPO_DIR || path.join(ROOT, 'library'))
  );
  const apiKey = local.apiKey || process.env.ANTHROPIC_API_KEY || '';
  const autoAnalyze = local.autoAnalyze ?? (process.env.AUTO_ANALYZE ?? 'true') !== 'false';
  return {
    libraryDir,
    dataDir: path.join(libraryDir, '.inspo'),
    apiKey,
    aiEnabled: Boolean(apiKey || process.env.ANTHROPIC_AUTH_TOKEN),
    model: local.model || process.env.INSPO_MODEL || DEFAULT_MODEL,
    autoAnalyze,
    port: Number(process.env.PORT || 4545),
  };
}

export function saveLocalConfig(patch) {
  const next = { ...readLocal(), ...patch };
  for (const key of Object.keys(next)) {
    if (next[key] === '' || next[key] === null) delete next[key];
  }
  fs.writeFileSync(LOCAL_CONFIG, JSON.stringify(next, null, 2));
  return getConfig();
}
