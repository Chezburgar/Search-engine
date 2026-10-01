// Google search for Spark, with a Google API key (AIza…):
//  1. Programmable Search / Custom Search JSON API, when a search engine ID (cx) is set.
//     Closed to new customers and shutting down on 2027-01-01, so it's optional.
//  2. Gemini with "Grounding with Google Search": Gemini searches Google and lists the
//     pages it found. Works with an AI Studio key and from the browser (CORS).
// Shared by the server and the static (GitHub Pages) build.

import { hostOf, normalizeResult } from './results.js';
import { relevantPassages } from './text.js';

const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

export class GoogleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Flash-Lite first: it has by far the largest free daily quota and search grounding.
export function rankGeminiModels(models) {
  const ok = models.filter(
    (m) =>
      /gemini/i.test(m.name) &&
      (m.supportedGenerationMethods || ['generateContent']).includes('generateContent') &&
      !/image|tts|audio|live|embed|vision|thinking|computer|robotics|nano|gemma/i.test(m.name)
  );
  const version = (n) => Number((n.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || 0);
  const score = (n) =>
    (/flash-lite/.test(n) ? 3000 : /flash/.test(n) ? 2000 : 0) +
    version(n) * 100 -
    (/preview|exp/.test(n) ? 50 : 0) -
    (/latest/.test(n) ? 10 : 0);
  return ok.map((m) => m.name.replace(/^models\//, '')).sort((a, b) => score(b) - score(a));
}

const FALLBACK_MODELS = [
  'gemini-flash-lite-latest',
  'gemini-flash-latest',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
];

const clean = (s) =>
  String(s || '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')
    .replace(/^\[(.*)\]$/, '$1')
    .trim();

const isRedirect = (u) => /vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i.test(u);
const looksLikeDomain = (s) => /^[\w-]+(\.[\w-]+)+$/.test(s || '');

// Builds results from Gemini's answer lines ("TITLE ::: URL ::: SUMMARY") and its grounding
// sources. Grounding links are real but are Google redirects with the domain as title; the
// answer lines carry titles and summaries. Either alone is enough.
export function parseGrounded(data) {
  const cand = data?.candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('');
  const gm = cand?.groundingMetadata || {};
  const chunks = (gm.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri);
  const supports = gm.groundingSupports || [];

  const rawLines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const lines = rawLines
    .map((line, index) => {
      const parts = line.split(':::').map(clean);
      if (parts.length < 2) return null;
      const [title, second, ...rest] = parts;
      const urlLike = /^https?:\/\//i.test(second);
      return {
        index,
        line,
        title,
        url: urlLike ? second : '',
        summary: urlLike ? rest.join(' ') : [second, ...rest].join(' '),
      };
    })
    .filter(Boolean);

  // Which grounding source backs each answer line.
  const chunkForLine = new Map();
  for (const s of supports) {
    const seg = (s.segment?.text || '').trim();
    const idx = s.groundingChunkIndices?.[0];
    if (!seg || idx == null) continue;
    const line = lines.find((l) => l.line.includes(seg.slice(0, 50)) || seg.includes(l.line.slice(0, 50)));
    if (line && !chunkForLine.has(line.index)) chunkForLine.set(line.index, idx);
  }

  const results = [];
  const usedChunks = new Set();
  for (const l of lines) {
    const ci = chunkForLine.get(l.index);
    const chunk = ci != null ? chunks[ci] : null;
    let url = l.url && !isRedirect(l.url) ? l.url : chunk?.uri || l.url;
    if (!/^https?:\/\//i.test(url || '')) continue;
    if (ci != null) usedChunks.add(ci);
    const site = !isRedirect(url) ? hostOf(url) : looksLikeDomain(chunk?.title) ? chunk.title : '';
    results.push({ title: l.title || site, url, snippet: l.summary, extract: l.summary, site });
  }
  chunks.forEach((w, i) => {
    if (usedChunks.has(i)) return;
    const site = looksLikeDomain(w.title) ? w.title : hostOf(w.uri);
    results.push({ title: w.title || site, url: w.uri, snippet: '', site });
  });

  return {
    results: results.map((r) => normalizeResult(r)).filter(Boolean),
    // Google asks apps that show grounded results to show these search suggestions.
    suggestionsHtml: gm.searchEntryPoint?.renderedContent || '',
    queries: gm.webSearchQueries || [],
    text,
  };
}

export function mapCse(data) {
  return (data.items || []).map((it) =>
    normalizeResult({
      title: it.title,
      url: it.link,
      snippet: it.snippet,
      thumbnail: it.pagemap?.cse_thumbnail?.[0]?.src || null,
    })
  );
}

export function createGoogle({ apiKey = '', cx = '', model = '' } = {}) {
  const http = (...args) => globalThis.fetch(...args);
  let modelsPromise = null;
  let working = model || null;

  const enabled = () => Boolean(apiKey);
  const hasCse = () => Boolean(apiKey && cx);

  async function readError(res, label) {
    let message = '';
    try {
      const data = await res.json();
      message = data.error?.message || data.error?.status || '';
    } catch {}
    if (res.status === 400 && /api key not valid/i.test(message)) message = 'the Google API key is not valid';
    else if (/are blocked/i.test(message)) message = `the Google API key's API restrictions don't allow the ${label}`;
    else if (/not been used|is disabled|SERVICE_DISABLED/i.test(message))
      message = `the ${label} isn't enabled in this key's Google Cloud project`;
    else if (/does not have the access/i.test(message))
      message = `this Google Cloud project has no access to the ${label} (closed to new customers)`;
    else if (res.status === 429) message = 'Google quota reached for today';
    const err = new GoogleError(res.status, `HTTP ${res.status}${message ? ` — ${message.slice(0, 160)}` : ''}`);
    // Retrying won't help until the key or project settings change.
    err.permanent = res.status === 401 || res.status === 403 || /api key/i.test(message);
    return err;
  }

  // Programmable Search Engine (needs `cx`).
  async function cse(q, page = 1, { signal } = {}) {
    if (!hasCse()) throw new GoogleError(400, 'no search engine ID (cx) configured');
    const start = (page - 1) * 10 + 1;
    const res = await http(
      `https://www.googleapis.com/customsearch/v1?${new URLSearchParams({ key: apiKey, cx, q, start: String(start), num: '10' })}`,
      { signal: signal || AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw await readError(res, 'Custom Search JSON API');
    const data = await res.json();
    const total = Number(data.searchInformation?.totalResults || 0);
    return { results: mapCse(data), more: start + 10 <= Math.min(total, 91) };
  }

  function candidates() {
    if (working) return Promise.resolve([working]);
    modelsPromise ||= http(`${GEMINI}/models?pageSize=200`, {
      headers: { 'x-goog-api-key': apiKey },
      signal: AbortSignal.timeout(6000),
    })
      .then((res) => (res.ok ? res.json() : { models: [] }))
      .then((data) => rankGeminiModels(data.models || []))
      .catch(() => [])
      .then((ranked) => [...ranked.slice(0, 4), ...FALLBACK_MODELS].filter((m, i, a) => a.indexOf(m) === i));
    return modelsPromise;
  }

  async function generate(body, { signal, timeout = 30000 } = {}) {
    let lastError = null;
    for (const m of await candidates()) {
      let res;
      try {
        res = await http(`${GEMINI}/models/${m}:generateContent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(body),
          signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
        });
      } catch (err) {
        if (err?.name === 'AbortError' || signal?.aborted) throw err;
        throw err instanceof TypeError ? err : new GoogleError(502, err.message);
      }
      if (res.ok) {
        working = m;
        return res.json();
      }
      lastError = await readError(res, 'Gemini API');
      // Try the next model only when this one is unavailable or out of quota.
      if (lastError.permanent || ![400, 404, 429].includes(res.status)) throw lastError;
    }
    throw lastError || new GoogleError(502, 'no Gemini model available');
  }

  const searchPrompt = (q, news) =>
    `Use Google Search to find the best ${news ? 'recent news articles' : 'web pages'} for this search: "${q}"
Then list up to 10 of the ${news ? 'articles' : 'pages'} you found, best first, one per line, in exactly this format:
TITLE ::: URL ::: SUMMARY
TITLE is the page's title, URL is its full address, and SUMMARY is one or two sentences on what it says about the search.
No numbering, no markdown, no other text.`;

  async function groundedSearch(q, { news = false, signal } = {}) {
    const data = await generate(
      {
        contents: [{ role: 'user', parts: [{ text: searchPrompt(q, news) }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 1600 },
      },
      { signal }
    );
    const out = parseGrounded(data);
    out.results = out.results.map((r) => ({ ...r, extract: r.extract || relevantPassages(r.snippet, q, 600) }));
    return out;
  }

  // Reads a page with Gemini's URL context tool and summarizes it.
  async function summarizeUrl(url, q, { signal } = {}) {
    const data = await generate(
      {
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `Read ${url} and summarize it${q ? ` for someone who searched "${q}"` : ''}.
Format: "**TL;DR:** one sentence", then 3–5 bullet points with the most useful facts. Under 130 words. Only use what the page says.`,
              },
            ],
          },
        ],
        tools: [{ url_context: {} }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
      },
      { signal, timeout: 40000 }
    );
    return (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '')
      .join('')
      .trim();
  }

  return { enabled, hasCse, cse, groundedSearch, summarizeUrl };
}
