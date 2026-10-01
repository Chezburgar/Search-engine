// Client for OpenAI-compatible chat APIs (xAI Grok or Groq), used by the server
// and by the static (GitHub Pages) build.
//   xAI:  https://docs.x.ai/docs/api-reference#chat-completions
//   Groq: https://console.groq.com/docs/api-reference#chat

export class LLMError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* -------------------------------- providers ------------------------------- */

const XAI_NON_CHAT = /image|imagine|vision|video|embed|tts|voice|audio|realtime|transcri|code/i;

// xAI: prefer the newest *fast* chat model, since search answers need to start streaming quickly.
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
  return ids.filter((id) => /^grok/i.test(id) && !XAI_NON_CHAT.test(id)).sort((a, b) => score(b) - score(a));
}

const byPreference = (ids, preferred, accept) => [
  ...preferred.filter((id) => ids.includes(id)),
  ...ids.filter((id) => !preferred.includes(id) && accept(id)).sort(),
];

const GROQ_NON_CHAT = /whisper|tts|playai|orpheus|guard|compound|distil|allam|embed|saba/i;
const GROQ_VISION = /llama-4|scout|maverick|vision|-vl\b|qwen3\.6|qwen3-vl|gemma-3/i;
const GROQ_TEXT_PREF = [
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'moonshotai/kimi-k2-instruct-0905',
  'moonshotai/kimi-k2-instruct',
  'openai/gpt-oss-20b',
  'qwen/qwen3-32b',
  'llama-3.1-8b-instant',
];
const GROQ_VISION_PREF = [
  'qwen/qwen3.6-27b',
  'meta-llama/llama-4-maverick-17b-128e-instruct',
  'meta-llama/llama-4-scout-17b-16e-instruct',
];

export const rankGroq = (ids) =>
  byPreference(ids, GROQ_TEXT_PREF, (id) => !GROQ_NON_CHAT.test(id) && !GROQ_VISION.test(id));
export const rankGroqVision = (ids) => byPreference(ids, GROQ_VISION_PREF, (id) => GROQ_VISION.test(id));

export const PROVIDERS = {
  xai: {
    label: 'Grok',
    company: 'xAI',
    baseUrl: 'https://api.x.ai/v1',
    rankText: rankModels,
    rankVision: (ids) => rankModels(ids).filter((id) => /grok-[4-9]/i.test(id)),
    fallbackText: ['grok-4-1-fast-non-reasoning', 'grok-4-fast-non-reasoning', 'grok-3-mini'],
    fallbackVision: ['grok-4-1-fast-non-reasoning', 'grok-4'],
    extras: () => ({}),
    isReasoning: (id) => /reasoning/i.test(id) && !/non-reasoning/i.test(id),
    searchModel: null,
  },
  groq: {
    label: 'Groq',
    company: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    rankText: rankGroq,
    rankVision: rankGroqVision,
    fallbackText: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'],
    fallbackVision: GROQ_VISION_PREF,
    // Keep reasoning short and out of the answer text.
    extras: (id) =>
      /gpt-oss/i.test(id) ? { reasoning_effort: 'low' } : /qwen3/i.test(id) ? { reasoning_format: 'hidden' } : {},
    isReasoning: (id) => /gpt-oss|qwen3|deepseek-r1|reasoning/i.test(id),
    // A Groq system with built-in web search; used when no other search works in the browser.
    searchModel: 'groq/compound-mini',
  },
};

// The key's prefix tells us who issued it.
export function detectProvider(key = '') {
  if (/^gsk_/.test(key)) return 'groq';
  if (/^xai-/.test(key)) return 'xai';
  return null;
}

export const hasImages = (messages) =>
  messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p?.type === 'image_url'));

/* --------------------------------- helpers -------------------------------- */

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

// Removes <think>…</think> blocks from streamed text, even when tags are split across chunks.
export function thinkFilter() {
  const OPEN = '<think>';
  const CLOSE = '</think>';
  let buf = '';
  let inside = false;
  const partial = (s, tag) => {
    for (let k = Math.min(tag.length - 1, s.length); k > 0; k--) if (tag.startsWith(s.slice(-k))) return k;
    return 0;
  };
  return (chunk, final = false) => {
    buf += chunk;
    let out = '';
    while (buf) {
      if (inside) {
        const end = buf.indexOf(CLOSE);
        if (end === -1) {
          buf = buf.slice(buf.length - partial(buf, CLOSE));
          return out;
        }
        buf = buf.slice(end + CLOSE.length).replace(/^\s+/, '');
        inside = false;
      } else {
        const start = buf.indexOf(OPEN);
        if (start === -1) {
          const keep = final ? 0 : partial(buf, OPEN);
          out += buf.slice(0, buf.length - keep);
          buf = buf.slice(buf.length - keep);
          return out;
        }
        out += buf.slice(0, start);
        buf = buf.slice(start + OPEN.length);
        inside = true;
      }
    }
    return out;
  };
}

// Finds search results ({ url, title, content }) anywhere inside Groq's `executed_tools`.
export function searchResultsFrom(executedTools) {
  const found = [];
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || depth > 6) return;
    if (Array.isArray(node)) return node.forEach((n) => visit(n, depth + 1));
    if (typeof node === 'string') {
      if (depth < 3 && /^[[{]/.test(node.trim())) {
        try {
          visit(JSON.parse(node), depth + 1);
        } catch {}
      }
      return;
    }
    if (typeof node !== 'object') return;
    if (typeof node.url === 'string' && /^https?:/i.test(node.url) && (node.title || node.content)) {
      if (!seen.has(node.url)) {
        seen.add(node.url);
        found.push({
          url: node.url,
          title: String(node.title || ''),
          content: String(node.content || node.snippet || ''),
        });
      }
      return;
    }
    Object.values(node).forEach((v) => visit(v, depth + 1));
  };
  visit(executedTools, 0);
  return found;
}

/* --------------------------------- client --------------------------------- */

export function createLLM({
  provider = 'xai',
  apiKey = '',
  baseUrl = '',
  model = '',
  chatModel = '',
  visionModel = '',
  keyHint = 'the API key',
} = {}) {
  const p = PROVIDERS[provider] || PROVIDERS.xai;
  const base = (baseUrl || p.baseUrl).replace(/\/+$/, '');
  let listPromise = null;
  const pools = {};
  const noExtras = new Set();
  // Call the global fetch at request time so tests (and polyfills) can swap it.
  const http = (...args) => globalThis.fetch(...args);
  const enabled = () => Boolean(apiKey);

  function listModels() {
    listPromise ||= http(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(6000),
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`models ${res.status}`))))
      .then((data) => (data.data || data.models || []).map((m) => m.id).filter(Boolean))
      .catch(() => []);
    return listPromise;
  }

  async function pool(kind) {
    const vision = kind === 'vision';
    if (!pools[vision ? 'vision' : 'text']) {
      const ids = await listModels();
      const ranked = vision ? p.rankVision(ids) : p.rankText(ids);
      const fallback = vision ? p.fallbackVision : p.fallbackText;
      pools[vision ? 'vision' : 'text'] = [...ranked, ...fallback].filter((m, i, a) => a.indexOf(m) === i);
    }
    return pools[vision ? 'vision' : 'text'];
  }

  async function resolveModel(kind = 'search') {
    if (kind === 'vision') return visionModel || (await pool('vision'))[0];
    if (kind === 'chat' && chatModel) return chatModel;
    if (model) return model;
    return (await pool('text'))[0];
  }

  async function errorFrom(res) {
    let message = `${p.label} request failed (${res.status})`;
    try {
      const data = JSON.parse(await res.text());
      message = data.error?.message || data.error || data.message || message;
      if (typeof message !== 'string') message = JSON.stringify(message);
    } catch {}
    if (res.status === 401 || res.status === 403 || /api key/i.test(message)) {
      message = `The ${p.company} API key was rejected. Check ${keyHint}.`;
    } else if (res.status === 429) {
      message = `${p.label} is rate limiting requests right now. Try again in a moment.`;
    }
    return new LLMError(res.status, message);
  }

  async function post(body, signal, timeout = 90_000) {
    try {
      return await http(`${base}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: withTimeout(signal, timeout),
      });
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) throw err;
      throw new LLMError(502, `Couldn't reach the ${p.label} API.`);
    }
  }

  async function open({ messages, kind, temperature, maxTokens, stream, signal }) {
    if (!enabled()) throw new LLMError(503, `Spark AI is not configured. Add ${keyHint}.`);
    if (hasImages(messages)) kind = 'vision';
    const pinned = kind === 'vision' ? visionModel : (kind === 'chat' && chatModel) || model;
    let current = await resolveModel(kind);
    for (let attempt = 0; attempt < 4; attempt++) {
      const extras = noExtras.has(current) ? {} : p.extras(current);
      const body = {
        model: current,
        messages,
        temperature,
        max_tokens: p.isReasoning(current) ? maxTokens + 800 : maxTokens,
        stream,
        ...extras,
      };
      const res = await post(body, signal);
      if (res.ok) return { res, model: current };
      const err = await errorFrom(res);
      // A model may not accept our reasoning settings; retry once without them.
      if (res.status === 400 && Object.keys(extras).some((k) => err.message.includes(k))) {
        noExtras.add(current);
        continue;
      }
      const modelProblem =
        (res.status === 400 || res.status === 404) && /model|image|vision|multimodal/i.test(err.message);
      if (!modelProblem || pinned) throw err;
      const list = await pool(kind);
      const next = list[list.indexOf(current) + 1];
      if (!next) throw err;
      current = next;
      // Remember the working choice for later requests.
      pools[kind === 'vision' ? 'vision' : 'text'] = list.slice(list.indexOf(next));
    }
    throw new LLMError(502, `No available ${p.label} model accepted the request.`);
  }

  // Yields text deltas as they stream in.
  async function* streamChat({ messages, kind = 'search', temperature = 0.3, maxTokens = 1200, signal }) {
    const { res } = await open({ messages, kind, temperature, maxTokens, stream: true, signal });
    const strip = thinkFilter();
    for await (const data of sseData(res.body)) {
      if (data.error) throw new LLMError(502, data.error.message || `${p.label} stream error`);
      const delta = data.choices?.[0]?.delta?.content;
      const text = delta ? strip(delta) : '';
      if (text) yield text;
    }
    const rest = strip('', true);
    if (rest) yield rest;
  }

  async function complete({ messages, kind = 'search', temperature = 0.4, maxTokens = 400, signal }) {
    const { res } = await open({ messages, kind, temperature, maxTokens, stream: false, signal });
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  // Web search through the provider's built-in search tool (Groq Compound), if it has one.
  async function webSearch(query, { signal } = {}) {
    if (!enabled() || !p.searchModel) return [];
    const res = await post(
      {
        model: p.searchModel,
        messages: [
          {
            role: 'user',
            content: `Search the web for: ${query}\nThen list the most relevant pages in one short line each.`,
          },
        ],
        max_tokens: 300,
        temperature: 0,
      },
      signal,
      30_000
    );
    if (!res.ok) throw await errorFrom(res);
    const data = await res.json();
    return searchResultsFrom(data.choices?.[0]?.message?.executed_tools);
  }

  // A one-off answer from the provider's tool-using system (it can search and visit pages).
  async function askWithTools(prompt, { signal, maxTokens = 600 } = {}) {
    if (!enabled() || !p.searchModel) throw new LLMError(501, `${p.label} has no browsing tools.`);
    const res = await post(
      { model: p.searchModel, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.2 },
      signal,
      45_000
    );
    if (!res.ok) throw await errorFrom(res);
    const data = await res.json();
    return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  }

  async function status({ resolve = true } = {}) {
    if (!enabled()) return { enabled: false, provider: p.label, model: null };
    return {
      enabled: true,
      provider: p.label,
      company: p.company,
      model: resolve ? await resolveModel('search') : model || null,
      vision: true,
    };
  }

  return { enabled, provider: p, resolveModel, streamChat, complete, webSearch, askWithTools, status };
}
