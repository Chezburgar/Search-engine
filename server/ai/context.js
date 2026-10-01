import { safeFetchPage } from '../lib/safe-fetch.js';
import { extractReadable, relevantPassages } from '../lib/html.js';
import { Cache } from '../lib/cache.js';

const pageCache = new Cache({ max: 300, ttl: 30 * 60 * 1000 });

// Hosts whose pages are mostly JS shells or login walls: snippets are all we'll get.
const SKIP_FETCH =
  /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|pinterest\.com|reddit\.com)$/i;

export function readPage(url, signal) {
  return pageCache.wrap(url, async () => {
    const page = await safeFetchPage(url, { timeout: 4000, maxBytes: 900_000, signal });
    return extractReadable(page.text);
  });
}

// Turns search results into numbered sources for the model. The top `deep`
// pages are fetched and trimmed to their most relevant passages, within a
// fixed time budget so the answer never waits on a slow site.
export async function buildSources(query, results, { limit = 6, deep = 3, budgetMs = 2500, knowledge } = {}) {
  const top = results.slice(0, limit).map((r, i) => ({
    n: i + 1,
    title: r.title,
    url: r.url,
    host: r.host,
    snippet: r.snippet,
    date: r.date || null,
  }));

  if (knowledge?.extract && !top.some((s) => s.url === knowledge.url)) {
    top.push({
      n: top.length + 1,
      title: `${knowledge.title} — Wikipedia`,
      url: knowledge.url,
      host: 'en.wikipedia.org',
      snippet: knowledge.extract,
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  const targets = top.filter((s) => !SKIP_FETCH.test(s.host)).slice(0, deep);
  await Promise.allSettled(
    targets.map(async (s) => {
      const page = await readPage(s.url, controller.signal);
      const excerpt = relevantPassages(page.text, query, 1300);
      if (excerpt && excerpt.length > 120) s.excerpt = excerpt;
    })
  );
  clearTimeout(timer);
  return top;
}

export function publicSources(sources) {
  return sources.map(({ n, title, url, host, date }) => ({ n, title, url, host, date }));
}
