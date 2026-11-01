// Company research without a vendor's built-in search: a few searches with a search API (Brave or Tavily),
// the company's own pages read directly, and the results handed to whatever model writes the answer.
// The number of searches and the amount of text are fixed here, so the cost per run is predictable.
//
// SEARCH_PROVIDER: "brave" | "tavily" (SEARCH_API_KEY) | "anthropic" (the model's built-in web search; only
// with an Anthropic model). Unset: "anthropic" when the research model is Anthropic, otherwise none.
import { REVIEW_SITES, NO_FETCH } from './config.js';
import { extractJob } from './webpage.js';
import { readPage } from './webread.js';

export function searchProvider(env, modelProvider) {
  const s = env.SEARCH_PROVIDER || (modelProvider === 'anthropic' ? 'anthropic' : '');
  if (s === 'anthropic' && modelProvider !== 'anthropic') return '';
  return ['anthropic', 'brave', 'tavily'].includes(s) ? s : '';
}

const core = (name) => String(name || '').replace(/株式会社|（株）|\(株\)|有限会社|合同会社|（架空）|[\s　]/g, '');
// four searches: who they are, the careers page, direction (plan, top message, results), the last year's news
export function researchQueries(company, position) {
  const n = String(company || '').replace(/（架空）/g, '').trim();
  if (!core(n)) return [];
  const pos = String(position || '').replace(/[（(].*$/, '').slice(0, 30);
  return [
    { q: `${n} 会社概要 事業内容` },
    { q: `${n} 採用 ${pos}`.trim() },
    { q: `${n} 中期経営計画 社長メッセージ 決算` },
    { q: `${n} プレスリリース お知らせ`, recent: true },
  ];
}

const hostOf = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };
const onList = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));
const key = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

// search results → sources: no review sites or job boards, one entry per page, the company's own site first
export function pickSources(groups, company, hosts = [], max = 10) {
  const name = core(company);
  const seen = new Set(); const all = [];
  groups.forEach((g, gi) => g.forEach((x, i) => {
    const host = hostOf(x.url);
    if (!host || onList(host, REVIEW_SITES) || onList(host, NO_FETCH) || seen.has(key(x.url))) return;
    seen.add(key(x.url)); all.push({ ...x, host, rank: gi * 100 + i });
  }));
  // the official site: a page the user pointed at, else the first "who they are" result that names the company
  const given = hosts.map((h) => String(h).toLowerCase().replace(/^www\./, ''));
  const OWN = /会社概要|会社案内|企業情報|企業概要|公式|コーポレート|corporate|company|about|profile|outline/i;
  const first = all.find((x) => x.rank < 100 && name && core(x.title).includes(name.slice(0, 6)) && (OWN.test(x.title) || OWN.test(new URL(x.url).pathname)));
  const official = new Set([...given, ...(first ? [first.host] : [])]);
  const own = (x) => [...official].some((h) => x.host === h || x.host.endsWith('.' + h) || h.endsWith('.' + x.host));
  all.sort((a, b) => (own(b) - own(a)) || (a.rank - b.rank));
  return all.slice(0, max).map((x, i) => ({ id: 'S' + (i + 1), url: x.url, title: String(x.title || '').slice(0, 120), date: x.date || '', text: String(x.snippet || '').slice(0, 400), official: own(x) }));
}

async function brave(env, { q, recent }) {
  const u = new URL('https://api.search.brave.com/res/v1/web/search');
  u.searchParams.set('q', q); u.searchParams.set('count', '8'); u.searchParams.set('country', 'JP');
  if (recent) u.searchParams.set('freshness', 'py');
  const r = await fetch(u, { headers: { accept: 'application/json', 'x-subscription-token': env.SEARCH_API_KEY } });
  if (!r.ok) throw new Error('brave ' + r.status);
  const j = await r.json();
  return ((j.web && j.web.results) || []).map((x) => ({ url: x.url, title: x.title, snippet: String(x.description || '').replace(/<[^>]+>/g, ''), date: ymd(x.page_age || x.age) }));
}
async function tavily(env, { q, recent }) {
  const r = await fetch('https://api.tavily.com/search', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.SEARCH_API_KEY },
    body: JSON.stringify({ query: q, max_results: 8, search_depth: 'basic', ...(recent ? { time_range: 'year' } : {}) }),
  });
  if (!r.ok) throw new Error('tavily ' + r.status);
  const j = await r.json();
  return (j.results || []).map((x) => ({ url: x.url, title: x.title, snippet: String(x.content || ''), date: ymd(x.published_date) }));
}
const ymd = (s) => { const m = /^(\d{4})-(\d{2})/.exec(String(s || '')); if (m) return m[1] + '-' + m[2]; const t = Date.parse(String(s || '')); return Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(0, 7) : ''; };

// sources for the research prompt: the searches, then the company's own pages read (up to 3, robots.txt
// respected) so the facts come from the page and not only from a search snippet
export async function collectSources(env, c, provider) {
  const company = (c.analysis && c.analysis.company) || c.name;
  const queries = researchQueries(company, c.analysis && c.analysis.position);
  if (!queries.length) return { sources: [], searches: 0 };
  const run = provider === 'tavily' ? tavily : brave;
  const groups = await Promise.all(queries.map((q) => run(env, q).catch((e) => { console.error('search', String(e.message || e)); return []; })));
  const sources = pickSources(groups, company, c.hosts || []);
  const own = sources.filter((s) => s.official).slice(0, 3);
  const pages = await Promise.all(own.map((s) => readPage(s.url, { ms: 6000, limit: 1024 * 1024 }).catch(() => ({ error: 'unreachable' }))));
  pages.forEach((p, i) => { if (p.html) { const t = extractJob(p.html).text.replace(/\n{2,}/g, '\n').slice(0, 2000); if (t.length > 200) own[i].text = (own[i].text + '\n' + t).slice(0, 2400); } });
  return { sources, searches: queries.length };
}
