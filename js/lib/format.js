export const favicon = (host) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;

export function siteName(host = '') {
  return host.replace(/^(www|m|en)\./, '');
}

export function timeAgo(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  const diff = (Date.now() - date.getTime()) / 1000;
  if (Number.isNaN(diff)) return '';
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr${diff < 7200 ? '' : 's'} ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} day${diff < 172800 ? '' : 's'} ago`;
  return shortDate(iso);
}

export function shortDate(iso) {
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
