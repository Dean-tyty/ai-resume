// Checks i18n/en.json and i18n/zh.json against i18n/keys.json: every key translated, the same {n} placeholders,
// no Japanese kana left in the English. Run: node tools/i18n-check.mjs
import { readFileSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const keys = JSON.parse(readFileSync(root + 'i18n/keys.json', 'utf8')).map((x) => x.k);
let bad = 0;
for (const lang of ['en', 'zh']) {
  const f = root + 'i18n/' + lang + '.json';
  if (!existsSync(f)) { console.log(lang, 'missing file'); bad++; continue; }
  const d = JSON.parse(readFileSync(f, 'utf8'));
  const ph = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join(',');
  const missing = keys.filter((k) => !(k in d));
  const wrongPh = keys.filter((k) => k in d && ph(k) !== ph(d[k]));
  const kana = lang === 'en' ? keys.filter((k) => k in d && /[぀-ヿ]/.test(d[k].replace(/【[^】]*】|（[^）]*[぀-ヿ][^）]*）|\([^)]*[぀-ヿ一-鿿][^)]*\)/g, ''))) : [];
  const zhKana = lang === 'zh' ? keys.filter((k) => k in d && /[぀-ゟ]/.test(d[k].replace(/【[^】]*】|（[^）]*）|\([^)]*\)/g, ''))) : [];
  console.log(`${lang}: ${keys.length - missing.length}/${keys.length} translated; placeholders differ: ${wrongPh.length}; kana left: ${kana.length + zhKana.length}`);
  [...missing.slice(0, 5).map((k) => 'missing: ' + k), ...wrongPh.slice(0, 5).map((k) => 'placeholders: ' + k + ' → ' + d[k]), ...kana.concat(zhKana).slice(0, 5).map((k) => 'kana: ' + k + ' → ' + d[k])].forEach((x) => console.log('  ' + x));
  bad += missing.length + wrongPh.length;
}
process.exit(bad ? 1 : 0);
