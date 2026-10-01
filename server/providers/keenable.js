import { config } from '../config.js';
import { fetchJSON } from '../lib/http.js';
import {
  keenableRequest,
  searchBody,
  mapKeenableResults,
  mapKeenableFetch,
  pageWindow,
  hasMore,
} from '../../public/js/shared/keenable.js';
import { normalizeResult } from './normalize.js';
import { encodeCursor } from './cursor.js';

const call = ({ path, body, query, timeout = 8000, signal }) => {
  const { url, init } = keenableRequest({ ...config.keenable, path, body, query });
  return fetchJSON(url, { ...init, timeout, signal });
};

export const keenableEnabled = () => true; // the keyless public endpoint works without a key

export const keenable = {
  name: 'Keenable',
  enabled: keenableEnabled,
  async search(q, { page = 1 }) {
    const { want, from } = pageWindow(page);
    const all = mapKeenableResults(await call({ path: '/v1/search', body: searchBody(q, want) }), q);
    return {
      results: all.slice(from, want).map(normalizeResult),
      next: hasMore(all.length, want) ? encodeCursor({ p: 'Keenable', page: page + 1 }) : null,
    };
  },
};

// A page as text via Keenable's fetcher: { url, title, text }.
export async function keenableFetch(url, { signal, maxChars = 20000 } = {}) {
  const data = await call({ path: '/v1/fetch', query: { url, max_chars: String(maxChars) }, signal });
  return mapKeenableFetch(data, url);
}
