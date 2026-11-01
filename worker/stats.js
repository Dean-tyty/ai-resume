// Steps counted for the weekly report on the website (docs/products.md §5 in the website's repository):
// the shared Analytics Engine dataset flatland_events, blob1 = "resume:<step>", blob2 = "resume".
// Nothing that identifies a person is written (no name, email, IP address or user id).
//   counted by the browser (POST /api/event): visit, download
//   counted by the Worker: signup, profile, doc, buy
const FROM_PAGE = new Set(['visit', 'download']);
import { BOT, str, readText } from './util.js';

export function track(env, step, request) {
  if (!env.STATS) return;
  const country = (request && request.cf && request.cf.country) || '';
  try {
    env.STATS.writeDataPoint({ indexes: ['resume:' + step], blobs: ['resume:' + step, 'resume', 'ja', '/', '', String(country).slice(0, 4)], doubles: [1] });
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
  if (FROM_PAGE.has(e)) track(env, e, request);
  return done;
}
