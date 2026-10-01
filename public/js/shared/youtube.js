// Video results from the YouTube Data API v3 (a Google API key with YouTube enabled).
// A search costs 100 quota units of the free 10,000 a day; the details call costs 1.

import { decodeEntities } from './text.js';

const API = 'https://www.googleapis.com/youtube/v3';

export function youtubeSearchUrl(q, key, { pageToken = '', region = 'us-en' } = {}) {
  const [country = 'us', lang = 'en'] = region.toLowerCase().split('-');
  return `${API}/search?${new URLSearchParams({
    part: 'snippet',
    type: 'video',
    q,
    maxResults: '24',
    safeSearch: 'moderate',
    regionCode: country.toUpperCase(),
    relevanceLanguage: lang,
    key,
    ...(pageToken ? { pageToken } : {}),
  })}`;
}

export const youtubeDetailsUrl = (ids, key) =>
  `${API}/videos?${new URLSearchParams({ part: 'contentDetails,statistics', id: ids.join(','), key })}`;

// "PT1H2M3S" → "1:02:03"
export function isoDuration(iso = '') {
  const m = String(iso).match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return '';
  const h = Number(m[1] || 0) * 24 + Number(m[2] || 0);
  const min = Number(m[3] || 0);
  const s = Number(m[4] || 0);
  if (!h && !min && !s) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(min)}:${pad(s)}` : `${min}:${pad(s)}`;
}

export function mapYouTube(search, details = {}) {
  const extra = new Map((details.items || []).map((v) => [v.id, v]));
  const results = (search.items || [])
    .map((it) => {
      const id = it.id?.videoId;
      if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
      const sn = it.snippet || {};
      const more = extra.get(id);
      const live = sn.liveBroadcastContent === 'live';
      return {
        id,
        title: decodeEntities(sn.title || ''),
        channel: decodeEntities(sn.channelTitle || ''),
        description: decodeEntities(sn.description || ''),
        date: sn.publishedAt || null,
        thumbnail:
          sn.thumbnails?.high?.url || sn.thumbnails?.medium?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
        url: `https://www.youtube.com/watch?v=${id}`,
        duration: live ? 'LIVE' : isoDuration(more?.contentDetails?.duration),
        views: more?.statistics?.viewCount ? Number(more.statistics.viewCount) : null,
      };
    })
    .filter(Boolean);
  return { results, next: search.nextPageToken || null };
}

export async function searchYouTube(q, key, { pageToken, region, getJSON }) {
  const search = await getJSON(youtubeSearchUrl(q, key, { pageToken, region }));
  const ids = (search.items || []).map((it) => it.id?.videoId).filter(Boolean);
  const details = ids.length ? await getJSON(youtubeDetailsUrl(ids, key)).catch(() => ({})) : {};
  return mapYouTube(search, details);
}
