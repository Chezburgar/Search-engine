import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuckDuckGo, decodeCursor, parseRssItems } from '../server/providers/web.js';
import { parseGoogleNews, parseBingNews } from '../server/providers/news.js';
import { matchesEntity } from '../server/providers/knowledge.js';
import { parseWeatherQuery } from '../server/providers/weather.js';
import { rankModels } from '../server/ai/grok.js';
import { parseQuestions } from '../server/ai/prompts.js';
import { decodeEntities, extractReadable, relevantPassages } from '../server/lib/html.js';
import { isPrivateAddress } from '../server/lib/safe-fetch.js';
import { Cache } from '../server/lib/cache.js';
import { breadcrumb, normalizeResult } from '../server/providers/normalize.js';
import { renderMarkdown } from '../public/js/lib/markdown.js';
import { evaluate, looksLikeMath } from '../public/js/lib/calc.js';

const DDG = `
<div class="result results_links results_links_deep result--ad "><h2 class="result__title">
<a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_domain=shop.example">Ad</a></h2>
<a class="result__snippet" href="#">Buy</a></div>
<div class="result results_links results_links_deep web-result "><div class="links_main links_deep result__body">
<h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.rust-lang.org%2Flearn&amp;rut=x">Learn <b>Rust</b> &amp; more</a></h2>
<div class="result__extras"><div class="result__extras__url"><a class="result__url" href="x">www.rust-lang.org</a><span>&nbsp; 2025-03-04T00:00:00.0000000</span></div></div>
<a class="result__snippet" href="x">A language empowering <b>everyone</b>.</a></div></div>
<div class="result results_links results_links_deep web-result "><h2 class="result__title"><a rel="nofollow" class="result__a" href="https://doc.rust-lang.org/book/">The Book</a></h2>
<a class="result__snippet" href="x">The Rust Programming Language</a></div>
<form action="/html/" method="post"><input type="submit" class="btn btn--alt" value="Next" />
<input type="hidden" name="q" value="rust" /><input type="hidden" name="s" value="10" /><input type="hidden" name="vqd" value="4-1" /></form>`;

test('DuckDuckGo parser skips ads, unwraps redirect links and reads pagination', () => {
  const { results, next, blocked } = parseDuckDuckGo(DDG);
  assert.equal(blocked, false);
  assert.equal(results.length, 2);
  assert.equal(results[0].url, 'https://www.rust-lang.org/learn');
  assert.equal(results[0].title, 'Learn Rust & more');
  assert.equal(results[0].snippet, 'A language empowering everyone.');
  assert.equal(results[0].date, '2025-03-04');
  assert.equal(results[0].host, 'rust-lang.org');
  assert.equal(results[1].url, 'https://doc.rust-lang.org/book/');
  assert.deepEqual(next, { q: 'rust', s: '10', vqd: '4-1' });
});

test('DuckDuckGo parser flags bot challenges', () => {
  assert.equal(parseDuckDuckGo('<div class="anomaly-modal">Please verify</div>').blocked, true);
});

test('RSS parsing for Google and Bing news', () => {
  const google =
    parseGoogleNews(`<rss><channel><item><title>Big story - Reuters</title><link>https://news.google.com/rss/articles/abc</link>
    <pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate><description>&lt;a&gt;Big story&lt;/a&gt;</description><source url="https://www.reuters.com">Reuters</source></item></channel></rss>`);
  assert.equal(google[0].title, 'Big story');
  assert.equal(google[0].source, 'Reuters');
  assert.equal(google[0].host, 'reuters.com');
  assert.equal(google[0].date, '2026-09-01T10:00:00.000Z');

  const bing =
    parseBingNews(`<rss><channel><item><title>Other story</title><link>http://www.bing.com/news/apiclick.aspx?url=https%3a%2f%2fexample.com%2fa&amp;c=1</link>
    <description>Details here</description><pubDate>Tue, 01 Sep 2026 10:00:00 GMT</pubDate><News:Source>Example</News:Source><News:Image>https://www.bing.com/th?id=OVF.1</News:Image></item></channel></rss>`);
  assert.equal(bing[0].url, 'https://example.com/a');
  assert.equal(bing[0].source, 'Example');
  assert.match(bing[0].image, /^https:\/\/www\.bing\.com\/th\?id=OVF\.1&w=240/);
  assert.equal(parseRssItems('<rss></rss>').length, 0);
});

test('knowledge panel only matches queries about the entity', () => {
  assert.equal(matchesEntity('black holes', 'Black hole'), true);
  assert.equal(matchesEntity('how do black holes form', 'Black hole'), true);
  assert.equal(matchesEntity('python', 'Python (programming language)'), true);
  assert.equal(matchesEntity('how to cook rice', 'Rice'), false);
  assert.equal(matchesEntity('best laptops 2026', 'Laptop'), false);
});

test('weather intent detection', () => {
  assert.equal(parseWeatherQuery('weather in Paris'), 'paris');
  assert.equal(parseWeatherQuery('tokyo weather'), 'tokyo');
  assert.equal(parseWeatherQuery("what's the weather in new york today?"), 'new york');
  assert.equal(parseWeatherQuery('forecast for London tomorrow'), 'london');
  assert.equal(parseWeatherQuery('best weather app'), null);
  assert.equal(parseWeatherQuery('how does weather work'), null);
});

test('model ranking prefers the newest fast chat model', () => {
  const ids = [
    'grok-4-0709',
    'grok-3-mini',
    'grok-4-1-fast-reasoning',
    'grok-4-1-fast-non-reasoning',
    'grok-code-fast-1',
    'grok-2-image-1212',
  ];
  const ranked = rankModels(ids);
  assert.equal(ranked[0], 'grok-4-1-fast-non-reasoning');
  assert.ok(!ranked.includes('grok-code-fast-1'));
  assert.ok(!ranked.includes('grok-2-image-1212'));
  assert.equal(rankModels([...ids, 'grok-5-fast-non-reasoning'])[0], 'grok-5-fast-non-reasoning');
});

test('related-question parsing tolerates numbering and bullets', () => {
  assert.deepEqual(
    parseQuestions('1. What is it?\n- How does it work?\n"Why now?"\nnot a question\n• Who made it?\n5) Where next?'),
    ['What is it?', 'How does it work?', 'Who made it?', 'Where next?']
  );
});

test('HTML helpers', () => {
  assert.equal(decodeEntities('&amp;&lt;&#39;&#x1F600;&hellip;&bogus;'), "&<'😀…&bogus;");
  const page = extractReadable(
    '<html><head><title>T &amp; t</title><meta name="description" content="Desc"></head><body><nav>menu menu menu</nav><script>evil()</script><article><p>' +
      'Black holes form when massive stars collapse at the end of their lives. '.repeat(8) +
      '</p></article></body></html>'
  );
  assert.equal(page.title, 'T & t');
  assert.equal(page.description, 'Desc');
  assert.ok(page.text.includes('Black holes form'));
  assert.ok(!page.text.includes('evil'));
  assert.ok(!page.text.includes('menu'));
  const passages = relevantPassages(
    `${'Filler sentence about nothing. '.repeat(80)}\nGravity wells are interesting.\n`,
    'gravity',
    300
  );
  assert.ok(passages.includes('Gravity wells'));
  assert.ok(passages.length <= 300);
});

test('SSRF guard recognises private and internal addresses', () => {
  for (const ip of [
    '127.0.0.1',
    '10.1.2.3',
    '172.20.0.1',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:127.0.0.1',
  ]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('cache shares in-flight promises and evicts failures', async () => {
  const cache = new Cache({ max: 2, ttl: 1000 });
  let calls = 0;
  const fn = async () => ++calls;
  const [a, b] = await Promise.all([cache.wrap('k', fn), cache.wrap('k', fn)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  await assert.rejects(cache.wrap('bad', async () => Promise.reject(new Error('x'))));
  assert.equal(await cache.wrap('bad', async () => 'ok'), 'ok');
  cache.set('c', 1);
  cache.set('d', 1);
  assert.equal(cache.get('k'), undefined, 'LRU evicts the oldest entry');
});

test('result normalisation', () => {
  assert.equal(normalizeResult({ url: 'javascript:alert(1)', title: 'x' }), null);
  const r = normalizeResult({ url: 'https://www.example.com/a/b%20c/', title: '<b>Hi</b>', snippet: 'x &amp; y' });
  assert.equal(r.title, 'Hi');
  assert.equal(r.snippet, 'x & y');
  assert.equal(breadcrumb('https://www.example.com/a/b%20c/'), 'https://www.example.com › a › b c');
  assert.equal(decodeCursor('not base64 json'), null);
});

test('markdown renderer escapes HTML and renders citations', () => {
  const html = renderMarkdown(
    '**Bold** fact [1][2, 3].\n\n- item [4]\n\n<img src=x onerror=alert(1)> [x](javascript:alert(1)) [ok](https://a.com/?q="x")'
  );
  assert.ok(html.includes('<strong>Bold</strong>'));
  assert.equal((html.match(/class="cite"/g) || []).length, 4);
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('href="javascript'));
  assert.ok(html.includes('href="https://a.com/?q=&quot;x&quot;"'));
  assert.match(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), /<table>.*<td>1<\/td>/);
  assert.match(renderMarkdown('```\n<b>\n```'), /<pre><code>&lt;b&gt;<\/code><\/pre>/);
});

test('calculator evaluates safely', () => {
  assert.equal(evaluate('12*(3+4)^2'), 588);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('sqrt(16)+2pi') > 10, true);
  assert.equal(evaluate('20%'), 0.2);
  assert.equal(evaluate('alert(1)'), null);
  assert.equal(evaluate('1/0'), null);
  assert.equal(looksLikeMath('2024-01-05'), false);
  assert.equal(looksLikeMath('covid-19'), false);
  assert.equal(looksLikeMath('3 * 7'), true);
});
