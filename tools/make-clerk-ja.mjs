// Makes public/lib/clerk-ja.js: Clerk's Japanese wording for its sign-in screens (from @clerk/localizations),
// with a few words changed to the ones used on this site. Run after updating the package:
//   node tools/make-clerk-ja.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { jaJP } = require('@clerk/localizations/ja-JP');
const ja = JSON.parse(JSON.stringify(jaJP));
ja.signIn.start.title = '職務経歴書AI にログイン';
ja.signIn.start.subtitle = 'メールアドレス、または Google などのアカウントでログインできます';
ja.signUp.start.title = '職務経歴書AI のアカウントを作成';
ja.signUp.start.subtitle = '最初の1社分は無料です';
const v = require('@clerk/localizations/package.json').version;
writeFileSync(new URL('../public/lib/clerk-ja.js', import.meta.url), `/* Clerk localization ja-JP (@clerk/localizations ${v}, MIT); made by tools/make-clerk-ja.mjs */\nwindow.CLERK_JA = ${JSON.stringify(ja)};\n`);
console.log('public/lib/clerk-ja.js', v);
