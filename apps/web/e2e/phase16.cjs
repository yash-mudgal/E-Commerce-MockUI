// Phase 16 browser walkthrough: the merchant edits the home page (headline, announcement, featured collection), creates
// a tag-based collection and a store page, and the storefront shows them; shoppers filter by size. Restores the store
// afterwards so the run can be repeated. Needs the local stack with demo seed. Run: node e2e/phase16.cjs [screenshot-dir]
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

/** Storefront pages are cached briefly; reload until the expected element shows. */
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
  const tag = `festive${stamp}`;
  const headline = `Festive season, handpicked ${stamp}`;
  const announcementText = `Diwali orders dispatch in 2 days (${stamp})`;

  log('1. Merchant tags two products');
  const adminCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const a = await adminCtx.newPage(); watch(a);
  await a.goto(`${APP}/login`);
  await a.getByLabel('Email').fill('owner@desithreads.demo');
  await a.getByLabel('Password', { exact: true }).fill('Demo-Passw0rd!');
  await a.getByRole('button', { name: 'Sign in' }).click();
  await a.waitForURL('**/admin');
  const products = (await call(a, '/api/admin/products?status=active&pageSize=10')).json.items.slice(0, 2);
  for (const p of products) {
    const full = (await call(a, `/api/admin/products/${p.id}`)).json;
    full.tags = [...full.tags, tag];
    const r = await call(a, `/api/admin/products/${p.id}`, { method: 'PUT', body: JSON.stringify(full) });
    check(r.status === 200, `tagged "${p.title}" (${r.status})`);
  }

  log('2. Merchant: collection, page and home page');
  await a.goto(`${APP}/admin/storefront`);
  await a.getByRole('button', { name: 'New collection' }).click();
  let dlg = a.getByRole('dialog');
  await dlg.getByLabel('Title').fill(`Festive Edit ${stamp}`);
  await dlg.getByLabel('Product tag').fill(tag.toUpperCase());
  await dlg.getByLabel(/^Description/).fill('Picked for Diwali gifting.');
  await dlg.getByRole('button', { name: 'Create' }).click();
  check(await shows(a.getByText('Collection created')), 'collection created');
  check(await shows(a.getByText(`Tag “${tag.toUpperCase()}” · 2 products`)), 'collection counts the tagged products');

  await a.getByRole('button', { name: 'Returns and exchanges' }).click();
  dlg = a.getByRole('dialog');
  await dlg.getByRole('button', { name: 'Publish' }).click();
  check(await shows(dlg.getByText('Write the page before publishing it.')), 'empty page cannot be published');
  await dlg.getByLabel('Page content').fill(`## Our window\nReturn unused items within **7 days** of delivery.\n\n- Sarees and kurtas\n- Footwear\n\nQuestions? [Write to us](mailto:support@desithreads.demo) (${stamp})`);
  await dlg.getByRole('button', { name: 'Preview' }).click();
  check(await shows(dlg.getByRole('heading', { name: 'Our window' })), 'preview renders the heading');
  await dlg.getByRole('button', { name: 'Publish' }).click();
  check(await shows(a.getByText('Page published')), 'page published');

  await a.getByLabel(/^Headline/).fill(headline);
  await a.getByLabel(/^Announcement bar/).fill(announcementText);
  await a.getByLabel(/^Featured collection/).selectOption({ label: `Festive Edit ${stamp}` });
  await a.getByRole('button', { name: 'Save home page' }).click();
  check(await shows(a.getByText(/Home page saved/)), 'home page saved');
  await a.screenshot({ path: `${out}/p16-01-admin-storefront.png`, fullPage: true });

  log('3. Storefront shows it');
  const shopCtx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await shopCtx.newPage(); watch(p);
  await p.goto(`${STORE}/`);
  check(await eventually(p, p.getByRole('heading', { name: headline })), 'home headline from settings');
  check(await shows(p.getByText(announcementText)), 'custom announcement');
  check(await shows(p.getByRole('heading', { name: `Festive Edit ${stamp}` })), 'featured collection on the home page');
  check(await shows(p.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: `Festive Edit ${stamp}` })), 'collection in the header');
  await p.screenshot({ path: `${out}/p16-02-home.png`, fullPage: true });
  await p.getByRole('navigation', { name: 'Categories' }).getByRole('link', { name: `Festive Edit ${stamp}` }).click();
  await p.waitForURL(/collection=/);
  check(await shows(p.getByRole('heading', { name: `Festive Edit ${stamp}`, level: 1 })) && await shows(p.getByText('2 products', { exact: true })), 'collection page lists 2 products');

  await p.goto(`${STORE}/`);
  await p.getByRole('contentinfo').getByRole('link', { name: 'Returns and exchanges' }).click();
  await p.waitForURL('**/pages/returns-and-exchanges');
  check(await shows(p.getByRole('heading', { name: 'Our window' })), 'store page renders headings');
  check(await shows(p.getByRole('listitem').filter({ hasText: 'Sarees and kurtas' })), 'store page renders lists');
  check(await p.getByRole('link', { name: 'Write to us' }).getAttribute('href') === 'mailto:support@desithreads.demo', 'store page renders safe links');
  await p.screenshot({ path: `${out}/p16-03-page.png`, fullPage: true });

  log('4. Size filter');
  await p.goto(`${STORE}/products?category=ethnic-wear`);
  const side = p.getByRole('complementary', { name: 'Filters' });
  const sizeGroup = side.getByRole('group', { name: 'Size' });
  check(await shows(sizeGroup), 'size filter offered for the category');
  await sizeGroup.locator('label').filter({ hasText: /^M \(/ }).click();
  check(await sizeGroup.getByRole('checkbox', { name: /^M \(/ }).isChecked(), 'size M selected');
  await side.getByRole('button', { name: 'Apply filters' }).click();
  await p.waitForURL(/opt=Size%3AM/);
  const api = (await call(p, '/api/storefront/products?category=ethnic-wear&opt=Size:M&pageSize=50')).json;
  check(await shows(p.getByText(`${api.totalCount} ${api.totalCount === 1 ? 'product' : 'products'}`, { exact: true })), `size M count matches the API (${api.totalCount})`);
  check(await shows(p.getByRole('list', { name: 'Active filters' }).getByRole('link', { name: /Size: M/ })), 'size shown as a removable chip');
  await p.screenshot({ path: `${out}/p16-04-size-filter.png`, fullPage: true });

  log('5. Restore the store');
  const cols = (await call(a, '/api/admin/collections')).json.filter((c) => c.tag === tag.toUpperCase());
  for (const c of cols) await call(a, `/api/admin/collections/${c.id}`, { method: 'DELETE' });
  const pages = (await call(a, '/api/admin/pages')).json.filter((x) => x.body.includes(stamp));
  for (const x of pages) await call(a, `/api/admin/pages/${x.id}`, { method: 'DELETE' });
  const reset = await call(a, '/api/admin/storefront', { method: 'PUT', body: JSON.stringify({ heroHeading: null, heroText: null, heroMediaId: null, announcement: null, showCategories: true, showNewArrivals: true, showSale: true, featuredCollectionId: null }) });
  for (const prod of products) {
    const full = (await call(a, `/api/admin/products/${prod.id}`)).json;
    full.tags = full.tags.filter((t) => t !== tag);
    await call(a, `/api/admin/products/${prod.id}`, { method: 'PUT', body: JSON.stringify(full) });
  }
  check(reset.status === 200, 'store restored');

  check(errors.length === 0, `no browser errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await b.close();
  if (failures.length) { log(`\n${failures.length} CHECK(S) FAILED`); process.exit(1); }
  log('\nALL CHECKS PASSED');
})().catch((e) => { console.error(e); process.exit(1); });
