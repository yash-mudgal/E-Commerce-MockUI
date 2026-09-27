/* ShopMint demo — customer-facing storefront (home, listing, product, cart, checkout, account). */
(function (A) {
  'use strict';
  var S = A.store, ui = A.ui, fmt = A.fmt, esc = ui.esc;
  var reg = function (p, fn) { A.router.register(p, fn, { layout: 'shop' }); };

  var co = { coupon: '' };                 // coupon carried from cart to checkout
  var pdpSel = { pid: null, size: '', color: '', qty: 1, pinMsg: '' };

  function offPct(p) { return p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0; }
  function catName(id) { var c = S.category(id); return c ? c.name : ''; }
  function activeProducts() { return A.state.products.filter(function (p) { return p.active !== false; }); }

  function stockLine(p) {
    if (p.stock <= 0) return '<span class="error-text"><b>Out of stock</b> — restocking soon</span>';
    if (S.isLow(p)) return '<span style="color:var(--warning)"><b>Hurry, only ' + p.stock + ' left!</b></span>';
    return '<span class="ok-text"><b>In stock</b> · ready to ship</span>';
  }

  function productCard(p) {
    var off = offPct(p);
    var needsVariant = p.variants.sizes.length || p.variants.colors.length;
    var btn = p.stock <= 0 ? '<button class="btn btn-sm" disabled>Sold out</button>'
      : needsVariant ? '<a class="btn btn-sm" href="#/product/' + p.id + '">Options</a>'
      : '<button class="btn btn-sm btn-brand" data-action="quickAdd" data-id="' + p.id + '">Add</button>';
    return '<div class="pcard"><a href="#/product/' + p.id + '"><div class="pcard-media">' + ui.productThumb(p, 'md') +
      (p.stock <= 0 ? '<span class="ribbon">Sold out</span>' : off >= 40 ? '<span class="ribbon">' + off + '% OFF</span>' : p.featured ? '<span class="ribbon">Bestseller</span>' : '') +
      '</div></a><div class="pcard-body"><div class="muted small">' + esc(catName(p.categoryId)) + '</div>' +
      '<a href="#/product/' + p.id + '" class="pcard-name" style="color:var(--text)">' + esc(p.name) + '</a>' +
      '<div class="rating"><b>' + p.rating + ' ★</b>(' + fmt.num(p.reviews) + ')</div>' +
      '<div class="pcard-foot"><div><span class="price">' + fmt.inr(p.price) + '</span> ' +
      (off ? '<span class="strike small">' + fmt.inr(p.mrp) + '</span>' : '') + '</div>' + btn + '</div></div></div>';
  }

  function brandVar() { return 'style="--brand:' + esc(A.state.settings.brandColor) + '"'; }

  /* ---------------- Home ---------------- */
  reg('#/', function () {
    var st = A.state, set = st.settings, prods = activeProducts();
    var featured = prods.filter(function (p) { return p.featured && p.stock > 0; }).slice(0, 8);
    var deals = prods.filter(function (p) { return p.stock > 0; }).sort(function (a, b) { return offPct(b) - offPct(a); }).slice(0, 4);
    var active = st.coupons.filter(function (c) { return c.active && (!c.expiry || c.expiry >= fmt.ymd()); });
    var cats = st.categories.map(function (c) {
      var n = prods.filter(function (p) { return p.categoryId === c.id; }).length;
      return '<a class="cat-tile" href="#/category/' + c.id + '" style="--c:' + esc(c.color) + '"><div class="ci">' + esc(c.emoji) + '</div><strong>' + esc(c.name) + '</strong><small>' + n + ' products</small></a>';
    }).join('');
    return '<div ' + brandVar() + '>' +
      '<section class="hero"><div><div class="small" style="opacity:.8;font-weight:600;text-transform:uppercase;letter-spacing:.08em">Welcome to ' + esc(set.storeName) + '</div>' +
      '<h1>' + esc(set.tagline) + '</h1><p>Free standard shipping above ' + fmt.inr((set.shipping[0] || {}).freeAbove || 999) + ' · Pay with ' +
      ['upi', 'card', 'cod'].filter(function (k) { return set.payments[k]; }).map(function (k) { return k === 'cod' ? 'Cash on Delivery' : k.toUpperCase(); }).join(', ') + '</p>' +
      '<div class="row"><a class="btn btn-lg" href="#/shop">Shop now →</a>' + (active[0] ? '<span class="small">Use <b>' + esc(active[0].code) + '</b> · ' + esc(active[0].description) + '</span>' : '') + '</div>' +
      '<div class="hero-tags"><span>🚚 Pan-India delivery</span><span>↩️ 7-day returns</span><span>🧾 GST invoice</span><span>🔒 Secure checkout</span></div></div>' +
      '<div class="hero-art">' + esc(set.logoEmoji) + '</div></section>' +
      '<section class="section"><div class="section-head"><h2>Shop by category</h2><a href="#/shop">View all →</a></div><div class="cat-grid">' + cats + '</div></section>' +
      '<section class="section"><div class="section-head"><h2>Bestsellers</h2><a href="#/shop?sort=rating">See more →</a></div><div class="product-grid">' + featured.map(productCard).join('') + '</div></section>' +
      '<section class="section"><div class="section-head"><h2>Top deals</h2><a href="#/shop?sort=discount">All deals →</a></div><div class="product-grid">' + deals.map(productCard).join('') + '</div></section>' +
      '</div>';
  });

  /* ---------------- Listing / search ---------------- */
  function listHref(base, q) {
    var parts = Object.keys(q).filter(function (k) { return q[k] !== '' && q[k] != null && q[k] !== false; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); });
    return base + (parts.length ? '?' + parts.join('&') : '');
  }

  function listing(q, fixedCat) {
    var st = A.state;
    var term = (q.q || '').toLowerCase().trim();
    var cats = fixedCat ? [fixedCat] : (q.cat ? q.cat.split(',') : []);
    var min = Number(q.min) || 0, max = Number(q.max) || 0;
    var list = activeProducts().filter(function (p) {
      if (cats.length && cats.indexOf(p.categoryId) < 0) return false;
      if (min && p.price < min) return false;
      if (max && p.price > max) return false;
      if (q.instock && p.stock <= 0) return false;
      if (term) {
        var hay = (p.name + ' ' + p.description + ' ' + catName(p.categoryId) + ' ' + p.sku + ' ' + p.variants.colors.join(' ')).toLowerCase();
        if (!term.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; })) return false;
      }
      return true;
    });
    var sorters = {
      'price-asc': function (a, b) { return a.price - b.price; },
      'price-desc': function (a, b) { return b.price - a.price; },
      rating: function (a, b) { return b.rating - a.rating; },
      discount: function (a, b) { return offPct(b) - offPct(a); },
      popular: function (a, b) { return b.reviews - a.reviews; }
    };
    if (sorters[q.sort]) list.sort(sorters[q.sort]);

    var base = fixedCat ? '#/category/' + fixedCat : '#/shop';
    var catObj = fixedCat && S.category(fixedCat);
    var title = catObj ? catObj.emoji + ' ' + catObj.name : term ? 'Results for “' + q.q + '”' : 'All products';

    var catFilter = fixedCat ? '' : '<h4>Category</h4>' + st.categories.map(function (c) {
      return '<label class="check"><input type="checkbox" data-change="shopFilterCat" value="' + c.id + '"' + (cats.indexOf(c.id) >= 0 ? ' checked' : '') + '> ' + esc(c.name) + '</label>';
    }).join('');
    var priceBands = [[0, 499], [500, 999], [1000, 2499], [2500, 4999], [5000, 0]].map(function (b) {
      var on = min === b[0] && max === b[1];
      return '<label class="check"><input type="radio" name="band" data-change="shopFilterBand" data-min="' + b[0] + '" data-max="' + b[1] + '"' + (on ? ' checked' : '') + '> ' +
        (b[1] ? fmt.inr(b[0]) + ' – ' + fmt.inr(b[1]) : 'Above ' + fmt.inr(b[0])) + '</label>';
    }).join('');

    var filters = '<aside class="card filters" data-base="' + esc(base) + '">' + catFilter +
      '<h4>Price</h4>' + priceBands +
      '<form class="row" style="margin-top:8px;flex-wrap:nowrap" data-submit="shopFilterPrice"><input class="input input-sm" style="width:100%" type="number" name="min" min="0" placeholder="Min ₹" value="' + (min || '') + '">' +
      '<input class="input input-sm" style="width:100%" type="number" name="max" min="0" placeholder="Max ₹" value="' + (max || '') + '"><button class="btn btn-sm">Go</button></form>' +
      '<h4>Availability</h4><label class="check"><input type="checkbox" data-change="shopFilterStock"' + (q.instock ? ' checked' : '') + '> In stock only</label>' +
      '<div style="margin-top:14px"><a class="btn btn-sm btn-block" href="' + base + (term ? '?q=' + encodeURIComponent(q.q) : '') + '">Clear filters</a></div></aside>';

    var sortSel = '<select class="input input-sm" data-change="shopSort" aria-label="Sort">' + [['', 'Relevance'], ['popular', 'Popularity'], ['price-asc', 'Price: low to high'],
      ['price-desc', 'Price: high to low'], ['rating', 'Customer rating'], ['discount', 'Biggest discount']].map(function (o) {
      return '<option value="' + o[0] + '"' + ((q.sort || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select>';

    listing.q = q; listing.base = base;
    return '<div ' + brandVar() + '><div class="breadcrumb"><a href="#/">Home</a> / ' + (catObj ? '<a href="#/shop">Shop</a> / ' + esc(catObj.name) : 'Shop') + '</div>' +
      '<div class="shop-layout">' + filters + '<div><div class="toolbar"><div><h2 style="margin:0">' + esc(title) + '</h2><span class="muted small">' + list.length + ' products</span></div>' + sortSel + '</div>' +
      (list.length ? '<div class="product-grid">' + list.map(productCard).join('') + '</div>'
        : '<div class="card empty"><div class="empty-icon">🔍</div><h3>No products match</h3><p class="muted">Try a different search or clear the filters.</p><a class="btn btn-brand" href="#/shop">Browse all products</a></div>') +
      '</div></div></div>';
  }

  reg('#/shop', function (params) { return listing(params.query); });
  reg('#/category/:id', function (params) {
    if (!S.category(params.id)) return '<div class="card empty"><div class="empty-icon">🗂️</div><h3>Category not found</h3><a class="btn btn-primary" href="#/shop">Shop all products</a></div>';
    return listing(params.query, params.id);
  });

  function updateListing(patch) {
    var q = Object.assign({}, listing.q, patch);
    history.replaceState(null, '', listHref(listing.base, q));
    A.router.refresh();
  }
  A.actions.shopSearch = function (form) {
    var q = form.q.value.trim();
    A.router.go(q ? '#/shop?q=' + encodeURIComponent(q) : '#/shop');
  };
  A.actions.shopSort = function (el) { updateListing({ sort: el.value }); };
  A.actions.shopFilterStock = function (el) { updateListing({ instock: el.checked ? 1 : '' }); };
  A.actions.shopFilterBand = function (el) { updateListing({ min: +el.dataset.min || '', max: +el.dataset.max || '' }); };
  A.actions.shopFilterPrice = function (form) { updateListing({ min: form.min.value, max: form.max.value }); };
  A.actions.shopFilterCat = function () {
    var vals = Array.prototype.map.call(document.querySelectorAll('[data-change="shopFilterCat"]:checked'), function (c) { return c.value; });
    updateListing({ cat: vals.join(',') });
  };
  A.actions.quickAdd = function (el) {
    var p = S.product(el.dataset.id);
    if (S.addToCart(p.id, 1, '')) { ui.toast('Added “' + p.name + '” to cart'); A.router.refresh(); }
    else ui.toast('Sorry, no more stock available for ' + p.name, 'error');
  };

  /* ---------------- Product detail ---------------- */
  reg('#/product/:id', function (params) {
    var p = S.product(params.id);
    if (!p || p.active === false) return '<div class="card empty"><div class="empty-icon">📦</div><h3>Product not found</h3><p class="muted">It may have been removed from ' + esc(A.state.settings.storeName) + '.</p><a class="btn btn-primary" href="#/shop">Continue shopping</a></div>';
    if (pdpSel.pid !== p.id) pdpSel = { pid: p.id, size: '', color: p.variants.colors[0] || '', qty: 1, pinMsg: '' };
    var cat = S.category(p.categoryId), off = offPct(p), set = A.state.settings;
    var opt = function (kind, vals) {
      return vals.length ? '<div class="opt-group"><span class="label">' + (kind === 'size' ? 'Size' : 'Colour') + (pdpSel[kind] ? ': <b style="color:var(--text)">' + esc(pdpSel[kind]) + '</b>' : '') + '</span><div class="opts">' +
        vals.map(function (v) { return '<button type="button" class="opt' + (pdpSel[kind] === v ? ' on' : '') + '" data-action="pdpOpt" data-kind="' + kind + '" data-val="' + esc(v) + '">' + esc(v) + '</button>'; }).join('') + '</div></div>' : '';
    };
    var whs = A.state.warehouses.filter(function (w) { return (p.stockByWh[w.id] || 0) > 0; }).map(function (w) { return w.city; });
    var related = activeProducts().filter(function (x) { return x.categoryId === p.categoryId && x.id !== p.id; }).slice(0, 4);
    var inCart = S.cart().filter(function (l) { return l.productId === p.id; }).reduce(function (s, l) { return s + l.qty; }, 0);

    return '<div ' + brandVar() + '><div class="breadcrumb"><a href="#/">Home</a> / <a href="#/category/' + p.categoryId + '">' + esc(cat ? cat.name : '') + '</a> / ' + esc(p.name) + '</div>' +
      '<div class="pdp"><div>' + ui.productThumb(p, 'lg') + '</div><div>' +
      '<div class="muted small">' + esc(cat ? cat.name : '') + ' · SKU ' + esc(p.sku) + '</div><h1>' + esc(p.name) + '</h1>' +
      '<div class="rating" style="margin-bottom:10px"><b>' + p.rating + ' ★</b>' + fmt.num(p.reviews) + ' ratings</div>' +
      '<div class="row" style="gap:10px;align-items:baseline"><span class="price-big">' + fmt.inr(p.price) + '</span>' +
      (off ? '<span class="strike">MRP ' + fmt.inr(p.mrp) + '</span><span class="off">' + off + '% off</span>' : '') + '</div>' +
      '<div class="muted small">Inclusive of all taxes (GST ' + p.gst + '%)</div>' +
      '<p style="margin-top:12px">' + esc(p.description) + '</p>' +
      opt('size', p.variants.sizes) + opt('color', p.variants.colors) +
      '<div class="opt-group">' + stockLine(p) + (whs.length ? '<div class="muted small">Ships from ' + esc(whs.join(', ')) + (inCart ? ' · ' + inCart + ' already in your cart' : '') + '</div>' : '') + '</div>' +
      (p.stock > 0 ? '<div class="row"><div class="qty"><button type="button" data-action="pdpQty" data-d="-1" aria-label="Decrease">−</button><span>' + pdpSel.qty +
        '</span><button type="button" data-action="pdpQty" data-d="1" aria-label="Increase">+</button></div>' +
        '<button class="btn btn-lg" data-action="pdpAdd">🛒 Add to cart</button><button class="btn btn-lg btn-brand" data-action="pdpAdd" data-buy="1">Buy now</button></div>' : '') +
      '<form class="row" style="margin-top:16px;flex-wrap:nowrap" data-submit="pdpPin"><input class="input" name="pin" inputmode="numeric" maxlength="6" placeholder="Enter pincode to check delivery" style="max-width:260px"><button class="btn">Check</button></form>' +
      (pdpSel.pinMsg ? '<div class="small" style="margin-top:6px">' + pdpSel.pinMsg + '</div>' : '') +
      '<div class="perks"><div>🚚<br>Free delivery above ' + fmt.inr((set.shipping[0] || {}).freeAbove || 999) + '</div><div>↩️<br>7-day easy returns</div><div>' + (set.payments.cod ? '💵<br>Cash on Delivery' : '🔒<br>Secure payments') + '</div></div>' +
      '<table class="specs"><tr><td>Category</td><td>' + esc(cat ? cat.name : '') + '</td></tr><tr><td>HSN code</td><td>' + esc(p.hsn) + '</td></tr>' +
      '<tr><td>GST</td><td>' + p.gst + '%</td></tr><tr><td>Sold by</td><td>' + esc(set.legalName) + '</td></tr></table>' +
      '</div></div>' +
      (related.length ? '<section class="section"><div class="section-head"><h2>You may also like</h2></div><div class="product-grid">' + related.map(productCard).join('') + '</div></section>' : '') + '</div>';
  });

  A.actions.pdpOpt = function (el) { pdpSel[el.dataset.kind] = el.dataset.val; A.router.refresh(); };
  A.actions.pdpQty = function (el) {
    var p = S.product(pdpSel.pid);
    pdpSel.qty = Math.max(1, Math.min(p.stock, pdpSel.qty + Number(el.dataset.d)));
    A.router.refresh();
  };
  A.actions.pdpAdd = function (el) {
    var p = S.product(pdpSel.pid);
    if (p.variants.sizes.length && !pdpSel.size) { ui.toast('Please select a size', 'error'); return; }
    if (p.variants.colors.length && !pdpSel.color) { ui.toast('Please select a colour', 'error'); return; }
    var variant = [pdpSel.size, pdpSel.color].filter(Boolean).join(' / ');
    if (!S.addToCart(p.id, pdpSel.qty, variant)) { ui.toast('Only ' + p.stock + ' in stock — reduce the quantity', 'error'); return; }
    ui.toast('Added ' + pdpSel.qty + ' × ' + p.name + ' to cart');
    pdpSel.qty = 1;
    if (el.dataset.buy) A.router.go('#/checkout'); else A.router.refresh();
  };
  A.actions.pdpPin = function (form) {
    var pin = form.pin.value.trim();
    if (!/^[1-9]\d{5}$/.test(pin)) { pdpSel.pinMsg = '<span class="error-text">Enter a valid 6-digit pincode</span>'; A.router.refresh(); return; }
    var metro = /^(4000|4110|1100|1220|5600|6000|5000|7000)/.test(pin);
    var days = metro ? 2 : 4 + (Number(pin[5]) % 3);
    var d = new Date(Date.now() + days * 864e5);
    pdpSel.pinMsg = '<span class="ok-text">✓ Delivery to ' + esc(pin) + ' by <b>' + d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) + '</b>' +
      (A.state.settings.payments.cod ? ' · COD available' : '') + '</span>';
    A.router.refresh();
  };

  /* ---------------- Cart ---------------- */
  function summaryHtml(t, opts) {
    opts = opts || {};
    return '<div class="sum-row"><span>Subtotal (' + opts.count + ' items)</span><span>' + fmt.inr(t.subtotal) + '</span></div>' +
      (t.discount ? '<div class="sum-row"><span>Coupon ' + esc(t.coupon) + '</span><span class="save">−' + fmt.inr(t.discount) + '</span></div>' : '') +
      '<div class="sum-row"><span>Shipping' + (opts.estimate ? ' (est.)' : '') + '</span><span>' + (t.shipping ? fmt.inr(t.shipping) : '<span class="save">FREE</span>') + '</span></div>' +
      (t.codFee ? '<div class="sum-row"><span>COD handling fee</span><span>' + fmt.inr(t.codFee) + '</span></div>' : '') +
      '<div class="sum-row total"><span>Total</span><span>' + fmt.inr(t.total) + '</span></div>' +
      '<div class="muted small">Includes GST of ' + fmt.inr2(t.tax) + '</div>' +
      (opts.mrpSave > 0 ? '<div class="ok-text" style="margin-top:6px">You save ' + fmt.inr(opts.mrpSave + t.discount) + ' on this order 🎉</div>' : '');
  }
  function couponBox() {
    var active = A.state.coupons.filter(function (c) { return c.active && (!c.expiry || c.expiry >= fmt.ymd()); });
    return '<div class="coupon-row"><input class="input" id="coupon-input" placeholder="Coupon code" value="' + esc(co.coupon) + '" style="text-transform:uppercase">' +
      '<button type="button" class="btn" data-action="applyCoupon">Apply</button></div><div id="coupon-msg" class="small" style="margin-top:4px"></div>' +
      '<div class="coupon-chips">' + active.map(function (c) { return '<button type="button" class="coupon-chip" data-action="pickCoupon" data-code="' + esc(c.code) + '" title="' + esc(c.description) + '">' + esc(c.code) + '</button>'; }).join('') + '</div>';
  }
  function mrpSavings(lines) { return lines.reduce(function (s, l) { return s + Math.max(0, l.p.mrp - l.p.price) * l.qty; }, 0); }

  reg('#/cart', function () {
    var lines = S.cartLines();
    if (!lines.length) return '<div ' + brandVar() + ' class="card empty"><div class="empty-icon">🛒</div><h3>Your cart is empty</h3><p class="muted">Explore bestsellers and festive deals from ' + esc(A.state.settings.storeName) + '.</p><a class="btn btn-brand" href="#/shop">Start shopping</a></div>';
    var t = S.totals(lines, co.coupon, 'standard', '');
    var count = S.cartCount();
    return '<div ' + brandVar() + '><h1>Shopping cart</h1><div class="cart-layout"><div class="card">' +
      lines.map(function (l) {
        return '<div class="cart-line">' + ui.productThumb(l.p, 'sm') + '<div class="info"><a href="#/product/' + l.p.id + '">' + esc(l.p.name) + '</a>' +
          '<div class="muted small">' + (l.variant ? esc(l.variant) + ' · ' : '') + fmt.inr(l.p.price) + ' each' + (l.qty >= l.p.stock ? ' · <span style="color:var(--warning)">max available</span>' : '') + '</div>' +
          '<div class="row" style="margin-top:6px"><div class="qty"><button data-action="cartQty" data-idx="' + l.idx + '" data-d="-1" aria-label="Decrease">−</button><span>' + l.qty + '</span>' +
          '<button data-action="cartQty" data-idx="' + l.idx + '" data-d="1" aria-label="Increase">+</button></div><button class="btn btn-sm btn-ghost" data-action="cartRemove" data-idx="' + l.idx + '">Remove</button></div></div>' +
          '<div class="price">' + fmt.inr(l.p.price * l.qty) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="card summary"><h3>Order summary</h3>' + couponBox() + '<div id="cart-sum" style="margin-top:12px">' + summaryHtml(t, { count: count, estimate: true, mrpSave: mrpSavings(lines) }) + '</div>' +
      '<a class="btn btn-brand btn-lg btn-block" style="margin-top:14px" href="#/checkout">Proceed to checkout →</a>' +
      '<a class="btn btn-ghost btn-block" style="margin-top:6px" href="#/shop">Continue shopping</a></div></div></div>';
  });

  A.actions.cartQty = function (el) {
    var cart = S.cart(), l = cart[+el.dataset.idx]; if (!l) return;
    var p = S.product(l.productId);
    var others = cart.filter(function (x) { return x !== l && x.productId === l.productId; }).reduce(function (s, x) { return s + x.qty; }, 0);
    var next = l.qty + Number(el.dataset.d);
    if (next + others > p.stock) { ui.toast('Only ' + p.stock + ' in stock', 'error'); return; }
    if (next <= 0) cart.splice(+el.dataset.idx, 1); else l.qty = next;
    S.saveSession(); A.router.refresh();
  };
  A.actions.cartRemove = function (el) { S.cart().splice(+el.dataset.idx, 1); S.saveSession(); ui.toast('Removed from cart'); A.router.refresh(); };
  A.actions.pickCoupon = function (el) { document.getElementById('coupon-input').value = el.dataset.code; A.actions.applyCoupon(); };
  A.actions.applyCoupon = function () {
    var code = document.getElementById('coupon-input').value.trim().toUpperCase();
    var lines = S.cartLines();
    var sub = lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var v = S.validateCoupon(code, sub);
    co.coupon = v.ok ? code : '';
    if (!code) { co.coupon = ''; }
    if (document.getElementById('co-form')) refreshCheckoutSummary(); else A.router.refresh();
    var msg = document.getElementById('coupon-msg');
    if (msg && code) msg.innerHTML = '<span class="' + (v.ok ? 'ok-text' : 'error-text') + '">' + esc(v.msg) + '</span>';
    if (code) ui.toast(v.ok ? v.msg : v.msg, v.ok ? 'success' : 'error');
  };

  /* ---------------- Checkout ---------------- */
  function checkoutValues() {
    var f = document.getElementById('co-form');
    return f ? ui.formData(f) : {};
  }
  function refreshCheckoutSummary() {
    var v = checkoutValues(), lines = S.cartLines();
    var t = S.totals(lines, co.coupon, v.shipping, v.payment);
    var el = document.getElementById('co-sum');
    if (el) el.innerHTML = summaryHtml(t, { count: S.cartCount(), mrpSave: mrpSavings(lines) });
    var btn = document.getElementById('co-place');
    if (btn) btn.textContent = (v.payment === 'COD' ? 'Place order · ' : 'Pay ') + fmt.inr(t.total);
    return t;
  }

  reg('#/checkout', function () {
    var lines = S.cartLines(), set = A.state.settings;
    if (!lines.length) return '<div class="card empty"><div class="empty-icon">🧾</div><h3>Nothing to check out</h3><p class="muted">Your cart is empty.</p><a class="btn btn-primary" href="#/shop">Browse products</a></div>';
    var c = S.currentCustomer() || {};
    var ships = set.shipping.filter(function (s) { return s.active; });
    var sub = lines.reduce(function (s, l) { return s + l.price * l.qty; }, 0);
    var pays = [['UPI', 'upi', '📱 UPI', 'Google Pay, PhonePe, Paytm, BHIM'], ['Card', 'card', '💳 Credit / Debit card', 'Visa, Mastercard, RuPay'],
      ['COD', 'cod', '💵 Cash on Delivery', '+' + fmt.inr(set.codFee) + ' handling fee' + (set.codLimit ? ' · up to ' + fmt.inr(set.codLimit) : '')]]
      .filter(function (p) { return set.payments[p[1]] && !(p[0] === 'COD' && set.codLimit && sub > set.codLimit); });
    var t0 = S.totals(lines, co.coupon, ships[0] && ships[0].id, pays[0] && pays[0][0]);
    var stateOpts = A.data.states.map(function (s) { return '<option' + (s === (c.state || '') ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('');
    var f = function (label, name, val, attrs) { return '<label class="field"><span>' + label + '</span><input class="input" name="' + name + '" value="' + esc(val || '') + '" ' + (attrs || '') + '></label>'; };

    return '<div ' + brandVar() + '><div class="steps"><span>Cart</span>›<b>Address & payment</b>›<span>Confirmation</span></div><h1>Checkout</h1>' +
      (c.id ? '' : '<div class="notice">Returning customer? <a href="#/login?next=%23%2Fcheckout">Log in</a> for faster checkout — or continue as a guest.</div>') +
      '<form id="co-form" data-submit="placeOrder" novalidate><div class="cart-layout"><div>' +
      '<div class="card"><h3>1. Contact</h3><div class="field-row">' + f('Email', 'email', c.email, 'type="email" required') + f('Mobile number', 'phone', c.phone, 'type="tel" required placeholder="+91 98xxx xxxxx"') + '</div></div>' +
      '<div class="card"><h3>2. Delivery address</h3>' + f('Full name', 'name', c.name, 'required') + f('Flat, house no., street, area', 'line', c.line, 'required') +
      '<div class="field-row">' + f('City', 'city', c.city, 'required') + f('Pincode', 'pincode', c.pincode, 'inputmode="numeric" maxlength="6" required') + '</div>' +
      '<label class="field"><span>State</span><select class="input" name="state" data-change="coChange"><option value="">Select state</option>' + stateOpts + '</select></label></div>' +
      '<div class="card"><h3>3. Shipping</h3>' + ships.map(function (s, i) {
        return '<label class="choice"><input type="radio" name="shipping" value="' + s.id + '" data-change="coChange"' + (i === 0 ? ' checked' : '') + '><div class="grow"><b>' + esc(s.name) + '</b><div class="muted small">' + esc(s.days) +
          (s.freeAbove ? ' · free above ' + fmt.inr(s.freeAbove) : '') + '</div></div><b>' + fmt.inr(s.rate) + '</b></label>';
      }).join('') + '</div>' +
      '<div class="card"><h3>4. Payment</h3>' + pays.map(function (p, i) {
        return '<label class="choice"><input type="radio" name="payment" value="' + p[0] + '" data-change="coChange"' + (i === 0 ? ' checked' : '') + '><div class="grow"><b>' + p[2] + '</b><div class="muted small">' + p[3] + '</div></div></label>';
      }).join('') + '<div class="muted small">🔒 Payments are processed by Razorpay (simulated in this demo).</div></div>' +
      '</div><div class="card summary"><h3>Your order</h3>' +
      lines.map(function (l) { return '<div class="cart-line" style="padding:8px 0">' + ui.productThumb(l.p, 'xs') + '<div class="info small"><b>' + esc(l.p.name) + '</b><div class="muted">' + (l.variant ? esc(l.variant) + ' · ' : '') + 'Qty ' + l.qty + '</div></div><span class="small">' + fmt.inr(l.p.price * l.qty) + '</span></div>'; }).join('') +
      '<div style="margin:12px 0">' + couponBox() + '</div><div id="co-sum">' + summaryHtml(t0, { count: S.cartCount(), mrpSave: mrpSavings(lines) }) + '</div>' +
      '<button id="co-place" type="submit" class="btn btn-brand btn-lg btn-block" style="margin-top:14px">' + (pays[0] && pays[0][0] === 'COD' ? 'Place order · ' : 'Pay ') + fmt.inr(t0.total) + '</button>' +
      '<div class="muted small" style="margin-top:8px;text-align:center">By placing the order you agree to ' + esc(set.storeName) + '\'s terms & return policy.</div></div></div></form></div>';
  });

  A.actions.coChange = function () { refreshCheckoutSummary(); };

  A.actions.placeOrder = function (form) {
    var v = ui.formData(form);
    var errs = [];
    if (!/^\S+@\S+\.\S+$/.test(v.email || '')) errs.push('a valid email');
    if ((v.phone || '').replace(/\D/g, '').replace(/^91/, '').length !== 10) errs.push('a 10-digit mobile number');
    if (!v.name) errs.push('your name');
    if (!v.line) errs.push('your address');
    if (!v.city) errs.push('city');
    if (!/^[1-9]\d{5}$/.test(v.pincode || '')) errs.push('a 6-digit pincode');
    if (!v.state) errs.push('state');
    if (!v.payment) errs.push('a payment method');
    if (errs.length) { ui.toast('Please enter ' + errs.join(', '), 'error'); return; }
    var t = refreshCheckoutSummary();

    var finish = function () {
      try {
        var o = S.placeOrder({
          address: { name: v.name, line: v.line, city: v.city, state: v.state, pincode: v.pincode, phone: v.phone },
          email: v.email, couponCode: co.coupon, shippingId: v.shipping, payment: v.payment
        });
        co.coupon = '';
        ui.toast('Order ' + o.id + ' placed successfully');
        A.router.go('#/order/' + o.id + '?new=1');
      } catch (e) { ui.toast(e.message, 'error'); }
    };
    if (v.payment === 'COD') { finish(); return; }

    var body = v.payment === 'UPI'
      ? '<div style="text-align:center"><div style="font-size:13px" class="muted">Scan with any UPI app or approve the request sent to</div>' +
        '<div style="margin:14px auto;width:150px;height:150px;border-radius:12px;background:repeating-conic-gradient(#0f172a 0 25%,#fff 0 50%) 0 0/18px 18px;border:8px solid #fff;box-shadow:0 0 0 1px var(--border)"></div>' +
        '<label class="field" style="text-align:left"><span>UPI ID</span><input class="input" name="vpa" value="' + esc(v.phone.replace(/\D/g, '').slice(-10)) + '@ybl"></label></div>'
      : '<label class="field"><span>Card number</span><input class="input" name="card" value="4111 1111 1111 1111"></label><div class="field-row">' +
        '<label class="field"><span>Expiry</span><input class="input" name="exp" value="12/29"></label><label class="field"><span>CVV</span><input class="input" name="cvv" value="123" type="password"></label></div>' +
        '<label class="field"><span>Name on card</span><input class="input" name="holder" value="' + esc(v.name) + '"></label>';
    ui.modal({
      title: 'Razorpay · Pay ' + fmt.inr(t.total), saveLabel: 'Pay ' + fmt.inr(t.total),
      body: '<div class="notice">Test mode — no real money is charged.</div>' + body + '<div class="muted small">Paying ' + esc(A.state.settings.legalName) + '</div>',
      onSave: function () { setTimeout(finish, 0); }
    });
  };

  /* ---------------- Order confirmation / detail ---------------- */
  var STEPS = ['pending', 'shipped', 'delivered'];
  function timeline(o) {
    var idx = STEPS.indexOf(o.status);
    var labels = { pending: 'Order placed', shipped: 'Shipped', delivered: 'Delivered' };
    var html = STEPS.map(function (s, i) {
      var h = (o.history || []).filter(function (x) { return x.status === s; })[0];
      var done = o.status === 'returned' || i <= idx;
      return '<div class="' + (done ? 'done' : '') + '">' + labels[s] + (h ? '<br><span class="muted" style="font-weight:400">' + fmt.date(h.at) + '</span>' : '') + '</div>';
    }).join('');
    if (o.status === 'returned') html += '<div class="bad">Returned</div>';
    return '<div class="timeline">' + html + '</div>';
  }

  reg('#/order/:id', function (params) {
    var o = S.order(params.id);
    var me = S.currentCustomer();
    if (!o) return '<div class="card empty"><div class="empty-icon">📭</div><h3>Order not found</h3><a class="btn btn-primary" href="#/account">My orders</a></div>';
    var isNew = params.query.new;
    var ship = A.state.settings.shipping.filter(function (s) { return s.id === o.shippingMethod; })[0];
    return '<div ' + brandVar() + '>' +
      (isNew ? '<div class="success-hero"><div class="big">🎉</div><h1>Thank you, ' + esc(o.address.name.split(' ')[0]) + '!</h1><p class="muted">Your order <b>' + esc(o.id) + '</b> has been placed. A confirmation has been sent to ' + esc(o.email || '') + '.</p></div>'
        : '<div class="breadcrumb"><a href="#/">Home</a> / ' + (me ? '<a href="#/account">My orders</a> / ' : '') + esc(o.id) + '</div>') +
      '<div class="cart-layout"><div class="card"><div class="order-card-head"><div><h3 style="margin:0">Order ' + esc(o.id) + '</h3><span class="muted small">Placed ' + fmt.dateTime(o.date) + '</span></div>' + ui.badge(o.status) + '</div>' +
      timeline(o) +
      o.items.map(function (it) {
        var p = S.product(it.productId) || { categoryId: '', name: it.name };
        return '<div class="cart-line">' + ui.productThumb(p, 'sm') + '<div class="info"><b>' + esc(it.name) + '</b><div class="muted small">' + (it.variant ? esc(it.variant) + ' · ' : '') + 'Qty ' + it.qty + ' × ' + fmt.inr(it.price) + '</div></div><b>' + fmt.inr(it.price * it.qty) + '</b></div>';
      }).join('') + '</div>' +
      '<div><div class="card"><h3>Payment summary</h3>' + summaryHtml(o, { count: o.items.reduce(function (s, i) { return s + i.qty; }, 0) }) +
      '<div class="small" style="margin-top:10px">Paid via <b>' + esc(o.payment) + '</b> · ' + ui.badge(o.paymentStatus || 'Paid', o.paymentStatus === 'Pending' ? 'warning' : o.paymentStatus === 'Refunded' ? 'muted' : 'success') + '</div></div>' +
      '<div class="card"><h3>Delivering to</h3><div><b>' + esc(o.address.name) + '</b><br>' + esc(o.address.line) + '<br>' + esc(o.address.city + ', ' + o.address.state + ' – ' + o.address.pincode) + '<br><span class="muted">' + esc(o.address.phone) + '</span></div>' +
      (ship ? '<div class="muted small" style="margin-top:8px">' + esc(ship.name) + ' · ' + esc(ship.days) + '</div>' : '') + '</div>' +
      '<div class="row" style="margin-top:14px"><a class="btn btn-brand" href="#/shop">Continue shopping</a><a class="btn" href="#/account">My orders</a></div>' +
      (isNew ? '<div class="notice" style="margin-top:14px">Demo tip: this order is now live in <a href="#/admin/orders/' + esc(o.id) + '">Admin → Orders</a> and stock has been reduced in Inventory.</div>' : '') +
      '</div></div></div>';
  });

  /* ---------------- Login / signup ---------------- */
  var authTab = 'login';
  reg('#/login', function (params) {
    if (params.query.tab) authTab = params.query.tab;
    var demo = A.state.customers[0];
    var next = params.query.next || '#/account';
    var f = function (label, name, attrs, val) { return '<label class="field"><span>' + label + '</span><input class="input" name="' + name + '" ' + (attrs || '') + ' value="' + esc(val || '') + '"></label>'; };
    return '<div ' + brandVar() + ' class="auth-box card"><div style="text-align:center;margin-bottom:8px"><span class="logo-mark" style="width:48px;height:48px;font-size:26px">' + esc(A.state.settings.logoEmoji) + '</span>' +
      '<h2 style="margin-top:8px">' + (authTab === 'login' ? 'Welcome back' : 'Create your account') + '</h2></div>' +
      '<div class="tabs"><button class="tab' + (authTab === 'login' ? ' on' : '') + '" data-action="authTab" data-tab="login">Login</button><button class="tab' + (authTab === 'signup' ? ' on' : '') + '" data-action="authTab" data-tab="signup">Sign up</button></div>' +
      (authTab === 'login'
        ? '<form data-submit="customerLogin" data-next="' + esc(next) + '">' + f('Email', 'email', 'type="email" required autocomplete="email"', '') + f('Password', 'password', 'type="password"', '') +
          '<button class="btn btn-brand btn-block btn-lg">Login</button><div class="muted small" style="margin-top:10px">Demo: use <a href="#" data-action="fillDemo" data-email="' + esc(demo.email) + '">' + esc(demo.email) + '</a> with any password.</div></form>'
        : '<form data-submit="customerSignup" data-next="' + esc(next) + '">' + f('Full name', 'name', 'required') + f('Email', 'email', 'type="email" required') + f('Mobile number', 'phone', 'type="tel" placeholder="+91 98xxx xxxxx"') +
          '<div class="field-row">' + f('City', 'city') + f('Pincode', 'pincode', 'inputmode="numeric" maxlength="6"') + '</div>' + f('Password', 'password', 'type="password"') +
          '<button class="btn btn-brand btn-block btn-lg">Create account</button><div class="muted small" style="margin-top:10px">We\'ll send order updates on email & WhatsApp.</div></form>') +
      '</div>';
  });
  A.actions.authTab = function (el) { authTab = el.dataset.tab; A.router.refresh(); };
  A.actions.fillDemo = function (el) { var i = document.querySelector('input[name=email]'); if (i) { i.value = el.dataset.email; document.querySelector('input[name=password]').value = 'demo1234'; } };
  A.actions.customerLogin = function (form) {
    var email = form.email.value.trim().toLowerCase();
    var c = A.state.customers.filter(function (x) { return x.email.toLowerCase() === email; })[0];
    if (!c) { ui.toast('No account found for ' + (email || 'that email') + ' — please sign up', 'error'); return; }
    S.loginCustomer(c);
    ui.toast('Welcome back, ' + c.name.split(' ')[0] + '!');
    A.router.go(form.dataset.next || '#/account');
  };
  A.actions.customerSignup = function (form) {
    var v = ui.formData(form);
    if (!v.name || !/^\S+@\S+\.\S+$/.test(v.email)) { ui.toast('Please enter your name and a valid email', 'error'); return; }
    if (A.state.customers.some(function (x) { return x.email.toLowerCase() === v.email.toLowerCase(); })) { ui.toast('An account with this email already exists — please log in', 'error'); return; }
    var c = { id: S.uid('c'), name: v.name, email: v.email, phone: v.phone, line: '', city: v.city, state: '', pincode: v.pincode, joined: new Date().toISOString(), notes: 'Signed up on storefront' };
    A.state.customers.unshift(c);
    S.save();
    S.loginCustomer(c);
    ui.toast('Account created — welcome, ' + v.name.split(' ')[0] + '!');
    A.router.go(form.dataset.next || '#/account');
  };

  /* ---------------- My account / orders ---------------- */
  reg('#/account', function () {
    var c = S.currentCustomer();
    if (!c) return '<div class="card empty auth-box"><div class="empty-icon">👤</div><h3>Log in to see your orders</h3><p class="muted">Track shipments, download invoices and reorder favourites.</p><a class="btn btn-primary" href="#/login?next=%23%2Faccount">Login / Sign up</a></div>';
    var orders = A.state.orders.filter(function (o) { return o.customerId === c.id; });
    var spent = orders.reduce(function (s, o) { return s + (o.status === 'returned' ? 0 : o.total); }, 0);
    return '<div ' + brandVar() + '><div class="toolbar"><div><h1 style="margin:0">Hi, ' + esc(c.name.split(' ')[0]) + ' 👋</h1><span class="muted">' + esc(c.email) + (c.phone ? ' · ' + esc(c.phone) : '') + '</span></div>' +
      '<button class="btn" data-action="customerLogout">Log out</button></div>' +
      '<div class="grid grid-3" style="margin-bottom:16px">' + ui.kpi('Orders', orders.length) + ui.kpi('Total spent', fmt.inr(spent)) + ui.kpi('Member since', fmt.date(c.joined)) + '</div>' +
      '<h2>My orders</h2>' +
      (orders.length ? orders.map(function (o) {
        return '<div class="order-card"><div class="order-card-head"><div><a href="#/order/' + esc(o.id) + '"><b>' + esc(o.id) + '</b></a> <span class="muted small">· ' + fmt.date(o.date) + ' · ' + esc(o.payment) + '</span></div>' +
          '<div class="row">' + ui.badge(o.status) + '<b>' + fmt.inr(o.total) + '</b></div></div>' +
          '<div class="mini-items">' + o.items.map(function (it) { var p = S.product(it.productId) || {}; return '<span title="' + esc(it.name) + '">' + ui.productThumb(p, 'xs') + '</span>'; }).join('') +
          '<span class="muted small" style="align-self:center">' + esc(o.items.map(function (it) { return it.name + (it.qty > 1 ? ' ×' + it.qty : ''); }).join(', ')) + '</span></div>' +
          timeline(o) + '<a class="btn btn-sm" href="#/order/' + esc(o.id) + '">View details</a></div>';
      }).join('') : '<div class="card empty"><div class="empty-icon">📦</div><h3>No orders yet</h3><p class="muted">Your orders will appear here.</p><a class="btn btn-brand" href="#/shop">Start shopping</a></div>') +
      '</div>';
  });
  A.actions.customerLogout = function () { S.loginCustomer(null); ui.toast('Logged out'); A.router.go('#/'); };
})(window.App);
