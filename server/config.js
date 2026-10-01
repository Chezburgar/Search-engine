import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectProvider } from '../public/js/shared/llm.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader so Spark runs with zero dependencies.
// Values already present in the environment always win.
function loadDotEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return;
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line
      .slice(0, eq)
      .trim()
      .replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const env = (k) => (process.env[k] || '').trim();

// AI provider: Groq (GROQ_API_KEY, gsk_…) or xAI Grok (XAI_API_KEY, xai-…). A key in
// the "wrong" variable still works because the prefix identifies the provider.
function aiConfig() {
  const key = env('AI_API_KEY') || env('GROQ_API_KEY') || env('XAI_API_KEY');
  const provider = env('AI_PROVIDER').toLowerCase() || detectProvider(key) || (env('GROQ_API_KEY') ? 'groq' : 'xai');
  const pick = (generic, xai, groq) => env(generic) || env(provider === 'groq' ? groq : xai);
  return {
    provider,
    apiKey: key,
    baseUrl: env('AI_BASE_URL') || (provider === 'xai' ? env('XAI_BASE_URL') : ''),
    model: pick('AI_MODEL', 'XAI_MODEL', 'GROQ_MODEL'),
    chatModel: pick('AI_CHAT_MODEL', 'XAI_CHAT_MODEL', 'GROQ_CHAT_MODEL'),
    visionModel: pick('AI_VISION_MODEL', 'XAI_VISION_MODEL', 'GROQ_VISION_MODEL'),
  };
}

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  region: process.env.SPARK_REGION || 'us-en',
  trustProxy: process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true',
  ai: aiConfig(),
  braveKey: (process.env.BRAVE_API_KEY || '').trim(),
  keenable: {
    apiKey: (process.env.KEENABLE_API_KEY || '').trim(),
    baseUrl: (process.env.KEENABLE_BASE_URL || 'https://api.keenable.ai').replace(/\/+$/, ''),
  },
  aiRateLimit: {
    max: num(process.env.AI_RATE_LIMIT, 120),
    windowMs: 10 * 60 * 1000,
  },
};
