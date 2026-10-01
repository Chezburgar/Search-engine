// Fixed-window rate limiter keyed by client IP.
export class RateLimiter {
  constructor({ max, windowMs }) {
    this.max = max;
    this.windowMs = windowMs;
    this.hits = new Map();
    this.sweep = setInterval(() => this.prune(), windowMs).unref();
  }

  take(key) {
    const now = Date.now();
    let entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + this.windowMs };
      this.hits.set(key, entry);
    }
    entry.count += 1;
    return {
      ok: entry.count <= this.max,
      remaining: Math.max(0, this.max - entry.count),
      retryAfter: Math.ceil((entry.reset - now) / 1000),
    };
  }

  prune() {
    const now = Date.now();
    for (const [key, entry] of this.hits) if (entry.reset <= now) this.hits.delete(key);
  }
}
