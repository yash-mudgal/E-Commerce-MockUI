#!/usr/bin/env node
// Post-deploy smoke test (no dependencies). Read-only: it never signs in or changes data.
//
//   node ops/smoke.cjs --app https://app.shopmint.in --store https://demo.shopmint.in --edge
//   node ops/smoke.cjs --app http://localhost:3001 --store http://desithreads.localhost:3001     (local production mode)
//
// --store   a launched store to check (optional; storefront checks are skipped without it)
// --edge    the target is behind CloudFront: also check HTTPS redirect, HSTS, /internal/* hidden and X-Forwarded-Host
//           ignored. Exit code 0 when every check passes.
const http = require('http');
const https = require('https');

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const APP = arg('app');
const STORE = arg('store');
const EDGE = process.argv.includes('--edge');
if (!APP) { console.error('Usage: node ops/smoke.cjs --app <url> [--store <url>] [--edge]'); process.exit(2); }

function request(url, { method = 'GET', headers = {}, body } = {}) {
  const u = new URL(url);
  const lib = u.protocol === 'https:' ? https : http;
  return new Promise((resolve) => {
    const started = Date.now();
    // Browsers resolve *.localhost to this machine; Node doesn't, so connect to 127.0.0.1 with the right Host header.
    const local = u.hostname.endsWith('.localhost');
    const req = lib.request({
      protocol: u.protocol, hostname: local ? '127.0.0.1' : u.hostname, port: u.port, path: u.pathname + u.search, servername: u.hostname,
      method, timeout: 15000, headers: { 'User-Agent': 'shopmint-smoke/1', ...(local ? { Host: u.host } : {}), ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString(), ms: Date.now() - started }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ status: 0, headers: {}, body: String(e.message), ms: Date.now() - started }));
    if (body) req.write(body);
    req.end();
  });
}

const results = [];
const check = (ok, label, detail = '') => { results.push({ ok, label }); console.log(`${ok ? '  ✓' : '  ✗'} ${label}${detail ? ` (${detail})` : ''}`); };
const title = (html) => (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';

(async () => {
  console.log(`Smoke test: ${APP}${STORE ? ` and ${STORE}` : ''}${EDGE ? ' (behind CloudFront)' : ''}`);

  const login = await request(`${APP}/login`);
  check(login.status === 200 && /^Sign in/.test(title(login.body)), 'sign-in page renders', `${login.status}, ${login.ms} ms`);
  check(/default-src 'self'/.test(login.headers['content-security-policy'] || ''), 'web Content-Security-Policy');
  check(!login.headers['x-powered-by'], 'no X-Powered-By');
  check(login.headers['x-content-type-options'] === 'nosniff', 'nosniff on pages');

  const me = await request(`${APP}/api/auth/me`, { headers: { Accept: 'application/json' } });
  check(me.status === 401 && /application\/problem\+json/.test(me.headers['content-type'] || ''), 'API answers through the app host (401 problem when signed out)', `${me.status}, ${me.ms} ms`);
  check(/default-src 'none'/.test(me.headers['content-security-policy'] || ''), 'API Content-Security-Policy');
  check(!/stack|exception/i.test(me.body), 'API errors carry no stack traces');

  const noCsrf = await request(`${APP}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check(noCsrf.status === 400 || noCsrf.status === 403, 'unsafe request without the CSRF header refused', String(noCsrf.status));

  const platform = await request(`${APP}/api/platform/tenants`, { headers: { 'X-ShopMint-Csrf': '1' } });
  check(platform.status === 401, 'platform API needs a session', String(platform.status));

  if (EDGE) {
    const u = new URL(APP);
    check(u.protocol === 'https:', 'app served over HTTPS');
    const plain = await request(`http://${u.host}/login`);
    check([301, 302, 307, 308].includes(plain.status) && /^https:/.test(plain.headers.location || ''), 'HTTP redirects to HTTPS', String(plain.status));
    check(/max-age=\d{7,}/.test(login.headers['strict-transport-security'] || ''), 'HSTS on pages');
    check(/max-age=\d{7,}/.test(me.headers['strict-transport-security'] || ''), 'HSTS on the API');
    for (const p of ['/internal/health', '/internal/revalidate']) {
      const r = await request(`${APP}${p}`, { method: p.endsWith('revalidate') ? 'POST' : 'GET' });
      check(r.status === 404, `${p} not reachable from the internet`, String(r.status));
    }
  }

  if (STORE) {
    const home = await request(`${STORE}/`);
    check(home.status === 200 && title(home.body) !== '', 'storefront home renders', `${home.status}, "${title(home.body)}", ${home.ms} ms`);
    const products = await request(`${STORE}/products`);
    check(products.status === 200, 'storefront catalogue renders', `${products.status}, ${products.ms} ms`);
    const sitemap = await request(`${STORE}/sitemap.xml`);
    check(sitemap.status === 200 && /<urlset/.test(sitemap.body), 'sitemap.xml');
    const missing = await request(`${STORE}/products/this-product-does-not-exist-smoke`);
    check(missing.status === 404, 'unknown product answers 404', String(missing.status));
    const storeApi = await request(`${STORE}/api/storefront/store`, { headers: { Accept: 'application/json' } });
    check(storeApi.status === 200, 'storefront API on the store host', `${storeApi.status}, ${storeApi.ms} ms`);
    if (EDGE) {
      const spoofed = await request(`${STORE}/`, { headers: { 'X-Forwarded-Host': `smoke-spoof-${Date.now()}.example.com` } });
      check(spoofed.status === 200 && title(spoofed.body) === title(home.body), 'X-Forwarded-Host from the browser is ignored');
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} of ${results.length} checks FAILED.` : `\nAll ${results.length} checks passed.`);
  process.exit(failed.length ? 1 : 0);
})();
