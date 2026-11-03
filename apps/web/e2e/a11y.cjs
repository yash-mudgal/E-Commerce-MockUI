// Runs axe-core (WCAG 2.x A/AA rules) on key pages while signed in.
const { chromium } = require('playwright');
const axeSource = require('fs').readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 860 } }); const p = await ctx.newPage();
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
  await p.getByLabel('Email').count();
  await p.goto('http://localhost:3000/login'); await p.getByLabel('Email').fill('owner@desithreads.demo'); await p.getByLabel('Password').fill('Demo-Passw0rd!');
  await p.getByRole('button', { name: 'Sign in' }).click(); await p.waitForURL('**/admin');
  await scan('http://localhost:3000/admin', 'Needs restocking');
  await scan('http://localhost:3000/admin/products', 'Add product');
  await scan('http://localhost:3000/admin/products/new', 'Variants');
  await scan('http://localhost:3000/admin/categories', 'Ethnic Wear');
  await scan('http://localhost:3000/admin/settings', 'Brand colour');
  await scan('http://desithreads.localhost:3000/', 'New arrivals');
  await scan('http://desithreads.localhost:3000/products', 'products');
  await scan('http://desithreads.localhost:3000/products/jaipuri-cotton-anarkali-kurta', 'Description');
  await b.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
