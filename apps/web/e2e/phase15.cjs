// Phases 14–15 browser walkthrough: the redesigned storefront (header, search, filters, sort, mini cart, mobile menu)
// and reviews, wishlist and recently viewed. A shopper orders (cash on delivery), the merchant delivers it, the
// shopper reviews the product, the merchant publishes it with a reply, and the storefront shows it with the rating.
// Needs the local stack with demo seed. Run: node e2e/phase15.cjs [screenshot-dir]
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

/** Storefront pages are cached briefly; reload until the expected text shows. */
async function eventually(page, locator, tries = 12) {
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

  log('1. Storefront: header, search, filters, sort');
  const shopCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await shopCtx.newPage(); watch(p);
  await p.goto(`${STORE}/`);
  check(await shows(p.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: 'Shop all' })), 'category navigation in the header');
  check(await shows(p.getByText(/Free shipping|Flat ₹|shipping/).first()), 'announcement states real shipping terms');
  check(await shows(p.getByRole('heading', { name: 'New arrivals' })), 'home: new arrivals');
  await p.getByRole('button', { name: 'Search', exact: true }).click();
  await p.getByRole('searchbox', { name: 'Search products' }).fill('kurta');
  await p.getByRole('searchbox', { name: 'Search products' }).press('Enter');
  await p.waitForURL(/\/products\?q=kurta/);
  check(await shows(p.getByRole('heading', { name: 'Results for “kurta”' })), 'search from the header');
  await p.goto(`${STORE}/products`);
  const side = p.getByRole('complementary', { name: 'Filters' });
  await side.getByLabel('On sale').check();
  await side.getByLabel('Maximum price').fill('1500');
  await side.getByRole('button', { name: 'Apply filters' }).click();
  await p.waitForURL(/maxPrice=1500/);
  check(await shows(p.getByRole('list', { name: 'Active filters' }).getByRole('link', { name: /On sale/ })), 'filters shown as removable chips');
  const filtered = (await call(p, '/api/storefront/products?onSale=true&maxPrice=1500&pageSize=50')).json;
  check(filtered.totalCount > 0 && await shows(p.getByText(`${filtered.totalCount} ${filtered.totalCount === 1 ? 'product' : 'products'}`, { exact: true })), `filtered count matches the API (${filtered.totalCount})`);
  await p.getByLabel('Sort by').selectOption('price_desc');
  await p.waitForURL(/sort=price_desc/);
  check(true, 'sort applies on change');
  await p.screenshot({ path: `${out}/p15-01-listing.png`, fullPage: true });

  log('2. Shopper orders (cash on delivery); merchant delivers');
  const list = (await call(p, '/api/storefront/products?inStock=true&pageSize=2&sort=price_asc')).json;
  const [first, second] = list.items;
  const email = `reviewer-${stamp}@example.com`;
  check((await call(p, '/api/storefront/account/signup', { method: 'POST', body: JSON.stringify({ name: 'Nisha Verma', email, password: 'Review-Pass-' + stamp }) })).status < 300, 'shopper signs up');
  const address = (await call(p, '/api/storefront/account/addresses', { method: 'POST', body: JSON.stringify({ name: 'Nisha Verma', phone: '9811122233', line1: '22 Lodhi Road', city: 'New Delhi', stateCode: '07', pincode: '110003' }) })).json;
  const product = (await call(p, `/api/storefront/products/${first.slug}`)).json;
  const variant = product.variants.find((v) => v.available);
  await call(p, '/api/storefront/cart/lines', { method: 'POST', body: JSON.stringify({ variantId: variant.id, quantity: 1 }) });
  const placed = await call(p, '/api/storefront/checkout/orders', { method: 'POST', body: JSON.stringify({ addressId: address.id, paymentMethod: 'cod' }), headers: { 'Idempotency-Key': 'p15-' + stamp } });
  check(placed.status === 200, `order placed (${placed.status})`);

  const adminCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await adminCtx.newPage(); watch(a);
  await a.goto(`${APP}/login`);
  await a.getByLabel('Email').fill('owner@desithreads.demo');
  await a.getByLabel('Password', { exact: true }).fill('Demo-Passw0rd!');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForURL('**/admin');
  const id = placed.json.orderId;
  for (const step of ['pack', 'ship', 'deliver']) {
    const body = step === 'ship' ? JSON.stringify({ carrier: 'Delhivery', trackingNumber: 'P15' + stamp }) : undefined;
    const r = await call(a, `/api/admin/orders/${id}/${step}`, { method: 'POST', body });
    check(r.status === 200, `merchant: ${step} (${r.status})`);
  }

  log('3. Wishlist');
  await p.goto(`${STORE}/products/${second.slug}`);
  await p.getByRole('button', { name: `Save ${second.title} to your wishlist` }).first().click();
  check(await shows(p.getByRole('button', { name: `Remove ${second.title} from your wishlist` })), 'product saved (heart pressed)');
  await p.getByRole('link', { name: 'Wishlist' }).click();
  await p.waitForURL('**/account/wishlist');
  check(await shows(p.getByRole('heading', { name: 'Your wishlist' })) && await shows(p.getByText(second.title)), 'wishlist page lists it');
  await p.screenshot({ path: `${out}/p15-02-wishlist.png`, fullPage: true });
  await p.getByRole('button', { name: `Remove ${second.title} from your wishlist` }).click();
  check(await shows(p.getByText('Nothing saved yet')), 'removed from the wishlist');

  log('4. Shopper writes a review');
  await p.goto(`${STORE}/products/${first.slug}`);
  await p.getByRole('button', { name: 'Write a review' }).click();
  await p.getByRole('button', { name: 'Submit review' }).click();
  check(await shows(p.getByText('Choose a rating from 1 to 5 stars.')), 'rating required');
  await p.getByRole('radio', { name: '4 stars' }).click();
  await p.getByLabel('Title (optional)').fill('Lovely colours');
  const body = `Arrived well packed; the fabric is soft and true to size. (${stamp})`;
  await p.getByLabel('Your review').fill(body);
  await p.getByRole('button', { name: 'Submit review' }).click();
  check(await shows(p.getByText('The store will check your review before it appears.')), 'review sent for moderation');

  log('5. Merchant publishes it with a reply');
  await a.goto(`${APP}/admin/reviews`);
  const row = a.getByRole('listitem').filter({ hasText: body });
  check(await shows(row), 'review waiting in the admin');
  await row.getByRole('button', { name: 'Reply' }).click();
  await a.getByRole('dialog').getByLabel('Your public reply').fill('Thank you, Nisha! Enjoy wearing it.');
  await a.getByRole('dialog').getByRole('button', { name: 'Save reply' }).click();
  check(await shows(a.getByText('Reply saved')), 'reply saved');
  await a.getByRole('listitem').filter({ hasText: body }).getByRole('button', { name: 'Publish' }).click();
  check(await shows(a.getByText('Review published')), 'review published');
  await a.screenshot({ path: `${out}/p15-03-admin-reviews.png`, fullPage: true });

  log('6. Storefront shows the review and rating');
  await p.goto(`${STORE}/products/${first.slug}`);
  check(await eventually(p, p.getByText(body)), 'review appears on the product page');
  check(await shows(p.getByText('Thank you, Nisha! Enjoy wearing it.')), 'store reply shown');
  check(await shows(p.getByText('Nisha V.', { exact: true })), 'author shown as first name and initial');
  const pdp = (await call(p, `/api/storefront/products/${first.slug}`)).json;
  check(pdp.ratings.count >= 1 && pdp.ratings.average !== null, `rating summary (${pdp.ratings.average} from ${pdp.ratings.count})`);
  check(await shows(p.getByRole('link', { name: new RegExp(`${pdp.ratings.count} reviews?`) })), 'rating link under the title');
  const ld = await p.locator('script[type="application/ld+json"]').first().textContent();
  check(ld.includes('"AggregateRating"') && ld.includes(`"reviewCount":${pdp.ratings.count}`), 'structured data has the aggregate rating');
  await p.screenshot({ path: `${out}/p15-04-reviews.png`, fullPage: true });

  log('7. Recently viewed');
  await p.goto(`${STORE}/products/${second.slug}`);
  const recent = p.getByRole('region', { name: 'Recently viewed' }).or(p.locator('section[aria-labelledby="recent"]'));
  check(await shows(recent.getByText(first.title)), 'recently viewed shows the previous product');

  log('8. Mini cart and mobile');
  await p.getByRole('button', { name: 'Add to cart' }).click();
  check(await shows(p.getByRole('dialog', { name: /Your cart/ })), 'mini cart opens after adding');
  await p.keyboard.press('Escape');
  const phone = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const m = await phone.newPage(); watch(m);
  await m.goto(`${STORE}/`);
  await m.getByRole('button', { name: 'Menu' }).click();
  check(await shows(m.getByRole('dialog', { name: 'Desi Threads' }).getByRole('link', { name: 'Shop all' })), 'mobile menu lists categories');
  await m.keyboard.press('Escape');
  await m.goto(`${STORE}/products`);
  await m.getByRole('button', { name: /Filters/ }).click();
  check(await shows(m.getByRole('dialog', { name: 'Filters' }).getByRole('button', { name: 'Apply filters' })), 'mobile filter panel');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no horizontal overflow at 390 px');
  await m.screenshot({ path: `${out}/p15-05-mobile-filters.png` });

  check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await b.close();
  if (failures.length) { log(`\n${failures.length} CHECK(S) FAILED`); process.exit(1); }
  log('\nALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
