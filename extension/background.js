// Spark Assistant for Chrome — background service worker.
//
// 1. Tab tools: Spark's assistant (in a Spark tab, or in this extension's side panel) asks for
//    actions on your real Chrome tabs — list, read, open, go to, switch, close, find, group.
// 2. A bridge: a small content script is registered only on your Spark site and relays the
//    assistant's requests here. No other site can talk to the extension.
// 3. Framing: while a Spark tab is open, sites shown inside that tab's frames get their
//    "don't embed me" headers removed, so Spark tabs can show any site. Only frames inside
//    Spark tabs are affected; every other tab and site works as usual.

const DEFAULTS = { sparkUrl: 'https://chezburgar.github.io/Search-engine/', unframe: true };
const BRIDGE_ID = 'spark-bridge';
const VERSION = chrome.runtime.getManifest().version;

async function settings() {
  const saved = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...saved };
}

// "https://chezburgar.github.io/Search-engine/?x" → "https://chezburgar.github.io/Search-engine/"
function sparkBase(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Spark must be an http(s) address');
  const path = u.pathname.endsWith('/') ? u.pathname : u.pathname.replace(/[^/]*$/, '');
  return `${u.origin}${path}`;
}

const isSparkPage = (url, base) => typeof url === 'string' && url.startsWith(base);

/* --------------------------------- bridge --------------------------------- */

async function registerBridge() {
  const { sparkUrl } = await settings();
  const base = sparkBase(sparkUrl);
  const u = new URL(base);
  await chrome.scripting.unregisterContentScripts({ ids: [BRIDGE_ID] }).catch(() => {});
  await chrome.scripting.registerContentScripts([
    {
      id: BRIDGE_ID,
      // Match patterns can't hold a port; the sender check below compares the full origin.
      matches: [`${u.protocol}//${u.hostname}${u.pathname}*`],
      js: ['bridge.js'],
      runAt: 'document_start',
      allFrames: false,
      persistAcrossSessions: true,
    },
  ]);
}

/* -------------------------------- framing --------------------------------- */

// One session rule per Spark tab: remove X-Frame-Options and CSP from its sub-frames.
async function allowFraming(tabId) {
  const { unframe } = await settings();
  const rule = {
    id: tabId,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' },
      ],
    },
    condition: { tabIds: [tabId], resourceTypes: ['sub_frame'] },
  };
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [tabId],
    addRules: unframe ? [rule] : [],
  });
}

const stopFraming = (tabId) =>
  chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] }).catch(() => {});

async function refreshFraming() {
  const { sparkUrl, unframe } = await settings();
  const base = sparkBase(sparkUrl);
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: rules.map((r) => r.id) });
  if (!unframe) return;
  for (const tab of await chrome.tabs.query({})) if (isSparkPage(tab.url, base)) await allowFraming(tab.id);
}

chrome.tabs.onRemoved.addListener((tabId) => stopFraming(tabId));
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (!info.url) return;
  const base = sparkBase((await settings()).sparkUrl);
  if (!isSparkPage(info.url, base)) stopFraming(tabId);
});

/* ---------------------------------- tools --------------------------------- */

const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

const webUrl = (value) => {
  let url;
  try {
    url = new URL(String(value || ''));
  } catch {
    throw new Error('That is not a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) addresses can be opened.');
  return url.href;
};

const tabIdOf = (value) => {
  const id = value === null || value === '' || typeof value === 'boolean' ? NaN : Number(value);
  if (!Number.isInteger(id) || id < 0) throw new Error(`"${value}" is not a tab id from list_tabs.`);
  return id;
};

async function getTab(value) {
  try {
    return await chrome.tabs.get(tabIdOf(value));
  } catch {
    throw new Error(`There is no tab ${value}.`);
  }
}

const readable = (tab) => /^https?:/.test(tab.url || '') && !/^https:\/\/chromewebstore\.google\.com/.test(tab.url);

// Runs inside the tab: the page's main text.
function pageText() {
  const pick = document.querySelector('main, article, [role="main"]');
  const root = pick && pick.innerText.trim().length > 400 ? pick : document.body;
  const text = (root?.innerText || '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return {
    title: document.title,
    description: document.querySelector('meta[name="description"]')?.content || '',
    selection: String(getSelection() || '')
      .trim()
      .slice(0, 3000),
    text: text.slice(0, 40000),
  };
}

// Runs inside the tab: select, scroll to and return the first match.
function findText(needle) {
  getSelection()?.removeAllRanges();
  if (!window.find(needle, false, false, true, false, false, false)) return { found: false };
  const sel = getSelection();
  const node = sel.anchorNode;
  const el = node?.nodeType === 1 ? node : node?.parentElement;
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const block = el?.closest('p, li, td, h1, h2, h3, h4, blockquote, section, div') || el;
  return { found: true, context: (block?.innerText || '').trim().slice(0, 400) };
}

async function inTab(tab, func, args = []) {
  if (!readable(tab)) throw new Error('Chrome doesn’t let extensions read or change this kind of page.');
  const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return res?.result;
}

const TOOLS = {
  async list_tabs() {
    const [tabs, groups, windows] = await Promise.all([
      chrome.tabs.query({}),
      chrome.tabGroups.query({}).catch(() => []),
      chrome.windows.getAll(),
    ]);
    const groupName = new Map(groups.map((g) => [g.id, g.title || g.color]));
    const focused = windows.find((w) => w.focused)?.id;
    const windowNo = new Map(windows.map((w, i) => [w.id, i + 1]));
    return {
      tabs: tabs.slice(0, 200).map((t) => ({
        id: t.id,
        title: (t.title || '').slice(0, 140),
        url: (t.url || t.pendingUrl || '').slice(0, 300),
        active: t.active && t.windowId === focused,
        window: windowNo.get(t.windowId),
        group: t.groupId >= 0 ? groupName.get(t.groupId) : undefined,
        pinned: t.pinned || undefined,
      })),
    };
  },

  async read_tab({ tab_id }) {
    const tab = await getTab(tab_id);
    const page = await inTab(tab, pageText);
    return {
      id: tab.id,
      title: page.title || tab.title,
      url: tab.url,
      description: page.description || undefined,
      selection: page.selection || undefined,
      text: page.text.slice(0, 12000),
      truncated: page.text.length > 12000 || undefined,
    };
  },

  async open_tab({ url, background }) {
    const tab = await chrome.tabs.create({ url: webUrl(url), active: !background });
    return { opened: tab.id, showing: !background };
  },

  async navigate_tab({ tab_id, url }) {
    const tab = await getTab(tab_id);
    await chrome.tabs.update(tab.id, { url: webUrl(url) });
    return { ok: true };
  },

  async switch_tab({ tab_id }) {
    const tab = await getTab(tab_id);
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    return { showing: tab.id };
  },

  async close_tabs({ tab_ids }, sender) {
    const ids = (Array.isArray(tab_ids) ? tab_ids : []).map(tabIdOf);
    // Never close the tab the assistant is running in.
    const keep = sender.tab?.id;
    const closing = ids.filter((id) => id !== keep);
    const existing = new Set((await chrome.tabs.query({})).map((t) => t.id));
    const closed = closing.filter((id) => existing.has(id));
    if (closed.length) await chrome.tabs.remove(closed);
    return { closed, skipped: ids.filter((id) => !closed.includes(id)) };
  },

  async find_in_tab({ tab_id, text }) {
    const tab = await getTab(tab_id);
    const needle = String(text || '')
      .trim()
      .slice(0, 200);
    if (!needle) throw new Error('Nothing to find.');
    await TOOLS.switch_tab({ tab_id: tab.id });
    return inTab(tab, findText, [needle]);
  },

  async group_tabs({ tab_ids, title, color }) {
    const ids = (Array.isArray(tab_ids) ? tab_ids : []).map(tabIdOf);
    if (!ids.length) throw new Error('No tabs to group.');
    const groupId = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(groupId, {
      title: String(title || '').slice(0, 60),
      ...(COLORS.includes(color) ? { color } : {}),
    });
    return { grouped: ids.length, group: groupId };
  },
};

/* -------------------------------- messages -------------------------------- */

const SIDE_PANEL = chrome.runtime.getURL('sidepanel.html');

async function trusted(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.url?.startsWith(SIDE_PANEL)) return true;
  const base = sparkBase((await settings()).sparkUrl);
  return Boolean(sender.tab) && isSparkPage(sender.url, base);
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (!(await trusted(sender))) throw new Error('Not allowed.');
    if (msg?.type === 'spark-hello') {
      if (sender.tab?.id != null) await allowFraming(sender.tab.id);
      const { unframe } = await settings();
      return { version: VERSION, unframe };
    }
    if (msg?.type === 'spark-tool') {
      const tool = Object.hasOwn(TOOLS, msg.method) ? TOOLS[msg.method] : null;
      if (!tool) throw new Error(`Unknown tool ${msg.method}.`);
      return tool(msg.args || {}, sender);
    }
    if (msg?.type === 'spark-settings' && sender.url?.startsWith(SIDE_PANEL)) {
      if (msg.set) {
        const next = {};
        if (typeof msg.set.unframe === 'boolean') next.unframe = msg.set.unframe;
        if (typeof msg.set.sparkUrl === 'string') next.sparkUrl = sparkBase(msg.set.sparkUrl);
        await chrome.storage.local.set(next);
        if (next.sparkUrl) await registerBridge();
        await refreshFraming();
      }
      return settings();
    }
    throw new Error('Unknown request.');
  })().then(
    (result) => reply({ ok: true, result }),
    (err) => reply({ ok: false, error: err?.message || String(err) })
  );
  return true; // reply asynchronously
});

/* ---------------------------------- setup --------------------------------- */

async function setup() {
  await registerBridge();
  await refreshFraming();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);
