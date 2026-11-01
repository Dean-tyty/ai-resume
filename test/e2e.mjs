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

// 経歴: typing works before signing in; AI asks for login, then consent
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
await act('extract');
await page.waitForSelector('#agree');
ok(true, 'consent dialog before the first AI request');
await act('consentOk');
await page.waitForTimeout(300);
ok(await page.isVisible('#agree'), 'consent needs the checkbox');
await page.check('#agree');
await act('consentOk');
await page.waitForSelector('.eps', { timeout: 15000 });
ok(true, '経歴 organised (mock AI)');
await page.waitForFunction(() => document.querySelector('#sync').textContent === '保存済み', null, { timeout: 8000 });
ok(true, 'saved to the server');

// 応募先: the first one uses the free credit
await act('step', '[data-step="2"]');
await page.click('.vh [data-act=sampleJob]');
await page.waitForSelector('.credit-note');
ok((await page.innerText('.credit-note')).includes('残り1社分'), 'credit note before the first analysis');
await page.click('[data-cid] [data-act=analyze]');
await page.waitForSelector('[data-cid] .an', { timeout: 15000 });
ok((await page.innerText('#acct .credit')).includes('0'), 'analysis used the credit');
await page.click('[data-cid] [data-act=generate]');
await page.waitForSelector('#preview canvas', { timeout: 30000 });
await page.waitForFunction(() => !document.querySelector('.pill.run'), null, { timeout: 30000 });
await shot('doc');
ok(true, '職務経歴書 made and previewed');

// downloads
for (const kind of ['pdf', 'docx']) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click(`[data-act=${kind}]`).then(() => page.click(`[data-act=${kind}]`).catch(() => {}))]);
  const p = OUT + 'out.' + kind; await dl.saveAs(p);
  ok(/職務経歴書_山田太郎_\d{8}\.(pdf|docx)/.test(dl.suggestedFilename()), kind + ' downloaded as ' + dl.suggestedFilename());
}
await act('tab', '[data-v=rireki]');
await page.waitForSelector('#rkPreview canvas', { timeout: 15000 });
{
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=rkPdf]').then(() => page.click('[data-act=rkPdf]').catch(() => {}))]);
  await dl.saveAs(OUT + 'rireki.pdf');
  ok(dl.suggestedFilename().startsWith('履歴書_'), '履歴書 PDF downloaded');
}

// a second 応募先 with no credit left -> purchase
await act('step', '[data-step="2"]');
await page.click('.vh [data-act=addCompany]');
const second = page.locator('[data-cid]').nth(1);
await second.locator('[data-cf=name]').fill('株式会社テスト二号');
await second.locator('[data-cf=job]').fill('【募集職種】営業マネージャー\n【必須】法人営業経験3年以上');
ok((await second.locator('.credit-note').innerText()).includes('利用枠が残っていません'), 'no-credit note shown');
await second.locator('[data-act=analyze]').click();
await page.waitForSelector('.packs');
ok(true, 'purchase dialog opens when out of credits');
await shot('buy');
await page.click('[data-act=buy][data-pack=p5]');
await page.waitForURL(/\/api\/dev\/pay/);
await page.click('#b');
await page.waitForURL((u) => !u.search.includes('paid') && u.pathname === '/', { timeout: 15000 });
await page.waitForFunction(() => /残り\s*5/.test((document.querySelector('#acct .credit') || {}).textContent || ''), null, { timeout: 20000 });
ok(true, 'paid pack added (5)');
ok((await page.locator('[data-cid]').count()) === 2, 'data still there after the payment round trip');
await page.locator('[data-cid]').nth(1).locator('[data-act=analyze]').click();
await page.waitForSelector('[data-cid]:nth-child(2) .an, .stack > [data-cid]:nth-of-type(2) .an', { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => /残り\s*4/.test(document.querySelector('#acct .credit').textContent), null, { timeout: 15000 });
ok(true, 'second 応募先 analysed with a paid credit (4 left)');
await page.waitForFunction(() => document.querySelector('#sync').textContent === '保存済み', null, { timeout: 8000 });

// another device: the same data from the server
const ctxB = await context(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctxB.addInitScript((u) => localStorage.setItem('resume-dev-user', u), user);
const pageB = await ctxB.newPage(); watch(pageB, errors);
await pageB.goto(BASE + '/');
await pageB.waitForSelector('#acct .credit');
await pageB.click('[data-act=step][data-step="2"]');
ok((await pageB.locator('[data-cid]').count()) === 2, 'another device sees both 応募先');
await pageB.screenshot({ path: OUT + 'mobile-step2.png', fullPage: false });

// conflict: B saves, then A (still on the old version) saves
await pageB.locator('[data-cid]').nth(1).locator('[data-cf=memo]').fill('端末Bでの指示');
await pageB.waitForFunction(() => document.querySelector('#sync').textContent === '保存済み', null, { timeout: 8000 });
await page.locator('[data-cid]').nth(1).locator('[data-cf=memo]').fill('端末Aでの指示');
await page.waitForSelector('[data-act=conflictLoad]', { timeout: 8000 });
ok(true, 'conflict detected on the older copy');
await act('conflictLoad');
await page.waitForTimeout(500);
ok((await page.locator('[data-cid]').nth(1).locator('[data-cf=memo]').inputValue()) === '端末Bでの指示', 'newer copy loaded');

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
