// Copies pdf.js (the legacy build, for older Safari) and its character maps into public/lib/pdfjs, for reading
// an uploaded PDF résumé in the browser. Run after updating the package: node tools/vendor-pdfjs.mjs
import { cpSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const from = root + 'node_modules/pdfjs-dist/'; const to = root + 'public/lib/pdfjs/';
rmSync(to, { recursive: true, force: true }); mkdirSync(to, { recursive: true });
for (const f of ['pdf.min.mjs', 'pdf.worker.min.mjs']) cpSync(from + 'legacy/build/' + f, to + f);
cpSync(from + 'cmaps', to + 'cmaps', { recursive: true });
cpSync(from + 'LICENSE', to + 'LICENSE');
console.log('public/lib/pdfjs', JSON.parse(readFileSync(from + 'package.json', 'utf8')).version);
