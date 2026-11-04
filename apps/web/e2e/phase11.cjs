// Phase 11 browser walkthrough: two-step verification through the UI (QR set-up, recovery codes, sign-in with a code
// and with a recovery code, turning it off), the platform console behind MFA, security headers, and the
// Content-Security-Policy not breaking real pages (any CSP violation is a console error, which fails the run).
// Run: node e2e/phase11.cjs [screenshot-dir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { totp, signInPlatformAdmin } = require('./totp.cjs');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const APP = 'http://localhost:3000';
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, label) => { log(ok ? '  ✓' : '  ✗', label); if (!ok) failures.push(label); };
const shows = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true, () => false);
const nextWindow = (page) => page.waitForTimeout(31000 - (Date.now() % 30000));

(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror @ ' + p.url() + ': ' + e.message.slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|401|403|404|409|422)/.test(m.text())) errors.push('console @ ' + p.url() + ': ' + m.text().slice(0, 200)); });
  };
  const stamp = Date.now().toString(36);
  const email = `mfa-${stamp}@example.com`;
  const password = 'Mfa-Owner-' + stamp;
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); watch(p);

  log('1. Turn on two-step verification');
  await p.goto(`${APP}/signup`);
  await p.evaluate(async ([email, password, sub]) => fetch('/api/auth/signup', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1' },
    body: JSON.stringify({ name: 'Mfa Owner', email, password, storeName: 'Mfa Store', subdomain: sub }) }), [email, password, 'mfa' + stamp]);
  await p.goto(`${APP}/admin/account`);
  const card = p.locator('#security');
  check(await shows(card.getByText('Off. Anyone with your password can sign in.')), 'shown as off');
  await card.getByRole('button', { name: 'Turn on' }).click();
  const dlg = p.getByRole('dialog', { name: 'Turn on two-step verification' });
  check(await shows(dlg.getByRole('img', { name: 'QR code for your authenticator app' })), 'QR code shown');
  const secret = (await dlg.getByTestId('mfa-secret').textContent()).replace(/\s/g, '');
  check(/^[A-Z2-7]{32}$/.test(secret), 'manual key shown');
  await dlg.getByLabel(/Enter the 6-digit code/).fill('000000');
  await dlg.getByRole('button', { name: 'Turn on' }).click();
  check(await shows(dlg.getByText("That code didn't match")), 'wrong code refused');
  await dlg.getByLabel(/Enter the 6-digit code/).fill(totp(secret));
  await dlg.getByRole('button', { name: 'Turn on' }).click();
  const codesDlg = p.getByRole('dialog', { name: 'Save your recovery codes' });
  check(await shows(codesDlg), 'recovery codes shown once');
  const codes = (await codesDlg.getByTestId('recovery-codes').locator('li').allTextContents()).map((c) => c.trim());
  check(codes.length === 10 && codes.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)), '10 recovery codes');
  await p.screenshot({ path: `${out}/p11-01-recovery-codes.png` });
  await codesDlg.getByRole('button', { name: "I've saved them" }).click();
  check(await shows(card.getByText(/Since .* 10 recovery codes left/)), 'shown as on');

  log('2. Sign in with a code, then with a recovery code');
  const ctx2 = await b.newContext();
  const s = await ctx2.newPage(); watch(s);
  async function passwordStep() {
    await s.goto(`${APP}/login`);
    await s.getByLabel('Email').fill(email);
    await s.getByLabel('Password').fill(password);
    await s.getByRole('button', { name: 'Sign in' }).click();
    return shows(s.getByRole('heading', { name: 'Two-step verification' }));
  }
  check(await passwordStep(), 'password leads to the code step');
  await s.getByLabel('Code').fill('123456');
  await s.getByRole('button', { name: 'Verify' }).click();
  check(await shows(s.getByText("That code didn't work.")), 'wrong code refused');
  await nextWindow(s); // the set-up code used this window; codes can't be replayed
  await s.getByLabel('Code').fill(totp(secret));
  await s.getByRole('button', { name: 'Verify' }).click();
  await s.waitForURL('**/admin');
  check(true, 'signed in with the authenticator code');
  await s.getByRole('button', { name: 'Sign out' }).click();
  await s.waitForURL('**/login');
  check(await passwordStep(), 'code step again');
  await s.getByRole('button', { name: 'Use a recovery code' }).click();
  await s.getByLabel('Recovery code').fill(codes[0]);
  await s.getByRole('button', { name: 'Verify' }).click();
  await s.waitForURL('**/admin');
  check(true, 'signed in with a recovery code');
  await s.goto(`${APP}/admin/account`);
  check(await shows(s.locator('#security').getByText(/9 recovery codes left/)), 'recovery code used up');
  await s.getByRole('button', { name: 'Sign out' }).click();
  await s.waitForURL('**/login');
  check(await passwordStep(), 'code step again');
  await s.getByRole('button', { name: 'Use a recovery code' }).click();
  await s.getByLabel('Recovery code').fill(codes[0]);
  await s.getByRole('button', { name: 'Verify' }).click();
  check(await shows(s.getByText("That code didn't work.")), 'a used recovery code is refused');

  log('3. Turn it off (password and code)');
  await p.goto(`${APP}/admin/account`);
  // Turning MFA on signed out other sessions; the browser that enabled it kept its (now verified) session.
  check(await shows(p.locator('#security').getByText(/recovery codes left/)), 'the enabling browser stayed signed in');
  await p.locator('#security').getByRole('button', { name: 'Turn off' }).click();
  const off = p.getByRole('dialog', { name: 'Turn off two-step verification?' });
  await off.getByLabel('Password').fill(password);
  await off.getByLabel(/Code from your app/).fill(codes[1]);
  await off.getByRole('button', { name: 'Turn off' }).click();
  check(await shows(p.getByText('Two-step verification turned off')), 'turned off with password and recovery code');

  log('4. Platform console behind two-step verification');
  const plat = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); watch(plat);
  await signInPlatformAdmin(plat, APP);
  await plat.goto(`${APP}/platform`);
  check(await shows(plat.getByText('Every merchant on the platform')), 'platform console after the code step');
  const res = await plat.evaluate(async () => (await fetch('/api/platform/plans', { headers: { 'X-ShopMint-Csrf': '1' } })).status);
  check(res === 200, 'platform API allowed for the verified session');

  log('5. Security headers');
  const web = await fetch(`${APP}/login`);
  const csp = web.headers.get('content-security-policy') || '';
  check(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'") && csp.includes("base-uri 'self'"), 'web CSP set');
  check(!!web.headers.get('strict-transport-security'), 'HSTS on the web app');
  check(!web.headers.get('x-powered-by'), 'no X-Powered-By');
  const api = await fetch(`${APP}/api/auth/me`);
  check((api.headers.get('content-security-policy') || '').includes("default-src 'none'"), "API responses can't be rendered as pages");
  check(api.headers.get('x-content-type-options') === 'nosniff', 'nosniff on API');

  log('6. The CSP keeps real pages working');
  const shop = await (await b.newContext()).newPage(); watch(shop);
  await shop.goto('http://kaarigar.localhost:3000/products/cast-iron-dosa-tawa-12in');
  await shop.waitForLoadState('networkidle');
  check(await shop.getByRole('button', { name: 'Add to cart' }).isVisible(), 'storefront product page renders and hydrates');
  await shop.goto('http://desithreads.localhost:3000/');
  await shop.waitForLoadState('networkidle');
  check(await shows(shop.getByText('New arrivals')), 'storefront home');
  await p.goto(`${APP}/admin/products/new`);
  check(await shows(p.getByText('Variants')), 'product editor');
  await p.goto(`${APP}/admin/reports`);
  check(await shows(p.getByText('Net sales').or(p.getByText('No sales in this period'))), 'reports page');

  log(errors.length ? `\nBrowser errors (incl. any CSP violations):\n  ${errors.join('\n  ')}` : '\nNo browser errors (no CSP violations).');
  log(failures.length ? `\n${failures.length} check(s) failed:\n  ${failures.join('\n  ')}` : '\nAll checks passed.');
  await b.close();
  process.exit(failures.length || errors.length ? 1 : 0);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
