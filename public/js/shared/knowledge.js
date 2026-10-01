const STOP = new Set(
  'a an the of in on at to for and or is are was were be been what who whom whose which when where why how do does did can could should would will tell me about define definition meaning explain vs versus with from by its it this that'.split(
    ' '
  )
);

const tokens = (s) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
const stem = (t) =>
  t.length <= 3
    ? t
    : t
        .replace(/ies$/, 'y')
        .replace(/(ss|x|z|ch|sh)es$/, '$1')
        .replace(/([^s])s$/, '$1');

// Only show a panel when the query is plausibly *about* the article,
// e.g. "black holes" → "Black hole", but not "how to cook rice" → "Rice".
export function matchesEntity(query, title) {
  const q = tokens(query)
    .filter((t) => !STOP.has(t))
    .map(stem);
  const t = tokens(title)
    .filter((x) => !STOP.has(x))
    .map(stem);
  if (!q.length || !t.length) return false;
  const covered = t.every((x) => q.includes(x));
  const extra = q.filter((x) => !t.includes(x)).length;
  return covered && extra <= (q.length >= 4 ? 1 : 0) + (t.length >= 2 ? 1 : 0);
}

// `cors` adds origin=* so browsers may call the MediaWiki API directly.
export function wikiSearchUrl(q, lang = 'en', { cors = false } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: q,
    srlimit: '3',
    srprop: '',
    format: 'json',
    formatversion: '2',
  });
  if (cors) params.set('origin', '*');
  return `https://${lang}.wikipedia.org/w/api.php?${params}`;
}

export const wikiSummaryUrl = (title, lang = 'en') =>
  `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`;

export function pickEntity(q, search) {
  return (search?.query?.search || []).find((r) => matchesEntity(q, r.title)) || null;
}

export function knowledgeFromSummary(s, lang = 'en') {
  if (!s || s.type === 'disambiguation' || !s.extract) return null;
  return {
    title: s.title,
    description: s.description || '',
    extract: s.extract,
    url: s.content_urls?.desktop?.page || `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(s.title)}`,
    image: s.thumbnail ? { src: s.thumbnail.source, width: s.thumbnail.width, height: s.thumbnail.height } : null,
    source: 'Wikipedia',
  };
}
