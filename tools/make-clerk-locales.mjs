// Makes public/lib/clerk-ja.js, clerk-zh.js, clerk-en.js: Clerk's wording for its sign-in screens in the page's
// language (from @clerk/localizations), with the titles changed to this site's. Run after updating the package:
//   node tools/make-clerk-locales.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const v = require('@clerk/localizations/package.json').version;
const out = (lang, name, obj, from) => {
  writeFileSync(new URL(`../public/lib/clerk-${lang}.js`, import.meta.url), `/* Clerk localization ${from} (@clerk/localizations ${v}, MIT); made by tools/make-clerk-locales.mjs */\nwindow.${name} = ${JSON.stringify(obj)};\n`);
  console.log(`public/lib/clerk-${lang}.js`, v);
};
const ja = JSON.parse(JSON.stringify(require('@clerk/localizations/ja-JP').jaJP));
ja.signIn.start.title = '職務経歴書AI にログイン';
ja.signIn.start.subtitle = 'メールアドレス、または Google などのアカウントでログインできます';
ja.signUp.start.title = '職務経歴書AI のアカウントを作成';
ja.signUp.start.subtitle = '最初の1社分は無料です';
out('ja', 'CLERK_JA', ja, 'ja-JP');
const zh = JSON.parse(JSON.stringify(require('@clerk/localizations/zh-CN').zhCN));
zh.signIn.start.title = '登录 職務経歴書AI';
zh.signIn.start.subtitle = '可使用邮箱或 Google 等账号登录';
zh.signUp.start.title = '创建 職務経歴書AI 账号';
zh.signUp.start.subtitle = '第一家公司免费';
out('zh', 'CLERK_ZH', zh, 'zh-CN');
// English is Clerk's own wording; only the titles
out('en', 'CLERK_EN', { signIn: { start: { title: 'Log in to 職務経歴書AI', subtitle: 'Use your email address or a Google account' } }, signUp: { start: { title: 'Create your 職務経歴書AI account', subtitle: 'Your first company is free' } } }, 'en-US (titles only)');
