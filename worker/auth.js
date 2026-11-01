// Who is calling: the Clerk session token (a JWT signed with RS256) in "Authorization: Bearer …",
// checked against the instance's public keys (CLERK_JWKS_URL). Returns { id } or null.
//
// Local development only: with DEV_AUTH = "1" (in .dev.vars, never in production) the header
// "Authorization: Dev <user id>" is accepted from localhost.

let jwksCache = { url: '', at: 0, keys: [] };
let lastForced = 0;   // an unknown key id refreshes the keys at most once a minute

const b64urlBytes = (s) => {
  s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
  const bin = atob(s); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlJSON = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

async function keys(env, force) {
  const url = env.CLERK_JWKS_URL;
  if (!url) throw new Error('CLERK_JWKS_URL not set');
  const fresh = jwksCache.url === url && Date.now() - jwksCache.at < 10 * 60 * 1000;
  if (fresh && (!force || Date.now() - lastForced < 60 * 1000)) return jwksCache.keys;
  if (force) lastForced = Date.now();
  const r = await fetch(url, { headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error('jwks ' + r.status);
  const j = await r.json();
  jwksCache = { url, at: Date.now(), keys: j.keys || [] };
  return jwksCache.keys;
}

export async function verifyToken(token, env, now = Date.now() / 1000) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  let header, claims;
  try { header = b64urlJSON(parts[0]); claims = b64urlJSON(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  let jwk = (await keys(env)).find((k) => k.kid === header.kid);
  if (!jwk) jwk = (await keys(env, true)).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]));
  if (!ok) return null;
  const skew = 10;
  if (typeof claims.exp !== 'number' || claims.exp < now - skew) return null;
  if (typeof claims.nbf === 'number' && claims.nbf > now + skew) return null;
  const parties = String(env.APP_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (claims.azp && parties.length && !parties.includes(claims.azp)) return null;
  if (claims.sts === 'pending') return null;
  if (!claims.sub) return null;
  return { id: String(claims.sub) };
}

export async function authenticate(request, env) {
  const h = request.headers.get('authorization') || '';
  if (env.DEV_AUTH === '1' && h.startsWith('Dev ')) {
    const host = new URL(request.url).hostname;
    if (host === 'localhost' || host === '127.0.0.1') return { id: 'dev_' + h.slice(4).replace(/[^\w-]/g, '').slice(0, 40), dev: true };
    return null;
  }
  if (!h.startsWith('Bearer ')) return null;
  try { return await verifyToken(h.slice(7), env); } catch (e) { console.error('auth', String(e.message || e)); return null; }
}

// the user's primary email address, from Clerk's Backend API (needed for Stripe receipts)
export async function clerkEmail(env, id) {
  if (!env.CLERK_SECRET_KEY) return '';
  const r = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(id), { headers: { authorization: 'Bearer ' + env.CLERK_SECRET_KEY } });
  if (!r.ok) return '';
  const u = await r.json();
  const p = (u.email_addresses || []).find((e) => e.id === u.primary_email_address_id) || (u.email_addresses || [])[0];
  return p ? p.email_address : '';
}

// throws when Clerk did not delete the user (already gone counts as deleted)
export async function clerkDelete(env, id) {
  if (!env.CLERK_SECRET_KEY) throw new Error('CLERK_SECRET_KEY not set');
  const r = await fetch('https://api.clerk.com/v1/users/' + encodeURIComponent(id), { method: 'DELETE', headers: { authorization: 'Bearer ' + env.CLERK_SECRET_KEY } });
  if (!r.ok && r.status !== 404) throw new Error('clerk delete ' + r.status);
}
