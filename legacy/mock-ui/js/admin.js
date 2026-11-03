/* admin.js — Admin panel: Dashboard, Products, Categories, Orders, Customers, Coupons.
   Classic script, global namespace. Depends on App (core.js) and Chart (Chart.js). */
(function () {
  'use strict';

  var ROLES = App.data.roles; // ['Owner', 'Manager', 'Staff'] — all see these pages
  var STATUSES = ['pending', 'shipped', 'delivered', 'returned'];
  var DAY = 864e5;

  var ui = { range: 30, prodQ: '', prodCat: '', prodStock: '', orderTab: 'all', orderQ: '', custQ: '' };

  /* ---------- small helpers ---------- */
  function S() { return App.state; }
  var esc = App.ui.esc;
  function inr(v) { return App.fmt.inr(v); }
  function fdate(v) { return App.fmt.date(v); }
  function num(v) { return App.fmt.num(v); }
  function byId(list, id) { for (var i = 0; i < (list || []).length; i++) if (list[i].id === id) return list[i]; return null; }
  function product(id) { return App.store.product(id); }
  function category(id) { return App.store.category(id); }
  function customer(id) { return App.store.customer(id); }
  function lowThreshold() { return S().settings.lowStockThreshold || 10; }
  function save() { App.store.save(); }
  function toast(msg, kind) { App.ui.toast(msg, kind); }
  function custName(o) { var c = customer(o.customerId); return c ? c.name : (o.address && o.address.name) || 'Guest'; }
  function statusBadge(s) { return App.ui.badge(cap(s)); } // core auto-maps status -> badge kind
  function cap(s) { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); }
  function fv(form, name) { var el = form.querySelector('[name="' + name + '"]'); if (!el) return ''; return el.type === 'checkbox' ? el.checked : el.value.trim(); }
  function list(str) { return String(str || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean); }
  function uid(p) { return App.store.uid(p); }
  function rerender() { App.router.refresh(); }

  function tbl(headers, rows, empty) {
    if (!rows.length) return '<div class="adm-empty">' + esc(empty || 'Nothing matches these filters.') + '</div>';
    return '<div class="table-wrap"><table class="table adm-table"><thead><tr>' +
      headers.map(function (h) { return '<th>' + h + '</th>'; }).join('') + '</tr></thead><tbody>' +
      rows.join('') + '</tbody></table></div>';
  }
  function tr(cells, onclick) {
    return '<tr' + (onclick ? ' class="adm-click" onclick="' + onclick + '"' : '') + '>' +
      cells.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
  }
  function nav(hash) { return "App.router.go('" + hash + "')"; }
  function head(title, sub, actions) {
    return '<div class="adm-head"><div><h1 class="adm-title">' + title + '</h1>' +
      (sub ? '<p class="adm-sub">' + sub + '</p>' : '') + '</div><div class="adm-actions">' + (actions || '') + '</div></div>';
  }
  function btn(label, onclick, cls) { return '<button type="button" class="btn ' + (cls || '') + '" onclick="' + onclick + '">' + label + '</button>'; }
  function stockBadge(p) { return App.ui.stockBadge(p); }
  function needsReorder(p) { return p.stock <= 0 || App.store.isLow(p); }
  function field(label, html, wide) { return '<label class="adm-field' + (wide ? ' adm-wide' : '') + '"><span>' + label + '</span>' + html + '</label>'; }
  function input(name, val, type, attrs) { return '<input class="input" name="' + name + '" type="' + (type || 'text') + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '>'; }
  function select(name, opts, val) {
    return '<select class="input" name="' + name + '">' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '"' + (String(o[0]) === String(val) ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select>';
  }

  /* Inline delete confirmation (replaces the button's cell content). */
  function askDelete(el, kind, id) {
    var cell = el.parentNode;
    cell.setAttribute('data-orig', cell.innerHTML);
    cell.innerHTML = '<span class="adm-confirm">Delete? ' +
      '<button type="button" class="btn btn-sm btn-danger" onclick="event.stopPropagation();App.admin.doDelete(\'' + kind + '\',\'' + id + '\')">Yes</button> ' +
      '<button type="button" class="btn btn-sm" onclick="event.stopPropagation();var c=this.closest(\'[data-orig]\');c.innerHTML=c.getAttribute(\'data-orig\')">No</button></span>';
  }

  function doDelete(kind, id) {
    var st = S();
    if (kind === 'product') {
      var p = product(id);
      st.products = st.products.filter(function (x) { return x.id !== id; });
      save(); toast('Deleted ' + (p ? p.name : 'product'), 'success'); refreshProducts();
    } else if (kind === 'category') {
      var n = st.products.filter(function (p) { return p.categoryId === id; }).length;
      if (n) { toast('Move or delete its ' + n + ' products first', 'error'); rerender(); return; }
      st.categories = st.categories.filter(function (x) { return x.id !== id; });
      save(); toast('Category deleted', 'success'); rerender();
    } else if (kind === 'coupon') {
      st.coupons = st.coupons.filter(function (x) { return x.id !== id; });
      save(); toast('Coupon deleted', 'success'); rerender();
    }
  }

  /* ---------- metrics (net revenue ex-GST; returned orders count as 0 — see App.store.orderNet) ---------- */
  function ordersBetween(from, to) {
    return S().orders.filter(function (o) { var t = +new Date(o.date); return t > from && t <= to; });
  }
  function metrics(orders) {
    var revenue = 0, profit = 0, valid = 0;
    orders.forEach(function (o) {
      revenue += App.store.orderNet(o);
      profit += App.store.orderProfit(o);
      if (o.status !== 'returned') valid++;
    });
    return { revenue: revenue, orders: orders.length, profit: profit, aov: valid ? revenue / valid : 0 };
  }
  function delta(cur, prev) {
    if (!prev) return '';
    var d = (cur - prev) / Math.abs(prev) * 100;
    return '<span class="adm-delta ' + (d >= 0 ? 'up' : 'down') + '">' + (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d).toFixed(1) + '%</span> vs prev ' + ui.range + 'd';
  }

  /* ---------- Dashboard ---------- */
  function dashboard() {
    var r = ui.range, end = Date.now(), start = end - r * DAY;
    var cur = ordersBetween(start, end), prev = ordersBetween(start - r * DAY, start);
    var m = metrics(cur), pm = metrics(prev);
    var low = S().products.filter(needsReorder).sort(function (a, b) { return a.stock - b.stock; });
    var outCount = low.filter(function (p) { return p.stock <= 0; }).length;

    // Sales trend (daily buckets, net revenue)
    var labels = [], sales = [], idx = {};
    for (var i = r - 1; i >= 0; i--) {
      var d = new Date(end - i * DAY);
      idx[App.fmt.ymd(d)] = labels.length;
      labels.push(d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
      sales.push(0);
    }
    var prodRev = {}, catRev = {}, statusCnt = { pending: 0, shipped: 0, delivered: 0, returned: 0 };
    cur.forEach(function (o) {
      statusCnt[o.status] = (statusCnt[o.status] || 0) + 1;
      if (o.status === 'returned') return;
      var k = App.fmt.ymd(o.date);
      if (idx[k] != null) sales[idx[k]] += App.store.orderNet(o);
      o.items.forEach(function (it) {
        var amt = it.qty * it.price;
        prodRev[it.productId] = (prodRev[it.productId] || { name: it.name, v: 0 });
        prodRev[it.productId].v += amt;
        var p = product(it.productId), c = p && category(p.categoryId), cn = c ? c.name : 'Other';
        catRev[cn] = catRev[cn] || { v: 0, color: c && c.color };
        catRev[cn].v += amt;
      });
    });
    var top = Object.keys(prodRev).map(function (k) { return prodRev[k]; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 5);
    var cats = Object.keys(catRev).sort(function (a, b) { return catRev[b].v - catRev[a].v; });
    var pal = App.ui.palette;

    App.onRender.push(function () {
      var money = function (v) { return App.fmt.inr(v); };
      var base = { responsive: true, maintainAspectRatio: false };
      App.ui.chart('adm-ch-sales', {
        type: 'line',
        data: { labels: labels, datasets: [{ label: 'Net sales', data: sales.map(Math.round), borderColor: pal[0], backgroundColor: 'rgba(79,70,229,.12)', fill: true, tension: .35, pointRadius: r > 30 ? 0 : 2, borderWidth: 2 }] },
        options: Object.assign({}, base, { scales: { y: { beginAtZero: true, ticks: { callback: money } }, x: { ticks: { maxTicksLimit: 10 } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return money(c.parsed.y); } } } } })
      });
      App.ui.chart('adm-ch-top', {
        type: 'bar',
        data: { labels: top.map(function (t) { return t.name.length > 24 ? t.name.slice(0, 23) + '…' : t.name; }),
          datasets: [{ data: top.map(function (t) { return Math.round(t.v); }), backgroundColor: pal[0], borderRadius: 6 }] },
        options: Object.assign({}, base, { indexAxis: 'y', scales: { x: { beginAtZero: true, ticks: { callback: money } } },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return money(c.parsed.x); } } } } })
      });
      App.ui.chart('adm-ch-cat', {
        type: 'doughnut',
        data: { labels: cats, datasets: [{ data: cats.map(function (c) { return Math.round(catRev[c].v); }),
          backgroundColor: cats.map(function (c, i) { return catRev[c].color || pal[i % pal.length]; }), borderWidth: 0 }] },
        options: Object.assign({}, base, { cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } },
          tooltip: { callbacks: { label: function (c) { return c.label + ': ' + money(c.parsed); } } } } })
      });
      App.ui.chart('adm-ch-status', {
        type: 'doughnut',
        data: { labels: STATUSES.map(cap), datasets: [{ data: STATUSES.map(function (s) { return statusCnt[s]; }),
          backgroundColor: STATUSES.map(function (s) { return App.ui.statusColors[s]; }), borderWidth: 0 }] },
        options: Object.assign({}, base, { cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10 } } } })
      });
    });

    var recent = S().orders.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).slice(0, 8);
    var user = S().currentUser || {};

    return head('Dashboard', 'Welcome back' + (user.name ? ', ' + esc(user.name.split(' ')[0]) : '') + ' — here is how ' + esc(S().settings.storeName) + ' is doing.',
      App.ui.rangePills(r, 'admRange')) +
      '<div class="adm-kpis">' +
      App.ui.kpi('Net revenue', inr(m.revenue), delta(m.revenue, pm.revenue)) +
      App.ui.kpi('Orders', num(m.orders), delta(m.orders, pm.orders)) +
      App.ui.kpi('Gross profit', inr(m.profit), (m.revenue ? (m.profit / m.revenue * 100).toFixed(1) + '% margin after cost of goods' : '')) +
      App.ui.kpi('Avg. order value', inr(m.aov), delta(m.aov, pm.aov)) +
      App.ui.kpi('Low / out of stock', num(low.length), low.length ? outCount + ' out of stock · <a href="#/admin/products" onclick="App.admin.filterLow()">Review →</a>' : 'All items well stocked', low.length ? 'warning' : '') +
      '</div>' +
      '<div class="adm-grid adm-grid-3">' +
      '<div class="card adm-card adm-span-2"><h3>Sales trend <small>net revenue, last ' + r + ' days</small></h3><div class="adm-chart"><canvas id="adm-ch-sales"></canvas></div></div>' +
      '<div class="card adm-card"><h3>Sales by category</h3><div class="adm-chart"><canvas id="adm-ch-cat"></canvas></div></div>' +
      '<div class="card adm-card adm-span-2"><h3>Top 5 products <small>by revenue</small></h3><div class="adm-chart"><canvas id="adm-ch-top"></canvas></div></div>' +
      '<div class="card adm-card"><h3>Order status</h3><div class="adm-chart"><canvas id="adm-ch-status"></canvas></div></div>' +
      '</div>' +
      '<div class="adm-grid adm-grid-3">' +
      '<div class="card adm-card adm-span-2"><h3>Recent orders <a class="adm-link" href="#/admin/orders">View all →</a></h3>' +
      tbl(['Order', 'Customer', 'Date', 'Status', 'Total'], recent.map(function (o) {
        return tr(['<b>' + esc(o.id) + '</b>', esc(custName(o)), fdate(o.date), statusBadge(o.status), inr(o.total)], nav('#/admin/orders/' + o.id));
      }), 'No orders yet.') + '</div>' +
      '<div class="card adm-card"><h3>Low stock <small>≤ ' + lowThreshold() + ' units</small></h3>' +
      (low.length ? '<ul class="adm-low">' + low.slice(0, 8).map(function (p) {
        return '<li onclick="App.admin.editProduct(\'' + p.id + '\')">' + App.ui.productThumb(p, 'sm') +
          '<div><b>' + esc(p.name) + '</b><small>' + esc(p.sku) + '</small></div>' + stockBadge(p) + '</li>';
      }).join('') + '</ul>' : '<div class="adm-empty">All products are above the reorder level.</div>') + '</div>' +
      '</div>';
  }

  /* ---------- Products ---------- */
  function filteredProducts() {
    var q = ui.prodQ.toLowerCase();
    return S().products.filter(function (p) {
      if (ui.prodCat && p.categoryId !== ui.prodCat) return false;
      if (ui.prodStock === 'out' && p.stock > 0) return false;
      if (ui.prodStock === 'low' && !App.store.isLow(p)) return false;
      if (ui.prodStock === 'in' && needsReorder(p)) return false;
      if (q && (p.name + ' ' + p.sku + ' ' + (p.hsn || '')).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function productsTable() {
    var rows = filteredProducts();
    return '<div class="adm-count">' + rows.length + ' of ' + S().products.length + ' products</div>' +
      tbl(['', 'Product', 'SKU', 'Category', 'Price', 'Stock', ''], rows.map(function (p) {
        var c = category(p.categoryId);
        return tr([
          App.ui.productThumb(p, 'sm'),
          '<b>' + esc(p.name) + '</b>' + (p.featured ? ' ' + App.ui.badge('Featured', 'info') : '') + '<div class="adm-muted">HSN ' + esc(p.hsn || '—') + ' · GST ' + (p.gst || 0) + '%</div>',
          '<code>' + esc(p.sku) + '</code>',
          esc(c ? c.name : '—'),
          inr(p.price) + (p.mrp > p.price ? '<div class="adm-muted"><s>' + inr(p.mrp) + '</s></div>' : ''),
          stockBadge(p),
          '<span class="adm-row-actions" onclick="event.stopPropagation()">' + btn('Edit', "App.admin.editProduct('" + p.id + "')", 'btn-sm') +
            ' ' + btn('Delete', "App.admin.askDelete(this,'product','" + p.id + "')", 'btn-sm btn-ghost-danger') + '</span>'
        ], "App.admin.editProduct('" + p.id + "')");
      }));
  }
  function refreshProducts() {
    var el = document.getElementById('adm-products-list');
    if (el) el.innerHTML = productsTable(); else rerender();
  }
  function productsPage() {
    var cats = [['', 'All categories']].concat(S().categories.map(function (c) { return [c.id, c.name]; }));
    return head('Products', S().products.length + ' products in catalog', btn('+ Add product', 'App.admin.editProduct()', 'btn-primary')) +
      '<div class="card adm-card"><div class="adm-toolbar">' +
      '<input class="input adm-search" placeholder="Search name, SKU or HSN…" value="' + esc(ui.prodQ) + '" oninput="App.admin.setF(\'prodQ\',this.value)">' +
      select('pcat', cats, ui.prodCat).replace('<select', '<select onchange="App.admin.setF(\'prodCat\',this.value)"') +
      select('pstock', [['', 'All stock'], ['in', 'In stock'], ['low', 'Low stock'], ['out', 'Out of stock']], ui.prodStock).replace('<select', '<select onchange="App.admin.setF(\'prodStock\',this.value)"') +
      '</div><div id="adm-products-list">' + productsTable() + '</div></div>';
  }
  function setF(key, val) {
    ui[key] = val;
    if (key.indexOf('prod') === 0) refreshProducts();
    else if (key === 'orderQ') { var el = document.getElementById('adm-orders-list'); if (el) el.innerHTML = ordersTable(); }
    else if (key === 'custQ') { var el2 = document.getElementById('adm-cust-list'); if (el2) el2.innerHTML = customersTable(); }
  }

  function editProduct(id) {
    var p = id ? product(id) : null, isNew = !p;
    var d = p || { name: '', sku: '', hsn: '', gst: 12, categoryId: (S().categories[0] || {}).id, price: '', mrp: '', cost: '', stock: 0, variants: { sizes: [], colors: [] }, color: '#6366f1', emoji: '🛍️', featured: false, description: '' };
    var v = d.variants || {};
    var body = '<div class="adm-form">' +
      field('Product name', input('name', d.name, 'text', 'required'), true) +
      field('SKU', input('sku', d.sku)) +
      field('HSN code', input('hsn', d.hsn)) +
      field('GST %', select('gst', [[0, '0%'], [5, '5%'], [12, '12%'], [18, '18%'], [28, '28%']], d.gst)) +
      field('Category', select('categoryId', S().categories.map(function (c) { return [c.id, c.name]; }), d.categoryId)) +
      field('Selling price (₹)', input('price', d.price, 'number', 'min="0" step="1"')) +
      field('MRP (₹)', input('mrp', d.mrp, 'number', 'min="0" step="1"')) +
      field('Cost price (₹)', input('cost', d.cost, 'number', 'min="0" step="1"')) +
      field('Stock (units)', input('stock', d.stock, 'number', 'min="0" step="1"')) +
      field('Image colour', input('color', d.color || '#6366f1', 'color')) +
      field('Emoji', input('emoji', d.emoji, 'text', 'maxlength="4"')) +
      field('Sizes (comma separated)', input('sizes', (v.sizes || []).join(', '), 'text', 'placeholder="S, M, L, XL"')) +
      field('Colours (comma separated)', input('colors', (v.colors || []).join(', '), 'text', 'placeholder="Indigo, Maroon"')) +
      field('Description', '<textarea class="input" name="description" rows="3">' + esc(d.description) + '</textarea>', true) +
      '<label class="adm-check adm-wide"><input type="checkbox" name="featured"' + (d.featured ? ' checked' : '') + '> Feature on storefront home page</label>' +
      '</div>';
    App.ui.modal({
      title: isNew ? 'Add product' : 'Edit ' + d.name,
      saveLabel: isNew ? 'Add product' : 'Save changes',
      body: body,
      onSave: function (f) {
        var name = fv(f, 'name'), price = +fv(f, 'price');
        if (!name) { toast('Product name is required', 'error'); return false; }
        if (!(price > 0)) { toast('Enter a valid selling price', 'error'); return false; }
        var sku = fv(f, 'sku') || ('SKU-' + Math.random().toString(36).slice(2, 7).toUpperCase());
        var dupe = S().products.some(function (x) { return x.sku === sku && x !== p; });
        if (dupe) { toast('SKU ' + sku + ' already exists', 'error'); return false; }
        var target = p || { id: uid('p'), stockByWh: {}, stock: 0, rating: 4.5, reviews: 0, active: true };
        var newStock = Math.max(0, parseInt(fv(f, 'stock'), 10) || 0);
        if (isNew) target.stock = newStock; // save() -> recalc seeds the first warehouse from p.stock
        else App.store.setStock(target, newStock);
        Object.assign(target, {
          name: name, sku: sku, hsn: fv(f, 'hsn'), gst: +fv(f, 'gst'), categoryId: fv(f, 'categoryId'),
          price: price, mrp: +fv(f, 'mrp') || price, cost: +fv(f, 'cost') || Math.round(price * 0.55),
          color: fv(f, 'color'), emoji: fv(f, 'emoji') || '🛍️', featured: fv(f, 'featured'), description: fv(f, 'description'),
          variants: { sizes: list(fv(f, 'sizes')), colors: list(fv(f, 'colors')) },
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
        });
        if (isNew) S().products.unshift(target);
        save();
        toast(isNew ? name + ' added' : name + ' updated', 'success');
        if (document.getElementById('adm-products-list')) refreshProducts(); else rerender();
      }
    });
  }

  /* ---------- Categories ---------- */
  function categoriesPage() {
    var st = S();
    return head('Categories', st.categories.length + ' categories', btn('+ Add category', 'App.admin.editCategory()', 'btn-primary')) +
      '<div class="card adm-card">' +
      tbl(['Category', 'Description', 'Products', 'Stock value', ''], st.categories.map(function (c) {
        var ps = st.products.filter(function (p) { return p.categoryId === c.id; });
        var val = ps.reduce(function (s, p) { return s + (p.cost || 0) * (p.stock || 0); }, 0);
        return tr([
          '<span class="adm-cat-ico">' + esc(c.emoji || '🏷️') + '</span> <b>' + esc(c.name) + '</b>',
          '<span class="adm-muted">' + esc(c.description || '—') + '</span>',
          '<a href="#/admin/products" onclick="App.admin.filterCat(\'' + c.id + '\')">' + ps.length + ' products</a>',
          inr(val),
          '<span class="adm-row-actions">' + btn('Edit', "App.admin.editCategory('" + c.id + "')", 'btn-sm') +
            ' ' + btn('Delete', "App.admin.askDelete(this,'category','" + c.id + "')", 'btn-sm btn-ghost-danger') + '</span>'
        ]);
      }), 'No categories yet — add your first one.') + '</div>';
  }
  function editCategory(id) {
    var c = id ? category(id) : null, isNew = !c, d = c || { name: '', emoji: '🏷️', color: '#6366f1', description: '' };
    App.ui.modal({
      title: isNew ? 'Add category' : 'Edit category',
      saveLabel: isNew ? 'Add category' : 'Save',
      body: '<div class="adm-form">' + field('Name', input('name', d.name), true) + field('Emoji', input('emoji', d.emoji, 'text', 'maxlength="4"')) +
        field('Colour', input('color', d.color || '#6366f1', 'color')) +
        field('Description', input('description', d.description), true) + '</div>',
      onSave: function (f) {
        var name = fv(f, 'name');
        if (!name) { toast('Category name is required', 'error'); return false; }
        var t = c || { id: uid('c') };
        Object.assign(t, { name: name, emoji: fv(f, 'emoji') || '🏷️', color: fv(f, 'color'), description: fv(f, 'description'), slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') });
        if (isNew) S().categories.push(t);
        save(); toast('Category saved', 'success'); rerender();
      }
    });
  }

  /* ---------- Orders ---------- */
  function filteredOrders() {
    var q = ui.orderQ.toLowerCase();
    return S().orders.filter(function (o) {
      if (ui.orderTab !== 'all' && o.status !== ui.orderTab) return false;
      if (!q) return true;
      var a = o.address || {};
      return (o.id + ' ' + custName(o) + ' ' + (a.city || '') + ' ' + (a.phone || '') + ' ' + (o.payment || '')).toLowerCase().indexOf(q) >= 0;
    }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
  }
  function ordersTable() {
    var rows = filteredOrders(), shown = rows.slice(0, 150);
    return '<div class="adm-count">' + rows.length + ' orders' + (rows.length > shown.length ? ' · showing latest 150' : '') + '</div>' +
      tbl(['Order', 'Date', 'Customer', 'City', 'Items', 'Payment', 'Status', 'Total'], shown.map(function (o) {
        var n = (o.items || []).reduce(function (s, i) { return s + i.qty; }, 0);
        return tr(['<b>' + esc(o.id) + '</b>', fdate(o.date), esc(custName(o)), esc((o.address || {}).city || '—'), n, esc(o.payment || '—'), statusBadge(o.status), '<b>' + inr(o.total) + '</b>'],
          nav('#/admin/orders/' + o.id));
      }), 'No orders match.');
  }
  function ordersPage() {
    var all = S().orders, counts = { all: all.length };
    STATUSES.forEach(function (s) { counts[s] = all.filter(function (o) { return o.status === s; }).length; });
    var tabs = ['all'].concat(STATUSES).map(function (s) {
      return '<button type="button" class="adm-tab' + (ui.orderTab === s ? ' active' : '') + '" onclick="App.admin.setTab(\'' + s + '\')">' + cap(s) + ' <span>' + counts[s] + '</span></button>';
    }).join('');
    return head('Orders', counts.pending + ' orders awaiting dispatch', btn('Export CSV', 'App.admin.exportOrders()')) +
      '<div class="card adm-card"><div class="adm-tabs">' + tabs + '</div><div class="adm-toolbar">' +
      '<input class="input adm-search" placeholder="Search order #, customer, city, phone…" value="' + esc(ui.orderQ) + '" oninput="App.admin.setF(\'orderQ\',this.value)"></div>' +
      '<div id="adm-orders-list">' + ordersTable() + '</div></div>';
  }
  function exportOrders() {
    var rows = filteredOrders().map(function (o) {
      return { Order: o.id, Date: o.date.slice(0, 10), Customer: custName(o), City: (o.address || {}).city, Status: o.status, Payment: o.payment, Subtotal: o.subtotal, Discount: o.discount, Shipping: o.shipping, Tax: o.tax, Total: o.total };
    });
    App.ui.csv('orders.csv', rows);
  }

  var TL_LABEL = { pending: 'Order placed', shipped: 'Shipped', delivered: 'Delivered', returned: 'Returned & refunded' };

  function orderDetail(params) {
    var o = App.store.order(params.id);
    if (!o) return head('Order not found', 'It may have been removed.', btn('← Back to orders', nav('#/admin/orders')));
    var a = o.address || {}, c = customer(o.customerId), tl = o.history || [];
    var actions = btn('← Orders', nav('#/admin/orders')) +
      ' <a class="btn" href="#/admin/invoices/' + esc(o.id) + '">🧾 Invoice</a>';
    if (o.status === 'pending') actions += ' ' + btn('Mark as shipped', "App.admin.setStatus('" + o.id + "','shipped')", 'btn-primary');
    if (o.status === 'shipped') actions += ' ' + btn('Mark as delivered', "App.admin.setStatus('" + o.id + "','delivered')", 'btn-primary');
    if (o.status === 'shipped' || o.status === 'delivered') actions += ' ' + btn('Mark returned', "App.admin.setStatus('" + o.id + "','returned')", 'btn-ghost-danger');

    var items = tbl(['', 'Item', 'Variant', 'Qty', 'Price', 'Amount'], (o.items || []).map(function (it) {
      var p = product(it.productId);
      return tr([p ? App.ui.productThumb(p, 'sm') : '', '<b>' + esc(it.name) + '</b>' + (p ? '<div class="adm-muted">' + esc(p.sku) + '</div>' : ''), esc(it.variant || '—'), it.qty, inr(it.price), inr(it.qty * it.price)]);
    }));
    var totals = '<div class="adm-totals">' +
      '<div><span>Subtotal</span><span>' + inr(o.subtotal) + '</span></div>' +
      (o.discount ? '<div><span>Discount' + (o.coupon ? ' (' + esc(o.coupon) + ')' : '') + '</span><span>− ' + inr(o.discount) + '</span></div>' : '') +
      '<div><span>Shipping</span><span>' + (o.shipping ? inr(o.shipping) : 'Free') + '</span></div>' +
      (o.codFee ? '<div><span>COD fee</span><span>' + inr(o.codFee) + '</span></div>' : '') +
      '<div class="adm-muted"><span>incl. GST</span><span>' + App.fmt.inr2(o.tax) + '</span></div>' +
      '<div class="adm-grand"><span>Total</span><span>' + inr(o.total) + '</span></div></div>';
    var tlHtml = '<ol class="adm-timeline">' + tl.map(function (e) {
      return '<li class="done"><b>' + esc(TL_LABEL[e.status] || cap(e.status)) + '</b><small>' + App.fmt.dateTime(e.at) + (e.note ? ' · ' + esc(e.note) : '') + '</small></li>';
    }).join('') + (o.status === 'pending' ? '<li><b>Awaiting dispatch</b><small>Ship within 24 hrs</small></li>' : '') +
      (o.status === 'shipped' ? '<li><b>Out for delivery</b><small>Expected in 2–3 days</small></li>' : '') + '</ol>';

    return head('Order ' + esc(o.id) + ' ' + statusBadge(o.status), 'Placed ' + App.fmt.dateTime(o.date) + ' · ' + esc(o.payment) + ' · ' + esc(o.paymentStatus || '') + ' · Profit ' + inr(App.store.orderProfit(o)), actions) +
      '<div class="adm-grid adm-grid-3">' +
      '<div class="card adm-card adm-span-2"><h3>Items</h3>' + items + totals + '</div>' +
      '<div><div class="card adm-card"><h3>Customer</h3>' +
      '<p><b>' + (c ? '<a href="#/admin/customers/' + esc(c.id) + '">' + esc(c.name) + '</a>' : esc(a.name)) + '</b></p>' +
      (c && c.email ? '<p class="adm-muted">' + esc(c.email) + '</p>' : '') +
      '<h4>Shipping address</h4><p>' + esc(a.name) + '<br>' + esc(a.line) + '<br>' + esc(a.city) + ', ' + esc(a.state) + ' – ' + esc(a.pincode) + '<br>📞 ' + esc(a.phone) + '</p></div>' +
      '<div class="card adm-card"><h3>Timeline</h3>' + tlHtml + '</div></div>' +
      '</div>';
  }

  function setStatus(id, status) {
    if (!App.store.setOrderStatus(id, status)) return;
    toast('Order ' + id + ' marked ' + status + (status === 'returned' ? ' — items restocked' : ''), 'success');
    rerender();
  }

  /* ---------- Customers ---------- */
  function custStats() {
    var map = {};
    S().orders.forEach(function (o) {
      var m = map[o.customerId] || (map[o.customerId] = { count: 0, spend: 0, last: null, city: '' });
      m.count++;
      if (o.status !== 'returned') m.spend += o.total || 0;
      if (!m.last || new Date(o.date) > new Date(m.last)) { m.last = o.date; m.city = (o.address || {}).city; }
    });
    return map;
  }
  function customersTable() {
    var stats = custStats(), q = ui.custQ.toLowerCase();
    var rows = S().customers.map(function (c) { return { c: c, s: stats[c.id] || { count: 0, spend: 0, last: null, city: '' } }; })
      .filter(function (r) { return !q || (r.c.name + ' ' + (r.c.email || '') + ' ' + (r.c.phone || '') + ' ' + (r.c.city || r.s.city || '')).toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return b.s.spend - a.s.spend; });
    return '<div class="adm-count">' + rows.length + ' customers</div>' +
      tbl(['Customer', 'City', 'Orders', 'Total spend', 'Last order', ''], rows.map(function (r) {
        var tier = r.s.spend >= 25000 ? App.ui.badge('VIP', 'success') : r.s.count >= 2 ? App.ui.badge('Repeat', 'info') : r.s.count ? App.ui.badge('New', 'muted') : App.ui.badge('No orders', 'muted');
        return tr(['<div class="adm-avatar">' + esc(initials(r.c.name)) + '</div><b>' + esc(r.c.name) + '</b><div class="adm-muted">' + esc(r.c.email || r.c.phone || '') + '</div>',
          esc(r.c.city || r.s.city || '—'), r.s.count, '<b>' + inr(r.s.spend) + '</b>', fdate(r.s.last), tier], nav('#/admin/customers/' + r.c.id));
      }), 'No customers match.');
  }
  function initials(n) { return String(n || '?').split(' ').map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }
  function customersPage() {
    return head('Customers', S().customers.length + ' registered customers', btn('Export CSV', 'App.admin.exportCustomers()')) +
      '<div class="card adm-card"><div class="adm-toolbar"><input class="input adm-search" placeholder="Search name, email, phone or city…" value="' + esc(ui.custQ) + '" oninput="App.admin.setF(\'custQ\',this.value)"></div>' +
      '<div id="adm-cust-list">' + customersTable() + '</div></div>';
  }
  function exportCustomers() {
    var stats = custStats();
    App.ui.csv('customers.csv', S().customers.map(function (c) {
      var s = stats[c.id] || { count: 0, spend: 0 };
      return { Name: c.name, Email: c.email, Phone: c.phone, City: c.city || s.city, Orders: s.count, Spend: s.spend };
    }));
  }
  function customerDetail(params) {
    var c = customer(params.id);
    if (!c) return head('Customer not found', '', btn('← Back to customers', nav('#/admin/customers')));
    var orders = S().orders.filter(function (o) { return o.customerId === c.id; }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    var s = custStats()[c.id] || { count: 0, spend: 0, last: null, city: '' };
    var valid = orders.filter(function (o) { return o.status !== 'returned'; }).length;
    var addr = c.line ? c : orders[0] && orders[0].address;
    return head('<span class="adm-avatar adm-avatar-lg">' + esc(initials(c.name)) + '</span>' + esc(c.name), 'Customer since ' + fdate(c.joined) + (c.notes ? ' · ' + esc(c.notes) : ''), btn('← Customers', nav('#/admin/customers'))) +
      '<div class="adm-kpis">' +
      App.ui.kpi('Orders', num(s.count), orders.filter(function (o) { return o.status === 'returned'; }).length + ' returned') +
      App.ui.kpi('Lifetime spend', inr(s.spend), 'excluding returns') +
      App.ui.kpi('Avg. order value', inr(valid ? s.spend / valid : 0), '') +
      App.ui.kpi('Last order', fdate(s.last), '') + '</div>' +
      '<div class="adm-grid adm-grid-3">' +
      '<div class="card adm-card adm-span-2"><h3>Order history</h3>' +
      tbl(['Order', 'Date', 'Items', 'Status', 'Total'], orders.map(function (o) {
        return tr(['<b>' + esc(o.id) + '</b>', fdate(o.date), esc((o.items || []).map(function (i) { return i.name; }).join(', ')), statusBadge(o.status), inr(o.total)], nav('#/admin/orders/' + o.id));
      }), 'This customer has not placed an order yet.') + '</div>' +
      '<div class="card adm-card"><h3>Contact</h3>' +
      '<p>✉️ ' + esc(c.email || '—') + '</p><p>📞 ' + esc(c.phone || (addr && addr.phone) || '—') + '</p>' +
      '<p>📍 ' + esc(c.city || s.city || '—') + (c.state ? ', ' + esc(c.state) : '') + '</p>' +
      (addr ? '<h4>Default address</h4><p>' + esc(addr.line) + '<br>' + esc(addr.city) + ', ' + esc(addr.state) + ' – ' + esc(addr.pincode) + '</p>' : '') +
      '</div></div>';
  }

  /* ---------- Coupons ---------- */
  function isPct(cp) { return cp.type === 'percent'; }
  function couponsPage() {
    var today = App.fmt.ymd();
    var cps = S().coupons || [];
    return head('Coupons', cps.filter(function (c) { return c.active; }).length + ' active coupons', btn('+ New coupon', 'App.admin.editCoupon()', 'btn-primary')) +
      '<div class="card adm-card">' +
      tbl(['Code', 'Discount', 'Min. order', 'Expiry', 'Used', 'Active', ''], cps.map(function (cp) {
        var expired = cp.expiry && cp.expiry < today;
        return tr([
          '<code class="adm-code">' + esc(cp.code) + '</code>' + (cp.description ? '<div class="adm-muted">' + esc(cp.description) + '</div>' : ''),
          isPct(cp) ? cp.value + '% off' + (cp.maxDiscount ? ' <span class="adm-muted">(max ' + inr(cp.maxDiscount) + ')</span>' : '') : inr(cp.value) + ' off',
          cp.minOrder ? inr(cp.minOrder) : '—',
          cp.expiry ? fdate(cp.expiry) + (expired ? ' ' + App.ui.badge('Expired') : '') : 'No expiry',
          num(cp.uses || 0) + ' times',
          '<label class="adm-switch"><input type="checkbox"' + (cp.active ? ' checked' : '') + ' onchange="App.admin.toggleCoupon(\'' + cp.id + '\',this.checked)"><span></span></label>',
          '<span class="adm-row-actions">' + btn('Edit', "App.admin.editCoupon('" + cp.id + "')", 'btn-sm') +
            ' ' + btn('Delete', "App.admin.askDelete(this,'coupon','" + cp.id + "')", 'btn-sm btn-ghost-danger') + '</span>'
        ]);
      }), 'No coupons yet — create one to run a promotion.') + '</div>';
  }
  function toggleCoupon(id, on) {
    var cp = byId(S().coupons, id); if (!cp) return;
    cp.active = on; save(); toast(cp.code + (on ? ' activated' : ' paused'), 'success');
  }
  function editCoupon(id) {
    var cp = id ? byId(S().coupons, id) : null, isNew = !cp;
    var d = cp || { code: '', type: 'percent', value: 10, minOrder: 999, maxDiscount: 500, expiry: App.fmt.ymd(Date.now() + 30 * DAY), active: true, description: '' };
    App.ui.modal({
      title: isNew ? 'New coupon' : 'Edit ' + d.code,
      saveLabel: isNew ? 'Create coupon' : 'Save',
      body: '<div class="adm-form">' +
        field('Code', input('code', d.code, 'text', 'style="text-transform:uppercase" placeholder="DIWALI20"')) +
        field('Type', select('type', [['percent', 'Percentage (%)'], ['flat', 'Flat amount (₹)']], isPct(d) ? 'percent' : 'flat')) +
        field('Value', input('value', d.value, 'number', 'min="1"')) +
        field('Minimum order (₹)', input('minOrder', d.minOrder, 'number', 'min="0"')) +
        field('Max discount (₹, % coupons; 0 = no cap)', input('maxDiscount', d.maxDiscount || 0, 'number', 'min="0"')) +
        field('Expiry date', input('expiry', d.expiry, 'date')) +
        field('Description', input('description', d.description, 'text', 'placeholder="Festive sale on all ethnic wear"'), true) +
        '<label class="adm-check adm-wide"><input type="checkbox" name="active"' + (d.active ? ' checked' : '') + '> Active</label></div>',
      onSave: function (f) {
        var code = fv(f, 'code').toUpperCase().replace(/\s+/g, ''), type = fv(f, 'type'), value = +fv(f, 'value');
        if (!code) { toast('Coupon code is required', 'error'); return false; }
        if (!(value > 0) || (type === 'percent' && value > 90)) { toast('Enter a valid discount value', 'error'); return false; }
        if (S().coupons.some(function (x) { return x.code === code && x !== cp; })) { toast(code + ' already exists', 'error'); return false; }
        var t = cp || { id: uid('cp'), uses: 0 };
        Object.assign(t, { code: code, type: type, value: value, minOrder: +fv(f, 'minOrder') || 0, maxDiscount: type === 'percent' ? (+fv(f, 'maxDiscount') || 0) : 0, expiry: fv(f, 'expiry'), description: fv(f, 'description'), active: fv(f, 'active') });
        if (isNew) S().coupons.unshift(t);
        save(); toast('Coupon ' + code + ' saved', 'success'); rerender();
      }
    });
  }

  /* ---------- scoped styles ---------- */
  function injectStyles() {
    if (document.getElementById('adm-styles')) return;
    var css = [
      '.adm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px}',
      '.adm-title{margin:0;font-size:1.45rem;display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.adm-sub{margin:4px 0 0;color:var(--muted,#64748b)}',
      '.adm-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}',
      '.adm-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:16px}',
      '.adm-grid{display:grid;gap:16px;margin-bottom:16px}',
      '.adm-grid-3{grid-template-columns:repeat(3,minmax(0,1fr))}',
      '.adm-span-2{grid-column:span 2}',
      '@media (max-width:900px){.adm-grid-3{grid-template-columns:1fr}.adm-span-2{grid-column:auto}}',
      '.adm-card{padding:16px;min-width:0}',
      '.adm-grid>div>.adm-card+.adm-card{margin-top:16px}',
      '.adm-card h3{margin:0 0 12px;font-size:1rem;display:flex;justify-content:space-between;align-items:baseline;gap:8px}',
      '.adm-card h3 small{font-weight:400;color:var(--muted,#64748b);font-size:.8rem;margin-right:auto}',
      '.adm-card h4{margin:14px 0 6px;font-size:.85rem;color:var(--muted,#64748b)}',
      '.adm-card p{margin:4px 0}',
      '.adm-chart{position:relative;height:260px}',
      '.adm-delta.up{color:#059669}.adm-delta.down{color:#dc2626}',
      '.adm-table-wrap{overflow-x:auto}',
      '.adm-table{width:100%;border-collapse:collapse}',
      '.adm-table th{text-align:left;font-size:.75rem;text-transform:uppercase;letter-spacing:.03em;color:var(--muted,#64748b);padding:8px 10px;border-bottom:1px solid var(--border,#e2e8f0);white-space:nowrap}',
      '.adm-table td{padding:10px;border-bottom:1px solid var(--border,#f1f5f9);vertical-align:middle}',
      '.adm-click{cursor:pointer}.adm-click:hover{background:rgba(79,70,229,.05)}',
      '.adm-muted{color:var(--muted,#64748b);font-size:.8rem}',
      '.adm-count{color:var(--muted,#64748b);font-size:.8rem;margin:0 0 8px}',
      '.adm-empty{padding:28px;text-align:center;color:var(--muted,#64748b)}',
      '.adm-toolbar{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}',
      '.adm-toolbar .input{width:auto}.adm-search{flex:1;min-width:200px}',
      '.adm-tabs{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--border,#e2e8f0);margin-bottom:12px}',
      '.adm-tab{border:0;background:none;padding:8px 12px;cursor:pointer;font:inherit;color:var(--muted,#64748b);border-bottom:2px solid transparent;margin-bottom:-1px}',
      '.adm-tab.active{color:var(--primary,#4f46e5);border-color:var(--primary,#4f46e5);font-weight:600}',
      '.adm-tab span{background:rgba(100,116,139,.12);border-radius:10px;padding:1px 7px;font-size:.75rem;margin-left:4px}',
      '.adm-row-actions{white-space:nowrap}',
      '.btn-ghost-danger{color:#dc2626}',
      '.adm-confirm{white-space:nowrap;font-size:.85rem;color:#dc2626}',
      '.adm-low{list-style:none;margin:0;padding:0}',
      '.adm-low li{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border,#f1f5f9);cursor:pointer}',
      '.adm-low li div{flex:1;min-width:0}.adm-low li b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.adm-low li small{color:var(--muted,#64748b)}',
      '.adm-link{font-size:.8rem;font-weight:400}',
      '.adm-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '.adm-field{display:flex;flex-direction:column;gap:4px;font-size:.85rem}.adm-field span{color:var(--muted,#64748b)}',
      '.adm-field input[type=color]{height:38px;padding:2px}',
      '.adm-wide{grid-column:1/-1}',
      '@media (max-width:560px){.adm-form{grid-template-columns:1fr}}',
      '.adm-check{display:flex;gap:8px;align-items:center;font-size:.9rem}',
      '.adm-totals{margin-left:auto;max-width:320px;margin-top:12px}',
      '.adm-totals div{display:flex;justify-content:space-between;padding:4px 0}',
      '.adm-grand{border-top:1px solid var(--border,#e2e8f0);font-weight:700;font-size:1.05rem;margin-top:4px;padding-top:8px!important}',
      '.adm-timeline{list-style:none;margin:0;padding:0 0 0 18px;border-left:2px solid var(--border,#e2e8f0)}',
      '.adm-timeline li{position:relative;padding:0 0 14px 6px}',
      '.adm-timeline li:before{content:"";position:absolute;left:-25px;top:3px;width:12px;height:12px;border-radius:50%;background:var(--border,#cbd5e1)}',
      '.adm-timeline li.done:before{background:#10b981}',
      '.adm-timeline small{display:block;color:var(--muted,#64748b)}',
      '.adm-avatar{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50%;background:#e0e7ff;color:#4338ca;font-size:.75rem;font-weight:700;margin-right:8px;vertical-align:middle;float:left}',
      '.adm-avatar-lg{width:40px;height:40px;font-size:.95rem;float:none;margin:0}',
      '.adm-cat-ico{font-size:1.2rem}',
      '.adm-code{background:var(--primary-soft,#eef2ff);color:var(--primary,#4f46e5);padding:3px 8px;border-radius:6px;font-weight:700;letter-spacing:.04em}',
      '.adm-switch{position:relative;display:inline-block;width:38px;height:22px}',
      '.adm-switch input{opacity:0;width:0;height:0}',
      '.adm-switch span{position:absolute;inset:0;background:#cbd5e1;border-radius:22px;cursor:pointer;transition:.2s}',
      '.adm-switch span:before{content:"";position:absolute;width:16px;height:16px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}',
      '.adm-switch input:checked+span{background:#10b981}.adm-switch input:checked+span:before{transform:translateX(16px)}'
    ].join('\n');
    var el = document.createElement('style');
    el.id = 'adm-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------- public API + registration ---------- */
  App.admin = {
    setRange: function (d) { ui.range = d; rerender(); },
    setTab: function (t) { ui.orderTab = t; rerender(); },
    setF: setF,
    filterLow: function () { ui.prodStock = 'low'; ui.prodQ = ''; ui.prodCat = ''; },
    filterCat: function (id) { ui.prodCat = id; ui.prodQ = ''; ui.prodStock = ''; },
    editProduct: editProduct, editCategory: editCategory, editCoupon: editCoupon,
    askDelete: askDelete, doDelete: doDelete, setStatus: setStatus, toggleCoupon: toggleCoupon,
    exportOrders: exportOrders, exportCustomers: exportCustomers
  };
  App.actions.admRange = function (el) { App.admin.setRange(Number(el.getAttribute('data-days'))); };

  function init() {
    injectStyles();
    var r = App.router, opt = { layout: 'admin' };
    r.register('#/admin', function () { return dashboard(); }, opt);
    r.register('#/admin/products', productsPage, opt);
    r.register('#/admin/categories', categoriesPage, opt);
    r.register('#/admin/orders', ordersPage, opt);
    r.register('#/admin/orders/:id', orderDetail, opt);
    r.register('#/admin/customers', customersPage, opt);
    r.register('#/admin/customers/:id', customerDetail, opt);
    r.register('#/admin/coupons', couponsPage, opt);

    [
      { hash: '#/admin', label: 'Dashboard', icon: '📊', group: 'Overview' },
      { hash: '#/admin/orders', label: 'Orders', icon: '🧾', group: 'Sales' },
      { hash: '#/admin/customers', label: 'Customers', icon: '👥', group: 'Sales' },
      { hash: '#/admin/coupons', label: 'Coupons', icon: '🎟️', group: 'Sales' },
      { hash: '#/admin/products', label: 'Products', icon: '📦', group: 'Catalog' },
      { hash: '#/admin/categories', label: 'Categories', icon: '🏷️', group: 'Catalog' }
    ].forEach(function (n) { n.roles = ROLES; App.adminNav.push(n); });
  }

  init();
})();
