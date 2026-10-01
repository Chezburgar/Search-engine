// Spark tabs: web pages open inside Spark instead of a new browser tab.
//
// The first tab is always Spark itself (search, AI, grades). Every other tab shows a page:
// by default as a reader view (the page's text via /api/read, which also lets the tab
// assistant read it), or live in a frame for sites that allow being shown inside others.
// Tabs last for the browser session.

import { h, icon, fill } from '../lib/dom.js';
import { getJSON } from '../lib/api.js';
import { renderMarkdown, hydrateCitations } from '../lib/markdown.js';
import { favicon, siteName } from '../lib/format.js';
import { isWebUrl, parseAddress } from '../shared/reader.js';

export { isWebUrl };

const KEY = 'spark:tabs';
const LIVE_KEY = 'spark:live-sites';
const MAX_TABS = 24;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const store = {
  load() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || 'null');
    } catch {
      return null;
    }
  },
  save(state) {
    try {
      sessionStorage.setItem(
        KEY,
        JSON.stringify({
          seq: state.seq,
          active: state.active,
          tabs: state.tabs.map(({ id, url, title, mode, history, index }) => ({
            id,
            url,
            title,
            mode,
            history,
            index,
          })),
        })
      );
    } catch {}
  },
};

const liveSites = {
  get() {
    try {
      return new Set(JSON.parse(localStorage.getItem(LIVE_KEY) || '[]'));
    } catch {
      return new Set();
    }
  },
  set(host, on) {
    const set = this.get();
    if (on) set.add(host);
    else set.delete(host);
    try {
      localStorage.setItem(LIVE_KEY, JSON.stringify([...set].slice(-200)));
    } catch {}
  },
};

function createTabs() {
  const state = { tabs: [], active: 'spark', seq: 1 };
  const listeners = new Set();
  let els = null;
  let sparkInfo = () => ({ title: 'Spark', url: location.href });
  let onSearch = () => {};
  let assistantToggle = null;

  const get = (id) => state.tabs.find((t) => t.id === id) || null;
  const activeTab = () => get(state.active);
  const emit = () => {
    store.save(state);
    listeners.forEach((fn) => fn());
  };

  /* ------------------------------- reading -------------------------------- */

  // The page's reader content; fetched once per URL and kept on the tab.
  function load(tab, { force = false } = {}) {
    if (!force && tab.page?.url === tab.url) return Promise.resolve(tab.page);
    if (!force && tab.pending?.url === tab.url) return tab.pending.promise;
    const url = tab.url;
    tab.status = 'loading';
    tab.error = null;
    const promise = getJSON('/api/read', { url })
      .then((page) => {
        if (tab.url !== url) return page;
        tab.page = { ...page, url };
        tab.status = 'ready';
        if (page.title) tab.title = page.title;
        return tab.page;
      })
      .catch((err) => {
        if (tab.url === url) {
          tab.status = 'error';
          tab.error = err.message || 'Spark couldn’t read this page.';
        }
        throw err;
      })
      .finally(() => {
        if (tab.pending?.promise === promise) tab.pending = null;
        if (get(tab.id)) {
          paintStrip();
          if (state.active === tab.id) paintView();
          emit();
        }
      });
    tab.pending = { url, promise };
    return promise;
  }

  /* ------------------------------- actions -------------------------------- */

  function open(url, { activate = true, title = '' } = {}) {
    if (!isWebUrl(url)) throw new Error(`Not a web address: ${url}`);
    if (state.tabs.length >= MAX_TABS) close(state.tabs[0].id);
    const host = hostOf(url);
    const tab = {
      id: `t${state.seq++}`,
      url,
      title: title.slice(0, 120) || siteName(host),
      mode: liveSites.get().has(host) ? 'live' : 'reader',
      history: [url],
      index: 0,
      status: 'idle',
      page: null,
    };
    state.tabs.push(tab);
    if (activate) activateTab(tab.id);
    else {
      paintStrip();
      emit();
    }
    // Background tabs start reading right away so the assistant can use them.
    if (!activate) load(tab).catch(() => {});
    return tab.id;
  }

  function close(id) {
    const i = state.tabs.findIndex((t) => t.id === id);
    if (i === -1) return false;
    state.tabs.splice(i, 1);
    if (state.active === id) {
      const next = state.tabs[i] || state.tabs[i - 1];
      activateTab(next ? next.id : 'spark');
    } else {
      paintStrip();
      emit();
    }
    return true;
  }

  function activateTab(id, { fromHistory = false } = {}) {
    const tab = id === 'spark' ? null : get(id);
    if (id !== 'spark' && !tab) return false;
    const was = state.active;
    state.active = id;
    // A page tab gets its own history entry, so Back returns to Spark.
    if (!fromHistory && tab && was !== id) history.pushState({ sparkTab: id }, '', location.href);
    paintStrip();
    paintView();
    emit();
    return true;
  }

  function navigate(id, url) {
    const tab = get(id);
    if (!tab || !isWebUrl(url)) return false;
    tab.history = [...tab.history.slice(0, tab.index + 1), url].slice(-50);
    tab.index = tab.history.length - 1;
    setUrl(tab, url);
    return true;
  }

  function step(id, delta) {
    const tab = get(id);
    const index = tab ? tab.index + delta : -1;
    if (!tab || index < 0 || index >= tab.history.length) return false;
    tab.index = index;
    setUrl(tab, tab.history[index]);
    return true;
  }

  function setUrl(tab, url) {
    tab.url = url;
    tab.title = siteName(hostOf(url));
    tab.page = null;
    tab.status = 'idle';
    tab.mode = liveSites.get().has(hostOf(url)) ? 'live' : 'reader';
    paintStrip();
    if (state.active === tab.id) paintView();
    emit();
  }

  function setMode(id, mode) {
    const tab = get(id);
    if (!tab || (mode !== 'reader' && mode !== 'live')) return false;
    tab.mode = mode;
    liveSites.set(hostOf(tab.url), mode === 'live');
    if (state.active === id) paintView();
    emit();
    return true;
  }

  async function read(id) {
    if (id === 'spark' || !id) return { id: 'spark', ...sparkInfo() };
    const tab = get(id);
    if (!tab) throw new Error(`There is no tab ${id}.`);
    const page = await load(tab);
    return {
      id,
      url: tab.url,
      title: tab.title,
      site: page.site,
      markdown: page.markdown,
      rewritten: !!page.rewritten,
    };
  }

  // Shows a tab in reader view and highlights the first match of `text`.
  async function find(id, text) {
    const tab = get(id);
    if (!tab) throw new Error(`There is no tab ${id}.`);
    if (tab.mode !== 'reader') setMode(id, 'reader');
    activateTab(id);
    await load(tab);
    paintView();
    const root = els.view.querySelector('.reader__md');
    return root ? highlight(root, text) : null;
  }

  /* --------------------------------- view ---------------------------------- */

  function tabButton(tab) {
    const active = state.active === tab.id;
    const host = hostOf(tab.url);
    const el = h(
      'div',
      {
        class: `stab${active ? ' is-active' : ''}${tab.status === 'loading' ? ' is-loading' : ''}`,
        role: 'tab',
        'aria-selected': String(active),
        tabindex: active ? '0' : '-1',
        title: `${tab.title}\n${tab.url}`,
        dataset: { tab: tab.id },
        on: {
          click: () => activateTab(tab.id),
          auxclick: (e) => e.button === 1 && close(tab.id),
          keydown: (e) => {
            if (e.key === 'Enter' || e.key === ' ') (e.preventDefault(), activateTab(tab.id));
            if (e.key === 'Delete') close(tab.id);
          },
        },
      },
      h('img', { class: 'stab__icon', src: favicon(host), alt: '', width: 16, height: 16, loading: 'lazy' }),
      h('span', { class: 'stab__title' }, tab.title || siteName(host)),
      h(
        'button',
        {
          class: 'stab__close',
          type: 'button',
          'aria-label': `Close ${tab.title}`,
          on: {
            click: (e) => {
              e.stopPropagation();
              close(tab.id);
            },
          },
        },
        icon('x')
      )
    );
    return el;
  }

  function paintStrip() {
    if (!els) return;
    const any = state.tabs.length > 0;
    els.strip.hidden = !any;
    document.body.classList.toggle('has-stabs', any);
    els.sparkTab.classList.toggle('is-active', state.active === 'spark');
    els.sparkTab.setAttribute('aria-selected', String(state.active === 'spark'));
    fill(els.list, state.tabs.map(tabButton));
    els.list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function readerView(tab) {
    if (tab.status === 'error') {
      return h(
        'div',
        { class: 'reader__state' },
        icon('alert'),
        h('h2', {}, 'Spark couldn’t read this page'),
        h('p', {}, tab.error),
        h(
          'div',
          { class: 'reader__actions' },
          h(
            'button',
            { class: 'btn btn--spark btn--sm', type: 'button', on: { click: () => setMode(tab.id, 'live') } },
            'Try the live page'
          ),
          h(
            'a',
            { class: 'btn btn--ghost btn--sm', href: tab.url, target: '_blank', rel: 'noopener', 'data-external': '' },
            'Open in your browser',
            icon('external')
          )
        )
      );
    }
    if (!tab.page) {
      load(tab).catch(() => {});
      return h(
        'div',
        { class: 'reader__loading', role: 'status' },
        h('span', { class: 'gr-spinner' }),
        h('span', {}, `Opening ${siteName(hostOf(tab.url))}…`),
        h('div', { class: 'skeleton-line skeleton-line--title w-64' }),
        h('div', { class: 'skeleton-line w-100' }),
        h('div', { class: 'skeleton-line w-92' }),
        h('div', { class: 'skeleton-line w-100' }),
        h('div', { class: 'skeleton-line w-64' })
      );
    }
    const page = tab.page;
    const md = h('div', { class: 'md reader__md' });
    md.innerHTML = renderMarkdown(page.markdown);
    hydrateCitations(md, []);
    return h(
      'article',
      { class: 'reader' },
      h(
        'header',
        { class: 'reader__head' },
        h(
          'div',
          { class: 'reader__site' },
          h('img', { src: favicon(hostOf(page.url || tab.url)), alt: '', width: 18, height: 18 }),
          h('span', {}, page.site || siteName(hostOf(tab.url))),
          page.source ? h('span', { class: 'reader__via' }, `· via ${page.source}`) : null
        ),
        h('h1', { class: 'reader__title' }, page.title || tab.title),
        page.rewritten
          ? h(
              'p',
              { class: 'reader__note' },
              icon('info'),
              'This site couldn’t be loaded directly, so this is Gemini’s rewrite of the page — not its original text. ',
              h('a', { href: tab.url, target: '_blank', rel: 'noopener', 'data-external': '' }, 'Open the original')
            )
          : null
      ),
      md
    );
  }

  function liveView(tab) {
    return h(
      'div',
      { class: 'live' },
      h(
        'p',
        { class: 'live__note' },
        icon('info'),
        h(
          'span',
          {},
          'Live page. Blank or “refused to connect”? That site doesn’t allow being shown inside other sites — ',
          h('button', { type: 'button', on: { click: () => setMode(tab.id, 'reader') } }, 'use Reader view'),
          ' or ',
          h('a', { href: tab.url, target: '_blank', rel: 'noopener', 'data-external': '' }, 'open it in your browser'),
          '.'
        )
      ),
      h('iframe', {
        class: 'live__frame',
        src: tab.url,
        title: tab.title,
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals',
        referrerpolicy: 'strict-origin-when-cross-origin',
        allow: 'fullscreen; clipboard-write; encrypted-media; picture-in-picture',
      })
    );
  }

  function paintView() {
    if (!els) return;
    const tab = activeTab();
    const app = document.getElementById('app');
    els.view.hidden = !tab;
    document.body.classList.toggle('tab-open', Boolean(tab));
    if (app) app.inert = Boolean(tab);
    if (!tab) {
      document.title = sparkInfo().title || 'Spark';
      return;
    }
    document.title = `${tab.title} — Spark`;
    els.address.value = tab.url;
    els.back.disabled = tab.index <= 0;
    els.forward.disabled = tab.index >= tab.history.length - 1;
    els.external.href = tab.url;
    for (const b of els.modes.querySelectorAll('button'))
      b.setAttribute('aria-pressed', String(b.dataset.mode === tab.mode));
    const body = tab.mode === 'live' ? liveView(tab) : readerView(tab);
    // Keep the live frame (and its scroll) when nothing about it changed.
    const current = els.body.firstElementChild;
    if (tab.mode === 'live' && current?.classList.contains('live') && current.dataset.url === tab.url) return;
    body.dataset.url = tab.url;
    fill(els.body, body);
    els.body.scrollTop = 0;
  }

  /* ---------------------------------- setup -------------------------------- */

  function build() {
    const sparkTab = h(
      'button',
      {
        class: 'stab stab--spark is-active',
        type: 'button',
        role: 'tab',
        'aria-selected': 'true',
        title: 'Spark',
        on: { click: () => activateTab('spark') },
      },
      h('img', { src: 'assets/spark-mark.png', alt: '', width: 20, height: 17 }),
      h('span', { class: 'stab__title' }, 'Spark')
    );
    const list = h('div', { class: 'stabs__list', role: 'presentation' });
    const assistantBtn = h(
      'button',
      {
        class: 'stabs__assistant',
        type: 'button',
        title: 'Tab assistant',
        on: { click: () => assistantToggle?.() },
      },
      icon('sparkleSolid'),
      h('span', {}, 'Assistant')
    );
    const strip = h(
      'div',
      { class: 'stabs', role: 'tablist', 'aria-label': 'Spark tabs', hidden: true },
      sparkTab,
      list,
      assistantBtn
    );

    const iconBtn = (name, label, onClick) =>
      h(
        'button',
        { class: 'iconbtn iconbtn--sm', type: 'button', title: label, 'aria-label': label, on: { click: onClick } },
        icon(name)
      );
    const back = iconBtn('arrowLeft', 'Back', () => step(state.active, -1));
    const forward = iconBtn('arrowRight', 'Forward', () => step(state.active, 1));
    const reload = iconBtn('refresh', 'Reload', () => {
      const tab = activeTab();
      if (!tab) return;
      if (tab.mode === 'live') {
        const frame = els.body.querySelector('iframe');
        if (frame) frame.src = tab.url;
      } else {
        tab.page = null;
        load(tab, { force: true }).catch(() => {});
        paintView();
      }
    });
    const address = h('input', {
      class: 'tabview__address',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      'aria-label': 'Address',
      enterkeyhint: 'go',
    });
    const addressForm = h('form', { class: 'tabview__addr', role: 'search' }, icon('globe'), address);
    addressForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const target = parseAddress(address.value);
      if (!target) return;
      if (target.url) navigate(state.active, target.url);
      else {
        activateTab('spark');
        onSearch(target.search);
      }
      address.blur();
    });
    address.addEventListener('focus', () => address.select());
    const modes = h(
      'div',
      { class: 'seg tabview__modes', role: 'group', 'aria-label': 'View' },
      ...[
        ['reader', 'Reader', 'book'],
        ['live', 'Live', 'globe'],
      ].map(([mode, label, ico]) =>
        h(
          'button',
          { type: 'button', dataset: { mode }, on: { click: () => setMode(state.active, mode) } },
          icon(ico),
          h('span', {}, label)
        )
      )
    );
    const external = h(
      'a',
      {
        class: 'iconbtn iconbtn--sm',
        href: '#',
        target: '_blank',
        rel: 'noopener',
        title: 'Open in your browser',
        'aria-label': 'Open in your browser',
        'data-external': '',
      },
      icon('external')
    );
    const closeBtn = iconBtn('x', 'Close tab', () => close(state.active));
    const body = h('div', { class: 'tabview__body' });
    const view = h(
      'section',
      { class: 'tabview', hidden: true, 'aria-label': 'Page' },
      h('div', { class: 'tabview__bar' }, back, forward, reload, addressForm, modes, external, closeBtn),
      body
    );

    // Links in the reader stay in this tab (modifier-clicks keep the browser's behavior).
    body.addEventListener('click', (e) => {
      const a = e.target.closest('a[href]');
      if (!a || a.hasAttribute('data-external') || !a.closest('.reader__md')) return;
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (!isWebUrl(a.href)) return;
      e.preventDefault();
      e.stopPropagation();
      navigate(state.active, a.href);
    });

    document.body.prepend(strip);
    document.body.append(view);
    return { strip, sparkTab, list, view, body, address, back, forward, external, modes };
  }

  // Every other web link in Spark opens in a Spark tab.
  function interceptLinks() {
    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.('a[href]');
      if (!a || a.hasAttribute('data-external') || a.hasAttribute('download')) return;
      if (!isWebUrl(a.href) || new URL(a.href).origin === location.origin) return;
      e.preventDefault();
      open(a.href, { title: (a.getAttribute('title') || a.textContent || '').trim() });
    });
  }

  // Back from a page tab returns to Spark without reloading it.
  function watchHistory() {
    window.addEventListener('popstate', (e) => {
      const wanted = e.state?.sparkTab;
      if (wanted && get(wanted)) {
        activateTab(wanted, { fromHistory: true });
        e.stopImmediatePropagation();
      } else if (state.active !== 'spark') {
        const sameUrl = els.lastSparkUrl === location.href;
        activateTab('spark', { fromHistory: true });
        if (sameUrl) e.stopImmediatePropagation();
      }
    });
  }

  return {
    init({ spark, search, toggleAssistant } = {}) {
      if (els) return;
      if (spark) sparkInfo = spark;
      if (search) onSearch = search;
      if (toggleAssistant) assistantToggle = toggleAssistant;
      els = build();
      const saved = store.load();
      if (saved?.tabs?.length) {
        state.seq = saved.seq || saved.tabs.length + 1;
        state.tabs = saved.tabs
          .filter((t) => isWebUrl(t.url))
          .map((t) => ({
            ...t,
            history: t.history?.length ? t.history : [t.url],
            index: t.index || 0,
            status: 'idle',
            page: null,
          }));
        state.active = get(saved.active) ? saved.active : 'spark';
      }
      interceptLinks();
      watchHistory();
      paintStrip();
      paintView();
      // Remember which Spark URL the tabs sit on top of (for Back).
      const remember = () => (els.lastSparkUrl = location.href);
      remember();
      listeners.add(() => state.active === 'spark' && remember());
    },
    noteSparkUrl() {
      if (els) els.lastSparkUrl = location.href;
    },
    open,
    close,
    activate: (id) => activateTab(id),
    navigate,
    back: (id) => step(id, -1),
    forward: (id) => step(id, 1),
    setMode,
    read,
    find,
    get active() {
      return state.active;
    },
    list() {
      return [
        {
          id: 'spark',
          title: sparkInfo().title,
          url: sparkInfo().url,
          active: state.active === 'spark',
          kind: 'spark',
        },
        ...state.tabs.map((t) => ({
          id: t.id,
          title: t.title,
          url: t.url,
          active: state.active === t.id,
          mode: t.mode,
        })),
      ];
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// Wraps the first case-insensitive match of `text` in <mark> and scrolls to it.
export function highlight(root, text) {
  root.querySelectorAll('mark.find-hit').forEach((m) => m.replaceWith(...m.childNodes));
  root.normalize();
  const needle = String(text || '')
    .trim()
    .toLowerCase();
  if (!needle) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const i = node.data.toLowerCase().indexOf(needle);
    if (i === -1) continue;
    const match = node.splitText(i);
    match.splitText(needle.length);
    const mark = document.createElement('mark');
    mark.className = 'find-hit';
    match.replaceWith(mark);
    mark.append(match);
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const context = (mark.closest('p, li, h2, h3, h4, h5, blockquote') || mark.parentElement).textContent;
    return context.trim().slice(0, 300);
  }
  return null;
}

export const tabs = createTabs();
