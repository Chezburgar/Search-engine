// The tab assistant panel: ask in plain words, and the AI reads and controls tabs through the
// tools in shared/agent.js. The tools run here, in the browser: on Spark's own tabs, or — with
// the Spark Assistant for Chrome extension — on your real Chrome tabs.

import { h, icon, fill } from '../lib/dom.js';
import { getJSON, postJSON } from '../lib/api.js';
import { renderInto } from '../lib/markdown.js';
import { runAgent } from '../shared/agent.js';
import { markdownToText } from '../shared/reader.js';
import { tabs, isWebUrl } from './tabs.js';
import { connectExtension, extCall } from './extension.js';
import { STATIC } from '../lib/routes.js';

const KEY = 'spark:assistant';
const MODE_KEY = 'spark:assistant-mode';
const SUGGESTIONS = {
  spark: ['Summarize this tab', 'Compare my open tabs', 'Open the top 3 results in tabs', 'Close all my tabs'],
  browser: ['Summarize this tab', 'Compare my open tabs', 'Group my tabs by topic', 'Close duplicate tabs'],
};
const MODES = {
  spark: { label: 'Spark tabs', subtitle: 'Reads and controls your Spark tabs' },
  browser: { label: 'Chrome tabs', subtitle: 'Reads and controls your Chrome tabs' },
};

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

// Chrome tab titles seen in the last list_tabs, for describing actions.
const chromeTitles = new Map();
const titleOf = (id) => chromeTitles.get(Number(id)) || tabs.list().find((t) => t.id === id)?.title || String(id);

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
    case 'find_in_tab':
      return result?.found ? `Found “${clip(args.text, 40)}”` : `Looked for “${clip(args.text, 40)}”`;
    case 'group_tabs':
      return `Grouped ${(args.tab_ids || []).length} tabs as “${clip(args.title, 32)}”`;
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
  find_in_tab: 'search',
  group_tabs: 'layers',
};

const readMode = () => {
  try {
    return localStorage.getItem(MODE_KEY);
  } catch {
    return null;
  }
};

export function createAssistant({ go, embedded = false }) {
  let mode = 'spark';
  let extension = null;

  // Spark-tab tools, as the AI sees them.
  const sparkTools = {
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

  // Chrome-tab tools: carried out by the extension.
  const markSelf = (list) => list.map((t) => (t.url === location.href ? { ...t, self: true } : t));
  const via = (name) => (args) => extCall(name, args);
  const browserTools = {
    async list_tabs() {
      const { tabs: list } = await extCall('list_tabs');
      list.forEach((t) => chromeTitles.set(t.id, t.title));
      return { tabs: markSelf(list) };
    },
    async read_tab(args) {
      const page = await extCall('read_tab', args);
      chromeTitles.set(page.id, page.title);
      return page;
    },
    open_tab: via('open_tab'),
    navigate_tab: via('navigate_tab'),
    switch_tab: via('switch_tab'),
    close_tabs: via('close_tabs'),
    find_in_tab: via('find_in_tab'),
    group_tabs: via('group_tabs'),
    search_web: sparkTools.search_web,
  };
  const tools = () => (mode === 'browser' ? browserTools : sparkTools);

  // The tabs listed in the AI's instructions for each step.
  async function tabsNow() {
    if (mode !== 'browser') return tabs.list();
    try {
      return (await browserTools.list_tabs()).tabs.slice(0, 60);
    } catch {
      return [];
    }
  }

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
  const subtitle = h('p', {}, MODES.spark.subtitle);
  const modeSwitch = h(
    'div',
    { class: 'seg assist__modes', role: 'group', 'aria-label': 'Which tabs', hidden: true },
    Object.entries(MODES).map(([id, m]) =>
      h(
        'button',
        { type: 'button', dataset: { mode: id }, on: { click: () => setMode(id, { remember: true }) } },
        m.label
      )
    )
  );
  const panel = h(
    'aside',
    { class: `assist${embedded ? ' assist--embedded' : ''}`, 'aria-label': 'Spark Assistant', hidden: true },
    h(
      'header',
      { class: 'assist__head' },
      h('span', { class: 'ai-badge' }, icon('sparkle')),
      h('div', { class: 'assist__titles' }, h('h2', {}, 'Assistant'), subtitle),
      clearBtn,
      embedded ? null : closeBtn
    ),
    modeSwitch,
    list,
    form
  );

  function setMode(next, { remember = false } = {}) {
    if (next === 'browser' && !extension) next = 'spark';
    if (next !== mode) {
      mode = next;
      // The AI's memory of the other kind of tabs would only confuse it.
      history = [];
      if (log.length) log.push({ role: 'note', text: `Now working with your ${MODES[mode].label}.` });
      persist();
    }
    if (remember) {
      try {
        localStorage.setItem(MODE_KEY, mode);
      } catch {}
    }
    subtitle.textContent = MODES[mode].subtitle;
    for (const b of modeSwitch.querySelectorAll('button'))
      b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    paint();
  }
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
    if (item.role === 'note') return h('p', { class: 'assist__note' }, item.text);
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
            mode === 'browser'
              ? 'I can read, summarize and compare your Chrome tabs, find things in them, open pages, and switch, group or close tabs.'
              : 'I can read, summarize and compare your Spark tabs, find things in them, open search results, and switch or close tabs.'
          ),
          !extension && !embedded
            ? h(
                'p',
                { class: 'assist__hint' },
                'Want me to work with your real Chrome tabs? ',
                STATIC
                  ? h(
                      'a',
                      { href: 'spark-chrome-extension.zip', download: '', 'data-external': '' },
                      'Get the Spark Chrome extension'
                    )
                  : 'Install the Spark Chrome extension from the extension/ folder',
                ', unzip it, open chrome://extensions, turn on Developer mode, and choose “Load unpacked”.'
              )
            : null,
          h(
            'div',
            { class: 'assist__ideas' },
            SUGGESTIONS[mode].map((s) =>
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
    if (embedded) open = true;
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
      const turnMode = mode;
      const { text: answer } = await runAgent({
        messages: history,
        signal,
        mode: turnMode,
        call: async (messages, { final }) => {
          const data = await postJSON(
            '/api/agent',
            { messages, tabs: await tabsNow(), final, mode: turnMode },
            { signal }
          );
          return data.message || {};
        },
        exec: (name, args) => tools()[name](args),
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

  if (embedded) document.body.append(panel);
  else document.body.append(fab, panel);
  setMode('spark');
  if (embedded) toggle(true);

  // With the extension installed, the assistant can work with real Chrome tabs.
  connectExtension().then((info) => {
    extension = info;
    if (!info) return paint();
    modeSwitch.hidden = embedded;
    setMode(embedded ? 'browser' : readMode() || 'browser');
  });

  return {
    toggle,
    ask,
    tools,
    el: panel,
    get mode() {
      return mode;
    },
  };
}
