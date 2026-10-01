import { h, icon } from './lib/dom.js';
import { aiStatus } from './lib/api.js';
import { searchUrl, homeUrl, isResultsPage, gradesUrl, isGradesPage } from './lib/routes.js';
import { settings, recent } from './lib/store.js';
import { createSearchBox } from './components/searchbox.js';
import { createSettingsMenu, installCitationTips } from './components/panels.js';
import { renderHome } from './views/home.js';
import { renderAll } from './views/all.js';
import { renderAI } from './views/ai.js';
import { renderImages } from './views/images.js';
import { renderNews } from './views/news.js';
import { renderVideos } from './views/videos.js';
import { tabs } from './tabs/tabs.js';
import { createAssistant } from './tabs/assistant.js';

// Spark Grades loads on first visit only.
const renderGrades = (...args) => import('./views/grades.js').then((m) => m.renderGrades(...args));

const app = document.getElementById('app');
const TABS = [
  { id: 'all', label: 'All', icon: 'search', view: renderAll },
  { id: 'ai', label: 'Spark AI', icon: 'sparkle', view: renderAI },
  { id: 'images', label: 'Images', icon: 'image', view: renderImages },
  { id: 'news', label: 'News', icon: 'news', view: renderNews },
  { id: 'videos', label: 'Videos', icon: 'video', view: renderVideos, when: () => features.videos },
];

let shell = null;
let pageController = null;
let ai = { enabled: false };
let assistant = null;
let sparkTitle = 'Spark';

// The Spark tab's title; the browser tab shows it only while Spark (not a page) is showing.
function setTitle(title) {
  sparkTitle = title;
  if (tabs.active === 'spark') document.title = title;
}
let features = { videos: false };

// Hands an overview / "People also ask" answer to the Spark AI tab so the chat continues it.
const handoff = {
  pending: null,
  put(q, value) {
    this.pending = { q: q.toLowerCase(), value };
  },
  take(q) {
    const p = this.pending;
    this.pending = null;
    return p && p.q === q.toLowerCase() ? p.value : null;
  },
};

function applyTheme() {
  const theme = settings.get('theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function parseLocation() {
  const url = new URL(location.href);
  const q = (url.searchParams.get('q') || '').trim();
  if (isGradesPage(url)) return { view: 'grades' };
  if (isResultsPage(url)) {
    const tab = TABS.some((t) => t.id === url.searchParams.get('tab')) ? url.searchParams.get('tab') : 'all';
    return { view: 'results', q, tab };
  }
  return { view: 'home' };
}

export function go(q, tab = 'all', { replace = false } = {}) {
  const url = searchUrl(q, tab);
  if (replace || url === location.pathname + location.search) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  render();
}

function goGrades(params = {}, { replace = false } = {}) {
  const url = gradesUrl(params);
  if (replace) history.replaceState(null, '', url);
  else history.pushState(null, '', url);
  render();
}

function goHome(e) {
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
  e?.preventDefault();
  history.pushState(null, '', homeUrl());
  render();
}

function openChat(q, value) {
  handoff.put(q, value);
  go(q, 'ai');
}

// From the search box's image button: start a Spark AI chat about the pictures.
function askAboutImages(images, text) {
  const question = text || "What's in this image?";
  openChat(question, { ask: question, images });
}

function onSettings(key) {
  if (key === 'theme') applyTheme();
  if (key === 'safe' && parseLocation().view === 'results') render();
}

function buildShell() {
  // A new query from the header stays on the current tab.
  const searchbox = createSearchBox({
    compact: true,
    onSubmit: (q, tab) => go(q, tab || shell.tab),
    onImage: ai.enabled ? askAboutImages : undefined,
  });
  const tabs = h('nav', { class: 'tabs', 'aria-label': 'Search type' });
  const tabEls = TABS.filter((t) => !t.when || t.when()).map((t) => {
    const a = h(
      'a',
      { class: `tab tab--${t.id}`, href: '#', dataset: { tab: t.id } },
      icon(t.icon),
      h('span', { class: 'tab__label' }, t.label)
    );
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
      e.preventDefault();
      go(shell.q, t.id);
    });
    tabs.append(a);
    return a;
  });
  const topbar = h(
    'header',
    { class: 'topbar' },
    h(
      'div',
      { class: 'topbar__row' },
      h(
        'a',
        {
          class: 'topbar__brand',
          href: homeUrl(),
          'aria-label': 'Spark home',
          on: {
            click: (e) => {
              e.preventDefault();
              history.pushState(null, '', homeUrl());
              render();
            },
          },
        },
        h('img', { src: 'assets/spark-mark.png', alt: '', width: 36, height: 31 }),
        h('span', { class: 'wordmark' }, 'Spark')
      ),
      searchbox.el,
      h('div', { class: 'topbar__actions' }, createSettingsMenu({ settings, onChange: onSettings }))
    ),
    tabs
  );
  const content = h('main', { class: 'page', id: 'main' });
  const el = h(
    'div',
    { class: 'shell' },
    h('a', { class: 'skip-link', href: '#main' }, 'Skip to results'),
    topbar,
    content
  );

  const onScroll = () => topbar.classList.toggle('is-scrolled', window.scrollY > 4);
  window.addEventListener('scroll', onScroll, { passive: true });

  return {
    el,
    content,
    searchbox,
    q: '',
    tab: 'all',
    update({ q, tab }) {
      this.q = q;
      this.tab = tab;
      searchbox.setValue(q);
      el.dataset.tab = tab;
      tabEls.forEach((a) => {
        const active = a.dataset.tab === tab;
        a.classList.toggle('is-active', active);
        a.href = searchUrl(q, a.dataset.tab);
        if (active) a.setAttribute('aria-current', 'page');
        else a.removeAttribute('aria-current');
      });
    },
  };
}

function render() {
  tabs.noteSparkUrl();
  pageController?.abort();
  pageController = new AbortController();
  const loc = parseLocation();
  document.body.classList.remove('no-scroll');

  if (loc.view === 'home') {
    shell = null;
    setTitle('Spark');
    document.body.dataset.view = 'home';
    renderHome(app, { go, goGrades, onSettings, onImage: ai.enabled ? askAboutImages : undefined });
    return;
  }

  if (loc.view === 'grades') {
    shell = null;
    document.body.dataset.view = 'grades';
    setTitle('Spark Grades');
    window.scrollTo({ top: 0 });
    renderGrades(app, { signal: pageController.signal, navigate: goGrades, home: goHome });
    return;
  }

  if (!shell) {
    shell = buildShell();
    app.replaceChildren(shell.el);
  }
  const changedQuery = shell.q !== loc.q;
  shell.update(loc);
  document.body.dataset.view = 'results';
  setTitle(`${loc.q} — Spark`);
  if (changedQuery) recent.add(loc.q);
  window.scrollTo({ top: 0 });

  const tab = TABS.find((t) => t.id === loc.tab);
  tab.view(shell.content, { q: loc.q, signal: pageController.signal, go, ai, openChat, handoff });
}

document.addEventListener('keydown', (e) => {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const input = document.querySelector('.searchbox__input');
  if (input) {
    e.preventDefault();
    input.focus();
    input.select();
  }
});

// Pages open in Spark tabs (set up first: it handles Back from a page tab).
tabs.init({
  spark: () => ({ title: sparkTitle, url: location.href }),
  search: (q) => go(q),
  toggleAssistant: () => assistant?.toggle(),
});
window.addEventListener('popstate', render);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

applyTheme();
installCitationTips();
aiStatus().then((status) => {
  ai = status.ai || { enabled: false };
  if (ai.enabled) assistant = createAssistant({ go: (q, tab) => go(q, tab) });
  features = { videos: Boolean(status.videos) };
  document.documentElement.classList.toggle('ai-off', !ai.enabled);
  render();
});
