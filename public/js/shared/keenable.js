import { relevantPassages } from './text.js';

// Keenable web search API (https://keenable.ai).
// POST /v1/search  { query, max_results (1–50), snippet_max_length }  → { results: [{ url, title, snippet, description, published_at }] }
// GET  /v1/fetch?url=&max_chars=                                      → { url, title, content (markdown) }
// With an API key, requests carry X-API-Key; without one they go to the keyless
// `/public` twins (same parameters, rate limited per IP).

export const KEENABLE_URL = 'https://api.keenable.ai';
export const PAGE_SIZE = 20;
export const MAX_RESULTS = 50;
const APP_TITLE = 'Spark Search';

export function keenableRequest({ apiKey = '', baseUrl = KEENABLE_URL, path, body, query }) {
  const url = `${baseUrl.replace(/\/+$/, '')}${path}${apiKey ? '' : '/public'}${
    query ? `?${new URLSearchParams(query)}` : ''
  }`;
  const headers = { Accept: 'application/json', 'X-Keenable-Title': APP_TITLE };
  if (apiKey) headers['X-API-Key'] = apiKey;
  if (body) headers['Content-Type'] = 'application/json';
  return {
    url,
    init: {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', // never forward the key to a redirect target
    },
  };
}

export const searchBody = (q, maxResults = PAGE_SIZE, extra = {}) => ({
  query: q,
  max_results: Math.min(Math.max(maxResults, 1), MAX_RESULTS),
  snippet_max_length: 2000,
  ...extra,
});

const oneLine = (s) =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim();

// Keenable's `snippet` is the page's own text, often starting with navigation.
// Show the sentences that match the query, like a search engine snippet.
export function displaySnippet(text, q, max = 300) {
  const best = oneLine(relevantPassages(text, q, max + 60) || text);
  if (best.length <= max) return best;
  const cut = best.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`;
}

export function mapKeenableResults(payload, q) {
  if (!payload || !Array.isArray(payload.results)) throw new Error('Keenable returned an unexpected response');
  return payload.results
    .filter((r) => r && typeof r.url === 'string')
    .map((r) => {
      const text = String(r.snippet || r.description || '');
      return {
        title: r.title || '',
        url: r.url,
        snippet: displaySnippet(text, q),
        extract: oneLine(relevantPassages(text, q, 1400)),
        date: typeof r.published_at === 'string' ? r.published_at.slice(0, 10) : null,
        published: typeof r.published_at === 'string' ? r.published_at : null,
      };
    });
}

// Page `n` of results: the API has no offset, so later pages request more and skip what was shown.
export const pageWindow = (page) => {
  const want = Math.min(page * PAGE_SIZE, MAX_RESULTS);
  return { want, from: (page - 1) * PAGE_SIZE };
};
export const hasMore = (count, want) => count >= want && want < MAX_RESULTS;

export function mapKeenableFetch(payload, url) {
  if (!payload || typeof payload.content !== 'string') throw new Error('Keenable returned an unexpected response');
  return { url: payload.url || url, title: payload.title || '', text: payload.content };
}
