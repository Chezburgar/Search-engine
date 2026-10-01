import { h, icon, clear, copyText, fill } from '../lib/dom.js';
import { stream, safe, aiLabel } from '../lib/api.js';
import { renderInto, toPlainText } from '../lib/markdown.js';
import { favicon, siteName } from '../lib/format.js';

const STAGES = {
  searching: 'Searching the web',
  reading: 'Reading sources',
  writing: 'Writing your overview',
};

export function sourceChip(s) {
  return h(
    'a',
    { class: 'source-chip', href: s.url, target: '_blank', rel: 'noopener', title: s.title },
    h('img', { src: favicon(s.host), alt: '', width: 16, height: 16, loading: 'lazy' }),
    h('span', { class: 'source-chip__host' }, siteName(s.host)),
    h('span', { class: 'source-chip__n' }, String(s.n))
  );
}

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

// The AI overview card at the top of results (kind "web") or news (kind "news").
export function createOverview({ q, kind = 'web', manual = false, onFollowUp, onSources }) {
  let controller = null;
  let text = '';
  let sources = [];
  let frame = 0;

  const title = kind === 'news' ? 'Spark Briefing' : 'Spark Overview';
  const copyBtn = h(
    'button',
    { class: 'iconbtn iconbtn--sm', type: 'button', title: 'Copy', 'aria-label': 'Copy overview', hidden: true },
    icon('copy')
  );
  const regenBtn = h(
    'button',
    {
      class: 'iconbtn iconbtn--sm',
      type: 'button',
      title: 'Regenerate',
      'aria-label': 'Regenerate overview',
      hidden: true,
    },
    icon('refresh')
  );
  const body = h('div', { class: 'ai-card__body' });
  const textEl = h('div', { class: 'md ai-card__text' });
  const moreBtn = h(
    'button',
    { class: 'ai-card__more', type: 'button', hidden: true },
    h('span', {}, 'Show more'),
    icon('chevronDown')
  );
  const sourcesEl = h('div', { class: 'ai-sources', hidden: true });
  const foot = h('div', { class: 'ai-card__foot' }, sourcesEl);
  const card = h(
    'section',
    { class: `ai-card ai-card--${kind}`, 'aria-label': title },
    h(
      'header',
      { class: 'ai-card__head' },
      h('span', { class: 'ai-badge' }, icon('sparkle')),
      h('h2', { class: 'ai-card__title' }, title),
      h('span', { class: 'ai-card__tag' }, aiLabel()),
      h('div', { class: 'ai-card__tools' }, copyBtn, regenBtn)
    ),
    body,
    moreBtn,
    foot
  );

  if (kind === 'web' && onFollowUp) {
    const input = h('input', {
      class: 'ai-followup__input',
      type: 'text',
      placeholder: 'Ask a follow-up…',
      'aria-label': 'Ask a follow-up question',
      enterkeyhint: 'send',
    });
    const followForm = h(
      'form',
      { class: 'ai-followup' },
      icon('sparkle', 'ai-followup__icon'),
      input,
      h('button', { class: 'ai-followup__send', type: 'submit', 'aria-label': 'Send follow-up' }, icon('arrowUp'))
    );
    followForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (v) onFollowUp(v, { q, text, sources });
    });
    foot.append(followForm);
  }

  const setCollapsed = (collapsed) => {
    card.classList.toggle('is-collapsed', collapsed);
    moreBtn.hidden = !collapsed;
  };
  moreBtn.addEventListener('click', () => setCollapsed(false));
  copyBtn.addEventListener('click', () => copyText(toPlainText(text)));
  regenBtn.addEventListener('click', () => run(true));

  const paint = (streaming) => {
    frame = 0;
    renderInto(textEl, text, { sources, streaming });
    if (streaming && !card.classList.contains('was-expanded') && textEl.scrollHeight > 420) setCollapsed(true);
  };

  function showError(err) {
    card.classList.remove('is-loading', 'is-streaming');
    card.classList.add('is-error');
    fill(
      body,
      h(
        'div',
        { class: 'ai-error' },
        icon(err.code === 'not_configured' ? 'info' : 'alert'),
        h('p', {}, err.message || 'Spark AI could not answer right now.'),
        err.code === 'not_configured' || err.code === 'rate_limited'
          ? null
          : h(
              'button',
              { class: 'btn btn--ghost btn--sm', type: 'button', on: { click: () => run(true) } },
              icon('refresh'),
              'Try again'
            )
      )
    );
  }

  async function run(fresh = false) {
    controller?.abort();
    controller = new AbortController();
    text = '';
    sources = [];
    card.classList.remove('is-error', 'is-done', 'is-collapsed');
    card.classList.add('is-loading');
    copyBtn.hidden = regenBtn.hidden = true;
    moreBtn.hidden = sourcesEl.hidden = true;
    const loader = loadingBlock(STAGES.searching);
    fill(body, loader.el);
    body.setAttribute('aria-busy', 'true');
    let failed = null;
    try {
      await stream('/api/overview', {
        params: { q, kind, safe: safe(), fresh: fresh ? Date.now() : undefined },
        signal: controller.signal,
        onEvent(event, data) {
          if (event === 'status') {
            loader.setStage(
              data.stage === 'reading' && data.count
                ? `Reading ${data.count} sources`
                : STAGES[data.stage] || 'Thinking'
            );
          } else if (event === 'sources') {
            sources = data;
            loader.setSources(sources);
            onSources?.(sources);
          } else if (event === 'token') {
            if (!text) {
              card.classList.replace('is-loading', 'is-streaming');
              fill(body, textEl);
            }
            text += data.t;
            if (!frame) frame = requestAnimationFrame(() => paint(true));
          } else if (event === 'error') {
            failed = data;
          }
        },
      });
    } catch (err) {
      if (err.name === 'AbortError') return;
      failed = { message: 'Spark AI is unreachable right now.' };
    }
    cancelAnimationFrame(frame);
    frame = 0;
    body.removeAttribute('aria-busy');
    if (failed && !text) return showError(failed);
    if (!text.trim()) return showError({ message: 'Spark had nothing useful to add for this search.' });
    card.classList.remove('is-loading', 'is-streaming');
    card.classList.add('is-done');
    paint(false);
    copyBtn.hidden = regenBtn.hidden = false;
    if (sources.length) {
      fill(sourcesEl, ...sources.map(sourceChip));
      sourcesEl.hidden = false;
    }
  }

  moreBtn.addEventListener('click', () => card.classList.add('was-expanded'));

  if (manual) {
    fill(
      body,
      h(
        'div',
        { class: 'ai-manual' },
        h('p', {}, 'Get a quick AI summary of the best sources for this search.'),
        h(
          'button',
          { class: 'btn btn--spark btn--sm', type: 'button', on: { click: () => run() } },
          icon('sparkleSolid'),
          'Generate overview'
        )
      )
    );
  } else run();

  return {
    el: card,
    abort: () => controller?.abort(),
  };
}
