import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { config, ROOT } from './config.js';
import { Cache } from './lib/cache.js';
import { RateLimiter } from './lib/ratelimit.js';
import { searchWeb } from './providers/web.js';
import { searchNews } from './providers/news.js';
import { searchImages } from './providers/images.js';
import { searchVideos, videosEnabled } from './providers/google.js';
import { ASMX, METHODS, soapEnvelope } from '../public/js/grades/studentvue.js';
import { request } from './lib/http.js';
import { suggest } from './providers/suggest.js';
import { getKnowledge } from './providers/knowledge.js';
import { getWeather, parseWeatherQuery } from './providers/weather.js';
import { aiEnabled, aiProvider, aiStatus, complete, streamChat, agentStep } from './ai/llm.js';
import { modeOf, toolsFor, agentSystemPrompt, sanitizeAgentMessages, sanitizeTabList } from '../public/js/shared/agent.js';
import { sanitizeHistory, validChat, shouldSearch, toModelMessages } from '../public/js/shared/chat.js';
import { buildSources, publicSources, readPage, readForTab } from './ai/context.js';
import { forDisplay } from './providers/normalize.js';
import { assertPublic } from './lib/safe-fetch.js';
import { chatSearchQuery } from '../public/js/shared/sources.js';
import { chatSystemPrompt, chatUserMessage, parseQuestions, relatedMessages, summarizeMessages } from './ai/prompts.js';

const PUBLIC = path.join(ROOT, 'public');
const MAX_QUERY = 400;

const cache = {
  web: new Cache({ max: 400, ttl: 10 * 60 * 1000 }),
  news: new Cache({ max: 200, ttl: 5 * 60 * 1000 }),
  images: new Cache({ max: 200, ttl: 30 * 60 * 1000 }),
  suggest: new Cache({ max: 2000, ttl: 30 * 60 * 1000 }),
  knowledge: new Cache({ max: 500, ttl: 60 * 60 * 1000 }),
  weather: new Cache({ max: 200, ttl: 10 * 60 * 1000 }),
  ai: new Cache({ max: 500, ttl: 20 * 60 * 1000 }),
};
const aiLimiter = new RateLimiter(config.aiRateLimit);
const gradesLimiter = new RateLimiter({ max: 120, windowMs: 10 * 60 * 1000 });
const readLimiter = new RateLimiter({ max: 240, windowMs: 10 * 60 * 1000 });

/* -------------------------------- helpers -------------------------------- */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(self)',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https: http:",
    "connect-src 'self'",
    // Spark tabs can show pages live, in a frame.
    'frame-src https: http:',
    // The Chrome extension's side panel shows Spark's assistant in a frame.
    "frame-ancestors 'self' chrome-extension:",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; '),
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function json(res, status, data, headers = {}) {
  send(res, status, JSON.stringify(data), {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
}

function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

const cleanQuery = (q) =>
  String(q || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_QUERY);
const safeLevel = (s) => (['strict', 'moderate', 'off'].includes(s) ? s : 'moderate');

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('Request body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('Invalid JSON body'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function openStream(res) {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': spark\n\n');
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  return {
    signal: controller.signal,
    send(event, data) {
      if (!res.writableEnded && !res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      if (!res.writableEnded) res.end();
    },
  };
}

function takeAiQuota(req, stream) {
  const verdict = aiLimiter.take(clientIp(req));
  if (!verdict.ok) {
    stream.send('error', {
      code: 'rate_limited',
      message: `You've reached the Spark AI limit for now. Try again in ${Math.ceil(verdict.retryAfter / 60)} min.`,
    });
    stream.end();
    return false;
  }
  return true;
}

function aiUnavailable(stream) {
  stream.send('error', {
    code: 'not_configured',
    message:
      'Spark AI is off because no AI key is configured. Add GROQ_API_KEY or XAI_API_KEY to your .env file and restart.',
  });
  stream.end();
}

async function pipeCompletion(stream, messages, opts) {
  let text = '';
  for await (const t of streamChat({ ...opts, messages, signal: stream.signal })) {
    text += t;
    stream.send('token', { t });
  }
  return text;
}

function streamFailure(stream, err) {
  if (stream.signal.aborted) return stream.end();
  console.error('[spark] AI error:', err.message);
  stream.send('error', { code: 'ai_error', message: err.message || 'Spark AI ran into a problem.' });
  stream.end();
}

/* ----------------------------- cached lookups ----------------------------- */

async function webResults(q, safe, cursor) {
  const key = `${safe}:${cursor || ''}:${q.toLowerCase()}`;
  const out = await cache.web.wrap(key, () => searchWeb(q, { safe, cursor }));
  if (!out.results.length) cache.web.delete(key);
  return out;
}

const knowledgeFor = (q) => cache.knowledge.wrap(q.toLowerCase(), () => getKnowledge(q).catch(() => null));

/* --------------------------------- routes --------------------------------- */

const routes = {
  // Tells the frontend it is talking to this server (the GitHub Pages build ships its own).
  'GET /spark-config.js'(req, res) {
    send(res, 200, 'window.SPARK_CONFIG = { mode: "server" };\n', {
      'Content-Type': 'text/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
  },

  // Lets browsers offer "Add Spark as a search engine".
  'GET /opensearch.xml'(req, res) {
    const proto =
      config.trustProxy && req.headers['x-forwarded-proto'] === 'https'
        ? 'https'
        : req.socket.encrypted
          ? 'https'
          : 'http';
    const host = String(req.headers.host || `localhost:${config.port}`).replace(/[^\w.:[\]-]/g, '');
    const origin = `${proto}://${host}`;
    send(
      res,
      200,
      `<?xml version="1.0" encoding="UTF-8"?>
<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/" xmlns:moz="http://www.mozilla.org/2006/browser/search/">
  <ShortName>Spark</ShortName>
  <Description>Search the web with Spark</Description>
  <InputEncoding>UTF-8</InputEncoding>
  <Image width="32" height="32" type="image/png">${origin}/assets/favicon-32.png</Image>
  <Url type="text/html" method="get" template="${origin}/search?q={searchTerms}"/>
  <Url type="application/x-suggestions+json" template="${origin}/api/suggest?format=opensearch&amp;q={searchTerms}"/>
  <moz:SearchForm>${origin}/</moz:SearchForm>
</OpenSearchDescription>
`,
      {
        'Content-Type': 'application/opensearchdescription+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
      }
    );
  },

  async 'GET /api/status'(req, res) {
    json(res, 200, { ai: await aiStatus(), braveSearch: Boolean(config.braveKey), videos: videosEnabled() });
  },

  async 'GET /api/search'(req, res, url) {
    const q = cleanQuery(url.searchParams.get('q'));
    if (!q) return json(res, 400, { error: 'Missing query' });
    const safe = safeLevel(url.searchParams.get('safe'));
    const cursor = url.searchParams.get('cursor') || '';
    const started = Date.now();
    const place = cursor ? null : parseWeatherQuery(q);
    const [web, weather] = await Promise.all([
      webResults(q, safe, cursor),
      place ? cache.weather.wrap(place, () => getWeather(place)).catch(() => null) : null,
    ]);
    json(res, 200, {
      query: q,
      results: forDisplay(web.results),
      provider: web.provider,
      next: web.next || null,
      weather: weather || null,
      elapsedMs: Date.now() - started,
      notes: web.errors || [],
      googleSuggestions: web.googleSuggestions || null,
    });
  },

  async 'GET /api/knowledge'(req, res, url) {
    const q = cleanQuery(url.searchParams.get('q'));
    if (!q) return json(res, 400, { error: 'Missing query' });
    json(res, 200, { knowledge: await knowledgeFor(q) });
  },

  async 'GET /api/suggest'(req, res, url) {
    const q = cleanQuery(url.searchParams.get('q')).slice(0, 120);
    if (!q) return json(res, 200, url.searchParams.get('format') === 'opensearch' ? ['', []] : { suggestions: [] });
    const suggestions = await cache.suggest.wrap(q.toLowerCase(), () => suggest(q));
    // Browsers that add Spark via OpenSearch expect ["query", [suggestions]].
    if (url.searchParams.get('format') === 'opensearch') {
      return json(res, 200, [q, suggestions], { 'Content-Type': 'application/x-suggestions+json; charset=utf-8' });
    }
    json(res, 200, { suggestions }, { 'Cache-Control': 'private, max-age=300' });
  },

  async 'GET /api/news'(req, res, url) {
    const q = cleanQuery(url.searchParams.get('q'));
    if (!q) return json(res, 400, { error: 'Missing query' });
    const out = await cache.news.wrap(q.toLowerCase(), () => searchNews(q));
    if (!out.results.length) cache.news.delete(q.toLowerCase());
    json(res, 200, { query: q, results: out.results, provider: out.provider });
  },

  async 'GET /api/images'(req, res, url) {
    const q = cleanQuery(url.searchParams.get('q'));
    if (!q) return json(res, 400, { error: 'Missing query' });
    const page = Math.min(Math.max(Number(url.searchParams.get('page')) || 1, 1), 20);
    const provider = url.searchParams.get('provider') || undefined;
    const key = `${provider || ''}:${page}:${q.toLowerCase()}`;
    const out = await cache.images.wrap(key, () => searchImages(q, { page, provider }));
    if (!out.results.length) cache.images.delete(key);
    json(res, 200, { query: q, results: out.results, provider: out.provider, more: out.more, page });
  },

  async 'GET /api/videos'(req, res, url) {
    const q = cleanQuery(url.searchParams.get('q'));
    if (!q) return json(res, 400, { error: 'Missing query' });
    if (!videosEnabled()) return json(res, 200, { query: q, results: [], next: null, enabled: false });
    const token = url.searchParams.get('page') || '';
    const pageToken = /^[\w-]{1,64}$/.test(token) ? token : '';
    const key = `yt:${pageToken}:${q.toLowerCase()}`;
    const out = await cache.images.wrap(key, () => searchVideos(q, pageToken));
    if (!out.results.length) cache.images.delete(key);
    json(res, 200, { query: q, ...out, enabled: true });
  },

  // A page as reader-view Markdown, for Spark tabs and the tab assistant.
  async 'GET /api/read'(req, res, url) {
    let target;
    try {
      target = new URL(url.searchParams.get('url') || '');
    } catch {
      return json(res, 400, { error: 'Invalid URL' });
    }
    if (!readLimiter.take(clientIp(req)).ok) return json(res, 429, { error: 'Too many pages opened. Try again soon.' });
    try {
      await assertPublic(target);
      json(res, 200, await readForTab(target.href), { 'Cache-Control': 'private, max-age=600' });
    } catch (err) {
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
      json(res, status >= 500 ? 502 : status, { error: `Spark couldn't read this page (${err.message}).` });
    }
  },

  async 'GET /api/related'(req, res, url) {
    const q = cleanQuery(url.searchParams.get('q'));
    if (!q) return json(res, 400, { error: 'Missing query' });
    if (!aiEnabled()) return json(res, 200, { questions: [] });
    const key = `rel:${q.toLowerCase()}`;
    const hit = cache.ai.get(key);
    if (hit) return json(res, 200, { questions: hit });
    if (!aiLimiter.take(clientIp(req)).ok) return json(res, 429, { questions: [] });
    try {
      const web = await webResults(q, 'moderate').catch(() => ({ results: [] }));
      const text = await complete({
        messages: relatedMessages(
          q,
          web.results.slice(0, 6).map((r) => r.title)
        ),
        temperature: 0.6,
        maxTokens: 160,
      });
      const questions = parseQuestions(text);
      if (questions.length) cache.ai.set(key, questions);
      json(res, 200, { questions });
    } catch (err) {
      console.error('[spark] related error:', err.message);
      json(res, 200, { questions: [] });
    }
  },

  // Spark Grades: relays one StudentVUE call to MCPS (fixed host, fixed list of read-only
  // methods). Answers like the public StudentVUE relay: { status, response: soapXml }.
  // Credentials pass straight through and are never logged or stored.
  async 'POST /api/studentvue'(req, res) {
    if (!gradesLimiter.take(clientIp(req)).ok) {
      return json(res, 429, { status: false, message: 'Too many requests. Try again in a few minutes.' });
    }
    const body = await readBody(req, 16 * 1024);
    const { username, password, method, paramStr } = body || {};
    const strings = [username, password, method, paramStr].every((v) => typeof v === 'string');
    if (
      !strings ||
      !username ||
      !password ||
      !METHODS.includes(method) ||
      !/^<Parms>[\w<>/ ]*<\/Parms>$/.test(paramStr)
    ) {
      return json(res, 400, { status: false, message: 'Invalid StudentVUE request.' });
    }
    try {
      const upstream = await request(ASMX, {
        method: 'POST',
        timeout: 25000,
        headers: {
          'Content-Type': 'text/xml; charset=utf-8',
          SOAPAction: 'http://edupoint.com/webservices/ProcessWebServiceRequestMultiWeb',
        },
        body: soapEnvelope({ username, password, method, paramStr }),
      });
      const text = await upstream.text();
      if (!upstream.ok && !/ProcessWebServiceRequestMultiWebResult/.test(text)) {
        return json(res, 502, { status: false, message: `MCPS StudentVUE answered ${upstream.status}.` });
      }
      json(res, 200, { status: true, response: text }, { 'Cache-Control': 'no-store' });
    } catch (err) {
      json(res, 502, {
        status: false,
        message:
          err?.name === 'TimeoutError' ? 'MCPS StudentVUE took too long to answer.' : "Couldn't reach MCPS StudentVUE.",
      });
    }
  },

  // One step of the tab assistant (the loop and the tools run in the browser).
  async 'POST /api/agent'(req, res) {
    const body = await readBody(req, 400 * 1024);
    const mode = modeOf(body?.mode);
    const messages = sanitizeAgentMessages(body?.messages, mode);
    if (!messages) return json(res, 400, { error: 'Invalid assistant conversation' });
    if (!aiEnabled()) return json(res, 503, { error: 'Spark AI is not set up on this server.' });
    const verdict = aiLimiter.take(clientIp(req));
    if (!verdict.ok) {
      return json(res, 429, {
        error: `You've reached the Spark AI limit for now. Try again in ${Math.ceil(verdict.retryAfter / 60)} min.`,
      });
    }
    try {
      const message = await agentStep({
        messages: [{ role: 'system', content: agentSystemPrompt(sanitizeTabList(body.tabs), mode) }, ...messages],
        tools: body.final ? undefined : toolsFor(mode),
      });
      json(res, 200, { message });
    } catch (err) {
      console.error('[spark] agent error:', err.message);
      json(res, err.status === 429 ? 429 : 502, { error: err.message || 'Spark AI ran into a problem.' });
    }
  },

  // Conversational search. Each user turn is grounded in a fresh web search.
  async 'POST /api/chat'(req, res) {
    const body = await readBody(req, 12 * 1024 * 1024); // room for a few attached images
    const safe = safeLevel(body.safe);
    const history = sanitizeHistory(body.messages);
    if (!validChat(history)) return json(res, 400, { error: 'Missing question' });
    const last = history[history.length - 1];

    const stream = openStream(res);
    if (!aiEnabled()) return aiUnavailable(stream);
    if (!takeAiQuota(req, stream)) return;

    try {
      let sources = [];
      if (body.search !== false && shouldSearch(last)) {
        stream.send('status', { stage: 'searching' });
        const searchQuery = chatSearchQuery(history);
        const web = await webResults(cleanQuery(searchQuery), safe).catch(() => ({ results: [] }));
        stream.send('status', { stage: 'reading', count: Math.min(web.results.length, 6) });
        sources = await buildSources(searchQuery, web.results, { limit: 6, deep: 2, budgetMs: 2200 });
      }
      stream.send('sources', publicSources(sources));
      stream.send('status', { stage: 'writing' });
      const messages = toModelMessages(chatSystemPrompt(), history, chatUserMessage(last.content, sources));
      await pipeCompletion(stream, messages, { kind: 'chat', temperature: 0.4, maxTokens: 1600 });
      stream.send('done', {});
      stream.end();
    } catch (err) {
      streamFailure(stream, err);
    }
  },

  // Reads a result page and streams a TL;DR.
  async 'GET /api/summarize'(req, res, url) {
    let target;
    try {
      target = new URL(url.searchParams.get('url') || '');
    } catch {
      return json(res, 400, { error: 'Invalid URL' });
    }
    const q = cleanQuery(url.searchParams.get('q')).slice(0, 200);
    const stream = openStream(res);
    if (!aiEnabled()) return aiUnavailable(stream);

    const key = `sum:${target.href}:${q.toLowerCase()}`;
    const hit = cache.ai.get(key);
    if (hit) {
      stream.send('token', { t: hit });
      stream.send('done', { cached: true });
      return stream.end();
    }
    if (!takeAiQuota(req, stream)) return;

    try {
      stream.send('status', { stage: 'reading' });
      let page;
      try {
        await assertPublic(target);
        page = await readPage(target.href, stream.signal);
      } catch (err) {
        stream.send('error', { code: 'unreadable', message: `Spark couldn't open that page (${err.message}).` });
        return stream.end();
      }
      const text = page.text.slice(0, 9000);
      if (text.length < 200) {
        stream.send('error', {
          code: 'unreadable',
          message: "This page doesn't expose readable text (it may need JavaScript or a login).",
        });
        return stream.end();
      }
      stream.send('status', { stage: 'writing' });
      const summary = await pipeCompletion(
        stream,
        summarizeMessages({ query: q, title: page.title, url: target.href, text }),
        { kind: 'search', temperature: 0.2, maxTokens: 450 }
      );
      if (summary.trim()) cache.ai.set(key, summary);
      stream.send('done', {});
      stream.end();
    } catch (err) {
      streamFailure(stream, err);
    }
  },
};

/* ------------------------------ static files ------------------------------ */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};
const gzipCache = new Map();

function serveStatic(req, res, pathname) {
  let rel = ['/', '/search', '/grades', '/games'].includes(pathname) ? '/index.html' : pathname;
  let file;
  try {
    rel = decodeURIComponent(rel);
  } catch {
    return send(res, 400, 'Bad request');
  }
  file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'Forbidden');

  let stat;
  try {
    stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    if (!path.extname(rel)) return serveStatic(req, res, '/');
    return send(res, 404, 'Not found', { 'Content-Type': 'text/plain; charset=utf-8' });
  }

  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size.toString(36)}-${stat.mtimeMs.toString(36)}"`;
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    ETag: etag,
    'Cache-Control': rel.startsWith('/assets/') ? 'public, max-age=604800' : 'no-cache',
  };
  if (req.headers['if-none-match'] === etag) return send(res, 304, undefined, headers);

  let body = fs.readFileSync(file);
  if (
    /text|javascript|json|svg|manifest/.test(headers['Content-Type']) &&
    /\bgzip\b/.test(req.headers['accept-encoding'] || '')
  ) {
    const cached = gzipCache.get(file);
    if (cached?.etag === etag) body = cached.body;
    else {
      body = zlib.gzipSync(body);
      gzipCache.set(file, { etag, body });
    }
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  if (req.method === 'HEAD') return send(res, 200, undefined, headers);
  send(res, 200, body, headers);
}

/* --------------------------------- server --------------------------------- */

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = routes[`${req.method} ${url.pathname}`];
    try {
      if (route) return await route(req, res, url);
      if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      serveStatic(req, res, url.pathname);
    } catch (err) {
      console.error(`[spark] ${req.method} ${url.pathname}:`, err.message);
      if (res.headersSent) return res.end();
      json(res, err.status || 502, { error: err.status ? err.message : 'Upstream search failed. Please try again.' });
    }
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.join(ROOT, 'server', 'index.js');
if (isMain) {
  createServer().listen(config.port, config.host, () => {
    console.log(`\n  ⚡ Spark is running at http://localhost:${config.port}`);
    console.log(
      aiEnabled()
        ? `     Spark AI: on (${aiProvider.label} via ${aiProvider.company})`
        : '     Spark AI: off — add GROQ_API_KEY or XAI_API_KEY to .env to enable overviews and chat'
    );
    console.log(`     Web results: ${config.braveKey ? 'Brave Search API' : 'DuckDuckGo → Bing → Wikipedia'}\n`);
  });
}
