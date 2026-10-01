const today = () =>
  new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

const CITATION_RULES = `Cite sources inline with their bracketed number right after the claim they support, like [1] or [2][3]. Only cite numbers that exist in the provided sources. Never invent URLs, quotes or statistics.`;

export function formatSources(sources) {
  return sources
    .map((s) => {
      const lines = [`[${s.n}] ${s.title} — ${s.host}`];
      if (s.date) lines.push(`Published: ${s.date}`);
      if (s.snippet) lines.push(`Snippet: ${s.snippet}`);
      if (s.excerpt) lines.push(`Excerpt:\n${s.excerpt}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

export function relatedMessages(query, titles) {
  return [
    {
      role: 'system',
      content: `You write "People also ask" questions for a search engine. Today is ${today()}.
Return exactly 4 short, distinct, natural questions a curious person would ask next about the query. Each under 12 words, each ending with "?". One question per line. No numbering, bullets, quotes or extra text.`,
    },
    {
      role: 'user',
      content: `Query: ${query}${titles.length ? `\nTop results:\n${titles.map((t) => `- ${t}`).join('\n')}` : ''}`,
    },
  ];
}

export function chatSystemPrompt() {
  return `You are Spark, a helpful and precise AI search assistant built into the Spark search engine. Today is ${today()}.
Each user message may come with fresh numbered web sources. Use them to give accurate, current answers.
- Lead with the answer. Be clear and well structured: short paragraphs, bullets, tables or numbered steps when they help.
- Bold key terms sparingly. Use "###" headings only for longer answers.
- ${CITATION_RULES} Citation numbers refer to the sources attached to the latest message.
- If sources are missing or irrelevant, rely on your own knowledge and say when something may be out of date.
- When the user attaches images, look at them carefully: describe, identify, read text, or solve what's shown, and say when you're unsure.
- Be concise by default (under 250 words) unless the user asks for depth, code, or a plan.`;
}

export function chatUserMessage(question, sources) {
  if (!sources.length) return question;
  return `${question}\n\n---\nWeb sources for this message:\n${formatSources(sources)}`;
}

export function summarizeMessages({ query, title, url, text }) {
  return [
    {
      role: 'system',
      content: `You summarize web pages for people browsing search results. Today is ${today()}.
Format:
**TL;DR:** one sentence.
Then 3–5 bullet points with the most useful facts from the page${query ? ", putting what matters for the searcher's query first" : ''}.
Under 130 words total. Only use information from the page. If the page text is empty, paywalled or unrelated, say so in one sentence.`,
    },
    {
      role: 'user',
      content: `${query ? `Searcher's query: ${query}\n` : ''}Page: ${title || url}\nURL: ${url}\n\nPage text:\n${text}`,
    },
  ];
}

// Pulls clean questions out of a free-form model reply.
export function parseQuestions(text) {
  return text
    .split('\n')
    .map((l) =>
      l
        .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
        .replace(/^["“]|["”]$/g, '')
        .trim()
    )
    .filter((l) => l.length > 8 && l.length < 140 && l.endsWith('?'))
    .slice(0, 4);
}
