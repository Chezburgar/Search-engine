// The GitHub Pages backend (runs in the browser) exercised in Node with mocked APIs.
process.env.MOCK_DELAY = '0';
const { mockFetch, calls } = await import('./fixtures/mock-fetch.js');
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { createBackend } = await import('../public/js/static/backend.js');

// Simulate a browser where Keenable refuses cross-origin calls (fetch throws TypeError).
let blockKeenable = false;
globalThis.fetch = (input, init) => {
  if (blockKeenable && String(input).includes('api.keenable.ai'))
    return Promise.reject(new TypeError('Failed to fetch'));
  return mockFetch(input, init);
};

const collect = async (backend, path, args) => {
  const events = [];
  await backend.stream(path, { ...args, onEvent: (name, data) => events.push({ name, data }) });
  return events;
};
const textOf = (events) =>
  events
    .filter((e) => e.name === 'token')
    .map((e) => e.data.t)
    .join('');

test('static search uses Keenable with the key', async () => {
  const backend = createBackend({ mode: 'static', aiKey: 'gsk_test', keenableKey: 'keen_test' });
  const data = await backend.json('/api/search', { q: 'black holes' });
  assert.equal(data.provider, 'Keenable');
  assert.equal(data.results.length, 20);
  assert.ok(data.results.every((r) => !('extract' in r)));
  const status = await backend.json('/api/status');
  assert.equal(status.ai.provider, 'Groq');
});

test('when the browser blocks Keenable, search, news and summaries fall back to Groq', async () => {
  blockKeenable = true;
  try {
    const backend = createBackend({ mode: 'static', aiKey: 'gsk_test', keenableKey: 'keen_test' });
    const data = await backend.json('/api/search', { q: 'neutron stars' });
    assert.equal(data.provider, 'Groq web search');
    assert.equal(data.results[0].host, 'science.nasa.gov');

    const before = calls.length;
    await backend.json('/api/search', { q: 'pulsars' });
    assert.equal(calls.slice(before).filter((c) => c.url.includes('keenable')).length, 0, 'stops retrying Keenable');

    const news = await backend.json('/api/news', { q: 'pulsars' });
    assert.equal(news.provider, 'Groq web search');
    assert.ok(news.results.length > 0);

    const sum = await collect(backend, '/api/summarize', {
      params: { url: 'https://science.nasa.gov/x', q: 'pulsars' },
    });
    assert.match(textOf(sum), /TL;DR/);
  } finally {
    blockKeenable = false;
  }
});

test('static overview is grounded in sources and streams a cleaned answer', async () => {
  const backend = createBackend({ mode: 'static', aiKey: 'gsk_test', keenableKey: 'keen_test' });
  const events = await collect(backend, '/api/overview', { params: { q: 'how do black holes form' } });
  assert.ok(events.find((e) => e.name === 'sources').data.length >= 6);
  assert.match(textOf(events), /^\*\*Black holes form/);
  assert.equal(events.at(-1).name, 'done');
});

test('static chat answers questions about an attached image without a web search', async () => {
  const backend = createBackend({ mode: 'static', aiKey: 'gsk_test', keenableKey: 'keen_test' });
  const before = calls.length;
  const events = await collect(backend, '/api/chat', {
    body: {
      messages: [{ role: 'user', content: "What's in this image?", images: ['data:image/jpeg;base64,/9j/AAAA'] }],
    },
  });
  assert.match(textOf(events), /^The image shows/);
  assert.deepEqual(events.find((e) => e.name === 'sources').data, []);
  assert.equal(calls.slice(before).filter((c) => c.url.includes('keenable')).length, 0);
  const body = JSON.parse(calls.filter((c) => c.url.includes('chat/completions')).at(-1).body);
  assert.equal(body.model, 'qwen/qwen3.6-27b');
  assert.equal(body.messages.at(-1).content[1].image_url.url, 'data:image/jpeg;base64,/9j/AAAA');
});

test('static site without an AI key reports AI off', async () => {
  const backend = createBackend({ mode: 'static' });
  assert.equal((await backend.json('/api/status')).ai.enabled, false);
  const events = await collect(backend, '/api/overview', { params: { q: 'x' } });
  assert.equal(events[0].data.code, 'not_configured');
});
