const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ensp: ' ',
  emsp: ' ',
  thinsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  bdquo: '„',
  laquo: '«',
  raquo: '»',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  times: '×',
  divide: '÷',
  plusmn: '±',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  euro: '€',
  pound: '£',
  yen: '¥',
  cent: '¢',
  sect: '§',
  para: '¶',
  zwj: '',
  zwnj: '',
  shy: '',
};

export function decodeEntities(str = '') {
  return str.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return m;
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    const named = NAMED[body.toLowerCase()];
    return named === undefined ? m : named;
  });
}

export function stripTags(html = '') {
  return decodeEntities(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull out the text of a <tag ...>...</tag> (first match) from an XML/HTML fragment.
export function tagText(fragment, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i');
  const m = fragment.match(re);
  if (!m) return '';
  return m[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1');
}

export function attr(fragment, name) {
  const m = fragment.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'));
  return m ? decodeEntities(m[2] ?? m[3] ?? '') : '';
}

export function metaContent(html, key) {
  const re = new RegExp(`<meta[^>]+(?:name|property)\\s*=\\s*["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re);
  return tag ? attr(tag[0], 'content') : '';
}

const BLOCK_TAGS = /<\/(p|div|section|article|li|h[1-6]|tr|br|blockquote|pre|dd|dt|figcaption|td)>|<br\s*\/?>/gi;

// Rough "reader mode": keeps the main content of a page as plain text.
export function extractReadable(html = '') {
  const title = stripTags(tagText(html, 'title')) || metaContent(html, 'og:title');
  const description = metaContent(html, 'description') || metaContent(html, 'og:description');
  const siteName = metaContent(html, 'og:site_name');

  let body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|canvas|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ');

  const main = body.match(/<article\b[\s\S]*?<\/article>/i) || body.match(/<main\b[\s\S]*?<\/main>/i);
  if (main && stripTags(main[0]).length > 400) body = main[0];

  const text = decodeEntities(body.replace(BLOCK_TAGS, '\n').replace(/<[^>]*>/g, ' '))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 30 || /[.!?:]$/.test(line))
    .join('\n');

  return { title, description, siteName, text };
}

// Picks the passages most relevant to `query`, up to `budget` characters,
// keeping them in document order. Short lines (menus, buttons, footers) are dropped.
export function relevantPassages(text, query, budget = 1400) {
  if (!text) return '';
  const terms = [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 2)
    ),
  ];
  const chunks = text
    .split(/\n+/)
    .flatMap((p) => (p.length > 600 ? p.match(/[^.!?]+[.!?]+\s*/g) || [p] : [p]))
    .map((t, i) => {
      const lower = t.toLowerCase();
      const score = terms.reduce((s, term) => s + (lower.includes(term) ? 1 : 0), 0) + (i < 3 ? 0.5 : 0);
      return { t: t.trim(), i, score };
    })
    .filter((c) => c.t.length > 20);
  const picked = [];
  let used = 0;
  for (const c of [...chunks].sort((a, b) => b.score - a.score || a.i - b.i)) {
    if (used + c.t.length > budget) continue;
    picked.push(c);
    used += c.t.length + 1;
    if (used > budget * 0.92) break;
  }
  return picked
    .sort((a, b) => a.i - b.i)
    .map((c) => c.t)
    .join('\n');
}
