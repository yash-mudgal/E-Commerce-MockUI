// Phase 9 browser walkthrough: a new store's trial banner → plan limits → subscribing in TEST MODE (declined, then
// set up during the trial) → first charge, failed payment (grace), halted payment (store closed: 503 storefront,
// read-only admin) → paying again reopens it → cancellation → platform plans, plan assignment and platform suspension.
// Billing runs on the API's test gateway because ShopMint's Razorpay account isn't reachable here; Razorpay's
// webhooks are simulated by signing them with the development-only secret in appsettings.Development.json.
// Needs the local stack (API in Development) and MAIL_DIR or Mailpit. Run: node e2e/phase9.cjs [screenshot-dir]
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const APP = 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.BILLING_WEBHOOK_SECRET || 'dev_billing_webhook_secret_local_only';
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, label) => { log(ok ? '  ✓' : '  ✗', label); if (!ok) failures.push(label); };
const shows = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true, () => false);

function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}
async function waitForMail(to, needle, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.env.MAIL_DIR) {
      for (const f of fs.readdirSync(process.env.MAIL_DIR).filter((x) => x.endsWith('.eml')).sort().reverse()) {
        const text = fs.readFileSync(path.join(process.env.MAIL_DIR, f), 'utf8');
        if (!text.split('\n')[0].includes(to)) continue;
        if (text.includes(needle)) return text;
        const decoded = decodeQuotedPrintable(text);
        if (decoded.includes(needle)) return decoded;
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

/** A Razorpay-style billing webhook, signed like Razorpay signs them (HMAC-SHA256 of the raw body). */
async function webhook(event, sub, payment) {
  const payload = { subscription: { entity: sub } };
  if (payment) payload.payment = { entity: payment };
  const body = JSON.stringify({ event, payload });
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const res = await fetch(`${APP}/api/webhooks/razorpay-billing`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Razorpay-Signature': sig, 'X-Razorpay-Event-Id': 'evt_' + crypto.randomUUID() }, body,
  });
  return res.status;
}

/** Polls the storefront until it answers with the wanted status (the proxy caches store state for up to a minute). */
async function storefrontStatus(page, url, want, timeoutMs = 75000) {
  const deadline = Date.now() + timeoutMs;
  let status = 0;
  while (Date.now() < deadline) {
    status = (await page.goto(url)).status();
    if (status === want) return status;
    await page.waitForTimeout(3000);
  }
  return status;
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 120)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|422|503)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const stamp = Date.now().toString(36);
  const sub = 'p9' + stamp;
  const email = `${sub}@example.com`;
  const STORE = `http://${sub}.localhost:3000`;
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); watch(p);
  const api = (method, url, body) => p.evaluate(async ([method, url, body]) => {
    const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1' }, body: body ? JSON.stringify(body) : undefined });
    let json = null; try { json = await r.json(); } catch { /* empty */ }
    return { status: r.status, json };
  }, [method, url, body]);

  log('1. New store, live, on a free trial');
  await p.goto(`${APP}/login`);
  const signup = await api('POST', '/api/auth/signup', { name: 'Billing Owner', email, password: 'Billing-Owner-' + stamp, storeName: 'Phase Nine Goods', subdomain: sub });
  check(signup.status === 200 || signup.status === 201, 'store created');
  const mail = await waitForMail(email, '/verify-email?token=');
  const token = mail && mail.match(/verify-email\?token=([A-Za-z0-9_\-%]+)/)[1];
  check((await api('POST', '/api/auth/email/verify', { token })).status === 204, 'owner email confirmed');
  const store = (await api('GET', '/api/admin/store')).json;
  await api('PATCH', '/api/admin/store', { name: store.name, brandColor: store.brandColor, lowStockThreshold: store.lowStockThreshold, supportEmail: `help-${sub}@example.com` });
  await api('POST', '/api/admin/products', { title: 'Brass Diya', status: 'active', gstRate: 12, hsnCode: '7418', optionNames: [], variants: [{ sku: 'BD-' + stamp, optionValues: [], price: 349, mrp: 499, stockOnHand: 20 }] });
  check((await api('POST', '/api/admin/onboarding/launch')).status < 300, 'store launched');
  await p.goto(`${APP}/admin`);
  check(await shows(p.getByText(/Free trial: .*14 days left/)), 'trial banner with days left');
  const loc2 = await api('POST', '/api/admin/locations', { name: 'Second', code: 'SEC', stateCode: '27', isDefault: false });
  check(loc2.status === 422 && /Trial plan includes 1 stock location/.test(loc2.json?.detail ?? ''), 'trial limit: one stock location');

  log('2. Billing page and test-mode subscription during the trial');
  await p.getByRole('link', { name: 'Choose a plan' }).click();
  await p.waitForURL('**/admin/billing');
  check(await shows(p.getByText('payments are simulated and nothing is charged')), 'test mode clearly labelled');
  check(await shows(p.getByText(/Your free trial ends on/)), 'trial notice');
  check(await shows(p.getByText('₹1,178.82 including GST')), 'Basic price with GST');
  check(await shows(p.getByText('Products').locator('..').getByText('1 of 100')), 'usage meter (products)');
  await p.screenshot({ path: `${out}/p9-01-billing-trial.png`, fullPage: true });
  await p.getByRole('button', { name: 'Choose Pro' }).click();
  const td = p.getByRole('dialog', { name: 'Test payment' });
  check(await shows(td.getByText(/first charge on/)), 'first charge scheduled for the trial end');
  await td.getByRole('button', { name: 'Simulate a failed payment' }).click();
  check(await shows(td.getByText('The test payment was declined')), 'declined payment explained, nothing changed');
  await td.getByRole('button', { name: 'Simulate a successful payment' }).click();
  check(await shows(p.getByText("You're all set")), 'subscription set up during the trial');
  let billing = (await api('GET', '/api/admin/billing')).json;
  check(billing.status === 'Trialing' && billing.planCode === 'pro' && billing.subscription.status === 'Authenticated', `trialing on Pro (${billing.status}/${billing.planCode})`);
  check((await api('POST', '/api/admin/locations', { name: 'Second', code: 'SEC', stateCode: '27', isDefault: false })).status === 201, "Pro's limits apply at once");
  await p.reload();
  check(await p.getByText(/Free trial: .* left/).count() === 0, 'trial banner gone once a plan is chosen');

  log('3. First charge (Razorpay webhook)');
  const platformCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await platformCtx.newPage(); watch(a);
  await a.goto(`${APP}/login`);
  await a.getByLabel('Email').fill('admin@shopmint.local');
  await a.getByLabel('Password').fill('Demo-Passw0rd!');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForURL(/\/(admin|platform)/);
  // Razorpay would now charge at the trial's end and send this webhook (signed); it names the subscription.
  const subscriptionId = billing.subscription.gatewaySubscriptionId;
  check(/^sub_test_/.test(subscriptionId ?? ''), `test subscription ${subscriptionId}`);
  const now = Math.floor(Date.now() / 1000);
  const active = { id: subscriptionId, status: 'active', current_start: now, current_end: now + 30 * 86400 };
  check(await webhook('subscription.charged', active, { id: 'pay_test_' + stamp, amount: 294882 }) === 200, 'charge webhook accepted');
  billing = (await api('GET', '/api/admin/billing')).json;
  check(billing.status === 'Active' && billing.invoices.length === 1 && billing.invoices[0].amount === '2948.82', `active with a ₹2,948.82 receipt (${billing.status})`);
  check(!!(await waitForMail(email, 'is on the ShopMint Pro plan')), 'activation email');
  await p.goto(`${APP}/admin/billing`);
  check(await shows(p.getByRole('cell', { name: '₹2,948.82' })), 'receipt listed');
  const basic = p.getByRole('listitem').filter({ hasText: 'Basic' });
  check(await basic.getByRole('button', { name: 'Switch to Basic' }).isDisabled(), 'downgrade disabled while over its limits');
  check(await shows(basic.getByText(/You have 2 stock locations; Basic includes 1/)), 'reason shown');
  await p.screenshot({ path: `${out}/p9-02-billing-active.png`, fullPage: true });

  log('4. Failed payment: grace period, then closed');
  check(await webhook('subscription.pending', { ...active, status: 'pending' }) === 200, 'pending webhook accepted');
  await p.goto(`${APP}/admin`);
  check(await shows(p.getByText(/Payment for your ShopMint plan failed. The store stays open until/)), 'past-due banner');
  check(!!(await waitForMail(email, "didn't go through")), 'payment-failed email');
  check(await storefrontStatus(p, `${STORE}/`, 200, 5000) === 200, 'storefront still open during grace');
  check(await webhook('subscription.halted', { ...active, status: 'halted' }) === 200, 'halted webhook accepted');
  await p.goto(`${APP}/admin`);
  check(await shows(p.getByText(/Your ShopMint payment didn't go through: the storefront is closed and the admin is read-only/)), 'closed banner');
  const blocked = await api('POST', '/api/admin/products', { title: 'Blocked', status: 'active', gstRate: 12, optionNames: [], variants: [{ sku: 'BL-' + stamp, optionValues: [], price: 100, mrp: 100, stockOnHand: 1 }] });
  check(blocked.status === 403, 'admin is read-only');
  const shop = await ctx.newPage();
  check(await storefrontStatus(shop, `${STORE}/`, 503) === 503, 'storefront answers 503');
  check(await shows(shop.getByText('This store is temporarily unavailable')), 'temporarily unavailable page');
  await shop.screenshot({ path: `${out}/p9-03-storefront-unavailable.png` });

  log('5. Paying again reopens the store');
  await p.goto(`${APP}/admin/billing`);
  check(await shows(p.getByText("We couldn't collect payment")), 'billing explains the closure');
  await p.getByRole('button', { name: 'Choose Pro' }).click();
  await p.getByRole('dialog', { name: 'Test payment' }).getByRole('button', { name: 'Simulate a successful payment' }).click();
  await p.getByRole('dialog', { name: 'Test payment' }).waitFor({ state: 'hidden' });
  billing = (await api('GET', '/api/admin/billing')).json;
  check(billing.status === 'Active', `reopened (${billing.status})`);
  check(await storefrontStatus(shop, `${STORE}/`, 200) === 200, 'storefront back online');

  log('6. Cancel at period end');
  await p.goto(`${APP}/admin/billing`);
  await p.getByRole('button', { name: 'Cancel subscription' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Cancel subscription' }).click();
  check(await shows(p.getByText(/Your plan ends on .*then your store closes/)), 'cancellation notice with end date');
  check((await api('GET', '/api/admin/billing')).json.status === 'Active', 'still active until the period ends');

  log('7. Platform: plans, assignment and suspension');
  await a.goto(`${APP}/platform/plans`);
  check(await shows(a.getByRole('cell', { name: /Basic/ })), 'plans listed');
  await a.getByRole('button', { name: 'Edit Basic' }).click();
  const pd = a.getByRole('dialog');
  await pd.getByLabel('Razorpay plan ID').fill('price_123');
  await pd.getByRole('button', { name: 'Save plan' }).click();
  check(await shows(pd.getByText('Razorpay plan IDs look like plan_…')), 'malformed Razorpay plan refused');
  await pd.getByRole('button', { name: 'Cancel' }).click();
  await a.screenshot({ path: `${out}/p9-04-platform-plans.png`, fullPage: true });
  await a.goto(`${APP}/platform`);
  await a.getByLabel('Search stores').fill(sub);
  check(await shows(a.getByText(/test billing active/)), 'store row shows its subscription');
  // A separate store gets an enterprise contract.
  const other = await b.newContext();
  const o = await other.newPage();
  await o.goto(`${APP}/login`);
  const sub2 = 'p9b' + stamp;
  await o.evaluate(async ([s]) => fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1' }, body: JSON.stringify({ name: 'Contract Owner', email: `${s}@example.com`, password: 'Contract-Owner-' + s, storeName: 'Contract Co', subdomain: s }) }), [sub2]);
  await a.getByLabel('Search stores').fill(sub2);
  // Earlier runs leave stores with the same name; pick this run's by its unique address.
  await a.getByRole('row').filter({ hasText: `${sub2}.localhost` }).getByRole('button', { name: 'Plan for Contract Co' }).click();
  const ad = a.getByRole('dialog');
  await ad.getByLabel('Plan').selectOption('enterprise');
  await ad.getByLabel('Note').fill('Annual contract #42');
  await ad.getByRole('button', { name: 'Save' }).click();
  check(await shows(a.getByText('Plan assigned')), 'enterprise plan assigned');
  const contract = await o.evaluate(async () => (await (await fetch('/api/admin/billing', { headers: { 'X-ShopMint-Csrf': '1' } })).json()));
  check(contract.status === 'Active' && contract.planCode === 'enterprise' && contract.subscription.gateway === 'manual', 'contract store active on Enterprise');

  await a.getByLabel('Search stores').fill(sub);
  await a.getByRole('button', { name: 'Suspend Phase Nine Goods' }).click();
  await a.getByRole('dialog').getByLabel(/Reason/).fill('Policy review');
  await a.getByRole('dialog').getByRole('button', { name: 'Suspend store' }).click();
  check(await shows(a.getByText('By ShopMint')), 'platform suspension shown');
  await p.goto(`${APP}/admin`);
  check(await shows(p.getByText(/suspended by ShopMint/)), 'merchant sees the platform suspension');
  await p.goto(`${APP}/admin/billing`);
  check(await shows(p.getByText('Suspended by ShopMint')), 'billing explains paying won\'t lift it');
  await a.getByRole('button', { name: 'Reactivate' }).click();
  await a.getByRole('dialog').getByRole('button', { name: 'Reactivate' }).click();
  check(await shows(a.getByText('Phase Nine Goods reactivated')), 'reactivated');
  check((await api('GET', '/api/admin/billing')).json.status === 'Active', 'back to its billing state (active)');

  log(errors.length ? `\nBrowser errors:\n  ${errors.join('\n  ')}` : '\nNo browser errors.');
  log(failures.length ? `\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}` : '\nAll checks passed.');
  await b.close();
  process.exit(failures.length || errors.length ? 1 : 0);

})().catch((e) => { console.error('FAILED', e); process.exit(1); });
