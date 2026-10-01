import { h, icon } from '../lib/dom.js';
import { createSearchBox } from '../components/searchbox.js';
import { createSettingsMenu } from '../components/panels.js';
import { settings } from '../lib/store.js';
import { searchUrl } from '../lib/routes.js';

const IDEAS = [
  'How do black holes form?',
  'Plan a 3-day trip to Kyoto',
  'Best budget laptops for students',
  'Explain quantum computing simply',
  'Weather in London',
  'Easy weeknight pasta recipes',
  'What is the James Webb telescope finding?',
  'Compare Python vs JavaScript for beginners',
];

export function renderHome(root, { go, onSettings }) {
  const box = createSearchBox({ autofocus: true, onSubmit: (q, tab) => go(q, tab) });
  const ideas = [...IDEAS].sort(() => Math.random() - 0.5).slice(0, 4);

  root.replaceChildren(
    h(
      'div',
      { class: 'home' },
      h('div', { class: 'home__glow', 'aria-hidden': 'true' }),
      h(
        'header',
        { class: 'home__top' },
        h(
          'nav',
          { class: 'home__links', 'aria-label': 'Quick links' },
          h(
            'a',
            {
              href: searchUrl("today's top stories", 'news'),
              on: { click: (e) => (e.preventDefault(), go("today's top stories", 'news')) },
            },
            'News'
          ),
          h(
            'a',
            {
              href: searchUrl('nature photography', 'images'),
              on: { click: (e) => (e.preventDefault(), go('nature photography', 'images')) },
            },
            'Images'
          )
        ),
        createSettingsMenu({ settings, onChange: onSettings })
      ),
      h(
        'main',
        { class: 'home__main' },
        h(
          'h1',
          { class: 'brand' },
          h('img', { class: 'brand__mark', src: 'assets/spark-mark.png', alt: '', width: 96, height: 83 }),
          h('span', { class: 'brand__word' }, 'Spark')
        ),
        h('p', { class: 'home__tagline' }, 'Search the web with a spark of intelligence.'),
        h('div', { class: 'home__search' }, box.el),
        h(
          'div',
          { class: 'home__actions' },
          h(
            'button',
            {
              class: 'btn btn--soft',
              type: 'button',
              on: { click: () => (box.input.value.trim() ? go(box.input.value.trim()) : box.focus()) },
            },
            'Spark Search'
          ),
          h(
            'button',
            {
              class: 'btn btn--spark',
              type: 'button',
              on: { click: () => (box.input.value.trim() ? go(box.input.value.trim(), 'ai') : box.focus()) },
            },
            icon('sparkleSolid'),
            'Ask Spark'
          )
        ),
        h(
          'div',
          { class: 'home__ideas' },
          h('span', { class: 'home__ideas-label' }, 'Try'),
          ideas.map((idea, i) =>
            h(
              'button',
              {
                class: 'chip chip--idea',
                type: 'button',
                style: { animationDelay: `${200 + i * 60}ms` },
                on: { click: () => go(idea, /^(weather|best|easy)/i.test(idea) ? 'all' : 'ai') },
              },
              icon(/^(weather|best|easy)/i.test(idea) ? 'search' : 'sparkle'),
              idea
            )
          )
        )
      ),
      h(
        'footer',
        { class: 'home__footer' },
        h('span', {}, '© Spark Search'),
        h(
          'span',
          { class: 'home__footer-right' },
          h('span', {}, 'No accounts. No tracking.'),
          h('span', { class: 'dot', 'aria-hidden': 'true' }),
          h('span', { class: 'home__footer-ai' }, icon('sparkle'), 'AI by Grok')
        )
      )
    )
  );
}
