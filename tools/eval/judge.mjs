// A second model grades what code cannot: natural Japanese business writing, tailoring to the posting,
// faithfulness to the input, and the motivation statement. Use one fixed judge for every model compared
// (and preferably not the model being judged), and read the texts in report.html yourself as well.
import { callModel } from '../../worker/llm.js';

const A = (v) => (Array.isArray(v) ? v : []);
export async function judgeCase(env, cs, r) {
  const doc = r.steps.doc; const pack = r.steps.pack;
  if (!doc) return { error: 'no document' };
  const shown = {
    summary: doc.summary,
    careers: A(doc.careers).slice(0, 2).map((c) => ({ company: c.company, blocks: A(c.blocks).slice(0, 2).map((b) => ({ heading: b.heading, duties: b.duties, achievements: b.achievements })) })),
    pr: doc.pr, motivation: pack && pack.motivation ? pack.motivation.long : '', answer: pack && pack.questions && pack.questions[2] ? pack.questions[2].answer : '',
  };
  const prompt = `あなたは日本の中途採用で多くの書類を読んできた採用担当者です。AI が作った応募書類を、下の基準で厳しく採点してください。

# 採点（各 1〜5。5 = そのまま提出できる、3 = 手直しが必要、1 = 使えない）
- japanese：日本語の自然さ、ビジネス文書としての書き方（敬語・体言止め・です・ます の使い分け、直訳調や不自然な言い回しがないか）
- tailoring：求人票の要件に合わせて、どの経験を前に出すかが適切か
- faithfulness：本人の入力にない事実・数字・役割を作っていないか（盛っていれば 1〜2）。【要記入】で本人に任せた部分は減点しない
- motivation：志望動機と回答例に説得力があり、本人の経験と応募先がつながっているか
- overall：全体として、この書類で応募したいか

# 出力形式（JSONのみ）
{"scores":{"japanese":0,"tailoring":0,"faithfulness":0,"motivation":0,"overall":0},"issues":["具体的な問題点（最大5件、各60字以内）"]}

# 本人の入力
"""
${cs.raw}
"""
# 求人票
"""
${cs.job}
"""
# AI が作った書類（抜粋）
${JSON.stringify(shown, null, 1)}`;
  const j = await callModel(env, 'judge', prompt, 6000);
  return { scores: j.value.scores || {}, issues: A(j.value.issues).slice(0, 5), model: j.model };
}
