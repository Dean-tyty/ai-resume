// Makes the English and Chinese pages from the Japanese one: public/en/index.html, public/zh/index.html (the landing
// page translated, for search engines and a first paint without Japanese) and the dictionaries public/i18n/en.js,
// zh.js that public/i18n.js uses for everything the app draws later. Run after changing page text or i18n/*.json:
//   node tools/i18n-extract.mjs && node tools/i18n-check.mjs && node tools/make-lang-pages.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const SITE = 'https://resume.flatland.co.jp';
const src = readFileSync(root + 'public/index.html', 'utf8');
mkdirSync(root + 'public/i18n', { recursive: true });
for (const lang of ['en', 'zh']) {
  if (!existsSync(root + `i18n/${lang}.json`)) { console.log(`i18n/${lang}.json missing: skipped`); continue; }
  const dict = JSON.parse(readFileSync(root + `i18n/${lang}.json`, 'utf8'));
  writeFileSync(root + `public/i18n/${lang}.js`, `/* page text in ${lang === 'en' ? 'English' : 'Chinese'}; made by tools/make-lang-pages.mjs from i18n/${lang}.json */\nwindow.I18N = ${JSON.stringify({ lang, dict })};\n`);
  // the same lookup as public/i18n.js
  const NUM = /\d+(?:[.,]\d+)*/g;
  const pats = Object.keys(dict).filter((k) => /\{\d+\}/.test(k) && k.replace(/\{\d+\}|[\s、。・：:（）()「」『』【】\-–—／/|｜,.]/g, '').length >= 2).map((k) => {
    const order = []; const parts = k.split(/(\{\d+\})/);
    const re = new RegExp('^' + parts.map((p, i) => { const m = /^\{(\d+)\}$/.exec(p); if (m) { order.push(+m[1]); return i === 1 && !parts[0] || i === parts.length - 2 && !parts[parts.length - 1] ? '(.*?)' : '(.+?)'; } return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('') + '$');
    return { re, order, k, own: k.replace(/\{\d+\}/g, '').length };
  }).sort((a, b) => b.own - a.own);
  const fill = (t, v) => t.replace(/\{(\d+)\}/g, (m, i) => (v[+i] != null ? v[+i] : m));
  const missing = new Set();
  const tr = (s) => {
    if (!/[぀-ヿ㐀-鿿]/.test(s)) return s;
    const t = s.replace(/\s+/g, ' ').trim(); const lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0];
    if (t in dict) return lead + dict[t] + tail;
    const nums = []; let i = 0; const kn = t.replace(NUM, (m) => { nums.push(m); return '{' + i++ + '}'; });
    if (nums.length && kn in dict) return lead + fill(dict[kn], nums) + tail;
    for (const p of pats) { const m = p.re.exec(t); if (m) { const v = []; p.order.forEach((n, j) => { const x = m[j + 1]; const nx = []; let q = 0; const kx = x.replace(NUM, (y) => { nx.push(y); return '{' + q++ + '}'; }); v[n] = x in dict ? dict[x] : kx in dict ? fill(dict[kx], nx) : x; }); return lead + fill(dict[p.k], v) + tail; } }
    missing.add(t); return s;
  };
  const tag = lang === 'zh' ? 'zh-Hans' : 'en';
  let h = src;
  // keep scripts, styles, SVG and data-noi18n parts as they are; translate text and labels elsewhere
  const keep = [];
  h = h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>|<nav class="langs"[\s\S]*?<\/nav>/g, (m) => { keep.push(m); return `\u0000${keep.length - 1}\u0000`; });
  h = h.replace(/>([^<]+)</g, (m, t) => '>' + tr(t) + '<');
  h = h.replace(/\b(placeholder|title|aria-label|alt|content)="([^"]*)"/g, (m, a, v) => `${a}="${tr(v).replace(/"/g, '&quot;')}"`);
  h = h.replace(/\u0000(\d+)\u0000/g, (m, i) => keep[+i]);
  h = h.replace('<html lang="ja">', `<html lang="${tag}">`)
    .replace(`<link rel="canonical" href="${SITE}/">`, `<link rel="canonical" href="${SITE}/${lang}/">`)
    .replace(`<meta property="og:url" content="${SITE}/">`, `<meta property="og:url" content="${SITE}/${lang}/">`)
    .replace('<fl-header product="職務経歴書AI" home="/">', `<fl-header product="職務経歴書AI" home="/${lang}/">`)
    .replace('<a class="word" href="/">', `<a class="word" href="/${lang}/">`)
    .replace(' aria-current="page">日本語', '>日本語')
    .replace(`hreflang="${tag}" lang="${tag}">`, `hreflang="${tag}" lang="${tag}" aria-current="page">`)
    .replace('<script src="/lib/clerk-ja.js" defer></script>', `<script src="/lib/clerk-${lang}.js" defer></script>\n<script src="/i18n/${lang}.js" defer></script>\n<script src="/i18n.js" defer></script>`)
    .replace('<script src="/demo.js" defer></script>', '<script src="/demo.js" defer></script>\n<script src="/demo-i18n.js" defer></script>');
  mkdirSync(root + `public/${lang}`, { recursive: true });
  writeFileSync(root + `public/${lang}/index.html`, h);
  console.log(`public/${lang}/index.html`, missing.size ? 'untranslated: ' + [...missing].join(' | ') : 'all translated');
}
