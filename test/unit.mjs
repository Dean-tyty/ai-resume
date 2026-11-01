// Unit tests of the Worker's checks that the browser test cannot reach: the Clerk token, the Stripe
// signature, reading the model's JSON, and that every prompt renders. Run: node test/unit.mjs
import assert from 'node:assert/strict';
import { verifyToken } from '../worker/auth.js';
import { verifyStripe } from '../worker/billing.js';
import { PROMPTS } from '../worker/prompts.js';
import { checkUrl, robotsAllows, extractJob, keepFound } from '../worker/webpage.js';
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
// buyers' features: reading a posting from its URL, and company research
await t('URLs that may be read', async () => {
  assert.ok(checkUrl('https://careers.example.co.jp/jobs/123?x=1').url);
  for (const u of ['ftp://example.com/a', 'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://intranet/', 'https://a.b.internal/x', 'https://u:p@example.com/', 'https://example.com:8080/', 'javascript:alert(1)', '']) assert.equal(checkUrl(u).error, 'url', u);
  for (const u of ['https://doda.jp/DodaFront/View/JobSearchDetail/j_jid__1/', 'https://www.openwork.jp/company.php', 'https://jp.indeed.com/viewjob?jk=1', 'https://www.linkedin.com/jobs/view/1']) assert.equal(checkUrl(u).error, 'site_not_allowed', u);
  assert.ok(checkUrl('https://notdoda.jp/').url, 'only the site itself and its subdomains');
});
await t('robots.txt is respected', async () => {
  const r = 'User-agent: *\nDisallow: /recruit/\nAllow: /recruit/open/\n\nUser-agent: BadBot\nDisallow: /';
  assert.equal(robotsAllows(r, '/recruit/123'), false);
  assert.equal(robotsAllows(r, '/recruit/open/1'), true, 'longer Allow wins');
  assert.equal(robotsAllows(r, '/company/'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: ResumeAI\nAllow: /jobs/', '/jobs/1'), true, 'our own group');
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: ResumeAI\nAllow: /jobs/', '/blog'), true, 'our group has no rule for it');
  assert.equal(robotsAllows('User-agent: *\nDisallow:', '/x'), true, 'empty Disallow');
  assert.equal(robotsAllows('User-agent: *\nDisallow: /*.pdf$', '/a/b.pdf'), false);
  assert.equal(robotsAllows('', '/x'), true);
});
await t('a posting page as plain text', async () => {
  const ld = { '@context': 'https://schema.org', '@type': 'JobPosting', title: 'バックエンドエンジニア', hiringOrganization: { '@type': 'Organization', name: '株式会社テスト' },
    description: '<p>決済基盤の開発を担当します。</p><ul><li>Go / Kotlin</li><li>AWS</li></ul>' + 'あ'.repeat(120), employmentType: 'FULL_TIME' };
  const page = `<html><head><title>求人 | テスト</title><script type="application/ld+json">${JSON.stringify(ld)}</script></head><body><nav>メニュー</nav><main>本文</main></body></html>`;
  const j = extractJob(page);
  assert.ok(j.text.includes('【職種】\nバックエンドエンジニア') && j.text.includes('・Go / Kotlin') && j.text.includes('【会社】'), 'JobPosting data');
  assert.equal(j.company, '株式会社テスト');
  const plain = `<html><body><header>ロゴ</header><script>var x="秘密";</script><main><h1>募集職種</h1><p>営業&amp;企画</p><ul><li>法人営業</li><li>提案</li></ul>${'<p>' + 'い'.repeat(320) + '</p>'}</main><footer>会社概要</footer></body></html>`;
  const p = extractJob(plain);
  assert.ok(p.text.includes('募集職種') && p.text.includes('営業&企画') && p.text.includes('・法人営業'), 'main content');
  assert.ok(!p.text.includes('秘密') && !p.text.includes('ロゴ') && !p.text.includes('会社概要'), 'scripts, header and footer left out');
  const two = `<script type="application/ld+json">${JSON.stringify([{ ...ld, validThrough: '2026-01-31' }, ld])}</script>`;
  const t2 = extractJob(two, Date.parse('2026-11-01'));
  assert.equal(t2.count, 2, 'a list page'); assert.equal(t2.expired, '2026-01-31', 'a closed posting');
});
await t('research keeps only pages the search returned', async () => {
  const v = keepFound({ facts: [{ text: 'a', url: 'https://ex.co.jp/news/1/' }, { text: 'b', url: 'https://made.up/page' }, { text: 'c', url: 'https://ex.co.jp/ir#top', title: '' }], position: [{ text: 'd', url: '' }] },
    [{ url: 'https://ex.co.jp/news/1', title: 'ニュース' }, { url: 'https://ex.co.jp/ir', title: 'IR情報' }]);
  assert.deepEqual(v.facts.map((x) => x.text), ['a', 'c']);
  assert.deepEqual(v.facts.map((x) => x.id), ['F1', 'F3'], 'ids kept for hooks and questions');
  assert.equal(v.facts[1].title, 'IR情報'); assert.equal(v.position.length, 0);
  const d = keepFound({ facts: [{ text: 'x', url: 'https://ex.co.jp/n', date: '' }] }, [{ url: 'https://ex.co.jp/n', title: 't', age: 'April 3, 2026' }]);
  assert.equal(d.facts[0].date, '2026-04', 'date from the search result');
});
await t('research prompt, and research in the other prompts', async () => {
  for (const uiLang of ['', 'en', 'zh']) {
    const p = PROMPTS.P_RESEARCH({ ...ctx, uiLang }, c);
    assert.ok(!/undefined|\[object Object\]/.test(p) && p.includes('web_search'), uiLang + ' renders');
    assert.ok(!p.includes(D.name) && !p.includes(D.raw.slice(0, 40)), uiLang + ' no candidate data in the research prompt');
    assert.equal(p.includes('q_tr'), !!uiLang);
    assert.ok(p.includes('2026年11月1日'), uiLang + ' knows today');
  }
  const w = {}; new Function('window', readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8'))(w);
  const cr = { ...c, research: w.DEMO.research };
  [PROMPTS.P_ANALYZE(ctx, cr), PROMPTS.P_PACK(ctx, cr), PROMPTS.P_PREP(ctx, cr, 2), PROMPTS.P_RK(ctx, cr)].forEach((p, i) => { assert.ok(p.includes('## 公開情報の調査'), 'research block ' + i); assert.ok(!/undefined/.test(p), 'renders ' + i + ' ' + (p.match(/.{60}undefined.{20}/s) || [''])[0]); });
  assert.ok(!PROMPTS.P_PACK(ctx, c).includes('## 公開情報の調査'), 'nothing when not researched');
  assert.ok(PROMPTS.P_PACK(ctx, cr).includes('motivation.used') && !PROMPTS.P_PACK(ctx, c).includes('# 公開情報の使い方'), 'usage rules only with research');
  assert.ok(!PROMPTS.P_PACK(ctx, { ...cr, research: { ...w.DEMO.research, confidence: 'low' } }).includes('## 公開情報の調査'), 'not used when unsure of the company');
  assert.ok(PROMPTS.P_RESEARCH(ctx, { ...c, hosts: ['careers.example.co.jp'] }).includes('careers.example.co.jp'), 'page hosts as a clue');
});
console.log(`${n} passed in total`);
