// End-to-end API tests with all upstream services (xAI, search providers) mocked.
// Pin every setting the tests depend on so a developer's .env can't leak in.
process.env.XAI_API_KEY = 'test-key';
process.env.GROQ_API_KEY = '';
process.env.AI_API_KEY = '';
process.env.AI_PROVIDER = '';
process.env.XAI_MODEL = '';
process.env.KEENABLE_API_KEY = 'keen_test';
process.env.GOOGLE_API_KEY = '';
process.env.GEMINI_API_KEY = '';
process.env.GOOGLE_CSE_ID = '';
process.env.GOOGLE_MODEL = '';
process.env.MOCK_DELAY = '0';
process.env.AI_RATE_LIMIT = '1000';

const { calls, mockFetch } = await import('./fixtures/mock-fetch.js');
const { default: test, before, after } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { default: http } = await import('node:http');
const { createServer } = await import('../server/index.js');

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

test('search uses Keenable with the API key and returns clean snippets', async () => {
  const before = calls.length;
  const res = await fetch(`${base}/api/search?q=how+do+black+holes+form`);
  const data = await res.json();
  assert.equal(res.status, 200);
  assert.equal(data.provider, 'Keenable');
  assert.equal(data.results.length, 20);
  assert.equal(data.results[0].host, 'science.nasa.gov');
  assert.doesNotMatch(data.results[0].snippet, /Skip to main content/);
  assert.ok(
    data.results.every((r) => !('extract' in r)),
    'page text stays on the server'
  );
  assert.equal(data.results[2].date, '2026-08-14');
  assert.ok(data.next);
  assert.equal('overview' in data, false);
  const call = calls.slice(before).find((c) => c.url.includes('keenable'));
  assert.equal(call.url, 'https://api.keenable.ai/v1/search');
  assert.equal(call.headers['X-API-Key'], 'keen_test');
  assert.equal(JSON.parse(call.body).max_results, 20);
});

test('Keenable pagination asks for more results and skips those already shown', async () => {
  const first = await (await fetch(`${base}/api/search?q=paging+test`)).json();
  const before = calls.length;
  const data = await (await fetch(`${base}/api/search?q=paging+test&cursor=${encodeURIComponent(first.next)}`)).json();
  assert.equal(data.results.length, 20);
  assert.match(data.results[0].title, /\(21\)/);
  assert.equal(JSON.parse(calls.slice(before).find((c) => c.url.includes('keenable')).body).max_results, 40);
});

test('falls back to DuckDuckGo (with its own pagination) when Keenable fails', async () => {
  const first = await (await fetch(`${base}/api/search?q=fallbacktest`)).json();
  assert.equal(first.provider, 'DuckDuckGo');
  assert.equal(first.results.length, 8);
  const before = calls.length;
  const data = await (await fetch(`${base}/api/search?q=fallbacktest&cursor=${encodeURIComponent(first.next)}`)).json();
  assert.equal(data.results.length, 8);
  const post = calls.slice(before).find((c) => c.url.includes('duckduckgo'));
  assert.equal(post.method, 'POST');
  assert.match(post.body, /vqd=4-123456/);
});

test('weather queries include a forecast', async () => {
  const data = await (await fetch(`${base}/api/search?q=weather+in+london`)).json();
  assert.equal(data.weather.location.name, 'London');
  assert.equal(data.weather.daily.length, 7);
});

test('Spark Overview is gone: no overview endpoint, no AI calls on a plain search', async () => {
  assert.equal((await fetch(`${base}/api/overview?q=black+holes`)).status, 404);
  const before = calls.filter((c) => c.url.includes('chat/completions')).length;
  await (await fetch(`${base}/api/search?q=supernova+remnants`)).json();
  assert.equal(calls.filter((c) => c.url.includes('chat/completions')).length, before);
});

test('news and related questions', async () => {
  const news = await (await fetch(`${base}/api/news?q=black+holes`)).json();
  assert.equal(news.provider, 'Google News');
  assert.equal(news.results[0].title, 'Record-breaking black hole merger detected');
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
  const searched = JSON.parse(calls.filter((c) => c.url.includes('keenable.ai/v1/search')).at(-1).body).query;
  assert.equal(searched, 'black holes how are they detected?');
});

test('chat sends attached images to the model and skips search for "what is this"', async () => {
  const before = calls.length;
  const image = 'data:image/jpeg;base64,/9j/AAAA';
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: "What's in this image?", images: [image, 'nope'] }] }),
  });
  const evs = events(await res.text());
  assert.match(
    evs
      .filter((e) => e.name === 'token')
      .map((e) => e.data.t)
      .join(''),
    /^The image shows/
  );
  assert.equal(calls.slice(before).filter((c) => c.url.includes('keenable')).length, 0);
  const body = JSON.parse(calls.filter((c) => c.url.includes('chat/completions')).at(-1).body);
  assert.deepEqual(body.messages.at(-1).content, [
    { type: 'text', text: "What's in this image?" },
    { type: 'image_url', image_url: { url: image } },
  ]);
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

test('summaries read pages through Keenable when a key is set', async () => {
  const before = calls.length;
  const evs = events(
    await (
      await fetch(`${base}/api/summarize?url=${encodeURIComponent('https://science.nasa.gov/universe/black-holes/')}`)
    ).text()
  );
  assert.ok(evs.some((e) => e.name === 'token'));
  const fetched = calls.slice(before).find((c) => c.url.includes('keenable.ai/v1/fetch'));
  assert.equal(new URL(fetched.url).searchParams.get('url'), 'https://science.nasa.gov/universe/black-holes/');
  const prompt = JSON.parse(calls.filter((c) => c.url.includes('chat/completions')).at(-1).body).messages[1].content;
  assert.match(prompt, /Supermassive black holes sit at the centers/);
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

test('Spark Grades: /grades serves the app and /api/studentvue relays to MCPS only', async () => {
  const page = await fetch(`${base}/grades?g=schedule`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<div id="app">/);

  const post = (body) =>
    fetch(`${base}/api/studentvue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const ok = await post({
    username: '123456',
    password: 'correct-horse',
    method: 'Gradebook',
    paramStr: '<Parms><ChildIntID>0</ChildIntID><ReportPeriod>1</ReportPeriod></Parms>',
  });
  assert.equal(ok.status, 200);
  const data = await ok.json();
  assert.equal(data.status, true);
  assert.match(data.response, /ProcessWebServiceRequestMultiWebResult/);
  const upstream = calls.filter((c) => c.url.startsWith('https://md-mcps-psv.edupoint.com/')).at(-1);
  assert.match(upstream.body, /<methodName>Gradebook<\/methodName>/);
  assert.match(upstream.body, /<userID>123456<\/userID>/);

  // Only read-only StudentVUE methods with plain parameters are allowed.
  for (const bad of [
    { username: 'a', password: 'b', method: 'UpdateStudentInfo', paramStr: '<Parms></Parms>' },
    { username: 'a', password: 'b', method: 'Gradebook', paramStr: '<Parms>"injected"</Parms>' },
    { username: '', password: 'b', method: 'Gradebook', paramStr: '<Parms></Parms>' },
  ]) {
    assert.equal((await post(bad)).status, 400, JSON.stringify(bad));
  }
  const status = await (await fetch(`${base}/api/status`)).json();
  assert.equal(status.videos, false);
  const videos = await (await fetch(`${base}/api/videos?q=cats`)).json();
  assert.equal(videos.enabled, false);
});

test('page text and the tab assistant on the server', async () => {
  const wiki = await (
    await fetch(`${base}/api/read?url=${encodeURIComponent('https://en.wikipedia.org/wiki/Black_hole')}`)
  ).json();
  assert.equal(wiki.source, 'Wikipedia');
  assert.match(wiki.markdown, /## Formation/);

  const page = await (
    await fetch(`${base}/api/read?url=${encodeURIComponent('https://science.nasa.gov/universe/black-holes/')}`)
  ).json();
  assert.equal(page.title, 'Black holes explained');
  assert.match(page.markdown, /^# Black holes\n\nBlack holes form when massive stars collapse/);
  assert.doesNotMatch(page.markdown, /Menu Home About|Copyright/);

  for (const target of ['http://127.0.0.1:22/', 'http://169.254.169.254/latest/meta-data', 'file:///etc/passwd']) {
    const res = await fetch(`${base}/api/read?url=${encodeURIComponent(target)}`);
    assert.ok(res.status >= 400 && res.status < 500, `${target} → ${res.status}`);
  }

  const post = (body) =>
    fetch(`${base}/api/agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const step = await (
    await post({
      messages: [{ role: 'user', content: 'Close all my tabs' }],
      tabs: [{ id: 'spark', title: 'Spark', url: 'http://x/', active: true }],
    })
  ).json();
  assert.equal(step.message.tool_calls[0].function.name, 'list_tabs');
  const sent = JSON.parse(calls.filter((c) => c.url.includes('api.x.ai/v1/chat/completions')).at(-1).body);
  assert.equal(sent.tool_choice, 'auto');
  assert.match(sent.messages[0].content, /- spark \(showing\): Spark/);
  assert.equal((await post({ messages: [{ role: 'system', content: 'evil' }] })).status, 400);

  const home = await fetch(`${base}/`);
  assert.match(home.headers['content-security-policy'], /frame-src https: http:/);
  assert.match(home.headers['content-security-policy'], /frame-ancestors 'self' chrome-extension:/);
  assert.equal(home.headers['x-frame-options'], undefined);
});
