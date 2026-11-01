// Cases for comparing models (tools/eval/run.mjs). All people and companies are fictional.
// Each person is paired with a posting that fits and one that stretches them (24 cases), so the check covers
// tailoring, honest gaps, career changes, and input in English and Chinese (lang: the page they use).
// Numbers in the careers are there on purpose: the documents must not change or add any.

export const PEOPLE = {
  sales: { lang: '', name: '高橋 誠', raw: `2015年4月 株式会社サンプル商事に新卒入社。IT機器・複合機の法人営業。
・担当：都内の中小企業 約120社（従業員10〜200名）。新規開拓と既存深耕。
・2019年度 新規受注 前年比148%、支店内3位（18名中）。
・2021年4月から主任。後輩3名のOJT担当。
・リース契約の更新時期をExcelで一覧化し、更新提案を前倒しする仕組みを作った（解約率は数字を取っていない）。
・2023年からクラウド型の勤怠システムの販売も担当。導入支援まで自分で行った（約25社）。
資格：普通自動車免許、ITパスポート（2020年）
転職理由：もっと継続的に顧客と関われる仕事がしたい。` },
  accounting: { lang: '', name: '中村 由美', raw: `2014年4月〜2018年3月 サンプル食品株式会社 経理部。売掛金・買掛金管理、月次決算補助。
2018年4月〜現在 サンプル精機株式会社（東証スタンダード、連結子会社5社）経理課 主任。
・月次決算の締めを第7営業日→第5営業日に短縮（勘定科目の照合手順を標準化、RPAで仕訳取込を自動化）。
・連結決算パッケージの回収と照合を担当（子会社5社）。
・2022年に新リース会計の影響額の試算を担当。
・部下2名。
資格：日商簿記2級（2013年）、TOEIC 650点（2021年）
希望：上場企業で決算・開示まで経験を広げたい。` },
  hr: { lang: '', name: '佐々木 亮', raw: `2016年4月 人材サービスの株式会社サンプルキャリアに入社。法人向けの求人広告営業を3年。
2019年4月 株式会社サンプルテック（Web系、従業員約350名）に転職、人事部 採用担当。
・中途採用 年間約40名（エンジニア中心）。スカウト媒体の運用、面接、内定者フォロー。
・エンジニア採用で、現場マネージャーと面接評価シートを作り直し、一次面接の通過基準をそろえた。
・内定承諾率を2021年 52%→2023年 71%に改善（オファー面談の設計を変えた）。
・採用広報としてテックブログの社員インタビューを企画（月1本）。
資格：なし` },
  marketing: { lang: '', name: '小林 彩', raw: `2017年4月〜2020年3月 株式会社サンプル広告 運用型広告のコンサルタント。担当クライアント約15社。
2020年4月〜現在 株式会社サンプルコスメ（自社EC中心の化粧品ブランド）デジタルマーケティング担当。
・広告予算 月約500万円の運用（Google、Meta、LINE）。
・CPA を1年で 4,200円→3,100円に改善。
・LTV分析のためにGA4とECの購入データをつないだダッシュボードを作った（Looker Studio）。
・新商品のローンチで、インフルエンサー施策を担当（2022年、2商品）。
・チームは自分を含め3名。
語学：英語 日常会話程度` },
  nurse: { lang: '', name: '伊藤 さくら', raw: `2013年3月 サンプル看護専門学校 卒業。看護師免許取得（2013年）。
2013年4月〜現在 サンプル総合病院（約400床）に勤務。
・循環器内科病棟 7年、その後カテーテル室 4年。
・カテーテル室では医師・臨床工学技士と連携し、年間約600件の検査・治療の介助。
・新人看護師の教育担当（プリセプター）を3回。
・院内の医療機器の勉強会を企画（メーカーの担当者と調整、年4回）。
転職の理由：医療機器の正しい使い方を広める仕事に関心がある。営業の経験はない。` },
  production: { lang: '', name: '山本 健', raw: `2012年4月 サンプル部品工業株式会社（自動車部品、従業員約1,200名）入社。
・2012〜2017年 製造課。ライン作業とQC活動。
・2017年〜現在 生産管理課。月次の生産計画、部品の発注・在庫管理。
・在庫回転日数を 2019年 18日→2022年 12日に短縮（発注点の見直し、仕入先2社と納入サイクルを週2回→週3回に変更）。
・2020年の半導体不足のとき、代替部品の調達と生産順序の組み替えで、納期遅れを最小限にした（具体的な数字は手元にない）。
・後輩4名の指導。
資格：QC検定2級（2015年）、フォークリフト運転技能講習` },
  hotel: { lang: '', name: '加藤 美咲', raw: `2016年4月〜2024年3月 サンプルホテルズ株式会社（都内のシティホテル、客室数約300）フロント。
・宿泊客のチェックイン・アウト、予約管理、クレーム対応。外国人の宿泊客が約4割。
・2021年からフロントのサブリーダー。シフト作成（スタッフ12名）。
・問い合わせの多い内容をまとめたFAQを作り、電話の問い合わせを減らした（件数は記録していない）。
2024年4月〜現在 株式会社サンプル旅行 予約センター（契約社員）。電話・メールでのツアー予約対応。
語学：英語（TOEIC 780点、2019年）
PCスキル：Excel（関数、ピボット）、予約システム（独自）` },
  backend: { lang: '', name: '渡辺 翔太', raw: `2016年4月 株式会社サンプルペイ（決済代行、従業員約200名）入社。
・Java（Spring Boot）で決済APIの開発・保守。PostgreSQL、AWS（ECS、RDS）。
・2019年 加盟店向け管理画面のリニューアルでバックエンドを担当（チーム5名）。
・2021年〜 チームリーダー（4名）。コードレビューと設計レビューを担当。
・決済処理のバッチをリファクタリングし、夜間バッチの処理時間を 3時間→40分 に短縮。
・障害対応の手順書を整備。オンコール対応あり。
・Go は個人開発で1年ほど（業務経験なし）。
資格：AWS Certified Solutions Architect – Associate（2022年）` },
  qa_en: { lang: 'en', name: 'Daniel Brooks', raw: `I'm from Canada and have lived in Japan since 2016 (JLPT N2, passed 2019).
2016–2018: English teacher at a language school in Osaka.
Apr 2018 – present: QA engineer at Sample Games K.K. (mobile games, about 500 employees), Tokyo.
- Tested 6 mobile titles before and after launch, worked with Japanese developers every day (meetings in Japanese).
- Introduced test case management in TestRail for my team of 8 testers; test case reuse made regression testing about 30% faster (team estimate).
- Wrote automated UI tests with Appium for 2 titles (Python).
- Since 2022, sub-leader: plan test schedules and review bug reports from 3 junior testers.
Education: BA in Psychology, University of Sample (Canada), 2015.
Why I want to change: I want to work on a product people use every day, not only games.` },
  brand_en: { lang: 'en', name: 'Olivia Hart', raw: `Australian, living in Tokyo since 2019. Japanese: business level (JLPT N1, 2022).
2014–2019: Marketing coordinator, Sample Travel Group (Sydney) — social media and email campaigns for Japan tours.
Jul 2019 – present: Marketing manager, Sample Trips K.K. (Tokyo startup, inbound tours, 40 staff).
- Run marketing for overseas customers (English-speaking markets). Team of 2.
- Grew organic website traffic from about 20,000 to 65,000 monthly visits in 3 years (SEO content in English).
- Manage paid ads budget around 1.5 million yen per month.
- Started partnerships with 4 overseas travel agencies.
- Built the customer review program after tours (review rate went up, but I don't have exact numbers).
Education: Bachelor of Business (Marketing), Sample University, 2013.` },
  trade_zh: { lang: 'zh', name: '王 芳', raw: `我是中国人，2017年来日本留学，2021年3月从日本的サンプル大学经济学部毕业。日语N1（2019年）。
2021年4月至今 在サンプル貿易株式会社（进出口贸易公司，员工约80人）做营业事务。
・负责和中国的供应商（约20家）联系：订单、交期、价格确认，邮件和电话都用中文。
・制作报价单、发票、出货资料。
・2022年开始管理一个新的中国供应商的导入，从样品确认到第一次量产订单，大约4个月。
・把订单管理从纸质改成Excel共享表，减少了和营业担当之间的确认邮件（没有具体数字）。
想换工作的原因：想做直接面对客户的海外营业，而不只是事务。` },
  data_zh: { lang: 'zh', name: '李 明', raw: `2016年7月毕业于中国的样本大学 统计学专业（本科）。
2016年7月-2020年6月 上海的样本电商有限公司，数据分析师。
・用SQL和Python分析用户行为，做促销活动的效果分析。
・搭建了每日销售看板（Tableau），给营销部门约30人使用。
・用户流失预测模型（逻辑回归），针对高风险用户发优惠券，流失率下降了大约2个百分点。
2020年10月-现在 日本的株式会社サンプルリテール（零售连锁，东京），数据分析担当。
・门店销售数据的分析（约150家门店），做需求预测的基础数据。
・把Excel手工报表改成BigQuery+Looker Studio，每周报表制作时间从约8小时减少到1小时。
日语：N1（2021年），工作中开会和写资料都用日语。英语：可以读写技术文档。` },
};

export const POSTINGS = {
  saas_sales: `【募集職種】法人営業（クラウド勤怠管理システム）
【会社】株式会社サンプルワークス（従業員約250名）
【仕事内容】中小企業向けに自社のクラウド勤怠管理システムを提案。インサイドセールスが獲得した商談への提案、契約、導入初期のフォロー。
【必須】法人営業経験3年以上
【歓迎】SaaS・IT製品の営業経験、導入支援の経験、後輩指導の経験
【求める人物像】お客様の業務を理解し、長く使っていただけるよう伴走できる方`,
  cs: `【募集職種】カスタマーサクセス
【会社】株式会社サンプルHR（HR SaaS、従業員約400名）
【仕事内容】導入済み企業（従業員100〜1,000名）の活用推進、解約防止、アップセル。データを見て打ち手を考え、チームで実行します。
【必須】法人向けの顧客対応経験3年以上
【歓迎】SaaSのカスタマーサクセス経験、データ分析（Excel・BIツール）
【求める人物像】数字と現場の両方を見て動ける方`,
  acct_listed: `【募集職種】経理（決算・開示担当）
【会社】サンプルホールディングス株式会社（東証プライム）
【仕事内容】単体・連結決算、有価証券報告書・決算短信の作成補助、監査法人対応。決算早期化のプロジェクトにも参加いただきます。
【必須】事業会社での月次・年次決算の経験3年以上、日商簿記2級以上
【歓迎】連結決算の経験、開示書類の作成経験、英語力`,
  fpa: `【募集職種】FP&A（経営企画・予算管理）
【会社】株式会社サンプルリテール（小売、上場準備中）
【仕事内容】予算策定、月次の予実分析、経営会議資料の作成、事業部へのKPI提案。
【必須】経理または経営企画の実務経験3年以上、Excelでの分析
【歓迎】管理会計の経験、BIツール、事業部との折衝経験`,
  recruit_lead: `【募集職種】採用リーダー（エンジニア採用）
【会社】株式会社サンプルクラウド（SaaS、従業員約600名）
【仕事内容】エンジニア中途採用の戦略立案と実行。採用担当2名のマネジメント、エージェント・媒体の選定、現場との面接設計。
【必須】中途採用の実務経験3年以上
【歓迎】エンジニア採用の経験、採用広報、メンバーのマネジメント経験`,
  hrbp: `【募集職種】HRBP
【会社】サンプル製薬株式会社
【仕事内容】研究開発部門の人事パートナーとして、組織開発、人員計画、評価・育成、労務対応を担当。
【必須】人事の実務経験5年以上（制度運用・労務を含む）
【歓迎】HRBPの経験、組織開発の経験、英語`,
  dmkt: `【募集職種】デジタルマーケティング担当
【会社】株式会社サンプルフーズ（食品D2Cブランド）
【仕事内容】自社ECの広告運用（月1,000万円規模）、CRM施策、データ分析にもとづく改善提案。
【必須】運用型広告の実務経験3年以上
【歓迎】EC・D2Cでの経験、GA4、CRMツール、チームリードの経験`,
  pmm: `【募集職種】プロダクトマーケティングマネージャー
【会社】株式会社サンプルソフト（BtoB SaaS）
【仕事内容】新機能のポジショニング、ローンチ計画、営業資料の作成、顧客インタビュー。
【必須】BtoBマーケティングまたはプロダクトマーケティングの経験3年以上
【歓迎】SaaS業界の経験、英語での情報収集`,
  clinical: `【募集職種】クリニカルスペシャリスト（循環器）
【会社】サンプルメディカル株式会社（外資系医療機器メーカー）
【仕事内容】カテーテル治療で使う当社製品について、医療従事者への使用方法の説明、症例の立ち会い、院内勉強会の実施。
【必須】看護師・臨床工学技士などの医療資格、臨床経験3年以上
【歓迎】循環器・カテーテル室での経験、教育・指導の経験、普通自動車免許`,
  med_sales: `【募集職種】医療機器の営業（MR経験不問）
【会社】サンプル医療器株式会社
【仕事内容】病院・クリニックへの医療機器の提案営業。新規開拓と既存のフォロー。担当エリアは首都圏。
【必須】普通自動車免許、法人営業経験または医療業界での経験
【歓迎】医療資格、営業成績の実績`,
  scm: `【募集職種】SCM担当（需給計画）
【会社】サンプル電機株式会社（家電メーカー）
【仕事内容】需要予測にもとづく生産・調達計画、在庫の最適化、仕入先との調整。
【必須】製造業での生産管理・購買・需給計画のいずれかの経験3年以上
【歓迎】在庫削減の実績、ERPの利用経験、データ分析`,
  seisan_gijutsu: `【募集職種】生産技術
【会社】サンプル精工株式会社（精密部品）
【仕事内容】新しい生産ラインの立ち上げ、設備の選定、工程設計、品質改善。
【必須】製造業での生産技術・設備保全の経験3年以上
【歓迎】CAD、QC手法、海外工場での立ち上げ経験`,
  support_it: `【募集職種】カスタマーサポート（ITサービス）
【会社】株式会社サンプルリンク（予約管理SaaS、従業員約120名）
【仕事内容】ホテル・飲食店などの導入企業からの電話・メール・チャットの問い合わせ対応、FAQの作成と改善。
【必須】接客・顧客対応の経験3年以上、基本的なPCスキル
【歓迎】ホテル業界の経験、英語対応、FAQ・マニュアル作成の経験`,
  inside_sales: `【募集職種】インサイドセールス
【会社】株式会社サンプルトラベルテック（旅行業界向けSaaS）
【仕事内容】問い合わせへの対応と商談化、オンラインでの製品説明。
【必須】法人・個人を問わず営業または接客の経験2年以上
【歓迎】旅行・ホテル業界の経験、英語`,
  go_backend: `【募集職種】バックエンドエンジニア（Go）
【会社】株式会社サンプルファイナンス（FinTech、従業員約300名）
【仕事内容】決済・送金サービスのAPI設計・開発。Go、gRPC、Kubernetes、AWS。
【必須】Webアプリケーションのバックエンド開発経験3年以上、RDBの設計経験
【歓迎】Goでの開発経験、決済・金融システムの経験、チームリードの経験`,
  sre: `【募集職種】SRE
【会社】株式会社サンプルメディア（動画配信、従業員約500名）
【仕事内容】サービスの信頼性向上、監視・アラートの設計、インフラのコード化、障害対応の仕組みづくり。
【必須】Linuxサーバーの運用経験3年以上、AWSまたはGCPの実務経験
【歓迎】Kubernetes、Terraform、オンコール運用の改善経験`,
  qa_lead: `【募集職種】QAリーダー
【会社】株式会社サンプルノート（家計簿アプリ、ユーザー500万人）
【仕事内容】アプリのQAチーム（5名）のリード、テスト計画、テスト自動化の推進、開発チームとの品質目標づくり。
【必須】QA・テストの実務経験5年以上、日本語でのビジネスコミュニケーション
【歓迎】テスト自動化（Appium等）、モバイルアプリ、マネジメント経験`,
  sdet: `【募集職種】SDET（テスト自動化エンジニア）
【会社】サンプルソリューションズ株式会社（BtoB SaaS）
【仕事内容】E2Eテストの自動化、CIへの組み込み、テスト基盤の設計。
【必須】プログラミング経験（Python、TypeScript等）、テスト自動化の実務経験2年以上
【歓迎】Playwright、CI/CD、英語`,
  inbound_mkt: `【募集職種】インバウンドマーケティング担当
【会社】株式会社サンプルジャパンツアーズ（訪日旅行）
【仕事内容】英語圏向けのWeb・SNS・広告の運用、海外の旅行会社との提携、レビュー施策。
【必須】旅行業界またはBtoCマーケティングの経験3年以上、ビジネスレベルの日本語と英語
【歓迎】SEO、海外のパートナー開拓の経験`,
  brand_mgr: `【募集職種】ブランドマネージャー
【会社】サンプル飲料株式会社（日本の飲料メーカー、海外展開を強化中）
【仕事内容】海外向けブランドの戦略立案、商品企画、代理店・広告会社との協業。
【必須】ブランドマネジメントまたは消費財マーケティングの経験5年以上
【歓迎】海外市場での経験、英語、P/L管理`,
  overseas_sales: `【募集職種】海外営業（中国市場）
【会社】サンプル化成株式会社（化学メーカー）
【仕事内容】中国の取引先への提案営業、価格交渉、展示会への出展。年数回の中国出張あり。
【必須】中国語ビジネスレベル、日本語ビジネスレベル、営業または貿易実務の経験2年以上
【歓迎】製造業の取引経験、新規開拓の経験`,
  trade_admin: `【募集職種】貿易事務
【会社】株式会社サンプルインターナショナル（輸入商社）
【仕事内容】輸入手続き、船積書類の作成、仕入先・通関業者・倉庫との調整。
【必須】貿易事務または営業事務の経験2年以上
【歓迎】中国語、通関士、Excel`,
  data_analyst: `【募集職種】データアナリスト
【会社】株式会社サンプルマート（小売チェーン、約200店舗）
【仕事内容】POSデータ・会員データの分析、需要予測、施策の効果検証、経営・現場向けのダッシュボード作成。
【必須】SQLでの分析経験3年以上、BIツールの経験
【歓迎】Python、統計モデリング、小売・EC業界の経験`,
  bi_engineer: `【募集職種】BIエンジニア（データ基盤）
【会社】株式会社サンプルデータ（データ活用支援）
【仕事内容】データウェアハウスの設計、ETL・データパイプラインの構築、BIツールの導入支援。
【必須】DWH（BigQuery、Snowflake等）の設計・構築経験2年以上
【歓迎】dbt、Airflow、Pythonでのデータ処理`,
};

// [id, person, posting]
export const CASES = [
  ['sales-fit', 'sales', 'saas_sales'], ['sales-cs', 'sales', 'cs'],
  ['acct-fit', 'accounting', 'acct_listed'], ['acct-fpa', 'accounting', 'fpa'],
  ['hr-fit', 'hr', 'recruit_lead'], ['hr-hrbp', 'hr', 'hrbp'],
  ['mkt-fit', 'marketing', 'dmkt'], ['mkt-pmm', 'marketing', 'pmm'],
  ['nurse-clinical', 'nurse', 'clinical'], ['nurse-sales', 'nurse', 'med_sales'],
  ['prod-scm', 'production', 'scm'], ['prod-pe', 'production', 'seisan_gijutsu'],
  ['hotel-support', 'hotel', 'support_it'], ['hotel-is', 'hotel', 'inside_sales'],
  ['be-go', 'backend', 'go_backend'], ['be-sre', 'backend', 'sre'],
  ['qa-lead', 'qa_en', 'qa_lead'], ['qa-sdet', 'qa_en', 'sdet'],
  ['brand-inbound', 'brand_en', 'inbound_mkt'], ['brand-mgr', 'brand_en', 'brand_mgr'],
  ['trade-sales', 'trade_zh', 'overseas_sales'], ['trade-admin', 'trade_zh', 'trade_admin'],
  ['data-analyst', 'data_zh', 'data_analyst'], ['data-bi', 'data_zh', 'bi_engineer'],
].map(([id, p, j]) => ({ id, person: p, posting: j, ...PEOPLE[p], job: POSTINGS[j] }));
