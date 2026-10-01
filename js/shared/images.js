import { stripTags } from './text.js';
import { hostOf } from './results.js';

export function image({ title, url, thumbnail, width, height, pageUrl, source, license, creator }) {
  if (!thumbnail || !/^https?:/i.test(thumbnail)) return null;
  return {
    title: stripTags(title || '').slice(0, 160) || 'Image',
    url: url || thumbnail,
    thumbnail,
    width: Number(width) || 400,
    height: Number(height) || 300,
    pageUrl: pageUrl || url,
    source: source || hostOf(pageUrl || url),
    license: license || null,
    creator: creator || null,
  };
}

export const openverseUrl = (q, page) =>
  `https://api.openverse.org/v1/images/?${new URLSearchParams({ q, page: String(page), page_size: '20', mature: 'false' })}`;

export function mapOpenverse(data, page) {
  return {
    results: (data.results || []).map((r) =>
      image({
        title: r.title,
        url: r.url,
        thumbnail: r.thumbnail || r.url,
        width: r.width,
        height: r.height,
        pageUrl: r.foreign_landing_url,
        source: r.source || r.provider,
        license: r.license ? `CC ${String(r.license).toUpperCase()} ${r.license_version || ''}`.trim() : null,
        creator: r.creator,
      })
    ),
    more: page < (data.page_count || 1),
  };
}

export function commonsUrl(q, page, { cors = false } = {}) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `filetype:bitmap ${q}`,
    gsrnamespace: '6',
    gsrlimit: '30',
    gsroffset: String((page - 1) * 30),
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiurlwidth: '480',
  });
  if (cors) params.set('origin', '*');
  return `https://commons.wikimedia.org/w/api.php?${params}`;
}

export function mapCommons(data) {
  const pages = (data.query?.pages || []).sort((a, b) => (a.index || 0) - (b.index || 0));
  return {
    results: pages.map((p) => {
      const info = p.imageinfo?.[0] || {};
      const meta = info.extmetadata || {};
      return image({
        title: stripTags(meta.ObjectName?.value || p.title.replace(/^File:/, '').replace(/\.\w+$/, '')),
        url: info.url,
        thumbnail: info.thumburl,
        width: info.thumbwidth || info.width,
        height: info.thumbheight || info.height,
        pageUrl: info.descriptionurl,
        source: 'Wikimedia Commons',
        license: stripTags(meta.LicenseShortName?.value || ''),
        creator: stripTags(meta.Artist?.value || ''),
      });
    }),
    more: Boolean(data.continue),
  };
}
