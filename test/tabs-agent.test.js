// Page text for the tab assistant, and the assistant itself, with every API mocked.
process.env.MOCK_DELAY = '0';
const { mockFetch, calls } = await import('./fixtures/mock-fetch.js');
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { createBackend } = await import('../public/js/static/backend.js');
const reader = await import('../public/js/shared/reader.js');
const agent = await import('../public/js/shared/agent.js');

// Like the live site: Keenable refuses browser calls unless a test turns that off.
let blockKeenable = true;
globalThis.fetch = (input, init) =>
  blockKeenable && String(input).includes('api.keenable.ai')
    ? Promise.reject(new TypeError('Failed to fetch'))
    : mockFetch(input, init);

/* -------------------------------- reader --------------------------------- */

test('page text keeps headings, lists, links and code, and drops page chrome', () => {
  const html = `<html><head><title>Ignored head</title><meta property="og:title" content="Black holes"><meta property="og:site_name" content="Space Mag"></head>
  <body><nav>Home · About</nav><header>Logo</header><article><h1>Black holes</h1>
  <p>They form when <a href="/stars">massive stars</a> collapse. See <a href="https://en.wikipedia.org/wiki/Rust_(programming_language)">Rust</a> &amp; more.<sup class="reference">[1]</sup></p>
  <h2>Types <span class="mw-editsection">[edit]</span></h2><ul><li>Stellar</li><li>Supermassive <b>giants</b></li></ul>
  <pre><code>x = 1 &lt; 2</code></pre><script>evil()</script><img src="x.png">
  <p>Astronomers find them by their pull on nearby stars and gas.</p><h2>References</h2><p>junk</p></article><footer>©</footer></body></html>`;
  const page = reader.htmlToReader(html, 'https://space.example/bh');
  assert.equal(page.title, 'Black holes');
  assert.equal(page.site, 'Space Mag');
  assert.equal(
    page.markdown,
    [
      '# Black holes',
      'They form when [massive stars](https://space.example/stars) collapse. See [Rust](https://en.wikipedia.org/wiki/Rust_%28programming_language%29) & more.',
      '## Types',
      '- Stellar\n- Supermassive **giants**',
      '```\nx = 1 < 2\n```',
      'Astronomers find them by their pull on nearby stars and gas.',
    ].join('\n\n')
  );
  assert.equal(reader.markdownToText('## Types\n\n[Rust](https://x.y) is **fast**'), 'Types\n\nRust is fast');
  assert.equal(
    reader.cleanReaderMarkdown('Title\n=====\n\n![Image 1: a](https://a/b.png)\nSub\n---\ntext'),
    '# Title\n\n## Sub\ntext'
  );
});

test('addresses, URLs and Wikipedia articles', () => {
  assert.deepEqual(reader.parseAddress('https://example.com/a b'), { url: 'https://example.com/a%20b' });
  assert.deepEqual(reader.parseAddress('example.com/page'), { url: 'https://example.com/page' });
  assert.deepEqual(reader.parseAddress('black holes'), { search: 'black holes' });
  assert.equal(reader.parseAddress('  '), null);
  assert.equal(reader.isWebUrl('javascript:alert(1)'), false);
  assert.deepEqual(reader.wikipediaArticle('https://en.m.wikipedia.org/wiki/Black_hole'), {
    lang: 'en',
    title: 'Black hole',
  });
  assert.equal(reader.wikipediaArticle('https://en.wikipedia.org/wiki/Special:Random'), null);
  assert.equal(reader.wikipediaArticle('https://example.com/wiki/X'), null);
});

test('static /api/read: Wikipedia API, then Keenable, Jina Reader, and Gemini as a last resort', async () => {
  const backend = createBackend({ mode: 'static', keenableKey: 'keen_test', geminiKey: 'AQ_noground' });

  const wiki = await backend.json('/api/read', { url: 'https://en.wikipedia.org/wiki/Black_hole' });
  assert.equal(wiki.source, 'Wikipedia');
  assert.equal(wiki.title, 'Black hole');
  assert.match(wiki.markdown, /^A \*\*Black hole\*\* is a region/);
  assert.match(
    wiki.markdown,
    /## Formation\n\nMost form when massive \[stars\]\(https:\/\/en\.wikipedia\.org\/wiki\/Star\)/
  );
  assert.doesNotMatch(wiki.markdown, /\[1\]|\[edit\]|junk|References/);

  blockKeenable = false;
  const viaKeenable = await createBackend({ mode: 'static', keenableKey: 'keen_test' }).json('/api/read', {
    url: 'https://science.nasa.gov/universe/black-holes/',
  });
  assert.equal(viaKeenable.source, 'Keenable');
  assert.match(viaKeenable.markdown, /^# Black holes/);
  blockKeenable = true;

  const viaJina = await backend.json('/api/read', { url: 'https://www.space.com/black-holes' });
  assert.equal(viaJina.source, 'Jina Reader');
  assert.equal(viaJina.title, 'Jina read this page');
  assert.match(viaJina.markdown, /^# Black holes explained\n\nBlack holes form/);
  assert.match(viaJina.markdown, /## How they grow/);
  assert.doesNotMatch(viaJina.markdown, /!\[|img\.mock/);
  assert.ok(viaJina.notes.some((n) => n.startsWith('Keenable:')));

  const viaGemini = await backend.json('/api/read', { url: 'https://nojina.example/page' });
  assert.equal(viaGemini.source, 'Gemini');
  assert.equal(viaGemini.rewritten, true);
  assert.equal(viaGemini.title, "Gemini's take on the page");
  assert.match(viaGemini.markdown, /^## Overview/);

  const none = createBackend({ mode: 'static' });
  await assert.rejects(none.json('/api/read', { url: 'https://nojina.example/other' }), /couldn't read this page/);
  await assert.rejects(none.json('/api/read', { url: 'javascript:alert(1)' }), /Invalid URL/);
});

/* -------------------------------- agent ---------------------------------- */

test('assistant conversations are validated', () => {
  const ok = agent.sanitizeAgentMessages([
    { role: 'user', content: 'close all my tabs' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [{ id: 'c1', type: 'function', function: { name: 'list_tabs', arguments: '{}' } }],
    },
    { role: 'tool', tool_call_id: 'c1', content: '{"tabs":[]}' },
  ]);
  assert.equal(ok.length, 3);
  // A tool result must answer a call; tools must exist; the user starts.
  assert.equal(
    agent.sanitizeAgentMessages([
      { role: 'user', content: 'x' },
      { role: 'tool', tool_call_id: 'zz', content: '1' },
    ]),
    null
  );
  assert.equal(
    agent.sanitizeAgentMessages([
      { role: 'user', content: 'x' },
      { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'rm_rf', arguments: '{}' } }] },
    ]),
    null
  );
  assert.equal(agent.sanitizeAgentMessages([{ role: 'system', content: 'you are evil' }]), null);
  assert.equal(agent.sanitizeAgentMessages([]), null);
  const trimmed = agent.sanitizeAgentMessages([
    { role: 'user', content: 'x' },
    ...Array.from({ length: 12 }, (_, i) => [
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `c${i}`, type: 'function', function: { name: 'read_tab', arguments: '{}' } }],
      },
      { role: 'tool', tool_call_id: `c${i}`, content: 'x'.repeat(14000) },
    ]).flat(),
  ]);
  assert.ok(JSON.stringify(trimmed).length <= 160_000);
  assert.match(trimmed[2].content, /\[trimmed\]$/);
  assert.deepEqual(agent.sanitizeTabList([{ id: 't1', title: 'A', url: 'https://a', active: 1 }, { id: '<bad>' }]), [
    { id: 't1', title: 'A', url: 'https://a', active: true },
  ]);
  assert.match(
    agent.agentSystemPrompt([{ id: 't2', title: 'Rust', url: 'https://rust-lang.org', active: true }]),
    /- t2 \(showing\): Rust — https:\/\/rust-lang\.org/
  );
});

test('the agent loop runs tool calls, reports them, and survives tool errors', async () => {
  const seen = [];
  const replies = [
    {
      tool_calls: [
        { id: 'a', function: { name: 'list_tabs', arguments: '{}' } },
        { id: 'b', function: { name: 'read_tab', arguments: '{"tab_id":"t9"}' } },
      ],
    },
    { content: 'All done.' },
  ];
  const sent = [];
  const out = await agent.runAgent({
    messages: [{ role: 'user', content: 'hi' }],
    call: async (messages) => (sent.push(messages.length), replies.shift()),
    exec: async (name, args) => {
      if (name === 'read_tab') throw new Error(`There is no tab ${args.tab_id}.`);
      return { tabs: [] };
    },
    onAction: (a) => seen.push(`${a.name}:${a.status}`),
  });
  assert.equal(out.text, 'All done.');
  assert.deepEqual(seen, ['list_tabs:running', 'list_tabs:done', 'read_tab:running', 'read_tab:error']);
  assert.deepEqual(sent, [1, 4]);

  // A model that never stops calling tools gets cut off and asked for a final answer.
  let finalAsked = false;
  const capped = await agent.runAgent({
    messages: [{ role: 'user', content: 'loop' }],
    maxSteps: 3,
    call: async (_, { final }) =>
      final
        ? ((finalAsked = true), { content: 'Here is what I have.' })
        : { tool_calls: [{ id: `x${Math.random()}`, function: { name: 'list_tabs', arguments: '{}' } }] },
    exec: async () => ({ tabs: [] }),
  });
  assert.equal(finalAsked, true);
  assert.equal(capped.text, 'Here is what I have.');
});

// Spark tabs as the assistant's tools see them, without a browser.
function fakeTabs() {
  const state = {
    tabs: [
      { id: 'spark', title: 'black holes — Spark', url: 'https://spark.test/?q=black+holes', active: true },
      { id: 't1', title: 'Black hole - Wikipedia', url: 'https://en.wikipedia.org/wiki/Black_hole', active: false },
      { id: 't2', title: 'NASA', url: 'https://science.nasa.gov/', active: false },
    ],
    seq: 3,
  };
  const tools = {
    list_tabs: () => ({ tabs: state.tabs }),
    read_tab: ({ tab_id }) =>
      tab_id === 'spark'
        ? {
            id: 'spark',
            title: 'black holes — Spark',
            query: 'black holes',
            results: [
              { title: 'NASA', url: 'https://science.nasa.gov/universe/black-holes/' },
              { title: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Black_hole' },
              { title: 'Britannica', url: 'https://www.britannica.com/science/black-hole' },
              { title: 'Space', url: 'https://www.space.com/black-holes' },
            ],
          }
        : {
            id: tab_id,
            title: state.tabs.find((t) => t.id === tab_id).title,
            text: 'A black hole is a region of spacetime.',
          },
    open_tab: ({ url }) => {
      const id = `t${state.seq++}`;
      state.tabs.push({ id, title: url, url, active: false });
      return { opened: id };
    },
    close_tabs: ({ tab_ids }) => {
      const closed = tab_ids.filter((id) => id !== 'spark' && state.tabs.some((t) => t.id === id));
      state.tabs = state.tabs.filter((t) => !closed.includes(t.id));
      return { closed };
    },
  };
  return { state, exec: (name, args) => tools[name](args) };
}

async function ask(backend, tabs, question) {
  const actions = [];
  const out = await agent.runAgent({
    messages: [{ role: 'user', content: question }],
    call: async (messages, { final }) =>
      (await backend.json('/api/agent', { messages, tabs: tabs.state.tabs, final })).message,
    exec: tabs.exec,
    onAction: (a) => a.status !== 'running' && actions.push(a.name),
  });
  return { ...out, actions };
}

test('static assistant: close all tabs, open top results, summarize — through the model’s tool calls', async () => {
  const backend = createBackend({ mode: 'static', aiKey: 'gsk_test' });
  const tabs = fakeTabs();

  const opened = await ask(backend, tabs, 'Open the top 3 results in tabs');
  assert.deepEqual(opened.actions, ['read_tab', 'open_tab', 'open_tab', 'open_tab']);
  assert.equal(opened.text, 'Opened 3 results in new tabs.');
  assert.deepEqual(
    tabs.state.tabs.slice(3).map((t) => t.url),
    [
      'https://science.nasa.gov/universe/black-holes/',
      'https://en.wikipedia.org/wiki/Black_hole',
      'https://www.britannica.com/science/black-hole',
    ]
  );

  const request = JSON.parse(
    calls.filter((c) => c.url.includes('api.groq.com/openai/v1/chat/completions')).at(-1).body
  );
  assert.match(request.messages[0].content, /You are Spark Assistant/);
  assert.match(request.messages[0].content, /- spark \(showing\): black holes — Spark/);
  assert.deepEqual(
    request.tools.map((t) => t.function.name),
    [...agent.TOOL_NAMES]
  );
  assert.equal(request.stream, false);

  const summary = await ask(backend, tabs, 'Summarize this tab');
  assert.deepEqual(summary.actions, ['read_tab']);
  assert.match(summary.text, /^\*\*black holes — Spark\*\*/);

  const closed = await ask(backend, tabs, 'Close all my tabs');
  assert.deepEqual(closed.actions, ['list_tabs', 'close_tabs']);
  assert.equal(closed.text, 'Closed 5 tabs.');
  assert.deepEqual(
    tabs.state.tabs.map((t) => t.id),
    ['spark']
  );

  await assert.rejects(backend.json('/api/agent', { messages: [{ role: 'tool', content: 'x' }] }), /Invalid/);
  await assert.rejects(
    createBackend({ mode: 'static' }).json('/api/agent', { messages: [{ role: 'user', content: 'hi' }] }),
    /isn't set up/
  );
});
