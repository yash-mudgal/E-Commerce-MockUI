// Runs axe-core (WCAG 2.x A/AA rules) on key pages while signed in.
const { chromium } = require('playwright');
const axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }); let p = await ctx.newPage();
  const scan = async (url, ready) => {
    await p.goto(url); await p.getByText(ready).first().waitFor(); await p.waitForTimeout(400);
    await p.addScriptTag({ content: axeSource });
    const r = await p.evaluate(async () => await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }));
    const bad = r.violations.filter(v => ['serious', 'critical'].includes(v.impact));
    console.log(url.replace('http://', '').padEnd(52), 'serious/critical:', bad.length, bad.map(v => `${v.id}(${v.nodes.length}): ${v.nodes[0].target}`).join('; '));
  };
  await scan('http://localhost:3000/', 'Simple monthly pricing');
  await scan('http://localhost:3000/login', 'Sign in to your store');
  await scan('http://localhost:3000/signup', 'Create your store');
  await scan('http://localhost:3000/forgot-password', 'Reset your password');
  await scan('http://localhost:3000/reset-password?token=example', 'Choose a new password');
  await scan('http://localhost:3000/verify-email?token=example', 'Confirm your email address');
  await scan('http://localhost:3000/invite/not-a-real-token', "This invitation can't be used");
  await p.goto('http://localhost:3000/login'); await p.getByLabel('Email').fill('owner@desithreads.demo'); await p.getByLabel('Password').fill('Demo-Passw0rd!');
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/admin');
  await scan('http://localhost:3000/admin', 'Needs restocking');
  await scan('http://localhost:3000/admin/products', 'Add product');
  await scan('http://localhost:3000/admin/products/new', 'Variants');
  await scan('http://localhost:3000/admin/categories', 'Ethnic Wear');
  await scan('http://localhost:3000/admin/settings', 'Brand colour');
  await scan('http://localhost:3000/admin/staff', 'Pending invitations');
  await scan('http://localhost:3000/admin/activity', 'What happened');
  await scan('http://localhost:3000/admin/account', 'Change password');
  await scan('http://localhost:3000/admin/setup', 'Open for business');
  await scan('http://localhost:3000/admin/inventory', 'Available');
  await scan('http://localhost:3000/admin/locations', 'Units on hand');
  {
    const first = (await (await p.request.get('http://localhost:3000/api/admin/products?pageSize=1')).json()).items[0];
    await scan(`http://localhost:3000/admin/products/${first.id}`, 'Images');
  }
  await scan('http://desithreads.localhost:3000/', 'New arrivals');
  await scan('http://desithreads.localhost:3000/products', 'products');
  await scan('http://desithreads.localhost:3000/products/jaipuri-cotton-anarkali-kurta', 'Description');
  await scan('http://kaarigar.localhost:3000/products/cast-iron-dosa-tawa-12in', 'Description'); // has uploaded images (after e2e/phase6.cjs)
  // A brand-new store: unverified banner, launch checklist and the storefront's coming-soon page.
  const fresh = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const sub = 'a11y' + Date.now().toString(36);
  const res = await fresh.request.post('http://localhost:3000/api/auth/signup', {
    headers: { 'X-ShopMint-Csrf': '1' },
    data: { name: 'A11y Check', email: `${sub}@example.com`, password: 'A11y-Check-Pass-1', storeName: 'Accessible Goods', subdomain: sub },
  });
  if (res.status() !== 201) throw new Error('signup failed: ' + res.status());
  await p.close(); p = await fresh.newPage();
  await scan('http://localhost:3000/admin', 'Get ready to launch');
  await scan('http://localhost:3000/admin/setup', 'Publish your storefront');
  await scan(`http://${sub}.localhost:3000/`, 'opening soon');
  await b.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
