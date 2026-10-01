import { config } from '../config.js';
import { createGoogle } from '../../public/js/shared/google.js';
import { searchYouTube } from '../../public/js/shared/youtube.js';
import { fetchJSON } from '../lib/http.js';
import { encodeCursor } from './cursor.js';

export const google = createGoogle(config.google);

// Once Google says the key can't use an API, stop calling it (until restart).
const off = {};
const guard = async (which, run) => {
  try {
    return await run();
  } catch (err) {
    if (err?.permanent) off[which] = err.message;
    throw err;
  }
};

export const googleCse = {
  name: 'Google',
  enabled: () => google.hasCse() && !off.cse,
  async search(q, { page = 1 }) {
    const out = await guard('cse', () => google.cse(q, page));
    return { results: out.results, next: out.more ? encodeCursor({ p: 'Google', page: page + 1 }) : null };
  },
};

export const googleGrounded = {
  name: 'Google AI search',
  enabled: () => google.enabled() && !off.gemini,
  async search(q, { page = 1 }) {
    if (page > 1) return { results: [], next: null };
    const out = await guard('gemini', () => google.groundedSearch(q));
    return { results: out.results, next: null, googleSuggestions: out.suggestionsHtml || null };
  },
};

export const googleNews = {
  name: 'Google AI search',
  enabled: () => google.enabled() && !off.gemini,
  async search(q) {
    const out = await guard('gemini', () => google.groundedSearch(q, { news: true }));
    return {
      results: out.results.map((r) => ({
        title: r.title,
        url: r.url,
        source: r.host,
        host: r.host,
        date: null,
        snippet: r.snippet,
        image: null,
      })),
    };
  },
};

export const videosEnabled = () => Boolean(config.google.apiKey);

export function searchVideos(q, pageToken = '') {
  return searchYouTube(q, config.google.apiKey, {
    pageToken,
    region: config.region,
    getJSON: (url) => fetchJSON(url, { timeout: 8000 }),
  });
}
