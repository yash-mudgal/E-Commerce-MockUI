/* ERP module: Inventory, Purchases, Suppliers, Invoicing, Accounting, Staff.
   Also defines window.XU - shared helpers used lazily by reports.js and saas.js. */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Shared helpers (window.XU)                                          */
  /* ------------------------------------------------------------------ */
  var XU = window.XU = window.XU || {};

  XU.st = function () { return App.state || {}; };
  XU.arr = function (key) {
    var s = XU.st();
    if (!Array.isArray(s[key])) s[key] = [];
    return s[key];
  };
  XU.esc = function (v) {
    if (App.ui && App.ui.esc) return App.ui.esc(v == null ? '' : v);
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  XU.num = function (n, d) {
    return Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
  };
  XU.inr = function (n) {
    if (App.fmt && App.fmt.inr) return App.fmt.inr(n);
    return '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  };
  XU.inr2 = function (n) {
    if (App.fmt && App.fmt.inr2) return App.fmt.inr2(n);
    return '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  XU.date = function (d) {
    if (!d) return '—';
    if (App.fmt && App.fmt.date) return App.fmt.date(d);
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  XU.iso = function (d) {
    d = d ? new Date(d) : new Date();
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (day < 10 ? '0' : '') + day;
  };
  XU.uid = function (p) {
    if (App.store && App.store.uid) return App.store.uid(p);
    return (p || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  };
  XU.me = function () {
    var s = XU.st();
    return s.currentUser || XU.arr('staff').filter(function (u) { return u.id === s.currentUserId; })[0] || {};
  };
  XU.role = function () { return XU.me().role || 'Owner'; };
  XU.can = function (roles) { return !roles || roles.indexOf(XU.role()) >= 0; };
  XU.denied = function (roles) {
    return '<div class="ex-card ex-empty"><div style="font-size:40px">🔒</div><h3>Access restricted</h3>' +
      '<p>This section is available to ' + roles.join(' / ') + ' only. You are signed in as <b>' + XU.esc(XU.role()) + '</b>.</p></div>';
  };
  XU.save = function () { if (App.store && App.store.save) App.store.save(); };
  XU.toast = function (m, type) {
    if (App.ui && App.ui.toast) App.ui.toast(m, type); else console.log(m);
  };
  XU.rerender = function () {
    var r = App.router || {};
    if (typeof r.render === 'function') return r.render();
    if (typeof r.refresh === 'function') return r.refresh();
    if (typeof r.resolve === 'function') return r.resolve();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  };
  XU.go = function (hash) {
    if (location.hash === hash) XU.rerender(); else location.hash = hash;
  };
  XU.modal = function (opts) {
    if (App.ui && App.ui.modal) return App.ui.modal(opts);
    // Fallback modal if core does not provide one
    var wrap = document.createElement('div');
    wrap.className = 'ex-modal-bg';
    wrap.innerHTML = '<form class="ex-modal"><h3>' + XU.esc(opts.title) + '</h3><div>' + opts.body + '</div>' +
      '<div class="ex-modal-foot"><button type="button" class="ex-btn" data-x>Cancel</button>' +
      (opts.onSave ? '<button class="ex-btn ex-primary">' + XU.esc(opts.saveLabel || 'Save') + '</button>' : '') + '</div></form>';
    document.body.appendChild(wrap);
    wrap.querySelector('[data-x]').onclick = XU.closeModal;
    wrap.querySelector('form').onsubmit = function (e) {
      e.preventDefault();
      if (opts.onSave && opts.onSave(e.target) === false) return;
      XU.closeModal();
    };
  };
  XU.closeModal = function () {
    if (App.ui && App.ui.closeModal) App.ui.closeModal();
    var m = document.querySelector('.ex-modal-bg'); if (m) m.remove();
  };
  XU.val = function (form, name) {
    var el = (form || document).querySelector('[name="' + name + '"]');
    if (!el) return '';
    if (el.type === 'checkbox') return el.checked;
    return el.value;
  };
  XU.badge = function (text, tone) {
    var map = {
      draft: 'grey', ordered: 'blue', received: 'green', cancelled: 'red', delivered: 'green', shipped: 'blue',
      processing: 'amber', pending: 'amber', paid: 'green', active: 'green', invited: 'amber', disabled: 'red',
      owner: 'purple', manager: 'blue', staff: 'grey', low: 'amber', out: 'red', ok: 'green', refunded: 'red', returned: 'red'
    };
    tone = tone || map[String(text).toLowerCase()] || 'grey';
    return '<span class="ex-badge ex-' + tone + '">' + XU.esc(text) + '</span>';
  };
  XU.kpi = function (label, value, sub, icon) {
    return '<div class="ex-kpi"><div class="ex-kpi-l">' + (icon ? icon + ' ' : '') + XU.esc(label) + '</div>' +
      '<div class="ex-kpi-v">' + value + '</div>' + (sub ? '<div class="ex-kpi-s">' + sub + '</div>' : '') + '</div>';
  };
  /* cols: [{label, align:'r'|'c'}] or strings; rows: array of arrays of html */
  XU.table = function (cols, rows, opts) {
    opts = opts || {};
    var h = '<div class="ex-table-wrap"><table class="ex-table' + (opts.cls ? ' ' + opts.cls : '') + '"' + (opts.id ? ' id="' + opts.id + '"' : '') + '><thead><tr>';
    cols.forEach(function (c) {
      c = typeof c === 'string' ? { label: c } : c;
      h += '<th class="' + (c.align ? 'ex-' + c.align : '') + '">' + c.label + '</th>';
    });
    h += '</tr></thead><tbody>';
    if (!rows.length) h += '<tr><td colspan="' + cols.length + '" class="ex-muted ex-c" style="padding:28px">' + (opts.empty || 'No records for this selection') + '</td></tr>';
    rows.forEach(function (r) {
      var attrs = r.attrs || '';
      h += '<tr ' + attrs + '>' + r.map(function (cell, i) {
        var c = cols[i]; c = typeof c === 'string' ? {} : (c || {});
        return '<td class="' + (c.align ? 'ex-' + c.align : '') + '">' + (cell == null ? '' : cell) + '</td>';
      }).join('') + '</tr>';
    });
    if (opts.foot) h += '</tbody><tfoot><tr>' + opts.foot.map(function (cell, i) {
      var c = cols[i]; c = typeof c === 'string' ? {} : (c || {});
      return '<td class="' + (c.align ? 'ex-' + c.align : '') + '">' + cell + '</td>';
    }).join('') + '</tr></tfoot>';
    return h + '</tbody></table></div>';
  };
  XU.head = function (title, sub, actions) {
    return '<div class="ex-head"><div><h1>' + title + '</h1>' + (sub ? '<p>' + sub + '</p>' : '') + '</div>' +
      '<div class="ex-actions">' + (actions || '') + '</div></div>';
  };
  XU.filterRows = function (input, tableId) {
    var q = input.value.toLowerCase();
    document.querySelectorAll('#' + tableId + ' tbody tr').forEach(function (tr) {
      tr.style.display = tr.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none';
    });
  };
  XU.csv = function (name, rows) {
    if (App.ui && App.ui.csv) return App.ui.csv(name, rows);
    var txt = rows.map(function (r) {
      return r.map(function (c) { c = String(c == null ? '' : c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(',');
    }).join('\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + txt], { type: 'text/csv' }));
    a.download = name; a.click();
  };
  XU.pdf = function (title, head, rows) {
    if (App.ui && App.ui.pdf) return App.ui.pdf(title, head, rows);
    var doc = new window.jspdf.jsPDF({ orientation: head.length > 6 ? 'landscape' : 'portrait' });
    doc.setFontSize(14); doc.text(title, 14, 16);
    doc.autoTable({ head: [head], body: rows, startY: 22, styles: { fontSize: 8 }, headStyles: { fillColor: [79, 70, 229] } });
    doc.save(title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.pdf');
  };
  /* Chart registry: destroys previous chart on same canvas id */
  XU.charts = XU.charts || {};
  XU.chart = function (id, config) {
    config.options = config.options || {};
    config.options.responsive = true;
    config.options.maintainAspectRatio = false;
    var draw = function () {
      var el = document.getElementById(id);
      if (!el) return;
      if (App.ui && App.ui.chart) return App.ui.chart(el, config); // core tracks + destroys on next render
      if (!window.Chart) return;
      if (XU.charts[id]) { try { XU.charts[id].destroy(); } catch (e) { /* stale */ } }
      XU.charts[id] = new Chart(el, config);
    };
    if (Array.isArray(App.onRender)) App.onRender.push(draw); else setTimeout(draw, 30);
  };
  XU.money = function (v) { return XU.inr(v); };
  XU.product = function (id) { return XU.arr('products').filter(function (p) { return p.id === id; })[0]; };
  XU.customer = function (id) { return XU.arr('customers').filter(function (c) { return c.id === id; })[0]; };
  XU.custName = function (o) {
    var c = XU.customer(o.customerId);
    return (c && (c.name || ((c.firstName || '') + ' ' + (c.lastName || '')).trim())) || (o.address && o.address.name) || 'Walk-in customer';
  };
  XU.warehouses = function () {
    var w = XU.arr('warehouses');
    if (!w.length) w.push({ id: 'wh-main', name: 'Main Warehouse', city: (XU.settings().city || 'Bengaluru') });
    return w;
  };
  XU.settings = function () {
    var s = XU.st();
    if (!s.settings) s.settings = {};
    return s.settings;
  };
  XU.storeName = function () {
    var s = XU.settings(), t = XU.st().tenant;
    return s.storeName || s.name || (t && t.name) || 'ShopMint Store';
  };
  XU.isCancelled = function (o) { return /cancel|refund|return|fail/i.test(o.status || ''); };
  /* Ensure a product has stockByWh consistent with its stock */
  XU.whStock = function (p) {
    var whs = XU.warehouses();
    if (!p.stockByWh || typeof p.stockByWh !== 'object') {
      p.stockByWh = {}; p.stockByWh[whs[0].id] = Number(p.stock) || 0;
    }
    return p.stockByWh;
  };
  XU.syncStock = function (p) {
    var t = 0, m = XU.whStock(p);
    Object.keys(m).forEach(function (k) { t += Number(m[k]) || 0; });
    p.stock = t;
  };
  XU.nav = function (hash, label, icon, group, roles) {
    if (!App.adminNav) App.adminNav = [];
    App.adminNav.push({ hash: hash, label: label, icon: icon, group: group, roles: roles });
  };
  /* Single point of route registration */
  XU.route = function (path, fn, roles) {
    App.router.register(path, function (params) {
      if (roles && !XU.can(roles)) return XU.denied(roles);
      return fn(params || {});
    }, { layout: 'admin', roles: roles });
  };
  XU.monthKey = function (d) { d = new Date(d); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2); };
  XU.monthLabel = function (k) {
    var p = k.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  };
  XU.lastMonths = function (n) {
    var out = [], d = new Date(); d.setDate(1);
    for (var i = n - 1; i >= 0; i--) { var x = new Date(d.getFullYear(), d.getMonth() - i, 1); out.push(XU.monthKey(x)); }
    return out;
  };
  XU.orderCost = function (o) {
    if (App.store && App.store.orderCost) return App.store.orderCost(o);
    return (o.items || []).reduce(function (s, it) {
      var p = XU.product(it.productId) || {};
      var c = it.cost != null ? Number(it.cost) : (p.cost != null ? Number(p.cost) : Number(it.price) * 0.6);
      return s + (Number(it.qty) || 0) * c;
    }, 0);
  };
  XU.orderNet = function (o) {
    if (App.store && App.store.orderNet) return App.store.orderNet(o);
    // Revenue excluding GST, shipping and COD fee
    return (Number(o.total) || 0) - (Number(o.tax) || 0) - (Number(o.shipping) || 0) - (Number(o.codFee) || 0);
  };
  /* Change one warehouse's stock by delta; goes through core so stockMoves is logged and totals recomputed */
  XU.adjust = function (p, whId, delta, reason) {
    if (!delta) return;
    if (App.store && App.store.adjustStock) return App.store.adjustStock(p.id, whId, delta, reason);
    var m = XU.whStock(p);
    m[whId] = Math.max(0, (Number(m[whId]) || 0) + delta);
    XU.syncStock(p);
    XU.arr('stockMoves').unshift({ id: XU.uid('sm'), date: new Date().toISOString(), productId: p.id, whId: whId,
      delta: delta, reason: reason, by: XU.me().name || '' });
    XU.save();
  };

  /* Indian number-to-words */
  XU.words = function (amount) {
    var ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
      'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    var tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    function two(n) { return n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : ''); }
    function three(n) {
      var h = Math.floor(n / 100), r = n % 100;
      return (h ? ones[h] + ' Hundred' + (r ? ' ' : '') : '') + (r ? two(r) : '');
    }
    function conv(n) {
      if (n === 0) return 'Zero';
      var parts = [], cr = Math.floor(n / 10000000); n %= 10000000;
      var lk = Math.floor(n / 100000); n %= 100000;
      var th = Math.floor(n / 1000); n %= 1000;
      if (cr) parts.push(conv(cr) + ' Crore');
      if (lk) parts.push(two(lk) + ' Lakh');
      if (th) parts.push(two(th) + ' Thousand');
      if (n) parts.push(three(n));
      return parts.join(' ');
    }
    amount = Math.round((Number(amount) || 0) * 100) / 100;
    var rupees = Math.floor(amount), paise = Math.round((amount - rupees) * 100);
    return 'Indian Rupees ' + conv(rupees) + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
  };

  /* Scoped styles for all three of my modules */
  if (!document.getElementById('ex-styles')) {
    var css = document.createElement('style');
    css.id = 'ex-styles';
    css.textContent = [
      '.ex-page{--exp:var(--primary,#4f46e5);--exb:var(--border,#e5e7eb);--exm:var(--muted,#6b7280);color:inherit}',
      '.ex-head{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-bottom:18px}',
      '.ex-head h1{margin:0;font-size:22px}.ex-head p{margin:4px 0 0;color:var(--exm,#6b7280);font-size:13px}',
      '.ex-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.ex-btn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--exb,#e5e7eb);background:var(--card,#fff);color:inherit;padding:7px 12px;border-radius:8px;font:inherit;font-size:13px;cursor:pointer;text-decoration:none;white-space:nowrap}',
      '.ex-btn:hover{border-color:var(--exp,#4f46e5)}.ex-btn.ex-primary{background:var(--exp,#4f46e5);border-color:var(--exp,#4f46e5);color:#fff}',
      '.ex-btn.ex-sm{padding:4px 9px;font-size:12px}.ex-btn.ex-danger{color:#dc2626}.ex-btn[disabled]{opacity:.5;cursor:default}',
      '.ex-card{background:var(--card,#fff);border:1px solid var(--exb,#e5e7eb);border-radius:12px;padding:16px;margin-bottom:16px;box-shadow:var(--shadow,none)}',
      '.ex-card h3{margin:0 0 12px;font-size:15px}.ex-empty{text-align:center;padding:48px 16px}',
      '.ex-grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(190px,100%),1fr));margin-bottom:16px}',
      '.ex-grid2{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))}',
      '.ex-kpi{background:var(--card,#fff);border:1px solid var(--exb,#e5e7eb);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow,none)}',
      '.ex-kpi-l{font-size:12px;color:var(--exm,#6b7280);text-transform:uppercase;letter-spacing:.04em}',
      '.ex-kpi-v{font-size:22px;font-weight:700;margin-top:4px}.ex-kpi-s{font-size:12px;color:var(--exm,#6b7280);margin-top:2px}',
      '.ex-table-wrap{overflow-x:auto}.ex-table{width:100%;border-collapse:collapse;font-size:13px}',
      '.ex-table th{text-align:left;font-weight:600;color:var(--exm,#6b7280);font-size:12px;padding:9px 10px;border-bottom:1px solid var(--exb,#e5e7eb);white-space:nowrap;background:var(--bg-soft,rgba(0,0,0,.02))}',
      '.ex-table td{padding:9px 10px;border-bottom:1px solid var(--exb,#e5e7eb);vertical-align:middle}',
      '.ex-table tfoot td{font-weight:700;border-top:2px solid var(--exb,#e5e7eb)}',
      '.ex-r{text-align:right!important}.ex-c{text-align:center!important}.ex-muted{color:var(--exm,#6b7280)}.ex-small{font-size:12px}',
      '.ex-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;white-space:nowrap}',
      '.ex-grey{background:#f1f5f9;color:#475569}.ex-blue{background:#dbeafe;color:#1d4ed8}.ex-green{background:#dcfce7;color:#15803d}',
      '.ex-red{background:#fee2e2;color:#b91c1c}.ex-amber{background:#fef3c7;color:#b45309}.ex-purple{background:#ede9fe;color:#6d28d9}',
      '.ex-input,.ex-page select,.ex-form input,.ex-form select,.ex-form textarea{border:1px solid var(--exb,#e5e7eb);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;background:var(--card,#fff);color:inherit;box-sizing:border-box}',
      '.ex-form{display:grid;gap:12px;grid-template-columns:1fr 1fr}.ex-form label{display:flex;flex-direction:column;gap:4px;font-size:12px;font-weight:600;color:var(--exm,#6b7280)}',
      '.ex-form .ex-full{grid-column:1/-1}.ex-form input,.ex-form select,.ex-form textarea{width:100%}',
      '.ex-lines{width:100%;border-collapse:collapse;font-size:13px}.ex-lines td{padding:4px}.ex-lines input,.ex-lines select{width:100%}',
      '.ex-wh{border-left:4px solid var(--exp,#4f46e5)}.ex-wh .ex-kpi-v{font-size:18px}',
      '.ex-alert{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px dashed var(--exb,#e5e7eb);font-size:13px;min-width:0}.ex-alert>div{min-width:0}',
      '.ex-alert:last-child{border-bottom:0}.ex-thumb{width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:18px;background:#f1f5f9;flex:none}',
      '.ex-prod{display:flex;align-items:center;gap:10px}.ex-chart{position:relative;height:260px}',
      '.ex-tabs{display:flex;gap:4px;border-bottom:1px solid var(--exb,#e5e7eb);margin-bottom:16px;flex-wrap:wrap}',
      '.ex-tab{padding:9px 14px;border:0;background:none;font:inherit;font-size:13px;cursor:pointer;color:var(--exm,#6b7280);border-bottom:2px solid transparent;margin-bottom:-1px}',
      '.ex-tab.on{color:var(--exp,#4f46e5);border-bottom-color:var(--exp,#4f46e5);font-weight:600}',
      '.ex-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '.ex-meter{height:8px;border-radius:99px;background:#eef2f7;overflow:hidden;margin-top:6px}.ex-meter i{display:block;height:100%;background:var(--exp,#4f46e5)}',
      '.ex-modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:999}',
      '.ex-modal{background:#fff;border-radius:12px;padding:20px;width:min(640px,94vw);max-height:90vh;overflow:auto}.ex-modal-foot{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
      /* invoice */
      '.ex-invoice{background:#fff;color:#111827;border:1px solid var(--exb,#e5e7eb);border-radius:12px;padding:28px;max-width:900px;margin:0 auto;font-size:13px}',
      '.ex-inv-top{display:flex;justify-content:space-between;gap:16px;border-bottom:2px solid #111827;padding-bottom:14px;margin-bottom:14px}',
      '.ex-inv-top h2{margin:0;font-size:20px}.ex-inv-title{text-align:right}.ex-inv-title h3{margin:0;letter-spacing:.08em}',
      '.ex-inv-parties{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:14px}.ex-inv-parties h4{margin:0 0 4px;font-size:11px;text-transform:uppercase;color:#6b7280}',
      '.ex-invoice .ex-table th{background:#f3f4f6;color:#111827}.ex-inv-sum{display:flex;justify-content:space-between;gap:24px;margin-top:14px;flex-wrap:wrap}',
      '.ex-inv-sum table{min-width:280px;font-size:13px}.ex-inv-sum td{padding:4px 8px}.ex-inv-sum tr.tot td{font-weight:700;font-size:15px;border-top:2px solid #111827}',
      '.ex-inv-foot{display:flex;justify-content:space-between;margin-top:28px;font-size:12px;color:#4b5563;gap:16px}',
      '.ex-plan{position:relative}.ex-plan.cur{border:2px solid var(--exp,#4f46e5);box-shadow:0 8px 24px rgba(79,70,229,.15)}',
      '.ex-plan .ex-price{font-size:28px;font-weight:800}.ex-plan ul{padding-left:18px;margin:10px 0;font-size:13px;line-height:1.8}',
      '.ex-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px dashed var(--exb,#e5e7eb)}',
      '.ex-switch input{width:18px;height:18px}.ex-tick{color:#16a34a;font-weight:700}.ex-cross{color:#cbd5e1}',
      '.ex-page{min-width:0;max-width:100%}.ex-page .card>div,.ex-page [class*=head]{flex-wrap:wrap}@media (max-width:640px){.ex-form{grid-template-columns:1fr}.ex-inv-parties{grid-template-columns:1fr}}',
      '@media print{body *{visibility:hidden!important}.ex-invoice,.ex-invoice *{visibility:visible!important}' +
      '.ex-invoice{position:absolute;left:0;top:0;width:100%;max-width:none;border:0;padding:0}.ex-noprint{display:none!important}@page{size:A4;margin:12mm}}'
    ].join('\n');
    document.head.appendChild(css);
  }

  /* ------------------------------------------------------------------ */
  /* ERP                                                                 */
  /* ------------------------------------------------------------------ */
  var ERP = window.ERP = { threshold: null, poStatus: 'all', expCat: 'all' };
  var MGR = ['Owner', 'Manager'];

  function threshold() {
    if (ERP.threshold == null) ERP.threshold = Number(XU.settings().lowStockThreshold) || 10;
    return ERP.threshold;
  }
  function thumb(p) {
    if (App.ui && App.ui.productThumb) {
      try { return App.ui.productThumb(p, 'sm'); } catch (e) { /* fall through */ }
    }
    return '<span class="ex-thumb" style="background:' + (p.color || '#f1f5f9') + '22">' + (p.emoji || '📦') + '</span>';
  }
  function whName(id) {
    var w = XU.warehouses().filter(function (x) { return x.id === id; })[0];
    return w ? w.name : id;
  }
  function whOptions(sel) {
    return XU.warehouses().map(function (w) {
      return '<option value="' + w.id + '"' + (w.id === sel ? ' selected' : '') + '>' + XU.esc(w.name) + (w.city ? ' — ' + XU.esc(w.city) : '') + '</option>';
    }).join('');
  }
  function stockStatus(qty) {
    if (qty <= 0) return XU.badge('Out of stock', 'red');
    if (qty <= threshold()) return XU.badge('Low stock', 'amber');
    return XU.badge('In stock', 'green');
  }

  /* ---------------- Inventory ---------------- */
  function renderInventory() {
    var prods = XU.arr('products'), whs = XU.warehouses(), th = threshold();
    prods.forEach(function (p) { if (App.store && App.store.recalc) App.store.recalc(p); else XU.syncStock(p); });
    var units = 0, value = 0, low = [], out = 0;
    prods.forEach(function (p) {
      units += p.stock; value += p.stock * (Number(p.cost) || 0);
      if (p.stock <= 0) out++;
      if (p.stock <= th) low.push(p);
    });
    low.sort(function (a, b) { return a.stock - b.stock; });

    var whCards = whs.map(function (w) {
      var u = 0, v = 0, skus = 0;
      prods.forEach(function (p) {
        var q = Number(XU.whStock(p)[w.id]) || 0;
        if (q > 0) skus++;
        u += q; v += q * (Number(p.cost) || 0);
      });
      return '<div class="ex-kpi ex-wh"><div class="ex-kpi-l">🏬 ' + XU.esc(w.name) + '</div>' +
        '<div class="ex-kpi-v">' + XU.num(u) + ' units</div>' +
        '<div class="ex-kpi-s">' + XU.esc(w.city || w.address || '') + ' · ' + skus + ' SKUs · ' + XU.money(v) + '</div></div>';
    }).join('');

    var alerts = low.slice(0, 8).map(function (p) {
      return '<div class="ex-alert">' + thumb(p) + '<div style="flex:1"><b>' + XU.esc(p.name) + '</b><div class="ex-muted ex-small">' +
        XU.esc(p.sku || '') + ' · ' + p.stock + ' left</div></div>' + stockStatus(p.stock) +
        '<button class="ex-btn ex-sm" onclick="ERP.adjust(\'' + p.id + '\')">Restock</button></div>';
    }).join('') || '<p class="ex-muted">All products are above the threshold of ' + th + ' units. 🎉</p>';

    var cols = [{ label: 'Product' }, { label: 'SKU' }].concat(whs.map(function (w) {
      return { label: XU.esc(w.name), align: 'r' };
    })).concat([{ label: 'Total', align: 'r' }, { label: 'Stock value', align: 'r' }, { label: 'Status' }, { label: '', align: 'r' }]);
    var rows = prods.slice().sort(function (a, b) { return a.stock - b.stock; }).map(function (p) {
      var m = XU.whStock(p);
      return ['<div class="ex-prod">' + thumb(p) + '<span>' + XU.esc(p.name) + '</span></div>', '<span class="ex-muted">' + XU.esc(p.sku || '') + '</span>']
        .concat(whs.map(function (w) { return XU.num(m[w.id] || 0); }))
        .concat(['<b>' + XU.num(p.stock) + '</b>', XU.money(p.stock * (Number(p.cost) || 0)), stockStatus(p.stock),
          '<button class="ex-btn ex-sm" onclick="ERP.adjust(\'' + p.id + '\')">Adjust</button> ' +
          '<button class="ex-btn ex-sm" onclick="ERP.transfer(\'' + p.id + '\')"' + (whs.length < 2 ? ' disabled' : '') + '>Transfer</button>']);
    });

    return '<div class="ex-page">' + XU.head('Inventory', 'Stock across ' + whs.length + ' warehouses · updated in real time',
      '<button class="ex-btn" onclick="ERP.exportInventory()">⬇ Export CSV</button>' +
      '<button class="ex-btn ex-primary" onclick="ERP.adjust()">＋ Stock adjustment</button>') +
      '<div class="ex-grid">' +
      XU.kpi('Total SKUs', XU.num(prods.length), prods.length + ' active products') +
      XU.kpi('Units on hand', XU.num(units), 'across all warehouses') +
      XU.kpi('Inventory value', XU.money(value), 'at cost price') +
      XU.kpi('Low / out of stock', low.length + ' / ' + out, 'threshold ≤ ' + th + ' units') + '</div>' +
      '<div class="ex-grid">' + whCards + '</div>' +
      '<div class="ex-card"><div class="ex-head" style="margin-bottom:8px"><h3 style="margin:0">⚠️ Low-stock alerts</h3>' +
      '<label class="ex-small ex-muted">Alert threshold <input class="ex-input" type="number" min="0" style="width:80px" value="' + th +
      '" onchange="ERP.setThreshold(this.value)"> units</label></div>' + alerts + '</div>' +
      '<div class="ex-card"><div class="ex-head" style="margin-bottom:10px"><h3 style="margin:0">Stock by warehouse</h3>' +
      '<input class="ex-input" placeholder="Search product or SKU…" oninput="XU.filterRows(this,\'ex-inv-table\')"></div>' +
      XU.table(cols, rows, { id: 'ex-inv-table' }) + '</div>' + movesCard() + '</div>';
  }
  function movesCard() {
    var moves = XU.arr('stockMoves').slice(0, 12);
    if (!moves.length) return '';
    return '<div class="ex-card"><h3>Recent stock movements</h3>' + XU.table(['When', 'Product', 'Warehouse', { label: 'Change', align: 'r' }, 'Reason', 'By'],
      moves.map(function (m) {
        var p = XU.product(m.productId) || {};
        return [App.fmt && App.fmt.dateTime ? App.fmt.dateTime(m.date) : XU.date(m.date), XU.esc(p.name || m.productId), XU.esc(whName(m.whId)),
          '<b style="color:' + (m.delta >= 0 ? '#16a34a' : '#dc2626') + '">' + (m.delta > 0 ? '+' : '') + m.delta + '</b>', XU.esc(m.reason || ''), XU.esc(m.by || '')];
      })) + '</div>';
  }
  ERP.setThreshold = function (v) {
    ERP.threshold = Math.max(0, Number(v) || 0);
    XU.settings().lowStockThreshold = ERP.threshold; XU.save(); XU.rerender();
  };
  function productOptions(sel) {
    return XU.arr('products').map(function (p) {
      return '<option value="' + p.id + '"' + (p.id === sel ? ' selected' : '') + '>' + XU.esc(p.name) + ' (' + XU.esc(p.sku || '') + ')</option>';
    }).join('');
  }
  ERP.adjust = function (pid) {
    pid = pid || (XU.arr('products')[0] || {}).id;
    XU.modal({
      title: 'Stock adjustment',
      saveLabel: 'Apply adjustment',
      body: '<div class="ex-form">' +
        '<label class="ex-full">Product<select name="pid">' + productOptions(pid) + '</select></label>' +
        '<label>Warehouse<select name="wh">' + whOptions() + '</select></label>' +
        '<label>Adjustment type<select name="type"><option value="add">Add stock (+)</option><option value="remove">Remove stock (−)</option><option value="set">Set exact quantity</option></select></label>' +
        '<label>Quantity<input name="qty" type="number" min="0" value="25" required></label>' +
        '<label>Reason<select name="reason"><option>Restock from supplier</option><option>Stock count correction</option><option>Damaged / expired</option><option>Customer return</option><option>Promotional sample</option></select></label>' +
        '</div>',
      onSave: function (f) {
        var p = XU.product(XU.val(f, 'pid')), wh = XU.val(f, 'wh'), q = Math.max(0, Number(XU.val(f, 'qty')) || 0), type = XU.val(f, 'type');
        if (!p) return false;
        var m = XU.whStock(p), cur = Number(m[wh]) || 0;
        var next = type === 'add' ? cur + q : type === 'remove' ? Math.max(0, cur - q) : q;
        XU.adjust(p, wh, next - cur, XU.val(f, 'reason'));
        XU.closeModal();
        XU.toast(p.name + ': ' + whName(wh) + ' now ' + m[wh] + ' units', 'success');
        XU.rerender();
      }
    });
  };
  ERP.transfer = function (pid) {
    var whs = XU.warehouses();
    XU.modal({
      title: 'Transfer stock between warehouses',
      saveLabel: 'Transfer',
      body: '<div class="ex-form">' +
        '<label class="ex-full">Product<select name="pid">' + productOptions(pid) + '</select></label>' +
        '<label>From<select name="from">' + whOptions(whs[0].id) + '</select></label>' +
        '<label>To<select name="to">' + whOptions((whs[1] || whs[0]).id) + '</select></label>' +
        '<label>Quantity<input name="qty" type="number" min="1" value="10" required></label>' +
        '<label>Reference<input name="ref" value="TRF-' + Date.now().toString().slice(-5) + '"></label></div>',
      onSave: function (f) {
        var p = XU.product(XU.val(f, 'pid')), from = XU.val(f, 'from'), to = XU.val(f, 'to'), q = Number(XU.val(f, 'qty')) || 0;
        if (!p) return false;
        var m = XU.whStock(p), avail = Number(m[from]) || 0;
        if (from === to) { XU.toast('Choose two different warehouses', 'error'); return false; }
        if (q <= 0 || q > avail) { XU.toast('Only ' + avail + ' units available in ' + whName(from), 'error'); return false; }
        XU.adjust(p, from, -q, 'Transfer ' + XU.val(f, 'ref') + ' to ' + whName(to));
        XU.adjust(p, to, q, 'Transfer ' + XU.val(f, 'ref') + ' from ' + whName(from));
        XU.closeModal();
        XU.toast('Moved ' + q + ' × ' + p.name + ' to ' + whName(to), 'success');
        XU.rerender();
      }
    });
  };
  ERP.exportInventory = function () {
    var whs = XU.warehouses();
    var rows = [['Product', 'SKU'].concat(whs.map(function (w) { return w.name; })).concat(['Total', 'Cost', 'Value'])];
    XU.arr('products').forEach(function (p) {
      var m = XU.whStock(p);
      rows.push([p.name, p.sku].concat(whs.map(function (w) { return m[w.id] || 0; })).concat([p.stock, p.cost, p.stock * (p.cost || 0)]));
    });
    XU.csv('inventory-' + XU.iso() + '.csv', rows);
  };

  /* ---------------- Suppliers ---------------- */
  function catName(id) { var c = XU.arr('categories').filter(function (x) { return x.id === id; })[0]; return c ? c.name : ''; }
  function supplier(id) { return XU.arr('suppliers').filter(function (s) { return s.id === id; })[0]; }
  function poTotal(po) {
    return po.total != null && !po._dirty ? Number(po.total) : (po.items || []).reduce(function (s, i) { return s + (Number(i.qty) || 0) * (Number(i.cost) || 0); }, 0);
  }
  function renderSuppliers() {
    var sups = XU.arr('suppliers'), pos = XU.arr('purchaseOrders');
    var rows = sups.map(function (s) {
      var mine = pos.filter(function (p) { return p.supplierId === s.id; });
      var spend = mine.reduce(function (a, p) { return a + poTotal(p); }, 0);
      return ['<b>' + XU.esc(s.name) + '</b><div class="ex-muted ex-small">' + XU.esc(catName(s.categoryId) || s.category || '') + (s.paymentTerms ? ' · ' + XU.esc(s.paymentTerms) : '') + '</div>',
        XU.esc(s.contact || s.contactPerson || '—'), XU.esc(s.phone || '—'), XU.esc(s.email || '—'),
        '<code>' + XU.esc(s.gstin || '—') + '</code>', XU.esc(s.city || '—'),
        mine.length, XU.money(spend),
        '<button class="ex-btn ex-sm" onclick="ERP.editSupplier(\'' + s.id + '\')">Edit</button> ' +
        '<button class="ex-btn ex-sm ex-danger" onclick="ERP.delSupplier(\'' + s.id + '\')">Delete</button>'];
    });
    return '<div class="ex-page">' + XU.head('Suppliers', sups.length + ' vendors · manage contacts, GSTIN and purchase history',
      '<a class="ex-btn" href="#/admin/purchases">Purchase orders →</a><button class="ex-btn ex-primary" onclick="ERP.editSupplier()">＋ Add supplier</button>') +
      '<div class="ex-card"><div class="ex-head" style="margin-bottom:10px"><h3 style="margin:0">All suppliers</h3>' +
      '<input class="ex-input" placeholder="Search suppliers…" oninput="XU.filterRows(this,\'ex-sup-table\')"></div>' +
      XU.table(['Supplier', 'Contact person', 'Phone', 'Email', 'GSTIN', 'City', { label: 'POs', align: 'r' }, { label: 'Total purchases', align: 'r' }, { label: '', align: 'r' }], rows,
        { id: 'ex-sup-table', empty: 'No suppliers yet — add your first vendor' }) + '</div></div>';
  }
  ERP.editSupplier = function (id) {
    var s = id ? supplier(id) : {};
    var f = function (n, l, v, t) { return '<label>' + l + '<input name="' + n + '" type="' + (t || 'text') + '" value="' + XU.esc(v || '') + '"' + (n === 'name' ? ' required' : '') + '></label>'; };
    XU.modal({
      title: id ? 'Edit supplier' : 'Add supplier',
      saveLabel: id ? 'Save changes' : 'Add supplier',
      body: '<div class="ex-form">' + f('name', 'Company name', s.name) + f('contact', 'Contact person', s.contact || s.contactPerson) +
        f('phone', 'Phone', s.phone, 'tel') + f('email', 'Email', s.email, 'email') + f('gstin', 'GSTIN', s.gstin) +
        f('city', 'City', s.city) + f('state', 'State', s.state) +
        '<label>Payment terms<select name="paymentTerms">' + ['Advance', 'Net 15', 'Net 30', 'Net 45'].map(function (t) { return '<option' + (t === (s.paymentTerms || 'Net 30') ? ' selected' : '') + '>' + t + '</option>'; }).join('') + '</select></label>' +
        '<label>Supplies category<select name="categoryId">' + XU.arr('categories').map(function (c) { return '<option value="' + c.id + '"' + (c.id === s.categoryId ? ' selected' : '') + '>' + XU.esc(c.name) + '</option>'; }).join('') + '</select></label></div>',
      onSave: function (fm) {
        var name = XU.val(fm, 'name').trim();
        if (!name) { XU.toast('Company name is required', 'error'); return false; }
        if (!id) { s = { id: XU.uid('sup') }; XU.arr('suppliers').unshift(s); }
        ['name', 'contact', 'phone', 'email', 'gstin', 'city', 'state', 'paymentTerms', 'categoryId'].forEach(function (k) { s[k] = XU.val(fm, k).trim(); });
        XU.save(); XU.closeModal(); XU.toast(id ? 'Supplier updated' : 'Supplier added', 'success'); XU.rerender();
      }
    });
  };
  ERP.delSupplier = function (id) {
    var s = supplier(id);
    if (XU.arr('purchaseOrders').some(function (p) { return p.supplierId === id && p.status !== 'received'; })) {
      XU.toast('Cannot delete: ' + s.name + ' has open purchase orders', 'error'); return;
    }
    XU.modal({
      title: 'Delete supplier', saveLabel: 'Delete',
      body: '<p>Remove <b>' + XU.esc(s.name) + '</b> from your supplier list? Past purchase orders are kept.</p>',
      onSave: function () {
        var list = XU.arr('suppliers'); list.splice(list.indexOf(s), 1);
        XU.save(); XU.closeModal(); XU.toast('Supplier deleted'); XU.rerender();
      }
    });
  };

  /* ---------------- Purchase orders ---------------- */
  function poNo(po) { return po.number || po.poNumber || po.id; }
  function poStatus(po) { return String(po.status || 'draft').toLowerCase(); }
  function renderPurchases() {
    var pos = XU.arr('purchaseOrders').slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    var counts = { draft: 0, ordered: 0, received: 0 }, openVal = 0, recMonth = 0, mk = XU.monthKey(new Date());
    pos.forEach(function (p) {
      var s = poStatus(p); counts[s] = (counts[s] || 0) + 1;
      if (s !== 'received' && s !== 'cancelled') openVal += poTotal(p);
      if (s === 'received' && XU.monthKey(p.receivedDate || p.date) === mk) recMonth += poTotal(p);
    });
    var f = ERP.poStatus;
    var shown = pos.filter(function (p) { return f === 'all' || poStatus(p) === f; });
    var rows = shown.map(function (p) {
      var s = poStatus(p), sup = supplier(p.supplierId);
      var act = '<button class="ex-btn ex-sm" onclick="ERP.viewPO(\'' + p.id + '\')">View</button> ';
      if (s === 'draft') act += '<button class="ex-btn ex-sm ex-primary" onclick="ERP.setPO(\'' + p.id + '\',\'ordered\')">Mark ordered</button>';
      if (s === 'ordered') act += '<button class="ex-btn ex-sm ex-primary" onclick="ERP.receivePO(\'' + p.id + '\')">Receive stock</button>';
      return ['<b>' + XU.esc(poNo(p)) + '</b>', XU.date(p.date), XU.esc(sup ? sup.name : 'Unknown supplier'), XU.esc(whName(p.warehouseId)),
        (p.items || []).length + ' items · ' + (p.items || []).reduce(function (a, i) { return a + (Number(i.qty) || 0); }, 0) + ' units',
        XU.money(poTotal(p)), XU.badge(s.charAt(0).toUpperCase() + s.slice(1), s), act];
    });
    var tab = function (k, l) { return '<button class="ex-tab' + (f === k ? ' on' : '') + '" onclick="ERP.poStatus=\'' + k + '\';XU.rerender()">' + l + '</button>'; };
    return '<div class="ex-page">' + XU.head('Purchase orders', 'Raise POs to suppliers and receive stock into warehouses',
      '<a class="ex-btn" href="#/admin/suppliers">Suppliers</a><button class="ex-btn ex-primary" onclick="ERP.newPO()">＋ New purchase order</button>') +
      '<div class="ex-grid">' + XU.kpi('Open PO value', XU.money(openVal), (counts.draft + counts.ordered) + ' open orders') +
      XU.kpi('Drafts', counts.draft, 'awaiting approval') + XU.kpi('Ordered', counts.ordered, 'in transit from suppliers') +
      XU.kpi('Received this month', XU.money(recMonth), counts.received + ' POs received overall') + '</div>' +
      '<div class="ex-card"><div class="ex-tabs">' + tab('all', 'All (' + pos.length + ')') + tab('draft', 'Draft (' + counts.draft + ')') +
      tab('ordered', 'Ordered (' + counts.ordered + ')') + tab('received', 'Received (' + counts.received + ')') + '</div>' +
      XU.table(['PO number', 'Date', 'Supplier', 'Deliver to', 'Items', { label: 'Amount', align: 'r' }, 'Status', { label: '', align: 'r' }], rows,
        { empty: 'No purchase orders in this status' }) + '</div></div>';
  }
  function lineRow(pid, qty, cost) {
    var p = XU.product(pid) || XU.arr('products')[0] || {};
    return '<tr><td style="width:55%"><select name="lp" onchange="ERP.lineProduct(this)">' + productOptions(p.id) + '</select></td>' +
      '<td><input name="lq" type="number" min="1" value="' + (qty || 20) + '"></td>' +
      '<td><input name="lc" type="number" min="0" step="0.01" value="' + (cost != null ? cost : (p.cost || 0)) + '"></td>' +
      '<td><button type="button" class="ex-btn ex-sm ex-danger" onclick="this.closest(\'tr\').remove()">✕</button></td></tr>';
  }
  ERP.lineProduct = function (sel) {
    var p = XU.product(sel.value), c = sel.closest('tr').querySelector('[name=lc]');
    if (p && c) c.value = p.cost || 0;
  };
  ERP.addLine = function () {
    var tb = document.getElementById('ex-po-lines');
    if (tb) tb.insertAdjacentHTML('beforeend', lineRow());
  };
  ERP.newPO = function () {
    var sups = XU.arr('suppliers');
    if (!sups.length) { XU.toast('Add a supplier first', 'error'); return ERP.editSupplier(); }
    var low = XU.arr('products').filter(function (p) { return p.stock <= threshold(); }).slice(0, 3);
    var lines = (low.length ? low : XU.arr('products').slice(0, 2)).map(function (p) { return lineRow(p.id, Math.max(20, threshold() * 3)); }).join('');
    XU.modal({
      title: 'New purchase order', wide: true,
      saveLabel: 'Create PO',
      body: '<div class="ex-form">' +
        '<label>Supplier<select name="sup">' + sups.map(function (s) { return '<option value="' + s.id + '">' + XU.esc(s.name) + '</option>'; }).join('') + '</select></label>' +
        '<label>Deliver to warehouse<select name="wh">' + whOptions() + '</select></label>' +
        '<label>Order date<input name="date" type="date" value="' + XU.iso() + '"></label>' +
        '<label>Expected delivery<input name="eta" type="date" value="' + XU.iso(Date.now() + 7 * 864e5) + '"></label>' +
        '<div class="ex-full"><table class="ex-lines"><thead><tr class="ex-small ex-muted"><td>Product</td><td>Qty</td><td>Unit cost (₹)</td><td></td></tr></thead>' +
        '<tbody id="ex-po-lines">' + lines + '</tbody></table>' +
        '<button type="button" class="ex-btn ex-sm" style="margin-top:6px" onclick="ERP.addLine()">＋ Add line</button></div>' +
        '<label class="ex-full">Notes<input name="notes" placeholder="e.g. Deliver between 10am–6pm"></label>' +
        '<label class="ex-full" style="flex-direction:row;align-items:center"><input type="checkbox" name="place" style="width:auto"> Place order immediately (skip draft)</label></div>',
      onSave: function (f) {
        var items = [];
        f.querySelectorAll('#ex-po-lines tr').forEach(function (tr) {
          var p = XU.product(tr.querySelector('[name=lp]').value), q = Number(tr.querySelector('[name=lq]').value) || 0, c = Number(tr.querySelector('[name=lc]').value) || 0;
          if (p && q > 0) items.push({ productId: p.id, name: p.name, sku: p.sku, qty: q, cost: c });
        });
        if (!items.length) { XU.toast('Add at least one line item', 'error'); return false; }
        var pos = XU.arr('purchaseOrders');
        var maxN = pos.reduce(function (m, x) { var n = +(String(x.id).match(/(\d+)$/) || [0, 0])[1]; return Math.max(m, n); }, 2400);
        var pre = (String((pos[0] || {}).id || 'PO-').match(/^(.*?)\d+$/) || [0, 'PO-'])[1];
        var po = {
          id: pre + (maxN + 1), supplierId: XU.val(f, 'sup'), warehouseId: XU.val(f, 'wh'),
          date: new Date(XU.val(f, 'date') || Date.now()).toISOString(), expectedDate: XU.val(f, 'eta'), items: items,
          notes: XU.val(f, 'notes'), status: XU.val(f, 'place') ? 'ordered' : 'draft'
        };
        po.total = items.reduce(function (s, i) { return s + i.qty * i.cost; }, 0);
        pos.unshift(po); XU.save(); XU.closeModal();
        XU.toast(po.id + ' created (' + XU.money(po.total) + ')', 'success'); XU.rerender();
      }
    });
  };
  ERP.setPO = function (id, status) {
    var po = XU.arr('purchaseOrders').filter(function (p) { return p.id === id; })[0];
    if (!po) return;
    po.status = status; if (status === 'ordered') po.orderedDate = new Date().toISOString();
    XU.save(); XU.closeModal(); XU.toast(poNo(po) + ' marked ' + status, 'success'); XU.rerender();
  };
  ERP.receivePO = function (id) {
    var po = XU.arr('purchaseOrders').filter(function (p) { return p.id === id; })[0];
    if (!po || poStatus(po) === 'received') return;
    var wh = po.warehouseId || XU.warehouses()[0].id, units = 0;
    (po.items || []).forEach(function (i) {
      var p = XU.product(i.productId); if (!p) return;
      units += Number(i.qty) || 0;
      XU.adjust(p, wh, Number(i.qty) || 0, 'Received against ' + poNo(po));
    });
    po.status = 'received'; po.receivedDate = new Date().toISOString();
    XU.save(); XU.closeModal();
    XU.toast('Received ' + units + ' units into ' + whName(wh), 'success'); XU.rerender();
  };
  ERP.viewPO = function (id) {
    var po = XU.arr('purchaseOrders').filter(function (p) { return p.id === id; })[0];
    if (!po) return;
    var sup = supplier(po.supplierId) || {}, s = poStatus(po);
    var rows = (po.items || []).map(function (i) {
      return [XU.esc(i.name || (XU.product(i.productId) || {}).name), XU.esc(i.sku || (XU.product(i.productId) || {}).sku || ''), XU.num(i.qty), XU.inr2(i.cost), XU.inr2(i.qty * i.cost)];
    });
    XU.modal({
      title: poNo(po) + ' · ' + (sup.name || ''), wide: true,
      saveLabel: s === 'draft' ? 'Mark ordered' : s === 'ordered' ? 'Receive stock' : 'Close', hideSave: s === 'received',
      body: '<p class="ex-small">' + XU.badge(s.charAt(0).toUpperCase() + s.slice(1), s) + ' &nbsp; Ordered ' + XU.date(po.date) +
        ' · Deliver to <b>' + XU.esc(whName(po.warehouseId)) + '</b>' + (po.expectedDate ? ' · ETA ' + XU.date(po.expectedDate) : '') +
        (po.receivedDate ? ' · Received ' + XU.date(po.receivedDate) : '') + '</p>' +
        XU.table(['Item', 'SKU', { label: 'Qty', align: 'r' }, { label: 'Unit cost', align: 'r' }, { label: 'Amount', align: 'r' }], rows,
          { foot: ['Total', '', '', '', XU.inr2(poTotal(po))] }) +
        (po.notes ? '<p class="ex-muted ex-small">Note: ' + XU.esc(po.notes) + '</p>' : ''),
      onSave: function () {
        if (s === 'draft') ERP.setPO(id, 'ordered'); else if (s === 'ordered') ERP.receivePO(id); else XU.closeModal();
      }
    });
  };

  /* ---------------- Invoices ---------------- */
  function fy(d) { d = new Date(d); var y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; return y + '-' + String(y + 1).slice(-2); }
  function invoiceNo(o) {
    return o.invoiceNo || 'INV/' + fy(o.date) + '/' + o.id;
  }
  ERP.invoiceNo = invoiceNo;
  /* Build GST lines for an order. Detects whether item prices are tax-inclusive. */
  function gstCalc(o) {
    var s = XU.settings(), sellerState = (s.state || '').toLowerCase().trim();
    var buyerState = ((o.address && o.address.state) || (XU.customer(o.customerId) || {}).state || s.state || '').toLowerCase().trim();
    var intra = !buyerState || buyerState === sellerState;
    var gross = (o.items || []).reduce(function (a, i) { return a + (Number(i.price) || 0) * (Number(i.qty) || 0); }, 0) || 1;
    var disc = Number(o.discount) || 0;
    var rateOf = function (i, p) { return Number(i.gst != null ? i.gst : p.gst != null ? p.gst : (s.taxRate != null ? s.taxRate : 18)); };
    var exclusive = s.pricesIncludeGst === false;
    var lines = (o.items || []).map(function (i) {
      var p = XU.product(i.productId) || {};
      var rate = rateOf(i, p);
      var amt = (Number(i.price) || 0) * (Number(i.qty) || 0) * (1 - disc / gross);
      var taxable = exclusive ? amt : amt / (1 + rate / 100);
      var tax = taxable * rate / 100;
      return {
        name: i.name || p.name, variant: i.variant, hsn: i.hsn || p.hsn || '—', qty: Number(i.qty) || 0, rate: rate,
        unit: taxable / (Number(i.qty) || 1), taxable: taxable, tax: tax, total: taxable + tax
      };
    });
    var ship = Number(o.shipping) || 0, cod = Number(o.codFee) || 0;
    var t = { taxable: 0, tax: 0 };
    lines.forEach(function (l) { t.taxable += l.taxable; t.tax += l.tax; });
    var grand = t.taxable + t.tax + ship + cod;
    var rounded = Math.round(grand);
    return { lines: lines, intra: intra, taxable: t.taxable, tax: t.tax, cgst: intra ? t.tax / 2 : 0, sgst: intra ? t.tax / 2 : 0,
      igst: intra ? 0 : t.tax, shipping: ship, codFee: cod, grand: grand, round: rounded - grand, payable: rounded,
      buyerState: (o.address && o.address.state) || '', sellerState: s.state || '' };
  }
  ERP.gstCalc = gstCalc;
  function renderInvoices() {
    var orders = XU.arr('orders').slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    var billable = orders.filter(function (o) { return !XU.isCancelled(o); });
    var mk = XU.monthKey(new Date()), mTaxable = 0, mTax = 0, mCount = 0, igst = 0, cgst = 0;
    billable.forEach(function (o) {
      if (XU.monthKey(o.date) !== mk) return;
      var g = gstCalc(o); mCount++; mTaxable += g.taxable; mTax += g.tax; igst += g.igst; cgst += g.cgst;
    });
    var rows = orders.map(function (o) {
      var g = gstCalc(o), c = XU.isCancelled(o);
      return ['<a href="#/admin/invoices/' + o.id + '"><b>' + XU.esc(invoiceNo(o)) + '</b></a><div class="ex-muted ex-small">Order ' + XU.esc(o.id) + '</div>',
        XU.date(o.date), XU.esc(XU.custName(o)), XU.esc(g.buyerState || '—') + ' ' + (g.intra ? XU.badge('CGST+SGST', 'blue') : XU.badge('IGST', 'purple')),
        XU.inr2(g.taxable), XU.inr2(g.tax), '<b>' + XU.inr2(g.payable) + '</b>',
        c ? XU.badge(o.paymentStatus === 'Refunded' ? 'Credit note' : 'Void', 'red') : XU.badge(o.paymentStatus || 'Paid', /pend|unpaid/i.test(o.paymentStatus || '') ? 'amber' : 'green'),
        '<a class="ex-btn ex-sm" href="#/admin/invoices/' + o.id + '">View</a> <button class="ex-btn ex-sm" onclick="ERP.invoicePdf(\'' + o.id + '\')">PDF</button>'];
    });
    return '<div class="ex-page">' + XU.head('Sales & invoicing', 'GST-compliant tax invoices generated from every order · GSTIN ' + XU.esc(XU.settings().gstin || '—'),
      '<button class="ex-btn" onclick="ERP.exportInvoices()">⬇ GSTR-1 CSV</button>') +
      '<div class="ex-grid">' + XU.kpi('Invoices this month', XU.num(mCount), billable.length + ' invoices total') +
      XU.kpi('Taxable value (month)', XU.money(mTaxable)) + XU.kpi('GST collected (month)', XU.money(mTax), 'CGST+SGST ' + XU.money(cgst * 2) + ' · IGST ' + XU.money(igst)) +
      XU.kpi('Seller state', XU.esc(XU.settings().state || '—'), 'place of supply determines tax split') + '</div>' +
      '<div class="ex-card"><div class="ex-head" style="margin-bottom:10px"><h3 style="margin:0">Invoices</h3>' +
      '<input class="ex-input" placeholder="Search invoice, customer, state…" oninput="XU.filterRows(this,\'ex-invoice-table\')"></div>' +
      XU.table(['Invoice #', 'Date', 'Customer', 'Place of supply', { label: 'Taxable', align: 'r' }, { label: 'GST', align: 'r' }, { label: 'Total', align: 'r' }, 'Status', { label: '', align: 'r' }],
        rows, { id: 'ex-invoice-table' }) + '</div></div>';
  }
  ERP.exportInvoices = function () {
    var rows = [['Invoice No', 'Date', 'Customer', 'Place of Supply', 'Taxable Value', 'CGST', 'SGST', 'IGST', 'Shipping', 'COD Fee', 'Invoice Total']];
    XU.arr('orders').filter(function (o) { return !XU.isCancelled(o); }).forEach(function (o) {
      var g = gstCalc(o);
      rows.push([invoiceNo(o), XU.iso(o.date), XU.custName(o), g.buyerState, g.taxable.toFixed(2), g.cgst.toFixed(2), g.sgst.toFixed(2), g.igst.toFixed(2), g.shipping.toFixed(2), g.codFee.toFixed(2), g.payable.toFixed(2)]);
    });
    XU.csv('gstr1-sales-' + XU.iso() + '.csv', rows);
  };
  function renderInvoice(params) {
    var o = XU.arr('orders').filter(function (x) { return String(x.id) === String(params.orderId); })[0];
    if (!o) return '<div class="ex-page"><div class="ex-card ex-empty"><h3>Invoice not found</h3><p>No order with id ' + XU.esc(params.orderId) +
      '.</p><a class="ex-btn" href="#/admin/invoices">← Back to invoices</a></div></div>';
    var s = XU.settings(), g = gstCalc(o), a = o.address || {}, c = XU.customer(o.customerId) || {};
    var cols = ['#', 'Item', 'HSN', { label: 'Qty', align: 'r' }, { label: 'Rate', align: 'r' }, { label: 'Taxable value', align: 'r' }];
    if (g.intra) cols = cols.concat([{ label: 'CGST', align: 'r' }, { label: 'SGST', align: 'r' }]);
    else cols.push({ label: 'IGST', align: 'r' });
    cols.push({ label: 'Amount', align: 'r' });
    var rows = g.lines.map(function (l, i) {
      var r = [i + 1, XU.esc(l.name) + (l.variant ? '<div class="ex-muted ex-small">' + XU.esc(l.variant) + '</div>' : ''), XU.esc(l.hsn), l.qty, XU.inr2(l.unit), XU.inr2(l.taxable)];
      if (g.intra) r.push(XU.inr2(l.tax / 2) + '<div class="ex-muted ex-small">@' + (l.rate / 2) + '%</div>', XU.inr2(l.tax / 2) + '<div class="ex-muted ex-small">@' + (l.rate / 2) + '%</div>');
      else r.push(XU.inr2(l.tax) + '<div class="ex-muted ex-small">@' + l.rate + '%</div>');
      r.push(XU.inr2(l.total));
      return r;
    });
    var sumRows = '<tr><td>Taxable value</td><td class="ex-r">' + XU.inr2(g.taxable) + '</td></tr>' +
      (g.intra ? '<tr><td>CGST</td><td class="ex-r">' + XU.inr2(g.cgst) + '</td></tr><tr><td>SGST</td><td class="ex-r">' + XU.inr2(g.sgst) + '</td></tr>'
        : '<tr><td>IGST</td><td class="ex-r">' + XU.inr2(g.igst) + '</td></tr>') +
      (g.shipping ? '<tr><td>Shipping charges</td><td class="ex-r">' + XU.inr2(g.shipping) + '</td></tr>' : '') +
      (g.codFee ? '<tr><td>COD handling fee</td><td class="ex-r">' + XU.inr2(g.codFee) + '</td></tr>' : '') +
      (Math.abs(g.round) >= 0.01 ? '<tr><td>Round off</td><td class="ex-r">' + (g.round > 0 ? '+' : '') + g.round.toFixed(2) + '</td></tr>' : '') +
      '<tr class="tot"><td>Grand total</td><td class="ex-r">' + XU.inr2(g.payable) + '</td></tr>';
    var logo = s.logo && /^data:|^http|\.(png|jpg|svg)/.test(s.logo) ? '<img src="' + s.logo + '" style="height:44px;margin-bottom:6px" alt="">' : '';
    return '<div class="ex-page">' +
      '<div class="ex-head ex-noprint"><div><a href="#/admin/invoices" class="ex-muted ex-small">← All invoices</a><h1>Invoice ' + XU.esc(invoiceNo(o)) + '</h1></div>' +
      '<div class="ex-actions"><button class="ex-btn" onclick="window.print()">🖨 Print</button>' +
      '<button class="ex-btn ex-primary" onclick="ERP.invoicePdf(\'' + o.id + '\')">⬇ Download PDF</button></div></div>' +
      '<div class="ex-invoice">' +
      '<div class="ex-inv-top"><div>' + logo + '<h2>' + XU.esc(XU.storeName()) + '</h2><div>' + XU.esc(s.legalName || '') + '</div>' +
      '<div>' + XU.esc(s.address || '') + (s.city ? ', ' + XU.esc(s.city) : '') + '</div>' +
      '<div>' + XU.esc(s.state || '') + (s.pincode ? ' – ' + XU.esc(s.pincode) : '') + '</div>' +
      '<div><b>GSTIN:</b> ' + XU.esc(s.gstin || '—') + (s.pan ? ' · <b>PAN:</b> ' + XU.esc(s.pan) : '') + '</div>' +
      (s.email || s.phone ? '<div>' + XU.esc(s.email || '') + ' ' + XU.esc(s.phone || '') + '</div>' : '') + '</div>' +
      '<div class="ex-inv-title"><h3>TAX INVOICE</h3><div class="ex-small ex-muted">Original for recipient</div>' +
      '<div style="margin-top:8px"><b>Invoice no:</b> ' + XU.esc(invoiceNo(o)) + '</div><div><b>Invoice date:</b> ' + XU.date(o.date) + '</div>' +
      '<div><b>Order ref:</b> ' + XU.esc(o.id) + '</div><div><b>Payment:</b> ' + XU.esc(o.payment || '—') + '</div></div></div>' +
      '<div class="ex-inv-parties"><div><h4>Bill to / Ship to</h4><b>' + XU.esc(a.name || XU.custName(o)) + '</b><div>' + XU.esc(a.line || '') + '</div>' +
      '<div>' + XU.esc(a.city || '') + (a.pincode ? ' – ' + XU.esc(a.pincode) : '') + '</div><div>' + XU.esc(a.state || '') + '</div>' +
      '<div>' + XU.esc(a.phone || c.phone || '') + '</div>' + (c.gstin ? '<div><b>GSTIN:</b> ' + XU.esc(c.gstin) + '</div>' : '<div class="ex-muted ex-small">Unregistered (B2C)</div>') + '</div>' +
      '<div><h4>Place of supply</h4><b>' + XU.esc(g.buyerState || s.state || '—') + '</b><div class="ex-small ex-muted">' +
      (g.intra ? 'Intra-state supply — CGST + SGST applicable' : 'Inter-state supply — IGST applicable') + '</div>' +
      '<div class="ex-small ex-muted" style="margin-top:6px">Reverse charge: No</div></div></div>' +
      XU.table(cols, rows) +
      '<div class="ex-inv-sum"><div style="flex:1;min-width:240px"><div class="ex-small ex-muted">Amount in words</div><b>' + XU.words(g.payable) + '</b>' +
      (o.coupon ? '<div class="ex-small ex-muted" style="margin-top:8px">Coupon ' + XU.esc(o.coupon) + ' applied · discount ' + XU.inr2(o.discount) + ' (included above)</div>' : '') +
      '</div><table>' + sumRows + '</table></div>' +
      '<div class="ex-inv-foot"><div>Goods once sold can be returned within 7 days as per return policy.<br>This is a computer-generated invoice.</div>' +
      '<div style="text-align:right">For <b>' + XU.esc(XU.storeName()) + '</b><br><br><br>Authorised Signatory</div></div>' +
      '</div></div>';
  }
  ERP.invoicePdf = function (id) {
    var o = XU.arr('orders').filter(function (x) { return String(x.id) === String(id); })[0];
    if (!o || !window.jspdf) { XU.toast('PDF library not loaded', 'error'); return; }
    var s = XU.settings(), g = gstCalc(o), a = o.address || {};
    var rs = function (n) { return 'Rs. ' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
    var doc = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4' }), W = 210;
    doc.setFontSize(16); doc.setFont(undefined, 'bold'); doc.text(XU.storeName(), 14, 18);
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    var sl = [s.address, [s.city, s.state, s.pincode].filter(Boolean).join(', '), 'GSTIN: ' + (s.gstin || '-')].filter(Boolean);
    doc.text(sl, 14, 24);
    doc.setFontSize(14); doc.setFont(undefined, 'bold'); doc.text('TAX INVOICE', W - 14, 18, { align: 'right' });
    doc.setFontSize(9); doc.setFont(undefined, 'normal');
    doc.text(['Invoice no: ' + invoiceNo(o), 'Date: ' + XU.date(o.date), 'Order: ' + o.id, 'Payment: ' + (o.payment || '-')], W - 14, 24, { align: 'right' });
    doc.line(14, 42, W - 14, 42);
    doc.setFont(undefined, 'bold'); doc.text('Bill to / Ship to', 14, 48); doc.text('Place of supply', 120, 48);
    doc.setFont(undefined, 'normal');
    doc.text([a.name || XU.custName(o), a.line || '', [a.city, a.pincode].filter(Boolean).join(' - '), a.state || '', a.phone || ''].filter(Boolean), 14, 53);
    doc.text([g.buyerState || s.state || '-', g.intra ? 'Intra-state: CGST + SGST' : 'Inter-state: IGST'], 120, 53);
    var head = ['#', 'Item', 'HSN', 'Qty', 'Rate', 'Taxable'].concat(g.intra ? ['CGST', 'SGST'] : ['IGST']).concat(['Amount']);
    var body = g.lines.map(function (l, i) {
      var r = [i + 1, l.name + (l.variant ? ' (' + l.variant + ')' : ''), l.hsn, l.qty, rs(l.unit), rs(l.taxable)];
      if (g.intra) r.push(rs(l.tax / 2) + ' @' + l.rate / 2 + '%', rs(l.tax / 2) + ' @' + l.rate / 2 + '%'); else r.push(rs(l.tax) + ' @' + l.rate + '%');
      r.push(rs(l.total)); return r;
    });
    doc.autoTable({ head: [head], body: body, startY: 78, styles: { fontSize: 8 }, headStyles: { fillColor: [31, 41, 55] } });
    var y = doc.lastAutoTable.finalY + 8;
    var sum = [['Taxable value', rs(g.taxable)]];
    if (g.intra) { sum.push(['CGST', rs(g.cgst)], ['SGST', rs(g.sgst)]); } else sum.push(['IGST', rs(g.igst)]);
    if (g.shipping) sum.push(['Shipping', rs(g.shipping)]);
    if (g.codFee) sum.push(['COD fee', rs(g.codFee)]);
    if (Math.abs(g.round) >= 0.01) sum.push(['Round off', g.round.toFixed(2)]);
    sum.push(['Grand total', rs(g.payable)]);
    doc.autoTable({ body: sum, startY: y, margin: { left: 120 }, theme: 'plain', styles: { fontSize: 9 },
      columnStyles: { 1: { halign: 'right' } }, didParseCell: function (d) { if (d.row.index === sum.length - 1) d.cell.styles.fontStyle = 'bold'; } });
    y = doc.lastAutoTable.finalY + 8;
    doc.setFont(undefined, 'bold'); doc.text('Amount in words:', 14, y); doc.setFont(undefined, 'normal');
    doc.text(doc.splitTextToSize(XU.words(g.payable), W - 28), 14, y + 5);
    doc.text('For ' + XU.storeName(), W - 14, y + 22, { align: 'right' }); doc.text('Authorised Signatory', W - 14, y + 36, { align: 'right' });
    doc.setFontSize(8); doc.setTextColor(120); doc.text('This is a computer-generated invoice.', 14, 287);
    doc.save(invoiceNo(o).replace(/\//g, '-') + '.pdf');
  };

  /* ---------------- Accounting ---------------- */
  var EXP_CATS = (App.data && App.data.expenseCategories) || ['Rent', 'Salaries', 'Shipping', 'Payment Gateway', 'Marketing', 'Packaging', 'Utilities', 'Software', 'Professional Fees', 'Miscellaneous'];
  var PAY_MODES = ['HDFC Current A/c', 'Bank Transfer (NEFT)', 'UPI', 'Corporate Card', 'Auto-deducted', 'Cash'];
  function renderAccounting() {
    var exps = XU.arr('expenses').slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    var orders = XU.arr('orders').filter(function (o) { return !XU.isCancelled(o); });
    var months = XU.lastMonths(6), inc = {}, cost = {}, ex = {};
    months.forEach(function (m) { inc[m] = 0; cost[m] = 0; ex[m] = 0; });
    orders.forEach(function (o) { var k = XU.monthKey(o.date); if (k in inc) { inc[k] += XU.orderNet(o); cost[k] += XU.orderCost(o); } });
    exps.forEach(function (e) { var k = XU.monthKey(e.date); if (k in ex) ex[k] += Number(e.amount) || 0; });
    var rev = 0, cogs = 0, opex = 0, byCat = {};
    months.forEach(function (m) { rev += inc[m]; cogs += cost[m]; opex += ex[m]; });
    exps.forEach(function (e) { if (months.indexOf(XU.monthKey(e.date)) >= 0) byCat[e.category] = (byCat[e.category] || 0) + (Number(e.amount) || 0); });
    var gp = rev - cogs, np = gp - opex;
    var pl = '<table class="ex-table"><tbody>' +
      '<tr><td>Revenue (net of GST & shipping)</td><td class="ex-r">' + XU.money(rev) + '</td></tr>' +
      '<tr><td>Cost of goods sold</td><td class="ex-r">− ' + XU.money(cogs) + '</td></tr>' +
      '<tr><td><b>Gross profit</b> <span class="ex-muted ex-small">' + (rev ? (gp / rev * 100).toFixed(1) : 0) + '% margin</span></td><td class="ex-r"><b>' + XU.money(gp) + '</b></td></tr>' +
      Object.keys(byCat).sort(function (a, b) { return byCat[b] - byCat[a]; }).map(function (k) {
        return '<tr><td class="ex-muted" style="padding-left:22px">' + XU.esc(k) + '</td><td class="ex-r ex-muted">− ' + XU.money(byCat[k]) + '</td></tr>';
      }).join('') +
      '<tr><td>Total operating expenses</td><td class="ex-r">− ' + XU.money(opex) + '</td></tr>' +
      '<tr><td><b>Net profit</b></td><td class="ex-r"><b style="color:' + (np >= 0 ? '#16a34a' : '#dc2626') + '">' + XU.money(np) + '</b></td></tr></tbody></table>';
    var cat = ERP.expCat;
    var shown = exps.filter(function (e) { return cat === 'all' || e.category === cat; });
    var cats = EXP_CATS.slice(); exps.forEach(function (e) { if (e.category && cats.indexOf(e.category) < 0) cats.push(e.category); });
    var rows = shown.map(function (e) {
      return [XU.date(e.date), XU.badge(e.category || 'Miscellaneous', 'grey'), XU.esc(e.vendor || '—'), XU.esc(e.description || e.note || ''),
        XU.esc(e.paidVia || e.paymentMode || 'Bank transfer'), '<b>' + XU.inr2(e.amount) + '</b>',
        '<button class="ex-btn ex-sm" onclick="ERP.editExpense(\'' + e.id + '\')">Edit</button> <button class="ex-btn ex-sm ex-danger" onclick="ERP.delExpense(\'' + e.id + '\')">✕</button>'];
    });
    XU.chart('ex-acc-chart', {
      type: 'bar',
      data: { labels: months.map(XU.monthLabel), datasets: [
        { label: 'Income', data: months.map(function (m) { return Math.round(inc[m]); }), backgroundColor: '#4f46e5', borderRadius: 4 },
        { label: 'Expenses (COGS + opex)', data: months.map(function (m) { return Math.round(cost[m] + ex[m]); }), backgroundColor: '#f59e0b', borderRadius: 4 },
        { label: 'Net profit', type: 'line', data: months.map(function (m) { return Math.round(inc[m] - cost[m] - ex[m]); }), borderColor: '#16a34a', backgroundColor: '#16a34a', tension: .3 }
      ] },
      options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: function (v) { return '₹' + Number(v).toLocaleString('en-IN'); } } } } }
    });
    return '<div class="ex-page">' + XU.head('Expenses & accounting', 'Last 6 months · ' + XU.monthLabel(months[0]) + ' – ' + XU.monthLabel(months[5]),
      '<button class="ex-btn" onclick="ERP.exportExpenses()">⬇ Export CSV</button><button class="ex-btn ex-primary" onclick="ERP.editExpense()">＋ Add expense</button>') +
      '<div class="ex-grid">' + XU.kpi('Income', XU.money(rev), 'net sales, 6 months') + XU.kpi('COGS', XU.money(cogs), 'product cost of sold items') +
      XU.kpi('Operating expenses', XU.money(opex), exps.length + ' expense entries') +
      XU.kpi('Net profit', '<span style="color:' + (np >= 0 ? '#16a34a' : '#dc2626') + '">' + XU.money(np) + '</span>', rev ? (np / rev * 100).toFixed(1) + '% net margin' : '') + '</div>' +
      '<div class="ex-grid2"><div class="ex-card"><h3>Income vs expenses</h3><div class="ex-chart"><canvas id="ex-acc-chart"></canvas></div></div>' +
      '<div class="ex-card"><h3>Profit & loss summary</h3>' + pl + '</div></div>' +
      '<div class="ex-card"><div class="ex-head" style="margin-bottom:10px"><h3 style="margin:0">Expenses</h3><div class="ex-bar">' +
      '<select class="ex-input" onchange="ERP.expCat=this.value;XU.rerender()"><option value="all">All categories</option>' +
      cats.map(function (c) { return '<option' + (c === cat ? ' selected' : '') + '>' + XU.esc(c) + '</option>'; }).join('') + '</select>' +
      '<input class="ex-input" placeholder="Search vendor…" oninput="XU.filterRows(this,\'ex-exp-table\')"></div></div>' +
      XU.table(['Date', 'Category', 'Vendor', 'Description', 'Paid via', { label: 'Amount', align: 'r' }, { label: '', align: 'r' }], rows,
        { id: 'ex-exp-table', foot: ['', '', '', '', 'Total', XU.inr2(shown.reduce(function (a, e) { return a + (Number(e.amount) || 0); }, 0)), ''] }) + '</div></div>';
  }
  ERP.editExpense = function (id) {
    var e = id ? XU.arr('expenses').filter(function (x) { return x.id === id; })[0] : {};
    XU.modal({
      title: id ? 'Edit expense' : 'Add expense', saveLabel: id ? 'Save' : 'Add expense',
      body: '<div class="ex-form">' +
        '<label>Category<select name="category">' + EXP_CATS.map(function (c) { return '<option' + (c === e.category ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select></label>' +
        '<label>Amount (₹)<input name="amount" type="number" min="1" step="0.01" required value="' + (e.amount || '') + '"></label>' +
        '<label>Vendor / payee<input name="vendor" required value="' + XU.esc(e.vendor || '') + '" placeholder="e.g. Delhivery Ltd"></label>' +
        '<label>Date<input name="date" type="date" value="' + XU.iso(e.date || Date.now()) + '"></label>' +
        '<label>Paid via<select name="mode">' + PAY_MODES.map(function (m) { return '<option' + (m === e.paidVia ? ' selected' : '') + '>' + m + '</option>'; }).join('') + '</select></label>' +
        '<label>Description<input name="note" value="' + XU.esc(e.description || e.note || '') + '"></label></div>',
      onSave: function (f) {
        var amt = Number(XU.val(f, 'amount'));
        if (!amt || !XU.val(f, 'vendor').trim()) { XU.toast('Amount and vendor are required', 'error'); return false; }
        if (!id) { e = { id: XU.uid('exp') }; XU.arr('expenses').unshift(e); }
        e.category = XU.val(f, 'category'); e.amount = amt; e.vendor = XU.val(f, 'vendor').trim();
        e.date = new Date(XU.val(f, 'date')).toISOString(); e.paidVia = XU.val(f, 'mode'); e.description = XU.val(f, 'note');
        XU.save(); XU.closeModal(); XU.toast(id ? 'Expense updated' : 'Expense of ' + XU.inr(amt) + ' recorded', 'success'); XU.rerender();
      }
    });
  };
  ERP.delExpense = function (id) {
    var list = XU.arr('expenses'), e = list.filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    list.splice(list.indexOf(e), 1); XU.save(); XU.toast('Expense deleted'); XU.rerender();
  };
  ERP.exportExpenses = function () {
    var rows = [['Date', 'Category', 'Vendor', 'Description', 'Paid via', 'Amount']];
    XU.arr('expenses').forEach(function (e) { rows.push([XU.iso(e.date), e.category, e.vendor, e.description || e.note || '', e.paidVia || '', e.amount]); });
    XU.csv('expenses-' + XU.iso() + '.csv', rows);
  };

  /* ---------------- Staff & roles ---------------- */
  var PERMS = [
    ['Dashboard', 1, 1, 1], ['Products & categories', 1, 1, 1], ['Orders & fulfilment', 1, 1, 1], ['Customers', 1, 1, 1],
    ['Coupons & marketing', 1, 1, 0], ['Inventory', 1, 1, 1], ['Purchases & suppliers', 1, 1, 0], ['Invoices', 1, 1, 1],
    ['Expenses & accounting', 1, 1, 0], ['Reports & exports', 1, 1, 0], ['Staff & roles', 1, 0, 0], ['Billing & plan', 1, 0, 0],
    ['Store settings', 1, 0, 0], ['Delete store data', 1, 0, 0]
  ];
  function staffStatus(u) { return u.status || (u.active === false ? 'Disabled' : 'Active'); }
  function renderStaff() {
    var staff = XU.arr('staff'), me = XU.me();
    var counts = { Owner: 0, Manager: 0, Staff: 0 };
    staff.forEach(function (u) { counts[u.role] = (counts[u.role] || 0) + 1; });
    var rows = staff.map(function (u) {
      var isMe = u.id === me.id;
      var initials = (u.name || '?').split(' ').map(function (x) { return x[0]; }).join('').slice(0, 2).toUpperCase();
      return ['<div class="ex-prod"><span class="ex-thumb" style="background:#ede9fe;color:#6d28d9;font-size:12px;font-weight:700;border-radius:50%">' + initials + '</span><div><b>' +
        XU.esc(u.name) + '</b>' + (isMe ? ' <span class="ex-muted ex-small">(you)</span>' : '') + '<div class="ex-muted ex-small">' + XU.esc(u.email || '') + '</div></div></div>',
        XU.esc(u.title || '—') + '<div class="ex-muted ex-small">' + XU.esc(u.phone || '') + '</div>', XU.badge(u.role || 'Staff'), XU.badge(staffStatus(u)), u.lastLogin || u.lastActive ? XU.date(u.lastLogin || u.lastActive) : '<span class="ex-muted">Never</span>',
        '<button class="ex-btn ex-sm" onclick="ERP.editStaff(\'' + u.id + '\')">Edit</button> ' +
        (isMe ? '' : '<button class="ex-btn ex-sm ex-danger" onclick="ERP.delStaff(\'' + u.id + '\')">Remove</button>')];
    });
    var tick = function (v) { return v ? '<span class="ex-tick">✓</span>' : '<span class="ex-cross">—</span>'; };
    var matrix = XU.table(['Module', { label: 'Owner', align: 'c' }, { label: 'Manager', align: 'c' }, { label: 'Staff', align: 'c' }],
      PERMS.map(function (p) { return [p[0], tick(p[1]), tick(p[2]), tick(p[3])]; }));
    return '<div class="ex-page">' + XU.head('Staff & roles', 'Invite your team and control what each role can access',
      '<button class="ex-btn ex-primary" onclick="ERP.editStaff()">＋ Invite staff</button>') +
      '<div class="ex-grid">' + XU.kpi('Team members', staff.length, staff.filter(function (u) { return /invit/i.test(staffStatus(u)); }).length + ' pending invites') +
      XU.kpi('Owners', counts.Owner) + XU.kpi('Managers', counts.Manager) + XU.kpi('Staff', counts.Staff) + '</div>' +
      '<div class="ex-card"><h3>Users</h3>' + XU.table(['Name', 'Title / phone', 'Role', 'Status', 'Last active', { label: '', align: 'r' }], rows) + '</div>' +
      '<div class="ex-card"><h3>Permission matrix</h3><p class="ex-muted ex-small" style="margin-top:-6px">Role permissions are fixed on your current plan. Custom roles are available on Enterprise.</p>' + matrix + '</div></div>';
  }
  ERP.editStaff = function (id) {
    var u = id ? XU.arr('staff').filter(function (x) { return x.id === id; })[0] : {};
    XU.modal({
      title: id ? 'Edit team member' : 'Invite team member', saveLabel: id ? 'Save' : 'Send invite',
      body: '<div class="ex-form"><label>Full name<input name="name" required value="' + XU.esc(u.name || '') + '"></label>' +
        '<label>Email<input name="email" type="email" required value="' + XU.esc(u.email || '') + '"></label>' +
        '<label>Phone<input name="phone" value="' + XU.esc(u.phone || '+91 ') + '"></label>' +
        '<label>Job title<input name="title" value="' + XU.esc(u.title || '') + '" placeholder="e.g. Catalogue Executive"></label>' +
        '<label>Role<select name="role">' + ['Owner', 'Manager', 'Staff'].map(function (r) { return '<option' + (r === (u.role || 'Staff') ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>' +
        (id ? '<label>Status<select name="status">' + ['Active', 'Invited', 'Disabled'].map(function (r) { return '<option' + (r === staffStatus(u) ? ' selected' : '') + '>' + r + '</option>'; }).join('') + '</select></label>' : '') +
        '</div><p class="ex-muted ex-small">Managers can run day-to-day operations; Staff handle catalogue and orders only.</p>',
      onSave: function (f) {
        var name = XU.val(f, 'name').trim(), email = XU.val(f, 'email').trim();
        if (!name || !email) { XU.toast('Name and email are required', 'error'); return false; }
        if (!id) { u = { id: XU.uid('u'), status: 'Invited', active: true }; XU.arr('staff').push(u); }
        var newRole = XU.val(f, 'role');
        if (u.role === 'Owner' && newRole !== 'Owner' && XU.arr('staff').filter(function (x) { return x.role === 'Owner'; }).length < 2) {
          XU.toast('A store must have at least one Owner', 'error'); return false;
        }
        u.name = name; u.email = email; u.phone = XU.val(f, 'phone'); u.title = XU.val(f, 'title'); u.role = newRole;
        if (id) { u.status = XU.val(f, 'status'); u.active = u.status !== 'Disabled'; }
        XU.save(); XU.closeModal(); XU.toast(id ? 'Team member updated' : 'Invite sent to ' + email, 'success'); XU.rerender();
      }
    });
  };
  ERP.delStaff = function (id) {
    var list = XU.arr('staff'), u = list.filter(function (x) { return x.id === id; })[0];
    if (!u) return;
    if (u.role === 'Owner' && list.filter(function (x) { return x.role === 'Owner'; }).length < 2) { XU.toast('Cannot remove the only Owner', 'error'); return; }
    list.splice(list.indexOf(u), 1); XU.save(); XU.toast(u.name + ' removed'); XU.rerender();
  };

  /* ---------------- Registration ---------------- */
  var ALL = ['Owner', 'Manager', 'Staff'];
  function init() {
  XU.route('#/admin/inventory', renderInventory, ALL);
  XU.route('#/admin/purchases', renderPurchases, MGR);
  XU.route('#/admin/suppliers', renderSuppliers, MGR);
  XU.route('#/admin/invoices', renderInvoices, ALL);
  XU.route('#/admin/invoices/:orderId', renderInvoice, ALL);
  XU.route('#/admin/accounting', renderAccounting, MGR);
  XU.route('#/admin/staff', renderStaff, ['Owner']);

  XU.nav('#/admin/inventory', 'Inventory', '📦', 'ERP', ALL);
  XU.nav('#/admin/purchases', 'Purchase Orders', '🧾', 'ERP', MGR);
  XU.nav('#/admin/suppliers', 'Suppliers', '🚚', 'ERP', MGR);
  XU.nav('#/admin/invoices', 'Sales & Invoices', '🧮', 'Accounting', ALL);
  XU.nav('#/admin/accounting', 'Expenses & P&L', '📒', 'Accounting', MGR);
  XU.nav('#/admin/staff', 'Staff & Roles', '🔐', 'SaaS', ['Owner']);
  }
  if (window.App && App.router && App.adminNav) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
