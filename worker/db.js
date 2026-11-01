// The D1 database (binding DB, tables in schema.sql): accounts, credits, saved data, daily usage.
import { FREE_CREDITS, LIMITS, PREVIEW, FREE_LIFE } from './config.js';
import { jpDay, sha256 } from './util.js';
import { clerkEmail } from './auth.js';

// Gmail ignores dots and "+tags"; other providers at least ignore "+tags" and case
function normEmail(e) {
  let [local, domain] = String(e || '').trim().toLowerCase().split('@');
  if (!local || !domain) return '';
  local = local.split('+')[0];
  if (domain === 'gmail.com' || domain === 'googlemail.com') { local = local.replace(/\./g, ''); domain = 'gmail.com'; }
  return local + '@' + domain;
}

// the account, created on first sight with the free credit — once per email address, so deleting an
// account and signing up again does not give a second free 応募先
// whether this address may have the free credit (first time it is seen)
async function firstFree(env, email) {
  const key = normEmail(email);
  if (!key) return false;
  const r = await env.DB.prepare('INSERT OR IGNORE INTO freebies (hash, created_at) VALUES (?, ?)').bind(await sha256('resume:' + (env.HASH_SALT || '') + ':' + key), Date.now()).run();
  return r.meta.changes > 0;
}

// the account, created on first sight. The free credit is given once per email address (deleting an account
// and signing up again gives none); when the address cannot be read yet, it is decided on a later visit.
export async function account(env, auth, { create = true } = {}) {
  const now = Date.now();
  let u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(auth.id).first();
  if (u) {
    if (now - u.seen_at > 3600e3 || u.free_pending) {
      await env.DB.prepare('UPDATE users SET seen_at = ? WHERE id = ?').bind(now, auth.id).run();
      if (u.free_pending) {
        const email = await clerkEmail(env, auth.id).catch(() => '');
        if (email) {
          const give = await firstFree(env, email);
          await env.DB.prepare('UPDATE users SET email = ?, free_pending = 0, credits = credits + ? WHERE id = ? AND free_pending = 1').bind(email, give ? FREE_CREDITS : 0, auth.id).run();
          if (!give) await noFreePreviews(env, auth.id);
          u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(auth.id).first();
        }
      }
    }
    return { user: u, created: false };
  }
  if (!create) return { user: null, created: false };
  let credits = FREE_CREDITS; let pending = 0; let email = '';
  if (!auth.dev) {
    email = await clerkEmail(env, auth.id).catch(() => '');
    if (email) credits = (await firstFree(env, email)) ? FREE_CREDITS : 0;
    else { credits = 0; pending = 1; }
  }
  const m = auth.meta || {};
  await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, credits, free_pending, src, lang, created_at, seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(auth.id, email, credits, pending, m.src || '', m.lang || '', now, now).run();
  // an address that has had the free 応募先 before: no free previews either
  if (!credits && !pending && !auth.dev) await noFreePreviews(env, auth.id);
  u = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(auth.id).first();
  return { user: u, created: true };
}

const noFreePreviews = (env, id) => env.DB.prepare(`INSERT INTO usage (user_id, day, kind, n) VALUES (?, 'life', 'previews', ?)
  ON CONFLICT (user_id, day, kind) DO UPDATE SET n = MAX(n, excluded.n)`).bind(id, PREVIEW.free).run();

// has bought credits at least once (the features that cost web searches are for them)
export async function hasPaid(env, id) {
  return !!(await env.DB.prepare('SELECT 1 AS x FROM purchases WHERE user_id = ? AND credited = 1 LIMIT 1').bind(id).first());
}
// one more company research for a 応募先 that holds a credit; false when it has had max already
export async function takeResearch(env, id, cid, max) {
  return !!(await env.DB.prepare('UPDATE slots SET research = research + 1 WHERE user_id = ? AND company_id = ? AND research < ? RETURNING research').bind(id, cid, max).first());
}
export async function giveBackResearch(env, id, cid) {
  await env.DB.prepare('UPDATE slots SET research = MAX(research - 1, 0) WHERE user_id = ? AND company_id = ?').bind(id, cid).run();
}
export async function researchCounts(env, id) {
  const r = await env.DB.prepare('SELECT company_id, research FROM slots WHERE user_id = ? AND research > 0').bind(id).all();
  return Object.fromEntries((r.results || []).map((x) => [x.company_id, x.research]));
}

// the account's 応募先 that use AI: open (a credit is used) and preview (not yet)
export async function slotIds(env, id) {
  const r = await env.DB.prepare('SELECT company_id, unlocked FROM slots WHERE user_id = ?').bind(id).all();
  const rows = r.results || [];
  return { open: rows.filter((x) => x.unlocked).map((x) => x.company_id), preview: rows.filter((x) => !x.unlocked).map((x) => x.company_id) };
}
// what is left of the free trial for an account that has never bought
export async function freeLeft(env, id) {
  const r = await env.DB.prepare(`SELECT kind, n FROM usage WHERE user_id = ? AND day = 'life'`).bind(id).all();
  const used = Object.fromEntries((r.results || []).map((x) => [x.kind, x.n]));
  return { previews: Math.max(0, PREVIEW.free - (used.previews || 0)), ...Object.fromEntries(Object.entries(FREE_LIFE).map(([k, v]) => [k, Math.max(0, v - (used[k] || 0))])) };
}

const SLOT_COLS = 'n, label, unlocked';
const slotOf = (x, state) => ({ state, n: x.n, label: x.label, unlocked: !!x.unlocked });
// Start an AI request for a 応募先 and count it as running. mode 'unlock': the 応募先 needs a credit (one is
// used now if it has none); 'preview': it may run without one (a preview, within PREVIEW). paid: the account
// has bought before. { state: 'have'|'new'|'none', n (successes so far), label (the company it is for),
// unlocked, why ('preview' when no more previews) }. Every claim other than 'none' must be ended with finishSlot.
export async function claimSlot(env, id, cid, mode, paid) {
  const have = await env.DB.prepare(`UPDATE slots SET busy = busy + 1 WHERE user_id = ? AND company_id = ? RETURNING ${SLOT_COLS}`).bind(id, cid).first();
  if (have) return slotOf(have, 'have');
  if (mode === 'unlock') return creditSlot(env, id, cid);
  const claim = crypto.randomUUID(); const now = Date.now();
  const undo = () => env.DB.prepare(`UPDATE usage SET n = MAX(n - 1, 0) WHERE user_id = ? AND day = 'life' AND kind = 'previews'`).bind(id).run();
  if (!paid) {
    // one more preview in all; taken back when it is over the free number
    const r = await bump(env, id, 'life', 'previews').first();
    if (!r || r.n > PREVIEW.free) { await undo(); return { state: 'none', why: 'preview' }; }
    await env.DB.prepare(`INSERT OR IGNORE INTO slots (user_id, company_id, claim, unlocked, n, busy, label, created_at) VALUES (?, ?, ?, 0, 0, 1, '', ?)`).bind(id, cid, claim, now).run();
  } else {
    // buyers: as many locked 応募先 at once as credits left + PREVIEW.open
    await env.DB.prepare(`INSERT INTO slots (user_id, company_id, claim, unlocked, n, busy, label, created_at)
      SELECT ?1, ?2, ?3, 0, 0, 1, '', ?4 WHERE (SELECT COUNT(*) FROM slots WHERE user_id = ?1 AND unlocked = 0) < (SELECT credits FROM users WHERE id = ?1) + ?5
      AND NOT EXISTS (SELECT 1 FROM slots WHERE user_id = ?1 AND company_id = ?2)`).bind(id, cid, claim, now, PREVIEW.open).run();
  }
  const s = await env.DB.prepare('SELECT claim FROM slots WHERE user_id = ? AND company_id = ?').bind(id, cid).first();
  if (s && s.claim === claim) return { state: 'new', n: 0, label: '', unlocked: false };
  if (!paid) await undo();
  // another request added it a moment ago: run as part of that one
  return s ? claimSlot(env, id, cid, mode, paid) : { state: 'none', why: 'preview' };
}
// a 応募先 that has no slot yet, made with a credit
async function creditSlot(env, id, cid) {
  const claim = crypto.randomUUID();
  // one transaction: add the slot only if a credit is left and the slot is not there yet, then take the
  // credit only if the slot just added is this request's
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO slots (user_id, company_id, claim, unlocked, n, busy, label, created_at)
      SELECT ?1, ?2, ?3, 1, 0, 1, '', ?4 WHERE (SELECT credits FROM users WHERE id = ?1) > 0
      AND NOT EXISTS (SELECT 1 FROM slots WHERE user_id = ?1 AND company_id = ?2)`).bind(id, cid, claim, Date.now()),
    env.DB.prepare(`UPDATE users SET credits = credits - 1 WHERE id = ?1
      AND EXISTS (SELECT 1 FROM slots WHERE user_id = ?1 AND company_id = ?2 AND claim = ?3)`).bind(id, cid, claim),
  ]);
  const s = await env.DB.prepare('SELECT claim FROM slots WHERE user_id = ? AND company_id = ?').bind(id, cid).first();
  if (!s) return { state: 'none' };
  if (s.claim === claim) return { state: 'new', n: 0, label: '', unlocked: true };
  return claimSlot(env, id, cid, 'unlock');
}
// Use a credit for a 応募先 (its documents leave the page, or a task that needs one runs). { ok, used: a credit was
// used by this call (false: it had one already) }
export async function unlockSlot(env, id, cid) {
  const s = await env.DB.prepare('SELECT unlocked FROM slots WHERE user_id = ? AND company_id = ?').bind(id, cid).first();
  if (s && s.unlocked) return { ok: true, used: false };
  if (!s) {
    // documents made before previews existed, or brought in from a file
    const r = await creditSlot(env, id, cid);
    if (r.state === 'none') return { ok: false };
    await env.DB.prepare('UPDATE slots SET n = MAX(n, 1), busy = MAX(busy - 1, 0) WHERE user_id = ? AND company_id = ?').bind(id, cid).run();
    return { ok: true, used: r.state === 'new' };
  }
  const t = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`UPDATE slots SET unlocked = 1, claim = ?3 WHERE user_id = ?1 AND company_id = ?2 AND unlocked = 0
      AND (SELECT credits FROM users WHERE id = ?1) > 0`).bind(id, cid, t),
    env.DB.prepare(`UPDATE users SET credits = credits - 1 WHERE id = ?1
      AND EXISTS (SELECT 1 FROM slots WHERE user_id = ?1 AND company_id = ?2 AND claim = ?3)`).bind(id, cid, t),
  ]);
  const a = await env.DB.prepare('SELECT unlocked, claim FROM slots WHERE user_id = ? AND company_id = ?').bind(id, cid).first();
  return a && a.unlocked ? { ok: true, used: a.claim === t } : { ok: false };
}

// An AI request for a 応募先 that already has a slot, counted as running ({state: 'have', …}); null if it has none.
export async function holdSlot(env, id, cid) {
  const have = await env.DB.prepare(`UPDATE slots SET busy = busy + 1 WHERE user_id = ? AND company_id = ? RETURNING ${SLOT_COLS}`).bind(id, cid).first();
  return have ? slotOf(have, 'have') : null;
}

// End an AI request for a 応募先. ok: one more success, and the company's name is kept the first time.
// Failed: when nothing has ever succeeded for the 応募先 and no other request is running, the slot goes, and
// with it the credit (or, for a preview, the count of free previews).
// Returns false when ok but the slot is gone (should not happen: a running request keeps it).
export async function finishSlot(env, id, cid, ok, label) {
  if (ok) {
    const r = await env.DB.prepare(`UPDATE slots SET n = n + 1, busy = MAX(busy - 1, 0), label = CASE WHEN label = '' THEN ?3 ELSE label END
      WHERE user_id = ?1 AND company_id = ?2`).bind(id, cid, String(label || '').slice(0, 120)).run();
    return r.meta.changes > 0;
  }
  const first = 'EXISTS (SELECT 1 FROM slots WHERE user_id = ?1 AND company_id = ?2 AND n = 0 AND busy <= 1 AND unlocked = ';
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET credits = credits + 1 WHERE id = ?1 AND ${first}1)`).bind(id, cid),
    env.DB.prepare(`UPDATE usage SET n = MAX(n - 1, 0) WHERE user_id = ?1 AND day = 'life' AND kind = 'previews' AND ${first}0)`).bind(id, cid),
    env.DB.prepare('DELETE FROM slots WHERE user_id = ? AND company_id = ? AND n = 0 AND busy <= 1').bind(id, cid),
    env.DB.prepare('UPDATE slots SET busy = MAX(busy - 1, 0) WHERE user_id = ? AND company_id = ?').bind(id, cid),
  ]);
  return true;
}

export async function credits(env, id) {
  const u = await env.DB.prepare('SELECT credits FROM users WHERE id = ?').bind(id).first();
  return u ? u.credits : 0;
}

// count one AI request and say which daily limit it goes over, if any. The service-wide count moves only for
// requests within the user's own limits, so one user cannot use up everyone's day.
const bump = (env, u, day, k) => env.DB.prepare(`INSERT INTO usage (user_id, day, kind, n) VALUES (?, ?, ?, 1)
  ON CONFLICT (user_id, day, kind) DO UPDATE SET n = n + 1 RETURNING n`).bind(u, day, k);
// paid false: the account has never bought, and FREE_LIFE limits the task in all (usage day 'life').
export async function countUse(env, id, task, cid, paid = true) {
  const day = jpDay();
  const mine = [['all', LIMITS.day, day], [task, LIMITS[task] || LIMITS.day, day]];
  if (cid) mine.push(['c:' + cid, LIMITS.company, day]);
  if (!paid && FREE_LIFE[task]) mine.push([task, FREE_LIFE[task], 'life']);
  const res = await env.DB.batch(mine.map(([k, , d]) => bump(env, id, d, k)));
  const serviceMax = Number(env.AI_DAILY_LIMIT) || 3000;
  for (let i = 0; i < mine.length; i++) {
    const n = res[i].results && res[i].results[0] ? res[i].results[0].n : 0;
    if (n > mine[i][1]) return { over: mine[i][2] === 'life' ? 'life' : mine[i][0].startsWith('c:') ? 'company' : mine[i][0], service: 0, serviceMax };
  }
  const g = await bump(env, '*', day, 'all').first();
  const service = g ? g.n : 0;
  return { over: service > serviceMax ? 'service' : '', service, serviceMax };
}

export async function getWorkspace(env, id) {
  return env.DB.prepare('SELECT data, version, updated_at FROM workspace WHERE user_id = ?').bind(id).first();
}

// save if the browser's copy was based on the latest version; returns the new version or null (conflict)
export async function putWorkspace(env, id, data, base) {
  const now = Date.now();
  if (!base) {
    const r = await env.DB.prepare('INSERT OR IGNORE INTO workspace (user_id, data, version, updated_at) VALUES (?, ?, 1, ?)').bind(id, data, now).run();
    return r.meta.changes ? 1 : null;
  }
  const r = await env.DB.prepare('UPDATE workspace SET data = ?, version = version + 1, updated_at = ? WHERE user_id = ? AND version = ?').bind(data, now, id, base).run();
  return r.meta.changes ? base + 1 : null;
}

// everything about a user except their purchases (accounting) and the free-credit hash
export async function deleteUser(env, id) {
  await env.DB.batch(['workspace', 'slots', 'usage'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE user_id = ?`).bind(id))
    .concat([env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id)]));
}

// add a paid pack once per Checkout Session (the webhook and the return page may both report it)
export async function creditPurchase(env, { session, user, pack, credits: n, amount }) {
  const now = Date.now();
  const res = await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO purchases (session, user_id, pack, credits, amount, credited, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(session, user, pack, n, amount, now),
    env.DB.prepare(`UPDATE users SET credits = credits + ?1 WHERE id = ?2
      AND EXISTS (SELECT 1 FROM purchases WHERE session = ?3 AND credited = 0)`).bind(n, user, session),
    env.DB.prepare(`UPDATE purchases SET credited = 1 WHERE session = ?1 AND credited = 0
      AND EXISTS (SELECT 1 FROM users WHERE id = ?2)`).bind(session, user),
  ]);
  const p = await env.DB.prepare('SELECT credited FROM purchases WHERE session = ?').bind(session).first();
  // ok: the pack is on the account; added: by this call (so the purchase is announced once)
  return { ok: !!p && p.credited === 1, added: res[1].meta.changes > 0 };
}
