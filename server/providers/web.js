import { config } from '../config.js';
import { fetchJSON, fetchText, qs, BOT_UA } from '../lib/http.js';
import { attr, decodeEntities, stripTags, tagText } from '../lib/html.js';
import { dedupe, firstSuccessful, normalizeResult } from './normalize.js';

const SAFE = {
  ddg: { strict: '1', moderate: '-1', off: '-2' },
};

function regionParts(region = config.region) {
  const [country = 'us', lang = 'en'] = region.toLowerCase().split('-');
  return { country, lang };
}

export const encodeCursor = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
export function decodeCursor(str) {
  try {
    return JSON.parse(Buffer.from(String(str), 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

/* ---------------------------------- Brave --------------------------------- */

const brave = {
  name: 'Brave',
  enabled: () => Boolean(config.braveKey),
  async search(q, { page = 1, safe = 'moderate' }) {
    const { country, lang } = regionParts();
    const data = await fetchJSON(
      `https://api.search.brave.com/res/v1/web/search?${qs({
        q,
        count: 20,
        offset: Math.min(page - 1, 9),
        safesearch: safe,
        country,
        search_lang: lang,
        extra_snippets: 'false',
      })}`,
      { headers: { 'X-Subscription-Token': config.braveKey } }
    );
    const results = (data.web?.results || []).map((r) =>
      normalizeResult({
        title: r.title,
        url: r.url,
        snippet: r.description,
        date: r.page_age || null,
        thumbnail: r.thumbnail?.src || null,
      })
    );
    const more = data.query?.more_results_available && page < 10;
    return { results, next: more ? encodeCursor({ p: 'Brave', page: page + 1 }) : null };
  },
};

/* ------------------------------- DuckDuckGo ------------------------------- */

export function parseDuckDuckGo(html) {
  const results = [];
  const marker = /class="result__a"/g;
  const starts = [];
  let m;
  while ((m = marker.exec(html))) starts.push(m.index);
  for (let i = 0; i < starts.length; i++) {
    const tagStart = html.lastIndexOf('<a', starts[i]);
    const chunk = html.slice(tagStart, starts[i + 1] ?? starts[i] + 6000);
    // The result's own container tells us whether it's an ad.
    const containerStart = html.lastIndexOf('<div class="result', tagStart);
    const container = containerStart === -1 ? '' : html.slice(containerStart, html.indexOf('>', containerStart));
    const anchor = chunk.match(/^<a\b[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    let href = attr(anchor[0], 'href');
    if (!href || /duckduckgo\.com\/y\.js|ad_domain=|ad_provider=/.test(href) || /result--ad/.test(container)) {
      continue;
    }
    if (href.startsWith('//')) href = `https:${href}`;
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.hostname.endsWith('duckduckgo.com') && u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
      else href = u.href;
    } catch {
      continue;
    }
    const snippetMatch = chunk.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td|span)>/i);
    const dateMatch = chunk.match(/(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}/);
    results.push(
      normalizeResult({
        title: anchor[1],
        url: href,
        snippet: snippetMatch ? snippetMatch[1] : '',
        date: dateMatch ? dateMatch[1] : null,
      })
    );
  }

  // Hidden inputs of the "Next" form let us request the following page.
  let next = null;
  const forms = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi) || [];
  const nextForm = forms.find((f) => /value\s*=\s*["']Next/i.test(f) && /name\s*=\s*["']s["']/i.test(f));
  if (nextForm) {
    next = {};
    for (const input of nextForm.match(/<input\b[^>]*>/gi) || []) {
      const name = attr(input, 'name');
      if (name && attr(input, 'type').toLowerCase() === 'hidden') next[name] = attr(input, 'value');
    }
  }
  const blocked = !results.length && /anomaly-modal|challenge-form|g-recaptcha|Unfortunately, bots/i.test(html);
  return { results: results.filter(Boolean), next, blocked };
}

const duckduckgo = {
  name: 'DuckDuckGo',
  enabled: () => true,
  async search(q, { safe = 'moderate', state }) {
    const kl = config.region;
    const kp = SAFE.ddg[safe] ?? '-1';
    const headers = {
      Accept: 'text/html,application/xhtml+xml',
      Referer: 'https://html.duckduckgo.com/',
    };
    const html = state
      ? await fetchText('https://html.duckduckgo.com/html/', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: qs({ ...state, kl, kp }),
        })
      : await fetchText(`https://html.duckduckgo.com/html/?${qs({ q, kl, kp })}`, { headers });
    const parsed = parseDuckDuckGo(html);
    if (parsed.blocked) throw new Error('rate limited');
    return {
      results: parsed.results,
      next: parsed.next && parsed.results.length ? encodeCursor({ p: 'DuckDuckGo', state: parsed.next }) : null,
    };
  },
};

/* ---------------------------------- Bing ---------------------------------- */

export function parseRssItems(xml) {
  return (xml.match(/<item\b[\s\S]*?<\/item>/gi) || []).map((item) => ({
    raw: item,
    title: decodeEntities(tagText(item, 'title')),
    link: decodeEntities(tagText(item, 'link')).trim(),
    description: tagText(item, 'description'),
    pubDate: tagText(item, 'pubDate').trim(),
  }));
}

const bing = {
  name: 'Bing',
  enabled: () => true,
  async search(q, { page = 1, safe = 'moderate' }) {
    const { country, lang } = regionParts();
    const xml = await fetchText(
      `https://www.bing.com/search?${qs({
        format: 'rss',
        q,
        first: (page - 1) * 10 + 1,
        count: 10,
        setlang: lang,
        cc: country.toUpperCase(),
        adlt: safe,
      })}`,
      { headers: { Accept: 'application/rss+xml, application/xml, text/xml' } }
    );
    const results = parseRssItems(xml).map((it) =>
      normalizeResult({ title: it.title, url: it.link, snippet: decodeEntities(it.description) })
    );
    return { results, next: results.length >= 5 && page < 10 ? encodeCursor({ p: 'Bing', page: page + 1 }) : null };
  },
};

/* -------------------------------- Wikipedia ------------------------------- */

const wikipedia = {
  name: 'Wikipedia',
  enabled: () => true,
  async search(q, { page = 1 }) {
    const { lang } = regionParts();
    const data = await fetchJSON(
      `https://${lang}.wikipedia.org/w/api.php?${qs({
        action: 'query',
        list: 'search',
        srsearch: q,
        srlimit: 10,
        sroffset: (page - 1) * 10,
        srprop: 'snippet|timestamp',
        format: 'json',
        formatversion: 2,
      })}`,
      { headers: { 'User-Agent': BOT_UA } }
    );
    const results = (data.query?.search || []).map((r) =>
      normalizeResult({
        title: r.title,
        url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
        snippet: `${stripTags(r.snippet)}…`,
        date: r.timestamp?.slice(0, 10) || null,
      })
    );
    return { results, next: data.continue ? encodeCursor({ p: 'Wikipedia', page: page + 1 }) : null };
  },
};

export const WEB_PROVIDERS = [brave, duckduckgo, bing, wikipedia];

export async function searchWeb(q, { cursor, safe = 'moderate' } = {}) {
  if (cursor) {
    const c = decodeCursor(cursor);
    const provider = c && WEB_PROVIDERS.find((p) => p.name === c.p && p.enabled());
    if (!provider) return { results: [], provider: null, next: null };
    const out = await provider.search(q, { page: c.page || 1, state: c.state, safe });
    return { results: dedupe(out.results), provider: provider.name, next: out.next };
  }
  const out = await firstSuccessful(
    WEB_PROVIDERS.filter((p) => p.enabled()),
    (p) => p.search(q, { page: 1, safe })
  );
  return { ...out, results: dedupe(out.results) };
}
