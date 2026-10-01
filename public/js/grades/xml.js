// A small XML parser for StudentVUE responses (works in the browser and in Node).
// Produces { name, attrs, children, text } elements; enough for SOAP and gradebook XML.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXml(s = '') {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return m;
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export const escapeXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const ATTR = /([^\s=/>]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
const localName = (n) => n.slice(n.indexOf(':') + 1);

export function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' };
  const stack = [root];
  let i = 0;
  const src = String(xml || '');
  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) {
      stack[stack.length - 1].text += decodeXml(src.slice(i));
      break;
    }
    if (lt > i) stack[stack.length - 1].text += decodeXml(src.slice(i, lt));
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
    } else if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += src.slice(lt + 9, end === -1 ? src.length : end);
      i = end === -1 ? src.length : end + 3;
    } else if (src[lt + 1] === '?' || src[lt + 1] === '!') {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
    } else if (src[lt + 1] === '/') {
      const end = src.indexOf('>', lt);
      const name = localName(src.slice(lt + 2, end).trim());
      // Close up to the matching element (tolerates stray tags).
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? src.length : end + 1;
    } else {
      // Find the tag's end, skipping '>' inside quoted attribute values.
      let j = lt + 1;
      let quote = null;
      for (; j < src.length; j++) {
        const c = src[j];
        if (quote) {
          if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
      }
      const raw = src.slice(lt + 1, j);
      const selfClosing = raw.endsWith('/');
      const body = selfClosing ? raw.slice(0, -1) : raw;
      const nameEnd = body.search(/[\s/]|$/);
      const el = { name: localName(body.slice(0, nameEnd)), attrs: {}, children: [], text: '' };
      ATTR.lastIndex = 0;
      const attrSrc = body.slice(nameEnd);
      let m;
      while ((m = ATTR.exec(attrSrc))) {
        el.attrs[m[1]] = decodeXml(m[2] ?? m[3] ?? m[4] ?? '');
      }
      stack[stack.length - 1].children.push(el);
      if (!selfClosing) stack.push(el);
      i = j + 1;
    }
  }
  return root;
}

/* ------------------------------- traversal ------------------------------- */

export const kids = (el, name) => (el?.children || []).filter((c) => !name || c.name === name);
export const kid = (el, name) => (el?.children || []).find((c) => c.name === name) || null;
export const attr = (el, name) => (el?.attrs?.[name] ?? '').trim();
export const text = (el) => (el?.text || '').trim();

// First element with this name anywhere below `el` (depth-first).
export function find(el, name) {
  for (const c of el?.children || []) {
    if (c.name === name) return c;
    const hit = find(c, name);
    if (hit) return hit;
  }
  return null;
}

// Follows a path of child names: path(doc, 'Gradebook', 'Courses').
export function path(el, ...names) {
  let cur = el;
  for (const n of names) cur = kid(cur, n);
  return cur;
}
