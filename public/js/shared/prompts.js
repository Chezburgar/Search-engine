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

export function overviewMessages(query, sources) {
  return [
    {
      role: 'system',
      content: `You are Spark, the AI layer of the Spark search engine. Today is ${today()}.
Write a search overview that answers the user's query directly, using the numbered web sources provided.

Style:
- Open with a direct 1–2 sentence answer. Bold the single most important fact or phrase.
- Then, only if it helps, add 2–5 tight bullet points with key details, steps or comparisons.
- Use a short "###" heading only when the answer naturally has distinct parts.
- Keep it under 170 words. No preamble ("Sure", "Based on the sources"), no closing summary, no follow-up offers.
- ${CITATION_RULES}
- If the sources disagree or are thin, say so briefly. If they don't cover the query, answer from general knowledge without citations and keep it short.
- For navigational queries (a website or brand), describe briefly what it is and where to go.`,
    },
    {
      role: 'user',
      content: `Query: ${query}\n\nSources:\n${formatSources(sources)}`,
    },
  ];
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

export function newsBriefMessages(query, sources) {
  return [
    {
      role: 'system',
      content: `You are Spark, writing a news briefing for a search engine. Today is ${today()}.
Summarize the latest developments about the topic from the numbered headlines below.
- Start with one sentence on the big picture, then 2–4 bullets on distinct developments, newest first.
- Mention when things happened in relative terms if dates are given.
- ${CITATION_RULES}
- Under 140 words. No preamble.`,
    },
    { role: 'user', content: `Topic: ${query}\n\nHeadlines:\n${formatSources(sources)}` },
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
