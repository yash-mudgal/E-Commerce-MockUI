// Browser walkthrough of the critical merchant + shopper journeys against a running local stack
// (API on :5080 with demo seed, web on :3000). Run: node e2e/walkthrough.cjs [screenshot-dir]
// Replaced by a @playwright/test suite in CI during Phase 11.
const { chromium } = require('playwright');
const out = process.argv[2] || require('path').join(__dirname, '..', 'e2e-output');
require('fs').mkdirSync(out, { recursive: true });
const log = (...a) => console.log(...a);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  await p.goto('http://localhost:3000/'); await p.screenshot({ path: `${out}/01-landing.png` });
  await p.goto('http://localhost:3000/admin');
  log('redirected to', p.url());
  await p.getByLabel('Email').fill('owner@desithreads.demo');
  await p.getByLabel('Password').fill('wrong-password');
  await p.getByRole('button', { name: 'Sign in' }).click();
  const al = p.locator('main [role=alert]').first(); await al.waitFor(); log('bad login alert:', (await al.innerText()).slice(0, 60));
  await p.getByLabel('Password').fill('Demo-Passw0rd!');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL('**/admin'); await p.getByText('Needs restocking').waitFor(); await p.waitForTimeout(400);
  await p.screenshot({ path: `${out}/02-dashboard.png`, fullPage: true });

  await p.getByRole('link', { name: 'Products', exact: true }).click();
  await p.waitForURL('**/admin/products'); await p.locator('tbody tr').first().waitFor();
  await p.screenshot({ path: `${out}/03-products.png` });
  await p.getByLabel('Search products').fill('saree'); await p.waitForTimeout(2500);
  log('search rows:', await p.locator('tbody tr:visible').count(), 'url:', p.url());

  const sku = 'DT-IKAT-' + Date.now().toString().slice(-5);
  // Create product with validation error first
  await p.goto('http://localhost:3000/admin/products/new');
  await p.getByRole('button', { name: 'Create product' }).click();
  log('client validation:', await p.locator('main [role=alert]').count(), 'alerts');
  await p.getByLabel('Title').fill('Handloom Ikat Cotton Saree ' + Date.now().toString().slice(-4));
  await p.getByLabel('Description').fill('Pochampally ikat, 6.3 m with blouse piece.');
  await p.getByLabel('SKU').fill(sku);
  await p.getByLabel('Price (₹)').fill('2899');
  await p.getByLabel('MRP (₹)').fill('2499');
  await p.getByLabel('In stock').fill('7');
  await p.getByRole('button', { name: 'Create product' }).click();
  log('mrp error:', await p.getByText('MRP must be at least the price').count());
  await p.getByLabel('MRP (₹)').fill('3999');
  await p.getByLabel('Category').selectOption({ label: 'Ethnic Wear' });
  await p.screenshot({ path: `${out}/04-editor.png`, fullPage: true });
  await p.getByRole('button', { name: 'Create product' }).click();
  await p.waitForURL(/\/admin\/products\/[0-9a-f-]{36}$/); log('created at', p.url());
  await p.getByText('Product created').waitFor();
  // Duplicate SKU via a second product -> server 409 shown
  await p.goto('http://localhost:3000/admin/products/new');
  await p.getByLabel('Title').fill('Duplicate');
  await p.getByLabel('SKU').fill(sku); await p.getByLabel('Price (₹)').fill('10'); await p.getByLabel('MRP (₹)').fill('10');
  await p.getByRole('button', { name: 'Create product' }).click();
  await p.locator('main [role=alert]').first().waitFor(); log('dup sku alert:', (await p.locator('main [role=alert]').first().innerText()).replace(/\n/g,' ').slice(0, 90));

  await p.goto('http://localhost:3000/admin/settings'); await p.getByText('Brand colour').first().waitFor();
  await p.getByRole('textbox', { name: 'Custom hex' }).fill('#fbbf24'); await p.waitForTimeout(200);
  log('contrast warning:', await p.getByText('too low for white text').count());
  await p.getByRole('radio', { name: 'Royal' }).click();
  await p.getByLabel('Tagline').fill('Handpicked Indian fashion and crafts ' + Date.now().toString().slice(-3) + ' · Demo store');
  await p.screenshot({ path: `${out}/05-settings.png`, fullPage: true });
  await p.getByRole('button', { name: 'Save changes' }).click(); await p.getByText('Settings saved').waitFor(); log('settings saved');

  await p.goto('http://localhost:3000/admin/categories'); await p.getByRole('cell', { name: 'Ethnic Wear', exact: true }).waitFor();
  await p.screenshot({ path: `${out}/06-categories.png` });

  // Storefront (separate host)
  const s = await ctx.newPage();
  await s.goto('http://desithreads.localhost:3000/'); await s.getByText('New arrivals').waitFor();
  await s.screenshot({ path: `${out}/07-store-home.png`, fullPage: true });
  await s.goto('http://desithreads.localhost:3000/products?category=ethnic-wear&sort=price_desc');
  await s.screenshot({ path: `${out}/08-store-listing.png` });
  log('listing first:', await s.locator('main h3').first().innerText());
  await s.getByRole('link', { name: /Jaipuri Cotton Anarkali Kurta/ }).click();
  await s.getByRole('button', { name: 'Mustard' }).click();
  await s.screenshot({ path: `${out}/09-store-pdp.png` });
  log('pdp status:', await s.getByRole('status').innerText());

  // Mobile
  const m = await b.newContext({ ...require('playwright').devices['iPhone 13'] });
  await m.addCookies(await ctx.cookies());
  const mp = await m.newPage();
  await mp.goto('http://localhost:3000/admin'); await mp.getByText('Needs restocking').waitFor(); await mp.waitForTimeout(300);
  await mp.screenshot({ path: `${out}/10-mobile-dashboard.png` });
  await mp.getByRole('button', { name: 'Open navigation' }).click(); await mp.screenshot({ path: `${out}/11-mobile-nav.png` });
  await mp.goto('http://localhost:3000/admin/products'); await mp.locator('tbody tr').first().waitFor(); await mp.screenshot({ path: `${out}/12-mobile-products.png` });
  await mp.goto('http://desithreads.localhost:3000/'); await mp.getByText('New arrivals').waitFor(); await mp.screenshot({ path: `${out}/13-mobile-store.png` });
  // horizontal overflow check
  for (const url of ['http://localhost:3000/admin','http://localhost:3000/admin/products','http://localhost:3000/admin/products/new','http://localhost:3000/admin/settings','http://desithreads.localhost:3000/','http://desithreads.localhost:3000/products']) {
    await mp.goto(url); await mp.waitForTimeout(700);
    const o = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); log('overflow', url.replace('http://',''), o);
  }
  // Logout
  await p.getByRole('button', { name: 'Sign out' }).click(); await p.waitForURL('**/login'); log('logged out ->', p.url());
  log('ERRORS', errors.length ? errors : 'none');
  await b.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
