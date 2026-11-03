// 職務経歴書AI (resume.flatland.co.jp): the page (public/, served as static files) and its API.
//
//   GET    /config.js              settings the page needs (Clerk's publishable key, packs, consent version)
//   GET    /api/me                 the account: credits, 応募先 that have a credit (slots) or are previews, consent
//   POST   /api/unlock {id}        use a credit for a 応募先 whose documents are about to leave the page
//   POST   /api/consent {version}  agreement to the terms and to sending data to the AI service
//   GET    /api/workspace          the saved data          PUT /api/workspace {data, base}  save it
//   POST   /api/ai                 one AI step (ai.js)
//   POST   /api/fetch-job {url}    a job posting read from its page, for users who have bought credits (fetchjob.js)
//   POST   /api/checkout, /api/checkout/confirm, /api/stripe   payments (billing.js)
//   DELETE /api/account            delete the account and everything saved
//   POST   /api/event              steps counted for the weekly report (stats.js)
// A daily cron deletes data not used for RETENTION_DAYS.
import { PRODUCT, PACKS, FREE_CREDITS, CONSENT_VERSION, MAX_WORKSPACE, RETENTION_DAYS, RESEARCH_PER_COMPANY, PREVIEW, FREE_LIFE, UPGRADE_DAYS } from './config.js';
import { authenticate, clerkDelete } from './auth.js';
import { account, slotIds, getWorkspace, putWorkspace, deleteUser, hasPaid, researchCounts, freeLeft, unlockSlot, credits, recentPurchases } from './db.js';
import { fetchJob } from './fetchjob.js';
import { handleAI } from './ai.js';
import { checkout, confirm, webhook, devPay, devPayPost } from './billing.js';
import { beacon, track, pageOf } from './stats.js';
import { notify } from './notify.js';
import { body, json, fail, NO_STORE } from './util.js';

function configJS(env) {
  const cfg = {
    clerkKey: env.CLERK_PUBLISHABLE_KEY || '', dev: env.DEV_AUTH === '1',
    // only the packs that can be paid for (their Stripe Price is set; all of them with the test payment)
    packs: Object.entries(PACKS).filter(([id]) => env.STRIPE_MOCK === '1' || env['STRIPE_PRICE_' + id.toUpperCase()]).map(([id, p]) => ({ id, ...p })), free: FREE_CREDITS, consent: CONSENT_VERSION,
    terms: PRODUCT.terms, privacy: PRODUCT.privacy, retention: RETENTION_DAYS, research: RESEARCH_PER_COMPANY,
    preview: PREVIEW, freeLife: FREE_LIFE, upgradeDays: UPGRADE_DAYS,
  };
  return new Response('window.APP_CONFIG = ' + JSON.stringify(cfg) + ';\n', { headers: { 'content-type': 'text/javascript; charset=utf-8', ...NO_STORE } });
}

async function me(request, env, auth) {
  const { user, created } = await account(env, auth);
  if (created) track(env, 'signup', request);
  // paid: has bought credits (URL reading and company research); research: researches used per 応募先;
  // free: what is left of the free trial (accounts that have never bought)
  const [slots, paid, research] = await Promise.all([slotIds(env, auth.id), hasPaid(env, auth.id), researchCounts(env, auth.id)]);
  const free = paid ? null : await freeLeft(env, auth.id);
  // bought in the last UPGRADE_DAYS days: a bigger pack costs only the difference (billing.js upgradeOffer)
  const recent = paid ? await recentPurchases(env, auth.id, UPGRADE_DAYS) : null;
  return json({ id: auth.id, credits: user.credits, slots: slots.open, previews: slots.preview, free, paid, recent, research, consent: user.consent === CONSENT_VERSION, created });
}

// the documents of a 応募先 are about to be saved or copied: its credit is used now (once)
async function unlock(request, env, auth) {
  const b = await body(request, 1024);
  const id = b && typeof b.id === 'string' && /^[a-z0-9]{4,16}$/.test(b.id) ? b.id : '';
  if (!id) return fail(400, 'company');
  await account(env, auth);
  const u = await unlockSlot(env, auth.id, id);
  const n = await credits(env, auth.id);
  if (!u.ok) return fail(402, 'no_credit', { credits: n });
  if (u.used) track(env, 'unlock', request);
  return json({ ok: true, used: u.used, credits: n });
}

async function consent(request, env, auth) {
  const b = await body(request, 512);
  if (!b || b.version !== CONSENT_VERSION) return fail(400, 'consent_version');
  await account(env, auth);
  await env.DB.prepare('UPDATE users SET consent = ?, consented_at = ? WHERE id = ?').bind(CONSENT_VERSION, Date.now(), auth.id).run();
  return json({ ok: true });
}

async function workspace(request, env, auth) {
  if (request.method === 'GET') {
    const w = await getWorkspace(env, auth.id);
    return json(w ? { data: JSON.parse(w.data), version: w.version, updated: w.updated_at } : { data: null, version: 0 });
  }
  const b = await body(request, MAX_WORKSPACE + 1024);
  if (!b) return fail(413, 'too_big');
  if (!b.data || typeof b.data !== 'object' || !Array.isArray(b.data.companies)) return fail(400, 'data');
  let data;
  try { data = JSON.stringify(b.data); } catch { return fail(400, 'data'); }   // e.g. nested too deeply
  if (new TextEncoder().encode(data).length > MAX_WORKSPACE) return fail(413, 'too_big');
  await account(env, auth);
  const v = await putWorkspace(env, auth.id, data, Number(b.base) || 0);
  if (v === null) {
    const w = await getWorkspace(env, auth.id);
    return json({ error: { code: 'conflict' }, version: w ? w.version : 0, updated: w ? w.updated_at : 0 }, 409);
  }
  return json({ version: v });
}

async function deleteAccount(env, ctx, auth) {
  await deleteUser(env, auth.id);
  // the data here is gone; if Clerk's copy (email, name) could not be deleted, someone deletes it by hand
  if (!auth.dev) await clerkDelete(env, auth.id).catch((e) => {
    console.error('clerk delete', String(e));
    ctx.waitUntil(notify(env, `退会したユーザーのログイン情報を Clerk から削除できませんでした。Clerk の管理画面でユーザー ${auth.id} を削除してください（${String(e.message || e)}）。`));
  });
  return json({ ok: true });
}

// data unused for RETENTION_DAYS: the saved data goes; an account with no credits left goes entirely
// (Clerk's copy too); one with unused credits keeps only the id and the credits
async function cleanup(env) {
  const before = Date.now() - RETENTION_DAYS * 864e5;
  const old = (await env.DB.prepare('SELECT id, credits FROM users WHERE seen_at < ? LIMIT 200').bind(before).all()).results || [];
  const clerkFailed = [];
  for (const u of old) {
    if (u.credits > 0) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM workspace WHERE user_id = ?').bind(u.id),
        env.DB.prepare('DELETE FROM slots WHERE user_id = ?').bind(u.id),
        env.DB.prepare("UPDATE users SET email = '', consent = '', seen_at = ? WHERE id = ?").bind(Date.now() - (RETENTION_DAYS - 30) * 864e5, u.id),
      ]);
    } else {
      await deleteUser(env, u.id);
      if (!u.id.startsWith('dev_')) await clerkDelete(env, u.id).catch(() => clerkFailed.push(u.id));
    }
  }
  if (clerkFailed.length) await notify(env, `保存期間を過ぎたユーザーのログイン情報を Clerk から削除できませんでした（${clerkFailed.length}件）。Clerk の管理画面で削除してください：${clerkFailed.slice(0, 20).join(', ')}`);
  const day = new Date(Date.now() - 40 * 864e5 + 9 * 3600e3).toISOString().slice(0, 10);
  await env.DB.prepare("DELETE FROM usage WHERE day < ? AND day <> 'life'").bind(day).run();   // 'life': the free trial's counts
  if (old.length) console.log('cleanup', old.length);
}

const API_AUTH = {
  'GET /api/me': (r, env, ctx, a) => me(r, env, a),
  'POST /api/consent': (r, env, ctx, a) => consent(r, env, a),
  'GET /api/workspace': (r, env, ctx, a) => workspace(r, env, a),
  'PUT /api/workspace': (r, env, ctx, a) => workspace(r, env, a),
  'POST /api/ai': (r, env, ctx, a) => handleAI(r, env, ctx, a),
  'POST /api/unlock': (r, env, ctx, a) => unlock(r, env, a),
  'POST /api/fetch-job': (r, env, ctx, a) => fetchJob(r, env, a),
  'POST /api/checkout': (r, env, ctx, a) => checkout(r, env, a),
  'POST /api/checkout/confirm': (r, env, ctx, a) => confirm(r, env, ctx, a),
  'DELETE /api/account': (r, env, ctx, a) => deleteAccount(env, ctx, a),
  'POST /api/dev/pay': (r, env, ctx, a) => (env.STRIPE_MOCK === '1' && a.dev ? devPayPost(r, env, ctx, a) : fail(404, 'not_found')),
};

async function api(request, env, ctx) {
  const url = new URL(request.url);
  const key = request.method + ' ' + url.pathname;
  if (key === 'POST /api/stripe') return webhook(request, env, ctx);
  if (key === 'POST /api/event') return beacon(request, env);
  if (key === 'GET /api/dev/pay' && env.STRIPE_MOCK === '1' && env.DEV_AUTH === '1') return devPay(request, env, ctx);
  const h = API_AUTH[key];
  if (!h) return fail(404, 'not_found');
  // the page's own requests only (a browser sends Origin on cross-site POST/PUT/DELETE)
  const origin = request.headers.get('origin');
  if (request.method !== 'GET' && origin && origin !== url.origin) return fail(403, 'origin');
  const auth = await authenticate(request, env);
  if (!auth) return fail(401, 'login');
  auth.meta = pageOf(request);   // kept on the account when it is made (the weekly report: which page and source sell)
  return h(request, env, ctx, auth);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/config.js') return configJS(env);
      if (url.pathname.startsWith('/api/')) return await api(request, env, ctx);
      return env.ASSETS.fetch(request);
    } catch (e) {
      console.error('fetch', url.pathname, String((e && e.stack) || e));
      ctx.waitUntil(notify(env, `サーバーでエラーが出ました（${request.method} ${url.pathname}）：${String((e && e.message) || e).slice(0, 200)}`));
      return fail(500, 'server');
    }
  },
  async scheduled(event, env, ctx) {
    try { await cleanup(env); } catch (e) { console.error('cleanup', String(e)); ctx.waitUntil(notify(env, '保存期間を過ぎたデータの削除に失敗しました：' + String(e.message || e).slice(0, 200))); }
  },
};
