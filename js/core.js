/* ShopMint demo — core: formatting, state store, UI helpers, router + layouts.
 * Shared by storefront.js, admin.js, erp.js, reports.js, saas.js. Classic script, no modules. */
(function (A) {
  'use strict';
  var DAY = 864e5;
  var LS = 'shopmint.v1.';

  /* ================= Formatting ================= */
  var inrFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
  var inr2Fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  var dtFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

  A.fmt = {
    inr: function (n) { n = Number(n) || 0; return (n < 0 ? '-₹' : '₹') + inrFmt.format(Math.abs(Math.round(n))); },
    inr2: function (n) { n = Number(n) || 0; return (n < 0 ? '-₹' : '₹') + inr2Fmt.format(Math.abs(n)); },
    num: function (n) { return inrFmt.format(Number(n) || 0); },
    date: function (d) { return d ? dateFmt.format(new Date(d)) : '—'; },
    dateTime: function (d) { return d ? dtFmt.format(new Date(d)) : '—'; },
    pct: function (n) { return (Math.round((Number(n) || 0) * 10) / 10) + '%'; },
    ymd: function (d) { var x = new Date(d || Date.now()); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
  };

  /* ================= Store ================= */
  var S = A.store = {
    tenants: A.data.tenants,
    session: null
  };

  function readLS(key) { try { var v = localStorage.getItem(LS + key); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function writeLS(key, val) { try { localStorage.setItem(LS + key, JSON.stringify(val)); } catch (e) { /* storage full or blocked: demo keeps running in memory */ } }

  S.saveSession = function () { writeLS('session', S.session); };
  S.session = readLS('session') || { tenantId: A.data.tenants[0].id, carts: {}, customers: {} };

  function linkUser() {
    var st = A.state;
    st.currentUser = st.staff.filter(function (u) { return u.id === st.currentUserId; })[0] || st.staff[0];
  }

  S.load = function (tid) {
    if (!A.data.tenants.some(function (t) { return t.id === tid; })) tid = A.data.tenants[0].id;
    var st = readLS('t.' + tid);
    if (!st || st.version !== 1) { st = A.data.seed(tid); }
    A.state = st;
    S.session.tenantId = tid;
    S.saveSession();
    linkUser();
    S.save();
    return st;
  };

  S.save = function () {
    var st = A.state;
    st.products.forEach(S.recalc);
    var copy = Object.assign({}, st);
    delete copy.currentUser;
    writeLS('t.' + st.tenant.id, copy);
  };

  S.reset = function () {
    var tid = A.state.tenant.id;
    try { localStorage.removeItem(LS + 't.' + tid); } catch (e) { /* ignore */ }
    S.session.carts[tid] = [];
    S.session.customers[tid] = null;
    S.saveSession();
    S.load(tid);
  };

  S.switchTenant = function (tid) {
    S.load(tid);
    var h = location.hash || '#/';
    var parts = h.split('?')[0].split('/');
    var target = parts[1] === 'admin' ? parts.slice(0, 3).join('/') : '#/';
    if (target === h) A.router.refresh(); else location.hash = target;
  };

  S.setCurrentUser = function (uid) {
    A.state.currentUserId = uid;
    linkUser();
    S.save();
  };

  var uidCounter = 0;
  S.uid = function (prefix) { return (prefix || 'id') + Date.now().toString(36) + (uidCounter++).toString(36); };

  /* ---- lookups ---- */
  function finder(coll) { return function (id) { var a = A.state[coll]; for (var i = 0; i < a.length; i++) if (a[i].id === id) return a[i]; return null; }; }
  S.product = finder('products');
  S.category = finder('categories');
  S.customer = finder('customers');
  S.order = finder('orders');
  S.warehouse = finder('warehouses');
  S.supplier = finder('suppliers');
  S.coupon = function (code) { code = String(code || '').trim().toUpperCase(); return A.state.coupons.filter(function (c) { return c.code === code; })[0] || null; };
  S.role = function () { return A.state.currentUser ? A.state.currentUser.role : 'Staff'; };
  S.can = function (roles) { return !roles || roles.indexOf(S.role()) >= 0; };

  /* ---- dates ---- */
  S.withinDays = function (d, days) { return new Date(d).getTime() >= Date.now() - days * DAY; };
  S.between = function (d, from, to) { // from/to: 'YYYY-MM-DD' (inclusive), either may be empty
    var t = new Date(d).getTime();
    if (from && t < new Date(from + 'T00:00:00').getTime()) return false;
    if (to && t > new Date(to + 'T23:59:59').getTime()) return false;
    return true;
  };

  /* ---- stock ---- */
  S.recalc = function (p) {
    if (!p.stockByWh) p.stockByWh = {};
    var keys = Object.keys(p.stockByWh);
    if (!keys.length) { p.stockByWh[A.state.warehouses[0].id] = Number(p.stock) || 0; keys = Object.keys(p.stockByWh); }
    p.stock = keys.reduce(function (s, k) { return s + (Number(p.stockByWh[k]) || 0); }, 0);
    return p.stock;
  };
  S.isLow = function (p) { return p.stock > 0 && p.stock <= (A.state.settings.lowStockThreshold || 10); };

  /** Adjust one warehouse's stock by delta (clamped at 0), log the move, save. */
  S.adjustStock = function (productId, whId, delta, reason) {
    var p = S.product(productId); if (!p) return;
    var cur = Number(p.stockByWh[whId]) || 0;
    var next = Math.max(0, cur + Number(delta));
    p.stockByWh[whId] = next;
    S.recalc(p);
    (A.state.stockMoves = A.state.stockMoves || []).unshift({ id: S.uid('sm'), date: new Date().toISOString(), productId: productId, whId: whId,
      delta: next - cur, reason: reason || 'Manual adjustment', by: A.state.currentUser ? A.state.currentUser.name : '' });
    S.save();
  };

  /** Set a product's total stock; the difference lands in (or comes out of) warehouses by largest holding. */
  S.setStock = function (p, total) {
    S.recalc(p);
    var delta = (Number(total) || 0) - p.stock;
    var whs = Object.keys(p.stockByWh).sort(function (a, b) { return p.stockByWh[b] - p.stockByWh[a]; });
    if (delta > 0) p.stockByWh[whs[0]] += delta;
    for (var i = 0; delta < 0 && i < whs.length; i++) {
      var take = Math.min(p.stockByWh[whs[i]], -delta);
      p.stockByWh[whs[i]] -= take; delta += take;
    }
    S.recalc(p);
  };

  /* ---- pricing (prices are GST-inclusive) ---- */
  S.validateCoupon = function (code, subtotal) {
    if (!code) return { ok: false, discount: 0, msg: '' };
    var c = S.coupon(code);
    if (!c) return { ok: false, discount: 0, msg: 'Invalid coupon code' };
    if (!c.active) return { ok: false, discount: 0, msg: 'This coupon is no longer active' };
    if (c.expiry && c.expiry < A.fmt.ymd()) return { ok: false, discount: 0, msg: 'This coupon expired on ' + A.fmt.date(c.expiry) };
    if (subtotal < (c.minOrder || 0)) return { ok: false, discount: 0, msg: 'Add ' + A.fmt.inr(c.minOrder - subtotal) + ' more to use ' + c.code };
    var d = c.type === 'percent' ? Math.round(subtotal * c.value / 100) : Number(c.value);
    if (c.type === 'percent' && c.maxDiscount) d = Math.min(d, c.maxDiscount);
    d = Math.min(d, subtotal);
    return { ok: true, coupon: c, discount: d, msg: c.code + ' applied — you save ' + A.fmt.inr(d) };
  };

  /** items: [{productId, qty, price, gst}] */
  S.totals = function (items, couponCode, shippingId, payment) {
    var set = A.state.settings;
    var subtotal = items.reduce(function (s, it) { return s + it.price * it.qty; }, 0);
    var cv = S.validateCoupon(couponCode, subtotal);
    var discount = cv.ok ? cv.discount : 0;
    var ship = set.shipping.filter(function (m) { return m.id === shippingId && m.active; })[0] || set.shipping.filter(function (m) { return m.active; })[0];
    var shipping = !ship || !items.length ? 0 : (ship.freeAbove && subtotal - discount >= ship.freeAbove ? 0 : ship.rate);
    var codFee = payment === 'COD' ? (set.codFee || 0) : 0;
    var ratio = subtotal ? (subtotal - discount) / subtotal : 1;
    var tax = items.reduce(function (s, it) { var g = it.gst || 0; return s + it.price * it.qty * ratio * g / (100 + g); }, 0);
    return { subtotal: subtotal, discount: discount, coupon: cv.ok ? cv.coupon.code : '', couponMsg: cv.msg, couponOk: cv.ok,
      shipping: shipping, shippingMethod: ship ? ship.id : '', codFee: codFee, tax: Math.round(tax * 100) / 100, total: subtotal - discount + shipping + codFee };
  };

  /** GST breakdown for invoices: CGST+SGST when buyer state == seller state, else IGST. */
  S.gstSplit = function (o) {
    var intra = (o.address && o.address.state) === A.state.settings.state;
    var ratio = o.subtotal ? (o.subtotal - (o.discount || 0)) / o.subtotal : 1;
    var lines = o.items.map(function (it) {
      var g = it.gst || 0, gross = it.price * it.qty * ratio;
      var taxable = gross * 100 / (100 + g), tax = gross - taxable;
      return { item: it, hsn: it.hsn, rate: g, gross: gross, taxable: taxable, tax: tax,
        cgst: intra ? tax / 2 : 0, sgst: intra ? tax / 2 : 0, igst: intra ? 0 : tax };
    });
    var sum = function (k) { return lines.reduce(function (s, l) { return s + l[k]; }, 0); };
    return { intra: intra, lines: lines, taxable: sum('taxable'), tax: sum('tax'), cgst: sum('cgst'), sgst: sum('sgst'), igst: sum('igst') };
  };

  /** Net revenue (ex-GST, after discount; excludes shipping/COD fees) and cost/profit of an order. Returned orders count as 0. */
  S.orderNet = function (o) { return o.status === 'returned' ? 0 : (o.subtotal - (o.discount || 0)) - (o.tax || 0); };
  S.orderCost = function (o) {
    if (o.status === 'returned') return 0;
    return o.items.reduce(function (s, it) { var p = S.product(it.productId); return s + (it.cost != null ? it.cost : (p ? p.cost : 0)) * it.qty; }, 0);
  };
  S.orderProfit = function (o) { return S.orderNet(o) - S.orderCost(o); };

  /* ---- storefront session: cart + logged-in customer (per tenant) ---- */
  S.cart = function () { var t = A.state.tenant.id; return S.session.carts[t] || (S.session.carts[t] = []); };
  S.cartCount = function () { return S.cart().reduce(function (s, l) { return s + l.qty; }, 0); };
  S.addToCart = function (productId, qty, variant) {
    var cart = S.cart(), p = S.product(productId);
    if (!p) return false;
    var line = cart.filter(function (l) { return l.productId === productId && l.variant === (variant || ''); })[0];
    var inCart = cart.filter(function (l) { return l.productId === productId; }).reduce(function (s, l) { return s + l.qty; }, 0);
    if (inCart + qty > p.stock) return false;
    if (line) line.qty += qty; else cart.push({ productId: productId, qty: qty, variant: variant || '' });
    S.saveSession();
    return true;
  };
  S.cartLines = function () { // resolved lines, dropping products that no longer exist
    return S.cart().map(function (l, i) { var p = S.product(l.productId); return p ? { idx: i, p: p, qty: l.qty, variant: l.variant, productId: p.id, price: p.price, gst: p.gst } : null; }).filter(Boolean);
  };
  S.currentCustomer = function () { var id = S.session.customers[A.state.tenant.id]; return id ? S.customer(id) : null; };
  S.loginCustomer = function (c) { S.session.customers[A.state.tenant.id] = c ? c.id : null; S.saveSession(); };

  /** Create an order from the cart. data: {address:{name,line,city,state,pincode,phone}, email, couponCode, shippingId, payment} */
  S.placeOrder = function (data) {
    var st = A.state, lines = S.cartLines();
    if (!lines.length) throw new Error('Your cart is empty');
    lines.forEach(function (l) { if (l.qty > l.p.stock) throw new Error(l.p.name + ' has only ' + l.p.stock + ' left in stock'); });
    var t = S.totals(lines, data.couponCode, data.shippingId, data.payment);

    var cust = S.currentCustomer() || st.customers.filter(function (c) { return c.email.toLowerCase() === String(data.email).toLowerCase(); })[0];
    if (!cust) {
      cust = { id: S.uid('c'), name: data.address.name, email: data.email, phone: data.address.phone, line: data.address.line,
        city: data.address.city, state: data.address.state, pincode: data.address.pincode, joined: new Date().toISOString(), notes: 'Signed up at checkout' };
      st.customers.unshift(cust);
    }
    S.loginCustomer(cust);

    // Fulfil from the warehouse holding the most of the first item, spilling over as needed
    var mainWh = Object.keys(lines[0].p.stockByWh).sort(function (a, b) { return lines[0].p.stockByWh[b] - lines[0].p.stockByWh[a]; })[0];
    lines.forEach(function (l) {
      var need = l.qty, p = l.p;
      var whs = Object.keys(p.stockByWh).sort(function (a, b) { return (b === mainWh) - (a === mainWh) || p.stockByWh[b] - p.stockByWh[a]; });
      whs.forEach(function (w) { var take = Math.min(need, p.stockByWh[w]); p.stockByWh[w] -= take; need -= take; });
      S.recalc(p);
    });
    if (t.coupon) { var c = S.coupon(t.coupon); if (c) c.uses = (c.uses || 0) + 1; }

    var maxNo = st.orders.reduce(function (m, o) { var n = parseInt(String(o.id).replace(/\D/g, ''), 10); return n > m ? n : m; }, 10230);
    var prefix = String(st.orders[0] ? st.orders[0].id : 'SM').replace(/\d+$/, '');
    var now = new Date().toISOString();
    var order = {
      id: prefix + (maxNo + 1), date: now, customerId: cust.id,
      items: lines.map(function (l) { return { productId: l.p.id, name: l.p.name, sku: l.p.sku, hsn: l.p.hsn, gst: l.p.gst, qty: l.qty, price: l.p.price, cost: l.p.cost, variant: l.variant }; }),
      subtotal: t.subtotal, discount: t.discount, coupon: t.coupon, shipping: t.shipping, shippingMethod: t.shippingMethod,
      codFee: t.codFee, tax: t.tax, total: t.total, status: 'pending', payment: data.payment,
      paymentStatus: data.payment === 'COD' ? 'Pending' : 'Paid',
      address: data.address, email: data.email, warehouseId: mainWh,
      history: [{ status: 'pending', at: now, note: 'Order placed on storefront' }]
    };
    st.orders.unshift(order);
    S.session.carts[st.tenant.id] = [];
    S.saveSession();
    S.save();
    return order;
  };

  /** Move an order along pending → shipped → delivered → returned. Returns restock inventory. */
  S.setOrderStatus = function (orderId, status, note) {
    var o = S.order(orderId); if (!o || o.status === status) return o;
    if (status === 'returned' && o.status !== 'returned') {
      o.items.forEach(function (it) { var p = S.product(it.productId); if (p) { p.stockByWh[o.warehouseId] = (p.stockByWh[o.warehouseId] || 0) + it.qty; S.recalc(p); } });
      o.paymentStatus = 'Refunded';
    }
    if (status === 'delivered' && o.payment === 'COD') o.paymentStatus = 'Paid';
    o.status = status;
    (o.history = o.history || []).push({ status: status, at: new Date().toISOString(), note: note || ('Marked ' + status + ' by ' + (A.state.currentUser ? A.state.currentUser.name : 'admin')) });
    S.save();
    return o;
  };

  /* ================= UI helpers ================= */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function esc(s) { return s == null ? '' : String(s).replace(/[&<>"']/g, function (c) { return ESC[c]; }); }

  var BADGE_AUTO = {
    pending: 'warning', shipped: 'info', delivered: 'success', returned: 'danger', ordered: 'info', received: 'success',
    paid: 'success', refunded: 'muted', active: 'success', inactive: 'muted', expired: 'muted', 'out of stock': 'danger',
    'low stock': 'warning', 'in stock': 'success', owner: 'info', manager: 'success', staff: 'muted'
  };

  var charts = [];

  A.ui = {
    esc: esc,

    badge: function (text, kind) {
      kind = kind || BADGE_AUTO[String(text).toLowerCase()] || 'muted';
      return '<span class="badge badge-' + kind + '">' + esc(text) + '</span>';
    },

    kpi: function (label, value, sub, kind) {
      return '<div class="card kpi' + (kind ? ' kpi-' + kind : '') + '"><div class="kpi-label">' + esc(label) + '</div><div class="kpi-value">' + value + '</div>' +
        (sub ? '<div class="kpi-sub">' + sub + '</div>' : '') + '</div>';
    },

    /** columns: [{label, key | render(row) -> html, cls, align:'right'}]; rows: array. Cell values from `key` are escaped; render() output is raw html. */
    table: function (columns, rows, opts) {
      opts = opts || {};
      var th = columns.map(function (c) { return '<th' + (c.align === 'right' ? ' class="r"' : '') + '>' + esc(c.label) + '</th>'; }).join('');
      var body = rows.length ? rows.map(function (r) {
        return '<tr' + (opts.rowAttr ? ' ' + opts.rowAttr(r) : '') + '>' + columns.map(function (c) {
          var v = c.render ? c.render(r) : esc(r[c.key]);
          return '<td' + (c.align === 'right' || c.cls ? ' class="' + (c.align === 'right' ? 'r ' : '') + (c.cls || '') + '"' : '') + ' data-label="' + esc(c.label) + '">' + (v == null ? '' : v) + '</td>';
        }).join('') + '</tr>';
      }).join('') : '<tr><td colspan="' + columns.length + '" class="empty-row">' + esc(opts.empty || 'No records match the current filters.') + '</td></tr>';
      return '<div class="table-wrap"><table class="table"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
    },

    toast: function (msg, type) {
      var box = document.getElementById('toasts');
      var el = document.createElement('div');
      el.className = 'toast toast-' + (type || 'success');
      el.textContent = msg;
      box.appendChild(el);
      setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 250); }, 2600);
    },

    /** opts: {title, body (html), onSave(formEl) -> false keeps it open, saveLabel, wide, hideSave, cancelLabel} */
    modal: function (opts) {
      A.ui.closeModal();
      var root = document.getElementById('modal-root');
      root.innerHTML = '<div class="modal-overlay"><form class="modal' + (opts.wide ? ' modal-wide' : '') + '" novalidate autocomplete="off">' +
        '<div class="modal-head"><h3>' + esc(opts.title || '') + '</h3><button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>' +
        '<div class="modal-body">' + (opts.body || '') + '</div>' +
        '<div class="modal-foot"><button type="button" class="btn" data-close>' + esc(opts.cancelLabel || (opts.hideSave ? 'Close' : 'Cancel')) + '</button>' +
        (opts.hideSave ? '' : '<button type="submit" class="btn btn-primary">' + esc(opts.saveLabel || 'Save') + '</button>') + '</div></form></div>';
      var form = root.querySelector('form');
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        if (!opts.onSave) { A.ui.closeModal(); return; }
        if (opts.onSave(form) !== false) A.ui.closeModal();
      });
      root.querySelector('.modal-overlay').addEventListener('mousedown', function (e) { if (e.target === e.currentTarget) A.ui.closeModal(); });
      root.querySelectorAll('[data-close]').forEach(function (b) { b.addEventListener('click', A.ui.closeModal); });
      var first = form.querySelector('.modal-body input, .modal-body select, .modal-body textarea');
      if (first) setTimeout(function () { first.focus(); }, 30);
      document.body.classList.add('modal-open');
      return form;
    },

    closeModal: function () {
      var root = document.getElementById('modal-root');
      if (root && root.firstChild) root.innerHTML = '';
      document.body.classList.remove('modal-open');
    },

    /** Read all named fields of a form into an object (checkboxes -> boolean, type=number -> Number). */
    formData: function (form) {
      var o = {};
      Array.prototype.forEach.call(form.elements, function (el) {
        if (!el.name) return;
        if (el.type === 'checkbox') o[el.name] = el.checked;
        else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
        else if (el.type === 'number') o[el.name] = el.value === '' ? '' : Number(el.value);
        else o[el.name] = el.value.trim();
      });
      return o;
    },

    /** rows: array of arrays (first row = header) or array of objects (keys = header). */
    csv: function (filename, rows) {
      if (rows.length && !Array.isArray(rows[0])) {
        var keys = Object.keys(rows[0]);
        rows = [keys].concat(rows.map(function (r) { return keys.map(function (k) { return r[k]; }); }));
      }
      var text = rows.map(function (r) {
        return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',');
      }).join('\r\n');
      var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = /\.csv$/i.test(filename) ? filename : filename + '.csv';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
      A.ui.toast('Exported ' + a.download);
    },

    /** PDF export via jsPDF + autotable (₹ rendered as "Rs." since PDF core fonts lack the glyph); falls back to print. */
    pdf: function (title, head, rows, subtitle) {
      var clean = function (v) { return v == null ? '' : String(v).replace(/₹/g, 'Rs. ').replace(/[^\x00-\x7F]/g, function (c) { return c === '–' || c === '—' ? '-' : c === '•' ? '*' : ''; }); };
      var store = A.state.settings.storeName;
      if (window.jspdf && window.jspdf.jsPDF) {
        var doc = new window.jspdf.jsPDF({ orientation: head.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
        if (typeof doc.autoTable === 'function') {
          doc.setFontSize(15); doc.text(clean(store + ' - ' + title), 40, 44);
          doc.setFontSize(9); doc.setTextColor(110);
          doc.text(clean((subtitle ? subtitle + '  |  ' : '') + 'Generated ' + A.fmt.dateTime(new Date()) + '  |  ' + A.state.tenant.subdomain + '.shopmint.in'), 40, 60);
          doc.autoTable({ head: [head.map(clean)], body: rows.map(function (r) { return r.map(clean); }), startY: 74,
            styles: { fontSize: 8, cellPadding: 4 }, headStyles: { fillColor: [79, 70, 229] }, alternateRowStyles: { fillColor: [246, 247, 251] } });
          doc.save(title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.pdf');
          A.ui.toast('Exported PDF');
          return;
        }
      }
      A.ui.printHtml(title, '<p class="muted">' + esc(subtitle || '') + '</p><table><thead><tr>' + head.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') +
        '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + r.map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>');
    },

    /** Print arbitrary html in an isolated iframe (used for invoices and PDF fallback). */
    printHtml: function (title, html) {
      var f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
      document.body.appendChild(f);
      var d = f.contentWindow.document;
      d.open();
      d.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' +
        'body{font:12px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:24px}h1{font-size:18px;margin:0 0 4px}' +
        'table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:left}' +
        'th{background:#f3f4f6}.r{text-align:right}.muted{color:#666}.grid2{display:flex;gap:24px;justify-content:space-between}' +
        '</style></head><body><h1>' + esc(A.state.settings.storeName + ' — ' + title) + '</h1>' + html + '</body></html>');
      d.close();
      setTimeout(function () { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(function () { f.remove(); }, 1500); }, 150);
    },

    productThumb: function (p, size) {
      var cat = p && S.category(p.categoryId);
      var color = (p && p.color) || (cat && cat.color) || '#6366f1';
      var emoji = (p && p.emoji) || (cat && cat.emoji) || '📦';
      return '<div class="thumb thumb-' + (size || 'md') + '" style="--c:' + esc(color) + '" aria-hidden="true"><span>' + esc(emoji) + '</span></div>';
    },

    stockBadge: function (p) {
      if (p.stock <= 0) return A.ui.badge('Out of stock', 'danger');
      if (S.isLow(p)) return A.ui.badge('Low stock · ' + p.stock, 'warning');
      return A.ui.badge('In stock · ' + p.stock, 'success');
    },

    /** Series colours for charts (fixed order — assign by entity, never by rank). */
    palette: ['#4f46e5', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444', '#64748b'],
    statusColors: { pending: '#f59e0b', shipped: '#0ea5e9', delivered: '#10b981', returned: '#ef4444' },

    /** Create a Chart.js chart on a canvas id/element; tracked and destroyed on the next route render. Safe if Chart.js failed to load. */
    chart: function (canvas, config) {
      var el = typeof canvas === 'string' ? document.getElementById(canvas) : canvas;
      if (!el) return null;
      if (typeof window.Chart === 'undefined') {
        el.outerHTML = '<div class="chart-fallback">Charts need an internet connection (Chart.js loads from cdnjs).</div>';
        return null;
      }
      var c = new window.Chart(el, config);
      charts.push(c);
      return c;
    },
    destroyCharts: function () { while (charts.length) { try { charts.pop().destroy(); } catch (e) { /* ignore */ } } },

    /** Date-range filter toolbar used by admin pages: returns html for 7/30/90 day pills. */
    rangePills: function (current, action) {
      return '<div class="pills">' + [7, 30, 90].map(function (d) {
        return '<button type="button" class="pill' + (d === current ? ' on' : '') + '" data-action="' + action + '" data-days="' + d + '">' + d + ' days</button>';
      }).join('') + '</div>';
    }
  };

  /* ================= Router + layouts ================= */
  A.adminNav = [];     // [{hash, label, icon, group, roles}] — other modules push into this
  A.onRender = [];     // callbacks run once after the current route's html is inserted, then cleared
  A.actions = {};      // delegated handlers: <el data-action="name"> click, <el data-change="name"> change, <form data-submit="name">
  A.adminGroups = ['Overview', 'Catalog', 'Sales', 'ERP', 'Accounting', 'Reports', 'SaaS'];

  var routes = [];
  var current = null;

  function parseHash(h) {
    h = (h || location.hash || '#/').replace(/^#/, '');
    if (!h || h[0] !== '/') h = '/' + h;
    var q = {}, qi = h.indexOf('?');
    if (qi >= 0) {
      h.slice(qi + 1).split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); q[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); });
      h = h.slice(0, qi);
    }
    return { path: h.replace(/\/+$/, '') || '/', query: q };
  }

  var R = A.router = {
    register: function (pattern, fn, opts) {
      var path = String(pattern).replace(/^#/, '').replace(/\/+$/, '') || '/';
      routes.push({ parts: path.split('/'), fn: fn, layout: (opts && opts.layout) || (path.indexOf('/admin') === 0 ? 'admin' : 'shop'), title: opts && opts.title });
    },
    go: function (hash) { if (location.hash === hash) R.refresh(); else location.hash = hash; },
    refresh: function () { render(false); },
    current: function () { return current; },
    start: function () {
      window.addEventListener('hashchange', function () { render(true); });
      render(true);
    }
  };

  function match(path) {
    var segs = path.split('/');
    for (var i = 0; i < routes.length; i++) {
      var r = routes[i];
      if (r.parts.length !== segs.length) continue;
      var params = {}, ok = true;
      for (var j = 0; j < segs.length && ok; j++) {
        if (r.parts[j][0] === ':') params[r.parts[j].slice(1)] = decodeURIComponent(segs[j]);
        else if (r.parts[j] !== segs[j]) ok = false;
      }
      if (ok) return { route: r, params: params };
    }
    return null;
  }

  function navItemFor(path) {
    var best = null;
    A.adminNav.forEach(function (n) {
      var h = n.hash.replace(/^#/, '');
      if ((path === h || path.indexOf(h + '/') === 0) && (!best || h.length > best.hash.replace(/^#/, '').length)) best = n;
    });
    return best;
  }

  function render(isNav) {
    var h = parseHash();
    var m = match(h.path);
    var layout = m ? m.route.layout : (h.path.indexOf('/admin') === 0 ? 'admin' : 'shop');
    A.ui.destroyCharts();
    A.ui.closeModal();
    A.ui.applyTheme(A.state.settings.brandColor);
    var app = document.getElementById('app');
    var nav = layout === 'admin' ? navItemFor(h.path) : null;
    app.innerHTML = layout === 'admin' ? adminShell(h.path, nav) : shopShell(h.path, h.query);
    A.el = document.getElementById('content');
    current = { path: h.path, query: h.query, layout: layout, params: m ? m.params : {} };

    var html;
    if (!m) html = notFound(layout);
    else if (nav && !S.can(nav.roles)) html = restricted(nav);
    else {
      var params = Object.assign({ query: h.query }, m.params);
      try { html = m.route.fn(params); }
      catch (e) { console.error(e); html = '<div class="card empty"><h3>Something went wrong</h3><p class="muted">' + esc(e.message) + '</p></div>'; }
    }
    if (typeof html === 'string') A.el.innerHTML = html;
    var hooks = A.onRender.splice(0);
    hooks.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
    document.title = (layout === 'admin' ? (nav ? nav.label + ' · Admin' : 'Admin') : A.state.settings.storeName) + ' · ShopMint';
    if (isNav) window.scrollTo(0, 0);
  }

  function notFound(layout) {
    return '<div class="card empty"><div class="empty-icon">🧭</div><h3>Page not found</h3><p class="muted">This page doesn\'t exist in ' + esc(A.state.settings.storeName) + '.</p>' +
      '<a class="btn btn-primary" href="' + (layout === 'admin' ? '#/admin' : '#/') + '">Go home</a></div>';
  }
  function restricted(nav) {
    return '<div class="card empty"><div class="empty-icon">🔒</div><h3>Restricted: ' + esc(nav.label) + '</h3><p class="muted">Your role (' + esc(S.role()) +
      ') doesn\'t have access. Allowed: ' + esc((nav.roles || []).join(', ')) + '.</p><a class="btn btn-primary" href="#/admin">Back to dashboard</a></div>';
  }

  function tenantSelect(cls) {
    return '<select class="input ' + (cls || '') + '" data-change="switchTenant" aria-label="Switch store">' + A.data.tenants.map(function (t) {
      return '<option value="' + t.id + '"' + (t.id === A.state.tenant.id ? ' selected' : '') + '>' + esc(t.emoji + ' ' + t.name) + '</option>';
    }).join('') + '</select>';
  }

  function logoMark(set) {
    return set.logo ? '<img class="logo-mark logo-img" src="' + esc(set.logo) + '" alt="">'
      : '<span class="logo-mark" style="background:' + esc(set.brandColor) + '">' + esc(set.logoEmoji) + '</span>';
  }
  A.ui.logoMark = logoMark;

  function shopShell(path, query) {
    var st = A.state, set = st.settings, cust = S.currentCustomer(), n = S.cartCount();
    var cats = st.categories.map(function (c) {
      return '<a href="#/category/' + c.id + '" class="' + (path === '/category/' + c.id ? 'on' : '') + '">' + esc(c.emoji + ' ' + c.name) + '</a>';
    }).join('');
    return '<div class="platform-bar"><div class="wrap pb-inner">' +
      '<span class="pb-brand">◆ ShopMint <em>demo</em></span>' +
      '<span class="pb-url">🔒 ' + esc(st.tenant.subdomain) + '.shopmint.in</span>' +
      '<span class="pb-spacer"></span>' + tenantSelect('input-sm input-dark') +
      A.ui.themePicker() + '<div class="seg"><a href="#/" class="on">Storefront</a><a href="#/admin">Admin</a></div></div></div>' +
      '<header class="shop-header" style="--brand:' + esc(set.brandColor) + '"><div class="wrap sh-inner">' +
      '<a class="shop-logo" href="#/">' + logoMark(set) + '<span>' + esc(set.storeName) + '</span></a>' +
      '<form class="shop-search" data-submit="shopSearch" role="search"><input class="input" name="q" type="search" placeholder="Search kurtas, masalas, earbuds…" value="' +
      esc(path === '/shop' ? query.q || '' : '') + '" aria-label="Search products"><button class="btn btn-primary" type="submit">Search</button></form>' +
      '<nav class="shop-nav"><a href="#/shop">Shop all</a>' +
      (cust ? '<a href="#/account">👤 ' + esc(cust.name.split(' ')[0]) + '</a>' : '<a href="#/login">👤 Login</a>') +
      '<a href="#/cart" class="cart-link">🛒 Cart' + (n ? '<span class="cart-count">' + n + '</span>' : '') + '</a></nav></div>' +
      '<div class="cat-strip"><div class="wrap">' + cats + '</div></div></header>' +
      '<main class="wrap shop-main" id="content"></main>' +
      '<footer class="shop-footer"><div class="wrap"><div><strong>' + esc(set.storeName) + '</strong><br><span class="muted">' + esc(set.legalName) + ' · GSTIN ' + esc(set.gstin) + '</span></div>' +
      '<div class="muted">' + esc(set.email) + ' · ' + esc(set.phone) + '<br>Secure payments: ' +
      ['upi', 'card', 'cod'].filter(function (k) { return set.payments[k]; }).map(function (k) { return k === 'cod' ? 'COD' : k.toUpperCase(); }).join(' · ') +
      '</div><div class="muted">Powered by ◆ ShopMint</div></div></footer>';
  }

  function adminShell(path, active) {
    var st = A.state, set = st.settings, role = S.role();
    var groups = {};
    A.adminNav.forEach(function (n) { if (!S.can(n.roles)) return; (groups[n.group || 'Other'] = groups[n.group || 'Other'] || []).push(n); });
    var order = A.adminGroups.filter(function (g) { return groups[g]; }).concat(Object.keys(groups).filter(function (g) { return A.adminGroups.indexOf(g) < 0; }));
    var navHtml = order.map(function (g) {
      return '<div class="nav-group"><div class="nav-group-label">' + esc(g) + '</div>' + groups[g].map(function (n) {
        return '<a href="' + (n.hash[0] === '#' ? n.hash : '#' + n.hash) + '" class="nav-item' + (active === n ? ' on' : '') + '"><span class="nav-icon">' + (n.icon || '•') + '</span>' + esc(n.label) + '</a>';
      }).join('') + '</div>';
    }).join('');
    var users = st.staff.filter(function (u) { return u.active; }).map(function (u) {
      return '<option value="' + u.id + '"' + (u.id === st.currentUser.id ? ' selected' : '') + '>' + esc(u.name + ' · ' + u.role) + '</option>';
    }).join('');
    return '<div class="admin" id="admin">' +
      '<aside class="sidebar"><div class="sb-brand">' + logoMark(set) + 
      '<div><strong>' + esc(set.storeName) + '</strong><small>' + esc(st.tenant.subdomain) + '.shopmint.in</small></div></div>' +
      '<nav class="sb-nav">' + navHtml + '</nav>' +
      '<div class="sb-foot">◆ ShopMint · ' + esc(A.data.plans.filter(function (p) { return p.id === set.billing.plan; }).map(function (p) { return p.name; })[0] || '') + ' plan</div></aside>' +
      '<div class="sb-backdrop" data-action="toggleSidebar"></div>' +
      '<div class="admin-main"><header class="topbar">' +
      '<button class="icon-btn sb-toggle" data-action="toggleSidebar" aria-label="Menu">☰</button>' +
      '<h1 class="topbar-title">' + esc(active ? active.label : 'Admin') + '</h1><span class="pb-spacer"></span>' +
      '<div class="seg seg-light"><a href="#/">Storefront</a><a href="#/admin" class="on">Admin</a></div>' +
      tenantSelect('input-sm') +
      '<select class="input input-sm" data-change="switchUser" aria-label="Current user role" title="Switch user to preview role permissions">' + users + '</select>' +
      A.ui.themePicker() + '<span class="role-chip role-' + role.toLowerCase() + '">' + esc(role) + '</span>' +
      '</header><main class="content" id="content"></main></div></div>';
  }

  /* ---- delegated events ---- */
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var fn = A.actions[el.getAttribute('data-action')];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
  document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-change]');
    if (!el) return;
    var fn = A.actions[el.getAttribute('data-change')];
    if (fn) fn(el, e);
  });
  document.addEventListener('submit', function (e) {
    var el = e.target.closest('form[data-submit]');
    if (!el) return;
    e.preventDefault();
    var fn = A.actions[el.getAttribute('data-submit')];
    if (fn) fn(el, e);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') A.ui.closeModal(); });

  A.actions.switchTenant = function (el) {
    S.switchTenant(el.value);
    A.ui.toast('Switched to ' + A.state.settings.storeName);
  };
  A.actions.switchUser = function (el) {
    S.setCurrentUser(el.value);
    A.ui.toast('Now signed in as ' + A.state.currentUser.name + ' (' + A.state.currentUser.role + ')');
    R.refresh();
  };
  /* ---- colour theme: settings.brandColor drives --primary across storefront + admin ---- */
  A.ui.themes = [['Indigo', '#4f46e5'], ['Saffron', '#ea580c'], ['Emerald', '#059669'], ['Teal', '#0d9488'], ['Ocean', '#0369a1'],
    ['Royal', '#7c3aed'], ['Rani pink', '#db2777'], ['Maroon', '#9f1239'], ['Mustard', '#b45309'], ['Charcoal', '#334155']];
  function mix(hex, to, t) {
    var h = hex.replace('#', ''); if (h.length === 3) h = h.replace(/./g, '$&$&');
    var c = [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); });
    return '#' + c.map(function (v) { return ('0' + Math.round(v + (to - v) * t).toString(16)).slice(-2); }).join('');
  }
  A.ui.applyTheme = function (color) {
    color = /^#[0-9a-f]{3,6}$/i.test(color || '') ? color : '#4f46e5';
    var s = document.documentElement.style, h = color.replace('#', '');
    if (h.length === 3) h = h.replace(/./g, '$&$&');
    s.setProperty('--primary', color);
    s.setProperty('--brand', color);
    s.setProperty('--primary-600', mix(color, 0, .15));
    s.setProperty('--primary-soft', mix(color, 255, .9));
    s.setProperty('--primary-ring', 'rgba(' + [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16); }).join(',') + ',.25)');
  };
  A.ui.themePicker = function () {
    var cur = (A.state.settings.brandColor || '').toLowerCase();
    return '<details class="theme-pick"><summary class="icon-btn" title="Change website colour" aria-label="Change website colour">🎨</summary><div class="theme-pop">' +
      '<div class="theme-title">Website colour</div><div class="theme-swatches">' +
      A.ui.themes.map(function (t) {
        return '<button type="button" class="swatch' + (t[1] === cur ? ' on' : '') + '" style="background:' + t[1] + '" title="' + t[0] + '" data-action="setTheme" data-color="' + t[1] + '"></button>';
      }).join('') + '</div><label class="theme-custom">Custom <input type="color" value="' + esc(cur || '#4f46e5') + '" data-change="setThemeInput"></label></div></details>';
  };
  function setTheme(color) {
    A.state.settings.brandColor = color; S.save(); A.ui.applyTheme(color); R.refresh();
    A.ui.toast('Website colour updated');
  }
  A.actions.setTheme = function (el) { setTheme(el.getAttribute('data-color')); };
  A.actions.setThemeInput = function (el) { setTheme(el.value); };
  document.addEventListener('click', function (e) { // close the colour popover on outside click
    document.querySelectorAll('.theme-pick[open]').forEach(function (d) { if (!d.contains(e.target)) d.removeAttribute('open'); });
  });

  A.actions.toggleSidebar = function () { var a = document.getElementById('admin'); if (a) a.classList.toggle('sb-open'); };
  document.addEventListener('click', function (e) { // close mobile sidebar after picking an item
    if (e.target.closest('.sb-nav a')) { var a = document.getElementById('admin'); if (a) a.classList.remove('sb-open'); }
  });

  // Initial tenant load so every module can read App.state at registration time
  S.load(S.session.tenantId);
})(window.App);
