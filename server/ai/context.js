import { config } from '../config.js';
import { safeFetchPage } from '../lib/safe-fetch.js';
import { extractReadable, relevantPassages } from '../lib/html.js';
import { Cache } from '../lib/cache.js';
import { keenableFetch } from '../providers/keenable.js';
import { baseSources } from '../../public/js/shared/sources.js';

export { publicSources } from '../../public/js/shared/sources.js';

const pageCache = new Cache({ max: 300, ttl: 30 * 60 * 1000 });

// Hosts whose pages are mostly JS shells or login walls: snippets are all we'll get.
const SKIP_FETCH =
  /(^|\.)(youtube\.com|youtu\.be|facebook\.com|instagram\.com|x\.com|twitter\.com|tiktok\.com|linkedin\.com|pinterest\.com|reddit\.com)$/i;

async function fetchDirect(url, signal) {
  const page = await safeFetchPage(url, { timeout: 4000, maxBytes: 900_000, signal });
  return extractReadable(page.text);
}

// Reads a page as text. With a Keenable key, Keenable's fetcher is tried first
// (it handles sites that block servers); otherwise, or if that fails, the page is
// fetched directly with SSRF protection.
export function readPage(url, signal) {
  return pageCache.wrap(url, async () => {
    if (config.keenable.apiKey) {
      try {
        const page = await keenableFetch(url, { signal });
        if (page.text.trim().length > 200) return page;
      } catch (err) {
        if (signal?.aborted) throw err;
      }
    }
    return fetchDirect(url, signal);
  });
}

// Numbered sources for the model. Results that already carry page text (from
// Keenable) are used as-is; up to `deep` of the others are fetched and trimmed to
// their most relevant passages, within a fixed time budget.
export async function buildSources(query, results, { limit = 6, deep = 3, budgetMs = 2500, knowledge } = {}) {
  const sources = baseSources(results, { limit, knowledge });
  const targets = sources.filter((s) => !s.excerpt && !SKIP_FETCH.test(s.host)).slice(0, deep);
  if (!targets.length) return sources;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  await Promise.allSettled(
    targets.map(async (s) => {
      const page = await readPage(s.url, controller.signal);
      const excerpt = relevantPassages(page.text, query, 1300);
      if (excerpt && excerpt.length > 120) s.excerpt = excerpt;
    })
  );
  clearTimeout(timer);
  return sources;
}
