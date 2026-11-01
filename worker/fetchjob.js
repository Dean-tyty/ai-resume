// POST /api/fetch-job {url}: reads a job posting from its page, for users who have bought credits.
// Company career pages and the posting tools they use mostly work; job boards whose terms forbid automated
// reading (worker/config.js NO_FETCH) are refused before anything is fetched, robots.txt is respected, and
// pages drawn by JavaScript return too little text (the user pastes the text then).
// Returns { text, title, company } — the posting as plain text (schema.org JobPosting when the page has one).
import { hasPaid, countUse } from './db.js';
import { body, json, fail } from './util.js';
import MOCK from './mock.json';
import { checkUrl, robotsAllows, extractJob } from './webpage.js';

const UA = 'Mozilla/5.0 (compatible; ResumeAI/1.0; +https://resume.flatland.co.jp/)';
const MAX_BYTES = 2 * 1024 * 1024;

function charsetOf(ct, bytes) {
  // the head read as ASCII (works whatever decoders the runtime has)
  const head = Array.from(bytes.subarray(0, 4096), (x) => (x < 128 ? String.fromCharCode(x) : ' ')).join('');
  const m = /charset=([\w-]+)/i.exec(ct || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : 'utf-8';
}
async function get(url, ms, limit) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'ja,en;q=0.8' }, redirect: 'follow', signal: ctl.signal });
    const reader = r.body ? r.body.getReader() : null; const chunks = []; let n = 0;
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > limit) { ctl.abort(); break; } chunks.push(value); }
    const bytes = new Uint8Array(n > limit ? limit : n); let o = 0; for (const c of chunks) { if (o + c.length > bytes.length) { bytes.set(c.subarray(0, bytes.length - o), o); break; } bytes.set(c, o); o += c.length; }
    return { status: r.status, ct: r.headers.get('content-type') || '', bytes, finalUrl: r.url || url };
  } finally { clearTimeout(t); }
}

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
    const rb = await get(new URL('/robots.txt', u).href, 4000, 256 * 1024).catch(() => null);
    if (rb && rb.status === 200 && !robotsAllows(new TextDecoder().decode(rb.bytes), u.pathname + u.search)) return fail(422, 'robots');
    const r = await get(u.href, 10000, MAX_BYTES);
    // a redirect to a site that is not read
    const again = checkUrl(r.finalUrl); if (again.error) return fail(400, again.error, again.host ? { host: again.host } : {});
    if (r.status === 401 || r.status === 403) return fail(422, 'login_required');
    if (r.status >= 400) return fail(422, 'page_error', { status: r.status });
    if (!/html|xml|text\/plain/i.test(r.ct)) return fail(422, 'not_html');
    let html;
    try { html = new TextDecoder(charsetOf(r.ct, r.bytes)).decode(r.bytes); } catch { html = new TextDecoder().decode(r.bytes); }
    const out = extractJob(html);
    if (out.text.replace(/\s+/g, '').length < 200) return fail(422, 'too_little');
    console.log(JSON.stringify({ fetch: u.hostname, chars: out.text.length }));
    return json(out);
  } catch (e) {
    console.error('fetch-job', u.hostname, String(e.message || e));
    return fail(422, 'unreachable');
  }
}
