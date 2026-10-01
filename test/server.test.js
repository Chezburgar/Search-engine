// End-to-end API tests with all upstream services (xAI, search providers) mocked.
process.env.XAI_API_KEY = 'test-key';
process.env.XAI_MODEL = '';
process.env.MOCK_DELAY = '0';
process.env.AI_RATE_LIMIT = '1000';

const { calls, mockFetch } = await import('./fixtures/mock-fetch.js');
const { default: test, before, after } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: http } = await import('node:http');
const { createServer, isNavigational } = await import('../server/index.js');

let base = '';
let server;

before(async () => {
  server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// The server's upstream calls hit the mocks; the test's own requests go to the server over HTTP.
globalThis.fetch = (input, init) => {
  const url = String(typeof input === 'string' || input instanceof URL ? input : input.url);
  return base && url.startsWith(base) ? request(url, init) : mockFetch(input, init);
};

function request(url, init = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: init.method || 'GET', headers: init.headers || {} }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: async () => body,
          json: async () => JSON.parse(body),
        });
      });
    });
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}

function events(text) {
  return text
    .split('\n\n')
    .filter((b) => b.startsWith('event:'))
    .map((b) => {
      const [, name] = b.match(/^event: (.+)$/m);
      const [, data] = b.match(/^data: (.+)$/m);
      return { name, data: JSON.parse(data) };
    });
}

test('status reports AI enabled with an auto-selected model', async () => {
  const res = await fetch(`${base}/api/status`);
  const data = await res.json();
  assert.equal(data.ai.enabled, true);
  assert.equal(data.ai.model, 'grok-4-1-fast-non-reasoning');
});

test('search returns normalised web results and an overview hint', async () => {
  const res = await fetch(`${base}/api/search?q=how+do+black+holes+form`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.provider, 'DuckDuckGo');
  assert.equal(data.results.length, 8);
  assert.equal(data.results[0].host, 'science.nasa.gov');
  assert.ok(data.next);
  assert.equal(data.overview, true);
});

test('search paginates with the provider cursor', async () => {
  const first = await (await fetch(`${base}/api/search?q=paging+test`)).json();
  const before = calls.length;
  const res = await fetch(`${base}/api/search?q=paging+test&cursor=${encodeURIComponent(first.next)}`);
  const data = await res.json();
  assert.equal(data.results.length, 8);
  const post = calls.slice(before).find((c) => c.url.includes('duckduckgo'));
  assert.equal(post.method, 'POST');
  assert.match(post.body, /vqd=4-123456/);
});

test('weather queries include a forecast and skip the AI overview', async () => {
  const data = await (await fetch(`${base}/api/search?q=weather+in+london`)).json();
  assert.equal(data.weather.location.name, 'London');
  assert.equal(data.weather.daily.length, 7);
  assert.equal(data.overview, false);
});

test('overview streams sources, tokens and done — and is cached', async () => {
  const res = await fetch(`${base}/api/overview?q=black+holes`);
  assert.match(res.headers['content-type'], /text\/event-stream/);
  const evs = events(await res.text());
  const sources = evs.find((e) => e.name === 'sources').data;
  assert.equal(sources[0].n, 1);
  assert.ok(sources.every((s) => s.url && s.host && !('excerpt' in s)));
  const text = evs
    .filter((e) => e.name === 'token')
    .map((e) => e.data.t)
    .join('');
  assert.match(text, /^\*\*Black holes form/);
  assert.equal(evs.at(-1).name, 'done');

  const xaiBefore = calls.filter((c) => c.url.includes('chat/completions')).length;
  const again = events(await (await fetch(`${base}/api/overview?q=black+holes`)).text());
  assert.equal(again.find((e) => e.name === 'done').data.cached, true);
  assert.equal(calls.filter((c) => c.url.includes('chat/completions')).length, xaiBefore);
});

test('overview prompt includes numbered sources and page excerpts', async () => {
  await (await fetch(`${base}/api/overview?q=supernova+remnants`)).text();
  const call = calls.filter((c) => c.url.includes('chat/completions')).at(-1);
  const body = JSON.parse(call.body);
  assert.equal(body.model, 'grok-4-1-fast-non-reasoning');
  assert.equal(body.stream, true);
  assert.match(body.messages[1].content, /\[1\] NASA Science/);
});

test('news briefing and related questions', async () => {
  const news = await (await fetch(`${base}/api/news?q=black+holes`)).json();
  assert.equal(news.provider, 'Google News');
  assert.equal(news.results[0].title, 'Record-breaking black hole merger detected');
  const brief = events(await (await fetch(`${base}/api/overview?q=black+holes&kind=news`)).text());
  assert.ok(brief.some((e) => e.name === 'token'));
  const related = await (await fetch(`${base}/api/related?q=black+holes`)).json();
  assert.equal(related.questions.length, 4);
});

test('chat grounds each turn in web sources', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'black holes' },
        { role: 'assistant', content: 'They are dense.' },
        { role: 'user', content: 'how are they detected?' },
      ],
    }),
  });
  const evs = events(await res.text());
  assert.ok(evs.find((e) => e.name === 'sources').data.length > 0);
  assert.equal(evs.at(-1).name, 'done');
  const body = JSON.parse(calls.filter((c) => c.url.includes('chat/completions')).at(-1).body);
  assert.equal(body.messages[0].role, 'system');
  assert.equal(body.messages.length, 4);
  assert.match(body.messages[3].content, /Web sources for this message/);
  const searched = new URL(calls.filter((c) => c.url.includes('duckduckgo')).at(-1).url).searchParams.get('q');
  assert.equal(searched, 'black holes how are they detected?');
});

test('chat rejects malformed requests', async () => {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"messages":[]}',
  });
  assert.equal(res.status, 400);
  const bad = await fetch(`${base}/api/chat`, { method: 'POST', body: 'not json' });
  assert.equal(bad.status, 400);
});

test('summaries refuse internal addresses', async () => {
  for (const target of [
    'http://127.0.0.1:22/',
    'http://localhost/',
    'file:///etc/passwd',
    'http://169.254.169.254/latest/meta-data',
  ]) {
    const evs = events(await (await fetch(`${base}/api/summarize?url=${encodeURIComponent(target)}`)).text());
    const err = evs.find((e) => e.name === 'error');
    assert.ok(err, target);
    assert.equal(
      evs.some((e) => e.name === 'token'),
      false
    );
  }
});

test('static files are served safely', async () => {
  const home = await fetch(`${base}/search?q=x`);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /<div id="app">/);
  assert.match(home.headers['content-security-policy'], /script-src 'self'/);
  const css = await fetch(`${base}/css/spark.css`);
  assert.match(css.headers['content-type'], /text\/css/);
  for (const path of ['/..%2f.env', '/js/..%2f..%2f.env', '/..%2f..%2fetc%2fpasswd']) {
    const res = await fetch(`${base}${path}`);
    assert.notEqual(res.status, 200, path);
    assert.doesNotMatch(await res.text(), /XAI_API_KEY/);
  }
  assert.equal((await fetch(`${base}/missing.js`)).status, 404);
  assert.match(await (await fetch(`${base}/opensearch.xml`)).text(), /OpenSearchDescription/);
});

test('navigational queries skip the overview', () => {
  assert.equal(isNavigational('youtube', [{ host: 'youtube.com' }]), true);
  assert.equal(isNavigational('facebook login', [{ host: 'facebook.com' }]), true);
  assert.equal(isNavigational('rust', [{ host: 'rust-lang.org' }]), false);
  assert.equal(isNavigational('how do black holes form', [{ host: 'nasa.gov' }]), false);
});
