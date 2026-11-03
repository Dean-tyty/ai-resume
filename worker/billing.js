// Payments with Stripe Checkout (the company's Stripe account; this product's own Product, Prices and
// webhook). Packs and prices: config.js PACKS; the Stripe Price ids: secrets STRIPE_PRICE_P1, _P5, _P10, _P20.
//
//   POST /api/checkout {pack, lang}  -> {url} of a Checkout page; Stripe sends the user back to /?paid=<session> (/en/, /zh/ by lang)
//   POST /api/checkout/confirm {session}  the return page asks at once (the webhook may come a little later)
//   POST /api/stripe                 the webhook (checkout.session.completed / async_payment_succeeded)
//
// A pack is added once per Checkout Session whichever of the two arrives first (db.js creditPurchase).
import { PACKS, UPGRADE_DAYS } from './config.js';
import { account, creditPurchase, credits, recentPurchases } from './db.js';
import { body, fail, json, same, readText } from './util.js';
import { notify } from './notify.js';
import { track } from './stats.js';

async function stripe(env, method, path, params) {
  const r = await fetch('https://api.stripe.com/v1/' + path, {
    method,
    headers: { authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, ...(params ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: params ? new URLSearchParams(params).toString() : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('stripe ' + r.status + ' ' + ((j.error && j.error.message) || ''));
  return j;
}

const yen = (n) => Number(n).toLocaleString('ja-JP') + '円';

// After buying a small pack, a bigger one within UPGRADE_DAYS costs only the difference: what was bought in that
// time counts towards it. { add (credits), amount (yen) } or null when it is not a step up.
export function upgradeOffer(recent, pack) {
  const t = PACKS[pack];
  if (!t || !recent || recent.credits <= 0 || t.credits <= recent.credits || t.price <= recent.amount) return null;
  return { add: t.credits - recent.credits, amount: t.price - recent.amount };
}

export async function checkout(request, env, auth) {
  const b = await body(request, 1024);
  const pack = b && PACKS[b.pack] ? b.pack : '';
  if (!pack) return fail(400, 'pack');
  const offer = b.upgrade ? upgradeOffer(await recentPurchases(env, auth.id, UPGRADE_DAYS), pack) : null;
  if (b.upgrade && !offer) return fail(400, 'upgrade');
  // back to the page in the user's language: / or /en/ or /zh/
  const lang = ['en', 'zh'].includes(b.lang) ? b.lang : 'ja';
  const origin = new URL(request.url).origin; const home = origin + (lang === 'ja' ? '/' : '/' + lang + '/');
  if (env.STRIPE_MOCK === '1' && auth.dev) return json({ url: origin + '/api/dev/pay?pack=' + pack + '&lang=' + lang + (offer ? '&upgrade=1' : '') });
  const price = env['STRIPE_PRICE_' + pack.toUpperCase()];
  if (!env.STRIPE_SECRET_KEY || !price) return fail(503, 'not_configured');
  const { user } = await account(env, auth);
  const params = {
    mode: 'payment', locale: lang,
    ...(offer ? {
      'line_items[0][price_data][currency]': 'jpy', 'line_items[0][price_data][unit_amount]': String(offer.amount),
      'line_items[0][price_data][product_data][name]': `職務経歴書AI ${PACKS[pack].label}への切り替え（${offer.add}社分を追加）`,
      'metadata[upgrade]': '1', 'metadata[add]': String(offer.add), 'metadata[amount]': String(offer.amount),
    } : { 'line_items[0][price]': price }),
    'line_items[0][quantity]': '1',
    success_url: home + '?paid={CHECKOUT_SESSION_ID}', cancel_url: home + '?paid=cancel',
    client_reference_id: auth.id, 'metadata[product]': 'resume', 'metadata[user]': auth.id, 'metadata[pack]': pack,
    'payment_intent_data[metadata][product]': 'resume', 'payment_intent_data[metadata][user]': auth.id, 'payment_intent_data[metadata][pack]': pack,
  };
  if (user.email) params.customer_email = user.email;
  if (env.STRIPE_INVOICE === '1') params['invoice_creation[enabled]'] = 'true';   // a receipt-style invoice PDF (Stripe charges for it)
  try {
    const s = await stripe(env, 'POST', 'checkout/sessions', params);
    return json({ url: s.url });
  } catch (e) {
    console.error('checkout', String(e.message || e));
    return fail(502, 'pay_error');
  }
}

// a paid Checkout Session of this product: the account gets the pack (other products on the same Stripe
// account send their sessions to this webhook too; those are left alone)
async function apply(env, s, request, ctx) {
  const m = s.metadata || {};
  if (m.product !== 'resume') return { ok: false, other: true };
  const user = m.user || s.client_reference_id;
  const pack = m.pack;
  if (s.payment_status !== 'paid' || !user || !PACKS[pack]) return { ok: false };
  // a switch to a bigger pack: the difference, for the credits it adds (both set by checkout above)
  const up = m.upgrade === '1';
  const add = up ? Number(m.add) : PACKS[pack].credits; const due = up ? Number(m.amount) : PACKS[pack].price;
  if (up && !(add > 0 && add < PACKS[pack].credits && due > 0 && due < PACKS[pack].price)) { ctx.waitUntil(notify(env, `差額購入の内容が不正なため、利用枠を追加していません（Checkout Session ${s.id}）。`)); return { ok: false }; }
  if (s.currency !== 'jpy' || s.amount_total !== due) {
    ctx.waitUntil(notify(env, `支払い額が想定と違うため、利用枠を追加していません（${pack}${up ? '（差額）' : ''}：${s.amount_total} ${s.currency}、想定 ${due} jpy）。Stripe の Price と worker/config.js の PACKS を確認してください。Checkout Session ${s.id}`));
    return { ok: false };
  }
  const r = await creditPurchase(env, { session: s.id, user, pack: up ? pack + '+' : pack, credits: add, amount: s.amount_total || 0 });
  if (r.added) {
    const who = await env.DB.prepare('SELECT src, lang FROM users WHERE id = ?').bind(user).first().catch(() => null);
    track(env, 'buy', request, who);
    ctx.waitUntil(notify(env, `ご購入：${PACKS[pack].label}${up ? `への切り替え（差額・${add}社分）` : ''}（${yen(s.amount_total || 0)}）`));
  } else if (!r.ok) {
    ctx.waitUntil(notify(env, `支払いを受けましたが、利用枠を追加できませんでした（アカウントが見つかりません）。Stripe の Checkout Session ${s.id} を確認し、返金などを対応してください。`));
  }
  return r;
}

export async function confirm(request, env, ctx, auth) {
  const b = await body(request, 1024);
  const id = b && typeof b.session === 'string' && /^cs_[A-Za-z0-9_]{10,200}$/.test(b.session) ? b.session : '';
  if (!id || !env.STRIPE_SECRET_KEY) return fail(400, 'session');
  try {
    const s = await stripe(env, 'GET', 'checkout/sessions/' + encodeURIComponent(id));
    const owner = (s.metadata && s.metadata.user) || s.client_reference_id;
    if (owner !== auth.id || (s.metadata || {}).product !== 'resume') return fail(403, 'session');
    const r = await apply(env, s, request, ctx);
    return json({ paid: s.payment_status === 'paid', ok: r.ok, credits: await credits(env, auth.id) });
  } catch (e) {
    console.error('confirm', String(e.message || e));
    return fail(502, 'pay_error');
  }
}

// Stripe-Signature: t=<time>,v1=<HMAC-SHA256 of "<time>.<body>" with the endpoint's signing secret>
export async function verifyStripe(payload, header, secret, now = Date.now() / 1000) {
  const parts = Object.create(null); const v1 = [];
  for (const kv of String(header || '').split(',')) { const [k, v] = kv.split('='); if (k === 'v1') v1.push(v); else parts[k] = v; }
  const t = Number(parts.t);
  if (!t || !v1.length || Math.abs(now - t) > 300) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(t + '.' + payload)));
  const hex = [...mac].map((x) => x.toString(16).padStart(2, '0')).join('');
  return v1.some((s) => same(s, hex));
}

export async function webhook(request, env, ctx) {
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('not configured', { status: 503 });
  const payload = await readText(request, 256 * 1024);
  if (payload === null) return new Response('too large', { status: 413 });
  if (!(await verifyStripe(payload, request.headers.get('stripe-signature'), env.STRIPE_WEBHOOK_SECRET))) return new Response('bad signature', { status: 400 });
  let ev; try { ev = JSON.parse(payload); } catch { return new Response('bad json', { status: 400 }); }
  const s = ev.data && ev.data.object;
  if ((ev.type === 'checkout.session.completed' || ev.type === 'checkout.session.async_payment_succeeded') && s) await apply(env, s, request, ctx);
  else if (ev.type === 'checkout.session.async_payment_failed') ctx.waitUntil(notify(env, 'コンビニ払いなどの支払いが期限切れ・失敗になりました（利用枠は追加していません）。'));
  else if (ev.type === 'charge.refunded') ctx.waitUntil(notify(env, '返金がありました。必要なら該当ユーザーの利用枠を減らしてください（D1 の purchases で Checkout Session を確認）。'));
  return new Response('ok');
}

// local development only (STRIPE_MOCK = "1" with DEV_AUTH): the pack is added without a payment
export async function devPay(request, env, ctx) {
  const url = new URL(request.url);
  const pack = url.searchParams.get('pack');
  if (!PACKS[pack]) return new Response('unknown pack', { status: 400 });
  const lang = url.searchParams.get('lang'); const home = ['en', 'zh'].includes(lang) ? '/' + lang + '/' : '/';
  const up = url.searchParams.get('upgrade') === '1';
  return new Response(`<!doctype html><meta charset="utf-8"><title>テスト決済</title><body style="font-family:sans-serif;padding:40px">
<h1>テスト決済（開発用）</h1><p>${PACKS[pack].label}を購入したことにします。</p>
<button id="b">支払う</button> <a href="${home}?paid=cancel">キャンセル</a>
<script>document.getElementById('b').onclick=async()=>{const u=localStorage.getItem('resume-dev-user')||'';const r=await fetch('/api/dev/pay',{method:'POST',headers:{authorization:'Dev '+u,'content-type':'application/json'},body:JSON.stringify({pack:${JSON.stringify(pack)},upgrade:${up}})});const j=await r.json();location.href='${home}?paid='+j.session;};</script>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}
export async function devPayPost(request, env, ctx, auth) {
  const b = await body(request, 1024);
  const pack = b && PACKS[b.pack] ? b.pack : '';
  if (!pack) return fail(400, 'pack');
  await account(env, auth);
  const session = 'cs_test_dev' + crypto.randomUUID().replace(/-/g, '');
  const offer = b.upgrade ? upgradeOffer(await recentPurchases(env, auth.id, UPGRADE_DAYS), pack) : null;
  if (b.upgrade && !offer) return fail(400, 'upgrade');
  const meta = offer ? { upgrade: '1', add: String(offer.add), amount: String(offer.amount) } : {};
  await apply(env, { id: session, payment_status: 'paid', metadata: { product: 'resume', user: auth.id, pack, ...meta }, currency: 'jpy', amount_total: offer ? offer.amount : PACKS[pack].price }, request, ctx);
  return json({ session });
}
