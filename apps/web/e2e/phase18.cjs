// Phase 18 browser walkthrough: gift cards and the newsletter. The merchant issues two gift cards (the code is shown
// once); a shopper pays part of an order with one (the rest online, in TEST MODE) and a whole order with the other;
// cash on delivery is refused alongside a gift card. A visitor subscribes to the newsletter (double opt-in) and the
// merchant sees them as subscribed. Needs the local stack with demo seed and MAIL_DIR or Mailpit.
// Run: node e2e/phase18.cjs [screenshot-dir]
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

(async () => {
  const b = await chromium.launch({ args: ['--host-resolver-rules=MAP *.localhost 127.0.0.1'] });
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|422)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const stamp = Date.now().toString(36);

  log('1. Merchant issues gift cards');
  const adminCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await adminCtx.newPage(); watch(a);
  await a.goto(`${APP}/login`);
  await a.getByLabel('Email').fill('owner@desithreads.demo');
  await a.getByLabel('Password', { exact: true }).fill('Demo-Passw0rd!');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForURL('**/admin');
  const issue = async (value, name) => {
    await a.goto(`${APP}/admin/gift-cards`);
    await a.getByRole('button', { name: 'Issue gift card' }).first().click();
    const d = a.getByRole('dialog');
    await d.getByLabel('Value (₹)').fill(String(value));
    await d.getByLabel(/^Recipient name/).fill(name);
    await d.getByRole('button', { name: 'Issue gift card' }).click();
    const code = (await d.getByTestId('gift-card-code').textContent()).trim();
    await d.getByRole('button', { name: 'Done' }).click();
    return code;
  };
  const small = await issue(100, `Small ${stamp}`);
  check(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(small), `code shown once (${small.slice(-4)})`);
  const big = await issue(10000, `Big ${stamp}`);
  await a.reload();
  check(await shows(a.getByRole('cell', { name: `Small ${stamp}` })), 'card listed');
  check(!(await a.content()).includes(small), 'code not shown in the list');
  await a.screenshot({ path: `${out}/p18-01-gift-cards.png`, fullPage: true });

  log('2. Partial payment: gift card + online (test mode)');
  const shopCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await shopCtx.newPage(); watch(p);
  await p.goto(`${STORE}/`);
  const email = `gift-${stamp}@example.com`;
  await call(p, '/api/storefront/account/signup', { method: 'POST', body: JSON.stringify({ name: 'Kiran Rao', email, password: 'Gift-Pass-' + stamp }) });
  await call(p, '/api/storefront/account/addresses', { method: 'POST', body: JSON.stringify({ name: 'Kiran Rao', phone: '9812345678', line1: '8 Brigade Road', city: 'Bengaluru', stateCode: '29', pincode: '560001' }) });
  const product = (await call(p, '/api/storefront/products?inStock=true&pageSize=1&sort=price_desc')).json.items[0];
  const detail = (await call(p, `/api/storefront/products/${product.slug}`)).json;
  const variantId = detail.variants.find((v) => v.available).id;
  await call(p, '/api/storefront/cart/lines', { method: 'POST', body: JSON.stringify({ variantId, quantity: 1 }) });
  await p.goto(`${STORE}/checkout`);
  await p.getByTestId('checkout-total').waitFor();
  await p.getByRole('textbox', { name: 'Gift card' }).fill(small.toLowerCase());
  await p.getByRole('textbox', { name: 'Gift card' }).press('Enter');
  check(await shows(p.getByText(`•••• ${small.slice(-4)}`).first()), 'gift card applied');
  const due = (await p.getByTestId('checkout-due').textContent()).trim();
  check(due.startsWith('₹'), `"To pay" shown (${due})`);
  check(await shows(p.getByText("Gift cards can't be combined with cash on delivery")), 'cash on delivery explained as unavailable');
  await p.screenshot({ path: `${out}/p18-02-checkout.png`, fullPage: true });
  await p.getByRole('button', { name: /^Pay ₹/ }).click();
  await p.getByRole('dialog', { name: 'Test payment' }).getByRole('button', { name: 'Simulate a successful payment' }).click();
  await p.waitForURL(/\/account\/orders\//);
  check(await shows(p.getByText('Paid by gift card')), 'order shows the gift card payment');
  check(await shows(p.getByText('Paid online')), 'and the online part');

  log('3. Whole order paid by gift card');
  // Re-pick a product with stock (repeated runs sell out the cheapest one).
  const again = (await call(p, '/api/storefront/products?inStock=true&pageSize=24&sort=price_desc')).json.items;
  let added = null;
  for (const item of again) {
    const d = (await call(p, `/api/storefront/products/${item.slug}`)).json;
    const v = d.variants.find((x) => x.available && !x.lowStock) ?? d.variants.find((x) => x.available);
    if (v && (await call(p, '/api/storefront/cart/lines', { method: 'POST', body: JSON.stringify({ variantId: v.id, quantity: 1 }) })).status === 200) { added = item.title; break; }
  }
  check(!!added, `item in the cart (${added})`);
  await p.goto(`${STORE}/checkout`);
  await p.getByTestId('checkout-total').waitFor();
  await p.getByRole('textbox', { name: 'Gift card' }).fill(big);
  await p.getByRole('textbox', { name: 'Gift card' }).press('Enter');
  check(await shows(p.getByText(`•••• ${big.slice(-4)}`).first()), 'second card applied');
  check(((await p.getByTestId('checkout-due').textContent()) || '').trim() === '₹0', 'nothing left to pay');
  await p.getByRole('button', { name: 'Place order' }).click();
  await p.waitForURL(/\/account\/orders\//);
  check(await shows(p.getByText('Thank you! Your order is confirmed.')), 'confirmed without an online payment');
  await p.screenshot({ path: `${out}/p18-03-paid-by-card.png`, fullPage: true });

  log('4. Newsletter (double opt-in)');
  const visitor = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(visitor);
  const subscriber = `news-${stamp}@example.com`;
  await visitor.goto(`${STORE}/`);
  await visitor.getByLabel('Newsletter sign-up').fill(subscriber);
  await visitor.getByRole('button', { name: 'Subscribe' }).click();
  check(await shows(visitor.getByText('check your inbox and confirm')), 'asked to confirm by email');
  const mail = await waitForMail(subscriber, 'newsletter/confirm');
  const link = mail && (mail.match(/https?:\/\/\S*newsletter\/confirm\?token=[0-9a-f]+/) || [])[0];
  check(!!link, 'confirmation email received');
  await visitor.goto(`${STORE}${new URL(link).pathname}${new URL(link).search}`);
  await visitor.getByRole('button', { name: 'Confirm subscription' }).click();
  check(await shows(visitor.getByText("You're subscribed.")), 'subscription confirmed');
  await a.goto(`${APP}/admin/newsletter`);
  check(await shows(a.getByRole('cell', { name: subscriber })), 'merchant sees the subscriber');
  await a.screenshot({ path: `${out}/p18-04-newsletter.png`, fullPage: true });

  check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await b.close();
  if (failures.length) { log(`\n${failures.length} CHECK(S) FAILED`); process.exit(1); }
  log('\nALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
