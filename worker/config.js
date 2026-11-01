// Product settings. Prices shown on the page come from here; the amounts actually charged come from the
// Stripe Prices named in the secrets STRIPE_PRICE_P5 / STRIPE_PRICE_P10 — keep the two in step.
export const PRODUCT = { id: 'resume', name: '職務経歴書AI', terms: 'https://www.flatland.co.jp/legal/terms/resume/', privacy: 'https://www.flatland.co.jp/privacy/' };
export const CONSENT_VERSION = '2026-11-01';          // bump when the consent text changes: everyone is asked again
export const FREE_CREDITS = 1;                         // 応募先 a new account can make documents for, free
export const PACKS = {
  p5: { credits: 5, price: 2480, label: '5社パック' },
  p10: { credits: 10, price: 3980, label: '10社パック' },
};
// cost guards: AI calls per user per day (all tasks / by task), and per 応募先 per day
export const LIMITS = { day: 150, profile: 15, analyze: 40, company: 40 };
export const MAX_WORKSPACE = 1800 * 1024;              // bytes (UTF-8) of one user's saved data; a D1 row holds at most 2 MB
export const MAX_PAYLOAD = 240 * 1024;                 // bytes of one AI request from the browser
export const RETENTION_DAYS = 365;                     // data unused this long is deleted (daily cron)
export const SLOT_MAX = 150;                           // AI requests one 応募先 may use in all (re-dos included)
