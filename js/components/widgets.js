import { h, icon, clear, fill } from '../lib/dom.js';
import { evaluate, formatNumber } from '../lib/calc.js';
import { settings } from '../lib/store.js';

/* --------------------------------- Weather -------------------------------- */

const WMO = {
  0: ['Clear', '☀️', '🌙'],
  1: ['Mostly clear', '🌤️', '🌙'],
  2: ['Partly cloudy', '⛅', '☁️'],
  3: ['Cloudy', '☁️'],
  45: ['Fog', '🌫️'],
  48: ['Freezing fog', '🌫️'],
  51: ['Light drizzle', '🌦️'],
  53: ['Drizzle', '🌦️'],
  55: ['Heavy drizzle', '🌧️'],
  56: ['Freezing drizzle', '🌧️'],
  57: ['Freezing drizzle', '🌧️'],
  61: ['Light rain', '🌦️'],
  63: ['Rain', '🌧️'],
  65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'],
  67: ['Freezing rain', '🌧️'],
  71: ['Light snow', '🌨️'],
  73: ['Snow', '🌨️'],
  75: ['Heavy snow', '❄️'],
  77: ['Snow grains', '🌨️'],
  80: ['Showers', '🌦️'],
  81: ['Showers', '🌧️'],
  82: ['Heavy showers', '🌧️'],
  85: ['Snow showers', '🌨️'],
  86: ['Snow showers', '❄️'],
  95: ['Thunderstorms', '⛈️'],
  96: ['Thunderstorms & hail', '⛈️'],
  99: ['Thunderstorms & hail', '⛈️'],
};
const wx = (code, isDay = true) => {
  const [label, day, night] = WMO[code] || ['—', '🌡️'];
  return { label, emoji: !isDay && night ? night : day };
};

export function createWeatherCard(w) {
  let unit = settings.get('tempUnit') || (w.useFahrenheit ? 'F' : 'C');
  const conv = (c) => Math.round(unit === 'F' ? (c * 9) / 5 + 32 : c);
  const root = h('section', { class: 'weather', 'aria-label': `Weather in ${w.location.name}` });

  function chart() {
    const hours = w.hourly.slice(0, 24);
    if (hours.length < 4) return null;
    const W = 600;
    const H = 70;
    const temps = hours.map((x) => conv(x.temp));
    const min = Math.min(...temps);
    const span = Math.max(Math.max(...temps) - min, 1);
    const x = (i) => (i / (temps.length - 1)) * W;
    const y = (t) => H - 6 - ((t - min) / span) * (H - 16);
    const line = temps.map((t, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(t).toFixed(1)}`).join(' ');
    const area = `${line} L${W} ${H} L0 ${H} Z`;
    const graph = h('div', {
      class: 'weather__graph',
      html: `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="wx-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F9A618" stop-opacity=".32"/><stop offset="1" stop-color="#F9A618" stop-opacity="0"/></linearGradient><linearGradient id="wx-line" x1="0" x2="1"><stop offset="0" stop-color="#F9A618"/><stop offset=".5" stop-color="#F26A1A"/><stop offset="1" stop-color="#D71D63"/></linearGradient></defs><path d="${area}" fill="url(#wx-fill)"/><path d="${line}" fill="none" stroke="url(#wx-line)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`,
    });
    const labels = h('div', { class: 'weather__hours' });
    hours.forEach((hr, i) => {
      if (i % 3 !== 0) return;
      const label = h(
        'span',
        { class: 'weather__hour' },
        h('b', {}, `${temps[i]}°`),
        new Date(hr.time).toLocaleTimeString(undefined, { hour: 'numeric' })
      );
      label.style.left = `${(i / (temps.length - 1)) * 100}%`;
      labels.append(label);
    });
    return h(
      'div',
      { class: 'weather__chart', role: 'img', 'aria-label': 'Temperature over the next 24 hours' },
      graph,
      labels
    );
  }

  function paint() {
    const c = w.current;
    const now = wx(c.code, c.isDay);
    const unitBtn = (u) =>
      h(
        'button',
        {
          type: 'button',
          class: 'weather__unit',
          'aria-pressed': String(unit === u),
          on: {
            click: () => {
              unit = u;
              settings.set('tempUnit', u);
              paint();
            },
          },
        },
        `°${u}`
      );
    fill(
      root,
      h(
        'div',
        { class: 'weather__top' },
        h(
          'div',
          { class: 'weather__now' },
          h('span', { class: 'weather__emoji', 'aria-hidden': 'true' }, now.emoji),
          h('span', { class: 'weather__temp' }, `${conv(c.temp)}`),
          h('div', { class: 'weather__units' }, unitBtn('C'), h('span', { 'aria-hidden': 'true' }, '|'), unitBtn('F')),
          h(
            'ul',
            { class: 'weather__meta' },
            h('li', {}, icon('thermo'), `Feels like ${conv(c.feels)}°`),
            h('li', {}, icon('droplet'), `Humidity ${c.humidity}%`),
            h(
              'li',
              {},
              icon('wind'),
              `Wind ${Math.round(unit === 'F' ? c.wind * 0.621 : c.wind)} ${unit === 'F' ? 'mph' : 'km/h'}`
            )
          )
        ),
        h(
          'div',
          { class: 'weather__place' },
          h('h2', {}, w.location.name),
          h('p', {}, w.location.region),
          h('p', { class: 'weather__cond' }, now.label)
        )
      ),
      chart(),
      h(
        'div',
        { class: 'weather__days' },
        w.daily.map((d, i) => {
          const day = wx(d.code);
          return h(
            'div',
            { class: `weather__day${i === 0 ? ' is-today' : ''}`, title: day.label },
            h(
              'span',
              { class: 'weather__dname' },
              i === 0 ? 'Today' : new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
            ),
            h('span', { class: 'weather__demoji', 'aria-label': day.label }, day.emoji),
            h(
              'span',
              { class: 'weather__drange' },
              h('b', {}, `${conv(d.max)}°`),
              ' ',
              h('span', {}, `${conv(d.min)}°`)
            ),
            d.precip ? h('span', { class: 'weather__dprecip' }, `${d.precip}%`) : null
          );
        })
      ),
      h('p', { class: 'weather__credit' }, 'Weather data by Open-Meteo')
    );
  }
  paint();
  return root;
}

/* ------------------------------- Calculator ------------------------------- */

export function createCalculator(initial) {
  let expr = initial.replace(/\s+/g, ' ').trim();
  let justEvaluated = true;
  const exprEl = h('div', { class: 'calc__expr' });
  const resultEl = h('div', { class: 'calc__result', 'aria-live': 'polite' });

  const show = () => {
    const v = evaluate(expr);
    exprEl.textContent = justEvaluated && v !== null ? `${expr} =` : '';
    resultEl.textContent = justEvaluated ? (v === null ? 'Error' : formatNumber(v)) : expr || '0';
  };

  const press = (key) => {
    if (key === 'AC') {
      expr = '';
      justEvaluated = false;
    } else if (key === '⌫') {
      if (justEvaluated) expr = '';
      expr = expr.slice(0, -1);
      justEvaluated = false;
    } else if (key === '=') {
      justEvaluated = true;
    } else {
      if (justEvaluated) {
        const v = evaluate(expr);
        expr = /[+\-×÷^%]/.test(key) && v !== null ? String(Math.round(v * 1e10) / 1e10) : '';
        justEvaluated = false;
      }
      expr += key === 'π' ? 'π' : key;
    }
    show();
  };

  const keys = [
    '(',
    ')',
    '%',
    'AC',
    '⌫',
    '7',
    '8',
    '9',
    '÷',
    '√(',
    '4',
    '5',
    '6',
    '×',
    '^',
    '1',
    '2',
    '3',
    '-',
    'π',
    '0',
    '.',
    '=',
    '+',
    'e',
  ];
  const keyEls = keys.map((k) =>
    h(
      'button',
      {
        type: 'button',
        class: `calc__key${/[0-9.]/.test(k) ? ' calc__key--num' : ''}${k === '=' ? ' calc__key--eq' : ''}${k === 'AC' ? ' calc__key--clear' : ''}`,
        on: { click: () => press(k === '√(' ? 'sqrt(' : k) },
      },
      k === '√(' ? '√' : k
    )
  );
  show();
  return h(
    'section',
    { class: 'calc', 'aria-label': 'Calculator' },
    h('div', { class: 'calc__display' }, exprEl, resultEl),
    h('div', { class: 'calc__keys' }, keyEls)
  );
}
