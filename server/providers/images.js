import { config } from '../config.js';
import { fetchJSON, qs, BOT_UA } from '../lib/http.js';
import { firstSuccessful } from './normalize.js';
import { image, openverseUrl, mapOpenverse, commonsUrl, mapCommons } from '../../public/js/shared/images.js';

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
  search: async (q, page) =>
    mapOpenverse(await fetchJSON(openverseUrl(q, page), { headers: { 'User-Agent': BOT_UA } }), page),
};

const commons = {
  name: 'Wikimedia Commons',
  enabled: () => true,
  search: async (q, page) => mapCommons(await fetchJSON(commonsUrl(q, page), { headers: { 'User-Agent': BOT_UA } })),
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
