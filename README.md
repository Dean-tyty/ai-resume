# 職務経歴書AI（resume.flatland.co.jp）

经历登记一次、贴上求人票，就按应募先生成可直接提交的职务经历书（PDF・Word）、履历书、志望动机与面试准备，并管理选考进度。面向日本中途采用，支持中文・英文输入。

这是 Flatland 的正式产品，按官网仓库 `docs/products.md` 的方式接入：自己的仓库、自己的 Cloudflare Worker、子域名 `resume.flatland.co.jp`，外观用官网的品牌套件，统计进官网的周报。

## 构成

| 部分 | 用什么 | 在哪里 |
| --- | --- | --- |
| 页面 | 静态文件（排版引擎在浏览器里生成 PDF・Word） | `public/` |
| API | Cloudflare Worker | `worker/` |
| 数据 | Cloudflare D1（账号、利用枠、保存的数据、每日用量） | `schema.sql` |
| 登录 | Clerk（邮箱、Google、LINE 等） | `worker/auth.js`、`public/app.js` 的 sign-in 部分 |
| AI | Anthropic Claude API（提示词只在服务器上） | `worker/ai.js`、`worker/prompts.js` |
| 支付 | Stripe Checkout + Webhook | `worker/billing.js` |
| 通知 | 官网同一个 Lark 机器人（只发购买和异常） | `worker/notify.js` |
| 统计 | 官网同一个 Analytics Engine（`flatland_events`） | `worker/stats.js` |
| 外观 | 官网品牌套件 v1（`<fl-header>`、`<fl-footer>`），加载失败时显示页面自带的页眉页脚 | `public/index.html` |

### 利用枠（收费方式）

- 1 社分 = 1 个应募先。分析求人票免费；第一次为某个应募先生成书类（职务经历书、面试准备、履历书志望动机、解说等）时扣 1 社分。只要这个应募先还没有任何一次成功、也没有别的请求在进行，失败就自动退回。之后这个应募先的书类可以反复重做，不再扣。
- 页面上的「サンプル求人で試す」：用示例求人分析和生成都不扣枠（服务器按求人票内容判断，`worker/mock.json` 的 `sampleJobHash`）。
- 1 社分只能用于一家公司：第一次成功时记住公司名，之后同一个应募先换成别的公司会被拒绝（去掉「株式会社」、括号、空格后比较，一方包含另一方就算同一家）。
- 新账号送 1 社分（同一个邮箱只送一次：删除账号再注册不会再送；保存的是邮箱的不可逆哈希）。注册时读不到邮箱的账号先不送，等之后能读到邮箱时再判断。
- 价格：5 社 2,480 円、10 社 3,980 円（含税）。改价格时，`worker/config.js` 的 `PACKS` 和 Stripe 的 Price 要一起改：支付金额和 `PACKS` 不一致时不加枠，并发 Lark 通知。
- 成本保护（`worker/config.js` 的 `LIMITS`、变量 `AI_DAILY_LIMIT`）：每人每天 AI 150 次、整理经历 15 次、分析 40 次、每个应募先每天 40 次、每个应募先累计 150 次；全站每天 3000 次（到 80% 和 100% 时 Lark 通知）。

### 数据

- 登录后，输入和书类保存在 D1（每人一行 JSON，带版本号；两台设备同时改时，旧的一方会被问「读入新的 / 用这边覆盖」）。撤销用的历史版本只留在本机。
- 登录前输入的内容只在浏览器里；登录后自动转入账号（账号里已经有数据时，让用户选用哪一份）。
- 最后一次使用起 1 年：删除保存的数据；没有剩余利用枠的账号整个删除（包括 Clerk 里的账号），有剩余利用枠的只留 ID 和枠数。每天 03:30（日本时间）执行。
- 删除账号：D1 里的数据和 Clerk 账号都删除；购买记录（不含内容）为了会计保留。Clerk 那边删除失败时会发 Lark 通知，需要在 Clerk 管理画面手动删除。
- 发给 AI 的只有经历、求人票、面试记录等；履历书的住址、电话、生日、照片不发送。
- 用户同意数据处理之前，不往服务器保存（只留在本机）；登录后会立刻请用户同意。
- 下载 Word 时按打开它的环境选字体（页面自动判断，可切换）：Windows 用 BIZ UD 字体（与 PDF 相同），Mac 用游明朝・游ゴシック（Mac 版 Office 提供，发到 Windows 也不变样），Google 文档用 BIZ UDPMincho / BIZ UDPGothic。提交建议用 PDF。

## 本机开发

```
npm install
cp .dev.vars.example .dev.vars     # 测试登录、模拟 AI 回答、模拟支付，不需要任何账号
npm run db:local                   # 建本机 D1 的表
npm run dev                        # http://localhost:8787
```

- 想在本机用真的 AI：在 `.dev.vars` 里删掉 `AI_MOCK=1`，加上 `ANTHROPIC_API_KEY=...`。
- 改了 `public/demo.js`（示例数据）后运行 `node tools/make-mock.mjs`，模拟 AI 的回答会随之更新。
- 升级 `@clerk/localizations` 后运行 `node tools/make-clerk-ja.mjs`。
- 看书类效果：`node tools/render-docs.mjs <输出目录>`，把示例简历按三种设计输出 PDF・Word（`TARGETS=windows,mac,google` 可以指定 Word 的环境），装了 pdftoppm / LibreOffice 时还会生成 PNG。首页的样例图 `public/img/sample-resume.webp` 就是 premium 的第 1 页。

## 测试

```
node test/unit.mjs                              # Clerk 令牌、Stripe 签名、AI 回答的读取、所有提示词
LANG=C.UTF-8 node test/e2e.mjs                  # 先 npm run dev；浏览器里走完整流程
```

E2E 需要官网的品牌套件：默认读取官网仓库本机构建的 `dist/`（`FL_OFFLINE=1 python3 tools/build.py`），路径用 `FLATLAND_DIST` 指定。E2E 覆盖：首页 → 示例 → 自己的数据 → 登录 → 同意 → 整理经历 → 应募先（扣免费枠）→ 生成书类 → 下载 PDF・Word・履历书 → 枠用完时购买 → 换设备读入 → 两台设备冲突 → 退出登录 → 删除账号，以及页面没有报错（含 CSP）。

## 画面预览（不需要任何账号）

`node tools/make-preview.mjs` 生成 `preview/dist/`：页面本身加上一个在浏览器里模拟服务器的 `preview/preview.js`（AI 返回示例回答，购买直接加枠，数据只留在浏览器里）。用来发布成 claude.ai 的 artifact 给人看界面、提意见；不要部署到正式网站。

## 上线步骤（需要 Dean 操作的部分）

### 1. GitHub

仓库：`Dean-tyty/ai-resume`（Private）。

### 2. Cloudflare

1. D1：「存储和数据库」→「D1」→「创建」，名字 `resume`。把 Database ID 填进 `wrangler.jsonc` 的 `database_id`。然后建表：
   `npx wrangler d1 execute resume --remote --file=schema.sql`
2. Worker：「Workers 和 Pages」→「创建」→「导入 Git 存储库」→ 选上面的仓库。部署命令 `npx wrangler deploy`。
3. 子域名：Worker →「设置」→「域和路由」→「添加」→「自定义域」→ `resume.flatland.co.jp`。
4. 「变量和机密」里加下面的机密（类型选「密钥」）。

| 名字 | 值从哪里来 |
| --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys。建议在 Console 里给这个 Key 所在的 Workspace 设每月花费上限 |
| `CLERK_SECRET_KEY` | Clerk Dashboard → API Keys（`sk_live_…`） |
| `STRIPE_SECRET_KEY` | Stripe → 开发者 → API 密钥（建议用只开放 Checkout Sessions 读写的受限密钥） |
| `STRIPE_WEBHOOK_SECRET` | 下面 Stripe 第 3 步得到的 `whsec_…` |
| `STRIPE_PRICE_P5` / `STRIPE_PRICE_P10` | 下面 Stripe 第 2 步得到的 `price_…` |
| `LARK_WEBHOOK` / `LARK_WEBHOOK_SECRET` | 和官网 Worker 相同 |
| `HASH_SALT` | 随便一串长的随机字符（以后不要改） |

5. `wrangler.jsonc` 的 `vars` 里填 Clerk 的两个公开值（不是机密）：`CLERK_PUBLISHABLE_KEY`（`pk_live_…`）、`CLERK_JWKS_URL`（Clerk Dashboard → API Keys → 「JWKS URL」）。

### 3. Clerk

1. 新建应用，名字「職務経歴書AI」。登录方式：邮箱（验证码）、Google、LINE。邮箱设为必填（免费枠按邮箱判断；LINE 登录也要求填邮箱）。
2. 生产实例的域名设为 `resume.flatland.co.jp`，按 Clerk 的提示在 Cloudflare DNS 里加 CNAME（`clerk.resume.flatland.co.jp` 等）。页面的 CSP 已经允许 `clerk.resume.flatland.co.jp`、`clerk.flatland.co.jp` 和开发实例的 `*.clerk.accounts.dev`；如果 Clerk 给的是别的域名，要改 `public/_headers`。
3. Google、LINE 登录在生产实例里要用自己的 OAuth 凭据（Google Cloud Console、LINE Developers），回调地址照 Clerk 的提示填。

### 4. Stripe

1. 同一个 Stripe 账号，新建 Product「職務経歴書AI」。
2. 建两个一次性 Price：5社パック 2,480 JPY、10社パック 3,980 JPY（含税，税务行为选「含税」）。
3. Webhook：端点 `https://resume.flatland.co.jp/api/stripe`，事件选 `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.async_payment_failed`、`charge.refunded`。
4. 想要可报销的发票（インボイス）：取得登录号码后填进 Stripe，并在 Worker 变量里加 `STRIPE_INVOICE=1`（Stripe 对发票另收费）。
5. 退款：在 Stripe 后台操作后，Lark 会收到通知；对应用户的利用枠需要手动减（D1 控制台：`UPDATE users SET credits = credits - 5 WHERE id = '…'`，用户 ID 在 `purchases` 表里按 Checkout Session 查）。

### 5. 官网登记

`site/content/products/` 里的两个文件复制到官网仓库的 `content/products/`：

- `resume.yml`：产品目录（现在是 `draft`）、周报的步骤、特商法的各项、隐私政策的追加条款。
- `resume.terms.ja.md`：利用规约草稿。

照 `docs/products.md`：写了 `privacy` 后要更新隐私政策的「改定日」；条款和隐私文字在改成 beta 或 live 之前请专业人士确认。开始收费前，特商法标示页必须能看到：`src/site.json` 的 `company.address` 要先填好，然后把产品改成 `live`（或先把 `legal.tokushoho` 设为 `true`）。

## 需要决定或确认的事

- **利用枠的有效期限**（资金结算法）：现在利用枠没有期限。这种「几社分」的预付利用权可能属于自家型前払式支払手段：期限 6 个月以内的话不适用；没有期限的话，每年 3 月底・9 月底的未使用余额超过 1,000 万円时需要申报。请和专业人士确认。如果要加期限，代码需要改成按购买批次管理（目前按总数管理）。
- **利用规约、隐私条款、同意弹窗的文字**：都是草稿，按上面「官网登记」请专业人士确认（特别是向外国第三方提供个人信息的说明）。
- **AI 成本**（推算，未实测）：一次请求约输入 6–9 千 token、输出 2–5 千 token（含思考），用 Sonnet 5.5（$2／$10 每百万 token）约 0.05–0.08 美元；一个应募先做齐分析、书类、面试准备、履历书、解说约 9 次，约 0.6 美元。上线后 Worker 日志里每次请求都记录了实际 token 数（`{"ai":"generate","in":…,"out":…}`），请用实测值复核价格。

## 文件

```
public/            页面（index.html、app.js、app.css、engine.js 排版引擎、demo.js 示例、fonts/ 书类字体、lib/）
public/_headers    CSP 等响应头
worker/            API（index.js 路由与定时清理、ai.js、prompts.js、auth.js、db.js、billing.js、stats.js、notify.js、config.js）
schema.sql         D1 的表
site/              交给官网仓库的登记文件（产品、条款、隐私）
test/              unit.mjs、e2e.mjs
tools/             make-mock.mjs、make-clerk-ja.mjs
```

书类字体：BIZ UDP明朝・BIZ UDPゴシック（SIL Open Font License，`public/fonts/OFL.txt`）。
