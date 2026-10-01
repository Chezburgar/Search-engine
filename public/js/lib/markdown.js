// Small, safe Markdown renderer for AI answers. Everything is HTML-escaped
// first; only a fixed set of constructs is turned back into markup.

const esc = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function expandCitations(spec) {
  const out = [];
  for (const part of spec.split(/\s*,\s*/)) {
    const range = part.match(/^(\d+)\s*[–-]\s*(\d+)$/);
    if (range) {
      const [a, b] = [Number(range[1]), Number(range[2])];
      for (let n = a; n <= Math.min(b, a + 9); n++) out.push(n);
    } else out.push(Number(part));
  }
  return out.filter((n) => n > 0 && n < 100);
}

function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
  s = esc(s);
  s = s.replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`
  );
  s = s
    .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>')
    .replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![*\w])/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^\w])_(?=[^\s_])([^_\n]*?[^\s_])_(?!\w)/g, '$1<em>$2</em>');
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>');
  // Citations: [1], [1, 3], [2-4], [^1], 【1】
  s = s.replace(/\s?(?:\[\^?(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\]|【(\d{1,2})】)(?!\()/g, (_, a, b) =>
    expandCitations(a || b)
      .map((n) => `<a class="cite" data-n="${n}">${n}</a>`)
      .join('')
  );
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[Number(i)])}</code>`);
}

const LIST = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/;
const FENCE = /^\s*```/;
const isTableDivider = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const splitRow = (l) =>
  l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

function buildList(items) {
  let idx = 0;
  const build = (level) => {
    const first = items[idx];
    const tag = first.ordered ? 'ol' : 'ul';
    let out = `<${tag}${first.ordered && first.num > 1 ? ` start="${first.num}"` : ''}>`;
    while (idx < items.length && items[idx].indent >= level) {
      const it = items[idx++];
      out += `<li>${inline(it.text)}`;
      if (idx < items.length && items[idx].indent > it.indent) out += build(items[idx].indent);
      out += '</li>';
    }
    return `${out}</${tag}>`;
  };
  let html = '';
  while (idx < items.length) html += build(items[idx].indent);
  return html;
}

export function renderMarkdown(src = '') {
  const lines = src.replace(/\r/g, '').split('\n');
  let html = '';
  let i = 0;
  const startsBlock = (l) => FENCE.test(l) || /^#{1,6}\s/.test(l) || LIST.test(l) || /^\s*>/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (FENCE.test(line)) {
      const lang = line.trim().slice(3).trim();
      const code = [];
      i++;
      while (i < lines.length && !FENCE.test(lines[i])) code.push(lines[i++]);
      i++;
      html += `<pre${lang ? ` data-lang="${esc(lang)}"` : ''}><code>${esc(code.join('\n'))}</code></pre>`;
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*$/);
    if (heading) {
      const level = Math.min(Math.max(heading[1].length + 1, 3), 5);
      html += `<h${level}>${inline(heading[2])}</h${level}>`;
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      html += '<hr>';
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) quote.push(lines[i++].replace(/^\s*>\s?/, ''));
      html += `<blockquote>${renderMarkdown(quote.join('\n'))}</blockquote>`;
      continue;
    }
    if (line.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) =>
        c.startsWith(':') && c.endsWith(':') ? ' class="al-c"' : c.endsWith(':') ? ' class="al-r"' : ''
      );
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      html += `<div class="md-table"><table><thead><tr>${head
        .map((c, j) => `<th${align[j] || ''}>${inline(c)}</th>`)
        .join('')}</tr></thead><tbody>${rows
        .map((r) => `<tr>${head.map((_, j) => `<td${align[j] || ''}>${inline(r[j] || '')}</td>`).join('')}</tr>`)
        .join('')}</tbody></table></div>`;
      continue;
    }
    if (LIST.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(LIST);
        if (m) {
          items.push({
            indent: m[1].replace(/\t/g, '    ').length,
            ordered: /\d/.test(m[2]),
            num: parseInt(m[2], 10) || 1,
            text: m[3],
          });
          i++;
        } else if (!lines[i].trim() && i + 1 < lines.length && LIST.test(lines[i + 1])) {
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += ` ${lines[i++].trim()}`;
        } else break;
      }
      html += buildList(items);
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !(para.length && startsBlock(lines[i]))) {
      if (lines[i].includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) break;
      para.push(lines[i++].trim());
    }
    html += `<p>${inline(para.join('\n')).replace(/\n/g, '<br>')}</p>`;
  }
  return html;
}

// Turns citation markers into links to their sources (or plain text if unknown).
export function hydrateCitations(root, sources = []) {
  const byN = new Map(sources.map((s) => [Number(s.n), s]));
  for (const a of root.querySelectorAll('a.cite')) {
    const s = byN.get(Number(a.dataset.n));
    if (!s) {
      a.remove();
      continue;
    }
    a.href = s.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.dataset.title = s.title;
    a.dataset.host = s.host;
    a.setAttribute('aria-label', `Source ${s.n}: ${s.title}`);
  }
}

// Renders `text` into `el`, with a typing caret at the end while streaming.
export function renderInto(el, text, { sources, streaming } = {}) {
  el.innerHTML = renderMarkdown(text);
  hydrateCitations(el, sources);
  if (streaming) {
    let target = el.lastElementChild || el;
    while (target.lastElementChild && /^(UL|OL|LI|BLOCKQUOTE|DIV|TABLE|TBODY|THEAD|TR)$/.test(target.tagName)) {
      target = target.lastElementChild;
    }
    if (/^(UL|OL|TABLE|TBODY|TR|PRE|HR)$/.test(target.tagName)) target = el;
    const caret = document.createElement('span');
    caret.className = 'caret';
    target.append(caret);
  }
}

// Strips Markdown for copying answers as plain text.
export function toPlainText(text) {
  return text
    .replace(/\s?\[\^?\d{1,2}(?:\s*[,–-]\s*\d{1,2})*\](?!\()/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .trim();
}
