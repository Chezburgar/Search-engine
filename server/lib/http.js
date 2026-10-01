export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
export const BOT_UA = 'SparkSearch/1.0 (+https://github.com/chezburgar/search-engine)';

export class HttpError extends Error {
  constructor(status, message, body) {
    super(message || `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

export async function request(url, { timeout = 7000, headers = {}, signal, ...init } = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      'User-Agent': BROWSER_UA,
      'Accept-Language': 'en-US,en;q=0.9',
      ...headers,
    },
    signal: withTimeout(signal, timeout),
  });
  return res;
}

export async function fetchText(url, opts = {}) {
  const res = await request(url, opts);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `${new URL(url).host} responded ${res.status}`, text.slice(0, 500));
  return text;
}

export async function fetchJSON(url, opts = {}) {
  const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `${new URL(url).host} responded ${res.status}`, text.slice(0, 500));
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, `${new URL(url).host} returned invalid JSON`);
  }
}

export function qs(params) {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') out.set(k, String(v));
  }
  return out.toString();
}
