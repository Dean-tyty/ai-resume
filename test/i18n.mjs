// The English and Chinese pages (/en/, /zh/): the landing page and every screen of the sample, looking for
// page text left in Japanese. Run after `npm run dev`: LANG=C.UTF-8 node test/i18n.mjs
// Japanese that belongs there is not reported: the documents (canvas), what goes to the company (with a
// translation under it, .trl), the 解説 originals, and fields.
import { chromium, context, watch, BASE } from './browser.mjs';
const b = await chromium.launch();
let fails = 0;
for (const lang of (process.env.LANGS || 'en,zh').split(',')) {
  const ctx = await context(b, { viewport: { width: 1360, height: 950 } }); const p = await ctx.newPage();
  const errors = []; watch(p, errors);
  await p.addInitScript(() => { window.I18N_MISSING = new Set(); });
  await p.goto(BASE + '/' + lang + '/'); await p.waitForTimeout(900);
  const left = async (where) => {
    const found = await p.evaluate((lang) => {
      const out = new Set();
      const okParent = (el) => el.closest('[data-noi18n],textarea,script,style,.trl,#result,.plan .tag,.ex-tr,.ex-ov,.explain ul,.ex-n .cc');
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.trim(); const el = n.parentElement;
        // Japanese that is meant: quoted or in brackets (terms of the documents, a legal name), and the sample's names
        const bare = t.replace(/（[^）]*）|\([^)]*\)|「[^」]*」|“[^”]*”|【[^】]*】|株式会社サンプル\S*?(?=\s|$|[、。的：:])|サンプル\S+|カスタマーサクセスマネージャー|職務経歴書AI/g, '');
        // English page: no Japanese characters at all; Chinese page: no kana
        if (!t || !(lang === 'en' ? /[\u3041-\u3096\u30a1-\u30fa\u4e00-\u9fff]/ : /[\u3041-\u3096\u30a1-\u30fa]/).test(bare) || !el || okParent(el)) continue;
        if (el.closest('.hidden') || !el.getClientRects().length) continue;
        out.add(t.slice(0, 80));
      }
      return [...out];
    }, lang);
    // the product name and Japanese document terms in brackets are fine
    const bad = found.filter((t) => !/^職務経歴書AI$/.test(t) && !/^[（(].*[）)]$/.test(t));
    console.log(`${lang} ${where}: ${bad.length ? bad.length + ' Japanese text(s) left' : 'ok'}`);
    bad.slice(0, 25).forEach((t) => console.log('   · ' + t));
    fails += bad.length;
  };
  await left('landing page');
  await p.locator('[data-act="demo"]:visible').first().click(); await p.waitForTimeout(1200);
  for (const step of [1, 2, 3, 4]) {
    await p.evaluate((s) => { const b = document.querySelector(`[data-act="step"][data-step="${s}"]`); if (b) b.click(); }, step);
    await p.waitForTimeout(900);
    await left('sample step ' + step);
    if (step === 3) for (const tab of ['rireki', 'en', 'pack']) { await p.click(`[data-act="tab"][data-v="${tab}"]`); await p.waitForTimeout(900); await left('sample step 3 / ' + tab); }
  }
  // own data: login and consent dialogs, organising the career, a posting, documents, the purchase dialog
  await p.locator('.demo-bar [data-act=startOwn]:visible').first().click(); await p.waitForTimeout(500);
  await left('own step 1 (empty)');
  await p.click('[data-act=sampleRaw]'); await p.fill('#in-name', 'Wang Wei');
  await p.click('[data-act=extract]'); await p.waitForSelector('#devName');
  await left('login dialog');
  await p.fill('#devName', 'i18n' + lang + Date.now().toString(36)); await p.click('[data-act=devLogin]');
  await p.waitForSelector('[data-act=consentOk]', { timeout: 8000 });
  await left('consent dialog');
  await p.click('[data-act=consentOk]'); await p.waitForSelector('.eps', { timeout: 15000 }); await p.waitForTimeout(600);
  await left('own step 1 (organised)');
  await p.click('[data-act=step][data-step="2"]'); await p.click('.vh [data-act=sampleJob]'); await p.waitForTimeout(400);
  await left('own step 2 (posting added)');
  await p.click('[data-cid] [data-act=analyze]'); await p.waitForSelector('[data-cid] .an', { timeout: 15000 });
  await left('own step 2 (analysed)');
  await p.click('[data-cid] [data-act=generate]'); await p.waitForSelector('#preview canvas', { timeout: 30000 }); await p.waitForTimeout(800);
  await left('own step 3 (documents)');
  await p.click('[data-act=edit]'); await p.waitForTimeout(500);
  await left('own step 3 (editor)');
  await p.evaluate(() => { const b = document.querySelector('[data-act=openBuy]'); if (b) b.click(); }); await p.waitForTimeout(500);
  await left('purchase dialog');
  await p.screenshot({ path: `/tmp/i18n-${lang}.png` });
  if (errors.length) { console.log(lang, 'page errors:', errors); fails++; }
  await ctx.close();
}
await b.close();
console.log(fails ? `\n${fails} problem(s)` : '\nall translated');
process.exit(fails ? 1 : 0);
