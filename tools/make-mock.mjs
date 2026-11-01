// Makes worker/mock.json (the answers used when AI_MOCK = "1") from the sample data in public/demo.js.
// Run after changing the sample: node tools/make-mock.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const window = {};
new Function('window', readFileSync(new URL('../public/demo.js', import.meta.url), 'utf8'))(window);
const D = window.DEMO;
const { missing, ...profile } = D.profile;
const mock = {
  profile: { ...profile, name: undefined, missing },
  analyze: D.analysis, generate: D.doc, shorten: D.doc, pack: D.pack, prep: D.prep,
  rk: { motive: '貴社の「顧客の成果から考える」という価値観に共感し、志望いたしました。【要記入：志望の決め手となった出来事】' },
  explain: { overview: D.explain.overview, sections: D.explain.sections, naturalness: D.explain.naturalness, conventions: D.explain.conventions },
};
writeFileSync(new URL('../worker/mock.json', import.meta.url), JSON.stringify(mock));
console.log('worker/mock.json', Object.keys(mock).join(' '));
