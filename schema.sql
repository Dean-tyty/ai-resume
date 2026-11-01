-- D1 schema for 職務経歴書AI. Apply with: npx wrangler d1 execute resume --remote --file=schema.sql
-- (local development: the same with --local). Every statement can be run again safely.
-- A database made before slots.research existed: ALTER TABLE slots ADD COLUMN research INTEGER NOT NULL DEFAULT 0;
-- A database made before 2026-11-02 (previews, first-touch source), run once:
--   ALTER TABLE slots ADD COLUMN unlocked INTEGER NOT NULL DEFAULT 1;
--   ALTER TABLE users ADD COLUMN src TEXT NOT NULL DEFAULT '';
--   ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,                -- Clerk user id (sub)
  email TEXT NOT NULL DEFAULT '',     -- for the Stripe checkout form; cleared when the data expires
  credits INTEGER NOT NULL DEFAULT 0, -- 応募先 the user can still add
  consent TEXT NOT NULL DEFAULT '',   -- the consent version agreed to (worker/config.js CONSENT_VERSION)
  consented_at INTEGER NOT NULL DEFAULT 0,
  free_pending INTEGER NOT NULL DEFAULT 0, -- 1: the email could not be read at sign-up; the free credit is decided later
  src TEXT NOT NULL DEFAULT '',       -- where the first visit came from (utm_source or the referring site's host), for the weekly report
  lang TEXT NOT NULL DEFAULT '',      -- the page the account was made on: ja / en / zh
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace (
  user_id TEXT PRIMARY KEY,
  data TEXT NOT NULL,                 -- the page's state as JSON: 経歴, 応募先, documents, interviews
  version INTEGER NOT NULL DEFAULT 0, -- raised on every save; a save based on an older version is refused
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS slots (    -- 応募先 that use AI: previews (unlocked 0) and those that have used a credit
  user_id TEXT NOT NULL,
  company_id TEXT NOT NULL,           -- the 応募先's id in the page's state
  claim TEXT NOT NULL,                -- the request that used the credit (to give it back if that request fails)
  unlocked INTEGER NOT NULL DEFAULT 1, -- 0: a preview (no credit used yet), 1: a credit is used for it
  n INTEGER NOT NULL DEFAULT 0,       -- AI requests that succeeded for this 応募先
  busy INTEGER NOT NULL DEFAULT 0,    -- AI requests running now (the credit goes back only when none is)
  label TEXT NOT NULL DEFAULT '',     -- the company's name, set by the first success (a credit is for one company)
  research INTEGER NOT NULL DEFAULT 0, -- company researches (web search) started for this 応募先
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, company_id)
);
CREATE TABLE IF NOT EXISTS purchases (-- kept when an account is deleted (accounting); holds no personal data
  session TEXT PRIMARY KEY,           -- Stripe Checkout Session id
  user_id TEXT NOT NULL,
  pack TEXT NOT NULL,
  credits INTEGER NOT NULL,
  amount INTEGER NOT NULL,            -- yen, tax included
  credited INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS freebies ( -- addresses that have had the free 応募先 (a one-way hash, not the address)
  hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS usage (    -- AI requests per day, for the daily limits
  user_id TEXT NOT NULL,              -- '*' for the whole service
  day TEXT NOT NULL,                  -- YYYY-MM-DD, Japan time
  kind TEXT NOT NULL,                 -- 'all', a task name, or 'c:<company id>'
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind)
);
CREATE INDEX IF NOT EXISTS users_seen ON users (seen_at);
CREATE INDEX IF NOT EXISTS usage_day ON usage (day);
