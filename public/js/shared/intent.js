const NAV_WORDS = /\s+(login|log in|sign in|signin|sign up|website|homepage|home page|official site|app|account)$/i;

// "youtube", "facebook login": the user wants a website, not an AI overview.
export function isNavigational(q, results) {
  const words = q.trim().split(/\s+/);
  if (words.length > 3) return false;
  const target = q
    .toLowerCase()
    .replace(NAV_WORDS, '')
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co)$/, '')
    .replace(/[\s.-]/g, '');
  const label = (results[0]?.host || '').split('.').slice(-2, -1)[0]?.replace(/-/g, '') || '';
  return target.length >= 3 && label === target;
}

export const isMath = (q) => /^[\d\s+\-*/^().,%×÷πe]+$/i.test(q) && /\d/.test(q) && /[+\-*/^%×÷]/.test(q);

export const wantsOverview = (q, results) => !isMath(q) && !isNavigational(q, results);
