// POST /api/fetch-job {url}: reads a job posting from its page, for users who have bought credits.
// Company career pages and the posting tools they use mostly work; job boards whose terms forbid automated
// reading (worker/config.js NO_FETCH) are refused before anything is fetched, robots.txt is respected, and
// pages drawn by JavaScript return too little text (the user pastes the text then).
// Returns { text, title, company } — the posting as plain text (schema.org JobPosting when the page has one).
import { hasPaid, countUse } from './db.js';
import { body, json, fail } from './util.js';
import MOCK from './mock.json';
import { checkUrl, extractJob } from './webpage.js';
import { readPage } from './webread.js';

export async function fetchJob(request, env, auth) {
  const b = await body(request, 4096);
  const chk = checkUrl(b && b.url);
  if (chk.error) return fail(400, chk.error, chk.host ? { host: chk.host } : {});
  if (!(await hasPaid(env, auth.id))) return fail(403, 'paid_only');
  const use = await countUse(env, auth.id, 'fetch', null);
  if (use.over) return fail(429, 'limit', { scope: use.over });
  const u = chk.url;
  // local development (AI_MOCK): pages on jobs.example.com are the sample posting
  if (env.AI_MOCK === '1' && u.hostname === 'jobs.example.com') return json({ text: MOCK.sampleJob + '\n【応募方法】Webサイトから応募', title: '', company: '株式会社サンプルクラウド（架空）' });
  try {
    const p = await readPage(u.href);
    if (p.error) return fail(p.error === 'url' || p.error === 'site_not_allowed' ? 400 : 422, p.error, p.host ? { host: p.host } : p.status ? { status: p.status } : {});
    const html = p.html;
    const out = extractJob(html);
    if (out.text.replace(/\s+/g, '').length < 200) return fail(422, 'too_little');
    console.log(JSON.stringify({ fetch: u.hostname, chars: out.text.length }));
    return json(out);
  } catch (e) {
    console.error('fetch-job', u.hostname, String(e.message || e));
    return fail(422, 'unreachable');
  }
}
