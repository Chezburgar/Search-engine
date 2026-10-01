// Turns search results into numbered sources for the model. Results that carry
// page text (`extract`) are used as-is; the server may additionally fetch pages
// for the rest.
export function baseSources(results, { limit = 6, knowledge } = {}) {
  const sources = results.slice(0, limit).map((r, i) => ({
    n: i + 1,
    title: r.title,
    url: r.url,
    host: r.host,
    snippet: r.snippet,
    date: r.date || null,
    ...(r.extract && r.extract.length > 120 ? { excerpt: r.extract } : {}),
  }));
  if (knowledge?.extract && !sources.some((s) => s.url === knowledge.url)) {
    sources.push({
      n: sources.length + 1,
      title: `${knowledge.title} — Wikipedia`,
      url: knowledge.url,
      host: 'en.wikipedia.org',
      snippet: knowledge.extract,
    });
  }
  return sources;
}

// What the browser is shown: no page text.
export const publicSources = (sources) =>
  sources.map(({ n, title, url, host, date }) => ({ n, title, url, host, date }));

// News headlines as numbered sources for a briefing.
export const newsSources = (items) =>
  items.slice(0, 10).map((r, i) => ({
    n: i + 1,
    title: r.title,
    url: r.url,
    host: r.source || r.host,
    date: r.date ? r.date.slice(0, 10) : null,
    snippet: r.snippet,
  }));

// Follow-up questions are often short ("what about X?"); search with the topic for context.
export function chatSearchQuery(history) {
  const users = history.filter((m) => m.role === 'user');
  const first = users[0]?.content || '';
  const question = (users[users.length - 1]?.content || '').trim();
  if (users.length > 1 && question.split(/\s+/).length < 7) return `${first.slice(0, 120)} ${question}`.slice(0, 220);
  return question.slice(0, 300);
}
