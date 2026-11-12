// Small helpers shared by the Worker's modules.
export const NO_STORE = { 'cache-control': 'no-store' };

export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, ...headers },
});
// an error the page shows in Japanese: code is one of the keys of ERRORS in public/app.js
export const fail = (status, code, extra = {}) => json({ error: { code, ...extra } }, status);

// the day and the date in Japan, whatever the server's clock zone
const jst = (t) => new Date(t + 9 * 3600e3);
export const jpDay = (t = Date.now()) => jst(t).toISOString().slice(0, 10);
export const jpDate = (t = Date.now()) => { const d = jst(t); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`; };

// the request body as text, read only up to max bytes (null when larger)
export async function readText(request, max) {
  const len = request.headers.get('content-length');
  if (len && Number(len) > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader(); const parts = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { try { await reader.cancel(); } catch { /* gone */ } return null; }
    parts.push(value);
  }
  const buf = new Uint8Array(size); let o = 0;
  for (const p of parts) { buf.set(p, o); o += p.byteLength; }
  return new TextDecoder().decode(buf);
}

// the request body as JSON, refused (null) when larger than max bytes or not an object
export async function body(request, max) {
  const text = await readText(request, max);
  if (text === null) return null;
  try { const v = JSON.parse(text); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

export const str = (v, n) => (typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, n) : '');
export const sizeOf = (v) => { try { return JSON.stringify(v).length; } catch { return Infinity; } };

export async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// constant-time comparison of two strings
export function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

export const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|monitor/i;

// the same company? Names compared without legal forms, brackets, spaces and case; one may contain the other
// (「サンプルクラウド」 and 「株式会社サンプルクラウド（架空）」 match). Unknown on either side counts as the same.
// A posting whose company is not named yet (社名非公開, through a headhunter) counts as unknown, so the credit
// follows it when the name comes out.
export const normCo = (s) => /^社名非公開/.test(String(s || '').trim()) ? '' : String(s || '').normalize('NFKC').toLowerCase()
  .replace(/[(（][^)）]*[)）]/g, '').replace(/株式会社|有限会社|合同会社|一般社団法人|㈱|inc\b\.?|co\.,?|ltd\.?|corporation|corp\.?|[\s・,.、。\-]/g, '');
export function sameCompany(a, b) { a = normCo(a); b = normCo(b); return !a || !b || a.includes(b) || b.includes(a); }
