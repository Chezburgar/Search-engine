import { h, icon, clear, progress, fill } from '../lib/dom.js';
import { getJSON } from '../lib/api.js';
import { favicon, siteName } from '../lib/format.js';
import { emptyState } from './all.js';

const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

function openViewer(images, start) {
  let index = start;
  const prevFocus = document.activeElement;
  const img = h('img', { class: 'viewer__img', alt: '' });
  const info = h('div', { class: 'viewer__info' });
  const prevBtn = h(
    'button',
    { class: 'viewer__nav viewer__nav--prev', type: 'button', 'aria-label': 'Previous image' },
    icon('chevronLeft')
  );
  const nextBtn = h(
    'button',
    { class: 'viewer__nav viewer__nav--next', type: 'button', 'aria-label': 'Next image' },
    icon('chevronRight')
  );
  const closeBtn = h('button', { class: 'iconbtn viewer__close', type: 'button', 'aria-label': 'Close' }, icon('x'));
  const dialog = h(
    'div',
    { class: 'viewer', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Image viewer' },
    h('div', { class: 'viewer__backdrop', on: { click: () => close() } }),
    h('div', { class: 'viewer__panel' }, closeBtn, h('div', { class: 'viewer__stage' }, prevBtn, img, nextBtn), info)
  );

  function show() {
    const it = images[index];
    img.src = it.thumbnail;
    img.alt = it.title;
    const full = new Image();
    full.onload = () => images[index] === it && (img.src = it.url);
    full.src = it.url;
    const host = hostOf(it.pageUrl);
    fill(
      info,
      h(
        'div',
        { class: 'viewer__source' },
        h('img', { src: favicon(host), alt: '', width: 16, height: 16 }),
        siteName(it.source || host)
      ),
      h('h2', { class: 'viewer__title' }, it.title),
      h(
        'p',
        { class: 'viewer__meta' },
        [
          it.width && it.height ? `${it.width} × ${it.height}` : null,
          it.creator ? `by ${it.creator}` : null,
          it.license,
        ]
          .filter(Boolean)
          .join(' · ')
      ),
      h(
        'div',
        { class: 'viewer__actions' },
        h(
          'a',
          { class: 'btn btn--spark btn--sm', href: it.pageUrl, target: '_blank', rel: 'noopener' },
          'Visit page',
          icon('external')
        ),
        h(
          'a',
          { class: 'btn btn--ghost btn--sm', href: it.url, target: '_blank', rel: 'noopener' },
          icon('image'),
          'Full image'
        )
      )
    );
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === images.length - 1;
  }
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft' && index > 0) (index--, show());
    else if (e.key === 'ArrowRight' && index < images.length - 1) (index++, show());
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('no-scroll');
    dialog.remove();
    prevFocus?.focus?.();
  }
  prevBtn.addEventListener('click', () => index > 0 && (index--, show()));
  nextBtn.addEventListener('click', () => index < images.length - 1 && (index++, show()));
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.classList.add('no-scroll');
  document.body.append(dialog);
  show();
  closeBtn.focus();
}

export function renderImages(root, { q, signal }) {
  const grid = h('div', { class: 'img-grid' });
  const sentinel = h('div', { class: 'img-sentinel' });
  const status = h('p', { class: 'serp__meta' });
  root.replaceChildren(h('div', { class: 'images' }, status, grid, sentinel));

  const images = [];
  let page = 1;
  let provider = null;
  let more = true;
  let loading = false;

  for (let i = 0; i < 18; i++) {
    const ph = h('div', { class: 'img-tile img-tile--ph' });
    const ratio = [1.5, 0.75, 1.33, 1, 1.78, 0.8][i % 6];
    ph.style.flexGrow = ratio;
    ph.style.flexBasis = `${ratio * 190}px`;
    grid.append(ph);
  }

  async function load() {
    if (loading || !more) return;
    loading = true;
    if (page === 1) progress.start();
    try {
      const data = await getJSON('/api/images', { q, page, provider }, { signal });
      if (page === 1) {
        clear(grid);
        progress.done();
        if (!data.results.length) {
          root.replaceChildren(
            emptyState({ title: `No images found for “${q}”`, text: 'Try a broader or different search.' })
          );
          return;
        }
        status.textContent = data.provider ? `Images from ${data.provider}` : '';
      }
      provider = data.provider;
      more = data.more;
      page++;
      for (const it of data.results) {
        const i = images.push(it) - 1;
        const ratio = Math.min(Math.max(it.width / it.height || 1.3, 0.5), 2.4);
        const tile = h(
          'button',
          { class: 'img-tile', type: 'button', 'aria-label': it.title, on: { click: () => openViewer(images, i) } },
          h('img', {
            src: it.thumbnail,
            alt: it.title,
            loading: 'lazy',
            decoding: 'async',
            referrerpolicy: 'no-referrer',
          }),
          h(
            'span',
            { class: 'img-tile__cap' },
            h('span', { class: 'img-tile__src' }, siteName(it.source || hostOf(it.pageUrl))),
            h('span', { class: 'img-tile__title' }, it.title)
          )
        );
        tile.style.flexGrow = ratio;
        tile.style.flexBasis = `${ratio * 190}px`;
        tile.querySelector('img').addEventListener('error', () => tile.remove());
        grid.append(tile);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      progress.done();
      if (page === 1)
        root.replaceChildren(
          emptyState({ title: 'Images are unavailable right now', text: 'Please try again in a moment.' })
        );
      more = false;
    } finally {
      loading = false;
    }
  }

  const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), {
    rootMargin: '600px',
  });
  observer.observe(sentinel);
  signal.addEventListener('abort', () => observer.disconnect());
  load();
}
