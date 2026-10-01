import { config } from '../config.js';
import { fetchJSON, BOT_UA } from '../lib/http.js';
import { wikiSearchUrl, wikiSummaryUrl, pickEntity, knowledgeFromSummary } from '../../public/js/shared/knowledge.js';

export { matchesEntity } from '../../public/js/shared/knowledge.js';

const lang = () => config.region.split('-')[1] || 'en';
const opts = { headers: { 'User-Agent': BOT_UA }, timeout: 4000 };

export async function getKnowledge(q) {
  const l = lang();
  const hit = pickEntity(q, await fetchJSON(wikiSearchUrl(q, l), opts));
  if (!hit) return null;
  return knowledgeFromSummary(await fetchJSON(wikiSummaryUrl(hit.title, l), opts), l);
}
