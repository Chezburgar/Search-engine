import { config } from '../config.js';

// Thin client for xAI's OpenAI-compatible Chat Completions API.
// https://docs.x.ai/docs/api-reference#chat-completions

export class GrokError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const FALLBACK_MODELS = ['grok-4-1-fast-non-reasoning', 'grok-4-fast-non-reasoning', 'grok-3-mini'];
const NON_CHAT = /image|imagine|vision|video|embed|tts|voice|audio|realtime|transcri|code/i;

export const aiEnabled = () => Boolean(config.xai.apiKey);

// Prefer the newest *fast* chat model: search answers need to start streaming quickly.
export function rankModels(ids) {
  const score = (id) => {
    const v = id.match(/grok-(\d+)(?:[-.](\d{1,2}))?(?=$|-[a-z])/i);
    const version = v ? Number(v[1]) + (v[2] ? Number(v[2]) / 10 : 0) : 0;
    let s = version * 100;
    if (/fast/i.test(id)) s += 150;
    if (/non-reasoning/i.test(id)) s += 20;
    if (/mini/i.test(id)) s -= 5;
    if (/beta|preview|\d{4}$/i.test(id)) s -= 3;
    return s;
  };
  return ids.filter((id) => /^grok/i.test(id) && !NON_CHAT.test(id)).sort((a, b) => score(b) - score(a));
}

let modelPromise = null;
let modelList = null;

async function listModels() {
  const res = await fetch(`${config.xai.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${config.xai.apiKey}` },
    signal: AbortSignal.timeout(6000),
  });
  if (!res.ok) throw new GrokError(res.status, `Could not list models (${res.status})`);
  const data = await res.json();
  return (data.data || data.models || []).map((m) => m.id).filter(Boolean);
}

export function resolveModel(kind = 'search') {
  if (kind === 'chat' && config.xai.chatModel) return Promise.resolve(config.xai.chatModel);
  if (config.xai.model) return Promise.resolve(config.xai.model);
  if (!modelPromise) {
    modelPromise = listModels()
      .then((ids) => {
        modelList = rankModels(ids);
        return modelList[0] || FALLBACK_MODELS[0];
      })
      .catch(() => FALLBACK_MODELS[0]);
  }
  return modelPromise;
}

// If the chosen model is rejected (retired, not on this key), pick the next best one.
function nextModelAfter(model) {
  const pool = [...(modelList || []), ...FALLBACK_MODELS].filter((m, i, a) => a.indexOf(m) === i);
  const i = pool.indexOf(model);
  return pool[i + 1] || null;
}

async function errorFrom(res) {
  let message = `Grok request failed (${res.status})`;
  try {
    const text = await res.text();
    const data = JSON.parse(text);
    message = data.error?.message || data.error || data.message || message;
    if (typeof message !== 'string') message = JSON.stringify(message);
  } catch {}
  if (res.status === 401 || res.status === 403 || /api key/i.test(message)) {
    message = 'The xAI API key was rejected. Check XAI_API_KEY in your .env file.';
  }
  if (res.status === 429) message = 'Grok is rate limiting requests right now. Try again in a moment.';
  return new GrokError(res.status, message);
}

async function post(body, signal) {
  return fetch(`${config.xai.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.xai.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
  });
}

async function open({ messages, kind, temperature, maxTokens, stream, signal }) {
  if (!aiEnabled()) throw new GrokError(503, 'Spark AI is not configured. Add XAI_API_KEY to your .env file.');
  let model = await resolveModel(kind);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await post({ model, messages, temperature, max_tokens: maxTokens, stream }, signal);
    if (res.ok) return { res, model };
    const err = await errorFrom(res);
    const modelProblem = (res.status === 400 || res.status === 404) && /model/i.test(err.message);
    const next = modelProblem && !config.xai.model ? nextModelAfter(model) : null;
    if (!next) throw err;
    model = next;
    modelPromise = Promise.resolve(next);
  }
  throw new GrokError(502, 'No available Grok model accepted the request.');
}

// Yields text deltas as they stream in.
export async function* streamChat({ messages, kind = 'search', temperature = 0.3, maxTokens = 1200, signal }) {
  const { res } = await open({ messages, kind, temperature, maxTokens, stream: true, signal });
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      let data;
      try {
        data = JSON.parse(payload);
      } catch {
        continue;
      }
      if (data.error) throw new GrokError(502, data.error.message || 'Grok stream error');
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

export async function complete({ messages, kind = 'search', temperature = 0.4, maxTokens = 400, signal }) {
  const { res } = await open({ messages, kind, temperature, maxTokens, stream: false, signal });
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

export async function aiStatus() {
  if (!aiEnabled()) return { enabled: false, model: null };
  return { enabled: true, model: await resolveModel('search'), chatModel: await resolveModel('chat') };
}
