/* SaaS module: Plans & billing, Store settings, Stores (tenants).
   Uses window.XU helpers defined in erp.js (resolved lazily at render time). */
(function () {
  'use strict';

  var SaaS = window.SaaS = {};
  var OWNER = ['Owner'];

  function plans() {
    return (App.data && App.data.plans) || [
      { id: 'basic', name: 'Basic', price: 999, tagline: 'For new sellers getting started', limits: { products: '500', staff: '2', warehouses: '1', stores: '1', txnFee: '2%' } },
      { id: 'pro', name: 'Pro', price: 2499, tagline: 'For growing D2C brands', popular: true, limits: { products: '5,000', staff: '10', warehouses: '3', stores: '2', txnFee: '1%' } },
      { id: 'enterprise', name: 'Enterprise', price: 7999, tagline: 'For multi-brand businesses', limits: { products: 'Unlimited', staff: 'Unlimited', warehouses: 'Unlimited', stores: '5', txnFee: '0.5%' } }
    ];
  }
  function features() { return (App.data && App.data.planFeatures) || []; }
  function tenants() { return (App.store && App.store.tenants) || (App.data && App.data.tenants) || []; }
  function curPlanId() {
    var s = XU.settings(), t = XU.st().tenant || {};
    return (s.billing && s.billing.plan) || t.plan || 'basic';
  }
  function plan(id) { return plans().filter(function (p) { return p.id === id; })[0] || plans()[0]; }
  function limitNum(v) { var n = parseInt(String(v).replace(/,/g, ''), 10); return isNaN(n) ? Infinity : n; }
  function subdomainOf(t) { var s = String(t.subdomain || ''); return /\./.test(s) ? s : s + '.shopmint.in'; }

  /* ---------------- Plans & billing ---------------- */
  function meter(label, used, limit) {
    var n = limitNum(limit), pct = n === Infinity ? 8 : Math.min(100, used / n * 100);
    return '<div style="margin-bottom:12px"><div class="ex-bar ex-small" style="justify-content:space-between"><span>' + label + '</span><b>' + XU.num(used) + ' / ' + XU.esc(limit) + '</b></div>' +
      '<div class="ex-meter"><i style="width:' + pct + '%;' + (pct > 85 ? 'background:#f59e0b' : '') + '"></i></div></div>';
  }
  function renderBilling() {
    var cur = curPlanId(), cp = plan(cur), s = XU.settings(), b = s.billing || {};
    var cards = plans().map(function (p) {
      var isCur = p.id === cur;
      var incl = features().filter(function (f) { return f[plans().indexOf(p) + 1]; }).slice(0, 7).map(function (f) {
        var v = f[plans().indexOf(p) + 1];
        return '<li>' + XU.esc(f[0]) + (typeof v === 'string' ? ' <span class="ex-muted">(' + XU.esc(v) + ')</span>' : '') + '</li>';
      }).join('');
      return '<div class="ex-card ex-plan' + (isCur ? ' cur' : '') + '">' +
        (isCur ? '<span class="ex-badge ex-purple" style="position:absolute;top:14px;right:14px">Current plan</span>' : p.popular ? '<span class="ex-badge ex-amber" style="position:absolute;top:14px;right:14px">Most popular</span>' : '') +
        '<h3 style="margin-bottom:4px">' + XU.esc(p.name) + '</h3><div class="ex-muted ex-small">' + XU.esc(p.tagline || '') + '</div>' +
        '<div style="margin:14px 0 4px"><span class="ex-price">' + XU.inr(p.price) + '</span><span class="ex-muted"> /month</span></div>' +
        '<div class="ex-muted ex-small">+18% GST · billed monthly · ' + XU.esc(p.limits.txnFee) + ' transaction fee</div>' +
        '<ul>' + ['Up to ' + p.limits.products + ' products', p.limits.staff + ' staff accounts', p.limits.warehouses + ' warehouse(s)', p.limits.stores + ' store(s)']
          .map(function (x) { return '<li>' + XU.esc(x.replace('Up to Unlimited', 'Unlimited')) + '</li>'; }).join('') + incl + '</ul>' +
        (isCur ? '<button class="ex-btn" disabled style="width:100%;justify-content:center">Your current plan</button>'
          : '<button class="ex-btn ' + (p.price > cp.price ? 'ex-primary' : '') + '" style="width:100%;justify-content:center" onclick="SaaS.changePlan(\'' + p.id + '\')">' +
            (p.price > cp.price ? 'Upgrade to ' : 'Downgrade to ') + XU.esc(p.name) + '</button>') + '</div>';
    }).join('');
    var tick = function (v) { return v === true ? '<span class="ex-tick">✓</span>' : v ? XU.esc(v) : '<span class="ex-cross">—</span>'; };
    var cmpCols = [{ label: 'Feature' }].concat(plans().map(function (p) { return { label: p.name + (p.id === cur ? ' ★' : ''), align: 'c' }; }));
    var limitRows = [['Monthly price'].concat(plans().map(function (p) { return '<b>' + XU.inr(p.price) + '</b>'; })),
      ['Products'].concat(plans().map(function (p) { return XU.esc(p.limits.products); })),
      ['Staff accounts'].concat(plans().map(function (p) { return XU.esc(p.limits.staff); })),
      ['Warehouses'].concat(plans().map(function (p) { return XU.esc(p.limits.warehouses); })),
      ['Stores'].concat(plans().map(function (p) { return XU.esc(p.limits.stores); })),
      ['Transaction fee'].concat(plans().map(function (p) { return XU.esc(p.limits.txnFee); }))];
    var cmpRows = limitRows.concat(features().map(function (f) { return [XU.esc(f[0])].concat(f.slice(1).map(tick)); }));
    // Billing history: last 6 monthly invoices for the current plan
    var hist = [], now = new Date();
    for (var i = 0; i < 6; i++) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, Math.min(15, now.getDate()));
      if (i === 0 && d > now) continue;
      var amt = cp.price * 1.18;
      hist.push(['SM/' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + '/' + String(XU.st().tenant.id || 'x').slice(0, 3).toUpperCase() + (4100 + i),
        XU.date(d), XU.esc(cp.name) + ' plan · monthly', XU.inr2(cp.price), XU.inr2(cp.price * 0.18), '<b>' + XU.inr2(amt) + '</b>', XU.badge('Paid', 'green'),
        '<button class="ex-btn ex-sm" onclick="SaaS.receipt(' + i + ')">Receipt</button>']);
    }
    var mk = XU.monthKey(new Date());
    var monthOrders = XU.arr('orders').filter(function (o) { return XU.monthKey(o.date) === mk; }).length;
    return '<div class="ex-page">' + XU.head('Plans & billing', 'You are on the <b>' + XU.esc(cp.name) + '</b> plan · next bill ' + XU.date(b.nextBillDate) + ' · ' + XU.esc(b.card || 'No card on file'),
      '<button class="ex-btn" onclick="SaaS.updateCard()">💳 Update payment method</button>') +
      '<div class="ex-grid2" style="margin-bottom:16px"><div class="ex-card"><h3>Usage this month</h3>' +
      meter('Products', XU.arr('products').length, cp.limits.products) +
      meter('Staff accounts', XU.arr('staff').length, cp.limits.staff) +
      meter('Warehouses', XU.warehouses().length, cp.limits.warehouses) +
      meter('Stores', tenants().length, cp.limits.stores) +
      '<div class="ex-small ex-muted">' + XU.num(monthOrders) + ' orders processed this month · ' + XU.esc(cp.limits.txnFee) + ' platform fee</div></div>' +
      '<div class="ex-card"><h3>Subscription</h3><table class="ex-table"><tbody>' +
      '<tr><td>Plan</td><td class="ex-r"><b>' + XU.esc(cp.name) + '</b></td></tr>' +
      '<tr><td>Billing cycle</td><td class="ex-r">' + XU.esc((b.cycle || 'monthly').replace(/^./, function (c) { return c.toUpperCase(); })) + '</td></tr>' +
      '<tr><td>Amount</td><td class="ex-r">' + XU.inr2(cp.price) + ' + ' + XU.inr2(cp.price * 0.18) + ' GST</td></tr>' +
      '<tr><td>Next billing date</td><td class="ex-r">' + XU.date(b.nextBillDate) + '</td></tr>' +
      '<tr><td>Payment method</td><td class="ex-r">' + XU.esc(b.card || '—') + '</td></tr>' +
      '<tr><td>Billing GSTIN</td><td class="ex-r"><code>' + XU.esc(XU.settings().gstin || '—') + '</code></td></tr></tbody></table></div></div>' +
      '<div class="ex-grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">' + cards + '</div>' +
      '<div class="ex-card"><h3>Feature comparison</h3>' + XU.table(cmpCols, cmpRows) + '</div>' +
      '<div class="ex-card"><h3>Billing history</h3>' + XU.table(['Invoice', 'Date', 'Description', { label: 'Amount', align: 'r' }, { label: 'GST 18%', align: 'r' }, { label: 'Total', align: 'r' }, 'Status', ''], hist) + '</div></div>';
  }
  SaaS.changePlan = function (id) {
    var np = plan(id), cp = plan(curPlanId()), up = np.price > cp.price;
    var blockers = [];
    if (!up) {
      if (XU.arr('products').length > limitNum(np.limits.products)) blockers.push('You have ' + XU.arr('products').length + ' products (limit ' + np.limits.products + ')');
      if (XU.arr('staff').length > limitNum(np.limits.staff)) blockers.push('You have ' + XU.arr('staff').length + ' staff accounts (limit ' + np.limits.staff + ')');
      if (XU.warehouses().length > limitNum(np.limits.warehouses)) blockers.push('You use ' + XU.warehouses().length + ' warehouses (limit ' + np.limits.warehouses + ')');
    }
    var days = 30 - new Date().getDate() % 30, prorate = Math.max(0, (np.price - cp.price) * days / 30);
    XU.modal({
      title: (up ? 'Upgrade' : 'Downgrade') + ' to ' + np.name,
      saveLabel: up ? 'Pay ' + XU.inr(prorate * 1.18) + ' & upgrade' : 'Confirm downgrade',
      body: '<p>' + XU.esc(cp.name) + ' (' + XU.inr(cp.price) + '/mo) → <b>' + XU.esc(np.name) + ' (' + XU.inr(np.price) + '/mo)</b></p>' +
        (up ? '<p class="ex-small">Prorated charge for the remaining ' + days + ' days: <b>' + XU.inr2(prorate) + '</b> + 18% GST = <b>' + XU.inr2(prorate * 1.18) + '</b>, charged to ' +
          XU.esc((XU.settings().billing || {}).card || 'your card on file') + '. New features are available immediately.</p>'
          : '<p class="ex-small">The change takes effect on your next billing date. Features not included in ' + XU.esc(np.name) + ' will be locked.</p>') +
        (blockers.length ? '<div class="ex-card" style="background:#fef3c7;border-color:#fcd34d;margin:0"><b>Heads up:</b><ul style="margin:6px 0 0">' +
          blockers.map(function (x) { return '<li>' + XU.esc(x) + '</li>'; }).join('') + '</ul><div class="ex-small">Extra items become read-only after the downgrade.</div></div>' : ''),
      onSave: function () {
        var s = XU.settings(), st = XU.st();
        s.billing = s.billing || {}; s.billing.plan = id;
        if (st.tenant) st.tenant.plan = id;
        tenants().forEach(function (t) { if (st.tenant && t.id === st.tenant.id) t.plan = id; });
        XU.save(); XU.closeModal();
        XU.toast('Plan changed to ' + np.name + (up ? ' — payment successful' : ''), 'success');
        XU.rerender();
      }
    });
  };
  SaaS.updateCard = function () {
    XU.modal({
      title: 'Update payment method', saveLabel: 'Save card',
      body: '<div class="ex-form"><label class="ex-full">Card number<input name="num" inputmode="numeric" value="4111 1111 1111 4821" required></label>' +
        '<label>Expiry<input name="exp" value="08/29"></label><label>CVV<input name="cvv" value="123" type="password"></label>' +
        '<label class="ex-full">Name on card<input name="name" value="' + XU.esc(XU.me().name || '') + '"></label></div>' +
        '<p class="ex-muted ex-small">Demo only — card details are not stored. Recurring payments are processed via RBI-compliant e-mandate.</p>',
      onSave: function (f) {
        var num = XU.val(f, 'num').replace(/\D/g, '');
        if (num.length < 12) { XU.toast('Enter a valid card number', 'error'); return false; }
        var brand = num[0] === '4' ? 'Visa' : num[0] === '5' ? 'Mastercard' : num[0] === '6' ? 'RuPay' : 'Card';
        var s = XU.settings(); s.billing = s.billing || {}; s.billing.card = brand + ' •••• ' + num.slice(-4);
        XU.save(); XU.closeModal(); XU.toast('Payment method updated', 'success'); XU.rerender();
      }
    });
  };
  SaaS.receipt = function (i) {
    var cp = plan(curPlanId()), d = new Date(); d.setMonth(d.getMonth() - i);
    var rows = [['ShopMint ' + cp.name + ' plan (monthly)', 'Rs. ' + cp.price.toLocaleString('en-IN', { minimumFractionDigits: 2 })],
      ['IGST @ 18%', 'Rs. ' + (cp.price * 0.18).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })],
      ['Total paid', 'Rs. ' + (cp.price * 1.18).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })]];
    if (App.ui && App.ui.pdf) App.ui.pdf('Subscription receipt', ['Description', 'Amount'], rows, 'Billed to ' + XU.storeName() + ' · GSTIN ' + (XU.settings().gstin || '-') + ' · ' + XU.date(d));
    else XU.pdf('Subscription receipt', ['Description', 'Amount'], rows);
  };

  /* ---------------- Store settings ---------------- */
  var CURRENCIES = [['INR', '₹ Indian Rupee (INR)'], ['USD', '$ US Dollar (USD) — international checkout'], ['AED', 'AED UAE Dirham — international checkout']];
  function inp(name, label, val, extra) {
    return '<label' + (extra && extra.full ? ' class="ex-full"' : '') + '>' + label + '<input name="' + name + '" value="' + XU.esc(val == null ? '' : val) + '"' +
      (extra && extra.type ? ' type="' + extra.type + '"' : '') + (extra && extra.attrs ? ' ' + extra.attrs : '') + '></label>';
  }
  function toggle(name, label, sub, on) {
    return '<label class="ex-switch" style="flex-direction:row;font-weight:400;color:inherit"><span><b>' + label + '</b><div class="ex-muted ex-small">' + sub + '</div></span>' +
      '<input type="checkbox" name="' + name + '"' + (on ? ' checked' : '') + '></label>';
  }
  function shipRow(m, i) {
    return '<tr data-ship="' + i + '"><td><input name="sname" value="' + XU.esc(m.name || '') + '"><input type="hidden" name="sid" value="' + XU.esc(m.id || '') + '"></td>' +
      '<td><input name="sdays" value="' + XU.esc(m.days || '') + '"></td><td><input name="srate" type="number" min="0" value="' + (m.rate || 0) + '"></td>' +
      '<td><input name="sfree" type="number" min="0" value="' + (m.freeAbove || 0) + '"></td>' +
      '<td class="ex-c"><input type="checkbox" name="sactive"' + (m.active !== false ? ' checked' : '') + ' style="width:auto"></td>' +
      '<td><button type="button" class="ex-btn ex-sm ex-danger" onclick="this.closest(\'tr\').remove()">✕</button></td></tr>';
  }
  function renderSettings() {
    var s = XU.settings(), t = XU.st().tenant || {}, pay = s.payments || {};
    var states = (App.data && App.data.states) || [s.state];
    var logo = s.logo ? '<img src="' + s.logo + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">' : XU.esc(s.logoEmoji || '🛍️');
    var sub = String(s.subdomain || t.subdomain || '').replace(/\.shopmint\.in$/, '');
    return '<div class="ex-page"><form id="ex-settings" class="ex-form-wrap" onsubmit="return SaaS.saveSettings(event)">' +
      XU.head('Store settings', 'Branding, domain, tax, payments and shipping for ' + XU.esc(XU.storeName()),
        '<button type="button" class="ex-btn" onclick="XU.rerender()">Discard changes</button><button class="ex-btn ex-primary" type="submit">Save settings</button>') +
      '<div class="ex-grid2">' +
      /* Branding */
      '<div class="ex-card"><h3>🎨 Branding</h3><div class="ex-bar" style="margin-bottom:14px;gap:14px">' +
      '<div id="ex-logo-prev" style="width:64px;height:64px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:34px;background:' + XU.esc(s.brandColor || '#4f46e5') + '22">' + logo + '</div>' +
      '<div class="ex-small"><label class="ex-btn ex-sm" style="cursor:pointer">Upload logo<input type="file" accept="image/*" hidden onchange="SaaS.logo(this)"></label> ' +
      (s.logo ? '<button type="button" class="ex-btn ex-sm" onclick="SaaS.clearLogo()">Use emoji</button>' : '') +
      '<div class="ex-muted" style="margin-top:4px">PNG/JPG, square, shown on storefront & invoices</div></div></div>' +
      '<div class="ex-form">' + inp('storeName', 'Store name', s.storeName, { attrs: 'required' }) + inp('tagline', 'Tagline', s.tagline) +
      inp('logoEmoji', 'Logo emoji (fallback)', s.logoEmoji, { attrs: 'maxlength="4"' }) + inp('brandColor', 'Website colour', s.brandColor || '#4f46e5', { type: 'color', attrs: 'style="height:36px;padding:2px" oninput="App.ui.applyTheme(this.value)"' }) +
      '<div class="ex-full"><div class="ex-small ex-muted" style="margin-bottom:6px">Theme presets: preview live, then click Save settings</div><div class="theme-swatches" style="grid-template-columns:repeat(10,30px)">' +
      App.ui.themes.map(function (t) {
        return '<button type="button" class="swatch' + (t[1] === String(s.brandColor).toLowerCase() ? ' on' : '') + '" style="background:' + t[1] + '" title="' + t[0] + '" onclick="SaaS.pickColor(this,\'' + t[1] + '\')"></button>';
      }).join('') + '</div></div></div></div>' +
      /* Domain */
      '<div class="ex-card"><h3>🌐 Domain & locale</h3><div class="ex-form">' +
      '<label class="ex-full">Subdomain<div class="ex-bar" style="flex-wrap:nowrap"><input name="subdomain" value="' + XU.esc(sub) + '" pattern="[a-z0-9-]{3,30}" required style="text-align:right"><span class="ex-muted" style="font-weight:400">.shopmint.in</span></div></label>' +
      inp('customDomain', 'Custom domain' + (curPlanId() === 'basic' ? ' <span class="ex-badge ex-amber">Pro</span>' : ''), s.customDomain, { attrs: curPlanId() === 'basic' ? 'disabled placeholder="Upgrade to Pro to connect"' : 'placeholder="www.yourbrand.in"', full: true }) +
      '<label>Currency<select name="currency">' + CURRENCIES.map(function (c) { return '<option value="' + c[0] + '"' + (c[0] === (s.currency || 'INR') ? ' selected' : '') + '>' + c[1] + '</option>'; }).join('') + '</select></label>' +
      inp('email', 'Support email', s.email, { type: 'email' }) + inp('phone', 'Support phone', s.phone) + '</div></div>' +
      /* Tax */
      '<div class="ex-card"><h3>🧾 Business & GST</h3><div class="ex-form">' +
      inp('legalName', 'Legal business name', s.legalName, { full: true }) +
      inp('gstin', 'GSTIN', s.gstin, { attrs: 'maxlength="15" style="text-transform:uppercase"' }) +
      '<label>State (place of business)<select name="state">' + states.map(function (x) { return '<option' + (x === s.state ? ' selected' : '') + '>' + XU.esc(x) + '</option>'; }).join('') + '</select></label>' +
      inp('address', 'Registered address', s.address, { full: true }) +
      '<label>Prices on storefront<select name="pricesIncludeGst"><option value="1"' + (s.pricesIncludeGst !== false ? ' selected' : '') + '>Inclusive of GST (MRP style)</option><option value="0"' + (s.pricesIncludeGst === false ? ' selected' : '') + '>Exclusive of GST</option></select></label>' +
      inp('lowStockThreshold', 'Low-stock alert threshold', s.lowStockThreshold || 10, { type: 'number', attrs: 'min="0"' }) +
      '</div><p class="ex-muted ex-small">Invoices use CGST + SGST for buyers in ' + XU.esc(s.state || 'your state') + ' and IGST for inter-state orders. GST rate is set per product (HSN).</p></div>' +
      /* Payments */
      '<div class="ex-card"><h3>💳 Payment methods</h3>' +
      toggle('pay_upi', 'UPI', 'Google Pay, PhonePe, Paytm, BHIM — 0% MDR', pay.upi) +
      toggle('pay_card', 'Credit & debit cards', 'Visa, Mastercard, RuPay, Amex · 1.9% gateway fee', pay.card) +
      toggle('pay_netbanking', 'Netbanking', '58 banks incl. SBI, HDFC, ICICI, Axis · 1.5% fee', pay.netbanking) +
      toggle('pay_cod', 'Cash on delivery', 'Collected by courier partner, remitted in 3–5 days', pay.cod) +
      '<div class="ex-form" style="margin-top:12px">' + inp('codFee', 'COD handling fee (₹)', s.codFee || 0, { type: 'number', attrs: 'min="0"' }) +
      inp('codLimit', 'Max order value for COD (₹)', s.codLimit || 0, { type: 'number', attrs: 'min="0"' }) + '</div></div>' +
      '</div>' +
      /* Shipping */
      '<div class="ex-card"><div class="ex-head" style="margin-bottom:8px"><h3 style="margin:0">🚚 Shipping options & rates</h3>' +
      '<button type="button" class="ex-btn ex-sm" onclick="SaaS.addShip()">＋ Add option</button></div>' +
      '<table class="ex-lines ex-form" style="display:table"><thead><tr class="ex-small ex-muted"><td>Name</td><td>Delivery time</td><td>Rate (₹)</td><td>Free above (₹, 0 = never)</td><td class="ex-c">Active</td><td></td></tr></thead>' +
      '<tbody id="ex-ship-rows">' + (s.shipping || []).map(shipRow).join('') + '</tbody></table>' +
      '<p class="ex-muted ex-small">Rates apply pan-India. Pincode serviceability is checked via Shiprocket at checkout.</p></div>' +
      '<div class="ex-bar" style="justify-content:space-between;flex-wrap:wrap;gap:8px"><button type="button" class="ex-btn" onclick="App.store.reset();App.ui.toast(&quot;Demo data reset&quot;);App.router.refresh()">↺ Reset demo data</button><button class="ex-btn ex-primary" type="submit">Save settings</button></div>' +
      '</form></div>';
  }
  SaaS.pickColor = function (btn, color) {
    var f = document.getElementById('ex-settings');
    f.querySelector('[name=brandColor]').value = color;
    f.querySelectorAll('.swatch').forEach(function (b) { b.classList.toggle('on', b === btn); });
    App.ui.applyTheme(color);
  };
  SaaS.addShip = function () {
    var tb = document.getElementById('ex-ship-rows');
    if (tb) tb.insertAdjacentHTML('beforeend', shipRow({ id: '', name: 'Same-day Delivery', days: 'Same day (metro cities)', rate: 249, freeAbove: 0, active: true }, tb.children.length));
  };
  SaaS.logo = function (input) {
    var f = input.files && input.files[0];
    if (!f) return;
    var rd = new FileReader();
    rd.onload = function () {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'), n = 128; c.width = c.height = n;
        var sc = Math.max(n / img.width, n / img.height), w = img.width * sc, h = img.height * sc;
        c.getContext('2d').drawImage(img, (n - w) / 2, (n - h) / 2, w, h);
        SaaS._logo = c.toDataURL('image/png');
        var prev = document.getElementById('ex-logo-prev');
        if (prev) prev.innerHTML = '<img src="' + SaaS._logo + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">';
        XU.toast('Logo ready — click Save settings to apply');
      };
      img.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  SaaS.clearLogo = function () { delete XU.settings().logo; XU.save(); XU.toast('Logo removed — using emoji'); XU.rerender(); };
  SaaS.saveSettings = function (e) {
    if (e) e.preventDefault();
    var f = document.getElementById('ex-settings'), s = XU.settings(), st = XU.st();
    var v = function (n) { return String(XU.val(f, n)).trim(); };
    var gstin = v('gstin').toUpperCase(), sub = v('subdomain').toLowerCase();
    if (!v('storeName')) { XU.toast('Store name is required', 'error'); return false; }
    if (!/^[a-z0-9-]{3,30}$/.test(sub)) { XU.toast('Subdomain: 3–30 lowercase letters, numbers or hyphens', 'error'); return false; }
    if (tenants().some(function (t) { return t.id !== (st.tenant || {}).id && subdomainOf(t) === sub + '.shopmint.in'; })) { XU.toast(sub + '.shopmint.in is already taken', 'error'); return false; }
    if (gstin && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) { XU.toast('GSTIN format looks invalid (e.g. 27AAGCD4821M1Z3)', 'error'); return false; }
    var payments = { upi: XU.val(f, 'pay_upi'), card: XU.val(f, 'pay_card'), netbanking: XU.val(f, 'pay_netbanking'), cod: XU.val(f, 'pay_cod') };
    if (!payments.upi && !payments.card && !payments.netbanking && !payments.cod) { XU.toast('Enable at least one payment method', 'error'); return false; }
    var ship = [];
    f.querySelectorAll('#ex-ship-rows tr').forEach(function (tr, i) {
      var q = function (n) { return tr.querySelector('[name=' + n + ']'); };
      var name = q('sname').value.trim(); if (!name) return;
      ship.push({ id: q('sid').value || name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + i, name: name, days: q('sdays').value.trim(),
        rate: Number(q('srate').value) || 0, freeAbove: Number(q('sfree').value) || 0, active: q('sactive').checked });
    });
    if (!ship.some(function (m) { return m.active; })) { XU.toast('Keep at least one shipping option active', 'error'); return false; }
    ['storeName', 'tagline', 'logoEmoji', 'brandColor', 'email', 'phone', 'legalName', 'state', 'address', 'currency'].forEach(function (k) { s[k] = v(k); });
    if (curPlanId() !== 'basic') s.customDomain = v('customDomain');
    s.gstin = gstin; s.subdomain = sub;
    if (App.data && App.data.stateCodes && App.data.stateCodes[s.state]) s.stateCode = App.data.stateCodes[s.state];
    s.pricesIncludeGst = v('pricesIncludeGst') === '1';
    s.lowStockThreshold = Math.max(0, Number(v('lowStockThreshold')) || 0);
    s.codFee = Number(v('codFee')) || 0; s.codLimit = Number(v('codLimit')) || 0;
    s.payments = payments; s.shipping = ship;
    if (SaaS._logo) { s.logo = SaaS._logo; SaaS._logo = null; }
    if (st.tenant) { st.tenant.subdomain = sub; st.tenant.name = s.storeName; }
    tenants().forEach(function (t) { if (st.tenant && t.id === st.tenant.id) { t.name = s.storeName; t.subdomain = sub + '.shopmint.in'; } });
    if (window.ERP) ERP.threshold = null;
    XU.save(); XU.toast('Settings saved', 'success'); XU.rerender();
    return false;
  };

  /* ---------------- Stores (tenants) ---------------- */
  var statsCache = {};
  function tenantStats(t) {
    var st = XU.st();
    var data = st.tenant && st.tenant.id === t.id ? st : null;
    if (!data) {
      if (!statsCache[t.id] && App.data && App.data.seed) { try { statsCache[t.id] = App.data.seed(t.id); } catch (e) { statsCache[t.id] = null; } }
      data = statsCache[t.id];
    }
    if (!data) return null;
    var cutoff = Date.now() - 30 * 864e5, rev = 0, n = 0;
    (data.orders || []).forEach(function (o) {
      if (new Date(o.date).getTime() >= cutoff && !/return|cancel/i.test(o.status || '')) { rev += Number(o.total) || 0; n++; }
    });
    return { products: (data.products || []).length, customers: (data.customers || []).length, orders: n, revenue: rev, staff: (data.staff || []).length };
  }
  function renderStores() {
    var st = XU.st(), curId = (st.tenant || {}).id, cp = plan(curPlanId());
    var cards = tenants().map(function (t) {
      var isCur = t.id === curId, s = tenantStats(t), tp = plan(t.plan);
      return '<div class="ex-card ex-plan' + (isCur ? ' cur' : '') + '" style="margin:0">' +
        '<div class="ex-bar" style="gap:12px;margin-bottom:12px"><span class="ex-thumb" style="width:48px;height:48px;font-size:26px;background:' + XU.esc(t.color || '#4f46e5') + '22">' + XU.esc(t.emoji || '🛍️') + '</span>' +
        '<div style="flex:1"><b style="font-size:16px">' + XU.esc(t.name) + '</b><div class="ex-muted ex-small">🔒 ' + XU.esc(subdomainOf(t)) + '</div></div>' +
        (isCur ? XU.badge('Current', 'purple') : '') + '</div>' +
        '<div class="ex-bar ex-small" style="margin-bottom:10px">' + XU.badge(tp.name + ' plan', tp.id === 'enterprise' ? 'purple' : tp.id === 'pro' ? 'blue' : 'grey') + XU.badge('Live', 'green') + '</div>' +
        (s ? '<table class="ex-table ex-small"><tbody>' +
          '<tr><td>Revenue (30 days)</td><td class="ex-r"><b>' + XU.inr(s.revenue) + '</b></td></tr>' +
          '<tr><td>Orders (30 days)</td><td class="ex-r">' + XU.num(s.orders) + '</td></tr>' +
          '<tr><td>Products</td><td class="ex-r">' + XU.num(s.products) + '</td></tr>' +
          '<tr><td>Customers</td><td class="ex-r">' + XU.num(s.customers) + '</td></tr>' +
          '<tr><td>Team</td><td class="ex-r">' + XU.num(s.staff) + '</td></tr></tbody></table>' : '') +
        '<div class="ex-bar" style="margin-top:12px">' +
        (isCur ? '<a class="ex-btn" href="#/admin">Open dashboard</a><a class="ex-btn" href="#/">View storefront</a>'
          : '<button class="ex-btn ex-primary" onclick="SaaS.switchStore(\'' + t.id + '\')">Switch to this store</button>') + '</div></div>';
    }).join('');
    var maxStores = limitNum(cp.limits.stores);
    return '<div class="ex-page">' + XU.head('Stores', tenants().length + ' stores on your ShopMint account · each store has its own catalogue, orders, inventory and settings',
      '<button class="ex-btn ex-primary" onclick="SaaS.newStore()">＋ Create store</button>') +
      '<div class="ex-grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">' + cards + '</div>' +
      '<div class="ex-card ex-small ex-muted">Your ' + XU.esc(cp.name) + ' plan includes up to ' + XU.esc(cp.limits.stores) + ' store(s). ' +
      (tenants().length >= maxStores ? 'You have reached your limit — <a href="#/admin/billing">upgrade</a> to add more stores.' : (maxStores - tenants().length) + ' more store(s) available.') + '</div></div>';
  }
  SaaS.switchStore = function (id) {
    var t = tenants().filter(function (x) { return x.id === id; })[0];
    App.store.switchTenant(id);
    XU.toast('Switched to ' + (t ? t.name : id), 'success');
  };
  SaaS.newStore = function () {
    var cp = plan(curPlanId());
    if (tenants().length >= limitNum(cp.limits.stores)) {
      XU.modal({
        title: 'Store limit reached', saveLabel: 'View plans',
        body: '<p>Your <b>' + XU.esc(cp.name) + '</b> plan allows ' + XU.esc(cp.limits.stores) + ' store(s) and you already have ' + tenants().length + '.</p><p class="ex-muted ex-small">Enterprise supports up to 5 stores with shared inventory and consolidated reports.</p>',
        onSave: function () { XU.closeModal(); XU.go('#/admin/billing'); }
      });
      return;
    }
    XU.modal({
      title: 'Create a new store', saveLabel: 'Request store',
      body: '<div class="ex-form"><label class="ex-full">Store name<input name="name" required placeholder="e.g. Desi Threads Kids"></label>' +
        '<label class="ex-full">Subdomain<input name="sub" placeholder="desithreadskids" pattern="[a-z0-9-]{3,30}"></label></div>' +
        '<p class="ex-muted ex-small">New stores are provisioned within a few minutes with a starter theme. You\'ll get an email when it\'s ready.</p>',
      onSave: function (f) {
        if (!XU.val(f, 'name').trim()) { XU.toast('Store name is required', 'error'); return false; }
        XU.closeModal(); XU.toast('Provisioning ' + XU.val(f, 'name').trim() + ' — we\'ll email you when it\'s live', 'success');
      }
    });
  };

  function init() {
    XU.route('#/admin/billing', renderBilling, OWNER);
    XU.route('#/admin/settings', renderSettings, OWNER);
    XU.route('#/admin/stores', renderStores, ['Owner', 'Manager']);
    XU.nav('#/admin/stores', 'Stores', '🏬', 'SaaS', ['Owner', 'Manager']);
    XU.nav('#/admin/billing', 'Plans & Billing', '💎', 'SaaS', OWNER);
    XU.nav('#/admin/settings', 'Store Settings', '⚙️', 'SaaS', OWNER);
  }
  if (window.XU && window.XU.route && window.App && App.router && App.adminNav) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
