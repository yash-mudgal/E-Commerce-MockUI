// Phase 13 browser walkthrough: a merchant sends feedback from the admin; the platform team sees it, triages it and
// filters by status; the metrics page shows the same numbers as the API, with charts, a table view and the funnel;
// platform navigation; no horizontal overflow at 390 px; no browser errors.
// Run: node e2e/phase13.cjs [screenshot-dir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { signInPlatformAdmin } = require('./totp.cjs');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const APP = 'http://localhost:3000';
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, label) => { log(ok ? '  ✓' : '  ✗', label); if (!ok) failures.push(label); };
const shows = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
// Same rule as formatINR in lib/utils.ts: whole rupees without paise, otherwise two decimals.
const inr = (v) => { const n = Number(v); return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 }).format(n); };

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|422)/.test(m.text())) errors.push('console @ ' + p.url() + ': ' + m.text().slice(0, 200)); });
  };
  const stamp = Date.now().toString(36);
  const marker = `fb${stamp}`;

  log('1. A merchant sends feedback from the admin');
  const m = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(m);
  await m.goto(`${APP}/signup`);
  const email = `fb-${stamp}@example.com`;
  await m.evaluate(async ([email, sub]) => fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1' },
    body: JSON.stringify({ name: 'Feedback Owner', email, password: 'Feedback-Owner-1', storeName: 'Feedback Store ' + sub, subdomain: sub }) }), [email, marker]);
  await m.goto(`${APP}/admin/products`);
  await m.getByRole('button', { name: 'Send feedback' }).click();
  const dlg = m.getByRole('dialog', { name: 'Send feedback' });
  check(await shows(dlg), 'feedback dialog opens');
  await dlg.getByRole('button', { name: 'Send' }).click();
  check(await shows(dlg.getByText('Choose what this is about')) && await shows(dlg.getByText('Tell us a little more')), 'empty feedback refused with reasons');
  await dlg.getByLabel('An idea or request').check();
  await dlg.getByLabel('Message').fill(`Please let us edit prices in bulk from a spreadsheet ${marker}`);
  await dlg.getByLabel('The ShopMint team may email me about this').check();
  await dlg.getByRole('button', { name: 'Send' }).click();
  check(await shows(m.getByText('Thanks. The ShopMint team reads every message.')), 'feedback sent');
  check(!(await dlg.isVisible()), 'dialog closes after sending');
  const readBack = await m.evaluate(async () => (await fetch('/api/platform/feedback', { headers: { 'X-ShopMint-Csrf': '1' } })).status);
  check(readBack === 403, 'merchants cannot read the feedback inbox');

  log('2. The platform team triages it');
  const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(p);
  await signInPlatformAdmin(p, APP);
  await p.goto(`${APP}/platform`);
  await p.getByRole('navigation', { name: 'Platform sections' }).getByRole('link', { name: 'Feedback' }).click();
  await p.waitForURL(/\/platform\/feedback$/);
  check(await p.getByRole('link', { name: 'Feedback' }).getAttribute('aria-current') === 'page', 'section navigation marks the current page');
  await p.getByLabel('Search feedback').fill(marker);
  const item = p.locator('li', { hasText: marker });
  check(await shows(item), 'new feedback listed');
  check(await shows(item.getByText(`Feedback Store ${marker}`)), 'with the store name');
  check(await shows(item.getByRole('link', { name: email })), 'and the email, because they agreed to be contacted');
  check(await shows(item.getByText('/admin/products')), 'and the page it was sent from');
  await item.getByRole('button', { name: /Update feedback/ }).click();
  const up = p.getByRole('dialog', { name: 'Update feedback' });
  await up.getByLabel('Status').selectOption('Planned');
  await up.getByLabel(/Team note/).fill('Q1: bulk price editor');
  await up.getByRole('button', { name: 'Save' }).click();
  check(await shows(p.getByText('Feedback updated')), 'status and note saved');
  // The list refetches after saving; wait for the item to leave it.
  check(await p.locator('li', { hasText: marker }).waitFor({ state: 'detached', timeout: 10000 }).then(() => true, () => false), 'gone from the New list');
  await p.getByRole('button', { name: /^Planned/ }).click();
  check(await shows(p.locator('li', { hasText: marker }).getByText('Team note: Q1: bulk price editor')), 'listed under Planned with the note');
  await p.screenshot({ path: path.join(out, 'p13-feedback.png'), fullPage: true });

  log('3. Metrics match the API');
  await p.getByRole('navigation', { name: 'Platform sections' }).getByRole('link', { name: 'Metrics' }).click();
  await p.waitForURL(/\/platform\/metrics$/);
  check(await shows(p.getByRole('heading', { name: 'Metrics' })), 'metrics page');
  const api = await p.evaluate(async () => {
    const t = new Date(Date.now() + 330 * 60000);
    const today = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()));
    const ymd = (d) => d.toISOString().slice(0, 10);
    const from = ymd(new Date(today.getTime() - 89 * 86400000));
    return (await fetch(`/api/platform/metrics?from=${from}&to=${ymd(today)}`, { headers: { 'X-ShopMint-Csrf': '1' } })).json();
  });
  const stat = (label) => p.locator('dl > div', { has: p.getByText(label, { exact: true }) }).locator('dd').first();
  check(await shows(stat('Monthly recurring revenue')) && (await stat('Monthly recurring revenue').innerText()) === inr(api.revenue.mrr), `MRR shown as ${inr(api.revenue.mrr)}`);
  check((await stat('Stores').innerText()) === api.stores.total.toLocaleString('en-IN'), `store count shown as ${api.stores.total}`);
  check((await stat('Net sales across stores').innerText()) === inr(api.commerce.netSales), 'net sales match the API');
  check(api.funnel.signedUp >= 1, 'the new store is in this period\'s sign-ups');
  check(await shows(p.locator('ol li', { hasText: 'Signed up' }).getByText(api.funnel.signedUp.toLocaleString('en-IN'), { exact: true })), 'funnel shows the sign-up count');
  check(await shows(p.getByRole('list', { name: 'Net sales by week' })) && await shows(p.getByRole('list', { name: 'New stores by week' })), 'weekly charts');
  const bars = await p.getByRole('list', { name: 'New stores by week' }).getByRole('button').count();
  check(bars === api.weeks.length, `one bar per week (${api.weeks.length})`);
  await p.getByRole('button', { name: 'Show weekly numbers as a table' }).click();
  const rows = p.locator('#weeks-table tbody tr');
  check((await rows.count()) === api.weeks.length, 'table view has the same weeks');
  const last = api.weeks[api.weeks.length - 1];
  check(await shows(rows.last().getByText(String(last.signups), { exact: true })), 'table matches the API for the current week');
  await p.getByLabel('Period', { exact: true }).selectOption('28d');
  check(await shows(p.getByText(/In this period/)), 'period can be changed');
  await p.screenshot({ path: path.join(out, 'p13-metrics.png'), fullPage: true });

  log('4. Small screens');
  const phone = await (await b.newContext({ viewport: { width: 390, height: 844 }, storageState: await p.context().storageState() })).newPage(); watch(phone);
  for (const u of ['/platform/metrics', '/platform/feedback']) {
    await phone.goto(`${APP}${u}`);
    await phone.waitForLoadState('networkidle');
    const over = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(over <= 0, `no horizontal overflow at 390 px on ${u}`);
  }

  log(errors.length ? `\nBrowser errors:\n  ${errors.join('\n  ')}` : '\nNo browser errors.');
  log(failures.length ? `\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}` : '\nAll checks passed.');
  await b.close();
  process.exit(failures.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
