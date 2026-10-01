import { h, icon, clear, progress, fill } from '../lib/dom.js';
import { getJSON } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import { emptyState } from './all.js';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const views = (n) => (n == null ? null : `${compact.format(n)} view${n === 1 ? '' : 's'}`);

// Plays a video inside Spark (privacy-enhanced YouTube embed).
function openPlayer(videos, start) {
  let index = start;
  const prevFocus = document.activeElement;
  const frameBox = h('div', { class: 'player__frame' });
  const info = h('div', { class: 'viewer__info' });
  const prevBtn = h(
    'button',
    { class: 'viewer__nav viewer__nav--prev', type: 'button', 'aria-label': 'Previous video' },
    icon('chevronLeft')
  );
  const nextBtn = h(
    'button',
    { class: 'viewer__nav viewer__nav--next', type: 'button', 'aria-label': 'Next video' },
    icon('chevronRight')
  );
  const closeBtn = h('button', { class: 'iconbtn viewer__close', type: 'button', 'aria-label': 'Close' }, icon('x'));
  const dialog = h(
    'div',
    { class: 'viewer viewer--video', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Video player' },
    h('div', { class: 'viewer__backdrop', on: { click: () => close() } }),
    h(
      'div',
      { class: 'viewer__panel' },
      closeBtn,
      h('div', { class: 'viewer__stage' }, prevBtn, frameBox, nextBtn),
      info
    )
  );

  function show() {
    const v = videos[index];
    fill(
      frameBox,
      h('iframe', {
        src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(v.id)}?autoplay=1&rel=0`,
        title: v.title,
        allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      })
    );
    fill(
      info,
      h('div', { class: 'viewer__source' }, icon('play', 'video-yt'), v.channel),
      h('h2', { class: 'viewer__title' }, v.title),
      h('p', { class: 'viewer__meta' }, [views(v.views), v.date ? timeAgo(v.date) : null].filter(Boolean).join(' · ')),
      v.description ? h('p', { class: 'player__desc' }, v.description) : null,
      h(
        'div',
        { class: 'viewer__actions' },
        h(
          'a',
          { class: 'btn btn--ghost btn--sm', href: v.url, target: '_blank', rel: 'noopener', 'data-external': '' },
          'Open on YouTube',
          icon('external')
        )
      )
    );
    prevBtn.disabled = index === 0;
    nextBtn.disabled = index === videos.length - 1;
  }
  const step = (d) => {
    const next = index + d;
    if (next < 0 || next >= videos.length) return;
    index = next;
    show();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'ArrowRight') step(1);
  };
  function close() {
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('no-scroll');
    dialog.remove();
    prevFocus?.focus?.();
  }
  prevBtn.addEventListener('click', () => step(-1));
  nextBtn.addEventListener('click', () => step(1));
  closeBtn.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  document.body.classList.add('no-scroll');
  document.body.append(dialog);
  show();
  closeBtn.focus();
}

function videoCard(v, onOpen) {
  return h(
    'button',
    { class: 'video-card rise', type: 'button', on: { click: onOpen } },
    h(
      'span',
      { class: 'video-card__thumb' },
      h('img', { src: v.thumbnail, alt: '', loading: 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' }),
      v.duration
        ? h('span', { class: `video-card__time${v.duration === 'LIVE' ? ' is-live' : ''}` }, v.duration)
        : null,
      h('span', { class: 'video-card__play', 'aria-hidden': 'true' }, icon('play'))
    ),
    h('span', { class: 'video-card__title' }, v.title),
    h('span', { class: 'video-card__channel' }, v.channel),
    h(
      'span',
      { class: 'video-card__meta' },
      [views(v.views), v.date ? timeAgo(v.date) : null].filter(Boolean).join(' · ')
    )
  );
}

export function renderVideos(root, { q, signal }) {
  const grid = h('div', { class: 'video-grid' });
  const sentinel = h('div', { class: 'img-sentinel' });
  const status = h('p', { class: 'serp__meta' });
  root.replaceChildren(h('div', { class: 'videos' }, status, grid, sentinel));

  const videos = [];
  let token = '';
  let more = true;
  let loading = false;

  for (let i = 0; i < 8; i++) {
    grid.append(
      h(
        'div',
        { class: 'video-card video-card--ph', 'aria-hidden': 'true' },
        h('span', { class: 'video-card__thumb' }),
        h('div', { class: 'skeleton-line skeleton-line--title w-92' }),
        h('div', { class: 'skeleton-line w-30' })
      )
    );
  }

  async function load() {
    if (loading || !more) return;
    loading = true;
    const first = !videos.length;
    if (first) progress.start();
    try {
      const data = await getJSON('/api/videos', { q, page: token }, { signal });
      if (first) {
        clear(grid);
        progress.done();
        if (!data.enabled) {
          root.replaceChildren(
            emptyState({
              title: 'Video search isn’t set up',
              text: 'Add a Google API key with the YouTube Data API enabled to search videos.',
            })
          );
          return;
        }
        if (!data.results.length) {
          root.replaceChildren(emptyState({ title: `No videos found for “${q}”`, text: 'Try a different search.' }));
          return;
        }
        status.textContent = 'Videos from YouTube';
      }
      token = data.next || '';
      more = Boolean(data.next) && videos.length < 120;
      for (const v of data.results) {
        if (videos.some((x) => x.id === v.id)) continue;
        const i = videos.push(v) - 1;
        const card = videoCard(v, () => openPlayer(videos, i));
        card.querySelector('img').addEventListener('error', (e) => e.target.remove());
        grid.append(card);
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      progress.done();
      if (first) {
        root.replaceChildren(
          emptyState({
            title: 'Videos are unavailable right now',
            text: /quota|403/i.test(err.message)
              ? 'The daily YouTube search quota may be used up. Try again tomorrow.'
              : 'Please try again in a moment.',
          })
        );
      }
      more = false;
    } finally {
      loading = false;
    }
  }

  const observer = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && load(), {
    rootMargin: '500px',
  });
  observer.observe(sentinel);
  signal.addEventListener('abort', () => observer.disconnect());
  load();
}
