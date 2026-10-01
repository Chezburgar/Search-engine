// localStorage can throw (private mode, blocked storage) — every access is guarded.
const read = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
};
const write = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
};

const DEFAULTS = { theme: 'system', overview: 'auto', safe: 'moderate', history: true };

export const settings = {
  get(key) {
    return { ...DEFAULTS, ...read('spark:settings', {}) }[key];
  },
  set(key, value) {
    write('spark:settings', { ...read('spark:settings', {}), [key]: value });
    window.dispatchEvent(new CustomEvent('spark:settings', { detail: { key, value } }));
  },
};

export const recent = {
  list() {
    return read('spark:recent', []);
  },
  add(q) {
    if (!settings.get('history')) return;
    const list = [q, ...recent.list().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
    write('spark:recent', list);
  },
  remove(q) {
    write(
      'spark:recent',
      recent.list().filter((x) => x !== q)
    );
  },
  clear() {
    write('spark:recent', []);
  },
};

export const session = {
  get(key) {
    try {
      return JSON.parse(sessionStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      sessionStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};
