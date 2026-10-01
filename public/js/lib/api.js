import { settings } from './store.js';

const withParams = (path, params = {}) => {
  const u = new URL(path, location.origin);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  return u;
};

export async function getJSON(path, params, { signal } = {}) {
  const res = await fetch(withParams(path, params), { signal, headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status });
  return data;
}

// Reads a text/event-stream response and calls onEvent(name, data) per event.
export async function stream(path, { params, body, signal, onEvent }) {
  const res = await fetch(withParams(path, params), {
    method: body ? 'POST' : 'GET',
    headers: body
      ? { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
      : { Accept: 'text/event-stream' },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        onEvent(event, JSON.parse(data));
      } catch (err) {
        console.warn('Bad stream event', err);
      }
    }
  }
}

export const safe = () => settings.get('safe');

let statusPromise;
export function aiStatus() {
  statusPromise ||= getJSON('/api/status').catch(() => ({ ai: { enabled: false } }));
  return statusPromise;
}
