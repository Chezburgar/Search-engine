// The tab assistant panel: ask in plain words, and the AI reads and controls Spark tabs
// through the tools in shared/agent.js. The tools themselves run here, in the browser.

import { h, icon, fill } from '../lib/dom.js';
import { getJSON, postJSON } from '../lib/api.js';
import { renderInto } from '../lib/markdown.js';
import { runAgent } from '../shared/agent.js';
import { markdownToText } from '../shared/reader.js';
import { tabs, isWebUrl } from './tabs.js';

const KEY = 'spark:assistant';
const SUGGESTIONS = [
  'Summarize this tab',
  'Compare my open tabs',
  'Open the top 3 results in tabs',
  'Close all my tabs',
];

const clip = (s, n) => {
  const str = String(s || '');
  return str.length > n ? `${str.slice(0, n)}…` : str;
};

// What the Spark tab is showing, for read_tab("spark").
function sparkPage() {
  const main = document.querySelector('#app main') || document.getElementById('app');
  const results = [...document.querySelectorAll('#app .result')].slice(0, 12).flatMap((el) => {
    const a = el.querySelector('.result__title a, h3 a');
    return a
      ? [
          {
            title: a.textContent.trim(),
            url: a.href,
            snippet: clip(el.querySelector('.result__snippet')?.textContent, 240),
          },
        ]
      : [];
  });
  const url = new URL(location.href);
  return {
    id: 'spark',
    url: location.href,
    query: url.searchParams.get('q') || null,
    view: url.searchParams.get('page') || url.searchParams.get('tab') || (url.searchParams.get('q') ? 'all' : 'home'),
    results: results.length ? results : undefined,
    text: results.length ? undefined : clip((main?.innerText || '').replace(/\n{3,}/g, '\n\n'), 8000),
  };
}

const titleOf = (id) => tabs.list().find((t) => t.id === id)?.title || id;

function describe(action) {
  const { name, args, result } = action;
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return u;
    }
  };
  switch (name) {
    case 'list_tabs':
      return 'Looked at your tabs';
    case 'read_tab':
      return `Read “${clip(result?.title || titleOf(args.tab_id), 48)}”`;
    case 'open_tab':
      return `Opened ${host(args.url)}`;
    case 'navigate_tab':
      return `Went to ${host(args.url)}`;
    case 'switch_tab':
      return `Switched to “${clip(titleOf(args.tab_id), 48)}”`;
    case 'close_tabs':
      return `Closed ${result?.closed?.length ?? (args.tab_ids || []).length} tab${(result?.closed?.length ?? 0) === 1 ? '' : 's'}`;
    case 'search_web':
      return `Searched “${clip(args.query, 48)}”`;
    case 'show_search':
      return `Showed results for “${clip(args.query, 48)}”`;
    default:
      return name;
  }
}

const ACTION_ICONS = {
  list_tabs: 'layers',
  read_tab: 'book',
  open_tab: 'plus',
  navigate_tab: 'arrowRight',
  switch_tab: 'arrowRight',
  close_tabs: 'x',
  search_web: 'search',
  show_search: 'search',
};

export function createAssistant({ go }) {
  // The tools, as the AI sees them.
  const tools = {
    list_tabs: () => ({ tabs: tabs.list() }),
    async read_tab({ tab_id }) {
      const id = tab_id || tabs.active;
      if (id === 'spark') return sparkPage();
      const page = await tabs.read(id);
      const text = markdownToText(page.markdown);
      return {
        id,
        title: page.title,
        url: page.url,
        site: page.site,
        note: page.rewritten ? 'Gemini rewrite of the page, not its original text' : undefined,
        text: clip(text, 10000),
        truncated: text.length > 10000 || undefined,
      };
    },
    open_tab({ url, background }) {
      if (!isWebUrl(url)) throw new Error('That is not an http(s) URL.');
      const id = tabs.open(url, { activate: !background });
      return { opened: id, url, showing: !background };
    },
    navigate_tab({ tab_id, url }) {
      if (!isWebUrl(url)) throw new Error('That is not an http(s) URL.');
      if (!tabs.navigate(tab_id, url)) throw new Error(`There is no page tab ${tab_id}.`);
      return { ok: true };
    },
    switch_tab({ tab_id }) {
      if (!tabs.activate(tab_id)) throw new Error(`There is no tab ${tab_id}.`);
      return { showing: tab_id };
    },
    close_tabs({ tab_ids }) {
      const ids = Array.isArray(tab_ids) ? tab_ids : [];
      const closed = ids.filter((id) => id !== 'spark' && tabs.close(id));
      return { closed, notFound: ids.filter((id) => !closed.includes(id)) };
    },
    async search_web({ query }) {
      const data = await getJSON('/api/search', { q: query });
      return {
        source: data.provider,
        results: data.results.slice(0, 8).map((r) => ({ title: r.title, url: r.url, snippet: clip(r.snippet, 220) })),
      };
    },
    show_search({ query, type }) {
      tabs.activate('spark', { history: false });
      go(query, ['news', 'images', 'videos'].includes(type) ? type : 'all');
      return { showing: `Spark results for “${query}”` };
    },
  };

  /* ---------------------------------- state --------------------------------- */

  // `history` is what the model sees across turns (questions and final answers only);
  // `log` is what the panel shows.
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
  } catch {}
  let history = Array.isArray(saved?.history) ? saved.history : [];
  let log = Array.isArray(saved?.log) ? saved.log : [];
  let controller = null;
  const persist = () => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify({ history: history.slice(-12), log: log.slice(-30) }));
    } catch {}
  };

  /* ----------------------------------- UI ----------------------------------- */

  const list = h('div', { class: 'assist__log', 'aria-live': 'polite' });
  const input = h('textarea', {
    class: 'assist__input',
    rows: 1,
    placeholder: 'Ask about or control your tabs…',
    'aria-label': 'Message the assistant',
  });
  const send = h('button', { class: 'assist__send', type: 'submit', 'aria-label': 'Send' }, icon('arrowUp'));
  const form = h('form', { class: 'assist__composer' }, input, send);
  const clearBtn = h(
    'button',
    {
      class: 'iconbtn iconbtn--sm',
      type: 'button',
      title: 'New conversation',
      'aria-label': 'New conversation',
      on: {
        click: () => {
          controller?.abort();
          history = [];
          log = [];
          persist();
          paint();
        },
      },
    },
    icon('refresh')
  );
  const closeBtn = h(
    'button',
    {
      class: 'iconbtn iconbtn--sm',
      type: 'button',
      'aria-label': 'Close assistant',
      on: { click: () => toggle(false) },
    },
    icon('x')
  );
  const panel = h(
    'aside',
    { class: 'assist', 'aria-label': 'Spark Assistant', hidden: true },
    h(
      'header',
      { class: 'assist__head' },
      h('span', { class: 'ai-badge' }, icon('sparkle')),
      h('div', { class: 'assist__titles' }, h('h2', {}, 'Assistant'), h('p', {}, 'Reads and controls your Spark tabs')),
      clearBtn,
      closeBtn
    ),
    list,
    form
  );
  const fab = h(
    'button',
    { class: 'assist-fab', type: 'button', title: 'Tab assistant', on: { click: () => toggle(true) } },
    icon('sparkleSolid'),
    h('span', {}, 'Assistant')
  );

  function actionRow(a) {
    return h(
      'li',
      { class: `assist__action is-${a.status}` },
      icon(a.status === 'error' ? 'alert' : ACTION_ICONS[a.name] || 'sparkle'),
      h('span', {}, a.label),
      a.status === 'running' ? h('span', { class: 'gr-spinner gr-spinner--xs' }) : null
    );
  }

  function entry(item) {
    if (item.role === 'user') return h('div', { class: 'assist__msg assist__msg--user' }, item.text);
    const body = h('div', { class: 'md assist__answer' });
    if (item.text) renderInto(body, item.text);
    return h(
      'div',
      { class: 'assist__msg assist__msg--bot' },
      item.actions?.length ? h('ul', { class: 'assist__actions' }, item.actions.map(actionRow)) : null,
      item.pending && !item.text
        ? h('div', { class: 'assist__thinking' }, h('span', { class: 'shimmer-text' }, item.stage || 'Thinking…'))
        : null,
      item.text ? body : null,
      item.error ? h('p', { class: 'assist__error' }, icon('alert'), item.error) : null
    );
  }

  function paint() {
    if (!log.length) {
      fill(
        list,
        h(
          'div',
          { class: 'assist__empty' },
          h(
            'p',
            {},
            'I can read, summarize and compare your Spark tabs, find things in them, open search results, and switch or close tabs.'
          ),
          h(
            'div',
            { class: 'assist__ideas' },
            SUGGESTIONS.map((s) =>
              h('button', { class: 'chip chip--quiet', type: 'button', on: { click: () => ask(s) } }, s)
            )
          )
        )
      );
    } else fill(list, log.map(entry));
    list.scrollTop = list.scrollHeight;
    const busy = Boolean(controller);
    fill(send, icon(busy ? 'stop' : 'arrowUp'));
    send.setAttribute('aria-label', busy ? 'Stop' : 'Send');
    send.classList.toggle('is-stop', busy);
  }

  function toggle(open = panel.hidden) {
    panel.hidden = !open;
    fab.hidden = open;
    document.body.classList.toggle('assist-open', open);
    if (open) {
      paint();
      setTimeout(() => input.focus(), 50);
    }
  }

  async function ask(text) {
    const question = String(text || '').trim();
    if (!question || controller) return;
    toggle(true);
    input.value = '';
    autosize();
    const turn = { role: 'bot', actions: [], text: '', pending: true };
    log.push({ role: 'user', text: question }, turn);
    history.push({ role: 'user', content: question });
    controller = new AbortController();
    const signal = controller.signal;
    paint();
    try {
      const { text: answer } = await runAgent({
        messages: history,
        signal,
        call: async (messages, { final }) => {
          const data = await postJSON('/api/agent', { messages, tabs: tabs.list(), final }, { signal });
          return data.message || {};
        },
        exec: (name, args) => tools[name](args),
        onAction: (a) => {
          const existing = turn.actions.find((x) => x.id === a.id);
          const row = { id: a.id, name: a.name, status: a.status, label: describe(a) };
          if (existing) Object.assign(existing, row);
          else turn.actions.push(row);
          paint();
        },
      });
      turn.text = answer || 'Done.';
      history.push({ role: 'assistant', content: turn.text });
    } catch (err) {
      turn.error = err.name === 'AbortError' ? 'Stopped.' : err.message || 'Something went wrong.';
      history.pop();
    } finally {
      turn.pending = false;
      controller = null;
      persist();
      paint();
    }
  }

  function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (controller) controller.abort();
    else ask(input.value);
  });
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !panel.hidden && panel.contains(document.activeElement)) toggle(false);
  });

  document.body.append(fab, panel);
  paint();
  return { toggle, ask, tools, el: panel };
}
