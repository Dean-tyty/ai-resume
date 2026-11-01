// Calling a language model, independent of the vendor. Used by the Worker (ai.js) and by the quality
// evaluation (tools/eval), so both run the same prompts the same way.
//
// A model is named "provider:model" or just "model" (then AI_PROVIDER decides):
//   anthropic:claude-sonnet-5-5           Anthropic Messages API (ANTHROPIC_API_KEY)
//   openai:google/gemini-3-pro            any OpenAI-compatible Chat Completions API: OpenRouter by default
//                                         (AI_BASE_URL, AI_API_KEY)
// AI_MODEL is the default, AI_MODELS (JSON) sets a model per task, e.g. {"explain":"openai:…"}.
// AI_FALLBACK is tried once when the first model is busy or unreachable.
// With OpenRouter, providers that keep prompts or may train on them are excluded (data_collection: deny);
// AI_ZDR=1 allows only zero-retention providers.

export class AIError extends Error { constructor(code, detail, extra) { super(code); this.code = code; this.detail = detail || ''; this.extra = extra; } }

// the JSON object in the model's text: without code fences, from the first { to the last }
export function parseJSON(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  const a = t.indexOf('{'); const z = t.lastIndexOf('}');
  if (a < 0 || z <= a) return null;
  try { const v = JSON.parse(t.slice(a, z + 1)); return v && typeof v === 'object' ? v : null; } catch { return null; }
}

export function spec(env, s) {
  const m = /^(anthropic|openai):(.+)$/.exec(String(s || '').trim());
  if (m) return { provider: m[1], model: m[2] };
  const provider = env.AI_PROVIDER === 'openai' ? 'openai' : 'anthropic';
  return { provider, model: String(s || '').trim() || (provider === 'anthropic' ? 'claude-sonnet-5-5' : '') };
}
export function modelFor(env, task) {
  let per = {}; try { per = env.AI_MODELS ? JSON.parse(env.AI_MODELS) : {}; } catch { per = {}; }
  return spec(env, per[task] || env.AI_MODEL);
}

const pause = (ms) => new Promise((ok) => setTimeout(ok, ms));
const RETRY_JSON = '\n\n# 注意\n前回の出力は JSON として読めませんでした。前置き・説明・コードブロックを付けず、指定の形式の JSON オブジェクトだけを出力してください。';

// one task: the answer as an object. tools (Anthropic web search) only with the Anthropic provider.
export async function callModel(env, task, prompt, maxTokens, opts = {}) {
  const first = modelFor(env, task);
  try {
    return await callWithJsonRetry(env, first, prompt, maxTokens, opts);
  } catch (e) {
    const fb = env.AI_FALLBACK && !opts.tools ? spec(env, env.AI_FALLBACK) : null;
    if (fb && e instanceof AIError && (e.code === 'busy' || e.code === 'ai_unreachable')) {
      const r = await callWithJsonRetry(env, fb, prompt, maxTokens, opts);
      r.fallback = true; return r;
    }
    throw e;
  }
}
async function callWithJsonRetry(env, m, prompt, maxTokens, opts) {
  const call = m.provider === 'openai' ? callOpenAI : callAnthropic;
  try {
    return await call(env, m, prompt, maxTokens, opts);
  } catch (e) {
    // weaker models sometimes wrap or break the JSON: one more try, told so (not with paid web search)
    if (e instanceof AIError && e.code === 'invalid_json' && !opts.tools) {
      const r = await call(env, m, prompt + RETRY_JSON, maxTokens, opts);
      r.usage.retried = 1; return r;
    }
    throw e;
  }
}

// Anthropic Messages API. With server tools (web search) the answer may come in several turns (pause_turn),
// and the pages the search returned are listed in `sources` (the answer may cite only pages really found).
async function callAnthropic(env, m, prompt, maxTokens, opts) {
  const req = { model: m.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (env.AI_EFFORT !== 'none') req.output_config = { effort: env.AI_EFFORT || 'medium' };
  if (opts.tools) req.tools = opts.tools;
  const blocks = []; const usage = { input_tokens: 0, output_tokens: 0, searches: 0 };
  for (let attempt = 0, turn = 0; ; ) {
    let r;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify(req),
      });
    } catch (e) {
      if (attempt++ < 1) { await pause(2000); continue; }
      throw new AIError('ai_unreachable', String(e.message || e));
    }
    const text = await r.text();
    if (r.ok) {
      let j; try { j = JSON.parse(text); } catch { throw new AIError('ai_error', 'not JSON'); }
      const u = j.usage || {};
      usage.input_tokens += u.input_tokens || 0; usage.output_tokens += u.output_tokens || 0;
      usage.searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;
      blocks.push(...(j.content || []));
      // a long turn with server tools is handed back to be continued: the reply so far (a continuation returns only what is new)
      if (j.stop_reason === 'pause_turn' && turn++ < 3) { req.messages = [req.messages[0], { role: 'assistant', content: blocks.slice() }]; continue; }
      if (j.stop_reason === 'refusal') throw new AIError('refused');
      if (j.stop_reason === 'max_tokens') throw new AIError('too_long');
      // the answer is the text after the last tool use
      let last = -1; blocks.forEach((b, i) => { if (b.type !== 'text') last = i; });
      const out = blocks.slice(last + 1).filter((b) => b.type === 'text').map((b) => b.text).join('');
      const v = parseJSON(out);
      if (!v) throw new AIError('invalid_json', 'length ' + out.length);   // never log the text: it holds the user's career
      const sources = blocks.filter((b) => b.type === 'web_search_tool_result' && Array.isArray(b.content)).flatMap((b) => b.content)
        .filter((x) => x && x.url).map((x) => ({ url: x.url, title: x.title || '', age: x.page_age || '' }));
      return { value: v, usage, sources, model: 'anthropic:' + m.model };
    }
    // overloaded / server errors: one more try after a pause
    if ((r.status === 529 || r.status >= 500) && attempt++ < 1) { await pause(2500); continue; }
    throw httpError(r.status, text);
  }
}

// OpenAI-compatible Chat Completions (OpenRouter and others)
async function callOpenAI(env, m, prompt, maxTokens) {
  const base = (env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
  const req = { model: m.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] };
  if (env.AI_JSON_MODE !== '0') req.response_format = { type: 'json_object' };
  if (/openrouter\.ai/.test(base)) req.provider = Object.assign({ data_collection: 'deny' }, env.AI_ZDR === '1' ? { zdr: true } : {});
  for (let attempt = 0; ; ) {
    let r;
    try {
      r = await fetch(base + '/chat/completions', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + (env.AI_API_KEY || ''), 'content-type': 'application/json', 'http-referer': 'https://resume.flatland.co.jp/', 'x-title': 'Resume AI' },
        body: JSON.stringify(req),
      });
    } catch (e) {
      if (attempt++ < 1) { await pause(2000); continue; }
      throw new AIError('ai_unreachable', String(e.message || e));
    }
    const text = await r.text();
    if (r.ok) {
      let j; try { j = JSON.parse(text); } catch { throw new AIError('ai_error', 'not JSON'); }
      if (j.error) throw httpError(Number(j.error.code) || 500, JSON.stringify(j.error));
      const ch = (j.choices || [])[0] || {};
      if (ch.finish_reason === 'length') throw new AIError('too_long');
      if (ch.finish_reason === 'content_filter') throw new AIError('refused');
      const out = (ch.message && ch.message.content) || '';
      const v = parseJSON(Array.isArray(out) ? out.map((p) => p.text || '').join('') : out);
      if (!v) throw new AIError('invalid_json', 'length ' + String(out).length);
      const u = j.usage || {};
      return { value: v, usage: { input_tokens: u.prompt_tokens || 0, output_tokens: u.completion_tokens || 0, cost: u.cost }, sources: null, model: 'openai:' + (j.model || m.model) };
    }
    if ((r.status === 429 || r.status >= 500) && attempt++ < 1) { await pause(2500); continue; }
    throw httpError(r.status, text);
  }
}

function httpError(status, text) {
  if (status === 429) return new AIError('busy', text.slice(0, 200));
  if (status === 529 || status >= 500) return new AIError('busy', status + ' ' + text.slice(0, 200));
  if (status === 400 && /prompt is too long|too many tokens|context/i.test(text)) return new AIError('prompt_too_large');
  return new AIError('ai_error', status + ' ' + text.slice(0, 300));
}
