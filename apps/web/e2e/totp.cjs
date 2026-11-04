// Authenticator codes for e2e scripts (RFC 6238, as the API implements). The development platform admin's secret is
// a documented dev-only value (Seed:PlatformAdminTotpSecret in appsettings.Development.json); override with
// E2E_ADMIN_TOTP_SECRET.
const crypto = require('crypto');

const ADMIN_SECRET = process.env.E2E_ADMIN_TOTP_SECRET || 'SHOPMINTDEVONLYTOTPKEY234567ABCD';

function base32(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, value = 0;
  const out = [];
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

function totp(secret, at = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac('sha1', base32(secret)).update(counter).digest();
  const o = h[h.length - 1] & 0x0f;
  const bin = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1000000).padStart(6, '0');
}

/**
 * Signs the platform admin in through the UI, including the authenticator step. A code can be used once, so if this
 * window's code was already used (another script just signed in), wait for the next one.
 */
async function signInPlatformAdmin(page, app, password = 'Demo-Passw0rd!') {
  await page.goto(`${app}/login`);
  await page.getByLabel('Email').fill('admin@shopmint.local');
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const step = page.getByRole('heading', { name: 'Two-step verification' });
  await step.waitFor({ timeout: 10000 });
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByLabel('Code').fill(totp(ADMIN_SECRET));
    await page.getByRole('button', { name: 'Verify' }).click();
    const done = await page.waitForURL(/\/(admin|platform)(\/|$)/, { timeout: 5000 }).then(() => true, () => false);
    if (done) return;
    await page.waitForTimeout(31000 - (Date.now() % 30000));
  }
  throw new Error('Platform admin sign-in failed at the code step');
}

module.exports = { totp, signInPlatformAdmin, ADMIN_SECRET };

// `node e2e/totp.cjs [secret]` prints the current code (default: the dev platform admin's, local development only).
if (require.main === module) console.log(totp(process.argv[2] || ADMIN_SECRET));
