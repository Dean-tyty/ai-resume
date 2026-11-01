// Makes preview/dist: the page with a stand-in for the server (preview/preview.js), for looking at the screens
// without accounts — published as a claude.ai artifact for review. Run: node tools/make-preview.mjs
// The website's brand kit is copied in from a local build of the website (FLATLAND_DIST) when there is one.
import { cpSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
const root = new URL('../', import.meta.url).pathname;
const out = root + 'preview/dist/';
rmSync(out, { recursive: true, force: true }); mkdirSync(out, { recursive: true });
for (const f of ['app.js', 'app.css', 'engine.js', 'demo.js', 'demo-i18n.js', 'charfix.js', 'i18n.js', 'i18n', 'favicon.svg', 'lib', 'fonts', 'img']) if (existsSync(root + 'public/' + f)) cpSync(root + 'public/' + f, out + f, { recursive: true });
const dist = process.env.FLATLAND_DIST || '/home/claude/flatland/dist';
const kit = existsSync(dist + '/brand/kit/v1/kit.js');
if (kit) { mkdirSync(out + 'kit'); cpSync(dist + '/brand/kit/v1/kit.js', out + 'kit/kit.js'); cpSync(dist + '/brand/kit/v1/kit.css', out + 'kit/kit.css'); }
const mock = readFileSync(root + 'worker/mock.json', 'utf8');
writeFileSync(out + 'preview.js', readFileSync(root + 'preview/preview.js', 'utf8').replace('__MOCK__', mock));
// the Japanese page and the English / Chinese ones (a folder deeper): paths relative to the preview's root
for (const [from, to, up] of [['index.html', 'index.html', ''], ['en/index.html', 'en/index.html', '../'], ['zh/index.html', 'zh/index.html', '../']]) {
  if (!existsSync(root + 'public/' + from)) continue;
  let html = readFileSync(root + 'public/' + from, 'utf8')
    .replace('<script src="/config.js"></script>', `<script src="${up}preview.js"></script>`)
    // the language links: index.html files, as the preview has no server to find them
    .replace(/href="\/(en|zh)\/"/g, (m, l) => `href="${up}${l}/index.html"`).replace(/(<a href=")\/(" hreflang="ja")/, `$1${up}index.html$2`)
    .replace(/(src|href)="\/(?!\/)/g, `$1="${up}`)
    .replace('<title>', '<title>【プレビュー】');
  html = kit
    ? html.replace('https://www.flatland.co.jp/brand/kit/v1/kit.css', up + 'kit/kit.css').replace('https://www.flatland.co.jp/brand/kit/v1/kit.js', up + 'kit/kit.js')
    : html.replace(/<link rel="stylesheet" href="https:\/\/www\.flatland\.co\.jp[^>]*>\n/, '').replace(/<script src="https:\/\/www\.flatland\.co\.jp[^>]*><\/script>\n/, '');
  html = html.replace('</head>', '<style>.preview-ribbon{background:#0B1220;color:#fff;font-size:12.5px;padding:8px 16px;text-align:center;line-height:1.6}.preview-ribbon button{margin-left:10px;border:1px solid rgba(255,255,255,.5);background:none;color:#fff;border-radius:999px;padding:1px 10px;font:inherit;cursor:pointer}</style>\n</head>');
  mkdirSync(out + to.replace(/[^/]*$/, ''), { recursive: true });
  writeFileSync(out + to, html);
}
console.log('preview/dist', kit ? '(with the brand kit)' : '(brand kit not found: fallback header)');
