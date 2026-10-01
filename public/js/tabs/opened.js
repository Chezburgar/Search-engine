// Real browser tabs opened by Spark — no extension needed.
//
// Each tab opens blank and is cut off from Spark (window.opener = null) before the site loads.
// That stops the site from redirecting the Spark tab (to a fake login page, say), but it also
// means Spark can't redirect, switch to or close the tab later: browsers only allow that while
// the tabs stay linked, and the link is exactly what a malicious site could abuse. So Spark can
// open tabs, see whether they're still open, and read the pages it opened (by address, through
// /api/read, since another site's page can't be read directly).

const tabs = [];
let seq = 0;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const isWeb = (value) => {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};

export class PopupBlockedError extends Error {
  constructor() {
    super(
      'The browser blocked the new tab. Allow pop-ups for Spark: click the blocked pop-up icon at the right of the address bar and choose “Always allow”, then ask again.'
    );
    this.name = 'PopupBlockedError';
  }
}

const alive = () => tabs.filter((t) => !t.win.closed);

export const openedTabs = {
  open(url, { title = '' } = {}) {
    if (!isWeb(url)) throw new Error('That is not an http(s) address.');
    const id = `w${++seq}`;
    const win = window.open('', `spark-${id}-${Date.now()}`);
    if (!win) throw new PopupBlockedError();
    try {
      win.opener = null;
    } catch {}
    win.location.href = url;
    tabs.push({ id, win, url, title: title.trim().slice(0, 120) || hostOf(url) });
    return id;
  },

  setTitle(id, title) {
    const tab = tabs.find((t) => t.id === id);
    if (tab && title) tab.title = title.slice(0, 120);
  },

  get(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) throw new Error(`There is no tab ${id} (only tabs Spark opened can be read).`);
    return tab;
  },

  list() {
    const open = alive();
    const newest = open.at(-1)?.id;
    return open.map((t) => ({ id: t.id, title: t.title, url: t.url, newest: t.id === newest || undefined }));
  },
};
