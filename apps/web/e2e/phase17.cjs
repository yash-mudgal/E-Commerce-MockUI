// Phase 17 browser walkthrough: delivery zones and estimates by PIN code, and returns from request to refund.
// The merchant sets a return window, default delivery days and a Pune zone (free, 1–2 days, no COD); a shopper checks
// delivery on a product page; a delivered order is returned, approved, received (restocked) and refunded.
// Restores the store's settings afterwards. Needs the local stack with demo seed and MAIL_DIR or Mailpit.
// Run: node e2e/phase17.cjs [screenshot-dir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const APP = 'http://localhost:3000';
const STORE = 'http://desithreads.localhost:3000';
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, label) => { log(ok ? '  ✓' : '  ✗', label); if (!ok) failures.push(label); };
const shows = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true, () => false);

async function call(page, p, init = {}) {
  return page.evaluate(async ([p, init]) => {
    const r = await fetch(p, { ...init, headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1', ...(init.headers || {}) } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json };
  }, [p, init]);
}

async function eventually(page, locator, tries = 14) {
  for (let i = 0; i < tries; i++) {
    if (await shows(locator, 2500)) return true;
    await page.waitForTimeout(2500);
    await page.reload();
  }
  return false;
}

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|422)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const stamp = Date.now().toString(36);

  log('1. Merchant: return window, delivery days and a zone');
  const adminCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await adminCtx.newPage(); watch(a);
  await a.goto(`${APP}/login`);
  await a.getByLabel('Email').fill('owner@desithreads.demo');
  await a.getByLabel('Password', { exact: true }).fill('Demo-Passw0rd!');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForURL('**/admin');
  await a.goto(`${APP}/admin/settings`);
  await a.getByLabel('Return window (days after delivery)').fill('7');
  await a.getByLabel(/^Delivery from \(days\)/).first().fill('3');
  await a.getByLabel(/^Delivery up to \(days\)/).first().fill('5');
  await a.getByRole('button', { name: 'Save changes' }).click();
  check(await shows(a.getByText('Settings saved')), 'return window and delivery days saved');
  await a.getByRole('button', { name: 'Add zone' }).click();
  const zd = a.getByRole('dialog');
  await zd.getByLabel('Name').fill(`Pune ${stamp}`);
  await zd.getByLabel('PIN codes or prefixes').fill('411');
  await zd.getByLabel(/^Delivery fee/).fill('0');
  await zd.getByLabel(/^Delivery from/).fill('1');
  await zd.getByLabel(/^Delivery up to/).fill('2');
  await zd.getByLabel(/Cash on delivery in this zone/).uncheck();
  await zd.getByRole('button', { name: 'Add zone' }).click();
  check(await shows(a.getByText('Zone added')), 'delivery zone added');
  check(await shows(a.getByText(`Pune ${stamp}`)), 'zone listed');
  await a.screenshot({ path: `${out}/p17-01-settings.png`, fullPage: true });

  log('2. Shopper checks delivery on a product page');
  const shopCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await shopCtx.newPage(); watch(p);
  await p.goto(`${STORE}/`);
  const product = (await call(p, '/api/storefront/products?inStock=true&pageSize=1&sort=price_asc')).json.items[0];
  await p.goto(`${STORE}/products/${product.slug}`);
  check(await eventually(p, p.getByText('7-day returns')), 'product page states the return window');
  await p.getByLabel('PIN code').fill('411002');
  await p.getByRole('button', { name: 'Check', exact: true }).click();
  check(await shows(p.getByText('Delivery in 1–2 days')), 'Pune: 1–2 days');
  check(await shows(p.getByText('Free shipping', { exact: true })), 'Pune: free shipping');
  check(await shows(p.getByText('Cash on delivery not available')), 'Pune: no cash on delivery');
  await p.getByLabel('PIN code').fill('560001');
  await p.getByRole('button', { name: 'Check', exact: true }).click();
  check(await shows(p.getByText('Delivery in 3–5 days')), 'elsewhere: the default estimate');
  check(await shows(p.getByText(/Cash on delivery available/)), 'elsewhere: cash on delivery');
  await p.screenshot({ path: `${out}/p17-02-delivery-check.png`, fullPage: true });

  log('3. A delivered order (Bengaluru, cash on delivery)');
  const email = `returner-${stamp}@example.com`;
  await call(p, '/api/storefront/account/signup', { method: 'POST', body: JSON.stringify({ name: 'Arjun Mehta', email, password: 'Return-Pass-' + stamp }) });
  const address = (await call(p, '/api/storefront/account/addresses', { method: 'POST', body: JSON.stringify({ name: 'Arjun Mehta', phone: '9845012345', line1: '12 Residency Road', city: 'Bengaluru', stateCode: '29', pincode: '560025' }) })).json;
  const detail = (await call(p, `/api/storefront/products/${product.slug}`)).json;
  await call(p, '/api/storefront/cart/lines', { method: 'POST', body: JSON.stringify({ variantId: detail.variants.find((v) => v.available).id, quantity: 2 }) });
  const placed = await call(p, '/api/storefront/checkout/orders', { method: 'POST', body: JSON.stringify({ addressId: address.id, paymentMethod: 'cod' }), headers: { 'Idempotency-Key': 'p17-' + stamp } });
  check(placed.status === 200, `order placed (${placed.status})`);
  const orderId = placed.json.orderId;
  for (const step of ['pack', 'ship', 'deliver']) {
    const r = await call(a, `/api/admin/orders/${orderId}/${step}`, { method: 'POST', body: step === 'ship' ? JSON.stringify({ carrier: 'Blue Dart', trackingNumber: 'P17' + stamp }) : undefined });
    check(r.status === 200, `merchant: ${step}`);
  }

  log('4. Shopper requests a return');
  await p.goto(`${STORE}/account/orders/${orderId}`);
  await p.getByRole('button', { name: 'Request a return' }).click();
  const rd = p.getByRole('dialog', { name: 'Request a return' });
  await rd.getByRole('button', { name: 'Send request' }).click();
  check(await shows(rd.getByText('Choose at least one item to return.')), 'needs at least one item');
  await rd.getByLabel(`Quantity of ${detail.title} to return`).selectOption('1');
  await rd.getByLabel('Reason').selectOption('SizeOrFit');
  await rd.getByLabel(/^Details/).fill(`Too small, can I get one size up? (${stamp})`);
  await rd.getByRole('button', { name: 'Send request' }).click();
  check(await shows(p.getByText('Waiting for the store')), 'return requested');
  await p.screenshot({ path: `${out}/p17-03-return-requested.png`, fullPage: true });

  log('5. Merchant approves, receives (restock) and refunds');
  await a.goto(`${APP}/admin/returns`);
  const row = () => a.getByRole('listitem').filter({ hasText: stamp });
  check(await shows(row()), 'return in the admin queue');
  await row().getByRole('button', { name: 'Approve' }).click();
  await a.getByRole('dialog').getByLabel(/Instructions for the shopper/).fill('Our courier will pick it up within 2 days.');
  await a.getByRole('dialog').getByRole('button', { name: 'Approve return' }).click();
  check(await shows(a.getByText(/Approve return: done/)), 'approved');
  await a.getByRole('button', { name: 'Approved, awaiting parcel' }).click();
  await row().getByRole('button', { name: 'Mark received' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Mark parcel received' }).click();
  check(await shows(a.getByText(/Mark parcel received: done/)), 'received and restocked');
  await a.getByRole('button', { name: 'Received', exact: true }).click();
  await row().getByRole('button', { name: 'Refund', exact: true }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Refund return' }).click();
  check(await shows(a.getByText(/Refund return: done/)), 'refunded');
  await a.getByRole('button', { name: 'Refunded', exact: true }).click();
  check(await shows(row().getByText(/Restocked\. Refunded ₹/)), 'listed as restocked and refunded');
  await a.screenshot({ path: `${out}/p17-04-admin-returns.png`, fullPage: true });

  await p.reload();
  check(await shows(p.getByText('Refunded', { exact: true })), 'shopper sees the refund');
  check(await shows(p.getByText('Our courier will pick it up within 2 days.')), "shopper sees the store's note");

  log('6. Restore the store');
  for (const z of (await call(a, '/api/admin/shipping-zones')).json.filter((x) => x.name.endsWith(stamp))) await call(a, `/api/admin/shipping-zones/${z.id}`, { method: 'DELETE' });
  const st = (await call(a, '/api/admin/store')).json;
  const reset = await call(a, '/api/admin/store', { method: 'PATCH', body: JSON.stringify({
    name: st.name, legalName: st.legalName, gstin: st.gstin, stateCode: st.stateCode, tagline: st.tagline, supportEmail: st.supportEmail,
    brandColor: st.brandColor, lowStockThreshold: st.lowStockThreshold, returnWindowDays: 0, clearDeliveryDays: true,
  }) });
  check(reset.status === 200, 'store restored');

  check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await b.close();
  if (failures.length) { log(`\n${failures.length} CHECK(S) FAILED`); process.exit(1); }
  log('\nALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
