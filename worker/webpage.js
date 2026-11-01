// Reading pages from the web, without the network (so it can be tested): which URLs may be read, robots.txt,
// a posting page as plain text, and keeping only research items whose page the search really returned.
import { NO_FETCH } from './config.js';

const BOT = 'resumeai';
const onList = (host, list) => list.some((d) => host === d || host.endsWith('.' + d));

export function checkUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return { error: 'url' }; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return { error: 'url' };
  if (u.port && u.port !== '80' && u.port !== '443') return { error: 'url' };
  const host = u.hostname.toLowerCase();
  // names only: no addresses, no local names
  if (!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':') || /(^|\.)(localhost|local|internal|lan|home)$/.test(host)) return { error: 'url' };
  if (onList(host, NO_FETCH)) return { error: 'site_not_allowed', host };
  return { url: u };
}

// robots.txt: the rules for our name or for every robot; the longest matching rule wins (Allow on a tie)
export function robotsAllows(txt, path) {
  const groups = []; let cur = null; let lastWasAgent = false;
  for (const line of String(txt || '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase(); const v = m[2];
    if (k === 'user-agent') {
      if (!lastWasAgent || !cur) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasAgent = true;
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      lastWasAgent = false;
      if (v || k === 'allow') cur.rules.push({ allow: k === 'allow', path: v });
    } else lastWasAgent = false;
  }
  const mine = groups.filter((g) => g.agents.includes(BOT));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes('*'));
  let best = null;
  for (const r of use.flatMap((g) => g.rules)) {
    if (!r.path) continue;
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
  }
  return !best || best.allow;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) => String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m;
});
// HTML to readable lines: blocks become lines, list items 「・」
export function htmlText(html) {
  let s = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|form|nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<li\b[^>]*>/gi, '\n・')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/?(p|div|section|article|main|h[1-6]|ul|ol|dl|dt|dd|tr|table|tbody|thead|blockquote|pre)\b[^>]*>/gi, '\n')
    .replace(/<(td|th)\b[^>]*>/gi, '\t')
    .replace(/<[^>]+>/g, ' ');
  s = decode(s).replace(/[ \t 　]+/g, (m) => (m.includes('　') ? '　' : ' '));
  const out = []; let blank = 0;
  for (const line of s.split('\n').map((x) => x.trim())) {
    if (!line || line === '・') { if (out.length && !blank) { out.push(''); blank = 1; } continue; }
    blank = 0; out.push(line);
  }
  return out.join('\n').trim();
}
function jsonLdJobs(html) {
  const jobs = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    const t = v['@type']; if (t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'))) jobs.push(v);
    if (v['@graph']) walk(v['@graph']);
  };
  for (const m of String(html).matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { walk(JSON.parse(m[1].trim())); } catch { /* not valid JSON */ }
  }
  return jobs;
}
const txt = (v) => (v == null ? '' : typeof v === 'string' ? htmlText(v) : Array.isArray(v) ? v.map(txt).filter(Boolean).join('\n') : typeof v === 'object' ? txt(v.name || v.value || v.text || '') : String(v));
function jobText(j) {
  const org = j.hiringOrganization && (j.hiringOrganization.name || '');
  const loc = [].concat(j.jobLocation || []).map((l) => { const a = (l && l.address) || {}; return [a.addressRegion, a.addressLocality, a.streetAddress].filter(Boolean).join(' '); }).filter(Boolean).join(' / ');
  const pay = j.baseSalary && j.baseSalary.value ? [j.baseSalary.value.minValue, j.baseSalary.value.maxValue].filter((x) => x != null).join('〜') + ' ' + (j.baseSalary.currency || '') + (j.baseSalary.value.unitText ? ' / ' + j.baseSalary.value.unitText : '') : '';
  const parts = [
    ['職種', txt(j.title)], ['会社', txt(org)], ['雇用形態', txt(j.employmentType)], ['勤務地', loc], ['給与', pay.trim()],
    ['仕事内容', txt(j.description)], ['担当業務', txt(j.responsibilities)], ['応募資格', txt(j.qualifications)], ['必要なスキル', txt(j.skills)],
    ['経験', txt(j.experienceRequirements)], ['学歴', txt(j.educationRequirements)], ['福利厚生', txt(j.jobBenefits)],
  ].filter(([, v]) => v);
  return { text: parts.map(([k, v]) => `【${k}】\n${v}`).join('\n\n'), company: txt(org), title: txt(j.title) };
}
// the text of a page as it would be pasted: the JobPosting data when the page has it, else the main content
export function extractJob(html, now = Date.now()) {
  const jobs = jsonLdJobs(html);
  const title = htmlText((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) || [])[1] || '').slice(0, 200);
  if (jobs.length) {
    const j = jobText(jobs[0]);
    // a list page holds several postings (the first is taken; the user is told); a closed one is flagged
    const until = String(jobs[0].validThrough || '').slice(0, 10);
    const expired = /^\d{4}-\d{2}-\d{2}$/.test(until) && Date.parse(until + 'T23:59:59+09:00') < now ? until : '';
    if (j.text.length > 150) return { text: j.text.slice(0, 12000), title: j.title || title, company: j.company, count: jobs.length, expired };
  }
  const main = (/<main\b[\s\S]*?<\/main>/i.exec(html) || /<article\b[\s\S]*?<\/article>/i.exec(html) || [])[0];
  let text = main ? htmlText(main) : '';
  if (text.length < 300) text = htmlText((/<body\b[\s\S]*<\/body>/i.exec(html) || [html])[0]);
  return { text: text.slice(0, 12000), title, company: '' };
}

// company research: keep only items whose page the search really returned; the page's title and age from the
// search when the answer has none. Facts keep their ids (F1…) so hooks and questions can point at them.
const ym = (age) => { const t = Date.parse(String(age || '')); if (!Number.isFinite(t)) return ''; const d = new Date(t); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); };
export function keepFound(v, sources) {
  const key = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');
  const found = new Map(sources.map((x) => [key(x.url), x]));
  const ok = (it) => { const f = found.get(key(it && it.url)); if (!f) return null; return { ...it, url: f.url, title: it.title || f.title, ...('date' in it || f.age ? { date: it.date || ym(f.age) } : {}) }; };
  v.facts = (Array.isArray(v.facts) ? v.facts : []).map((f, i) => (f && typeof f === 'object' ? { ...f, id: f.id || 'F' + (i + 1) } : f)).map(ok).filter(Boolean);
  v.position = (Array.isArray(v.position) ? v.position : []).map(ok).filter(Boolean).map(({ date, ...p }) => p);
  return v;
}
