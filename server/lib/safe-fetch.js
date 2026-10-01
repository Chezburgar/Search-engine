import dns from 'node:dns/promises';
import net from 'node:net';
import { request, HttpError } from './http.js';

function isPrivateIPv4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) return isPrivateIPv4(ip);
  const lower = ip.toLowerCase();
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    lower === '::' ||
    lower === '::1' ||
    lower.startsWith('fc') ||
    lower.startsWith('fd') ||
    /^fe[89ab]/.test(lower) ||
    lower.startsWith('ff')
  );
}

export async function assertPublic(url) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new HttpError(400, 'Only http(s) URLs are allowed');
  if (url.username || url.password) throw new HttpError(400, 'URLs with credentials are not allowed');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    throw new HttpError(400, 'That address is not allowed');
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new HttpError(400, 'That address is not allowed');
  }
}

// Fetches a user-supplied URL while refusing private/internal destinations,
// re-checking every redirect hop. Returns at most `maxBytes` of body text.
export async function safeFetchPage(input, { timeout = 6000, maxBytes = 1_500_000, signal } = {}) {
  let url = new URL(input);
  for (let hop = 0; hop < 5; hop++) {
    await assertPublic(url);
    const res = await request(url, {
      timeout,
      signal,
      redirect: 'manual',
      headers: { Accept: 'text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8,*/*;q=0.5' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url);
      res.body?.cancel().catch(() => {});
      continue;
    }
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      throw new HttpError(res.status, `The page responded with ${res.status}`);
    }
    const type = res.headers.get('content-type') || '';
    if (type && !/text\/|html|xml|json/i.test(type)) {
      res.body?.cancel().catch(() => {});
      throw new HttpError(415, 'That page is not a text document');
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let bytes = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (bytes >= maxBytes) {
        reader.cancel().catch(() => {});
        break;
      }
    }
    return { url: url.toString(), text, contentType: type };
  }
  throw new HttpError(508, 'Too many redirects');
}
