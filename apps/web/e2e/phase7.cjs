// Phase 7 browser walkthrough: guest cart → sign up (cart merges) → addresses → second device sees the same cart →
// sign out; store-bound sessions; instant storefront refresh after an admin change; SEO tags; real 404s; shopper
// password reset. Needs the local stack with demo seed, the API's Web:RevalidateUrl/Secret matching the web app's
// REVALIDATE_SECRET, and Mailpit (MAILPIT_URL) or MAIL_DIR for email. Run: node e2e/phase7.cjs [screenshot-dir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const APP = 'http://localhost:3000';
const STORE = 'http://desithreads.localhost:3000';
const OTHER = 'http://masalabox.localhost:3000';
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
  throw new Error(`No email to ${to} containing ${needle}`);
}

/** fetch() from inside a page, so requests go to that page's store domain with its cookies (Node can't resolve *.localhost). */
async function call(page, path, init = {}) {
  return page.evaluate(async ([path, init]) => {
    const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1', ...(init.headers || {}) } });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json };
  }, [path, init]);
}

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 120)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|404|409)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const stamp = Date.now().toString(36);
  const email = `shopper-${stamp}@example.com`;
  const password = 'Shopper-Pass-' + stamp;
  const laptop = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await laptop.newPage(); watch(p);

  // An in-stock product of the demo store.
  await p.goto(`${STORE}/`);
  const list = (await call(p, '/api/storefront/products?inStock=true&pageSize=1&sort=price_asc')).json;
  const slug = list.items[0].slug;
  const product = (await call(p, `/api/storefront/products/${slug}`)).json;
  const variant = product.variants.find((v) => v.available);

  log('1. Guest adds to cart');
  await p.goto(`${STORE}/products/${slug}`);
  await p.getByRole('heading', { name: product.title }).waitFor();
  for (let i = 0; i < product.optionNames.length; i++)
    await p.getByRole('button', { name: variant.optionValues[i], exact: true }).first().click();
  await p.getByRole('button', { name: 'Increase quantity' }).click();
  await p.getByRole('button', { name: 'Add to cart' }).click();
  check(await shows(p.getByText('Added to your cart.')), 'add to cart confirms');
  check(await shows(p.getByRole('link', { name: 'Cart, 2 items' })), 'header shows 2 items');
  await p.screenshot({ path: `${out}/p7-01-pdp-added.png` });

  log('2. Cart page');
  await p.getByRole('link', { name: 'View cart' }).click();
  await p.waitForURL('**/cart');
  await p.getByText(product.title).first().waitFor();
  const cart1 = (await call(p, '/api/storefront/cart')).json;
  check(cart1.subtotal === (Number(variant.price) * 2).toFixed(2), `subtotal uses the catalogue price (${cart1.subtotal})`);
  check(await shows(p.getByText('Online checkout for this store is opening soon.')), 'honest checkout notice, no fake checkout button');
  check(await p.getByRole('button', { name: /checkout|place order|pay/i }).count() === 0, 'no checkout or pay button');
  await p.getByRole('button', { name: 'Increase quantity' }).click();
  check(await shows(p.getByRole('link', { name: 'Cart, 3 items' })), 'quantity increase updates the cart');
  await p.screenshot({ path: `${out}/p7-02-cart.png`, fullPage: true });

  log('3. Sign up: guest cart joins the account');
  await p.getByRole('link', { name: 'Sign in' }).first().click();
  await p.waitForURL('**/account/login**');
  await p.getByRole('link', { name: 'Create an account' }).click();
  await p.waitForURL('**/account/signup**');
  await vis(p.getByLabel('Your name')).fill('Ananya Rao');
  await vis(p.getByLabel('Email', { exact: true })).fill(email);
  await vis(p.getByLabel('Password')).fill('short');
  await p.getByRole('button', { name: 'Create account' }).click();
  check(await shows(p.getByText('Use at least 10 characters')), 'weak password caught');
  await vis(p.getByLabel('Password')).fill(password);
  await p.getByRole('button', { name: 'Create account' }).click();
  await p.waitForURL('**/account');
  check(await shows(p.getByRole('heading', { name: 'Hello, Ananya' })), 'signed in to the account page');
  check(await shows(p.getByRole('link', { name: 'Cart, 3 items' })), 'guest cart kept after sign-up');

  log('4. Addresses and profile');
  await p.getByRole('button', { name: 'Add address' }).click();
  const dlg = p.getByRole('dialog');
  await dlg.getByLabel('Full name').fill('Ananya Rao');
  await dlg.getByLabel('Mobile').fill('98450 12345');
  await dlg.getByLabel('House, building, street').fill('14, 2nd Cross, Indiranagar');
  await dlg.getByLabel('City').fill('Bengaluru');
  await dlg.getByLabel('PIN code').fill('012345');
  await dlg.getByLabel('State').selectOption({ label: 'Karnataka' });
  await dlg.getByRole('button', { name: 'Save address' }).click();
  check(await shows(dlg.getByText('Enter a 6-digit PIN code')), 'invalid PIN code caught');
  await dlg.getByLabel('PIN code').fill('560038');
  await dlg.getByRole('button', { name: 'Save address' }).click();
  check(await shows(p.getByText('Address added')), 'address saved');
  check(await shows(p.getByText('Bengaluru, Karnataka 560038')), 'address listed with state name');
  check(await shows(p.getByText('Default')), 'first address is the default');
  await p.screenshot({ path: `${out}/p7-03-account.png`, fullPage: true });

  log('5. Second device sees the same cart');
  const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const m = await phoneCtx.newPage(); watch(m);
  await m.goto(`${STORE}/account/login`);
  await vis(m.getByLabel('Email')).fill(email);
  await vis(m.getByLabel('Password')).fill(password);
  await m.getByRole('button', { name: 'Sign in' }).click();
  await m.waitForURL('**/account');
  await m.goto(`${STORE}/cart`);
  check(await shows(m.getByText(product.title)), 'phone shows the cart from the laptop');
  check(await shows(m.getByRole('link', { name: 'Cart, 3 items' })), 'phone badge shows 3 items');
  await m.screenshot({ path: `${out}/p7-04-cart-phone.png`, fullPage: true });
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  check(overflow <= 0, `cart fits a 390px screen (${overflow})`);

  log('6. Sessions belong to one store');
  await m.goto(`${OTHER}/`);
  check(await shows(m.getByRole('link', { name: 'Sign in' })), 'not signed in on a different store');
  check((await call(m, '/api/storefront/account/me')).status === 204, 'other store sees no session (204) for this shopper');

  log('7. Sign out empties this device');
  await m.goto(`${STORE}/account`);
  await m.getByRole('button', { name: 'Sign out' }).click();
  await m.waitForURL(`${STORE}/`);
  check(await shows(m.getByRole('link', { name: 'Cart, 0 items' })), 'signed-out device has an empty cart');

  log('8. Merchant change shows on the storefront at once');
  const admin = await b.newContext();
  const a = await admin.newPage(); watch(a);
  await a.goto(`${APP}/login`);
  await vis(a.getByLabel('Email')).fill('owner@desithreads.demo');
  await vis(a.getByLabel('Password')).fill('Demo-Passw0rd!');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForURL('**/admin');
  const csrf = { 'X-ShopMint-Csrf': '1' };
  const store = await (await a.request.get(`${APP}/api/admin/store`)).json();
  await p.goto(`${STORE}/`); // make sure the old version is cached
  const fresh = `Handloom picks, refreshed ${stamp}`;
  const body = { name: store.name, legalName: store.legalName, gstin: store.gstin, stateCode: store.stateCode, tagline: fresh, supportEmail: store.supportEmail, brandColor: store.brandColor, lowStockThreshold: store.lowStockThreshold };
  await a.request.patch(`${APP}/api/admin/store`, { headers: csrf, data: body });
  const t0 = Date.now();
  let seenAfter = null;
  while (Date.now() - t0 < 20000) {
    await p.goto(`${STORE}/`);
    if (await p.getByText(fresh).count()) { seenAfter = ((Date.now() - t0) / 1000).toFixed(1); break; }
    await p.waitForTimeout(500);
  }
  check(seenAfter !== null && Number(seenAfter) < 10, `new tagline visible on the storefront after ${seenAfter}s (cache revalidated)`);
  await a.request.patch(`${APP}/api/admin/store`, { headers: csrf, data: { ...body, tagline: store.tagline } });

  await a.goto(`${APP}/admin/customers`);
  check(await shows(a.getByText(email)), 'merchant sees the new customer');
  await a.screenshot({ path: `${out}/p7-05-admin-customers.png`, fullPage: true });

  log('9. SEO');
  await p.goto(`${STORE}/products/${slug}`);
  const title = await p.title();
  check(title.includes(product.title) && !title.includes('ShopMint'), `product title is store-branded ("${title}")`);
  const canonical = await p.locator('link[rel="canonical"]').getAttribute('href');
  check(canonical === `${STORE}/products/${slug}`, `canonical URL (${canonical})`);
  const ld = JSON.parse(await p.locator('script[type="application/ld+json"]').first().textContent());
  check(ld['@type'] === 'Product' && ld.offers.priceCurrency === 'INR' && Number(ld.offers.lowPrice) > 0, 'Product structured data with INR offer');
  check((await p.locator('meta[property="og:title"]').count()) > 0, 'Open Graph tags present');
  await p.goto(`${STORE}/products?sort=price_desc`);
  check((await p.locator('meta[name="robots"][content*="noindex"]').count()) > 0, 'sorted listing is noindex');
  await p.goto(`${STORE}/cart`);
  check((await p.locator('meta[name="robots"][content*="noindex"]').count()) > 0, 'cart is noindex');

  log('10. Real 404s');
  const missingProduct = await p.goto(`${STORE}/products/no-such-product-${stamp}`);
  check(missingProduct.status() === 404, `unknown product returns 404 (${missingProduct.status()})`);
  check(await shows(p.getByRole('link', { name: 'Browse all products' })), 'store-branded 404 page');
  const missingStore = await p.goto(`http://nosuchstore-${stamp}.localhost:3000/`);
  check(missingStore.status() === 404, `unknown store returns 404 (${missingStore.status()})`);
  const internal = await p.goto(`${OTHER}/store/desithreads.localhost`);
  check(internal.status() === 404, 'another store cannot be shown through an internal path');

  log('11. Shopper password reset');
  await p.goto(`${STORE}/account/forgot-password`);
  await vis(p.getByLabel('Email')).fill(email);
  await p.getByRole('button', { name: 'Send reset link' }).click();
  await p.getByText('Check your email').waitFor();
  const mail = await waitForMail(email, '/account/reset-password?token=');
  const link = mail.match(/http:\/\/desithreads\.localhost:3000\/account\/reset-password\?token=[A-Za-z0-9_-]+/);
  check(!!link, 'reset link points at the store domain');
  await p.goto(link[0]);
  const newPw = 'Reset-Shopper-' + stamp;
  await vis(p.getByLabel('New password', { exact: true })).fill(newPw);
  await vis(p.getByLabel('Confirm new password')).fill(newPw);
  await p.getByRole('button', { name: 'Update password' }).click();
  check(await shows(p.getByText('Password updated')), 'password updated');
  const relog = await call(p, '/api/storefront/account/login', { method: 'POST', body: JSON.stringify({ email, password: newPw }) });
  check(relog.status === 200, 'signs in with the new password');

  log('errors:', errors.length ? errors : 'none');
  if (errors.length) failures.push(`${errors.length} browser errors`);
  await b.close();
  log(failures.length ? `\nFAILED: ${failures.length}\n - ${failures.join('\n - ')}` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
