// Lists the Japanese text of the page (public/app.js, public/index.html, design names of public/engine.js) as
// translation keys: i18n/keys.json. A key is a text node or attribute value as it appears on the page, with
// inserted values written {0}, {1}… (public/i18n.js looks text up the same way, numbers also as {n}).
// Run after changing page text: node tools/i18n-extract.mjs   (then add the new keys to i18n/en.json, zh.json)
import { readFileSync, writeFileSync } from 'node:fs';
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';
const root = new URL('../', import.meta.url).pathname;
const JA = /[぀-ヿ㐀-鿿！-｠　-〿]/;
const keys = new Map();
// text that is data, not page text (dates, the 学歴・職歴 lines of the 履歴書)
const IGNORE = new Set(['周日', '周一', '周二', '周三', '周四', '周五', '周六', '{0}年{1}月{2}日', '日月火水木金土', '{0}/{1}（{2}）', '年', '日', '月', '｜現在に至る', '一身上の都合により退職', '貴社の規定に従います。']);
const put = (k, where) => {
  k = k.replace(/\s+/g, ' ').trim();
  if (!k || !JA.test(k)) return;
  // an inserted value (${…}) is {n}; digits written in the text stay (public/i18n.js also tries all numbers as {n})
  let i = 0; k = k.replace(/\u0000/g, () => '{' + i++ + '}');
  if (!/[\u3040-\u30ff\u3400-\u9fff]/.test(k)) return;   // punctuation only
  if (IGNORE.has(k)) return;
  if (!keys.has(k)) keys.set(k, where);
};
const ATTR = /\b(placeholder|title|aria-label|alt|content)="([^"]*)"/g;
function htmlish(s, where) {
  // attributes first, then the text between tags
  let m; while ((m = ATTR.exec(s))) put(m[2], where + ' @' + m[1]);
  s.split(/<[^>]*>/).forEach((t) => t.split(/\u0002/).forEach((x) => put(x.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), where)));
}
// app.js: string literals and template literals (a ${…} part is {n})
const app = readFileSync(root + 'public/app.js', 'utf8');
const lineOf = (pos) => app.slice(0, pos).split('\n').length;
const ast = acorn.parse(app, { ecmaVersion: 'latest', sourceType: 'script', locations: false });
const inTemplate = new Set();
walk.full(ast, (n) => {
  if (n.type === 'TemplateLiteral') {
    const s = n.quasis.map((q) => q.value.cooked).join('\u0000');
    htmlish(s, 'app.js:' + lineOf(n.start));
  } else if (n.type === 'Literal' && typeof n.value === 'string' && JA.test(n.value)) {
    htmlish(n.value, 'app.js:' + lineOf(n.start));
  }
});
void inTemplate;
// index.html (the landing page)
const html = readFileSync(root + 'public/index.html', 'utf8').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
htmlish(html, 'index.html');
// design names and notes shown in the page
const w = {}; new Function('window', 'module', readFileSync(root + 'public/engine.js', 'utf8'))(w, undefined);
const E = w.ResumeEngine;
Object.values(E.THEMES).forEach((t) => { put(t.label, 'engine.js THEMES'); put(t.note, 'engine.js THEMES'); });
E.ACCENTS.forEach((a) => put(a.label, 'engine.js ACCENTS'));
// shown on the page but made elsewhere: values the AI gives (分析の出典・要件の種類), counts put together in code
['企業情報', '求人票', '必須', '歓迎', '配色', '{0}社', '{0}件', '{0}年', '{0}日'].forEach((k) => { if (!keys.has(k)) keys.set(k, 'extra'); });
const out = [...keys].map(([k, where]) => ({ k, where }));
writeFileSync(root + 'i18n/keys.json', JSON.stringify(out, null, 1));
console.log(out.length, 'keys → i18n/keys.json');
