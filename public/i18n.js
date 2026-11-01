/* The page in English or Chinese (/en/, /zh/). The app writes its page text in Japanese; here every text node
   and label that is exactly a known page text is replaced by its translation as soon as it appears. Numbers and
   inserted values are kept: a text is looked up with them written {0}, {1}… (tools/i18n-extract.mjs makes the keys
   the same way). What the user typed and what the AI wrote are left as they are: they are never exactly a page
   text, and fields, the document previews and [data-noi18n] are skipped.
   window.I18N = { lang, dict } comes from i18n/en.js or i18n/zh.js, loaded before this file. */
(function () {
  'use strict';
  const I = window.I18N;
  if (!I || !I.dict) return;
  const dict = I.dict;
  const NUM = /\d+(?:[.,]\d+)*/g;
  const JA = /[぀-ヿ㐀-鿿]/;
  // keys with {n}: a pattern each, grouped by their first character (or '*' when they start with {n})
  const pats = {};
  Object.keys(dict).forEach((k) => {
    if (!/\{\d+\}/.test(k)) return;
    // only keys with some text of their own: 「{0}枚{1}」 would match almost anything
    if (k.replace(/\{\d+\}|[\s、。・：:（）()「」『』【】\-–—／/|｜,.]/g, '').length < 2) return;
    const parts = k.split(/(\{\d+\})/);
    const order = [];
    // a value at the start or end may be empty (「英文レジュメ{0}」 is also 「英文レジュメ」 before the ✓)
    const src = parts.map((p, i) => { const m = /^\{(\d+)\}$/.exec(p); if (m) { order.push(+m[1]); return i === 1 && !parts[0] || i === parts.length - 2 && !parts[parts.length - 1] ? '(.*?)' : '(.+?)'; } return p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('');
    const first = /^\{\d+\}/.test(k) ? '*' : k[0];
    (pats[first] = pats[first] || []).push({ re: new RegExp('^' + src + '$'), order, k, own: k.replace(/\{\d+\}/g, '').length });
  });
  Object.values(pats).forEach((l) => l.sort((a, b) => b.own - a.own)); // the most specific key first
  const fill = (tr, vals) => tr.replace(/\{(\d+)\}/g, (m, i) => (vals[+i] != null ? vals[+i] : m));
  function lookup(t, depth) {
    if (Object.prototype.hasOwnProperty.call(dict, t)) return dict[t];
    // numbers as {n}
    const nums = []; let i = 0;
    const kn = t.replace(NUM, (m) => { nums.push(m); return '{' + i++ + '}'; });
    if (nums.length && Object.prototype.hasOwnProperty.call(dict, kn)) return fill(dict[kn], nums);
    // a mark in front (「✓ 」「⚠ 」) or an ellipsis after: the rest on its own
    const mk = /^([✓⚠＋+→・•]\s*)(?=\S)/.exec(t);
    if (mk && (depth || 0) < 2) { const r = lookup(t.slice(mk[1].length), (depth || 0) + 1); if (r != null) return mk[1] + r; }
    const el = /(…|\.\.\.)$/.exec(t);
    if (el && (depth || 0) < 2) { const r = lookup(t.slice(0, -el[1].length), (depth || 0) + 1); if (r != null) return r + el[1]; }
    // inserted values as {n}
    const cands = (pats[t[0]] || []).concat(pats['*'] || []).sort((a, b) => b.own - a.own);
    for (const p of cands) {
      const m = p.re.exec(t);
      if (!m) continue;
      const vals = [];
      // an inserted value may itself be page text (「1年」, a label)
      p.order.forEach((n, j) => { const v = m[j + 1]; const r = (depth || 0) < 2 && JA.test(v) ? lookup(v, (depth || 0) + 1) : null; vals[n] = r != null ? r : v; });
      return fill(dict[p.k], vals);
    }
    return null;
  }
  function tr(s) {
    if (!s || !JA.test(s)) return null;
    let t = s.replace(/\s+/g, ' ').trim();
    // a mark the page puts in front (「✓ 」「⚠ 」「＋ 」) is kept and the rest looked up
    const r = lookup(t);
    if (r == null) { if (window.I18N_MISSING) window.I18N_MISSING.add(t); return null; }
    const lead = /^\s*/.exec(s)[0], tail = /\s*$/.exec(s)[0];
    return lead + r + tail;
  }
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'CANVAS', 'NOSCRIPT', 'CODE', 'PRE']);
  const skipped = (el) => !el || (el.closest && el.closest('[data-noi18n],[contenteditable="true"]'));
  const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  function attrs(el) {
    for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v) { const r = tr(v); if (r != null && r !== v) el.setAttribute(a, r); } }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && el.value) { const r = tr(el.value); if (r != null) el.value = r; }
  }
  function text(node) {
    const p = node.parentElement;
    if (!p || SKIP.has(p.tagName) || skipped(p)) return;
    const r = tr(node.nodeValue);
    if (r != null && r !== node.nodeValue) node.nodeValue = r;
  }
  function walkTree(root) {
    if (root.nodeType === 3) { text(root); return; }
    if (root.nodeType !== 1 || skipped(root)) return;
    if (SKIP.has(root.tagName)) { if (root.tagName === 'TEXTAREA') attrs(root); return; }
    attrs(root);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
        if (n.hasAttribute('data-noi18n')) return NodeFilter.FILTER_REJECT;
        if (SKIP.has(n.tagName)) { if (n.tagName === 'TEXTAREA') attrs(n); return NodeFilter.FILTER_REJECT; } // a field's placeholder, never its text
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    let n;
    while ((n = w.nextNode())) { if (n.nodeType === 3) text(n); else attrs(n); }
  }
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walkTree);
      else if (m.type === 'characterData') text(m.target);
      else if (m.type === 'attributes' && !skipped(m.target)) attrs(m.target);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  const all = () => { walkTree(document.body || document.documentElement); const t = tr(document.title); if (t) document.title = t; };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', all); else all();
  // for text the page shows outside the DOM (confirm dialogs and the like)
  window.I18N_T = (s) => { const r = tr(s); return r == null ? s : r; };
})();
