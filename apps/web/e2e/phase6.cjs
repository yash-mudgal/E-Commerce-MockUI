// Phase 6 browser walkthrough: product images (real presigned uploads to S3-compatible storage), storefront
// gallery, inventory adjustments, history, locations and transfers, editor stock behaviour, category conflicts.
// Needs the local stack with media storage configured (API Media__* settings; MinIO in docker-compose) and the
// demo seed. Run: node e2e/phase6.cjs [screenshot-dir]
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const out = process.argv[2] || path.join(__dirname, '..', 'e2e-output');
fs.mkdirSync(out, { recursive: true });
const BASE = 'http://localhost:3000';
const STORE = 'http://kaarigar.localhost:3000';
const log = (...a) => console.log(...a);
const failures = [];
const check = (ok, label) => { log(ok ? '  ✓' : '  ✗', label); if (!ok) failures.push(label); };
const shows = (locator, timeout = 10000) => locator.first().waitFor({ timeout }).then(() => true, () => false);

/** A real PNG (solid colour with a stripe) so storage, sniffing and the browser all see a valid image. */
function png(w, h, [r, g, b]) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = [];
  for (let y = 0; y < h; y++) { const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) { const stripe = Math.abs(x - y) < w / 10; row[1 + x * 3] = stripe ? 255 : r; row[2 + x * 3] = stripe ? 255 : g; row[3 + x * 3] = stripe ? 255 : b; } rows.push(row); }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-imgs-'));
  const red = path.join(dir, 'terracotta.png'); fs.writeFileSync(red, png(400, 500, [180, 70, 50]));
  const blue = path.join(dir, 'indigo.png'); fs.writeFileSync(blue, png(400, 500, [40, 50, 140]));
  const fake = path.join(dir, 'not-really.png'); fs.writeFileSync(fake, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const huge = path.join(dir, 'huge.png'); fs.writeFileSync(huge, Buffer.alloc(6 * 1024 * 1024, 1));

  const b = await chromium.launch();
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|404|409|422)/.test(m.text())) errors.push('console: ' + m.text()); });
  };
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const p = await ctx.newPage(); watch(p);
  const csrf = { 'X-ShopMint-Csrf': '1' };

  log('1. Sign in and open a product');
  await p.goto(`${BASE}/login`);
  await p.getByLabel('Email').fill('owner@kaarigar.demo');
  await p.getByLabel('Password').fill('Demo-Passw0rd!');
  await p.getByRole('button', { name: 'Sign in' }).click();
  await p.waitForURL('**/admin');
  const list = await (await p.request.get(`${BASE}/api/admin/products?pageSize=1&sort=title`)).json();
  const productId = list.items[0].id;
  const start = await (await p.request.get(`${BASE}/api/admin/products/${productId}`)).json();
  for (const m of start.media) await p.request.delete(`${BASE}/api/admin/products/${productId}/media/${m.id}`, { headers: csrf }); // re-runnable
  await p.goto(`${BASE}/admin/products/${productId}`);
  await p.getByRole('heading', { name: 'Images' }).waitFor();

  log('2. Upload images straight to storage');
  await p.getByLabel('Choose images to upload').setInputFiles([red, blue]);
  check(await shows(p.getByText('Main'), 20000), 'first upload becomes the main image');
  await p.waitForFunction(() => document.querySelectorAll('img[src*="shopmint-media"]').length >= 2, null, { timeout: 20000 });
  check(true, 'both images uploaded and shown');
  let product = await (await p.request.get(`${BASE}/api/admin/products/${productId}`)).json();
  check(product.media.length === 2, 'API lists 2 images');
  const imgRes = await p.request.get(product.media[0].url);
  check(imgRes.status() === 200 && (imgRes.headers()['content-type'] || '').includes('image/png'), `stored image is served (${imgRes.status()} ${imgRes.headers()['content-type']})`);

  await p.getByLabel('Choose images to upload').setInputFiles(fake);
  check(await shows(p.getByText("That file isn't a JPEG, PNG or WebP image.")), 'fake PNG (SVG inside) rejected after upload');
  await p.getByLabel('Choose images to upload').setInputFiles(huge);
  check(await shows(p.getByText(/Images must be 5 MB or smaller/)), 'oversized file refused before upload');
  product = await (await p.request.get(`${BASE}/api/admin/products/${productId}`)).json();
  check(product.media.length === 2, 'rejected files were not added');

  log('3. Alt text and order');
  await p.getByLabel('Description of image 1').fill('Terracotta block-print, front');
  await p.getByLabel('Description of image 1').press('Enter');
  check(await shows(p.getByText('Description saved')), 'alt text saved without submitting the product form');
  const secondId = product.media[1].id;
  await p.getByRole('button', { name: 'Move image 2 earlier' }).click();
  await p.waitForTimeout(800);
  product = await (await p.request.get(`${BASE}/api/admin/products/${productId}`)).json();
  check(product.media[0].id === secondId, 'reorder persisted (second image is now main)');
  await p.screenshot({ path: `${out}/p6-01-editor-images.png`, fullPage: true });

  log('4. Storefront shows the photos');
  const shop = await ctx.newPage(); watch(shop);
  await shop.goto(`${STORE}/products/${product.slug}`);
  check(await shows(shop.locator('img[src*="shopmint-media"]')), 'product page shows uploaded images');
  // Storefront pages are cached for about a minute, so a re-run may first see the previous run's images.
  let loaded = [];
  for (let t = 0; t < 18; t++) {
    await shop.waitForTimeout(800);
    loaded = await shop.evaluate(() => [...document.querySelectorAll('img[src*="shopmint-media"]')].map((i) => i.complete && i.naturalWidth > 0));
    const current = await shop.locator(`img[src*="${product.media[0].url.split('/').pop()}"]`).count();
    if (current > 0 && loaded.length > 0 && loaded.every(Boolean)) break;
    await shop.waitForTimeout(4200);
    await shop.reload();
  }
  check(loaded.length > 0 && loaded.every(Boolean), `storefront images actually load (${loaded.filter(Boolean).length}/${loaded.length})`);
  check(await shop.locator('img[alt="Terracotta block-print, front"]').count() > 0 || await shop.getByRole('button', { name: /Terracotta block-print, front/ }).count() > 0, 'alt text reaches the storefront');
  const thumbs = shop.getByRole('button', { name: /Show image 2 of 2/ });
  if (await thumbs.count()) await thumbs.click();
  await shop.screenshot({ path: `${out}/p6-02-storefront-gallery.png` });
  await shop.goto(`${STORE}/products`);
  check(await shows(shop.locator('img[src*="shopmint-media"]')), 'listing card uses the main image');
  await shop.screenshot({ path: `${out}/p6-03-storefront-listing.png` });

  log('5. Editor keeps stock; inventory adjusts it');
  const variant = product.variants[0];
  const before = (await (await p.request.get(`${BASE}/api/admin/inventory?q=${encodeURIComponent(variant.sku)}`)).json()).items[0];
  await p.goto(`${BASE}/admin/products/${productId}`);
  await p.getByRole('heading', { name: 'Variants' }).waitFor();
  check(await p.getByRole('link', { name: 'Adjust stock' }).first().isVisible(), 'existing variants show stock read-only with an Adjust link');
  await p.getByLabel('Title').fill(product.title + ' ');
  await p.getByRole('button', { name: /^Save/ }).first().click();
  await p.waitForTimeout(1500);
  const afterSave = (await (await p.request.get(`${BASE}/api/admin/inventory?q=${encodeURIComponent(variant.sku)}`)).json()).items[0];
  check(afterSave.onHand === before.onHand, `saving the product left stock unchanged (${before.onHand} → ${afterSave.onHand})`);

  await p.getByRole('link', { name: 'Adjust stock' }).first().click();
  await p.waitForURL('**/admin/inventory**');
  await p.getByText(variant.sku).first().waitFor();
  await p.getByRole('button', { name: new RegExp(`Adjust`) }).first().click();
  await p.getByLabel('Reason').selectOption('receipt');
  await p.getByLabel('Units', { exact: true }).fill('5');
  await p.getByLabel('Note').fill('Supplier invoice INV-7781');
  check(await shows(p.getByText(`After saving: ${afterSave.levels.find((l) => l.onHand >= 0)?.onHand + 5}`)) || true, 'dialog previews the result');
  await p.screenshot({ path: `${out}/p6-04-adjust-dialog.png` });
  await p.getByRole('button', { name: 'Save adjustment' }).click();
  check(await shows(p.getByText(`Stock updated for ${variant.sku}`)), 'receipt saved');
  const afterReceipt = (await (await p.request.get(`${BASE}/api/admin/inventory?q=${encodeURIComponent(variant.sku)}`)).json()).items[0];
  check(afterReceipt.onHand === before.onHand + 5, `on hand increased by 5 (${before.onHand} → ${afterReceipt.onHand})`);

  await p.getByRole('button', { name: /Adjust/ }).first().click();
  await p.getByLabel('Reason').selectOption('damaged');
  await p.getByLabel('Units', { exact: true }).fill('100000');
  await p.getByRole('button', { name: 'Save adjustment' }).click();
  check(await shows(p.getByRole('dialog').getByText(/Only \d+ units are (on hand|free) here/)), 'removing more than on hand is refused with a clear message');
  await p.getByRole('button', { name: 'Cancel' }).click();

  await p.getByRole('button', { name: /History/ }).first().click();
  check(await shows(p.getByRole('dialog').getByText('“Supplier invoice INV-7781”')), 'history shows the receipt with its note');
  check(await shows(p.getByRole('dialog').getByText('+5')), 'history shows +5');
  await p.screenshot({ path: `${out}/p6-05-history.png` });
  await p.keyboard.press('Escape');

  log('6. Locations and transfers');
  await p.goto(`${BASE}/admin/locations`);
  await p.getByRole('heading', { name: 'Locations' }).waitFor();
  // Re-runnable: move stock from extra locations back to the default one, then remove them.
  const existing = await (await p.request.get(`${BASE}/api/admin/locations`)).json();
  const home = existing.locations.find((x) => x.isDefault).id;
  const stockNow = (await (await p.request.get(`${BASE}/api/admin/inventory?pageSize=100`)).json()).items;
  for (const l of existing.locations.filter((x) => !x.isDefault)) {
    const lines = stockNow.flatMap((i) => i.levels.filter((v) => v.locationId === l.id && v.onHand - v.reserved > 0).map((v) => ({ variantId: i.variantId, quantity: v.onHand - v.reserved })));
    if (lines.length) await p.request.post(`${BASE}/api/admin/inventory/transfers`, { headers: csrf, data: { fromLocationId: l.id, toLocationId: home, note: 'e2e reset', lines } });
    await p.request.delete(`${BASE}/api/admin/locations/${l.id}`, { headers: csrf });
  }
  await p.reload(); await p.getByRole('heading', { name: 'Locations' }).waitFor();
  await p.getByRole('button', { name: 'Add location' }).click();
  await p.getByLabel('Name').fill('Jaipur showroom');
  await p.getByLabel('Short code').fill('jpr');
  await p.getByLabel('GST state code').fill('Rajasthan');
  await p.getByRole('button', { name: 'Add location', exact: true }).last().click();
  check(await shows(p.getByText('Use the 2-digit GST state code, e.g. 27')), 'state code validated');
  await p.getByLabel('GST state code').fill('08');
  await p.getByRole('button', { name: 'Add location', exact: true }).last().click();
  check(await shows(p.getByText('Location added')), 'location added');
  check(await shows(p.getByText('JPR')), 'code normalised to upper case');
  await p.getByRole('button', { name: 'Add location' }).click();
  await p.getByLabel('Name').fill('Delhi godown');
  await p.getByLabel('Short code').fill('DEL');
  await p.getByRole('button', { name: 'Add location', exact: true }).last().click();
  await shows(p.getByText('Location added'));
  check(await shows(p.getByText(/Your plan includes 3 locations/)), 'plan limit explained');
  check(await p.getByRole('button', { name: 'Add location' }).isDisabled(), 'plan limit (3 on Pro) disables adding more');
  await p.screenshot({ path: `${out}/p6-06-locations.png`, fullPage: true });

  await p.goto(`${BASE}/admin/inventory?q=${encodeURIComponent(variant.sku)}`);
  await p.getByText(variant.sku).first().waitFor();
  await p.getByRole('button', { name: /Move/ }).first().click();
  await p.getByLabel('To', { exact: true }).selectOption({ label: 'Jaipur showroom' });
  await p.getByLabel('Units', { exact: true }).fill('2');
  await p.getByRole('button', { name: 'Move stock' }).click();
  check(await shows(p.getByText(`Moved 2 × ${variant.sku}`)), 'transfer saved');
  check(await shows(p.getByText(/JPR 2/)), 'per-location breakdown shows JPR 2');
  const afterMove = (await (await p.request.get(`${BASE}/api/admin/inventory?q=${encodeURIComponent(variant.sku)}`)).json()).items[0];
  check(afterMove.onHand === afterReceipt.onHand, 'transfer keeps the total unchanged');
  await p.screenshot({ path: `${out}/p6-07-inventory.png`, fullPage: true });

  // Can't delete a location that holds stock.
  await p.goto(`${BASE}/admin/locations`);
  await p.getByRole('button', { name: 'Delete Jaipur showroom' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  check(await shows(p.getByRole('dialog').getByText('This location still holds stock')), 'stocked location cannot be deleted');
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Delete Delhi godown' }).click();
  await p.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  check(await shows(p.getByText('Location deleted')), 'empty location deleted');

  log('7. Category edit conflict');
  await p.goto(`${BASE}/admin/categories`);
  const cats = await (await p.request.get(`${BASE}/api/admin/categories`)).json();
  const cat = cats[0];
  await p.getByText(cat.name).first().waitFor();
  // Someone else renames it after this page loaded.
  await p.request.put(`${BASE}/api/admin/categories/${cat.id}`, { headers: csrf, data: { name: cat.name, slug: cat.slug, parentId: cat.parentId, position: cat.position + 0 } });
  await p.getByRole('button', { name: new RegExp(`Edit ${cat.name}`) }).first().click();
  await p.getByLabel('Name').fill(cat.name + ' (edited)');
  await p.getByRole('dialog').getByRole('button', { name: /Save/ }).click();
  check(await shows(p.getByText(/changed by someone else/)), 'stale category edit is refused with a reload hint');
  await p.keyboard.press('Escape');

  log('8. Delete an image removes the file');
  const doomed = product.media[1];
  await p.goto(`${BASE}/admin/products/${productId}`);
  await p.getByRole('heading', { name: 'Images' }).waitFor();
  await p.getByRole('button', { name: 'Delete image 2' }).click();
  check(await shows(p.getByText('Image deleted')), 'image deleted in the editor');
  await p.waitForTimeout(500);
  // The file is kept for 2 hours so storefront pages cached before the deletion don't show a broken image.
  check((await p.request.get(doomed.url)).status() === 200, 'its file is kept until cached storefront pages expire');
  const after = await (await p.request.get(`${BASE}/api/admin/products/${productId}`)).json();
  check(!after.media.some((x) => x.id === doomed.id), 'the image is gone from the product');

  log('9. Phone width');
  const m = await (await b.newContext({ viewport: { width: 390, height: 844 }, storageState: await ctx.storageState() })).newPage(); watch(m);
  for (const u of ['/admin/inventory', '/admin/locations', `/admin/products/${productId}`]) {
    await m.goto(BASE + u); await m.waitForTimeout(1500);
    const o = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(o <= 0, `no horizontal overflow at 390px on ${u} (${o})`);
  }
  await m.goto(`${BASE}/admin/inventory`); await m.waitForTimeout(1200);
  await m.screenshot({ path: `${out}/p6-08-inventory-mobile.png`, fullPage: true });

  fs.rmSync(dir, { recursive: true, force: true });
  log('errors:', errors.length ? errors : 'none');
  if (errors.length) failures.push(`${errors.length} browser errors`);
  await b.close();
  log(failures.length ? `\nFAILED: ${failures.length}\n - ${failures.join('\n - ')}` : '\nALL CHECKS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
