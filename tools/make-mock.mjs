// Makes worker/mock.json (the answers used when AI_MOCK = "1") from the sample data in public/demo.js.
// Run after changing the sample: node tools/make-mock.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const window = {};
new Function('window', readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8'))(window);
new Function('window', readFileSync(new URL('../public/demo-i18n.js', import.meta.url), 'utf8'))(window);
const D = window.DEMO; const X = window.DEMO_I18N || {};
const { missing, ...profile } = D.profile;
const mock = {
  profile: { ...profile, name: undefined, missing },
  analyze: D.analysis, generate: D.doc, shorten: D.doc, pack: D.pack, prep: D.prep,
  rk: { motive: '貴社の「顧客の成果から考える」という価値観に共感し、志望いたしました。【要記入：志望の決め手となった出来事】' },
  english: D.english,
  explain: { overview: D.explain.overview, sections: D.explain.sections, naturalness: D.explain.naturalness, conventions: D.explain.conventions },
  // the English / Chinese page (ctx.uiLang): the answers as the AI writes them for that page
  ...Object.fromEntries(['en', 'zh'].flatMap((l) => [
    ['analyze_' + l, X[l] && X[l].analysis], ['pack_' + l, X[l] && X[l].pack], ['prep_' + l, X[l] && X[l].prep],
    ['profile_' + l, X[l] && X[l].missing ? { ...profile, name: undefined, missing: X[l].missing } : null],
    ['explain_' + l, l === 'en' ? X.en && X.en.explain : { overview: D.explain.overview, sections: D.explain.sections, naturalness: D.explain.naturalness, conventions: D.explain.conventions }],
  ]).filter(([, v]) => v)),
  // the sample job posting, so trying it uses no credit (worker/ai.js)
  sampleJobHash: createHash('sha256').update(D.job.replace(/\s+/g, '')).digest('hex'),
};
writeFileSync(new URL('../worker/mock.json', import.meta.url), JSON.stringify(mock));
console.log('worker/mock.json', Object.keys(mock).join(' '));
