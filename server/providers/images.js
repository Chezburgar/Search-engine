import { config } from '../config.js';
import { fetchJSON, qs, BOT_UA } from '../lib/http.js';
import { stripTags } from '../lib/html.js';
import { firstSuccessful, hostOf } from './normalize.js';

function image({ title, url, thumbnail, width, height, pageUrl, source, license, creator }) {
  if (!thumbnail || !/^https?:/i.test(thumbnail)) return null;
  return {
    title: stripTags(title || '').slice(0, 160) || 'Image',
    url: url || thumbnail,
    thumbnail,
    width: Number(width) || 400,
    height: Number(height) || 300,
    pageUrl: pageUrl || url,
    source: source || hostOf(pageUrl || url),
    license: license || null,
    creator: creator || null,
  };
}

const brave = {
  name: 'Brave',
  enabled: () => Boolean(config.braveKey),
  async search(q, page) {
    if (page > 1) return { results: [] };
    const data = await fetchJSON(`https://api.search.brave.com/res/v1/images/search?${qs({ q, count: 100 })}`, {
      headers: { 'X-Subscription-Token': config.braveKey },
    });
    return {
      results: (data.results || []).map((r) =>
        image({
          title: r.title,
          url: r.properties?.url,
          thumbnail: r.thumbnail?.src,
          width: r.properties?.width || r.thumbnail?.width,
          height: r.properties?.height || r.thumbnail?.height,
          pageUrl: r.url,
          source: r.source,
        })
      ),
      more: false,
    };
  },
};

const openverse = {
  name: 'Openverse',
  enabled: () => true,
  async search(q, page) {
    const data = await fetchJSON(
      `https://api.openverse.org/v1/images/?${qs({ q, page, page_size: 20, mature: 'false' })}`,
      { headers: { 'User-Agent': BOT_UA } }
    );
    return {
      results: (data.results || []).map((r) =>
        image({
          title: r.title,
          url: r.url,
          thumbnail: r.thumbnail || r.url,
          width: r.width,
          height: r.height,
          pageUrl: r.foreign_landing_url,
          source: r.source || r.provider,
          license: r.license ? `CC ${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim() : null,
          creator: r.creator,
        })
      ),
      more: page < (data.page_count || 1),
    };
  },
};

const commons = {
  name: 'Wikimedia Commons',
  enabled: () => true,
  async search(q, page) {
    const data = await fetchJSON(
      `https://commons.wikimedia.org/w/api.php?${qs({
        action: 'query',
        format: 'json',
        formatversion: 2,
        generator: 'search',
        gsrsearch: `filetype:bitmap ${q}`,
        gsrnamespace: 6,
        gsrlimit: 30,
        gsroffset: (page - 1) * 30,
        prop: 'imageinfo',
        iiprop: 'url|size|extmetadata',
        iiurlwidth: 480,
      })}`,
      { headers: { 'User-Agent': BOT_UA } }
    );
    const pages = (data.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
    return {
      results: pages.map((p) => {
        const info = p.imageinfo?.[0] || {};
        const meta = info.extmetadata || {};
        return image({
          title: stripTags(meta.ObjectName?.value || p.title.replace(/^File:/, '').replace(/\.\w+$/, '')),
          url: info.url,
          thumbnail: info.thumburl,
          width: info.thumbwidth || info.width,
          height: info.thumbheight || info.height,
          pageUrl: info.descriptionurl,
          source: 'Wikimedia Commons',
          license: stripTags(meta.LicenseShortName?.value || ''),
          creator: stripTags(meta.Artist?.value || ''),
        });
      }),
      more: Boolean(data.continue),
    };
  },
};

export async function searchImages(q, { page = 1, provider } = {}) {
  const providers = [brave, openverse, commons].filter((p) => p.enabled());
  const chosen = provider ? providers.filter((p) => p.name === provider) : providers;
  const out = await firstSuccessful(chosen, async (p) => {
    const r = await p.search(q, page);
    return { results: r.results.filter(Boolean), more: r.more };
  });
  return { results: out.results, provider: out.provider, more: Boolean(out.more), errors: out.errors };
}
