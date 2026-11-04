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
  // Shopper pages on a store domain: guest views, then a signed-in shopper with an item in the cart.
  const shopCtx = await b.newContext({ viewport: { width: 1280, height: 860 } });
  const prev = p; p = await shopCtx.newPage();
  const S = 'http://desithreads.localhost:3000';
  await scan(`${S}/cart`, 'Your cart is empty');
  await scan(`${S}/account/login`, 'Forgot password?');
  await scan(`${S}/account/signup`, 'Create account');
  await scan(`${S}/account/forgot-password`, 'Send reset link');
  await p.evaluate(async () => {
    const h = { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1' };
    await fetch('/api/storefront/account/signup', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Axe Shopper', email: `axe-${Date.now()}@example.com`, password: 'Axe-Shopper-Pass-1' }) });
    const slug = (await (await fetch('/api/storefront/products?inStock=true&pageSize=1')).json()).items[0].slug;
    const v = (await (await fetch(`/api/storefront/products/${slug}`)).json()).variants.find((x) => x.available).id;
    await fetch('/api/storefront/cart/lines', { method: 'POST', headers: h, body: JSON.stringify({ variantId: v, quantity: 1 }) });
  });
  await scan(`${S}/cart`, 'Summary');
  await scan(`${S}/account`, 'Delivery addresses');
  // Phase 8: checkout, an order (cash on delivery), its invoice and the orders list.
  const orderId = await p.evaluate(async () => {
    const h = { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1' };
    const addr = await (await fetch('/api/storefront/account/addresses', { method: 'POST', headers: h, body: JSON.stringify({ name: 'Axe Shopper', phone: '9876543210', line1: '1 MG Road', line2: null, city: 'Pune', stateCode: '27', pincode: '411001', isDefault: true }) })).json();
    window.__addr = addr.id;
    return addr.id;
  });
  await scan(`${S}/checkout`, 'Order summary');
  const placed = await p.evaluate(async (addressId) => {
    const h = { 'Content-Type': 'application/json', 'X-ShopMint-Csrf': '1', 'Idempotency-Key': 'axe-' + Date.now() };
    return (await (await fetch('/api/storefront/checkout/orders', { method: 'POST', headers: h, body: JSON.stringify({ addressId, paymentMethod: 'cod' }) })).json()).orderId;
  }, orderId);
  await scan(`${S}/account/orders/${placed}`, 'Delivery address');
  await scan(`${S}/account/orders/${placed}/invoice`, 'Tax invoice');
  await scan(`${S}/account/orders`, 'Your orders');
  await prev.goto('http://localhost:3000/admin');
  {
    const shopperPage = p; p = prev;
    await scan('http://localhost:3000/admin/orders', 'To fulfil');
    await scan(`http://localhost:3000/admin/orders/${placed}`, 'Customer');
    await scan(`http://localhost:3000/admin/orders/${placed}/invoice`, 'Tax invoice');
    await scan('http://localhost:3000/admin/coupons', 'Discount codes');
    await scan('http://localhost:3000/admin/settings', 'Online payments');
    p = shopperPage;
  }
  await p.close(); p = prev;

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
