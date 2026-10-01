// Google search, YouTube videos and Spark Grades (MCPS StudentVUE), with every API mocked.
process.env.MOCK_DELAY = '0';
const { mockFetch, calls, SVUE_XML } = await import('./fixtures/mock-fetch.js');
const { default: test } = await import('node:test');
const { default: assert } = await import('node:assert/strict');
const { createBackend } = await import('../public/js/static/backend.js');
const { parseGrounded, rankGeminiModels, createGoogle, resolveLink } = await import('../public/js/shared/google.js');
const { isoDuration } = await import('../public/js/shared/youtube.js');
const { linksFrom } = await import('../public/js/shared/llm.js');
const { parseXml, find, attr } = await import('../public/js/grades/xml.js');
const svueMod = await import('../public/js/grades/studentvue.js');
const calc = await import('../public/js/grades/calc.js');
const { demoGradebook, demoAttendance, demoSchedule } = await import('../public/js/grades/demo.js');

// A browser where Keenable refuses cross-origin calls.
globalThis.fetch = (input, init) =>
  String(input).includes('api.keenable.ai') ? Promise.reject(new TypeError('Failed to fetch')) : mockFetch(input, init);

/* --------------------------------- Google --------------------------------- */

test('Gemini grounding becomes results with real sites, even behind redirect links', () => {
  const out = parseGrounded({
    candidates: [
      {
        content: {
          parts: [
            {
              text: 'Rust ::: https://www.rust-lang.org/ ::: The Rust language.\n**The Book** ::: The official book.\nnoise line',
            },
          ],
        },
        groundingMetadata: {
          groundingChunks: [
            {
              web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/a', title: 'rust-lang.org' },
            },
            {
              web: {
                uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/b',
                title: 'doc.rust-lang.org',
              },
            },
            { web: { uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/c', title: 'github.com' } },
          ],
          groundingSupports: [
            {
              segment: { text: 'Rust ::: https://www.rust-lang.org/ ::: The Rust language.' },
              groundingChunkIndices: [0],
            },
            { segment: { text: '**The Book** ::: The official book.' }, groundingChunkIndices: [1] },
          ],
          searchEntryPoint: { renderedContent: '<div>chips</div>' },
        },
      },
    ],
  });
  assert.deepEqual(
    out.results.map((r) => [r.title, r.host]),
    [
      ['Rust', 'rust-lang.org'],
      ['The Book', 'doc.rust-lang.org'],
      ['github.com', 'github.com'],
    ]
  );
  assert.equal(out.results[0].url, 'https://www.rust-lang.org/');
  assert.match(out.results[1].url, /vertexaisearch/);
  assert.equal(out.results[1].breadcrumb, 'https://doc.rust-lang.org');
  assert.equal(out.suggestionsHtml, '<div>chips</div>');
});

test('Gemini models are ranked Flash-Lite first, skipping image and embedding models', () => {
  const ranked = rankGeminiModels([
    { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-3.5-flash-image', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
    { name: 'models/gemini-3.1-pro', supportedGenerationMethods: ['generateContent'] },
  ]);
  assert.deepEqual(ranked, ['gemini-3.5-flash-lite', 'gemini-3.8-flash', 'gemini-3.1-pro']);
});

test('static search falls back to Google AI search with suggestion chips', async () => {
  const backend = createBackend({ mode: 'static', keenableKey: 'keen_test', googleKey: 'AIza_test' });
  const data = await backend.json('/api/search', { q: 'black holes' });
  assert.equal(data.provider, 'Google AI search');
  assert.equal(data.results.length, 4);
  assert.ok(data.results.every((r) => !('extract' in r)));
  assert.match(data.googleSuggestions, /class="chip"/);
  assert.ok(data.notes.some((n) => /^Keenable: blocked by the browser/.test(n)));
  const gen = calls.filter((c) => c.url.includes(':generateContent')).at(-1);
  assert.match(gen.url, /gemini-3\.5-flash-lite/);
  assert.deepEqual(JSON.parse(gen.body).tools, [{ google_search: {} }]);

  const news = await backend.json('/api/news', { q: 'black holes' });
  assert.equal(news.provider, 'Google AI search');
  assert.ok(news.results[0].source);
});

test('a Google key that is not allowed to use Gemini is explained, then skipped', async () => {
  const backend = createBackend({ mode: 'static', keenableKey: 'keen_test', googleKey: 'AIza_blocked' });
  const first = await backend.json('/api/search', { q: 'rust language' });
  assert.equal(first.provider, 'Wikipedia');
  const note = first.notes.find((n) => n.startsWith('Google AI search'));
  assert.match(note, /API restrictions don't allow the Gemini API/);
  // The same key also drives the DuckDuckGo reader, so that isn't tried either.
  assert.ok(first.notes.includes('DuckDuckGo (read by Gemini): skipped (same Gemini key)'), first.notes.join('\n'));
  const before = calls.filter((c) => c.url.includes('generativelanguage')).length;
  const second = await backend.json('/api/search', { q: 'python language' });
  assert.ok(second.notes.some((n) => /Google AI search: .*skipped until reload/.test(n)));
  assert.equal(calls.filter((c) => c.url.includes('generativelanguage')).length, before);
});

test('without search grounding (free tier), Gemini reads DuckDuckGo results instead', async () => {
  const start = calls.length;
  const backend = createBackend({
    mode: 'static',
    keenableKey: 'keen_test',
    googleKey: 'AIza_youtube',
    geminiKey: 'AQ_noground',
  });
  const data = await backend.json('/api/search', { q: 'black holes' });
  assert.equal(data.provider, 'DuckDuckGo (read by Gemini)');
  assert.match(
    data.notes.find((n) => n.startsWith('Google AI search')),
    /not included in the Gemini free tier/
  );
  // Redirects resolved, bare domains given a scheme, the ad dropped.
  assert.equal(data.results.length, 6);
  assert.deepEqual(
    data.results.slice(0, 2).map((r) => [r.url, r.host]),
    [
      ['https://science.nasa.gov/universe/black-holes/', 'science.nasa.gov'],
      ['https://en.wikipedia.org/wiki/Black_hole', 'en.wikipedia.org'],
    ]
  );
  assert.ok(data.results.every((r) => !/duckduckgo/.test(r.url) && r.snippet));
  const gemini = calls.slice(start).filter((c) => c.url.includes('generativelanguage'));
  assert.ok(
    gemini.every((c) => c.headers['x-goog-api-key'] === 'AQ_noground'),
    'Gemini uses its own key'
  );
  const reader = gemini.filter((c) => c.body && /lite\.duckduckgo\.com/.test(c.body)).at(-1);
  assert.match(
    JSON.parse(reader.body).contents[0].parts[0].text,
    /lite\.duckduckgo\.com\/lite\/\?q=black\+holes&kl=us-en/
  );

  // Grounding is not retried; the reader still is.
  const before = calls.filter((c) => /google_search/.test(c.body || '')).length;
  const again = await backend.json('/api/search', { q: 'rust language' });
  assert.equal(again.provider, 'DuckDuckGo (read by Gemini)');
  assert.equal(calls.filter((c) => /google_search/.test(c.body || '')).length, before);

  const news = await backend.json('/api/news', { q: 'nasa' });
  assert.equal(news.provider, 'DuckDuckGo (read by Gemini)');
  assert.match(calls.filter((c) => /lite\.duckduckgo/.test(c.body || '')).at(-1).body, /nasa\+news&kl=us-en&df=w/);

  // YouTube keeps using the Google key.
  await backend.json('/api/videos', { q: 'cats' });
  assert.match(calls.filter((c) => c.url.includes('/youtube/v3/search')).at(-1).url, /key=AIza_youtube/);
});

test('Gemini answers are dropped when it could not load the page', async () => {
  const google = createGoogle({ geminiKey: 'AQ_noground' });
  await assert.rejects(google.readSearch('readerfail'), /couldn’t open the results page/);
  await assert.rejects(google.summarizeUrl('https://unreachable.example/', 'x'), /couldn’t open the page/);
  assert.match(await google.summarizeUrl('https://www.rust-lang.org/', 'rust'), /TL;DR/);

  assert.equal(
    resolveLink('//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1&rut=x'),
    'https://example.com/a?b=1'
  );
  assert.equal(resolveLink('www.example.com/page'), 'https://www.example.com/page');
  assert.equal(resolveLink('https://duckduckgo.com/y.js?ad_domain=x'), '');
  assert.equal(resolveLink('javascript:alert(1)'), '');
  assert.equal(resolveLink('A sentence, not a link.'), '');
});

test('Custom Search is used first when a search engine ID is configured', async () => {
  const google = createGoogle({ apiKey: 'AIza_test', cx: 'abc123' });
  const out = await google.cse('black holes', 2);
  assert.ok(out.results.length >= 5);
  assert.equal(out.more, true);
  const call = calls.filter((c) => c.url.includes('/customsearch/v1')).at(-1);
  assert.match(call.url, /start=11/);
  const backend = createBackend({ mode: 'static', keenableKey: 'k', googleKey: 'AIza_test', googleCx: 'abc123' });
  const data = await backend.json('/api/search', { q: 'black holes' });
  assert.equal(data.provider, 'Google');
  assert.ok(data.next);
});

test('YouTube videos with durations and view counts', async () => {
  assert.equal(isoDuration('PT1H2M3S'), '1:02:03');
  assert.equal(isoDuration('PT4M5S'), '4:05');
  assert.equal(isoDuration('P0D'), '');
  const backend = createBackend({ mode: 'static', googleKey: 'AIza_test' });
  assert.equal((await backend.json('/api/status')).videos, true);
  const data = await backend.json('/api/videos', { q: 'cats' });
  assert.equal(data.enabled, true);
  assert.equal(data.results.length, 6);
  assert.equal(data.results[0].title, 'cats explained & visualized #1');
  assert.equal(data.results[0].duration, '1:02:03');
  assert.equal(data.results[1].views, 3000);
  assert.equal(data.next, 'PAGE2');
  const off = createBackend({ mode: 'static' });
  assert.equal((await off.json('/api/videos', { q: 'cats' })).enabled, false);
});

test('Groq web search falls back to links in the answer text', () => {
  const found = linksFrom(
    '1. **[Rust](https://www.rust-lang.org/)** – the language.\n- See https://doc.rust-lang.org/book/.'
  );
  assert.deepEqual(
    found.map((f) => f.url),
    ['https://www.rust-lang.org/', 'https://doc.rust-lang.org/book/']
  );
  assert.equal(found[0].title, 'Rust');
});

/* ------------------------------ Spark Grades ------------------------------ */

test('the XML parser handles SOAP, entities, CDATA and self-closing tags', () => {
  const doc = parseXml(
    '<?xml version="1.0"?><a:Root xmlns:a="x"><Item Name="A &amp; B" Note=\'x > y\'/><!-- c --><T><![CDATA[<raw>]]></T></a:Root>'
  );
  const item = find(doc, 'Item');
  assert.equal(attr(item, 'Name'), 'A & B');
  assert.equal(attr(item, 'Note'), 'x > y');
  assert.equal(find(doc, 'T').text, '<raw>');
  assert.equal(doc.children[0].name, 'Root');
});

test('StudentVUE (MCPS) through the relay: sign-in, gradebook, attendance, schedule', async () => {
  const svue = svueMod.createStudentVue({ transport: svueMod.relayTransport() });
  const creds = { username: '123456', password: 'correct-horse' };

  const info = await svue.studentInfo(creds);
  assert.equal(info.name, 'Alex Kim');
  assert.equal(info.school, 'Mock High School');
  const relayCall = calls.filter((c) => c.url.includes('studentvuelib')).at(-1);
  const sent = JSON.parse(relayCall.body);
  assert.equal(sent.url, 'https://md-mcps-psv.edupoint.com/Service/PXPCommunication.asmx');
  assert.match(sent.xml, /<methodName>StudentInfo<\/methodName>/);

  const gb = await svue.gradebook(creds);
  assert.equal(gb.reportPeriod.name, 'MP1');
  assert.equal(gb.reportPeriod.index, 1);
  assert.equal(gb.reportPeriods.length, 2);
  const [alg, bio] = gb.courses;
  assert.equal(alg.title, 'ALGEBRA 2 HN A');
  assert.equal(alg.scoreRaw, 86.5);
  assert.deepEqual(
    alg.categories.map((c) => [c.type, c.weight]),
    [
      ['All Tasks / Assessments', 0.9],
      ['Practice/Preparation', 0.1],
    ]
  );
  assert.equal(alg.assignments[1].name, 'Homework 1 & 2');
  assert.equal(alg.assignments[2].graded, false);
  assert.equal(alg.assignments[2].pointsPossible, 100);
  assert.equal(alg.assignments[2].pointsEarned, null);
  assert.equal(bio.categories.length, 0);

  const interim = await svue.gradebook(creds, { reportPeriod: 0 });
  assert.equal(interim.reportPeriod.name, 'MP1 Interim');
  assert.match(
    JSON.parse(calls.filter((c) => c.url.includes('studentvuelib')).at(-1).body).xml,
    /&lt;ReportPeriod&gt;0/
  );

  const at = await svue.attendance(creds);
  assert.equal(at.events.length, 2);
  assert.equal(at.events[0].periods.length, 1);
  assert.deepEqual(at.totals, { excused: 1, unexcused: 0, tardy: 1, activity: 0 });

  const sched = await svue.schedule(creds);
  assert.deepEqual(
    sched.map((c) => [c.period, c.name, c.room]),
    [
      ['1', 'ALGEBRA 2 HN A', '210'],
      ['2', 'AP BIOLOGY A', '305'],
    ]
  );

  await assert.rejects(svue.gradebook({ username: '123456', password: 'wrong' }), (err) => {
    assert.equal(err.kind, 'auth');
    assert.equal(err.message, 'Incorrect student ID or password.');
    return true;
  });
  assert.ok(SVUE_XML.StudentCalendar);
});

test('StudentVUE through Spark’s server endpoint uses the same parsing', async () => {
  const saved = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === 'api/studentvue') {
      const body = JSON.parse(init.body);
      const res = await mockFetch('https://md-mcps-psv.edupoint.com/Service/PXPCommunication.asmx', {
        method: 'POST',
        body: svueMod.soapEnvelope(body),
      });
      return new Response(JSON.stringify({ status: true, response: await res.text() }), { status: 200 });
    }
    return saved(input, init);
  };
  try {
    const svue = svueMod.createStudentVue({ transport: svueMod.serverTransport('api/studentvue') });
    const gb = await svue.gradebook({ username: '1', password: 'correct-horse' });
    assert.equal(gb.courses.length, 2);
  } finally {
    globalThis.fetch = saved;
  }
});

test('MCPS letters, GPA and semester grades', () => {
  assert.equal(calc.letterFromPercent(89.5), 'A');
  assert.equal(calc.letterFromPercent(89.49), 'B');
  assert.equal(calc.letterFromPercent(59.4), 'E');
  assert.equal(calc.letterFromPercent(null), null);
  assert.equal(calc.letterOf('B+'), 'B');
  assert.equal(calc.letterOf('F'), 'E');
  assert.equal(calc.letterOf('', 91), 'A');
  assert.equal(calc.letterOf('72.4%'), 'C');

  const courses = [
    { title: 'AP BIOLOGY A', mark: 'A', scoreRaw: 95 },
    { title: 'ENGLISH 10 HN A', mark: 'C', scoreRaw: 75 },
    { title: 'GEOMETRY HN A', mark: 'D', scoreRaw: 65 },
    { title: 'PE 1', mark: 'B', scoreRaw: 85 },
  ];
  assert.equal(calc.gpa(courses), (4 + 2 + 1 + 3) / 4);
  // Honors/AP add a point only for A, B and C.
  assert.equal(calc.gpa(courses, { weighted: true }), (5 + 3 + 1 + 3) / 4);
  assert.equal(calc.average(courses), 80);

  assert.equal(calc.semesterLetter('A', 'B'), 'A');
  assert.equal(calc.semesterLetter('A', 'C'), 'B');
  assert.equal(calc.semesterLetter('B', 'E'), 'C');
  assert.equal(calc.semesterLetter('C', 'E'), 'D');
  assert.equal(calc.semesterLetter('D', 'E'), 'D');
  assert.equal(calc.semesterLetter('A', null), 'A');

  assert.equal(calc.prettyTitle('ALGEBRA 2 HN A'), 'Algebra 2 HN A');
  assert.equal(calc.prettyTitle('AP COMPUTER SCIENCE A A'), 'AP Computer Science A A');
  assert.equal(calc.prettyTitle('AP CALCULUS AB A'), 'AP Calculus AB A');
  assert.equal(calc.prettyTitle('Already Nice'), 'Already Nice');
  assert.equal(calc.personName('Lee, Dana'), 'Dana Lee');
});

test('what-if grades: weighted categories, edits, made-up assignments, score needed', () => {
  const course = {
    title: 'ALGEBRA 2 HN A',
    categories: [
      { type: 'All Tasks / Assessments', weight: 0.9 },
      { type: 'Practice/Preparation', weight: 0.1 },
    ],
    assignments: [
      { id: 't1', type: 'All Tasks / Assessments', pointsEarned: 80, pointsPossible: 100 },
      { id: 'p1', type: 'Practice/Preparation', pointsEarned: 10, pointsPossible: 10 },
      { id: 'u1', type: 'All Tasks / Assessments', pointsEarned: null, pointsPossible: 50 },
    ],
  };
  const base = calc.computeCourse(course);
  assert.equal(base.weighted, true);
  assert.ok(Math.abs(base.percent - 82) < 1e-9); // 80% * .9 + 100% * .1

  const edited = calc.computeCourse(course, { overrides: { t1: { earned: 90, possible: null } } });
  assert.ok(Math.abs(edited.percent - 91) < 1e-9);

  const withHypo = calc.computeCourse(course, {
    hypos: [{ type: 'All Tasks / Assessments', earned: 50, possible: 50 }],
  });
  // Tasks: 130 / 150 = 86.67%
  assert.ok(Math.abs(withHypo.percent - (0.9 * (130 / 150) * 100 + 10)) < 1e-9);

  const need = calc.scoreNeeded(course, { target: 89.5, type: 'All Tasks / Assessments', possible: 100 });
  assert.equal(need.reachable, true);
  const check = calc.computeCourse(course, {
    hypos: [{ type: 'All Tasks / Assessments', earned: need.earned, possible: 100 }],
  });
  assert.ok(check.percent >= 89.5 && check.percent < 89.6, String(check.percent));
  assert.equal(calc.scoreNeeded(course, { target: 50, type: 'All Tasks / Assessments', possible: 10 }).earned, 0);
  assert.equal(calc.scoreNeeded(course, { target: 99.9, type: 'Practice/Preparation', possible: 1 }).reachable, false);

  // No weights: straight points.
  const points = calc.computeCourse({
    categories: [],
    assignments: [
      { id: 'a', type: 'Labs', pointsEarned: 45, pointsPossible: 50 },
      { id: 'b', type: 'Quizzes', pointsEarned: 5, pointsPossible: 50 },
    ],
  });
  assert.equal(points.weighted, false);
  assert.equal(points.percent, 50);
  assert.equal(points.categories.length, 2);
});

test('demo data is complete and upcoming work is found', () => {
  const gb = demoGradebook();
  assert.equal(gb.reportPeriod.name, 'MP1');
  assert.ok(gb.courses.length >= 6);
  for (const c of gb.courses) {
    const computed = calc.computeCourse(c).percent;
    assert.ok(computed > 50 && computed <= 100, `${c.title}: ${computed}`);
  }
  assert.notDeepEqual(
    demoGradebook(3).courses.map((c) => c.scoreRaw),
    gb.courses.map((c) => c.scoreRaw)
  );
  const soon = calc.upcoming(gb.courses);
  assert.ok(soon.length >= 3);
  assert.ok(soon.every((a, i) => i === 0 || soon[i - 1].diff <= a.diff));
  assert.equal(calc.recentGrades(gb.courses).length, 6);
  assert.equal(demoSchedule().length, gb.courses.length);
  assert.equal(demoAttendance().events.length, 3);
});
