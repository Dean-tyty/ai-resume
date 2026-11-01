// Renders the sample 職務経歴書 in every design (PDF, Word) and the 履歴書, for looking at the documents
// outside the browser. Run: node tools/render-docs.mjs [out dir]   (PNG pages too when pdftoppm is installed;
// the Word files also as PDF through LibreOffice when soffice is installed — LibreOffice's rendering, not Word's)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const root = new URL('../', import.meta.url).pathname;
const out = (process.argv[2] || root + 'test/out/docs').replace(/\/$/, '') + '/';
mkdirSync(out, { recursive: true });
const win = {}; win.window = win; win.self = win; win.globalThis = win;
const ctx = vm.createContext(Object.assign(win, { console, setTimeout, clearTimeout, TextEncoder, TextDecoder }));
const U8 = vm.runInContext('Uint8Array', ctx);   // the libraries check types against their own realm's
for (const f of ['lib/pdf-lib.min.js', 'lib/fontkit.umd.min.js', 'lib/jszip.min.js', 'engine.js', 'charfix.js', 'demo.js']) vm.runInContext(readFileSync(root + 'public/' + f, 'utf8'), ctx, { filename: f });
const E = win.ResumeEngine; const D = win.DEMO;
const bytes = {}; const fk = {};
for (const k of Object.keys(E.FONT_FILES)) { bytes[k] = new U8(readFileSync(root + 'public/' + E.FONT_FILES[k])); fk[k] = win.fontkit.create(bytes[k]); }
const meas = E.makeMeasurer(fk);
const inCtx = (v) => vm.runInContext('(' + JSON.stringify(v) + ')', ctx);
const doc = Object.assign(E.normalizeDoc(inCtx(D.doc)), { name: D.name, date: '2026年11月1日現在' });
const png = (pdf, base) => { try { execFileSync('pdftoppm', ['-png', '-r', '110', pdf, base]); } catch (e) { /* no pdftoppm */ } };
const designs = (process.env.DESIGNS || 'standard,modern,premium').split(',');
const targets = (process.env.TARGETS || '').split(',').filter(Boolean);
for (const theme of designs) {
  const lay = E.layout(doc, theme, meas, { accent: 'navy' });
  const pdf = await E.renderPDF(lay, bytes, win.PDFLib, win.fontkit, { title: '職務経歴書', author: D.name }, fk);
  writeFileSync(out + theme + '.pdf', pdf); png(out + theme + '.pdf', out + theme);
  for (const target of targets.length ? targets : ['']) {
    const name = theme + (target ? '-' + target : '') + '.docx';
    writeFileSync(out + name, await E.buildDocx(doc, theme, win.JSZip, { accent: 'navy', target }));
    try { execFileSync('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', out + 'word', out + name], { stdio: 'ignore' }); png(out + 'word/' + name.replace('.docx', '.pdf'), out + 'word/' + name.replace('.docx', '')); } catch (e) { /* no LibreOffice */ }
  }
  console.log(theme, lay.pageCount + ' pages');
}
const rk = inCtx(Object.assign({}, D.rireki, { date: '2026-11-01', name: D.name, era: 'west', photo: '', history: [{ text: '学歴', align: 'center' }, { ym: '2012-4', text: 'サンプル大学　経済学部　経済学科　入学' }, { ym: '2016-3', text: 'サンプル大学　経済学部　経済学科　卒業' }, { text: '' }, { text: '職歴', align: 'center' }, { ym: '2016-4', text: 'サンプルシステムズ株式会社　入社' }, { ym: '2022-3', text: '一身上の都合により退職' }, { ym: '2022-4', text: '株式会社サンプルリンク　入社' }, { text: '現在に至る' }, { text: '以上', align: 'right' }], licenses: [{ ym: '2017-6', text: '普通自動車第一種運転免許　取得' }], motive: '貴社の「顧客の成果から考える」という価値観に共感し、志望いたしました。', hope: '貴社の規定に従います。' }));
const rpdf = await E.renderPDF(E.layoutRireki(rk, meas), bytes, win.PDFLib, win.fontkit, { title: '履歴書', author: D.name }, fk);
writeFileSync(out + 'rireki.pdf', rpdf); png(out + 'rireki.pdf', out + 'rireki');
console.log('written to', out);
