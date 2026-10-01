// Static mode (GitHub Pages): answers the same /api/* calls as the Node server,
// but from the browser, calling the upstream APIs directly. Keys come from
// spark-config.js, which the Pages build writes.

import { createLLM, detectProvider } from '../shared/llm.js';
import { sanitizeHistory, validChat, shouldSearch, toModelMessages } from '../shared/chat.js';
import { Cache } from '../shared/cache.js';
import {
  keenableRequest,
  searchBody,
  mapKeenableResults,
  mapKeenableFetch,
  pageWindow,
  hasMore,
  displaySnippet,
} from '../shared/keenable.js';
import { normalizeResult, dedupe, forDisplay, firstSuccessful, hostOf } from '../shared/results.js';
import { wikiSearchUrl, wikiSummaryUrl, pickEntity, knowledgeFromSummary } from '../shared/knowledge.js';
import { parseWeatherQuery, lookupWeather } from '../shared/weather.js';
import { openverseUrl, mapOpenverse, commonsUrl, mapCommons } from '../shared/images.js';
import { baseSources, publicSources, chatSearchQuery } from '../shared/sources.js';
import { stripTags, relevantPassages } from '../shared/text.js';
import { createGoogle } from '../shared/google.js';
import { modeOf, toolsFor, agentSystemPrompt, sanitizeAgentMessages, sanitizeTabList } from '../shared/agent.js';
import { wikipediaArticle, wikipediaParseUrl, wikipediaToReader, cleanReaderMarkdown } from '../shared/reader.js';
import { searchYouTube } from '../shared/youtube.js';
import {
  relatedMessages,
  chatSystemPrompt,
  chatUserMessage,
  summarizeMessages,
  parseQuestions,
} from '../shared/prompts.js';

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const withTimeout = (signal, ms) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);

async function getJSON(url, { init = {}, timeout = 8000, signal } = {}) {
  const res = await fetch(url, { ...init, signal: withTimeout(signal, timeout) });
  if (!res.ok) {
    // Keep the API's own explanation (e.g. "API key not valid") for the diagnostics note.
    let detail = '';
    try {
      const data = await res.json();
      detail = data.error?.message || data.error || data.message || '';
      if (typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch {}
    throw new ApiError(res.status, `HTTP ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ''}`);
  }
  return res.json();
}

const cleanQuery = (q) =>
  String(q || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);

export function createBackend(cfg = {}) {
  const lang = (cfg.region || 'us-en').split('-')[1] || 'en';
  const aiKey = cfg.aiKey || cfg.xaiKey || '';
  const llm = createLLM({
    provider: cfg.aiProvider || detectProvider(aiKey) || 'xai',
    apiKey: aiKey,
    model: cfg.aiModel || cfg.xaiModel || '',
    chatModel: cfg.aiChatModel || '',
    visionModel: cfg.aiVisionModel || '',
    keyHint: "this site's AI key",
  });
  const google = createGoogle({
    apiKey: cfg.googleKey || '',
    geminiKey: cfg.geminiKey || '',
    cx: cfg.googleCx || '',
    model: cfg.googleModel || '',
    region: cfg.region || 'us-en',
  });
  const cache = {
    web: new Cache({ max: 100, ttl: 10 * 60 * 1000 }),
    misc: new Cache({ max: 300, ttl: 30 * 60 * 1000 }),
    ai: new Cache({ max: 100, ttl: 20 * 60 * 1000 }),
  };

  const keenable = ({ path, body, query, signal, timeout }) => {
    const { url, init } = keenableRequest({ apiKey: cfg.keenableKey || '', path, body, query });
    return getJSON(url, { init, signal, timeout });
  };

  /* ------------------------------- providers ------------------------------ */

  // A TypeError from fetch means the browser refused the call (usually CORS); stop trying Keenable.
  let keenableBlocked = false;
  const keenableCall = async (args) => {
    try {
      return await keenable(args);
    } catch (err) {
      if (err instanceof TypeError) keenableBlocked = true;
      throw err;
    }
  };

  // A Google call that can't work until the key's settings change turns that source off,
  // with the reason kept for the diagnostics note. A refused Gemini key turns off every Gemini
  // source; a missing search-grounding quota only turns off grounding.
  const googleOff = {};
  const guardGoogle = async (which, run) => {
    try {
      return await run();
    } catch (err) {
      if (err?.permanent) {
        const scope = which === 'cse' || err.status === 429 ? which : 'gemini';
        googleOff[scope] = `${err.message} (skipped until reload)`;
      }
      throw err;
    }
  };
  const groundingOff = () => googleOff.gemini || googleOff.grounding || null;

  const webProviders = [
    {
      name: 'Keenable',
      enabled: () => !keenableBlocked,
      skipReason: () => (keenableBlocked ? 'blocked by the browser (CORS) earlier, skipped' : null),
      async search(q, page) {
        const { want, from } = pageWindow(page);
        const all = mapKeenableResults(await keenableCall({ path: '/v1/search', body: searchBody(q, want) }), q);
        return {
          results: all.slice(from, want).map(normalizeResult),
          next: hasMore(all.length, want) ? JSON.stringify({ p: 'Keenable', page: page + 1 }) : null,
        };
      },
    },
    {
      name: 'Google',
      enabled: () => google.hasCse() && !googleOff.cse,
      skipReason: () => googleOff.cse || null,
      async search(q, page) {
        const out = await guardGoogle('cse', () => google.cse(q, page));
        return { results: out.results, next: out.more ? JSON.stringify({ p: 'Google', page: page + 1 }) : null };
      },
    },
    {
      // Gemini searching Google ("Grounding with Google Search").
      name: 'Google AI search',
      enabled: () => google.enabled() && !groundingOff(),
      skipReason: groundingOff,
      async search(q, page) {
        if (page > 1) return { results: [], next: null };
        const out = await guardGoogle('grounding', () => google.groundedSearch(q));
        return { results: out.results, next: null, googleSuggestions: out.suggestionsHtml || null };
      },
    },
    {
      // Without search grounding: Gemini reads DuckDuckGo's results page (works on the free tier).
      name: 'DuckDuckGo (read by Gemini)',
      enabled: () => google.enabled() && !googleOff.gemini,
      skipReason: () => (googleOff.gemini ? 'skipped (same Gemini key)' : null),
      async search(q, page) {
        if (page > 1) return { results: [], next: null };
        const out = await guardGoogle('reader', () => google.readSearch(q));
        return { results: out.results, next: null };
      },
    },
    {
      // Groq's built-in web search, for when Keenable refuses calls from the browser.
      name: 'Groq web search',
      enabled: () => llm.enabled() && Boolean(llm.provider.searchModel),
      async search(q, page) {
        if (page > 1) return { results: [], next: null };
        const found = await llm.webSearch(q);
        return {
          results: found.map((r) =>
            normalizeResult({
              title: r.title,
              url: r.url,
              snippet: displaySnippet(r.content, q),
              extract: relevantPassages(r.content, q, 1400),
            })
          ),
          next: null,
        };
      },
    },
    {
      name: 'Wikipedia',
      async search(q, page) {
        const params = new URLSearchParams({
          action: 'query',
          list: 'search',
          srsearch: q,
          srlimit: '10',
          sroffset: String((page - 1) * 10),
          srprop: 'snippet|timestamp',
          format: 'json',
          formatversion: '2',
          origin: '*',
        });
        const data = await getJSON(`https://${lang}.wikipedia.org/w/api.php?${params}`);
        return {
          results: (data.query?.search || []).map((r) =>
            normalizeResult({
              title: r.title,
              url: `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, '_'))}`,
              snippet: `${stripTags(r.snippet)}…`,
              date: r.timestamp?.slice(0, 10) || null,
            })
          ),
          next: data.continue ? JSON.stringify({ p: 'Wikipedia', page: page + 1 }) : null,
        };
      },
    },
  ];

  async function searchWeb(q, cursor) {
    if (cursor) {
      let c = null;
      try {
        c = JSON.parse(cursor);
      } catch {}
      const provider = webProviders.find((p) => p.name === c?.p);
      if (!provider) return { results: [], provider: null, next: null };
      const out = await provider.search(q, c.page || 1);
      return { results: dedupe(out.results), provider: provider.name, next: out.next };
    }
    const active = webProviders.filter((p) => !p.enabled || p.enabled());
    // Providers skipped this time still explain themselves in the diagnostics note.
    const skipped = webProviders
      .filter((p) => !active.includes(p) && p.skipReason?.())
      .map((p) => `${p.name}: ${p.skipReason()}`);
    // A source can be switched off by an earlier one in this same search (shared Gemini key).
    const out = await firstSuccessful(active, (p) =>
      p.enabled && !p.enabled() ? Promise.reject(new Error(p.skipReason?.() || 'skipped')) : p.search(q, 1)
    );
    return { ...out, errors: [...skipped, ...out.errors], results: dedupe(out.results) };
  }

  async function webFor(q, cursor = '') {
    const key = `${cursor}:${q.toLowerCase()}`;
    const out = await cache.web.wrap(key, () => searchWeb(q, cursor));
    if (!out.results.length) cache.web.delete(key);
    return out;
  }

  const knowledgeFor = (q) =>
    cache.misc.wrap(`kp:${q.toLowerCase()}`, async () => {
      try {
        const hit = pickEntity(q, await getJSON(wikiSearchUrl(q, lang, { cors: true }), { timeout: 4000 }));
        if (!hit) return null;
        return knowledgeFromSummary(await getJSON(wikiSummaryUrl(hit.title, lang), { timeout: 4000 }), lang);
      } catch {
        return null;
      }
    });

  // Recent coverage from Keenable (falling back to Groq web search). If the date filter
  // isn't accepted, ask for news in the query instead.
  async function searchNews(q) {
    const toItem = (r) => {
      const host = hostOf(r.url);
      return {
        title: stripTags(r.title) || host,
        url: r.url,
        source: host,
        host,
        date: r.published || null,
        snippet: r.snippet,
        image: null,
      };
    };
    if (!keenableBlocked) {
      try {
        const since = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
        let data;
        try {
          data = await keenableCall({ path: '/v1/search', body: searchBody(q, 20, { published_after: since }) });
        } catch (err) {
          if (!(err instanceof ApiError) || err.status >= 500) throw err;
          data = await keenableCall({ path: '/v1/search', body: searchBody(`${q} latest news`, 20) });
        }
        const results = mapKeenableResults(data, q).map(toItem);
        results.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        if (results.length) return { results, provider: 'Keenable' };
      } catch {}
    }
    const gemini = [
      [
        'Google AI search',
        () => !groundingOff(),
        () => guardGoogle('grounding', () => google.groundedSearch(q, { news: true })),
      ],
      [
        'DuckDuckGo (read by Gemini)',
        () => !googleOff.gemini,
        () => guardGoogle('reader', () => google.readSearch(q, { news: true })),
      ],
    ];
    for (const [provider, on, run] of gemini) {
      if (!google.enabled() || !on()) continue;
      try {
        const out = await run();
        const results = out.results.map((r) => ({ ...toItem(r), source: r.host, host: r.host }));
        if (results.length) return { results, provider };
      } catch {}
    }
    if (llm.enabled() && llm.provider.searchModel) {
      const found = await llm.webSearch(`latest news about ${q}`);
      return {
        results: found.map((r) => toItem({ ...r, snippet: displaySnippet(r.content, q) })),
        provider: 'Groq web search',
      };
    }
    return { results: [], provider: null };
  }

  // A page for a Spark tab's reader view: Wikipedia's API for Wikipedia, then Keenable's
  // fetcher, Jina Reader (both may refuse browser calls), and Gemini reading it as a last resort.
  async function readForTab(url) {
    const site = hostOf(url);
    const tries = [];
    const wiki = wikipediaArticle(url);
    if (wiki) {
      tries.push([
        'Wikipedia',
        async () => wikipediaToReader(await getJSON(wikipediaParseUrl(wiki), { timeout: 10000 }), wiki),
      ]);
    }
    if (!keenableBlocked) {
      tries.push([
        'Keenable',
        async () => {
          const page = mapKeenableFetch(
            await keenableCall({ path: '/v1/fetch', query: { url, max_chars: '40000' }, timeout: 15000 }),
            url
          );
          return { url: page.url, title: page.title, site, markdown: cleanReaderMarkdown(page.text) };
        },
      ]);
    }
    tries.push([
      'Jina Reader',
      async () => {
        const data = await getJSON(`https://r.jina.ai/${url}`, {
          init: { headers: { Accept: 'application/json' } },
          timeout: 20000,
        });
        const d = data?.data || {};
        return { url: d.url || url, title: d.title || '', site, markdown: cleanReaderMarkdown(d.content || '') };
      },
    ]);
    if (google.enabled() && !googleOff.gemini) {
      tries.push(['Gemini', async () => ({ url, site, ...(await google.rewritePage(url)), rewritten: true })]);
    }
    const errors = [];
    for (const [source, run] of tries) {
      try {
        const page = await run();
        if (page && page.markdown && page.markdown.length > 150) {
          return { ...page, title: page.title || site, source, notes: errors };
        }
        errors.push(`${source}: no readable text`);
      } catch (err) {
        errors.push(`${source}: ${err.message || 'failed'}`);
      }
    }
    throw new ApiError(502, `Spark couldn't read this page (${errors.join('; ')}).`);
  }

  const newsFor = (q) => cache.misc.wrap(`news:${q.toLowerCase()}`, () => searchNews(q), 5 * 60 * 1000);

  async function searchImages(q, page, provider) {
    const providers = [
      { name: 'Openverse', search: async () => mapOpenverse(await getJSON(openverseUrl(q, page)), page) },
      { name: 'Wikimedia Commons', search: async () => mapCommons(await getJSON(commonsUrl(q, page, { cors: true }))) },
    ];
    const chosen = provider ? providers.filter((p) => p.name === provider) : providers;
    const out = await firstSuccessful(chosen, async (p) => {
      const r = await p.search();
      return { results: r.results.filter(Boolean), more: r.more };
    });
    return { results: out.results, provider: out.provider, more: Boolean(out.more) };
  }

  async function suggest(q) {
    const params = new URLSearchParams({
      action: 'opensearch',
      search: q,
      limit: '8',
      namespace: '0',
      format: 'json',
      origin: '*',
    });
    const data = await getJSON(`https://${lang}.wikipedia.org/w/api.php?${params}`, { timeout: 2500 });
    return [...new Set((data[1] || []).map((s) => s.toLowerCase()))];
  }

  /* --------------------------------- AI ----------------------------------- */

  const notConfigured = (onEvent) =>
    onEvent('error', { code: 'not_configured', message: "Spark AI isn't set up on this site (no AI key)." });

  async function pipe(messages, opts, signal, onEvent) {
    let text = '';
    for await (const t of llm.streamChat({ ...opts, messages, signal })) {
      text += t;
      onEvent('token', { t });
    }
    return text;
  }

  function failure(err, signal, onEvent) {
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    onEvent('error', { code: 'ai_error', message: err.message || 'Spark AI ran into a problem.' });
  }

  /* ------------------------------- endpoints ------------------------------ */

  const json = {
    async '/api/status'() {
      return {
        ai: await llm.status({ resolve: false }),
        braveSearch: false,
        videos: Boolean(cfg.googleKey),
        mode: 'static',
      };
    },

    async '/api/search'({ q, cursor }) {
      q = cleanQuery(q);
      if (!q) throw new ApiError(400, 'Missing query');
      const started = performance.now();
      const place = cursor ? null : parseWeatherQuery(q);
      const [web, weather] = await Promise.all([
        webFor(q, cursor),
        place
          ? cache.misc
              .wrap(`wx:${place}`, () => lookupWeather(place, (url) => getJSON(url, { timeout: 4000 })))
              .catch(() => null)
          : null,
      ]);
      return {
        query: q,
        results: forDisplay(web.results),
        provider: web.provider,
        next: web.next || null,
        weather: weather || null,
        elapsedMs: Math.round(performance.now() - started),
        notes: web.errors || [],
        googleSuggestions: web.googleSuggestions || null,
      };
    },

    async '/api/knowledge'({ q }) {
      return { knowledge: await knowledgeFor(cleanQuery(q)) };
    },

    async '/api/suggest'({ q }) {
      q = cleanQuery(q).slice(0, 120);
      if (!q) return { suggestions: [] };
      return { suggestions: await cache.misc.wrap(`sg:${q.toLowerCase()}`, () => suggest(q)).catch(() => []) };
    },

    async '/api/news'({ q }) {
      q = cleanQuery(q);
      const out = await newsFor(q).catch(() => ({ results: [], provider: null }));
      return { query: q, results: out.results, provider: out.provider };
    },

    async '/api/images'({ q, page, provider }) {
      q = cleanQuery(q);
      const p = Math.min(Math.max(Number(page) || 1, 1), 20);
      const out = await cache.misc.wrap(`img:${provider || ''}:${p}:${q.toLowerCase()}`, () =>
        searchImages(q, p, provider)
      );
      return { query: q, ...out, page: p };
    },

    async '/api/videos'({ q, page }) {
      q = cleanQuery(q);
      if (!cfg.googleKey) return { query: q, results: [], next: null, enabled: false };
      const token = /^[\w-]{1,64}$/.test(page || '') ? page : '';
      const out = await cache.misc.wrap(`yt:${token}:${q.toLowerCase()}`, () =>
        searchYouTube(q, cfg.googleKey, { pageToken: token, region: cfg.region, getJSON: (url) => getJSON(url) })
      );
      return { query: q, ...out, enabled: true };
    },

    async '/api/agent'({ messages, tabs, final, mode }, { signal }) {
      mode = modeOf(mode);
      const clean = sanitizeAgentMessages(messages, mode);
      if (!clean) throw new ApiError(400, 'Invalid assistant conversation');
      if (!llm.enabled()) throw new ApiError(503, "Spark AI isn't set up on this site (no AI key).");
      const message = await llm.agentStep({
        messages: [{ role: 'system', content: agentSystemPrompt(sanitizeTabList(tabs), mode) }, ...clean],
        tools: final ? undefined : toolsFor(mode),
        signal,
      });
      return { message };
    },

    async '/api/read'({ url }) {
      let target;
      try {
        target = new URL(url);
        if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('bad scheme');
      } catch {
        throw new ApiError(400, 'Invalid URL');
      }
      const key = `read:${target.href}`;
      const page = await cache.misc.wrap(key, () => readForTab(target.href));
      return page;
    },

    async '/api/related'({ q }) {
      q = cleanQuery(q);
      if (!llm.enabled() || !q) return { questions: [] };
      const key = `rel:${q.toLowerCase()}`;
      const hit = cache.ai.get(key);
      if (hit) return { questions: hit };
      try {
        const web = await webFor(q).catch(() => ({ results: [] }));
        const text = await llm.complete({
          messages: relatedMessages(
            q,
            web.results.slice(0, 6).map((r) => r.title)
          ),
          temperature: 0.6,
          maxTokens: 160,
        });
        const questions = parseQuestions(text);
        if (questions.length) cache.ai.set(key, questions);
        return { questions };
      } catch {
        return { questions: [] };
      }
    },
  };

  const streams = {
    async '/api/chat'(body, { signal, onEvent }) {
      const history = sanitizeHistory(body?.messages);
      if (!validChat(history)) throw new ApiError(400, 'Missing question');
      if (!llm.enabled()) return notConfigured(onEvent);
      const last = history[history.length - 1];
      try {
        let sources = [];
        if (shouldSearch(last)) {
          onEvent('status', { stage: 'searching' });
          const searchQuery = chatSearchQuery(history);
          const web = await webFor(cleanQuery(searchQuery)).catch(() => ({ results: [] }));
          onEvent('status', { stage: 'reading', count: Math.min(web.results.length, 6) });
          sources = baseSources(web.results, { limit: 6 });
        }
        onEvent('sources', publicSources(sources));
        onEvent('status', { stage: 'writing' });
        const messages = toModelMessages(chatSystemPrompt(), history, chatUserMessage(last.content, sources));
        await pipe(messages, { kind: 'chat', temperature: 0.4, maxTokens: 1600 }, signal, onEvent);
        onEvent('done', {});
      } catch (err) {
        failure(err, signal, onEvent);
      }
    },

    async '/api/summarize'({ url, q }, { signal, onEvent }) {
      let target;
      try {
        target = new URL(url);
        if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('bad scheme');
      } catch {
        throw new ApiError(400, 'Invalid URL');
      }
      if (!llm.enabled()) return notConfigured(onEvent);
      q = cleanQuery(q).slice(0, 200);
      const key = `sum:${target.href}:${q.toLowerCase()}`;
      const hit = cache.ai.get(key);
      if (hit) {
        onEvent('token', { t: hit });
        return onEvent('done', { cached: true });
      }
      try {
        onEvent('status', { stage: 'reading' });
        let page;
        try {
          page = mapKeenableFetch(
            await keenableCall({
              path: '/v1/fetch',
              query: { url: target.href, max_chars: '20000' },
              signal,
              timeout: 12000,
            }),
            target.href
          );
        } catch (err) {
          if (signal?.aborted) throw err;
          // No page reader in the browser: let Gemini (URL context) or Groq's browsing tool read it.
          if (google.enabled() && !googleOff.gemini) {
            onEvent('status', { stage: 'writing' });
            const summary = await guardGoogle('gemini', () => google.summarizeUrl(target.href, q, { signal })).catch(
              (e) => {
                if (signal?.aborted) throw e;
                return '';
              }
            );
            if (summary) {
              cache.ai.set(key, summary);
              onEvent('token', { t: summary });
              return onEvent('done', {});
            }
          }
          if (llm.provider.searchModel) {
            onEvent('status', { stage: 'writing' });
            const summary = await llm.askWithTools(
              `Visit ${target.href} and summarize the page${q ? ` for someone who searched "${q}"` : ''}.\nFormat: "**TL;DR:** one sentence", then 3–5 bullet points with the most useful facts. Under 130 words. Only use what the page says.`,
              { signal }
            );
            if (summary) {
              cache.ai.set(key, summary);
              onEvent('token', { t: summary });
              return onEvent('done', {});
            }
          }
          return onEvent('error', { code: 'unreadable', message: `Spark couldn't open that page (${err.message}).` });
        }
        const text = page.text.slice(0, 9000);
        if (text.length < 200) {
          return onEvent('error', {
            code: 'unreadable',
            message: "This page doesn't expose readable text (it may need JavaScript or a login).",
          });
        }
        onEvent('status', { stage: 'writing' });
        const summary = await pipe(
          summarizeMessages({ query: q, title: page.title, url: target.href, text }),
          { kind: 'search', temperature: 0.2, maxTokens: 450 },
          signal,
          onEvent
        );
        if (summary.trim()) cache.ai.set(key, summary);
        onEvent('done', {});
      } catch (err) {
        failure(err, signal, onEvent);
      }
    },
  };

  return {
    async json(path, params = {}, signal) {
      const handler = json[path];
      if (!handler) throw new ApiError(404, 'Not found');
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return handler(params, { signal });
    },
    async stream(path, { params = {}, body, signal, onEvent }) {
      const handler = streams[path];
      if (!handler) throw new ApiError(404, 'Not found');
      return handler(body || params, { signal, onEvent });
    },
  };
}
