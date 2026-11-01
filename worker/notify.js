// Messages to the Lark group (the same custom bot as the website: LARK_WEBHOOK, LARK_WEBHOOK_SECRET).
// Only purchases and problems are sent, never what a user wrote.
async function sign(secret, timestamp) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(`${timestamp}\n${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new Uint8Array(0)));
  let s = ''; for (const b of sig) s += String.fromCharCode(b);
  return btoa(s);
}

export async function notify(env, text) {
  if (!env.LARK_WEBHOOK) { console.log('notify (LARK_WEBHOOK not set):', text); return; }
  const body = { msg_type: 'text', content: { text: '【職務経歴書AI】' + text } };
  if (env.LARK_WEBHOOK_SECRET) { const ts = String(Math.floor(Date.now() / 1000)); body.timestamp = ts; body.sign = await sign(env.LARK_WEBHOOK_SECRET, ts); }
  try {
    const r = await fetch(env.LARK_WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    const code = j.code !== undefined ? j.code : j.StatusCode;
    if (code !== 0) console.error('notify', r.status, JSON.stringify(j).slice(0, 200));
  } catch (e) { console.error('notify', String(e.message || e)); }
}
