import { config } from '../config.js';
import { fetchJSON, fetchText, qs } from '../lib/http.js';
import { attr, decodeEntities, stripTags, tagText } from '../lib/html.js';
import { parseRssItems } from './web.js';
import { firstSuccessful, hostOf } from './normalize.js';

function toISO(date) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function item({ title, url, source, sourceUrl, date, snippet, image }) {
  if (!title || !url || !/^https?:/i.test(url)) return null;
  return {
    title: stripTags(title).slice(0, 220),
    url,
    source: source || hostOf(sourceUrl || url),
    host: hostOf(sourceUrl || url),
    date: toISO(date),
    snippet: stripTags(snippet || '').slice(0, 300),
    image: image && /^https?:/i.test(image) ? image : null,
  };
}

const brave = {
  name: 'Brave',
  enabled: () => Boolean(config.braveKey),
  async search(q) {
    const data = await fetchJSON(`https://api.search.brave.com/res/v1/news/search?${qs({ q, count: 20 })}`, {
      headers: { 'X-Subscription-Token': config.braveKey },
    });
    return {
      results: (data.results || []).map((r) =>
        item({
          title: r.title,
          url: r.url,
          source: r.meta_url?.hostname?.replace(/^www\./, ''),
          date: r.page_age,
          snippet: r.description,
          image: r.thumbnail?.src,
        })
      ),
    };
  },
};

export function parseGoogleNews(xml) {
  return parseRssItems(xml).map((it) => {
    const sourceTag = it.raw.match(/<source\b[^>]*>[\s\S]*?<\/source>/i)?.[0] || '';
    const source = decodeEntities(tagText(sourceTag, 'source'));
    let title = it.title;
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3));
    const desc = decodeEntities(it.description);
    const snippet = stripTags(desc);
    return item({
      title,
      url: it.link,
      source,
      sourceUrl: attr(sourceTag, 'url'),
      date: it.pubDate,
      // Google's description repeats the headline; only keep it when it adds something.
      snippet: snippet && !snippet.startsWith(title.slice(0, 40)) ? snippet : '',
    });
  });
}

const googleNews = {
  name: 'Google News',
  enabled: () => true,
  async search(q) {
    const [country, lang] = config.region.split('-');
    const gl = (country || 'us').toUpperCase();
    const hl = `${lang || 'en'}-${gl}`;
    const xml = await fetchText(
      `https://news.google.com/rss/search?${qs({ q, hl, gl, ceid: `${gl}:${lang || 'en'}` })}`,
      { headers: { Accept: 'application/rss+xml, application/xml' } }
    );
    return { results: parseGoogleNews(xml).slice(0, 30) };
  },
};

export function parseBingNews(xml) {
  return parseRssItems(xml).map((it) => {
    let url = it.link;
    try {
      const u = new URL(it.link);
      if (u.hostname.endsWith('bing.com') && u.searchParams.get('url')) url = u.searchParams.get('url');
    } catch {}
    const image = decodeEntities(tagText(it.raw, 'News:Image')).trim();
    return item({
      title: it.title,
      url,
      source: decodeEntities(tagText(it.raw, 'News:Source')),
      date: it.pubDate,
      snippet: decodeEntities(it.description),
      image: image ? `${image}${image.includes('?') ? '&' : '?'}w=240&h=160&c=7` : null,
    });
  });
}

const bingNews = {
  name: 'Bing News',
  enabled: () => true,
  async search(q) {
    const xml = await fetchText(`https://www.bing.com/news/search?${qs({ q, format: 'rss', setlang: 'en' })}`, {
      headers: { Accept: 'application/rss+xml, application/xml' },
    });
    return { results: parseBingNews(xml) };
  },
};

export async function searchNews(q) {
  const out = await firstSuccessful(
    [brave, googleNews, bingNews].filter((p) => p.enabled()),
    async (p) => {
      const r = await p.search(q);
      return { results: r.results.filter(Boolean) };
    }
  );
  out.results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out;
}
