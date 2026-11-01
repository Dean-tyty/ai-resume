/* 職務経歴書 layout engine — one deterministic layout feeds the canvas preview and the PDF.
   Units: pt, origin top-left. Works in the browser (window.ResumeEngine) and in Node (module.exports). */
(function (global) {
  'use strict';

  const PAGE_W = 595.28, PAGE_H = 841.89;
  const M = { t: 52, b: 56, l: 54, r: 54 };
  const CW = PAGE_W - M.l - M.r;
  const S = {
    title: 17, titleTc: 5,
    body: 10, bodyLead: 17.5,
    tbl: 9.5, tblLead: 15.5,
    small: 8.5, smallLead: 13,
    head: 11.5, headLead: 22, headBefore: 15, headAfter: 7,
    colPeriod: 86, padX: 7, padY: 6,
  };
  const ASC = 0.88; // BIZ UD ascent / em

  const FONT_FILES = { 'mincho-r': 'fonts/mincho-r.ttf', 'gothic-r': 'fonts/gothic-r.ttf', 'gothic-b': 'fonts/gothic-b.ttf' };

  const THEMES = {
    standard: {
      label: 'スタンダード', note: '罫線の表組み・明朝体。金融・メーカー・官公庁など、伝統的な企業に', body: 'mincho-r', bold: 'gothic-b',
      text: '#1a1a1a', sub: '#555555', accent: '#1a1a1a', rule: '#333333', grid: '#a6a6a6', fill: '#ffffff', band: '#f3f3f3',
      frame: '#333333', frameW: 0.75, gridW: 0.4, title: 18, titleTc: 7, achBullet: 'square',
      head: 'rule', docx: { body: 'mincho', bold: 'gothic' },
    },
    modern: {
      label: 'モダン', note: 'ゴシック体と控えめな配色。業界を問わず使える標準形', body: 'gothic-r', bold: 'gothic-b',
      text: '#1d2127', sub: '#5b6470', accent: '#1f3a5f', rule: '#1f3a5f', grid: '#c3cad3', fill: '#ffffff', band: '#eef2f7',
      frame: '#9aa7b6', frameW: 0.6, gridW: 0.4, bandRule: 1.2, title: 17, titleTc: 5, achBullet: 'dot',
      head: 'bar', docx: { body: 'gothic', bold: 'gothic' },
    },
    premium: {
      label: 'プレミアム', note: '実績ハイライトと時系列。IT・Web・スタートアップ・外資系に', body: 'gothic-r', bold: 'gothic-b', accentable: true,
      text: '#1b1f24', sub: '#5f6873', accent: '#1f3a5f', rule: '#1f3a5f', grid: '#d3d9e0', fill: '#f2f4f7', band: '#eef1f5',
      head: 'premium', docx: { body: 'gothic', bold: 'gothic' },
    },
  };
  // Fonts of the Word file, by where it will be opened: ones that come with that system, so the file looks
  // as intended without installing anything. PDF embeds its own fonts and looks the same everywhere.
  //   windows: BIZ UD fonts, standard since Windows 10 (October 2018 Update) — the same design as the PDF
  //   mac: Yu Mincho / Yu Gothic, which Office for Mac provides (downloaded on first use); written with the Windows
  //        names, so the file also looks the same on the Windows PC it is sent to. Pages users: the PDF.
  //   google: BIZ UD fonts as Google Docs names them (Google Fonts)
  // [name in the file, [other names Word may know it by], family class for Word's fallback]
  const DOCX_FONTS = {
    windows: { label: 'Windows の Word', mincho: ['BIZ UDP明朝 Medium', ['BIZ UDPMincho Medium'], 'roman'], gothic: ['BIZ UDPゴシック', ['BIZ UDPGothic'], 'swiss'] },
    mac: { label: 'Mac の Word', mincho: ['Yu Mincho', ['游明朝'], 'roman'], gothic: ['Yu Gothic', ['游ゴシック'], 'swiss'] },
    google: { label: 'Google ドキュメント', mincho: ['BIZ UDPMincho', ['BIZ UDP明朝 Medium'], 'roman'], gothic: ['BIZ UDPGothic', ['BIZ UDPゴシック'], 'swiss'] },
  };
  const ACCENTS = [
    { key: 'navy', label: '紺', hex: '#1f3a5f' },
    { key: 'green', label: '深緑', hex: '#1d5a4b' },
    { key: 'wine', label: 'ワイン', hex: '#7a2c3b' },
    { key: 'ink', label: '墨', hex: '#30353c' },
  ];
  function mix(a, b, t) {
    const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
    const ch = (s) => Math.round(((pa >> s) & 255) * (1 - t) + ((pb >> s) & 255) * t);
    return '#' + [16, 8, 0].map((s) => ch(s).toString(16).padStart(2, '0')).join('');
  }
  function resolveTheme(key, opts) {
    const th = Object.assign({}, THEMES[key] || THEMES.standard);
    if (th.accentable && opts && opts.accent) { const a = (ACCENTS.find((x) => x.key === opts.accent) || {}).hex || opts.accent; if (/^#[0-9a-f]{6}$/i.test(a)) { th.accent = a; th.rule = a; } }
    th.tint = mix(th.accent, '#ffffff', 0.9);
    return th;
  }

  // ---------- measuring ----------
  function makeMeasurer(fkFonts) {
    const cache = {};
    return {
      fonts: fkFonts,
      adv(key, ch) {
        const c = cache[key] || (cache[key] = new Map());
        let v = c.get(ch);
        if (v === undefined) {
          const f = fkFonts[key];
          const g = f.glyphForCodePoint(ch.codePointAt(0));
          v = g.advanceWidth / f.unitsPerEm;
          c.set(ch, v);
        }
        return v;
      },
      width(key, s, z) { let w = 0; for (const ch of s) w += this.adv(key, ch); return w * z; },
      has(key, ch) { return fkFonts[key].hasGlyphForCodePoint(ch.codePointAt(0)); },
    };
  }

  // ---------- line breaking (with basic 禁則) ----------
  const NO_START = new Set([...'、。，．,.)）]］｝〕〉》」』】〙〗〟’”｠»ゝゞーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖ々〻‐゠–〜～?!？！‼⁇⁈⁉・:;：；%％']);
  const NO_END = new Set([...'(（[［｛〔〈《「『【〘〖〝‘“｟«']);
  const isSpace = (t) => /^[ \t]+$/.test(t);
  function tokenize(s) {
    const out = []; const re = /[\x21-\x7E]+|[ \t]+|[\s\S]/gu; let m;
    while ((m = re.exec(s))) out.push(m[0]);
    return out;
  }

  function wrapOne(meas, f, z, text, maxW) {
    const toks = tokenize(text);
    const lines = []; let cur = []; let curW = 0;
    const tw = (t) => meas.width(f, t, z);
    const flush = () => {
      while (cur.length && isSpace(cur[cur.length - 1])) cur.pop();
      const s = cur.join('');
      lines.push({ s, w: tw(s) }); cur = []; curW = 0;
    };
    let guard = 0;
    for (let i = 0; i < toks.length; i++) {
      if (++guard > 20000) break;
      const t = toks[i];
      if (cur.length === 0 && isSpace(t)) continue;
      const w = tw(t);
      if (curW + w <= maxW + 0.01) { cur.push(t); curW += w; continue; }
      if (t.length > 1 && /^[\x21-\x7E]+$/.test(t) && w > maxW * 0.6) { toks.splice(i, 1, ...[...t]); i--; continue; }
      if (cur.length === 0) { cur.push(t); curW += w; flush(); continue; }
      if (isSpace(t)) { flush(); continue; }
      const first = [...t][0];
      if (NO_START.has(first) && cur.length >= 2) {
        const moved = [cur.pop()];
        while (cur.length >= 2 && NO_START.has([...moved[0]][0])) moved.unshift(cur.pop());
        if (tw(moved.join('')) + w <= maxW) { flush(); cur = moved; curW = tw(moved.join('')); i--; continue; }
        cur.push(...moved);
      }
      const moved = [];
      while (cur.length >= 2 && NO_END.has(cur[cur.length - 1])) moved.unshift(cur.pop());
      flush(); cur = moved; curW = tw(moved.join('')); i--;
    }
    if (cur.length || lines.length === 0) flush();
    return lines;
  }

  // Returns lines; `last` marks the final line of each hard paragraph (not justified).
  function wrap(meas, f, z, text, maxW) {
    const out = [];
    String(text || '').split(/\r?\n/).forEach((p) => {
      const ls = wrapOne(meas, f, z, p, maxW);
      ls[ls.length - 1].last = true;
      out.push(...ls);
    });
    return out;
  }

  // Pack "label：value" items onto lines without breaking inside an item (unless one item is longer than a line).
  function wrapItems(meas, f, z, items, maxW, sep) {
    sep = sep || '　／　';
    const lines = []; let cur = '';
    items.filter(Boolean).forEach((it) => {
      const cand = cur ? cur + sep + it : it;
      if (meas.width(f, cand, z) <= maxW) { cur = cand; return; }
      if (cur) lines.push(cur);
      if (meas.width(f, it, z) <= maxW) cur = it;
      else { const w = wrapOne(meas, f, z, it, maxW); w.slice(0, -1).forEach((l) => lines.push(l.s)); cur = w[w.length - 1].s; }
    });
    if (cur) lines.push(cur);
    return lines.map((s2) => ({ s: s2, w: meas.width(f, s2, z), last: true }));
  }
  const metaItems = (s) => str(s).split(/\s*[／/]\s*/).filter(Boolean);

  function textOp(ops, s, x, yTop, lead, f, z, c, tc) {
    if (!s) return;
    ops.push({ t: 'text', s, x, y: yTop + (lead - z) / 2 + ASC * z, f, z, c, tc: tc || 0 });
  }
  // "2019年6月" / "2023年11月" in a column: the year at x, the month right-aligned after it, so the
  // months line up although the digits of the proportional font differ in width
  function dateOp(ops, s, x, yTop, lead, f, z, c) {
    const m = /^(\d{4}年)(\d{1,2}月)$/.exec(s);
    if (!m || !dateOp.meas) { textOp(ops, s, x, yTop, lead, f, z, c); return; }
    const yw = dateOp.meas.width(f, '0000年', z);
    textOp(ops, m[1], x, yTop, lead, f, z, c);
    textOp(ops, m[2], x + yw + dateOp.meas.width(f, '00月', z) - dateOp.meas.width(f, m[2], z), yTop, lead, f, z, c);
  }
  function lineOp(ops, x, yTop, lead, ln, f, z, c, maxW, justify) {
    let tc = 0;
    if (justify && !ln.last) {
      const n = [...ln.s].length; const extra = maxW - ln.w;
      if (n > 1 && extra > 0.05 && extra / (n - 1) <= z * 0.06) tc = extra / (n - 1);
    }
    textOp(ops, ln.s, x, yTop, lead, f, z, c, tc);
  }

  // ---------- document model ----------
  function str(v) { return v == null ? '' : String(v).trim(); }
  function normDate(v) {
    let s = str(v).replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
    s = s.replace(/(\d{4})\s*[.\/\-]\s*(\d{1,2})(?!\d)/g, (m, y, mo) => `${y}年${+mo}月`);
    s = s.replace(/\s*[~〜–―ー-]\s*(?=\d{4}|現在|在籍中)/g, '～').replace(/\s*～\s*/g, '～');
    return s;
  }
  function arr(v) { return Array.isArray(v) ? v : (v ? [v] : []); }
  function normalizeDoc(d) {
    d = d || {};
    return {
      title: str(d.title) || '職務経歴書',
      date: str(d.date),
      name: str(d.name),
      summary: str(d.summary),
      careers: arr(d.careers).map((c) => ({
        company: str(c.company), period: normDate(c.period), business: str(c.business), meta: str(c.meta),
        blocks: arr(c.blocks).map((b) => ({
          period: normDate(b.period), heading: str(b.heading),
          duties: arr(b.duties).map(str).filter(Boolean),
          achievements: arr(b.achievements).map(str).filter(Boolean),
        })),
      })).filter((c) => c.company || c.blocks.length),
      skills: arr(d.skills).map(str).filter(Boolean),
      tech: arr(d.tech).map(str).filter(Boolean),
      qualifications: arr(d.qualifications).map((q) => (typeof q === 'string' ? { date: '', name: str(q) } : { date: normDate(q.date), name: str(q.name) })).filter((q) => q.name),
      pr: arr(d.pr).map((p) => ({ heading: str(p.heading), body: str(p.body) })).filter((p) => p.heading || p.body),
      highlights: arr(d.highlights).map((h) => ({ value: str(h.value), label: str(h.label) })).filter((h) => h.value),
    };
  }

  function splitPeriod(p) {
    p = str(p);
    const i = p.search(/[～〜~\-–―]/);
    if (i > 0) return [p.slice(0, i).trim(), '～' + p.slice(i + 1).trim()];
    return [p];
  }

  // ---------- building boxes ----------
  const EN = { '職務要約': 'SUMMARY', '職務経歴': 'CAREER', '活かせる経験・知識・技術': 'SKILLS', 'スキル・ツール・語学': 'TOOLS & LANGUAGES', '資格・免許': 'CERTIFICATIONS', '自己PR': 'STRENGTHS' };

  // Split "ツール：A、B（x、y）、C" into a category and items, respecting brackets.
  function splitChips(line) {
    let cat = '', rest = line;
    const m = /^([^：:]{1,12})[：:]\s*(.*)$/.exec(line);
    if (m) { cat = m[1].trim(); rest = m[2]; }
    const items = []; let cur = '', depth = 0;
    for (const ch of rest) {
      if ('（(「『[【'.includes(ch)) depth++;
      if ('）)」』]】'.includes(ch)) depth = Math.max(0, depth - 1);
      if (depth === 0 && '、,，／/'.includes(ch)) { if (cur.trim()) items.push(cur.trim()); cur = ''; } else cur += ch;
    }
    if (cur.trim()) items.push(cur.trim());
    return { cat, items };
  }

  function build(docIn, themeKey, meas, opts) {
    const doc = normalizeDoc(docIn);
    dateOp.meas = meas;
    const th = resolveTheme(themeKey, opts);
    const prem = th.head === 'premium';
    const B = [];
    let section = 'head';
    const add = (b) => { b.section = section; B.push(b); return b; };
    const space = (h, keep) => add({ h, space: true, keepWithNext: !!keep, draw() {} });
    const keepPrev = () => { for (let i = B.length - 1; i >= 0; i--) { if (!B[i].space) { B[i].keepWithNext = true; return; } } };
    const dot = (ops, cx, cy, r, fill) => ops.push({ t: 'circle', x: cx, y: cy, r, fill });

    function para(text, o) {
      const x = o.x || 0, w = (o.w || CW) - x, hang = o.hang || 0;
      const lines = wrap(meas, o.f, o.z, text, w - hang);
      lines.forEach((ln, i) => {
        const n = lines.length;
        add({
          h: o.lead, text: true,
          keepWithNext: (n >= 2 && i === 0) || (n >= 3 && i === n - 2) || (o.keepLast && i === n - 1),
          draw(ops, X, Y) {
            if (i === 0 && o.bullet === 'dot') dot(ops, X + x + o.z * 0.32, Y + (o.lead - o.z) / 2 + 0.52 * o.z, o.z * 0.16, th.accent);
            else if (i === 0 && o.bullet) textOp(ops, o.bullet, X + x, Y, o.lead, o.bf || o.f, o.z, o.bc || o.c);
            if (i === 0 && o.bar) ops.push({ t: 'rect', x: X, y: Y + 3.5, w: 2.6, h: o.lead - 7, fill: th.accent });
            lineOp(ops, X + x + hang, Y, o.lead, ln, o.f, o.z, o.c, w - hang, o.justify !== false);
          },
        });
      });
      return lines.length;
    }

    function heading(label) {
      space(prem ? 18 : th.head === 'bar' ? S.headBefore + 4 : S.headBefore);
      add({
        h: S.headLead + S.headAfter, keepWithNext: true,
        draw(ops, X, Y) {
          if (prem) {
            textOp(ops, label, X, Y, S.headLead, th.bold, 12, th.accent);
            const w = meas.width(th.bold, label, 12);
            const en = EN[label] || ''; const n = en.length;
            textOp(ops, en, X + w + 9, Y + 1.2, S.headLead, th.bold, 6.8, th.sub, 1.3);
            ops.push({ t: 'rect', x: X, y: Y + S.headLead, w: CW, h: 0.6, fill: th.grid });
            void n;
          } else if (th.head === 'bar') {
            ops.push({ t: 'rect', x: X, y: Y + 4.5, w: 3.2, h: S.headLead - 9, fill: th.accent });
            textOp(ops, label, X + 10, Y, S.headLead, th.bold, S.head, th.accent);
          } else {
            textOp(ops, '■' + label, X, Y, S.headLead, th.bold, S.head, th.text);
            ops.push({ t: 'line', x1: X, y1: Y + S.headLead, x2: X + CW, y2: Y + S.headLead, w: 0.8, c: th.rule });
          }
        },
      });
    }

    // --- title block
    if (prem) {
      add({
        h: 60, draw(ops, X, Y) {
          textOp(ops, doc.title, X, Y, 14, th.bold, 8.6, th.accent, 2.6);
          if (doc.name) {
            let z = 22; while (z > 14 && meas.width(th.bold, doc.name, z) + 1.5 * [...doc.name].length > CW - 150) z -= 1;
            textOp(ops, doc.name, X, Y + 16, 32, th.bold, z, th.text, 1.5);
          }
          if (doc.date) { const w = meas.width(th.body, doc.date, 8.8); textOp(ops, doc.date, X + CW - w, Y + 30, 16, th.body, 8.8, th.sub); }
          ops.push({ t: 'rect', x: X, y: Y + 55, w: CW, h: 0.6, fill: th.grid });
          ops.push({ t: 'rect', x: X, y: Y + 54.2, w: 40, h: 2.2, fill: th.accent });
        },
      });
      const hs = doc.highlights.slice(0, 3);
      if (hs.length) {
        space(14);
        const n = hs.length, gap = 10, tW = (CW - gap * (n - 1)) / n, inW = tW - 24;
        // the label in at most 2 lines, re-wrapped narrower when its last line would be a few characters alone
        const labelLines = hs.map((hl) => {
          let ls = wrap(meas, th.body, 8.2, hl.label, inW);
          for (let k = 1; ls.length === 2 && [...ls[1].s].length < 5 && k <= 6; k++) {
            const tryLs = wrap(meas, th.body, 8.2, hl.label, inW - k * 12);
            if (tryLs.length === 2) ls = tryLs; else break;
          }
          return ls.slice(0, 2);
        });
        const maxL = Math.max(...labelLines.map((l) => l.length));
        const tH = 22 + 26 + maxL * 11.5;
        const fillT = mix(th.accent, '#ffffff', 0.94), lineT = mix(th.accent, '#ffffff', 0.7);
        add({
          h: tH, keepWithNext: false, draw(ops, X, Y) {
            hs.forEach((hl, i) => {
              const x = X + i * (tW + gap); const ls = labelLines[i];
              ops.push({ t: 'rrect', x, y: Y, w: tW, h: tH, r: 4, fill: fillT, stroke: lineT, sw: 0.5 });
              const y0 = Y + (tH - (26 + ls.length * 11.5)) / 2;
              // "8.1%→4.3%": the before value small and grey; "前年比132%": the words before the number likewise
              const arrow = hl.value.split('→');
              const pre = arrow.length === 2 ? arrow[0].trim() + ' → ' : (/^(\D+?)\s*(\d.*)$/.exec(hl.value) || [])[1] || '';
              const main = arrow.length === 2 ? arrow[1].trim() : pre ? hl.value.slice(hl.value.indexOf(pre) + pre.length).trim() : hl.value;
              let z = 17; const wOf = (zz) => (pre ? meas.width(th.body, pre, zz * 0.62) + 2 : 0) + meas.width(th.bold, main, zz);
              while (z > 10.5 && wOf(z) > inW) z -= 0.5;
              const za = z * 0.62; const wa = pre ? meas.width(th.body, pre, za) + 2 : 0;
              if (pre) textOp(ops, pre, x + 12, y0 + (z - za) * 0.62, 26, th.body, za, th.sub);
              textOp(ops, main, x + 12 + wa, y0, 26, th.bold, z, th.accent);
              ls.forEach((ln, j) => textOp(ops, ln.s, x + 12, y0 + 26 + j * 11.5, 11.5, th.body, 8.2, th.sub));
            });
          },
        });
      }
    } else {
      add({
        h: 30, draw(ops, X, Y) {
          const t = doc.title; const n = [...t].length; const tz = th.title || S.title, tc = th.titleTc != null ? th.titleTc : S.titleTc;
          const w = meas.width(th.bold, t, tz) + tc * (n - 1);
          textOp(ops, t, X + (CW - w) / 2, Y, 30, th.bold, tz, th.text, tc);
        },
      });
      space(8);
      if (doc.date) add({ h: 15, draw(ops, X, Y) { const w = meas.width(th.body, doc.date, 9); textOp(ops, doc.date, X + CW - w, Y, 15, th.body, 9, th.sub); } });
      if (doc.name) add({ h: 24, draw(ops, X, Y) {
        const wn = meas.width(th.bold, doc.name, 13) + 1 * ([...doc.name].length - 1); const wl = meas.width(th.body, '氏名', 9);
        textOp(ops, doc.name, X + CW - wn, Y, 24, th.bold, 13, th.text, 1);
        textOp(ops, '氏名', X + CW - wn - 10 - wl, Y + 1.5, 24, th.body, 9, th.sub);
      } });
    }

    // --- 職務要約
    if (doc.summary) {
      section = 'summary'; heading('職務要約');
      para(doc.summary, { f: th.body, z: S.body, lead: S.bodyLead, c: th.text });
    }

    // --- 職務経歴
    if (doc.careers.length) {
      section = 'career'; heading('職務経歴');
      if (prem) careerTimeline(); else careerTable();
    }

    function rightLines(b, rightW, style) {
      const R = [];
      const pushLines = (text, o) => wrap(meas, o.f, o.z, text, rightW - (o.hang || 0)).forEach((ln, i) => R.push({ ln, o, first: i === 0 }));
      if (b.heading) pushLines(b.heading, { f: th.bold, z: style.headZ, c: th.text, justify: false, kind: 'heading' });
      const group = (label, items, bullet) => {
        if (!items.length) return;
        const gap = R.length ? style.gap : 0;
        R.push({ ln: { s: label, w: 0, last: true }, o: { f: th.bold, z: style.labelZ, c: style.labelC, justify: false, kind: 'label' }, first: true, gap });
        items.forEach((it) => pushLines(it, { f: th.body, z: S.tbl, c: th.text, hang: S.tbl * 0.85, bullet, kind: 'bullet' }));
      };
      group(style.l1, b.duties, '・');
      group(style.l2, b.achievements, style.achBullet);
      return R;
    }
    function drawRight(ops, r, x, yT, lead, rightW) {
      const hang = r.o.hang || 0;
      if (r.first && r.o.bullet === 'dot') dot(ops, x + r.o.z * 0.3, yT + (lead - r.o.z) / 2 + 0.52 * r.o.z, r.o.z * 0.17, th.accent);
      else if (r.first && r.o.bullet === 'square') { const q = r.o.z * 0.36; ops.push({ t: 'rect', x: x + r.o.z * 0.12, y: yT + (lead - r.o.z) / 2 + 0.52 * r.o.z - q / 2, w: q, h: q, fill: th.text }); }
      else if (r.first && r.o.bullet) textOp(ops, r.o.bullet, x - r.o.z * 0.12, yT, lead, r.o.f, r.o.z, th.sub);
      lineOp(ops, x + hang, yT, lead, r.ln, r.o.f, r.o.z, r.o.c, rightW - hang, r.o.justify !== false);
    }

    function careerTable() {
      const x0 = 0, x1 = S.colPeriod, x2 = CW;
      const rightW = CW - S.colPeriod - S.padX * 2;
      const leftW = S.colPeriod - S.padX * 2;
      const FR = th.frame || th.grid, FW = th.frameW || 0.5, GW = th.gridW || 0.5;
      const vlines = (ops, X, Y, h) => { [[x0, FR, FW], [x1, th.grid, GW], [x2, FR, FW]].forEach(([x, c, w]) => ops.push({ t: 'line', x1: X + x, y1: Y, x2: X + x, y2: Y + h, w, c })); };
      const hline = (ops, X, Y, outer) => ops.push({ t: 'line', x1: X, y1: Y, x2: X + CW, y2: Y, w: outer ? FW : GW, c: outer ? FR : th.grid });
      const sides = (ops, X, Y, h) => [0, CW].forEach((x) => ops.push({ t: 'line', x1: X + x, y1: Y, x2: X + x, y2: Y + h, w: FW, c: FR }));
      const style = { headZ: S.tbl, labelZ: 9, labelC: th.text, gap: 4, l1: '【業務内容】', l2: '【実績・取り組み】', achBullet: th.achBullet || '・' };

      doc.careers.forEach((c, ci) => {
        section = 'career:' + ci;
        space(ci === 0 ? 2 : 12);
        const innerW = CW - S.padX * 2;
        const periodW = c.period ? meas.width(th.body, c.period, 9) : 0;
        let nameZ = 10.5;
        while (nameZ > 8.5 && meas.width(th.bold, c.company + '（続き）', nameZ) > innerW) nameZ -= 0.5;
        const periodInline = !c.period || meas.width(th.bold, c.company, nameZ) + periodW + 16 <= innerW;
        const metaLines = wrapItems(meas, th.body, S.small, [!periodInline ? '在籍期間：' + c.period : '', c.business ? '事業内容：' + c.business : '', ...metaItems(c.meta)], innerW);

        const bandBoxes = (cont) => {
          const out = [];
          const nameText = c.company + (cont ? '（続き）' : '');
          const h1 = 8 + 16 + (metaLines.length && !cont ? 0 : 6);
          out.push({
            h: h1, keepWithNext: true, isBand: true,
            draw(ops, X, Y) {
              ops.push({ t: 'rect', x: X, y: Y, w: CW, h: h1, fill: th.band });
              hline(ops, X, Y, true); sides(ops, X, Y, h1);
              if (th.bandRule) ops.push({ t: 'rect', x: X, y: Y, w: CW, h: th.bandRule, fill: th.accent });
              textOp(ops, nameText, X + S.padX, Y + 8, 16, th.bold, nameZ, th.text);
              if (c.period && periodInline && !(cont && meas.width(th.bold, nameText, nameZ) + periodW + 16 > innerW)) textOp(ops, c.period, X + CW - S.padX - periodW, Y + 8, 16, th.body, 9, th.text);
            },
          });
          if (!cont) {
            metaLines.forEach((ln, i) => {
              const last = i === metaLines.length - 1; const h = S.smallLead + (last ? 6 : 0);
              out.push({
                h, keepWithNext: true, isBand: true,
                draw(ops, X, Y) {
                  ops.push({ t: 'rect', x: X, y: Y, w: CW, h, fill: th.band }); sides(ops, X, Y, h);
                  lineOp(ops, X + S.padX, Y, S.smallLead, ln, th.body, S.small, th.sub, innerW, true);
                },
              });
            });
          }
          out.push({
            h: 18, keepWithNext: true, isBand: true,
            draw(ops, X, Y) {
              ops.push({ t: 'rect', x: X, y: Y, w: CW, h: 18, fill: th.fill });
              hline(ops, X, Y); hline(ops, X, Y + 18); vlines(ops, X, Y, 18);
              const a = '期間', b = '業務内容';
              textOp(ops, a, X + (S.colPeriod - meas.width(th.bold, a, 8)) / 2, Y, 18, th.bold, 8, th.sub);
              textOp(ops, b, X + S.colPeriod + (CW - S.colPeriod - meas.width(th.bold, b, 8)) / 2, Y, 18, th.bold, 8, th.sub);
            },
          });
          return out;
        };
        const table = { contHeader: () => bandBoxes(true).map((b) => Object.assign(b, { isContHeader: true, section: 'career:' + ci })) };
        bandBoxes(false).forEach(add);

        c.blocks.forEach((b, bi) => {
          const lastBlock = bi === c.blocks.length - 1;
          const R = rightLines(b, rightW, style);
          const L = splitPeriod(b.period).flatMap((p) => wrap(meas, th.body, 9, p, leftW).map((l) => l.s));
          const n = Math.max(R.length, L.length, 1);
          for (let i = 0; i < n; i++) {
            const r = R[i]; const first = i === 0; const last = i === n - 1;
            const gap = r && r.gap ? r.gap : 0;
            const h = S.tblLead + gap + (first ? S.padY : 0) + (last ? S.padY : 0);
            const isLabel = r && r.o.kind === 'label'; const isHeading = r && r.o.kind === 'heading';
            add({
              h, text: true, table,
              keepWithNext: keepRow(R, i, n),
              draw(ops, X, Y, ctx) {
                vlines(ops, X, Y, h);
                if (first || ctx.pageFirst) hline(ops, X, Y);
                if (last || ctx.pageLast) hline(ops, X, Y + h, !!ctx.pageLast || (last && lastBlock));
                const yT = Y + (first ? S.padY : 0) + gap;
                if (L[i]) textOp(ops, L[i], X + S.padX, yT, S.tblLead, th.body, 9, th.text);
                if (r) drawRight(ops, r, X + S.colPeriod + S.padX, yT, S.tblLead, rightW);
              },
            });
          }
        });
      });
    }

    function careerTimeline() {
      const PC = 94, LX = PC - 13, rightW = CW - PC;
      const style = { headZ: 10, labelZ: 7.8, labelC: th.accent, gap: 4, l1: '主な業務', l2: '主な実績', achBullet: 'dot' };
      doc.careers.forEach((c, ci) => {
        section = 'career:' + ci;
        space(ci === 0 ? 4 : 16);
        const periodW = c.period ? meas.width(th.body, c.period, 8.8) : 0;
        let nameZ = 11.5;
        while (nameZ > 9 && meas.width(th.bold, c.company, nameZ) + periodW + 14 > CW) nameZ -= 0.5;
        while (nameZ > 8 && meas.width(th.bold, c.company, nameZ) > CW) nameZ -= 0.5;
        const periodInline = !c.period || meas.width(th.bold, c.company, nameZ) + periodW + 14 <= CW;
        const head = (cont) => ({
          h: 21, keepWithNext: true, isBand: true,
          draw(ops, X, Y) {
            textOp(ops, c.company + (cont ? '（続き）' : ''), X, Y, 21, th.bold, cont ? 9.5 : nameZ, cont ? th.sub : th.text);
            if (c.period && !cont && periodInline) textOp(ops, c.period, X + CW - periodW, Y + 1, 21, th.body, 8.8, th.sub);
          },
        });
        add(head(false));
        wrapItems(meas, th.body, 8.2, [!periodInline ? '在籍期間：' + c.period : '', c.business ? '事業内容：' + c.business : '', ...metaItems(c.meta)], CW).forEach((ln) => add({ h: 13, keepWithNext: true, isBand: true, draw(ops, X, Y) { lineOp(ops, X, Y, 13, ln, th.body, 8.2, th.sub, CW, true); } }));
        space(7, true);
        const table = { contHeader: () => [Object.assign(head(true), { isContHeader: true, section: 'career:' + ci })] };
        c.blocks.forEach((b, bi) => {
          if (bi > 0) add({ h: 9, table, keepWithNext: true, draw(ops, X, Y) { ops.push({ t: 'rect', x: X + LX - 0.5, y: Y, w: 1, h: 9, fill: th.grid }); } });
          const R = rightLines(b, rightW, style);
          const L = splitPeriod(b.period).flatMap((p) => wrap(meas, th.body, 8.6, p, LX - 12).map((l) => l.s));
          const n = Math.max(R.length, L.length, 1);
          const lastBlock = bi === c.blocks.length - 1;
          for (let i = 0; i < n; i++) {
            const r = R[i]; const gap = r && r.gap ? r.gap : 0; const h = S.tblLead + gap;
            const isLabel = r && r.o.kind === 'label'; const isHeading = r && r.o.kind === 'heading';
            add({
              h, text: true, table,
              keepWithNext: keepRow(R, i, n),
              draw(ops, X, Y) {
                const yT = Y + gap;
                const top = i === 0 ? yT + S.tblLead / 2 : Y;
                const bot = lastBlock && i === n - 1 ? Y + h - 4 : Y + h;
                ops.push({ t: 'rect', x: X + LX - 0.5, y: top, w: 1, h: Math.max(0, bot - top), fill: th.grid });
                if (i === 0) { dot(ops, X + LX, yT + S.tblLead / 2, 4.4, '#ffffff'); dot(ops, X + LX, yT + S.tblLead / 2, 3, th.accent); }
                if (L[i]) textOp(ops, L[i], X, yT, S.tblLead, i === 0 ? th.bold : th.body, 8.6, i === 0 ? th.text : th.sub);
                if (r) drawRight(ops, r, X + PC, yT, S.tblLead, rightW);
              },
            });
          }
        });
      });
    }

    // --- 活かせる経験・知識・技術
    if (doc.skills.length) {
      section = 'skills'; heading('活かせる経験・知識・技術');
      doc.skills.forEach((s) => para(s, { f: th.body, z: S.body, lead: S.bodyLead, c: th.text, bullet: prem ? 'dot' : '・', hang: S.body, bc: th.sub }));
    }
    // --- スキル・ツール・語学
    if (doc.tech.length) {
      section = 'tech'; heading('スキル・ツール・語学');
      if (prem) {
        doc.tech.forEach((line, li) => {
          const { cat, items } = splitChips(line);
          const catW = cat ? 66 : 0; const z = 8.8, padX = 7, chH = 17, rowH = 22, g = 5;
          const rows = [[]]; let x = 0; const maxW = CW - catW;
          items.forEach((it) => {
            const w = Math.min(meas.width(th.body, it, z) + padX * 2, maxW);
            if (x > 0 && x + w > maxW) { rows.push([]); x = 0; }
            rows[rows.length - 1].push({ it, w, x }); x += w + g;
          });
          if (li > 0) space(2);
          rows.forEach((row, ri) => add({
            h: rowH, text: true, keepWithNext: ri < rows.length - 1,
            draw(ops, X, Y) {
              if (ri === 0 && cat) textOp(ops, cat, X, Y + (rowH - chH) / 2, chH, th.bold, 8.2, th.sub);
              row.forEach((c) => {
                ops.push({ t: 'rrect', x: X + catW + c.x, y: Y + (rowH - chH) / 2, w: c.w, h: chH, r: chH / 2, fill: th.tint });
                const ln = wrap(meas, th.body, z, c.it, c.w - padX * 2)[0];
                textOp(ops, ln.s, X + catW + c.x + padX, Y + (rowH - chH) / 2, chH, th.body, z, th.text);
              });
            },
          }));
        });
      } else {
        doc.tech.forEach((s) => para(s, { f: th.body, z: S.body, lead: S.bodyLead, c: th.text, bullet: '・', hang: S.body, bc: th.sub }));
      }
    }
    // --- 保有資格
    if (doc.qualifications.length) {
      section = 'qual'; heading('資格・免許');
      doc.qualifications.forEach((q) => {
        const dateW = 84;
        const lines = wrap(meas, th.body, S.body, q.name, CW - dateW);
        lines.forEach((ln, i) => add({
          h: S.bodyLead, text: true, keepWithNext: lines.length > 1 && i < lines.length - 1,
          draw(ops, X, Y) {
            if (i === 0 && q.date) dateOp(ops, q.date, X, Y, S.bodyLead, th.body, prem ? 9 : S.body, prem ? th.sub : th.text);
            lineOp(ops, X + dateW, Y, S.bodyLead, ln, th.body, S.body, th.text, CW - dateW, true);
          },
        }));
      });
    }
    // --- 自己PR
    if (doc.pr.length) {
      section = 'pr'; heading('自己PR');
      doc.pr.forEach((p, i) => {
        if (i > 0) space(prem ? 11 : 9);
        if (p.heading) {
          if (prem) para(p.heading, { f: th.bold, z: 10.5, lead: S.bodyLead + 1, c: th.text, justify: false, keepLast: true, x: 10, bar: true });
          else {
            const label = th.head === 'bar' ? p.heading : '【' + p.heading + '】';
            para(label, { f: th.bold, z: 10.5, lead: S.bodyLead + 1, c: th.head === 'bar' ? th.accent : th.text, justify: false, keepLast: true });
          }
        }
        if (p.body) para(p.body, { f: th.body, z: S.body, lead: S.bodyLead, c: th.text, x: prem ? 10 : 0 });
      });
    }
    section = 'end';
    keepPrev();
    space(4);
    add({ h: 18, draw(ops, X, Y) { const w = meas.width(th.body, '以上', 10); textOp(ops, '以上', X + CW - w, Y, 18, th.body, 10, th.text); } });
    return { boxes: B, theme: th, doc };
  }

  // Rows of one career block: a page may break inside a block longer than 4 rows, but not after its heading,
  // a label or its first line, nor before its last two lines (the next page repeats the company as （続き）).
  // So page 1 fills instead of a whole company moving to page 2.
  function keepRow(R, i, n) {
    const r = R[i];
    if (r && (r.o.kind === 'label' || r.o.kind === 'heading')) return true;
    if (i >= n - 1) return false;
    if (i < 2 || i >= n - 2) return true;
    return n <= 4;
  }

  // ---------- pagination ----------
  function paginate(boxes) {
    const top = M.t, bottom = PAGE_H - M.b, ph = bottom - top;
    const pages = []; let cur = []; let y = top;
    const close = () => { if (cur.length) cur[cur.length - 1].ctx.pageLast = true; pages.push({ items: cur, used: y - top }); cur = []; y = top; };
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (b.space && cur.length === 0) continue;
      let gh = b.h, j = i;
      while (boxes[j].keepWithNext && j + 1 < boxes.length && gh < ph * 0.5) { j++; gh += boxes[j].h; }
      if (cur.length && y + gh > bottom + 0.01) {
        close();
        if (b.space) continue;
      } else if (cur.length && y + b.h > bottom + 0.01) {
        close();
        if (b.space) continue;
      }
      if (cur.length === 0 && b.table) {
        for (const hb of b.table.contHeader()) { cur.push({ b: hb, y, ctx: {} }); y += hb.h; }
      }
      const prev = cur[cur.length - 1];
      cur.push({ b, y, ctx: { pageFirst: !prev || !!prev.b.isContHeader || (!!b.table && !prev.b.table && !prev.b.isBand) } });
      y += b.h;
    }
    close();
    return pages;
  }

  function layout(doc, themeKey, meas, opts) {
    const built = build(doc, themeKey, meas, opts);
    const pages = paginate(built.boxes);
    const th = built.theme;
    const N = pages.length;
    const out = pages.map((p, pi) => {
      const ops = [];
      p.items.forEach((it) => it.b.draw(ops, M.l, it.y, it.ctx));
      if (N > 1) {
        const s = (built.doc.name ? built.doc.name + '　' : '') + `${pi + 1} / ${N}`; const w = meas.width(th.body, s, 8);
        textOp(ops, s, (PAGE_W - w) / 2, PAGE_H - 36, 12, th.body, 8, th.sub);
      }
      return { ops, used: p.used };
    });
    const ph = PAGE_H - M.t - M.b;
    // section line stats (for the shortening prompt)
    const lines = {};
    built.boxes.forEach((b) => { if (b.text) { const k = String(b.section).split(':')[0]; lines[k] = (lines[k] || 0) + 1; } });
    return { pages: out, pageCount: N, lastFill: out[N - 1].used / ph, contentHeight: ph, lines, doc: built.doc, theme: themeKey };
  }

  // How far over the target page count we are (in body lines / chars).
  function fitReport(lay, maxPages) {
    const ph = lay.contentHeight;
    const N = lay.pageCount;
    const charsPerLine = Math.floor(CW / S.body);
    let overPt = 0, reason = '';
    if (N > maxPages) {
      overPt = (N - maxPages - 1) * ph + lay.pages[N - 1].used + S.bodyLead * 1.5;
      reason = 'over';
    } else if (N > 1 && lay.lastFill < 0.1) {
      overPt = lay.pages[N - 1].used + S.bodyLead * 1.5;
      reason = 'orphan';
    }
    const overLines = Math.ceil(overPt / S.bodyLead);
    return { ok: overPt === 0, reason, pages: N, overLines, overChars: overLines * Math.round(charsPerLine * 0.8), charsPerLine };
  }

  function missingChars(doc, themeKey, meas) {
    const th = THEMES[themeKey] || THEMES.standard;
    const set = new Set();
    const txt = JSON.stringify(normalizeDoc(doc));
    for (const ch of txt) { if (ch.codePointAt(0) > 0x7f && !meas.has(th.body, ch)) set.add(ch); }
    return [...set];
  }

  // Replace characters the fonts cannot draw (e.g. Simplified Chinese) using a char map.
  function fixChars(obj, map) {
    if (typeof obj === 'string') return [...obj].map((ch) => map[ch] || ch).join('');
    if (Array.isArray(obj)) return obj.map((v) => fixChars(v, map));
    if (obj && typeof obj === 'object') { const o = {}; for (const k in obj) o[k] = fixChars(obj[k], map); return o; }
    return obj;
  }


  // ---------- 履歴書 (厚生労働省様式例に準拠した A4×2枚) ----------
  function toEra(y, m) {
    const v = y * 12 + m;
    if (v >= 2019 * 12 + 5) { const n = y - 2018; return '令和' + (n === 1 ? '元' : n); }
    if (v >= 1989 * 12 + 1) { const n = y - 1988; return '平成' + (n === 1 ? '元' : n); }
    if (v >= 1926 * 12 + 12) { const n = y - 1925; return '昭和' + (n === 1 ? '元' : n); }
    return String(y);
  }
  function ymParts(s) { const m = /(\d{4})\D+(\d{1,2})/.exec(String(s || '')) || /^(\d{4})$/.exec(String(s || '')); return m ? { y: +m[1], m: m[2] ? +m[2] : 0 } : null; }
  function layoutRireki(d, meas) {
    d = d || {};
    const F = 'mincho-r', INK = '#111111', SUB = '#444444', GRID = '#222222';
    const L = 42, R = PAGE_W - 42, W = R - L;
    const era = d.era === 'jp';
    const yStr = (y, m) => (era ? toEra(y, m || 1) : String(y));
    const warn = [];
    const p1 = [], p2 = [];
    const box = (ops, x, y, w, h, lw) => { const t = lw || 0.6; ops.push({ t: 'line', x1: x, y1: y, x2: x + w, y2: y, w: t, c: GRID }, { t: 'line', x1: x, y1: y + h, x2: x + w, y2: y + h, w: t, c: GRID }, { t: 'line', x1: x, y1: y, x2: x, y2: y + h, w: t, c: GRID }, { t: 'line', x1: x + w, y1: y, x2: x + w, y2: y + h, w: t, c: GRID }); };
    const hl = (ops, x1, x2, y, lw) => ops.push({ t: 'line', x1, y1: y, x2, y2: y, w: lw || 0.4, c: GRID });
    const vl = (ops, x, y1, y2, lw) => ops.push({ t: 'line', x1: x, y1, x2: x, y2, w: lw || 0.4, c: GRID });
    const fitText = (ops, s, x, yTop, h, maxW, z, c, align) => {
      s = String(s || ''); if (!s) return;
      let zz = z; while (zz > 6.5 && meas.width(F, s, zz) > maxW) zz -= 0.25;
      if (meas.width(F, s, zz) > maxW) warn.push('欄に入りきらない文字があります：' + s.slice(0, 12) + '…');
      const w = meas.width(F, s, zz); const xx = align === 'center' ? x + (maxW - w) / 2 : align === 'right' ? x + maxW - w : x;
      textOp(ops, s, xx, yTop, h, F, zz, c || INK);
    };
    const label = (ops, s, x, y, z) => textOp(ops, s, x, y, (z || 7.5) * 1.6, F, z || 7.5, SUB);
    const area = (ops, text, x, y, w, h, z0) => {
      let z = z0 || 10.5, lines;
      for (;;) { lines = wrap(meas, F, z, text, w); if (lines.length * z * 1.75 <= h || z <= 7.5) break; z -= 0.5; }
      if (lines.length * z * 1.75 > h) warn.push('「' + String(text).slice(0, 10) + '…」が欄に入りきりません。短くしてください。');
      lines.forEach((ln, i) => { if ((i + 1) * z * 1.75 <= h + 0.1) lineOp(ops, x, y + i * z * 1.75, z * 1.75, ln, F, z, INK, w, true); });
    };

    // ---- page 1: title, photo, name block
    const today = ymParts(d.date) ? d.date : '';
    const dt = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(today || '');
    textOp(p1, '履　歴　書', L, 40, 30, F, 20, INK, 2);
    if (dt) textOp(p1, `${yStr(+dt[1], +dt[2])}年${+dt[2]}月${+dt[3]}日現在`, L + 160, 48, 22, F, 9.5, INK);
    const PW = 85, PH = 113, PX = R - PW, PY = 46;
    if (d.photo) p1.push({ t: 'image', x: PX, y: PY, w: PW, h: PH, src: d.photo });
    else {
      ops_dash(p1, PX, PY, PW, PH);
      ['写真をはる位置', '', '写真をはる必要が', 'ある場合', '1. 縦 36〜40mm', '　 横 24〜30mm', '2. 本人単身胸から上', '3. 裏面のりづけ'].forEach((t, i) => textOp(p1, t, PX + 6, PY + 8 + i * 11.5, 11.5, F, 6.8, SUB));
    }
    const BW = PX - 10 - L, BY = 78;
    const rowK = 16, rowN = 46, rowB = 26;
    box(p1, L, BY, BW, rowK + rowN + rowB, 1.1);
    hl(p1, L, L + BW, BY + rowK, 0.3); hl(p1, L, L + BW, BY + rowK + rowN, 0.6);
    label(p1, 'ふりがな', L + 6, BY + 2);
    fitText(p1, d.furigana, L + 56, BY, rowK, BW - 62, 9, INK);
    label(p1, '氏　　名', L + 6, BY + rowK + 4);
    fitText(p1, d.name, L + 56, BY + rowK, rowN, BW - 62, 20, INK);
    const GW = 92; vl(p1, L + BW - GW, BY + rowK + rowN, BY + rowK + rowN + rowB, 0.6);
    const bd = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(d.birth || '');
    if (bd) {
      const nowD = dt ? new Date(+dt[1], +dt[2] - 1, +dt[3]) : new Date();
      let age = nowD.getFullYear() - +bd[1]; if (nowD.getMonth() + 1 < +bd[2] || (nowD.getMonth() + 1 === +bd[2] && nowD.getDate() < +bd[3])) age--;
      fitText(p1, `${yStr(+bd[1], +bd[2])}年${+bd[2]}月${+bd[3]}日生（満${age}歳）`, L + 10, BY + rowK + rowN, rowB, BW - GW - 16, 10.5, INK);
    } else fitText(p1, '　　　年　　月　　日生　（満　　歳）', L + 10, BY + rowK + rowN, rowB, BW - GW - 16, 10.5, SUB);
    label(p1, '※性別', L + BW - GW + 5, BY + rowK + rowN + 1, 6.8);
    fitText(p1, d.gender, L + BW - GW + 8, BY + rowK + rowN + 6, rowB - 6, GW - 14, 10, INK, 'center');
    textOp(p1, '※「性別」欄：記載は任意です。未記載とすることも可能です。', L, BY + rowK + rowN + rowB + 2, 10, F, 6.8, SUB);

    // ---- address block
    const AY = BY + rowK + rowN + rowB + 15, RC = 150, AW = W - RC;
    const addr = (y, kana, zip, ad, tel, mail, second) => {
      const hK = 16, hA = 44;
      box(p1, L, y, W, hK + hA, 1.1);
      hl(p1, L, L + AW, y + hK, 0.3); vl(p1, L + AW, y, y + hK + hA, 0.6); hl(p1, L + AW, R, y + hK + 6, 0.4);
      label(p1, 'ふりがな', L + 6, y + 2); fitText(p1, kana, L + 56, y, hK, AW - 62, 8.5, INK);
      label(p1, second ? '連 絡 先' : '現 住 所', L + 6, y + hK + 3);
      textOp(p1, '〒' + (zip || ''), L + 56, y + hK + 2, 14, F, 9, INK);
      if (second) textOp(p1, '（現住所以外に連絡を希望する場合のみ記入）', L + 130, y + hK + 2, 14, F, 7, SUB);
      area(p1, ad || '', L + 56, y + hK + 16, AW - 64, hA - 18, 10.5);
      label(p1, '電話', L + AW + 6, y + 2); fitText(p1, tel, L + AW + 30, y + 3, hK + 2, RC - 36, 9, INK);
      label(p1, 'E-mail', L + AW + 6, y + hK + 9); fitText(p1, mail, L + AW + 8, y + hK + 22, 18, RC - 14, 8.5, INK);
      return y + hK + hA;
    };
    let y2 = addr(AY, d.addrKana, d.zip, d.addr, d.tel, d.email, false);
    y2 = addr(y2, d.addr2Kana, d.zip2, d.addr2, d.tel2, d.email2, true);

    // ---- 学歴・職歴 rows
    const YW = 46, MW = 26; const TX = L + YW + MW;
    const rowH = 21.5;
    const table = (ops, y0, nRows, head, rows) => {
      const h = 20 + nRows * rowH;
      box(ops, L, y0, W, h, 1.1); hl(ops, L, R, y0 + 20, 0.6);
      vl(ops, L + YW, y0, y0 + h); vl(ops, TX, y0, y0 + h);
      fitText(ops, '年', L, y0, 20, YW, 9, INK, 'center'); fitText(ops, '月', L + YW, y0, 20, MW, 9, INK, 'center');
      fitText(ops, head, TX, y0, 20, W - (TX - L), 9, INK, 'center');
      for (let i = 1; i < nRows; i++) hl(ops, L, R, y0 + 20 + i * rowH, 0.3);
      rows.slice(0, nRows).forEach((r, i) => {
        const yy = y0 + 20 + i * rowH;
        const ym = ymParts(r.ym);
        if (ym) { fitText(ops, yStr(ym.y, ym.m || 1), L + 2, yy, rowH, YW - 4, 9.5, INK, 'center'); if (ym.m) fitText(ops, String(ym.m), L + YW, yy, rowH, MW, 9.5, INK, 'center'); }
        fitText(ops, r.text, TX + 10, yy, rowH, W - (TX - L) - 20, 10, INK, r.align || 'left');
      });
      return y0 + h;
    };
    const hist = (d.history || []).filter((r) => r && (r.text || r.ym));
    const n1 = Math.floor((PAGE_H - 40 - (y2 + 12) - 20) / rowH);
    table(p1, y2 + 12, n1, '学歴・職歴（各別にまとめて書く）', hist);
    // ---- page 2
    const n2 = 7;
    let yy = table(p2, 40, n2, '学歴・職歴（各別にまとめて書く）', hist.slice(n1));
    if (hist.length > n1 + n2) warn.push(`学歴・職歴が欄に入りきりません（${hist.length}行 / ${n1 + n2}行）。行をまとめてください。`);
    const quals = (d.licenses || []).filter((r) => r && (r.text || r.ym));
    const n3 = 6;
    yy = table(p2, yy + 12, n3, '免許・資格', quals);
    if (quals.length > n3) warn.push(`免許・資格が欄に入りきりません（${quals.length}件 / ${n3}件）。`);
    const bigBox = (y, h, title, text) => {
      box(p2, L, y, W, h, 1.1);
      textOp(p2, title, L + 8, y + 3, 14, F, 7.8, SUB);
      area(p2, text || '', L + 12, y + 22, W - 24, h - 28, 10.5);
      return y + h;
    };
    yy = bigBox(yy + 12, 222, '志望の動機、特技、好きな学科、アピールポイントなど', d.motive);
    bigBox(yy + 12, PAGE_H - 40 - (yy + 12), '本人希望記入欄（特に給料・職種・勤務時間・勤務地・その他についての希望などがあれば記入）', d.hope);
    return { pages: [{ ops: p1, used: 0 }, { ops: p2, used: 0 }], pageCount: 2, warnings: [...new Set(warn)] };
  }
  function ops_dash(ops, x, y, w, h) {
    const seg = (x1, y1, x2, y2) => { const len = Math.hypot(x2 - x1, y2 - y1); const n = Math.floor(len / 4); for (let i = 0; i < n; i += 2) { const a = i / n, b = Math.min(1, (i + 1) / n); ops.push({ t: 'line', x1: x1 + (x2 - x1) * a, y1: y1 + (y2 - y1) * a, x2: x1 + (x2 - x1) * b, y2: y1 + (y2 - y1) * b, w: 0.5, c: '#666666' }); } };
    seg(x, y, x + w, y); seg(x, y + h, x + w, y + h); seg(x, y, x, y + h); seg(x + w, y, x + w, y + h);
  }

  // ---------- TrueType subsetter (glyph IDs retained; pdf-lib's own subsetting drops CJK glyphs) ----------
  function subsetTTF(src, fkFont, codepoints) {
    const u8 = src instanceof Uint8Array ? src : new Uint8Array(src);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const numTables = dv.getUint16(4);
    const T = {};
    for (let i = 0; i < numTables; i++) {
      const o = 12 + i * 16;
      const tag = String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
      T[tag] = { off: dv.getUint32(o + 8), len: dv.getUint32(o + 12) };
    }
    const locFmt = dv.getInt16(T.head.off + 50);
    const numGlyphs = dv.getUint16(T.maxp.off + 4);
    const loca = (g) => (locFmt === 0 ? dv.getUint16(T.loca.off + g * 2) * 2 : dv.getUint32(T.loca.off + g * 4));
    // glyphs to keep
    const cmapPairs = [];
    const keep = new Set([0]);
    [...new Set(codepoints)].filter((cp) => cp <= 0xffff).sort((a, b) => a - b).forEach((cp) => {
      if (!fkFont.hasGlyphForCodePoint(cp)) return;
      const gid = fkFont.glyphForCodePoint(cp).id;
      cmapPairs.push([cp, gid]); keep.add(gid);
    });
    const stack = [...keep];
    while (stack.length) {
      const g = stack.pop(); const a = loca(g), b = loca(g + 1);
      if (b <= a) continue;
      const go = T.glyf.off + a;
      if (dv.getInt16(go) >= 0) continue; // simple glyph
      let p = go + 10, flags;
      do {
        flags = dv.getUint16(p); const gi = dv.getUint16(p + 2); p += 4;
        p += (flags & 1) ? 4 : 2;
        if (flags & 8) p += 2; else if (flags & 0x40) p += 4; else if (flags & 0x80) p += 8;
        if (!keep.has(gi)) { keep.add(gi); stack.push(gi); }
      } while (flags & 0x20);
    }
    // glyf + loca (long)
    let glyfLen = 0;
    for (const g of keep) { const l = loca(g + 1) - loca(g); glyfLen += (l + 3) & ~3; }
    const glyf = new Uint8Array(glyfLen); const locaNew = new Uint8Array((numGlyphs + 1) * 4); const ldv = new DataView(locaNew.buffer);
    let off = 0;
    for (let g = 0; g < numGlyphs; g++) {
      ldv.setUint32(g * 4, off);
      if (keep.has(g)) { const a = loca(g), l = loca(g + 1) - a; if (l > 0) { glyf.set(u8.subarray(T.glyf.off + a, T.glyf.off + a + l), off); off += (l + 3) & ~3; } }
    }
    ldv.setUint32(numGlyphs * 4, off);
    // cmap: one (3,1) format-4 subtable
    const segs = [];
    cmapPairs.forEach(([cp, gid]) => {
      const s = segs[segs.length - 1];
      if (s && cp === s.end + 1 && gid === s.gid0 + (cp - s.start)) s.end = cp; else segs.push({ start: cp, end: cp, gid0: gid });
    });
    segs.push({ start: 0xffff, end: 0xffff, gid0: 0, last: true });
    const sc = segs.length; const sub4Len = 16 + sc * 8;
    const cmap = new Uint8Array(12 + sub4Len); const cdv = new DataView(cmap.buffer);
    cdv.setUint16(0, 0); cdv.setUint16(2, 1); cdv.setUint16(4, 3); cdv.setUint16(6, 1); cdv.setUint32(8, 12);
    let q = 12; const es = Math.floor(Math.log2(sc)); const sr = 2 * Math.pow(2, es);
    cdv.setUint16(q, 4); cdv.setUint16(q + 2, sub4Len); cdv.setUint16(q + 4, 0); cdv.setUint16(q + 6, sc * 2);
    cdv.setUint16(q + 8, sr); cdv.setUint16(q + 10, es); cdv.setUint16(q + 12, sc * 2 - sr);
    q += 14;
    segs.forEach((s, i) => cdv.setUint16(q + i * 2, s.end)); q += sc * 2 + 2;
    segs.forEach((s, i) => cdv.setUint16(q + i * 2, s.start)); q += sc * 2;
    segs.forEach((s, i) => cdv.setUint16(q + i * 2, s.last ? 1 : ((s.gid0 - s.start) & 0xffff))); q += sc * 2;
    // idRangeOffset all zero
    // post format 3
    const post = new Uint8Array(32); post.set(u8.subarray(T.post.off, T.post.off + 32)); new DataView(post.buffer).setUint32(0, 0x00030000);
    // head with long loca
    const head = u8.slice(T.head.off, T.head.off + T.head.len); new DataView(head.buffer).setInt16(50, 1); new DataView(head.buffer).setUint32(8, 0);
    const out = { head, cmap, glyf, loca: locaNew, post };
    const KEEP = ['OS/2', 'hhea', 'hmtx', 'maxp', 'name', 'cvt ', 'fpgm', 'prep', 'gasp'];
    KEEP.forEach((t) => { if (T[t]) out[t] = u8.subarray(T[t].off, T[t].off + T[t].len); });
    const tags = Object.keys(out).sort();
    const n = tags.length; let size = 12 + n * 16;
    tags.forEach((t) => { size += (out[t].length + 3) & ~3; });
    const font = new Uint8Array(size); const fdv = new DataView(font.buffer);
    const es2 = Math.floor(Math.log2(n)); const sr2 = Math.pow(2, es2) * 16;
    fdv.setUint32(0, 0x00010000); fdv.setUint16(4, n); fdv.setUint16(6, sr2); fdv.setUint16(8, es2); fdv.setUint16(10, n * 16 - sr2);
    let pos = 12 + n * 16;
    tags.forEach((t, i) => {
      const data = out[t]; const o = 12 + i * 16;
      for (let k = 0; k < 4; k++) font[o + k] = t.charCodeAt(k);
      let sum = 0; const padded = (data.length + 3) & ~3;
      font.set(data, pos);
      for (let k = 0; k < padded; k += 4) sum = (sum + fdv.getUint32(pos + k)) >>> 0;
      fdv.setUint32(o + 4, sum); fdv.setUint32(o + 8, pos); fdv.setUint32(o + 12, data.length);
      pos += padded;
    });
    return font;
  }

  // ---------- renderers ----------
  function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

  async function renderPDF(lay, fontBytes, PDFLib, fontkit, meta, fkFonts) {
    const pdf = await PDFLib.PDFDocument.create();
    pdf.registerFontkit(fontkit);
    meta = meta || {};
    pdf.setTitle(meta.title || '職務経歴書'); if (meta.author) pdf.setAuthor(meta.author);
    pdf.setCreator(''); pdf.setProducer(''); pdf.setLanguage('ja-JP');
    const usedChars = {};
    lay.pages.forEach((p) => p.ops.forEach((o) => { if (o.t === 'text') { const s = usedChars[o.f] || (usedChars[o.f] = new Set()); for (const ch of o.s) s.add(ch.codePointAt(0)); } }));
    const fonts = {};
    for (const k in usedChars) {
      const fk = (fkFonts && fkFonts[k]) || fontkit.create(fontBytes[k]);
      fonts[k] = await pdf.embedFont(subsetTTF(fontBytes[k], fk, [...usedChars[k]]), { subset: false });
    }
    const col = (h) => { const c = hexToRgb(h); return PDFLib.rgb(c[0], c[1], c[2]); };
    for (const p of lay.pages) {
      const page = pdf.addPage([PAGE_W, PAGE_H]);
      for (const o of p.ops) {
        if (o.t === 'rect') page.drawRectangle({ x: o.x, y: PAGE_H - o.y - o.h, width: o.w, height: o.h, color: col(o.fill) });
        else if (o.t === 'circle') page.drawCircle({ x: o.x, y: PAGE_H - o.y, size: o.r, color: col(o.fill) });
        else if (o.t === 'image') {
          const b64 = String(o.src).split(',')[1] || ''; const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
          const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          const img = /^data:image\/png/.test(o.src) ? await pdf.embedPng(u8) : await pdf.embedJpg(u8);
          page.drawImage(img, { x: o.x, y: PAGE_H - o.y - o.h, width: o.w, height: o.h });
        }
        else if (o.t === 'rrect') { const r = Math.min(o.r, o.h / 2, o.w / 2), w = o.w, h = o.h; page.drawSvgPath(`M ${r} 0 H ${w - r} A ${r} ${r} 0 0 1 ${w} ${r} V ${h - r} A ${r} ${r} 0 0 1 ${w - r} ${h} H ${r} A ${r} ${r} 0 0 1 0 ${h - r} V ${r} A ${r} ${r} 0 0 1 ${r} 0 Z`, Object.assign({ x: o.x, y: PAGE_H - o.y, color: col(o.fill) }, o.stroke ? { borderColor: col(o.stroke), borderWidth: o.sw || 0.5 } : {})); }
        else if (o.t === 'line') page.drawLine({ start: { x: o.x1, y: PAGE_H - o.y1 }, end: { x: o.x2, y: PAGE_H - o.y2 }, thickness: o.w, color: col(o.c) });
        else if (o.t === 'text') {
          if (o.tc) page.pushOperators(PDFLib.setCharacterSpacing(o.tc));
          page.drawText(o.s, { x: o.x, y: PAGE_H - o.y, size: o.z, font: fonts[o.f], color: col(o.c) });
          if (o.tc) page.pushOperators(PDFLib.setCharacterSpacing(0));
        }
      }
    }
    return pdf.save();
  }

  function renderCanvas(ctx, page, scale, meas, families, marks) {
    ctx.save();
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.textBaseline = 'alphabetic';
    for (const o of page.ops) {
      if (o.t === 'rect') { ctx.fillStyle = o.fill; ctx.fillRect(o.x, o.y, o.w, o.h); }
      else if (o.t === 'circle') { ctx.fillStyle = o.fill; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill(); }
      else if (o.t === 'image') { const im = renderCanvas.images && renderCanvas.images[o.src]; if (im && im.complete) ctx.drawImage(im, o.x, o.y, o.w, o.h); else { ctx.fillStyle = '#eeeeee'; ctx.fillRect(o.x, o.y, o.w, o.h); } }
      else if (o.t === 'rrect') {
        const r = Math.min(o.r, o.h / 2, o.w / 2); ctx.fillStyle = o.fill; ctx.beginPath();
        ctx.moveTo(o.x + r, o.y); ctx.arcTo(o.x + o.w, o.y, o.x + o.w, o.y + o.h, r); ctx.arcTo(o.x + o.w, o.y + o.h, o.x, o.y + o.h, r);
        ctx.arcTo(o.x, o.y + o.h, o.x, o.y, r); ctx.arcTo(o.x, o.y, o.x + o.w, o.y, r); ctx.closePath(); ctx.fill();
        if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.sw || 0.5; ctx.stroke(); }
      }
      else if (o.t === 'line') { ctx.strokeStyle = o.c; ctx.lineWidth = o.w; ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2); ctx.stroke(); }
      else if (o.t === 'text') {
        if (marks && marks.length) {
          const chars = [...o.s]; const flat = chars.join('');
          marks.forEach((m) => {
            const re = new RegExp('(^|[^0-9.])(' + m.replace(/\./g, '\\.') + ')(?![0-9]|\\.[0-9])', 'g'); let mm;
            while ((mm = re.exec(flat))) {
              const start = [...flat.slice(0, mm.index + mm[1].length)].length; const n = [...mm[2]].length;
              let x0 = o.x; for (let i = 0; i < start; i++) x0 += meas.adv(o.f, chars[i]) * o.z + o.tc;
              let w = 0; for (let i = start; i < start + n; i++) w += meas.adv(o.f, chars[i]) * o.z + o.tc;
              ctx.fillStyle = '#ffe07a'; ctx.fillRect(x0 - 1, o.y - o.z * 0.92, w + 2, o.z * 1.18);
            }
          });
        }
        ctx.fillStyle = o.c; ctx.font = `${o.z}px "${families[o.f]}"`;
        let x = o.x;
        for (const ch of o.s) { ctx.fillText(ch, x, o.y); x += meas.adv(o.f, ch) * o.z + o.tc; }
      }
    }
    ctx.restore();
  }

  // ---------- DOCX (WordprocessingML written by hand) ----------
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  const tw = (pt) => Math.round(pt * 20);

  function buildDocxXml(docIn, themeKey, opts) {
    const doc = normalizeDoc(docIn);
    const th = resolveTheme(themeKey, opts);
    const prem = th.head === 'premium';
    const DF = DOCX_FONTS[opts && opts.target] || DOCX_FONTS.windows;
    const FB = DF[th.docx.body][0], FH = DF[th.docx.bold][0];
    const usedFonts = [...new Set([th.docx.body, th.docx.bold])].map((k) => DF[k]);
    const hx = (h) => h.replace('#', '').toUpperCase();
    const run = (t, o = {}) => {
      const f = o.bold ? FH : FB;
      return `<w:r><w:rPr><w:rFonts w:ascii="${f}" w:hAnsi="${f}" w:eastAsia="${f}" w:cs="${f}"/>${o.bold ? '<w:b/><w:bCs/>' : ''}<w:color w:val="${hx(o.c || th.text)}"/>${o.sp ? `<w:spacing w:val="${o.sp}"/>` : ''}<w:sz w:val="${Math.round((o.z || S.body) * 2)}"/><w:szCs w:val="${Math.round((o.z || S.body) * 2)}"/></w:rPr><w:t xml:space="preserve">${esc(t)}</w:t></w:r>`;
    };
    const tab = '<w:r><w:tab/></w:r>';
    const p = (runs, o = {}) => {
      let pp = '<w:pPr>';
      if (o.keepNext) pp += '<w:keepNext/>';
      if (o.keepLines) pp += '<w:keepLines/>';
      if (o.bdr) pp += `<w:pBdr>${o.bdr}</w:pBdr>`;
      if (o.shd) pp += `<w:shd w:val="clear" w:color="auto" w:fill="${hx(o.shd)}"/>`;
      if (o.tabs) pp += `<w:tabs>${o.tabs}</w:tabs>`;
      pp += '<w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:snapToGrid w:val="0"/>';
      pp += `<w:spacing w:before="${tw(o.before || 0)}" w:after="${tw(o.after || 0)}" w:line="${tw(o.line || S.bodyLead)}" w:lineRule="exact"/>`;
      if (o.ind) pp += `<w:ind w:left="${tw(o.ind.left || 0)}" w:hanging="${tw(o.ind.hanging || 0)}"/>`;
      pp += `<w:jc w:val="${o.jc || 'both'}"/>`;
      pp += '</w:pPr>';
      return `<w:p>${pp}${runs}</w:p>`;
    };
    const cw = tw(CW);
    const bd = (k, sz, color, space) => `<w:${k} w:val="single" w:sz="${sz}" w:space="${space || 0}" w:color="${hx(color)}"/>`;
    const nil = (k) => `<w:${k} w:val="nil"/>`;
    const tbl = (grid, rows, borders, cellMar) => `<w:tbl><w:tblPr><w:tblW w:w="${grid.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar>${cellMar}</w:tblCellMar><w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>${grid.map((g) => `<w:gridCol w:w="${g}"/>`).join('')}</w:tblGrid>${rows}</w:tbl>`;
    const mar = (t, l, b, r) => `<w:top w:w="${tw(t)}" w:type="dxa"/><w:left w:w="${tw(l)}" w:type="dxa"/><w:bottom w:w="${tw(b)}" w:type="dxa"/><w:right w:w="${tw(r)}" w:type="dxa"/>`;
    const body = [];

    const heading = (label) => {
      if (prem) {
        body.push(p(run(label, { bold: true, z: 12, c: th.accent }) + run('   ' + (EN[label] || ''), { bold: true, z: 6.8, c: th.sub, sp: 26 }),
          { before: 18, after: S.headAfter, line: S.headLead, keepNext: true, jc: 'left', bdr: bd('bottom', 4, th.grid, 2) }));
        return;
      }
      const bdr = th.head === 'bar'
        ? bd('left', 24, th.accent, 6)
        : bd('bottom', 6, th.rule, 2);
      body.push(p(run(th.head === 'bar' ? label : '■' + label, { bold: true, z: S.head, c: th.head === 'bar' ? th.accent : th.text }),
        { before: th.head === 'bar' ? S.headBefore + 4 : S.headBefore, after: S.headAfter, line: S.headLead, keepNext: true, bdr, jc: 'left', ind: th.head === 'bar' ? { left: 7 } : null }));
    };
    const bullet = (t, o = {}) => {
      const mark = o.dot ? run('•', { c: th.accent, z: o.z || S.body }) : o.square ? run('■', { c: th.text, z: (o.z || S.body) * 0.5 }) : run('・', { c: th.sub, z: o.z });
      return p(mark + tab + run(t, { z: o.z }), { ind: { left: (o.left || 0) + (o.z || S.body), hanging: o.z || S.body }, line: o.line, keepLines: true, tabs: `<w:tab w:val="left" w:pos="${tw((o.left || 0) + (o.z || S.body))}"/>` });
    };

    // title
    if (prem) {
      body.push(p(run(doc.title, { bold: true, z: 8.6, c: th.accent, sp: tw(2.6) }), { jc: 'left', line: 16 }));
      body.push(p(run(doc.name || '', { bold: true, z: 21, sp: tw(1.5) }) + (doc.date ? tab + run(doc.date, { z: 8.8, c: th.sub }) : ''),
        { jc: 'left', line: 34, after: 4, tabs: `<w:tab w:val="right" w:pos="${cw}"/>`, bdr: bd('bottom', 4, th.grid, 6) }));
      const hs = doc.highlights.slice(0, 3);
      if (hs.length) {
        const n = hs.length; const g = Math.floor(cw / n);
        const tile = (v) => {
          const arrow = v.split('→');
          const pre = arrow.length === 2 ? arrow[0].trim() + ' → ' : (/^(\D+?)\s*(\d.*)$/.exec(v) || [])[1] || '';
          const main = arrow.length === 2 ? arrow[1].trim() : pre ? v.slice(v.indexOf(pre) + pre.length).trim() : v;
          return (pre ? run(pre, { z: 10, c: th.sub }) : '') + run(main, { bold: true, z: 16, c: th.accent });
        };
        const fillT = mix(th.accent, '#ffffff', 0.94);
        const cells = hs.map((hl) => `<w:tc><w:tcPr><w:tcW w:w="${g}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${hx(fillT)}"/><w:vAlign w:val="center"/></w:tcPr>${p(tile(hl.value), { jc: 'left', line: 24 })}${p(run(hl.label, { z: 8.2, c: th.sub }), { jc: 'left', line: 11.5 })}</w:tc>`).join('');
        body.push(p('', { line: 10 }));
        body.push(tbl(Array(n).fill(g), `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells}</w:tr>`, ['top', 'left', 'bottom', 'right'].map(nil).join('') + bd('insideV', 48, '#ffffff'), mar(7, 11, 7, 11)));
      }
    } else {
      body.push(p(run(doc.title, { bold: true, z: th.title || S.title, sp: tw(th.titleTc != null ? th.titleTc : S.titleTc) }), { jc: 'center', line: 30, after: 8 }));
      if (doc.date) body.push(p(run(doc.date, { z: 9, c: th.sub }), { jc: 'right', line: 15 }));
      if (doc.name) body.push(p(run('氏名', { z: 9, c: th.sub }) + run('　', { z: 9 }) + run(doc.name, { bold: true, z: 13, sp: 20 }), { jc: 'right', line: 24 }));
    }

    if (doc.summary) { heading('職務要約'); doc.summary.split(/\n/).forEach((s) => body.push(p(run(s)))); }

    if (doc.careers.length) {
      heading('職務経歴');
      if (prem) {
        const c1 = tw(94), c2 = cw - c1;
        doc.careers.forEach((c, ci) => {
          body.push(p(run(c.company, { bold: true, z: 11.5 }) + (c.period ? tab + run(c.period, { z: 8.8, c: th.sub }) : ''), { jc: 'left', line: 21, before: ci ? 16 : 4, keepNext: true, tabs: `<w:tab w:val="right" w:pos="${cw}"/>` }));
          const meta = [c.business ? '事業内容：' + c.business : '', c.meta].filter(Boolean).join('　／　');
          if (meta) body.push(p(run(meta, { z: 8.2, c: th.sub }), { line: 13, after: 7, keepNext: true }));
          let rows = '';
          c.blocks.forEach((b, bi) => {
            const L = splitPeriod(b.period).map((s, i) => p(run(s, { z: 8.6, bold: i === 0, c: i === 0 ? th.text : th.sub }), { jc: 'left', line: S.tblLead })).join('') || p('', { line: S.tblLead });
            // one row per group (業務 / 実績); rows may split, so a page can break inside a block, as in the PDF
            const parts = []; let R = '';
            if (b.heading) R += p(run(b.heading, { bold: true, z: 10 }), { jc: 'left', line: S.tblLead, keepNext: true });
            const group = (label, items, dot) => {
              if (!items.length) return;
              R += p(run(label, { bold: true, z: 7.8, c: th.accent }), { jc: 'left', line: S.tblLead, before: R || parts.length ? 4 : 0, keepNext: true });
              items.forEach((it) => { R += bullet(it, { z: S.tbl, line: S.tblLead, dot }); });
            };
            group('主な業務', b.duties, false);
            if (R && b.achievements.length) { parts.push(R); R = ''; }
            group('主な実績', b.achievements, true);
            parts.push(R || p('', { line: S.tblLead }));
            parts.forEach((part, k) => {
              const padB = k === parts.length - 1 && bi < c.blocks.length - 1 ? 9 : 0;
              rows += `<w:tr><w:tc><w:tcPr><w:tcW w:w="${c1}" w:type="dxa"/><w:tcMar><w:bottom w:w="${tw(padB)}" w:type="dxa"/></w:tcMar></w:tcPr>${k ? p('', { line: 4 }) : L}</w:tc><w:tc><w:tcPr><w:tcW w:w="${c2}" w:type="dxa"/><w:tcBorders>${bd('left', 6, th.grid)}</w:tcBorders><w:tcMar><w:left w:w="240" w:type="dxa"/><w:bottom w:w="${tw(padB)}" w:type="dxa"/></w:tcMar></w:tcPr>${part}</w:tc></w:tr>`;
            });
          });
          body.push(tbl([c1, c2], rows, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(nil).join(''), mar(0, 0, 0, 10)));
        });
      } else {
        const c1 = tw(S.colPeriod), c2 = cw - c1;
        doc.careers.forEach((c, ci) => {
          if (ci > 0) body.push(p('', { line: 12 }));
          const meta = [c.business ? '事業内容：' + c.business : '', c.meta].filter(Boolean).join('　／　');
          let rows = '';
          rows += `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/><w:gridSpan w:val="2"/>${th.bandRule ? `<w:tcBorders>${bd('top', Math.round(th.bandRule * 8), th.accent)}</w:tcBorders>` : ''}<w:shd w:val="clear" w:color="auto" w:fill="${hx(th.band)}"/></w:tcPr>`
            + p(run(c.company, { bold: true, z: 10.5 }) + (c.period ? tab + run(c.period, { z: 9 }) : ''), { jc: 'left', line: 16, tabs: `<w:tab w:val="right" w:pos="${cw - tw(S.padX * 2)}"/>`, keepNext: true })
            + (meta ? p(run(meta, { z: S.small, c: th.sub }), { line: S.smallLead, keepNext: true }) : '')
            + '</w:tc></w:tr>';
          const hcell = (w, t) => `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${hx(th.fill)}"/><w:vAlign w:val="center"/></w:tcPr>${p(run(t, { bold: true, z: 8, c: th.sub }), { jc: 'center', line: 14, keepNext: true })}</w:tc>`;
          rows += `<w:tr><w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>${hcell(c1, '期間')}${hcell(c2, '業務内容')}</w:tr>`;
          c.blocks.forEach((b) => {
            const L = splitPeriod(b.period).map((s) => p(run(s, { z: 9 }), { jc: 'left', line: S.tblLead })).join('') || p('', { line: S.tblLead });
            // one row per group with no rule between them; rows may split, so a page can break inside a block
            // as in the PDF (the table header repeats on the next page)
            const parts = []; let R = '';
            if (b.heading) R += p(run(b.heading, { bold: true, z: S.tbl }), { jc: 'left', line: S.tblLead, keepNext: true });
            const group = (label, items, ach) => {
              if (!items.length) return;
              R += p(run(label, { bold: true, z: 9 }), { jc: 'left', line: S.tblLead, before: R || parts.length ? 4 : 0, keepNext: true });
              items.forEach((it) => { R += bullet(it, { z: S.tbl, line: S.tblLead, dot: ach && th.achBullet === 'dot', square: ach && th.achBullet === 'square' }); });
            };
            group('【業務内容】', b.duties, false);
            if (R && b.achievements.length) { parts.push(R); R = ''; }
            group('【実績・取り組み】', b.achievements, true);
            parts.push(R || p('', { line: S.tblLead }));
            parts.forEach((part, k) => {
              const open = (k < parts.length - 1 ? nil('bottom') : '') + (k > 0 ? nil('top') : '');
              const mar2 = `${k > 0 ? '<w:top w:w="0" w:type="dxa"/>' : ''}${k < parts.length - 1 ? '<w:bottom w:w="0" w:type="dxa"/>' : ''}`;
              const pr = (w) => `<w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${open ? `<w:tcBorders>${open}</w:tcBorders>` : ''}${mar2 ? `<w:tcMar>${mar2}</w:tcMar>` : ''}</w:tcPr>`;
              rows += `<w:tr><w:tc>${pr(c1)}${k ? p('', { line: 4 }) : L}</w:tc><w:tc>${pr(c2)}${part}</w:tc></w:tr>`;
            });
          });
          const FR = th.frame || th.grid; const fw = Math.round((th.frameW || 0.5) * 8); const gw = Math.max(2, Math.round((th.gridW || 0.5) * 8));
          body.push(tbl([c1, c2], rows, ['top', 'left', 'bottom', 'right'].map((k) => bd(k, fw, FR)).join('') + ['insideH', 'insideV'].map((k) => bd(k, gw, th.grid)).join(''), mar(S.padY, S.padX, S.padY, S.padX)));
        });
      }
    }
    if (doc.skills.length) { heading('活かせる経験・知識・技術'); doc.skills.forEach((s) => body.push(bullet(s, { dot: prem }))); }
    if (doc.tech.length) {
      heading('スキル・ツール・語学');
      if (prem) doc.tech.forEach((s) => {
        const { cat, items } = splitChips(s);
        const est = (t) => [...t].reduce((a, ch) => a + (/[\x20-\x7e]/.test(ch) ? 0.56 : 1), 0) * 9.5;
        const maxW = CW - (cat ? 66 : 0); const lines = [[]]; let w = 0;
        items.forEach((it) => { const iw = est(it) + (w ? est('　／　') : 0); if (w && w + iw > maxW) { lines.push([]); w = 0; } lines[lines.length - 1].push(it); w += w ? iw : est(it); });
        const text = lines.map((l) => run(l.join('　／　'), { z: 9.5 })).join('<w:r><w:br/></w:r>');
        body.push(p((cat ? run(cat, { bold: true, z: 8.2, c: th.sub }) + tab : '') + text, { jc: 'left', line: 20, ind: cat ? { left: 66, hanging: 66 } : null, tabs: cat ? `<w:tab w:val="left" w:pos="${tw(66)}"/>` : '' }));
      });
      else doc.tech.forEach((s) => body.push(bullet(s)));
    }
    if (doc.qualifications.length) {
      heading('資格・免許');
      doc.qualifications.forEach((q) => {
        const dz = prem ? 9 : S.body, dc = prem ? th.sub : th.text; const m = /^(\d{4}年)(\d{1,2}月)$/.exec(q.date);
        const date = m ? run(m[1], { z: dz, c: dc }) + tab + run(m[2], { z: dz, c: dc }) : run(q.date, { z: dz, c: dc });
        body.push(p(date + tab + run(q.name), { jc: 'left', ind: { left: 84, hanging: 84 }, tabs: (m ? `<w:tab w:val="right" w:pos="${tw(dz * 5.4)}"/>` : '') + `<w:tab w:val="left" w:pos="${tw(84)}"/>` }));
      });
    }
    if (doc.pr.length) {
      heading('自己PR');
      doc.pr.forEach((x, i) => {
        if (x.heading) {
          if (prem) body.push(p(run(x.heading, { bold: true, z: 10.5 }), { jc: 'left', before: i > 0 ? 11 : 0, line: S.bodyLead + 1, keepNext: true, bdr: bd('left', 18, th.accent, 7), ind: { left: 10 } }));
          else body.push(p(run(th.head === 'bar' ? x.heading : '【' + x.heading + '】', { bold: true, z: 10.5, c: th.head === 'bar' ? th.accent : th.text }), { jc: 'left', before: i > 0 ? 9 : 0, line: S.bodyLead + 1, keepNext: true }));
        }
        if (x.body) x.body.split(/\n/).forEach((s) => body.push(p(run(s), { ind: prem ? { left: 10 } : null })));
      });
    }
    body.push(p(run('以上'), { jc: 'right', before: 4, line: 18 }));

    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const sect = `<w:sectPr><w:footerReference w:type="default" r:id="rIdFtr"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${tw(M.t)}" w:right="${tw(M.r)}" w:bottom="${tw(M.b)}" w:left="${tw(M.l)}" w:header="567" w:footer="${tw(28)}" w:gutter="0"/><w:cols w:space="425"/></w:sectPr>`;
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document ${W}><w:body>${body.join('')}${sect}</w:body></w:document>`;
    const fr = (t) => `<w:r><w:rPr><w:rFonts w:ascii="${FB}" w:hAnsi="${FB}" w:eastAsia="${FB}"/><w:color w:val="${hx(th.sub)}"/><w:sz w:val="16"/></w:rPr>${t}</w:r>`;
    const fld = (code) => fr('<w:fldChar w:fldCharType="begin"/>') + fr(`<w:instrText xml:space="preserve"> ${code} </w:instrText>`) + fr('<w:fldChar w:fldCharType="separate"/>') + fr('<w:t>1</w:t>') + fr('<w:fldChar w:fldCharType="end"/>');
    const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr>${doc.name ? fr(`<w:t xml:space="preserve">${esc(doc.name)}　</w:t>`) : ''}${fld('PAGE')}${fr('<w:t xml:space="preserve"> / </w:t>')}${fld('NUMPAGES')}</w:p></w:ftr>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${FB}" w:hAnsi="${FB}" w:eastAsia="${FB}" w:cs="${FB}"/><w:sz w:val="20"/><w:szCs w:val="20"/><w:lang w:val="ja-JP" w:eastAsia="ja-JP" w:bidi="ar-SA"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:autoSpaceDE w:val="0"/><w:autoSpaceDN w:val="0"/><w:spacing w:after="0" w:line="${tw(S.bodyLead)}" w:lineRule="exact"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style></w:styles>`;
    const settings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:settings ${W}><w:zoom w:percent="100"/><w:defaultTabStop w:val="420"/><w:characterSpacingControl w:val="compressPunctuation"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`;
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(doc.title)}</dc:title><dc:creator>${esc(doc.name)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`;
    return {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/><Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdFonts" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>',
      'word/document.xml': document,
      'word/styles.xml': styles,
      'word/settings.xml': settings,
      'word/footer1.xml': footer,
      'word/fontTable.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:fonts ${W}>${usedFonts.map(([n, alt, fam]) => `<w:font w:name="${esc(n)}"><w:altName w:val="${esc(alt.join(','))}"/><w:charset w:val="80"/><w:family w:val="${fam}"/><w:pitch w:val="variable"/></w:font>`).join('')}</w:fonts>`,
      'docProps/core.xml': core,
    };
  }

  async function buildDocx(doc, themeKey, JSZip, opts) {
    const files = buildDocxXml(doc, themeKey, opts);
    const zip = new JSZip();
    zip.file('[Content_Types].xml', files['[Content_Types].xml'], { createFolders: false });
    for (const k in files) if (k !== '[Content_Types].xml') zip.file(k, files[k], { createFolders: false });
    return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  }

  const DOCX_TARGETS = Object.keys(DOCX_FONTS).map((k) => ({ key: k, label: DOCX_FONTS[k].label }));
  const api = { DOCX_TARGETS, normDate, toEra, layoutRireki, PAGE_W, PAGE_H, M, CW, S, THEMES, ACCENTS, resolveTheme, FONT_FILES, makeMeasurer, wrap, normalizeDoc, layout, fitReport, missingChars, fixChars, subsetTTF, renderPDF, renderCanvas, buildDocxXml, buildDocx };
  global.ResumeEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
