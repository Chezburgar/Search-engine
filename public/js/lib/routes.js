// URLs work both on the Node server (/search?q=…) and on GitHub Pages, where the
// site lives under a subpath (/Search-engine/) and every page is index.html (?q=…).

export const CONFIG = window.SPARK_CONFIG || { mode: 'server' };
export const STATIC = CONFIG.mode === 'static';
export const ROOT = new URL('./', location.href).pathname;

export function searchUrl(q, tab = 'all') {
  const params = new URLSearchParams({ q });
  if (tab && tab !== 'all') params.set('tab', tab);
  return `${ROOT}${STATIC ? '' : 'search'}?${params}`;
}

export const homeUrl = () => ROOT;

export function isResultsPage(url = new URL(location.href)) {
  return Boolean(url.searchParams.get('q')?.trim()) && (STATIC || url.pathname.endsWith('/search'));
}
