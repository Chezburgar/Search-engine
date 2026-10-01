import { h, icon, fill } from '../lib/dom.js';
import { streamAnswer } from './answer.js';
import { sourceChip } from './ai-bits.js';
import { safe } from '../lib/api.js';
import { searchUrl } from '../lib/routes.js';

/* ----------------------------- Knowledge panel ---------------------------- */

export function createKnowledgePanel(k, { onAsk }) {
  const portrait = k.image && k.image.height > k.image.width * 1.05;
  const img = k.image
    ? h('img', { class: 'kp__img', src: k.image.src, alt: k.title, loading: 'lazy', decoding: 'async' })
    : null;
  return h(
    'aside',
    { class: `kp${portrait ? ' kp--portrait' : ''}${img ? '' : ' kp--noimg'}`, 'aria-label': `About ${k.title}` },
    img && !portrait ? h('div', { class: 'kp__media' }, img) : null,
    h(
      'div',
      { class: 'kp__head' },
      h(
        'div',
        {},
        h('h2', { class: 'kp__title' }, k.title),
        k.description ? h('p', { class: 'kp__desc' }, k.description) : null
      ),
      img && portrait ? h('div', { class: 'kp__thumb' }, img) : null
    ),
    h(
      'div',
      { class: 'kp__body' },
      h('p', { class: 'kp__extract' }, k.extract),
      h(
        'a',
        { class: 'kp__source', href: k.url, target: '_blank', rel: 'noopener' },
        icon('book'),
        h('span', {}, 'Wikipedia'),
        icon('external', 'kp__ext')
      ),
      onAsk
        ? h(
            'button',
            {
              class: 'btn btn--spark-outline kp__ask',
              type: 'button',
              on: { click: () => onAsk(`Tell me about ${k.title}`) },
            },
            icon('sparkle'),
            h('span', {}, `Ask Spark about ${k.title}`)
          )
        : null
    )
  );
}

/* ----------------------------- People also ask ---------------------------- */

export function createPeopleAlsoAsk(questions, { onContinue }) {
  const list = h('div', { class: 'paa__list' });
  for (const question of questions) {
    let controller = null;
    let loaded = false;
    let answer = '';
    let answerSources = [];
    const panel = h('div', { class: 'paa__a', hidden: true });
    const btn = h(
      'button',
      { class: 'paa__q', type: 'button', 'aria-expanded': 'false' },
      h('span', {}, question),
      icon('chevronDown', 'paa__chev')
    );
    btn.addEventListener('click', async () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      panel.hidden = !open;
      if (!open) return controller?.abort();
      if (loaded) return;
      controller = new AbortController();
      const body = h('div', { class: 'paa__body' });
      const foot = h('div', { class: 'paa__foot' });
      panel.replaceChildren(body, foot);
      try {
        const out = await streamAnswer(body, {
          path: '/api/chat',
          body: { messages: [{ role: 'user', content: question }], safe: safe() },
          signal: controller.signal,
          stages: { initial: 'Searching', searching: 'Searching', reading: 'Reading sources', writing: 'Answering' },
        });
        answer = out.text;
        answerSources = out.sources;
        if (!answer) return;
        loaded = true;
        fill(
          foot,
          h('div', { class: 'ai-sources ai-sources--compact' }, answerSources.slice(0, 4).map(sourceChip)),
          onContinue
            ? h(
                'button',
                {
                  class: 'link-btn',
                  type: 'button',
                  on: { click: () => onContinue(question, { text: answer, sources: answerSources }) },
                },
                'Continue in Spark AI',
                icon('arrowRight')
              )
            : null
        );
      } catch {}
    });
    list.append(h('div', { class: 'paa__item' }, btn, panel));
  }
  return h(
    'section',
    { class: 'paa', 'aria-label': 'People also ask' },
    h(
      'h2',
      { class: 'section-title' },
      'People also ask',
      h('span', { class: 'badge-ai' }, icon('sparkle'), 'Answered by Spark')
    ),
    list
  );
}

/* ---------------------------- Related searches ---------------------------- */

export function createRelatedSearches(q, suggestions, { onSearch }) {
  const items = suggestions.filter((s) => s.toLowerCase() !== q.toLowerCase()).slice(0, 8);
  if (!items.length) return null;
  const words = new Set(q.toLowerCase().split(/\s+/));
  return h(
    'section',
    { class: 'related', 'aria-label': 'Related searches' },
    h('h2', { class: 'section-title' }, 'Related searches'),
    h(
      'div',
      { class: 'related__grid' },
      items.map((s) =>
        h(
          'a',
          {
            class: 'related__item',
            href: searchUrl(s),
            on: {
              click: (e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey) return;
                e.preventDefault();
                onSearch(s);
              },
            },
          },
          icon('search'),
          h(
            'span',
            {},
            s.split(/(\s+)/).map((w) => (w.trim() && !words.has(w.toLowerCase()) ? h('b', {}, w) : w))
          )
        )
      )
    )
  );
}

/* ------------------------------ Settings menu ----------------------------- */

export function createSettingsMenu({ settings, onChange }) {
  const btn = h(
    'button',
    {
      class: 'iconbtn',
      type: 'button',
      'aria-label': 'Settings',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      title: 'Settings',
    },
    icon('sliders')
  );
  const seg = (key, label, options) => {
    const group = h('div', { class: 'seg', role: 'group', 'aria-label': label });
    const paint = () =>
      [...group.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === settings.get(key))));
    for (const [value, text, ico] of options) {
      group.append(
        h(
          'button',
          {
            type: 'button',
            dataset: { value },
            on: {
              click: () => {
                settings.set(key, value);
                paint();
                onChange?.(key, value);
              },
            },
          },
          ico ? icon(ico) : null,
          text
        )
      );
    }
    paint();
    return h('div', { class: 'popover__row' }, h('div', { class: 'popover__label' }, label), group);
  };

  const pop = h(
    'div',
    { class: 'popover', role: 'dialog', 'aria-label': 'Settings', hidden: true },
    seg('theme', 'Appearance', [
      ['light', 'Light', 'sun'],
      ['dark', 'Dark', 'moon'],
      ['system', 'Auto', 'monitor'],
    ]),
    seg('safe', 'SafeSearch', [
      ['strict', 'Strict'],
      ['moderate', 'Moderate'],
      ['off', 'Off'],
    ]),
    h('p', { class: 'popover__note' }, 'Settings are saved in this browser only.')
  );
  const wrap = h('div', { class: 'popover-wrap' }, btn, pop);
  const close = () => {
    pop.hidden = true;
    btn.setAttribute('aria-expanded', 'false');
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
    btn.setAttribute('aria-expanded', String(!pop.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !pop.hidden) {
      close();
      btn.focus();
    }
  });
  return wrap;
}

/* ---------------------------- Citation tooltips --------------------------- */

export function installCitationTips() {
  const tip = h('div', { class: 'cite-tip', role: 'tooltip', hidden: true });
  document.body.append(tip);
  let current = null;
  const hide = () => {
    tip.hidden = true;
    current = null;
  };
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest?.('a.cite[href]');
    if (!a) return current && !e.target.closest?.('.cite-tip') ? hide() : undefined;
    if (a === current) return;
    current = a;
    fill(
      tip,
      h(
        'div',
        { class: 'cite-tip__host' },
        h('img', {
          src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(a.dataset.host)}&sz=32`,
          alt: '',
          width: 14,
          height: 14,
        }),
        a.dataset.host
      ),
      h('div', { class: 'cite-tip__title' }, a.dataset.title)
    );
    tip.hidden = false;
    const r = a.getBoundingClientRect();
    const w = tip.offsetWidth;
    const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    const above = r.top > tip.offsetHeight + 16;
    tip.style.left = `${left}px`;
    tip.style.top = `${above ? r.top - tip.offsetHeight - 8 : r.bottom + 8}px`;
  });
  window.addEventListener('scroll', hide, { passive: true });
}
