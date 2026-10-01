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

// Spark Grades: /grades on the server, ?page=grades on Pages. `params` are the grades
// view's own state (g = view, c = course, mp = marking period).
export function gradesUrl(params = {}) {
  const p = new URLSearchParams(STATIC ? { page: 'grades' } : {});
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') p.set(k, v);
  const qs = p.toString();
  return `${ROOT}${STATIC ? '' : 'grades'}${qs ? `?${qs}` : ''}`;
}

export function isGradesPage(url = new URL(location.href)) {
  return STATIC ? url.searchParams.get('page') === 'grades' : url.pathname.endsWith('/grades');
}
