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
// how the translations shown under the Japanese are written
const trRule = (ctx) => `${uiName(ctx)}訳では、【要記入：…】の印は【要記入】のまま残し、コロンの後の説明だけを訳す（例：【要記入：the reason you chose this company】）。${ctx.uiLang === 'zh' ? '中国語は中国大陸で自然な表現にし、日本語の漢語をそのまま使わない（例：中堅企業→中型企业、活用→使用・推广使用、法人営業→企业客户销售）。中国語の文中の引用は “” を使う。' : ''}`;
// rules shared by the documents: no role inflation, qualifiers kept, clients' names hidden unless the user says not to
const LEVEL_RULE = '- 役割・立場を表す言葉は候補者データより上げない（「参加」を「主導」、「担当」を「責任者」、「まとめた」を「率いた」、「サポート」を「推進」にしない）。「約」「以上」「前年比」「延べ」「月平均」など数値の限定語と、期間・人数・単位は候補者データのまま残す。';
const maskRule = (ctx) => (ctx.mask === false ? '' : '\n- 守秘：顧客名・取引先名・社内のプロジェクト名や製品コード名・未公表の数値（売上額・顧客数・単価など）は、本人がそのまま書いてよいと明記していない限り書かない。顧客は「大手通信会社」「従業員約300名の製造業」のように業界と規模（候補者データに規模がある場合だけ）で書き、金額は割合・倍率・前年比などの相対値が候補者データにあればそれを使う。在籍した会社の社名と、公開されている自社製品名はそのまま書く。');
// gaps of half a year or more between jobs, and jobs left within a year: told plainly, never invented
const GAP_RULE = '- 職歴の間に半年以上の空白がある場合や、在籍1年未満の会社がある場合は、隠さず弁解もしない。候補者データにその理由（出産・育児、介護、療養、留学、資格の勉強など）とその間にしたことがあれば、職務要約か該当する職歴に1文で事実だけを書き、働ける条件が整ったことがデータにあれば添える。理由がデータになければ書かない（作らない）。';
// the profile as the other prompts see it: without the questions and the translations shown on the page
function slimProfile(ctx) {
  const p = Object.assign({}, ctx.profile || {}); delete p.missing;
  if (Array.isArray(p.careers)) p.careers = p.careers.map((c) => (c && Array.isArray(c.roles) ? { ...c, roles: c.roles.map((r) => { const o = { ...r }; delete o.tr; return o; }) } : c));
  if (Array.isArray(p.episodes)) p.episodes = p.episodes.map((e) => { const o = { ...e }; delete o.tr; return o; });
  return p;
}
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
7. missing：書類の説得力を上げるために不足している情報への質問を最大5件。優先順：数値の口径（何の数値か・期間・母数）、本人の役割（主導か担当かチームの一員か）、規模、期間。職歴の間に半年以上の空白があるか、いま離職中と読み取れる場合は、その期間にしていたこと（理由を含む）と、いつから・どんな条件で働けるかを聞く質問を1つ含める。入力が日本語以外の場合は、日本語力（JLPT等）と業務で日本語を使う場面の質問を必ず1つ含める。質問文は${uiName(ctx) ? uiName(ctx) + 'で書く（q と why の両方）' : '本人の入力と同じ言語で書く'}。すでに答えがある内容は聞かない。
8. education：学歴（高校卒業以降）。海外の学校は「英語表記（日本語の読み）」。
9. ITエンジニア（開発・インフラ・QA・PM・データなど）の経歴で、案件・プロジェクトごとの記述がある場合は roles[].projects に案件ごとに整理する。phases は担当した工程（要件定義・基本設計・詳細設計・実装・テスト・運用・保守）のうち本人の記述から分かるものだけ。env は本人が書いた言語・フレームワーク・DB・インフラ・OS・ツールだけ。エンジニア以外の経歴では projects は空配列。
10. skills.tech：本人が書いた技術スキル。years は本人が経験年数を書いた場合だけ（計算や推測で埋めない）。
${uiName(ctx) ? `11. 本人は${uiName(ctx)}で読み、AI が正しく理解したかを確かめる。roles の tr に、その役割（部署・役職・主な業務・実績）を${uiName(ctx)}で1〜2文、episodes の tr に、その事例（見出しと結果）を${uiName(ctx)}で1文で書く（数字は原文どおり）。
` : ''}
# 出力形式（JSONのみ。説明文は不要）
{"careers":[{"company":"","start":"YYYY-MM","end":"YYYY-MM または 現在","business":"事業内容（30字以内）","employees":"従業員数（不明なら空）","employment":"雇用形態（不明なら空）","roles":[{"start":"","end":"","org":"部署","title":"役職・立場","team":"チーム規模など","duties":["担当業務（体言止め）"],"achievements":["実績（原文の数字を使う）"],${uiName(ctx) ? '"tr":"",' : ''}"projects":[{"start":"","end":"","name":"案件名","overview":"","role":"立場（PL・メンバーなど）","team":"規模","phases":[""],"env":{"言語":[""],"FW":[""],"DB":[""],"インフラ":[""],"OS":[""],"ツール":[""]},"duties":[""],"achievements":[""]}]}]}],"episodes":[{"id":"E1","title":"20字以内の見出し",${uiName(ctx) ? '"tr":"",' : ''}"career_index":0,"role":"本人の役割（主導／担当／チームの一員 など。不明なら空）","situation":"","action":"","result":"","metrics":[""],"strengths":["発揮した強み"]}],"education":[{"date":"YYYY-MM","school":"学校名","detail":"学部・学科／卒業・修了"}],"skills":{"expertise":[""],"tools":[""],"languages":["言語と水準"],"tech":[{"cat":"言語|FW|DB|インフラ|ツール など","name":"","years":""}]},"qualifications":[{"date":"YYYY-MM","name":""}],"missing":[{"q":"質問","why":"なぜ必要か（短く）"}]}

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
1. 企業の特徴は、求人票と企業情報の記述を最優先の根拠にする（source: "求人票" または "企業情報"）。公開情報の調査がある場合はそれも根拠にできる（source: "公開情報"）。あなたの一般知識で補う場合は source を "一般知識" とし、確信がないことは書かない。
2. 候補者の経歴にない事実は作らない。方針は既存の事例の選び方・順番・切り口で表現する。
3. 要件に対して経歴の裏付けが弱い点は gaps に正直に書き、書類でどう扱うか（盛らずにどう書くか）を添える。
4. episode_ids には候補者データの episodes の id だけを使う。
5. template：応募先の業界・社風に合う書類デザインを1つ選ぶ。standard＝罫線の表組み・明朝体（金融・メーカー・官公庁など伝統的な企業）、modern＝落ち着いたゴシック体（業界を問わない）、premium＝実績ハイライトと時系列表示（IT・Web・スタートアップ・外資系・コンサルなど）、engineer＝プロジェクトごとの表（役割・規模・担当工程・開発環境）とテクニカルスキル表。応募職種が ITエンジニア（開発・インフラ・QA・PM・データなど）で、候補者データに projects がある場合は engineer を選ぶ。premium は、応募職種が数値で成果を示しにくい職種（経理・総務・法務など）の場合や、応募要件に関係する強い数値実績が候補者データに2つ未満の場合は選ばない。

# 出力形式（JSONのみ）
{"company":"正式な会社名","position":"応募職種","summary":"この求人が本当に求めていることを1文で（60字以内）","values":[{"label":"重視していること（15字以内）","detail":"具体的に（50字以内）","source":"求人票|企業情報|公開情報|一般知識","quote":"根拠となる原文の短い抜粋（30字以内、なければ空）"}],"requirements":[{"text":"要件（30字以内）","type":"必須|歓迎","match":"◎|○|△","evidence":"対応する経歴（30字以内）"}],"plan":[{"value":"values の label","episode_ids":["E1"],"angle":"その事例のどこをどう見せるか（60字以内）"}],"summary_angle":"職務要約の打ち出し方（60字以内）","pr_themes":["自己PRの見出し候補（20字以内）"],"keywords":["書類に自然に入れたい語"],"gaps":["裏付けが弱い点と書類での扱い方（60字以内）"],"template":"standard|modern|premium|engineer","template_reason":"選んだ理由（40字以内）"}
件数の目安：values 3〜5、requirements は求人票の要件すべて（最大8）、plan 2〜4、pr_themes 2〜3、keywords 5〜8。
${uiName(ctx) ? `言語：本人は${uiName(ctx)}で読みます。company・position・keywords・quote は日本語（求人票の表記）のまま、それ以外の文章（summary、values の label と detail、requirements の text と evidence、plan の angle、summary_angle、pr_themes、gaps、template_reason）は${uiName(ctx)}で書く。source と type と match の値は上の日本語のまま。${ctx.uiLang === 'zh' ? '中国語は中国大陸で自然な表現にし、日本語の漢語をそのまま使わない（例：中堅企業→中型企业、活用→使用）。' : ''}
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
${researchBlock(c)}
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
${LEVEL_RULE}${maskRule(ctx)}
- 方針の values のうち source が「公開情報」のものは、見せ方を決めるためだけに使う。会社のニュース・数字・日付・スローガンは職務経歴書に書かない。
- 職務経歴書には応募先の社名・「貴社」「御社」・応募先のスローガンやバリューの名前を書かない（転職エージェント経由で他社にも出されたり、本人が使い回したりするため）。応募先に合わせるのは、事例の選び方・順番・言葉の選び方で行う。志望動機は履歴書と面接で伝える。
${GAP_RULE}
- 転職が3回以上ある場合は、職務要約で、経験に共通する軸（職種・顧客・身につけた力）を1文で示す。転職理由の弁解は書かない。

# 最適化のルール
- 方針（plan / summary_angle / pr_themes / keywords）に沿って、応募先に効く経歴・実績を前に出し、関係の薄い業務は短くする。
- keywords は自然に入る範囲で使う（不自然な詰め込みはしない）。
- 同じ数値は書類全体（highlights を含む）で2回まで。
- 自己PRは職務経歴の言い換えにしない。課題をどう捉え、どう工夫したか、なぜ次の職場でも再現できるかを書く。最後に、応募職種でどう生かすかへ一言つなげてよい（事実を足さない範囲で。社名は書かない）。
- 自己PRの項目どうしで、文の組み立てと締め方を変える（すべてを「〜は、次の職場でも生かせます」「〜と考えています」で終えない。応募職種へのつなぎは1項目だけでよい）。求人票の言い回しをそのまま繰り返すのは、同じ語につき書類全体で2回まで。本人の入力にある本人らしい言い方は、意味を変えずに残す。
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
- 「約」「以上」「前年比」「延べ」などの限定語、期間・人数・単位は削らない（削ると数字の意味が変わる）。役割の言葉を強くしない。
- 資格は削らない。プロジェクトの role・team・phases・env と skillTable はそのまま残す（減らすのは overview・duties・achievements）。
- 同じ JSON 構造で全体を返す（JSONのみ）。

# 応募先の方針（要点）
${J({ plan: a.plan, keywords: a.keywords })}
# 現在のデータ
${J(stripDoc(c.doc))}`;
}
export function P_PACK(ctx, c) {
  const a = c.analysis || {};
  return `あなたは日本の中途採用で面接官を多く務めてきた採用担当者です。以下の応募先と、候補者が実際に提出する職務経歴書にもとづいて、面接準備パックを作ってください。今日の日付は${ctx.today}です。

# 厳守
- 回答例・志望動機は、提出する職務経歴書・候補者データ・本人の転職の軸に矛盾させない。そこにない具体的な手順・数字・エピソード・動機は足さない。足りない部分は【要記入：何を書くか】と書き、本人が埋められるようにする。
- 選考フローは、企業固有の公開情報が与えられていない限り「一般的な想定」であり、flow.note にそう書く。
- 回答例は丸暗記用の原稿にしない。話し言葉の「です・ます」で、話して30〜40秒（150〜220字）。要点は3つまで。
- 応募先の呼び方：話す回答例と逆質問では「御社」、書く志望動機（motivation）では「貴社」。
- 本人の優先度が「併願」の場合、「第一志望」「御社だけ」など他社を受けていないと受け取られる言い方をしない。
${LEVEL_RULE}
- 職歴に半年以上の空白か在籍1年未満の会社がある場合、その理由を聞かれる質問を1問含め、事実を短く述べてから「今は働ける状態であること・その間に得たこと」へつなぐ答え方を示す。理由が候補者データになければ【要記入：その期間の理由と、していたこと】とする。
- 転職が3回以上ある場合、転職回数や一貫性を問う質問を1問含め、共通する軸で答える例を示す（転職理由が候補者データになければ【要記入】）。
- 方針の gaps（経歴の弱い点）を突かれる質問を2問以上含め、盛らずに答える方法を示す。
- 逆質問：求人票・企業情報・公開情報の調査で答えが分かることは聞かない。形は「前提（調べた事実、1文）＋自分の経験とのつながり＋公開情報では分からない問い」。条件だけの質問（年収・残業・休日）、口コミやネガティブな報道を前提にした質問、相手を試す質問、「はい／いいえ」で終わる質問はしない。調査の question_seeds は使ってよいが、本人の経験とのつながりを足す。
- 質問は9問：自己紹介、転職理由、志望動機、強み・弱み、希望年収・入社可能時期・他社の選考状況（1問にまとめる）、この求人ならではの質問。希望年収の答えは「現在の年収（データになければ【要記入：現在の年収】）→ 希望 → 相談の余地」の順にし、「〜まで下がってもよい」「〜以上であればお受けする」のような譲歩の下限を自分から言わせない。転職理由は、履歴書・エージェント・面接のどこでも同じ説明になるよう、本人の入力の事実から1つの筋にまとめる。候補者データの入力が日本語以外と読み取れる場合は、日本で働く理由や日本語での業務経験を問う質問と、在留資格・日本で長く働く予定を確かめる質問（答え方は事実だけを短く。在留期限などがデータになければ【要記入】）を含める。

${c.research && c.research.facts && c.research.facts.length && c.research.confidence !== 'low' ? `# 公開情報の使い方（下に調査がある）
- 「なぜこの会社か」には調査の事実を1つ（多くても2つ）だけ使う。本人の転職の軸か職務経歴書の事例と直接つながる事実に限る。つながる事実がなければ使わず【要記入：この会社を選ぶ理由】を残す。
- 形は「事実（短く、自分の言葉で）→ 本人の軸・経験とのつながり → 入社後にどう生かすか」。事実の紹介は全体の3分の1以下。
- 会社の文章を写さない。スローガン・バリューの引用は1か所・15字以内。理念やバリューへの共感だけを志望理由の中心にしない（中心は事業・顧客・この職種の役割と本人の経験の接点）。
- 売上・調達額・株価・順位などの数字は志望動機に入れない。会社の課題を断定しない。
- ニュースは時期を入れて書く（例「2026年4月に発表された〜」）。今日から1年以上前のニュースは志望動機に使わない。
- 使った事実の id を motivation.used に入れる（例 ["F2"]）。使わなければ空配列。
` : ''}
# 出力形式（JSONのみ）
${uiName(ctx) ? `{"motivation":{"long":"","short":"","long_tr":"long の${uiName(ctx)}訳","short_tr":"","used":["使った公開情報の id"]},"flow":{"note":"","steps":[{"name":"","who":"","focus":""}]},"questions":[{"q":"日本語の質問","q_tr":"q の${uiName(ctx)}訳","intent":"","points":[""],"answer":"日本語の回答例","answer_easy":"同じ内容のやさしい日本語版","answer_tr":"answer の${uiName(ctx)}訳"}],"reverse":["日本語の逆質問"],"reverse_tr":["reverse の${uiName(ctx)}訳"],"cautions":[""]}
件数：flow.steps 3〜5、questions 9、reverse 3、cautions 2〜4。
言語：面接は日本語なので、motivation の long と short、questions の q と answer と answer_easy、reverse は日本語で書く。本人は${uiName(ctx)}で読むので、*_tr にその忠実な訳を、flow（note・name・who・focus）、intent、points、cautions は${uiName(ctx)}で書く。${trRule(ctx)}
answer_easy：日本語が母語でない人が自分の言葉で話せるように、answer と同じ要点を、短い文（1文40字以内）・よく使う語彙（日本語能力試験 N3〜N2 程度）・敬語は「です・ます」と基本の謙譲語だけで書く（100〜160字）。`
  : `{"motivation":{"long":"志望動機（280〜320字。転職の軸が未入力なら【要記入】を含める）","short":"志望動機（130〜160字）","used":["使った公開情報の id"]},"flow":{"note":"","steps":[{"name":"","who":"","focus":""}]},"questions":[{"q":"","intent":"質問の意図","points":["回答の要点"],"answer":"回答例"}],"reverse":["逆質問"],"cautions":["注意点と対策"]}
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
${researchBlock(c)}## 提出する職務経歴書
${J(stripDoc(c.doc))}

# 候補者データ
${J(slimProfile(ctx))}${intentBlock(ctx, false)}`;
}
export function P_PREP(ctx, c, i) {
  const a = c.analysis || {}; const st = c.stages[i];
  const past = c.stages.slice(0, i).map((s) => ({ step: s.name, status: s.status, date: s.date, format: s.format, interviewer: s.who, record: s.log }));
  return `あなたは日本の中途採用の面接対策コーチです（本人の優先度：${c.priority}）。応募先「${a.company || c.name}」の選考で、本人がこれまでに受けた選考の記録をもとに、次の「${st.name}」の対策を作ってください。今日の日付は${ctx.today}です。

# 厳守
- 根拠は、下の選考記録・提出した職務経歴書・候補者データ・方針だけ。面接官の意図や評価は推測であることがわかる書き方にする。
- 前回うまく答えられなかった点は、事実を盛らずに答え直す方法を示す。候補者データや記録にない具体例は足さず、必要なら【要記入：何を書くか】とする。
- 話す言葉（答え直し方・逆質問）では応募先を「御社」と呼ぶ。本人の優先度が「併願」なら「第一志望」と言わせない。
- 前回の質問と応募先の方針から、次の面接で深掘りされそうな点を予測する。記録がなければ方針と書類から予測する。
- 面接の記録がない場合は、前回の面接があったように書かない（fixes は空の配列にし、summary・focus・questions でも「前回」「一次では」などと書かない）。
- 「${st.name}」で一般的に会う相手${st.who ? '（本人のメモ：' + st.who + '）' : ''}が気にすることに合わせる。
- 公開情報の調査がある場合、この面接の相手に合う事実を1〜2個だけ使う（現場・マネージャー → 職種・部署・プロダクト・社員インタビュー、部門長 → 部門の方針・募集背景、役員・社長 → 中期経営計画・トップメッセージ・直近の決算で会社が説明した重点）。使う場合は checklist に「使う事実のリンク先を開き、日付と内容が今も正しいか確かめる」を入れる。
- 逆質問：求人票・公開情報の調査・これまでの選考記録で答えが分かることは聞かない。「前提（調べた事実か面接で聞いたこと、1文）＋自分の経験とのつながり＋公開情報では分からない問い」の形で、相手に合わせる。一次・二次では条件だけの質問（年収・残業・休日）をしない。口コミ・ネガティブな報道・面接官個人の情報を前提にしない。

# 出力形式（JSONのみ）
{"summary":"ここまでの選考の要点（80字以内）","focus":["次の面接で見られそうな点"],"questions":[{"q":"","why":"そう予想する理由","points":["回答の要点"]${uiName(ctx) ? ',"q_tr":""' : ''}}],"fixes":[{"issue":"前回詰まった点","better":"答え直し方"${uiName(ctx) ? ',"better_tr":""' : ''}}],"reverse":["逆質問"],${uiName(ctx) ? '"reverse_tr":[""],' : ''}"checklist":["前日までにやること"]}
件数：focus 3、questions 5、fixes 0〜3、reverse 3、checklist 3〜5。
${uiName(ctx) ? `言語：面接は日本語なので、questions の q、fixes の better、reverse は日本語で書き、q_tr・better_tr・reverse_tr にその${uiName(ctx)}訳を書く。summary、focus、why、points、fixes の issue、checklist は${uiName(ctx)}で書く。${trRule(ctx)}
` : ''}
# 応募先の方針
${J({ position: a.position, summary: a.summary, values: a.values, gaps: a.gaps })}
${researchBlock(c)}# これまでの選考記録
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
- 公開情報の調査がある場合、使うのは事業・顧客・職種に関する変わりにくい事実を1つまで。ニュース・数字・日付・スローガンの引用は入れない（履歴書は提出後も残り、面接で読み返されるため）。面接用の志望動機の文をそのまま使わない（骨子は同じでよい）。
- 書き言葉なので応募先は「貴社」と呼ぶ。本人の優先度が「併願」なら「第一志望」と書かない。
- hope（本人希望記入欄）：本人の希望条件のうち、勤務地・勤務時間・勤務形態・職種・入社可能時期など、譲れない条件だけを「勤務地：東京都内を希望いたします。」のように1〜3文で書く。年収・待遇の希望は書かず「給与・待遇は貴社の規定に従います。」とする。希望条件が未入力か譲れない条件がなければ「貴社の規定に従います。」だけにする。
- 中国語の簡体字は日本の字体にする。

# 出力形式（JSONのみ）
${uiName(ctx) ? `{"motive":"","motive_tr":"motive の${uiName(ctx)}訳","hope":"","hope_tr":"hope の${uiName(ctx)}訳"}
本人は${uiName(ctx)}で読むので motive_tr・hope_tr に忠実な訳を書く（motive・hope は日本語）。${trRule(ctx)}` : '{"motive":"","hope":""}'}

# 応募先：${a.company || c.name}（${a.position || ''}）（本人の優先度：${c.priority}）
${J({ summary: a.summary, values: a.values })}
${c.pack && c.pack.motivation.long ? '# 面接用に作成済みの志望動機（参考）\n' + c.pack.motivation.long : ''}
${researchBlock(c)}# 提出する職務経歴書（要約と自己PR）
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
- 事実を足さない。翻訳は意訳しすぎない。naturalness の suggestion で事実を変えない。役割の言葉を強くしない（「まとめた」→「率いた」、「担当」→「主導」などにしない）。数値の限定語（約・以上・前年比など）を消さない。

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
- 成果に対する本人の役割（led / owned / as part of a team）は、データで分かる場合だけ書く。役職名を英語にするときに格上げしない（「リーダー」を Manager、「担当」を Head にしない）。"about"・"over"・"year over year" など数値の限定語は残す。${maskRule(ctx).replace('\n- 守秘：', '\n- Confidentiality（守秘）：')}
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

// sources: pages already found (search API + the company's own pages, worker/research.js); without them the
// model searches itself (Anthropic web search)
export function P_RESEARCH(ctx, c, sources) {
  const a = c.analysis || {}; const L = uiName(ctx);
  const hosts = (c.hosts || []).filter(Boolean);
  const given = Array.isArray(sources) && sources.length > 0;
  return `あなたは日本の中途採用に詳しい企業リサーチャーです。今日の日付は${ctx.today}です。下の応募先について${given ? '、下の「資料」だけを根拠に' : ' web_search で公開情報を調べ、'}志望動機・面接準備・逆質問の材料になる事実を、出典付きでまとめてください。候補者の情報は与えられていません。候補者の経験と結びつけるのは後の工程なので、ここでは会社側のことだけを書きます。

# まず、同じ会社か確かめる
- 手がかり：正式名称、本社所在地、事業内容、求人票の内容${hosts.length ? `、本人が示したページのドメイン（${hosts.join('、')}）` : ''}。
- 求人票に社名がない（「大手メーカー」「非公開」など）、または同じ名前の会社が絞り込めない場合は調べるのをやめ、confidence を "low"、facts を空にし、caveats に理由を書く。
- 親会社・子会社・海外本社・グループの別会社の情報は、応募先の情報として書かない。どうしても使う場合は entity を "グループ" にし、本文に「親会社の〜」のように明記する。

${given ? `# 資料の使い方
- 資料（検索結果の要約と、会社のページの抜粋）にあることだけを書く。資料にないことを、知識で補わない。
- 見る順番の目安：会社概要・事業紹介（同じ会社か確かめる）→ 採用ページ（募集背景・求める人物像・この職種の仕事）→ IR・中期経営計画・トップメッセージ・決算 → 今日から12か月以内のニュース。
- 掲示板・まとめサイト・個人ブログの評判は使わない。
` : `# 調べ方（web_search は最大5回。検索語は会社名・事業名・職種名だけ。候補者の情報は使わない）
1. 公式サイトの会社概要・事業紹介（同じ会社か確かめる）
2. 採用ページ：募集背景・求める人物像・社員インタビュー・この職種の仕事
3. 上場企業は IR（直近の決算説明資料・中期経営計画）、未上場はプレスリリース（資金調達の使い道・事業計画）。あわせて社長・トップのメッセージ
4. 今日から12か月以内のニュースリリース・報道
5. 職種に合わせて1回（エンジニア：技術ブログ、営業・CS：導入事例、企画・マーケ：新サービス）
- 口コミサイト・掲示板・まとめサイト・個人ブログの評判は使わない。
`}
# 書き方
- 事実だけを書く。推測や評価（「成長企業」「働きやすい」など）は書かない。強みは「会社は〜を強みとして説明」の形にする。
- 書かないもの：設立年・資本金・受賞歴・CSR活動・株価・求人票と同じ内容・業界一般の話・競合他社の名前を出した比較。
- 決算は、会社が説明した増減の理由と注力領域を1つ。数字は1つまで。
- 「最近の動き」は今日から12か月以内の発表だけ。日付が確かめられないニュースは書かない。中期経営計画・トップメッセージは最新のものだけ。2年以上前の情報は書かない（日付のない会社概要・事業紹介は除く）。
- facts と position の各項目には、${given ? '根拠にした資料の url をそのまま' : '実際に検索結果で見たページの url をそのまま'}書き、分かれば時期（YYYY-MM）を date に書く。
- 見つからなかった項目は書かない（件数を埋めるために作らない）。
- hooks：志望動機の材料になりそうな事実と、その理由（会社側の視点）。候補者の経験には触れない。
- questions：facts を前提にした、公開情報では答えが分からない問いだけ。サイトや求人票を読めば答えが分かる問い（事業内容・制度・拠点など）、条件だけの問い（年収・残業・休日）、相手を試す問い、「はい／いいえ」で終わる問いは書かない。for は聞く相手（現場・マネージャーには仕事の進め方とチーム、部門長には部門の課題と期待、役員には事業の方向性）。
- check_yourself：公開情報では分からず、入社を判断するために説明会・面接・人事面談で確かめるとよい点（point）と、その中立な聞き方（ask、日本語）。
${L ? `- 言語：本人は${L}で読む。company は日本語の正式名称、questions の q と check_yourself の ask は日本語（面接で使うため）で書き、q_tr・ask_tr にその${L}訳を書く。topic・entity・for は下の日本語の選択肢のまま。それ以外の文章（overview、hiring_context、identity.match、facts と position の text、hooks の why、check_yourself の point、caveats）は${L}で書く。会社固有の名前（制度・製品・部署・スローガン）は日本語の原文を「」で残し、訳を（）で添える（本人が会社のサイトと照らし合わせ、面接で言えるように）。${ctx.uiLang === 'zh' ? '中国語は中国大陸で自然な表現にし、日本語の漢語をそのまま使わない。' : ''}\n` : ''}
# 出力形式（JSONのみ）
{"company":"正式な会社名","confidence":"high|medium|low","identity":{"official_site":"公式サイトの URL","match":"求人票と一致した点（30字以内）"},"overview":"事業と規模の要約（80字以内）","hiring_context":"募集背景の手がかり（求人票・採用ページに書かれている場合だけ。推測しない。なければ空）","facts":[{"id":"F1","topic":"事業・顧客|経営方針・中期経営計画|トップメッセージ|直近の決算|最近の動き|採用・求める人物像|プロダクト・技術|会社が説明する強み","entity":"応募先|グループ","text":"60字以内","url":"","title":"出典ページの名前","date":"YYYY-MM または空"}],"position":[{"text":"この職種・部署について公開情報から分かること（60字以内）","url":"","title":""}],"hooks":[{"fact":"F2","why":"志望動機の材料になる理由（会社側の視点、40字以内）"}],"questions":[{"q":"逆質問","${L ? 'q_tr":"","' : ''}premise":"F2","for":"現場|部門長|役員"}],"check_yourself":[{"point":"確かめるとよい点（30字以内）","ask":"中立な聞き方（日本語、40字以内）"${L ? ',"ask_tr":""' : ''}}],"caveats":["情報の古さ・不確かさについての注意（あれば）"]}
件数：facts 4〜8（id は F1 から順に）、position 0〜3、hooks 2〜3、questions 2〜3、check_yourself 2〜3、caveats 0〜2。

# 応募先
会社名：${a.company || c.name || '（求人票から読み取る）'}
職種：${a.position || '（求人票から読み取る）'}
## 求人票（抜粋）
"""
${(c.job || '').slice(0, 3000)}
"""${given ? '\n\n# 資料\n' + sources.map((x) => `[${x.id}] ${x.title}${x.official ? '（会社のサイト）' : ''}${x.date ? '（' + x.date + '）' : ''}\n${x.url}\n${x.text}`).join('\n\n') : ''}`;
}
const ymd = (t) => { const d = new Date(Number(t) + 9 * 3600e3); return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : ''; };
// research results as the other prompts see them: numbered facts with their dates and sources, marked as an
// automatic survey of public information (nothing when the company could not be confirmed)
function researchBlock(c) {
  const r = c.research;
  if (!r || !Array.isArray(r.facts) || !r.facts.length || r.confidence === 'low') return '';
  const facts = r.facts.map((f, i) => ({ id: f.id || 'F' + (i + 1), topic: f.topic, entity: f.entity || '応募先', date: f.date, text: f.text, source: f.title || f.url }));
  const seeds = (r.questions || []).map((q) => (typeof q === 'string' ? { q } : { q: q.q, premise: q.premise, for: q.for }));
  return `\n## 公開情報の調査（${ymd(r.at) || '日付不明'} 時点の自動調査。会社が書いたものではない。確からしさ：${r.confidence || 'medium'}）
志望動機に使えるのは entity が「応募先」で、今日から1年以内か時期に左右されない事実だけ。
${J({ overview: r.overview, hiring_context: r.hiring_context || '', facts, position: (r.position || []).map((p) => p.text), hooks: r.hooks || [], question_seeds: seeds, caveats: r.caveats || [] })}\n`;
}

export const PROMPTS = { P_PROFILE, P_ANALYZE, P_GENERATE, P_SHORTEN, P_PACK, P_PREP, P_RK, P_EXPLAIN, P_ENGLISH, P_RESEARCH };
