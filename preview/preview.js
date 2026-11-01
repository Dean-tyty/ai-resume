/* Preview of 職務経歴書AI for looking at the screens without the server: a stand-in for /config.js and the
   API, kept in this browser. AI answers are the sample's, payments add credits at once, nothing leaves the page.
   Made into the preview by tools/make-preview.mjs; never part of the real site. */
(function () {
  'use strict';
  // storage that may be missing in a sandboxed frame: fall back to memory
  ['localStorage', 'sessionStorage'].forEach((k) => {
    try { window[k].setItem('__t', '1'); window[k].removeItem('__t'); }
    catch (e) {
      const m = {};
      const store = { getItem: (x) => (x in m ? m[x] : null), setItem: (x, v) => { m[x] = String(v); }, removeItem: (x) => { delete m[x]; }, clear: () => { Object.keys(m).forEach((x) => delete m[x]); }, key: (i) => Object.keys(m)[i] || null, get length() { return Object.keys(m).length; } };
      try { Object.defineProperty(window, k, { value: store, configurable: true }); } catch (er) { /* keep the browser's */ }
    }
  });
  window.APP_CONFIG = {
    clerkKey: '', dev: true, preview: true, free: 1, consent: 'preview', retention: 365,
    packs: [{ id: 'p5', credits: 5, price: 2480, label: '5社パック' }, { id: 'p10', credits: 10, price: 3980, label: '10社パック' }],
    terms: 'https://www.flatland.co.jp/legal/terms/resume/', privacy: 'https://www.flatland.co.jp/privacy/',
  };
  const MOCK = __MOCK__;
  const KEY = 'resume-preview-server';
  let S; try { S = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { S = null; }
  if (!S || !S.users) S = { users: {} };
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { /* memory only */ } };
  const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const PACKS = { p5: 5, p10: 10 };
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (input, init) {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
    init = init || {};
    const method = (init.method || 'GET').toUpperCase();
    const auth = (init.headers && (init.headers.authorization || init.headers.Authorization)) || '';
    const name = auth.startsWith('Dev ') ? auth.slice(4) : '';
    if (!name) return res(401, { error: { code: 'login' } });
    const id = 'dev_' + name;
    const created = !S.users[id];
    const u = S.users[id] || (S.users[id] = { credits: 1, slots: [], consent: false, data: null, version: 0 });
    const body = init.body ? JSON.parse(init.body) : {};
    const key = method + ' ' + url.pathname;
    try {
      if (key === 'GET /api/me') return res(200, { id, credits: u.credits, slots: u.slots, consent: u.consent, created });
      if (key === 'POST /api/consent') { u.consent = true; return res(200, { ok: true }); }
      if (key === 'GET /api/workspace') return res(200, { data: u.data, version: u.version });
      if (key === 'PUT /api/workspace') {
        if ((Number(body.base) || 0) !== u.version) return res(409, { error: { code: 'conflict' }, version: u.version });
        u.data = body.data; u.version += 1; return res(200, { version: u.version });
      }
      if (key === 'POST /api/checkout') { u.credits += PACKS[body.pack] || 0; await wait(600); return res(200, { credited: true }); }
      if (key === 'DELETE /api/account') { delete S.users[id]; return res(200, { ok: true }); }
      if (key === 'POST /api/ai') {
        if (!u.consent) return res(403, { error: { code: 'consent' } });
        const c = body.c;
        // as on the server: reading a posting is free, documents use a credit, the sample posting never does
        const sample = c && window.DEMO && c.job.replace(/\s+/g, '') === window.DEMO.job.replace(/\s+/g, '');
        if (c && body.task !== 'analyze' && !sample && !u.slots.includes(c.id)) {
          if (u.credits <= 0) return res(402, { error: { code: 'no_credit', credits: 0 } });
          u.credits -= 1; u.slots.push(c.id);
        }
        await wait(body.task === 'generate' || body.task === 'pack' ? 2600 : 1500);
        const ul = body.ctx && body.ctx.uiLang;
        const v = JSON.parse(JSON.stringify(MOCK[body.task + '_' + ul] || MOCK[body.task] || {}));
        if (body.task === 'analyze' && c && c.name) v.company = c.name;
        return res(200, { result: v, credits: u.credits, slot: c && u.slots.includes(c.id) ? 'have' : '' });
      }
      return res(404, { error: { code: 'not_found' } });
    } finally { keep(); }
  };
  navigator.sendBeacon = () => true;
  // files: through the page host's save dialog when it offers one
  let dl = null;
  if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then((d) => { dl = d; }).catch(() => {});
  window.APP_SAVE = async (filename, data) => {
    if (!dl) throw new Error('この画面ではファイルを保存できません');
    try { await dl.save({ filename, data }); } catch (e) { if (!e || e.code !== 'declined') throw e; }
  };
  // a ribbon saying what this is
  document.addEventListener('DOMContentLoaded', () => {
    const r = document.createElement('div');
    r.className = 'preview-ribbon';
    r.innerHTML = '画面確認用のプレビューです。AI はサンプルの回答を返し、購入しても支払いは発生しません。入力内容はこのブラウザの中にだけ残ります。<button type="button">リセット</button>';
    r.querySelector('button').onclick = () => { try { Object.keys(localStorage).filter((k) => /^resume-/.test(k)).forEach((k) => localStorage.removeItem(k)); sessionStorage.clear(); } catch (e) { /* ignore */ } location.reload(); };
    document.body.prepend(r);
  });
})();
