// Unit tests of the Worker's checks that the browser test cannot reach: the Clerk token, the Stripe
// signature, reading the model's JSON, and that every prompt renders. Run: node test/unit.mjs
import assert from 'node:assert/strict';
import { verifyToken } from '../worker/auth.js';
import { verifyStripe } from '../worker/billing.js';
import { PROMPTS } from '../worker/prompts.js';
import { readFileSync } from 'node:fs';

let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok   ' + name); };
const b64u = (buf) => Buffer.from(buf).toString('base64url');

// a key pair standing in for Clerk's, served as its JWKS
const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', kp.publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
globalThis.fetch = async (url) => ({ ok: true, json: async () => ({ keys: [jwk] }) });
async function token(claims, header = { alg: 'RS256', kid: 'k1', typ: 'JWT' }, key = kp.privateKey) {
  const head = b64u(JSON.stringify(header)) + '.' + b64u(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(head));
  return head + '.' + b64u(sig);
}
const env = { CLERK_JWKS_URL: 'https://example.clerk.accounts.dev/.well-known/jwks.json', APP_ORIGINS: 'https://resume.flatland.co.jp' };
const now = Math.floor(Date.now() / 1000);
const good = { sub: 'user_1', exp: now + 60, nbf: now - 5, azp: 'https://resume.flatland.co.jp', sts: 'active' };

await t('valid Clerk token accepted', async () => assert.deepEqual(await verifyToken(await token(good), env), { id: 'user_1' }));
await t('expired token refused', async () => assert.equal(await verifyToken(await token({ ...good, exp: now - 60 }), env), null));
await t('token not yet valid refused', async () => assert.equal(await verifyToken(await token({ ...good, nbf: now + 120 }), env), null));
await t('token for another site refused', async () => assert.equal(await verifyToken(await token({ ...good, azp: 'https://evil.example' }), env), null));
await t('pending session refused', async () => assert.equal(await verifyToken(await token({ ...good, sts: 'pending' }), env), null));
await t('wrong algorithm refused', async () => assert.equal(await verifyToken(await token(good, { alg: 'HS256', kid: 'k1' }), env), null));
await t('tampered token refused', async () => {
  const tk = (await token(good)).split('.'); tk[1] = b64u(JSON.stringify({ ...good, sub: 'admin' }));
  assert.equal(await verifyToken(tk.join('.'), env), null);
});
await t('token signed by another key refused', async () => {
  const other = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  assert.equal(await verifyToken(await token(good, undefined, other.privateKey), env), null);
});
await t('garbage refused', async () => { for (const g of ['', 'a.b', 'a.b.c', null]) assert.equal(await verifyToken(g, env), null); });

const secret = 'whsec_test123';
async function stripeSig(payload, ts, key = secret) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(ts + '.' + payload))).toString('hex');
  return `t=${ts},v1=${mac}`;
}
const payload = JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1' } } });
await t('Stripe signature accepted', async () => assert.equal(await verifyStripe(payload, await stripeSig(payload, now), secret), true));
await t('Stripe signature with another secret refused', async () => assert.equal(await verifyStripe(payload, await stripeSig(payload, now, 'whsec_other'), secret), false));
await t('Stripe signature on changed body refused', async () => assert.equal(await verifyStripe(payload + ' ', await stripeSig(payload, now), secret), false));
await t('old Stripe signature refused (replay)', async () => assert.equal(await verifyStripe(payload, await stripeSig(payload, now - 3600), secret), false));
await t('missing Stripe signature refused', async () => assert.equal(await verifyStripe(payload, '', secret), false));

// parseJSON is not exported from ai.js (it imports a .json module); check the same logic via a copy
const src = readFileSync(new URL('../worker/ai.js', import.meta.url), 'utf8');
const fn = new Function(src.match(/export function parseJSON[\s\S]*?\n}\n/)[0].replace('export ', '') + 'return parseJSON;')();
await t('JSON read from fenced / chatty output', async () => {
  assert.deepEqual(fn('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(fn('はい。\n{"a":{"b":[1,2]}}\n以上です'), { a: { b: [1, 2] } });
  assert.equal(fn('no json'), null); assert.equal(fn('{broken'), null);
});

// every prompt renders from the sample data without throwing or leaving "undefined"
const window = {}; new Function('window', readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8'))(window);
const D = window.DEMO;
const ctx = { today: '2026年11月1日', name: D.name, raw: D.raw, answers: { 'Q1': 'A1' }, intent: D.intent, profile: D.profile, explainLang: 'en' };
const c = { id: 'abcd1234', name: D.jobName, job: D.job, info: D.companyInfo, priority: '本命', memo: '', analysis: D.analysis, doc: D.doc, maxPages: 2, pack: { motivation: D.pack.motivation },
  stages: D.stages.map((s) => ({ name: s.name, status: s.status, date: '', format: s.format || '', who: s.who || '', log: Object.assign({ asked: '', good: '', bad: '', vibe: '', reverse: '' }, s.log || {}) })) };
await t('all prompts render', async () => {
  const out = [PROMPTS.P_PROFILE(ctx), PROMPTS.P_ANALYZE(ctx, c), PROMPTS.P_GENERATE(ctx, c), PROMPTS.P_SHORTEN(ctx, c, { reason: '', pages: 3, overLines: 12, overChars: 400 }),
    PROMPTS.P_PACK(ctx, c), PROMPTS.P_PREP(ctx, c, 2), PROMPTS.P_RK(ctx, c), PROMPTS.P_EXPLAIN(ctx, c)];
  out.forEach((p, i) => { assert.ok(p.length > 300, 'prompt ' + i); assert.ok(!/undefined|\[object Object\]/.test(p), 'prompt ' + i + ' has undefined'); });
  assert.ok(out[7].includes('英語'), 'explain language');
});
console.log(`\n${n} passed`);
import { sameCompany } from '../worker/util.js';
await t('same company despite legal form / brackets / spacing', async () => {
  assert.ok(sameCompany('株式会社サンプルクラウド（架空）', 'サンプルクラウド'));
  assert.ok(sameCompany('Sample Cloud Inc.', 'sample cloud'));
  assert.ok(sameCompany('', 'どこでも'));
  assert.ok(!sameCompany('株式会社サンプルクラウド', '株式会社テスト二号'));
});
console.log(`${n} passed in all`);

// ---- engineer (project) format
const ER = (() => { const w = {}; new Function('window', 'module', readFileSync(new URL('../public/engine.js', import.meta.url), 'utf8'))(w, undefined); return w.ResumeEngine; })();
const FX = JSON.parse(readFileSync(new URL('./fixtures/engineer.json', import.meta.url), 'utf8'));
await t('phases and environment are normalized', async () => {
  const d = ER.normalizeDoc({ careers: [{ company: 'A', blocks: [
    { phases: ['要件定義〜テスト'], env: { lang: ['Java', 'Go'], DB: ['MySQL'] } },
    { phases: '製造、単体テスト、保守', env: ['フレームワーク：Rails'] },
    { phases: ['提案', '企画'] }] }] });
  const [a, b, c2] = d.careers[0].blocks;
  assert.deepEqual(a.phases, ['要件定義', '基本設計', '詳細設計', '実装', 'テスト']);
  assert.deepEqual(a.env, ['言語：Java、Go', 'DB：MySQL']);
  assert.deepEqual(b.phases, ['実装', 'テスト', '運用・保守']);
  assert.deepEqual(b.env, ['FW：Rails']);
  assert.deepEqual(c2.phases, [], 'no phase is made up from 提案/企画');
  assert.ok(ER.hasProjects(FX.doc)); assert.ok(!ER.hasProjects(D.doc));
});
await t('engineer prompt only for engineer data', async () => {
  const eng = PROMPTS.P_GENERATE({ ...ctx, profile: { careers: [{ roles: [{ projects: [{ name: 'x' }] }] }] } }, c);
  assert.ok(eng.includes('エンジニア形式') && eng.includes('skillTable'));
  assert.ok(!PROMPTS.P_GENERATE(ctx, c).includes('skillTable'));
});
await t('engineer Word file is well-formed and has the project table', async () => {
  for (const th of Object.keys(ER.THEMES)) {
    const files = ER.buildDocxXml(FX.doc, th, { target: 'windows' });
    const x = files['word/document.xml'];
    // balanced tags (a cheap well-formedness check)
    const opens = (x.match(/<w:(tbl|tr|tc|p)(?=[\s>])[^>]*>/g) || []).filter((m) => !m.endsWith('/>')).length, closes = (x.match(/<\/w:(tbl|tr|tc|p)>/g) || []).length;
    assert.equal(opens, closes, th + ' tags balanced');
    assert.ok(x.includes('テクニカルスキル'), th + ' skill table');
    assert.ok(x.includes('Spring Boot'), th + ' environment');
    if (th === 'engineer') assert.ok(x.includes('役割・規模／開発環境'));
  }
});
console.log(`${n} passed with engineer`);

// English / Chinese page: the same prompts with the reader's language, and the English resume
await t('prompts for the English and Chinese pages', async () => {
  for (const uiLang of ['en', 'zh']) {
    const cx = { ...ctx, uiLang };
    const out = [PROMPTS.P_PROFILE(cx), PROMPTS.P_ANALYZE(cx, c), PROMPTS.P_PACK(cx, c), PROMPTS.P_PREP(cx, c, 2), PROMPTS.P_EXPLAIN(cx, c), PROMPTS.P_ENGLISH(cx, c)];
    out.forEach((p, i) => assert.ok(!/undefined|\[object Object\]/.test(p), uiLang + ' prompt ' + i));
    const name = uiLang === 'en' ? '英語' : '中国語';
    assert.ok(out[1].includes(name) && out[2].includes('answer_tr') && out[3].includes('q_tr'), uiLang + ' language rules');
  }
  assert.ok(!PROMPTS.P_PACK(ctx, c).includes('answer_tr'), 'Japanese page: no translations asked');
});
await t('English resume layout fits and builds', async () => {
  const w = {}; new Function('window', readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8'))(w);
  const d = ER.normalizeEn(w.DEMO.english);
  assert.equal(d.experience.length, 2); assert.ok(d.experience[0].roles[0].bullets.length >= 3);
  const files = ER.buildDocxEnXml(d, { dense: 1 });
  assert.ok(files['word/document.xml'].includes('EXPERIENCE') || files['word/document.xml'].includes('Experience'));
  assert.ok(files['word/styles.xml'].includes('en-US'));
});
console.log(`${n} passed in total`);
