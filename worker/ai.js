// POST /api/ai {task, ctx, c, rep, i}: one AI step. The prompts live here on the server (prompts.js);
// the browser sends only the user's own data.
// Credits: reading a job posting (analyze) is free; making documents for a 応募先 uses one credit the first
// time (given back if nothing ever succeeds for it). A credit is for one company: once its name is known,
// requests for another company under the same 応募先 are refused. The sample job posting costs nothing.
// Every request counts towards the daily limits.
//
// The answer can take a minute or more, so the response starts at once and sends a space every
// 15 seconds until the JSON arrives (spaces before JSON are allowed).
import { PROMPTS } from './prompts.js';
import { MAX_PAYLOAD, CONSENT_VERSION, SLOT_MAX } from './config.js';
import { account, claimSlot, holdSlot, finishSlot, credits, countUse } from './db.js';
import { body, fail, str, sizeOf, jpDate, NO_STORE, sameCompany, sha256 } from './util.js';
import { track } from './stats.js';
import { notify } from './notify.js';
import MOCK from './mock.json';

// task -> [prompt, max output tokens (thinking included), needs a 応募先, uses a credit]
const TASKS = {
  profile: ['P_PROFILE', 12000, false, false],
  analyze: ['P_ANALYZE', 10000, true, false],
  generate: ['P_GENERATE', 16000, true, true],
  shorten: ['P_SHORTEN', 16000, true, true],
  pack: ['P_PACK', 14000, true, true],
  prep: ['P_PREP', 10000, true, true],
  rk: ['P_RK', 4000, true, true],
  explain: ['P_EXPLAIN', 16000, true, true],
};
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
  };
}
function cleanCompany(c) {
  if (!c || typeof c !== 'object' || !/^[a-z0-9]{4,16}$/.test(c.id || '')) return null;
  const m = c.pack && c.pack.motivation;
  return {
    id: c.id, name: str(c.name, 120), job: str(c.job, 12000), info: str(c.info, 6000), priority: str(c.priority, 10) || '本命', memo: str(c.memo, 1500),
    analysis: obj(c.analysis, 40000), doc: obj(c.doc, 60000), maxPages: c.maxPages === 3 ? 3 : 2,
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
  if (!ctx.profile) return 'profile';
  if (task === 'analyze') return c.job.trim() ? '' : 'job';
  if (task === 'generate') return c.analysis ? '' : 'analysis';
  if (['shorten', 'pack', 'rk', 'explain'].includes(task) && !c.doc) return 'doc';
  if (task === 'prep' && !c.stages[b.i]) return 'stage';
  return '';
}

// the JSON object in the model's text: without code fences, from the first { to the last }
export function parseJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'); const z = t.lastIndexOf('}');
  if (a < 0 || z <= a) return null;
  try { const v = JSON.parse(t.slice(a, z + 1)); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

class AIError extends Error { constructor(code, detail, extra) { super(code); this.code = code; this.detail = detail || ''; this.extra = extra; } }

async function callClaude(env, prompt, maxTokens) {
  const req = {
    model: env.AI_MODEL || 'claude-sonnet-5-5', max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: env.AI_EFFORT || 'medium' },
  };
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    } catch (e) {
      if (attempt < 1) { await new Promise((ok) => setTimeout(ok, 2000)); continue; }
      throw new AIError('ai_unreachable', String(e.message || e));
    }
    const text = await r.text();
    if (r.ok) {
      let j; try { j = JSON.parse(text); } catch { throw new AIError('ai_error', 'not JSON'); }
      if (j.stop_reason === 'refusal') throw new AIError('refused');
      if (j.stop_reason === 'max_tokens') throw new AIError('too_long');
      const out = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const v = parseJSON(out);
      if (!v) throw new AIError('invalid_json', 'length ' + out.length);   // never log the text: it holds the user's career
      return { value: v, usage: j.usage || {} };
    }
    // overloaded / server errors: one more try after a pause
    if ((r.status === 529 || r.status >= 500) && attempt < 1) { await new Promise((ok) => setTimeout(ok, 2500)); continue; }
    if (r.status === 429) throw new AIError('busy', text.slice(0, 200));
    if (r.status === 529 || r.status >= 500) throw new AIError('busy', r.status + ' ' + text.slice(0, 200));
    if (r.status === 400 && /prompt is too long|too many tokens|context/i.test(text)) throw new AIError('prompt_too_large');
    throw new AIError('ai_error', r.status + ' ' + text.slice(0, 300));
  }
}

async function mockClaude(task, ctx, c) {
  await new Promise((ok) => setTimeout(ok, 250));
  if (/【モック失敗】/.test(ctx.raw + (c ? c.memo : ''))) throw new AIError('invalid_json', 'mock');
  const v = JSON.parse(JSON.stringify(MOCK[task]));
  if (task === 'analyze' && c && c.name) v.company = c.name;
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
  if (!env.ANTHROPIC_API_KEY && env.AI_MOCK !== '1') return fail(503, 'not_configured');

  let slot = null;
  const named = c ? (c.analysis && c.analysis.company) || c.name : '';
  const free = c ? await isSample(c) : true;
  if (c && !free) {
    // documents: the 応募先 takes a credit unless it has one; reading the posting: only if it already has one
    slot = def[3] ? await claimSlot(env, auth.id, c.id) : await holdSlot(env, auth.id, c.id);
  }
  if (slot) {
    if (slot.state === 'none') return fail(402, 'no_credit', { credits: 0 });
    if (slot.n >= SLOT_MAX) { await finishSlot(env, auth.id, c.id, false); return fail(429, 'limit', { scope: 'slot' }); }
    if (slot.label && !sameCompany(slot.label, named)) { await finishSlot(env, auth.id, c.id, false); return fail(409, 'company_changed', { label: slot.label }); }
  }
  const use = await countUse(env, auth.id, task, c && c.id);
  if (use.over) {
    if (slot) await finishSlot(env, auth.id, c.id, false);
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
      const r = env.AI_MOCK === '1' ? await mockClaude(task, ctx, c) : await callClaude(env, prompt, def[1]);
      if (slot) {
        // a re-analysis that turns out to be another company's posting is not given out under this credit
        const found = task === 'analyze' ? String(r.value.company || '') : '';
        if (slot.label && found && !sameCompany(slot.label, found)) throw new AIError('company_changed', '', { label: slot.label });
        if (!(await finishSlot(env, auth.id, c.id, true, slot.label || found || named))) throw new AIError('no_credit');
        slot.done = true;
      }
      if (task === 'profile') track(env, 'profile', request);
      if (task === 'generate') track(env, 'doc', request);
      out = { result: r.value, credits: await credits(env, auth.id), slot: slot ? slot.state : '' };
      console.log(JSON.stringify({ ai: task, in: r.usage.input_tokens || 0, out: r.usage.output_tokens || 0 }));
    } catch (e) {
      const code = e instanceof AIError ? e.code : 'server';
      console.error('ai', task, code, e instanceof AIError ? e.detail : String(e.message || e));
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
