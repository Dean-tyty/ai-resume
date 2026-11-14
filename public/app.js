(function () {
'use strict';
const E = window.ResumeEngine;
const $ = (s, r = document) => r.querySelector(s);
// files next to this script (fonts, PDF reader): also right on /en/ and /zh/, whose address is a folder deeper
const SCRIPT_URL = (document.currentScript && document.currentScript.src) || document.baseURI; // only set while this file first runs
const ASSET = (p) => new URL(p, SCRIPT_URL).href;
// the language of the page: /en/ and /zh/ (made by tools/make-lang-pages.mjs, <html lang="en|zh-Hans">) are the
// pages for people whose first language is not Japanese
const UI_LANG = (/^(en|zh)/.exec(document.documentElement.lang || '') || [])[1] || 'ja';
const h = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map((x) => (x % 36).toString(36)).join(''); };
const len = (s) => [...String(s || '')].length;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());
const today = () => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const WD = UI_LANG === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : UI_LANG === 'zh' ? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] : '日月火水木金土';
const SEP = UI_LANG === 'en' ? ' · ' : '・'; // between short items in a line
const monthWd = (d) => (UI_LANG === 'en' ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()] + ` (${WD[d.getDay()]})` : `${d.getMonth() + 1}月（${WD[d.getDay()]}）`);
const jpDate = (s) => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return UI_LANG === 'en' ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const daysFrom = (s) => Math.round((new Date(s + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 864e5);

// ---------------- state ----------------
const RK0 = () => ({ furigana: '', birth: '', gender: '', addrKana: '', zip: '', addr: '', tel: '', email: '', addr2Kana: '', zip2: '', addr2: '', tel2: '', email2: '', photo: '', era: 'west', history: '', licenses: '' });
const fresh = () => ({ step: 1, name: '', raw: '', answers: {}, intent: { reason: '', axis: '', conditions: '' }, rireki: RK0(), explainLang: UI_LANG === 'en' ? 'en' : 'zh', profile: null, profileStatus: '', companies: [], active: null, active4: null });
let state = null;
let userState = null; // the user's own data, kept aside while the sample is shown
const TRANSIENT = { analyzing: 'idle', generating: 'analyzed', fitting: 'analyzed', queued: 'idle' };
function migrate(st) {
  st.profileStatus = '';
  st.intent = Object.assign({ reason: '', axis: '', conditions: '' }, st.intent || {});
  st.rireki = Object.assign(RK0(), st.rireki || {});
  if (!st.explainLang) st.explainLang = 'zh';
  if (UI_LANG !== 'ja') st.explainLang = UI_LANG;   // the English / Chinese page explains in its own language
  st.companies.forEach((c) => {
    if (TRANSIENT[c.status]) c.status = c.doc ? 'done' : (c.analysis ? 'analyzed' : 'idle');
    if (c.packStatus === 'run') c.packStatus = c.pack ? 'done' : '';
    (c.stages || []).forEach((s) => { if (s.prepStatus === 'run') s.prepStatus = s.prep ? 'done' : ''; });
    c.edit = false;
    if (!c.accent) c.accent = 'navy';
    if (!c.result) c.result = '選考中';
    if (c.doc) c.doc = E.normalizeDoc(c.doc);
    if (!c.history) c.history = [];
    if (!c.tab) c.tab = 'doc';
    c.rk = Object.assign({ motive: '', hope: '貴社の規定に従います。', status: '' }, c.rk || {}); if (c.rk.status === 'run') c.rk.status = '';
    if (c.exStatus === 'run') c.exStatus = c.explain ? 'done' : '';
    if (c.researchStatus === 'run') c.researchStatus = '';
    if (c.fetchStatus === 'run') c.fetchStatus = '';
    if (c.research) c.research = normResearch(c.research);
    c.batch = false;
  });
  return st;
}
function confirm2(b, msg, ms) {
  // pressed again: the button gets its own label back (it stayed as the question, wide and unwrapped, before)
  if (b.dataset.confirm === '1') { b.dataset.confirm = ''; if (b.dataset.orig != null) { b.textContent = b.dataset.orig; delete b.dataset.orig; } return true; }
  const orig = b.textContent; b.dataset.confirm = '1'; b.dataset.orig = orig; b.textContent = msg;
  setTimeout(() => { if (b.isConnected && b.dataset.confirm === '1') { b.dataset.confirm = ''; b.textContent = orig; } }, ms || 3500);
  return false;
}
function pushHistory(c) { if (!c.doc) return; c.history = (c.history || []).concat([JSON.parse(JSON.stringify(c.doc))]).slice(-3); }
const company = (id) => state.companies.find((c) => c.id === id);
function newCompany(o) { return Object.assign({ id: uid(), name: '', job: '', info: '', priority: '本命', memo: '', analysis: null, doc: null, theme: '', accent: 'navy', maxPages: 0, status: 'idle', error: '', fit: null, rounds: 0, pack: null, packStatus: '', packError: '', edit: false, stages: null, result: '選考中', history: [], dirty: false, tab: 'doc', fixed: [], rk: { motive: '', hope: '貴社の規定に従います。', status: '' }, explain: null, exStatus: '' }, o || {}); }
const newStage = (o) => Object.assign({ id: uid(), name: '', status: '未定', date: '', time: '', format: '', who: '', log: { asked: '', good: '', bad: '', vibe: '', reverse: '' }, prep: null, prepStatus: '', prepError: '' }, o || {});
const opt = (c) => ({ accent: c.accent || 'navy' });

// ---------------- account, saving, AI and payments (the server side: worker/) ----------------
const CFG = window.APP_CONFIG || { packs: [], free: 1, consent: '', dev: false, terms: '#', privacy: '#' };
// user: {id} once signed in; me: {credits, slots (応募先 ids that have a credit), consent}
// base: the server's version of the saved data this copy is based on; dirty: changes not yet on the server
const acct = { ready: false, user: null, me: null, base: 0, dirty: false, syncing: false, conflict: false, offline: false, full: false, unavailable: false };
const ui = { lp: false };
const keepFor = () => { const d = CFG.retention || 365; return d % 365 === 0 ? d / 365 + '年' : d + '日'; };
const GUEST = 'resume-v1:guest';
const lsKey = () => (acct.user ? 'resume-v1:' + acct.user.id : GUEST);
function readLocal(key) { try { const s = JSON.parse(localStorage.getItem(key) || 'null'); return s && Array.isArray(s.companies) ? s : null; } catch (e) { return null; } }
function readMeta() { try { return JSON.parse(localStorage.getItem(lsKey() + ':meta') || '{}') || {}; } catch (e) { return {}; } }
function writeLocal() {
  try { localStorage.setItem(lsKey(), JSON.stringify(state)); if (acct.user) localStorage.setItem(lsKey() + ':meta', JSON.stringify({ base: acct.base, dirty: acct.dirty })); }
  catch (e) { /* storage full or blocked: the server copy still works */ }
}
const hasOwnData = (s) => !!(s && !s.demo && ((s.raw || '').trim() || s.profile || (s.companies || []).length));
// what is saved on the server: the page's state without the undo history (kept only on this device)
function persistable(s) { const o = Object.assign({}, s, { companies: s.companies.map((c) => { const x = Object.assign({}, c); delete x.history; delete x.fit; return x; }) }); delete o.demo; return o; }
let saveT;
function save() {
  if (!state || state.demo) return;
  if (acct.user) { acct.dirty = true; acct.full = false; syncUI(); }
  clearTimeout(saveT); saveT = setTimeout(() => { writeLocal(); if (acct.user) schedulePush(); }, 250);
}
let pushT;
function schedulePush(ms) { clearTimeout(pushT); pushT = setTimeout(push, ms == null ? 1200 : ms); }
async function push() {
  if (!acct.user || acct.syncing || acct.conflict || !acct.dirty || !state || state.demo) return;
  if (!acct.me || !acct.me.consent) return;   // saved to the account only once the user has agreed
  acct.syncing = true; acct.dirty = false; syncUI();
  try {
    const r = await api('PUT', '/api/workspace', { data: persistable(state), base: acct.base });
    acct.base = r.version; acct.offline = false;
  } catch (e) {
    if (e.code === 'conflict') { acct.conflict = true; acct.dirty = true; showConflict(); }
    else if (e.code === 'too_big') { acct.dirty = true; acct.full = true; showNotice('保存できるデータの上限を超えました。使わなくなった応募先を削除すると保存できます。'); }
    else if (e.code === 'login') { acct.dirty = true; }
    else { acct.dirty = true; acct.offline = true; schedulePush(15000); }
  } finally {
    acct.syncing = false; writeLocal(); syncUI();
    if (acct.dirty && !acct.conflict && !acct.offline && !acct.full) schedulePush();
  }
}
function syncUI() {
  const el = $('#sync'); if (!el) return;
  el.textContent = !state || state.demo ? '' : !acct.user ? 'ログインすると保存されます' : acct.me && !acct.me.consent ? '同意後に保存'
    : acct.conflict ? '別の端末で更新されています' : acct.full ? '容量の上限のため未保存' : acct.offline ? 'オフライン・未保存' : acct.syncing || acct.dirty ? '保存中…' : '保存済み';
  el.className = 'sync' + (acct.conflict || acct.offline || acct.full ? ' warn' : '');
}
window.addEventListener('beforeunload', (e) => { if (acct.user && acct.dirty && !acct.conflict) { push(); e.preventDefault(); } });
let lastPull = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !acct.user || acct.dirty || acct.syncing || !state || state.demo || anyBusy() || Date.now() - lastPull < 20000) return;
  lastPull = Date.now();
  try {
    const w = await api('GET', '/api/workspace');
    if (w.data && w.version > acct.base) { adopt(w.data, w.version); toast('別の端末で保存された最新の内容を読み込みました'); }
  } catch (e) { /* stay with this copy */ }
});
function adopt(data, version) {
  const keep = state && !state.demo ? { step: state.step, active: state.active, active4: state.active4 } : null;
  state = migrate(Object.assign(fresh(), data)); if (keep) Object.assign(state, keep);
  acct.base = version; acct.dirty = false; acct.conflict = false; writeLocal(); render();
}

async function token() {
  if (CFG.dev) return 'Dev ' + (localStorage.getItem('resume-dev-user') || '');
  const s = window.Clerk && window.Clerk.session;
  const t = s ? await s.getToken() : null;
  if (!t) throw { code: 'login' };
  return 'Bearer ' + t;
}
async function api(method, path, data, signal) {
  let j = null; let status = 0;
  try {
    const r = await fetch(path, { method, headers: Object.assign({ authorization: await token(), 'x-resume-lang': UI_LANG, 'x-resume-src': SRC, 'x-resume-variant': (acct.me && acct.me.variant) || '' }, data ? { 'content-type': 'application/json' } : {}), body: data ? JSON.stringify(data) : undefined, signal });
    status = r.status;
    const text = await r.text();
    try { j = JSON.parse(text); } catch (e) { j = null; }
  } catch (e) {
    if (e && e.code) throw e;
    if (e && e.name === 'AbortError') throw { code: 'cancelled' };
    throw { code: 'network' };
  }
  if (!j || j.error || status >= 400) throw Object.assign({ code: status === 401 ? 'login' : 'http_' + status, status, body: j }, j && j.error);
  return j;
}
async function refreshMe() {
  const m = await api('GET', '/api/me');
  // paid: has bought credits (URL reading and company research are for them); research: researches used per 応募先
  // slots: 応募先 that have used a credit; previews: made but not yet taken out; free: left of the free trial
  acct.me = { credits: m.credits, slots: new Set(m.slots), previews: new Set(m.previews || []), free: m.free || null, recent: m.recent || null, refunds: m.refunds || [], variant: m.variant || '', consent: m.consent, paid: !!m.paid, research: m.research || {} };
  acctUI(); modelClass(); return acct.me;
}
const hasSlot = (c) => !!(acct.me && acct.me.slots.has(c.id));
// a 応募先 whose documents can be read here but not yet saved or copied (no credit used for it)
const locked = (c) => !!c && !c.sample && !state.demo && !hasSlot(c);
// the pricing test's variant 'b': saving and copying a 職務経歴書 needs no credit (the credit is for 志望動機・面接準備
// and the other AI documents); docLocked: the documents of this 応募先 cannot leave the page yet
const docsFree = () => (acct.me ? acct.me.variant === 'b' : !!CFG.docsFree);
// the landing page has both models' copy (.m-a / .m-b); the class picks one
const modelClass = () => document.documentElement.classList.toggle('docs-free', docsFree());
modelClass();
const docLocked = (c) => locked(c) && !docsFree();
// a new company that cannot be made before buying (the free previews are used up)
const overPreview = (c) => !!(acct.me && locked(c) && !c.doc && !acct.me.previews.has(c.id) && previewsLeft() <= 0);
const previewsLeft = () => (acct.me && acct.me.free ? acct.me.free.previews : Infinity);
const isPaid = () => !!(acct.me && acct.me.paid);
const researchLeft = (c) => (CFG.research || 3) - ((acct.me && acct.me.research[c.id]) || 0);
const RESUMABLE = new Set(['extract', 'analyze', 'generate', 'pack', 'prep', 'rkMotive', 'explain', 'analyzeAll', 'generateAll', 'research', 'fetchJob', 'pdf', 'docx', 'rkPdf', 'enPdf', 'enDocx', 'copyField', 'copyText', 'copyPart', 'taste']);
const SHOW_ONLY = new Set();   // after a purchase these would be shown, not started (none now: using a credit is always asked first)
// made and read on the screen before the 応募先 uses its credit; the others use it (worker/ai.js TASKS)
const PREVIEW_TASKS = new Set(['generate', 'shorten', 'explain']);
const UNLOCK_TASKS = new Set(['pack', 'prep', 'rk', 'english', 'research']);
let lastAct = null;
// the action that led to the login or the purchase; an earlier one is dropped when this one can't be resumed
// (otherwise a stale "作成する" would run again after the payment)
function savePending() { try { if (lastAct) sessionStorage.setItem('resume-pending', JSON.stringify(lastAct)); else sessionStorage.removeItem('resume-pending'); } catch (e) { /* not resumed */ } }
function runPending() {
  let a = null; try { a = JSON.parse(sessionStorage.getItem('resume-pending') || 'null'); sessionStorage.removeItem('resume-pending'); } catch (e) { return false; }
  if (!a || !RESUMABLE.has(a.act)) return false;
  const sel = Object.keys(a).map((k) => `[data-${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}="${CSS.escape(a[k])}"]`).join('');
  const btn = document.querySelector(sel);
  if (!btn || btn.disabled) return false;
  if (SHOW_ONLY.has(a.act)) { setTimeout(() => { btn.scrollIntoView({ block: 'center', behavior: 'smooth' }); btn.focus({ preventScroll: true }); btn.classList.add('flash'); }, 150); return true; }
  // confirmed already before the login or the payment ("もう一度押す"): not asked twice
  setTimeout(() => { btn.dataset.confirm = '1'; btn.click(); }, 150); return true;
}

const controllers = {};
const ctxPay = () => ({ name: state.name, raw: state.raw, answers: state.answers, intent: state.intent, profile: state.profile, explainLang: state.explainLang, nameEn: state.nameEnGuess ? '' : (state.nameEn || ''), uiLang: UI_LANG, mask: state.mask !== false });
// the general version (登録用・汎用版): not a posting but the 職種 the user is looking for, for job-site profiles,
// agent registration and scouts; the analysis prompt reads the first line (prompts.js P_ANALYZE rule 7)
const generalJob = (c) => `【登録用・汎用版】特定の会社の求人ではありません。転職サイトの Web 職務経歴書、転職エージェントへの登録、スカウトに使う1通です。\n希望職種：${(c.target || '').trim()}${(c.info || '').trim() ? '\n重視したいこと：' + c.info.trim() : ''}`;
const cPay = (c) => ({ id: c.id, name: c.general ? '登録用（汎用版）' : c.name, anon: !!c.anon && !c.name.trim(), job: c.general ? generalJob(c) : c.job, info: c.info, priority: c.priority, memo: c.memo, analysis: c.analysis, doc: c.doc, maxPages: c.maxPages, research: c.research && !c.research.sample ? c.research : null,
  pack: c.pack ? { motivation: c.pack.motivation } : null, stages: (c.stages || []).map((s) => ({ name: s.name, status: s.status, date: s.date, format: s.format, who: s.who, log: s.log })) });
// one AI step on the server: task is profile / analyze / generate / shorten / pack / prep / rk / explain
async function ask(task, extra, key) {
  if (state.demo) throw { code: 'demo' };
  if (!acct.user) { savePending(); openLogin(); throw { code: 'login' }; }
  if (!acct.me) await refreshMe();
  // a dialog is about to ask (consent, the credit): the elapsed time starts from its answer
  const gated = !acct.me.consent || !!(extra && extra.c && UNLOCK_TASKS.has(task) && locked(extra.c));
  if (!acct.me.consent && !(await askConsent())) throw { code: 'consent_declined' };
  const c = extra && extra.c;
  if (task === 'research' && !acct.me.paid) { openBuy('会社の公開情報の調査は、利用枠を購入した方が使える機能です。', 'buyer'); throw { code: 'paid_only' }; }
  // a new 応募先 for an account that has used its free previews
  if (c && PREVIEW_TASKS.has(task) && locked(c) && !acct.me.previews.has(c.id) && previewsLeft() <= 0) { openBuy('', 'preview'); throw { code: 'quiet' }; }
  // 志望動機・面接準備・履歴書・英文レジュメ・調査: the 応募先 uses its credit first (asked before)
  if (c && UNLOCK_TASKS.has(task) && locked(c) && !(await ensureUnlocked(c))) throw { code: 'quiet' };
  if (gated) ui.gateEnd = Date.now();
  const ctl = new AbortController(); controllers[key] = ctl;
  try {
    // company research needs only the company and the posting (nothing about the user is sent)
    const payload = task === 'research'
      ? { task, ctx: { uiLang: UI_LANG }, c: { id: c.id, name: c.name, job: c.job, analysis: c.analysis ? { company: c.analysis.company, position: c.analysis.position } : null, hosts: [hostOf(c.jobUrl), hostOf(c.siteUrl)].filter(Boolean) } }
      : Object.assign({ task, ctx: ctxPay() }, extra, c ? { c: cPay(c) } : {});
    const j = await api('POST', '/api/ai', payload, ctl.signal);
    if (typeof j.credits === 'number') acct.me.credits = j.credits;
    if (c && j.slot) {
      if (j.unlocked) { acct.me.slots.add(c.id); acct.me.previews.delete(c.id); }
      else if (!acct.me.previews.has(c.id)) { acct.me.previews.add(c.id); if (acct.me.free) acct.me.free.previews = Math.max(0, acct.me.free.previews - 1); }
    }
    if (c && task === 'research') acct.me.research[c.id] = (acct.me.research[c.id] || 0) + 1;
    acctUI();
    return j.result;
  } catch (e) {
    const b = e.body || {};
    if (typeof b.credits === 'number' && acct.me) { acct.me.credits = b.credits; acctUI(); }
    if (e.code === 'no_credit') { acct.me.credits = 0; acctUI(); openBuy('', 'unlock', c); }
    if (e.code === 'preview_limit') { if (acct.me.free) acct.me.free.previews = 0; openBuy('', 'preview'); }
    if (e.code === 'limit' && e.scope === 'life') openBuy(errMsg(e));
    if (e.code === 'consent') acct.me.consent = false;
    if (e.code === 'login') openLogin();
    throw e;
  } finally { if (controllers[key] === ctl) delete controllers[key]; }
}
// messages that are not a failure (sign in to go on, a dialog answered "no"): shown plainly, not in red
const softErr = (m) => !!m && (m === errMsg({ code: 'login' }) || m === errMsg({ code: 'consent_declined' }));
function errMsg(e) {
  const c = e && e.code;
  const scope = e && e.scope;
  const m = {
    login: 'ログインすると、そのまま続きを実行します。',
    consent: '利用規約とデータの取り扱いへの同意が必要です。もう一度押してください。',
    consent_declined: '同意いただけなかったため、AI は使っていません。',
    no_credit: '利用枠が足りません。利用枠を追加すると続けられます。',
    preview_limit: `購入前に無料で作成・確認できる応募先は${(CFG.preview && CFG.preview.free) || 2}社までです。`,
    quiet: '',
    demo: 'サンプルでは AI は動きません。「自分の経歴で始める」から始めてください。',
    limit: scope === 'service' ? '本日はご利用が集中しているため、AI を一時的に止めています。明日以降にお試しください。'
      : scope === 'slot' ? 'この応募先で AI を使える回数の上限に達しました。お問い合わせください。'
      : scope === 'preview' ? 'この応募先は、まだ利用枠を使っていないため、AI で作り直せる回数の上限に達しました。書類を保存するか志望動機・面接準備を作る（1社分を使う）と、続けて作り直せます。'
      : scope === 'life' ? '無料でお試しいただける回数の上限に達しました。利用枠を購入すると、続けてお使いいただけます。'
      : scope === 'research' ? `会社の公開情報の調査は、1社につき${CFG.research || 3}回までです。`
      : scope === 'fetch' ? 'URL からの読み込みは1日30回までです。明日またお試しください。'
      : '本日の AI の利用回数の上限に達しました。明日またお試しください。',
    busy: 'AI が混み合っています。少し時間をおいて、もう一度お試しください。',
    invalid_json: 'AI の出力をうまく読み取れませんでした。もう一度お試しください。',
    too_long: 'AI の出力が長くなりすぎました。入力を少し短くして、もう一度お試しください。',
    refused: 'この内容では AI が回答できませんでした。入力内容を見直してください。',
    prompt_too_large: '入力が長すぎます。求人票や経歴を短くしてからお試しください。',
    payload: '入力が長すぎます。求人票や経歴を短くしてからお試しください。',
    network: '通信できませんでした。インターネット接続を確認して、もう一度お試しください。',
    not_configured: 'AI の設定がまだ完了していません。しばらくしてからお試しください。',
    cancelled: '中止しました。',
    company_changed: `この応募先は「${(e && e.label) || '別の会社'}」の分として利用枠を使っています。別の会社に応募するときは「＋ 応募先を追加」から追加してください。`,
    paid_only: 'この機能は、利用枠を購入した方が使えます。',
    sample: 'サンプルの会社は架空のため、公開情報は調べられません。',
    research_empty: `公開情報を十分に見つけられませんでした（回数と利用枠は使っていません）。会社名を正式名称にするか、公式サイトの URL を入れてもう一度お試しください。${e && e.reason ? '（' + e.reason + '）' : ''}`,
    url: 'URL の形が正しくありません。「https://」から始まる求人ページの URL を貼ってください。',
    site_not_allowed: 'このサイトは利用規約などの理由で自動では読み込めません。求人ページの本文をコピーして、下の欄に貼り付けてください。',
    robots: 'このページはサイトの設定（robots.txt）で自動の読み込みが許可されていません。本文をコピーして、下の欄に貼り付けてください。',
    login_required: 'ログインが必要なページのため読み込めません。本文をコピーして、下の欄に貼り付けてください。',
    page_error: 'ページを開けませんでした。URL を確かめるか、本文をコピーして下の欄に貼り付けてください。',
    not_html: 'ウェブページではないため読み込めません（PDF や画像の可能性があります）。開いて本文をコピーし、下の欄に貼り付けてください。',
    too_little: '本文をほとんど読み取れませんでした（画面を JavaScript で表示するページの可能性があります）。本文をコピーして、下の欄に貼り付けてください。',
    unreachable: 'ページに接続できませんでした。時間をおいて試すか、本文をコピーして下の欄に貼り付けてください。',
  }[c];
  return m != null ? m : ('エラーが発生しました（' + (c || (e && e.message) || 'unknown') + '）。もう一度お試しください。');
}
async function pool(items, n, fn) {
  const q = items.slice(); const run = async () => { while (q.length) { const it = q.shift(); try { await fn(it); } catch (e) { /* handled in fn */ } } };
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, run));
}
// where the first visit came from (kept in this browser): utm_source, or the referring site's host
const SRC = (() => {
  try {
    let v = localStorage.getItem('resume-src');
    if (v == null) {
      const q = new URLSearchParams(location.search); let r = '';
      try { r = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { /* none */ }
      v = String(q.get('utm_source') || (r && r !== location.hostname ? r : '')).toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
      localStorage.setItem('resume-src', v);
    }
    return v;
  } catch (e) { return ''; }
})();
function beacon(e) { try { navigator.sendBeacon('/api/event', new Blob([JSON.stringify({ e, lang: UI_LANG, src: SRC })], { type: 'application/json' })); } catch (er) { /* not counted */ } }
function saveFile(name, data, type) {
  if (window.APP_SAVE) return window.APP_SAVE(name, data, type);   // a page host that saves files its own way (the preview)
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = name; a.hidden = true; document.body.appendChild(a); a.click();
  // removed later: Chromium drops the file name when the link goes away at once
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 30000);
}
const MIME = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', json: 'application/json' };

// ---- sign-in (Clerk; a test login in local development) ----
const APPEARANCE = { variables: { colorPrimary: '#0B1220', colorText: '#0B1220', colorBackground: '#FFFDF9', fontFamily: '"Host Grotesk","Zen Kaku Gothic New","Hiragino Sans",sans-serif', borderRadius: '12px' } };
function loadScript(src, attrs) {
  return new Promise((ok, ng) => {
    const s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
    Object.keys(attrs || {}).forEach((k) => s.setAttribute(k, attrs[k]));
    s.onload = ok; s.onerror = () => ng(new Error('load ' + src)); document.head.appendChild(s);
  });
}
async function initAuth() {
  if (CFG.dev) { const u = localStorage.getItem('resume-dev-user'); acct.user = u ? { id: 'dev_' + u, name: u } : null; return; }
  if (!CFG.clerkKey) { acct.unavailable = true; return; }
  try {
    const fapi = atob(CFG.clerkKey.split('_')[2]).slice(0, -1);
    await loadScript(`https://${fapi}/npm/@clerk/ui@1/dist/ui.browser.js`);
    await loadScript(`https://${fapi}/npm/@clerk/clerk-js@6/dist/clerk.browser.js`, { 'data-clerk-publishable-key': CFG.clerkKey });
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, localization: { ja: window.CLERK_JA, en: window.CLERK_EN, zh: window.CLERK_ZH }[UI_LANG], appearance: APPEARANCE, afterSignOutUrl: UI_LANG === 'ja' ? '/' : '/' + UI_LANG + '/' });
    acct.user = window.Clerk.user ? { id: window.Clerk.user.id } : null;
    window.Clerk.addListener(({ user }) => { const id = user ? user.id : null; if (id !== (acct.user ? acct.user.id : null)) onUserChange(id ? { id } : null); });
  } catch (e) { console.error(e); acct.unavailable = true; }
}
function openLogin() {
  if (CFG.dev) {
    openModal(`<h2 id="modalTitle">${CFG.preview ? 'プレビュー用ログイン' : 'テスト用ログイン（開発環境）'}</h2><p class="hint">本番ではここで Clerk のログイン画面（メールアドレス・Google・LINE）が開きます。</p>
      <label for="devName">ユーザー名</label><input type="text" id="devName" value="tester"><div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">閉じる</button><button class="btn primary" data-act="devLogin">ログイン</button></div>`);
    return;
  }
  if (acct.unavailable || !window.Clerk) { toast('ログイン機能を読み込めませんでした。ページを再読み込みしてください'); return; }
  window.Clerk.openSignIn({});
}
async function onUserChange(user) {
  const prev = acct.user;
  if (state && !state.demo) writeLocal();
  // a save still waiting would otherwise land under the new account (and the pre-login copy would stay behind)
  clearTimeout(saveT); clearTimeout(pushT);
  // signing out: this account's copy leaves the browser (kept only if it has changes the server lacks)
  if (prev && !user && !acct.dirty) [lsKey(), lsKey() + ':meta', lsKey() + ':backup'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
  acct.user = user; acct.me = null; acct.base = 0; acct.dirty = false; acct.conflict = false;
  if (user) { await loadAccount(); toast('ログインしました'); } else { state = readLocal(GUEST) || fresh(); migrate(state); ui.lp = !hasOwnData(state); }
  acctUI(); render();
  if (user) afterSignIn();
}
// right after signing in: carry on with what the user had clicked, or ask for consent so their data can be saved
function afterSignIn() {
  if (runPending()) return;
  if (acct.me && !acct.me.consent && hasOwnData(state) && $('#modal').classList.contains('hidden')) askConsent();
}
// after signing in: the saved data from the server, this device's copy, or what was typed before signing in
async function loadAccount() {
  let ws = null;
  try {
    const r = await Promise.all([refreshMe(), api('GET', '/api/workspace')]);
    ws = r[1];
  } catch (e) {
    acct.offline = true;
    state = readLocal(lsKey()) || readLocal(GUEST) || fresh(); migrate(state); ui.lp = false;
    showNotice('サーバーに接続できませんでした。この端末に残っている内容を表示しています。接続が戻ると保存されます。');
    return;
  }
  const local = readLocal(lsKey()); const meta = readMeta(); const guest = readLocal(GUEST);
  if (ws.data) {
    if (local && meta.base === ws.version) { state = local; acct.base = ws.version; acct.dirty = !!meta.dirty; }
    else {
      if (local && meta.dirty && hasOwnData(local)) { try { localStorage.setItem(lsKey() + ':backup', JSON.stringify(local)); } catch (e) { /* no room */ } }
      state = Object.assign(fresh(), ws.data); acct.base = ws.version;
    }
    if (hasOwnData(guest) && JSON.stringify(persistable(guest)) !== JSON.stringify(persistable(state))) guestChoice(guest);
  } else {
    state = local || (hasOwnData(guest) ? guest : null) || state && !state.demo && hasOwnData(state) && state || fresh();
    acct.base = 0; acct.dirty = hasOwnData(state);
    // the pre-login copy has become this account's: it is not offered again later
    if (guest && (state === guest || JSON.stringify(persistable(guest)) === JSON.stringify(persistable(state)))) try { localStorage.removeItem(GUEST); } catch (e) { /* ignore */ }
  }
  migrate(state); ui.lp = false; writeLocal();
  if (acct.dirty) schedulePush(300);
}
function guestChoice(guest) {
  const n = (s) => (s.companies || []).filter((c) => !c.sample).length; const docs = (s) => (s.companies || []).filter((c) => c.doc && !c.sample).length;
  const notes = (s) => len((s.raw || '').trim()); const head = (s) => { const t = (s.raw || '').trim().replace(/\s+/g, ' '); return t ? `「${h(t.slice(0, 30))}${t.length > 30 ? '…' : ''}」` : ''; };
  const line = (lab, s) => `<li><b>${lab}</b>：経歴メモ${notes(s)}字${head(s)}・応募先${n(s)}社（書類${docs(s)}社）</li>`;
  // the side with more of the user's work is offered first; neither is pre-selected as "safe"
  const score = (s) => docs(s) * 5 + n(s) * 2 + (notes(s) >= 100 ? 1 : 0); const guestFirst = score(guest) >= score(state);
  const bs = [['useSaved', 'アカウントの内容を使う'], ['useGuest', 'ログイン前の内容を使う']]; if (guestFirst) bs.reverse();
  openModal(`<h2 id="modalTitle">ログイン前に入力した内容があります</h2>
    <p>この端末でログインする前に入力した内容と、アカウントに保存されている内容があります。どちらを使いますか？</p>
    <ul class="hint">${line('アカウントの内容', state)}${line('ログイン前の内容', guest)}</ul>
    <div class="row">${bs.map(([a, l]) => `<button class="btn" data-act="${a}">${l}</button>`).join('')}</div>
    <p class="hint">選ばなかった方は削除されます（アカウントの内容を使う場合、ログイン前の内容はこの端末から消えます）。</p>`, { lock: true });
  ui.guest = guest;
}
function showConflict() {
  openModal(`<h2 id="modalTitle">別の端末で更新されています</h2>
    <p>別の端末またはタブで、より新しい内容が保存されました。どちらを残しますか？</p>
    <div class="row"><button class="btn" data-act="conflictLoad">新しい内容を読み込む</button><button class="btn primary" data-act="conflictKeep">この画面の内容で上書き</button></div>`, { lock: true });
}

// ---- modal, consent, purchase ----
let modalResolve = null; let modalLock = false;
function openModal(html, o) {
  $('#sheet').innerHTML = html; $('#modal').classList.remove('hidden'); document.body.classList.add('noscroll'); modalLock = !!(o && o.lock);
  $('#modal').scrollTop = 0;   // a tall sheet on a phone opens at its title and reason, not at the buttons
  const f = $('#sheet').querySelector('input'); const t = $('#sheet').querySelector('#modalTitle');
  if (t) t.setAttribute('tabindex', '-1');
  setTimeout(() => { const el = f || t || $('#sheet').querySelector('button.primary'); if (el) el.focus({ preventScroll: true }); $('#modal').scrollTop = 0; }, 30);
}
function closeModal(v) { $('#modal').classList.add('hidden'); document.body.classList.remove('noscroll'); modalLock = false; if (modalResolve) { const r = modalResolve; modalResolve = null; r(v); } }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !modalLock) closeModal(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden') && !modalLock) closeModal(false); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing || !e.target.matches || !e.target.matches('[data-cf=jobUrl]')) return;
  e.preventDefault(); const b = e.target.closest('[data-cid]') && e.target.closest('[data-cid]').querySelector('[data-act=fetchJob]'); if (b && !b.disabled) b.click();
});
// open / closed sections are remembered across re-renders (the posting, the research result)
document.addEventListener('click', (e) => {
  const sm = e.target.closest && e.target.closest('summary'); const d = sm && sm.parentElement; if (!d || d.tagName !== 'DETAILS' || !d.dataset) return;
  const k = d.dataset.jobd ? 'jobOpen' : d.dataset.rs ? 'rsOpen' : d.dataset.an ? 'anOpen' : ''; if (!k) return;
  const c = company(d.dataset.jobd || d.dataset.rs || d.dataset.an); if (c) c[k] = !d.open;   // the click is about to flip it
}, true);
function askConsent() {
  return new Promise((ok) => {
    modalResolve = ok;
    openModal(`<h2 id="modalTitle">はじめる前に：データの取り扱い</h2>
      <p class="assure"><b>入力した内容が AI の学習に使われることはありません。</b><br><b>履歴書の住所・電話番号・写真は AI に送りません。</b></p>
      <ul class="consent">
        <li>経歴・求人票・面接の記録などは、書類と面接対策を作るために <b>Anthropic, PBC（米国）</b>の AI「Claude」に送信されます。</li>
        <li>入力内容と書類は、続きから使えるようにアカウントに保存されます（保存：Cloudflare, Inc.、ログイン：Clerk, Inc.、いずれも米国）。いつでも削除でき、最後に使ってから${keepFor()}たつと自動で削除されます。</li>
        <li>AI の出力には誤りが含まれることがあります。提出前に、内容が事実どおりか必ずご確認ください。</li>
        ${UI_LANG !== 'ja' ? '<li>書類は日本語で作られます。提出前に、アプリ内の母語の対訳で内容を確認してください。</li>' : ''}
      </ul>
      <p class="hint">外国にある第三者への提供と各国の個人情報保護制度については<a href="${h(CFG.privacy)}" target="_blank" rel="noopener">プライバシーポリシー</a>をご覧ください。</p>
      ${UI_LANG !== 'ja' ? '<p class="hint">利用規約とプライバシーポリシーは日本語版が正式なものです。</p>' : ''}
      <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">同意しない</button><button class="btn primary" data-act="consentOk"><span>利用規約・プライバシーポリシーに同意して始める</span></button></div>
      <p class="hint" style="text-align:right;margin-top:8px"><a href="${h(CFG.terms)}" target="_blank" rel="noopener">利用規約</a>　<a href="${h(CFG.privacy)}" target="_blank" rel="noopener">プライバシーポリシー</a></p>`, { lock: true });
  });
}
// the cheapest pack, for "利用枠の購入が必要です（5社 2,480円〜）"
const fromPrice = () => { const p = (CFG.packs || []).slice().sort((a, b) => a.price - b.price)[0]; return p ? `${p.price.toLocaleString('ja-JP')}円〜` : ''; };
// a company whose credit is not used yet: what saving and the other tabs will do
function lockNoteHTML(c) {
  if (!locked(c) || !acct.user || !acct.me) return '';
  if (c.tab === 'rireki') return `<p class="hint tiny lock-note">履歴書の保存は無料です（利用枠を使いません）。「志望の動機」を AI で作るときに、この会社で1社分を使います${acct.me.credits > 0 ? `（あと${acct.me.credits}社分）` : `（利用枠の購入が必要です：${fromPrice()}）`}。</p>`;
  if (docsFree()) return acct.me.credits > 0
    ? `<p class="hint tiny lock-note">この会社の職務経歴書は、保存・コピーとも無料です。志望動機・面接準備・英文レジュメを作ると、この会社で1社分を使います（あと${acct.me.credits}社分）。</p>`
    : `<p class="hint tiny lock-note">この会社の職務経歴書は、保存・コピーとも無料です。志望動機・面接準備・英文レジュメには、利用枠の購入が必要です（${fromPrice()}）。<button class="linkbtn" data-act="openBuy" data-why="unlock">利用枠を追加する</button></p>`;
  return acct.me.credits > 0
    ? `<p class="hint tiny lock-note">保存・コピーするか、志望動機・面接準備・英文レジュメを作ると、この会社で1社分を使います（あと${acct.me.credits}社分）。それまでは何度でも画面で確認・修正できます。履歴書の保存は無料です。</p>`
    : `<p class="hint tiny lock-note warn">保存・コピーと、志望動機・面接準備・英文レジュメには、利用枠の購入が必要です（${fromPrice()}）。画面での確認・修正と、履歴書の保存は無料です。<button class="linkbtn" data-act="openBuy" data-why="unlock">利用枠を追加する</button></p>`;
}
const docAch = (d) => (d.careers || []).flatMap((x) => x.blocks.flatMap((b) => b.achievements)).slice(0, 3).map((t) => t.slice(0, 26) + (t.length > 26 ? '…' : '')).join(' ／ ');
// what was made for this company, shown where the user decides to pay for it
function tailoredHTML(c) {
  const a = c.analysis || {}; const d = c.doc || {};
  const rows = [
    a.values && a.values.length ? ['この会社が重視していること', a.values.slice(0, 3).map((v) => v.label).join('・')] : null,
    a.summary_angle ? ['職務要約の打ち出し方', a.summary_angle] : null,
    d.pr && d.pr.length && UI_LANG === 'ja' ? ['自己PRの見出し', d.pr.map((p) => '「' + p.heading + '」').join('　')] : null,
  ].filter(Boolean);
  if (!rows.length) return '';
  const other = state.companies.filter((x) => x !== c && x.doc && !x.sample).sort((x, y) => (locked(x) ? 1 : 0) - (locked(y) ? 1 : 0))[0];
  const first = (t) => { const m = /^[^。]*。?/.exec(t || ''); return (m ? m[0] : '').slice(0, 90); };
  const vs = other ? [
    ['職務要約の書き出し', first(other.doc.summary), first(d.summary)],
    ['自己PRの見出し', (other.doc.pr || []).map((p) => '「' + p.heading + '」').join(''), (d.pr || []).map((p) => '「' + p.heading + '」').join('')],
    ['実績の並び（最初の3つ）', docAch(other.doc), docAch(d)],
  ].filter((r) => r[1] && r[2] && r[1] !== r[2]) : [];
  const vsHTML = vs.length && UI_LANG === 'ja' ? `<div class="vs"><b>「${h(cname(other))}」向けの書類との違い</b>${vs.map(([k, x, y]) => `<div><span>${h(k)}</span><span><small>「${h(cname(other))}」向け</small>${h(x)}</span><span><small>この会社向け</small>${h(y)}</span></div>`).join('')}</div>` : '';
  // what this company's interviewers are likely to press on, read off the free analysis (no AI call): the
  // requirements the career only partly meets, then the gaps
  // the questions this company's interview is likely to ask, read off the free analysis (no AI call): the
  // requirements the career only partly meets, the values, and the ones every company asks; answers are what the credit makes
  const weakReq = (a.requirements || []).filter((r) => r.match === '△').map((r) => r.text).slice(0, 2);
  const qs = [
    ...weakReq.map((t) => `「${t}」について、具体的に教えてください（一部だけ合う要件です）`),
    a.values && a.values[0] ? `当社が大切にしている「${a.values[0].label}」に関わる経験はありますか` : '',
    `なぜ当社を志望されたのですか`,
    state.profile && /[A-Za-z]{4,}\s[A-Za-z]{3,}/.test(state.raw || '') && !/[\u3040-\u30ff]/.test((state.raw || '').slice(0, 200)) ? '日本で働き続ける予定や、日本語での業務経験を教えてください' : '',
  ].filter(Boolean).slice(0, 4);
  const askHTML = qs.length ? `<div class="asks"><b>この会社の面接で聞かれそうな質問（求人の分析から・一部）</b><ul>${qs.map((t) => `<li>${h(t)}</li>`).join('')}</ul><p class="hint tiny" style="margin:4px 0 0">1社分を使うと、これらを含む9問前後の想定質問に、回答例・答え方のポイント（経歴にない経験は盛らずに、近い経験でどう答えるか）・やさしい日本語の版を作ります。</p></div>` : '';
  return `${vsHTML}<div class="tailored"><b>この会社向けに作ったところ</b>${rows.map(([k, v]) => `<div><span>${h(k)}</span><span>${h(v)}</span></div>`).join('')}<p class="hint tiny" style="margin:6px 0 0">1社分を使うと、この内容に合わせた志望動機（300字・150字）、想定質問と回答例（9問前後）、逆質問、選考ごとの面接対策も作れます。</p></div>${c.taste || c.tasteStatus === 'run' ? '' : askHTML}`;
}
// bought recently: a bigger pack for the difference (worker/billing.js upgradeOffer works out the same)
function upgradeHTML(packs) {
  const r = acct.me && acct.me.recent;
  // before any purchase: say that a small one now can become a bigger pack later at the difference
  if (!r || !r.credits) return packs.length > 1 && packs.some((p) => p.credits === 1) ? `<p class="hint tiny" style="margin:-2px 0 8px">迷ったら1社分から。購入から${CFG.upgradeDays || 30}日以内なら、払った金額を差し引いた差額で、まとめ買いのパックに切り替えられます。</p>` : '';
  const offers = packs.filter((p) => p.credits > r.credits && p.price > r.amount).map((p) => ({ p, add: p.credits - r.credits, amount: p.price - r.amount }));
  if (!offers.length) return '';
  return `<div class="upg"><b>差額で、まとめ買いの料金に切り替えられます</b><p class="hint tiny" style="margin:2px 0 6px">直近${CFG.upgradeDays || 30}日間に購入した${r.credits}社分（${r.amount.toLocaleString('ja-JP')}円）を差し引きます。</p>${offers.map((o) => `<button class="btn" data-act="buy" data-pack="${h(o.p.id)}" data-up="1">${h(o.p.label)}に切り替え：差額${o.amount.toLocaleString('ja-JP')}円で${o.add}社分を追加</button>`).join('')}</div>`;
}
// kind: 'buyer' (a feature for buyers), 'unlock' (this 応募先's documents need its 1社分), 'preview' (no more
// free previews), '' (adding credits)
// the payment methods turned on in Stripe (config PAY_METHODS), as the sheet names them
const PAY_NAMES = { card: 'クレジットカード', wallet: 'Apple Pay・Google Pay', paypay: 'PayPay', konbini: 'コンビニ払い' };
const payMethodsText = () => ((CFG.payMethods && CFG.payMethods.length ? CFG.payMethods : ['card']).map((k) => PAY_NAMES[k]).filter(Boolean)).join('・');
// purchases that can still be refunded (within the days, no credit used since)
function refundsHTML() {
  const rs = (acct.me && acct.me.refunds) || []; if (!rs.length) return '';
  const pk = (id) => ((CFG.packs || []).find((p) => p.id === id) || {}).label || id;
  return `<div class="refunds">${rs.map((r) => { const d = new Date(r.until); return `<div><span>${h(pk(r.pack))}${r.up ? '（差額）' : ''}・${r.amount.toLocaleString('ja-JP')}円は、まだ1社分も使っていないため、${d.getMonth() + 1}月${d.getDate()}日まで返金できます。</span><button class="btn small ghost" data-act="refund" data-session="${h(r.session)}">返金する</button></div>`; }).join('')}</div>`;
}
const PLAN = [['1', '1〜2社', 1], ['5', '3〜5社', 5], ['10', '6社以上', 10]];
function openBuy(reason, kind, c) {
  const packs = CFG.packs || [];
  const left = acct.me ? acct.me.credits : null;
  if (reason || kind) savePending();
  ui.buyArgs = [reason, kind, c];
  // the pack that fits the number of companies the user means to apply to (asked once, in this dialog)
  const want = PLAN.find((x) => x[0] === ui.plan);
  const rec = (want && packs.slice().sort((a, b) => a.credits - b.credits).find((p) => p.credits >= want[2] - Math.max(0, left || 0))) || packs.find((p) => p.rec) || null;
  const buyer = kind === 'buyer';
  if (kind === 'unlock' && !c) kind = '';
  // from step 4 (an interview is set or passed): the sheet is about that interview
  const st = kind === 'unlock' && c && state.step === 4 ? (c.stages || []).find((x) => x.status === '予定') : null;
  const title = buyer ? '利用枠を購入する' : st ? `「${h(st.name)}」の対策を作る` : kind === 'unlock' ? (docsFree() ? 'この会社の志望動機・面接準備を作る' : 'この会社の書類を保存する・面接準備をする') : kind === 'preview' ? '次の応募先の書類を作る' : '利用枠を追加する';
  const lead = kind === 'unlock' && c ? (docsFree() ? `<p>「${h(cname(c))}」の<b>志望動機・面接準備・英文レジュメ</b>には、この会社の1社分が必要です（職務経歴書の保存・コピーは無料）。</p>` : `<p>「${h(cname(c))}」の職務経歴書は、画面で確認できています。<b>保存（PDF・Word）・コピーと、志望動機・面接準備・英文レジュメ</b>には、この会社の1社分が必要です。</p>`)
    : kind === 'preview' ? (acct.me && acct.me.paid
      ? `<p class="status warn">まだ1社分を使っていない応募先が多いため、新しい応募先の書類を作れません（残りの利用枠＋${(CFG.preview && CFG.preview.open) || 3}社まで）。作った会社の書類を保存して1社分を使うか、利用枠を追加してください。</p>`
      : `<p class="status warn">${docsFree() ? `購入前に無料で作成・保存できる職務経歴書は${(CFG.preview && CFG.preview.free) || 2}社までです。` : `購入前に無料で作成・確認できる応募先は${(CFG.preview && CFG.preview.free) || 2}社までです。`}</p>${left ? `<p class="hint">残っている無料の1社分は、作成済みの応募先（${state.companies.filter((x) => x.doc && locked(x)).map((x) => '「' + h(cname(x)) + '」').join('') || 'これまでに作った会社'}）の保存に使えます。3社目からの作成には購入が必要です。</p>` : ''}`) : '';
  // the prices come first (on a phone the sheet is long); what this company's credit gives follows
  openModal(`<button class="sheet-x" data-act="closeModal" aria-label="閉じる">×</button><h2 id="modalTitle">${title}</h2>
    ${reason ? `<p class="status warn">${h(reason)}</p>` : ''}${lead}
    ${kind === 'unlock' && c ? tasteHTML(c, 'buy') : ''}
    ${buyer ? `<p class="hint" style="margin:0 0 8px">${docsFree() ? '購入すると、すでに登録した会社にも使えます。' : '無料の1社分では使えません。購入すると、すでに登録した会社にも使えます。'}</p>` : ''}
    <div class="plan-q"><span>書き分けたい・面接対策をしたい会社：</span>${PLAN.map(([k, l]) => `<button class="${ui.plan === k ? 'on' : ''}" data-act="plan" data-v="${k}">${l}</button>`).join('')}</div>
    <div class="packs">${packs.map((p) => `<button class="buy-pack ${p === rec ? 'rec' : ''}" data-act="buy" data-pack="${h(p.id)}">${p === rec && packs.length > 1 ? '<span class="badge">おすすめ</span>' : ''}<span class="pl">${h(p.label)}</span><b>${p.price.toLocaleString('ja-JP')}円</b><small>1社あたり${Math.round(p.price / p.credits).toLocaleString('ja-JP')}円</small><span class="go">購入へ進む →</span></button>`).join('')}</div>
    <p class="hint buy-terms">買い切り（月額・自動更新なし）・有効期限なし。購入から${CFG.refundDays || 7}日以内で、購入後に1社分も使っていなければ返金できます。お支払い：${payMethodsText()}（Stripe の決済画面）。${left != null ? `いまの利用枠：あと${left}社分。` : ''}</p>
    ${refundsHTML()}
    ${upgradeHTML(packs)}
    ${kind === 'unlock' && c ? tailoredHTML(c) : ''}
    ${kind === 'unlock' && c ? `<p class="hint after-pay">お支払いのあと、この画面に戻ります。続けて「${h(cname(c))}」で1社分を使うかを確認します。</p>` : ''}
    ${kind === 'preview' ? '<p class="hint">購入すると、作成済みで保存していない応募先の書類も、そのまま保存できます。新しい応募先の書類も作れます。</p>'
      : docsFree() ? '<p class="hint">1社分 ＝ 1つの応募先。その会社の志望動機・面接準備・英文レジュメ・会社調査を作るときに1回だけ使います。そのあとは、その会社の分を何度作り直しても追加料金はかかりません（1日に使える回数には上限があります）。職務経歴書の保存・コピーと履歴書は無料です。購入すると、3社目からの職務経歴書も作れます。</p>'
      : '<p class="hint">1社分 ＝ 1つの応募先。その会社の書類を保存・コピーするとき、または志望動機・面接準備などを作るときに1回だけ使います。そのあとは、その会社の職務経歴書・履歴書・英文レジュメ・志望動機・面接準備を何度作り直しても追加料金はかかりません（1日に使える回数には上限があります）。最初の1社の書類は、ほかの会社への応募にもそのまま使えます。利用枠は、書き分けたい会社・面接が決まった会社に使ってください。</p>'}
    <ul class="trust buyer"><li>会社の公開情報の調査（出典付き・1社につき${CFG.research || 3}回まで。その会社の1社分に含まれます）</li><li>会社の採用ページの URL から求人票を読み込み（転職サイトの求人は本文を貼り付けてください）</li></ul>
    <p class="hint">表示価格がお支払いの総額です。職務経歴書は、利用枠を使う前に画面で確かめられます。</p>
    <p class="hint"><a href="${h(CFG.terms)}" target="_blank" rel="noopener">利用規約</a>　<a href="https://www.flatland.co.jp/legal/tokushoho/" target="_blank" rel="noopener">特定商取引法に基づく表記</a></p>
    <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">閉じる</button></div>`);
}
// before a 応募先's documents leave the page (or a task that needs its credit runs): use its 1社分, once,
// after asking. true when it may go ahead.
async function ensureUnlocked(c) {
  if (!locked(c)) return true;
  if (!acct.user) { savePending(); openLogin(); return false; }
  if (!acct.me) await refreshMe();
  if (!locked(c)) return true;
  if (acct.me.credits <= 0) { openBuy('', 'unlock', c); return false; }
  const n = acct.me.credits;
  const ok = await new Promise((done) => {
    openModal(`<h2 id="modalTitle">${acct.me.paid ? 'この会社で1社分を使います' : 'この会社で無料の1社分を使います'}</h2>
      <p>「${h(cname(c))}」で、次のことができるようになります。</p>
      <ul class="trust buyer">${docsFree() ? '<li>英文レジュメの作成と保存</li>' : '<li>職務経歴書・英文レジュメの保存（PDF・Word）とコピー</li>'}<li>志望動機・想定質問と回答例・逆質問、履歴書の志望動機</li><li>選考ごとの面接対策</li>${acct.me.paid ? `<li>会社の公開情報の調査（${CFG.research || 3}回まで）</li>` : ''}</ul>
      <p class="hint">この会社の分は、このあと何度作り直しても追加の利用枠はかかりません。使った1社分は戻せません。利用枠：あと${n}社分 → ${n - 1}社分</p>
      ${acct.me.paid ? '' : `<p class="hint">無料の1社分はこれだけです。${docsFree() ? '2社目からの志望動機・面接準備' : '2社目からの保存'}には利用枠の購入が必要です。応募するつもりの会社に使ってください。</p>`}
      ${!acct.me.paid && !docsFree() && !c.general && !state.companies.some((x) => x.general) ? '<p class="hint">同じ職務経歴書で多くの会社に応募する予定（転職サイトの Web 職務経歴書・エージェント登録）なら、無料の1社分は、ステップ2の「登録用の汎用版」に使う方が向いています。</p>' : ''}
      <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">やめる</button><button class="btn primary" data-act="unlockOk">1社分を使って続ける</button></div>`);
    modalResolve = done;
  });
  if (!ok) return false;
  try {
    const j = await api('POST', '/api/unlock', { id: c.id });
    acct.me.credits = j.credits; acct.me.slots.add(c.id); acct.me.previews.delete(c.id); acctUI(); render();
    return true;
  } catch (e) {
    if (e.code === 'no_credit') { acct.me.credits = 0; acctUI(); openBuy('', 'unlock', c); } else toast(errMsg(e));
    return false;
  }
}
async function buy(pack, btn) {
  if (!acct.user) { closeModal(false); openLogin(); return; }
  btn.disabled = true; btn.classList.add('wait');
  try {
    await push();
    const r = await api('POST', '/api/checkout', { pack, lang: UI_LANG, upgrade: btn.dataset.up === '1' });
    try { sessionStorage.setItem('resume-credits-before', String(acct.me ? acct.me.credits : 0)); } catch (e) { /* compared with the current count */ }
    if (r.url) { location.href = r.url; return; }
    // added without a payment page (the preview)
    closeModal(true); await refreshMe(); render(); runPending(); showNotice(`お支払いが完了し、利用枠を追加しました（あと${acct.me.credits}社分）。`);
  } catch (e) { btn.disabled = false; btn.classList.remove('wait'); toast(e.code === 'not_configured' ? '決済の準備がまだ整っていません' : '決済画面を開けませんでした。もう一度お試しください'); }
}
// back from Stripe: /?paid=<session> (or cancel)
async function paidReturn() {
  const q = new URLSearchParams(location.search); const s = q.get('paid'); if (!s) return;
  q.delete('paid'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  if (s === 'cancel') { toast('購入を取りやめました'); return; }
  if (!acct.user) return;
  // the count before going to Stripe (the webhook may already have added the pack by the time the page loads)
  // without that count (the return opened in another tab or browser) the server's word that the session is paid decides
  let before = acct.me ? acct.me.credits : 0; let known = false; let paid = false;
  try { const b = sessionStorage.getItem('resume-credits-before'); if (b != null) { before = Number(b); known = true; sessionStorage.removeItem('resume-credits-before'); } } catch (e) { /* as is */ }
  showNotice('お支払いを確認しています…');
  if (!CFG.dev) try { const r = await api('POST', '/api/checkout/confirm', { session: s }); paid = !!(r && r.paid && r.ok); } catch (e) { /* the webhook adds it */ }
  else paid = !known;
  const done = () => acct.me && (acct.me.credits > before || (!known && paid && acct.me.credits > 0));
  for (let i = 0; i < 8; i++) {
    try { await refreshMe(); } catch (e) { /* retry */ }
    if (done()) break;
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  hideNotice();
  if (done()) { render(); const went = runPending(); showNotice([`お支払いが完了し、利用枠を追加しました（あと${acct.me.credits}社分）。`, went ? '' : '会社の公開情報の調査と、採用ページ URL の読み込みも使えます。']); }
  else showNotice('お支払いの確認に時間がかかっています。数分後にページを再読み込みしてください。解決しない場合はお問い合わせください。');
}
async function deleteAccount() {
  try {
    await api('DELETE', '/api/account');
    [lsKey(), lsKey() + ':meta', lsKey() + ':backup', GUEST].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
    acct.dirty = false; closeModal(true);
    if (CFG.dev) { localStorage.removeItem('resume-dev-user'); await onUserChange(null); } else if (window.Clerk) await window.Clerk.signOut();
    state = fresh(); ui.lp = true; render(); toast('アカウントとデータを削除しました');
  } catch (e) { toast('削除できませんでした。もう一度お試しください'); }
}
function acctUI() {
  const el = $('#acct'); if (!el) return;
  if (!acct.ready) return;
  if (!acct.user) { el.innerHTML = `<a class="pricelink" href="#price" data-act="toPrice">料金</a><button class="btn primary small" data-act="login">ログイン</button>`; return; }
  const n = acct.me ? acct.me.credits : null;
  const needs = n === 0 && state && !state.demo && state.companies.some((c) => c.doc && docLocked(c));
  const pill = `<button class="credit ${needs ? 'zero' : ''}" data-act="openBuy" title="書類の保存・面接準備に使える応募先の数（追加できます）">${n == null ? '…' : `<span class="unit">利用枠 </span>あと<b>${n}</b>社`}<span class="plus">＋</span></button>`;
  if (CFG.dev) { el.innerHTML = pill + `<button class="btn ghost small" data-act="devLogout">${h(acct.user.id)}（ログアウト）</button>`; return; }
  if (!el.querySelector('#userBtn')) { el.innerHTML = '<span id="pill"></span><div id="userBtn"></div>'; try { window.Clerk.mountUserButton($('#userBtn')); } catch (e) { console.error(e); } }
  $('#pill').innerHTML = pill;
}

// ---------------- fonts ----------------
const F = { bytes: {}, fk: {}, fam: {}, meas: null, ready: false, err: null };
let fontsP = null;
const loadFonts = () => fontsP || (fontsP = (async () => {
  await Promise.all(Object.keys(E.FONT_FILES).map(async (k) => {
    const r = await fetch(ASSET(E.FONT_FILES[k]));
    if (!r.ok) throw new Error('font ' + k + ' ' + r.status);
    const buf = new Uint8Array(await r.arrayBuffer());
    F.bytes[k] = buf; F.fk[k] = fontkit.create(buf);
    const fam = 'RF-' + k; const ff = new FontFace(fam, buf.slice().buffer);
    await ff.load(); document.fonts.add(ff); F.fam[k] = fam;
  }));
  F.meas = E.makeMeasurer(F.fk); F.ready = true;
})().catch((e) => { F.err = e; console.error(e); }).then(() => { if (state && state.step === 3) render(); }));

// ---------------- normalizers ----------------
const A = (v) => (Array.isArray(v) ? v : (v ? [v] : []));
const Sx = (v) => (v == null ? '' : String(v));
function normProfile(p) {
  p = p || {};
  return {
    name: Sx(p.name),
    careers: A(p.careers).map((c) => ({ company: Sx(c.company), start: Sx(c.start), end: Sx(c.end), business: Sx(c.business), employees: Sx(c.employees), employment: Sx(c.employment),
      roles: A(c.roles).map((r) => ({ start: Sx(r.start), end: Sx(r.end), org: Sx(r.org), title: Sx(r.title), team: Sx(r.team), duties: A(r.duties).map(Sx), achievements: A(r.achievements).map(Sx), tr: Sx(r.tr),
        // IT engineers: the projects of this role, kept as the AI structured them (env, phases)
        projects: A(r.projects).filter((x) => x && typeof x === 'object').map((x) => ({ start: Sx(x.start), end: Sx(x.end), name: Sx(x.name), overview: Sx(x.overview), role: Sx(x.role), team: Sx(x.team), phases: A(x.phases).map(Sx), env: x.env && typeof x.env === 'object' ? x.env : A(x.env).map(Sx), duties: A(x.duties).map(Sx), achievements: A(x.achievements).map(Sx) })) })) })),
    education: A(p.education).map((x) => ({ date: Sx(x.date), school: Sx(x.school), detail: Sx(x.detail) })).filter((x) => x.school),
    episodes: A(p.episodes).map((e, i) => ({ id: Sx(e.id) || 'E' + (i + 1), title: Sx(e.title), tr: Sx(e.tr), career_index: e.career_index, role: Sx(e.role), situation: Sx(e.situation), action: Sx(e.action), result: Sx(e.result), metrics: A(e.metrics).map(Sx).filter(Boolean), strengths: A(e.strengths).map(Sx).filter(Boolean) })),
    skills: { expertise: A(p.skills && p.skills.expertise).map(Sx), tools: A(p.skills && p.skills.tools).map(Sx), languages: A(p.skills && p.skills.languages).map(Sx),
      tech: A(p.skills && p.skills.tech).filter((x) => x && typeof x === 'object').map((x) => ({ cat: Sx(x.cat), name: Sx(x.name), years: Sx(x.years) })).filter((x) => x.name) },
    qualifications: A(p.qualifications).map((q) => ({ date: Sx(q.date), name: Sx(q.name) })).filter((q) => q.name),
    missing: A(p.missing).map((m) => ({ q: Sx(m.q || m.question), why: Sx(m.why) })).filter((m) => m.q).slice(0, 5),
  };
}
function normAnalysis(a) {
  a = a || {};
  return { company: Sx(a.company), position: Sx(a.position), summary: Sx(a.summary),
    values: A(a.values).map((v) => ({ label: Sx(v.label), detail: Sx(v.detail), source: Sx(v.source), quote: Sx(v.quote) })),
    requirements: A(a.requirements).map((r) => ({ text: Sx(r.text), type: Sx(r.type), match: Sx(r.match), evidence: Sx(r.evidence) })),
    conditions: A(a.conditions).map((x) => ({ item: Sx(x.item), posting: Sx(x.posting), wish: Sx(x.wish), match: Sx(x.match) })).filter((x) => x.item && x.match),
    plan: A(a.plan).map((p) => ({ value: Sx(p.value), episode_ids: A(p.episode_ids).map(Sx), angle: Sx(p.angle) })),
    summary_angle: Sx(a.summary_angle), pr_themes: A(a.pr_themes).map(Sx), keywords: A(a.keywords).map(Sx), gaps: A(a.gaps).map(Sx),
    template: E.THEMES[a.template] ? a.template : 'modern', template_reason: Sx(a.template_reason) };
}
// easy answers carry readings as 漢字《かんじ》: shown as ruby (furigana), or hidden; copied and checked without them
const RUBY = /([\u4e00-\u9fff々〆ヶ]+)《([\u3041-\u309fー]+)》/g;
const noRuby = (t) => String(t || '').replace(/《[^》]*》/g, '');
// the 【要記入】 marks of fill() kept: readings are put in after it
const hasRuby = (t) => /[\u4e00-\u9fff々〆ヶ]《[\u3041-\u309fー]+》/.test(String(t || ''));
const rubyFill = (t) => { const x = h(ui.ruby === false ? noRuby(t) : t).replace(/【要記入[^】]*】/g, (m) => `<mark class="todo">${m}</mark>`); return ui.ruby === false ? x : x.replace(RUBY, '<ruby>$1<rt>$2</rt></ruby>'); };
// spoken Japanese calls the company 御社 (貴社 is for writing): the interview answers and reverse questions
const spoken = (t) => Sx(t).replace(/貴社/g, '御社');
function normPack(p) {
  p = p || {}; const m = p.motivation || {};
  // *_tr: the translation for the English / Chinese page (the Japanese is what is said in the interview)
  return { at: Number(p.at) || 0, motivation: { long: Sx(m.long), short: Sx(m.short), long_tr: Sx(m.long_tr), short_tr: Sx(m.short_tr), used: A(m.used).map(Sx) },
    flow: { note: Sx(p.flow && p.flow.note), steps: A(p.flow && p.flow.steps).map((s) => ({ name: Sx(s.name), who: Sx(s.who), focus: Sx(s.focus) })) },
    questions: A(p.questions).map((q) => ({ q: Sx(q.q), q_tr: Sx(q.q_tr), intent: Sx(q.intent), points: A(q.points).map(Sx), answer: spoken(q.answer), answer_easy: spoken(q.answer_easy), answer_tr: Sx(q.answer_tr) })),
    reverse: A(p.reverse).map(spoken), reverse_tr: A(p.reverse_tr).map(Sx), cautions: A(p.cautions).map(Sx) };
}
// the free look at one company's interview prep (the short 志望動機 and one question with its answer)
function normTaste(t) {
  t = t || {}; const q = t.question || {};
  return { short: Sx(t.short), short_tr: Sx(t.short_tr), q: { q: Sx(q.q), q_tr: Sx(q.q_tr), intent: Sx(q.intent), points: A(q.points).map(Sx), answer: spoken(q.answer), answer_easy: spoken(q.answer_easy), answer_tr: Sx(q.answer_tr) } };
}
// step 1 without a 職務経歴書 (phones): one employer at a time, seven short answers, written into the career box
const QA_FIELDS = [
  ['co', '会社名と、何の会社か', '例：株式会社〇〇（レディースアパレルの販売）'],
  ['period', '働いた期間', '例：2019年4月〜現在'],
  ['role', '職種・役職・雇用形態', '例：販売 → 2022年から店長（正社員）'],
  ['team', '人数や規模（部下・チーム・担当した店舗やお客様の数）', '例：スタッフ8名、月の来店 約3,000人'],
  ['work', '担当していた仕事', '例：接客販売、シフト作成、新人教育、在庫と発注、売上の集計'],
  ['result', '数字で言える成果（売上・件数・％・順位・期間など。だいたいでも可）', '例：予算比 105%（2023年度）、リピート率 28%→35%'],
  ['how', '工夫したこと・任されたこと', '例：購入後のお礼メッセージを全員で始めた／エリアの新人研修を担当'],
];
function qaFormHTML() {
  return `<h2 id="modalTitle">質問に答えて経歴を書く</h2>
    <p class="hint">1社ずつ答えてください。分からない欄は空のままで大丈夫です。数字は「約」「だいたい」でもかまいません（あとで確認を求められます）。</p>
    ${QA_FIELDS.map(([k, l, ph]) => `<label for="qa-${k}">${l}</label><textarea id="qa-${k}" rows="${k === 'work' || k === 'result' || k === 'how' ? 2 : 1}" placeholder="${ph}"></textarea>`).join('')}
    <label for="qa-skill">資格・スキル・語学（最後の1回だけで大丈夫です）</label><textarea id="qa-skill" rows="1" placeholder="例：普通自動車免許、ITパスポート勉強中、Excel（集計・グラフ）"></textarea>
    <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">閉じる</button><button class="btn" data-act="qaAdd" data-more="1">書き込んで、もう1社答える</button><button class="btn primary" data-act="qaAdd">書き込む</button></div>`;
}
function qaAdd(more) {
  const v = (k) => (($('#qa-' + k) || {}).value || '').trim();
  const L = [];
  if (v('co')) L.push(`■ ${v('co')}${v('period') ? '（' + v('period') + '）' : ''}`); else if (v('period')) L.push(`■ ${v('period')}`);
  [['role', '職種・役職'], ['team', '規模'], ['work', '担当した仕事'], ['result', '成果'], ['how', '工夫したこと・任されたこと']].forEach(([k, l]) => { if (v(k)) L.push(`${l}：${v(k)}`); });
  if (v('skill')) L.push('', `資格・スキル・語学：${v('skill')}`);
  if (!L.length) { toast('どれか1つは入力してください'); return; }
  state.raw = (state.raw.trim() ? state.raw.trim() + '\n\n' : '') + L.join('\n');
  save(); closeModal(true); render();
  if (more) openModal(qaFormHTML()); else toast('経歴の欄に書き込みました');
}
// a part of the page on paper (or "Save as PDF"): the review sheet for a native check, the interview sheet
function printSheet(title, html) {
  let a = $('#printArea'); if (!a) { a = document.createElement('div'); a.id = 'printArea'; document.body.appendChild(a); }
  a.innerHTML = `<h1>${h(title)}</h1>${html}`;
  a.querySelectorAll('button, .rubyopt, .status, .taste').forEach((e) => e.remove()); a.querySelectorAll('details').forEach((d) => { d.open = true; });
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done); setTimeout(() => window.print(), 50);
}
// the whole check as one sheet: each passage in Japanese, its translation and the notes; then the wording advice
function reviewSheetHTML(c) {
  const x = c.explain; if (!x) return '';
  const sec = x.sections.map((t) => `<div class="ps-r"><div class="ps-h" data-noi18n>${h(t.title)}</div><div class="ps-ja" data-noi18n>${h(t.ja)}</div><div class="ps-tr">${h(t.tr)}</div>${(t.notes || []).length ? `<ul>${t.notes.map((n) => `<li>${h(n)}</li>`).join('')}</ul>` : ''}</div>`).join('');
  const nat = (x.naturalness || []).length ? `<h2>もっと自然な言い方</h2>${x.naturalness.map((n) => `<div class="ps-r"><div class="ps-ja" data-noi18n>${h(n.ja)} → ${h(n.suggestion)}</div><div class="ps-tr">${h(n.issue)}</div></div>`).join('')}` : '';
  return `<p class="ps-note">日本語が母語の方（友人・リクルーターなど）に確認してもらうためのシートです。左が提出する日本語、その下が対訳と書き方の解説です。</p>${sec}${nat}`;
}
function normPrep(p) {
  p = p || {};
  return { summary: Sx(p.summary), focus: A(p.focus).map(Sx), questions: A(p.questions).map((q) => ({ q: Sx(q.q), q_tr: Sx(q.q_tr), why: Sx(q.why), points: A(q.points).map(Sx) })),
    fixes: A(p.fixes).map((f) => ({ issue: Sx(f.issue), better: spoken(f.better), better_tr: Sx(f.better_tr) })), reverse: A(p.reverse).map(spoken), reverse_tr: A(p.reverse_tr).map(Sx), checklist: A(p.checklist).map(Sx) };
}
let lastFixed = [];
function normExplain(x) {
  x = x || {};
  return { overview: Sx(x.overview), sections: A(x.sections).map((t) => ({ title: Sx(t.title), ja: Sx(t.ja), tr: Sx(t.tr), notes: A(t.notes).map(Sx) })),
    naturalness: A(x.naturalness).map((n) => ({ ja: Sx(n.ja), issue: Sx(n.issue), suggestion: Sx(n.suggestion), applied: false })).filter((n) => n.ja && n.suggestion), conventions: A(x.conventions).map(Sx) };
}
function prepDoc(raw) {
  let d = E.normalizeDoc(raw);
  const map = window.CHARFIX || {}; const txt = JSON.stringify(d);
  lastFixed = [...new Set([...txt].filter((ch) => map[ch]))].map((ch) => ch + '→' + map[ch]);
  d = E.fixChars(d, map);
  d.date = today() + '現在';
  d.name = E.fixChars(state.name || (state.profile && state.profile.name) || '', window.CHARFIX || {});
  return d;
}

// ---------------- checks ----------------
const nd = (s) => String(s).replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))).replace(/,(?=\d{3})/g, '');
// Numbers are checked against what the user typed (not against AI-structured data), with digit boundaries.
function unitForms(t) {
  const out = []; const num = (x) => String(+x.toFixed(4)).replace(/\.0+$/, '');
  String(t || '').replace(/(\d+(?:\.\d+)?)\s*(k|thousand|m|mn|million|b|bn|billion)\b/gi, (m, n, u) => {
    const v = +n; const k = u.toLowerCase();
    const mul = k === 'k' || k === 'thousand' ? 1e3 : k[0] === 'm' ? 1e6 : 1e9;
    out.push(num(v * mul), num(v * mul / 1e4), num(v * mul / 1e8)); return m;
  });
  String(t || '').replace(/(\d+(?:\.\d+)?)\s*(千万|百万|万|亿|億)/g, (m, n, u) => { const v = +n; const mul = { 千万: 1e7, 百万: 1e6, 万: 1e4, 亿: 1e8, 億: 1e8 }[u]; out.push(num(v * mul), num(v * mul / 1e4), num(v * mul / 1e8)); return m; });
  const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  String(t || '').replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?/gi, (m, x) => { out.push(String(MON.indexOf(x.toLowerCase()) + 1)); return m; });
  return out.join(' ');
}
function userSource() { const it = state.intent || {}; return nd([unitForms([state.raw, Object.values(state.answers || {}).join('\n')].join('\n')), state.raw, Object.values(state.answers || {}).join('\n'), it.reason, it.axis, it.conditions, ...(state.companies || []).flatMap((c) => (c.stages || []).map((s) => Object.values(s.log || {}).join('\n')))].join('\n')); }
// `more`: other text the numbers may come from (the job posting, for interview material that quotes it)
// the researched facts as text: numbers taken from them are not the user's, but they are sourced
const researchText = (c) => (c && c.research ? [...c.research.facts, ...c.research.position].map((f) => [f.text, f.date, (f.date || '').replace(/^(\d{4})-0?(\d+).*$/, '$1年$2月')].join(' ')).join('\n') : '');
function checkNumbers(parts, more) {
  const src = userSource() + '\n' + nd(more || ''); const all = new Set(), bad = new Set();
  parts.forEach((t) => { (nd(t || '').match(/\d+(?:\.\d+)?/g) || []).forEach((n) => { all.add(n); const re = new RegExp('(^|[^0-9.])' + n.replace(/\./g, '\\.') + '(?![0-9]|\\.[0-9])'); if (!re.test(src)) bad.add(n); }); });
  return { checked: all.size, bad: [...bad] };
}
const docParts = (doc) => [doc.summary, ...(doc.highlights || []).flatMap((x) => [x.value, x.label]), ...doc.careers.flatMap((c) => [c.business, c.meta, ...c.blocks.flatMap((b) => [b.heading, b.overview, b.role, b.team, ...(b.env || []), ...b.duties, ...b.achievements])]), ...doc.skills, ...doc.tech, ...(doc.skillTable || []).flatMap((r) => [r.name, r.years, r.level]), ...doc.pr.map((p) => p.heading + ' ' + p.body)];
// on the English / Chinese page the points and summaries are in that language; only the Japanese is checked
const packParts = (p) => [p.motivation.long, p.motivation.short, ...p.questions.flatMap((q) => [q.answer, ...(UI_LANG === 'ja' ? q.points : [])])];
const prepParts = (p) => [...(UI_LANG === 'ja' ? [p.summary, ...p.questions.flatMap((q) => q.points)] : []), ...p.fixes.map((f) => f.better)];
function futureDates(doc) {
  const now = new Date(); const cur = now.getFullYear() * 12 + now.getMonth() + 1; const out = [];
  [...doc.careers.flatMap((c) => [c.period, ...c.blocks.map((b) => b.period)]), ...doc.qualifications.map((q) => q.date)].forEach((p) => {
    (String(p).match(/(\d{4})年(\d{1,2})月/g) || []).forEach((m) => { const [, y, mo] = /(\d{4})年(\d{1,2})月/.exec(m); if (+y * 12 + +mo > cur) out.push(m); });
  });
  return [...new Set(out)];
}
// the 応募先's name, 貴社 or 御社 written in the 職務経歴書 (the first one found)
function companyIn(c) {
  const t = docParts(c.doc).join('\n'); const n = cname(c).replace(/株式会社|（株）|\(株\)|（架空）|\s+/g, '');
  if (/貴社|御社/.test(t)) return (t.match(/貴社|御社/) || [''])[0];
  return n.length >= 2 && t.replace(/\s+/g, '').includes(n) ? n : '';
}
const simplifiedIn = (doc) => { const map = window.CHARFIX || {}; return [...new Set([...JSON.stringify(doc)].filter((ch) => map[ch]))]; };

// ---------------- stages ----------------
const ST = ['未定', '予定', '通過', '不通過', '辞退'];
function ensureStages(c) {
  if (c.stages && c.stages.length) return c.stages;
  // the steps' names are the user's own text: in the page's language
  const DEF = { ja: ['書類選考', '一次面接', '二次面接', '最終面接'], en: ['Document screening (書類選考)', '1st interview (一次面接)', '2nd interview (二次面接)', 'Final interview (最終面接)'], zh: ['简历筛选（書類選考）', '一面（一次面接）', '二面（二次面接）', '终面（最終面接）'] };
  const names = c.pack && c.pack.flow.steps.length ? c.pack.flow.steps.map((s) => s.name).filter(Boolean) : DEF[UI_LANG];
  c.stages = names.map((n, i) => newStage({ name: n, who: c.pack && c.pack.flow.steps[i] ? c.pack.flow.steps[i].who : '' }));
  return c.stages;
}
function curStage(c) { const s = c.stages || []; const i = s.findIndex((x) => x.status !== '通過'); return i; }
function nextEvent(c) { return (c.stages || []).filter((s) => s.status === '予定' && s.date && daysFrom(s.date) >= 0).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null; }
function hasLog(s) { return Object.values(s.log || {}).some((v) => (v || '').trim()); }

// ---------------- actions ----------------
async function extractProfile() {
  if (!state.raw.trim()) { toast('経歴を入力してください'); return; }
  state.profileStatus = 'run'; state.profileError = ''; state.since = Date.now(); render();
  try {
    state.profile = normProfile(await ask('profile', {}, 'profile'));
    if (!state.name && state.profile.name) state.name = state.profile.name;
    state.profileStatus = 'done';
  } catch (e) { state.profileStatus = 'err'; state.profileError = errMsg(e); }
  save(); render();
  // on a phone the result is far below the button: brought into view
  if (state.profileStatus === 'done' && state.step === 1 && window.innerWidth < 720) setTimeout(() => { const r = $('#result'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 200);
}
async function analyze(c) {
  if (!state.profile) { toast('先に「経歴」で経歴を整理してください'); return; }
  if (c.general ? !(c.target || '').trim() : !c.job.trim()) { toast(c.general ? '希望する職種を入れてください' : '求人票を貼り付けてください'); return; }
  c.status = 'analyzing'; c.error = ''; c.since = Date.now(); render();
  try {
    c.analysis = normAnalysis(await ask('analyze', { c }, 'an-' + c.id)); c.analyzedAt = Date.now();
    if (!c.name && c.analysis.company) c.name = c.analysis.company;
    c.status = c.doc ? 'done' : 'analyzed';
  } catch (e) { c.status = c.doc ? 'done' : (c.analysis ? 'analyzed' : 'idle'); c.error = errMsg(e); }
  save(); render();
}
async function generate(c) {
  if (!c.analysis) { toast('先に求人票を分析してください'); return; }
  if (!c.maxPages) { const p = state.profile || { careers: [] }; const roles = p.careers.reduce((n, x) => n + x.roles.length, 0); c.maxPages = (p.careers.length >= 4 || roles >= 6) ? 3 : 2; }
  if (!c.theme) c.theme = c.analysis.template || 'modern';
  c.status = 'generating'; c.error = ''; c.rounds = 0; c.since = Date.now(); render();
  try {
    const raw = await ask('generate', { c }, 'gen-' + c.id);
    pushHistory(c);
    c.doc = prepDoc(raw); c.fixed = lastFixed; c.dirty = false;
    await fit(c);
    c.status = 'done';
  } catch (e) { c.status = c.doc ? 'done' : 'analyzed'; c.error = errMsg(e); }
  save(); render();
}
async function fit(c) {
  await loadFonts();
  if (!F.ready) return;
  for (let r = 0; r <= 2; r++) {
    const rep = E.fitReport(E.layout(c.doc, c.theme, F.meas, opt(c)), c.maxPages);
    c.fit = rep;
    if (rep.ok || r === 2) break;
    c.status = 'fitting'; c.rounds = r + 1; c.since = Date.now(); render();
    const hl = c.doc.highlights;
    const raw = await ask('shorten', { c, rep: { reason: rep.reason, pages: rep.pages, overLines: rep.overLines, overChars: rep.overChars } }, 'fit-' + c.id);
    if (r === 0 && c.dirty) pushHistory(c);
    c.doc = prepDoc(raw); c.fixed = (c.fixed || []).concat(lastFixed); c.dirty = false;
    if (!c.doc.highlights.length && hl.length) c.doc.highlights = hl;
  }
}
async function refit(c) {
  c.error = '';
  try { await fit(c); } catch (e) { c.error = errMsg(e); }
  c.status = 'done'; save(); render();
}
// ---------------- for buyers: a posting from its URL, the company's public information ----------------
const hostOf = (u) => { try { return new URL(String(u || '').trim()).hostname; } catch (e) { return ''; } };
async function fetchJobUrl(c) {
  if (!acct.user) { savePending(); openLogin(); return; }
  if (!acct.me) await refreshMe();
  if (!acct.me.paid) { openBuy('求人ページの URL からの読み込みは、利用枠を購入した方が使える機能です。', 'buyer'); return; }
  const url = (c.jobUrl || '').trim();
  if (!url) { toast('求人ページの URL を入れてください'); const i = document.querySelector(`[data-cid="${c.id}"] [data-cf=jobUrl]`); if (i) i.focus(); return; }
  c.fetchStatus = 'run'; c.fetchError = ''; c.fetchCode = ''; c.fetchNote = []; render();
  try {
    const r = await api('POST', '/api/fetch-job', { url });
    c.jobPrev = c.job; c.job = Sx(r.text).slice(0, 12000); c.jobOpen = true;
    if (!c.name && r.company) c.name = Sx(r.company).slice(0, 120);
    c.fetchNote = [r.count > 1 ? `このページには求人が${r.count}件ありました。最初の1件を読み込んだので、目的の求人か確かめてください。` : '',
      r.expired ? `この求人は掲載期限（${Sx(r.expired)}）を過ぎている可能性があります。` : ''].filter(Boolean);
    c.fetchStatus = ''; toast('求人ページを読み込みました。内容を確かめてから分析してください');
    save(); render();
    setTimeout(() => { const t = document.querySelector(`[data-cid="${c.id}"] [data-cf=job]`); if (t) { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); t.focus({ preventScroll: true }); } }, 60);
    return;
  } catch (e) { c.fetchStatus = ''; c.fetchError = errMsg(e); c.fetchCode = e.code || ''; }
  save(); render();
}
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
// research as stored: facts F1…, what can go into the motivation (hooks), questions with the fact they rest on.
// Older results (talking_points, questions as text) are read too.
function normResearch(r) {
  r = r || {};
  const item = (x, i) => ({ id: Sx(x.id) || (i != null ? 'F' + (i + 1) : ''), topic: Sx(x.topic), entity: Sx(x.entity) || '応募先', text: Sx(x.text), url: safeUrl(x.url), title: Sx(x.title), date: Sx(x.date) });
  const hooks = A(r.hooks).length ? A(r.hooks).map((x) => ({ fact: Sx(x.fact), why: Sx(x.why) })) : A(r.talking_points).map((t) => ({ fact: '', why: Sx(t) }));
  const qs = A(r.questions).map((q, i) => (typeof q === 'string' ? { q: Sx(q), q_tr: Sx(A(r.questions_tr)[i]), premise: '', for: '' } : { q: Sx(q.q), q_tr: Sx(q.q_tr), premise: Sx(q.premise), for: Sx(q.for) }));
  const id = r.identity || {};
  return { company: Sx(r.company), confidence: ['high', 'medium', 'low'].includes(r.confidence) ? r.confidence : 'medium', sample: !!r.sample,
    identity: { official_site: safeUrl(id.official_site), match: Sx(id.match) }, overview: Sx(r.overview), hiring_context: Sx(r.hiring_context),
    facts: A(r.facts).map((x, i) => item(x, i)).filter((x) => x.text && x.url), position: A(r.position).map((x) => item(x)).filter((x) => x.text && x.url),
    hooks: hooks.filter((x) => x.why), questions: qs.filter((q) => q.q),
    check_yourself: A(r.check_yourself).map((x) => (typeof x === 'string' ? { point: Sx(x), ask: '', ask_tr: '' } : { point: Sx(x.point), ask: Sx(x.ask), ask_tr: Sx(x.ask_tr) })).filter((x) => x.point || x.ask),
    caveats: A(r.caveats).map(Sx).filter(Boolean), at: r.at || Date.now() };
}
async function makeResearch(c) {
  c.researchStatus = 'run'; c.researchSince = Date.now(); c.researchError = ''; render();
  try {
    const nr = normResearch(await ask('research', { c }, 'rs-' + c.id));
    if (c.research && !c.research.sample) c.researchPrev = c.research;
    c.research = nr; c.researchStatus = ''; c.rsOpen = true;
  } catch (e) { c.researchStatus = ''; c.researchError = errMsg(e); }
  save(); render();
}
// another 応募先 at the same company already researched: its result can be reused (no search)
const sameCo = (a, b) => { const n = (x) => String(x || '').replace(/株式会社|（株）|\(株\)|（架空）|[\s　]/g, ''); const x = n(a); const y = n(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
const researchTwin = (c) => state.companies.find((x) => x !== c && x.research && !x.research.sample && sameCo(cname(x), cname(c)));
const ymLabel = (d) => { const m = /^(\d{4})-(\d{2})/.exec(d || ''); if (!m) return ''; const y = +m[1]; const mo = +m[2]; return UI_LANG === 'en' ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][mo - 1] + ' ' + y : `${y}年${mo}月`; };
const dayLabel = (t) => { const d = new Date(t); return UI_LANG === 'en' ? d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`; };
const srcLink = (x) => { let host = ''; try { host = new URL(x.url).hostname.replace(/^www\./, ''); } catch (e) { /* none */ } return `<a href="${h(x.url)}" target="_blank" rel="noopener noreferrer nofollow">${h(x.title || host)}<span class="sr">（新しいタブで開きます）</span></a> <span class="cc" data-noi18n>· ${h(host)}${x.date ? ' · ' + h(ymLabel(x.date) || x.date) : ''}</span>`; };
const FOR = { 現場: '現場の担当者・マネージャーに', 部門長: '部門長に', 役員: '役員に' };
function researchHTML(c) {
  const r = c.research; const run = c.researchStatus === 'run';
  const paid = isPaid(); const max = CFG.research || 3; const left = researchLeft(c);
  const live = !c.sample && !state.demo;
  const twin = live && !r ? researchTwin(c) : null;
  if (c.anon && !c.name.trim() && !r) return '<div class="research"><p class="hint tiny" style="margin:0">社名非公開の求人です。志望動機・面接準備は、求人票の業界・事業内容・規模から作ります（社名を推測しません）。社名が分かったら会社名を入れてください。同じ1社分のまま、会社の公開情報の調査と志望動機の作り直しができます。</p></div>';
  let s = `<div class="research" id="rs-${c.id}">`;
  if (!r) {
    s += `<div class="rs-head"><h4 tabindex="-1">会社の公開情報を調べる</h4>${live && !paid ? '<span class="pill lock">購入者向け</span>' : ''}</div>`;
    s += '<p class="hint" style="margin:6px 0 0">会社の公式サイト・ニュース・IR・採用ページを AI が検索し、志望動機や逆質問に使える事実を出典付きでまとめます。</p>';
    s += '<p class="hint tiny" style="margin:4px 0 0">検索に使うのは会社名・職種・求人票だけです。あなたの経歴は送りません。口コミサイトは使いません。</p>';
    if (c.sample && !state.demo) s += '<p class="hint tiny" style="margin:4px 0 0">サンプルの会社は架空のため、公開情報は調べられません。</p>';
    if (live && !run) {
      if (twin) s += `<div class="row" style="margin:10px 0 0"><button class="btn small" data-act="useTwin" data-id="${c.id}">「${h(cname(twin))}」の調査結果を使う（無料）</button></div>`;
      if (!paid) s += `<div class="row" style="margin:10px 0 0;align-items:center"><button class="btn small" data-act="research" data-id="${c.id}">🔒 購入して使う</button><button class="linkbtn" data-act="researchExample">結果の例を見る</button></div>`;
      else {
        s += `<div class="row" style="margin:10px 0 0;align-items:center"><button class="btn small ${c.analysis ? 'primary' : ''}" data-act="research" data-id="${c.id}" ${left <= 0 || BUSY.includes(c.status) ? 'disabled' : ''}>${hasSlot(c) ? '公式サイトやニュースを調べる' : '調べる（この会社の1社分を使う）'}</button><span class="hint tiny">1社につき${max}回まで。1〜2分かかります。</span></div>`;
        if (!hasSlot(c)) s += '<p class="credit-note warn">この会社の利用枠（1社分）を使います。この会社の書類・面接準備は、追加料金なしで作れます。</p>';
      }
    }
  }
  if (run) s += `<div class="status" role="status">${spin}${stage('research', c.researchSince)} ${elapsed(c.researchSince, '1〜2分')} ${abortBtn('rs-' + c.id)}</div>`;
  if (c.researchError) s += `<div class="status err" role="alert">${h(c.researchError)}</div>`;
  if (r) {
    const fact = (id) => r.facts.find((f) => f.id === id);
    s += `<details class="rs" data-rs="${c.id}" ${c.rsOpen || run ? 'open' : ''}><summary><span class="rs-sum"><b>会社の公開情報（出典付き）</b><span>事実${r.facts.length}件</span><span>${h(dayLabel(r.at))} 調査</span></span></summary>`;
    if (r.sample) s += '<p class="hint tiny" style="margin:6px 0 0">サンプル：架空の会社のため、リンク先は例です。</p>';
    // the next step: the motivation statement and interview answers made before this research don't use it yet
    if (!r.sample && live) {
      if (c.pack && (c.pack.at || 0) < r.at) s += `<div class="fb note rs-cta"><span>志望動機・想定問答は、調べる前に作ったものです。</span><button class="btn small primary" data-act="reflect" data-id="${c.id}" ${c.packStatus === 'run' ? 'disabled' : ''}>志望動機・想定問答に反映する（無料）</button></div>`;
      else if (!c.pack) s += `<div class="fb note rs-cta"><span>このあと作る志望動機・面接準備に、調べた情報が使われます。</span></div>`;
    }
    if (r.confidence === 'low') s += '<div class="fb warn" style="margin-top:8px">同じ名前の別の会社の情報が混ざっている可能性があります。リンク先で会社を確かめてください。</div>';
    if (r.overview) s += `<p style="margin:10px 0 4px">${h(r.overview)}</p>`;
    if (r.identity.match || r.identity.official_site) s += `<p class="hint tiny" style="margin:0">${r.identity.match ? `<span>同じ会社か：${h(r.identity.match)}</span> ` : ''}${r.identity.official_site ? `<span class="rs-src">${srcLink({ url: r.identity.official_site, title: '公式サイト' })}</span>` : ''}</p>`;
    if (r.hiring_context) s += `<div class="rs-ctx"><b>募集背景の手がかり</b><span>${h(r.hiring_context)}</span></div>`;
    s += '<div class="rs-cols"><div>';
    if (r.facts.length) s += `<h5>主な事実</h5><ul class="rs-facts">${r.facts.map((x) => `<li><span class="tag gray">${h(x.topic || '公開情報')}</span><div><div>${h(x.text)}${x.entity === 'グループ' ? ' <span class="tag warn">グループ会社</span>' : ''}</div><div class="rs-src">${srcLink(x)}</div></div></li>`).join('')}</ul>`;
    if (r.position.length) s += `<h5>この職種について</h5><ul class="rs-facts">${r.position.map((x) => `<li><span class="tag gray">職種</span><div><div>${h(x.text)}</div><div class="rs-src">${srcLink(x)}</div></div></li>`).join('')}</ul>`;
    s += '</div><div>';
    if (r.hooks.length) s += `<h5>志望動機の材料になりそうなこと</h5><ul>${r.hooks.map((x) => { const f = fact(x.fact); return `<li>${h(x.why)}${f ? `<span class="rs-sub">${h(f.text)}</span>` : ''}</li>`; }).join('')}</ul>`;
    if (r.questions.length) s += `<h5>逆質問の候補</h5><ul>${r.questions.map((q) => `<li><span data-noi18n>${h(q.q)}</span>${trl(q.q_tr)}${FOR[q.for] ? `<span class="rs-sub">${FOR[q.for]}</span>` : ''}</li>`).join('')}</ul>`;
    if (r.check_yourself.length) s += `<h5>自分で確かめたいこと</h5><ul>${r.check_yourself.map((x) => `<li>${h(x.point)}${x.ask ? `<span class="rs-sub"><span>聞き方の例：</span><span data-noi18n>「${h(x.ask)}」</span></span>${trl(x.ask_tr)}` : ''}</li>`).join('')}</ul>`;
    s += `<details class="rs-more"><summary>口コミサイトについて</summary><p>口コミサイトは AI の調査に使っていません。匿名の投稿は書き手の職種や時期を確かめられず、AI が要約すると一部の声が事実のように見えるためです。応募や入社を判断する材料として読むのは役立ちます。読むときは、直近2〜3年の投稿か、職種・部署が近いか、同じ点が複数の投稿で繰り返されているかを見てください。面接では口コミを根拠にせず、気になる点は中立な質問に言い換えて、人事面談やオファー面談で確かめましょう。</p></details>`;
    s += '</div></div>';
    if (r.caveats.length) s += r.caveats.map((x) => `<p class="hint tiny" style="margin:4px 0 0">※ ${h(x)}</p>`).join('');
    s += '<p class="hint tiny" style="margin:8px 0 0">AI が自動で集めた公開情報です。内容と日付はリンク先で確かめてください。検索に使ったのは会社名・職種・求人票だけです。</p>';
    if (live && paid) {
      s += '<div class="row rs-again" style="margin:10px 0 0;align-items:center">';
      if (left > 0) s += `<button class="btn small ghost" data-act="research" data-id="${c.id}" ${run || BUSY.includes(c.status) ? 'disabled' : ''}>もう一度調べる（あと${left}回）</button><span class="hint tiny">別の会社の情報だったとき、情報が少ないときに</span>`;
      else s += `<span class="pill">この会社の調査は上限（${max}回）に達しました</span>`;
      if (c.researchPrev) s += `<span class="spacer"></span><button class="linkbtn" data-act="researchBack" data-id="${c.id}">前回の結果に戻す</button>`;
      s += '</div>';
      if (left > 0) s += `<label class="tiny-l">公式サイトの URL（任意・同じ名前の別の会社と区別するため）</label><input type="url" inputmode="url" data-cf="siteUrl" value="${h(c.siteUrl || '')}" placeholder="https://www.example.co.jp/" aria-label="公式サイトの URL">`;
    }
    s += '</details>';
  }
  return s + '</div>';
}
// the sample result, for people deciding whether to buy
function researchExample() {
  const X = UI_LANG !== 'ja' && window.DEMO_I18N && window.DEMO_I18N[UI_LANG];
  const ex = { id: 'example', sample: true, research: normResearch((X && X.research) || DEMO.research), rsOpen: true };
  openModal(`<h2 id="modalTitle">会社の公開情報の調査：結果の例</h2><p class="hint">架空の会社の例です。実際の調査では、公式サイト・ニュース・IR・採用ページのリンク先が付きます。</p>${researchHTML(ex)}<div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">閉じる</button><button class="btn primary" data-act="openBuy" data-why="buyer">利用枠を購入する</button></div>`);
}

async function makePack(c) {
  c.packStatus = 'run'; c.packError = ''; c.packSince = Date.now(); render();
  try { c.pack = normPack(await ask('pack', { c }, 'pack-' + c.id)); c.pack.at = Date.now(); c.packStatus = 'done'; }
  catch (e) { c.packStatus = c.pack ? 'done' : 'err'; c.packError = errMsg(e); }
  save(); render();
}
async function makeTaste(c) {
  c.tasteStatus = 'run'; c.tasteError = ''; c.tasteSince = Date.now(); render(); reBuy();
  try { c.taste = normTaste(await ask('taste', { c }, 'taste-' + c.id)); c.tasteStatus = 'done'; }
  catch (e) { c.tasteStatus = c.taste ? 'done' : 'err'; c.tasteError = e && e.code === 'limit' ? 'お試しで見られる回数を使い切りました。この会社の面接準備は、1社分を使って作れます。' : errMsg(e); }
  save(); render(); reBuy();
}
// the purchase sheet, drawn again while it is open (the free look runs and lands in it)
function reBuy() { if (ui.buyArgs && !$('#modal').classList.contains('hidden') && $('#modal .packs')) { const [r, k, x] = ui.buyArgs; openBuy(r, k, x); } }
async function makePrep(c, i) {
  const s = c.stages[i];
  s.prepStatus = 'run'; s.prepError = ''; s.since = Date.now(); render();
  try { s.prep = normPrep(await ask('prep', { c, i }, 'prep-' + s.id)); s.prepStatus = 'done'; }
  catch (e) { s.prepStatus = s.prep ? 'done' : 'err'; s.prepError = errMsg(e); }
  save(); render();
}
// where the Word file will be opened (its fonts follow): chosen by the user, or guessed from this device
function wordTarget() {
  if (state.wordTarget) return state.wordTarget;
  const p = ((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || navigator.userAgent || '').toLowerCase();
  return /mac|iphone|ipad/.test(p) ? 'mac' : /win/.test(p) ? 'windows' : /android|cros|linux/.test(p) ? 'google' : 'windows';
}
// 職務経歴書_氏名_日付 (the usual name; no 応募先 in it, so a file sent on to another company does not show it)
// 職務経歴書_氏名_日付 (no company or position: the same file may go to other companies through an agent)
function fname(c, ext) { const d = new Date(); return ('職務経歴書' + (state.name ? '_' + state.name.replace(/\s+/g, '') : '') + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.' + ext).replace(/[\\/:*?"<>|]/g, '_'); }
async function download(c, kind) {
  await loadFonts(); if (!F.ready) { toast('書体の読み込みに失敗しました。ページを再読み込みしてください'); return; }
  try {
    const data = kind === 'pdf'
      ? await E.renderPDF(E.layout(c.doc, c.theme, F.meas, opt(c)), F.bytes, PDFLib, fontkit, { title: '職務経歴書', author: state.name }, F.fk)
      : await E.buildDocx(c.doc, c.theme, JSZip, Object.assign(opt(c), { target: wordTarget() }));
    await saveFile(fname(c, kind), data, MIME[kind]); beacon('download');
    if (!c.downloaded) { c.downloaded = true; save(); setTimeout(render, 600); }
    toast('保存しました');
  } catch (e) { toast('保存に失敗しました'); console.error(e); }
}
// ---------------- 英文レジュメ ----------------
// The name in Latin letters and the contact line are shared by all 応募先; the rest is per 応募先 (c.en).
function enDoc(c) {
  const r = state.rireki || {};
  const contact = state.enContact != null ? state.enContact : [r.email, r.tel].filter(Boolean).join(' · ');
  return Object.assign({}, c.en, { name: state.nameEn || (c.en && c.en.name) || '', contact });
}
const enParts = (d) => [d.headline, d.summary, ...d.experience.flatMap((x) => [x.note, ...x.roles.flatMap((r) => [r.title, ...r.bullets])]), ...d.skills.flatMap((k) => k.items), ...d.education.map((e) => e.degree), ...d.certifications.map((q) => q.name), ...d.languages.map((l) => l.level)];
async function makeEnglish(c) {
  c.enStatus = 'run'; c.enSince = Date.now(); c.enError = ''; render();
  try {
    const r = await ask('english', { c }, 'en-' + c.id);
    c.en = E.normalizeEn(r);
    // a name typed in Latin letters is the user's own spelling: it is used as is, not the AI's reading
    const latin = /^[A-Za-z][A-Za-z .'\-]+$/.test((state.name || '').trim()) ? state.name.trim().replace(/\s+/g, ' ') : '';
    if (latin && (!state.nameEn || state.nameEnGuess)) { state.nameEn = latin; state.nameEnGuess = false; }
    else if (!state.nameEn || state.nameEnGuess) { state.nameEn = c.en.name; state.nameEnGuess = !!(r && r.name_guess); }
    c.enStatus = '';
  } catch (e) { c.enStatus = ''; c.enError = errMsg(e); }
  save(); render();
}
function englishHTML(c) {
  const en = c.en;
  const run = c.enStatus === 'run';
  const ta = (path, v, rows, label, list) => `<label>${label}</label><textarea rows="${rows}" data-en="${path}" data-list="${list || ''}">${h(v)}</textarea>`;
  let edit = '';
  if (en) {
    edit += ta('headline', en.headline, 2, 'Headline（肩書き）') + ta('summary', en.summary, 5, 'Summary（職務要約）');
    en.experience.forEach((x, i) => {
      edit += `<fieldset><legend>${h(x.company)}</legend>`;
      x.roles.forEach((r, j) => { edit += ta(`experience.${i}.roles.${j}.bullets`, r.bullets.join('\n'), 5, h(r.title || 'Role') + ' <span>（1行に1項目）</span>', '1'); });
      edit += '</fieldset>';
    });
    edit += ta('skills', en.skills.map((k) => (k.cat ? k.cat + ': ' : '') + k.items.join(', ')).join('\n'), 4, 'Skills（「Category: A, B」の形）', 'sk');
    edit += ta('certifications', en.certifications.map((q) => q.name + (q.date ? '｜' + q.date : '')).join('\n'), 3, 'Certifications（「名称｜Nov 2023」の形）', 'ce');
    edit += ta('languages', en.languages.map((l) => l.lang + (l.level ? '｜' + l.level : '')).join('\n'), 2, 'Languages（「English｜Business」の形）', 'la');
  }
  const d = en ? enDoc(c) : null;
  return `<div class="rk">
    <div class="stack">
      <div class="card"><h2>英文レジュメ</h2>
        <p class="hint">外資系企業や、英文での提出を求められた応募先に。日本語の職務経歴書と同じ方針・同じ事実で、英語圏の書き方（実績を動詞から書く・1〜2枚）に合わせて作ります。作り直しても、この応募先の1社分のほかに利用枠はかかりません。</p>
        <div class="row"><button class="btn ${en ? '' : 'primary'}" data-act="english" ${run ? 'disabled' : ''}>${en ? 'AI で作り直す' : '英文レジュメを作る'}</button>${run ? `<span class="status" style="margin:0">${spin}${stage('english', c.enSince)} ${elapsed(c.enSince, '1〜2分')} ${abortBtn('en-' + c.id)}</span>` : ''}</div>
        ${c.enError ? `<div class="status err">${h(c.enError)}</div>` : ''}
        ${en ? `<label for="en-name">氏名（ローマ字）</label><input type="text" id="en-name" data-enshared="nameEn" value="${h(d.name)}" placeholder="Kenta Sato">
        ${state.nameEnGuess ? '<div class="fb warn" style="margin-top:6px">読み方は AI の推測です。パスポートと同じ表記か確認してください。</div>' : ''}
        <label for="en-contact">連絡先（メール・電話など。全応募先で共通）</label><input type="text" id="en-contact" data-enshared="enContact" value="${h(d.contact)}" placeholder="name@example.com · 090-0000-0000">` : ''}
      </div>
      ${en ? `<div class="card editor"><h2>文章を直す</h2><p class="hint" style="margin-top:0">直すとプレビューがすぐ更新されます。「AI で作り直す」を押すと、ここで直した内容は上書きされます。</p>${edit}</div>` : ''}
    </div>
    <div class="stack">
      ${en ? `<div class="card" style="padding:14px 18px"><div class="row" style="margin:0"><b>プレビュー（A4）</b><span class="spacer"></span><button class="btn primary" data-act="enPdf">PDF</button><button class="btn" data-act="enDocx">Word</button></div><div id="enWarn" class="fitbar"></div></div>
      <div class="desk" id="enPreview">${F.ready ? '' : `<div class="empty">${spin}書体を読み込んでいます…</div>`}</div>`
      : `<div class="card empty">英文レジュメはまだありません。<br>左の「英文レジュメを作る」で作成します（1〜2分）。</div>`}
    </div>
  </div>`;
}
let enT;
function drawEnglish(c) {
  const box = $('#enPreview'); if (!box || !F.ready || !c || !c.en) return;
  const d = enDoc(c);
  const lay = E.layoutEnglishFit(d, F.meas, opt(c));
  const cssW = Math.min(Math.max(box.clientWidth - 36, 280), 640);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  box.querySelectorAll('.empty').forEach((e) => e.remove());
  const cvs = [...box.querySelectorAll('canvas')];
  lay.pages.forEach((pg, i) => {
    let cv = cvs[i]; if (!cv) { cv = document.createElement('canvas'); box.appendChild(cv); }
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssW * E.PAGE_H / E.PAGE_W * dpr); cv.style.width = cssW + 'px';
    E.renderCanvas(cv.getContext('2d'), pg, cv.width / E.PAGE_W, F.meas, F.fam);
  });
  cvs.slice(lay.pages.length).forEach((cv) => cv.remove());
  const w = $('#enWarn');
  if (w) {
    const bad = checkNumbers(enParts(E.normalizeEn(d))).bad;
    w.innerHTML = (bad.length ? `<div class="fb warn">⚠ あなたの入力で確認できない数値：${bad.map((n) => `<mark>${h(n)}</mark>`).map((x, i, a) => `<span class="nw">${x}${i < a.length - 1 ? '、' : ''}</span>`).join('')}<span>　提出前に事実か確認してください。</span></div>` : '')
      + (!d.name ? '<div class="fb warn">氏名（ローマ字）を入れてください。</div>' : '')
      + `<div class="fb ${lay.pageCount <= 2 ? 'ok' : 'warn'}">${lay.pageCount <= 2 ? '✓' : '⚠'} A4 ${lay.pageCount}枚${lay.pageCount > 2 ? '。英文レジュメは2枚までが一般的です。古い経歴の項目を減らしてください' : ''}</div>`;
  }
}
async function downloadEnglish(c, kind) {
  await loadFonts(); if (!F.ready) { toast('書体の読み込みに失敗しました。ページを再読み込みしてください'); return; }
  try {
    const d = enDoc(c); const lay = E.layoutEnglishFit(d, F.meas, opt(c));
    const data = kind === 'pdf'
      ? await E.renderPDF(lay, F.bytes, PDFLib, fontkit, { title: 'Resume', author: d.name, lang: 'en-US' }, F.fk)
      : await E.buildDocxEn(d, JSZip, Object.assign(opt(c), { dense: lay.dense }));
    const dt = new Date();
    await saveFile(('Resume' + (d.name ? '_' + d.name.replace(/\s+/g, '') : '') + '_' + dt.getFullYear() + pad(dt.getMonth() + 1) + pad(dt.getDate()) + '.' + kind).replace(/[\\/:*?"<>|]/g, '_'), data, MIME[kind]); beacon('download');
    toast('保存しました');
  } catch (e) { toast('保存に失敗しました'); console.error(e); }
}

// ---------------- 履歴書 ----------------
const ymJ = (s) => { const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(s || ''); return m ? m[1] + '年' + (m[2] ? +m[2] + '月' : '') : ''; };
// the leaving line: 一身上の都合 unless the user's own notes say they left for childbirth/childcare or caregiving
// (said as the reason for leaving, not just mentioned) and half a year or more without a job follows
function leaveReason(c, cs) {
  const src = [state.raw || '', Object.values(state.answers || {}).join('\n')].join('\n');
  const next = cs[cs.indexOf(c) + 1]; const gap = !next || !(monthOf(next.start) - monthOf(c.end, true) < 6);
  const why = (w) => new RegExp(`(${w})[^。\\n]{0,12}(ため|で|を機に|に専念)[^。\\n]{0,8}(退職|離職|辞め)|(退職|離職|辞め)[^。\\n]{0,4}(理由|のは)[^。\\n]{0,8}(${w})`).test(src);
  if (gap && why('出産|育児|子育て')) return '出産・育児のため退職';
  if (gap && why('介護')) return '家族の介護のため退職';
  return '一身上の都合により退職';
}
// 本人希望記入欄 from the 希望条件, without AI: the conditions written in Japanese, one per line, without pay
// (pay is not usually written there)
function hopeDraft() {
  const t = ((state.intent && state.intent.conditions) || '').trim(); if (!t || !/[\u3040-\u30ff\u4e00-\u9fff]/.test(t) || /[A-Za-z]{4,}\s+[A-Za-z]{3,}/.test(t)) return '';
  // only what belongs in that field (working hours, days, place, start date); pay and notes to oneself are left out
  const parts = t.split(/[、,，／/\n・。]+/).map((x) => x.trim()).filter((x) => x && /\d\s*時|時短|時間|週\s*\d|曜|平日|土日|勤務地|通勤|在宅|リモート|転勤|入社|扶養内/.test(x) && !/年収|月給|給与|給料|万円|時給|でなくても|どちらでも|こだわら|できれば/.test(x))
    .map((x) => /希望$/.test(x) ? x.replace(/を?希望$/, '') + 'を希望します。' : /(可能|不可)$/.test(x) ? x + 'です。' : /(です|ます|ません)$/.test(x) ? x + '。' : x + 'を希望します。');
  return parts.join('\n');
}
function genHistory() {
  const p = state.profile || { careers: [], education: [] }; const L = ['学歴'];
  (p.education || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((e) => L.push(`${ymJ(e.date)}｜${e.school}${e.detail ? '　' + e.detail : ''}`));
  if (!(p.education || []).length) L.push('（例）2012年4月｜○○大学 ○○学部 入学', '（例）2016年3月｜○○大学 ○○学部 卒業');
  L.push('', '職歴');
  const cs = (p.careers || []).slice().reverse();
  cs.forEach((c) => {
    L.push(`${ymJ(c.start)}｜${c.company}　入社`);
    const rs = c.roles.slice().reverse(); const r0 = rs[0]; if (r0 && r0.org) L.push(`｜　${r0.org}${r0.title ? '　' + r0.title : ''}`);
    // later moves and promotions in the same company (異動・昇進): one line each, with the month
    rs.slice(1).forEach((r, i) => {
      if (!r.start || (!r.org && !r.title)) return;
      const prev = rs[i]; const sameOrg = r.org && prev && r.org === prev.org;
      if (sameOrg && (!r.title || r.title === prev.title)) return;
      L.push(`${ymJ(r.start)}｜　${sameOrg ? `${r.title}に昇進` : `${r.org}${r.title ? '　' + r.title : ''}に異動`}`);
    });
    if (c.end && c.end !== '現在') L.push(`${ymJ(c.end)}｜${leaveReason(c, cs)}`);
  });
  if (cs.some((c) => c.end === '現在')) L.push('｜現在に至る');
  L.push('以上');
  return L.join('\n');
}
function genLicenses() { return ((state.profile || {}).qualifications || []).map((q) => `${ymJ(q.date)}｜${q.name}`).join('\n'); }
function parseLines(text) {
  return String(text || '').split('\n').map((ln) => {
    const t = ln.trim();
    if (t === '学歴' || t === '職歴') return { text: t, align: 'center' };
    if (t === '以上') return { text: '以上', align: 'right' };
    if (!t) return { text: '' };
    const i = t.indexOf('｜') >= 0 ? t.indexOf('｜') : t.indexOf('|');
    if (i < 0) return { text: t };
    const d = E.normDate(t.slice(0, i)); const m = /(\d{4})年(?:(\d{1,2})月)?/.exec(d);
    return { ym: m ? m[1] + '-' + (m[2] || '') : '', text: t.slice(i + 1).replace(/^\s+/, (sp) => sp.replace(/ /g, '　')) };
  });
}
function rkData(c) {
  const r = state.rireki;
  return Object.assign({}, r, { date: todayIso(), name: E.fixChars(state.name || '', window.CHARFIX || {}), history: parseLines(r.history), licenses: parseLines(r.licenses), motive: c.rk.motive, hope: c.rk.hope });
}
const photoImgs = {};
function photoImg(src) { if (!src) return null; if (!photoImgs[src]) { const im = new Image(); im.onload = () => { if (state.step === 3) drawRireki(company(state.active)); }; im.src = src; photoImgs[src] = im; } E.renderCanvas.images = photoImgs; return photoImgs[src]; }
function loadPhoto(file) {
  const fr = new FileReader();
  fr.onload = () => {
    const im = new Image();
    im.onload = () => {
      const W = 300, H = 400, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
      const r = Math.max(W / im.width, H / im.height); const w = im.width * r, h = im.height * r;
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(im, (W - w) / 2, (H - h) / 2, w, h);
      state.rireki.photo = cv.toDataURL('image/jpeg', 0.86); save(); render();
    };
    im.onerror = () => toast('この画像は読み込めませんでした');
    im.src = fr.result;
  };
  fr.readAsDataURL(file);
}
async function makeRkMotive(c) {
  c.rk.status = 'run'; c.rk.since = Date.now(); c.rk.error = ''; render();
  try {
    const r = await ask('rk', { c }, 'rk-' + c.id); c.rk.motive = E.fixChars(Sx(r && r.motive), window.CHARFIX || {}); c.rk.motiveSrc = c.rk.motive; c.rk.motive_tr = Sx(r && r.motive_tr);
    // 本人希望記入欄: from the 希望条件, unless the user has written their own
    const hope = E.fixChars(Sx(r && r.hope), window.CHARFIX || {});
    if (hope && (!c.rk.hope.trim() || c.rk.hope === '貴社の規定に従います。' || c.rk.hope === c.rk.hopeSrc)) { c.rk.hope = hope; c.rk.hopeSrc = hope; c.rk.hope_tr = Sx(r && r.hope_tr); }
    c.rk.status = '';
  }
  catch (e) { c.rk.status = ''; c.rk.error = errMsg(e); }
  save(); render();
}
async function makeExplain(c) {
  c.exStatus = 'run'; c.exSince = Date.now(); c.exError = ''; render();
  try { c.explain = normExplain(await ask('explain', { c }, 'ex-' + c.id)); c.explain.lang = state.explainLang; c.exStatus = 'done'; }
  catch (e) { c.exStatus = c.explain ? 'done' : ''; c.exError = errMsg(e); }
  save(); render();
}
function replaceInDoc(obj, from, to) {
  let done = false;
  const walk = (o) => {
    if (done || !o || typeof o !== 'object') return;
    for (const k of Object.keys(o)) {
      if (done) return;
      if (typeof o[k] === 'string' && o[k].includes(from)) { o[k] = o[k].replace(from, to); done = true; }
      else if (typeof o[k] === 'object') walk(o[k]);
    }
  };
  walk(obj); return done;
}
async function downloadRireki(c) {
  await loadFonts(); if (!F.ready) { toast('書体の読み込みに失敗しました。ページを再読み込みしてください'); return; }
  try {
    const data = await E.renderPDF(E.layoutRireki(rkData(c), F.meas), F.bytes, PDFLib, fontkit, { title: '履歴書', author: state.name }, F.fk);
    const d = new Date();
    await saveFile(('履歴書' + (state.name ? '_' + state.name.replace(/\s+/g, '') : '') + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.pdf').replace(/[\\/:*?"<>|]/g, '_'), data, MIME.pdf); beacon('download');
    toast('保存しました');
  } catch (e) { toast('保存に失敗しました'); console.error(e); }
}
async function exportData() {
  const data = state.demo ? userState : state;
  if (!hasOwnData(data)) { toast('書き出す自分のデータがまだありません'); return; }
  const d = new Date();
  saveFile(`職務経歴書AI_データ_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.json`, JSON.stringify(persistable(data)), MIME.json);
  toast('書き出しました');
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try { const obj = JSON.parse(r.result); if (!obj || !Array.isArray(obj.companies)) throw 0; obj.demo = false; state = migrate(Object.assign(fresh(), obj)); userState = null; ui.lp = false; save(); render(); toast('データを読み込みました'); }
    catch (e) { toast('このファイルは読み込めません'); }
  };
  r.readAsText(file);
}
// ---------------- reading an existing résumé (in the browser; the file is not sent anywhere) ----------------
const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
async function docxText(buf) {
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml'); if (!f) throw new Error('not a Word file');
  const xml = new DOMParser().parseFromString(await f.async('string'), 'application/xml');
  const para = (p) => { let t = ''; p.querySelectorAll('*').forEach((n) => { if (n.namespaceURI !== W_NS) return; if (n.localName === 't') t += n.textContent; else if (n.localName === 'tab') t += '　'; else if (n.localName === 'br' || n.localName === 'cr') t += '\n'; }); return t; };
  const out = [];
  const walk = (el) => {
    for (const n of el.children) {
      if (n.namespaceURI !== W_NS) continue;
      if (n.localName === 'p') out.push(para(n));
      else if (n.localName === 'tbl') {
        for (const tr of n.children) {
          if (tr.localName !== 'tr') continue;
          const cells = [...tr.children].filter((c) => c.localName === 'tc').map((tc) => [...tc.children].filter((x) => x.localName === 'p').map(para).filter((x) => x.trim()).join(' '));
          const line = cells.filter((x) => x.trim()).join('　｜　'); if (line) out.push(line);
        }
      } else if (n.localName === 'sdt' || n.localName === 'sdtContent' || n.localName === 'body') walk(n);
    }
  };
  walk(xml.getElementsByTagNameNS(W_NS, 'body')[0] || xml.documentElement);
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function pdfText(buf) {
  const pdfjs = await import(ASSET('lib/pdfjs/pdf.min.mjs'));
  pdfjs.GlobalWorkerOptions.workerSrc = ASSET('lib/pdfjs/pdf.worker.min.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf), cMapUrl: ASSET('lib/pdfjs/cmaps/'), cMapPacked: true, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= Math.min(pdf.numPages, 12); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    let line = ''; const lines = [];
    tc.items.forEach((it) => { line += it.str; if (it.hasEOL) { lines.push(line); line = ''; } });
    if (line) lines.push(line);
    pages.push(lines.map((l) => l.replace(/\s+$/, '')).join('\n'));
  }
  return pages.join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}
async function importResume(file) {
  const name = (file.name || '').toLowerCase();
  if (file.size > 15 * 1024 * 1024) { toast('ファイルが大きすぎます（15MBまで）'); return; }
  if (/\.doc$/.test(name)) { toast('古い形式の .doc は読み込めません。Word で .docx か PDF として保存してから読み込んでください'); return; }
  let text = '';
  const st = $('#importStatus'); if (st) st.innerHTML = `${spin}ファイルを読み込んでいます…`;
  try {
    if (/\.docx$/.test(name)) text = await docxText(await file.arrayBuffer());
    else if (/\.pdf$/.test(name)) text = await pdfText(await file.arrayBuffer());
    else if (/\.(txt|md)$/.test(name)) text = await file.text();
    else { toast('Word（.docx）・PDF・テキストのファイルを選んでください'); if (st) st.textContent = ''; return; }
  } catch (e) { console.error(e); toast('このファイルは読み込めませんでした'); if (st) st.textContent = ''; return; }
  if (st) st.textContent = '';
  if (len(text.replace(/\s/g, '')) < 20) { toast('文字を読み取れませんでした（画像として保存された PDF の可能性があります）。文章をコピーして貼り付けてください'); return; }
  state.raw = state.raw.trim() ? state.raw.trim() + '\n\n' + text : text;
  state.oldDoc = text.slice(0, 6000);   // the document the user had: shown next to the new one in step 3
  save(); render();
  toast(`${file.name} を読み込みました（${len(text)}字）。内容を確かめて「経歴を整理する」を押してください`);
}

async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('コピーしました'); }
  catch (e) {
    // some browsers (iPhone Safari) refuse a copy that comes after a wait: offered again behind one tap
    openModal(`<h2 id="modalTitle">コピーの準備ができました</h2><textarea id="copyBox" rows="8" readonly>${h(text)}</textarea>
      <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">閉じる</button><button class="btn primary" data-act="copyNow">コピーする</button></div>`);
  }
}

// ---------------- rendering helpers ----------------
// t: a text, or several texts (each is translated on the English / Chinese page)
function showNotice(t) { const n = $('#notice'); n.innerHTML = '<div><span class="nt">' + [].concat(t).filter(Boolean).map((x) => `<span>${h(x)}</span>`).join('') + '</span><button class="x" data-act="hideNotice" aria-label="閉じる">×</button></div>'; n.classList.remove('hidden'); }
function hideNotice() { $('#notice').classList.add('hidden'); }
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }
const spin = '<span class="spin"></span>';
const PILL = { idle: ['未分析', ''], queued: ['待機中', 'wait'], analyzing: ['分析中', 'run'], analyzed: ['分析済み', 'ok'], generating: ['作成中', 'run'], fitting: ['枚数を調整中', 'run'], done: ['書類完成', 'ok'] };
const BUSY = ['queued', 'analyzing', 'generating', 'fitting'];
const anyBusy = () => state.companies.some((c) => BUSY.includes(c.status));
const elapsed = (since, est) => (since ? `<span class="elapsed" data-since="${since}" data-est="${est}"></span>` : '');
const pill = (c) => { const p = c.status === 'done' && c.doc && docLocked(c) && acct.user ? ['確認中（未保存）', 'wait'] : (PILL[c.status] || ['', '']); return `<span class="pill ${p[1]}">${p[1] === 'run' ? spin : ''}${p[0]}</span>`; };
const abortBtn = (key) => `<button class="btn small" data-act="abort" data-key="${key}">中止</button>`;
const cname = (c) => c.general ? '登録用（汎用版）' : (c.analysis && c.analysis.company) || c.name || '（会社名未入力）';
const STAGES = {
  profile: ['経歴を読み込んでいます', '職歴と使える事例に分けています', 'あると強くなる情報を確かめています'],
  analyze: ['求人票の重視点を読んでいます', 'あなたの事例と照らし合わせています', 'どの実績をどう見せるか決めています'],
  generate: ['この会社向けの見せ方で書いています', '職務要約と自己PRを書いています', 'A4 に収まるよう整えています'],
  fit: ['A4 の枚数に収まるよう文章を詰めています'],
  pack: ['想定される質問を選んでいます', '回答例を書類と照らし合わせています', '逆質問と注意点をまとめています'],
  prep: ['これまでの選考記録を読んでいます', '次の面接で聞かれそうな点を整理しています'],
  rk: ['履歴書の志望動機を書いています'],
  explain: ['原文と翻訳を並べています', '書き方の理由と不自然な箇所を確かめています'],
  english: ['経歴と方針を読み込んでいます', '実績を英語の書き方で組み立てています', '1〜2枚に収まるよう整えています'],
  research: ['会社の公式サイトとニュースを検索しています', '出典を確かめながらまとめています'],
};
const stageText = (kind, since) => { const L = STAGES[kind] || ['処理しています']; const i = Math.min(L.length - 1, Math.floor((Date.now() - (since || Date.now())) / 16000)); return L[i] + '…'; };
const stage = (kind, since) => `<span class="stg" data-kind="${kind}" data-since="${since || Date.now()}">${stageText(kind, since)}</span>`;
function renderFoot() {
  const signed = !!acct.user;
  // the language links of the header are hidden on phones once signed in: here too
  $('#foot').innerHTML = `<div class="foot-lang" data-noi18n>${[['/', 'ja', '日本語'], ['/en/', 'en', 'English'], ['/zh/', 'zh-Hans', '中文']].map(([u, l, t]) => `<a href="${u}" lang="${l}" ${(UI_LANG === 'zh' ? 'zh-Hans' : UI_LANG) === l ? 'aria-current="page"' : ''}>${t}</a>`).join('<span>·</span>')}</div><div class="foot-act">
      <button class="linkbtn" data-act="exportData">データを書き出す</button><span>·</span><button class="linkbtn" data-act="importData">データを読み込む</button><span>·</span><button class="linkbtn" data-act="reset">入力データを消去</button>
      ${signed ? '<span>·</span><button class="linkbtn" data-act="delAccount">アカウントを削除</button>' : ''}</div>
    ${signed ? `入力した内容と書類はアカウントに保存され、ほかの端末でも続きから使えます。最後に使ってから${keepFor()}たつと自動で削除されます。`
      : 'ログインする前の入力内容は、このブラウザの中にだけ保存されます。ログインするとアカウントに保存されます。'}
    AI の処理には Anthropic 社（米国）の Claude を使っています。書類の書体：BIZ UDP明朝・BIZ UDPゴシック（SIL Open Font License）`;
}
function creditNote(c) {
  if (state.demo || hasSlot(c)) return '';
  if (c.sample) return '<p class="hint credit-note">サンプル求人は、分析も書類の作成も無料です（利用枠は使いません）。</p>';
  if (!acct.user) return docsFree() ? '<p class="hint credit-note">AI を使うにはログインが必要です。職務経歴書の作成・保存は2社まで無料です。志望動機・面接準備は1社分から購入でき、払う前に1問を無料で試せます。</p>' : '<p class="hint credit-note">AI を使うにはログインが必要です。書類の作成と画面での確認は無料で、保存・面接準備は最初の1社分が無料です。</p>';
  if (!acct.me || !c.analysis) return '';
  if (!acct.me.previews.has(c.id) && previewsLeft() <= 0) return `<p class="hint credit-note warn">購入前に無料で作成・確認できる応募先は${(CFG.preview && CFG.preview.free) || 2}社までです。<button class="linkbtn" data-act="openBuy" data-why="preview">利用枠を追加する</button></p>`;
  if (docsFree()) return acct.me.credits > 0 ? '<p class="hint credit-note">職務経歴書の作成・保存・コピーは無料です（利用枠は使いません）。志望動機・面接準備を作るときに、この会社で1社分を使います。</p>'
    : `<p class="hint credit-note">職務経歴書の作成・保存・コピーは無料です。志望動機・面接準備には、利用枠の購入が必要です（${fromPrice()}）。</p>`;
  return acct.me.credits > 0 ? '<p class="hint credit-note">書類を作って画面で確認するまでは、利用枠は使いません。保存（PDF・Word）・コピーするか、志望動機・面接準備を作るときに、この会社で1社分を使います。</p>'
    : `<p class="hint credit-note">書類を作って画面で確認するのは無料です。保存・コピーと志望動機・面接準備には、利用枠の購入が必要です（${fromPrice()}）。</p>`;
}
function viewHead(title, desc, right) { return `${demoBar()}<div class="vh"><div><div class="eyebrow">STEP ${state.step} / 4</div><h1>${title}</h1><p>${desc}</p></div><span class="spacer"></span>${right || ''}</div>`; }
function demoPick() {
  const ks = demoKinds(); if (ks.length < 2) return '';
  const lab = (k, l) => { const x = k && window.DEMO_SET[k].i18n && window.DEMO_SET[k].i18n[UI_LANG]; return x && x.label ? x.label : l; };
  return `<div class="demo-pick"><span class="lab">ほかの例：</span>${ks.map(([k, l]) => `<button class="${(state.demoKind || '') === k ? 'on' : ''}" data-act="demo" data-v="${k}">${h(lab(k, l))}</button>`).join('')}</div>`;
}
// the examples whose person wrote the notes in another language
const DEMO_NOTES = { eng: '中国語', mkt: '英語' };
function demoBar() {
  if (!state.demo) return '';
  const bar = hasOwnData(userState)
    ? `<div class="demo-bar"><span>いま表示しているのは<b>サンプル</b>（架空の人物・企業）です。あなたのデータはそのまま残っています。サンプルでの操作は保存されません。</span><span class="spacer"></span><button class="btn primary small" data-act="startOwn">自分のデータに戻る</button></div>`
    : `<div class="demo-bar"><span>いま表示しているのは<b>サンプル</b>（架空の人物・企業）です。サンプルでの操作は保存されません。各ステップを見たあと、自分の経歴で始められます。${UI_LANG !== 'ja' ? (DEMO_NOTES[state.demoKind] ? `</span><span class="tiny">この例の人物は、経歴を${DEMO_NOTES[state.demoKind]}で書いています。書類は日本語で作られ、ステップ3で母語の対訳を見ながら確認できます。` : '</span><span class="tiny">このサンプルの人物は日本語で経歴を書いています。英語・中国語で書いても書類は日本語で作られ、ステップ3で母語の対訳を見ながら確認できます。') : ''}</span><span class="spacer"></span><button class="btn primary small" data-act="startOwn">自分の経歴で始める</button></div>`;
  return bar.replace(/<\/div>$/, demoPick() + '</div>');
}

function render() {
  const lp = ui.lp && !state.demo;
  $('#lp').classList.toggle('hidden', !lp); $('#app').classList.toggle('hidden', lp); $('#bar').classList.toggle('hidden', lp);
  if (lp) return;
  if (state.step >= 2) loadFonts();
  renderFoot(); syncUI();
  const n2 = state.companies.length, n3 = state.companies.filter((c) => c.doc).length, n4 = state.companies.filter((c) => c.stages && c.stages.length).length;
  const steps = [[1, '経歴', state.profile ? '' : ''], [2, '求人の読み解き', n2 ? n2 + '社' : ''], [3, '書類', n3 ? n3 + '件' : ''], [4, '選考管理', n4 ? n4 + '社' : '']];
  const done = { 1: !!state.profile, 2: state.companies.some((c) => c.analysis), 3: n3 > 0, 4: false };
  $('#steps').innerHTML = steps.map(([i, t, b], k) => `${k ? '<span class="sep"></span>' : ''}<button data-act="step" data-step="${i}" class="${state.step === i ? 'on' : ''} ${done[i] && state.step !== i ? 'done' : ''}"><span class="num">${done[i] && state.step !== i ? '✓' : i}</span><span class="lbl">${t}</span>${b ? `<span class="cnt">${b}</span>` : ''}</button>`).join('');
  ['v1', 'v2', 'v3', 'v4'].forEach((id, i) => $('#' + id).classList.toggle('on', state.step === i + 1));
  if (state.step === 1) render1(); else if (state.step === 2) render2(); else if (state.step === 3) render3(); else render4();
  if (lastFocus && document.activeElement === document.body) { const el = document.querySelector(lastFocus); if (el) el.focus({ preventScroll: true }); }
}
let lastFocus = '';

// ---------------- step 1 ----------------
// the input's language: Chinese or English input shows the help in that language
function inputLang() {
  const t = (state.raw || '').slice(0, 3000); if (!t.trim()) return '';
  const han = (t.match(/[一-鿿]/g) || []).length, kana = (t.match(/[぀-ヿ]/g) || []).length, latin = (t.match(/[A-Za-z]/g) || []).length;
  const simp = [...t].filter((ch) => (window.CHARFIX || {})[ch]).length;
  if (kana > han * 0.12 || kana > 40) return 'ja';
  if (simp > 3 || han > 30) return 'zh';
  return latin > 80 ? 'en' : 'ja';
}
function render1() {
  const p = state.profile;
  const st = state.profileStatus === 'run' ? `<div class="status">${spin}${stage('profile', state.since)} ${elapsed(state.since, '30〜60秒')} ${abortBtn('profile')}</div>`
    : state.profileStatus === 'err' ? `<div class="status ${softErr(state.profileError) ? '' : 'err'}">${h(state.profileError)}</div>` : '';
  const lang = inputLang();
  const intentFilled = ['reason', 'axis', 'conditions'].some((k) => (state.intent[k] || '').trim());
  const done = p && state.profileStatus !== 'run'
    ? `<div class="done-line"><span>✓ 経歴を整理しました（職歴${p.careers.length}社・事例${p.episodes.length}件）</span><span class="spacer"></span><button class="btn small" data-act="toResult">結果を確認</button><button class="btn primary small" data-act="step" data-step="2">次へ：応募先を追加 →</button></div>` : '';
  $('#v1').innerHTML = viewHead('経歴を一度だけ登録する', 'ここで整理した事実だけを材料に、応募先ごとの書類と面接対策を作ります。あなたが書いていない数字や実績を AI が書き足すことはありません。') + `
  <div class="g12">
    <div class="card">
      <h2>経歴を入力</h2>
      <p class="hint">今お持ちの職務経歴書をそのまま貼り付けるか、経歴を箇条書きで書いてください。人数・金額・％・期間などの数字が多いほど、仕上がりが良くなります。日本語・中文・English のどれでも入力できます。</p>
      ${UI_LANG !== 'ja' ? '<p class="hint">母国での経歴も含めて書いてください。日本語力（日本語能力試験のレベル（N1〜N5）、仕事で日本語を使う場面）や話せる言語も書いておくと、書類に反映されます。</p><p class="hint">整理した経歴データと書類は日本語で作られます。整理された内容が違っていたら、経歴の入力を直して「経歴を整理し直す」を押してください。書類はステップ3で母語の対訳を見ながら確認できます。</p>' : (lang === 'zh' ? '<p class="hint native" lang="zh">已识别为中文输入。系统会生成日文的职务经历书和履历书；在第 3 步可以用中文对照确认内容，并查看日文写法的解说和不自然之处。</p>' : lang === 'en' ? '<p class="hint native" lang="en">Your notes are in English. The documents will be written in Japanese; in step 3 you can check them against an English translation, with notes on how Japanese résumés are written.</p>' : '')}
      <label for="in-name">氏名（書類に記載されます）</label>
      <input type="text" id="in-name" data-bind="name" value="${h(state.name)}" placeholder="例：佐藤 健太" autocomplete="name">${nameHint()}
      ${UI_LANG !== 'ja' ? '<p class="hint tiny">書類に載る氏名です。在留カードと同じ表記で書いてください（漢字の名前は漢字で、アルファベットの名前はアルファベットかカタカナで）。</p>' : ''}
      <div class="importer"><button class="btn small" data-act="pickResume">ファイルから読み込む（Word・PDF）</button><span class="hint tiny">今の職務経歴書や履歴書（英語・中国語のものも可）のファイルから文章を読み取ります。ファイルはこの端末の中で読むだけで、送信しません。</span><span id="importStatus" class="hint tiny"></span></div>
      <div class="importer"><button class="btn small" data-act="qaForm">質問に答えて書く</button><span class="hint tiny">職務経歴書を持っていない方・スマホで入力する方向け。会社ごとに7つの質問に短く答えると、下の欄に書き込みます。</span></div>
      <label for="in-raw" class="lab-row">経歴・現在の職務経歴書<span class="cc" id="rawCount">${len(state.raw)}字</span></label>
      <textarea id="in-raw" data-bind="raw" rows="16" placeholder="例）2016年4月 〇〇株式会社 入社。法人営業として既存顧客80社を担当…">${h(state.raw)}</textarea>
      <details class="intent" ${intentFilled ? 'open' : ''}><summary>転職の軸（任意・志望動機と面接対策に使います）</summary>
        <p class="hint">空欄の場合、AI は動機を作らず【要記入】として残します。転職理由と希望条件は書類には書きません。</p>
        <label for="in-reason">転職理由（本音で大丈夫です）</label>
        <textarea id="in-reason" rows="2" data-intent="reason" placeholder="例：担当顧客の規模が小さく、より複雑な組織での活用推進に挑戦したい">${h(state.intent.reason)}</textarea>
        <label for="in-axis">次の仕事で実現したいこと</label>
        <textarea id="in-axis" rows="2" data-intent="axis" placeholder="例：CSの仕組みづくりをリードしたい／チームを率いたい">${h(state.intent.axis)}</textarea>
        <label for="in-cond">希望条件（年収・勤務地・入社可能時期など）</label>
        <textarea id="in-cond" rows="2" data-intent="conditions" placeholder="例：年収650万円以上、都内またはリモート、2027年2月以降に入社可能／平日9:30〜15:30の時短・パート希望">${h(state.intent.conditions)}</textarea>
      </details>
      <div class="row">
        <button class="btn primary" data-act="extract" ${state.profileStatus === 'run' ? 'disabled' : ''}>${p ? '経歴を整理し直す' : '経歴を整理する'}</button>
        ${state.raw.trim() ? '' : '<button class="btn ghost" data-act="sampleRaw">サンプルの経歴を入れる</button>'}
      </div>
      ${st}${done}
    </div>
    <div class="card" id="result">
      <h2>あなたの経歴データ</h2>
      <p class="hint">職歴・使える事例・スキルに分けて保存されます。応募先が何社あっても、ここは一度で済みます。</p>
      ${p ? profileHTML(p) : '<div class="empty">経歴を入力して「経歴を整理する」を押すと、ここに職歴・事例・スキルが整理されます。</div>'}
    </div>
  </div>`;
}
function ym(s) { const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(s || ''); return m ? (m[1] + '年' + (m[2] ? +m[2] + '月' : '')) : (s || ''); }
// What screeners look at before reading the words: the number of job changes, short stays, gaps and being out
// of work now. Worked out from the organised career (no AI, free); the documents' prompts know how to handle each.
// a name with simplified Chinese characters: the documents' fonts have the Japanese forms (陈→陳)
function nameHint() {
  const map = window.CHARFIX || {}; const ch = [...new Set([...(state.name || '')].filter((x) => map[x]))];
  if (!ch.length) return '';
  return `<p class="hint tiny namehint" style="margin:4px 0 0">書類の書体は日本の字体のため、${ch.map((x) => `「${x}」は「${map[x]}」`).join('、')}として書きます。在留カードなどの表記と違う場合は、ここで直してください。<button class="linkbtn" data-act="fixName">日本の字体に直す</button></p>`;
}
const monthOf = (s, end) => { const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(s || ''); return m ? +m[1] * 12 + (m[2] ? +m[2] : end ? 12 : 1) - 1 : null; };
const ymText = (n) => (UI_LANG === 'en' ? `${'Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split(' ')[n % 12]} ${Math.floor(n / 12)}` : `${Math.floor(n / 12)}年${(n % 12) + 1}月`);
function screenCheck(p) {
  const now = new Date(); const cur = now.getFullYear() * 12 + now.getMonth();
  const cs = (p.careers || []).map((c) => ({ name: c.company, s: monthOf(c.start), e: c.end === '現在' ? cur : monthOf(c.end, true), now: c.end === '現在' })).filter((c) => c.s != null && c.e != null).sort((a, b) => a.s - b.s);
  const out = [];
  if (!cs.length) return out;
  const born = monthOf(state.rireki && state.rireki.birth); const age = born != null ? Math.floor((cur - born) / 12) : null;
  const changes = cs.length - 1;
  if (changes >= (age == null ? 4 : age < 30 ? 3 : age < 40 ? 4 : 5)) out.push({ t: `転職${changes}回`, d: '回数だけで判断する企業もあります。職務要約で、経験に共通する軸（職種・顧客・身につけた力）を1文で示し、面接では理由を短く前向きに話せるようにします。' });
  cs.filter((c) => !c.now && c.e - c.s + 1 < 12).forEach((c) => out.push({ t: `在籍1年未満：${c.name}（${c.e - c.s + 1}か月）`, d: '理由を聞かれる前提で、事実を1文で答えられるようにします。書類では弁解せず、その期間にしたことを書きます。' }));
  cs.filter((c) => c.now && c.e - c.s + 1 < 12).forEach((c) => out.push({ t: `現職が在籍1年未満：${c.name}（${c.e - c.s + 1}か月）`, d: '「入社してすぐ、なぜ辞めるのか」を必ず聞かれます。入社前に聞いていた話との違いなど、事実を1文で答えられるようにし、次は長く働きたい理由を添えます。経歴に理由を書き足すと、面接の答え方に生かせます。' }));
  for (let i = 1; i < cs.length; i++) { const g = cs[i].s - cs[i - 1].e - 1; if (g >= 6) out.push({ t: `職歴の空白：${ymText(cs[i - 1].e + 1)}〜${ymText(cs[i].s - 1)}（${g}か月）`, d: 'その期間の理由としていたこと（育児・介護・療養・学習・資格など）を経歴に書き足すと、書類と面接の答え方に生かせます。書かなければ、AI は理由を作りません。' }); }
  const last = cs[cs.length - 1];
  if (!cs.some((c) => c.now) && cur - last.e >= 3) out.push({ t: `現在、離職して${cur - last.e}か月`, d: '離職後にしていること（学習・資格・家庭の事情など）と、いつから・どんな条件で働けるかを経歴に書き足すと、履歴書の本人希望記入欄と面接の答えに生かせます。' });
  return out;
}
function screenHTML(p) {
  const x = screenCheck(p);
  if (!(p.careers || []).length) return '';
  return `<div class="screen"><h3>書類選考で最初に見られやすい点</h3>${x.length
    ? `<p class="hint" style="margin:0 0 8px">多くの企業は、文章を読む前に年数・転職回数・空白期間を見ます。あなたの経歴では次の点が見られやすいので、書類と面接の準備で扱い方を決めておきます。</p>${x.map((i) => `<div class="sc-it"><b>${h(i.t)}</b><span>${h(i.d)}</span></div>`).join('')}`
    : '<p class="hint" style="margin:0">転職回数・在籍期間・空白期間で、目立って気にされる点はありません。</p>'}</div>`;
}
function profileHTML(p) {
  const careers = p.careers.map((c) => `<div class="tl"><div class="co">${h(c.company)}<span class="per">${h(ym(c.start))}～${h(c.end === '現在' ? '現在' : ym(c.end))}</span></div>
    ${c.roles.map((r) => `<div class="role">${h([r.org, r.title, r.team].filter(Boolean).join('／'))}</div><ul>${r.duties.map((x) => `<li>${h(x)}</li>`).join('')}${r.achievements.map((x) => `<li class="ach">${h(x)}</li>`).join('')}</ul>${trl(r.tr)}`).join('')}</div>`).join('');
  const eps = p.episodes.map((e) => `<div><span class="id">${h(e.id)}${e.role ? '　' + h(e.role) : ''}</span><b>${h(e.title)}</b>${h(e.result || e.action)}${trl(e.tr)}<div>${e.strengths.map((s) => `<span class="tag">${h(s)}</span>`).join('')}</div></div>`).join('');
  const sk = [...p.skills.expertise, ...p.skills.tools, ...p.skills.languages].filter(Boolean).map((s) => `<span class="tag gray">${h(s)}</span>`).join('');
  const qs = p.missing.length ? `<h3>あると書類が強くなる情報（任意）</h3>${p.missing.map((m) => `<div class="q"><p>${h(m.q)} <small>${h(m.why)}</small></p><textarea rows="2" data-answer="${h(m.q)}" placeholder="分かる範囲で（空欄のままでもOK）">${h((state.answers || {})[m.q] || '')}</textarea></div>`).join('')}
    <div class="row"><button class="btn" data-act="extract">回答を反映して整理し直す</button></div>` : '';
  return `<h3>職歴</h3>${careers || '<div class="empty">職歴を読み取れませんでした</div>'}
    <h3>使える事例（${p.episodes.length}件）</h3><div class="eps">${eps}</div>
    ${sk ? `<h3>スキル・ツール・語学</h3><div>${sk}</div>` : ''}
    ${(p.education || []).length ? `<h3>学歴</h3>${p.education.map((x) => `<div class="dl2"><span>${h(ym(x.date))}</span><span>${h(x.school + (x.detail ? '　' + x.detail : ''))}</span></div>`).join('')}` : ''}
    ${p.qualifications.length ? `<h3>資格</h3>${p.qualifications.map((q) => `<div class="dl2"><span>${h(ym(q.date))}</span><span>${h(q.name)}</span></div>`).join('')}` : ''}
    ${screenHTML(p)}
    ${qs}
    <div class="row"><span class="spacer"></span><button class="btn primary" data-act="step" data-step="2">次へ：応募先を追加 →</button></div>`;
}

// ---------------- step 2 ----------------
function render2() {
  const pending = state.companies.filter((c) => c.job.trim() && !c.analysis && c.status !== 'analyzing').length;
  const ready = state.companies.filter((c) => c.analysis && !c.doc && c.status === 'analyzed').length;
  const hasSample = state.companies.some((c) => c.sample);
  $('#v2').innerHTML = viewHead('この会社向けの見せ方を決める', '求人票を貼ると、その会社が重視していることと、あなたのどの実績をどう見せるかを整理します。分析は無料。何社でもまとめて扱えます。' + (acct.me && !acct.me.paid && !state.demo && previewsLeft() <= 0 ? `書類の作成は、購入前は${(CFG.preview && CFG.preview.free) || 2}社までです（分析と選考管理は、何社でも無料）。` : ''),
    `<button class="btn primary" data-act="addCompany">＋ 応募先を追加</button>${state.companies.some((c) => c.general) ? '' : '<button class="btn" data-act="addGeneral" title="doda・リクナビ・ビズリーチの Web 職務経歴書や、エージェントへの登録に使う1通">＋ 登録用の汎用版</button>'}${hasSample ? '' : '<button class="btn ghost" data-act="sampleJob">サンプル求人で試す（無料）</button>'}`) + `
  ${!state.profile ? '<div class="card" style="margin-bottom:16px;background:var(--warn-soft);border-color:#f0d7a8;color:var(--warn)">先に「経歴」のステップで経歴を整理してください。</div>' : ''}
  ${(pending > 1 || ready > 1 || state.companies.filter((c) => c.batch).length) ? `<div class="row" style="margin:0 0 14px">${batchProgress()}<span class="spacer"></span>
    ${anyBusy() ? '<button class="btn" data-act="abortAll">すべて中止</button>' : ''}
    ${pending > 1 ? `<button class="btn" data-act="analyzeAll">未分析の${pending}社をまとめて分析</button>` : ''}
    ${ready > 1 ? `<button class="btn primary" data-act="generateAll">分析済みの${ready}社の書類をまとめて作る</button>` : ''}</div>` : ''}
  <div class="stack">${state.companies.length ? state.companies.map(companyHTML).join('') : '<div class="card empty">「＋ 応募先を追加」で、応募したい会社の求人票を貼り付けてください。まず試したいときは「サンプル求人で試す」をどうぞ（利用枠は使いません）。</div>'}</div>`;
}
function batchProgress() {
  const inBatch = state.companies.filter((c) => c.batch);
  if (!inBatch.length) return '';
  const done = inBatch.filter((c) => !BUSY.includes(c.status)).length;
  return `<span class="pill run">${done < inBatch.length ? spin : ''}まとめて処理：${done}/${inBatch.length}社 完了</span>`;
}
// the job posting from its URL (buyers); a quiet link for others
function urlRowHTML(c) {
  if (c.sample || state.demo) return '';
  if (!isPaid()) return `<div class="urlrow locked"><button class="linkbtn" data-act="fetchJob" data-id="${c.id}">🔒 求人ページの URL から読み込む（購入者向け）</button></div>`;
  const run = c.fetchStatus === 'run';
  let s = `<label>求人ページの URL から読み込む</label><div class="urlrow"><input type="url" inputmode="url" enterkeyhint="go" data-cf="jobUrl" value="${h(c.jobUrl || '')}" placeholder="https://（会社の採用ページなど）" aria-label="求人ページの URL"><button class="btn small ${run ? 'wait' : ''}" data-act="fetchJob" data-id="${c.id}" ${run ? 'disabled' : ''}>${run ? spin + '読み込み中…' : 'URL から読み込む'}</button></div>`;
  if (c.fetchError) {
    s += `<div class="status err" role="alert" style="margin:2px 0 6px">${h(c.fetchError)}</div>`;
    if (['site_not_allowed', 'robots', 'login_required', 'too_little', 'not_html'].includes(c.fetchCode)) s += `<p class="hint tiny" style="margin:0 0 8px"><span>ページ全体をコピーして貼り付けても大丈夫です（関係のない部分は分析のときに読み飛ばします）。</span>${c.name ? ` <a href="https://www.google.com/search?q=${encodeURIComponent(c.name + ' 採用')}" target="_blank" rel="noopener noreferrer">この会社の採用ページを探す</a>` : ''}</p>`;
  } else s += '<p class="hint tiny" style="margin:2px 0 8px">会社の採用ページなどから本文を読み込みます。転職サイト（doda・リクナビ・ビズリーチ・Indeed・LinkedIn など）や、ログインが必要なページは読み込めないため、本文を貼り付けてください。</p>';
  if (c.fetchNote && c.fetchNote.length) s += `<div class="fb warn" style="margin:0 0 8px">${[].concat(c.fetchNote).map((x) => `<span>${h(x)}</span>`).join('')}</div>`;
  return s;
}
function generalHTML(c) {
  const a = c.analysis; const busy = BUSY.includes(c.status);
  return `<div class="card general" data-cid="${c.id}">
    <div class="chead"><b class="gtitle">登録用（汎用版）</b>${pill(c)}<span class="spacer"></span><button class="btn ghost small" data-act="delCompany" data-id="${c.id}">削除</button></div>
    <p class="hint" style="margin:0 0 8px">特定の求人ではなく、転職サイト（doda・リクナビNEXT・ビズリーチなど）の Web 職務経歴書や、転職エージェントへの登録・スカウトに使う1通です。応募先の会社名や「貴社」は書きません。保存すると1社分を使います。面接準備は、面接が決まった応募先ごとに作ります。</p>
    <label>希望する職種</label>
    <input type="text" data-cf="target" value="${h(c.target || '')}" placeholder="例：法人営業（SaaS・IT）／カスタマーサクセス／経理（連結・開示）">
    <label>重視したいこと（任意）</label>
    <input type="text" data-cf="info" value="${h(c.info || '')}" placeholder="例：マネジメント経験を前に出したい／業界は問わない">
    ${a ? `<details class="anwrap" data-an="${c.id}" ${c.anOpen || !c.doc ? 'open' : ''}><summary>この職種での見せ方</summary>${analysisHTML(a)}</details>` : ''}
    <label>見せ方への追加指示（任意）</label>
    <input type="text" data-cf="memo" value="${h(c.memo)}" placeholder="例：直近3年の実績を中心に">
    ${c.error ? `<div class="status ${softErr(c.error) ? '' : 'err'}">${h(c.error)}</div>` : ''}
    ${c.status === 'analyzing' ? `<div class="status">${spin}${stage('analyze', c.since)} ${elapsed(c.since, '30〜60秒')} ${abortBtn('an-' + c.id)}</div>` : ''}
    <div class="row">
      ${!a ? `<button class="btn primary" data-act="analyze" data-id="${c.id}" ${busy ? 'disabled' : ''}>この職種での見せ方を決める（無料）</button>`
        : `<button class="btn ghost" data-act="analyze" data-id="${c.id}" ${busy ? 'disabled' : ''}>決め直す</button><span class="spacer"></span>
           ${c.doc ? `<button class="btn" data-act="generate" data-id="${c.id}" ${busy ? 'disabled' : ''}>作り直す</button><button class="btn primary" data-act="open" data-id="${c.id}">書類を見る →</button>`
             : overPreview(c) ? '<button class="btn primary" data-act="openBuy" data-why="preview">利用枠を追加して作る →</button>'
             : `<button class="btn primary" data-act="generate" data-id="${c.id}" ${busy ? 'disabled' : ''}>汎用版を作る →</button>`}`}
    </div>
    ${creditNote(c)}
  </div>`;
}
function companyHTML(c) {
  if (c.general) return generalHTML(c);
  const a = c.analysis;
  const busy = BUSY.includes(c.status);
  return `<div class="card" data-cid="${c.id}">
    <div class="chead">
      <input type="text" data-cf="name" value="${h(c.name)}" placeholder="${c.anon ? '社名が分かったら入力' : '会社名（空欄なら求人票から読み取ります）'}" aria-label="会社名">
      <label class="anon"><input type="checkbox" data-act="anon" data-id="${c.id}" ${c.anon ? 'checked' : ''}>社名非公開</label>
      <select data-cf="priority" aria-label="優先度">${['本命', '併願'].map((o) => `<option value="${o}" ${c.priority === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      ${pill(c)}
      <button class="btn ghost small" data-act="delCompany" data-id="${c.id}">削除</button>
    </div>
    <details data-jobd="${c.id}" ${!a || c.jobOpen || c.fetchStatus || c.fetchError ? 'open' : ''}><summary>求人票・企業情報${a ? '（入力済み）' : ''}</summary>
      ${urlRowHTML(c)}
      <label>${isPaid() && !c.sample ? 'または、求人票の本文を貼り付け' : '求人票（全文を貼り付け）'}</label>
      <textarea rows="9" data-cf="job" placeholder="仕事内容・必須要件・歓迎要件・求める人物像などを含めて貼り付けてください">${h(c.job)}</textarea>
      <label>企業情報（任意・あると精度が上がります）</label>
      <textarea rows="4" data-cf="info" placeholder="企業理念・バリュー・トップメッセージ・中期経営計画の要点など">${h(c.info)}</textarea>
    </details>
    ${a ? (c.doc ? `<details class="anwrap" data-an="${c.id}" ${c.anOpen ? 'open' : ''}><summary>求人の読み解き（書類作成済み）</summary>${analysisHTML(a)}</details>` : analysisHTML(a)) : ''}
    ${a || c.research || (c.job.trim() && !c.sample) ? researchHTML(c) : ''}
    <label>見せ方への追加指示（任意）</label>
    <input type="text" data-cf="memo" value="${h(c.memo)}" placeholder="例：マネジメント経験をもっと前に出したい／英語力は控えめに">
    ${c.error ? `<div class="status ${softErr(c.error) ? '' : 'err'}">${h(c.error)}</div>` : ''}
    ${c.status === 'analyzing' ? `<div class="status">${spin}${stage('analyze', c.since)} ${elapsed(c.since, '30〜60秒')} ${abortBtn('an-' + c.id)}</div>` : ''}
    ${c.status === 'queued' ? '<div class="status">待機中です。前の応募先が終わると自動で始まります。</div>' : ''}
    <div class="row">
      ${!a ? `<button class="btn primary" data-act="analyze" data-id="${c.id}" ${busy ? 'disabled' : ''}>求人票を分析する（無料）</button>`
        : `<button class="btn ghost" data-act="analyze" data-id="${c.id}" ${busy ? 'disabled' : ''}>分析し直す</button><span class="spacer"></span>
           ${c.doc ? `<button class="btn" data-act="generate" data-id="${c.id}" ${busy ? 'disabled' : ''}>この見せ方で作り直す</button><button class="btn primary" data-act="open" data-id="${c.id}">書類を見る →</button>`
             : overPreview(c) ? '<button class="btn primary" data-act="openBuy" data-why="preview">利用枠を追加して作る →</button>'
             : `<button class="btn primary" data-act="generate" data-id="${c.id}" ${busy ? 'disabled' : ''}>この見せ方で書類を作る →</button>`}`}
    </div>
    ${creditNote(c)}
  </div>`;
}
// the user's current document: one they imported, or career notes pasted from an existing 職務経歴書
function oldText() {
  if (state.oldDoc) return state.oldDoc;
  const r = state.raw || ''; return len(r) >= 400 && /職務要約|職務経歴|職務内容|自己PR|自己ＰＲ/.test(r) ? r.slice(0, 6000) : '';
}
function oldDocCheck(a) {
  const t = oldText(); if (!t || !a) return [];
  const out = [];
  const miss = (a.keywords || []).filter((k) => k && k.length >= 2 && !t.includes(k));
  if (miss.length) out.push(['この求人の言葉が出てこない', `${miss.slice(0, 6).join('・')}（求人票で重視されている言葉です）`]);
  const nums = (nd(t).match(/\d+(?:\.\d+)?\s*(%|％|倍|件|社|名|人|円|万|億|時間|日|か月|ヶ月|ポイント|pt)/g) || []).length;
  if (nums < 5) out.push(['成果を示す数字が少ない', `数字で規模や成果を示した箇所が${nums}か所です。採用担当者は、規模と成果を数字で見ます。`]);
  const vague = ['粘り強', '責任感', 'コミュニケーション能力', '協調性', '幅広い', '様々な', '貢献', '頑張', '努力', '真面目', '誠実'].filter((w) => t.includes(w));
  if (vague.length >= 2) out.push(['抽象的な言葉が目立つ', `${vague.map((w) => '「' + w + '」').join('')}は、具体的な行動と結果がないと伝わりません。`]);
  const lines = t.split(/\n/).filter((l) => l.trim().length > 6); const res = lines.filter((l) => /改善|削減|向上|増加|拡大|達成|短縮|獲得|表彰|%|％|倍/.test(l)).length;
  if (lines.length >= 10 && res / lines.length < 0.15) out.push(['業務の説明が中心で、成果が少ない', `${lines.length}行のうち、成果を書いた行は${res}行です。`]);
  if (/部長|課長|マネージャ|マネジャ|管理職|責任者|リーダー|室長|所長|工場長/.test((a.position || '') + (a.summary || '')) && !/部下|メンバー\s*\d|\d+\s*(名|人)の(チーム|組織|部|課)|予算|損益|P\/?L|売上責任/.test(nd(t)))
    out.push(['組織を動かした規模が見えない', '部下やチームの人数、任された予算・損益の規模が書かれていません。管理職の選考では、最初にここを見ます。']);
  return out;
}
function oldDocHTML(a) {
  const x = oldDocCheck(a);
  if (!oldText()) return state.demo || (a.company || '').startsWith('登録用') ? '' : '<p class="hint tiny olddiag-hint">いま使っている職務経歴書があれば、ステップ1で貼り付けるか読み込むと、この求人の目でどこが弱いかを無料で診断します。</p>';
  return `<div class="olddiag"><b>今の書類を、この求人の目で見ると（無料の診断）</b>${x.length ? `<ul>${x.map(([k, v]) => `<li><b>${h(k)}</b>：${h(v)}</li>`).join('')}</ul><p class="hint tiny" style="margin:4px 0 0">この会社向けに作る書類では、これらを直すように作ります。</p>` : '<p class="hint" style="margin:4px 0 0">求人の言葉・数字・具体性の点で、目立った問題は見つかりませんでした。この会社向けには、実績の選び方と順番を変えて作ります。</p>'}</div>`;
}
function analysisHTML(a) {
  const ep = {}; ((state.profile && state.profile.episodes) || []).forEach((e) => { ep[e.id] = e.title; });
  const src = (s) => `<span class="tag ${s === '一般知識' ? 'warn' : 'gray'}">${h(s === '一般知識' ? 'AIの一般知識・要確認' : (s || '—'))}</span>`;
  const mc = { '◎': 'a', '○': 'b', '△': 'c' };
  const must = a.requirements.filter((r) => r.type === '必須'); const weak = must.filter((r) => r.match === '△').length;
  const line = must.length ? `<p class="screenline"><b>書類選考の目で見ると：</b>必須要件${must.length}件のうち、あなたの経歴で裏付けられるのは${must.length - weak}件${weak ? `、一部だけ合うのが${weak}件です。△の要件は、書類での見せ方（下の「アピールの組み立て」）と面接での答え方で補います` : 'です。書類では、その裏付けを求人の言葉に合わせて前に出します'}。</p>` : '';
  const cs = a.conditions || []; const bad = cs.filter((x) => x.match === '×').length;
  const cond = cs.length ? `<div class="conds ${bad ? 'bad' : ''}"><b>あなたの希望条件と求人票</b>${bad ? `<span class="tiny">合わない条件が${bad}件あります。応募するなら、面接の前に条件を確かめておきましょう。</span>` : ''}<div class="req">${cs.map((x) => `<span class="m ${x.match === '○' ? 'b' : x.match === '×' ? 'x' : 'c'}">${h(x.match)}</span><div class="t">${h(x.item)}：${h(x.wish)}<div class="e">求人票：${h(x.posting)}</div></div>`).join('')}</div><p class="hint tiny" style="margin:4px 0 0">○ 合う　△ 一部だけ・相談次第　× 合わない　? 求人票に記載なし（面接の終盤やエージェント経由で確かめます）</p></div>` : '';
  return `${line}${cond}${oldDocHTML(a)}<div class="an">
    <div class="box"><h4>この会社が重視していること</h4>${a.summary ? `<p style="margin:0 0 10px;font-size:12.5px">${h(a.summary)}</p>` : ''}
      ${a.values.map((v) => `<div class="val"><b>${h(v.label)}</b> ${src(v.source)}<div class="d">${h(v.detail)}</div>${v.quote ? `<div class="qt" data-noi18n>「${h(v.quote)}」</div>` : ''}</div>`).join('')}</div>
    <div class="box"><h4>求人の要件とあなたの経歴</h4><p class="hint tiny" style="margin:-4px 0 8px">◎ 十分に合う　○ 合う　△ 一部だけ合う</p><div class="req">${a.requirements.map((r) => `<span class="m ${mc[r.match] || 'b'}">${h(r.match)}</span><div class="t">${h(r.text)} <span class="tag gray">${h(r.type)}</span><div class="ev">${h(r.evidence)}</div></div>`).join('')}</div></div>
  </div>
  <div class="plan"><h4>アピールの組み立て：どの実績を、どう見せるか</h4>
    ${a.plan.map((p) => `<div class="it"><div class="v">${h(p.value)}</div><div>${p.episode_ids.map((id) => `<span class="tag">${h(id)} ${h(ep[id] || '')}</span>`).join('')}<div>${h(p.angle)}</div></div></div>`).join('')}
    ${a.summary_angle ? `<div class="it"><div class="v">職務要約</div><div>${h(a.summary_angle)}</div></div>` : ''}
    ${a.pr_themes.length ? `<div class="it"><div class="v">自己PRの軸</div><div>${a.pr_themes.map((t) => `<span class="tag">${h(t)}</span>`).join('')}</div></div>` : ''}
    <div class="it"><div class="v">おすすめデザイン</div><div><b>${h(E.THEMES[a.template].label)}</b>　${h(a.template_reason)}</div></div>
  </div>
  ${a.gaps.map((g) => `<p class="gap">⚠ ${h(g)}</p>`).join('')}`;
}

// text for job-site forms and agents (doda・リクナビNEXT・ビズリーチの Web 職務経歴書 have one box per part and per employer)
const bl = (xs) => (xs || []).filter(Boolean).map((x) => '・' + x).join('\n');
function careerText(k) {
  const L = [`${k.company}（${k.period}）`];
  if (k.business) L.push('事業内容：' + k.business); if (k.meta) L.push(k.meta);
  (k.blocks || []).forEach((b) => {
    L.push('', `■ ${[b.period, b.heading].filter(Boolean).join('　')}`);
    if (b.overview) L.push(b.overview);
    if (b.role || b.team) L.push([b.role ? '役割：' + b.role : '', b.team ? '規模：' + b.team : ''].filter(Boolean).join('　'));
    if (b.phases && b.phases.length) L.push('担当工程：' + b.phases.join('・'));
    if (b.env && b.env.length) L.push('開発環境：' + b.env.join('／'));
    if (b.duties && b.duties.length) L.push('【業務内容】', bl(b.duties));
    if (b.achievements && b.achievements.length) L.push('【実績】', bl(b.achievements));
  });
  return L.join('\n');
}
function partText(d, part) {
  if (part === 'summary') return d.summary || '';
  if (part.startsWith('career:')) { const k = (d.careers || [])[Number(part.slice(7))]; return k ? careerText(k) : ''; }
  if (part === 'skills') return [bl(d.skills), (d.tech || []).length ? bl(d.tech) : '', (d.qualifications || []).length ? '【資格】\n' + bl(d.qualifications) : ''].filter(Boolean).join('\n');
  if (part === 'pr') return (d.pr || []).map((p) => (p.heading ? '【' + p.heading + '】\n' : '') + p.body).join('\n\n');
  if (part === 'all') return ['■職務要約', d.summary, '', '■職務経歴', ...(d.careers || []).map((k) => careerText(k) + '\n'), '■活かせる経験・知識・技術', partText(d, 'skills'), '', '■自己PR', partText(d, 'pr')].join('\n');
  return '';
}
function formCopyHTML(c) {
  const d = c.doc || {}; const ks = d.careers || [];
  return `<details class="formcopy"><summary>転職サイト・エージェントの入力欄に貼る（テキストでコピー）</summary>
    <p class="hint tiny" style="margin:4px 0 6px">doda・リクナビNEXT・ビズリーチの Web 職務経歴書は、項目ごと・会社ごとの入力欄に分かれています。欄ごとにコピーして貼り付けてください。${c.general ? '' : '複数の会社に同じ書類で応募するなら、ステップ2の「登録用の汎用版」も使えます。'}</p>
    <div class="fc-row"><button class="btn small" data-act="copyPart" data-part="summary">職務要約</button>${ks.map((k, i) => `<button class="btn small" data-act="copyPart" data-part="career:${i}">職務内容：${h(k.company)}</button>`).join('')}<button class="btn small" data-act="copyPart" data-part="skills">活かせる経験・知識</button><button class="btn small" data-act="copyPart" data-part="pr">自己PR</button><button class="btn small ghost" data-act="copyPart" data-part="all">全文</button></div>
  </details>`;
}

// ---------------- step 3 ----------------
function render3() {
  const list = state.companies.filter((c) => c.analysis || c.doc);
  if (!list.length) { $('#v3').innerHTML = viewHead('そのまま出せる書類', '求人票を分析した応募先の書類をここで作ります。') + '<div class="card empty">「応募先と方針」で方針を作ると、ここで書類を作成できます。<br><br><button class="btn" data-act="demo">サンプルを見る</button></div>'; return; }
  if (!company(state.active) || !list.includes(company(state.active))) state.active = (list.find((c) => c.doc) || list[0]).id;
  const c = company(state.active);
  const ready = state.companies.filter((x) => x.analysis && !x.doc && x.status === 'analyzed').length;
  const single = list.length === 1 && !ready;
  $('#v3').innerHTML = viewHead('そのまま出せる書類', 'テンプレートに自動で流し込み、A4 の枚数に収めます。文字を直してもレイアウトは崩れません。' + (UI_LANG !== 'ja' ? '<br>多くの日本企業には、履歴書と職務経歴書をセットで出します。英文レジュメは、求人で求められた場合や外資系企業に出します。' : ''), anyBusy() ? batchProgress() + '<button class="btn" data-act="abortAll">すべて中止</button>' : '') + `<div class="l3 ${single ? 'single' : ''}">
    ${list.length > 1 || ready ? `<aside class="side">
      <div class="lab">応募先</div>
      ${list.map((x) => `<button class="co-it ${x.id === c.id ? 'on' : ''}" data-act="open" data-id="${x.id}"><b>${h(cname(x))}</b>${pill(x)} <span class="cc">${h(x.priority)}</span></button>`).join('')}
      ${ready > 1 ? `<button class="btn primary" style="width:100%" data-act="generateAll">未作成の${ready}社をまとめて作る</button>` : ''}
    </aside>` : ''}
    <div class="stack">${docPaneHTML(c)}</div>
  </div>`;
  if (c.doc && (c.tab === 'doc' || !c.tab)) { drawPreview(c); drawThumbs(c); }
  if (c.doc && c.tab === 'rireki') drawRireki(c);
  if (c.tab === 'en') drawEnglish(c);
}
function docPaneHTML(c) {
  const a = c.analysis || {};
  if (!c.doc) {
    return `<div class="card"><h2>${h(cname(c))}</h2><div class="hint" style="margin:0">${h(a.position || '')}</div>
      ${c.status === 'generating' ? `<div class="empty">${spin}${stage('generate', c.since)} ${elapsed(c.since, '1〜2分')}<br><br>${abortBtn('gen-' + c.id)}</div>` : c.status === 'queued' ? '<div class="empty">待機中です。前の応募先が終わると自動で始まります。</div>'
      : overPreview(c) ? `<div class="empty">見せ方は決まっています。<br>購入前に無料で作成・確認できる応募先は${(CFG.preview && CFG.preview.free) || 2}社までです。<br><br><button class="btn primary" data-act="openBuy" data-why="preview">利用枠を追加して作る</button></div>`
      : `<div class="empty">見せ方は決まっています。<br><br><button class="btn primary" data-act="generate" data-id="${c.id}">この見せ方で書類を作る</button></div>`}
      ${c.error ? `<div class="fb err">${h(c.error)}</div>` : ''}</div>`;
  }
  const rec = a.template;
  // the engineer design only where it has something to show: projects with role / phases / environment
  const tpls = Object.keys(E.THEMES).filter((k) => k !== 'engineer' || c.theme === k || rec === k || E.hasProjects(c.doc)).map((k) => `<button class="tpl ${c.theme === k ? 'on' : ''}" data-act="theme" data-v="${k}"><canvas data-thumb="${k}" width="168" height="238"></canvas><div><b>${E.THEMES[k].label}</b><span>${h(E.THEMES[k].note)}</span>${rec === k ? '<span class="rec">この応募先におすすめ</span>' : ''}</div></button>`).join('');
  const sw = E.THEMES[c.theme] && E.THEMES[c.theme].accentable ? `<div class="swatches">配色 ${E.ACCENTS.map((x) => `<button class="sw ${c.accent === x.key ? 'on' : ''}" style="background:${x.hex}" data-act="accent" data-v="${x.key}" title="${x.label}" aria-label="${x.label}"></button>`).join('')}</div>` : '';
  const tabs = `<div class="seg tabs"><button data-act="tab" data-v="doc" class="${c.tab === 'doc' || !c.tab ? 'on' : ''}">職務経歴書</button><button data-act="tab" data-v="rireki" class="${c.tab === 'rireki' ? 'on' : ''}">履歴書</button><button data-act="tab" data-v="en" class="${c.tab === 'en' ? 'on' : ''}">英文レジュメ${c.en ? ' ✓' : ''}</button>${c.general ? '' : `<button data-act="tab" data-v="pack" class="${c.tab === 'pack' ? 'on' : ''}">志望動機・面接準備${c.pack ? ' ✓' : ''}</button>`}</div>`;
  const head = `<div class="row" style="margin:0;align-items:flex-start">
        <div style="min-width:0"><h2>${h(cname(c))}</h2><div class="hint" style="margin:0">${h(a.position || '')}</div></div>
        <span class="spacer"></span>${tabs}</div>`;
  if (c.tab === 'pack') return `<div class="card">${head}${lockNoteHTML(c)}</div>${packHTML(c)}`;
  if (c.tab === 'rireki') return `<div class="card">${head}${lockNoteHTML(c)}</div>${rirekiHTML(c)}`;
  if (c.tab === 'en') return `<div class="card">${head}${lockNoteHTML(c)}</div>${englishHTML(c)}`;
  const exOpen = inputLang() !== 'ja' || UI_LANG !== 'ja' || c.exStatus === 'run' || ui.exOpen;
  // the check in one's own language: right under the document on the English / Chinese page, where it matters most
  const exBlock = `<details class="exwrap" ${exOpen ? 'open' : ''}><summary data-act="exToggle">${UI_LANG === 'ja' ? '日本語が母語でない方へ：中文・English で内容と書き方を確認する（任意）' : '提出前に、内容と日本語の書き方を母語で確認する（おすすめ）'}</summary>${explainHTML(c)}</details>`;
  const others = state.companies.filter((x) => !x.sample).length;
  return `<div class="card dochead">${head}</div>
    <div class="docgrid ${c.edit ? 'edit' : ''}">
      ${c.edit ? `<div class="card editor" id="editor">${editorHTML(c.doc, c.theme)}</div>` : ''}
      <div class="readbar"><div class="seg">${UI_LANG !== 'ja' ? `<button data-act="readMode" data-v="tr" class="${readOn() && ui.readTr !== false ? 'on' : ''}">対訳で読む</button>` : ''}<button data-act="readMode" data-v="read" class="${readOn() && (UI_LANG === 'ja' || ui.readTr === false) ? 'on' : ''}">文字で読む</button><button data-act="readMode" data-v="a4" class="${readOn() ? '' : 'on'}">A4 で見る</button></div><button class="btn primary small" data-act="toSave">保存・デザイン ↓</button></div>
      <div class="desk" id="preview">${F.ready ? '' : (F.err ? '<div class="empty">書体の読み込みに失敗しました。ページを再読み込みしてください。</div>' : `<div class="empty">${spin}書体を読み込んでいます…</div>`)}</div>
      <aside class="card ctrl">
        <div class="fitbar" id="fitbar">${fitbarHTML(c)}</div>
        <div class="dl">
          <button class="btn primary" data-act="pdf">PDF をダウンロード</button>
          <span class="wordpick"><button class="btn" data-act="docx">Word</button><select data-wt aria-label="Word を開く環境" title="Word を開く環境に入っている書体を使います">${E.DOCX_TARGETS.map((t) => `<option value="${t.key}" ${wordTarget() === t.key ? 'selected' : ''}>${t.key === 'google' ? 'Google ドキュメント用' : t.key === 'mac' ? 'Mac 用' : 'Windows 用'}</option>`).join('')}</select></span>
        </div>
        ${lockNoteHTML(c)}
        <p class="hint tiny">提出は PDF がおすすめです（どのパソコンでも同じ見た目）。Word は自分で書き直したいときや、企業から Word を求められたときに。</p>
        ${formCopyHTML(c)}
        <div class="ctrl-row"><button class="btn" data-act="edit">${c.edit ? '編集を閉じる' : '文章を直す'}</button><div class="seg">${[2, 3].map((n) => `<button data-act="pages" data-v="${n}" class="${c.maxPages === n ? 'on' : ''}">A4 ${n}枚</button>`).join('')}</div></div>
        <label class="maskopt"><input type="checkbox" data-act="mask" ${state.mask !== false ? 'checked' : ''}><span>顧客名・社外秘の数字を伏せて書く（おすすめ）<small>取引先の名前や売上額などを「大手通信会社」「前年比」のように書きます。変えたら「AI で作り直す」で反映されます。</small></span></label>
        <h4>デザイン</h4>
        <div class="tpls">${tpls}</div>${sw}
        <div class="ctrl-row">${(c.history || []).length ? '<button class="btn ghost small" data-act="undo">1つ前の版に戻す</button>' : ''}<span class="spacer"></span><button class="btn ghost small" data-act="generate" data-id="${c.id}" ${BUSY.includes(c.status) ? 'disabled' : ''}>AI で作り直す</button></div>
      </aside>
    </div>
    ${UI_LANG !== 'ja' ? exBlock : ''}
    ${c.downloaded && others <= 1 ? `<div class="card nudge"><div><b>1社目の書類ができました</b><div class="hint" style="margin:0">経歴はそのまま使えます。次の会社は求人票を貼るだけです。</div></div><span class="spacer"></span><button class="btn primary" data-act="nextCompany">＋ 次の応募先を追加</button></div>` : ''}
    ${oldText() && !state.demo ? `<div class="card nudge"><div><b>今までの職務経歴書と比べる</b><div class="hint" style="margin:0">読み込んだ書類と、この会社向けに作った書類を並べて見られます。</div></div><span class="spacer"></span><button class="btn" data-act="compareOld">比べる</button></div>` : ''}
    ${c.general ? '<div class="card next"><div><b>志望動機・面接準備</b><div class="hint" style="margin:0">汎用版には志望動機・面接準備はありません。面接が決まった会社をステップ2で応募先として追加すると、その会社向けに作れます。</div></div></div>' : `<div class="card next"><div><b>志望動機・面接準備</b><div class="hint" style="margin:0">この書類と矛盾しない志望動機と想定問答を作ります。</div></div><span class="spacer"></span><button class="btn" data-act="tab" data-v="pack" data-go="1">${c.pack ? '作成済みを見る →' : '作成する →'}</button></div>`}
    ${UI_LANG === 'ja' ? exBlock : ''}`;
}
function explainHTML(c) {
  const x = c.explain;
  let s = `<div class="card explain"><div class="row" style="margin:0"><div><b>母語で内容と書き方を確認する</b><div class="hint" style="margin:0">日本語の原文と翻訳を並べ、書き方の理由と不自然な箇所を解説します。手で直した部分も確認できます。${UI_LANG === 'ja' ? '<span lang="zh">可用中文对照确认内容和日文写法。</span>' : ''}</div></div><span class="spacer"></span>
    <div class="seg">${['zh', 'en'].map((k) => `<button data-act="exLang" data-v="${k}" class="${state.explainLang === k ? 'on' : ''}">${k === 'zh' ? '中文' : 'English'}</button>`).join('')}</div>
    <button class="btn ${x ? 'ghost' : 'primary'}" data-act="explain" ${c.exStatus === 'run' ? 'disabled' : ''}>${x ? 'もう一度確認する' : '対照と解説を作る'}</button></div>`;
  if (c.exStatus === 'run') s += `<div class="status">${spin}${stage('explain', c.exSince)} ${elapsed(c.exSince, '1〜2分')} ${abortBtn('ex-' + c.id)}</div>`;
  if (c.exError) s += `<div class="status err">${h(c.exError)}</div>`;
  if (x) {
    if (x.overview) s += `<div class="ex-ov">${h(x.overview)}</div>`;
    if (x.naturalness.length) s += `<h3>より自然な言い回し（${x.naturalness.length}件）</h3>${x.naturalness.map((n, i) => `<div class="ex-n"><div><s data-noi18n>${h(n.ja)}</s> → <b data-noi18n>${h(n.suggestion)}</b><div class="cc">${h(n.issue)}</div></div><button class="btn small" data-act="exApply" data-i="${i}" ${n.applied ? 'disabled' : ''}>${n.applied ? '反映済み' : '反映する'}</button></div>`).join('')}`;
    else s += '<div class="fb ok" style="margin-top:10px">日本語として不自然な箇所は見つかりませんでした。</div>';
    if (x.sections.length) s += `<h3>原文と翻訳</h3><div class="ex-t">${x.sections.map((t) => `<div class="ex-r"><div class="ex-h" data-noi18n>${h(t.title)}</div><div class="ex-ja" data-noi18n>${h(t.ja)}</div><div class="ex-tr" lang="${x.lang === 'en' ? 'en' : 'zh'}">${h(t.tr)}${t.notes.length ? `<ul>${t.notes.map((n) => `<li>${h(n)}</li>`).join('')}</ul>` : ''}</div></div>`).join('')}</div>`;
    if (x.conventions.length) s += `<h3>日本の職務経歴書の書き方</h3><ul lang="${x.lang === 'en' ? 'en' : 'zh'}">${x.conventions.map((t) => `<li>${h(t)}</li>`).join('')}</ul>`;
  }
  return s + '</div>';
}
function rirekiHTML(c) {
  const r = state.rireki;
  if (!r.history) { r.history = genHistory(); save(); }
  if (!r.licenses) { r.licenses = genLicenses(); save(); }
  const f = (k, label, ph, type) => `<div><label for="rk-${k}">${label}</label><input type="${type || 'text'}" id="rk-${k}" data-rk="${k}" value="${h(r[k])}" placeholder="${h(ph || '')}"></div>`;
  const todo = /【要記入/.test(c.rk.motive);
  return `<div class="rk">
    <div class="stack">
      ${UI_LANG !== 'ja' ? '<div class="card"><p class="hint" style="margin:0">履歴書は、氏名・連絡先・学歴・職歴・資格などを決まった様式で書く書類で、職務経歴書と一緒に出します。共通の情報は一度入れればすべての応募先で使えます。「志望の動機」は応募先ごとに作ります。</p></div>' : ''}
      <div class="card"><h2>共通の情報</h2><p class="hint">すべての応募先で共通です。住所・電話番号・写真は AI には送りません（アカウントには保存され、ほかの端末でも使えます）。</p>
        <div class="g2f">${f('furigana', 'ふりがな', 'さとう けんた')}${f('birth', '生年月日', '', 'date')}</div>
        <div class="g2f">${f('gender', '性別（記入は任意です）', '')}<div><label>年の書き方</label><div class="seg">${[['west', '西暦'], ['jp', '和暦']].map(([k, l]) => `<button data-act="rkEra" data-v="${k}" class="${r.era === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
        <div class="g2f">${f('zip', '郵便番号', '140-0002')}${f('addrKana', '住所のふりがな', '')}</div>
        ${f('addr', '現住所', '東京都品川区…')}
        <div class="g2f">${f('tel', '電話', '090-0000-0000')}${f('email', 'E-mail', 'name@example.com')}</div>
        <details><summary>連絡先（現住所以外に連絡を希望する場合のみ）</summary><div class="g2f">${f('zip2', '郵便番号', '')}${f('addr2Kana', 'ふりがな', '')}</div>${f('addr2', '連絡先住所', '')}<div class="g2f">${f('tel2', '電話', '')}${f('email2', 'E-mail', '')}</div></details>
        <label>証明写真（縦4:横3。印刷して貼る場合は空欄でOK）</label>
        ${UI_LANG !== 'ja' ? '<p class="hint tiny">日本の履歴書には写真を貼るのが一般的です（企業の指示があればそれに従ってください）。3か月以内に撮った、無地の背景・正面向き・胸から上の証明写真（縦40mm×横30mm）を使います。</p>' : ''}
        <div class="row" style="margin-top:4px">${r.photo ? `<img src="${r.photo}" alt="" class="rk-ph">` : ''}<label class="btn small" style="margin:0;color:var(--ink)">${r.photo ? '写真を変える' : '写真を選ぶ'}<input type="file" id="rkPhoto" accept="image/*" class="hidden"></label>${r.photo ? '<button class="btn ghost small" data-act="rkPhotoDel">写真を外す</button>' : ''}</div>
      </div>
      <div class="card"><h2>学歴・職歴</h2><p class="hint">1行に1項目、「2016年4月｜○○株式会社　入社」の形で書きます。「学歴」「職歴」「以上」だけの行は見出しとして配置されます。経歴データから自動で作っています。</p>
        <p class="hint tiny">退職の行は「一身上の都合により退職」としています（自分の意思で辞めた場合）。経歴に出産・育児や介護のために辞めたと書いてあれば、「出産・育児のため退職」「家族の介護のため退職」としています（書きたくなければ「一身上の都合により退職」に直してかまいません）。会社の倒産・解雇などは「会社都合により退職」、契約が終わった場合は「契約期間満了により退職」に直してください。</p>
        <textarea rows="13" data-rk="history">${h(r.history)}</textarea>
        <div class="row"><button class="btn small" data-act="rkGen" data-v="history">経歴データから作り直す</button></div>
        ${UI_LANG !== 'ja' ? '<p class="hint tiny">よく使う決まった言い方：入学・卒業、入社、一身上の都合により退職（自分の意思で辞めたときの一般的な書き方）、現在に至る。海外の学校・会社は正式名称で書き、必要なら国名を添えます。</p>' : ''}
        <h3>免許・資格</h3>${UI_LANG !== 'ja' ? '<p class="hint tiny">日本語能力試験の結果は「2023年12月｜日本語能力試験 N2 合格」のように書きます。採用担当者がよく確認する項目です。</p>' : ''}<textarea rows="4" data-rk="licenses">${h(r.licenses)}</textarea>
        <div class="row"><button class="btn small" data-act="rkGen" data-v="licenses">経歴データから作り直す</button></div>
      </div>
      <div class="card"><h2>この応募先向け</h2>
        <label style="display:flex;justify-content:space-between">志望の動機・アピールポイント<span class="cc">${len(c.rk.motive)}字</span></label>
        <textarea rows="6" data-crk="motive">${h(c.rk.motive)}</textarea>
        ${c.rk.motive_tr && c.rk.motive === c.rk.motiveSrc ? trl(c.rk.motive_tr) : ''}
        ${todo ? '<div class="fb warn" style="margin-top:8px">【要記入】が残っています。あなたの言葉で埋めてから提出してください。</div>' : ''}
        ${!c.rk.motive ? '<p class="hint tiny" style="margin:4px 0 0">面接用の志望動機とは別に、履歴書に合う長さと書き言葉で作ります（同じ文を2つの書類に書かないため）。本人希望記入欄も、転職の軸の「希望条件」から作ります。</p>' : ''}
        <div class="row"><button class="btn small" data-act="rkMotive" ${c.rk.status === 'run' ? 'disabled' : ''}>${c.rk.motive ? 'AI で作り直す' : 'AI で作る'}</button>${c.rk.status === 'run' ? `<span class="status" style="margin:0">${spin}作っています… ${elapsed(c.rk.since, '20〜40秒')} ${abortBtn('rk-' + c.id)}</span>` : ''}</div>
        ${c.rk.error ? `<div class="status err">${h(c.rk.error)}</div>` : ''}
        <label>本人希望記入欄</label>
        <textarea rows="3" data-crk="hope">${h(c.rk.hope)}</textarea>
        ${c.rk.hope_tr && c.rk.hope === c.rk.hopeSrc ? trl(c.rk.hope_tr) : ''}
        ${hopeDraft() && (!c.rk.hope.trim() || c.rk.hope === '貴社の規定に従います。') ? `<div class="fb" style="margin-top:6px">転職の軸の「希望条件」に、勤務時間・勤務地などの条件があります。この欄に書いておくと、面接で条件が食い違いません。<div class="row" style="margin:6px 0 0"><button class="btn small" data-act="hopeFill">希望条件から入れる（無料）</button></div></div>` : ''}
        <p class="hint" style="margin-top:6px">特に希望がなければ「貴社の規定に従います。」と書くのが一般的です。勤務地・勤務時間・職種など譲れない条件がある場合だけ書きます（育児・介護などで勤務時間に条件がある場合も、ここに書きます）。年収の希望は、ふつう書きません。</p>
        ${UI_LANG !== 'ja' ? '<p class="hint tiny">外国籍の方：履歴書の様式には国籍・在留資格の欄がありません。在留資格と在留期限を伝える場合は、この欄に書く方法があります（例：在留資格：技術・人文知識・国際業務（2028年3月まで））。企業や紹介会社から指示があれば、それに従ってください。</p>' : ''}
      </div>
    </div>
    <div class="stack">
      <div class="card" style="padding:14px 18px"><div class="row" style="margin:0"><b>プレビュー（A4・2枚）</b><span class="spacer"></span><button class="btn primary" data-act="rkPdf">履歴書 PDF をダウンロード</button></div><p class="hint tiny" style="margin:6px 0 0">保存は無料です。手書きを求められていなければ、PDF で提出できます。スマートフォンに保存した PDF は、コンビニのネットプリントで A4 に印刷できます。</p><div id="rkWarn" class="fitbar"></div></div>
      <div class="desk" id="rkPreview">${F.ready ? '' : `<div class="empty">${spin}書体を読み込んでいます…</div>`}</div>
    </div>
  </div>`;
}
let rkT;
function drawRireki(c) {
  const box = $('#rkPreview'); if (!box || !F.ready || !c) return;
  photoImg(state.rireki.photo);
  const lay = E.layoutRireki(rkData(c), F.meas);
  const cssW = Math.min(Math.max(box.clientWidth - 36, 280), 640);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  box.querySelectorAll('.empty').forEach((e) => e.remove());
  const cvs = [...box.querySelectorAll('canvas')];
  lay.pages.forEach((pg, i) => {
    let cv = cvs[i]; if (!cv) { cv = document.createElement('canvas'); box.appendChild(cv); }
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssW * E.PAGE_H / E.PAGE_W * dpr); cv.style.width = cssW + 'px';
    E.renderCanvas(cv.getContext('2d'), pg, cv.width / E.PAGE_W, F.meas, F.fam);
  });
  const w = $('#rkWarn');
  if (w) {
    const r = state.rireki; const miss = [!r.furigana && 'ふりがな', !r.birth && '生年月日', !r.addr && '現住所', !r.tel && '電話', !r.email && 'E-mail'].filter(Boolean);
    w.innerHTML = lay.warnings.map((t) => `<div class="fb warn">${h(t)}</div>`).join('') + (miss.length ? `<div class="fb note">未入力：${miss.map((m) => `<span>${h(m)}</span>`).join('、')}</div>` : '<div class="fb ok">✓ 基本情報はそろっています。提出前に誤字と日付を確認してください。</div>');
  }
}
function fitbarHTML(c) {
  const out = []; const oks = [];
  if (c.status === 'generating' && c.doc) out.push(`<div class="fb run">${spin}${stage('generate', c.since)} ${elapsed(c.since, '1〜2分')} ${abortBtn('gen-' + c.id)}</div>`);
  if (c.status === 'fitting') out.push(`<div class="fb run">${spin}A4 ${c.maxPages}枚に収まるよう AI が文章を詰めています（${c.rounds}回目）… ${elapsed(c.since, '30〜60秒')} ${abortBtn('fit-' + c.id)}</div>`);
  if (c.error) out.push(`<div class="fb err">${h(c.error)}</div>`);
  if (!c.doc) return out.join('');
  if (F.ready && c.status !== 'fitting') {
    const rep = E.fitReport(E.layout(c.doc, c.theme, F.meas, opt(c)), c.maxPages); c.fit = rep;
    if (rep.ok) oks.push(`A4 ${rep.pages}枚に収まっています${c.rounds ? `（AI が${c.rounds}回 自動調整）` : ''}`);
    else out.push(`<div class="fb warn">${rep.reason === 'orphan' ? '最終ページに数行だけはみ出しています' : `A4 ${c.maxPages}枚を超えています（現在 ${rep.pages}枚）`}。あと約${rep.overChars}字減らすと収まります。<button class="btn small" data-act="refit">AI で ${c.maxPages}枚に収める</button></div>`);
    const miss = E.missingChars(c.doc, c.theme, F.meas);
    if (miss.length) out.push(`<div class="fb warn">書体にない文字があります：${h(miss.join(' '))}　→「文章を直す」で別の表記に置き換えてください。</div>`);
  }
  const nc = checkNumbers(docParts(c.doc));
  if (nc.bad.length) out.push(`<div class="fb warn">⚠ あなたの入力で確認できない数値が ${nc.bad.length}件 あります：${nc.bad.map((n) => `<mark>${h(n)}</mark>`).map((x, i, a) => `<span class="nw">${x}${i < a.length - 1 ? '、' : ''}</span>`).join('')}<span>　プレビューの黄色い箇所です。事実なら「経歴」に追記、違うなら「文章を直す」で修正してください。</span></div>`);
  else if (nc.checked) oks.push(`数値${nc.checked}件は、どれもあなたの入力にある数字です（何の数字か・「約」「前年比」などの言い方が合っているかは、目で確かめてください）`);
  const co = companyIn(c);
  if (co) out.push(`<div class="fb note"><span>職務経歴書に「${h(co)}」が入っています。職務経歴書は転職エージェント経由でほかの会社に出されたり、使い回したりすることが多いため、応募先の名前は志望動機（履歴書・面接）で伝えるのがおすすめです。</span></div>`);
  const fut = futureDates(c.doc);
  if (fut.length) out.push(`<div class="fb warn">⚠ 作成日より後の日付があります：${h(fut.join('、'))}</div>`);
  const zh = simplifiedIn(c.doc);
  if (zh.length || (c.fixed || []).length) out.push(`<div class="fb warn">⚠ 中国語の表記が混ざっていた可能性があります（${h([...(c.fixed || []), ...zh].slice(0, 6).join('、'))}）。字体だけでなく、文として自然な日本語か確認してください。</div>`);
  if (oks.length) out.unshift(`<div class="fb ok">${oks.map((t) => '✓ ' + t).join('<br>')}</div>`);
  out.push('<p class="hint tiny">提出前に、数値・社名・期間が事実どおりか最後に目で確認してください。</p>');
  if (UI_LANG !== 'ja') out.push('<p class="hint tiny">日本語で書かれた内容は、この下の「母語で確認する」で1項目ずつ対訳を見られます。</p>');
  return out.join('');
}
function editorHTML(d, theme) {
  const projOn = theme === 'engineer' || E.hasProjects(d);
  const ta = (path, v, rows, label, list) => `<label>${label}<span class="cc">${list ? '' : len(v) + '字'}</span></label><textarea rows="${rows}" data-ed="${path}" data-list="${list ? 1 : ''}">${h(list ? v.join('\n') : v)}</textarea>`;
  const inp = (path, v, label) => `<label>${label}</label><input type="text" data-ed="${path}" value="${h(v)}">`;
  let s = '<p class="hint" style="margin-top:0">文字を直すとプレビューがすぐ更新されます。箇条書きは1行に1項目です。手で直した内容は「AI で作り直す」で上書きされます（直前の3版までは戻せます）。</p>';
  s += `<fieldset><legend>基本</legend>${inp('name', d.name, '氏名')}${inp('date', d.date, '日付')}</fieldset>`;
  s += `<fieldset><legend>実績ハイライト（プレミアムで表示）</legend><label>1行に1つ（「数値｜説明」の形）</label><textarea rows="3" data-ed="highlights" data-list="hl">${h(d.highlights.map((x) => x.value + '｜' + x.label).join('\n'))}</textarea></fieldset>`;
  s += `<fieldset><legend>職務要約</legend>${ta('summary', d.summary, 6, '本文')}<div class="row" style="margin-top:6px"><button class="btn small" data-act="copyField" data-path="summary">コピー</button></div></fieldset>`;
  d.careers.forEach((c, i) => {
    s += `<fieldset><legend>職務経歴 ${i + 1}</legend>${inp(`careers.${i}.company`, c.company, '会社名')}${inp(`careers.${i}.period`, c.period, '在籍期間')}${inp(`careers.${i}.business`, c.business, '事業内容')}${inp(`careers.${i}.meta`, c.meta, '従業員数・雇用形態など')}`;
    c.blocks.forEach((b, j) => {
      const k = `careers.${i}.blocks.${j}`;
      const proj = theme === 'engineer' || b.env.length || b.phases.length || b.role || b.team || b.overview;
      s += `<div style="border-top:1px dashed var(--line);margin-top:12px;padding-top:2px">${inp(k + '.period', b.period, '期間')}${inp(k + '.heading', b.heading, proj ? 'プロジェクト名' : '部署・役職')}`
        + (proj ? `${ta(k + '.overview', b.overview, 2, '概要')}${inp(k + '.role', b.role, '役割（PL・メンバーなど）')}${inp(k + '.team', b.team, '規模（「5名（全体30名）」など）')}${inp(k + '.phases', [].concat(b.phases).join('／'), '担当工程（要件定義／基本設計／詳細設計／実装／テスト／運用・保守 から）')}${ta(k + '.env', b.env, 4, '開発環境（1行に1つ、「言語：Java、Go」の形）', true)}` : '')
        + `${ta(k + '.duties', b.duties, 4, proj ? '担当業務' : '業務内容', true)}${ta(k + '.achievements', b.achievements, 4, '実績・取り組み', true)}</div>`;
    });
    s += '</fieldset>';
  });
  s += `<fieldset><legend>活かせる経験・知識・技術</legend>${ta('skills', d.skills, 5, '1行に1項目', true)}</fieldset>`;
  if (projOn || (d.skillTable || []).length) s += `<fieldset><legend>テクニカルスキル</legend><label>1行に1つ（「分類｜スキル｜経験年数｜レベル・内容」の形）</label><textarea rows="6" data-ed="skillTable" data-list="st">${h((d.skillTable || []).map((r) => [r.cat, r.name, r.years, r.level].join('｜')).join('\n'))}</textarea></fieldset>`;
  s += `<fieldset><legend>スキル・ツール・語学</legend>${ta('tech', d.tech, 3, '1行に1項目（「ツール：A、B」の形）', true)}</fieldset>`;
  s += `<fieldset><legend>資格・免許</legend><label>1行に1件（「2019年6月｜資格名」の形）</label><textarea rows="4" data-ed="qualifications" data-list="q">${h(d.qualifications.map((q) => q.date + '｜' + q.name).join('\n'))}</textarea></fieldset>`;
  d.pr.forEach((p, i) => { s += `<fieldset><legend>自己PR ${i + 1}</legend>${inp(`pr.${i}.heading`, p.heading, '見出し')}${ta(`pr.${i}.body`, p.body, 6, '本文')}</fieldset>`; });
  s += `<div class="row"><button class="btn small" data-act="copyField" data-path="pr">自己PRをまとめてコピー</button></div>`;
  return s;
}
// the translation under a Japanese text, on the English / Chinese page
const trl = (t, tag) => (t && UI_LANG !== 'ja' ? `<${tag || 'div'} class="trl" lang="${UI_LANG === 'zh' ? 'zh-Hans' : 'en'}">${h(t)}</${tag || 'div'}>` : '');
// before the credit: this company's short 志望動機 and one likely question, answered from the user's own career
// (free, a few companies; ai.js 'taste'). where: 'pack' (the tab), 'buy' (the purchase sheet), 's4' (step 4)
function tasteHTML(c, where) {
  if (!c || c.pack || c.general || state.demo || !c.analysis) return '';
  const t = c.taste; const id = `data-id="${c.id}"`;
  if (c.tasteStatus === 'run') return `<div class="taste"><div class="status">${spin}この会社の志望動機と想定質問を、あなたの経歴から作っています… ${elapsed(c.tasteSince, '20〜40秒')}</div></div>`;
  if (!t && where === 's4') return `<div class="taste ask"><div><b>面接が決まったら：この会社の面接対策</b><div class="hint tiny" style="margin:2px 0 0">想定質問と回答例（9問前後）・逆質問・突っ込まれやすい点と対策・志望動機に加えて、面接の記録から次の選考の対策も作れます（この会社で1社分・${fromPrice()}）。まず1問を、あなたの経歴で無料で試せます。</div></div><button class="btn primary" data-act="taste" ${id}>無料で1問見る</button>${c.tasteError ? `<div class="status err" style="flex-basis:100%">${h(c.tasteError)}</div>` : ''}</div>`;
  if (!t) return `<div class="taste ask"><div><b>払う前に、この会社の分を見てみる（無料）</b><div class="hint tiny" style="margin:2px 0 0">この会社の志望動機の書き出しと、面接で突かれそうな質問1問への回答例を、あなたの経歴から作ります。利用枠は使いません。</div></div><button class="btn ${where === 'buy' ? '' : 'primary'}" data-act="taste" ${id}>無料で見る</button>${c.tasteError ? `<div class="status err" style="flex-basis:100%">${h(c.tasteError)}</div>` : ''}</div>`;
  const fill = (x) => h(x).replace(/【要記入[^】]*】/g, (m) => `<mark class="todo">${m}</mark>`);
  const q = t.q;
  return `<div class="taste got nocopy"><b>この会社の面接準備（無料で見られる一部）</b>
    ${t.short ? `<div class="mv"><div class="h"><span>志望動機（書き出し）</span></div><div data-noi18n>${fill(t.short)}</div>${trl(t.short_tr)}</div>` : ''}
    ${q.q ? `<div class="tq"><div class="tq-q">Q. <span data-noi18n>${h(q.q)}</span>${trl(q.q_tr, 'span')}</div>${q.intent ? `<div class="intent">意図：${h(q.intent)}</div>` : ''}${q.points.length ? `<ul>${q.points.map((x) => `<li>${h(x)}</li>`).join('')}</ul>` : ''}<div class="mv"><div class="h"><span>回答例</span></div><div data-noi18n>${fill(q.answer)}</div>${trl(q.answer_tr)}</div>${q.answer_easy ? `<details class="easy"><summary>やさしい日本語の版（自分の言葉で話す練習に）</summary><div data-noi18n class="easytx">${rubyFill(q.answer_easy)}</div></details>` : ''}</div>` : ''}
    <p class="hint tiny" style="margin:8px 0 0">1社分を使うと、志望動機の全文（300字・150字）、残りの想定質問（全部で9問前後）と回答例、逆質問、突っ込まれやすい点と対策、選考ごとの面接対策を作り、コピーもできます。</p>
    ${where === 'buy' ? '' : `<div class="row" style="margin:8px 0 0"><span class="spacer"></span><button class="btn primary" data-act="packFor" ${id}>この会社の面接準備を作る（1社分）</button></div>`}</div>`;
}
function packHTML(c) {
  const p = c.pack;
  let s = `<div class="card pack"><div class="row" style="margin:0"><div><h2>志望動機・面接準備</h2><div class="hint" style="margin:0">提出した職務経歴書と矛盾しない志望動機・想定問答をまとめて作ります。回答例は丸暗記用ではなく、要点と30〜40秒の話し方の例です。【要記入】は、あなたにしか書けない部分です。</div>${UI_LANG !== 'ja' ? '<div class="hint" style="margin:6px 0 0">日本企業の面接は日本語で行われることが多いです。回答例は丸暗記せず、要点を自分の日本語で話せるように練習してください。訳は、それぞれの文が何を言っているかを確かめるためのものです。【要記入】を日本語で書くのが難しければ、伝えたい内容を「経歴」や「転職の軸」に母語で書いてから作り直すと、AI が日本語にします。</div>' : ''}</div><span class="spacer"></span>
    ${p ? '<button class="btn ghost" data-act="printPack" title="面接の前日に見直す用に、紙または PDF にします">印刷する</button>' : ''}
    ${p ? `<button class="btn" data-act="toStages" data-id="${c.id}">選考管理に進む →</button>` : ''}
    <button class="btn ${p ? 'ghost' : 'primary'}" data-act="pack" ${c.packStatus === 'run' ? 'disabled' : ''}>${p ? '作り直す' : '作成する'}</button></div>`;
  if (c.packStatus === 'run') s += `<div class="status">${spin}${stage('pack', c.packSince)} ${elapsed(c.packSince, '1〜2分')} ${abortBtn('pack-' + c.id)}</div>`;
  if (c.packError) s += `<div class="status err">${h(c.packError)}</div>`;
  if (!p && locked(c) && c.packStatus !== 'run') s += tasteHTML(c, 'pack');
  if (p) {
    const fill = (t) => h(t).replace(/【要記入[^】]*】/g, (m) => `<mark class="todo">${m}</mark>`);
    const cnt = (t, lo, hi) => { const n = len(t); return `<span class="${n < lo || n > hi ? 'off' : ''}">${n}字・目安${lo}〜${hi}字</span>`; };
    const mv = (t, label, lo, hi, tr) => `<div class="mv"><div class="h"><span><span>${label}</span>${UI_LANG === 'ja' ? `（${cnt(t, lo, hi)}）` : ` (${cnt(t, lo, hi)})`}</span><button class="btn small" data-act="copyText" data-text="${h(t)}">コピー</button></div><div data-noi18n>${fill(t)}</div>${trl(tr)}</div>`;
    const pc = checkNumbers(packParts(p), c.job + '\n' + c.info + '\n' + researchText(c));
    const r = c.research;
    if (r && !r.sample && (p.at || 0) < r.at) s += `<div class="fb note" style="margin-top:12px"><span>会社の公開情報を調べた後、まだ作り直していません。</span> <button class="btn small primary" data-act="pack" ${c.packStatus === 'run' ? 'disabled' : ''}>調べた情報で作り直す</button></div>`;
    if (pc.bad.length) s += `<div class="fb warn" style="margin-top:12px">⚠ あなたの入力と求人票で確認できない数値：${pc.bad.map((n) => `<mark>${h(n)}</mark>`).map((x, i, a) => `<span class="nw">${x}${i < a.length - 1 ? '、' : ''}</span>`).join('')}<span>　面接で話す前に事実か確認してください。</span></div>`;
    s += `<h3>志望動機</h3>${p.motivation.long ? mv(p.motivation.long, '300字版', 280, 320, p.motivation.long_tr) : ''}${p.motivation.short ? mv(p.motivation.short, '150字版', 130, 160, p.motivation.short_tr) : ''}`;
    const used = r ? p.motivation.used.map((id) => r.facts.find((f) => f.id === id)).filter(Boolean) : [];
    if (used.length) s += `<div class="rs-used"><b>この志望動機で使った公開情報</b><ul>${used.map((f) => `<li>${h(f.text)}<div class="rs-src">${srcLink(f)}</div></li>`).join('')}</ul><div class="hint tiny">話す前に、リンク先で内容と日付が今も正しいか確かめてください。</div></div>`;
    if (p.flow.steps.length) s += `<h3>選考の流れ <span class="tag warn">${h(p.flow.note || '一般的な想定')}</span></h3><div class="flow">${p.flow.steps.map((x) => `<div><b>${h(x.name)}</b>${h(x.who)}<div style="color:var(--ink2)">${h(x.focus)}</div></div>`).join('')}</div>`;
    if (p.questions.length) s += `<h3>想定質問と回答例（${p.questions.length}問）</h3>${p.questions.map((q, i) => `<details ${i === 0 ? 'open' : ''}><summary>Q${i + 1}. <span data-noi18n>${h(q.q)}</span>${trl(q.q_tr, 'span')}</summary><div class="intent">意図：${h(q.intent)}</div><ul>${q.points.map((x) => `<li>${h(x)}</li>`).join('')}</ul>${mv(q.answer, '回答例', 150, 220, q.answer_tr)}${q.answer_easy ? `<details class="easy"><summary>やさしい日本語の版（自分の言葉で話す練習に）</summary>${hasRuby(q.answer_easy) ? `<label class="rubyopt"><input type="checkbox" data-act="ruby" ${ui.ruby === false ? '' : 'checked'}>読み仮名を表示</label>` : ''}<div data-noi18n class="easytx">${rubyFill(q.answer_easy)}</div></details>` : ''}</details>`).join('')}`;
    if (p.reverse.length) s += `<h3>逆質問</h3><ul>${p.reverse.map((x, i) => `<li><span data-noi18n>${h(x)}</span>${trl(p.reverse_tr && p.reverse_tr[i])}</li>`).join('')}</ul>`;
    if (p.cautions.length) s += `<h3>突っ込まれやすい点と対策</h3><ul>${p.cautions.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
  }
  return s + '</div>';
}
// phones: the A4 page is too small to read, so the text is shown as text first ("A4 で見る" shows the page)
const readOn = () => window.innerWidth < 720 && ui.read !== false;
function readHTML(c) {
  const d = c.doc; const bad = new Set(checkNumbers(docParts(d)).bad);
  const t = (x) => h(x).replace(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g, (n) => (bad.has(nd(n)) ? `<mark>${n}</mark>` : n));
  const ul = (a) => (a.length ? `<ul>${a.map((x) => `<li>${t(x)}</li>`).join('')}</ul>` : '');
  let s = `<div class="readv ${docLocked(c) ? 'nocopy' : ''}" data-noi18n><div class="rd-title">職務経歴書</div><div class="rd-meta">${h(d.date)}　${h(d.name)}</div>`;
  if (d.highlights.length) s += `<ul class="rd-hl">${d.highlights.map((x) => `<li><b>${t(x.value)}</b> ${t(x.label)}</li>`).join('')}</ul>`;
  s += `<h4>職務要約</h4><p>${t(d.summary)}</p><h4>職務経歴</h4>`;
  d.careers.forEach((cr) => {
    s += `<div class="rd-co"><div class="rd-co-h"><b>${h(cr.company)}</b><span>${h(cr.period)}</span></div>${cr.business || cr.meta ? `<div class="cc">${t([cr.business, cr.meta].filter(Boolean).join('　'))}</div>` : ''}`;
    cr.blocks.forEach((b) => { s += `<div class="rd-bl"><div class="rd-h">${t([b.period, b.heading].filter(Boolean).join('　'))}</div>${b.overview ? `<p>${t(b.overview)}</p>` : ''}${b.role || b.team ? `<div class="cc">${t([b.role, b.team].filter(Boolean).join('／'))}</div>` : ''}${ul(b.duties)}${b.achievements.length ? `<div class="rd-l">実績</div>${ul(b.achievements)}` : ''}</div>`; });
    s += '</div>';
  });
  if (d.skills.length) s += `<h4>活かせる経験・知識・技術</h4>${ul(d.skills)}`;
  if ((d.skillTable || []).length) s += `<h4>テクニカルスキル</h4>${ul(d.skillTable.map((r) => [r.name, r.years, r.level].filter(Boolean).join('　')))}`;
  if (d.tech.length) s += `<h4>スキル・ツール・語学</h4>${ul(d.tech)}`;
  if (d.qualifications.length) s += `<h4>資格・免許</h4>${ul(d.qualifications.map((q) => q.date + '　' + q.name))}`;
  if (d.pr.length) s += `<h4>自己PR</h4>${d.pr.map((p) => `<div class="rd-pr"><b>${t(p.heading)}</b><p>${t(p.body)}</p></div>`).join('')}`;
  return s + '</div><p class="hint tiny" style="margin:8px 4px 0">文字だけの表示です。提出する書類の見た目は「A4 で見る」で確かめてください。</p>';
}
// the English / Chinese page: each part of the document with its translation (from 「母語で確認する」)
function trReadHTML(c) {
  const x = c.explain;
  if (!x || !x.sections.length) return `<div class="readv"><p>まだ対訳がありません。「対訳と解説を作る」を押すと、書類の各部分の対訳と書き方の解説を作ります（利用枠は使いません）。</p><button class="btn primary" data-act="explain" ${c.exStatus === 'run' ? 'disabled' : ''}>対訳と解説を作る</button>${c.exStatus === 'run' ? `<div class="status">${spin}${stage('explain', c.exSince)}</div>` : ''}</div>`;
  return `<div class="trprint"><button class="btn small" data-act="printReview">確認用シートを印刷・PDF にする（日本語が母語の方に見てもらう用）</button></div><div class="readv trv ${docLocked(c) ? 'nocopy' : ''}">${x.sections.map((t) => `<div class="tr-r"><div class="rd-h" data-noi18n>${h(t.title)}</div><div class="ex-ja" data-noi18n>${h(t.ja)}</div><div class="ex-tr" lang="${x.lang === 'en' ? 'en' : 'zh'}">${h(t.tr)}</div></div>`).join('')}</div>`;
}
function drawPreview(c) {
  const box = $('#preview'); if (!box || !F.ready || !c.doc) return;
  if (readOn()) { box.innerHTML = UI_LANG !== 'ja' && ui.readTr !== false ? trReadHTML(c) : readHTML(c); box.classList.add('reading'); return; }
  if (box.classList.contains('reading')) { box.classList.remove('reading'); box.innerHTML = ''; }
  const lay = E.layout(c.doc, c.theme, F.meas, opt(c));
  const marks = checkNumbers(docParts(c.doc)).bad;
  const cssW = Math.min(Math.max(box.clientWidth - 36, 280), 740);
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cvs = [...box.querySelectorAll('canvas')];
  box.querySelectorAll('.empty').forEach((e) => e.remove());
  lay.pages.forEach((pg, i) => {
    let cv = cvs[i];
    if (!cv) { cv = document.createElement('canvas'); box.appendChild(cv); }
    cv.width = Math.round(cssW * dpr); cv.height = Math.round(cssW * E.PAGE_H / E.PAGE_W * dpr); cv.style.width = cssW + 'px';
    E.renderCanvas(cv.getContext('2d'), pg, cv.width / E.PAGE_W, F.meas, F.fam, marks);
  });
  cvs.slice(lay.pages.length).forEach((cv) => cv.remove());
}
function drawThumbs(c) {
  if (!F.ready) return;
  document.querySelectorAll('canvas[data-thumb]').forEach((cv) => {
    const k = cv.dataset.thumb;
    const lay = E.layout(c.doc, k, F.meas, opt(c));
    E.renderCanvas(cv.getContext('2d'), lay.pages[0], cv.width / E.PAGE_W, F.meas, F.fam);
  });
}

// ---------------- step 4 ----------------
function render4() {
  // every 応募先 with an analysis or a document is tracked (tracking is free); the interview prep uses the
  // company's 1社分 when it is first made
  const list = state.companies.filter((c) => !c.general && (c.doc || c.analysis || (c.stages || []).some(hasLog)));
  if (!list.length) { $('#v4').innerHTML = viewHead('選考管理', '応募先ごとの選考ステップと日程を管理し、面接の記録から次の面接の対策を作ります。') + '<div class="card empty">ステップ2で応募先の求人票を分析すると、ここで選考を管理できます（無料）。ほかの会社向けの書類で応募した会社も、求人票を分析しておけば、面接が決まったときに面接対策を作れます。</div>'; return; }
  list.forEach(ensureStages); save();
  if (!company(state.active4) || !list.includes(company(state.active4))) state.active4 = list[0].id;
  const c = company(state.active4);
  const active = list.filter((x) => x.result === '選考中').length;
  const ups = list.flatMap((x) => x.stages.filter((s) => s.status === '予定' && s.date && daysFrom(s.date) >= 0).map((s) => ({ c: x, s }))).sort((a, b) => (a.s.date + a.s.time).localeCompare(b.s.date + b.s.time));
  const passed = list.reduce((n, x) => n + x.stages.filter((s) => s.status === '通過' && !/書類|document|screening|简历|筛选/i.test(s.name)).length, 0);
  const offers = list.filter((x) => x.result === '内定').length;
  $('#v4').innerHTML = viewHead('選考管理', '応募先ごとの選考ステップと日程を一覧にし、面接の記録から次の面接の対策を作ります。') + `
  ${ups.length || passed || offers || list.some((x) => (x.stages || []).some((s) => s.status !== '未定')) ? `<div class="kpis">
    <div class="kpi"><div class="n">${active}</div><div class="l">選考中の応募先</div></div>
    <div class="kpi"><div class="n">${ups.length}</div><div class="l">これからの面接</div></div>
    <div class="kpi"><div class="n">${passed}</div><div class="l">通過した面接</div></div>
    <div class="kpi"><div class="n">${offers}</div><div class="l">内定</div></div>
  </div>` : '<div class="card first4"><b>書類を出したら、ここで選考を記録しましょう。</b><div class="hint" style="margin:0">ステップごとに日程と結果を入れておくと、面接の前日までに「次の面接の対策」を作れます。面接で聞かれたことを3行メモするだけで、次の対策が具体的になります。</div></div>'}
  <div class="g4">
    <div class="card"><h2>応募先ごとの進み具合</h2>
      <table class="board"><thead><tr><th>応募先</th><th>進み具合</th><th>現在のステップ</th><th>次の予定</th><th>結果</th></tr></thead><tbody>
      ${list.map((x) => { const i = curStage(x); const ne = nextEvent(x); return `<tr class="${x.id === c.id ? 'on' : ''}" data-act="sel4" data-id="${x.id}">
        <td><b>${h(cname(x))}</b><div class="cc">${h(x.priority)}</div></td>
        <td><div class="mini">${x.stages.map((s) => `<i class="${s.status === '通過' ? 'p' : s.status === '予定' ? 's' : (s.status === '不通過' || s.status === '辞退') ? 'f' : ''}" title="${h(s.name + '：' + s.status)}"></i>`).join('')}</div></td>
        <td>${i >= 0 ? h(x.stages[i].name) + ` <span class="pill ${x.stages[i].status === '予定' ? 'run' : x.stages[i].status === '不通過' ? 'err' : ''}">${h(x.stages[i].status)}</span>` : '<span class="pill ok">全ステップ通過</span>'}</td>
        <td>${ne ? `${h(jpDate(ne.date))} ${h(ne.time)}` : '<span class="cc">—</span>'}</td>
        <td><span class="pill ${x.result === '内定' ? 'ok' : x.result === '見送り' ? 'err' : x.result === '辞退' ? 'warn' : ''}">${h(x.result)}</span></td></tr>`; }).join('')}
      </tbody></table>
      <div class="bcards">${list.map((x) => { const i = curStage(x); const ne = nextEvent(x); return `<button class="bcard ${x.id === c.id ? 'on' : ''}" data-act="sel4" data-id="${x.id}"><b>${h(cname(x))}</b><span class="pill ${x.result === '内定' ? 'ok' : x.result === '見送り' ? 'err' : ''}">${h(x.result)}</span><div class="mini">${x.stages.map((s) => `<i class="${s.status === '通過' ? 'p' : s.status === '予定' ? 's' : (s.status === '不通過' || s.status === '辞退') ? 'f' : ''}"></i>`).join('')}</div><span class="cc">${i >= 0 ? `<span>${h(x.stages[i].name)}</span>・<span>${h(x.stages[i].status)}</span>` : '全ステップ通過'}${ne ? `　<span>次：</span>${h(jpDate(ne.date) + ' ' + ne.time)}` : ''}</span></button>`; }).join('')}</div>
    </div>
    <div class="card"><h2>これからの予定</h2>
      ${ups.length ? `<div class="sched">${ups.slice(0, 8).map(({ c: x, s }) => { const d = new Date(s.date + 'T00:00:00'); const dd = daysFrom(s.date); return `<div class="it ${dd <= 3 ? 'soon' : ''}" data-act="sel4" data-id="${x.id}"><div class="dt"><b>${d.getDate()}</b><small data-noi18n>${monthWd(d)}</small></div><div><b style="font-size:13px">${h(cname(x))}</b><div class="cc"><span>${h(s.name)}</span>${s.time ? SEP + h(s.time) : ''}${s.format ? `${SEP}<span>${h(s.format)}</span>` : ''}${dd === 0 ? `${SEP}<span>今日</span>` : dd === 1 ? `${SEP}<span>明日</span>` : dd > 0 ? `${SEP}<span>あと${dd}日</span>` : ''}</div></div></div>`; }).join('')}</div>` : '<div class="empty" style="padding:18px">日程が入った面接はまだありません。</div>'}
    </div>
  </div>
  <div class="card" style="margin-top:16px">${stagesHTML(c)}</div>`;
}
// a step was passed and the next one has no preparation yet: the moment to prepare (and, for a preview, to use the 1社分)
function nextPrepHTML(c, ci) {
  const st = c.stages || []; const s = st[ci];
  if (!s || ci < 1 || s.prep || s.prepStatus === 'run' || c.result !== '選考中' && c.result) return '';
  if (['不通過', '辞退'].includes(s.status)) return '';
  return `<div class="fb note nextprep"><span><b>「${h(st[ci - 1].name)}」を通過しました。</b>${s.date ? `「${h(s.name)}」は${h(s.date.slice(5).replace('-', '/'))}です。` : ''}次の「${h(s.name)}」の対策を作りましょう。これまでの記録と提出した書類から、聞かれそうな質問と答え直し方をまとめます。${locked(c) ? '（この会社で1社分を使います）' : ''}</span><button class="btn primary small" data-act="prep" data-sid="${s.id}">対策を作る</button></div>`;
}
function stagesHTML(c) {
  const ci = curStage(c);
  return `<div class="row" style="margin:0"><div><h2>${h(cname(c))} の選考</h2>${c.analysis && c.analysis.position ? `<div class="cc">${h(c.analysis.position)}</div>` : ''}<p class="hint" style="margin:2px 0 0">面接が終わったら、聞かれたことと詰まったことを残してください。次のステップの対策に使います。</p></div><span class="spacer"></span>
    <label style="margin:0">結果</label><select data-c4="result" style="width:auto">${['選考中', '内定', '見送り', '辞退'].map((o) => `<option value="${o}" ${c.result === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
  ${nextPrepHTML(c, ci)}
  ${locked(c) && !c.pack ? tasteHTML(c, 's4') : ''}
  <div class="stages">${c.stages.map((s, i) => {
    const prevLogged = c.stages.slice(0, i).some(hasLog);
    const canPrep = i > 0 && (prevLogged || c.doc) && s.status !== '通過' && s.status !== '不通過' && s.status !== '辞退';
    return `<div class="stage ${i === ci ? 'cur' : ''}" data-sid="${s.id}">
      <div class="top">
        <input type="text" class="nm" data-sf="name" value="${h(s.name)}" aria-label="ステップ名">
        <select data-sf="status" aria-label="状態">${ST.map((o) => `<option value="${o}" ${s.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <input type="date" data-sf="date" value="${h(s.date)}" aria-label="日付">
        <input type="time" data-sf="time" value="${h(s.time)}" aria-label="時間">
        <select data-sf="format" aria-label="形式"><option value="">形式</option>${['オンライン', '対面', '電話', 'その他'].map((o) => `<option value="${o}" ${s.format === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <input type="text" data-sf="who" value="${h(s.who)}" placeholder="面接官（例：部門長）" aria-label="面接官">
        <button class="btn ghost small" data-act="delStage" data-sid="${s.id}" aria-label="このステップを削除">削除</button>
      </div>
      ${true ? `<details ${hasLog(s) || s.status === '不通過' || (i > 0 && s.status === '通過') ? 'open' : ''}><summary>${i === 0 ? '選考のメモ・フィードバック' : '面接の記録'}${hasLog(s) ? '<span>（記入済み）</span>' : ''}</summary><div class="log">
        ${(i === 0 && !/面接|面談/.test(s.name) ? [['vibe', '企業・エージェントからのフィードバック（見送りの理由など）', 3], ['bad', '書類で気になっている点', 3]] : [['asked', '聞かれた質問（1行に1問）', 4], ['bad', '詰まったこと・反省点', 4], ['good', 'うまく話せたこと', 3], ['vibe', '面接官の反応・雰囲気', 3], ['reverse', '逆質問で聞いたこと・分かったこと', 3]]).map(([k, l, r]) => `<div><label>${l}</label><textarea rows="${r}" data-lf="${k}">${h(s.log[k])}</textarea></div>`).join('')}
        ${i === 0 && s.status === '不通過' ? '<p class="hint tiny" style="margin:6px 0 0">見送りの理由が分かれば残してください。次の応募先のステップ2「見せ方への追加指示」に書くと、その会社の書類に反映できます。</p>' : ''}
      </div></details>` : ''}
      ${canPrep || s.prep ? `<div class="prep">
        <div class="row" style="margin:0"><b style="font-size:13px">「${h(s.name)}」の対策</b><span class="cc">${prevLogged ? 'これまでの面接記録をもとに作ります' : '書類と方針をもとに作ります（記録があると精度が上がります）'}</span><span class="spacer"></span>
          <button class="btn ${s.prep ? 'ghost' : 'primary'} small" data-act="prep" data-sid="${s.id}" ${s.prepStatus === 'run' ? 'disabled' : ''}>${s.prep ? '作り直す' : '対策を作る'}</button></div>
        ${s.prepStatus === 'run' ? `<div class="status">${spin}${stage('prep', s.since)} ${elapsed(s.since, '30〜60秒')} ${abortBtn('prep-' + s.id)}</div>` : ''}
        ${s.prepError ? `<div class="status err">${h(s.prepError)}</div>` : ''}
        ${s.prep ? prepHTML(s.prep, c) : ''}
      </div>` : ''}
    </div>`; }).join('')}</div>
  <div class="row"><button class="btn small" data-act="addStage">＋ ステップを追加</button></div>`;
}
function prepHTML(p, c) {
  let s = '';
  const pc = checkNumbers(prepParts(p), c ? c.job + '\n' + c.info + '\n' + researchText(c) : '');
  if (pc.bad.length) s += `<div class="fb warn" style="margin-top:10px">⚠ あなたの入力と求人票で確認できない数値：${pc.bad.map((n) => `<mark>${h(n)}</mark>`).map((x, i, a) => `<span class="nw">${x}${i < a.length - 1 ? '、' : ''}</span>`).join('')}</div>`;
  if (p.summary) s += `<div class="sum" style="margin-top:10px">${h(p.summary)}</div>`;
  if (p.focus.length) s += `<h3>見られそうな点</h3><div>${p.focus.map((x) => `<span class="tag">${h(x)}</span>`).join('')}</div>`;
  if (p.fixes.length) s += `<h3>前回の答え直し</h3>${p.fixes.map((f) => `<div class="fix"><b>${h(f.issue)}</b><span data-noi18n>${h(f.better)}</span>${trl(f.better_tr)}</div>`).join('')}`;
  if (p.questions.length) s += `<h3>深掘りされそうな質問</h3>${p.questions.map((q, i) => `<details ${i === 0 ? 'open' : ''}><summary><span data-noi18n>${h(q.q)}</span>${trl(q.q_tr, 'span')}</summary><div class="intent">予想の理由：${h(q.why)}</div><ul>${q.points.map((x) => `<li>${h(x)}</li>`).join('')}</ul></details>`).join('')}`;
  if (p.reverse.length) s += `<h3>逆質問</h3><ul>${p.reverse.map((x, i) => `<li><span data-noi18n>${h(x)}</span>${trl(p.reverse_tr && p.reverse_tr[i])}</li>`).join('')}</ul>`;
  if (p.checklist.length) s += `<h3>前日までにやること</h3><ul class="chk">${p.checklist.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
  return s;
}

// ---------------- demo ----------------
const docGuard = (e) => {
  const inDoc = e.target && e.target.closest && e.target.closest('#editor, .readv, .cmp');
  const c = inDoc && state && company(state.active);
  if (!c || !docLocked(c) || !acct.user) return;
  // a few words moved while editing are fine; taking the text out is what uses the credit
  const t = e.target; const sel = t && typeof t.selectionStart === 'number' ? String(t.value || '').slice(t.selectionStart, t.selectionEnd) : String(window.getSelection() || '');
  if (e.type !== 'dragstart' && sel.replace(/\s/g, '').length < 30) return;
  e.preventDefault();
  toast('この会社の書類のコピーは、保存と同じく1社分を使います');
  if (e.type !== 'dragstart') ensureUnlocked(c);
};
['copy', 'cut', 'dragstart'].forEach((t) => document.addEventListener(t, docGuard));
// the document the user brought, next to the one made for this company (what changed, before deciding to pay)
function compareOld(c) {
  const d = c.doc; const a = c.analysis || {};
  const must = (a.requirements || []).filter((r) => r.type === '必須');
  const newText = [d.highlights.length ? '【実績】\n' + d.highlights.map((x) => x.value + '　' + x.label).join('\n') : '', '【職務要約】\n' + d.summary, d.pr.length ? '【自己PR】\n' + d.pr.map((p) => '■' + p.heading).join('\n') : ''].filter(Boolean).join('\n\n');
  openModal(`<h2 id="modalTitle">今までの書類と、この会社向けの書類</h2>
    ${must.length ? `<p class="hint">この求人の必須要件：${must.map((r) => `<span class="tag ${r.match === '△' ? 'warn' : 'gray'}">${h(r.match)} ${h(r.text)}</span>`).join(' ')}</p>` : ''}
    <div class="cmp"><div><h4>今までの書類（読み込んだ文章）</h4><pre data-noi18n>${h(oldText())}</pre></div><div><h4>この会社向けに作った書類（抜粋）</h4><pre data-noi18n class="${locked(c) ? 'nocopy' : ''}">${h(newText)}</pre></div></div>
    <p class="hint tiny">今までの書類は、あなたの端末で読み取った文章をそのまま表示しています（レイアウトは含みません）。</p>
    <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">閉じる</button></div>`);
}
// the examples (public/samples.js): the built-in one (DEMO) and others by kind of job change; on the English /
// Chinese page only those written for that page
function demoKinds() {
  const set = window.DEMO_SET || {};
  return [['', 'CS・リーダー候補']].concat(Object.keys(set).filter((k) => UI_LANG === 'ja' || (set[k].i18n && set[k].i18n[UI_LANG])).map((k) => [k, set[k].label]));
}
function demoState(kind) {
  const alt = kind && window.DEMO_SET && window.DEMO_SET[kind];
  const d = alt || window.DEMO; const st = fresh();
  st.demo = true; st.demoKind = alt ? kind : ''; st.name = d.name; st.raw = d.raw; st.profile = normProfile(d.profile); st.intent = Object.assign({}, d.intent || {});
  st.rireki = Object.assign(RK0(), (d.rireki || window.DEMO.rireki) || {});
  const co = newCompany({ name: d.jobName, job: d.job, info: d.companyInfo, analysis: normAnalysis(d.analysis), status: 'done', maxPages: (alt && d.maxPages) || 2, theme: (alt && d.theme) || 'premium', accent: 'navy', pack: normPack(d.pack), packStatus: 'done' });
  if (d.rk) co.rk = Object.assign({}, co.rk || {}, { motive: d.rk.motive || '', hope: d.rk.hope || '', status: '' });
  co.doc = Object.assign(E.normalizeDoc(d.doc), { date: today() + '現在', name: d.name });
  if (d.english) { co.en = E.normalizeEn(d.english); st.nameEn = co.en.name; st.nameEnGuess = !!d.english.name_guess; }
  if (d.research) { co.research = normResearch(d.research); co.analyzedAt = Date.now(); co.rsOpen = true; }
  const base = new Date();
  co.stages = (d.stages || [{ name: '書類選考', status: '通過', offset: -7 }, { name: '一次面接', status: '予定', offset: 5 }]).map((s) => { const dt = s.offset != null ? new Date(base.getTime() + s.offset * 864e5) : null; return newStage({ name: s.name, status: s.status, date: dt ? iso(dt) : '', time: s.time || '', format: s.format || '', who: s.who || '', log: Object.assign({ asked: '', good: '', bad: '', vibe: '', reverse: '' }, s.log || {}) }); });
  if (d.explain) { co.explain = Object.assign(normExplain(d.explain), { lang: 'zh' }); co.exStatus = 'done'; }
  const nx = co.stages.findIndex((s) => s.status === '予定'); if (nx >= 0 && d.prep) { co.stages[nx].prep = normPrep(d.prep); co.stages[nx].prepStatus = 'done'; }
  // the English / Chinese page: the sample as the AI writes it for that page (demo-i18n.js; samples.js for the others)
  const X = UI_LANG !== 'ja' && (alt ? d.i18n && d.i18n[UI_LANG] : window.DEMO_I18N && window.DEMO_I18N[UI_LANG]);
  if (X) {
    if (X.analysis) co.analysis = normAnalysis(X.analysis);
    if (X.missing) st.profile.missing = X.missing.map((m) => ({ q: Sx(m.q), why: Sx(m.why) }));
    if (X.profileTr) { st.profile.careers.forEach((c, i) => c.roles.forEach((r, j) => { r.tr = ((X.profileTr.roles || [])[i] || [])[j] || ''; })); st.profile.episodes.forEach((e) => { e.tr = (X.profileTr.episodes || {})[e.id] || ''; }); }
    if (X.pack) co.pack = normPack(X.pack);
    if (X.prep && nx >= 0) co.stages[nx].prep = normPrep(X.prep);
    if (X.explain) co.explain = Object.assign(normExplain(X.explain), { lang: UI_LANG });
    if (X.research) co.research = normResearch(X.research);
  }
  st.companies = [co]; st.active = co.id; st.active4 = co.id; st.step = 3;
  return st;
}

// ---------------- events ----------------
function setPath(obj, path, val) { const ks = path.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; }
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
const stageOf = (el) => { const c = company(state.active4); const card = el.closest('[data-sid]'); return c && card ? [c, c.stages.find((s) => s.id === card.dataset.sid)] : [c, null]; };
let edT;
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.intent) { state.intent[t.dataset.intent] = t.value; save(); return; }
  if (t.dataset.rk) { state.rireki[t.dataset.rk] = t.value; save(); clearTimeout(rkT); rkT = setTimeout(() => drawRireki(company(state.active)), 200); return; }
  if (t.dataset.enshared) { state[t.dataset.enshared] = t.value; if (t.dataset.enshared === 'nameEn') state.nameEnGuess = false; save(); clearTimeout(enT); enT = setTimeout(() => drawEnglish(company(state.active)), 200); return; }
  if (t.dataset.en) {
    const c = company(state.active); if (!c || !c.en) return;
    const L = t.value.split('\n').map((x) => x.trim()).filter(Boolean); const bar = (x) => x.split(/[｜|]/).map((y) => y.trim());
    const v = t.dataset.list === '1' ? L
      : t.dataset.list === 'sk' ? L.map((x) => { const m = /^([^:：]{1,40})[:：]\s*(.*)$/.exec(x); return m ? { cat: m[1].trim(), items: m[2].split(/\s*[,、]\s*/).filter(Boolean) } : { cat: '', items: x.split(/\s*[,、]\s*/).filter(Boolean) }; })
      : t.dataset.list === 'ce' ? L.map((x) => { const m = bar(x); return { name: m[0], date: m[1] || '' }; })
      : t.dataset.list === 'la' ? L.map((x) => { const m = bar(x); return { lang: m[0], level: m[1] || '' }; })
      : t.value;
    setPath(c.en, t.dataset.en, v); save();
    clearTimeout(enT); enT = setTimeout(() => drawEnglish(c), 200); return;
  }
  if (t.dataset.crk) { const c = company(state.active); c.rk[t.dataset.crk] = t.value; save(); const cc = t.previousElementSibling && t.previousElementSibling.querySelector('.cc'); if (cc) cc.textContent = len(t.value) + '字'; clearTimeout(rkT); rkT = setTimeout(() => drawRireki(c), 200); return; }
  if (t.dataset.bind) { state[t.dataset.bind] = t.value; if (t.dataset.bind === 'name') { const was = $('.namehint'); if (was) was.remove(); t.insertAdjacentHTML('afterend', nameHint()); } if (t.dataset.bind === 'raw') { const rc = $('#rawCount'); if (rc) rc.textContent = len(t.value) + '字'; } save(); return; }
  if (t.dataset.answer !== undefined) { state.answers = state.answers || {}; state.answers[t.dataset.answer] = t.value; save(); return; }
  if (t.dataset.cf) { const c = company(t.closest('[data-cid]').dataset.cid); c[t.dataset.cf] = t.value; save(); return; }
  if (t.dataset.sf && t.tagName !== 'SELECT') { const [, s] = stageOf(t); if (s) { s[t.dataset.sf] = t.value; save(); } return; }
  if (t.dataset.lf) { const [, s] = stageOf(t); if (s) { s.log[t.dataset.lf] = t.value; save(); } return; }
  if (t.dataset.ed) {
    const c = company(state.active); if (!c || !c.doc) return;
    let v = t.value;
    const lines = () => v.split('\n').map((x) => x.trim()).filter(Boolean);
    if (t.dataset.list === '1') v = lines();
    else if (t.dataset.list === 'q') v = lines().map((x) => { const m = x.split(/[｜|]/); return m.length > 1 ? { date: m[0].trim(), name: m.slice(1).join('｜').trim() } : { date: '', name: x }; });
    else if (t.dataset.list === 'hl') v = lines().map((x) => { const m = x.split(/[｜|]/); return { value: m[0].trim(), label: m.slice(1).join('｜').trim() }; });
    else if (t.dataset.list === 'st') v = lines().map((x) => { const m = x.split(/[｜|]/).map((y) => y.trim()); return m.length > 1 ? { cat: m[0], name: m[1], years: m[2] || '', level: m.slice(3).join('｜') } : { cat: '', name: m[0], years: '', level: '' }; });
    setPath(c.doc, t.dataset.ed, v); c.dirty = true;
    const cc = t.previousElementSibling && t.previousElementSibling.querySelector('.cc'); if (cc && !t.dataset.list) cc.textContent = len(t.value) + '字';
    save();
    clearTimeout(edT); edT = setTimeout(() => { drawPreview(c); const fb = $('#fitbar'); if (fb) fb.innerHTML = fitbarHTML(c); }, 180);
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.tagName === 'SELECT' && t.dataset.cf) { const c = company(t.closest('[data-cid]').dataset.cid); c[t.dataset.cf] = t.value; save(); }
  if (t.dataset.sf && (t.tagName === 'SELECT' || t.type === 'date' || t.type === 'time')) {
    const [c, s] = stageOf(t);
    if (s) {
      s[t.dataset.sf] = t.value;
      // a step that ends the process sets the company's result; undoing it puts the company back in 選考中
      if (t.dataset.sf === 'status' && c) {
        const end = c.stages.find((x) => x.status === '不通過' || x.status === '辞退');
        if (end && (!c.result || c.result === '選考中')) c.result = end.status === '不通過' ? '見送り' : '辞退';
        else if (!end && (c.result === '見送り' || c.result === '辞退')) c.result = '選考中';
      }
      save(); render();
    }
  }
  if (t.dataset.wt !== undefined) { state.wordTarget = t.value; save(); toast({ windows: 'Word は Windows で開く前提の書体で作ります', mac: 'Word は Mac で開く前提の書体で作ります', google: 'Word は Google ドキュメントで開く前提の書体で作ります' }[t.value] || ''); return; }
  if (t.dataset.c4) { const c = company(state.active4); c[t.dataset.c4] = t.value; save(); render(); }
  if (t.id === 'importFile' && t.files && t.files[0]) { importData(t.files[0]); t.value = ''; }
  if (t.id === 'resumeFile' && t.files && t.files[0]) { importResume(t.files[0]); t.value = ''; }
  if (t.id === 'rkPhoto' && t.files && t.files[0]) { loadPhoto(t.files[0]); t.value = ''; }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  // (the free look asked for inside the purchase sheet does not replace the save that opened the sheet)
  if (RESUMABLE.has(b.dataset.act) && !(b.dataset.act === 'taste' && b.closest('#modal'))) { lastAct = Object.assign({}, b.dataset); delete lastAct.confirm; delete lastAct.orig; }
  else if (!b.closest('#modal')) lastAct = null;
  lastFocus = `[data-act="${CSS.escape(b.dataset.act)}"]` + (b.dataset.id ? `[data-id="${CSS.escape(b.dataset.id)}"]` : '');
  const act = b.dataset.act; const c = b.dataset.id ? company(b.dataset.id) : company(state.step === 4 ? state.active4 : state.active);
  switch (act) {
    case 'step': state.step = +b.dataset.step; save(); render(); window.scrollTo(0, 0); break;
    case 'extract': extractProfile(); break;
    case 'sampleRaw': state.raw = DEMO.raw; if (!state.name) state.name = DEMO.name; save(); render(); break;
    case 'ruby': ui.ruby = !!b.checked; render(); break;
    case 'printReview': if (c && c.explain) (docsFree() ? Promise.resolve(true) : ensureUnlocked(c)).then((ok) => { if (ok) printSheet(`${state.name || ''}　職務経歴書 確認用シート`, reviewSheetHTML(c)); }); break;
    case 'printPack': { const el = $('.card.pack'); if (c && c.pack && el) printSheet(`${cname(c)}　面接準備シート`, el.innerHTML); break; }
    case 'qaForm': openModal(qaFormHTML()); setTimeout(() => { const t = $('#qa-co'); if (t) t.focus(); }, 50); break;
    case 'qaAdd': qaAdd(!!b.dataset.more); break;
    case 'taste': { const x = company(b.dataset.id); if (x && x.tasteStatus !== 'run') makeTaste(x); break; }
    case 'packFor': { const x = company(b.dataset.id); if (!x) break; state.active = x.id; if (x.doc) { state.step = 3; x.tab = 'pack'; save(); render(); makePack(x); } else { toast('先に、この会社の書類を作成してください（ステップ2）'); state.step = 2; save(); render(); } break; }
    case 'anon': { const x = company(b.dataset.id); if (x) { x.anon = !!b.checked; save(); render(); } break; }
    case 'addGeneral': { if (state.companies.some((x) => x.general)) break; const nc = newCompany({ general: true, priority: '併願' }); state.companies.unshift(nc); save(); render(); setTimeout(() => { const t = document.querySelector(`[data-cid="${nc.id}"] [data-cf=target]`); if (t) t.focus(); }, 50); break; }
    case 'addCompany': { const empty = state.companies.find((x) => !x.general && !x.sample && !x.job.trim() && !x.name.trim() && !x.analysis); const nc = empty || newCompany(); if (!empty) state.companies.unshift(nc); save(); render(); setTimeout(() => { const t = document.querySelector(`[data-cid="${nc.id}"] [data-cf=job]`); if (t) { t.scrollIntoView({ block: 'center' }); t.focus(); } }, 30); break; }
    case 'sampleJob': state.companies.unshift(newCompany({ name: DEMO.jobName, job: DEMO.job, info: DEMO.companyInfo, sample: true })); save(); render(); break;
    case 'delCompany': if (c && !BUSY.includes(c.status) && confirm2(b, '本当に削除（もう一度押す）')) { state.companies = state.companies.filter((x) => x !== c); save(); render(); toast('削除しました'); } break;
    case 'analyze': if (c) analyze(c); break;
    case 'fetchJob': if (!c) break; if (isPaid() && c.job.trim() && (c.jobUrl || '').trim() && !confirm2(b, '貼り付けた本文を置き換えます（もう一度押す）')) break; fetchJobUrl(c); break;
    case 'research': if (c) makeResearch(c); break;
    case 'researchBack': if (c && c.researchPrev) { const x = c.research; c.research = c.researchPrev; c.researchPrev = x; save(); render(); } break;
    case 'researchExample': researchExample(); break;
    case 'useTwin': { const t = c && researchTwin(c); if (t) { c.research = Object.assign({}, t.research); c.rsOpen = true; save(); render(); toast('調査結果を使いました（検索はしていません）'); } break; }
    case 'reflect': if (c) { state.active = c.id; state.step = 3; c.tab = 'pack'; save(); render(); window.scrollTo(0, 0); makePack(c); } break;
    case 'analyzeAll': (async () => { const qs = state.companies.filter((x) => x.job.trim() && !x.analysis && !BUSY.includes(x.status)); if (!(await readyFor(qs))) return; state.companies.forEach((x) => { x.batch = qs.includes(x); }); qs.forEach((x) => { x.status = 'queued'; }); render(); pool(qs, 2, (x) => (x.status === 'queued' ? analyze(x) : null)); })(); break;
    case 'generate': if (c) { if (c.doc && c.dirty && !confirm2(b, '手で直した箇所も作り直されます（もう一度押す）')) break; state.active = c.id; state.step = 3; save(); generate(c); window.scrollTo(0, 0); } break;
    case 'generateAll': (async () => { const qs = state.companies.filter((x) => x.analysis && !x.doc && x.status === 'analyzed'); if (qs.length && (await readyFor(qs)) && qs.length) { state.companies.forEach((x) => { x.batch = qs.includes(x); }); qs.forEach((x) => { x.status = 'queued'; }); state.active = qs[0].id; state.step = 3; render(); pool(qs, 2, (x) => (x.status === 'queued' ? generate(x) : null)); } })(); break;
    case 'abortAll': Object.values(controllers).forEach((ctl) => ctl.abort()); state.companies.forEach((x) => { if (x.status === 'queued') x.status = x.doc ? 'done' : x.analysis ? 'analyzed' : 'idle'; }); render(); break;
    case 'tab': c.tab = b.dataset.v; c.edit = false; render(); window.scrollTo(0, 0);
      // from the "next" card: the prep starts at once when this company's credit is already used
      if (b.dataset.go && c.tab === 'pack' && !c.pack && !locked(c) && c.packStatus !== 'run') makePack(c);
      break;
    case 'undo': if (c && c.history && c.history.length) { c.doc = c.history.pop(); c.dirty = true; save(); render(); toast('1つ前の版に戻しました'); } break;
    case 'exportData': exportData(); break;
    case 'nextCompany': state.step = 2; save(); render(); window.scrollTo(0, 0); $('[data-act=addCompany]').click(); break;
    case 'exToggle': ui.exOpen = !b.parentElement.open; break;
    case 'toResult': { const r = $('#result'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
    case 'rkEra': state.rireki.era = b.dataset.v; save(); render(); break;
    case 'hopeFill': { const c2 = company(state.active); if (c2 && hopeDraft()) { c2.rk.hope = hopeDraft(); save(); render(); } break; }
    case 'rkGen': if (confirm2(b, '今の内容を置き換えます（もう一度押す）')) { state.rireki[b.dataset.v] = b.dataset.v === 'history' ? genHistory() : genLicenses(); save(); render(); } break;
    case 'rkPhotoDel': state.rireki.photo = ''; save(); render(); break;
    case 'rkMotive': if (c && c.general) { toast('志望動機は応募先ごとに作ります。応募先を追加してください'); break; } if (c) makeRkMotive(c); break;
    case 'rkPdf': if (c) { if (/【要記入/.test(c.rk.motive) && !confirm2(b, '【要記入】が残っています。もう一度押すと保存', 15000)) break; downloadRireki(c); } break;
    case 'exLang': state.explainLang = b.dataset.v; save(); render(); break;
    case 'explain': if (c && c.doc) makeExplain(c); break;
    case 'exApply': { const n = c.explain && c.explain.naturalness[+b.dataset.i]; if (!n) break; pushHistory(c); if (replaceInDoc(c.doc, n.ja, n.suggestion)) { n.applied = true; c.dirty = true; save(); render(); toast('反映しました（「1つ前の版に戻す」で取り消せます）'); } else { c.history.pop(); toast('原文が見つかりませんでした。「文章を直す」から直接修正してください'); } break; }
    case 'importData': $('#importFile').click(); break;
    case 'pickResume': $('#resumeFile').click(); break;
    case 'open': if (c) { state.active = c.id; state.step = 3; save(); render(); window.scrollTo(0, 0); } break;
    case 'theme': c.theme = b.dataset.v; save(); render(); break;
    case 'accent': c.accent = b.dataset.v; save(); render(); break;
    case 'pages': c.maxPages = +b.dataset.v; save(); render(); break;
    case 'refit': if (c.dirty && !confirm2(b, '手で直した箇所も詰められます（もう一度押す）')) break; refit(c); break;
    case 'edit': c.edit = !c.edit; render(); break;
    case 'pdf': case 'docx': { if (c.doc && c.doc.name) c.doc.name = E.fixChars(c.doc.name, window.CHARFIX || {}); const bad = checkNumbers(docParts(c.doc)).bad.length; if (bad && !confirm2(b, `未確認の数値が${bad}件あります。もう一度押すと保存`, 15000)) break; (docsFree() ? Promise.resolve(true) : ensureUnlocked(c)).then((ok) => { if (ok) download(c, act); }); break; }
    case 'pack': makePack(c); break;
    case 'english': makeEnglish(c); break;
    case 'enPdf': case 'enDocx': { const bad = checkNumbers(enParts(E.normalizeEn(enDoc(c)))).bad.length; if (bad && !confirm2(b, `未確認の数値が${bad}件あります。もう一度押すと保存`, 15000)) break; ensureUnlocked(c).then((ok) => { if (ok) downloadEnglish(c, act === 'enPdf' ? 'pdf' : 'docx'); }); break; }
    case 'toStages': state.active4 = c.id; state.step = 4; save(); render(); window.scrollTo(0, 0); break;
    case 'copyNow': { const ta = $('#copyBox'); if (!ta) break; const t = ta.value; ta.focus(); ta.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (e) { /* next */ }
      (ok ? Promise.resolve() : navigator.clipboard.writeText(t)).then(() => { closeModal(true); toast('コピーしました'); }).catch(() => toast('コピーできませんでした。テキストを選択してコピーしてください')); break; }
    case 'copyText': { const t = b.dataset.text; (c && state.step >= 3 && !docsFree() ? ensureUnlocked(c) : Promise.resolve(true)).then((ok) => { if (ok) copy(t); }); break; }
    case 'copyPart': { const t = partText(c.doc || {}, b.dataset.part); if (!t) break; (docsFree() ? Promise.resolve(true) : ensureUnlocked(c)).then((ok) => { if (ok) copy(t); }); break; }
    case 'copyField': { const v = getPath(c.doc, b.dataset.path); (docsFree() ? Promise.resolve(true) : ensureUnlocked(c)).then((ok) => { if (ok) copy(Array.isArray(v) ? v.map((p) => (p.heading ? '【' + p.heading + '】\n' : '') + p.body).join('\n\n') : v); }); break; }
    case 'unlockOk': closeModal(true); break;
    case 'mask': state.mask = state.mask === false; save(); render(); toast(state.mask ? '顧客名などを伏せて作ります（「AI で作り直す」で反映）' : '顧客名などをそのまま書きます（「AI で作り直す」で反映）'); break;
    case 'readMode': ui.read = b.dataset.v !== 'a4'; ui.readTr = b.dataset.v === 'tr' ? true : b.dataset.v === 'read' ? false : ui.readTr; render(); break;
    case 'compareOld': if (c && c.doc) compareOld(c); break;
    case 'fixName': state.name = E.fixChars(state.name, window.CHARFIX || {}); save(); render(); break;
    case 'refund': {
      if (!confirm2(b, 'もう一度押すと返金します')) break;
      b.disabled = true;
      api('POST', '/api/refund', { session: b.dataset.session }).then(async () => { await refreshMe(); closeModal(true); render(); showNotice('返金しました。カード会社などからの返金の反映には、数日から数週間かかることがあります。'); })
        .catch(async (e) => { await refreshMe().catch(() => {}); b.disabled = false; toast(e && e.code === 'not_refundable' ? 'この購入は返金できません（購入後に利用枠を使ったか、期限を過ぎています）' : '自動で返金できませんでした。運営者に連絡しましたので、お待ちください'); });
      break;
    }
    case 'plan': ui.plan = b.dataset.v; { const [r, k, x] = ui.buyArgs || ['', '']; openBuy(r, k, x); } break;
    case 'toSave': { const el = $('.ctrl'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); break; }
    case 'abort': { const ctl = controllers[b.dataset.key]; if (ctl) ctl.abort(); break; }
    case 'sel4': state.active4 = b.dataset.id; save(); render(); break;
    case 'addStage': { const x = company(state.active4); x.stages.push(newStage({ name: (UI_LANG === 'en' ? 'Step ' : UI_LANG === 'zh' ? '步骤 ' : 'ステップ') + (x.stages.length + 1) })); save(); render(); break; }
    case 'delStage': { const x = company(state.active4); if (x.stages.length > 1 && confirm2(b, '削除する？')) { x.stages = x.stages.filter((s) => s.id !== b.dataset.sid); save(); render(); } break; }
    case 'prep': { const x = company(state.active4); const i = x.stages.findIndex((s) => s.id === b.dataset.sid); if (i >= 0) makePrep(x, i); break; }
    case 'demo': if (!state.demo) userState = state; ui.lp = false; state = demoState(b.dataset.v || ''); render(); window.scrollTo(0, 0); break;
    case 'startOwn': case 'startFree': { const own = state.demo ? userState : state; state = own && !own.demo ? own : fresh(); userState = null; ui.lp = false; if (!hasOwnData(state)) state.step = 1; save(); render(); window.scrollTo(0, 0); if (state.step === 1) setTimeout(() => { const el = $('#in-raw'); if (el) el.focus(); }, 50); break; }
    case 'reset': if (confirm2(b, 'もう一度押すと消去')) { state = fresh(); userState = null; save(); render(); toast('入力データを消去しました'); } break;
    case 'login': openLogin(); break;
    case 'devLogin': { const v = ($('#devName').value || '').replace(/[^\w-]/g, '').slice(0, 30); if (!v) break; localStorage.setItem('resume-dev-user', v); closeModal(true); onUserChange({ id: 'dev_' + v, name: v }); break; }
    case 'devLogout': localStorage.removeItem('resume-dev-user'); onUserChange(null); break;
    case 'closeModal': closeModal(false); break;
    case 'consentOk': b.disabled = true; api('POST', '/api/consent', { version: CFG.consent }).then(() => { acct.me.consent = true; closeModal(true); acct.dirty = acct.dirty || hasOwnData(state); syncUI(); schedulePush(200); }).catch(() => { b.disabled = false; toast('送信できませんでした。もう一度お試しください'); }); break;
    case 'openBuy': openBuy('', b.dataset.why); break;
    case 'toPrice': if (!ui.lp || state.demo) { e.preventDefault(); openBuy(''); } break;
    case 'buy': buy(b.dataset.pack, b); break;
    case 'hideNotice': hideNotice(); break;
    case 'useSaved': try { localStorage.removeItem(GUEST); } catch (er) { /* ignore */ } ui.guest = null; closeModal(true); break;
    case 'useGuest': { const g = ui.guest; ui.guest = null; try { localStorage.removeItem(GUEST); } catch (er) { /* ignore */ } closeModal(true); if (g) { state = migrate(Object.assign(fresh(), g)); save(); render(); toast('ログイン前の内容を使います'); } break; }
    case 'conflictLoad': api('GET', '/api/workspace').then((w) => { closeModal(true); adopt(w.data || fresh(), w.version); toast('最新の内容を読み込みました'); }).catch(() => toast('読み込めませんでした')); break;
    case 'conflictKeep': api('GET', '/api/workspace').then((w) => { closeModal(true); acct.base = w.version; acct.conflict = false; acct.dirty = true; push(); toast('この画面の内容で保存します'); }).catch(() => toast('保存できませんでした')); break;
    case 'delAccount': openModal(`<h2 id="modalTitle">アカウントを削除しますか？</h2><p>アカウントと、保存した経歴・応募先・書類・選考の記録をすべて削除します。<b>残っている利用枠（${acct.me ? acct.me.credits : 0}社分）も失われ、返金はできません。</b>この操作は取り消せません。</p><p class="hint">書類を残したい場合は、先に PDF・Word で保存するか「データを書き出す」を使ってください。</p><div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">やめる</button><button class="btn danger" data-act="delAccountOk">削除する</button></div>`); break;
    case 'delAccountOk': b.disabled = true; deleteAccount(); break;
  }
});
setInterval(() => {
  // while a dialog asks (consent, a credit, the purchase) nothing has started yet; the time counts from its answer
  const asking = !$('#modal').classList.contains('hidden');
  document.querySelectorAll('.elapsed[data-since]').forEach((el) => {
    if (asking) { el.textContent = '（確認をお待ちしています）'; return; }
    const from = Math.max(+el.dataset.since, ui.gateEnd || 0);
    el.textContent = `（${Math.max(0, Math.round((Date.now() - from) / 1000))}秒経過・目安${el.dataset.est}）`;
  });
  document.querySelectorAll('.stg[data-kind]').forEach((el) => { el.textContent = stageText(el.dataset.kind, +el.dataset.since); });
}, 1000);
document.addEventListener('dragover', (e) => { if (e.target.id === 'in-raw' && e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); e.target.classList.add('drop'); } });
document.addEventListener('dragleave', (e) => { if (e.target.id === 'in-raw') e.target.classList.remove('drop'); });
document.addEventListener('drop', (e) => { if (e.target.id === 'in-raw' && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); e.target.classList.remove('drop'); importResume(e.dataTransfer.files[0]); } });
let rsT; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (!state) return; const c = company(state.active); if (state.step === 3 && c) drawPreview(c); }, 200); });
// before a batch: signed in, consent given, and enough credits for the 応募先 that have none yet
async function readyFor(qs) {
  if (state.demo) { toast(errMsg({ code: 'demo' })); return false; }
  if (!acct.user) { savePending(); openLogin(); return false; }
  try { if (!acct.me) await refreshMe(); } catch (e) { toast(errMsg(e)); return false; }
  if (!acct.me.consent && !(await askConsent())) return false;
  // documents for 応募先 that are not previews yet: within the free previews (accounts that have never bought)
  const fresh = qs.filter((x) => x.analysis && locked(x) && !acct.me.previews.has(x.id));
  const left = previewsLeft();
  if (fresh.length > left) {
    if (!left) { openBuy('', 'preview'); return false; }
    // the first ones that fit are made; the others stay as they are
    fresh.slice(left).forEach((x) => { qs.splice(qs.indexOf(x), 1); });
    showNotice(`購入前に無料で作成できる応募先は、あと${left}社です。先に${left}社を作ります。残りの${fresh.length - left}社は、利用枠を追加すると作れます。`);
  }
  const toRead = qs.filter((x) => !x.analysis).length;
  if (acct.me.free && toRead > acct.me.free.analyze) { openBuy(`無料で分析できる求人票は、あと${acct.me.free.analyze}件です。`); return false; }
  return true;
}
function renderPrices() {
  const el = $('#price .prices'); const packs = CFG.packs || []; if (!el || !packs.length) return;
  el.innerHTML = `<div class="pc m-a"><span>最初の${CFG.free || 1}社</span><b>無料</b><small>職務経歴書・履歴書・面接準備まで</small></div><div class="pc m-b"><span>職務経歴書・履歴書</span><b>無料</b><small>2社まで作成・保存。面接準備は1問お試し</small></div>` + packs.map((p) => `<div class="pc ${p.rec ? 'rec' : ''}">${p.rec ? '<span class="badge">おすすめ</span>' : ''}<span>${h(p.label)}${p.credits === 1 ? '<em class="pc-for">面接が決まった1社の対策に</em>' : ''}</span><b>${p.price.toLocaleString('ja-JP')}円</b><small>1社あたり${Math.round(p.price / p.credits).toLocaleString('ja-JP')}円</small><small class="plus">＋ 会社の公開情報の調査・採用ページ URL の読み込み</small></div>`).join('');
}
async function boot() {
  renderPrices();
  // what this browser has, shown at once; the account's copy replaces it once sign-in is known
  state = readLocal(GUEST) || fresh(); migrate(state); ui.lp = !hasOwnData(state);
  render();
  await initAuth(); acct.ready = true;
  if (acct.user) await loadAccount();
  acctUI(); render();
  if (acct.user && !new URLSearchParams(location.search).get('paid')) afterSignIn();   // e.g. back from Google sign-in
  if (!sessionStorage.getItem('resume-visit')) { sessionStorage.setItem('resume-visit', '1'); beacon('visit'); }
  paidReturn();
}
// local development and the preview only: lets the browser tests put data in (window.__test.set((state) => …))
if (CFG.dev) window.__test = { state: () => state, set: (fn) => { fn(state); render(); }, me: () => acct.me, partText, genHistory, company };
boot();
})();
