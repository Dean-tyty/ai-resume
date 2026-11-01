// Several runs side by side, with a verdict against the bar in README（モデルの合格基準）.
//   node tools/eval/compare.mjs tools/eval/out/<run1> tools/eval/out/<run2> …
import { readFileSync } from 'node:fs';

const runs = process.argv.slice(2).map((d) => JSON.parse(readFileSync(d.replace(/\/?$/, '/') + 'results.json', 'utf8')).summary);
if (!runs.length) { console.error('usage: node tools/eval/compare.mjs <run dir> …'); process.exit(1); }
const ref = runs[0];
const verdict = (s) => {
  const why = [];
  if (s.passRate < 90) why.push('合格率 90% 未満');
  if (s.inventedNumbers > 0) why.push('入力にない数字');
  if (s.simplified > 0) why.push('簡体字');
  if (s.notFitting > 1) why.push('枚数');
  if (s.judge && ref.judge && s !== ref && s.judge.overall < ref.judge.overall - 0.3) why.push('判定が基準モデルより 0.3 以上低い');
  if (s.judge && s.judge.faithfulness < 4) why.push('事実の忠実さ 4 未満');
  return why.length ? '不可：' + why.join('、') : '可';
};
const rows = [
  ['モデル', (s) => s.model], ['合格', (s) => `${s.passed}/${s.cases}（${s.passRate}%）`], ['エラー', (s) => s.errors], ['入力にない数字', (s) => s.inventedNumbers],
  ['枚数に収まらない', (s) => s.notFitting], ['簡体字', (s) => s.simplified], ['字数どおり', (s) => s.lengthOkRate + '%'], ['JSON 再試行', (s) => s.jsonRetries],
  ['判定 総合', (s) => (s.judge ? s.judge.overall : '-')], ['判定 日本語', (s) => (s.judge ? s.judge.japanese : '-')], ['判定 事実', (s) => (s.judge ? s.judge.faithfulness : '-')],
  ['トークン 入力/出力', (s) => `${s.tokens.input}/${s.tokens.output}`], ['秒/件', (s) => s.secondsPerCase], ['判定', verdict],
];
console.log('| 項目 | ' + runs.map((_, i) => '#' + (i + 1)).join(' | ') + ' |');
console.log('|---|' + runs.map(() => '---').join('|') + '|');
for (const [name, f] of rows) console.log(`| ${name} | ${runs.map((s) => f(s)).join(' | ')} |`);
console.log('\n#1 を基準モデルとして比べています。');
