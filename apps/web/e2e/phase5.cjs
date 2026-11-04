// Phase 5 browser walkthrough: signup → confirm email → launch checklist → launch, team invitation → accept →
// role change → activity log, and forgot/reset password. Emails are read from the local mail catcher.
// Needs the local stack (API :5080 with SMTP delivery on, web :3000) and either Mailpit (MAILPIT_URL, default
// http://localhost:8025) or a directory of .eml files (MAIL_DIR).
// Run: node e2e/phase5.cjs [screenshot-dir]
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:3000';
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, label) => { log(ok ? '  ✓' : '  ✗', label); if (!ok) failures.push(label); };
/** Waits (streamed content arrives after first paint) instead of sampling visibility once. */
const shows = (locator, timeout = 8000) => locator.first().waitFor({ timeout }).then(() => true, () => false);

/** Waits for the newest email to an address and returns its plain-text content. */
async function waitForMail(to, needle, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (process.env.MAIL_DIR) {
      const files = fs.readdirSync(process.env.MAIL_DIR).filter((f) => f.endsWith('.eml')).sort().reverse();
      for (const f of files) {
        const text = fs.readFileSync(path.join(process.env.MAIL_DIR, f), 'utf8');
        if (!text.split('\n')[0].includes(to)) continue;
        // Only decode quoted-printable when needed: decoding plain text would corrupt "token=6D..." into "tokenm...".
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
  throw new Error(`No email to ${to} containing ${needle}`);
}

function decodeQuotedPrintable(s) {
  return s.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

const linkIn = (text, prefix) => {
  const m = text.match(new RegExp(prefix.replace(/[.?/]/g, '\\$&') + '[A-Za-z0-9_\\-%]+'));
  if (!m) throw new Error('No link starting with ' + prefix);
  return m[0];
};

let current = null; // page to capture if a step throws
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    if (process.env.DEBUG) p.on('response', (r) => { if (r.url().includes('/api/') && r.status() >= 400) log('    [api]', r.status(), r.request().method(), r.url().replace(BASE, '')); });
    p.on('console', (m) => { if (m.type() === 'error' && !/the server responded with a status of (400|401|404|422)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const p = await ctx.newPage(); watch(p); current = p;
  const stamp = Date.now().toString(36);
  const sub = 'p5' + stamp;
  const ownerEmail = `owner-${stamp}@example.com`;
  const ownerPw = 'Owner-Secret-' + stamp;

  log('1. Signup');
  await p.goto(`${BASE}/signup`);
  await p.getByLabel('Your name').fill('Asha Verma');
  await p.getByLabel('Work email').fill(ownerEmail);
  await p.getByLabel('Password').fill(ownerPw);
  await p.getByLabel('Store name').fill('Phase Five Crafts');
  await p.getByLabel('Store address').fill(sub);
  await p.getByRole('button', { name: /create/i }).click();
  await p.waitForURL('**/admin');
  await p.getByText('Get ready to launch').waitFor();
  check(await shows(p.getByText('Confirm your email address')), 'unverified banner shown');
  check(await p.getByRole('link', { name: 'Launch checklist' }).isVisible(), 'Launch checklist in nav');
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${out}/p5-01-dashboard-new-store.png`, fullPage: true });

  log('2. Storefront before launch');
  const shop = await ctx.newPage(); watch(shop);
  await shop.goto(`http://${sub}.localhost:3000/`);
  check(await shows(shop.getByText('Phase Five Crafts is opening soon')), 'coming-soon page before launch');
  await shop.goto(`http://${sub}.localhost:3000/products`);
  check(await shows(shop.getByText('is opening soon')), 'catalogue hidden before launch');
  await shop.screenshot({ path: `${out}/p5-02-coming-soon.png` });

  log('3. Confirm email via the real SMTP path');
  const verifyMail = await waitForMail(ownerEmail, '/verify-email?token=');
  const verifyLink = linkIn(verifyMail, `${BASE}/verify-email?token=`);
  await p.goto(verifyLink);
  await p.getByRole('button', { name: 'Confirm email' }).click();
  await p.getByText('Email confirmed').waitFor();
  check(true, 'email confirmed through link');

  log('4. Launch checklist');
  await p.goto(`${BASE}/admin/setup`);
  await p.getByText('Publish your storefront').waitFor();
  check(await p.getByRole('button', { name: 'Launch store' }).isDisabled(), 'launch disabled while steps are missing');
  // The first unfinished step starts expanded.
  const step = p.getByRole('button', { name: /Add a support email/ });
  if ((await step.getAttribute('aria-expanded')) !== 'true') await step.click();
  await p.getByLabel('Support email').fill('not-an-email');
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  check(await shows(p.getByText('Enter a valid email address')), 'inline validation on support email');
  await p.getByLabel('Support email').fill('help@phasefive.example');
  await p.getByRole('button', { name: 'Save', exact: true }).click();
  await p.getByText('Support email saved').waitFor();
  const csrf = { 'X-ShopMint-Csrf': '1' };
  const created = await p.request.post(`${BASE}/api/admin/products`, {
    headers: csrf,
    data: { title: 'Block-print Cushion Cover', status: 'active', gstRate: 12, hsnCode: '6304', optionNames: [], variants: [{ sku: 'P5-CUSH-' + stamp, optionValues: [], price: 649, mrp: 899, stockOnHand: 12 }] },
  });
  check(created.status() === 201, 'product created via API (201)');
  await p.reload();
  await p.getByText('Publish your storefront').waitFor();
  await p.screenshot({ path: `${out}/p5-03-setup-ready.png`, fullPage: true });
  check(await p.getByRole('button', { name: 'Launch store' }).isEnabled(), 'launch enabled once required steps are done');
  await p.getByRole('button', { name: 'Launch store' }).click();
  await p.getByText('Open for business').waitFor();
  check(await p.getByRole('link', { name: 'Launch checklist' }).waitFor({ state: 'hidden', timeout: 8000 }).then(() => true, () => false), 'checklist leaves nav after launch');
  await p.screenshot({ path: `${out}/p5-04-launched.png`, fullPage: true });

  // The storefront caches the store profile for about a minute (documented). Measure the real delay.
  const launchedAt = Date.now();
  let liveAfter = null;
  while (Date.now() - launchedAt < 150000) {
    await shop.goto(`http://${sub}.localhost:3000/products`);
    if (await shop.getByText('Block-print Cushion Cover').count()) { liveAfter = Math.round((Date.now() - launchedAt) / 1000); break; }
    await shop.waitForTimeout(5000);
  }
  check(liveAfter !== null, `storefront shows the catalogue after launch (after ~${liveAfter}s)`);

  log('5. Invite a team member');
  const staffEmail = `staff-${stamp}@example.com`;
  await p.goto(`${BASE}/admin/staff`);
  await p.getByRole('heading', { name: 'Members' }).waitFor();
  await p.getByRole('button', { name: 'Invite' }).click();
  await p.getByLabel('Email').fill(staffEmail);
  await p.getByLabel('Role').selectOption('Staff');
  await p.screenshot({ path: `${out}/p5-05-invite-dialog.png` });
  await p.getByRole('button', { name: 'Send invitation' }).click();
  await p.getByText(`Invitation sent to ${staffEmail}`).waitFor();
  check(await p.locator('td', { hasText: staffEmail }).isVisible(), 'pending invitation listed');
  await p.screenshot({ path: `${out}/p5-06-staff.png`, fullPage: true });

  const inviteMail = await waitForMail(staffEmail, '/invite/');
  const inviteLink = linkIn(inviteMail, `${BASE}/invite/`);
  const staffCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const s = await staffCtx.newPage(); watch(s);
  await s.goto(inviteLink);
  await s.getByRole('heading', { name: 'Join Phase Five Crafts' }).waitFor();
  await s.screenshot({ path: `${out}/p5-07-invite-accept-mobile.png`, fullPage: true });
  await s.getByLabel('Your name').fill('Ravi Kumar');
  await s.getByLabel('Password', { exact: true }).fill('Staff-Secret-' + stamp);
  await s.getByLabel('Confirm password').fill('Staff-Secret-x');
  await s.getByRole('button', { name: 'Join store' }).click();
  check(await shows(s.getByText("Passwords don't match")), 'confirm-password mismatch caught');
  await s.getByLabel('Confirm password').fill('Staff-Secret-' + stamp);
  await s.getByRole('button', { name: 'Join store' }).click();
  await s.waitForURL('**/admin');
  await s.getByRole('button', { name: 'Open navigation' }).click();
  const nav = s.getByRole('navigation', { name: 'Main' });
  check(await nav.getByRole('link', { name: 'Products' }).isVisible(), 'staff sees Products');
  check(!(await nav.getByRole('link', { name: 'Team' }).count()), 'staff does not see Team');
  check(!(await nav.getByRole('link', { name: 'Activity log' }).count()), 'staff does not see Activity log');
  await s.goto(inviteLink);
  check(await shows(s.getByText("This invitation can't be used")), 'invitation link is single-use');

  log('6. Role change and activity log');
  await p.goto(`${BASE}/admin/staff`);
  await p.getByLabel('Role for Ravi Kumar').selectOption('Manager');
  await p.getByRole('button', { name: 'Change role' }).click();
  await p.getByText('Role updated').waitFor();
  await s.goto(`${BASE}/admin/products`);
  await s.waitForURL('**/login**');
  check(true, 'member with changed role is signed out and sent to login');

  await p.goto(`${BASE}/admin/activity`);
  await p.getByText(`Invited ${staffEmail} as Staff`).waitFor();
  check(await p.getByText('Joined the store as Staff').isVisible(), 'activity shows acceptance');
  check(await p.getByText(`Changed ${staffEmail}'s role from Staff to Manager`).isVisible(), 'activity shows role change');
  check(await p.getByText('Launched the storefront').isVisible(), 'activity shows launch');
  await p.screenshot({ path: `${out}/p5-08-activity.png`, fullPage: true });
  await p.getByLabel('Show').selectOption('product');
  await p.waitForTimeout(800);
  const rows = await p.locator('tbody tr').allInnerTexts();
  check(rows.length > 0 && rows.every((r) => /product/i.test(r)), 'area filter shows only product events');

  log('7. Forgot and reset password');
  // Next 16 keeps the previous route mounted but hidden (React Activity), so scope to visible fields.
  const vis = (l) => l.filter({ visible: true });
  await p.getByRole('button', { name: 'Sign out' }).first().click();
  await p.waitForURL('**/login');
  await p.getByRole('link', { name: 'Forgot password?' }).click();
  await p.waitForURL('**/forgot-password');
  await p.getByRole('heading', { name: 'Reset your password' }).waitFor();
  await vis(p.getByLabel('Email')).fill(ownerEmail);
  await p.getByRole('button', { name: 'Send reset link' }).click();
  await p.getByText('Check your email').waitFor();
  const resetMail = await waitForMail(ownerEmail, '/reset-password?token=');
  await p.goto(linkIn(resetMail, `${BASE}/reset-password?token=`));
  await p.getByLabel('New password', { exact: true }).fill('short');
  await p.getByRole('button', { name: 'Update password' }).click();
  check(await shows(p.getByText('Use at least 10 characters')), 'weak password rejected client-side');
  const newPw = 'Reset-Secret-' + stamp;
  await p.getByLabel('New password', { exact: true }).fill(newPw);
  await p.getByLabel('Confirm new password').fill(newPw);
  await p.getByRole('button', { name: 'Update password' }).click();
  await p.getByText('Password updated').waitFor();
  await p.screenshot({ path: `${out}/p5-09-password-updated.png` });
  await p.getByRole('link', { name: 'Sign in' }).click();
  await p.waitForURL('**/login');
  await p.getByRole('heading', { name: 'Sign in to your store' }).waitFor();
  await vis(p.getByLabel('Email')).fill(ownerEmail);
  await vis(p.getByLabel('Password')).fill(ownerPw);
  await p.getByRole('button', { name: 'Sign in' }).click();
  check(await shows(p.locator('main [role=alert]')), 'old password no longer works');
  await vis(p.getByLabel('Password')).fill(newPw);
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL('**/admin');
  check(true, 'new password signs in');

  log('8. Account page');
  await p.goto(`${BASE}/admin/account`);
  await p.getByLabel('Current password').fill('wrong-current-pw');
  await p.getByLabel('New password', { exact: true }).fill('Another-Secret-' + stamp);
  await p.getByLabel('Confirm new password').fill('Another-Secret-' + stamp);
  await p.getByRole('button', { name: 'Change password' }).click();
  await p.getByText('Your current password is incorrect.').waitFor();
  check(true, 'wrong current password rejected by API');
  await p.screenshot({ path: `${out}/p5-10-account.png`, fullPage: true });

  log('errors:', errors.length ? errors : 'none');
  if (errors.length) failures.push(`${errors.length} browser errors`);
  await b.close();
  log(failures.length ? `\nFAILED: ${failures.length}\n - ${failures.join('\n - ')}` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  if (current) {
    await current.screenshot({ path: `${out}/p5-failure.png`, fullPage: true }).catch(() => {});
    log('url at failure:', current.url());
    log('visible text:', (await current.locator('body').innerText().catch(() => '')).slice(0, 600));
  }
  process.exit(1);
});
