// Spark tabs: web pages open inside Spark instead of a new browser tab.
//
// The first tab is always Spark itself (search, AI, grades). Every other tab shows a live page
// in its own frame; frames stay alive while you switch tabs, like a browser. The assistant
// reads a tab's text separately, through /api/read. Tabs last for the browser session.

import { h, icon, fill } from '../lib/dom.js';
import { getJSON } from '../lib/api.js';
import { favicon, siteName } from '../lib/format.js';
import { isWebUrl, parseAddress } from '../shared/reader.js';

export { isWebUrl };

const KEY = 'spark:tabs';
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
          tabs: state.tabs.map(({ id, url, title, history, index }) => ({ id, url, title, history, index })),
        })
      );
    } catch {}
  },
};

function createTabs() {
  const state = { tabs: [], active: 'spark', seq: 1 };
  const frames = new Map(); // tab id → { wrap, frame }
  const listeners = new Set();
  let els = null;
  let sparkInfo = () => ({ title: 'Spark', url: location.href });
  let onSearch = () => {};
  let assistantToggle = null;
  let expectPop = false;

  const get = (id) => state.tabs.find((t) => t.id === id) || null;
  const activeTab = () => get(state.active);
  const emit = () => {
    store.save(state);
    listeners.forEach((fn) => fn());
  };

  /* ------------------------------- reading -------------------------------- */

  // The page's text for the assistant; fetched once per URL and kept on the tab.
  function load(tab) {
    if (tab.page?.url === tab.url) return Promise.resolve(tab.page);
    if (tab.pending?.url === tab.url) return tab.pending.promise;
    const url = tab.url;
    const promise = getJSON('/api/read', { url })
      .then((page) => {
        if (tab.url === url) {
          tab.page = { ...page, url };
          // The frame can't tell us the page's title (other site); the reader can.
          if (page.title && !page.rewritten) {
            tab.title = page.title;
            paintStrip();
            if (state.active === tab.id) document.title = `${tab.title} — Spark`;
            emit();
          }
        }
        return { ...page, url };
      })
      .finally(() => {
        if (tab.pending?.promise === promise) tab.pending = null;
      });
    tab.pending = { url, promise };
    return promise;
  }

  /* ------------------------------- actions -------------------------------- */

  function open(url, { activate = true, title = '' } = {}) {
    if (!isWebUrl(url)) throw new Error(`Not a web address: ${url}`);
    if (state.tabs.length >= MAX_TABS) close(state.tabs[0].id);
    const tab = {
      id: `t${state.seq++}`,
      url,
      title: title.slice(0, 120) || siteName(hostOf(url)),
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
    return tab.id;
  }

  function close(id) {
    const i = state.tabs.findIndex((t) => t.id === id);
    if (i === -1) return false;
    state.tabs.splice(i, 1);
    frames.get(id)?.wrap.remove();
    frames.delete(id);
    if (state.active === id) {
      const next = state.tabs[i] || state.tabs[i - 1];
      activateTab(next ? next.id : 'spark');
    } else {
      paintStrip();
      emit();
    }
    return true;
  }

  // `history: false` leaves the browser history alone (Back/Forward, or a search about to
  // add its own entry).
  function activateTab(id, { history: track = true } = {}) {
    const tab = id === 'spark' ? null : get(id);
    if (id !== 'spark' && !tab) return false;
    const was = state.active;
    state.active = id;
    // Going from Spark to a page adds one history entry, so Back returns to Spark; switching
    // between pages doesn't; going back to Spark removes it.
    if (track && was !== id) {
      if (tab && was === 'spark') history.pushState({ sparkTab: id }, '', location.href);
      else if (tab) history.replaceState({ sparkTab: id }, '', location.href);
      else if (history.state?.sparkTab) {
        expectPop = true;
        history.back();
      }
    }
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
    const f = frames.get(tab.id);
    if (f) pointFrame(f, tab);
    paintStrip();
    if (state.active === tab.id) paintView();
    emit();
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

  /* --------------------------------- view ---------------------------------- */

  function tabButton(tab) {
    const active = state.active === tab.id;
    const host = hostOf(tab.url);
    return h(
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

  // Points a tab's frame at the tab's URL and tracks loading for the strip. After the first
  // load it replaces the frame's page, so Spark's own navigation (address box, back/forward,
  // reload) doesn't pile up entries in the browser's history.
  function pointFrame(f, tab) {
    tab.status = 'loading';
    f.frame.title = tab.title;
    if (f.started) {
      try {
        f.frame.contentWindow.location.replace(tab.url);
        return;
      } catch {}
    }
    f.started = true;
    f.frame.src = tab.url;
  }

  // A tab's live frame, made the first time the tab is shown.
  function frameFor(tab) {
    let f = frames.get(tab.id);
    if (f) return f;
    const frame = h('iframe', {
      class: 'live__frame',
      title: tab.title,
      sandbox:
        'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads',
      referrerpolicy: 'strict-origin-when-cross-origin',
      allow: 'fullscreen; clipboard-write; encrypted-media; picture-in-picture',
    });
    frame.addEventListener('load', () => {
      tab.status = 'ready';
      paintStrip();
    });
    const external = h(
      'a',
      { href: tab.url, target: '_blank', rel: 'noopener', 'data-external': '', class: 'live__open' },
      'open it in your browser'
    );
    const wrap = h(
      'div',
      { class: 'live', dataset: { tab: tab.id } },
      h(
        'p',
        { class: 'live__note' },
        icon('info'),
        h(
          'span',
          {},
          'Page blank or “refused to connect”? That site doesn’t allow being shown inside other sites — ',
          external,
          '.'
        )
      ),
      frame
    );
    f = { wrap, frame, external };
    frames.set(tab.id, f);
    els.body.append(wrap);
    pointFrame(f, tab);
    return f;
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
    const current = frameFor(tab);
    current.external.href = tab.url;
    for (const [id, f] of frames) f.wrap.hidden = id !== tab.id;
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
      const f = tab && frames.get(tab.id);
      if (f) {
        pointFrame(f, tab);
        paintStrip();
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
        activateTab('spark', { history: false });
        onSearch(target.search);
      }
      address.blur();
    });
    address.addEventListener('focus', () => address.select());
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
      h('div', { class: 'tabview__bar' }, back, forward, reload, addressForm, external, closeBtn),
      body
    );

    document.body.prepend(strip);
    document.body.append(view);
    return { strip, sparkTab, list, view, body, address, back, forward, external };
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
      // Our own history.back() after clicking the Spark tab: nothing else to do.
      if (expectPop) {
        expectPop = false;
        if (!wanted && els.lastSparkUrl === location.href) return e.stopImmediatePropagation();
      }
      if (wanted && get(wanted)) {
        activateTab(wanted, { history: false });
        e.stopImmediatePropagation();
      } else if (state.active !== 'spark') {
        const sameUrl = els.lastSparkUrl === location.href;
        activateTab('spark', { history: false });
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
            id: t.id,
            url: t.url,
            title: t.title,
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
    activate: (id, opts) => activateTab(id, opts),
    navigate,
    back: (id) => step(id, -1),
    forward: (id) => step(id, 1),
    read,
    get active() {
      return state.active;
    },
    list() {
      return [
        { id: 'spark', title: sparkInfo().title, url: sparkInfo().url, active: state.active === 'spark' },
        ...state.tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: state.active === t.id })),
      ];
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export const tabs = createTabs();
