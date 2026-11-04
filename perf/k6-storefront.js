// k6 load test for staging (and the CI smoke job): shoppers browsing a store and getting checkout quotes.
// Thresholds are the NFRs in docs/PRODUCT_REQUIREMENTS.md §5. Run on staging with real TLS hosts, e.g.
//   k6 run -e BASE=https://demo.shopmint.in perf/k6-storefront.js
// BASE is a storefront origin; API calls go to the same origin (/api/storefront/*), as browsers do.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE = __ENV.BASE || 'http://desithreads.localhost:3000';
const headers = { 'X-ShopMint-Csrf': '1', 'Content-Type': 'application/json', Accept: 'application/json' };

export const options = {
  scenarios: {
    browse: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: __ENV.RAMP || '30s', target: Number(__ENV.VUS || 50) }, { duration: __ENV.HOLD || '2m', target: Number(__ENV.VUS || 50) }, { duration: '15s', target: 0 }] },
  },
  thresholds: {
    'http_req_failed': ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<300'],
    'http_req_duration{kind:checkout}': ['p(95)<800'],
  },
};

export function setup() {
  const list = http.get(`${BASE}/api/storefront/products?pageSize=24`, { headers }).json();
  return { slugs: list.items.map((p) => p.slug) };
}

export default function (data) {
  const slug = data.slugs[Math.floor(Math.random() * data.slugs.length)];
  check(http.get(`${BASE}/`, { tags: { kind: 'read' } }), { 'home 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/api/storefront/products?pageSize=24`, { headers, tags: { kind: 'read' } }), { 'list 200': (r) => r.status === 200 });
  const p = http.get(`${BASE}/api/storefront/products/${slug}`, { headers, tags: { kind: 'read' } });
  check(p, { 'product 200': (r) => r.status === 200 });
  check(http.get(`${BASE}/products/${slug}`, { tags: { kind: 'read' } }), { 'product page 200': (r) => r.status === 200 });
  // One in ten virtual users is a signed-in shopper getting a checkout quote.
  if (__VU % 10 === 0 && __ITER === 0) {
    const email = `k6-${__VU}-${Date.now()}@example.com`;
    http.post(`${BASE}/api/storefront/account/signup`, JSON.stringify({ name: 'k6 Shopper', email, password: 'K6-Shopper-Pass-1' }), { headers });
    const addr = http.post(`${BASE}/api/storefront/account/addresses`, JSON.stringify({ name: 'k6', phone: '9876543210', line1: '1 Test Road', city: 'Pune', stateCode: '27', pincode: '411001' }), { headers }).json();
    const v = p.json().variants.find((x) => x.available);
    if (v && addr && addr.id) {
      http.post(`${BASE}/api/storefront/cart/lines`, JSON.stringify({ variantId: v.id, quantity: 1 }), { headers });
      check(http.post(`${BASE}/api/storefront/checkout/quote`, JSON.stringify({ addressId: addr.id }), { headers, tags: { kind: 'checkout' } }), { 'quote 200': (r) => r.status === 200 });
    }
  }
  sleep(1);
}
