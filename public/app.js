(function () {
'use strict';
const E = window.ResumeEngine;
const $ = (s, r = document) => r.querySelector(s);
const h = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uid = () => { const a = new Uint8Array(8); crypto.getRandomValues(a); return [...a].map((x) => (x % 36).toString(36)).join(''); };
const len = (s) => [...String(s || '')].length;
const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => iso(new Date());
const today = () => { const d = new Date(); return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`; };
const WD = '日月火水木金土';
const jpDate = (s) => { if (!s) return ''; const d = new Date(s + 'T00:00:00'); return `${d.getMonth() + 1}/${d.getDate()}（${WD[d.getDay()]}）`; };
const daysFrom = (s) => Math.round((new Date(s + 'T00:00:00') - new Date(todayIso() + 'T00:00:00')) / 864e5);

// ---------------- state ----------------
const RK0 = () => ({ furigana: '', birth: '', gender: '', addrKana: '', zip: '', addr: '', tel: '', email: '', addr2Kana: '', zip2: '', addr2: '', tel2: '', email2: '', photo: '', era: 'west', history: '', licenses: '' });
const fresh = () => ({ step: 1, name: '', raw: '', answers: {}, intent: { reason: '', axis: '', conditions: '' }, rireki: RK0(), explainLang: 'zh', profile: null, profileStatus: '', companies: [], active: null, active4: null });
let state = null;
let userState = null; // the user's own data, kept aside while the sample is shown
const TRANSIENT = { analyzing: 'idle', generating: 'analyzed', fitting: 'analyzed', queued: 'idle' };
function migrate(st) {
  st.profileStatus = '';
  st.intent = Object.assign({ reason: '', axis: '', conditions: '' }, st.intent || {});
  st.rireki = Object.assign(RK0(), st.rireki || {});
  if (!st.explainLang) st.explainLang = 'zh';
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
    c.batch = false;
  });
  return st;
}
function confirm2(b, msg) {
  if (b.dataset.confirm === '1') { b.dataset.confirm = ''; return true; }
  const orig = b.textContent; b.dataset.confirm = '1'; b.textContent = msg;
  setTimeout(() => { if (b.isConnected && b.dataset.confirm === '1') { b.dataset.confirm = ''; b.textContent = orig; } }, 3500);
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
  el.textContent = !state || state.demo ? '' : !acct.user ? 'ログインすると保存されます'
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
    const r = await fetch(path, { method, headers: Object.assign({ authorization: await token() }, data ? { 'content-type': 'application/json' } : {}), body: data ? JSON.stringify(data) : undefined, signal });
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
  acct.me = { credits: m.credits, slots: new Set(m.slots), consent: m.consent };
  acctUI(); return acct.me;
}
const hasSlot = (c) => !!(acct.me && acct.me.slots.has(c.id));

const controllers = {};
const ctxPay = () => ({ name: state.name, raw: state.raw, answers: state.answers, intent: state.intent, profile: state.profile, explainLang: state.explainLang });
const cPay = (c) => ({ id: c.id, name: c.name, job: c.job, info: c.info, priority: c.priority, memo: c.memo, analysis: c.analysis, doc: c.doc, maxPages: c.maxPages,
  pack: c.pack ? { motivation: c.pack.motivation } : null, stages: (c.stages || []).map((s) => ({ name: s.name, status: s.status, date: s.date, format: s.format, who: s.who, log: s.log })) });
// one AI step on the server: task is profile / analyze / generate / shorten / pack / prep / rk / explain
async function ask(task, extra, key) {
  if (state.demo) throw { code: 'demo' };
  if (!acct.user) { openLogin(); throw { code: 'login' }; }
  if (!acct.me) await refreshMe();
  if (!acct.me.consent && !(await askConsent())) throw { code: 'consent_declined' };
  const c = extra && extra.c;
  if (c && !hasSlot(c) && acct.me.credits <= 0) { openBuy('この応募先の書類を作るには、利用枠が1社分必要です。'); throw { code: 'no_credit' }; }
  const ctl = new AbortController(); controllers[key] = ctl;
  try {
    const j = await api('POST', '/api/ai', Object.assign({ task, ctx: ctxPay() }, extra, c ? { c: cPay(c) } : {}), ctl.signal);
    if (typeof j.credits === 'number') acct.me.credits = j.credits;
    if (c) acct.me.slots.add(c.id);
    acctUI();
    return j.result;
  } catch (e) {
    const b = e.body || {};
    if (typeof b.credits === 'number' && acct.me) { acct.me.credits = b.credits; acctUI(); }
    if (e.code === 'no_credit') { acct.me.credits = 0; acctUI(); openBuy('利用枠がなくなりました。'); }
    if (e.code === 'consent') acct.me.consent = false;
    if (e.code === 'login') openLogin();
    throw e;
  } finally { if (controllers[key] === ctl) delete controllers[key]; }
}
function errMsg(e) {
  const c = e && e.code;
  const scope = e && e.scope;
  const m = {
    login: 'ログインすると、AI で書類を作れます。ログイン後にもう一度押してください。',
    consent: '利用規約とデータの取り扱いへの同意が必要です。もう一度押してください。',
    consent_declined: '同意いただけなかったため、AI は使っていません。',
    no_credit: '利用枠が足りません。利用枠を追加すると続けられます。',
    demo: 'サンプルでは AI は動きません。「自分の経歴で始める」から始めてください。',
    limit: scope === 'service' ? '本日はご利用が集中しているため、AI を一時的に止めています。明日以降にお試しください。'
      : scope === 'slot' ? 'この応募先で AI を使える回数の上限に達しました。お問い合わせください。'
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
  }[c];
  return m || ('エラーが発生しました（' + (c || (e && e.message) || 'unknown') + '）。もう一度お試しください。');
}
async function pool(items, n, fn) {
  const q = items.slice(); const run = async () => { while (q.length) { const it = q.shift(); try { await fn(it); } catch (e) { /* handled in fn */ } } };
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, run));
}
function beacon(e) { try { navigator.sendBeacon('/api/event', new Blob([JSON.stringify({ e })], { type: 'application/json' })); } catch (er) { /* not counted */ } }
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
    await window.Clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor }, localization: window.CLERK_JA, appearance: APPEARANCE, afterSignOutUrl: '/' });
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
  // signing out: this account's copy leaves the browser (kept only if it has changes the server lacks)
  if (prev && !user && !acct.dirty) [lsKey(), lsKey() + ':meta', lsKey() + ':backup'].forEach((k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } });
  acct.user = user; acct.me = null; acct.base = 0; acct.dirty = false; acct.conflict = false;
  if (user) { await loadAccount(); toast('ログインしました'); } else { state = readLocal(GUEST) || fresh(); migrate(state); ui.lp = !hasOwnData(state); }
  acctUI(); render();
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
    if (state === guest) try { localStorage.removeItem(GUEST); } catch (e) { /* ignore */ }
  }
  migrate(state); ui.lp = false; writeLocal();
  if (acct.dirty) schedulePush(300);
}
function guestChoice(guest) {
  openModal(`<h2 id="modalTitle">ログイン前に入力した内容があります</h2>
    <p>この端末でログインする前に入力した内容と、アカウントに保存されている内容があります。どちらを使いますか？</p>
    <div class="row"><button class="btn" data-act="useSaved">アカウントの内容を使う</button><button class="btn primary" data-act="useGuest">ログイン前の内容を使う</button></div>
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
  const f = $('#sheet').querySelector('input,button.primary'); if (f) setTimeout(() => f.focus(), 30);
}
function closeModal(v) { $('#modal').classList.add('hidden'); document.body.classList.remove('noscroll'); modalLock = false; if (modalResolve) { const r = modalResolve; modalResolve = null; r(v); } }
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !modalLock) closeModal(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden') && !modalLock) closeModal(false); });
function askConsent() {
  return new Promise((ok) => {
    modalResolve = ok;
    openModal(`<h2 id="modalTitle">AI を使う前にご確認ください</h2>
      <ul class="consent">
        <li>入力した経歴・求人票・面接の記録などは、書類と面接対策を作るために、<b>Anthropic, PBC（米国）</b>の AI サービス「Claude」に送信されます。Anthropic の利用規約により、送信した内容が AI の学習に使われることはありません。</li>
        <li>入力内容と作った書類は、続きから使えるようにアカウントに保存されます（保存先：Cloudflare, Inc.、ログイン：Clerk, Inc.、いずれも米国の事業者）。保存したデータはいつでも削除でき、最後に使ってから${keepFor()}たつと自動で削除されます。</li>
        <li>AI の出力には誤りが含まれることがあります。提出する前に、内容が事実どおりかを必ずご自身で確認してください。</li>
      </ul>
      <p class="hint">外国にある第三者への提供と各国の個人情報保護制度については<a href="${h(CFG.privacy)}" target="_blank" rel="noopener">プライバシーポリシー</a>に記載しています。</p>
      <label class="check"><input type="checkbox" id="agree"> <span><a href="${h(CFG.terms)}" target="_blank" rel="noopener">利用規約</a>と<a href="${h(CFG.privacy)}" target="_blank" rel="noopener">プライバシーポリシー</a>に同意し、上記のとおり入力内容を送信・保存することに同意します</span></label>
      <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">同意しない</button><button class="btn primary" data-act="consentOk">同意して続ける</button></div>`);
  });
}
function openBuy(reason) {
  const packs = CFG.packs || [];
  const left = acct.me ? acct.me.credits : null;
  openModal(`<h2 id="modalTitle">利用枠を追加する</h2>
    ${reason ? `<p class="status warn">${h(reason)}</p>` : ''}
    ${left != null ? `<p>いまの残り：<b>${left}社分</b></p>` : ''}
    <div class="packs">${packs.map((p) => `<button class="pack" data-act="buy" data-pack="${h(p.id)}"><span class="pl">${h(p.label)}</span><b>${p.price.toLocaleString('ja-JP')}円</b><small>税込・1社あたり${Math.round(p.price / p.credits).toLocaleString('ja-JP')}円</small></button>`).join('')}</div>
    <p class="hint">1社分 = 1つの応募先。その応募先の職務経歴書・履歴書・志望動機・面接準備は、何度作り直しても追加料金はかかりません。応募先を削除しても利用枠は戻りません。お支払いは Stripe の決済画面で行います。</p>
    <p class="hint"><a href="${h(CFG.terms)}" target="_blank" rel="noopener">利用規約</a>　<a href="https://www.flatland.co.jp/legal/tokushoho/" target="_blank" rel="noopener">特定商取引法に基づく表示</a></p>
    <div class="row"><span class="spacer"></span><button class="btn" data-act="closeModal">閉じる</button></div>`);
}
async function buy(pack, btn) {
  if (!acct.user) { closeModal(false); openLogin(); return; }
  btn.disabled = true; btn.classList.add('wait');
  try {
    await push();
    const r = await api('POST', '/api/checkout', { pack });
    if (r.url) { location.href = r.url; return; }
    // added without a payment page (the preview)
    closeModal(true); await refreshMe(); render(); toast(`利用枠を追加しました（残り${acct.me.credits}社分）`);
  } catch (e) { btn.disabled = false; btn.classList.remove('wait'); toast(e.code === 'not_configured' ? '決済の準備がまだ整っていません' : '決済画面を開けませんでした。もう一度お試しください'); }
}
// back from Stripe: /?paid=<session> (or cancel)
async function paidReturn() {
  const q = new URLSearchParams(location.search); const s = q.get('paid'); if (!s) return;
  q.delete('paid'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  if (s === 'cancel') { toast('購入を取りやめました'); return; }
  if (!acct.user) return;
  const before = acct.me ? acct.me.credits : 0;
  showNotice('お支払いを確認しています…');
  if (!CFG.dev) try { await api('POST', '/api/checkout/confirm', { session: s }); } catch (e) { /* the webhook adds it */ }
  for (let i = 0; i < 8; i++) {
    try { await refreshMe(); } catch (e) { /* retry */ }
    if (acct.me && acct.me.credits > before) break;
    await new Promise((ok) => setTimeout(ok, 2500));
  }
  hideNotice();
  if (acct.me && acct.me.credits > before) { toast(`利用枠を追加しました（残り${acct.me.credits}社分）`); render(); }
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
  const pill = `<button class="credit ${n === 0 ? 'zero' : ''}" data-act="openBuy" title="利用枠を追加">${n == null ? '…' : `残り <b>${n}</b><span class="unit">社分</span>`}<span class="plus">＋</span></button>`;
  if (CFG.dev) { el.innerHTML = pill + `<button class="btn ghost small" data-act="devLogout">${h(acct.user.id)}（ログアウト）</button>`; return; }
  if (!el.querySelector('#userBtn')) { el.innerHTML = '<span id="pill"></span><div id="userBtn"></div>'; try { window.Clerk.mountUserButton($('#userBtn')); } catch (e) { console.error(e); } }
  $('#pill').innerHTML = pill;
}

// ---------------- fonts ----------------
const F = { bytes: {}, fk: {}, fam: {}, meas: null, ready: false, err: null };
let fontsP = null;
const loadFonts = () => fontsP || (fontsP = (async () => {
  await Promise.all(['gothic-b', 'gothic-r', 'mincho-r'].map(async (k) => {
    const r = await fetch(E.FONT_FILES[k]);
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
      roles: A(c.roles).map((r) => ({ start: Sx(r.start), end: Sx(r.end), org: Sx(r.org), title: Sx(r.title), team: Sx(r.team), duties: A(r.duties).map(Sx), achievements: A(r.achievements).map(Sx) })) })),
    education: A(p.education).map((x) => ({ date: Sx(x.date), school: Sx(x.school), detail: Sx(x.detail) })).filter((x) => x.school),
    episodes: A(p.episodes).map((e, i) => ({ id: Sx(e.id) || 'E' + (i + 1), title: Sx(e.title), career_index: e.career_index, role: Sx(e.role), situation: Sx(e.situation), action: Sx(e.action), result: Sx(e.result), metrics: A(e.metrics).map(Sx).filter(Boolean), strengths: A(e.strengths).map(Sx).filter(Boolean) })),
    skills: { expertise: A(p.skills && p.skills.expertise).map(Sx), tools: A(p.skills && p.skills.tools).map(Sx), languages: A(p.skills && p.skills.languages).map(Sx) },
    qualifications: A(p.qualifications).map((q) => ({ date: Sx(q.date), name: Sx(q.name) })).filter((q) => q.name),
    missing: A(p.missing).map((m) => ({ q: Sx(m.q || m.question), why: Sx(m.why) })).filter((m) => m.q).slice(0, 5),
  };
}
function normAnalysis(a) {
  a = a || {};
  return { company: Sx(a.company), position: Sx(a.position), summary: Sx(a.summary),
    values: A(a.values).map((v) => ({ label: Sx(v.label), detail: Sx(v.detail), source: Sx(v.source), quote: Sx(v.quote) })),
    requirements: A(a.requirements).map((r) => ({ text: Sx(r.text), type: Sx(r.type), match: Sx(r.match), evidence: Sx(r.evidence) })),
    plan: A(a.plan).map((p) => ({ value: Sx(p.value), episode_ids: A(p.episode_ids).map(Sx), angle: Sx(p.angle) })),
    summary_angle: Sx(a.summary_angle), pr_themes: A(a.pr_themes).map(Sx), keywords: A(a.keywords).map(Sx), gaps: A(a.gaps).map(Sx),
    template: E.THEMES[a.template] ? a.template : 'modern', template_reason: Sx(a.template_reason) };
}
function normPack(p) {
  p = p || {}; const m = p.motivation || {};
  return { motivation: { long: Sx(m.long), short: Sx(m.short) },
    flow: { note: Sx(p.flow && p.flow.note), steps: A(p.flow && p.flow.steps).map((s) => ({ name: Sx(s.name), who: Sx(s.who), focus: Sx(s.focus) })) },
    questions: A(p.questions).map((q) => ({ q: Sx(q.q), intent: Sx(q.intent), points: A(q.points).map(Sx), answer: Sx(q.answer) })),
    reverse: A(p.reverse).map(Sx), cautions: A(p.cautions).map(Sx) };
}
function normPrep(p) {
  p = p || {};
  return { summary: Sx(p.summary), focus: A(p.focus).map(Sx), questions: A(p.questions).map((q) => ({ q: Sx(q.q), why: Sx(q.why), points: A(q.points).map(Sx) })),
    fixes: A(p.fixes).map((f) => ({ issue: Sx(f.issue), better: Sx(f.better) })), reverse: A(p.reverse).map(Sx), checklist: A(p.checklist).map(Sx) };
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
  d.name = state.name || (state.profile && state.profile.name) || '';
  return d;
}

// ---------------- checks ----------------
const nd = (s) => String(s).replace(/[０-９．]/g, (c) => (c === '．' ? '.' : String.fromCharCode(c.charCodeAt(0) - 0xfee0))).replace(/,(?=\d{3})/g, '');
// Numbers are checked against what the user typed (not against AI-structured data), with digit boundaries.
function userSource() { const it = state.intent || {}; return nd([state.raw, Object.values(state.answers || {}).join('\n'), it.reason, it.axis, it.conditions, ...(state.companies || []).flatMap((c) => (c.stages || []).map((s) => Object.values(s.log || {}).join('\n')))].join('\n')); }
function checkNumbers(parts) {
  const src = userSource(); const all = new Set(), bad = new Set();
  parts.forEach((t) => { (nd(t || '').match(/\d+(?:\.\d+)?/g) || []).forEach((n) => { all.add(n); const re = new RegExp('(^|[^0-9.])' + n.replace(/\./g, '\\.') + '(?![0-9]|\\.[0-9])'); if (!re.test(src)) bad.add(n); }); });
  return { checked: all.size, bad: [...bad] };
}
const docParts = (doc) => [doc.summary, ...(doc.highlights || []).flatMap((x) => [x.value, x.label]), ...doc.careers.flatMap((c) => [c.business, c.meta, ...c.blocks.flatMap((b) => [b.heading, ...b.duties, ...b.achievements])]), ...doc.skills, ...doc.tech, ...doc.pr.map((p) => p.heading + ' ' + p.body)];
const packParts = (p) => [p.motivation.long, p.motivation.short, ...p.questions.flatMap((q) => [q.answer, ...q.points])];
const prepParts = (p) => [p.summary, ...p.questions.flatMap((q) => q.points), ...p.fixes.map((f) => f.better)];
function futureDates(doc) {
  const now = new Date(); const cur = now.getFullYear() * 12 + now.getMonth() + 1; const out = [];
  [...doc.careers.flatMap((c) => [c.period, ...c.blocks.map((b) => b.period)]), ...doc.qualifications.map((q) => q.date)].forEach((p) => {
    (String(p).match(/(\d{4})年(\d{1,2})月/g) || []).forEach((m) => { const [, y, mo] = /(\d{4})年(\d{1,2})月/.exec(m); if (+y * 12 + +mo > cur) out.push(m); });
  });
  return [...new Set(out)];
}
const simplifiedIn = (doc) => { const map = window.CHARFIX || {}; return [...new Set([...JSON.stringify(doc)].filter((ch) => map[ch]))]; };

// ---------------- stages ----------------
const ST = ['未定', '予定', '通過', '不通過', '辞退'];
function ensureStages(c) {
  if (c.stages && c.stages.length) return c.stages;
  const names = c.pack && c.pack.flow.steps.length ? c.pack.flow.steps.map((s) => s.name).filter(Boolean) : ['書類選考', '一次面接', '二次面接', '最終面接'];
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
}
async function analyze(c) {
  if (!state.profile) { toast('先に「経歴」で経歴を整理してください'); return; }
  if (!c.job.trim()) { toast('求人票を貼り付けてください'); return; }
  c.status = 'analyzing'; c.error = ''; c.since = Date.now(); render();
  try {
    c.analysis = normAnalysis(await ask('analyze', { c }, 'an-' + c.id));
    if (!c.name && c.analysis.company) c.name = c.analysis.company;
    c.status = c.doc ? 'done' : 'analyzed';
  } catch (e) { c.status = c.doc ? 'done' : (c.analysis ? 'analyzed' : 'idle'); c.error = errMsg(e); }
  save(); render();
}
async function generate(c) {
  if (!c.analysis) { toast('先に方針を作成してください'); return; }
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
async function makePack(c) {
  c.packStatus = 'run'; c.packError = ''; c.packSince = Date.now(); render();
  try { c.pack = normPack(await ask('pack', { c }, 'pack-' + c.id)); c.packStatus = 'done'; }
  catch (e) { c.packStatus = c.pack ? 'done' : 'err'; c.packError = errMsg(e); }
  save(); render();
}
async function makePrep(c, i) {
  const s = c.stages[i];
  s.prepStatus = 'run'; s.prepError = ''; s.since = Date.now(); render();
  try { s.prep = normPrep(await ask('prep', { c, i }, 'prep-' + s.id)); s.prepStatus = 'done'; }
  catch (e) { s.prepStatus = s.prep ? 'done' : 'err'; s.prepError = errMsg(e); }
  save(); render();
}
function fname(c, ext) { const d = new Date(); return ('職務経歴書' + (state.name ? '_' + state.name.replace(/\s+/g, '') : '') + '_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.' + ext).replace(/[\\/:*?"<>|]/g, '_'); }
async function download(c, kind) {
  await loadFonts(); if (!F.ready) { toast('書体の読み込みに失敗しました。ページを再読み込みしてください'); return; }
  try {
    const data = kind === 'pdf'
      ? await E.renderPDF(E.layout(c.doc, c.theme, F.meas, opt(c)), F.bytes, PDFLib, fontkit, { title: '職務経歴書', author: state.name }, F.fk)
      : await E.buildDocx(c.doc, c.theme, JSZip, opt(c));
    await saveFile(fname(c, kind), data, MIME[kind]); beacon('download');
    toast('保存しました');
  } catch (e) { toast('保存に失敗しました'); console.error(e); }
}
// ---------------- 履歴書 ----------------
const ymJ = (s) => { const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(s || ''); return m ? m[1] + '年' + (m[2] ? +m[2] + '月' : '') : ''; };
function genHistory() {
  const p = state.profile || { careers: [], education: [] }; const L = ['学歴'];
  (p.education || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date))).forEach((e) => L.push(`${ymJ(e.date)}｜${e.school}${e.detail ? '　' + e.detail : ''}`));
  if (!(p.education || []).length) L.push('（例）2012年4月｜○○大学 ○○学部 入学', '（例）2016年3月｜○○大学 ○○学部 卒業');
  L.push('', '職歴');
  const cs = (p.careers || []).slice().reverse();
  cs.forEach((c) => {
    L.push(`${ymJ(c.start)}｜${c.company}　入社`);
    const r0 = c.roles[c.roles.length - 1]; if (r0 && r0.org) L.push(`｜　${r0.org}${r0.title ? '　' + r0.title : ''}`);
    if (c.end && c.end !== '現在') L.push(`${ymJ(c.end)}｜一身上の都合により退職`);
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
  return Object.assign({}, r, { date: todayIso(), name: state.name, history: parseLines(r.history), licenses: parseLines(r.licenses), motive: c.rk.motive, hope: c.rk.hope });
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
  try { const r = await ask('rk', { c }, 'rk-' + c.id); c.rk.motive = E.fixChars(Sx(r && r.motive), window.CHARFIX || {}); c.rk.status = ''; }
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
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('コピーしました'); } catch (e) { toast('コピーできませんでした。テキストを選択してコピーしてください'); } }

// ---------------- rendering helpers ----------------
function showNotice(t) { const n = $('#notice'); n.innerHTML = '<div>' + h(t) + '<button class="x" data-act="hideNotice" aria-label="閉じる">×</button></div>'; n.classList.remove('hidden'); }
function hideNotice() { $('#notice').classList.add('hidden'); }
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('on'), 2200); }
const spin = '<span class="spin"></span>';
const PILL = { idle: ['未分析', ''], queued: ['待機中', 'wait'], analyzing: ['分析中', 'run'], analyzed: ['方針OK', 'ok'], generating: ['作成中', 'run'], fitting: ['枚数を調整中', 'run'], done: ['書類完成', 'ok'] };
const BUSY = ['queued', 'analyzing', 'generating', 'fitting'];
const anyBusy = () => state.companies.some((c) => BUSY.includes(c.status));
const elapsed = (since, est) => (since ? `<span class="elapsed" data-since="${since}" data-est="${est}"></span>` : '');
const pill = (c) => { const p = PILL[c.status] || ['', '']; return `<span class="pill ${p[1]}">${p[1] === 'run' ? spin : ''}${p[0]}</span>`; };
const abortBtn = (key) => `<button class="btn small" data-act="abort" data-key="${key}">中止</button>`;
const cname = (c) => (c.analysis && c.analysis.company) || c.name || '（会社名未入力）';
function renderFoot() {
  const signed = !!acct.user;
  $('#foot').innerHTML = `<div class="foot-act">
      <button class="btn small" data-act="exportData">データを書き出す</button><button class="btn small" data-act="importData">データを読み込む</button>
      <button class="btn small ghost" data-act="reset">入力データを消去</button>
      ${signed ? '<button class="btn small ghost" data-act="delAccount">アカウントを削除</button>' : ''}</div>
    ${signed ? `入力した内容と書類はアカウントに保存され、ほかの端末でも続きから使えます。最後に使ってから${keepFor()}たつと自動で削除されます。`
      : 'ログインする前の入力内容は、このブラウザの中にだけ保存されます。ログインするとアカウントに保存されます。'}
    AI の処理には Anthropic 社（米国）の Claude を使っています。書類の書体：BIZ UDP明朝・BIZ UDPゴシック（SIL Open Font License）`;
}
function creditNote(c) {
  if (state.demo || hasSlot(c)) return '';
  if (!acct.user) return '<p class="hint credit-note">分析と書類の作成にはログインが必要です。最初の1社分は無料です。</p>';
  if (!acct.me) return '';
  const n = acct.me.credits;
  return n > 0 ? `<p class="hint credit-note">分析すると利用枠を1社分使います（残り${n}社分）。この応募先の書類・面接準備は、何度作り直しても追加料金はかかりません。</p>`
    : '<p class="hint credit-note warn">利用枠が残っていません。<button class="linkbtn" data-act="openBuy">利用枠を追加する</button></p>';
}
function viewHead(title, desc, right) { return `${demoBar()}<div class="vh"><div><div class="eyebrow">STEP ${state.step} / 4</div><h1>${title}</h1><p>${desc}</p></div><span class="spacer"></span>${right || ''}</div>`; }
function demoBar() {
  if (!state.demo) return '';
  return hasOwnData(userState)
    ? `<div class="demo-bar"><span>いま表示しているのは<b>サンプル</b>（架空の人物・企業）です。あなたのデータはそのまま残っています。サンプルでの操作は保存されません。</span><span class="spacer"></span><button class="btn primary small" data-act="startOwn">自分のデータに戻る</button></div>`
    : `<div class="demo-bar"><span>いま表示しているのは<b>サンプル</b>（架空の人物・企業）です。サンプルでの操作は保存されません。各ステップを見たあと、自分の経歴で始められます。</span><span class="spacer"></span><button class="btn primary small" data-act="startOwn">自分の経歴で始める</button></div>`;
}

function render() {
  const lp = ui.lp && !state.demo;
  $('#lp').classList.toggle('hidden', !lp); $('#app').classList.toggle('hidden', lp); $('#bar').classList.toggle('hidden', lp);
  if (lp) return;
  if (state.step >= 2) loadFonts();
  renderFoot(); syncUI();
  const n2 = state.companies.length, n3 = state.companies.filter((c) => c.doc).length, n4 = state.companies.filter((c) => c.stages && c.stages.length).length;
  const steps = [[1, '経歴', state.profile ? '' : ''], [2, '応募先と方針', n2 ? n2 + '社' : ''], [3, '書類', n3 ? n3 + '件' : ''], [4, '選考管理', n4 ? n4 + '社' : '']];
  const done = { 1: !!state.profile, 2: state.companies.some((c) => c.analysis), 3: n3 > 0, 4: false };
  $('#steps').innerHTML = steps.map(([i, t, b], k) => `${k ? '<span class="sep"></span>' : ''}<button data-act="step" data-step="${i}" class="${state.step === i ? 'on' : ''} ${done[i] && state.step !== i ? 'done' : ''}"><span class="num">${done[i] && state.step !== i ? '✓' : i}</span><span class="lbl">${t}</span>${b ? `<span class="cnt">${b}</span>` : ''}</button>`).join('');
  ['v1', 'v2', 'v3', 'v4'].forEach((id, i) => $('#' + id).classList.toggle('on', state.step === i + 1));
  if (state.step === 1) render1(); else if (state.step === 2) render2(); else if (state.step === 3) render3(); else render4();
}

// ---------------- step 1 ----------------
function render1() {
  const p = state.profile;
  const st = state.profileStatus === 'run' ? `<div class="status">${spin}経歴を整理しています… ${elapsed(state.since, '30〜60秒')} ${abortBtn('profile')}</div>`
    : state.profileStatus === 'err' ? `<div class="status err">${h(state.profileError)}</div>` : '';
  $('#v1').innerHTML = viewHead('経歴を一度だけ登録する', 'ここで整理した事実だけを材料に、応募先ごとの書類と面接対策を作ります。AI が数字や実績を書き足すことはありません。') + `
  <div class="howto">
    <div><b><i>1</i>経歴を登録</b>今の職務経歴書を貼るか、箇条書きで書くだけ。</div>
    <div><b><i>2</i>応募先を並べる</b>求人票から、重視点と「どの事例をどう見せるか」を出します。</div>
    <div><b><i>3</i>そのまま出せる書類</b>テンプレートに流し込み、A4 の枚数に自動で収めます。</div>
    <div><b><i>4</i>選考を管理</b>面接の記録から、次の面接の対策を作ります。</div>
  </div>
  <div class="g12">
    <div class="card">
      <h2>経歴を入力</h2>
      <p class="hint">今お持ちの職務経歴書をそのまま貼り付けるか、経歴を箇条書きで書いてください。日本語・中文・English どれでも大丈夫です。人数・金額・％・期間などの数字が多いほど、仕上がりが良くなります。</p>
      <p class="hint" lang="zh" style="background:var(--salt);border-radius:10px;padding:8px 12px">可以直接用中文填写经历。系统会生成日文的职务经历书和履历书；在第 3 步可以用「中文」对照确认内容，并查看日文写法的解说和不自然之处。</p>
      <label for="in-name">氏名（書類に記載されます）</label>
      <input type="text" id="in-name" data-bind="name" value="${h(state.name)}" placeholder="例：佐藤 健太">
      <label for="in-raw" style="display:flex;justify-content:space-between">経歴・現在の職務経歴書<span class="cc" id="rawCount">${len(state.raw)}字</span></label>
      <textarea id="in-raw" data-bind="raw" rows="18" placeholder="例）2016年4月 〇〇株式会社 入社。法人営業として既存顧客80社を担当…">${h(state.raw)}</textarea>
      <div class="row">
        <button class="btn primary" data-act="extract" ${state.profileStatus === 'run' ? 'disabled' : ''}>${p ? '経歴を整理し直す' : '経歴を整理する'}</button>
        <button class="btn ghost" data-act="sampleRaw">サンプルを入れる</button>
      </div>
      ${st}
      <h3 style="margin-top:22px">転職の軸（任意・おすすめ）</h3>
      <p class="hint">志望動機と面接対策の材料になります。空欄の場合、AI は動機を作らず【要記入】として残します。転職理由と希望条件は書類には書きません。</p>
      <label for="in-reason">転職理由（本音で大丈夫です）</label>
      <textarea id="in-reason" rows="2" data-intent="reason" placeholder="例：担当顧客の規模が小さく、より複雑な組織での活用推進に挑戦したい">${h(state.intent.reason)}</textarea>
      <label for="in-axis">次の仕事で実現したいこと</label>
      <textarea id="in-axis" rows="2" data-intent="axis" placeholder="例：CSの仕組みづくりをリードしたい／チームを率いたい">${h(state.intent.axis)}</textarea>
      <label for="in-cond">希望条件（年収・勤務地・入社可能時期など）</label>
      <textarea id="in-cond" rows="2" data-intent="conditions" placeholder="例：年収650万円以上、都内またはリモート、2027年2月以降に入社可能">${h(state.intent.conditions)}</textarea>
    </div>
    <div class="card">
      <h2>あなたの経歴データ</h2>
      <p class="hint">職歴・使える事例・スキルに分けて保存されます。応募先が何社あっても、ここは一度で済みます。</p>
      ${p ? profileHTML(p) : '<div class="empty">左で経歴を入力して「経歴を整理する」を押すと、ここに職歴・事例・スキルが整理されます。</div>'}
    </div>
  </div>`;
}
function ym(s) { const m = /^(\d{4})(?:-(\d{1,2}))?/.exec(s || ''); return m ? (m[1] + '年' + (m[2] ? +m[2] + '月' : '')) : (s || ''); }
function profileHTML(p) {
  const careers = p.careers.map((c) => `<div class="tl"><div class="co">${h(c.company)}<span class="per">${h(ym(c.start))}～${h(c.end === '現在' ? '現在' : ym(c.end))}</span></div>
    ${c.roles.map((r) => `<div class="role">${h([r.org, r.title, r.team].filter(Boolean).join('／'))}</div><ul>${r.duties.map((x) => `<li>${h(x)}</li>`).join('')}${r.achievements.map((x) => `<li class="ach">${h(x)}</li>`).join('')}</ul>`).join('')}</div>`).join('');
  const eps = p.episodes.map((e) => `<div><span class="id">${h(e.id)}${e.role ? '　' + h(e.role) : ''}</span><b>${h(e.title)}</b>${h(e.result || e.action)}<div>${e.strengths.map((s) => `<span class="tag">${h(s)}</span>`).join('')}</div></div>`).join('');
  const sk = [...p.skills.expertise, ...p.skills.tools, ...p.skills.languages].filter(Boolean).map((s) => `<span class="tag gray">${h(s)}</span>`).join('');
  const qs = p.missing.length ? `<h3>あると書類が強くなる情報（任意）</h3>${p.missing.map((m) => `<div class="q"><p>${h(m.q)} <small>${h(m.why)}</small></p><textarea rows="2" data-answer="${h(m.q)}" placeholder="分かる範囲で（空欄のままでもOK）">${h((state.answers || {})[m.q] || '')}</textarea></div>`).join('')}
    <div class="row"><button class="btn" data-act="extract">回答を反映して整理し直す</button></div>` : '';
  return `<h3>職歴</h3>${careers || '<div class="empty">職歴を読み取れませんでした</div>'}
    <h3>使える事例（${p.episodes.length}件）</h3><div class="eps">${eps}</div>
    ${sk ? `<h3>スキル・ツール・語学</h3><div>${sk}</div>` : ''}
    ${(p.education || []).length ? `<h3>学歴</h3><div style="font-size:13px">${p.education.map((x) => h(ym(x.date) + '　' + x.school + (x.detail ? '　' + x.detail : ''))).join('<br>')}</div>` : ''}
    ${p.qualifications.length ? `<h3>資格</h3><div style="font-size:13px">${p.qualifications.map((q) => h(ym(q.date) + '　' + q.name)).join('<br>')}</div>` : ''}
    ${qs}
    <div class="row"><span class="spacer"></span><button class="btn primary" data-act="step" data-step="2">次へ：応募先を追加 →</button></div>`;
}

// ---------------- step 2 ----------------
function render2() {
  const pending = state.companies.filter((c) => c.job.trim() && !c.analysis && c.status !== 'analyzing').length;
  const ready = state.companies.filter((c) => c.analysis && !c.doc && c.status === 'analyzed').length;
  $('#v2').innerHTML = viewHead('応募先と書類の方針', '求人票を貼ると、その会社が重視していることと、あなたのどの事例をどう見せるかを整理します。何社でもまとめて扱えます。',
    `<button class="btn" data-act="addCompany">＋ 応募先を追加</button><button class="btn ghost" data-act="sampleJob">サンプル求人を追加</button>`) + `
  ${!state.profile ? '<div class="card" style="margin-bottom:16px;background:var(--warn-soft);border-color:#f0d7a8;color:var(--warn)">先に「経歴」のステップで経歴を整理してください。</div>' : ''}
  ${pending || ready || anyBusy() ? `<div class="row" style="margin:0 0 14px">${batchProgress()}<span class="spacer"></span>
    ${anyBusy() ? '<button class="btn" data-act="abortAll">すべて中止</button>' : ''}
    ${pending ? `<button class="btn" data-act="analyzeAll">未分析の${pending}社をまとめて分析</button>` : ''}
    ${ready ? `<button class="btn primary" data-act="generateAll">方針OKの${ready}社をまとめて作成</button>` : ''}</div>` : ''}
  <div class="stack">${state.companies.length ? state.companies.map(companyHTML).join('') : '<div class="card empty">「＋ 応募先を追加」で、応募したい会社の求人票を貼り付けてください。</div>'}</div>`;
}
function batchProgress() {
  const inBatch = state.companies.filter((c) => c.batch);
  if (!inBatch.length) return '';
  const done = inBatch.filter((c) => !BUSY.includes(c.status)).length;
  return `<span class="pill run">${done < inBatch.length ? spin : ''}まとめて処理：${done}/${inBatch.length}社 完了</span>`;
}
function companyHTML(c) {
  const a = c.analysis;
  const busy = BUSY.includes(c.status);
  return `<div class="card" data-cid="${c.id}">
    <div class="chead">
      <input type="text" data-cf="name" value="${h(c.name)}" placeholder="会社名（空欄なら求人票から読み取ります）" aria-label="会社名">
      <select data-cf="priority" aria-label="優先度">${['本命', '併願'].map((o) => `<option ${c.priority === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
      ${pill(c)}
      <button class="btn ghost small" data-act="delCompany" data-id="${c.id}">削除</button>
    </div>
    <details ${a ? '' : 'open'}><summary>求人票・企業情報${a ? '（入力済み）' : ''}</summary>
      <label>求人票（全文を貼り付け）</label>
      <textarea rows="9" data-cf="job" placeholder="仕事内容・必須要件・歓迎要件・求める人物像などを含めて貼り付けてください">${h(c.job)}</textarea>
      <label>企業情報（任意・あると精度が上がります）</label>
      <textarea rows="4" data-cf="info" placeholder="企業理念・バリュー・トップメッセージ・中期経営計画の要点など">${h(c.info)}</textarea>
    </details>
    ${a ? analysisHTML(a) : ''}
    <label>方針への追加指示（任意）</label>
    <input type="text" data-cf="memo" value="${h(c.memo)}" placeholder="例：マネジメント経験をもっと前に出したい／英語力は控えめに">
    ${c.error ? `<div class="status err">${h(c.error)}</div>` : ''}
    ${c.status === 'analyzing' ? `<div class="status">${spin}求人票と企業情報を読んで方針を作っています… ${elapsed(c.since, '30〜60秒')} ${abortBtn('an-' + c.id)}</div>` : ''}
    ${c.status === 'queued' ? '<div class="status">待機中です。前の応募先が終わると自動で始まります。</div>' : ''}
    <div class="row">
      <button class="btn" data-act="analyze" data-id="${c.id}" ${busy ? 'disabled' : ''}>${a ? '方針を作り直す' : '分析して方針を作る'}</button>
      <span class="spacer"></span>
      ${c.doc ? `<button class="btn" data-act="generate" data-id="${c.id}" ${busy ? 'disabled' : ''}>この方針で作り直す</button><button class="btn primary" data-act="open" data-id="${c.id}">書類を見る →</button>`
        : `<button class="btn primary" data-act="generate" data-id="${c.id}" ${!a || busy ? 'disabled' : ''}>この方針で書類を作成 →</button>`}
    </div>
    ${creditNote(c)}
  </div>`;
}
function analysisHTML(a) {
  const ep = {}; ((state.profile && state.profile.episodes) || []).forEach((e) => { ep[e.id] = e.title; });
  const src = (s) => `<span class="tag ${s === '一般知識' ? 'warn' : 'gray'}">${h(s === '一般知識' ? 'AIの一般知識・要確認' : (s || '—'))}</span>`;
  const mc = { '◎': 'a', '○': 'b', '△': 'c' };
  return `<div class="an">
    <div class="box"><h4>この会社が重視していること</h4>${a.summary ? `<p style="margin:0 0 10px;font-size:12.5px">${h(a.summary)}</p>` : ''}
      ${a.values.map((v) => `<div class="val"><b>${h(v.label)}</b> ${src(v.source)}<div class="d">${h(v.detail)}</div>${v.quote ? `<div class="qt">「${h(v.quote)}」</div>` : ''}</div>`).join('')}</div>
    <div class="box"><h4>求人の要件とあなたの経歴</h4><div class="req">${a.requirements.map((r) => `<span class="m ${mc[r.match] || 'b'}">${h(r.match)}</span><div class="t">${h(r.text)} <span class="tag gray">${h(r.type)}</span><div class="ev">${h(r.evidence)}</div></div>`).join('')}</div></div>
  </div>
  <div class="plan"><h4>書類の方針：どの事例を、どう見せるか</h4>
    ${a.plan.map((p) => `<div class="it"><div class="v">${h(p.value)}</div><div>${p.episode_ids.map((id) => `<span class="tag">${h(id)} ${h(ep[id] || '')}</span>`).join('')}<div>${h(p.angle)}</div></div></div>`).join('')}
    ${a.summary_angle ? `<div class="it"><div class="v">職務要約</div><div>${h(a.summary_angle)}</div></div>` : ''}
    ${a.pr_themes.length ? `<div class="it"><div class="v">自己PRの軸</div><div>${a.pr_themes.map((t) => `<span class="tag">${h(t)}</span>`).join('')}</div></div>` : ''}
    <div class="it"><div class="v">おすすめデザイン</div><div><b>${h(E.THEMES[a.template].label)}</b>　${h(a.template_reason)}</div></div>
  </div>
  ${a.gaps.map((g) => `<p class="gap">⚠ ${h(g)}</p>`).join('')}`;
}

// ---------------- step 3 ----------------
function render3() {
  const list = state.companies.filter((c) => c.analysis || c.doc);
  if (!list.length) { $('#v3').innerHTML = viewHead('そのまま出せる書類', '方針ができた応募先の書類をここで作ります。') + '<div class="card empty">「応募先と方針」で方針を作ると、ここで書類を作成できます。<br><br><button class="btn" data-act="demo">サンプルを見る</button></div>'; return; }
  if (!company(state.active) || !list.includes(company(state.active))) state.active = (list.find((c) => c.doc) || list[0]).id;
  const c = company(state.active);
  const ready = state.companies.filter((x) => x.analysis && !x.doc && x.status === 'analyzed').length;
  $('#v3').innerHTML = viewHead('そのまま出せる書類', 'テンプレートに自動で流し込み、A4 の枚数に収めます。文字を直してもレイアウトは崩れません。', anyBusy() ? batchProgress() + '<button class="btn" data-act="abortAll">すべて中止</button>' : '') + `<div class="l3">
    <aside class="side">
      <div class="lab">応募先</div>
      ${list.map((x) => `<button class="co-it ${x.id === c.id ? 'on' : ''}" data-act="open" data-id="${x.id}"><b>${h(cname(x))}</b>${pill(x)} <span class="cc">${h(x.priority)}</span></button>`).join('')}
      ${ready ? `<button class="btn primary" style="width:100%" data-act="generateAll">未作成の${ready}社をまとめて作成</button>` : ''}
    </aside>
    <div class="stack">${docPaneHTML(c)}</div>
  </div>`;
  if (c.doc && (c.tab === 'doc' || !c.tab)) { drawPreview(c); drawThumbs(c); }
  if (c.doc && c.tab === 'rireki') drawRireki(c);
}
function docPaneHTML(c) {
  const a = c.analysis || {};
  if (!c.doc) {
    return `<div class="card"><h2>${h(cname(c))}</h2><div class="hint" style="margin:0">${h(a.position || '')}</div>
      ${c.status === 'generating' ? `<div class="empty">${spin}方針にもとづいて書類を書いています… ${elapsed(c.since, '1〜2分')}<br><br>${abortBtn('gen-' + c.id)}</div>` : c.status === 'queued' ? '<div class="empty">待機中です。前の応募先が終わると自動で始まります。</div>'
      : `<div class="empty">方針はできています。<br><br><button class="btn primary" data-act="generate" data-id="${c.id}">この方針で書類を作成</button></div>`}
      ${c.error ? `<div class="fb err">${h(c.error)}</div>` : ''}</div>`;
  }
  const rec = a.template;
  const tpls = Object.keys(E.THEMES).map((k) => `<button class="tpl ${c.theme === k ? 'on' : ''}" data-act="theme" data-v="${k}"><canvas data-thumb="${k}" width="168" height="238"></canvas><div><b>${E.THEMES[k].label}</b><span>${h(E.THEMES[k].note)}</span>${rec === k ? '<span class="rec">この応募先におすすめ</span>' : ''}</div></button>`).join('');
  const sw = E.THEMES[c.theme] && E.THEMES[c.theme].accentable ? `<div class="swatches">配色 ${E.ACCENTS.map((x) => `<button class="sw ${c.accent === x.key ? 'on' : ''}" style="background:${x.hex}" data-act="accent" data-v="${x.key}" title="${x.label}" aria-label="${x.label}"></button>`).join('')}</div>` : '';
  const tabs = `<div class="seg tabs"><button data-act="tab" data-v="doc" class="${c.tab === 'doc' || !c.tab ? 'on' : ''}">職務経歴書</button><button data-act="tab" data-v="rireki" class="${c.tab === 'rireki' ? 'on' : ''}">履歴書</button><button data-act="tab" data-v="pack" class="${c.tab === 'pack' ? 'on' : ''}">志望動機・面接準備${c.pack ? ' ✓' : ''}</button></div>`;
  const head = `<div class="row" style="margin:0;align-items:flex-start">
        <div style="min-width:0"><h2>${h(cname(c))}</h2><div class="hint" style="margin:0">${h(a.position || '')}</div></div>
        <span class="spacer"></span>${tabs}</div>`;
  if (c.tab === 'pack') return `<div class="card">${head}</div>${packHTML(c)}`;
  if (c.tab === 'rireki') return `<div class="card">${head}</div>${rirekiHTML(c)}`;
  return `<div class="card">
      ${head}
      <div class="tpls">${tpls}</div>${sw}
      <div class="row">
        <button class="btn primary" data-act="pdf">PDF をダウンロード</button>
        <button class="btn" data-act="docx">Word をダウンロード</button>
        <button class="btn" data-act="edit">${c.edit ? '編集を閉じる' : '文章を直す'}</button>
        <div class="seg">${[2, 3].map((n) => `<button data-act="pages" data-v="${n}" class="${c.maxPages === n ? 'on' : ''}">A4 ${n}枚</button>`).join('')}</div>
        <span class="spacer"></span>
        ${(c.history || []).length ? `<button class="btn ghost" data-act="undo">1つ前の版に戻す</button>` : ''}
        <button class="btn ghost" data-act="generate" data-id="${c.id}" ${BUSY.includes(c.status) ? 'disabled' : ''}>AI で作り直す</button>
      </div>
      <div class="fitbar" id="fitbar">${fitbarHTML(c)}</div>
    </div>
    ${explainHTML(c)}
    <div class="dbody ${c.edit ? 'edit' : ''}">
      ${c.edit ? `<div class="card editor" id="editor">${editorHTML(c.doc)}</div>` : ''}
      <div class="desk" id="preview">${F.ready ? '' : (F.err ? '<div class="empty">書体の読み込みに失敗しました。ページを再読み込みしてください。</div>' : `<div class="empty">${spin}書体を読み込んでいます…</div>`)}</div>
    </div>
    <div class="card" style="display:flex;align-items:center;gap:12px;flex-wrap:wrap"><div><b>志望動機・面接準備</b><div class="hint" style="margin:0">この書類と矛盾しない志望動機と想定問答を作ります。</div></div><span class="spacer"></span><button class="btn" data-act="tab" data-v="pack">${c.pack ? '作成済みを見る →' : '作成する →'}</button></div>`;
}
function explainHTML(c) {
  const x = c.explain;
  let s = `<div class="card explain"><div class="row" style="margin:0"><div><b>母語で内容と書き方を確認する</b><div class="hint" style="margin:0">日本語の原文と翻訳を並べ、書き方の理由と不自然な箇所を解説します。手で直した部分も確認できます。<span lang="zh">可用中文对照确认内容和日文写法。</span></div></div><span class="spacer"></span>
    <div class="seg">${['zh', 'en'].map((k) => `<button data-act="exLang" data-v="${k}" class="${state.explainLang === k ? 'on' : ''}">${k === 'zh' ? '中文' : 'English'}</button>`).join('')}</div>
    <button class="btn ${x ? 'ghost' : 'primary'}" data-act="explain" ${c.exStatus === 'run' ? 'disabled' : ''}>${x ? 'もう一度確認する' : '対照と解説を作る'}</button></div>`;
  if (c.exStatus === 'run') s += `<div class="status">${spin}翻訳と解説を作っています… ${elapsed(c.exSince, '1〜2分')} ${abortBtn('ex-' + c.id)}</div>`;
  if (c.exError) s += `<div class="status err">${h(c.exError)}</div>`;
  if (x) {
    if (x.overview) s += `<div class="ex-ov">${h(x.overview)}</div>`;
    if (x.naturalness.length) s += `<h3>日本語の自然さ（${x.naturalness.length}件）</h3>${x.naturalness.map((n, i) => `<div class="ex-n"><div><s>${h(n.ja)}</s> → <b>${h(n.suggestion)}</b><div class="cc">${h(n.issue)}</div></div><button class="btn small" data-act="exApply" data-i="${i}" ${n.applied ? 'disabled' : ''}>${n.applied ? '反映済み' : '反映する'}</button></div>`).join('')}`;
    else s += '<div class="fb ok" style="margin-top:10px">日本語として不自然な箇所は見つかりませんでした。</div>';
    if (x.sections.length) s += `<h3>原文と翻訳</h3><div class="ex-t">${x.sections.map((t) => `<div class="ex-r"><div class="ex-h">${h(t.title)}</div><div class="ex-ja">${h(t.ja)}</div><div class="ex-tr" lang="${x.lang === 'en' ? 'en' : 'zh'}">${h(t.tr)}${t.notes.length ? `<ul>${t.notes.map((n) => `<li>${h(n)}</li>`).join('')}</ul>` : ''}</div></div>`).join('')}</div>`;
    if (x.conventions.length) s += `<h3>日本の職務経歴書の書き方</h3><ul lang="${x.lang === 'en' ? 'en' : 'zh'}">${x.conventions.map((t) => `<li>${h(t)}</li>`).join('')}</ul>`;
  }
  return s + '</div>';
}
function rirekiHTML(c) {
  const r = state.rireki;
  if (!r.history) { r.history = genHistory(); save(); }
  if (!r.licenses) { r.licenses = genLicenses(); save(); }
  if (!c.rk.motive && c.pack && c.pack.motivation.short) c.rk.motive = c.pack.motivation.short;
  const f = (k, label, ph, type) => `<div><label for="rk-${k}">${label}</label><input type="${type || 'text'}" id="rk-${k}" data-rk="${k}" value="${h(r[k])}" placeholder="${h(ph || '')}"></div>`;
  const todo = /【要記入/.test(c.rk.motive);
  return `<div class="rk">
    <div class="stack">
      <div class="card"><h2>共通の情報</h2><p class="hint">すべての応募先で共通です。住所や電話番号などはこのブラウザ内にだけ保存し、AI には送りません。</p>
        <div class="g2f">${f('furigana', 'ふりがな', 'さとう けんた')}${f('birth', '生年月日', '', 'date')}</div>
        <div class="g2f">${f('gender', '性別（記入は任意です）', '')}<div><label>年の書き方</label><div class="seg">${[['west', '西暦'], ['jp', '和暦']].map(([k, l]) => `<button data-act="rkEra" data-v="${k}" class="${r.era === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
        <div class="g2f">${f('zip', '郵便番号', '140-0002')}${f('addrKana', '住所のふりがな', '')}</div>
        ${f('addr', '現住所', '東京都品川区…')}
        <div class="g2f">${f('tel', '電話', '090-0000-0000')}${f('email', 'E-mail', 'name@example.com')}</div>
        <details><summary>連絡先（現住所以外に連絡を希望する場合のみ）</summary><div class="g2f">${f('zip2', '郵便番号', '')}${f('addr2Kana', 'ふりがな', '')}</div>${f('addr2', '連絡先住所', '')}<div class="g2f">${f('tel2', '電話', '')}${f('email2', 'E-mail', '')}</div></details>
        <label>証明写真（縦4:横3。印刷して貼る場合は空欄でOK）</label>
        <div class="row" style="margin-top:4px">${r.photo ? `<img src="${r.photo}" alt="" class="rk-ph">` : ''}<label class="btn small" style="margin:0;color:var(--ink)">${r.photo ? '写真を変える' : '写真を選ぶ'}<input type="file" id="rkPhoto" accept="image/*" class="hidden"></label>${r.photo ? '<button class="btn ghost small" data-act="rkPhotoDel">写真を外す</button>' : ''}</div>
      </div>
      <div class="card"><h2>学歴・職歴</h2><p class="hint">1行に1項目、「2016年4月｜○○株式会社　入社」の形で書きます。「学歴」「職歴」「以上」だけの行は見出しとして配置されます。経歴データから自動で作っています。</p>
        <textarea rows="13" data-rk="history">${h(r.history)}</textarea>
        <div class="row"><button class="btn small" data-act="rkGen" data-v="history">経歴データから作り直す</button></div>
        <h3>免許・資格</h3><textarea rows="4" data-rk="licenses">${h(r.licenses)}</textarea>
        <div class="row"><button class="btn small" data-act="rkGen" data-v="licenses">経歴データから作り直す</button></div>
      </div>
      <div class="card"><h2>この応募先向け</h2>
        <label style="display:flex;justify-content:space-between">志望の動機・アピールポイント<span class="cc">${len(c.rk.motive)}字</span></label>
        <textarea rows="6" data-crk="motive">${h(c.rk.motive)}</textarea>
        ${todo ? '<div class="fb warn" style="margin-top:8px">【要記入】が残っています。あなたの言葉で埋めてから提出してください。</div>' : ''}
        <div class="row"><button class="btn small" data-act="rkMotive" ${c.rk.status === 'run' ? 'disabled' : ''}>${c.rk.motive ? 'AI で作り直す' : 'AI で作る'}</button>${c.rk.status === 'run' ? `<span class="status" style="margin:0">${spin}作っています… ${elapsed(c.rk.since, '20〜40秒')} ${abortBtn('rk-' + c.id)}</span>` : ''}</div>
        ${c.rk.error ? `<div class="status err">${h(c.rk.error)}</div>` : ''}
        <label>本人希望記入欄</label>
        <textarea rows="3" data-crk="hope">${h(c.rk.hope)}</textarea>
        <p class="hint" style="margin-top:6px">特に希望がなければ「貴社の規定に従います。」と書くのが一般的です。勤務地や職種に譲れない条件がある場合だけ書きます。</p>
      </div>
    </div>
    <div class="stack">
      <div class="card" style="padding:14px 18px"><div class="row" style="margin:0"><b>プレビュー（A4・2枚）</b><span class="spacer"></span><button class="btn primary" data-act="rkPdf">履歴書 PDF をダウンロード</button></div><div id="rkWarn" class="fitbar"></div></div>
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
    w.innerHTML = lay.warnings.map((t) => `<div class="fb warn">${h(t)}</div>`).join('') + (miss.length ? `<div class="fb note">未入力：${h(miss.join('、'))}</div>` : '<div class="fb ok">✓ 基本情報はそろっています。提出前に誤字と日付を確認してください。</div>');
  }
}
function fitbarHTML(c) {
  const out = [];
  if (c.status === 'generating' && c.doc) out.push(`<div class="fb run">${spin}作り直しています… ${elapsed(c.since, '1〜2分')} ${abortBtn('gen-' + c.id)}</div>`);
  if (c.status === 'fitting') out.push(`<div class="fb run">${spin}A4 ${c.maxPages}枚に収まるよう AI が文章を詰めています（${c.rounds}回目）… ${elapsed(c.since, '30〜60秒')} ${abortBtn('fit-' + c.id)}</div>`);
  if (c.error) out.push(`<div class="fb err">${h(c.error)}</div>`);
  if (!c.doc) return out.join('');
  if (F.ready && c.status !== 'fitting') {
    const rep = E.fitReport(E.layout(c.doc, c.theme, F.meas, opt(c)), c.maxPages); c.fit = rep;
    if (rep.ok) out.push(`<div class="fb ok">✓ A4 ${rep.pages}枚に収まっています${c.rounds ? `（AI が ${c.rounds}回 自動調整）` : ''}。</div>`);
    else out.push(`<div class="fb warn">${rep.reason === 'orphan' ? '最終ページに数行だけはみ出しています' : `A4 ${c.maxPages}枚を超えています（現在 ${rep.pages}枚）`}。あと約${rep.overChars}字減らすと収まります。<button class="btn small" data-act="refit">AI で ${c.maxPages}枚に収める</button></div>`);
    const miss = E.missingChars(c.doc, c.theme, F.meas);
    if (miss.length) out.push(`<div class="fb warn">書体にない文字があります：${h(miss.join(' '))}　→「文章を直す」で別の表記に置き換えてください。</div>`);
  }
  const nc = checkNumbers(docParts(c.doc));
  if (nc.bad.length) out.push(`<div class="fb warn">⚠ あなたの入力で確認できない数値が ${nc.bad.length}件 あります：${nc.bad.map((n) => `<mark>${h(n)}</mark>`).join('、')}　プレビューの黄色い箇所です。事実なら「経歴」に追記、違うなら「文章を直す」で修正してください。</div>`);
  else if (nc.checked) out.push(`<div class="fb ok">✓ 書類の数値 ${nc.checked}件は、すべてあなたの入力と一致しています。</div>`);
  const fut = futureDates(c.doc);
  if (fut.length) out.push(`<div class="fb warn">⚠ 作成日より後の日付があります：${h(fut.join('、'))}</div>`);
  const zh = simplifiedIn(c.doc);
  if (zh.length || (c.fixed || []).length) out.push(`<div class="fb warn">⚠ 中国語の表記が混ざっていた可能性があります（${h([...(c.fixed || []), ...zh].slice(0, 6).join('、'))}）。字体だけでなく、文として自然な日本語か確認してください。</div>`);
  out.push(`<div class="fb note">提出前に、数値・社名・期間が事実どおりか最後に目で確認してください。</div>`);
  return out.join('');
}
function editorHTML(d) {
  const ta = (path, v, rows, label, list) => `<label>${label}<span class="cc">${list ? '' : len(v) + '字'}</span></label><textarea rows="${rows}" data-ed="${path}" data-list="${list ? 1 : ''}">${h(list ? v.join('\n') : v)}</textarea>`;
  const inp = (path, v, label) => `<label>${label}</label><input type="text" data-ed="${path}" value="${h(v)}">`;
  let s = '<p class="hint" style="margin-top:0">文字を直すとプレビューがすぐ更新されます。箇条書きは1行に1項目です。手で直した内容は「AI で作り直す」で上書きされます（直前の3版までは戻せます）。</p>';
  s += `<fieldset><legend>基本</legend>${inp('name', d.name, '氏名')}${inp('date', d.date, '日付')}</fieldset>`;
  s += `<fieldset><legend>実績ハイライト（プレミアムで表示）</legend><label>1行に1つ（「数値｜説明」の形）</label><textarea rows="3" data-ed="highlights" data-list="hl">${h(d.highlights.map((x) => x.value + '｜' + x.label).join('\n'))}</textarea></fieldset>`;
  s += `<fieldset><legend>職務要約</legend>${ta('summary', d.summary, 6, '本文')}<div class="row" style="margin-top:6px"><button class="btn small" data-act="copyField" data-path="summary">コピー</button></div></fieldset>`;
  d.careers.forEach((c, i) => {
    s += `<fieldset><legend>職務経歴 ${i + 1}</legend>${inp(`careers.${i}.company`, c.company, '会社名')}${inp(`careers.${i}.period`, c.period, '在籍期間')}${inp(`careers.${i}.business`, c.business, '事業内容')}${inp(`careers.${i}.meta`, c.meta, '従業員数・雇用形態など')}`;
    c.blocks.forEach((b, j) => { s += `<div style="border-top:1px dashed var(--line);margin-top:12px;padding-top:2px">${inp(`careers.${i}.blocks.${j}.period`, b.period, '期間')}${inp(`careers.${i}.blocks.${j}.heading`, b.heading, '部署・役職')}${ta(`careers.${i}.blocks.${j}.duties`, b.duties, 4, '業務内容', true)}${ta(`careers.${i}.blocks.${j}.achievements`, b.achievements, 4, '実績・取り組み', true)}</div>`; });
    s += '</fieldset>';
  });
  s += `<fieldset><legend>活かせる経験・知識・技術</legend>${ta('skills', d.skills, 5, '1行に1項目', true)}</fieldset>`;
  s += `<fieldset><legend>スキル・ツール・語学</legend>${ta('tech', d.tech, 3, '1行に1項目（「ツール：A、B」の形）', true)}</fieldset>`;
  s += `<fieldset><legend>資格・免許</legend><label>1行に1件（「2019年6月｜資格名」の形）</label><textarea rows="4" data-ed="qualifications" data-list="q">${h(d.qualifications.map((q) => q.date + '｜' + q.name).join('\n'))}</textarea></fieldset>`;
  d.pr.forEach((p, i) => { s += `<fieldset><legend>自己PR ${i + 1}</legend>${inp(`pr.${i}.heading`, p.heading, '見出し')}${ta(`pr.${i}.body`, p.body, 6, '本文')}</fieldset>`; });
  s += `<div class="row"><button class="btn small" data-act="copyField" data-path="pr">自己PRをまとめてコピー</button></div>`;
  return s;
}
function packHTML(c) {
  const p = c.pack;
  let s = `<div class="card pack"><div class="row" style="margin:0"><div><h2>志望動機・面接準備</h2><div class="hint" style="margin:0">提出した職務経歴書と矛盾しない志望動機・想定問答をまとめて作ります。回答例は丸暗記用ではなく、要点と30〜40秒の話し方の例です。【要記入】は、あなたにしか書けない部分です。</div></div><span class="spacer"></span>
    ${p ? `<button class="btn" data-act="toStages" data-id="${c.id}">選考管理に進む →</button>` : ''}
    <button class="btn ${p ? 'ghost' : 'primary'}" data-act="pack" ${c.packStatus === 'run' ? 'disabled' : ''}>${p ? '作り直す' : '作成する'}</button></div>`;
  if (c.packStatus === 'run') s += `<div class="status">${spin}志望動機と想定問答を作っています… ${elapsed(c.packSince, '1〜2分')} ${abortBtn('pack-' + c.id)}</div>`;
  if (c.packError) s += `<div class="status err">${h(c.packError)}</div>`;
  if (p) {
    const fill = (t) => h(t).replace(/【要記入[^】]*】/g, (m) => `<mark class="todo">${m}</mark>`);
    const cnt = (t, lo, hi) => { const n = len(t); return `<span class="${n < lo || n > hi ? 'off' : ''}">${n}字・目安${lo}〜${hi}字</span>`; };
    const mv = (t, label, lo, hi) => `<div class="mv"><div class="h"><span>${label}（${cnt(t, lo, hi)}）</span><button class="btn small" data-act="copyText" data-text="${h(t)}">コピー</button></div>${fill(t)}</div>`;
    const pc = checkNumbers(packParts(p));
    if (pc.bad.length) s += `<div class="fb warn" style="margin-top:12px">⚠ あなたの入力で確認できない数値：${pc.bad.map((n) => `<mark>${h(n)}</mark>`).join('、')}　面接で話す前に事実か確認してください。</div>`;
    s += `<h3>志望動機</h3>${p.motivation.long ? mv(p.motivation.long, '300字版', 280, 320) : ''}${p.motivation.short ? mv(p.motivation.short, '150字版', 130, 160) : ''}`;
    if (p.flow.steps.length) s += `<h3>選考の流れ <span class="tag warn">${h(p.flow.note || '一般的な想定')}</span></h3><div class="flow">${p.flow.steps.map((x) => `<div><b>${h(x.name)}</b>${h(x.who)}<div style="color:var(--ink2)">${h(x.focus)}</div></div>`).join('')}</div>`;
    if (p.questions.length) s += `<h3>想定質問と回答例（${p.questions.length}問）</h3>${p.questions.map((q, i) => `<details ${i === 0 ? 'open' : ''}><summary>Q${i + 1}. ${h(q.q)}</summary><div class="intent">意図：${h(q.intent)}</div><ul>${q.points.map((x) => `<li>${h(x)}</li>`).join('')}</ul>${mv(q.answer, '回答例', 150, 220)}</details>`).join('')}`;
    if (p.reverse.length) s += `<h3>逆質問</h3><ul>${p.reverse.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
    if (p.cautions.length) s += `<h3>突っ込まれやすい点と対策</h3><ul>${p.cautions.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
  }
  return s + '</div>';
}
function drawPreview(c) {
  const box = $('#preview'); if (!box || !F.ready || !c.doc) return;
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
  const list = state.companies.filter((c) => c.analysis || c.doc || c.stages);
  if (!list.length) { $('#v4').innerHTML = viewHead('選考管理', '応募先ごとの選考ステップと日程を管理し、面接の記録から次の面接の対策を作ります。') + '<div class="card empty">応募先を追加すると、ここで選考を管理できます。</div>'; return; }
  list.forEach(ensureStages); save();
  if (!company(state.active4) || !list.includes(company(state.active4))) state.active4 = list[0].id;
  const c = company(state.active4);
  const active = list.filter((x) => x.result === '選考中').length;
  const ups = list.flatMap((x) => x.stages.filter((s) => s.status === '予定' && s.date && daysFrom(s.date) >= 0).map((s) => ({ c: x, s }))).sort((a, b) => (a.s.date + a.s.time).localeCompare(b.s.date + b.s.time));
  const passed = list.reduce((n, x) => n + x.stages.filter((s) => s.status === '通過' && s.name !== '書類選考').length, 0);
  const offers = list.filter((x) => x.result === '内定').length;
  $('#v4').innerHTML = viewHead('選考管理', '応募先ごとの選考ステップと日程を一覧にし、面接の記録から次の面接の対策を作ります。') + `
  <div class="kpis">
    <div class="kpi"><div class="n">${active}</div><div class="l">選考中の応募先</div></div>
    <div class="kpi"><div class="n">${ups.length}</div><div class="l">これからの面接</div></div>
    <div class="kpi"><div class="n">${passed}</div><div class="l">通過した面接</div></div>
    <div class="kpi"><div class="n">${offers}</div><div class="l">内定</div></div>
  </div>
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
      <div class="bcards">${list.map((x) => { const i = curStage(x); const ne = nextEvent(x); return `<button class="bcard ${x.id === c.id ? 'on' : ''}" data-act="sel4" data-id="${x.id}"><b>${h(cname(x))}</b><span class="pill ${x.result === '内定' ? 'ok' : x.result === '見送り' ? 'err' : ''}">${h(x.result)}</span><div class="mini">${x.stages.map((s) => `<i class="${s.status === '通過' ? 'p' : s.status === '予定' ? 's' : (s.status === '不通過' || s.status === '辞退') ? 'f' : ''}"></i>`).join('')}</div><span class="cc">${i >= 0 ? h(x.stages[i].name + '・' + x.stages[i].status) : '全ステップ通過'}${ne ? '　次：' + h(jpDate(ne.date) + ' ' + ne.time) : ''}</span></button>`; }).join('')}</div>
    </div>
    <div class="card"><h2>これからの予定</h2>
      ${ups.length ? `<div class="sched">${ups.slice(0, 8).map(({ c: x, s }) => { const d = new Date(s.date + 'T00:00:00'); const dd = daysFrom(s.date); return `<div class="it ${dd <= 3 ? 'soon' : ''}" data-act="sel4" data-id="${x.id}"><div class="dt"><b>${d.getDate()}</b><small>${d.getMonth() + 1}月（${WD[d.getDay()]}）</small></div><div><b style="font-size:13px">${h(cname(x))}</b><div class="cc">${h(s.name)}${s.time ? '・' + h(s.time) : ''}${s.format ? '・' + h(s.format) : ''}${dd === 0 ? '・今日' : dd > 0 ? `・あと${dd}日` : ''}</div></div></div>`; }).join('')}</div>` : '<div class="empty" style="padding:18px">日程が入った面接はまだありません。</div>'}
    </div>
  </div>
  <div class="card" style="margin-top:16px">${stagesHTML(c)}</div>`;
}
function stagesHTML(c) {
  const ci = curStage(c);
  return `<div class="row" style="margin:0"><div><h2>${h(cname(c))} の選考</h2><div class="hint" style="margin:0">${h((c.analysis && c.analysis.position) || '')}　面接が終わったら、聞かれたことと詰まったことを残してください。次のステップの対策に使います。</div></div><span class="spacer"></span>
    <label style="margin:0">結果</label><select data-c4="result" style="width:auto">${['選考中', '内定', '見送り', '辞退'].map((o) => `<option ${c.result === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
  <div class="stages">${c.stages.map((s, i) => {
    const prevLogged = c.stages.slice(0, i).some(hasLog);
    const canPrep = i > 0 && (prevLogged || c.doc) && s.status !== '通過' && s.status !== '不通過' && s.status !== '辞退';
    return `<div class="stage ${i === ci ? 'cur' : ''}" data-sid="${s.id}">
      <div class="top">
        <input type="text" class="nm" data-sf="name" value="${h(s.name)}" aria-label="ステップ名">
        <select data-sf="status" aria-label="状態">${ST.map((o) => `<option ${s.status === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <input type="date" data-sf="date" value="${h(s.date)}" aria-label="日付">
        <input type="time" data-sf="time" value="${h(s.time)}" aria-label="時間">
        <select data-sf="format" aria-label="形式"><option value="">形式</option>${['オンライン', '対面', '電話', 'その他'].map((o) => `<option ${s.format === o ? 'selected' : ''}>${o}</option>`).join('')}</select>
        <input type="text" data-sf="who" value="${h(s.who)}" placeholder="面接官（例：部門長）" aria-label="面接官">
        <button class="btn ghost small" data-act="delStage" data-sid="${s.id}" aria-label="このステップを削除">削除</button>
      </div>
      ${true ? `<details ${hasLog(s) || (i > 0 && (s.status === '通過' || s.status === '不通過')) ? 'open' : ''}><summary>${i === 0 ? '選考のメモ・フィードバック' : '面接の記録'}${hasLog(s) ? '（記入済み）' : ''}</summary><div class="log">
        ${[['asked', '聞かれた質問（1行に1問）', 4], ['bad', '詰まったこと・反省点', 4], ['good', 'うまく話せたこと', 3], ['vibe', '面接官の反応・雰囲気', 3], ['reverse', '逆質問で聞いたこと・分かったこと', 3]].map(([k, l, r]) => `<div><label>${l}</label><textarea rows="${r}" data-lf="${k}">${h(s.log[k])}</textarea></div>`).join('')}
      </div></details>` : ''}
      ${canPrep || s.prep ? `<div class="prep">
        <div class="row" style="margin:0"><b style="font-size:13px">「${h(s.name)}」の対策</b><span class="cc">${prevLogged ? 'これまでの面接記録をもとに作ります' : '書類と方針をもとに作ります（記録があると精度が上がります）'}</span><span class="spacer"></span>
          <button class="btn ${s.prep ? 'ghost' : 'primary'} small" data-act="prep" data-sid="${s.id}" ${s.prepStatus === 'run' ? 'disabled' : ''}>${s.prep ? '作り直す' : '対策を作る'}</button></div>
        ${s.prepStatus === 'run' ? `<div class="status">${spin}面接の記録を読んで対策を作っています… ${elapsed(s.since, '30〜60秒')} ${abortBtn('prep-' + s.id)}</div>` : ''}
        ${s.prepError ? `<div class="status err">${h(s.prepError)}</div>` : ''}
        ${s.prep ? prepHTML(s.prep) : ''}
      </div>` : ''}
    </div>`; }).join('')}</div>
  <div class="row"><button class="btn small" data-act="addStage">＋ ステップを追加</button></div>`;
}
function prepHTML(p) {
  let s = '';
  const pc = checkNumbers(prepParts(p));
  if (pc.bad.length) s += `<div class="fb warn" style="margin-top:10px">⚠ あなたの入力で確認できない数値：${pc.bad.map((n) => `<mark>${h(n)}</mark>`).join('、')}</div>`;
  if (p.summary) s += `<div class="sum" style="margin-top:10px">${h(p.summary)}</div>`;
  if (p.focus.length) s += `<h3>見られそうな点</h3><div>${p.focus.map((x) => `<span class="tag">${h(x)}</span>`).join('')}</div>`;
  if (p.fixes.length) s += `<h3>前回の答え直し</h3>${p.fixes.map((f) => `<div class="fix"><b>${h(f.issue)}</b>${h(f.better)}</div>`).join('')}`;
  if (p.questions.length) s += `<h3>深掘りされそうな質問</h3>${p.questions.map((q, i) => `<details ${i === 0 ? 'open' : ''}><summary>${h(q.q)}</summary><div class="intent">予想の理由：${h(q.why)}</div><ul>${q.points.map((x) => `<li>${h(x)}</li>`).join('')}</ul></details>`).join('')}`;
  if (p.reverse.length) s += `<h3>逆質問</h3><ul>${p.reverse.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
  if (p.checklist.length) s += `<h3>前日までにやること</h3><ul class="chk">${p.checklist.map((x) => `<li>${h(x)}</li>`).join('')}</ul>`;
  return s;
}

// ---------------- demo ----------------
function demoState() {
  const d = window.DEMO; const st = fresh();
  st.demo = true; st.name = d.name; st.raw = d.raw; st.profile = normProfile(d.profile); st.intent = Object.assign({}, d.intent || {});
  st.rireki = Object.assign(RK0(), d.rireki || {});
  const co = newCompany({ name: d.jobName, job: d.job, info: d.companyInfo, analysis: normAnalysis(d.analysis), status: 'done', maxPages: 2, theme: 'premium', accent: 'navy', pack: normPack(d.pack), packStatus: 'done' });
  co.doc = Object.assign(E.normalizeDoc(d.doc), { date: today() + '現在', name: d.name });
  const base = new Date();
  co.stages = d.stages.map((s) => { const dt = s.offset != null ? new Date(base.getTime() + s.offset * 864e5) : null; return newStage({ name: s.name, status: s.status, date: dt ? iso(dt) : '', time: s.time || '', format: s.format || '', who: s.who || '', log: Object.assign({ asked: '', good: '', bad: '', vibe: '', reverse: '' }, s.log || {}) }); });
  co.explain = Object.assign(normExplain(d.explain), { lang: 'zh' }); co.exStatus = 'done';
  const nx = co.stages.findIndex((s) => s.status === '予定'); if (nx >= 0) { co.stages[nx].prep = normPrep(d.prep); co.stages[nx].prepStatus = 'done'; }
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
  if (t.dataset.crk) { const c = company(state.active); c.rk[t.dataset.crk] = t.value; save(); const cc = t.previousElementSibling && t.previousElementSibling.querySelector('.cc'); if (cc) cc.textContent = len(t.value) + '字'; clearTimeout(rkT); rkT = setTimeout(() => drawRireki(c), 200); return; }
  if (t.dataset.bind) { state[t.dataset.bind] = t.value; if (t.dataset.bind === 'raw') { const rc = $('#rawCount'); if (rc) rc.textContent = len(t.value) + '字'; } save(); return; }
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
    setPath(c.doc, t.dataset.ed, v); c.dirty = true;
    const cc = t.previousElementSibling && t.previousElementSibling.querySelector('.cc'); if (cc && !t.dataset.list) cc.textContent = len(t.value) + '字';
    save();
    clearTimeout(edT); edT = setTimeout(() => { drawPreview(c); const fb = $('#fitbar'); if (fb) fb.innerHTML = fitbarHTML(c); }, 180);
  }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.tagName === 'SELECT' && t.dataset.cf) { const c = company(t.closest('[data-cid]').dataset.cid); c[t.dataset.cf] = t.value; save(); }
  if (t.dataset.sf && (t.tagName === 'SELECT' || t.type === 'date' || t.type === 'time')) { const [, s] = stageOf(t); if (s) { s[t.dataset.sf] = t.value; save(); render(); } }
  if (t.dataset.c4) { const c = company(state.active4); c[t.dataset.c4] = t.value; save(); render(); }
  if (t.id === 'importFile' && t.files && t.files[0]) { importData(t.files[0]); t.value = ''; }
  if (t.id === 'rkPhoto' && t.files && t.files[0]) { loadPhoto(t.files[0]); t.value = ''; }
});
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]'); if (!b) return;
  const act = b.dataset.act; const c = b.dataset.id ? company(b.dataset.id) : company(state.step === 4 ? state.active4 : state.active);
  switch (act) {
    case 'step': state.step = +b.dataset.step; save(); render(); window.scrollTo(0, 0); break;
    case 'extract': extractProfile(); break;
    case 'sampleRaw': state.raw = DEMO.raw; if (!state.name) state.name = DEMO.name; save(); render(); break;
    case 'addCompany': state.companies.push(newCompany()); save(); render(); break;
    case 'sampleJob': state.companies.push(newCompany({ name: DEMO.jobName, job: DEMO.job, info: DEMO.companyInfo })); save(); render(); break;
    case 'delCompany': if (c && !BUSY.includes(c.status) && confirm2(b, '本当に削除（もう一度押す）')) { state.companies = state.companies.filter((x) => x !== c); save(); render(); toast('削除しました'); } break;
    case 'analyze': if (c) analyze(c); break;
    case 'analyzeAll': (async () => { const qs = state.companies.filter((x) => x.job.trim() && !x.analysis && !BUSY.includes(x.status)); if (!(await readyFor(qs))) return; state.companies.forEach((x) => { x.batch = qs.includes(x); }); qs.forEach((x) => { x.status = 'queued'; }); render(); pool(qs, 2, (x) => (x.status === 'queued' ? analyze(x) : null)); })(); break;
    case 'generate': if (c) { if (c.doc && c.dirty && !confirm2(b, '手で直した箇所も作り直されます（もう一度押す）')) break; state.active = c.id; state.step = 3; save(); generate(c); window.scrollTo(0, 0); } break;
    case 'generateAll': (async () => { const qs = state.companies.filter((x) => x.analysis && !x.doc && x.status === 'analyzed'); if (qs.length && (await readyFor(qs))) { state.companies.forEach((x) => { x.batch = qs.includes(x); }); qs.forEach((x) => { x.status = 'queued'; }); state.active = qs[0].id; state.step = 3; render(); pool(qs, 2, (x) => (x.status === 'queued' ? generate(x) : null)); } })(); break;
    case 'abortAll': Object.values(controllers).forEach((ctl) => ctl.abort()); state.companies.forEach((x) => { if (x.status === 'queued') x.status = x.doc ? 'done' : x.analysis ? 'analyzed' : 'idle'; }); render(); break;
    case 'tab': c.tab = b.dataset.v; c.edit = false; render(); window.scrollTo(0, 0); break;
    case 'undo': if (c && c.history && c.history.length) { c.doc = c.history.pop(); c.dirty = true; save(); render(); toast('1つ前の版に戻しました'); } break;
    case 'exportData': exportData(); break;
    case 'rkEra': state.rireki.era = b.dataset.v; save(); render(); break;
    case 'rkGen': if (confirm2(b, '今の内容を置き換えます（もう一度押す）')) { state.rireki[b.dataset.v] = b.dataset.v === 'history' ? genHistory() : genLicenses(); save(); render(); } break;
    case 'rkPhotoDel': state.rireki.photo = ''; save(); render(); break;
    case 'rkMotive': if (c) makeRkMotive(c); break;
    case 'rkPdf': if (c) { if (/【要記入/.test(c.rk.motive) && !confirm2(b, '【要記入】が残っています。もう一度押すと保存')) break; downloadRireki(c); } break;
    case 'exLang': state.explainLang = b.dataset.v; save(); render(); break;
    case 'explain': if (c && c.doc) makeExplain(c); break;
    case 'exApply': { const n = c.explain && c.explain.naturalness[+b.dataset.i]; if (!n) break; pushHistory(c); if (replaceInDoc(c.doc, n.ja, n.suggestion)) { n.applied = true; c.dirty = true; save(); render(); toast('反映しました（「1つ前の版に戻す」で取り消せます）'); } else { c.history.pop(); toast('原文が見つかりませんでした。「文章を直す」から直接修正してください'); } break; }
    case 'importData': $('#importFile').click(); break;
    case 'open': if (c) { state.active = c.id; state.step = 3; save(); render(); window.scrollTo(0, 0); } break;
    case 'theme': c.theme = b.dataset.v; save(); render(); break;
    case 'accent': c.accent = b.dataset.v; save(); render(); break;
    case 'pages': c.maxPages = +b.dataset.v; save(); render(); break;
    case 'refit': if (c.dirty && !confirm2(b, '手で直した箇所も詰められます（もう一度押す）')) break; refit(c); break;
    case 'edit': c.edit = !c.edit; render(); break;
    case 'pdf': case 'docx': { const bad = checkNumbers(docParts(c.doc)).bad.length; if (bad && !confirm2(b, `未確認の数値が${bad}件あります。もう一度押すと保存`)) break; download(c, act); break; }
    case 'pack': makePack(c); break;
    case 'toStages': state.active4 = c.id; state.step = 4; save(); render(); window.scrollTo(0, 0); break;
    case 'copyText': copy(b.dataset.text); break;
    case 'copyField': { const v = getPath(c.doc, b.dataset.path); copy(Array.isArray(v) ? v.map((p) => (p.heading ? '【' + p.heading + '】\n' : '') + p.body).join('\n\n') : v); break; }
    case 'abort': { const ctl = controllers[b.dataset.key]; if (ctl) ctl.abort(); break; }
    case 'sel4': state.active4 = b.dataset.id; save(); render(); break;
    case 'addStage': { const x = company(state.active4); x.stages.push(newStage({ name: 'ステップ' + (x.stages.length + 1) })); save(); render(); break; }
    case 'delStage': { const x = company(state.active4); if (x.stages.length > 1 && confirm2(b, '削除する？')) { x.stages = x.stages.filter((s) => s.id !== b.dataset.sid); save(); render(); } break; }
    case 'prep': { const x = company(state.active4); const i = x.stages.findIndex((s) => s.id === b.dataset.sid); if (i >= 0) makePrep(x, i); break; }
    case 'demo': if (!state.demo) userState = state; state = demoState(); render(); window.scrollTo(0, 0); break;
    case 'startOwn': case 'startFree': { const own = state.demo ? userState : state; state = own && !own.demo ? own : fresh(); userState = null; ui.lp = false; if (!hasOwnData(state)) state.step = 1; save(); render(); window.scrollTo(0, 0); if (state.step === 1) setTimeout(() => { const el = $('#in-raw'); if (el) el.focus(); }, 50); break; }
    case 'reset': if (confirm2(b, 'もう一度押すと消去')) { state = fresh(); userState = null; save(); render(); toast('入力データを消去しました'); } break;
    case 'login': openLogin(); break;
    case 'devLogin': { const v = ($('#devName').value || '').replace(/[^\w-]/g, '').slice(0, 30); if (!v) break; localStorage.setItem('resume-dev-user', v); closeModal(true); onUserChange({ id: 'dev_' + v, name: v }); break; }
    case 'devLogout': localStorage.removeItem('resume-dev-user'); onUserChange(null); break;
    case 'closeModal': closeModal(false); break;
    case 'consentOk': if (!$('#agree').checked) { toast('チェックを入れてください'); break; } b.disabled = true; api('POST', '/api/consent', { version: CFG.consent }).then(() => { acct.me.consent = true; closeModal(true); }).catch(() => { b.disabled = false; toast('送信できませんでした。もう一度お試しください'); }); break;
    case 'openBuy': openBuy(''); break;
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
setInterval(() => { document.querySelectorAll('.elapsed[data-since]').forEach((el) => { const sec = Math.max(0, Math.round((Date.now() - +el.dataset.since) / 1000)); el.textContent = `（${sec}秒経過・目安${el.dataset.est}）`; }); }, 1000);
let rsT; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (!state) return; const c = company(state.active); if (state.step === 3 && c) drawPreview(c); }, 200); });
// before a batch: signed in, consent given, and enough credits for the 応募先 that have none yet
async function readyFor(qs) {
  if (state.demo) { toast(errMsg({ code: 'demo' })); return false; }
  if (!acct.user) { openLogin(); return false; }
  try { if (!acct.me) await refreshMe(); } catch (e) { toast(errMsg(e)); return false; }
  if (!acct.me.consent && !(await askConsent())) return false;
  const need = qs.filter((x) => !hasSlot(x)).length;
  if (need > acct.me.credits) { openBuy(`まとめて処理するには利用枠が${need}社分必要です（残り${acct.me.credits}社分）。`); return false; }
  return true;
}
function renderPrices() {
  const el = $('#price .prices'); const packs = CFG.packs || []; if (!el || !packs.length) return;
  el.innerHTML = `<div class="pc"><span>最初の${CFG.free || 1}社</span><b>無料</b></div>` + packs.map((p) => `<div class="pc"><span>${h(p.label)}</span><b>${p.price.toLocaleString('ja-JP')}円</b><small>1社あたり${Math.round(p.price / p.credits).toLocaleString('ja-JP')}円</small></div>`).join('');
}
async function boot() {
  renderPrices();
  // what this browser has, shown at once; the account's copy replaces it once sign-in is known
  state = readLocal(GUEST) || fresh(); migrate(state); ui.lp = !hasOwnData(state);
  render();
  await initAuth(); acct.ready = true;
  if (acct.user) await loadAccount();
  acctUI(); render();
  if (!sessionStorage.getItem('resume-visit')) { sessionStorage.setItem('resume-visit', '1'); beacon('visit'); }
  paidReturn();
}
boot();
})();
