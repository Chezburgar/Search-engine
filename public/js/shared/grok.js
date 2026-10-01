// Client for xAI's OpenAI-compatible Chat Completions API, used by the server
// and by the static (GitHub Pages) build. https://docs.x.ai/docs/api-reference#chat-completions

export class GrokError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const FALLBACK_MODELS = ['grok-4-1-fast-non-reasoning', 'grok-4-fast-non-reasoning', 'grok-3-mini'];
const NON_CHAT = /image|imagine|vision|video|embed|tts|voice|audio|realtime|transcri|code/i;

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

const withTimeout = (signal, ms) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

// Reads an OpenAI-style SSE body and yields parsed `data:` payloads.
async function* sseData(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          yield JSON.parse(payload);
        } catch {}
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

export function createGrok({
  apiKey = '',
  baseUrl = 'https://api.x.ai/v1',
  model = '',
  chatModel = '',
  keyHint = 'XAI_API_KEY',
} = {}) {
  const base = baseUrl.replace(/\/+$/, '');
  let modelPromise = null;
  let modelList = null;
  // Call the global fetch at request time so tests (and polyfills) can swap it.
  const http = (...args) => globalThis.fetch(...args);

  const enabled = () => Boolean(apiKey);

  async function listModels() {
    const res = await http(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new GrokError(res.status, `Could not list models (${res.status})`);
    const data = await res.json();
    return (data.data || data.models || []).map((m) => m.id).filter(Boolean);
  }

  function resolveModel(kind = 'search') {
    if (kind === 'chat' && chatModel) return Promise.resolve(chatModel);
    if (model) return Promise.resolve(model);
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
  function nextModelAfter(current) {
    const pool = [...(modelList || []), ...FALLBACK_MODELS].filter((m, i, a) => a.indexOf(m) === i);
    return pool[pool.indexOf(current) + 1] || null;
  }

  async function errorFrom(res) {
    let message = `Grok request failed (${res.status})`;
    try {
      const data = JSON.parse(await res.text());
      message = data.error?.message || data.error || data.message || message;
      if (typeof message !== 'string') message = JSON.stringify(message);
    } catch {}
    if (res.status === 401 || res.status === 403 || /api key/i.test(message)) {
      message = `The xAI API key was rejected. Check ${keyHint}.`;
    }
    if (res.status === 429) message = 'Grok is rate limiting requests right now. Try again in a moment.';
    return new GrokError(res.status, message);
  }

  async function open({ messages, kind, temperature, maxTokens, stream, signal }) {
    if (!enabled()) throw new GrokError(503, `Spark AI is not configured. Add ${keyHint}.`);
    let current = await resolveModel(kind);
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await http(`${base}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: current, messages, temperature, max_tokens: maxTokens, stream }),
          signal: withTimeout(signal, 90_000),
        });
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        throw new GrokError(502, "Couldn't reach the Grok API.");
      }
      if (res.ok) return { res, model: current };
      const err = await errorFrom(res);
      const modelProblem = (res.status === 400 || res.status === 404) && /model/i.test(err.message);
      const next = modelProblem && !model ? nextModelAfter(current) : null;
      if (!next) throw err;
      current = next;
      modelPromise = Promise.resolve(next);
    }
    throw new GrokError(502, 'No available Grok model accepted the request.');
  }

  // Yields text deltas as they stream in.
  async function* streamChat({ messages, kind = 'search', temperature = 0.3, maxTokens = 1200, signal }) {
    const { res } = await open({ messages, kind, temperature, maxTokens, stream: true, signal });
    for await (const data of sseData(res.body)) {
      if (data.error) throw new GrokError(502, data.error.message || 'Grok stream error');
      const delta = data.choices?.[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  async function complete({ messages, kind = 'search', temperature = 0.4, maxTokens = 400, signal }) {
    const { res } = await open({ messages, kind, temperature, maxTokens, stream: false, signal });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }

  async function status() {
    if (!enabled()) return { enabled: false, model: null };
    return { enabled: true, model: await resolveModel('search'), chatModel: await resolveModel('chat') };
  }

  return { enabled, resolveModel, streamChat, complete, status };
}
