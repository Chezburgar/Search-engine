// Replaces global fetch with canned upstream responses so the server can be
// exercised offline:  node --import ./test/fixtures/mock-fetch.js server/index.js
// Also imported directly by the integration tests.

const enc = new TextEncoder();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DELAY = Number(process.env.MOCK_DELAY ?? 25);

export const calls = [];

const SITES = [
  [
    'NASA Science',
    'https://science.nasa.gov/universe/black-holes/',
    'A black hole is an astronomical object with a gravitational pull so strong that nothing, not even light, can escape it.',
  ],
  [
    'Wikipedia',
    'https://en.wikipedia.org/wiki/Black_hole',
    'A black hole is a region of spacetime where gravity is so strong that nothing, including light and other electromagnetic waves, is capable of possessing enough energy to escape it.',
  ],
  [
    'Space.com',
    'https://www.space.com/15421-black-holes-facts-formation-discovery-sdcmp.html',
    'Black holes are some of the strangest and most fascinating objects in space. They form when the core of a massive star collapses under its own gravity.',
  ],
  [
    'Britannica',
    'https://www.britannica.com/science/black-hole',
    'Black hole, cosmic body of extremely intense gravity from which nothing, not even light, can escape. A black hole can be formed by the death of a massive star.',
  ],
  [
    'ESA',
    'https://www.esa.int/Science_Exploration/Space_Science/Black_holes',
    'Stellar-mass black holes form when stars more than about 20 times the mass of the Sun run out of fuel and collapse.',
  ],
  [
    'Scientific American',
    'https://www.scientificamerican.com/article/how-do-black-holes-form/',
    'Astronomers think supermassive black holes grew from smaller seeds through mergers and by swallowing gas in the early universe.',
  ],
  [
    'Harvard CfA',
    'https://www.cfa.harvard.edu/research/topic/black-holes',
    'Black holes come in different sizes: stellar-mass, intermediate-mass and supermassive black holes at the centers of galaxies.',
  ],
  [
    'Event Horizon Telescope',
    'https://eventhorizontelescope.org/',
    'The Event Horizon Telescope captured the first image of a black hole, M87*, in 2019 and Sagittarius A* in 2022.',
  ],
];

function ddgHtml(q) {
  const items = SITES.map(
    ([title, url, snippet], i) => `
  <div class="result results_links results_links_deep web-result ">
    <div class="links_main links_deep result__body">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=${encodeURIComponent(url)}&amp;rut=abc${i}">${title} — ${q.replace(/</g, '')}</a>
      </h2>
      <div class="result__extras"><div class="result__extras__url">
        <a class="result__url" href="${url}">${new URL(url).host}</a>
        ${i === 2 ? '<span>&nbsp; &nbsp; 2026-08-14T00:00:00.0000000</span>' : ''}
      </div></div>
      <a class="result__snippet" href="${url}">${snippet.replace(/black holes?/i, (m) => `<b>${m}</b>`)}</a>
    </div>
  </div>`
  );
  const ad = `<div class="result results_links results_links_deep result--ad "><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=ads.example.com">Sponsored thing</a></h2><a class="result__snippet" href="#">Buy now</a></div>`;
  return `<!DOCTYPE html><html><body><div class="results">${ad}${items.join('')}</div>
  <div class="nav-link"><form action="/html/" method="post"><input type="submit" class="btn btn--alt" value="Next" />
  <input type="hidden" name="q" value="${q}" /><input type="hidden" name="s" value="10" /><input type="hidden" name="nextParams" value="" />
  <input type="hidden" name="v" value="l" /><input type="hidden" name="o" value="json" /><input type="hidden" name="dc" value="11" />
  <input type="hidden" name="api" value="d.js" /><input type="hidden" name="vqd" value="4-123456" /></form></div></body></html>`;
}

export function svgThumb(i) {
  const hues = [
    [30, 340],
    [200, 260],
    [20, 50],
    [320, 280],
    [180, 220],
    [10, 330],
  ];
  const [a, b] = hues[i % hues.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><defs><radialGradient id="g" cx="40%" cy="40%" r="80%"><stop offset="0" stop-color="hsl(${a},90%,60%)"/><stop offset=".55" stop-color="hsl(${b},70%,30%)"/><stop offset="1" stop-color="#0b0a10"/></radialGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="${150 + ((i * 37) % 120)}" cy="${130 + ((i * 23) % 60)}" r="${30 + (i % 4) * 10}" fill="#000" stroke="hsl(${a},100%,70%)" stroke-width="6" opacity=".9"/></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

const ANSWERS = {
  overview: () =>
    `**Black holes form when gravity crushes matter into a region so dense that not even light can escape** [1][2]. Most begin as the collapsed cores of very massive stars [3][5].

- **Stellar collapse:** stars above roughly 20 solar masses run out of fuel, their cores implode, and the outer layers blast away in a supernova [5][4].
- **Growth by mergers:** black holes merge with each other and swallow surrounding gas, growing over billions of years [6].
- **Supermassive giants:** the monsters at galaxy centers likely grew from early "seed" black holes [6][7].
- **Seen directly:** the Event Horizon Telescope imaged M87* in 2019 and our galaxy's Sagittarius A* in 2022 [8].`,
  news: () =>
    `Black-hole research is moving fast this week, led by new telescope observations [1].

- Astronomers reported a record-breaking black hole merger detected by gravitational-wave observatories [2].
- JWST spotted unusually massive black holes in the early universe, challenging growth models [3][4].
- A new EHT movie shows the shadow of M87* shifting over time [5].`,
  chat: () =>
    `### How stars become black holes
When a star more than about **20 times the Sun's mass** exhausts its nuclear fuel, its core can no longer resist gravity [1].

1. The core collapses in under a second.
2. A supernova blows off the outer layers [2].
3. If the remnant exceeds ~3 solar masses, nothing stops the collapse — a **black hole** forms [3].

| Type | Typical mass |
|---|---|
| Stellar | 5–100 Suns |
| Supermassive | millions–billions of Suns |

Want to know how we *detect* them?`,
  summarize: () =>
    `**TL;DR:** NASA explains what black holes are, how they form, and how astronomers find them.

- Black holes form when massive stars collapse at the end of their lives.
- Supermassive black holes sit at the centers of most large galaxies.
- They're detected through their effect on nearby stars and gas, and via gravitational waves.`,
  related: () =>
    `What happens if you fall into a black hole?
Can a black hole die?
How big is the largest black hole?
Is there a black hole near Earth?`,
};

function pickAnswer(body) {
  const sys = body.messages?.[0]?.content || '';
  if (/People also ask/.test(sys)) return 'related';
  if (/summarize web pages/.test(sys)) return 'summarize';
  if (/news briefing/.test(sys)) return 'news';
  if (/search overview/.test(sys)) return 'overview';
  return 'chat';
}

function sseStream(text) {
  const chunks = text.match(/[\s\S]{1,7}/g) || [];
  return new ReadableStream({
    async start(controller) {
      for (const c of chunks) {
        controller.enqueue(
          enc.encode(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`)
        );
        await sleep(DELAY);
      }
      controller.enqueue(enc.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const text = (body, type = 'text/html') => new Response(body, { status: 200, headers: { 'Content-Type': type } });

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  calls.push({ url: url.href, method: init.method || 'GET', body: init.body });
  await sleep(DELAY * 2);
  const host = url.hostname;

  if (host === 'api.x.ai') {
    if (url.pathname.endsWith('/models')) {
      return json({
        data: [
          'grok-4-0709',
          'grok-3-mini',
          'grok-4-1-fast-non-reasoning',
          'grok-4-1-fast-reasoning',
          'grok-code-fast-1',
          'grok-2-image-1212',
        ].map((id) => ({ id })),
      });
    }
    const body = JSON.parse(init.body);
    if (process.env.MOCK_XAI_FAIL) return json({ error: 'Incorrect API key provided' }, 401);
    const kind = pickAnswer(body);
    const lastUser = [...body.messages].reverse().find((m) => m.role === 'user')?.content || '';
    const answer = ANSWERS[kind](lastUser.split('\n')[0].replace(/^Query: /, ''));
    if (!body.stream) return json({ choices: [{ message: { role: 'assistant', content: answer } }] });
    return new Response(sseStream(answer), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }
  if (host === 'html.duckduckgo.com') {
    const q = url.searchParams.get('q') || new URLSearchParams(init.body || '').get('q') || '';
    return text(ddgHtml(q));
  }
  if (host === 'suggestqueries.google.com') {
    const q = url.searchParams.get('q');
    return json([
      q,
      [
        `${q} for kids`,
        `${q} explained`,
        `${q} facts`,
        `${q} images`,
        `${q} vs neutron star`,
        `${q} 2026`,
        `how do ${q} work`,
      ],
    ]);
  }
  if (host.endsWith('wikipedia.org') && url.pathname === '/w/api.php') {
    return json({
      query: {
        search: [
          {
            title: 'Black hole',
            snippet: 'A <span class="searchmatch">black hole</span> is a region of spacetime',
            timestamp: '2026-09-01T00:00:00Z',
          },
        ],
      },
    });
  }
  if (host.endsWith('wikipedia.org') && url.pathname.startsWith('/api/rest_v1/page/summary/')) {
    return json({
      type: 'standard',
      title: 'Black hole',
      description: 'Region of spacetime from which nothing can escape',
      extract:
        "A black hole is a massive, compact astronomical object so dense that its gravity prevents anything from escaping, even light. Albert Einstein's theory of general relativity predicts that a sufficiently compact mass will form a black hole. The boundary of no escape is called the event horizon.",
      thumbnail: { source: svgThumb(1), width: 320, height: 213 },
      content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Black_hole' } },
    });
  }
  if (host === 'news.google.com') {
    const items = [
      ['Record-breaking black hole merger detected', 'Reuters', 'https://www.reuters.com', 1],
      ['JWST finds surprisingly massive early black holes', 'The New York Times', 'https://www.nytimes.com', 5],
      ['New Event Horizon Telescope images reveal M87* changes', 'BBC', 'https://www.bbc.com', 20],
      [
        'What a black hole would really look like up close',
        'Scientific American',
        'https://www.scientificamerican.com',
        50,
      ],
      ['Astronomers spot a black hole wandering alone', 'NASA', 'https://www.nasa.gov', 120],
    ]
      .map(
        ([t, s, u, h]) =>
          `<item><title>${t} - ${s}</title><link>https://news.google.com/rss/articles/${encodeURIComponent(t)}</link><pubDate>${new Date(Date.now() - h * 3600e3).toUTCString()}</pubDate><description>&lt;a href="#"&gt;${t}&lt;/a&gt;&amp;nbsp;&amp;nbsp;&lt;font color="#6f6f6f"&gt;${s}&lt;/font&gt;</description><source url="${u}">${s}</source></item>`
      )
      .join('');
    return text(`<?xml version="1.0"?><rss><channel>${items}</channel></rss>`, 'application/xml');
  }
  if (host === 'api.openverse.org') {
    const page = Number(url.searchParams.get('page') || 1);
    const sizes = [
      [400, 300],
      [300, 400],
      [500, 280],
      [400, 400],
      [640, 360],
      [300, 450],
    ];
    return json({
      page_count: 3,
      results: Array.from({ length: 20 }, (_, i) => {
        const [w, h] = sizes[(i + page) % sizes.length];
        return {
          id: `${page}-${i}`,
          title: `Black hole render ${page}-${i + 1}`,
          url: `https://img.mock.test/${i + page}.svg`,
          thumbnail: `https://img.mock.test/${i + page}.svg`,
          width: w,
          height: h,
          foreign_landing_url: 'https://www.flickr.com/photos/nasa/123',
          source: 'flickr',
          creator: 'NASA Goddard',
          license: 'by',
          license_version: '2.0',
        };
      }),
    });
  }
  if (host === 'geocoding-api.open-meteo.com') {
    return json({
      results: [
        {
          name: 'London',
          latitude: 51.5,
          longitude: -0.12,
          country: 'United Kingdom',
          country_code: 'GB',
          admin1: 'England',
        },
      ],
    });
  }
  if (host === 'api.open-meteo.com') {
    const now = new Date();
    now.setMinutes(0, 0, 0);
    return json({
      current: {
        time: now.toISOString(),
        temperature_2m: 17.4,
        apparent_temperature: 16.1,
        relative_humidity_2m: 68,
        weather_code: 2,
        wind_speed_10m: 14.2,
        is_day: 1,
        precipitation: 0,
      },
      hourly: {
        time: Array.from({ length: 24 }, (_, i) => new Date(now.getTime() + i * 3600e3).toISOString().slice(0, 16)),
        temperature_2m: Array.from({ length: 24 }, (_, i) => 14 + 5 * Math.sin((i - 4) / 4)),
        weather_code: Array.from({ length: 24 }, () => 2),
        precipitation_probability: Array.from({ length: 24 }, (_, i) => (i * 7) % 60),
      },
      daily: {
        time: Array.from({ length: 7 }, (_, i) => new Date(now.getTime() + i * 86400e3).toISOString().slice(0, 10)),
        weather_code: [2, 61, 3, 0, 1, 80, 95],
        temperature_2m_max: [19, 16, 15, 21, 22, 18, 17],
        temperature_2m_min: [11, 10, 9, 12, 13, 12, 11],
        precipitation_probability_max: [10, 80, 30, 0, 5, 60, 70],
      },
    });
  }
  // Any other site: a generic article page (used by page reading / summaries).
  return text(
    `<html><head><title>Black holes explained</title><meta name="description" content="All about black holes"></head><body><nav>Menu Home About</nav><article><h1>Black holes</h1><p>Black holes form when massive stars collapse at the end of their lives, compressing their cores into an incredibly small space.</p><p>Supermassive black holes, millions to billions of times the mass of the Sun, sit at the centers of most large galaxies including the Milky Way.</p><p>Astronomers detect black holes through their gravitational effect on nearby stars and gas, and through gravitational waves produced when they merge.</p></article><footer>Copyright</footer></body></html>`
  );
}

if (!process.env.MOCK_FETCH_PASSTHROUGH) globalThis.fetch = mockFetch;
export { mockFetch };
