/* Reports module: Sales, Inventory, Purchases, Profit & Loss, Customer — date-range filtered, CSV/PDF export.
   Uses window.XU helpers defined in erp.js (resolved lazily at render time). */
(function () {
  'use strict';

  var DAY = 864e5;
  var R = window.Reports = { tab: 'sales', from: null, to: null, range: '30' };
  var TABS = [['sales', 'Sales'], ['inventory', 'Inventory'], ['purchases', 'Purchases'], ['pnl', 'Profit & Loss'], ['customer', 'Customer']];

  function ymd(d) { return App.fmt && App.fmt.ymd ? App.fmt.ymd(d) : XU.iso(d); }
  function inRange(d) {
    if (App.store && App.store.between) return App.store.between(d, R.from, R.to);
    var t = new Date(d).getTime();
    return (!R.from || t >= new Date(R.from + 'T00:00:00').getTime()) && (!R.to || t <= new Date(R.to + 'T23:59:59').getTime());
  }
  function applyPreset(p) {
    var now = new Date(), from, to = ymd(now);
    if (p === '7' || p === '30' || p === '90') from = ymd(now.getTime() - (Number(p) - 1) * DAY);
    else if (p === 'month') from = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
    else if (p === 'lastmonth') { from = ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)); to = ymd(new Date(now.getFullYear(), now.getMonth(), 0)); }
    else if (p === 'fy') from = ymd(new Date(now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1, 3, 1));
    R.range = p; R.from = from; R.to = to;
  }
  function rangeLabel() { return XU.date(R.from) + ' – ' + XU.date(R.to); }
  function billable(o) { return !XU.isCancelled(o); }
  function orders() { return XU.arr('orders').filter(function (o) { return inRange(o.date); }); }
  var n2 = function (v) { return Math.round((Number(v) || 0) * 100) / 100; };

  /* Each builder returns { kpis, cols:[{label,type}], rows:[[raw]], foot?, chart? }.
     type: 'money' | 'num' | 'date' | 'text' | 'pct' | 'badge' */
  var build = {
    sales: function () {
      var os = orders(), byDay = {}, prodAgg = {};
      os.forEach(function (o) {
        var k = ymd(o.date), d = byDay[k] || (byDay[k] = { orders: 0, items: 0, gross: 0, disc: 0, tax: 0, ship: 0, net: 0, returns: 0 });
        if (!billable(o)) { d.returns++; return; }
        d.orders++; d.gross += Number(o.subtotal) || 0; d.disc += Number(o.discount) || 0; d.tax += Number(o.tax) || 0;
        d.ship += (Number(o.shipping) || 0) + (Number(o.codFee) || 0); d.net += XU.orderNet(o);
        (o.items || []).forEach(function (it) {
          d.items += Number(it.qty) || 0;
          var a = prodAgg[it.productId] || (prodAgg[it.productId] = { name: it.name, qty: 0 });
          a.qty += Number(it.qty) || 0;
        });
      });
      var days = Object.keys(byDay).sort().reverse();
      var rows = days.map(function (k) { var d = byDay[k]; return [k, d.orders, d.items, n2(d.gross), n2(d.disc), n2(d.tax), n2(d.ship), n2(d.net), d.returns]; });
      var tot = rows.reduce(function (t, r) { for (var i = 1; i < r.length; i++) t[i] = (t[i] || 0) + r[i]; return t; }, ['Total']);
      var totOrders = tot[1] || 0;
      var top = Object.keys(prodAgg).map(function (k) { return prodAgg[k]; }).sort(function (a, b) { return b.qty - a.qty; })[0];
      var asc = days.slice().reverse();
      return {
        kpis: [['Net sales (ex-GST)', XU.money(tot[7] || 0)], ['Orders', XU.num(totOrders), (tot[8] || 0) + ' returned'],
          ['Avg. order value', XU.money(totOrders ? (tot[3] - tot[4]) / totOrders : 0), 'gross after discount'], ['Best seller', XU.esc(top ? top.name : '—'), top ? top.qty + ' units' : '']],
        cols: [{ label: 'Date', type: 'date' }, { label: 'Orders', type: 'num' }, { label: 'Units', type: 'num' }, { label: 'Gross sales', type: 'money' },
          { label: 'Discounts', type: 'money' }, { label: 'GST', type: 'money' }, { label: 'Shipping & fees', type: 'money' }, { label: 'Net sales', type: 'money' }, { label: 'Returns', type: 'num' }],
        rows: rows, foot: tot.map(function (v, i) { return i === 0 ? v : n2(v); }),
        chart: { type: 'line', data: { labels: asc.map(function (k) { return XU.date(k); }), datasets: [
          { label: 'Net sales', data: asc.map(function (k) { return Math.round(byDay[k].net); }), borderColor: '#4f46e5', backgroundColor: 'rgba(79,70,229,.12)', fill: true, tension: .3 }] } }
      };
    },
    inventory: function () {
      var sold = {};
      orders().filter(billable).forEach(function (o) { (o.items || []).forEach(function (it) { sold[it.productId] = (sold[it.productId] || 0) + (Number(it.qty) || 0); }); });
      var th = Number(XU.settings().lowStockThreshold) || 10, byCat = {}, units = 0, value = 0, low = 0;
      var cats = {}; XU.arr('categories').forEach(function (c) { cats[c.id] = c.name; });
      var rows = XU.arr('products').map(function (p) {
        var v = (Number(p.stock) || 0) * (Number(p.cost) || 0), s = sold[p.id] || 0;
        units += p.stock; value += v; if (p.stock <= th) low++;
        byCat[cats[p.categoryId] || 'Other'] = (byCat[cats[p.categoryId] || 'Other'] || 0) + v;
        var cover = s ? Math.round(p.stock / (s / Math.max(1, daysInRange()))) : null;
        return [p.name, p.sku, cats[p.categoryId] || '', p.stock, n2(p.cost), n2(v), s, cover == null ? '—' : cover + ' days',
          p.stock <= 0 ? 'Out of stock' : p.stock <= th ? 'Low stock' : 'In stock'];
      }).sort(function (a, b) { return a[3] - b[3]; });
      var labels = Object.keys(byCat);
      return {
        kpis: [['SKUs', XU.num(rows.length)], ['Units on hand', XU.num(units)], ['Stock value (cost)', XU.money(value)], ['Low / out of stock', XU.num(low), 'threshold ≤ ' + th]],
        cols: [{ label: 'Product' }, { label: 'SKU' }, { label: 'Category' }, { label: 'On hand', type: 'num' }, { label: 'Unit cost', type: 'money' },
          { label: 'Stock value', type: 'money' }, { label: 'Sold in period', type: 'num' }, { label: 'Stock cover' }, { label: 'Status', type: 'badge' }],
        rows: rows,
        chart: { type: 'doughnut', data: { labels: labels, datasets: [{ data: labels.map(function (k) { return Math.round(byCat[k]); }),
          backgroundColor: ['#4f46e5', '#0ea5e9', '#f59e0b', '#10b981', '#ec4899', '#8b5cf6', '#ef4444', '#64748b'] }] }, options: { plugins: { legend: { position: 'right' } } } }
      };
    },
    purchases: function () {
      var sups = {}; XU.arr('suppliers').forEach(function (s) { sups[s.id] = s.name; });
      var whs = {}; XU.warehouses().forEach(function (w) { whs[w.id] = w.name; });
      var bySup = {}, tot = 0, open = 0, units = 0;
      var rows = XU.arr('purchaseOrders').filter(function (p) { return inRange(p.date); }).sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).map(function (p) {
        var amt = (p.items || []).reduce(function (a, i) { return a + i.qty * i.cost; }, 0), q = (p.items || []).reduce(function (a, i) { return a + (Number(i.qty) || 0); }, 0);
        var sn = sups[p.supplierId] || 'Unknown'; bySup[sn] = (bySup[sn] || 0) + amt; tot += amt; units += q;
        if (p.status !== 'received') open += amt;
        var st = String(p.status || 'draft'); st = st.charAt(0).toUpperCase() + st.slice(1);
        return [p.number || p.id, ymd(p.date), sn, whs[p.warehouseId] || '', (p.items || []).length, q, n2(amt), st, p.receivedDate ? ymd(p.receivedDate) : '—'];
      });
      var labels = Object.keys(bySup).sort(function (a, b) { return bySup[b] - bySup[a]; });
      return {
        kpis: [['Purchase value', XU.money(tot)], ['Purchase orders', XU.num(rows.length)], ['Units purchased', XU.num(units)], ['Open (not received)', XU.money(open)]],
        cols: [{ label: 'PO number' }, { label: 'Date', type: 'date' }, { label: 'Supplier' }, { label: 'Warehouse' }, { label: 'Lines', type: 'num' },
          { label: 'Units', type: 'num' }, { label: 'Amount', type: 'money' }, { label: 'Status', type: 'badge' }, { label: 'Received on' }],
        rows: rows, foot: ['Total', '', '', '', '', units, n2(tot), '', ''],
        chart: { type: 'bar', data: { labels: labels, datasets: [{ label: 'Purchases', data: labels.map(function (k) { return Math.round(bySup[k]); }), backgroundColor: '#0ea5e9', borderRadius: 4 }] },
          options: { indexAxis: 'y', plugins: { legend: { display: false } } } }
      };
    },
    pnl: function () {
      var m = {}, keyOf = function (d) { return XU.monthKey(d); };
      var get = function (k) { return m[k] || (m[k] = { rev: 0, cogs: 0, exp: 0 }); };
      orders().filter(billable).forEach(function (o) { var r = get(keyOf(o.date)); r.rev += XU.orderNet(o); r.cogs += XU.orderCost(o); });
      XU.arr('expenses').filter(function (e) { return inRange(e.date); }).forEach(function (e) { get(keyOf(e.date)).exp += Number(e.amount) || 0; });
      var keys = Object.keys(m).sort();
      var T = { rev: 0, cogs: 0, exp: 0 };
      var rows = keys.map(function (k) {
        var r = m[k]; T.rev += r.rev; T.cogs += r.cogs; T.exp += r.exp;
        var gp = r.rev - r.cogs, np = gp - r.exp;
        return [XU.monthLabel(k), n2(r.rev), n2(r.cogs), n2(gp), r.rev ? n2(gp / r.rev * 100) : 0, n2(r.exp), n2(np), r.rev ? n2(np / r.rev * 100) : 0];
      });
      var gpT = T.rev - T.cogs, npT = gpT - T.exp;
      return {
        kpis: [['Revenue (ex-GST)', XU.money(T.rev)], ['Gross profit', XU.money(gpT), T.rev ? (gpT / T.rev * 100).toFixed(1) + '% margin' : ''],
          ['Operating expenses', XU.money(T.exp)], ['Net profit', '<span style="color:' + (npT >= 0 ? '#16a34a' : '#dc2626') + '">' + XU.money(npT) + '</span>', T.rev ? (npT / T.rev * 100).toFixed(1) + '% net margin' : '']],
        cols: [{ label: 'Month' }, { label: 'Revenue', type: 'money' }, { label: 'COGS', type: 'money' }, { label: 'Gross profit', type: 'money' }, { label: 'GP %', type: 'pct' },
          { label: 'Expenses', type: 'money' }, { label: 'Net profit', type: 'money' }, { label: 'NP %', type: 'pct' }],
        rows: rows, foot: ['Total', n2(T.rev), n2(T.cogs), n2(gpT), T.rev ? n2(gpT / T.rev * 100) : 0, n2(T.exp), n2(npT), T.rev ? n2(npT / T.rev * 100) : 0],
        chart: { type: 'bar', data: { labels: keys.map(XU.monthLabel), datasets: [
          { label: 'Revenue', data: keys.map(function (k) { return Math.round(m[k].rev); }), backgroundColor: '#4f46e5', borderRadius: 4 },
          { label: 'COGS + expenses', data: keys.map(function (k) { return Math.round(m[k].cogs + m[k].exp); }), backgroundColor: '#f59e0b', borderRadius: 4 },
          { label: 'Net profit', data: keys.map(function (k) { return Math.round(m[k].rev - m[k].cogs - m[k].exp); }), backgroundColor: '#10b981', borderRadius: 4 }] },
          options: { plugins: { legend: { position: 'bottom' } } } }
      };
    },
    customer: function () {
      var agg = {};
      orders().filter(billable).forEach(function (o) {
        var a = agg[o.customerId] || (agg[o.customerId] = { orders: 0, spend: 0, last: o.date });
        a.orders++; a.spend += Number(o.total) || 0; if (new Date(o.date) > new Date(a.last)) a.last = o.date;
      });
      var custs = XU.arr('customers'), active = 0, repeat = 0, rev = 0;
      var rows = custs.map(function (c) {
        var a = agg[c.id] || { orders: 0, spend: 0, last: null };
        if (a.orders) active++; if (a.orders > 1) repeat++; rev += a.spend;
        var seg = a.spend >= 15000 ? 'VIP' : a.orders > 1 ? 'Repeat' : a.orders ? 'New' : 'Inactive';
        return [c.name, c.email, (c.city || '') + (c.state ? ', ' + c.state : ''), a.orders, n2(a.spend), a.orders ? n2(a.spend / a.orders) : 0, a.last ? ymd(a.last) : '—', seg];
      }).sort(function (a, b) { return b[4] - a[4]; });
      var top = rows.filter(function (r) { return r[3]; }).slice(0, 8);
      return {
        kpis: [['Active customers', XU.num(active), 'of ' + custs.length + ' total'], ['Repeat rate', active ? (repeat / active * 100).toFixed(1) + '%' : '0%', repeat + ' repeat buyers'],
          ['Revenue from customers', XU.money(rev)], ['Avg. spend / customer', XU.money(active ? rev / active : 0)]],
        cols: [{ label: 'Customer' }, { label: 'Email' }, { label: 'Location' }, { label: 'Orders', type: 'num' }, { label: 'Total spend', type: 'money' },
          { label: 'AOV', type: 'money' }, { label: 'Last order', type: 'date' }, { label: 'Segment', type: 'badge' }],
        rows: rows,
        chart: { type: 'bar', data: { labels: top.map(function (r) { return r[0]; }), datasets: [{ label: 'Spend', data: top.map(function (r) { return Math.round(r[4]); }), backgroundColor: '#8b5cf6', borderRadius: 4 }] },
          options: { indexAxis: 'y', plugins: { legend: { display: false } } } }
      };
    }
  };
  function daysInRange() {
    var f = R.from ? new Date(R.from) : new Date(Date.now() - 90 * DAY), t = R.to ? new Date(R.to) : new Date();
    return Math.max(1, Math.round((t - f) / DAY) + 1);
  }

  var SEG = { VIP: 'purple', Repeat: 'blue', New: 'green', Inactive: 'grey', 'In stock': 'green', 'Low stock': 'amber', 'Out of stock': 'red' };
  function cell(v, type) {
    if (v === '—' || v == null) return '<span class="ex-muted">—</span>';
    if (type === 'money') return XU.inr2(v);
    if (type === 'num') return XU.num(v);
    if (type === 'pct') return Number(v).toFixed(1) + '%';
    if (type === 'date') return XU.date(v);
    if (type === 'badge') return XU.badge(v, SEG[v]);
    return XU.esc(v);
  }
  function plain(v, type) {
    if (type === 'money') return typeof v === 'number' ? 'Rs. ' + Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : v;
    if (type === 'num') return typeof v === 'number' ? Number(v).toLocaleString('en-IN') : v;
    if (type === 'pct') return typeof v === 'number' ? v.toFixed(1) + '%' : v;
    if (type === 'date') return v && v !== '—' ? XU.date(v) : v;
    return v;
  }
  function current() { return build[R.tab](); }
  function tabLabel() { return TABS.filter(function (t) { return t[0] === R.tab; })[0][1]; }

  function render() {
    if (!R.from) applyPreset(R.range);
    var d = current();
    var isNum = function (c) { return c.type === 'money' || c.type === 'num' || c.type === 'pct'; };
    var cols = d.cols.map(function (c) { return { label: c.label, align: isNum(c) ? 'r' : '' }; });
    var rows = d.rows.map(function (r) { return r.map(function (v, i) { return cell(v, d.cols[i].type); }); });
    var foot = d.foot ? d.foot.map(function (v, i) { return i === 0 ? v : (v === '' ? '' : cell(v, d.cols[i].type)); }) : null;
    if (d.chart) {
      d.chart.options = d.chart.options || {};
      XU.chart('ex-rep-chart', d.chart);
    }
    var presets = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['fy', 'This FY']];
    return '<div class="ex-page">' + XU.head('Reports', 'Business reports for ' + XU.esc(XU.storeName()) + ' · ' + rangeLabel(),
      '<button class="ex-btn" onclick="Reports.exportCsv()">⬇ Export CSV</button><button class="ex-btn ex-primary" onclick="Reports.exportPdf()">⬇ Export PDF</button>') +
      '<div class="ex-tabs">' + TABS.map(function (t) {
        return '<button class="ex-tab' + (t[0] === R.tab ? ' on' : '') + '" onclick="Reports.setTab(\'' + t[0] + '\')">' + t[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="ex-card ex-bar" style="justify-content:space-between">' +
      '<div class="ex-bar">' + presets.map(function (p) {
        return '<button class="ex-btn ex-sm' + (R.range === p[0] ? ' ex-primary' : '') + '" onclick="Reports.preset(\'' + p[0] + '\')">' + p[1] + '</button>';
      }).join('') + '</div>' +
      '<div class="ex-bar ex-small"><label>From <input class="ex-input" type="date" value="' + (R.from || '') + '" onchange="Reports.setRange(\'from\',this.value)"></label>' +
      '<label>To <input class="ex-input" type="date" value="' + (R.to || '') + '" onchange="Reports.setRange(\'to\',this.value)"></label></div></div>' +
      '<div class="ex-grid">' + d.kpis.map(function (k) { return XU.kpi(k[0], k[1], k[2]); }).join('') + '</div>' +
      (d.chart ? '<div class="ex-card"><h3>' + tabLabel() + ' overview</h3><div class="ex-chart"><canvas id="ex-rep-chart"></canvas></div></div>' : '') +
      '<div class="ex-card"><div class="ex-head" style="margin-bottom:10px"><h3 style="margin:0">' + tabLabel() + ' report <span class="ex-muted ex-small">(' + d.rows.length + ' rows)</span></h3>' +
      '<input class="ex-input" placeholder="Filter rows…" oninput="XU.filterRows(this,\'ex-rep-table\')"></div>' +
      XU.table(cols, rows, { id: 'ex-rep-table', foot: foot, empty: 'No activity in this date range — try a wider preset' }) + '</div></div>';
  }

  R.setTab = function (t) { R.tab = t; XU.rerender(); };
  R.preset = function (p) { applyPreset(p); XU.rerender(); };
  R.setRange = function (k, v) { R[k] = v; R.range = 'custom'; XU.rerender(); };
  function fname(ext) { return 'report-' + R.tab + '-' + R.from + '-to-' + R.to + '.' + ext; }
  R.exportCsv = function () {
    var d = current();
    var out = [d.cols.map(function (c) { return c.label + (c.type === 'money' ? ' (INR)' : ''); })].concat(d.rows);
    if (d.foot) out.push(d.foot);
    XU.csv(fname('csv'), out);
  };
  R.exportPdf = function () {
    var d = current();
    var rows = d.rows.map(function (r) { return r.map(function (v, i) { return plain(v, d.cols[i].type); }); });
    if (d.foot) rows.push(d.foot.map(function (v, i) { return i === 0 ? v : plain(v, d.cols[i].type); }));
    var head = d.cols.map(function (c) { return c.label; });
    if (App.ui && App.ui.pdf) App.ui.pdf(tabLabel() + ' Report', head, rows, 'Period: ' + rangeLabel());
    else XU.pdf(tabLabel() + ' Report (' + rangeLabel() + ')', head, rows);
  };

  function init() {
    XU.route('#/admin/reports', render, ['Owner', 'Manager']);
    XU.nav('#/admin/reports', 'Reports', '📈', 'Reports', ['Owner', 'Manager']);
  }
  // XU comes from erp.js; wait for DOMContentLoaded if erp.js or the router isn't ready yet
  if (window.XU && window.XU.route && window.App && App.router && App.adminNav) init();
  else document.addEventListener('DOMContentLoaded', init);
})();
