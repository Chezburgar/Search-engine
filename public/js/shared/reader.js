// Reader view: a web page as simple Markdown (headings, paragraphs, lists, quotes, code and
// links), for showing pages inside Spark tabs and for the tab assistant to read. Everything
// here is plain string work, so the server and the browser share it.

import { decodeEntities, stripTags, tagText, attr, metaContent } from './text.js';

const MAX_MARKDOWN = 60_000;

export function isWebUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// What the address box means: a URL, a bare domain, or (else) a search.
export function parseAddress(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  if (isWebUrl(text)) return { url: new URL(text).href };
  if (/^[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/.test(text) && !/\s/.test(text)) return { url: `https://${text}` };
  return { search: text };
}

// Sections that are lists of references rather than content.
const TAIL_SECTIONS =
  /^#{1,6}\s+(references|notes|citations|sources|footnotes|external links|further reading|bibliography)\s*$/i;

const JUNK_ELEMENTS =
  /<(script|style|noscript|svg|template|iframe|canvas|form|select|button|nav|footer|header|aside|table|figure|math|object|video|audio)\b[\s\S]*?<\/\1>/gi;
// Wikipedia and other wikis: edit links, footnote markers, coordinates and the like.
const JUNK_INLINE =
  /<(span|sup|div|ol|ul|link)\b[^>]*class="[^"]*\b(mw-editsection|reference|noprint|mw-empty-elt|navbox|metadata|mw-references-wrap|references|toc|sr-only|visually-hidden)\b[^"]*"[^>]*>[\s\S]*?<\/\1>/gi;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

// An absolute http(s) link that our Markdown renderer can show as-is.
function linkTarget(href, base) {
  try {
    const url = new URL(decodeEntities(href), base);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (base && url.href.split('#')[0] === String(base).split('#')[0]) return ''; // same-page anchors
    return url.href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20');
  } catch {
    return '';
  }
}

const inlineText = (html) => stripTags(html).replace(/[[\]]/g, '');

// The page's main content, as Markdown.
export function htmlToMarkdown(html = '', base = '') {
  let body = String(html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<head\b[\s\S]*?<\/head>/i, ' ')
    .replace(JUNK_ELEMENTS, ' ')
    .replace(JUNK_INLINE, ' ')
    .replace(/<img\b[^>]*>/gi, ' ');

  const main =
    body.match(/<article\b[\s\S]*<\/article>/i) ||
    body.match(/<main\b[\s\S]*<\/main>/i) ||
    body.match(
      /<div\b[^>]*(?:id|class)="[^"]*\b(mw-parser-output|mw-content-text|content|post-content|entry-content)\b[\s\S]*/i
    );
  if (main && stripTags(main[0]).length > 400) body = main[0];

  const codes = [];
  body = body
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, inner) => {
      codes.push(decodeEntities(inner.replace(/<[^>]*>/g, '')).replace(/\n+$/, ''));
      return `\n\n\u0000${codes.length - 1}\u0000\n\n`;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, inner) => {
      const text = inlineText(inner);
      return text ? `\n\n${'#'.repeat(Number(n))} ${text}\n\n` : '\n\n';
    })
    .replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_, attrs, inner) => {
      const text = inlineText(inner);
      if (!text) return ' ';
      const href = linkTarget(attr(` ${attrs}`, 'href'), base);
      return href ? `[${text}](${href})` : text;
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, t, inner) => {
      const text = inner.trim();
      return text && !/\n/.test(text) ? `**${text}**` : inner;
    })
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<blockquote\b[^>]*>/gi, '\n\n> ')
    .replace(/<\/li>/gi, ' ')
    .replace(/<\/(p|div|section|article|main|ul|ol|blockquote|dd|dt|figcaption|tr|details|summary)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<(p|div|section|ul|ol|dl|dd|dt)\b[^>]*>/gi, '\n\n')
    .replace(/<[^>]*>/g, ' ');

  const blocks = [];
  for (const raw of decodeEntities(body).split(/\n{2,}/)) {
    const lines = raw
      .split('\n')
      .map((l) => l.replace(/[ \t ]+/g, ' ').trim())
      .filter((l) => l && l !== '-' && l !== '>');
    if (!lines.length) continue;
    const block = lines.join(lines.every((l) => l.startsWith('- ')) ? '\n' : ' ');
    // Drop leftover menu crumbs: tiny blocks that aren't headings, lists or code.
    if (block.length < 3 && !/^\u0000/.test(block)) continue;
    blocks.push(block);
  }

  let markdown = blocks
    .join('\n\n')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => `\`\`\`\n${codes[Number(i)]}\n\`\`\``)
    .replace(/\*\*\s*\*\*/g, '');

  const lines = markdown.split('\n');
  const tail = lines.findIndex((l, i) => i > 5 && TAIL_SECTIONS.test(l));
  if (tail > 0) markdown = lines.slice(0, tail).join('\n');
  return markdown.trim().slice(0, MAX_MARKDOWN);
}

// A full HTML page → { title, site, description, markdown }.
export function htmlToReader(html = '', url = '') {
  const title =
    stripTags(metaContent(html, 'og:title')) || stripTags(tagText(html, 'title')) || stripTags(tagText(html, 'h1'));
  return {
    title: title.slice(0, 300),
    site: metaContent(html, 'og:site_name') || hostOf(url),
    description: metaContent(html, 'description') || metaContent(html, 'og:description'),
    markdown: htmlToMarkdown(html, url),
  };
}

// Plain text with paragraphs (e.g. from a page fetcher that strips HTML) → Markdown.
export const textToMarkdown = (text = '') =>
  String(text)
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, MAX_MARKDOWN);

// Jina Reader Markdown: drop images and setext underlines our renderer doesn't know.
export function cleanReaderMarkdown(md = '') {
  const lines = String(md)
    .replace(/\r/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[\s*\]\([^)]*\)/g, '')
    .split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const next = lines[i + 1] || '';
    if (lines[i].trim() && /^\s*(=+|-{3,})\s*$/.test(next) && !/^\s*[-*>#|]/.test(lines[i])) {
      out.push(`${/=/.test(next) ? '#' : '##'} ${lines[i].trim()}`);
      i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_MARKDOWN);
}

// Markdown → plain text (for the assistant, which doesn't need link targets).
export const markdownToText = (md = '') =>
  String(md)
    .replace(/```[a-z]*\n?/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*/g, '')
    .trim();

// "https://en.wikipedia.org/wiki/Black_hole" → { lang: 'en', title: 'Black hole' }
export function wikipediaArticle(url) {
  try {
    const u = new URL(url);
    const m = u.hostname.match(/^([a-z-]{2,12})(?:\.m)?\.wikipedia\.org$/);
    const path = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!m || !path) return null;
    const title = decodeURIComponent(path[1]).replace(/_/g, ' ');
    if (/^(Special|File|Talk|User|Wikipedia|Help|Template|Category|Portal):/i.test(title)) return null;
    return { lang: m[1], title };
  } catch {
    return null;
  }
}

export const wikipediaParseUrl = ({ lang, title }) =>
  `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
    action: 'parse',
    page: title,
    prop: 'text',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    disableeditsection: '1',
    disabletoc: '1',
    origin: '*',
  })}`;

export function wikipediaToReader(data, { lang, title }) {
  const parsed = data?.parse;
  if (!parsed?.text) return null;
  const pageTitle = parsed.title || title;
  const url = `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`;
  return { url, title: pageTitle, site: 'Wikipedia', markdown: htmlToMarkdown(parsed.text, url) };
}
