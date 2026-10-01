import { ICONS } from './icons.js';

// Tiny element builder. Strings become text nodes, so untrusted text is never parsed as HTML.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key === 'html')
      el.innerHTML = value; // trusted, app-generated markup only
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) el.addEventListener(ev, fn);
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `icon ${cls}`.trim();
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = ICONS[name] || '';
  return span;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Replaces an element's children; like `append`, skips null/false and flattens arrays.
export function fill(el, ...children) {
  return append(clear(el), children);
}

const STOPWORDS = new Set(
  'a an and are as at be by can do does did for from how i in is it of on or the to what when where who why with you'.split(
    ' '
  )
);

// Wraps whole-word, case-insensitive matches of the query's words (and simple plurals) in <b>.
export function highlight(text, query) {
  const words = [
    ...new Set(
      String(query)
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
    ),
  ].filter((w) => w.length > 1 && !STOPWORDS.has(w));
  if (!words.length || !text) return [text];
  const base = (w) => (w.length > 3 ? w.replace(/(ss|x|z|ch|sh)es$/, '$1').replace(/([^s])s$/, '$1') : w);
  const alt = [...new Set(words.map(base))].map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])((?:${alt})(?:s|es)?)(?![\\p{L}\\p{N}])`, 'giu');
  return text.split(re).map((part, i) => (i % 2 ? h('b', {}, part) : part));
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

let toastTimer;
export function toast(message) {
  let el = $('.toast');
  if (!el) {
    el = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  requestAnimationFrame(() => el.classList.add('is-visible'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copied to clipboard');
  } catch {
    toast('Copy failed — select the text instead');
  }
}

const progressEl = () => $('#progress');
let progressTimer;
export const progress = {
  start() {
    const el = progressEl();
    if (!el) return;
    clearTimeout(progressTimer);
    el.style.transition = 'none';
    el.style.width = '0';
    el.classList.add('is-active');
    requestAnimationFrame(() => {
      el.style.transition = '';
      el.style.width = '72%';
    });
  },
  done() {
    const el = progressEl();
    if (!el) return;
    el.style.width = '100%';
    progressTimer = setTimeout(() => {
      el.classList.remove('is-active');
      el.style.width = '0';
    }, 350);
  },
};
