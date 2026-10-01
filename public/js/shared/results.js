import { stripTags } from './text.js';

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// "https://www.rust-lang.org › learn › get-started"
export function breadcrumb(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split('/')
      .filter(Boolean)
      .slice(0, 3)
      .map((p) => {
        try {
          return decodeURIComponent(p);
        } catch {
          return p;
        }
      })
      .map((p) => (p.length > 28 ? `${p.slice(0, 26)}…` : p));
    return [`${u.protocol}//${u.host}`, ...parts].join(' › ');
  } catch {
    return url;
  }
}

export function normalizeResult(r) {
  if (!r || !r.url) return null;
  let url;
  try {
    url = new URL(r.url);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  // `site` names the real website when `url` is a redirect (Google grounding links).
  const site = r.site || '';
  const title = stripTags(r.title || '') || site || hostOf(url.href);
  return {
    title: title.slice(0, 200),
    url: url.href,
    host: site || hostOf(url.href),
    breadcrumb: site ? `https://${site}` : breadcrumb(url.href),
    snippet: stripTags(r.snippet || '').slice(0, 400),
    date: r.date || null,
    thumbnail: r.thumbnail || null,
    // Longer page text used to ground AI answers (not shown in results).
    ...(r.extract ? { extract: String(r.extract).slice(0, 2000) } : {}),
  };
}

export function dedupe(results) {
  const seen = new Set();
  return results.filter((r) => {
    if (!r) return false;
    const key = r.url.replace(/^https?:\/\/(www\.)?/, '').replace(/[/#]+$/, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// What the results list needs; extracts stay on the server / in the AI layer.
export const forDisplay = (results) => results.map(({ extract, ...r }) => r);

// A short, human reason for a failed upstream call.
export function describeError(err) {
  if (!err) return 'unknown error';
  if (err.name === 'TimeoutError' || /timed? ?out|aborted due to timeout/i.test(err.message)) return 'timed out';
  if (err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(err.message)) {
    return 'blocked by the browser (CORS) or unreachable';
  }
  return err.message || String(err);
}

// Try each provider in order until one returns results. `errors` lists why the
// earlier ones were skipped, so the UI can explain a fallback.
export async function firstSuccessful(providers, run) {
  const errors = [];
  for (const provider of providers) {
    try {
      const out = await run(provider);
      if (out && out.results && out.results.length) return { ...out, provider: provider.name, errors };
      errors.push(`${provider.name}: no results`);
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      errors.push(`${provider.name}: ${describeError(err)}`);
    }
  }
  return { results: [], provider: null, errors };
}
