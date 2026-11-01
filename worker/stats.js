// Steps counted for the weekly report on the website (docs/products.md §5 in the website's repository):
// the shared Analytics Engine dataset flatland_events, blob1 = "resume:<step>", blob2 = "resume".
// blob3 = the page's language (ja / en / zh), blob4 = its path, blob5 = where the first visit came from
// (utm_source, or the referring site's host; "" = direct). Nothing that identifies a person is written (no
// name, email, IP address or user id).
//   counted by the browser (POST /api/event): visit, download
//   counted by the Worker: signup, profile, doc, unlock (a credit used), buy
const FROM_PAGE = new Set(['visit', 'download']);
import { BOT, str, readText } from './util.js';

const LANGS = ['ja', 'en', 'zh'];
const cleanSrc = (v) => String(v || '').toLowerCase().replace(/^www\./, '').replace(/[^a-z0-9._-]/g, '').slice(0, 40);
const cleanPage = (x) => ({ lang: LANGS.includes(x && x.lang) ? x.lang : '', src: cleanSrc(x && x.src) });
// the page and first-visit source the browser sends with its requests (headers x-resume-lang, x-resume-src)
export function pageOf(request) {
  const g = (k) => (request && request.headers && request.headers.get(k)) || '';
  return cleanPage({ lang: g('x-resume-lang'), src: g('x-resume-src') });
}
// who: { lang, src } kept on the account, for steps the browser is not part of (the payment webhook)
export function track(env, step, request, who) {
  if (!env.STATS) return;
  const country = (request && request.cf && request.cf.country) || '';
  const h = pageOf(request); const w = cleanPage(who);
  const lang = h.lang || w.lang || 'ja'; const src = h.src || w.src;
  try {
    env.STATS.writeDataPoint({ indexes: ['resume:' + step], blobs: ['resume:' + step, 'resume', lang, lang === 'ja' ? '/' : '/' + lang + '/', src, String(country).slice(0, 4)], doubles: [1] });
  } catch (e) { console.error('track', step, String(e.message || e)); }
}

export async function beacon(request, env) {
  const done = new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return done;
  if (BOT.test(request.headers.get('user-agent') || '')) return done;
  const raw = await readText(request, 512);
  if (raw === null) return done;
  let d; try { d = JSON.parse(raw); } catch { return done; }
  const e = d && str(d.e, 20);
  if (FROM_PAGE.has(e)) track(env, e, request, d);
  return done;
}
