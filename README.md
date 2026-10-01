<p align="center">
  <img src="public/assets/spark-mark.png" width="96" alt="Spark logo" />
</p>

<h1 align="center">Spark</h1>
<p align="center"><b>Search the web with a spark of intelligence.</b><br/>A fast, good-looking search engine with Grok-powered AI built into every page.</p>

---

## Features

**Search**
- Web results with favicons, breadcrumbs, highlighted matches and "More results" pagination
- Autocomplete with recent searches, keyboard navigation and voice search
- Knowledge panels from Wikipedia
- Instant answers: a full calculator for math queries, and a live 7-day forecast for "weather in …" queries
- **Images** tab with a justified grid, infinite scroll and a lightbox viewer
- **News** tab with the latest headlines

**Spark AI (Grok, via the xAI API)**
- **Spark Overview**: a streamed answer at the top of results, grounded in the top web results *and the text of the top pages*, with numbered citation chips you can hover and click
- **Ask a follow-up** from the overview to continue the conversation in the Spark AI tab
- **Spark AI tab**: conversational search. Each question runs a fresh web search, shows source cards, and streams a cited answer, followed by suggested follow-ups
- **People also ask**: AI-generated questions that expand into cited answers
- **Summarize** any result: Spark reads the page and writes a TL;DR
- **Spark Briefing** on the News tab: a summary of the latest headlines
- An "Ask Spark" row in autocomplete and a ✦ button in the search box jump straight to an AI answer

**Polish**
- Light and dark themes in the logo's amber → orange → magenta palette
- Responsive from phones to wide screens
- Respects reduced-motion settings
- Installable as a PWA, and browsers can add it as a search engine (OpenSearch)
- Settings for theme, AI overviews (always / on request / off) and SafeSearch

## Quick start

Requires **Node.js 20.3+**. There is nothing to install.

```bash
cp .env.example .env      # then put your xAI key in XAI_API_KEY
npm start                 # http://localhost:3000
```

| Variable | Purpose |
| --- | --- |
| `XAI_API_KEY` | **Required for AI features.** Your key from [console.x.ai](https://console.x.ai). |
| `XAI_MODEL` | Optional. Pins a Grok model. If unset, Spark picks the newest *fast* Grok model your key can use. |
| `XAI_CHAT_MODEL` | Optional. A different model for the Spark AI chat tab, e.g. a larger reasoning model. |
| `BRAVE_API_KEY` | Optional. [Brave Search API](https://brave.com/search/api/) key for higher-quality web, news and image results. |
| `PORT` / `HOST` | Where to listen (default `3000` / `0.0.0.0`). |
| `SPARK_REGION` | Result region and language, e.g. `us-en`, `uk-en`, `de-de`. |
| `AI_RATE_LIMIT` | Max AI requests per visitor IP per 10 minutes (default 120). |
| `TRUST_PROXY` | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For`. |

> **Keep your key secret.** `.env` is git-ignored. The key is only used on the server and is never sent to the browser.

## How it works

```
Browser (vanilla JS, no build step)
  │
  ├── /api/search, /api/news, /api/images, /api/suggest, /api/knowledge
  │       └─ provider chains with automatic fallback and in-memory caching
  │            web:    Brave (if keyed) → DuckDuckGo → Bing → Wikipedia
  │            news:   Brave (if keyed) → Google News RSS → Bing News RSS
  │            images: Brave (if keyed) → Openverse → Wikimedia Commons
  │            weather: Open-Meteo, knowledge: Wikipedia
  │
  └── /api/overview, /api/chat, /api/summarize   (Server-Sent Events)
          └─ search → fetch and trim top pages → numbered sources → Grok (streamed)
```

- **Grounded answers.** The AI never answers from a bare prompt. The server gathers numbered sources (snippets plus the most relevant passages of the top pages, fetched within a 2.5 s budget) and Grok cites them inline as `[n]`.
- **Model choice.** On startup Spark lists the models your key can use and ranks them, preferring fast, non-reasoning, newer models so overviews start streaming quickly. If a model is retired, it automatically retries with the next best one.
- **Safety.** Page fetching for summaries blocks private and internal addresses (SSRF protection, re-checked on every redirect). AI output is rendered by a small Markdown renderer that escapes all HTML. Strict CSP and security headers are set, AI endpoints are rate-limited per IP, and repeated questions are served from cache.

## Project layout

```
server/
  index.js            HTTP server, routes, SSE streaming, static files
  config.js           .env loading and settings
  ai/                 Grok client, prompts, source building
  providers/          web, news, images, suggestions, knowledge, weather
  lib/                cache, rate limiter, HTML utilities, SSRF-safe fetch
public/
  index.html, css/spark.css
  js/app.js           router and app shell
  js/views/           home, all results, Spark AI, images, news
  js/components/      search box, AI overview, results, panels, widgets
  js/lib/             DOM helpers, API/SSE client, Markdown, calculator
test/                 unit and end-to-end API tests (upstreams mocked)
```

## Development

```bash
npm run dev     # restarts on file changes
npm test        # runs offline: every upstream service is mocked
```

To try the UI without network access or an API key, start the server with the test mocks:
`node --import ./test/fixtures/mock-fetch.js server/index.js`

## Deploying

Any Node host works (Render, Railway, Fly.io, a VPS). Set the environment variables above in your host's dashboard instead of committing a `.env` file. A Dockerfile is included:

```bash
docker build -t spark .
docker run -p 3000:3000 -e XAI_API_KEY=your-key spark
```

**Note:** without `BRAVE_API_KEY`, web results come from keyless sources (DuckDuckGo's HTML endpoint, Bing RSS) that can rate-limit busy servers. Spark falls back automatically, but for production traffic a Brave Search API key is recommended.
