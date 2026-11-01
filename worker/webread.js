// Reading a web page over the network (job postings, company pages for research): robots.txt respected,
// size and time limited, decoded with the page's character set.
import { checkUrl, robotsAllows } from './webpage.js';

const UA = 'Mozilla/5.0 (compatible; ResumeAI/1.0; +https://resume.flatland.co.jp/)';

export function charsetOf(ct, bytes) {
  // the head read as ASCII (works whatever decoders the runtime has)
  const head = Array.from(bytes.subarray(0, 4096), (x) => (x < 128 ? String.fromCharCode(x) : ' ')).join('');
  const m = /charset=([\w-]+)/i.exec(ct || '') || /<meta[^>]+charset=["']?([\w-]+)/i.exec(head);
  return m ? m[1].toLowerCase() : 'utf-8';
}
export async function get(url, ms, limit) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5', 'accept-language': 'ja,en;q=0.8' }, redirect: 'follow', signal: ctl.signal });
    const reader = r.body ? r.body.getReader() : null; const chunks = []; let n = 0;
    if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.length; if (n > limit) { ctl.abort(); break; } chunks.push(value); }
    const bytes = new Uint8Array(n > limit ? limit : n); let o = 0; for (const c of chunks) { if (o + c.length > bytes.length) { bytes.set(c.subarray(0, bytes.length - o), o); break; } bytes.set(c, o); o += c.length; }
    return { status: r.status, ct: r.headers.get('content-type') || '', bytes, finalUrl: r.url || url };
  } finally { clearTimeout(t); }
}
export const decode = (r) => { try { return new TextDecoder(charsetOf(r.ct, r.bytes)).decode(r.bytes); } catch { return new TextDecoder().decode(r.bytes); } };

// a page as HTML, or { error } (the codes of /api/fetch-job)
export async function readPage(raw, { ms = 10000, limit = 2 * 1024 * 1024 } = {}) {
  const chk = checkUrl(raw); if (chk.error) return { error: chk.error, host: chk.host };
  const u = chk.url;
  const rb = await get(new URL('/robots.txt', u).href, 4000, 256 * 1024).catch(() => null);
  if (rb && rb.status === 200 && !robotsAllows(new TextDecoder().decode(rb.bytes), u.pathname + u.search)) return { error: 'robots' };
  const r = await get(u.href, ms, limit);
  const again = checkUrl(r.finalUrl); if (again.error) return { error: again.error, host: again.host };   // redirected to a site that is not read
  if (r.status === 401 || r.status === 403) return { error: 'login_required' };
  if (r.status >= 400) return { error: 'page_error', status: r.status };
  if (!/html|xml|text\/plain/i.test(r.ct)) return { error: 'not_html' };
  return { html: decode(r), url: r.finalUrl };
}
