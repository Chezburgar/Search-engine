import { config } from '../config.js';
import { safeFetchPage } from '../lib/safe-fetch.js';
import { extractReadable, relevantPassages } from '../lib/html.js';
import { Cache } from '../lib/cache.js';
import { keenableFetch } from '../providers/keenable.js';
import { baseSources } from '../../public/js/shared/sources.js';
import {
  htmlToReader,
  textToMarkdown,
  cleanReaderMarkdown,
  wikipediaArticle,
  wikipediaParseUrl,
  wikipediaToReader,
} from '../../public/js/shared/reader.js';
import { fetchJSON } from '../lib/http.js';

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

const readerCache = new Cache({ max: 200, ttl: 30 * 60 * 1000 });
const hostOf = (url) => new URL(url).hostname.replace(/^www\./, '');

// A page for a Spark tab's reader view: { url, title, site, markdown, source }.
export function readForTab(url) {
  return readerCache.wrap(url, async () => {
    const wiki = wikipediaArticle(url);
    if (wiki) {
      try {
        const page = wikipediaToReader(await fetchJSON(wikipediaParseUrl(wiki), { timeout: 8000 }), wiki);
        if (page?.markdown) return { ...page, source: 'Wikipedia' };
      } catch {}
    }
    let page = null;
    try {
      const res = await safeFetchPage(url, { timeout: 8000, maxBytes: 2_000_000 });
      page = /html|xml/i.test(res.contentType)
        ? { url: res.url, ...htmlToReader(res.text, res.url) }
        : { url: res.url, title: '', site: hostOf(res.url), markdown: textToMarkdown(res.text) };
      page.source = 'Spark';
    } catch (err) {
      if (!config.keenable.apiKey) throw err;
    }
    if ((!page || page.markdown.length < 150) && config.keenable.apiKey) {
      const k = await keenableFetch(url, { maxChars: 40000 }).catch(() => null);
      if (k?.text)
        page = {
          url: k.url,
          title: k.title,
          site: hostOf(url),
          markdown: cleanReaderMarkdown(k.text),
          source: 'Keenable',
        };
    }
    if (!page || page.markdown.length < 40)
      throw Object.assign(new Error("This page doesn't have readable text"), { status: 422 });
    return { ...page, title: page.title || page.site };
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
