// Phase 10 browser walkthrough: a new store takes a mix of orders (COD and online, two states, two GST rates, a refund,
// a cancellation, an unpaid order) and the Reports page and CSV export must add up to those orders exactly. Also:
// GST summary, date ranges, new-order email preference, abandoned-cart setting and the shopper unsubscribe page.
// Low-stock digests and abandoned-cart sending need time to pass, so they're covered by the API tests.
// Needs the local stack (API in Development, test payments) and MAIL_DIR or Mailpit. Run: node e2e/phase10.cjs [dir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const APP = 'http://localhost:3000';
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, label) => { log(ok ? '  ✓' : '  ✗', label); if (!ok) failures.push(label); };
const shows = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
const money = (n) => '₹' + Number(n).toLocaleString('en-IN', Number.isInteger(Number(n)) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (xs, f) => Math.round(xs.reduce((s, x) => s + Number(f(x)), 0) * 100) / 100;

function decodeQuotedPrintable(s) { return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); }
async function waitForMail(to, needle, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.env.MAIL_DIR) {
      for (const f of fs.readdirSync(process.env.MAIL_DIR).filter((x) => x.endsWith('.eml')).sort().reverse()) {
        const text = fs.readFileSync(path.join(process.env.MAIL_DIR, f), 'utf8');
        if (!text.split('\n')[0].includes(to)) continue;
        if (text.includes(needle)) return text;
        const d = decodeQuotedPrintable(text);
        if (d.includes(needle)) return d;
      }
    } else {
      const api = process.env.MAILPIT_URL || 'http://localhost:8025';
      const res = await fetch(`${api}/api/v1/search?query=${encodeURIComponent('to:' + to)}`).then((r) => r.json()).catch(() => null);
      for (const m of res?.messages ?? []) {
        const msg = await fetch(`${api}/api/v1/message/${m.ID}`).then((r) => r.json());
        if (msg.Text.includes(needle)) return msg.Text;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

const call = (page, method, url, body) => page.evaluate(async ([method, url, body]) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1', 'Idempotency-Key': crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
}, [method, url, body]);

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 120)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|404|409|422)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const stamp = Date.now().toString(36);
  const sub = 'p10' + stamp;
  const ownerEmail = `${sub}@example.com`;
  const STORE = `http://${sub}.localhost:3000`;
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const p = await ctx.newPage(); watch(p);

  log('1. A live store with two GST rates');
  await p.goto(`${APP}/login`);
  await call(p, 'POST', '/api/auth/signup', { name: 'Report Owner', email: ownerEmail, password: 'Report-Owner-' + stamp, storeName: 'Phase Ten Traders', subdomain: sub });
  const mail = await waitForMail(ownerEmail, '/verify-email?token=');
  await call(p, 'POST', '/api/auth/email/verify', { token: mail.match(/verify-email\?token=([A-Za-z0-9_\-%]+)/)[1] });
  const store = (await call(p, 'GET', '/api/admin/store')).json;
  await call(p, 'PATCH', '/api/admin/store', { name: store.name, brandColor: store.brandColor, lowStockThreshold: 5, supportEmail: `orders-${sub}@example.com`, gstin: '27AAGCD4821M1Z3', legalName: 'Phase Ten Traders' });
  const shawl = (await call(p, 'POST', '/api/admin/products', { title: 'Pashmina Shawl', status: 'active', gstRate: 12, hsnCode: '6214', optionNames: [], variants: [{ sku: 'SH-' + stamp, optionValues: [], price: 1200, mrp: 1500, stockOnHand: 30 }] })).json;
  const tea = (await call(p, 'POST', '/api/admin/products', { title: 'Darjeeling Tea', status: 'active', gstRate: 5, hsnCode: '0902', optionNames: [], variants: [{ sku: 'TE-' + stamp, optionValues: [], price: 350, mrp: 400, stockOnHand: 30 }] })).json;
  check((await call(p, 'POST', '/api/admin/onboarding/launch')).status < 300, 'store launched');

  log('2. Orders: COD and online, Maharashtra and Karnataka, refund, cancellation, unpaid');
  const shopCtx = await b.newContext();
  async function order(state, lines, method, pay = true) {
    const s = await shopCtx.newPage();
    await s.goto(`${STORE}/`);
    await s.evaluate(() => { document.cookie = 'sm_c=; Max-Age=0; path=/'; });
    await call(s, 'POST', '/api/storefront/account/signup', { name: `Buyer ${state}`, email: `buyer-${state}-${crypto.randomUUID().slice(0, 8)}-${stamp}@example.com`, password: 'Buyer-Pass-' + stamp });
    const addr = (await call(s, 'POST', '/api/storefront/account/addresses', { name: 'Buyer', phone: '9876543210', line1: '1 Main Road', city: state === '27' ? 'Pune' : 'Mysuru', stateCode: state, pincode: state === '27' ? '411001' : '570001' })).json;
    for (const [v, q] of lines) await call(s, 'POST', '/api/storefront/cart/lines', { variantId: v.variants[0].id, quantity: q });
    const placed = (await call(s, 'POST', '/api/storefront/checkout/orders', { addressId: addr.id, paymentMethod: method })).json;
    if (method === 'online' && pay) await call(s, 'POST', `/api/storefront/checkout/orders/${placed.orderId}/test-payment`, { outcome: 'success' });
    await s.close();
    return placed.orderId;
  }
  const ids = [];
  ids.push(await order('27', [[shawl, 2], [tea, 1]], 'cod'));
  const online = await order('29', [[shawl, 1], [tea, 2]], 'online');
  ids.push(online);
  ids.push(await order('27', [[tea, 1]], 'cod')); // below free delivery: pays the delivery fee
  const cancelled = await order('27', [[tea, 3]], 'cod');
  ids.push(cancelled);
  ids.push(await order('29', [[shawl, 1]], 'online', false)); // never paid
  check((await call(p, 'POST', `/api/admin/orders/${online}/refunds`, { amount: 50, reason: 'Late delivery' })).status === 200, 'partial refund');
  check((await call(p, 'POST', `/api/admin/orders/${cancelled}/cancel`, { reason: 'Customer request' })).status === 200, 'cancellation');
  const orders = [];
  for (const id of ids) orders.push((await call(p, 'GET', `/api/admin/orders/${id}`)).json);
  const sales = orders.filter((o) => !['PendingPayment', 'Cancelled', 'Expired'].includes(o.status));
  const expectedNet = sum(sales, (o) => o.total) - sum(sales, (o) => o.refundedTotal);
  check(sales.length === 3, 'three sales, one cancelled, one unpaid');

  log('3. Reports page adds up to the orders');
  await p.goto(`${APP}/admin/reports`);
  check(await shows(p.getByText('Net sales').first()), 'reports page');
  const rep = (await call(p, 'GET', '/api/admin/reports/sales')).json;
  check(rep.totals.orders === 3, `orders counted (${rep.totals.orders})`);
  check(Number(rep.totals.total) === sum(sales, (o) => o.total), `sales total = Σ order totals (${rep.totals.total})`);
  check(Number(rep.totals.refunds) === 50, `refunds (${rep.totals.refunds})`);
  check(Number(rep.totals.netSales) === expectedNet, `net sales = ${expectedNet}`);
  check(Number(rep.totals.tax) === sum(sales, (o) => Number(o.cgst) + Number(o.sgst) + Number(o.igst)), 'GST collected = Σ order taxes');
  check(rep.cancelled.orders === 1, 'cancelled order reported separately');
  check(await shows(p.getByText(money(expectedNet)).first()), `net sales shown (${money(expectedNet)})`);
  check(await shows(p.getByRole('cell', { name: 'Pashmina Shawl' })), 'top products');
  check(await shows(p.getByRole('cell', { name: 'Cash on delivery' })), 'payment split');
  check(await shows(p.getByRole('cell', { name: 'Karnataka' })), 'by delivery state');
  await p.screenshot({ path: `${out}/p10-01-reports.png`, fullPage: true });

  log('4. GST summary');
  const gst = (await call(p, 'GET', '/api/admin/reports/gst')).json;
  const invoiced = orders.filter((o) => o.invoiceNumber && o.status !== 'Cancelled');
  check(gst.invoices === invoiced.length && Number(gst.igst) === sum(invoiced, (o) => o.igst) && Number(gst.cgst) === sum(invoiced, (o) => o.cgst), 'GST totals = Σ invoices');
  check(gst.byStateAndRate.some((r) => r.stateCode === '29' && Number(r.rate) === 5 && Number(r.igst) > 0), 'Karnataka 5% IGST row');
  check(gst.byStateAndRate.some((r) => r.stateCode === '27' && Number(r.rate) === 12 && Number(r.cgst) > 0 && Number(r.igst) === 0), 'Maharashtra 12% CGST row');
  check(await shows(p.getByText(/1 invoice was cancelled/)), 'cancelled invoice note (credit notes)');
  await p.getByText('HSN summary').click();
  check(await shows(p.getByRole('cell', { name: '9965' })), 'delivery under SAC 9965');

  log('5. Orders CSV');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.getByRole('link', { name: 'Orders CSV' }).click()]);
  const csv = fs.readFileSync(await dl.path(), 'utf8').replace(/^﻿/, '');
  const rows = csv.trim().split('\r\n');
  check(/^orders-\d{4}-\d{2}-\d{2}-to-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), `file name ${dl.suggestedFilename()}`);
  check(rows.length === 1 + orders.length, `one row per order, any status (${rows.length - 1})`);
  const totalCol = rows[0].split(',').indexOf('Total');
  check(Math.round(rows.slice(1).reduce((s, r) => s + Number(r.split(',')[totalCol]), 0) * 100) / 100 === sum(orders, (o) => o.total), 'CSV totals = Σ order totals');

  log('6. Date ranges');
  await p.getByLabel('Period', { exact: true }).selectOption('custom');
  await p.getByLabel('From').fill('2025-01-01');
  await p.getByLabel('To').fill('2025-01-31');
  check(await shows(p.getByText('No sales in this period')), 'empty range shows an empty state');
  await p.getByLabel('Period', { exact: true }).selectOption('this-fy');
  check(await shows(p.getByText(money(expectedNet)).first()), 'this financial year includes the orders');

  log('7. Notifications and shopper emails');
  await p.goto(`${APP}/admin/account`);
  const toggle = p.getByRole('checkbox', { name: /New orders/ });
  check(!(await toggle.isChecked()), 'new-order emails off by default for the owner');
  check(await p.getByRole('checkbox', { name: /Low stock/ }).isChecked(), 'low-stock digest on by default for the owner');
  await toggle.check();
  check(await shows(p.getByText('Notification settings saved')), 'preference saved');
  const fifth = await order('27', [[tea, 1]], 'cod');
  const num = (await call(p, 'GET', `/api/admin/orders/${fifth}`)).json.number;
  check(!!(await waitForMail(ownerEmail, `#${num}`)), 'owner now gets new-order emails');
  check(!!(await waitForMail(`orders-${sub}@example.com`, `#${num}`)), 'support address still gets them');
  await p.goto(`${APP}/admin/settings`);
  const abandoned = p.getByRole('checkbox', { name: /Remind shoppers about carts they left/ });
  check(!(await abandoned.isChecked()), 'abandoned-cart reminders off by default');
  await abandoned.check();
  await p.getByRole('button', { name: 'Save changes' }).click();
  check(await shows(p.getByText('Settings saved')), 'abandoned-cart reminders turned on');
  check((await call(p, 'GET', '/api/admin/store')).json.abandonedCartEmails === true, 'setting stored');
  const shopper = await shopCtx.newPage(); watch(shopper);
  await shopper.goto(`${STORE}/account/unsubscribe?token=not-a-real-token-0000000000000000000000`);
  await shopper.getByRole('button', { name: 'Unsubscribe' }).click();
  check(await shows(shopper.getByText(/isn't valid|has expired/)), 'bad unsubscribe link explained');
  await shopper.goto(`${STORE}/account/unsubscribe`);
  check(await shopper.getByRole('button', { name: 'Unsubscribe' }).isDisabled(), 'incomplete link can\'t submit');

  log(errors.length ? `\nBrowser errors:\n  ${errors.join('\n  ')}` : '\nNo browser errors.');
  log(failures.length ? `\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}` : '\nAll checks passed.');
  await b.close();
  process.exit(failures.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
