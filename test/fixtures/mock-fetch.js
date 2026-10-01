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
  vision: () =>
    `The image shows an **artist's illustration of a black hole**: a dark central shadow ringed by a bright, orange accretion disk.

- The glowing ring is hot gas spiraling inward.
- The dark center marks the event horizon's shadow.`,
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

const hasImage = (body) =>
  body.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'));
const textOf = (content) =>
  Array.isArray(content) ? content.find((p) => p.type === 'text')?.text || '' : content || '';

function pickAnswer(body) {
  if (hasImage(body)) return 'vision';
  const sys = body.messages?.[0]?.content || '';
  if (/People also ask/.test(sys)) return 'related';
  if (/summarize web pages/.test(sys)) return 'summarize';
  if (/news briefing/.test(sys)) return 'news';
  if (/search overview/.test(sys)) return 'overview';
  return 'chat';
}

// The tab assistant: a scripted model that calls tools based on the request and the
// results it has seen, then answers.
export function agentReply(body) {
  const msgs = body.messages;
  const lastUserIndex = msgs.map((m) => m.role).lastIndexOf('user');
  const request = textOf(msgs[lastUserIndex].content).toLowerCase();
  const since = msgs.slice(lastUserIndex + 1);
  const toolResults = since.filter((m) => m.role === 'tool').map((m) => JSON.parse(m.content));
  const showing = (msgs[0].content.match(/^- (\S+) \(showing\)/m) || [])[1] || 'spark';
  let n = 0;
  const call = (name, args) => ({
    id: `call_${name}_${since.length}_${n++}`,
    type: 'function',
    function: { name, arguments: JSON.stringify(args) },
  });
  const reply = (message) => json({ choices: [{ message: { role: 'assistant', content: null, ...message } }] });
  if (!body.tools) return reply({ content: 'Final answer without tools.' });

  if (/close all/.test(request)) {
    if (!toolResults.length) return reply({ tool_calls: [call('list_tabs', {})] });
    if (toolResults.length === 1) {
      const ids = toolResults[0].tabs.filter((t) => t.id !== 'spark').map((t) => t.id);
      return reply({ tool_calls: [call('close_tabs', { tab_ids: ids })] });
    }
    return reply({ content: `Closed ${toolResults[1].closed.length} tabs.` });
  }
  if (/open the top (\d)/.test(request)) {
    const count = Number(request.match(/open the top (\d)/)[1]);
    if (!toolResults.length) return reply({ tool_calls: [call('read_tab', { tab_id: 'spark' })] });
    if (toolResults.length === 1) {
      const results = toolResults[0].results || [];
      return reply({
        tool_calls: results.slice(0, count).map((r) => call('open_tab', { url: r.url, background: true })),
      });
    }
    return reply({ content: `Opened ${toolResults.length - 1} results in new tabs.` });
  }
  if (/summari[sz]e/.test(request)) {
    if (!toolResults.length) return reply({ tool_calls: [call('read_tab', { tab_id: showing })] });
    const page = toolResults[0];
    return reply({ content: `**${page.title}**: ${String(page.text || '').slice(0, 80)}` });
  }
  if (!toolResults.length) return reply({ tool_calls: [call('list_tabs', {})] });
  return reply({ content: `You have ${toolResults[0].tabs.length} tabs open.` });
}

function chatReply(body, { think = false } = {}) {
  const kind = pickAnswer(body);
  const lastUser = textOf([...body.messages].reverse().find((m) => m.role === 'user')?.content);
  let answer = ANSWERS[kind](lastUser.split('\n')[0].replace(/^Query: /, ''));
  // Some reasoning models put their thinking inline; Spark must strip it.
  if (think) answer = `<think>Let me look at the image carefully.</think>\n${answer}`;
  if (!body.stream) return json({ choices: [{ message: { role: 'assistant', content: answer } }] });
  return new Response(sseStream(answer), { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
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

/* ------------------------------- Google ---------------------------------- */

const GROUNDED_SITES = SITES.slice(0, 4);

function geminiGrounded(prompt) {
  const query = (prompt.match(/search: "([^"]+)"/) || [])[1] || 'query';
  // Like Gemini: the answer lists pages, and grounding links are Google redirects whose
  // titles are the bare domain.
  const lines = GROUNDED_SITES.map(([title, url, snippet], i) =>
    i === 2 ? `${title} ::: ${snippet}` : `${title} ::: ${url} ::: ${snippet}`
  );
  const text = lines.join('\n');
  let offset = 0;
  const supports = lines.map((line, i) => {
    const seg = { startIndex: offset, endIndex: offset + line.length, text: line };
    offset += line.length + 1;
    return { segment: seg, groundingChunkIndices: [i] };
  });
  return {
    candidates: [
      {
        content: { role: 'model', parts: [{ text }] },
        groundingMetadata: {
          webSearchQueries: [query],
          searchEntryPoint: {
            renderedContent: `<div class="container"><a class="chip" href="https://www.google.com/search?q=${encodeURIComponent(query)}">${query}</a></div>`,
          },
          groundingChunks: GROUNDED_SITES.map(([, url], i) => ({
            web: {
              uri: `https://vertexaisearch.cloud.google.com/grounding-api-redirect/r${i}`,
              title: new URL(url).hostname.replace(/^www\./, ''),
            },
          })),
          groundingSupports: supports,
        },
      },
    ],
  };
}

function youtubeSearch(q) {
  return {
    nextPageToken: 'PAGE2',
    items: Array.from({ length: 6 }, (_, i) => ({
      id: { kind: 'youtube#video', videoId: `vid${i}abcdef` },
      snippet: {
        title: `${q} explained &amp; visualized #${i + 1}`,
        description: `A video about ${q}.`,
        channelTitle: `Channel ${i + 1}`,
        publishedAt: '2026-08-01T12:00:00Z',
        liveBroadcastContent: 'none',
        thumbnails: { high: { url: `https://img.mock.test/${i}.svg` } },
      },
    })),
  };
}

/* ------------------------------ StudentVUE -------------------------------- */

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const SVUE_XML = {
  StudentInfo: `<StudentInfo xmlns:xsd="http://www.w3.org/2001/XMLSchema"><FormattedName>Alex Kim</FormattedName><PermID>123456</PermID><Grade>10</Grade><CurrentSchool>Mock High School</CurrentSchool><NickName /></StudentInfo>`,
  Gradebook: (period) =>
    `<Gradebook><ReportingPeriods><ReportPeriod Index="0" GradePeriod="MP1 Interim" StartDate="8/25/2026" EndDate="9/19/2026" /><ReportPeriod Index="1" GradePeriod="MP1" StartDate="8/25/2026" EndDate="11/3/2026" /></ReportingPeriods>` +
    `<ReportingPeriod GradePeriod="${period === 0 ? 'MP1 Interim' : 'MP1'}" StartDate="8/25/2026" EndDate="11/3/2026" />` +
    `<Courses>` +
    `<Course Period="1" Title="ALGEBRA 2 HN A" Room="210" Staff="Lee, Dana" StaffEMail="dana_lee@mcpsmd.test"><Marks><Mark MarkName="MP1" CalculatedScoreString="B" CalculatedScoreRaw="${period === 0 ? '84.0' : '86.5'}"><GradeCalculationSummary><AssignmentGradeCalc Type="All Tasks / Assessments" Weight="90%" Points="85.00" PointsPossible="100.00" WeightedPct="76.5%" CalculatedMark="B" /><AssignmentGradeCalc Type="Practice/Preparation" Weight="10%" Points="10.00" PointsPossible="10.00" WeightedPct="10%" CalculatedMark="A" /><AssignmentGradeCalc Type="TOTAL" Weight="100%" Points="95" PointsPossible="110" WeightedPct="86.5%" CalculatedMark="B" /></GradeCalculationSummary><Assignments>` +
    `<Assignment GradebookID="a1" Measure="Unit 1 Test" Type="All Tasks / Assessments" Date="9/12/2026" DueDate="9/12/2026" Score="85 out of 100.0000" ScoreType="Raw Score" Points="85.00 / 100.0000" Notes="" />` +
    `<Assignment GradebookID="a2" Measure="Homework 1 &amp; 2" Type="Practice/Preparation" Date="9/5/2026" DueDate="9/5/2026" Score="10 out of 10.0000" ScoreType="Raw Score" Points="10.00 / 10.0000" Notes="" />` +
    `<Assignment GradebookID="a3" Measure="Unit 2 Test" Type="All Tasks / Assessments" Date="10/20/2026" DueDate="10/20/2026" Score="Not Graded" ScoreType="Raw Score" Points="100.0000 Points Possible" Notes="Study chapter 3" />` +
    `</Assignments></Mark></Marks></Course>` +
    `<Course Period="2" Title="AP BIOLOGY A" Room="305" Staff="Ortiz, Sam" StaffEMail="sam_ortiz@mcpsmd.test"><Marks><Mark MarkName="MP1" CalculatedScoreString="A" CalculatedScoreRaw="94.2"><GradeCalculationSummary /><Assignments><Assignment GradebookID="b1" Measure="Lab 1" Type="Labs" Date="9/10/2026" DueDate="9/10/2026" Score="47 out of 50.0000" Points="47.00 / 50.0000" Notes="" /></Assignments></Mark></Marks></Course>` +
    `</Courses></Gradebook>`,
  Attendance: `<Attendance Type="Period" StartPeriod="1" EndPeriod="8"><Absences><Absence AbsenceDate="9/15/2026" Reason="Illness" Note=""><Periods><Period Number="1" Name="Excused Absence" Reason="Illness" Course="ALGEBRA 2 HN A" Staff="Lee, Dana" /><Period Number="2" Name="" Reason="" Course="" Staff="" /></Periods></Absence><Absence AbsenceDate="9/22/2026" Reason="Tardy" Note=""><Periods><Period Number="1" Name="Tardy" Reason="Tardy" Course="ALGEBRA 2 HN A" Staff="Lee, Dana" /></Periods></Absence></Absences></Attendance>`,
  StudentClassList: `<StudentClassSchedule><ClassLists><ClassListing Period="1" CourseTitle="ALGEBRA 2 HN A" RoomName="210" Teacher="Lee, Dana" TeacherEmail="dana_lee@mcpsmd.test" SectionGU="s1" /><ClassListing Period="2" CourseTitle="AP BIOLOGY A" RoomName="305" Teacher="Ortiz, Sam" TeacherEmail="sam_ortiz@mcpsmd.test" SectionGU="s2" /></ClassLists></StudentClassSchedule>`,
  StudentCalendar: `<CalendarListing><EventLists><EventList Date="10/9/2026" Title="No school" DayType="Holiday" /></EventLists></CalendarListing>`,
};

// Answers a ProcessWebServiceRequestMultiWeb envelope the way StudentVUE does.
export function studentVueResponse(envelope) {
  const field = (name) => (envelope.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1] || '';
  const unescape = (s) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&amp;/g, '&');
  const method = field('methodName');
  const password = unescape(field('password'));
  const params = unescape(field('paramStr'));
  let inner;
  if (password !== 'correct-horse') {
    inner = '<RT_ERROR ERROR_MESSAGE="Invalid user id or password"><STACK_TRACE /></RT_ERROR>';
  } else {
    const fixture = SVUE_XML[method];
    const period = (params.match(/<ReportPeriod>(\d+)<\/ReportPeriod>/) || [])[1];
    inner = typeof fixture === 'function' ? fixture(period == null ? 1 : Number(period)) : fixture;
  }
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ProcessWebServiceRequestMultiWebResponse xmlns="http://edupoint.com/webservices/"><ProcessWebServiceRequestMultiWebResult>${esc(inner)}</ProcessWebServiceRequestMultiWebResult></ProcessWebServiceRequestMultiWebResponse></soap:Body></soap:Envelope>`;
}

async function mockFetch(input, init = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  calls.push({ url: url.href, method: init.method || 'GET', body: init.body, headers: init.headers || {} });
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
    if (process.env.MOCK_XAI_FAIL) return json({ error: 'Incorrect API key provided' }, 401);
    const body = JSON.parse(init.body);
    if (body.tools || /You are Spark Assistant/.test(body.messages?.[0]?.content || '')) return agentReply(body);
    return chatReply(body);
  }
  if (host === 'api.groq.com') {
    if (url.pathname.endsWith('/models')) {
      return json({
        data: [
          'whisper-large-v3',
          'openai/gpt-oss-20b',
          'qwen/qwen3.6-27b',
          'groq/compound-mini',
          'openai/gpt-oss-120b',
          'meta-llama/llama-guard-4-12b',
        ].map((id) => ({ id })),
      });
    }
    const body = JSON.parse(init.body);
    if (body.tools || /You are Spark Assistant/.test(body.messages?.[0]?.content || '')) return agentReply(body);
    if (body.model === 'groq/compound-mini') {
      const prompt = textOf(body.messages[0].content);
      if (/^Visit /.test(prompt)) {
        return json({ choices: [{ message: { role: 'assistant', content: ANSWERS.summarize() } }] });
      }
      const query = prompt.replace(/^Search the web for: /, '').split('\n')[0];
      return json({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Here are relevant pages.',
              executed_tools: [
                {
                  index: 0,
                  type: 'search',
                  arguments: JSON.stringify({ query }),
                  search_results: {
                    results: SITES.slice(0, 5).map(([title, url, snippet], i) => ({
                      title,
                      url,
                      content: `${snippet} More on ${query}.`,
                      score: 0.9 - i / 10,
                    })),
                  },
                },
              ],
            },
          },
        ],
      });
    }
    if (body.reasoning_format && !/qwen3/.test(body.model)) {
      return json({ error: { message: 'reasoning_format is not supported with this model' } }, 400);
    }
    return chatReply(body, { think: /qwen3/.test(body.model) });
  }
  if (host === 'generativelanguage.googleapis.com') {
    const key = (init.headers || {})['x-goog-api-key'] || url.searchParams.get('key');
    if (key === 'AIza_blocked') {
      return json(
        {
          error: {
            code: 403,
            message: `Requests to this API generativelanguage.googleapis.com method google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent are blocked.`,
            status: 'PERMISSION_DENIED',
          },
        },
        403
      );
    }
    if (url.pathname.endsWith('/models')) {
      return json({
        models: [
          { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-3.5-flash-image', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-005', supportedGenerationMethods: ['embedContent'] },
        ],
      });
    }
    const body = JSON.parse(init.body || '{}');
    const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
    if (body.tools?.[0]?.url_context) {
      const target = (prompt.match(/https?:\/\/\S+/) || [''])[0];
      const loaded = !/readerfail|unreachable/.test(target);
      const urlContextMetadata = {
        urlMetadata: [
          {
            retrievedUrl: target,
            urlRetrievalStatus: loaded ? 'URL_RETRIEVAL_STATUS_SUCCESS' : 'URL_RETRIEVAL_STATUS_ERROR',
          },
        ],
      };
      // A results page: links as on DuckDuckGo's lite page (redirects, a bare domain, an ad).
      // When the page didn't load, Gemini answers from memory anyway.
      const text = /reader version/.test(prompt)
        ? `# Gemini's take on the page\n\n## Overview\n\nThis page explains how black holes form when massive stars collapse, and how astronomers find them through their pull on nearby stars and gas.\n\n## Key points\n\n- Stellar black holes come from collapsing stars.\n- Supermassive ones sit at the centers of galaxies.`
        : /search results page/.test(prompt)
          ? [
              'Sponsored deal ::: https://duckduckgo.com/y.js?ad_domain=ads.example&u3=x ::: An ad.',
              ...SITES.slice(0, 6).map(([title, link], i) =>
                i === 1
                  ? `${title} ::: ${link.replace(/^https:\/\//, '')} ::: Gemini's summary of ${title}.`
                  : `${title} ::: //duckduckgo.com/l/?uddg=${encodeURIComponent(link)}&rut=abc${i} ::: Gemini's summary of ${title}.`
              ),
            ].join('\n')
          : '**TL;DR:** Gemini read the page.\n- Point one';
      return json({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', urlContextMetadata }] });
    }
    // Free-tier keys have no Google Search grounding quota.
    if (key === 'AQ_noground') {
      return json(
        {
          error: {
            code: 429,
            message: 'You exceeded your current quota, please check your plan and billing details.',
            status: 'RESOURCE_EXHAUSTED',
          },
        },
        429
      );
    }
    return json(geminiGrounded(prompt));
  }
  if (host === 'www.googleapis.com') {
    if (url.pathname === '/customsearch/v1') {
      if (!url.searchParams.get('cx'))
        return json({ error: { code: 400, message: 'Request contains an invalid argument.' } }, 400);
      return json({
        searchInformation: { totalResults: '1200' },
        items: SITES.slice(0, 10).map(([title, link, snippet]) => ({ title, link, snippet })),
      });
    }
    if (url.pathname === '/youtube/v3/search') return json(youtubeSearch(url.searchParams.get('q')));
    if (url.pathname === '/youtube/v3/videos') {
      return json({
        items: url.searchParams
          .get('id')
          .split(',')
          .map((id, i) => ({
            id,
            contentDetails: { duration: i === 0 ? 'PT1H2M3S' : 'PT4M5S' },
            statistics: { viewCount: String(1500 * (i + 1)) },
          })),
      });
    }
  }
  if (host === 'r.jina.ai') {
    const target = decodeURIComponent(url.pathname.slice(1)) + url.search;
    if (/nojina/.test(target)) return json({ code: 451, message: 'blocked' }, 451);
    return json({
      code: 200,
      data: {
        title: 'Jina read this page',
        url: target,
        content: `Black holes explained\n=====================\n\n![Image 1: diagram](https://img.mock.test/1.svg)\n\nBlack holes form when massive stars collapse at the end of their lives, compressing their cores into an incredibly small space.\n\nHow they grow\n-------------\n\nThey grow by [merging](https://example.com/mergers) and by swallowing gas over billions of years.`,
      },
    });
  }
  if (host === 'studentvuelib.up.railway.app' && url.pathname === '/fulfillAxios') {
    const body = JSON.parse(init.body || '{}');
    if (body.url !== 'https://md-mcps-psv.edupoint.com/Service/PXPCommunication.asmx') {
      return json({ status: false, message: 'Unknown district' });
    }
    return json({ status: true, response: studentVueResponse(body.xml) });
  }
  if (host === 'md-mcps-psv.edupoint.com' && url.pathname === '/Service/PXPCommunication.asmx') {
    return text(studentVueResponse(String(init.body || '')), 'text/xml');
  }
  if (host === 'api.keenable.ai') {
    if (url.pathname.startsWith('/v1/search')) {
      const body = JSON.parse(init.body || '{}');
      if (/fallbacktest/.test(body.query)) return json({ error: 'Internal error' }, 500);
      const results = [];
      for (let i = 0; i < Math.min(body.max_results || 10, 45); i++) {
        const [title, url, snippet] = SITES[i % SITES.length];
        results.push({
          url: i < SITES.length ? url : `${url}?page=${i}`,
          title: i < SITES.length ? title : `${title} (${i + 1})`,
          description: '',
          snippet: `Skip to main content\nMenu\nHome About Contact\n${snippet} Researchers continue to study how ${body.query} shapes the universe.\nMore about ${body.query}: astronomers use telescopes and gravitational waves to observe these objects in detail.`,
          published_at: i === 2 ? '2026-08-14T00:00:00Z' : undefined,
        });
      }
      return json({ results });
    }
    if (url.pathname.startsWith('/v1/fetch')) {
      return json({
        url: url.searchParams.get('url'),
        title: 'Black holes explained',
        content:
          '# Black holes\n\nBlack holes form when massive stars collapse at the end of their lives, compressing their cores into an incredibly small space. Supermassive black holes sit at the centers of most large galaxies, including the Milky Way. Astronomers detect them through their gravitational effect on nearby stars and gas.',
      });
    }
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
  if (host.endsWith('wikipedia.org') && url.searchParams.get('action') === 'opensearch') {
    const q = url.searchParams.get('search');
    return json([q, ['Black hole', 'Black hole information paradox', 'Black Hole Sun', 'Black holes in fiction']]);
  }
  if (host.endsWith('wikipedia.org') && url.pathname === '/w/api.php' && url.searchParams.get('action') === 'parse') {
    const page = url.searchParams.get('page');
    return json({
      parse: {
        title: page,
        text: `<div class="mw-parser-output"><p>A <b>${page}</b> is a region of spacetime where gravity is so strong that nothing can escape.<sup class="reference">[1]</sup></p><h2>Formation<span class="mw-editsection">[edit]</span></h2><p>Most form when massive <a href="/wiki/Star" title="Star">stars</a> collapse at the end of their lives.</p><table class="infobox"><tr><td>junk</td></tr></table><h2>References</h2><ol class="references"><li>ref</li></ol></div>`,
      },
    });
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
