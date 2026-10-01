// Spark Games: a library of browser games, each played inside Spark in a frame.

import { h, icon, fill } from '../lib/dom.js';
import { gamesUrl, homeUrl } from '../lib/routes.js';
import { GAMES, gameById } from '../games/catalog.js';

const RECENT_KEY = 'spark:games-recent';

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const recent = {
  list() {
    try {
      const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
      return ids.map(gameById).filter(Boolean);
    } catch {
      return [];
    }
  },
  add(id) {
    try {
      const ids = [
        id,
        ...this.list()
          .map((g) => g.id)
          .filter((x) => x !== id),
      ].slice(0, 4);
      localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
    } catch {}
  },
};

// The game's picture: its thumbnail over a gradient with an emoji (shown if the image fails).
function tile(game, cls = '') {
  const el = h(
    'span',
    {
      class: `gm-tile ${cls}`.trim(),
      style: { background: `linear-gradient(135deg, ${game.colors[0]}, ${game.colors[1]})` },
      'aria-hidden': 'true',
    },
    h('span', { class: 'gm-tile__emoji' }, game.emoji)
  );
  if (game.thumb) {
    const img = h('img', {
      class: `gm-tile__img gm-tile__img--${game.fit}`,
      src: game.thumb,
      alt: '',
      loading: 'lazy',
      decoding: 'async',
      referrerpolicy: 'no-referrer',
    });
    img.addEventListener('error', () => img.remove());
    img.addEventListener('load', () => el.classList.add('has-img'));
    el.append(img);
  }
  return el;
}

function topbar({ home, children = [] }) {
  return h(
    'header',
    { class: 'gm-top' },
    h(
      'a',
      { class: 'gr-brand', href: homeUrl(), 'aria-label': 'Spark home', on: { click: home } },
      h('img', { src: 'assets/spark-mark.png', alt: '', width: 34, height: 29 }),
      h('span', { class: 'wordmark' }, 'Spark'),
      h('span', { class: 'gr-brand__tag' }, 'Games')
    ),
    ...children
  );
}

/* --------------------------------- library -------------------------------- */

function library(root, { navigate, home }) {
  const tags = ['All', ...new Set(GAMES.flatMap((g) => g.tags))];
  let tag = 'All';
  let query = '';

  const open = (game) => (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    navigate({ g: game.id });
  };

  const card = (game, i) =>
    h(
      'a',
      {
        class: 'gm-card rise',
        href: gamesUrl({ g: game.id }),
        style: { animationDelay: `${Math.min(i, 10) * 40}ms` },
        on: { click: open(game) },
      },
      tile(game),
      h(
        'span',
        { class: 'gm-card__body' },
        h('span', { class: 'gm-card__name' }, game.name),
        h('span', { class: 'gm-card__blurb' }, game.blurb),
        h(
          'span',
          { class: 'gm-card__meta' },
          game.tags.map((t) => h('span', { class: 'gm-tag' }, t)),
          h('span', { class: 'gm-card__host' }, hostOf(game.url))
        )
      ),
      h('span', { class: 'gm-card__play', 'aria-hidden': 'true' }, icon('play'))
    );

  const grid = h('div', { class: 'gm-grid' });
  const count = h('p', { class: 'gm-count' });
  const chips = h('div', { class: 'gm-chips', role: 'group', 'aria-label': 'Filter by type' });
  const search = h('input', {
    class: 'gm-search__input',
    type: 'search',
    placeholder: 'Search games',
    'aria-label': 'Search games',
    on: {
      input: (e) => {
        query = e.target.value.trim().toLowerCase();
        paint();
      },
    },
  });

  function paint() {
    fill(
      chips,
      tags.map((t) =>
        h(
          'button',
          {
            class: `chip chip--sm${t === tag ? ' is-active' : ''}`,
            type: 'button',
            'aria-pressed': String(t === tag),
            on: {
              click: () => {
                tag = t;
                paint();
              },
            },
          },
          t
        )
      )
    );
    const shown = GAMES.filter(
      (g) =>
        (tag === 'All' || g.tags.includes(tag)) &&
        (!query || `${g.name} ${g.blurb} ${g.tags.join(' ')}`.toLowerCase().includes(query))
    );
    count.textContent = `${shown.length} game${shown.length === 1 ? '' : 's'}`;
    fill(grid, shown.length ? shown.map(card) : h('p', { class: 'gm-none' }, 'No games match that.'));
  }

  const played = recent.list();
  root.replaceChildren(
    h(
      'div',
      { class: 'gm' },
      topbar({
        home,
        children: [h('label', { class: 'gm-search' }, icon('search'), search)],
      }),
      h(
        'main',
        { class: 'gm-main', id: 'main' },
        h(
          'div',
          { class: 'gm-hero' },
          h('h1', { class: 'gm-hero__title' }, 'Games'),
          h('p', { class: 'gm-hero__sub' }, 'Play right inside Spark. Pick a game to start.')
        ),
        played.length
          ? h(
              'section',
              { class: 'gm-recent' },
              h('h2', { class: 'gm-h2' }, icon('clock'), 'Continue playing'),
              h(
                'div',
                { class: 'gm-recent__row' },
                played.map((g) =>
                  h(
                    'a',
                    { class: 'gm-mini', href: gamesUrl({ g: g.id }), on: { click: open(g) } },
                    tile(g, 'gm-tile--mini'),
                    h('span', {}, g.name)
                  )
                )
              )
            )
          : null,
        h('div', { class: 'gm-bar' }, chips, count),
        grid
      )
    )
  );
  paint();
}

/* --------------------------------- player --------------------------------- */

function player(root, game, { navigate, home, signal }) {
  recent.add(game.id);
  const frame = h('iframe', {
    class: 'gm-frame',
    src: game.url,
    title: game.name,
    allow: 'fullscreen; autoplay; gamepad; accelerometer; gyroscope; clipboard-write',
    allowfullscreen: true,
    // No top-navigation: a game (or its ads) can't send Spark somewhere else.
    sandbox:
      'allow-scripts allow-same-origin allow-pointer-lock allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads allow-orientation-lock',
    referrerpolicy: 'no-referrer',
  });
  const hint = h('p', { class: 'gm-loading__hint', hidden: true }, 'Taking a while? Try opening it in a new tab.');
  const loading = h(
    'div',
    { class: 'gm-loading', role: 'status' },
    tile(game, 'gm-tile--big'),
    h('p', {}, `Loading ${game.name}…`),
    h('span', { class: 'gr-spinner' }),
    hint
  );
  const timer = setTimeout(() => (hint.hidden = false), 12000);
  signal?.addEventListener('abort', () => clearTimeout(timer));
  frame.addEventListener('load', () => {
    clearTimeout(timer);
    loading.classList.add('is-done');
    setTimeout(() => loading.remove(), 400);
    frame.focus();
  });
  const stage = h('div', { class: 'gm-stage' }, frame, loading);

  const btn = (name, label, onClick, extra = {}) =>
    h(
      'button',
      { class: 'gm-btn', type: 'button', title: label, 'aria-label': label, on: { click: onClick }, ...extra },
      icon(name),
      h('span', {}, label)
    );

  root.replaceChildren(
    h(
      'div',
      { class: 'gm gm--playing' },
      topbar({
        home,
        children: [
          h(
            'a',
            {
              class: 'gm-back',
              href: gamesUrl(),
              on: {
                click: (e) => {
                  e.preventDefault();
                  navigate({});
                },
              },
            },
            icon('arrowLeft'),
            h('span', {}, 'All games')
          ),
          h(
            'div',
            { class: 'gm-now' },
            h('span', { class: 'gm-now__name' }, game.name),
            h('span', { class: 'gm-now__host' }, hostOf(game.url))
          ),
          h(
            'div',
            { class: 'gm-actions' },
            btn('refresh', 'Restart', () => {
              frame.src = game.url;
            }),
            btn('maximize', 'Fullscreen', () => {
              stage.requestFullscreen?.().catch(() => {});
              frame.focus();
            }),
            h(
              'a',
              {
                class: 'gm-btn',
                href: game.url,
                target: '_blank',
                rel: 'noopener',
                'data-external': '',
                title: 'Open in a new tab',
              },
              icon('external'),
              h('span', {}, 'New tab')
            )
          ),
        ],
      }),
      stage
    )
  );
}

export function renderGames(root, { signal, navigate, home }) {
  const game = gameById(new URL(location.href).searchParams.get('g'));
  document.title = game ? `${game.name} — Spark Games` : 'Spark Games';
  if (game) player(root, game, { navigate, home, signal });
  else library(root, { navigate, home });
}
