// Shared set-up for the browser tests: Chromium against `npm run dev` (localhost:8787, DEV_AUTH / AI_MOCK /
// STRIPE_MOCK), with the website's brand kit served from a local build of the website (FLATLAND_DIST).
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const require = createRequire(import.meta.url);
export const { chromium } = require('playwright');
export const BASE = process.env.BASE || 'http://localhost:8787';
const DIST = process.env.FLATLAND_DIST || '/home/claude/flatland/dist';
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };

export async function context(browser, opts = {}) {
  const ctx = await browser.newContext({ acceptDownloads: true, locale: 'ja-JP', ...opts });
  await ctx.route('https://www.flatland.co.jp/**', (route) => {
    const p = join(DIST, decodeURIComponent(new URL(route.request().url()).pathname));
    if (existsSync(p)) return route.fulfill({ body: readFileSync(p), headers: { 'content-type': TYPES[extname(p)] || 'application/octet-stream', 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 404, body: '' });
  });
  await ctx.route('https://fonts.googleapis.com/**', (route) => route.fulfill({ body: '', headers: { 'content-type': 'text/css' } }));
  return ctx;
}
export function watch(page, errors) {
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|status of 409/.test(m.text())) errors.push('console: ' + m.text()); });
}
