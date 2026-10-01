// Small in-memory LRU cache with per-entry TTL. `wrap` caches the promise so
// concurrent requests for the same key share one upstream call.
export class Cache {
  constructor({ max = 500, ttl = 5 * 60 * 1000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
  }

  get(key) {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, ttl = this.ttl) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttl });
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
    return value;
  }

  delete(key) {
    this.map.delete(key);
  }

  wrap(key, fn, ttl = this.ttl) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;
    const promise = Promise.resolve()
      .then(fn)
      .catch((err) => {
        if (this.map.get(key)?.value === promise) this.map.delete(key);
        throw err;
      });
    this.set(key, promise, ttl);
    return promise;
  }
}
