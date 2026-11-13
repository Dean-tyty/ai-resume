// Makes worker/mock.json (the answers used when AI_MOCK = "1") from the sample data in public/demo.js.
// Run after changing the sample: node tools/make-mock.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const window = {};
new Function('window', readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8'))(window);
new Function('window', readFileSync(new URL('../public/demo-i18n.js', import.meta.url), 'utf8'))(window);
const D = window.DEMO; const X = window.DEMO_I18N || {};
const { missing, ...profile } = D.profile;
// the translations of the organised career, for the English / Chinese page
const withTr = (p, t) => (t ? { ...p, careers: p.careers.map((c, i) => ({ ...c, roles: c.roles.map((r, j) => ({ ...r, tr: ((t.roles || [])[i] || [])[j] || '' })) })), episodes: p.episodes.map((e) => ({ ...e, tr: (t.episodes || {})[e.id] || '' })) } : p);
// the gap question of the canned pack (中堅企業の顧客を担当した経験)
function taste(pk) { const q = pk.questions[6] || pk.questions[pk.questions.length - 1]; return { short: pk.motivation.short, ...(pk.motivation.short_tr ? { short_tr: pk.motivation.short_tr } : {}), question: q }; }
const mock = {
  profile: { ...profile, name: undefined, missing },
  analyze: D.analysis, generate: D.doc, shorten: D.doc, pack: D.pack, prep: D.prep,
  rk: { motive: '勤怠管理SaaSのカスタマーサクセスとして、解約率の改善と導入支援の仕組みづくりに取り組んできました。貴社が顧客の成果を起点に支援体制を広げている点に、この経験を生かせると考え、志望いたしました。【要記入：志望の決め手となった出来事】', hope: '貴社の規定に従います。' },
  english: D.english, research: D.research, sampleJob: D.job,
  // the free look: the short 志望動機 and one gap question of the pack
  taste: taste(D.pack),
  explain: { overview: D.explain.overview, sections: D.explain.sections, naturalness: D.explain.naturalness, conventions: D.explain.conventions },
  // the English / Chinese page (ctx.uiLang): the answers as the AI writes them for that page
  ...Object.fromEntries(['en', 'zh'].flatMap((l) => [
    ['analyze_' + l, X[l] && X[l].analysis], ['research_' + l, X[l] && X[l].research], ['pack_' + l, X[l] && X[l].pack], ['prep_' + l, X[l] && X[l].prep],
    ['taste_' + l, X[l] && X[l].pack ? taste(X[l].pack) : null],
    ['profile_' + l, X[l] && X[l].missing ? withTr({ ...profile, name: undefined, missing: X[l].missing }, X[l].profileTr) : null],
    ['explain_' + l, l === 'en' ? X.en && X.en.explain : { overview: D.explain.overview, sections: D.explain.sections, naturalness: D.explain.naturalness, conventions: D.explain.conventions }],
  ]).filter(([, v]) => v)),
  // the sample job posting, so trying it uses no credit (worker/ai.js)
  sampleJobHash: createHash('sha256').update(D.job.replace(/\s+/g, '')).digest('hex'),
};
writeFileSync(new URL('../worker/mock.json', import.meta.url), JSON.stringify(mock));
console.log('worker/mock.json', Object.keys(mock).join(' '));
