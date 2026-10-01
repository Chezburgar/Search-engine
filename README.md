<p align="center">
  <img src="public/assets/spark-mark.png" width="96" alt="Spark logo" />
</p>

<h1 align="center">Spark</h1>
<p align="center"><b>Search the web with a spark of intelligence.</b><br/>A fast, good-looking search engine with AI (Groq or xAI Grok) built into every page.</p>

---

## Features

**Search**

- Web results from [Keenable](https://keenable.ai) with favicons, breadcrumbs, query-focused snippets and "More results" pagination
- Autocomplete with recent searches, keyboard navigation and voice search
- Knowledge panels from Wikipedia
- Instant answers: a full calculator for math queries, and a live 7-day forecast for "weather in …" queries
- **Google results** through Gemini's "Grounding with Google Search" (or the Custom Search API), with Google's suggestion chips
- **Images** tab with a justified grid, infinite scroll and a lightbox viewer
- **News** tab with the latest headlines
- **Videos** tab with YouTube results that play inside Spark

**Spark Grades (MCPS)**

- A **Grades** link on the home page opens StudentVUE grades for Montgomery County Public Schools, in Spark's style (a vanilla-JS take on GradeFlow)
- Sign in with an MCPS student ID and StudentVUE password, or explore the demo
- Overview with unweighted and weighted GPA (Honors/AP/IB +1 for A–C), average, grade spread, every class, upcoming work and recent grades, per marking period
- Class pages with category breakdowns, **what-if** grades (edit any score or add made-up assignments) and a **"What do I need?"** calculator
- Schedule and attendance

**Spark AI (Groq or xAI Grok)**

- **Spark AI tab**: conversational search. Each question runs a fresh web search, shows source cards, and streams a cited answer, followed by suggested follow-ups
- **Image questions**: attach, paste or drop up to 4 images in the chat, or use the image button in the search box. Images are resized in the browser and sent to a vision model
- **People also ask**: AI-generated questions that expand into cited answers
- **Summarize** any result: Spark reads the page and writes a TL;DR
- An "Ask Spark" row in autocomplete and a ✦ button in the search box jump straight to an AI answer
- No AI overview on results: the only AI call a search makes is a small one for the People also ask questions; full answers run only when you ask

**Spark tabs and the tab assistant**

- Links open in **Spark tabs** instead of new browser tabs: a tab strip at the top, with back/forward, reload, and an address box, showing the real site in a frame. Switching tabs keeps each page as you left it. Ctrl/⌘-click still opens a browser tab
- The **Assistant** (✦ button) reads and controls your Spark tabs on request: "summarize this tab", "compare my open tabs", "open the top 3 results", "where does this page mention pricing?", "close all my tabs". It uses AI tool calling; every action it takes is listed under its answer

**Polish**

- Light and dark themes in the logo's amber → orange → magenta palette
- Responsive from phones to wide screens
- Respects reduced-motion settings
- Installable as a PWA, and browsers can add it as a search engine (OpenSearch)
- Settings for theme and SafeSearch

## Quick start

Requires **Node.js 20.3+**. There is nothing to install.

```bash
cp .env.example .env      # then put your xAI key in XAI_API_KEY
npm start                 # http://localhost:3000
```

| Variable                                         | Purpose                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GROQ_API_KEY`                                   | **AI features**, option 1: a [Groq](https://console.groq.com) key (`gsk_…`). Fast, with a free tier. Used if set.                                                                                                                                              |
| `XAI_API_KEY`                                    | **AI features**, option 2: an [xAI](https://console.x.ai) Grok key (`xai-…`). A key in the wrong variable still works; the prefix decides.                                                                                                                     |
| `AI_MODEL` / `AI_CHAT_MODEL` / `AI_VISION_MODEL` | Optional. Pin models. Otherwise Spark lists the models your key can use and picks fast ones (Groq: GPT-OSS for text, Qwen 3.6 for images).                                                                                                                     |
| `KEENABLE_API_KEY`                               | Recommended. [Keenable](https://keenable.ai) web search key. Without one, Spark uses Keenable's keyless endpoint (rate limited per IP), then DuckDuckGo, Bing and Wikipedia.                                                                                   |
| `GOOGLE_API_KEY`                                 | Optional. A Google API key (`AIza…`) with the **YouTube Data API v3** allowed, for the Videos tab. It's also used for Gemini when `GEMINI_API_KEY` is unset.                                                                                                   |
| `GEMINI_API_KEY`                                 | Optional. A [Gemini API](https://aistudio.google.com/apikey) key for Google AI search (Grounding with Google Search, which needs billing on the key's project) and page summaries. On Pages without grounding, Gemini reads DuckDuckGo's results page instead. |
| `GOOGLE_CSE_ID`                                  | Optional. A Programmable Search Engine ID; enables the Custom Search JSON API (closed to new customers, ends 2027-01-01).                                                                                                                                      |
| `GOOGLE_MODEL`                                   | Optional. Pin the Gemini model used for Google search.                                                                                                                                                                                                         |
| `BRAVE_API_KEY`                                  | Optional. [Brave Search API](https://brave.com/search/api/) key; when set it is tried before Keenable and also powers news and images.                                                                                                                         |
| `PORT` / `HOST`                                  | Where to listen (default `3000` / `0.0.0.0`).                                                                                                                                                                                                                  |
| `SPARK_REGION`                                   | Result region and language, e.g. `us-en`, `uk-en`, `de-de`.                                                                                                                                                                                                    |
| `AI_RATE_LIMIT`                                  | Max AI requests per visitor IP per 10 minutes (default 120).                                                                                                                                                                                                   |
| `TRUST_PROXY`                                    | Set to `1` behind a reverse proxy so rate limits use `X-Forwarded-For`.                                                                                                                                                                                        |

> **Keep your key secret.** `.env` is git-ignored. The key is only used on the server and is never sent to the browser.

## How it works

```
Browser (vanilla JS, no build step)
  │
  ├── /api/search, /api/news, /api/images, /api/suggest, /api/knowledge
  │       └─ provider chains with automatic fallback and in-memory caching
  │            web:    Brave (if keyed) → Keenable → Google (CSE, then Gemini) → DuckDuckGo → Bing → Wikipedia
  │            news:   Brave (if keyed) → Google News RSS → Bing News RSS → Google (Gemini)
  │            videos: YouTube Data API
  │            images: Brave (if keyed) → Openverse → Wikimedia Commons
  │            weather: Open-Meteo, knowledge: Wikipedia
  │
  ├── /api/chat, /api/summarize   (Server-Sent Events)
  │       └─ search → fetch and trim top pages → numbered sources → AI (streamed)
  │
  ├── /api/read     a page's text as Markdown, for the tab assistant
  └── /api/agent    one step of the tab assistant (the model's next message or tool calls)
```

- **Grounded answers.** The AI never answers from a bare prompt. Spark gathers numbered sources (Keenable returns page text with each result; for other providers the top pages are fetched within a 2.5 s budget), keeps the passages most relevant to the query, and Grok cites them inline as `[n]`.
- **Model choice.** On startup Spark lists the models your key can use and ranks them, preferring fast, non-reasoning, newer models so answers start streaming quickly. If a model is retired, it automatically retries with the next best one.
- **Safety.** Page fetching for summaries blocks private and internal addresses (SSRF protection, re-checked on every redirect). AI output is rendered by a small Markdown renderer that escapes all HTML. Strict CSP and security headers are set, AI endpoints are rate-limited per IP, and repeated questions are served from cache.

## Spark tabs and the assistant

Clicking any web link inside Spark opens it in a Spark tab (tabs last for the browser session).

- **Tabs show the real site** in a frame, one frame per tab, created the first time a tab is shown.
  Many sites refuse to be shown inside other sites; without the Chrome extension (below) those show
  a blank or "refused to connect" frame, and the bar above each page links to opening it in your
  browser instead. Back/forward follow the
  pages opened from the address box or by the assistant (links clicked inside a site stay in its
  frame).
- **Page text for the assistant** comes from `/api/read`, because a page from another site can't be
  read from inside its frame. On the Node server, Spark fetches the page itself (with the same SSRF
  protection as summaries) and converts its HTML to Markdown; Wikipedia articles come from
  Wikipedia's API. On GitHub Pages the browser can't fetch most sites, so it tries Wikipedia's API,
  then Keenable's fetcher, then [Jina Reader](https://jina.ai/reader) (`r.jina.ai`, which receives
  the address of the page being read), and finally Gemini, whose version is a rewrite in its own
  words and is marked as such to the assistant. Pages are only read when the assistant asks.
- **The assistant** runs its loop in your browser, where the tabs are. Each step goes to `/api/agent`,
  which asks the AI (Groq or Grok tool calling) for its next move; the browser then runs the tools:
  `list_tabs`, `read_tab`, `open_tab`, `navigate_tab`, `switch_tab`, `close_tabs`, `search_web`
  and `show_search`. It controls Spark tabs only, not your browser's own
  tabs (a web page can't; that would need a browser extension). Page text is passed to the model as
  data, and the model is told never to follow instructions found in pages.

## Real browser tabs without the extension

If extensions can't be installed (for example on a managed school or work browser), the assistant's
**Browser tabs** mode works with real tabs that Spark opens itself: it opens pages in new browser
tabs (allow pop-ups for Spark once) and reads the pages it opened, via `/api/read`. Each tab is cut
off from Spark (`window.opener = null`) before the site loads. That stops a site from redirecting
the Spark tab to a fake page (reverse tabnabbing), and it's also why Spark can't switch to,
redirect or close those tabs: browsers only allow that while the tabs stay linked, and the link is
what a malicious site would abuse. Seeing tabs you opened yourself, and showing every site inside
Spark tabs, need the extension; a web page can't do either.

## Chrome extension (real tabs, and no embed problems)

`extension/` is **Spark Assistant for Chrome** (Manifest V3). With it installed:

- The assistant gets a **Spark tabs / Chrome tabs** switch. In Chrome-tabs mode its tools act on
  your real tabs through the extension: `list_tabs`, `read_tab`, `open_tab`, `navigate_tab`,
  `switch_tab`, `close_tabs`, `find_in_tab` (scrolls to and highlights the words), `group_tabs`
  and `search_web`. It never closes the tab it runs in.
- Clicking the toolbar icon opens the assistant in Chrome's **side panel** (Spark's
  `?page=assistant` view in a frame), next to whatever page you're on.
- **Embedding:** while a Spark tab is open, a session rule removes `X-Frame-Options` and
  `Content-Security-Policy` from the frames inside that tab only, so any site shows in Spark tabs.

How it connects: the extension registers a tiny content script for your Spark address only (set in
the side panel; the default is the GitHub Pages site). Spark and that script talk with
`postMessage`; in the side panel, Spark accepts messages only from a `chrome-extension://` parent.
The Pages build publishes the folder as `spark-chrome-extension.zip`; see
[extension/README.md](extension/README.md) to install it.

Why sites don't show in Spark tabs without it: sites send `X-Frame-Options` or a
`frame-ancestors` CSP to block being framed (protection against clickjacking), and a web page can't
override another site's headers. The other ways around it are a rewriting proxy server (fragile,
breaks logins, and it would see everything you browse) or a desktop app (Electron or Tauri) whose
built-in browser views aren't frames. The extension is the lightest fix.

## GitHub Pages (static) version

GitHub Pages can only host static files, so the Pages build has no server: an in-browser
backend (`public/js/static/backend.js`) answers the same `/api/*` calls by calling
Keenable, Google, Groq/Grok, Wikipedia, Open-Meteo and Openverse directly from the visitor's browser.
The live site is https://chezburgar.github.io/Search-engine/.

**Publishing (GitHub Actions).** `.github/workflows/pages.yml` runs the tests, builds the
site and deploys it on every push (or from Actions → _Deploy to GitHub Pages_ → _Run
workflow_). Keys come from repository secrets, so they never enter git history. One-time setup:

1. **Settings → Secrets and variables → Actions → New repository secret**: add
   `GROQ_API_KEY` (or `XAI_API_KEY`), `KEENABLE_API_KEY`, `GOOGLE_API_KEY` and `GEMINI_API_KEY`.
2. **Settings → Pages → Build and deployment → Source**: choose **GitHub Actions**.

> **The keys are public on Pages.** The build writes them into `spark-config.js`, which
> every visitor downloads, so anyone can copy them and use your quota. Use keys you're
> comfortable sharing, set spending limits, and rotate them if they're abused. Leave the
> `XAI_API_KEY` secret out to publish without AI. For private keys, run the Node server
> instead (see Deploying).

To build locally: `npm run build:pages` writes `dist/` (serve it with any static server).
`npm run deploy:pages -- --no-keys` pushes a keyless build to the `gh-pages` branch;
GitHub's push protection rejects builds that contain the xAI key, by design.

Every API is called from the visitor's browser, so it must accept cross-origin (CORS)
requests. Groq and Google do. If Keenable refuses, Spark switches to Google AI search (Gemini
grounding, paid tier only), then has Gemini read DuckDuckGo's results page (free tier; titles and
links copied from the page, answers dropped unless Gemini actually loaded it), then Groq's
built-in web search, for results, news and page summaries; Wikipedia is the last resort. **Why these results?** under the result count lists each source that was
skipped and why (for example, a key whose API restrictions block the Gemini API).
Compared with the server, the static build has no DuckDuckGo/Bing fallback, takes
suggestions from Wikipedia, and has no per-visitor rate limiting.

## Project layout

```
server/
  index.js            HTTP server, routes, SSE streaming, static files
  config.js           .env loading and settings
  ai/                 Grok client, prompts, source building
  providers/          web, news, images, videos (Google), suggestions, knowledge, weather
  lib/                cache, rate limiter, HTML utilities, SSRF-safe fetch
public/
  index.html, css/spark.css
  js/app.js           router and app shell
  js/views/           home, all results, Spark AI, images, news, videos, grades
  js/grades/          Spark Grades: StudentVUE client (MCPS), XML parser, grade math, demo data
  js/components/      search box, results, panels, widgets, AI answer bits
  js/tabs/            Spark tabs (strip and page frames) and the tab assistant
  js/lib/             DOM helpers, API/SSE client, routes, Markdown, calculator
  js/shared/          logic shared by the server and the static build (prompts, Grok client, parsers)
  js/static/          in-browser backend used by the GitHub Pages build
scripts/              build and deploy the GitHub Pages version
extension/            Spark Assistant for Chrome (real tabs, side panel, embedding)
test/                 unit and end-to-end API tests (upstreams mocked)
```

## Spark Grades

`?page=grades` on Pages (`/grades` on the server) is a StudentVUE client for Montgomery County
Public Schools only (`https://md-mcps-psv.edupoint.com`). StudentVUE speaks SOAP and doesn't accept
calls from other websites, so:

- **GitHub Pages:** the browser sends each request through the CORS-enabled StudentVUE relay that
  GradeFlow uses (`studentvuelib.up.railway.app`).
- **Node server:** `POST /api/studentvue` forwards it to MCPS itself. It only accepts read-only
  methods (StudentInfo, Gradebook, Attendance, StudentClassList, StudentCalendar), never logs or
  stores credentials, and is rate limited per IP.

Credentials stay in the browser: in `localStorage` with "Keep me signed in", otherwise in
`sessionStorage` until the tab closes. What-if edits never leave the page. Grades use the MCPS scale
(A 90+, B 80+, C 70+, D 60+, E below; 89.5 rounds up), and weighted GPA adds a point for A–C in
Honors, AP and IB courses. Spark Grades is unofficial and not affiliated with MCPS or Edupoint.

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
