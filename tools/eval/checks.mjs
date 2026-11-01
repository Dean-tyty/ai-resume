// What code can check in a model's output, the same way the app checks it: no numbers the person didn't
// write, fits the pages, lengths the prompts ask for, Japanese characters (not simplified Chinese), stock
// phrases, translations present for English / Chinese readers. A case passes when nothing is broken.

const nd = (s) => String(s).replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))).replace(/,(?=\d{3})/g, '');
// numbers in `parts` that do not appear (as a whole number) in the source text
export function unknownNumbers(parts, source) {
  const src = nd(source); const bad = new Set();
  parts.forEach((t) => { (nd(t || '').match(/\d+(?:\.\d+)?/g) || []).forEach((n) => { const re = new RegExp('(^|[^0-9.])' + n.replace(/\./g, '\\.') + '(?![0-9]|\\.[0-9])'); if (!re.test(src)) bad.add(n); }); });
  return [...bad];
}
const A = (v) => (Array.isArray(v) ? v : []);
// the same parts as the app's docParts / packParts (periods and qualifications are left out there too)
const docParts = (d) => [d.summary, ...A(d.highlights).flatMap((x) => [x.value, x.label]), ...A(d.careers).flatMap((c) => [c.business, c.meta, ...A(c.blocks).flatMap((b) => [b.heading, b.overview, b.role, b.team, ...A(b.env), ...A(b.duties), ...A(b.achievements)])]), ...A(d.skills), ...A(d.tech), ...A(d.pr).map((p) => (p.heading || '') + ' ' + (p.body || ''))];
const packParts = (p, ja) => { const m = p.motivation || {}; return [m.long, m.short, ...A(p.questions).flatMap((q) => [q.answer, ...(ja ? A(q.points) : [])])]; };
const len = (s) => [...String(s || '').replace(/\s/g, '')].length;
const STOCK = ['伴走', '一貫した姿勢', '幅広い', '様々な', '貢献したいと考えています', '多岐にわたる'];

export function checkCase(cs, r, charfix) {
  const m = {}; const problems = [];
  const failed = Object.keys(r.errors); if (failed.length) problems.push('エラー: ' + failed.map((k) => k + '=' + r.errors[k]).join(','));
  const doc = r.steps.doc; const pack = r.steps.pack;
  if (doc) {
    m.docNumbers = unknownNumbers(docParts(doc), cs.raw);
    if (m.docNumbers.length) problems.push('職務経歴書に入力にない数字: ' + m.docNumbers.join(','));
    m.fits = !!(r.fit && r.fit.ok); m.fitRounds = r.fitRounds || 0;
    if (!m.fits) problems.push(`枚数に収まらない（${r.fit && r.fit.pages}/${r.fit && r.fit.maxPages}枚）`);
    const bullets = A(doc.careers).flatMap((c) => A(c.blocks).flatMap((b) => [...A(b.duties), ...A(b.achievements)]));
    m.bullets = bullets.length; m.bulletsTooLong = bullets.filter((b) => len(b) > 76).length;
    m.summaryChars = len(doc.summary); m.prCount = A(doc.pr).length;
    const text = JSON.stringify(doc);
    m.stock = STOCK.reduce((n, w) => n + (text.split(w).length - 1), 0);
    m.simplified = [...new Set([...text].filter((ch) => charfix[ch]))];
    if (m.simplified.length) problems.push('簡体字: ' + m.simplified.join(''));
    m.todo = (text.match(/【要記入/g) || []).length;
  }
  if (pack) {
    const mo = pack.motivation || {};
    m.packNumbers = unknownNumbers(packParts(pack, !cs.lang), cs.raw + '\n' + cs.job);
    if (m.packNumbers.length) problems.push('志望動機・回答例に入力・求人票にない数字: ' + m.packNumbers.join(','));
    const inRange = (t, lo, hi) => { const n = len(t); return n >= lo * 0.9 && n <= hi * 1.1; };
    m.motivationLong = len(mo.long); m.motivationShort = len(mo.short);
    const answers = A(pack.questions).map((q) => q.answer).filter(Boolean);
    m.questions = A(pack.questions).length;
    m.lengthOk = [inRange(mo.long, 280, 320), inRange(mo.short, 130, 160), ...answers.map((a) => inRange(a, 150, 220))];
    m.lengthOkRate = m.lengthOk.length ? Math.round(100 * m.lengthOk.filter(Boolean).length / m.lengthOk.length) : 0;
    if (m.lengthOkRate < 70) problems.push(`字数の指定から外れた文章が多い（${100 - m.lengthOkRate}%）`);
    if (m.questions < 7) problems.push('想定質問が少ない（' + m.questions + '問）');
    const ptext = JSON.stringify([mo.long, mo.short, answers]);
    m.packStock = STOCK.reduce((n, w) => n + (ptext.split(w).length - 1), 0);
    const simp = [...new Set([...ptext].filter((ch) => charfix[ch]))]; if (simp.length) problems.push('志望動機に簡体字: ' + simp.join(''));
    if (cs.lang) {
      const tr = [mo.long_tr, ...A(pack.questions).map((q) => q.answer_tr)];
      m.translated = Math.round(100 * tr.filter((t) => t && t.trim()).length / Math.max(1, tr.length));
      if (m.translated < 95) problems.push('訳が抜けている（' + m.translated + '%）');
      // the translation must be in the reader's language, not Japanese
      const kana = tr.filter((t) => /[぀-ヿ]{6,}/.test(String(t || '').replace(/【[^】]*】|「[^」]*」/g, ''))).length;
      if (kana) problems.push('訳が日本語のまま: ' + kana + '件');
    }
  }
  if (cs.lang && r.steps.explain) {
    const ex = r.steps.explain; m.explainSections = A(ex.sections).length;
    if (!m.explainSections) problems.push('解説が空');
  }
  m.stockTotal = (m.stock || 0) + (m.packStock || 0);
  if (m.stockTotal > 3) problems.push('定型句が多い（' + m.stockTotal + '）');
  return { pass: problems.length === 0, problems, metrics: m };
}

export function summarize(results, meta) {
  const n = results.length; const pass = results.filter((r) => r.checks.pass).length;
  const sum = (f) => results.reduce((a, r) => a + (f(r) || 0), 0);
  const judged = results.filter((r) => r.judge && r.judge.scores);
  const avg = (k) => (judged.length ? Math.round(100 * judged.reduce((a, r) => a + (r.judge.scores[k] || 0), 0) / judged.length) / 100 : null);
  return {
    ...meta, cases: n, passed: pass, passRate: n ? Math.round(100 * pass / n) : 0,
    errors: results.filter((r) => Object.keys(r.errors).length).length,
    inventedNumbers: results.filter((r) => (r.checks.metrics.docNumbers || []).length || (r.checks.metrics.packNumbers || []).length).length,
    notFitting: results.filter((r) => r.checks.metrics.fits === false).length,
    simplified: results.filter((r) => (r.checks.metrics.simplified || []).length).length,
    lengthOkRate: n ? Math.round(sum((r) => r.checks.metrics.lengthOkRate) / n) : 0,
    jsonRetries: sum((r) => r.usage.retried),
    tokens: { input: sum((r) => r.usage.input_tokens), output: sum((r) => r.usage.output_tokens) },
    secondsPerCase: n ? Math.round(sum((r) => r.usage.ms) / n / 1000) : 0,
    judge: judged.length ? { cases: judged.length, japanese: avg('japanese'), tailoring: avg('tailoring'), faithfulness: avg('faithfulness'), motivation: avg('motivation'), overall: avg('overall') } : null,
  };
}
