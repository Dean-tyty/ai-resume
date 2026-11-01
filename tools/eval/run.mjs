// Quality check of a model on the app's own prompts: runs the cases in tools/eval/cases.mjs through the same
// steps as the app (経歴の整理 → 求人の分析 → 職務経歴書 → A4 に収める → 志望動機・面接準備 [→ 解説]) and scores
// what can be checked by code. With --judge, a second model grades the Japanese and the tailoring.
//
//   node tools/eval/run.mjs --model anthropic:claude-sonnet-5-5
//   node tools/eval/run.mjs --model openai:google/gemini-3-pro --judge anthropic:claude-opus-5-5 --cases sales-fit,qa-lead
//   node tools/eval/run.mjs --mock            (no API: the canned answers, to check the tool itself)
//
// Keys from the environment: ANTHROPIC_API_KEY; for openai:… AI_API_KEY (and AI_BASE_URL, default OpenRouter).
// Output: tools/eval/out/<date>-<model>/results.json, report.md, report.html (the texts, for reading by people).
// Compare runs: node tools/eval/compare.mjs tools/eval/out/<run1> tools/eval/out/<run2> …
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { PROMPTS } from '../../worker/prompts.js';
import { callModel } from '../../worker/llm.js';
import { jpDate } from '../../worker/util.js';
import { CASES } from './cases.mjs';
import { checkCase, summarize } from './checks.mjs';
import { judgeCase } from './judge.mjs';
import { writeReports } from './report.mjs';

const root = new URL('../../', import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith('--') ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : '1'] : null)).filter(Boolean));
const mock = !!args.mock;
const model = mock ? 'mock' : args.model;
if (!model) { console.error('--model provider:model (or --mock)'); process.exit(1); }
const tasks = new Set((args.tasks || 'profile,analyze,generate,pack,explain').split(','));
const pick = args.cases ? CASES.filter((c) => args.cases.split(',').includes(c.id)) : CASES.slice(0, Number(args.limit) || CASES.length);
const parallel = Number(args.parallel) || 3;

// the layout engine and the character map, as in tools/render-docs.mjs
const win = {}; win.window = win; win.self = win; win.globalThis = win;
const vctx = vm.createContext(Object.assign(win, { console, setTimeout, clearTimeout, TextEncoder, TextDecoder }));
for (const f of ['lib/fontkit.umd.min.js', 'engine.js', 'charfix.js']) vm.runInContext(readFileSync(root + 'public/' + f, 'utf8'), vctx, { filename: f });
const E = win.ResumeEngine; const U8 = vm.runInContext('Uint8Array', vctx);
const fk = {}; for (const k of Object.keys(E.FONT_FILES)) fk[k] = win.fontkit.create(new U8(readFileSync(root + 'public/' + E.FONT_FILES[k])));
const meas = E.makeMeasurer(fk);
const inCtx = (v) => vm.runInContext('(' + JSON.stringify(v) + ')', vctx);
const toDoc = (raw) => { const d = E.fixChars(E.normalizeDoc(inCtx(raw)), win.CHARFIX || {}); return JSON.parse(JSON.stringify(d)); };
const fit = (doc, maxPages) => JSON.parse(JSON.stringify(E.fitReport(E.layout(inCtx(doc), 'standard', meas, { accent: 'navy' }), maxPages)));

const MOCK = JSON.parse(readFileSync(root + 'worker/mock.json', 'utf8'));
const env = { ...process.env, AI_MODEL: model };
async function ask(task, prompt, maxTokens, uiLang) {
  const t0 = Date.now();
  if (mock) { await new Promise((ok) => setTimeout(ok, 20)); return { value: JSON.parse(JSON.stringify(MOCK[task + '_' + uiLang] || MOCK[task])), usage: {}, ms: Date.now() - t0 }; }
  const r = await callModel(env, task, prompt, maxTokens);
  return { ...r, ms: Date.now() - t0 };
}

async function runCase(cs) {
  const out = { id: cs.id, lang: cs.lang, steps: {}, errors: {}, usage: { input_tokens: 0, output_tokens: 0, ms: 0, retried: 0 } };
  const step = async (task, prompt, max) => {
    try {
      const r = await ask(task, prompt, max, cs.lang);
      out.usage.input_tokens += r.usage.input_tokens || 0; out.usage.output_tokens += r.usage.output_tokens || 0; out.usage.ms += r.ms; out.usage.retried += r.usage.retried || 0;
      return r.value;
    } catch (e) { out.errors[task] = e.code || String(e.message || e); return null; }
  };
  const ctx = { today: jpDate(), name: cs.name, raw: cs.raw, answers: {}, intent: { reason: '', axis: '', conditions: '' }, profile: null, explainLang: cs.lang || 'zh', nameEn: '', uiLang: cs.lang };
  const c = { id: 'eval' + cs.id.replace(/\W/g, '').slice(0, 10), name: '', job: cs.job, info: '', priority: '本命', memo: '', analysis: null, doc: null, maxPages: 2, research: null, hosts: [], pack: null, stages: [] };
  ctx.profile = out.steps.profile = await step('profile', PROMPTS.P_PROFILE(ctx), 16000);
  if (!ctx.profile) return out;
  if (!tasks.has('analyze')) return out;
  c.analysis = out.steps.analyze = await step('analyze', PROMPTS.P_ANALYZE(ctx, c), 10000);
  if (!c.analysis || !tasks.has('generate')) return out;
  const careers = (ctx.profile.careers || []); const roles = careers.reduce((n, x) => n + ((x.roles || []).length || 1), 0);
  c.maxPages = careers.length >= 4 || roles >= 6 ? 3 : 2;
  let raw = await step('generate', PROMPTS.P_GENERATE(ctx, c), 16000);
  if (!raw) return out;
  c.doc = toDoc(raw); out.steps.generate = c.doc;
  // as the app does: up to two rounds of shortening when it does not fit the pages
  let rep = fit(c.doc, c.maxPages); out.fitRounds = 0;
  for (let r = 0; r < 2 && !rep.ok; r++) {
    raw = await step('shorten', PROMPTS.P_SHORTEN(ctx, c, { reason: rep.reason, pages: rep.pages, overLines: rep.overLines, overChars: rep.overChars }), 16000);
    if (!raw) break;
    c.doc = toDoc(raw); out.fitRounds = r + 1; rep = fit(c.doc, c.maxPages);
  }
  out.steps.doc = c.doc; out.fit = { ok: rep.ok, pages: rep.pages, maxPages: c.maxPages };
  if (tasks.has('pack')) c.pack = out.steps.pack = await step('pack', PROMPTS.P_PACK(ctx, c), 14000);
  if (tasks.has('explain') && cs.lang) out.steps.explain = await step('explain', PROMPTS.P_EXPLAIN(ctx, c), 16000);
  if (tasks.has('english')) out.steps.english = await step('english', PROMPTS.P_ENGLISH(ctx, c), 14000);
  return out;
}

const started = Date.now(); const results = [];
const queue = pick.slice();
await Promise.all(Array.from({ length: Math.min(parallel, queue.length) }, async () => {
  while (queue.length) {
    const cs = queue.shift();
    const r = await runCase(cs);
    r.checks = checkCase(cs, r, win.CHARFIX || {});
    if (args.judge && !mock) r.judge = await judgeCase({ ...process.env, AI_MODEL: args.judge }, cs, r).catch((e) => ({ error: e.code || String(e.message || e) }));
    results.push(r);
    console.log(`${r.checks.pass ? 'PASS' : 'FAIL'} ${cs.id}${r.checks.problems.length ? '  ' + r.checks.problems.join(' / ') : ''}`);
  }
}));
results.sort((a, b) => pick.findIndex((c) => c.id === a.id) - pick.findIndex((c) => c.id === b.id));
const summary = summarize(results, { model, judge: args.judge || '', minutes: Math.round((Date.now() - started) / 600) / 100 });
const dir = root + 'tools/eval/out/' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '') + '-' + model.replace(/[^\w.-]+/g, '_') + '/';
mkdirSync(dir, { recursive: true });
writeFileSync(dir + 'results.json', JSON.stringify({ summary, results }, null, 1));
writeReports(dir, summary, results, CASES);
console.log('\n' + JSON.stringify(summary, null, 1));
console.log('written to', dir);
