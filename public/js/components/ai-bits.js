import { h, clear } from '../lib/dom.js';
import { favicon, siteName } from '../lib/format.js';

// A numbered source link under an AI answer.
export function sourceChip(s) {
  return h(
    'a',
    { class: 'source-chip', href: s.url, title: s.title },
    h('img', { src: favicon(s.host), alt: '', width: 16, height: 16, loading: 'lazy' }),
    h('span', { class: 'source-chip__host' }, siteName(s.host)),
    h('span', { class: 'source-chip__n' }, String(s.n))
  );
}

// "Searching the web…" with skeleton lines, then the favicons of the sources being read.
export function loadingBlock(label = 'Searching the web') {
  const text = h('span', { class: 'ai-loading__text shimmer-text' }, `${label}…`);
  const icons = h('span', { class: 'ai-loading__icons' });
  return {
    el: h(
      'div',
      { class: 'ai-loading' },
      h('div', { class: 'ai-loading__status' }, text, icons),
      h('div', { class: 'skeleton-line w-100' }),
      h('div', { class: 'skeleton-line w-92' }),
      h('div', { class: 'skeleton-line w-64' })
    ),
    setStage(label) {
      text.textContent = `${label}…`;
    },
    setSources(sources) {
      clear(icons);
      sources.slice(0, 6).forEach((s, i) => {
        const img = h('img', { src: favicon(s.host), alt: '', width: 18, height: 18 });
        img.style.animationDelay = `${i * 70}ms`;
        icons.append(img);
      });
    },
  };
}
