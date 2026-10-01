import { h, icon, clear, copyText, fill } from '../lib/dom.js';
import { stream, getJSON, safe } from '../lib/api.js';
import { session } from '../lib/store.js';
import { renderInto, toPlainText } from '../lib/markdown.js';
import { favicon, siteName } from '../lib/format.js';
import { loadingBlock } from '../components/overview.js';
import { emptyState } from './all.js';

const STAGES = { searching: 'Searching the web', reading: 'Reading sources', writing: 'Writing' };

function sourceCard(s) {
  return h(
    'a',
    { class: 'source-card', href: s.url, target: '_blank', rel: 'noopener' },
    h('span', { class: 'source-card__title' }, s.title),
    h(
      'span',
      { class: 'source-card__meta' },
      h('img', { src: favicon(s.host), alt: '', width: 14, height: 14, loading: 'lazy' }),
      h('span', { class: 'source-card__host' }, siteName(s.host)),
      h('span', { class: 'source-card__n' }, String(s.n))
    )
  );
}

export function renderAI(root, { q, signal, go, ai, handoff }) {
  if (!ai.enabled) {
    root.replaceChildren(
      emptyState({
        title: 'Spark AI is not configured',
        text: 'Add your xAI API key as XAI_API_KEY in the .env file and restart the server to chat with Spark.',
        actions: [
          h(
            'button',
            { class: 'btn btn--soft', type: 'button', on: { click: () => go(q, 'all') } },
            icon('search'),
            'See web results'
          ),
        ],
      })
    );
    return;
  }

  const key = `spark:thread:${q.toLowerCase()}`;
  const seed = handoff.take(q);
  let turns = seed ? [seed.seed] : session.get(key) || [];
  let controller = null;
  let busy = false;

  const thread = h('div', { class: 'thread' });
  const followups = h('div', { class: 'followups', hidden: true });
  const textarea = h('textarea', {
    class: 'composer__input',
    rows: 1,
    placeholder: 'Ask a follow-up…',
    'aria-label': 'Ask Spark a follow-up question',
    enterkeyhint: 'send',
  });
  const sendBtn = h(
    'button',
    { class: 'composer__send', type: 'submit', 'aria-label': 'Send', disabled: true },
    icon('arrowUp')
  );
  const composer = h(
    'form',
    { class: 'composer' },
    h('div', { class: 'composer__box' }, icon('sparkle', 'composer__icon'), textarea, sendBtn),
    h(
      'p',
      { class: 'composer__note' },
      'Spark AI uses Grok and live web results. It can make mistakes — check important info.'
    )
  );
  root.replaceChildren(h('div', { class: 'ai-page' }, thread, followups, composer));

  const autosize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    sendBtn.disabled = !busy && !textarea.value.trim();
  };
  textarea.addEventListener('input', autosize);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      composer.requestSubmit();
    }
  });
  composer.addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) return controller?.abort();
    const v = textarea.value.trim();
    if (!v) return;
    textarea.value = '';
    autosize();
    ask(v);
  });

  const setBusy = (b) => {
    busy = b;
    sendBtn.replaceChildren(icon(b ? 'stop' : 'arrowUp'));
    sendBtn.setAttribute('aria-label', b ? 'Stop generating' : 'Send');
    sendBtn.classList.toggle('is-stop', b);
    sendBtn.disabled = !b && !textarea.value.trim();
  };

  const save = () =>
    session.set(
      key,
      turns.filter((t) => t.text).map(({ q: tq, text, sources }) => ({ q: tq, text, sources }))
    );

  function turnView(turn, index) {
    const sourcesEl = h('div', { class: 'sources-strip' });
    const sourcesBlock = h(
      'div',
      { class: 'turn__block', hidden: !turn.sources?.length },
      h('div', { class: 'turn__label' }, icon('globe'), 'Sources'),
      sourcesEl
    );
    const answer = h('div', { class: 'md turn__answer' });
    const actions = h('div', { class: 'turn__actions', hidden: !turn.text });
    const el = h(
      'article',
      { class: 'turn rise' },
      h('h2', { class: 'turn__q' }, turn.q),
      sourcesBlock,
      h('div', { class: 'turn__block' }, h('div', { class: 'turn__label' }, icon('sparkle'), 'Answer'), answer),
      actions
    );
    const paintSources = () => {
      fill(sourcesEl, ...(turn.sources || []).map(sourceCard));
      sourcesBlock.hidden = !turn.sources?.length;
    };
    const paintActions = (isLast = true) => {
      fill(
        actions,
        h(
          'button',
          { class: 'chip chip--quiet chip--sm', type: 'button', on: { click: () => copyText(toPlainText(turn.text)) } },
          icon('copy'),
          'Copy'
        ),
        isLast
          ? h(
              'button',
              { class: 'chip chip--quiet chip--sm', type: 'button', on: { click: () => regenerate() } },
              icon('refresh'),
              'Regenerate'
            )
          : null,
        h(
          'a',
          {
            class: 'chip chip--quiet chip--sm',
            href: `/search?q=${encodeURIComponent(turn.q)}`,
            on: { click: (e) => (e.preventDefault(), go(turn.q)) },
          },
          icon('search'),
          'Web results'
        )
      );
      actions.hidden = false;
    };
    paintSources();
    if (turn.text) {
      renderInto(answer, turn.text, { sources: turn.sources });
      paintActions(index === turns.length - 1);
    }
    return { el, answer, paintSources, paintActions, turn };
  }

  async function ask(question, { replaceLast = false } = {}) {
    if (replaceLast) {
      turns.pop();
      views.pop()?.el.remove();
    }
    const prev = views[views.length - 1];
    if (prev?.turn.text) prev.paintActions(false);
    const turn = { q: question, text: '', sources: [] };
    turns.push(turn);
    const view = turnView(turn, turns.length - 1);
    views.push(view);
    thread.append(view.el);
    followups.hidden = true;
    view.el.scrollIntoView({ behavior: turns.length > 1 ? 'smooth' : 'auto', block: 'start' });

    const loader = loadingBlock(STAGES.searching);
    view.answer.append(loader.el);
    controller = new AbortController();
    signal.addEventListener('abort', () => controller.abort(), { once: true });
    setBusy(true);
    let frame = 0;
    let failed = null;
    const messages = turns.flatMap((t) => [
      { role: 'user', content: t.q },
      ...(t.text ? [{ role: 'assistant', content: t.text }] : []),
    ]);
    try {
      await stream('/api/chat', {
        body: { messages, safe: safe() },
        signal: controller.signal,
        onEvent(event, data) {
          if (event === 'status') loader.setStage(STAGES[data.stage] || 'Thinking');
          else if (event === 'sources') {
            turn.sources = data;
            loader.setSources(data);
            view.paintSources();
          } else if (event === 'token') {
            if (!turn.text) clear(view.answer);
            turn.text += data.t;
            if (!frame)
              frame = requestAnimationFrame(() => {
                frame = 0;
                renderInto(view.answer, turn.text, { sources: turn.sources, streaming: true });
              });
          } else if (event === 'error') failed = data;
        },
      });
    } catch (err) {
      if (err.name !== 'AbortError') failed = { message: 'Spark AI is unreachable right now.' };
    }
    cancelAnimationFrame(frame);
    setBusy(false);
    if (signal.aborted) return;
    if (!turn.text) {
      fill(
        view.answer,
        h(
          'div',
          { class: 'ai-error ai-error--inline' },
          icon('alert'),
          h('p', {}, failed?.message || 'Stopped.'),
          failed?.code === 'rate_limited'
            ? null
            : h(
                'button',
                {
                  class: 'btn btn--ghost btn--sm',
                  type: 'button',
                  on: { click: () => ask(question, { replaceLast: true }) },
                },
                icon('refresh'),
                'Retry'
              )
        )
      );
      return;
    }
    renderInto(view.answer, turn.text, { sources: turn.sources });
    view.paintActions();
    save();
    loadFollowups(question);
    textarea.focus({ preventScroll: true });
  }

  function regenerate() {
    const last = turns[turns.length - 1];
    if (last && !busy) ask(last.q, { replaceLast: true });
  }

  async function loadFollowups(question) {
    try {
      const { questions } = await getJSON('/api/related', { q: question }, { signal });
      if (!questions?.length || signal.aborted || busy) return;
      followups.replaceChildren(
        h('div', { class: 'turn__label' }, icon('layers'), 'Related'),
        h(
          'div',
          { class: 'followups__list' },
          questions.map((fq) =>
            h(
              'button',
              { class: 'followup', type: 'button', on: { click: () => ask(fq) } },
              h('span', {}, fq),
              icon('plus')
            )
          )
        )
      );
      followups.hidden = false;
    } catch {}
  }

  const views = turns.map((t, i) => turnView(t, i));
  thread.append(...views.map((v) => v.el));
  if (seed?.ask) ask(seed.ask);
  else if (!turns.length) ask(q);
  else {
    save();
    loadFollowups(turns[turns.length - 1].q);
  }
}
