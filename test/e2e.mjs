// The whole flow in a browser against `npm run dev` (test login, canned AI answers, test payment):
// landing page -> sample -> own data -> login -> consent -> 経歴 -> 応募先 -> 書類 -> downloads -> no credit ->
// purchase -> saved on the server -> another device -> conflict -> delete the account.
// Run: npm run dev (another terminal), then node test/e2e.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, context, watch, BASE } from './browser.mjs';

const OUT = new URL('./out/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const user = 'e2e' + Date.now().toString(36);
let failed = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) failed++; };
const errors = [];
const browser = await chromium.launch();

const ctxA = await context(browser, { viewport: { width: 1360, height: 960 } });
const page = await ctxA.newPage(); watch(page, errors);
const act = (a, extra = '') => page.click(`[data-act=${a}]${extra}`);
const shot = (n) => page.screenshot({ path: OUT + n + '.png' });

// landing page, then the sample
await page.goto(BASE + '/');
await page.waitForSelector('#acct [data-act=login]');
ok(await page.isVisible('#lp') && await page.isHidden('#app'), 'landing page first for a new visitor');
await page.click('.lp-cta [data-act=demo]');
await page.waitForSelector('#preview canvas', { timeout: 20000 });
ok(await page.isVisible('.demo-bar'), 'sample shown with its notice');
await page.click('.demo-bar [data-act=startOwn]');
ok(await page.isVisible('#in-raw'), 'own data starts at step 1');

// 経歴: typing works before signing in; AI asks for login, then consent, then carries on by itself
await page.fill('#in-name', '山田 太郎');
await page.click('[data-act=sampleRaw]');
await page.fill('#in-name', '山田 太郎');
await act('extract');
await page.waitForSelector('#devName');
ok(true, 'AI without login opens the login dialog');
await page.fill('#devName', user);
await act('devLogin');
await page.waitForSelector('#acct .credit');
ok((await page.innerText('#acct .credit')).includes('1'), 'new account has 1 free credit');
ok((await page.inputValue('#in-name')) === '山田 太郎', 'what was typed before login is kept');
await page.waitForSelector('[data-act=consentOk]', { timeout: 8000 });
ok(true, 'after login the action resumes and asks for consent first');
ok(await page.evaluate(() => document.querySelector('#sync').textContent !== '保存済み'), 'nothing saved to the account before consent');
await act('consentOk');
await page.waitForSelector('.eps', { timeout: 15000 });
ok(true, '経歴 organised (mock AI) without a second click');
ok((await page.innerText('.screen')).includes('書類選考で最初に見られやすい点'), 'free screening check shown with the organised career');
await page.waitForFunction(() => document.querySelector('#sync').textContent === '保存済み', null, { timeout: 8000 });
ok(true, 'saved to the server after consent');

// the sample posting is free from start to finish
const cardOf = async () => page.$eval('[data-cid]', (el) => el.dataset.cid);
await act('step', '[data-step="2"]');
await page.click('.vh [data-act=sampleJob]');
const sampleId = await cardOf();
const S = `[data-cid="${sampleId}"]`;
ok((await page.innerText(S + ' .credit-note')).includes('無料'), 'sample posting marked free');
await page.click(S + ' [data-act=analyze]');
await page.waitForSelector(S + ' .an', { timeout: 15000 });
await page.click(S + ' [data-act=generate]');
await page.waitForSelector('#preview canvas', { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('.pill.run'), null, { timeout: 30000 });
await shot('doc');
ok(true, '職務経歴書 made and previewed');
ok((await page.innerText('#acct .credit')).includes('1'), 'sample used no credit');

// downloads
for (const kind of ['pdf', 'docx']) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-act=${kind}]`).then(() => page.click(`[data-act=${kind}]`).catch(() => {}))]);
  const p = OUT + 'out.' + kind; await dl.saveAs(p);
  ok(/^職務経歴書_山田太郎_[^_]+_\d{8}\.(pdf|docx)$/.test(dl.suggestedFilename()) && !dl.suggestedFilename().includes('サンプルクラウド'), kind + ' downloaded as ' + dl.suggestedFilename());
}
await act('tab', '[data-v=rireki]');
await page.waitForSelector('#rkPreview canvas', { timeout: 15000 });
{
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=rkPdf]').then(() => page.click('[data-act=rkPdf]').catch(() => {}))]);
  await dl.saveAs(OUT + 'rireki.pdf');
  ok(dl.suggestedFilename().startsWith('履歴書_'), '履歴書 PDF downloaded');
}
ok(!(await page.isVisible('[data-act=theme][data-v=engineer]')), 'engineer design not offered without projects');
// English resume: made for the same company (no extra credit), name in Latin letters asked to be checked
await act('tab', '[data-v=en]');
await page.click('[data-act=english]');
await page.waitForSelector('#enPreview canvas', { timeout: 30000 });
ok(await page.isVisible('#en-name') && (await page.inputValue('#en-name')).length > 0, 'English resume made, with a name in Latin letters');
await page.fill('#en-name', 'Taro Yamada');
for (const [a, ext] of [['enPdf', 'pdf'], ['enDocx', 'docx']]) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-act=${a}]`).then(() => page.click(`[data-act=${a}]`).catch(() => {}))]);
  await dl.saveAs(OUT + 'english.' + ext);
  ok(/^Resume_TaroYamada_.+\.(pdf|docx)$/.test(dl.suggestedFilename()), 'English resume ' + ext + ' downloaded as ' + dl.suggestedFilename());
}
ok((await page.innerText('#acct .credit')).includes('1'), 'English resume of the sample used no credit');
await act('tab', '[data-v=doc]');

// a real company: reading the posting is free, the documents use the free credit
const addCo = async (name) => {
  await act('step', '[data-step="2"]');
  await page.click('.vh [data-act=addCompany]');
  const id = await cardOf(); const C = `[data-cid="${id}"]`;
  await page.fill(C + ' [data-cf=name]', name);
  await page.fill(C + ' [data-cf=job]', '【募集職種】営業マネージャー\n【必須】法人営業経験3年以上');
  return C;
};
const C2 = await addCo('株式会社テスト二号');
await page.click(C2 + ' [data-act=analyze]');
await page.waitForSelector(C2 + ' .an', { timeout: 15000 });
ok((await page.innerText('#acct .credit')).includes('1'), 'analysis is free');
// buyers' features are not open before a purchase
ok(!(await page.isVisible(C2 + ' details[data-jobd] [data-cf=job]')), 'the posting folds away after the analysis');
await page.click(C2 + ' details[data-jobd] > summary');
ok(await page.isVisible(C2 + ' .urlrow.locked'), 'URL import shown as a buyers\' feature before a purchase');
ok((await page.innerText(C2 + ' .research')).includes('購入して使う'), 'company research offered to buyers');
await page.click(C2 + ' .research [data-act=researchExample]');
ok((await page.innerText('#modal')).includes('結果の例'), 'example result shown before buying');
await act('closeModal');
await page.click(C2 + ' .urlrow.locked [data-act=fetchJob]');
ok((await page.innerText('#modal')).includes('無料の1社分では使えません'), 'purchase dialog says why (buyers\' feature)');
await act('closeModal');
// (called from here, not from the page: refusals are expected and would show as page errors)
const api = async (path, b) => JSON.parse((await (await fetch(BASE + path, { method: 'POST', headers: { authorization: 'Dev ' + user, 'content-type': 'application/json', origin: BASE }, body: JSON.stringify(b) })).text()).trim());
const C2c = { id: C2.match(/"(.+)"/)[1], name: '株式会社テスト二号', job: '【募集職種】営業マネージャー\n【必須】法人営業経験3年以上' };
ok((await api('/api/fetch-job', { url: 'https://jobs.example.com/1' })).error.code === 'paid_only', 'server: URL import refused before a purchase');
ok((await api('/api/ai', { task: 'research', ctx: {}, c: C2c })).error.code === 'paid_only', 'server: research refused before a purchase');
// the 職務経歴書 is made and read before any credit is used (a preview); saving it uses the free credit
ok((await page.innerText(C2 + ' .credit-note')).includes('利用枠は使いません'), 'note: making the 職務経歴書 uses no credit');
await page.click(C2 + ' [data-act=generate]');
await page.waitForSelector('.lock-note', { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('.pill.run'), null, { timeout: 30000 });
ok(/あと\s*1/.test(await page.innerText('#acct .credit')), 'making the 職務経歴書 used no credit (a preview)');
// saving: asked first, then the free credit is used and the file saved
const save = async (sel) => { await page.click(sel); await page.waitForTimeout(200); if ((await page.innerText(sel).catch(() => '')).includes('もう一度')) await page.click(sel); };
{
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await save('[data-act=pdf]');
  await page.waitForSelector('[data-act=unlockOk]');
  ok((await page.innerText('#modal')).includes('無料の1社分を使います'), 'asked before the free credit is used');
  await page.click('[data-act=unlockOk]');
  await dl;
  ok(/あと\s*0/.test(await page.innerText('#acct .credit')) && !(await page.isVisible('.lock-note')), 'saving used the free credit (1 → 0)');
}

// a third: made as the second free preview; saving it -> purchase -> asked again on return -> saved
const C3 = await addCo('株式会社テスト三号');
await page.click(C3 + ' [data-act=analyze]');
await page.waitForSelector(C3 + ' .an', { timeout: 15000 });
await page.click(C3 + ' [data-act=generate]');
await page.waitForSelector('.lock-note', { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('.pill.run'), null, { timeout: 30000 });
ok(/あと\s*0/.test(await page.innerText('#acct .credit')), 'second company made as a free preview (still 0)');
// a number not in the career: saving asks "press again" first, and the save must still resume after paying
await page.evaluate(() => window.__test.set((st) => { const x = st.companies.find((y) => y.name === '株式会社テスト三号'); x.doc.summary += '（延べ999件）'; }));
await save('[data-act=pdf]');
await page.waitForSelector('.packs');
ok((await page.innerText('#modal')).includes('画面で確認できています'), 'out of credits: purchase dialog says what this company needs');
ok((await page.innerText('#modal')).includes('英語での業務経験'), 'purchase dialog names what this company\'s interview is likely to press on');
ok((await page.innerText('#modal')).includes('差額で'), 'first purchase: says a small pack can be upgraded later');
await shot('buy');
// a fourth company cannot be made before buying (2 free previews)
ok((await api('/api/ai', { task: 'generate', ctx: { profile: { careers: [] } }, c: { id: 'zzzz9', name: '株式会社テスト九号', job: 'x', analysis: { company: '株式会社テスト九号' } } })).error.code === 'preview_limit', 'server: no third free preview');
await page.click('[data-act=buy][data-pack=p5]');
await page.waitForURL(/\/api\/dev\/pay/);
await page.click('#b');
await page.waitForURL((u) => !u.search.includes('paid') && u.pathname === '/', { timeout: 15000 });
await page.waitForSelector('[data-act=unlockOk]', { timeout: 30000 });
ok(/あと\s*5/.test(await page.innerText('#acct .credit')), 'paid pack added; the waiting save asks before using one');
{
  const dl = page.waitForEvent('download', { timeout: 20000 });
  await page.click('[data-act=unlockOk]');
  await dl;
  ok(/あと\s*4/.test(await page.innerText('#acct .credit')), 'saved after the purchase (5 → 4)');
}
ok((await page.locator('[data-cid], .co-it').count()) >= 3, 'data still there after the payment round trip');
await page.waitForFunction(() => !document.querySelector('.pill.run'), null, { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#sync').textContent === '保存済み', null, { timeout: 8000 });

// after a purchase: a posting from its URL, then the company's public information
await act('step', '[data-step="2"]');
await page.click('.vh [data-act=addCompany]');
const C4id = await cardOf(); const C4 = `[data-cid="${C4id}"]`;
await page.fill(C4 + ' [data-cf=jobUrl]', 'https://doda.jp/DodaFront/View/JobSearchDetail/j_jid__1/');
const errsBefore = errors.length;
await page.click(C4 + ' [data-act=fetchJob]');
await page.waitForSelector(C4 + ' .status.err', { timeout: 8000 });
errors.splice(errsBefore).filter((e) => !/status of 400/.test(e)).forEach((e) => errors.push(e));   // the refusal itself is expected
ok((await page.innerText(C4 + ' .status.err')).includes('自動では読み込めません'), 'job boards are not read (paste instead)');
await page.fill(C4 + ' [data-cf=jobUrl]', 'https://jobs.example.com/recruit/cs-lead');
await page.click(C4 + ' [data-act=fetchJob]');
await page.waitForFunction((S) => ((document.querySelector(S + ' [data-cf=job]') || {}).value || '').includes('カスタマーサクセス'), C4, { timeout: 10000 });
ok(true, 'posting read from its URL');
ok((await page.inputValue(C4 + ' [data-cf=name]')).includes('サンプルクラウド'), 'company name taken from the page');
await page.click(C4 + ' [data-act=analyze]');
await page.waitForSelector(C4 + ' .an', { timeout: 15000 });
const researched = async () => { await page.waitForFunction((S) => document.querySelector(S + ' .rs-facts') && !document.querySelector(S + ' .research .status'), C4, { timeout: 15000 }); };
await page.click(C4 + ' [data-act=research]');
await page.waitForSelector('[data-act=unlockOk]');
ok((await page.innerText('#modal')).includes('1社分を使います'), 'asked before research uses a credit');
await page.click('[data-act=unlockOk]');
await researched();
await shot('research');
ok(/あと\s*3/.test(await page.innerText('#acct .credit')), 'research uses the company\'s credit (4 → 3)');
ok((await page.innerText(C4 + ' .research')).includes('あと2回'), 'research count shown');
ok((await page.innerText(C4 + ' .research')).includes('事実5件'), 'result summary');
ok((await page.locator(C4 + ' .rs-src a').count()) > 0, 'each fact links its source');
for (let k = 0; k < 2; k++) { await page.click(C4 + ' [data-act=research]'); await researched(); }
ok((await page.innerText(C4 + ' .research')).includes('上限') && !(await page.isVisible(C4 + ' [data-act=research]')), 'research limited per company (no button)');
ok(await page.isVisible(C4 + ' [data-act=researchBack]'), 'previous result can be restored');
const fourth = await api('/api/ai', { task: 'research', ctx: {}, c: { id: C4id, name: await page.inputValue(C4 + ' [data-cf=name]'), job: await page.inputValue(C4 + ' [data-cf=job]') } });
ok(fourth.error && fourth.error.code === 'limit' && fourth.error.scope === 'research', 'server: research limited to 3 per company');
ok(/あと\s*3/.test(await page.innerText('#acct .credit')), 'credits unchanged by repeated research');
// a bigger pack within 30 days costs only the difference: bought 5社 (2,480円) -> 20社 for 4,500円, 15 more
{
  const meGet = async () => (await (await fetch(BASE + '/api/me', { headers: { authorization: 'Dev ' + user } })).json());
  const before = await meGet();
  ok(before.recent && before.recent.credits === 5 && before.recent.amount === 2480, 'recent purchase known (5社, 2,480円)');
  const r = await api('/api/dev/pay', { pack: 'p20', upgrade: true });
  const after = await meGet();
  ok(r.session && after.credits === before.credits + 15 && after.recent.amount === 6980, 'upgrade to 20社 adds 15 for the difference');
  ok((await api('/api/dev/pay', { pack: 'p10', upgrade: true })).error.code === 'upgrade', 'no "upgrade" to a smaller pack');
}
await page.waitForFunction(() => document.querySelector('#sync').textContent === '保存済み', null, { timeout: 8000 });

// another device: the same data from the server
const ctxB = await context(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctxB.addInitScript((u) => localStorage.setItem('resume-dev-user', u), user);
const pageB = await ctxB.newPage(); watch(pageB, errors);
await pageB.goto(BASE + '/');
await pageB.waitForSelector('#acct .credit');
await pageB.click('[data-act=step][data-step="2"]');
ok((await pageB.locator('[data-cid]').count()) === 4, 'another device sees all 応募先');
await pageB.screenshot({ path: OUT + 'mobile-step2.png', fullPage: false });

// conflict: B saves, then A (still on the old version) saves
await pageB.locator('[data-cid]').nth(0).locator('[data-cf=memo]').fill('端末Bでの指示');
await pageB.waitForFunction(() => document.querySelector('#sync').textContent === '保存済み', null, { timeout: 8000 });
await act('step', '[data-step="2"]');
await page.locator('[data-cid]').nth(0).locator('[data-cf=memo]').fill('端末Aでの指示');
await page.waitForSelector('[data-act=conflictLoad]', { timeout: 8000 });
ok(true, 'conflict detected on the older copy');
await act('conflictLoad');
await page.waitForTimeout(500);
ok((await page.locator('[data-cid]').nth(0).locator('[data-cf=memo]').inputValue()) === '端末Bでの指示', 'newer copy loaded');

// sign out of A -> its copy leaves this browser; landing page again
await act('devLogout');
await page.waitForSelector('#acct [data-act=login]');
ok(await page.evaluate((u) => !localStorage.getItem('resume-v1:dev_' + u), user), 'signed-out copy removed from the browser');

// delete the account on B
await pageB.click('[data-act=delAccount]');
await pageB.click('[data-act=delAccountOk]');
await pageB.waitForSelector('#acct [data-act=login]', { timeout: 10000 });
ok(await pageB.isVisible('#lp'), 'after deletion: landing page');
const me = await pageB.evaluate(async (u) => (await fetch('/api/workspace', { headers: { authorization: 'Dev ' + u } })).json(), user);
ok(me.data === null, 'server data gone');

await page.goto(BASE + '/'); await page.waitForTimeout(800);
await page.screenshot({ path: OUT + 'lp-after.png' });
const pageM = await ctxB.newPage(); await pageM.goto(BASE + '/'); await pageM.waitForTimeout(1200);
await pageM.screenshot({ path: OUT + 'mobile-lp.png', fullPage: true });

ok(errors.length === 0, 'no page errors' + (errors.length ? ':\n  ' + errors.join('\n  ') : ''));
writeFileSync(OUT + 'errors.txt', errors.join('\n'));
await browser.close();
console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
