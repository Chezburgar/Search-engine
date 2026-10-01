import { h, icon, highlight, copyText } from '../lib/dom.js';
import { favicon, shortDate, siteName } from '../lib/format.js';
import { streamAnswer } from './answer.js';

export function faviconEl(host, size = 18) {
  const wrap = h('span', { class: 'favicon', 'aria-hidden': 'true' });
  const img = h('img', { src: favicon(host), alt: '', width: size, height: size, loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => {
    img.remove();
    wrap.textContent = (siteName(host)[0] || '?').toUpperCase();
    wrap.classList.add('favicon--letter');
  });
  wrap.append(img);
  return wrap;
}

export function createResult(r, q, { aiEnabled }) {
  const summaryEl = h('div', { class: 'result__summary', hidden: true });
  let controller = null;

  const summarizeBtn = aiEnabled
    ? h(
        'button',
        { class: 'chip chip--ai chip--sm', type: 'button', 'aria-expanded': 'false' },
        icon('sparkle'),
        h('span', {}, 'Summarize')
      )
    : null;

  const article = h(
    'article',
    { class: 'result' },
    h(
      'div',
      { class: 'result__site' },
      faviconEl(r.host),
      h(
        'div',
        { class: 'result__siteinfo' },
        h('span', { class: 'result__sitename' }, siteName(r.host)),
        h('cite', { class: 'result__url' }, r.breadcrumb)
      ),
      h(
        'div',
        { class: 'result__tools' },
        summarizeBtn,
        h(
          'button',
          {
            class: 'iconbtn iconbtn--sm',
            type: 'button',
            title: 'Copy link',
            'aria-label': 'Copy link',
            on: { click: () => copyText(r.url) },
          },
          icon('link')
        )
      )
    ),
    h('h3', { class: 'result__title' }, h('a', { href: r.url, rel: 'noopener', 'data-result': '' }, r.title)),
    r.snippet || r.date
      ? h(
          'p',
          { class: 'result__snippet' },
          r.date ? h('span', { class: 'result__date' }, `${shortDate(r.date)} — `) : null,
          highlight(r.snippet, q)
        )
      : null,
    summaryEl
  );

  summarizeBtn?.addEventListener('click', async () => {
    const open = summaryEl.hidden;
    summaryEl.hidden = !open;
    summarizeBtn.setAttribute('aria-expanded', String(open));
    article.classList.toggle('has-summary', open);
    if (!open) {
      controller?.abort();
      return;
    }
    if (summaryEl.dataset.done) return;
    controller = new AbortController();
    const body = h('div', { class: 'result__summary-body' });
    summaryEl.replaceChildren(
      h(
        'div',
        { class: 'result__summary-head' },
        icon('sparkle'),
        h('span', {}, 'Spark summary'),
        h('span', { class: 'result__summary-host' }, siteName(r.host))
      ),
      body
    );
    try {
      const out = await streamAnswer(body, {
        path: '/api/summarize',
        params: { url: r.url, q },
        signal: controller.signal,
        stages: { initial: 'Opening page', reading: 'Reading page', writing: 'Summarizing' },
      });
      if (out.text) summaryEl.dataset.done = '1';
    } catch {}
  });

  return article;
}

export function resultSkeleton(n = 6) {
  return h(
    'div',
    { class: 'skeleton-results', 'aria-hidden': 'true' },
    Array.from({ length: n }, () =>
      h(
        'div',
        { class: 'skeleton-result' },
        h(
          'div',
          { class: 'skeleton-row' },
          h('span', { class: 'skeleton-circle' }),
          h('span', { class: 'skeleton-line w-30' })
        ),
        h('div', { class: 'skeleton-line skeleton-line--title w-70' }),
        h('div', { class: 'skeleton-line w-100' }),
        h('div', { class: 'skeleton-line w-80' })
      )
    )
  );
}
