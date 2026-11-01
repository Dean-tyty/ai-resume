// POST /api/ai {task, ctx, c, rep, i}: one AI step. The prompts live here on the server (prompts.js);
// the browser sends only the user's own data.
// Credits: reading a job posting (analyze) is free. The 職務経歴書 of a 応募先 can be made and read on the
// screen without a credit (a preview, within PREVIEW in config.js); the credit is used when its documents leave
// the page (POST /api/unlock) or a task below marked 'unlock' runs (given back if nothing ever succeeds for it).
// A credit is for one company: once its name is known, requests for another company under the same 応募先 are
// refused. The sample job posting costs nothing. Every request counts towards the daily limits (and, for an
// account that has never bought, towards FREE_LIFE).
//
// The answer can take a minute or more, so the response starts at once and sends a space every
// 15 seconds until the JSON arrives (spaces before JSON are allowed).
import { PROMPTS } from './prompts.js';
import { MAX_PAYLOAD, CONSENT_VERSION, SLOT_MAX, FREE_SLOT_MAX, PREVIEW, RESEARCH_PER_COMPANY, REVIEW_SITES } from './config.js';
import { account, claimSlot, holdSlot, finishSlot, unlockSlot, credits, countUse, hasPaid, takeResearch, giveBackResearch } from './db.js';
import { body, fail, str, sizeOf, jpDate, NO_STORE, sameCompany, sha256 } from './util.js';
import { track } from './stats.js';
import { notify } from './notify.js';
import MOCK from './mock.json';
import { keepFound } from './webpage.js';
import { AIError, callModel, modelFor } from './llm.js';
import { searchProvider, collectSources } from './research.js';

// task -> [prompt, max output tokens (thinking included), needs a 応募先, credit: '' none (analyze runs under
// the slot if there is one) | 'preview' may run before the credit is used | 'unlock' uses the credit]
const TASKS = {
  profile: ['P_PROFILE', 16000, false, ''],
  analyze: ['P_ANALYZE', 10000, true, ''],
  generate: ['P_GENERATE', 16000, true, 'preview'],
  shorten: ['P_SHORTEN', 16000, true, 'preview'],
  explain: ['P_EXPLAIN', 16000, true, 'preview'],
  pack: ['P_PACK', 14000, true, 'unlock'],
  prep: ['P_PREP', 10000, true, 'unlock'],
  rk: ['P_RK', 4000, true, 'unlock'],
  english: ['P_ENGLISH', 14000, true, 'unlock'],
  research: ['P_RESEARCH', 12000, true, 'unlock'],
};
// for users who have bought credits only, and at most RESEARCH_PER_COMPANY times per 応募先: web searches cost
const PAID_ONLY = new Set(['research']);
const searchTool = (env) => ({ type: env.AI_SEARCH_TOOL || 'web_search_20250305', name: 'web_search', max_uses: 5, blocked_domains: REVIEW_SITES,
  user_location: { type: 'approximate', country: 'JP', timezone: 'Asia/Tokyo' } });
// the sample job posting of the page ("サンプル求人で試す"): trying it never uses a credit
const SAMPLE_JOB = MOCK.sampleJobHash || '';
const isSample = async (c) => !!SAMPLE_JOB && (await sha256(c.job.replace(/\s+/g, ''))) === SAMPLE_JOB;

const obj = (v, max) => (v && typeof v === 'object' && !Array.isArray(v) && sizeOf(v) <= max ? v : null);
function cleanCtx(x) {
  x = x || {};
  const answers = {};
  if (x.answers && typeof x.answers === 'object') Object.keys(x.answers).slice(0, 12).forEach((k) => { answers[str(k, 300)] = str(x.answers[k], 1500); });
  const it = x.intent || {};
  return {
    today: jpDate(), name: str(x.name, 60), raw: str(x.raw, 20000), answers,
    intent: { reason: str(it.reason, 1500), axis: str(it.axis, 1500), conditions: str(it.conditions, 1000) },
    profile: obj(x.profile, 80000), explainLang: x.explainLang === 'en' ? 'en' : 'zh',
    nameEn: str(x.nameEn, 80), uiLang: ['en', 'zh'].includes(x.uiLang) ? x.uiLang : 'ja',
    mask: x.mask !== false,   // clients' names and internal numbers left out of the documents (the default)
  };
}
function cleanCompany(c) {
  if (!c || typeof c !== 'object' || !/^[a-z0-9]{4,16}$/.test(c.id || '')) return null;
  const m = c.pack && c.pack.motivation;
  return {
    id: c.id, name: str(c.name, 120), job: str(c.job, 12000), info: str(c.info, 6000), priority: str(c.priority, 10) || '本命', memo: str(c.memo, 1500),
    analysis: obj(c.analysis, 40000), doc: obj(c.doc, 60000), maxPages: c.maxPages === 3 ? 3 : 2, research: obj(c.research, 24000),
    // the pages the user pointed at (job posting, official site): host names only, to tell same-name companies apart
    hosts: Array.isArray(c.hosts) ? c.hosts.slice(0, 3).map((x) => str(x, 100).toLowerCase()).filter((x) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(x)) : [],
    pack: m ? { motivation: { long: str(m.long, 1200), short: str(m.short, 600) } } : null,
    stages: Array.isArray(c.stages) ? c.stages.slice(0, 10).map((s) => ({
      name: str(s && s.name, 40), status: str(s && s.status, 10), date: str(s && s.date, 10), format: str(s && s.format, 20), who: str(s && s.who, 80),
      log: Object.fromEntries(['asked', 'good', 'bad', 'vibe', 'reverse'].map((k) => [k, str(s && s.log && s.log[k], 2000)])),
    })) : [],
  };
}
const num = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };

// what each task needs before it can run (the page checks the same, so these only stop odd requests)
function missing(task, ctx, c, b) {
  if (task === 'profile') return ctx.raw.trim() ? '' : 'raw';
  if (task === 'research') return (c.name || (c.analysis && c.analysis.company) || c.job).trim() ? '' : 'company';   // no career data needed
  if (!ctx.profile) return 'profile';
  if (task === 'analyze') return c.job.trim() ? '' : 'job';
  if (task === 'generate' || task === 'english') return c.analysis ? '' : 'analysis';
  if (['shorten', 'pack', 'rk', 'explain'].includes(task) && !c.doc) return 'doc';
  if (task === 'prep' && !c.stages[b.i]) return 'stage';
  return '';
}

async function mockClaude(task, ctx, c) {
  await new Promise((ok) => setTimeout(ok, 250));
  if (/【モック失敗】/.test(ctx.raw + (c ? c.memo : ''))) throw new AIError('invalid_json', 'mock');
  const v = JSON.parse(JSON.stringify(MOCK[task + '_' + ctx.uiLang] || MOCK[task]));
  if (task === 'analyze' && c && c.name) v.company = c.name;
  if (task === 'research') v.sample = false;   // behaves as a real result (the next steps show)
  return { value: v, usage: {} };
}

export async function handleAI(request, env, ctxExec, auth) {
  const b = await body(request, MAX_PAYLOAD);
  if (!b) return fail(413, 'payload');
  const task = String(b.task || '');
  const def = TASKS[task];
  if (!def) return fail(400, 'task');
  const { user, created } = await account(env, auth);
  if (created) track(env, 'signup', request);
  if (user.consent !== CONSENT_VERSION) return fail(403, 'consent');
  const ctx = cleanCtx(b.ctx);
  const c = def[2] ? cleanCompany(b.c) : null;
  if (def[2] && !c) return fail(400, 'company');
  const i = num(b.i, 0, 9);
  const need = missing(task, ctx, c, { i });
  if (need) return fail(400, 'missing', { need });
  const mdl = modelFor(env, task);
  if (env.AI_MOCK !== '1' && !(mdl.provider === 'openai' ? env.AI_API_KEY : env.ANTHROPIC_API_KEY)) return fail(503, 'not_configured');
  const sp = task === 'research' ? searchProvider(env, mdl.provider) : '';
  if (task === 'research' && !sp && env.AI_MOCK !== '1') return fail(503, 'not_configured');
  const paid = await hasPaid(env, auth.id);
  if (PAID_ONLY.has(task) && !paid) return fail(403, 'paid_only');

  let slot = null;
  const named = c ? (c.analysis && c.analysis.company) || c.name : '';
  const free = c ? await isSample(c) : true;
  if (task === 'research' && free) return fail(400, 'sample');   // the sample company does not exist
  if (c && !free) {
    // documents: under the 応募先's slot (made now if it has none); reading the posting: only if it already has one
    slot = def[3] ? await claimSlot(env, auth.id, c.id, def[3], paid) : await holdSlot(env, auth.id, c.id);
  }
  if (slot) {
    if (slot.state === 'none') return fail(402, slot.why === 'preview' ? 'preview_limit' : 'no_credit', { credits: await credits(env, auth.id) });
    if (def[3] === 'unlock' && !slot.unlocked) {
      // a preview that now needs its credit (the page asks before sending)
      const u = await unlockSlot(env, auth.id, c.id);
      if (!u.ok) { await finishSlot(env, auth.id, c.id, false); return fail(402, 'no_credit', { credits: 0 }); }
      slot.unlocked = true;
      if (u.used) track(env, 'unlock', request);
    }
    const max = !slot.unlocked ? PREVIEW.requests : paid ? SLOT_MAX : FREE_SLOT_MAX;
    if (slot.n >= max) { await finishSlot(env, auth.id, c.id, false); return fail(429, 'limit', { scope: slot.unlocked ? 'slot' : 'preview' }); }
    if (slot.label && !sameCompany(slot.label, named)) { await finishSlot(env, auth.id, c.id, false); return fail(409, 'company_changed', { label: slot.label }); }
    if (task === 'research' && !(await takeResearch(env, auth.id, c.id, RESEARCH_PER_COMPANY))) { await finishSlot(env, auth.id, c.id, false); return fail(429, 'limit', { scope: 'research' }); }
  }
  const use = await countUse(env, auth.id, task, c && c.id, paid);
  if (use.over) {
    if (slot) { if (task === 'research') await giveBackResearch(env, auth.id, c.id); await finishSlot(env, auth.id, c.id, false); }
    if (use.over === 'service' && use.service === use.serviceMax + 1) ctxExec.waitUntil(notify(env, `本日の AI 利用がサービス全体の上限（${use.serviceMax}回）に達しました。AI_DAILY_LIMIT を確認してください。`));
    return fail(429, 'limit', { scope: use.over });
  }
  if (use.service === Math.floor(use.serviceMax * 0.8)) ctxExec.waitUntil(notify(env, `本日の AI 利用がサービス全体の上限の 80%（${use.service}/${use.serviceMax}回）に達しました。`));

  const prompt = task === 'profile' ? PROMPTS[def[0]](ctx)
    : task === 'shorten' ? PROMPTS[def[0]](ctx, c, { reason: b.rep && b.rep.reason === 'orphan' ? 'orphan' : '', pages: num(b.rep && b.rep.pages, 1, 9), overLines: num(b.rep && b.rep.overLines, 1, 400), overChars: num(b.rep && b.rep.overChars, 1, 20000) })
    : task === 'prep' ? PROMPTS[def[0]](ctx, c, i)
    : PROMPTS[def[0]](ctx, c);

  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const w = writable.getWriter();
  const tick = setInterval(() => { w.write(enc.encode(' ')).catch(() => {}); }, 15000);
  const job = (async () => {
    let out;
    try {
      let r;
      if (env.AI_MOCK === '1') r = await mockClaude(task, ctx, c);
      else if (task === 'research' && sp !== 'anthropic') {
        // our own searches and the company's pages, then any model writes the answer from them
        const got = await collectSources(env, c, sp);
        if (got.sources.length < 2) throw new AIError('research_empty', 'sources ' + got.sources.length, { reason: '' });
        r = await callModel(env, task, PROMPTS.P_RESEARCH(ctx, c, got.sources), def[1]);
        r.sources = got.sources.map((x) => ({ url: x.url, title: x.title, age: x.date })); r.usage.searches = got.searches;
      } else r = await callModel(env, task, prompt, def[1], task === 'research' ? { tools: [searchTool(env)] } : {});
      if (task === 'research') {
        if (r.sources) r.value = keepFound(r.value, r.sources);
        // nothing usable found (or not sure it is the same company): not counted, the credit is not used
        const facts = Array.isArray(r.value.facts) ? r.value.facts : [];
        if (facts.length < 2 || (r.value.confidence === 'low' && facts.length < 3)) throw new AIError('research_empty', 'facts ' + facts.length, { reason: String((Array.isArray(r.value.caveats) && r.value.caveats[0]) || '').slice(0, 200) });
      }
      if (slot) {
        // a re-analysis that turns out to be another company's posting is not given out under this credit
        const found = task === 'analyze' ? String(r.value.company || '') : '';
        if (slot.label && found && !sameCompany(slot.label, found)) throw new AIError('company_changed', '', { label: slot.label });
        if (!(await finishSlot(env, auth.id, c.id, true, slot.label || found || named))) throw new AIError('no_credit');
        slot.done = true;
      }
      if (task === 'profile') track(env, 'profile', request);
      if (task === 'generate') track(env, 'doc', request);
      out = { result: r.value, credits: await credits(env, auth.id), slot: slot ? slot.state : '', unlocked: !!(slot && slot.unlocked) };
      console.log(JSON.stringify({ ai: task, model: r.model || 'mock', in: r.usage.input_tokens || 0, out: r.usage.output_tokens || 0, ...(r.usage.searches ? { searches: r.usage.searches } : {}), ...(r.usage.retried ? { retried: 1 } : {}), ...(r.fallback ? { fallback: 1 } : {}) }));
    } catch (e) {
      const code = e instanceof AIError ? e.code : 'server';
      console.error('ai', task, code, e instanceof AIError ? e.detail : String(e.message || e));
      if (slot && !slot.done && task === 'research') await giveBackResearch(env, auth.id, c.id).catch(() => {});
      if (slot && !slot.done) await finishSlot(env, auth.id, c.id, false).catch((x) => console.error('finish', String(x)));
      out = { error: { code, ...(e.extra || {}) }, credits: await credits(env, auth.id).catch(() => null) };
      if (code === 'ai_error' || code === 'ai_unreachable') ctxExec.waitUntil(notify(env, `AI の呼び出しでエラーが出ました（${task}：${code}）。${String(e.detail || '').slice(0, 160)}`));
    }
    clearInterval(tick);
    try { await w.write(enc.encode(JSON.stringify(out))); await w.close(); } catch { /* the page went away */ }
  })();
  ctxExec.waitUntil(job);
  return new Response(readable, { headers: { 'content-type': 'application/json; charset=utf-8', ...NO_STORE, 'x-content-type-options': 'nosniff' } });
}
