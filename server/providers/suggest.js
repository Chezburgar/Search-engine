import { fetchJSON, qs } from '../lib/http.js';

function clean(list, q) {
  const seen = new Set();
  return (Array.isArray(list) ? list : [])
    .map((s) => (typeof s === 'string' ? s : s?.phrase || ''))
    .map((s) => s.trim())
    .filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 8);
}

async function google(q) {
  const data = await fetchJSON(
    `https://suggestqueries.google.com/complete/search?${qs({ client: 'firefox', hl: 'en', ie: 'utf-8', oe: 'utf-8', q })}`,
    { timeout: 2500 }
  );
  return data[1];
}

async function duckduckgo(q) {
  const data = await fetchJSON(`https://duckduckgo.com/ac/?${qs({ q, type: 'list' })}`, { timeout: 2500 });
  return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : data;
}

export async function suggest(q) {
  for (const source of [google, duckduckgo]) {
    try {
      const list = clean(await source(q), q);
      if (list.length) return list;
    } catch {}
  }
  return [];
}
