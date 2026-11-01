// report.md (the numbers) and report.html (the texts side by side with the input, for people to read)
import { writeFileSync } from 'node:fs';

const h = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const A = (v) => (Array.isArray(v) ? v : []);

export function writeReports(dir, s, results, cases) {
  const md = [`# ${s.model}${s.judge ? '（判定：' + s.judge + '）' : ''}`, '',
    `| 項目 | 値 |`, `|---|---|`,
    `| 合格 | ${s.passed}/${s.cases}（${s.passRate}%） |`, `| エラー | ${s.errors} |`, `| 入力にない数字 | ${s.inventedNumbers} 件 |`,
    `| 枚数に収まらない | ${s.notFitting} 件 |`, `| 簡体字 | ${s.simplified} 件 |`, `| 字数の指定どおり | ${s.lengthOkRate}% |`,
    `| JSON の再試行 | ${s.jsonRetries} 回 |`, `| トークン（入力／出力） | ${s.tokens.input.toLocaleString()} / ${s.tokens.output.toLocaleString()} |`, `| 1件あたりの時間 | ${s.secondsPerCase} 秒 |`,
    ...(s.judge ? [`| 判定の平均（日本語／最適化／事実／志望動機／総合） | ${s.judge.japanese} / ${s.judge.tailoring} / ${s.judge.faithfulness} / ${s.judge.motivation} / ${s.judge.overall} |`] : []),
    '', '## ケース', '', '| ケース | 結果 | 問題 |', '|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.checks.pass ? '合格' : '不合格'}${r.judge && r.judge.scores ? '（' + r.judge.scores.overall + '）' : ''} | ${r.checks.problems.join('<br>') || ''} |`)].join('\n');
  writeFileSync(dir + 'report.md', md + '\n');

  const caseOf = (id) => cases.find((c) => c.id === id) || {};
  const body = results.map((r) => {
    const cs = caseOf(r.id); const d = r.steps.doc || {}; const p = r.steps.pack || {};
    return `<section><h2>${h(r.id)} <small>${r.checks.pass ? '合格' : '不合格'}</small></h2>
${r.checks.problems.length ? `<ul class="bad">${r.checks.problems.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
${r.judge && r.judge.scores ? `<p class="j">判定：${Object.entries(r.judge.scores).map(([k, v]) => h(k) + ' ' + h(v)).join('・')}</p><ul>${A(r.judge.issues).map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}
<div class="cols"><div><h3>入力</h3><pre>${h(cs.raw)}</pre><h3>求人票</h3><pre>${h(cs.job)}</pre></div>
<div><h3>職務要約</h3><p>${h(d.summary)}</p><h3>職務経歴（抜粋）</h3>${A(d.careers).map((c) => `<p><b>${h(c.company)}</b></p>${A(c.blocks).map((b) => `<p>${h(b.heading)}</p><ul>${[...A(b.duties), ...A(b.achievements)].map((x) => `<li>${h(x)}</li>`).join('')}</ul>`).join('')}`).join('')}
<h3>自己PR</h3>${A(d.pr).map((x) => `<p><b>${h(x.heading)}</b><br>${h(x.body)}</p>`).join('')}
<h3>志望動機</h3><p>${h(p.motivation && p.motivation.long)}</p>${p.motivation && p.motivation.long_tr ? `<p class="tr">${h(p.motivation.long_tr)}</p>` : ''}
<h3>回答例（志望動機の質問）</h3><p>${h(p.questions && p.questions[2] && p.questions[2].answer)}</p></div></div></section>`;
  }).join('\n');
  writeFileSync(dir + 'report.html', `<!doctype html><meta charset="utf-8"><title>${h(s.model)}</title><style>body{font:14px/1.7 system-ui,sans-serif;max-width:1200px;margin:24px auto;padding:0 16px;color:#111}section{border-top:1px solid #ddd;padding:12px 0}.cols{display:grid;grid-template-columns:1fr 1.3fr;gap:24px}pre{white-space:pre-wrap;background:#f6f5f2;padding:10px;font-size:13px}.bad{color:#a40}.tr{color:#666}.j{color:#245}small{color:#666;font-weight:400}</style>
<h1>${h(s.model)}</h1><pre>${h(md.split('## ケース')[0])}</pre>${body}`);
}
