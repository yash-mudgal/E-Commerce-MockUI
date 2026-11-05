// Phase 8 browser walkthrough: merchant sets delivery/COD and a coupon → shopper checks out with cash on delivery
// (coupon, GST, invoice) → shopper pays online in TEST MODE (declined, then paid via "Pay now") → idempotent order
// placement → merchant packs, ships, delivers and refunds → shopper cancels → dashboard sales from real orders →
// webhook signature rejection. Razorpay itself isn't reachable from CI: online payment here runs through the API's
// test gateway (Payments:AllowTestMode, development only). The Razorpay client, signature checks and webhooks are
// covered against a fake Razorpay in the API integration tests.
// Needs the local stack with demo seed and MAIL_DIR or Mailpit. Run: node e2e/phase8.cjs [screenshot-dir]
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
const vis = (l) => l.filter({ visible: true });

async function waitForMail(to, needle, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.env.MAIL_DIR) {
      for (const f of fs.readdirSync(process.env.MAIL_DIR).filter((x) => x.endsWith('.eml')).sort().reverse()) {
        const text = fs.readFileSync(path.join(process.env.MAIL_DIR, f), 'utf8');
        if (text.split('\n')[0].includes(to) && text.includes(needle)) return text;
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

async function call(page, p, init = {}) {
  return page.evaluate(async ([p, init]) => {
    const r = await fetch(p, { ...init, headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1', ...(init.headers || {}) } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json };
  }, [p, init]);
}

async function addToCart(page, slug, quantity) {
  const product = (await call(page, `/api/storefront/products/${slug}`)).json;
  const v = product.variants.find((x) => x.available);
  const r = await call(page, '/api/storefront/cart/lines', { method: 'POST', body: JSON.stringify({ variantId: v.id, quantity }) });
  if (r.status !== 200) throw new Error('add to cart failed ' + r.status);
  return { product, variant: v };
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 120)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|404|409|422)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const stamp = Date.now().toString(36);
  const code = ('P8' + stamp).toUpperCase().slice(0, 14);

  log('1. Merchant: delivery, cash on delivery, payments and a coupon');
  const admin = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await admin.newPage(); watch(a);
  await a.goto(`${APP}/login`);
  await vis(a.getByLabel('Email')).fill('owner@desithreads.demo');
  await vis(a.getByLabel('Password')).fill('Demo-Passw0rd!');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForURL('**/admin');
  await a.goto(`${APP}/admin/settings`);
  await a.getByLabel('Delivery fee (₹)').fill('49');
  await a.getByLabel('Free delivery from (₹)').fill('2999');
  await a.getByLabel('Cash on delivery up to (₹)').fill('5000');
  await a.getByLabel('Registered business address').fill('Unit 4, Kala Ghoda, Fort\nMumbai 400001');
  await a.getByRole('checkbox', { name: /Offer cash on delivery/ }).check();
  const save = a.getByRole('button', { name: 'Save changes' });
  if (await save.isEnabled()) {
    await save.click();
    check(await shows(a.getByText('Settings saved')), 'delivery and COD settings saved');
  }
  const st = await (await a.request.get(`${APP}/api/admin/store`)).json();
  check(st.shippingFee === '49.00' && st.freeShippingThreshold === '2999.00' && st.codEnabled && st.codMaxOrderValue === '5000.00', 'settings stored');
  check(await shows(a.getByText('Until you connect Razorpay, online checkout uses a simulator')), 'payments card says test mode is a simulator');
  const webhookUrl = await a.getByTestId('webhook-url').textContent();
  const tenantId = (await (await a.request.get(`${APP}/api/admin/store`)).json()).id;
  check(webhookUrl === `${APP}/api/webhooks/razorpay/${tenantId}`, `webhook URL is per store (${webhookUrl})`);
  await a.getByLabel('Key ID').fill('not-a-key');
  await a.getByRole('button', { name: 'Check and connect' }).click();
  check(await shows(a.getByText('Key IDs look like rzp_live_… or rzp_test_…')), 'malformed Razorpay key rejected');
  await a.screenshot({ path: `${out}/p8-01-settings.png`, fullPage: true });

  await a.goto(`${APP}/admin/coupons`);
  await a.getByRole('button', { name: 'New coupon' }).click();
  const cd = a.getByRole('dialog');
  await cd.getByLabel('Code').fill(code.toLowerCase());
  await cd.getByLabel('Percent off').fill('95');
  await cd.getByRole('button', { name: 'Save coupon' }).click();
  check(await shows(cd.getByText('Percent discounts go up to 90%')), 'coupon over 90% caught');
  await cd.getByLabel('Percent off').fill('10');
  await cd.getByLabel('Maximum discount (₹)').fill('150');
  await cd.getByRole('button', { name: 'Save coupon' }).click();
  check(await shows(a.getByText('Coupon created')), 'coupon created');
  check(await shows(a.getByRole('cell', { name: new RegExp(code) })), 'coupon listed in upper case');
  await a.screenshot({ path: `${out}/p8-02-coupons.png`, fullPage: true });

  log('2. Shopper: cart → checkout (needs sign-in) → address');
  const shop = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await shop.newPage(); watch(p);
  await p.goto(`${STORE}/`);
  const list = (await call(p, '/api/storefront/products?inStock=true&pageSize=1&sort=price_asc')).json;
  const slug = list.items[0].slug;
  const email = `buyer-${stamp}@example.com`;
  const { variant } = await addToCart(p, slug, 2);
  await p.goto(`${STORE}/cart`);
  await p.getByRole('link', { name: 'Sign in to check out' }).click();
  await p.waitForURL(/\/account\/login\?next=(%2F|\/)checkout/);
  await p.getByRole('link', { name: 'Create an account' }).click();
  await vis(p.getByLabel('Your name')).fill('Kavya Iyer');
  await vis(p.getByLabel('Email', { exact: true })).fill(email);
  await vis(p.getByLabel('Password')).fill('Buyer-Pass-' + stamp);
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.waitForURL('**/checkout');
  check(true, 'sign-up returns to checkout');
  await p.getByRole('button', { name: 'Add an address' }).click();
  const ad = p.getByRole('dialog');
  await ad.getByLabel('Full name').fill('Kavya Iyer');
  await ad.getByLabel('Mobile').fill('98200 54321');
  await ad.getByLabel('House, building, street').fill('7 Marine Drive');
  await ad.getByLabel('City').fill('Mumbai');
  await ad.getByLabel('PIN code').fill('400020');
  await ad.getByLabel('State').selectOption({ label: 'Maharashtra' });
  await ad.getByRole('button', { name: 'Save address' }).click();
  check(await shows(p.getByTestId('checkout-total')), 'quote appears once an address is chosen');
  const quote1 = (await call(p, '/api/storefront/checkout/quote', { method: 'POST', body: JSON.stringify({ addressId: (await call(p, '/api/storefront/account/addresses')).json[0].id }) })).json;
  const goods = Number(variant.price) * 2;
  check(Number(quote1.subtotal) === goods, `server prices the cart (${quote1.subtotal})`);
  check(quote1.shipping === (goods >= 2999 ? '0.00' : '49.00'), `delivery fee from store settings (${quote1.shipping})`);
  check(quote1.intraState && Number(quote1.cgst) > 0 && quote1.igst === '0.00', 'Maharashtra seller → Maharashtra buyer: CGST + SGST');
  check(await shows(p.getByText(/Test mode — no real payment/)), 'online option is labelled test mode');

  log('3. Coupon');
  await p.getByLabel('Coupon code').fill('NOPE-' + stamp);
  await p.getByRole('button', { name: 'Apply coupon' }).click();
  check(await shows(p.locator('#coupon-error')), 'unknown coupon explained');
  await p.getByLabel('Coupon code').fill(code.toLowerCase());
  await p.getByRole('button', { name: 'Apply coupon' }).click();
  check(await shows(p.getByText(`Coupon ${code} applied`)), 'coupon applied');
  const discount = Math.min(150, Math.round(goods * 0.1 * 100) / 100);
  check(await shows(p.getByText(`Coupon ${code}`, { exact: true })), 'discount line shown');
  await p.screenshot({ path: `${out}/p8-03-checkout.png`, fullPage: true });

  log('4. Cash on delivery');
  await p.getByRole('radio', { name: /Cash on delivery/ }).check();
  await p.getByRole('button', { name: 'Place order' }).click();
  await p.waitForURL(/\/account\/orders\/[0-9a-f-]+\?placed=1/);
  check(await shows(p.getByText('Thank you! Your order is confirmed.')), 'order confirmed page');
  const codId = p.url().match(/orders\/([0-9a-f-]+)/)[1];
  const cod = (await call(p, `/api/storefront/account/orders/${codId}`)).json;
  check(cod.status === 'Confirmed' && cod.paymentStatus === 'CodDue', `COD order confirmed, cash due (${cod.status}/${cod.paymentStatus})`);
  check(Number(cod.discount) === discount, `coupon discount applied by the server (${cod.discount})`);
  check(cod.payments.length === 0 && cod.refunds.every((r) => r.reason === ''), 'shopper view hides gateway details');
  check((await call(p, '/api/storefront/cart')).json.lines.length === 0, 'cart emptied after ordering');
  check(await shows(p.getByRole('link', { name: 'Cart, 0 items' })), 'header cart count cleared');
  check(!!(await waitForMail(email, `#${cod.number}`)), 'order confirmation emailed to shopper');
  await p.screenshot({ path: `${out}/p8-04-order-cod.png`, fullPage: true });
  await p.getByRole('link', { name: 'Invoice' }).click();
  check(await shows(p.getByRole('heading', { name: 'Tax invoice' })), 'invoice page');
  check(await shows(p.getByText(cod.invoiceNumber)), `invoice number ${cod.invoiceNumber}`);
  check(/^\d{2}-\d{2}\/\d{6}$/.test(cod.invoiceNumber || ''), 'invoice number uses the financial-year series');
  check(await shows(p.getByText('27AAGCD4821M1Z3')), 'seller GSTIN on invoice');
  check(await shows(p.getByText('CGST + SGST (intra-state)')), 'intra-state tax type on invoice');
  check(await shows(p.getByText(/Rupees .* Only/)), 'amount in words');
  await p.screenshot({ path: `${out}/p8-05-invoice.png`, fullPage: true });

  log('5. Online payment (test mode): declined, then paid with "Pay now"');
  await addToCart(p, slug, 1);
  await p.goto(`${STORE}/checkout`);
  await p.getByTestId('checkout-total').waitFor();
  await p.getByRole('radio', { name: /Pay online/ }).check();
  await p.getByRole('button', { name: /^Pay ₹/ }).click();
  const td = p.getByRole('dialog', { name: 'Test payment' });
  check(await shows(td.getByTestId('test-mode-banner')), 'test payment dialog is clearly labelled');
  await p.screenshot({ path: `${out}/p8-06-test-payment.png` });
  await td.getByRole('button', { name: 'Simulate a failed payment' }).click();
  await p.waitForURL(/payment=failed/);
  check(await shows(p.getByText("Your payment didn't go through.")), 'declined payment explained');
  check(await shows(p.getByText('Waiting for payment')), 'order awaits payment with stock held');
  const onlineId = p.url().match(/orders\/([0-9a-f-]+)/)[1];
  await p.getByRole('button', { name: 'Pay now' }).click();
  await p.getByRole('dialog', { name: 'Test payment' }).getByRole('button', { name: 'Simulate a successful payment' }).click();
  check(await shows(p.getByRole('heading', { name: /Order #\d+/ }).getByText('Confirmed')), 'paid order confirmed');
  const online = (await call(p, `/api/storefront/account/orders/${onlineId}`)).json;
  check(online.paymentStatus === 'Paid' && !!online.invoiceNumber, `paid and invoiced (${online.paymentStatus}, ${online.invoiceNumber})`);

  log('6. Retried "Place order" with the same Idempotency-Key returns the same order');
  await addToCart(p, slug, 1);
  const addressId = (await call(p, '/api/storefront/account/addresses')).json[0].id;
  const body = JSON.stringify({ addressId, couponCode: null, paymentMethod: 'cod' });
  const key = 'e2e-' + stamp + '-dup';
  const [r1, r2] = await Promise.all([1, 2].map(() => call(p, '/api/storefront/checkout/orders', { method: 'POST', body, headers: { 'Idempotency-Key': key } })));
  check(r1.status === 200 && r2.status === 200 && r1.json.orderId === r2.json.orderId, 'concurrent retries → one order');
  const noKey = await call(p, '/api/storefront/checkout/orders', { method: 'POST', body });
  check(noKey.status === 400, 'order without an Idempotency-Key refused');
  const tampered = await call(p, '/api/storefront/checkout/orders', { method: 'POST', headers: { 'Idempotency-Key': key + 'x' },
    body: JSON.stringify({ addressId, paymentMethod: 'cod', total: 1, unitPrice: 1, discount: 99999 }) });
  check(tampered.status === 422 || tampered.status === 409, `browser-sent prices are ignored (empty cart → ${tampered.status})`);

  log('7. Shopper cancels an order');
  await p.goto(`${STORE}/account/orders/${r1.json.orderId}`);
  await p.getByRole('button', { name: 'Cancel order' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
  check(await shows(p.getByText('Order cancelled')), 'cancelled by shopper');
  await p.goto(`${STORE}/account/orders`);
  check(await shows(p.getByText(`Order #${online.number}`)), 'orders list');
  await p.screenshot({ path: `${out}/p8-07-orders.png`, fullPage: true });

  log('8. Merchant fulfils and refunds');
  await a.goto(`${APP}/admin/orders`);
  check(await shows(a.getByRole('link', { name: `#${online.number}` })), 'order in admin list');
  await a.getByRole('tab', { name: 'To fulfil' }).click();
  check(await shows(a.getByRole('link', { name: `#${cod.number}` })), '"To fulfil" filter');
  await a.getByPlaceholder('Order #, name, email or mobile').fill(email);
  check(await shows(a.getByRole('link', { name: `#${online.number}` })), 'search by email');
  await a.getByRole('link', { name: `#${online.number}` }).click();
  await a.getByRole('button', { name: 'Mark packed' }).click();
  check(await shows(a.getByText('Marked as packed')), 'packed');
  await a.getByRole('button', { name: 'Ship' }).click();
  const sd = a.getByRole('dialog');
  await sd.getByLabel('Courier').fill('Delhivery');
  await sd.getByLabel('Tracking number').fill('DLV' + stamp.toUpperCase());
  await sd.getByLabel('Tracking link').fill('http://insecure.example');
  await sd.getByRole('button', { name: 'Mark shipped' }).click();
  check(await shows(sd.getByText('Use a full https:// link')), 'insecure tracking link refused');
  await sd.getByLabel('Tracking link').fill('https://www.delhivery.com/track/package/DLV' + stamp.toUpperCase());
  await sd.getByRole('button', { name: 'Mark shipped' }).click();
  check(await shows(a.getByText('Marked as shipped')), 'shipped');
  check(!!(await waitForMail(email, 'DLV' + stamp.toUpperCase())), 'shipping email with tracking number');
  await a.getByRole('button', { name: 'Mark delivered' }).click();
  check(await shows(a.getByText('Marked as delivered')), 'delivered');
  await a.getByRole('button', { name: 'Refund' }).click();
  const rd = a.getByRole('dialog');
  await rd.getByLabel('Amount (₹)').fill(String(Number(online.total) + 1));
  await rd.getByLabel('Reason (internal)').fill('Damaged in transit');
  await rd.getByRole('button', { name: 'Send refund' }).click();
  check(await shows(rd.getByText(/You can refund up to/)), 'over-refund caught');
  await rd.getByLabel('Amount (₹)').fill('100');
  await rd.getByRole('button', { name: 'Send refund' }).click();
  check(await shows(a.getByText('Refund recorded')), 'partial refund sent');
  const after = await (await a.request.get(`${APP}/api/admin/orders/${onlineId}`)).json();
  check(after.paymentStatus === 'PartiallyRefunded' && after.refundedTotal === '100.00', `refund recorded (${after.paymentStatus}, ${after.refundedTotal})`);
  check(after.refunds[0]?.reason === 'Damaged in transit', 'merchant sees the refund reason');
  await a.screenshot({ path: `${out}/p8-08-admin-order.png`, fullPage: true });
  await a.goto(`${APP}/admin/orders/${codId}`);
  check(await shows(a.getByText(/Cash on delivery: collect/)), 'COD order tells staff to collect cash');
  await a.goto(`${APP}/admin/orders/${onlineId}/invoice`);
  check(await shows(a.getByText('₹100 has been refunded against this invoice.')), 'invoice notes the refund');

  log('9. Dashboard sales come from real orders');
  await a.goto(`${APP}/admin`);
  check(await shows(a.getByText('Last 30 days · confirmed orders, net of refunds')), 'sales card');
  const dash = await (await a.request.get(`${APP}/api/admin/dashboard/summary`)).json();
  check(dash.sales && dash.sales.orders >= 2 && Number(dash.sales.revenue) > 0, `sales summary (${dash.sales?.orders} orders, ₹${dash.sales?.revenue})`);
  await a.getByText('Show as table').click();
  check(await shows(a.getByRole('columnheader', { name: 'Revenue' })), 'chart has a table view');
  await a.screenshot({ path: `${out}/p8-09-dashboard.png`, fullPage: true });

  log('10. Webhooks and isolation');
  const hook = await fetch(`${APP}/api/webhooks/razorpay/${tenantId}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': 'bad' }, body: '{"event":"payment.captured"}' });
  check(hook.status === 404 || hook.status === 401, `unsigned webhook rejected (${hook.status}; 404 while no Razorpay keys are connected)`);
  const other = await b.newContext();
  const o = await other.newPage();
  await o.goto(`${STORE}/`);
  check((await call(o, `/api/storefront/account/orders/${onlineId}`)).status === 401, 'orders need a signed-in shopper');
  await call(o, '/api/storefront/account/signup', { method: 'POST', body: JSON.stringify({ name: 'Other Shopper', email: `other-${stamp}@example.com`, password: 'Other-Pass-' + stamp }) });
  check((await call(o, `/api/storefront/account/orders/${onlineId}`)).status === 404, "another shopper can't see this order");
  check((await call(o, `/api/storefront/checkout/orders/${onlineId}/test-payment`, { method: 'POST', body: JSON.stringify({ outcome: 'success' }) })).status === 404, "another shopper can't pay/confirm it");

  log(errors.length ? `\nBrowser errors:\n  ${errors.join('\n  ')}` : '\nNo browser errors.');
  log(failures.length ? `\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}` : '\nAll checks passed.');
  await b.close();
  process.exit(failures.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
