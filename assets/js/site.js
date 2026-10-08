/* =========================================================================
   NB Aquarium House — storefront behaviour
   Vanilla JS, no build step. The basket lives in localStorage and every read
   and write is guarded, because storage throws in private windows and comes
   back empty with site data cleared.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NB_CFG || {};
  var BASE = window.NB_BASE || './';
  var CATALOG = (window.NB_CATALOG && window.NB_CATALOG.products) || [];
  var KEY = 'nb_cart_v1';

  var byId = {};
  CATALOG.forEach(function (p) { byId[p.slug] = p; });

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------- storage -- */

  function readCart() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  }

  var memory = readCart();

  function writeCart(cart) {
    try { window.localStorage.setItem(KEY, JSON.stringify(cart)); } catch (e) { /* unavailable */ }
    memory = cart;
    renderAll();
  }

  function getCart() { return memory; }

  /* ------------------------------------------------------------- money -- */

  function money(n) {
    var sym = CFG.currencySymbol || 'Rs. ';
    return sym + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function lines() {
    var cart = getCart();
    return Object.keys(cart).map(function (slug) {
      var p = byId[slug];
      if (!p) return null;
      var qty = Math.max(0, parseInt(cart[slug], 10) || 0);
      if (!qty) return null;
      return { product: p, qty: qty, total: p.price * qty };
    }).filter(Boolean);
  }

  function subtotal() { return lines().reduce(function (s, l) { return s + l.total; }, 0); }
  function count() { return lines().reduce(function (s, l) { return s + l.qty; }, 0); }
  function hasLive() { return lines().some(function (l) { return l.product.live; }); }

  /* ------------------------------------------------------------ mutate -- */

  function add(slug, qty) {
    var p = byId[slug];
    if (!p) return;
    var cart = getCart();
    cart[slug] = (parseInt(cart[slug], 10) || 0) + (qty || p.minQty || 1);
    writeCart(cart);
    toast(p.name + ' added to your basket');
  }

  function setQty(slug, qty) {
    var cart = getCart();
    var min = (byId[slug] && byId[slug].minQty) || 1;
    if (qty < min) delete cart[slug]; else cart[slug] = qty;
    writeCart(cart);
  }

  function remove(slug) { var c = getCart(); delete c[slug]; writeCart(c); }

  /* --------------------------------------------------------- rendering -- */

  function lineMarkup(l) {
    var p = l.product;
    return '<div class="line" data-line="' + p.slug + '">' +
      '<img class="line__thumb" src="' + BASE + 'assets/img/' + p.image + '-400.webp" alt="" width="64" height="48" loading="lazy">' +
      '<div><p class="line__name"><a href="' + BASE + p.url + '">' + p.name + '</a></p>' +
      '<p class="line__meta">' + money(p.price) + ' &middot; ' + p.unit + '</p>' +
      (p.live ? '<p class="line__meta">Collection or valley delivery only</p>' : '') +
      '<div class="line__controls">' +
      '<button type="button" data-dec="' + p.slug + '" aria-label="Reduce quantity of ' + p.name + '">&minus;</button>' +
      '<span class="line__qty">' + l.qty + '</span>' +
      '<button type="button" data-inc="' + p.slug + '" aria-label="Increase quantity of ' + p.name + '">+</button>' +
      '<button type="button" class="line__remove" data-remove="' + p.slug + '">Remove</button>' +
      '</div></div>' +
      '<p class="line__price">' + money(l.total) + '</p></div>';
  }

  function shippingCost() {
    var picked = document.querySelector('[name="fulfilment"]:checked');
    if (!picked) return 0;
    if (picked.value === 'local') return CFG.localDelivery || 0;
    if (picked.value === 'courier') return subtotal() >= (CFG.freeShippingThreshold || Infinity) ? 0 : (CFG.flatShipping || 0);
    return 0;
  }

  function shippingLabel() {
    var picked = document.querySelector('[name="fulfilment"]:checked');
    if (!picked) return 'Chosen at checkout';
    if (picked.value === 'collection') return 'Free, collection';
    var c = shippingCost();
    return c === 0 ? 'Free' : money(c);
  }

  function renderAll() {
    var ls = lines();
    var sub = subtotal();

    var badge = document.querySelector('[data-cart-count]');
    if (badge) { var c = count(); badge.textContent = c; badge.hidden = c === 0; }

    var empty = '<p class="empty">Nothing in your basket yet. <a href="' + BASE + 'aquarium/">Have a look at the range</a>.</p>';
    ['[data-cart-lines]', '[data-cart-page-lines]', '[data-checkout-lines]'].forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) el.innerHTML = ls.length ? ls.map(lineMarkup).join('') : empty;
    });

    var ds = document.querySelector('[data-cart-subtotal]');
    if (ds) ds.textContent = money(sub);

    var note = document.querySelector('[data-cart-note]');
    if (note) note.textContent = hasLive() ? 'Contains living stock: collection or valley delivery only.' : (ls.length ? 'Delivery is chosen at checkout.' : '');

    document.querySelectorAll('[data-total-subtotal]').forEach(function (e) { e.textContent = money(sub); });
    document.querySelectorAll('[data-total-shipping]').forEach(function (e) { e.textContent = shippingLabel(); });
    document.querySelectorAll('[data-total-grand]').forEach(function (e) { e.textContent = money(sub + shippingCost()); });

    var ln = document.querySelector('[data-cart-livestock-note]');
    if (ln) ln.hidden = !hasLive();

    var link = document.querySelector('[data-checkout-link]');
    if (link) { if (!ls.length) link.setAttribute('aria-disabled', 'true'); else link.removeAttribute('aria-disabled'); }

    syncFulfilment();
    renderShipMeter();
  }

  /** Courier is switched off whenever anything living is in the basket. */
  function syncFulfilment() {
    var courier = document.querySelector('[data-courier-choice]');
    if (!courier) return;
    var input = courier.querySelector('input');
    var notice = document.querySelector('[data-livestock-notice]');
    var live = hasLive();

    courier.classList.toggle('is-disabled', live);
    if (input) input.disabled = live;
    if (notice) notice.hidden = !live;
    if (live && input && input.checked) {
      var fallback = document.querySelector('[name="fulfilment"][value="collection"]');
      if (fallback) fallback.checked = true;
    }

    var addr = document.querySelector('[data-address-fields]');
    if (addr) {
      var picked = document.querySelector('[name="fulfilment"]:checked');
      var needs = picked && picked.value !== 'collection';
      addr.hidden = !needs;
      addr.querySelectorAll('input').forEach(function (i) { i.required = !!needs; });
    }
  }

  /* ------------------------------------------------------------- toast -- */

  var toastTimer = null;
  function toast(msg) {
    var el = document.querySelector('[data-toast]');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    window.requestAnimationFrame(function () { el.classList.add('is-visible'); });
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(function () {
      el.classList.remove('is-visible');
      window.setTimeout(function () { el.hidden = true; }, 260);
    }, 2400);
  }

  /* ------------------------------------------------------- open/close -- */

  var lastFocus = null;

  function openPanel(sel, focusSel) {
    var p = document.querySelector(sel);
    if (!p) return;
    lastFocus = document.activeElement;
    p.hidden = false;
    document.body.style.overflow = 'hidden';
    var f = focusSel ? p.querySelector(focusSel) : null;
    if (f && f.focus) f.focus();
  }

  function closePanel(sel) {
    var p = document.querySelector(sel);
    if (!p || p.hidden) return;
    p.hidden = true;
    document.body.style.overflow = '';
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ------------------------------------------------------------ search -- */

  function initSearch() {
    var input = document.querySelector('[data-search-input]');
    var out = document.querySelector('[data-search-results]');
    if (!input || !out) return;

    function run() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { out.innerHTML = ''; return; }
      var hits = CATALOG.filter(function (p) {
        return (p.name + ' ' + p.latin + ' ' + p.collection).toLowerCase().indexOf(q) !== -1;
      }).slice(0, 8);
      out.innerHTML = hits.length
        ? hits.map(function (p) {
            return '<a class="search__hit" href="' + BASE + p.url + '">' +
              '<img src="' + BASE + 'assets/img/' + p.image + '-400.webp" alt="" width="52" height="39" loading="lazy">' +
              '<span><b>' + p.name + '</b><br><span>' + money(p.price) + '</span></span></a>';
          }).join('')
        : '<p class="empty">Nothing matches that.</p>';
    }
    input.addEventListener('input', run);
  }

  /* -------------------------------------------------------- mega menus -- */

  function initMenus() {
    document.querySelectorAll('[data-menu]').forEach(function (item) {
      var btn = item.querySelector('button');
      if (!btn) return;
      btn.addEventListener('click', function () {
        var open = item.classList.contains('is-open');
        document.querySelectorAll('[data-menu]').forEach(function (o) {
          o.classList.remove('is-open');
          var b = o.querySelector('button');
          if (b) b.setAttribute('aria-expanded', 'false');
        });
        if (!open) { item.classList.add('is-open'); btn.setAttribute('aria-expanded', 'true'); }
      });
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('[data-menu]')) return;
      document.querySelectorAll('[data-menu]').forEach(function (o) {
        o.classList.remove('is-open');
        var b = o.querySelector('button');
        if (b) b.setAttribute('aria-expanded', 'false');
      });
    });
  }

  /* ============================================================ motion == */

  var vh = window.innerHeight;
  window.addEventListener('resize', function () { vh = window.innerHeight; }, { passive: true });

  /** One observer for every entrance: reveal, fade-up, word splits, wipes.
   *  Siblings stagger; the index resets per parent and is capped. */
  function initReveal() {
    var items = document.querySelectorAll('.reveal, .fade-up, .wsplit, .wipe');
    if (!items.length) return;
    var seen = new Map();
    document.querySelectorAll('.reveal').forEach(function (el) {
      var n = seen.get(el.parentNode) || 0;
      seen.set(el.parentNode, n + 1);
      el.style.setProperty('--i', Math.min(n, 6));
    });
    if (!('IntersectionObserver' in window)) { items.forEach(function (el) { el.classList.add('is-in'); }); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 });
    items.forEach(function (el) { io.observe(el); });

    // Anything already on screen at load animates in immediately.
    requestAnimationFrame(function () {
      items.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) el.classList.add('is-in');
      });
    });
    // Safety net: these start hidden, so an element the observer never reaches
    // would be invisible content rather than a skipped animation.
    window.setTimeout(function () { items.forEach(function (el) { el.classList.add('is-in'); }); }, 3000);
  }

  /** Header: condensed once scrolled, hidden while scrolling down, back on the
   *  way up. Also the reading-progress bar and the parallax layers. */
  function initScroll() {
    var bar = document.querySelector('[data-progress]');
    var header = document.querySelector('[data-header]');
    var hero = document.querySelector('[data-parallax]');
    var pimgs = document.querySelectorAll('[data-parallax-img] img');
    var scrubs = document.querySelectorAll('[data-scrub]');
    var lastY = window.scrollY;
    var ticking = false;

    scrubs.forEach(splitForScrub);

    function update() {
      ticking = false;
      var y = window.scrollY;
      var max = document.documentElement.scrollHeight - vh;
      if (bar) bar.style.transform = 'scaleX(' + (max > 0 ? Math.min(1, y / max) : 0) + ')';
      if (header) {
        header.classList.toggle('is-stuck', y > 40);
        var tog = document.querySelector('[data-menu-toggle]');
        var menuOpen = document.querySelector('[data-menu].is-open') || (tog && tog.getAttribute('aria-expanded') === 'true');
        header.classList.toggle('is-hidden', !menuOpen && y > 400 && y > lastY + 2);
        if (y < lastY - 2) header.classList.remove('is-hidden');
      }
      lastY = y;

      if (reduced) return;
      if (hero && y < vh * 1.2) {
        var k = parseFloat(hero.getAttribute('data-parallax')) || 0.2;
        hero.style.transform = 'translate3d(0,' + (y * k).toFixed(1) + 'px,0)';
      }
      pimgs.forEach(function (img) {
        var r = img.parentNode.getBoundingClientRect();
        if (r.bottom < 0 || r.top > vh) return;
        var mid = (r.top + r.height / 2 - vh / 2) / vh;
        img.style.transform = 'translate3d(0,' + (mid * -9).toFixed(2) + '%,0)';
      });
      scrubs.forEach(scrub);
    }

    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
  }

  /** Wraps each word of a statement so it can brighten with scroll. */
  function splitForScrub(el) {
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (n) {
        if (n.nodeType === 3) {
          var frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(w)); return; }
            var s = document.createElement('span'); s.className = 'sw'; s.textContent = w; frag.appendChild(s);
          });
          n.parentNode.replaceChild(frag, n);
        } else if (n.nodeType === 1) walk(n);
      });
    })(el);
    el._words = el.querySelectorAll('.sw');
    if (reduced) el._words.forEach(function (w) { w.classList.add('on'); });
  }

  function scrub(el) {
    var words = el._words; if (!words) return;
    var r = el.getBoundingClientRect();
    var p = (vh * 0.85 - r.top) / (r.height + vh * 0.3);
    var lit = Math.round(Math.max(0, Math.min(1, p)) * words.length);
    for (var i = 0; i < words.length; i++) words[i].classList.toggle('on', i < lit);
  }

  /** Counts a figure up the first time it scrolls into view. */
  function initCounters() {
    var nums = document.querySelectorAll('[data-count]');
    if (!nums.length || !('IntersectionObserver' in window) || reduced) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var el = en.target; io.unobserve(el);
        var target = parseInt(el.getAttribute('data-count'), 10);
        var suffix = el.getAttribute('data-suffix') || '';
        // A year counts up from a nearby year, not from zero.
        var from = target > 1900 ? target - 40 : 0;
        var start = performance.now();
        (function step(now) {
          var t = Math.min(1, (now - start) / 1600);
          el.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 4))) + suffix;
          if (t < 1) requestAnimationFrame(step);
        })(start);
      });
    }, { threshold: 0.5 });
    nums.forEach(function (n) { io.observe(n); });
  }

  /** Accessible tabs with a sliding ink pill. */
  function initTabs() {
    document.querySelectorAll('[data-tabs]').forEach(function (strip) {
      var id = strip.getAttribute('data-tabs');
      var btns = Array.prototype.slice.call(strip.querySelectorAll('[role="tab"]'));
      var panels = document.querySelectorAll('[data-tabpanel="' + id + '"]');
      var ink = strip.querySelector('.tabs__ink');
      strip.classList.remove('no-ink');

      function moveInk(btn) {
        if (!ink) return;
        ink.style.width = btn.offsetWidth + 'px';
        ink.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
      }
      function select(i, focus) {
        btns.forEach(function (b, j) {
          var on = i === j;
          b.setAttribute('aria-selected', String(on));
          b.tabIndex = on ? 0 : -1;
          panels[j].classList.toggle('is-active', on);
        });
        moveInk(btns[i]);
        if (focus) btns[i].focus();
      }
      btns.forEach(function (b, i) {
        b.addEventListener('click', function () { select(i); });
        b.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowRight') { e.preventDefault(); select((i + 1) % btns.length, true); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); select((i - 1 + btns.length) % btns.length, true); }
        });
      });
      requestAnimationFrame(function () { moveInk(btns[0]); });
      window.addEventListener('resize', function () {
        var cur = btns.filter(function (b) { return b.getAttribute('aria-selected') === 'true'; })[0];
        if (cur) moveInk(cur);
      });
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { moveInk(btns.filter(function (b) { return b.getAttribute('aria-selected') === 'true'; })[0] || btns[0]); });
    });
  }

  /** Pinned story: the step nearest the middle of the screen drives the image. */
  function initStory() {
    var root = document.querySelector('[data-story]');
    if (!root || !('IntersectionObserver' in window)) return;
    var steps = root.querySelectorAll('[data-story-step]');
    var imgs = root.querySelectorAll('[data-story-img]');
    var num = root.querySelector('[data-story-n]');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var i = +en.target.getAttribute('data-story-step');
        steps.forEach(function (s, j) { s.classList.toggle('is-active', i === j); });
        imgs.forEach(function (s, j) { s.classList.toggle('is-active', i === j); });
        if (num) num.textContent = '0' + (i + 1);
      });
    }, { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(function (s) { io.observe(s); });
  }

  /** Product rails: arrow buttons, mouse drag, and a progress bar. */
  function initRails() {
    document.querySelectorAll('[data-rail]').forEach(function (rail) {
      var track = rail.querySelector('[data-rail-track]');
      var barEl = rail.querySelector('[data-rail-bar]');
      var head = rail.previousElementSibling;
      var prev = head && head.querySelector('[data-rail-prev]');
      var next = head && head.querySelector('[data-rail-next]');
      function step() { return Math.max(260, track.clientWidth * 0.8); }
      function sync() {
        var max = track.scrollWidth - track.clientWidth;
        var p = max > 0 ? track.scrollLeft / max : 1;
        if (barEl) barEl.style.transform = 'scaleX(' + Math.max(0.12, Math.min(1, (track.clientWidth / track.scrollWidth) + p * (1 - track.clientWidth / track.scrollWidth))) + ')';
        if (prev) prev.disabled = track.scrollLeft < 4;
        if (next) next.disabled = track.scrollLeft > max - 4;
      }
      if (prev) prev.addEventListener('click', function () { track.scrollBy({ left: -step(), behavior: reduced ? 'auto' : 'smooth' }); });
      if (next) next.addEventListener('click', function () { track.scrollBy({ left: step(), behavior: reduced ? 'auto' : 'smooth' }); });
      track.addEventListener('scroll', sync, { passive: true });
      window.addEventListener('resize', sync, { passive: true });
      sync();

      // Mouse drag (touch already scrolls natively).
      var down = false, startX = 0, startL = 0, moved = 0;
      track.addEventListener('pointerdown', function (e) {
        if (e.pointerType !== 'mouse' || e.target.closest('button')) return;
        down = true; moved = 0; startX = e.clientX; startL = track.scrollLeft;
      });
      window.addEventListener('pointermove', function (e) {
        if (!down) return;
        var dx = e.clientX - startX; moved = Math.max(moved, Math.abs(dx));
        if (moved > 6) track.classList.add('is-dragging');
        track.scrollLeft = startL - dx;
      });
      window.addEventListener('pointerup', function () {
        if (!down) return; down = false;
        window.setTimeout(function () { track.classList.remove('is-dragging'); }, 0);
      });
      track.addEventListener('click', function (e) { if (moved > 6) { e.preventDefault(); e.stopPropagation(); moved = 0; } }, true);
    });
  }

  /** FAQ accordion. */
  function initFaq() {
    document.querySelectorAll('[data-faq] .faq__q').forEach(function (q) {
      q.addEventListener('click', function () {
        var item = q.closest('.faq__item');
        var open = !item.classList.contains('is-open');
        item.classList.toggle('is-open', open);
        q.setAttribute('aria-expanded', String(open));
      });
    });
  }

  /** Collection page: sort and an in-stock filter, both client side. */
  function initCollectionTools() {
    var grid = document.querySelector('[data-product-grid]');
    var sort = document.querySelector('[data-sort]');
    var stock = document.querySelector('[data-filter-stock]');
    var label = document.querySelector('[data-count-label]');
    if (!grid || !sort) return;
    var cards = Array.prototype.slice.call(grid.children);
    cards.forEach(function (c, i) { c._order = i; });

    function apply() {
      var mode = sort.value;
      var sorted = cards.slice().sort(function (a, b) {
        if (mode === 'price-asc') return a.dataset.price - b.dataset.price;
        if (mode === 'price-desc') return b.dataset.price - a.dataset.price;
        if (mode === 'name') return a.dataset.name.localeCompare(b.dataset.name);
        return a._order - b._order;
      });
      var shown = 0;
      sorted.forEach(function (c, i) {
        var hide = stock && stock.checked && c.dataset.stock !== 'in-stock';
        c.classList.toggle('is-filtered', !!hide);
        if (!hide) { c.style.setProperty('--i', Math.min(shown, 12)); shown++; }
        c.classList.add('is-in');
        grid.appendChild(c);
      });
      grid.classList.remove('is-sorting'); void grid.offsetWidth; grid.classList.add('is-sorting');
      if (label) label.innerHTML = shown + ' <span>' + (shown === 1 ? 'product' : 'products') + '</span>';
    }
    sort.addEventListener('change', apply);
    if (stock) stock.addEventListener('change', apply);
  }

  /** Product image zoom that follows the pointer. */
  function initZoom() {
    var z = document.querySelector('[data-zoom]');
    if (!z || reduced) return;
    z.addEventListener('pointermove', function (e) {
      if (e.pointerType !== 'mouse') return;
      var r = z.getBoundingClientRect();
      z.style.setProperty('--zx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
      z.style.setProperty('--zy', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      z.classList.add('is-zoomed');
    });
    z.addEventListener('pointerleave', function () { z.classList.remove('is-zoomed'); });
  }

  /** Buttons lean toward the pointer; card images tilt in 3D. Mouse only. */
  function initPointerFx() {
    if (reduced || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    document.querySelectorAll('[data-magnetic]').forEach(function (b) {
      b.addEventListener('pointermove', function (e) {
        var r = b.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * 0.22;
        var y = (e.clientY - r.top - r.height / 2) * 0.3;
        b.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
    document.addEventListener('pointermove', function (e) {
      var m = e.target.closest && e.target.closest('[data-tilt]');
      if (!m) return;
      var r = m.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width - 0.5;
      var py = (e.clientY - r.top) / r.height - 0.5;
      m.style.transform = 'perspective(800px) rotateY(' + (px * 7).toFixed(2) + 'deg) rotateX(' + (py * -7).toFixed(2) + 'deg) translateY(-4px)';
    });
    document.addEventListener('pointerout', function (e) {
      var m = e.target.closest && e.target.closest('[data-tilt]');
      if (m && !m.contains(e.relatedTarget)) m.style.transform = '';
    });
  }

  /** Free-delivery meter in the basket drawer. */
  function renderShipMeter() {
    var meter = document.querySelector('[data-ship-meter]');
    var text = document.querySelector('[data-ship-text]');
    var t = CFG.freeShippingThreshold || 0;
    if (!meter || !t) return;
    var sub = subtotal();
    meter.style.width = Math.min(100, (sub / t) * 100) + '%';
    if (text) text.textContent = !lines().length ? '' : sub >= t ? 'Free courier delivery unlocked.' : money(t - sub) + ' more for free courier delivery.';
  }

  function bumpCart() {
    var btn = document.querySelector('[data-cart-open]');
    if (!btn) return;
    btn.classList.remove('is-bumped'); void btn.offsetWidth; btn.classList.add('is-bumped');
  }

  /** Sends a copy of the product image arcing into the basket button. */
  function flyToCart(trigger) {
    if (reduced) return;
    var cart = document.querySelector('[data-cart-open]');
    if (!cart) return;
    var scope = trigger.closest('.card') || trigger.closest('.nbc-prod') || trigger.closest('.product') || document;
    var source = scope.querySelector('img');
    if (!source) return;
    var from = source.getBoundingClientRect();
    var to = cart.getBoundingClientRect();
    if (!from.width || !to.width) return;
    var fly = document.createElement('img');
    fly.src = source.currentSrc || source.src; fly.alt = ''; fly.className = 'fly';
    fly.style.left = from.left + 'px'; fly.style.top = from.top + 'px';
    fly.style.width = from.width + 'px'; fly.style.height = from.height + 'px';
    document.body.appendChild(fly);
    requestAnimationFrame(function () {
      var dx = to.left + to.width / 2 - (from.left + from.width / 2);
      var dy = to.top + to.height / 2 - (from.top + from.height / 2);
      fly.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(.06) rotate(14deg)';
      fly.style.opacity = '0.1';
    });
    window.setTimeout(function () { fly.remove(); }, 850);
  }

  function initMobileNav() {
    var btn = document.querySelector('[data-menu-toggle]');
    var nav = document.querySelector('[data-mobile-nav]');
    if (!btn || !nav) return;
    btn.addEventListener('click', function () {
      var open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      nav.hidden = open;
    });
  }

  function initQty() {
    var wrap = document.querySelector('[data-qty-control]');
    if (!wrap) return;
    var input = wrap.querySelector('[data-qty-input]');
    var min = parseInt(input.getAttribute('min'), 10) || 1;
    wrap.querySelector('[data-qty-down]').addEventListener('click', function () {
      input.value = Math.max(min, (parseInt(input.value, 10) || min) - 1);
    });
    wrap.querySelector('[data-qty-up]').addEventListener('click', function () {
      input.value = (parseInt(input.value, 10) || min) + 1;
    });
  }

  function initDemoBar() {
    var bar = document.querySelector('[data-demo-bar]');
    if (!bar) return;
    try { if (window.localStorage.getItem('nb_demo_dismissed') === '1') { bar.remove(); return; } } catch (e) {}
    var b = bar.querySelector('[data-demo-dismiss]');
    if (b) b.addEventListener('click', function () {
      bar.remove();
      try { window.localStorage.setItem('nb_demo_dismissed', '1'); } catch (e) {}
    });
  }

  /* ------------------------------------------------------------- forms -- */

  function orderRef() {
    var d = new Date();
    return 'NB-' + d.toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  }

  function collect(form) {
    var data = {};
    Array.prototype.slice.call(form.elements).forEach(function (el) {
      if (!el.name || el.type === 'submit') return;
      if (el.type === 'checkbox') { data[el.name] = el.checked ? 'yes' : 'no'; return; }
      if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; return; }
      data[el.name] = el.value;
    });
    return data;
  }

  function status(form, msg, ok) {
    var el = form.querySelector('[data-form-status]');
    if (!el) return;
    el.textContent = msg;
    el.classList.toggle('is-ok', !!ok);
    el.classList.toggle('is-error', !ok);
  }

  function post(payload, done) {
    if (!CFG.orderEndpoint) { done(false); return; }
    fetch(CFG.orderEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { done(r.ok); }).catch(function () { done(false); });
  }

  function initCheckout() {
    var form = document.querySelector('[data-checkout-form]');
    if (!form) return;
    form.addEventListener('change', renderAll);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!lines().length) { status(form, 'Your basket is empty.', false); return; }
      if (!form.reportValidity()) return;

      var data = collect(form);
      var ref = orderRef();
      var payload = {
        reference: ref,
        placedAt: new Date().toISOString(),
        customer: data,
        items: lines().map(function (l) {
          return { slug: l.product.slug, name: l.product.name, qty: l.qty, price: l.product.price, total: l.total };
        }),
        subtotal: subtotal(), shipping: shippingCost(), total: subtotal() + shippingCost()
      };

      var btn = form.querySelector('[type="submit"]');
      if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

      post(payload, function (ok) {
        if (btn) { btn.disabled = false; btn.textContent = 'Send order request'; }
        if (ok) {
          status(form, 'Order ' + ref + ' received. We will call you on ' + (data.phone || 'the number you gave') + ' the same working day.', true);
          writeCart({});
          return;
        }
        var text = ['Order ' + ref, ''].concat(
          lines().map(function (l) { return l.qty + ' x ' + l.product.name + '  ' + money(l.total); }),
          ['', 'Subtotal: ' + money(subtotal()), 'Delivery: ' + shippingLabel(), 'Total: ' + money(subtotal() + shippingCost()), ''],
          Object.keys(data).filter(function (k) { return data[k]; }).map(function (k) { return k + ': ' + data[k]; })
        ).join('\n');
        status(form, 'Order ' + ref + ' is ready to send. WhatsApp should open; if nothing happens, call the shop and quote that reference.', true);
        window.location.href = CFG.whatsapp
          ? 'https://wa.me/' + CFG.whatsapp + '?text=' + encodeURIComponent(text)
          : 'mailto:' + (CFG.email || '') + '?subject=' + encodeURIComponent('Order ' + ref) + '&body=' + encodeURIComponent(text);
      });
    });
  }

  function initContactForm() {
    var form = document.querySelector('[data-contact-form]');
    if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!form.reportValidity()) return;
      var data = collect(form);
      post({ type: 'enquiry', customer: data }, function (ok) {
        if (ok) { status(form, 'Thank you. We will reply to ' + data.email + ' within one working day.', true); form.reset(); return; }
        var body = Object.keys(data).map(function (k) { return k + ': ' + data[k]; }).join('\n');
        status(form, 'Opening your mail client. If nothing happens, email us directly.', true);
        window.location.href = 'mailto:' + (CFG.email || '') + '?subject=' + encodeURIComponent('Website enquiry: ' + (data.topic || '')) + '&body=' + encodeURIComponent(body);
      });
    });
  }

  /* -------------------------------------------------------- delegation -- */

  document.addEventListener('click', function (e) {
    var t = e.target.closest ? e.target.closest('[data-add],[data-inc],[data-dec],[data-remove],[data-cart-open],[data-cart-close],[data-search-open],[data-search-close]') : null;
    if (!t) return;

    if (t.hasAttribute('data-cart-open')) { e.preventDefault(); openPanel('[data-cart-drawer]', '[data-cart-close]'); return; }
    if (t.hasAttribute('data-cart-close')) { e.preventDefault(); closePanel('[data-cart-drawer]'); return; }
    if (t.hasAttribute('data-search-open')) { e.preventDefault(); openPanel('[data-search]', '[data-search-input]'); return; }
    if (t.hasAttribute('data-search-close')) { e.preventDefault(); closePanel('[data-search]'); return; }

    if (t.hasAttribute('data-add')) {
      var slug = t.getAttribute('data-add');
      var qty;
      if (t.hasAttribute('data-qty-from-input')) {
        var input = document.querySelector('[data-qty-input]');
        qty = input ? parseInt(input.value, 10) : null;
      } else {
        qty = parseInt(t.getAttribute('data-qty'), 10);
      }
      flyToCart(t);
      add(slug, qty || null);
      bumpCart();
      return;
    }

    var inc = t.getAttribute('data-inc');
    if (inc) { setQty(inc, (getCart()[inc] || 0) + 1); return; }
    var dec = t.getAttribute('data-dec');
    if (dec) { setQty(dec, (getCart()[dec] || 0) - 1); return; }
    var rm = t.getAttribute('data-remove');
    if (rm) { remove(rm); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    closePanel('[data-cart-drawer]');
    closePanel('[data-search]');
  });

  /* --------------------------------------------------------------- go -- */

  function init() {
    renderAll();
    initSearch();
    initMenus();
    initReveal();
    initScroll();
    initCounters();
    initTabs();
    initStory();
    initRails();
    initFaq();
    initCollectionTools();
    initZoom();
    initPointerFx();
    initMobileNav();
    initQty();
    initDemoBar();
    initCheckout();
    initContactForm();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
