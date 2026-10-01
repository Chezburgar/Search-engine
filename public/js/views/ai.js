import { h, icon, clear, copyText, fill, toast } from '../lib/dom.js';
import { stream, getJSON, safe, aiLabel } from '../lib/api.js';
import { MAX_ATTACH, pickImages, imageFiles, toDataUrls } from '../lib/images.js';
import { session } from '../lib/store.js';
import { renderInto, toPlainText } from '../lib/markdown.js';
import { favicon, siteName } from '../lib/format.js';
import { loadingBlock } from '../components/ai-bits.js';
import { emptyState } from './all.js';
import { searchUrl, STATIC } from '../lib/routes.js';

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
        text: STATIC
          ? 'This site was published without an AI key, so the AI chat is unavailable.'
          : 'Add GROQ_API_KEY (or XAI_API_KEY) to the .env file and restart the server to chat with Spark.',
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
  let turns = seed?.seed ? [seed.seed] : seed ? [] : session.get(key) || [];
  let controller = null;
  let busy = false;
  let attachments = []; // data URLs waiting to be sent

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
  const attachBtn = h(
    'button',
    { class: 'composer__attach', type: 'button', title: 'Add images', 'aria-label': 'Add images' },
    icon('image')
  );
  const tray = h('div', { class: 'composer__tray', hidden: true });
  const composer = h(
    'form',
    { class: 'composer' },
    h('div', { class: 'composer__box' }, tray, h('div', { class: 'composer__row' }, attachBtn, textarea, sendBtn)),
    h(
      'p',
      { class: 'composer__note' },
      `Spark AI uses ${aiLabel()} and live web results. You can add images. It can make mistakes — check important info.`
    )
  );
  const page = h('div', { class: 'ai-page' }, thread, followups, composer);
  root.replaceChildren(page);

  const canSend = () => Boolean(textarea.value.trim() || attachments.length);
  const autosize = () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
    sendBtn.disabled = !busy && !canSend();
  };

  function paintTray() {
    fill(
      tray,
      attachments.map((src, i) =>
        h(
          'div',
          { class: 'thumb' },
          h('img', { src, alt: `Attachment ${i + 1}` }),
          h(
            'button',
            {
              class: 'thumb__remove',
              type: 'button',
              'aria-label': 'Remove image',
              on: {
                click: () => {
                  attachments.splice(i, 1);
                  paintTray();
                },
              },
            },
            icon('x')
          )
        )
      )
    );
    tray.hidden = !attachments.length;
    attachBtn.disabled = attachments.length >= MAX_ATTACH;
    autosize();
  }

  async function addImages(files) {
    if (!files.length) return;
    const room = MAX_ATTACH - attachments.length;
    if (room <= 0) return toast(`You can attach up to ${MAX_ATTACH} images.`);
    try {
      attachments.push(...(await toDataUrls(files, room)));
      if (files.length > room) toast(`Only ${MAX_ATTACH} images can be attached.`);
    } catch (err) {
      toast(err.message);
    }
    paintTray();
    textarea.focus();
  }

  attachBtn.addEventListener('click', async () => addImages(await pickImages()));
  textarea.addEventListener('paste', (e) => {
    const files = imageFiles(e.clipboardData);
    if (files.length) {
      e.preventDefault();
      addImages(files);
    }
  });
  page.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      composer.classList.add('is-dropping');
    }
  });
  page.addEventListener('dragleave', (e) => {
    if (!page.contains(e.relatedTarget)) composer.classList.remove('is-dropping');
  });
  page.addEventListener('drop', (e) => {
    composer.classList.remove('is-dropping');
    const files = imageFiles(e.dataTransfer);
    if (files.length) {
      e.preventDefault();
      addImages(files);
    }
  });
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
    if (!canSend()) return;
    const images = attachments;
    const v = textarea.value.trim() || "What's in this image?";
    attachments = [];
    textarea.value = '';
    paintTray();
    ask(v, { images });
  });

  const setBusy = (b) => {
    busy = b;
    sendBtn.replaceChildren(icon(b ? 'stop' : 'arrowUp'));
    sendBtn.setAttribute('aria-label', b ? 'Stop generating' : 'Send');
    sendBtn.classList.toggle('is-stop', b);
    sendBtn.disabled = !b && !canSend();
  };

  const save = () =>
    session.set(
      key,
      // Images are left out: they would quickly fill the browser's session storage.
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
      turn.images?.length
        ? h(
            'div',
            { class: 'turn__images' },
            turn.images.map((src) => h('img', { src, alt: 'Attached image', loading: 'lazy' }))
          )
        : null,
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
            href: searchUrl(turn.q),
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

  async function ask(question, { replaceLast = false, images = [] } = {}) {
    if (replaceLast) {
      turns.pop();
      views.pop()?.el.remove();
    }
    const prev = views[views.length - 1];
    if (prev?.turn.text) prev.paintActions(false);
    const turn = { q: question, text: '', sources: [], images };
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
      { role: 'user', content: t.q, ...(t.images?.length ? { images: t.images } : {}) },
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
                  on: { click: () => ask(question, { replaceLast: true, images }) },
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
    if (last && !busy) ask(last.q, { replaceLast: true, images: last.images || [] });
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
  if (seed?.ask) ask(seed.ask, { images: seed.images || [] });
  else if (!turns.length) ask(q);
  else {
    save();
    loadFollowups(turns[turns.length - 1].q);
  }
}
