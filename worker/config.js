// Product settings. Prices shown on the page come from here; the amounts actually charged come from the
// Stripe Prices named in the secrets STRIPE_PRICE_P5 / STRIPE_PRICE_P10 — keep the two in step.
export const PRODUCT = { id: 'resume', name: '職務経歴書AI', terms: 'https://www.flatland.co.jp/legal/terms/resume/', privacy: 'https://www.flatland.co.jp/privacy/' };
export const CONSENT_VERSION = '2026-11-01';          // bump when the consent text changes: everyone is asked again
export const FREE_CREDITS = 1;                         // 応募先 a new account can take documents out for, free
// A 応募先's 職務経歴書 can be made and read on the screen before a credit is used ("preview"). The credit is
// used the first time its documents leave the page (PDF / Word / copy) or its 志望動機・面接準備・履歴書・
// 英文レジュメ・公開情報の調査 is made (UNLOCK tasks in ai.js). Previews cost AI calls, so they are capped:
//   free: 応募先 an account that has never bought may start in all (the free one included)
//   open: locked 応募先 a buyer may hold at once, on top of the credits left
//   requests: AI requests one locked 応募先 may use
export const PREVIEW = { free: 2, open: 3, requests: 20 };
// accounts that have never bought: AI requests in all (not per day), by task
export const FREE_LIFE = { profile: 6, analyze: 10 };
export const FREE_SLOT_MAX = 40;                       // AI requests the free 応募先 may use in all (buyers: SLOT_MAX)
export const PACKS = {
  p5: { credits: 5, price: 2480, label: '5社パック', rec: true },
  p10: { credits: 10, price: 3980, label: '10社パック' },
};
// cost guards: AI calls per user per day (all tasks / by task), and per 応募先 per day
export const LIMITS = { day: 150, profile: 15, analyze: 40, company: 40, research: 10, fetch: 30 };
// for users who have bought credits only (the cost of web searches): reading a posting from its URL, and
// researching a company's public information — this many times per 応募先 in all
export const RESEARCH_PER_COMPANY = 3;
// sites whose pages are not read from a URL (their terms forbid it, or they need a login): the user pastes the text;
// review sites are also left out of the company research
export const NO_FETCH = ['doda.jp', 'rikunabi.com', 'bizreach.jp', 'en-japan.com', 'mynavi.jp', 'indeed.com', 'jp.indeed.com', 'linkedin.com', 'green-japan.com', 'type.jp', 'wantedly.com', 'jac-recruitment.jp', 'r-agent.com', 'openwork.jp', 'vorkers.com', 'jobtalk.jp', 'en-hyouban.com', 'careerconnection.jp', 'glassdoor.com', 'glassdoor.jp', 'lighthouse-r.com'];
export const REVIEW_SITES = ['openwork.jp', 'vorkers.com', 'jobtalk.jp', 'en-hyouban.com', 'careerconnection.jp', 'glassdoor.com', 'glassdoor.jp', 'lighthouse-r.com', '5ch.net', '2ch.sc', 'kaisharank.com'];
export const MAX_WORKSPACE = 1800 * 1024;              // bytes (UTF-8) of one user's saved data; a D1 row holds at most 2 MB
export const MAX_PAYLOAD = 240 * 1024;                 // bytes of one AI request from the browser
export const RETENTION_DAYS = 365;                     // data unused this long is deleted (daily cron)
export const SLOT_MAX = 150;                           // AI requests one 応募先 may use in all (re-dos included)
