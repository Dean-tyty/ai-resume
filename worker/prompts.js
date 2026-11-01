// The prompts sent to Claude. They were tuned in the prototype; keep their wording when editing.
// ctx is what the browser sends: { today, name, raw, answers, intent, profile, explainLang }; c is one 応募先.
const J = (o) => JSON.stringify(o, null, 1);
function answersBlock(ctx) {
  const lines = [];
  Object.keys(ctx.answers || {}).forEach((k) => { const a = String(ctx.answers[k] || '').trim(); if (a) lines.push('Q: ' + k + '\nA: ' + a); });
  return lines.length ? '\n# 追加の回答（本人）\n' + lines.join('\n') : '';
}
function intentBlock(ctx, forDoc) {
  const it = ctx.intent || {}; const has = (it.reason || it.axis || it.conditions || '').trim();
  if (!has) return '\n# 本人の転職の軸\n（未入力。動機や転職理由を推測で作らない）';
  return `\n# 本人の転職の軸（本人の入力）\n転職理由：${it.reason || '（未入力）'}\n次の仕事で実現したいこと：${it.axis || '（未入力）'}\n希望条件：${it.conditions || '（未入力）'}\n${forDoc ? '※転職理由は書類にそのまま書かず、前向きな表現にする。希望条件（年収など）は書類に書かない。' : '※転職理由は面接で話せる前向きな表現に整える。'}`;
}
// /en/ and /zh/ pages: what the user reads is written in their language; what goes to the company stays Japanese
const UI = { en: '英語', zh: '中国語（簡体字）' };
const uiName = (ctx) => UI[ctx.uiLang] || '';
function slimProfile(ctx) { const p = Object.assign({}, ctx.profile || {}); delete p.missing; return p; }
function stripDoc(d) { const o = Object.assign({}, d || {}); delete o.name; delete o.date; delete o.title; return o; }
export function P_PROFILE(ctx) {
  return `あなたは日本の中途採用に精通したキャリアアドバイザー兼編集者です。
下の「本人の入力」から、職務経歴書をつくるための事実を構造化してください。今日の日付は${ctx.today}です。

# 厳守
1. 抽出と整理だけを行う。本人が書いていない数値・実績・役職・期間・資格・人数・業務（例：育成、マネジメント、予算管理）や顧客の規模・属性は作らない（推測で埋めない）。不明なら "" や [] にする。
2. 出力する文章はすべて自然なビジネス日本語にする。入力が中国語や英語でも日本語に訳す。
3. 固有名詞：日本企業は正式な社名。海外企業は一般的なカタカナ表記か英語表記（例：アリババグループ、Microsoft）。中国語の簡体字は日本の字体に直す（例：集团→集団）。
4. 期間は "YYYY-MM"（月が不明なら "YYYY"）。在籍中は end を "現在"。
5. careers と roles は新しい順。
6. episodes：面接や書類で使える具体的な事例を3〜8件。1件 = 1つの状況・行動・結果。原文の数字はそのまま metrics に入れる。
7. missing：書類の説得力を上げるために不足している情報への質問を最大5件。優先順：数値の口径（何の数値か・期間・母数）、本人の役割（主導か担当かチームの一員か）、規模、期間。入力が日本語以外の場合は、日本語力（JLPT等）と業務で日本語を使う場面の質問を必ず1つ含める。質問文は${uiName(ctx) ? uiName(ctx) + 'で書く（q と why の両方）' : '本人の入力と同じ言語で書く'}。すでに答えがある内容は聞かない。
8. education：学歴（高校卒業以降）。海外の学校は「英語表記（日本語の読み）」。
9. ITエンジニア（開発・インフラ・QA・PM・データなど）の経歴で、案件・プロジェクトごとの記述がある場合は roles[].projects に案件ごとに整理する。phases は担当した工程（要件定義・基本設計・詳細設計・実装・テスト・運用・保守）のうち本人の記述から分かるものだけ。env は本人が書いた言語・フレームワーク・DB・インフラ・OS・ツールだけ。エンジニア以外の経歴では projects は空配列。
10. skills.tech：本人が書いた技術スキル。years は本人が経験年数を書いた場合だけ（計算や推測で埋めない）。

# 出力形式（JSONのみ。説明文は不要）
{"careers":[{"company":"","start":"YYYY-MM","end":"YYYY-MM または 現在","business":"事業内容（30字以内）","employees":"従業員数（不明なら空）","employment":"雇用形態（不明なら空）","roles":[{"start":"","end":"","org":"部署","title":"役職・立場","team":"チーム規模など","duties":["担当業務（体言止め）"],"achievements":["実績（原文の数字を使う）"],"projects":[{"start":"","end":"","name":"案件名","overview":"","role":"立場（PL・メンバーなど）","team":"規模","phases":[""],"env":{"言語":[""],"FW":[""],"DB":[""],"インフラ":[""],"OS":[""],"ツール":[""]},"duties":[""],"achievements":[""]}]}]}],"episodes":[{"id":"E1","title":"20字以内の見出し","career_index":0,"role":"本人の役割（主導／担当／チームの一員 など。不明なら空）","situation":"","action":"","result":"","metrics":[""],"strengths":["発揮した強み"]}],"education":[{"date":"YYYY-MM","school":"学校名","detail":"学部・学科／卒業・修了"}],"skills":{"expertise":[""],"tools":[""],"languages":["言語と水準"],"tech":[{"cat":"言語|FW|DB|インフラ|ツール など","name":"","years":""}]},"qualifications":[{"date":"YYYY-MM","name":""}],"missing":[{"q":"質問","why":"なぜ必要か（短く）"}]}

# 本人の入力
氏名：${ctx.name || '（未記入）'}
"""
${ctx.raw}
"""${answersBlock(ctx)}`;
}
export function P_ANALYZE(ctx, c) {
  return `あなたは日本の中途採用の選考を熟知した採用コンサルタントです。
応募先の求人票と企業情報を読み、この候補者の経歴のうち「何を・どの順で・どう見せるか」という書類の方針を作ってください。

# 厳守
1. 企業の特徴は、求人票と企業情報の記述を最優先の根拠にする（source: "求人票" または "企業情報"）。あなたの一般知識で補う場合は source を "一般知識" とし、確信がないことは書かない。
2. 候補者の経歴にない事実は作らない。方針は既存の事例の選び方・順番・切り口で表現する。
3. 要件に対して経歴の裏付けが弱い点は gaps に正直に書き、書類でどう扱うか（盛らずにどう書くか）を添える。
4. episode_ids には候補者データの episodes の id だけを使う。
5. template：応募先の業界・社風に合う書類デザインを1つ選ぶ。standard＝罫線の表組み・明朝体（金融・メーカー・官公庁など伝統的な企業）、modern＝落ち着いたゴシック体（業界を問わない）、premium＝実績ハイライトと時系列表示（IT・Web・スタートアップ・外資系・コンサルなど）、engineer＝プロジェクトごとの表（役割・規模・担当工程・開発環境）とテクニカルスキル表。応募職種が ITエンジニア（開発・インフラ・QA・PM・データなど）で、候補者データに projects がある場合は engineer を選ぶ。premium は、応募職種が数値で成果を示しにくい職種（経理・総務・法務など）の場合や、応募要件に関係する強い数値実績が候補者データに2つ未満の場合は選ばない。

# 出力形式（JSONのみ）
{"company":"正式な会社名","position":"応募職種","summary":"この求人が本当に求めていることを1文で（60字以内）","values":[{"label":"重視していること（15字以内）","detail":"具体的に（50字以内）","source":"求人票|企業情報|一般知識","quote":"根拠となる原文の短い抜粋（30字以内、なければ空）"}],"requirements":[{"text":"要件（30字以内）","type":"必須|歓迎","match":"◎|○|△","evidence":"対応する経歴（30字以内）"}],"plan":[{"value":"values の label","episode_ids":["E1"],"angle":"その事例のどこをどう見せるか（60字以内）"}],"summary_angle":"職務要約の打ち出し方（60字以内）","pr_themes":["自己PRの見出し候補（20字以内）"],"keywords":["書類に自然に入れたい語"],"gaps":["裏付けが弱い点と書類での扱い方（60字以内）"],"template":"standard|modern|premium|engineer","template_reason":"選んだ理由（40字以内）"}
件数の目安：values 3〜5、requirements は求人票の要件すべて（最大8）、plan 2〜4、pr_themes 2〜3、keywords 5〜8。
${uiName(ctx) ? `言語：本人は${uiName(ctx)}で読みます。company・position・keywords・quote は日本語（求人票の表記）のまま、それ以外の文章（summary、values の label と detail、requirements の text と evidence、plan の angle、summary_angle、pr_themes、gaps、template_reason）は${uiName(ctx)}で書く。source と type と match の値は上の日本語のまま。
` : ''}
# 応募先
会社名：${c.name || '（求人票から読み取る）'}
本人の優先度：${c.priority}
本人からの追加指示：${c.memo || 'なし'}

## 求人票
"""
${(c.job || '').slice(0, 12000)}
"""
## 企業情報（任意）
"""
${(c.info || '').slice(0, 6000)}
"""

# 候補者データ
${J(slimProfile(ctx))}${answersBlock(ctx)}${intentBlock(ctx, true)}`;
}
function budget(c) {
  return c.maxPages >= 3 ? { a: 220, b: 320, d: 5, e: 4, p: '3', q: 180, r: 280 } : { a: 180, b: 250, d: 4, e: 3, p: '2〜3', q: 150, r: 220 };
}
const DOC_SCHEMA = '{"highlights":[{"value":"8.1%→4.3%","label":"担当領域の年間解約率"}],"summary":"","careers":[{"company":"","period":"2018年4月～現在","business":"事業内容（30字以内）","meta":"従業員数：約○名　／　雇用形態：正社員","blocks":[{"period":"","heading":"","duties":[""],"achievements":[""]}]}],"skills":[""],"tech":[""],"qualifications":[{"date":"2019年6月","name":""}],"pr":[{"heading":"","body":""}]}';
// IT engineers with projects in their data: one block per project, plus the テクニカルスキル table
const DOC_SCHEMA_ENG = '{"highlights":[],"summary":"","skillTable":[{"cat":"言語","name":"Java","years":"6年","level":"できること（30字以内）"}],"careers":[{"company":"","period":"","business":"","meta":"","blocks":[{"period":"2021年4月～2023年3月","heading":"プロジェクト名","overview":"","role":"","team":"","phases":["基本設計","実装"],"env":["言語：Java、TypeScript","DB：PostgreSQL"],"duties":[""],"achievements":[""]}]}],"skills":[""],"tech":[""],"qualifications":[{"date":"","name":""}],"pr":[{"heading":"","body":""}]}';
const isEngineer = (ctx, c) => !!((ctx.profile && (ctx.profile.careers || []).some((x) => (x.roles || []).some((r) => (r.projects || []).length))) || (c.analysis || {}).template === 'engineer');
function engineerRules(ctx, c) {
  if (!isEngineer(ctx, c)) return '';
  return `
# エンジニア形式（候補者データに projects がある経歴）
- その会社の block を1プロジェクトにする（新しい順）。heading はプロジェクト名（「物流会社向け 配送管理システムの刷新」の形、30字以内）。overview は目的と内容（50字以内）。role は立場（PL・メンバーなど）、team は規模（「5名（全体30名）」の形）。どちらもデータにある場合だけ。
- phases は担当工程を「要件定義」「基本設計」「詳細設計」「実装」「テスト」「運用・保守」から選ぶ。データから分かる工程だけ。
- env は「言語：Java、TypeScript」「FW：Spring Boot」「DB：PostgreSQL」「インフラ：AWS（ECS、RDS）」「OS：Linux」「ツール：GitHub、Jira」の形。データにあるものだけ、応募先の技術要件に関係するものを先に。
- この形式の duties は各 block 2〜4項目・各全角28字以内、achievements は 0〜3項目・各全角56字以内（表の列が狭いため）。古い・応募先と関係の薄いプロジェクトはまとめるか項目を減らす。
- skillTable（テクニカルスキル）：応募先の技術要件に関係する順に 5〜12行。cat は「言語」「FW」「DB」「インフラ」「ツール」など。years は候補者データに経験年数がある場合だけ書き、ない場合は ""（期間から計算しない）。level はそのスキルで何ができるかを候補者データの範囲で（30字以内）。
- tech は skillTable に入らないもの（語学など）だけ。
- エンジニア以外の経歴の block には overview・role・team・phases・env を書かない。
`;
}
export function P_GENERATE(ctx, c) {
  const b = budget(c); const a = c.analysis || {};
  return `あなたは日本の中途採用向け職務経歴書のプロの書き手です。下の「候補者データ」と「書類の方針」から、この応募先に最適化した職務経歴書の本文を作ってください。文章はそのまま A4 の決まったレイアウトに流し込まれます。

# 事実のルール（最重要）
- 候補者データにない事実・数値・役職・期間・人数・社名・業務・顧客の規模や属性を一切作らない（例：データにない「育成」「マネジメント」「中堅企業担当」を推測で書かない）。できるのは、選ぶ・並べ替える・言い換える・強調することだけ。
- 数値は候補者データの表記どおりに書く（丸めたり盛ったりしない）。
- 実績は、本人の役割（主導／担当／チームとして）が候補者データで分かる場合だけ明記する。分からない場合は役割を盛らない。

# 最適化のルール
- 方針（plan / summary_angle / pr_themes / keywords）に沿って、応募先に効く経歴・実績を前に出し、関係の薄い業務は短くする。
- keywords は自然に入る範囲で使う（不自然な詰め込みはしない）。
- 同じ数値は書類全体（highlights を含む）で2回まで。
- 自己PRは職務経歴の言い換えにしない。課題をどう捉え、どう工夫したか、なぜ応募先でも再現できるかを書く。最後に応募先でどう生かすかへ一言つなげてよい（事実を足さない範囲で）。
- 定型句を避け、具体的な言葉で書く（避ける例：「〜することで」の多用、「伴走」「一貫した姿勢」「幅広い」「様々な」「貢献したいと考えています」）。

# 文体と分量（レイアウトに収めるための制約）
- 職務要約・自己PRは「です・ます」調。業務内容・実績は体言止めの箇条書き。
- highlights（冒頭の実績ハイライト）：応募先の要件に関係し、本人の関わりが明確な数値実績を2〜3項目。value は候補者データの数値そのままで、比較の基準を含める（12字以内、例「8.1%→4.3%」「前年比132%」）。label は対象・期間・本人の関わりが分かる説明（24字以内）。条件に合う数値がなければ空配列。
- summary（職務要約）：${b.a}〜${b.b}字。
- careers：新しい順。期間は「2018年4月～2021年3月」「2021年4月～現在」の形に統一し、作成日（${ctx.today}）より後の日付は書かない。社名の表記は書類内で統一する（日本法人と海外本社を混同しない）。block の heading は「部署　役職（チーム規模）」の形。duties は各 block 2〜${b.d}項目、achievements は 1〜${b.e}項目。箇条書き1項目は全角38字以内（重要な実績だけ76字以内）。短くてよい項目は短く書く。応募先と関係の薄い古い経歴は block を1つにまとめ、項目を減らす。
- meta：「従業員数：約○名　／　雇用形態：正社員」の形。不明な項目は書かない。
- skills（活かせる経験・知識・技術）：3〜5項目、各45字以内。応募先の要件に対応する順に並べる。
- tech（スキル・ツール・語学）：0〜3項目。「ツール：A、B、C」「語学：英語（水準）」の形。
- qualifications：日付は「2019年6月」の形。省略しない。
- pr（自己PR）：${b.p}項目。heading は20字以内、body は${b.q}〜${b.r}字。
- 全体で A4 ${c.maxPages}枚に収まる分量にする。
- 中国語の簡体字は日本の字体にする。数字と英字は半角にする。
${engineerRules(ctx, c)}
# 出力形式（JSONのみ）
${isEngineer(ctx, c) ? DOC_SCHEMA_ENG : DOC_SCHEMA}

# 応募先：${a.company || c.name}（${a.position || ''}）
## 書類の方針
${J({ summary: a.summary, values: a.values, plan: a.plan, summary_angle: a.summary_angle, pr_themes: a.pr_themes, keywords: a.keywords, gaps: a.gaps })}
## 求人票（抜粋）
"""
${(c.job || '').slice(0, 5000)}
"""

# 候補者データ
${J(slimProfile(ctx))}${answersBlock(ctx)}${intentBlock(ctx, true)}`;
}
export function P_SHORTEN(ctx, c, rep) {
  const a = c.analysis || {};
  const why = rep.reason === 'orphan' ? '最終ページに数行だけはみ出しているため、' : `現在 ${rep.pages}枚になっているため、`;
  return `次の職務経歴書データは、決まったレイアウトで A4 ${c.maxPages}枚に収まりません。${why}あと約${rep.overLines}行分（全角でおよそ${rep.overChars}字）を減らしてください。

# 削り方（この順で）
1. 同じ数値・同じ話の重複（2回目以降の言及）
2. 応募先との関連が薄い経歴・古い経歴の業務内容（項目をまとめる・減らす）
3. 自己PR本文の前置き
4. 職務要約の冗長な部分
5. 箇条書きを1行（全角38字以内）に収める言い換え
# 守ること
- 応募先の方針で重要な実績と数値は残す。highlights は変えない。事実は変えない。新しい内容を足さない。
- 資格は削らない。プロジェクトの role・team・phases・env と skillTable はそのまま残す（減らすのは overview・duties・achievements）。
- 同じ JSON 構造で全体を返す（JSONのみ）。

# 応募先の方針（要点）
${J({ plan: a.plan, keywords: a.keywords })}
# 現在のデータ
${J(stripDoc(c.doc))}`;
}
export function P_PACK(ctx, c) {
  const a = c.analysis || {};
  return `あなたは日本の中途採用で面接官を多く務めてきた採用担当者です。以下の応募先と、候補者が実際に提出する職務経歴書にもとづいて、面接準備パックを作ってください。

# 厳守
- 回答例・志望動機は、提出する職務経歴書・候補者データ・本人の転職の軸に矛盾させない。そこにない具体的な手順・数字・エピソード・動機は足さない。足りない部分は【要記入：何を書くか】と書き、本人が埋められるようにする。
- 選考フローは、企業固有の公開情報が与えられていない限り「一般的な想定」であり、flow.note にそう書く。
- 回答例は丸暗記用の原稿にしない。話し言葉の「です・ます」で、話して30〜40秒（150〜220字）。要点は3つまで。
- 方針の gaps（経歴の弱い点）を突かれる質問を2問以上含め、盛らずに答える方法を示す。
- 質問は9問：自己紹介、転職理由、志望動機、強み・弱み、希望年収・入社可能時期・他社の選考状況（1問にまとめる）、この求人ならではの質問。候補者データの入力が日本語以外と読み取れる場合は、日本で働く理由や日本語での業務経験を問う質問を1問含める。

# 出力形式（JSONのみ）
${uiName(ctx) ? `{"motivation":{"long":"","short":"","long_tr":"long の${uiName(ctx)}訳","short_tr":""},"flow":{"note":"","steps":[{"name":"","who":"","focus":""}]},"questions":[{"q":"日本語の質問","q_tr":"q の${uiName(ctx)}訳","intent":"","points":[""],"answer":"日本語の回答例","answer_tr":"answer の${uiName(ctx)}訳"}],"reverse":["日本語の逆質問"],"reverse_tr":["reverse の${uiName(ctx)}訳"],"cautions":[""]}
件数：flow.steps 3〜5、questions 9、reverse 3、cautions 2〜4。
言語：面接は日本語なので、motivation の long と short、questions の q と answer、reverse は日本語で書く。本人は${uiName(ctx)}で読むので、*_tr にその忠実な訳を、flow（note・name・who・focus）、intent、points、cautions は${uiName(ctx)}で書く。【要記入】は訳でもそのまま残す。`
  : `{"motivation":{"long":"志望動機（280〜320字。転職の軸が未入力なら【要記入】を含める）","short":"志望動機（130〜160字）"},"flow":{"note":"","steps":[{"name":"","who":"","focus":""}]},"questions":[{"q":"","intent":"質問の意図","points":["回答の要点"],"answer":"回答例"}],"reverse":["逆質問"],"cautions":["注意点と対策"]}
件数：flow.steps 3〜5、questions 9、reverse 3、cautions 2〜4。`}

# 応募先：${a.company || c.name}（${a.position || ''}）
## 方針
${J({ summary: a.summary, values: a.values, gaps: a.gaps })}
## 求人票
"""
${(c.job || '').slice(0, 6000)}
"""
## 企業情報
"""
${(c.info || '').slice(0, 3000)}
"""
## 提出する職務経歴書
${J(stripDoc(c.doc))}

# 候補者データ
${J(slimProfile(ctx))}${intentBlock(ctx, false)}`;
}
export function P_PREP(ctx, c, i) {
  const a = c.analysis || {}; const st = c.stages[i];
  const past = c.stages.slice(0, i).map((s) => ({ step: s.name, status: s.status, date: s.date, format: s.format, interviewer: s.who, record: s.log }));
  return `あなたは日本の中途採用の面接対策コーチです。応募先「${a.company || c.name}」の選考で、本人がこれまでに受けた選考の記録をもとに、次の「${st.name}」の対策を作ってください。

# 厳守
- 根拠は、下の選考記録・提出した職務経歴書・候補者データ・方針だけ。面接官の意図や評価は推測であることがわかる書き方にする。
- 前回うまく答えられなかった点は、事実を盛らずに答え直す方法を示す。候補者データや記録にない具体例は足さず、必要なら【要記入：何を書くか】とする。
- 前回の質問と応募先の方針から、次の面接で深掘りされそうな点を予測する。記録がなければ方針と書類から予測する。
- 「${st.name}」で一般的に会う相手${st.who ? '（本人のメモ：' + st.who + '）' : ''}が気にすることに合わせる。

# 出力形式（JSONのみ）
{"summary":"ここまでの選考の要点（80字以内）","focus":["次の面接で見られそうな点"],"questions":[{"q":"","why":"そう予想する理由","points":["回答の要点"]${uiName(ctx) ? ',"q_tr":""' : ''}}],"fixes":[{"issue":"前回詰まった点","better":"答え直し方"${uiName(ctx) ? ',"better_tr":""' : ''}}],"reverse":["逆質問"],${uiName(ctx) ? '"reverse_tr":[""],' : ''}"checklist":["前日までにやること"]}
件数：focus 3、questions 5、fixes 0〜3、reverse 3、checklist 3〜5。
${uiName(ctx) ? `言語：面接は日本語なので、questions の q、fixes の better、reverse は日本語で書き、q_tr・better_tr・reverse_tr にその${uiName(ctx)}訳を書く。summary、focus、why、points、fixes の issue、checklist は${uiName(ctx)}で書く。
` : ''}
# 応募先の方針
${J({ position: a.position, summary: a.summary, values: a.values, gaps: a.gaps })}
# これまでの選考記録
${J(past)}
# 提出した職務経歴書
${J(stripDoc(c.doc))}
${c.pack && c.pack.motivation && c.pack.motivation.long ? '# 伝えている志望動機\n' + c.pack.motivation.long + '\n' : ''}
# 候補者データ
${J(slimProfile(ctx))}${intentBlock(ctx, false)}`;
}

export function P_RK(ctx, c) {
  const a = c.analysis || {};
  return `あなたは日本の中途採用の書類作成の専門家です。履歴書の「志望の動機、特技、好きな学科、アピールポイントなど」欄に入れる文章を作ってください。

# 厳守
- 候補者データ・本人の転職の軸・提出する職務経歴書にない事実や動機を作らない。足りない部分は【要記入：何を書くか】とする。
- です・ます調で200〜260字。職務経歴書の自己PRの繰り返しにせず、志望動機を中心に、生かせる経験を1つ添える。
- 中国語の簡体字は日本の字体にする。

# 出力形式（JSONのみ）
{"motive":""}

# 応募先：${a.company || c.name}（${a.position || ''}）
${J({ summary: a.summary, values: a.values })}
${c.pack && c.pack.motivation.long ? '# 面接用に作成済みの志望動機（参考）\n' + c.pack.motivation.long : ''}
# 提出する職務経歴書（要約と自己PR）
${J({ summary: (c.doc || {}).summary, pr: (c.doc || {}).pr })}
# 候補者データ
${J(slimProfile(ctx))}${intentBlock(ctx, true)}`;
}
const LANGS = { zh: '中国語（簡体字）', en: '英語' };
export function P_EXPLAIN(ctx, c) {
  const lang = LANGS[ctx.uiLang] || LANGS[ctx.explainLang] || LANGS.zh;
  return `あなたは日本の採用書類に詳しい日本語教師兼キャリアアドバイザーです。日本語が母語ではない求職者が、自分の職務経歴書の内容と日本語の書き方を母語で確認できるように、以下の職務経歴書を解説してください。解説の言語は${lang}です。

# やること
1. sections：書類の部分（職務要約、各職務経歴、活かせる経験・知識・技術、各自己PR）ごとに、日本語原文（ja）、その忠実な翻訳（tr、解説の言語）、日本の書類でこう書く理由や採用担当者の受け取り方（notes、解説の言語で1〜3点）。
2. naturalness：日本語として不自然・誤用・文体の不統一・直訳調の箇所を最大8件。ja は原文からそのまま抜き出した短い部分（30字以内、原文と完全一致）、issue は解説の言語で問題点、suggestion は修正後の日本語（ja を置き換える文字列）。問題がなければ空配列。
3. conventions：この書類に即した、日本の職務経歴書の書き方の要点を3〜6点（解説の言語）。例：体言止め、です・ます、「貴社」と「御社」、「以上」、数字や社名の書き方。

# 厳守
- 事実を足さない。翻訳は意訳しすぎない。naturalness の suggestion で事実を変えない。

# 出力形式（JSONのみ）
{"overview":"書類の全体像と、日本の採用担当者にどう読まれるか（解説の言語、120字程度）","sections":[{"title":"","ja":"","tr":"","notes":[""]}],"naturalness":[{"ja":"","issue":"","suggestion":""}],"conventions":[""]}

# 職務経歴書
${J(stripDoc(c.doc))}`;
}

export function P_ENGLISH(ctx, c) {
  const a = c.analysis || {};
  return `あなたは日本企業と外資系企業の採用に詳しいバイリンガルのレジュメライターです。下の「候補者データ」と「日本語の職務経歴書」から、この応募先に合わせた英文レジュメ（英語の履歴書兼職務経歴書）を作ってください。文章は A4 の1段組みのレイアウトに流し込まれます。

# 事実のルール（最重要）
- 候補者データと日本語の職務経歴書にない事実・数値・役職・期間・人数・社名・業務・顧客の規模や属性・成果を一切作らない。できるのは、選ぶ・並べ替える・英語で言い換えることだけ。
- 数値は元の表記どおり（丸めない）。意味を変えずに訳す（例：「前年比132%」→ "132% of the previous year"、「解約率 8.1%→4.3%」→ "from 8.1% to 4.3%"）。
- 成果に対する本人の役割（led / owned / as part of a team）は、データで分かる場合だけ書く。
- 学校名・社名の英語表記は、正式な英語名を知っている場合だけ使う。分からなければヘボン式で書き、株式会社は "Co., Ltd." または "Inc." にする（英語名を作らない）。

# 書き方
- name：本人のローマ字表記（${ctx.nameEn ? '「' + ctx.nameEn + '」をそのまま使い、name_guess は false' : '入力がないので、氏名をヘボン式で「名 姓」の順に書き、name_guess を true にする'}）。
- headline：本人の実際の経験に基づく肩書き（70字以内。例 "Customer Success Team Lead | B2B SaaS"）。
- summary：3〜4文・60〜90語。応募先の方針（plan / keywords）に沿って、関係の深い経験と成果を先に。一人称の "I" は使わない。
- experience：新しい順。period は "Apr 2022 – Present" の形。note は会社の事業を1行（80字以内、データにある範囲）。location はデータに勤務地がある場合だけ（なければ ""）。roles は役職・部署ごと。bullets は各 role 2〜5項目、1項目25語以内。現在の役職は現在形、過去は過去形の動詞で始め、文末にピリオドを付けない。応募先と関係の薄い古い経歴は短くする。
- skills：2〜4カテゴリ（語学は languages に入れる）。items は短い名詞句。
- education：高校は除く。学位は日本語の学部・学科から自然な英語にする（例：経済学部 経済学科 → "B.A. in Economics"）。
- certifications：英語圏で意味が伝わる書き方にする（例 "TOEIC Listening & Reading: 780"、"IT Passport (Japanese national IT certification)"）。応募先と関係のない運転免許などは省く。date は "Nov 2023" の形。
- languages：データにある水準だけ。本人の入力が日本語で書かれていれば日本語は "Native"。データにない水準を書かない。
- contact は書かない（アプリ側で入れる）。
- 全体で A4 1〜2枚（450〜650語程度）。
- 自然なビジネス英語（米国式つづり）。直訳調を避ける。

# 出力形式（JSONのみ）
{"name":"","name_guess":false,"headline":"","summary":"","experience":[{"company":"","location":"","period":"","note":"","roles":[{"title":"","period":"","bullets":[""]}]}],"skills":[{"cat":"","items":[""]}],"education":[{"school":"","degree":"","period":""}],"certifications":[{"name":"","date":""}],"languages":[{"lang":"","level":""}]}

# 応募先：${a.company || c.name}（${a.position || ''}）
## 書類の方針
${J({ summary: a.summary, plan: a.plan, summary_angle: a.summary_angle, keywords: a.keywords })}
## 求人票（抜粋）
"""
${(c.job || '').slice(0, 4000)}
"""
${c.doc ? '# 日本語の職務経歴書（この内容と矛盾させない）\n' + J(stripDoc(c.doc)) + '\n' : ''}
# 候補者データ
氏名：${ctx.name || '（未記入）'}
${J(slimProfile(ctx))}${answersBlock(ctx)}`;
}

export const PROMPTS = { P_PROFILE, P_ANALYZE, P_GENERATE, P_SHORTEN, P_PACK, P_PREP, P_RK, P_EXPLAIN, P_ENGLISH };
