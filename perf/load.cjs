// Dependency-free load test (Node's http module) for local and CI stacks: fixed concurrency per scenario for a fixed
// time, reporting throughput and latency percentiles against the NFRs in PRODUCT_REQUIREMENTS.md §5
// (p95 < 300 ms for reads, < 800 ms for checkout excluding the gateway). For staging use k6-storefront.js.
// Usage: node perf/load.cjs [--seconds 15] [--concurrency 20] [--store desithreads.localhost]
const http = require('http');

const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const SECONDS = Number(arg('seconds', 15));
const CONCURRENCY = Number(arg('concurrency', 20));
const STORE = arg('store', 'desithreads.localhost');
const API = new URL(arg('api', 'http://localhost:5080'));
const WEB = new URL(arg('web', 'http://localhost:3000'));
const agent = new http.Agent({ keepAlive: true, maxSockets: CONCURRENCY * 2 });

function request(base, method, path, { host, body, cookie } = {}) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const headers = { Accept: 'application/json', 'X-ShopMint-Csrf': '1', 'X-Forwarded-Host': host ?? STORE, 'X-Forwarded-Proto': 'https' };
    if (host) headers.Host = host;
    if (cookie) headers.Cookie = cookie;
    let payload;
    if (body) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    const req = http.request({ hostname: base.hostname, port: base.port, path, method, headers, agent }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, ms: Number(process.hrtime.bigint() - started) / 1e6, body: Buffer.concat(chunks).toString(), headers: res.headers }));
    });
    req.on('error', () => resolve({ status: 0, ms: Number(process.hrtime.bigint() - started) / 1e6, body: '', headers: {} }));
    if (payload) req.write(payload);
    req.end();
  });
}

const pct = (sorted, p) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : NaN;

async function run(name, target, fn) {
  const times = [];
  let errors = 0;
  const end = Date.now() + SECONDS * 1000;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (Date.now() < end) {
      const r = await fn();
      if (r.status >= 200 && r.status < 400) times.push(r.ms); else errors++;
    }
  }));
  times.sort((a, b) => a - b);
  const row = { scenario: name, requests: times.length + errors, rps: Math.round((times.length + errors) / SECONDS), errors,
    p50: Math.round(pct(times, 50)), p95: Math.round(pct(times, 95)), p99: Math.round(pct(times, 99)), target, ok: pct(times, 95) < target && errors === 0 };
  console.log(`${row.ok ? 'PASS' : 'FAIL'} ${name.padEnd(34)} ${String(row.rps).padStart(5)} req/s  p50 ${String(row.p50).padStart(4)} ms  p95 ${String(row.p95).padStart(4)} ms  p99 ${String(row.p99).padStart(4)} ms  errors ${errors}  (p95 target < ${target} ms)`);
  return row;
}

(async () => {
  console.log(`Load test: ${CONCURRENCY} concurrent clients, ${SECONDS}s per scenario, store ${STORE}\n`);
  const list = JSON.parse((await request(API, 'GET', '/api/storefront/products?pageSize=24')).body);
  const slug = list.items[0].slug;
  const product = JSON.parse((await request(API, 'GET', `/api/storefront/products/${slug}`)).body);
  const variant = product.variants.find((v) => v.available).id;

  // A signed-in shopper with an address and a cart, for the checkout quote.
  const email = `load-${Date.now()}@example.com`;
  const signup = await request(API, 'POST', '/api/storefront/account/signup', { body: { name: 'Load Test', email, password: 'Load-Test-Pass-1' } });
  const cookie = (signup.headers['set-cookie'] || []).map((c) => c.split(';')[0]).join('; ');
  const addr = JSON.parse((await request(API, 'POST', '/api/storefront/account/addresses', { cookie, body: { name: 'Load Test', phone: '9876543210', line1: '1 Test Road', city: 'Pune', stateCode: '27', pincode: '411001' } })).body);
  await request(API, 'POST', '/api/storefront/cart/lines', { cookie, body: { variantId: variant, quantity: 1 } });
  const webHost = `${STORE}:${WEB.port}`;

  const rows = [];
  rows.push(await run('API  GET product list', 300, () => request(API, 'GET', '/api/storefront/products?pageSize=24')));
  rows.push(await run('API  GET product detail', 300, () => request(API, 'GET', `/api/storefront/products/${slug}`)));
  rows.push(await run('API  GET product search', 300, () => request(API, 'GET', '/api/storefront/products?q=cotton&sort=price_asc')));
  rows.push(await run('API  GET cart (signed in)', 300, () => request(API, 'GET', '/api/storefront/cart', { cookie })));
  rows.push(await run('API  POST checkout quote', 800, () => request(API, 'POST', '/api/storefront/checkout/quote', { cookie, body: { addressId: addr.id } })));
  rows.push(await run('Web  GET storefront home', 300, () => request(WEB, 'GET', '/', { host: webHost })));
  rows.push(await run('Web  GET product page', 300, () => request(WEB, 'GET', `/products/${slug}`, { host: webHost })));
  console.log(`\n${rows.every((r) => r.ok) ? 'All scenarios within targets.' : 'Some scenarios missed their target.'}`);
  console.log(JSON.stringify({ seconds: SECONDS, concurrency: CONCURRENCY, rows }));
  agent.destroy();
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
