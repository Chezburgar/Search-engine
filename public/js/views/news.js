import { h, progress } from '../lib/dom.js';
import { getJSON } from '../lib/api.js';
import { timeAgo } from '../lib/format.js';
import { faviconEl } from '../components/result.js';
import { emptyState } from './all.js';

function newsItem(n) {
  return h(
    'a',
    { class: `news-item rise${n.image ? ' has-image' : ''}`, href: n.url, target: '_blank', rel: 'noopener' },
    h(
      'div',
      { class: 'news-item__body' },
      h('div', { class: 'news-item__source' }, faviconEl(n.host, 14), h('span', {}, n.source)),
      h('h3', { class: 'news-item__title' }, n.title),
      n.snippet ? h('p', { class: 'news-item__snippet' }, n.snippet) : null,
      n.date ? h('time', { class: 'news-item__time', datetime: n.date }, timeAgo(n.date)) : null
    ),
    n.image
      ? h('img', { class: 'news-item__img', src: n.image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' })
      : null
  );
}

export async function renderNews(root, { q, signal }) {
  const list = h('div', { class: 'news-list' });
  const meta = h('p', { class: 'serp__meta' });
  root.replaceChildren(h('div', { class: 'news-page' }, meta, list));

  for (let i = 0; i < 5; i++) {
    list.append(
      h(
        'div',
        { class: 'skeleton-result', 'aria-hidden': 'true' },
        h('div', { class: 'skeleton-line w-30' }),
        h('div', { class: 'skeleton-line skeleton-line--title w-92' }),
        h('div', { class: 'skeleton-line w-20' })
      )
    );
  }

  progress.start();
  try {
    const data = await getJSON('/api/news', { q }, { signal });
    progress.done();
    if (!data.results.length) {
      list.replaceChildren(emptyState({ title: `No recent news for “${q}”`, text: 'Try a broader topic.' }));
      return;
    }
    meta.textContent = `${data.results.length} stories${data.provider ? ` from ${data.provider}` : ''}`;
    list.replaceChildren(...data.results.map(newsItem));
  } catch (err) {
    if (err.name === 'AbortError') return;
    progress.done();
    list.replaceChildren(emptyState({ title: 'News is unavailable right now', text: 'Please try again in a moment.' }));
  }
}
