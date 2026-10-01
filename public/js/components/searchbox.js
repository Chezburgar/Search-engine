import { h, icon, clear, debounce } from '../lib/dom.js';
import { getJSON } from '../lib/api.js';
import { recent } from '../lib/store.js';

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let uid = 0;

// Google-style combobox: suggestions, recent searches, "Ask Spark" shortcut and voice input.
export function createSearchBox({ value = '', compact = false, autofocus = false, onSubmit }) {
  const listId = `suggest-${++uid}`;
  let items = [];
  let active = -1;
  let keyNav = false;
  let typed = value;
  let controller;

  const input = h('input', {
    class: 'searchbox__input',
    type: 'search',
    name: 'q',
    value,
    placeholder: compact || window.innerWidth < 520 ? 'Search or ask anything' : 'Search the web or ask Spark anything',
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    enterkeyhint: 'search',
    role: 'combobox',
    'aria-label': 'Search',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
  });
  const list = h('ul', { class: 'suggest', id: listId, role: 'listbox', hidden: true });
  const clearBtn = h(
    'button',
    { type: 'button', class: 'iconbtn searchbox__clear', 'aria-label': 'Clear search', hidden: !value },
    icon('x')
  );
  const micBtn = SpeechRecognition
    ? h(
        'button',
        { type: 'button', class: 'iconbtn searchbox__mic', 'aria-label': 'Search by voice', title: 'Search by voice' },
        icon('mic')
      )
    : null;
  const askBtn = h(
    'button',
    { type: 'button', class: 'searchbox__ask', 'aria-label': 'Ask Spark AI', title: 'Ask Spark AI' },
    icon('sparkleSolid')
  );
  const panel = h(
    'div',
    { class: 'searchbox__panel' },
    h(
      'div',
      { class: 'searchbox__field' },
      icon('search', 'searchbox__icon'),
      input,
      clearBtn,
      micBtn ? h('span', { class: 'searchbox__sep', 'aria-hidden': 'true' }) : null,
      micBtn,
      askBtn
    ),
    list
  );
  const form = h('form', { class: `searchbox${compact ? ' searchbox--compact' : ''}`, role: 'search' }, panel);

  const submit = (q, tab) => {
    q = (q ?? input.value).trim();
    if (!q) return input.focus();
    close();
    input.blur();
    onSubmit(q, tab);
  };

  function close() {
    list.hidden = true;
    form.classList.remove('is-open');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
  }

  function setActive(i, { preview = true } = {}) {
    active = i;
    [...list.children].forEach((li, j) => {
      li.classList.toggle('is-active', j === i);
      li.setAttribute('aria-selected', String(j === i));
    });
    if (!preview) return;
    if (i >= 0 && items[i]) {
      input.setAttribute('aria-activedescendant', `${listId}-${i}`);
      if (items[i].kind !== 'ask') input.value = items[i].text;
    } else {
      input.removeAttribute('aria-activedescendant');
      input.value = typed;
    }
  }

  function suggestionLabel(text, q) {
    const lower = text.toLowerCase();
    const prefix = q.toLowerCase();
    if (q && lower.startsWith(prefix)) return [text.slice(0, q.length), h('b', {}, text.slice(q.length))];
    return [text];
  }

  function render(q, suggestions) {
    items = [];
    if (q) items.push({ kind: 'ask', text: q });
    if (!q) for (const r of recent.list().slice(0, 6)) items.push({ kind: 'recent', text: r });
    for (const s of suggestions)
      if (s.toLowerCase() !== q.toLowerCase() || !q) items.push({ kind: 'suggest', text: s });
    if (q && !suggestions.length) items.splice(1);

    clear(list);
    items.forEach((it, i) => {
      const li = h('li', {
        id: `${listId}-${i}`,
        role: 'option',
        class: `suggest__item suggest__item--${it.kind}`,
        'aria-selected': 'false',
        on: {
          mousedown: (e) => e.preventDefault(),
          click: () => submit(it.text, it.kind === 'ask' ? 'ai' : undefined),
          mousemove: () => {
            keyNav = false;
            if (active !== i) setActive(i, { preview: false });
          },
        },
      });
      if (it.kind === 'ask') {
        li.append(
          icon('sparkle', 'suggest__icon'),
          h(
            'span',
            { class: 'suggest__text' },
            h('span', { class: 'suggest__ask-label' }, 'Ask Spark'),
            h('span', { class: 'suggest__ask-q' }, it.text)
          ),
          h('span', { class: 'suggest__hint' }, 'AI answer')
        );
      } else {
        li.append(
          icon(it.kind === 'recent' ? 'clock' : 'search', 'suggest__icon'),
          h('span', { class: 'suggest__text' }, it.kind === 'recent' ? it.text : suggestionLabel(it.text, q))
        );
        if (it.kind === 'recent') {
          li.append(
            h(
              'button',
              {
                type: 'button',
                class: 'suggest__action',
                'aria-label': `Remove ${it.text} from history`,
                title: 'Remove',
                on: {
                  click: (e) => {
                    e.stopPropagation();
                    recent.remove(it.text);
                    render(input.value.trim(), []);
                    input.focus();
                  },
                },
              },
              icon('x')
            )
          );
        } else {
          li.append(
            h(
              'button',
              {
                type: 'button',
                class: 'suggest__action',
                'aria-label': `Edit "${it.text}"`,
                title: 'Edit this search',
                on: {
                  click: (e) => {
                    e.stopPropagation();
                    input.value = typed = `${it.text} `;
                    input.focus();
                    fetchSuggestions();
                  },
                },
              },
              icon('arrowUpLeft')
            )
          );
        }
      }
      list.append(li);
    });

    const show = items.length > 0 && document.activeElement === input;
    list.hidden = !show;
    form.classList.toggle('is-open', show);
    input.setAttribute('aria-expanded', String(show));
    active = -1;
  }

  const fetchSuggestions = debounce(async () => {
    const q = input.value.trim();
    controller?.abort();
    if (!q) return render('', []);
    controller = new AbortController();
    try {
      const { suggestions } = await getJSON('/api/suggest', { q }, { signal: controller.signal });
      if (input.value.trim() === q) render(q, suggestions);
    } catch (err) {
      if (err.name !== 'AbortError') render(q, []);
    }
  }, 110);

  input.addEventListener('input', () => {
    typed = input.value;
    keyNav = false;
    clearBtn.hidden = !input.value;
    const q = input.value.trim();
    if (q) render(q, []); // instant "Ask Spark" row while suggestions load
    fetchSuggestions();
  });
  input.addEventListener('focus', () => {
    form.classList.add('is-focused');
    typed = input.value;
    if (!input.value.trim()) render('', []);
    else fetchSuggestions();
  });
  input.addEventListener('blur', () => {
    form.classList.remove('is-focused');
    setTimeout(close, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (list.hidden) return;
      e.preventDefault();
      keyNav = true;
      const n = items.length;
      const next = e.key === 'ArrowDown' ? (active + 1 >= n ? -1 : active + 1) : active - 1 < -1 ? n - 1 : active - 1;
      setActive(next);
    } else if (e.key === 'Escape') {
      if (!list.hidden) {
        e.preventDefault();
        input.value = typed;
        close();
      } else input.blur();
    } else if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      const it = items[active];
      if (it && !list.hidden && keyNav) submit(it.text, it.kind === 'ask' ? 'ai' : undefined);
      else submit();
    } else if (e.key === 'Tab' && active >= 0 && !list.hidden) {
      typed = input.value;
      close();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit();
  });
  clearBtn.addEventListener('click', () => {
    input.value = typed = '';
    clearBtn.hidden = true;
    input.focus();
    render('', []);
  });
  askBtn.addEventListener('click', () => submit(undefined, 'ai'));

  if (micBtn) {
    let rec = null;
    micBtn.addEventListener('click', () => {
      if (rec) return rec.stop();
      rec = new SpeechRecognition();
      rec.lang = navigator.language || 'en-US';
      rec.interimResults = true;
      rec.maxAlternatives = 1;
      form.classList.add('is-listening');
      const prevPlaceholder = input.placeholder;
      input.placeholder = 'Listening…';
      let finalText = '';
      rec.onresult = (ev) => {
        const res = [...ev.results];
        input.value = res.map((r) => r[0].transcript).join('');
        clearBtn.hidden = !input.value;
        finalText = res
          .filter((r) => r.isFinal)
          .map((r) => r[0].transcript)
          .join('');
      };
      rec.onend = () => {
        form.classList.remove('is-listening');
        input.placeholder = prevPlaceholder;
        rec = null;
        if (finalText.trim()) submit(finalText);
      };
      rec.onerror = () => rec?.stop();
      rec.start();
    });
  }

  if (autofocus) requestAnimationFrame(() => input.focus({ preventScroll: true }));

  return {
    el: form,
    input,
    setValue(v) {
      input.value = typed = v;
      clearBtn.hidden = !v;
    },
    focus() {
      input.focus();
      input.select();
    },
  };
}
