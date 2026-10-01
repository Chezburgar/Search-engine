import { h, icon, clear, progress } from '../lib/dom.js';
import { getJSON, safe } from '../lib/api.js';
import { settings } from '../lib/store.js';
import { looksLikeMath } from '../lib/calc.js';
import { STATIC } from '../lib/routes.js';
import { createResult, resultSkeleton } from '../components/result.js';
import { createOverview } from '../components/overview.js';
import { createKnowledgePanel, createPeopleAlsoAsk, createRelatedSearches } from '../components/panels.js';
import { createWeatherCard, createCalculator } from '../components/widgets.js';

const wide = window.matchMedia('(min-width: 1200px)');

export function emptyState({ title, text, actions = [] }) {
  return h(
    'div',
    { class: 'empty' },
    h('img', { class: 'empty__mark', src: 'assets/spark-mark.png', alt: '', width: 72, height: 62 }),
    h('h2', {}, title),
    text ? h('p', {}, text) : null,
    actions.length ? h('div', { class: 'empty__actions' }, actions) : null
  );
}

export async function renderAll(root, { q, signal, go, ai, openChat }) {
  const meta = h('p', { class: 'serp__meta' });
  const instant = h('div', { class: 'serp__instant' });
  const overviewSlot = h('div');
  const kpInline = h('div', { class: 'kp-inline' });
  const list = h('div', { class: 'results' }, resultSkeleton());
  const after = h('div', { class: 'serp__after' });
  const side = h('aside', { class: 'serp__side' });
  root.replaceChildren(
    h(
      'div',
      { class: 'serp' },
      h('div', { class: 'serp__main' }, meta, instant, overviewSlot, kpInline, list, after),
      side
    )
  );

  if (looksLikeMath(q)) instant.append(createCalculator(q));

  // Knowledge panel loads alongside the results.
  getJSON('/api/knowledge', { q }, { signal })
    .then(({ knowledge }) => {
      if (!knowledge || signal.aborted) return;
      const panel = createKnowledgePanel(knowledge, ai.enabled ? { onAsk: (question) => go(question, 'ai') } : {});
      const place = () => {
        const target = wide.matches ? side : kpInline;
        if (panel.parentNode !== target) target.append(panel);
      };
      place();
      wide.addEventListener('change', place);
      signal.addEventListener('abort', () => wide.removeEventListener('change', place));
    })
    .catch(() => {});

  progress.start();
  let data;
  try {
    data = await getJSON('/api/search', { q, safe: safe() }, { signal });
  } catch (err) {
    if (err.name === 'AbortError') return;
    progress.done();
    list.replaceChildren(
      emptyState({
        title: 'Search is having a moment',
        text: 'Spark could not reach its search providers. Check your connection and try again.',
        actions: [
          h(
            'button',
            { class: 'btn btn--soft', type: 'button', on: { click: () => go(q, 'all', { replace: true }) } },
            icon('refresh'),
            'Try again'
          ),
        ],
      })
    );
    return;
  }
  progress.done();
  if (signal.aborted) return;

  if (data.weather) instant.append(createWeatherCard(data.weather));

  const mode = settings.get('overview');
  if (ai.enabled && data.overview && mode !== 'off') {
    const overview = createOverview({
      q,
      manual: mode === 'manual',
      onFollowUp: (question, context) =>
        openChat(q, { seed: { q, text: context.text, sources: context.sources }, ask: question }),
    });
    overviewSlot.append(overview.el);
    signal.addEventListener('abort', overview.abort);
  } else if (!ai.enabled && data.results.length) {
    overviewSlot.append(
      h(
        'div',
        { class: 'ai-setup' },
        icon('sparkle'),
        h(
          'p',
          {},
          h('b', {}, 'Spark AI is off. '),
          STATIC
            ? "This site was published without an xAI key, so AI overviews, chat and summaries aren't available."
            : [
                'Add your xAI key as ',
                h('code', {}, 'XAI_API_KEY'),
                ' in ',
                h('code', {}, '.env'),
                ' to get AI overviews, chat and summaries.',
              ]
        )
      )
    );
  }

  const results = data.results;
  if (!results.length) {
    list.replaceChildren(
      emptyState({
        title: `No web results for “${q}”`,
        text: 'Try different or fewer keywords — or let Spark answer it directly.',
        actions: ai.enabled
          ? [
              h(
                'button',
                { class: 'btn btn--spark', type: 'button', on: { click: () => go(q, 'ai') } },
                icon('sparkleSolid'),
                'Ask Spark'
              ),
            ]
          : [],
      })
    );
    meta.textContent = '';
    return;
  }

  meta.textContent = `${results.length} results${data.provider ? ` from ${data.provider}` : ''} · ${(data.elapsedMs / 1000).toFixed(2)} s`;
  const paaSlot = h('div', { class: 'paa-slot' });
  clear(list);
  results.forEach((r, i) => {
    const el = createResult(r, q, { aiEnabled: ai.enabled });
    el.classList.add('rise');
    el.style.animationDelay = `${Math.min(i, 8) * 35}ms`;
    list.append(el);
    if (i === 2) list.append(paaSlot);
  });

  if (ai.enabled) {
    getJSON('/api/related', { q }, { signal })
      .then(({ questions }) => {
        if (questions?.length && !signal.aborted) {
          paaSlot.append(
            createPeopleAlsoAsk(questions, {
              onContinue: (question, ctx) => openChat(question, { seed: { q: question, ...ctx } }),
            })
          );
        }
      })
      .catch(() => {});
  }

  // "More results" pagination.
  let next = data.next;
  const moreBtn = h(
    'button',
    { class: 'btn btn--ghost btn--wide', type: 'button' },
    'More results',
    icon('chevronDown')
  );
  const moreWrap = h('div', { class: 'more' }, moreBtn);
  if (next) after.append(moreWrap);
  moreBtn.addEventListener('click', async () => {
    moreBtn.disabled = true;
    moreBtn.classList.add('is-loading');
    try {
      const page = await getJSON('/api/search', { q, safe: safe(), cursor: next }, { signal });
      const seen = new Set([...list.querySelectorAll('a[data-result]')].map((a) => a.href));
      page.results
        .filter((r) => !seen.has(r.url))
        .forEach((r) => list.append(createResult(r, q, { aiEnabled: ai.enabled })));
      next = page.next;
      if (!next || !page.results.length) moreWrap.remove();
    } catch (err) {
      if (err.name !== 'AbortError')
        moreWrap.replaceChildren(h('p', { class: 'serp__meta' }, 'Could not load more results.'));
    } finally {
      moreBtn.disabled = false;
      moreBtn.classList.remove('is-loading');
    }
  });

  getJSON('/api/suggest', { q }, { signal })
    .then(({ suggestions }) => {
      const related = createRelatedSearches(q, suggestions, { onSearch: (s) => go(s) });
      if (related && !signal.aborted) after.prepend(related);
    })
    .catch(() => {});
}
