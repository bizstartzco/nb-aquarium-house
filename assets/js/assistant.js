/* =========================================================================
   NB Aquarium House: on-site assistant
   Runs entirely in the browser and answers only from facts the site already
   publishes (window.NB_CATALOG: products, services, FAQs, hours, delivery).
   It never invents a price, stock level or promise; anything it cannot answer
   goes to the shop by WhatsApp or phone.

   Optional AI backend: set NB_CFG.chatEndpoint to a server URL that accepts
   POST {messages:[{role,content}]} and returns {reply}. The API key lives on
   that server, never in this file. If the endpoint fails, the local answers
   take over.
   ========================================================================= */
(function () {
  'use strict';

  var CFG = window.NB_CFG || {};
  var BASE = window.NB_BASE || './';
  var CAT = window.NB_CATALOG || {};
  var KB = CAT.kb || {};
  var PRODUCTS = CAT.products || [];
  var DETAILS = CAT.details || {};
  var COLLECTIONS = CAT.collections || [];
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var STORE = 'nb_chat_v1';

  /* ------------------------------------------------------------ helpers -- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    return (CFG.currencySymbol || 'Rs. ') + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim(); }
  var STOP = ' a an the is are do does you your i me my we our can could would will to for of in on at and or with any have has what how which there it its this that be please about tell show me some get want need looking buy sell much many '.split(' ');
  function tokens(s) {
    return norm(s).split(' ').filter(function (w) { return w && STOP.indexOf(' ' + w + ' ') === -1 && STOP.indexOf(w) === -1 && w.length > 1; })
      .map(function (w) { return w.replace(/(ies)$/, 'y').replace(/(es|s)$/, ''); });
  }
  function has(q, words) { for (var i = 0; i < words.length; i++) if (q.indexOf(words[i]) !== -1) return true; return false; }
  function wa(text) {
    return KB.whatsapp ? 'https://wa.me/' + KB.whatsapp + (text ? '?text=' + encodeURIComponent(text) : '') : '';
  }

  /* --------------------------------------------------------- knowledge -- */

  function handoff(topic) {
    var parts = [];
    if (KB.whatsapp) parts.push('<a class="nbc-link" href="' + esc(wa(topic ? 'Hello NB Aquarium House, I have a question about ' + topic : '')) + '" target="_blank" rel="noopener">WhatsApp the shop</a>');
    if (KB.phoneHref) parts.push('<a class="nbc-link" href="' + esc(KB.phoneHref) + '">Call ' + esc(KB.phone) + '</a>');
    if (KB.email) parts.push('<a class="nbc-link" href="mailto:' + esc(KB.email) + '">Email us</a>');
    return parts.length ? '<p class="nbc-actions">' + parts.join('') + '</p>' : '';
  }

  /** Is the shop open right now, in Kathmandu time? */
  function openNow() {
    try {
      var now = new Date();
      var parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kathmandu', weekday: 'long', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(now);
      var get = function (t) { return (parts.filter(function (p) { return p.type === t; })[0] || {}).value; };
      var day = get('weekday'); var mins = parseInt(get('hour'), 10) * 60 + parseInt(get('minute'), 10);
      var order = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      for (var i = 0; i < (KB.hours || []).length; i++) {
        var h = KB.hours[i]; var m = /(\w+)\s*-\s*(\w+)|^(\w+)$/.exec(h.days); var t = /(\d+):(\d+)\s*-\s*(\d+):(\d+)/.exec(h.time);
        if (!t) continue;
        var from, to;
        if (m && m[3]) { from = to = order.indexOf(m[3]); } else if (m) { from = order.indexOf(m[1]); to = order.indexOf(m[2]); }
        var d = order.indexOf(day);
        if (from < 0 || d < from || d > to) continue;
        var o = +t[1] * 60 + +t[2], c = +t[3] * 60 + +t[4];
        if (mins >= o && mins < c) return 'We are <strong>open now</strong>, until ' + t[3] + ':' + t[4] + ' Kathmandu time.';
        if (mins < o) return 'We open today at ' + t[1] + ':' + t[2] + ' Kathmandu time.';
        return 'We have closed for today.';
      }
      return 'We are closed today.';
    } catch (e) { return ''; }
  }

  function productCards(list) {
    return '<div class="nbc-products">' + list.map(function (p) {
      var stock = p.stock === 'in-stock' ? 'In stock' : p.stock === 'low' ? 'Low stock' : 'To order';
      return '<div class="nbc-prod">' +
        '<a href="' + esc(BASE + p.url) + '"><img src="' + esc(BASE + 'assets/img/' + p.image + '-400.webp') + '" alt="" width="64" height="48" loading="lazy"></a>' +
        '<div><a class="nbc-prod__name" href="' + esc(BASE + p.url) + '">' + esc(p.name) + '</a>' +
        '<span>' + money(p.price) + ' &middot; ' + esc(p.unit) + '</span><span class="nbc-prod__stock">' + stock + (p.live ? ' &middot; collection or valley delivery' : '') + '</span></div>' +
        '<button type="button" class="nbc-add" data-add="' + esc(p.slug) + '" data-qty="' + (p.minQty || 1) + '" aria-label="Add ' + esc(p.name) + ' to basket">Add' + (p.minQty > 1 ? ' ' + p.minQty : '') + '</button>' +
        '</div>';
    }).join('') + '</div>';
  }

  var GENERIC = {};
  COLLECTIONS.forEach(function (c) { tokens(c.name).forEach(function (w) { GENERIC[w] = 1; }); });
  ['koi', 'pond', 'water', 'aquarium', 'tank', 'system', 'set', 'pack', 'kit'].forEach(function (w) { GENERIC[w] = 1; });

  /** Scores products against the question by name, latin name, category and tags. */
  function findProducts(q) {
    var qt = tokens(q); if (!qt.length) return [];
    var colName = {}; COLLECTIONS.forEach(function (c) { colName[c.slug] = c.name; });
    var scored = PRODUCTS.map(function (p) {
      var d = DETAILS[p.slug] || {};
      var nameT = tokens(p.name + ' ' + p.latin), catT = tokens(colName[p.collection] || p.collection), tagT = tokens((d.tags || []).join(' '));
      var score = 0, nameHit = false;
      qt.forEach(function (w) {
        // Category words ("fish", "food", "filter") and numbers are weak
        // evidence: "fish" alone must not mean "Fish Net".
        var weak = GENERIC[w] || /^\d+$/.test(w);
        if (nameT.indexOf(w) !== -1) { score += weak ? 1 : 3; if (!weak) nameHit = true; }
        else if (!weak && nameT.some(function (n) { return n.length > 3 && w.length > 3 && (n.indexOf(w) === 0 || w.indexOf(n) === 0); })) { score += 2; nameHit = true; }
        if (catT.indexOf(w) !== -1) score += 1.5;
        if (tagT.indexOf(w) !== -1) score += 1;
      });
      return { p: p, score: score, nameHit: nameHit };
    }).filter(function (x) { return x.score >= 2; })
      .sort(function (a, b) { return b.score - a.score; });
    // Keep only matches close to the best one, so "canister filter" does not
    // also list every pond filter.
    var top = scored[0];
    var out = scored.filter(function (x) { return top && x.score >= top.score * 0.6; }).map(function (x) { return x.p; });
    out.nameHit = !!(top && top.nameHit);
    return out;
  }

  function bestFaq(q) {
    var qt = tokens(q), best = null, bestScore = 0;
    (KB.faqs || []).forEach(function (f) {
      var ft = tokens(f.q + ' ' + f.a.slice(0, 120)), s = 0;
      qt.forEach(function (w) { if (ft.indexOf(w) !== -1) s++; });
      var r = qt.length ? s / qt.length : 0;
      if (s >= 2 && r > bestScore) { bestScore = r; best = f; }
    });
    return bestScore >= 0.4 ? best : null;
  }

  var SPEC_WORDS = { temperature: ['temperature', 'temp', 'heat', 'warm', 'cold'], 'minimum tank': ['tank size', 'how big', 'litre', 'liter', 'minimum tank', 'tank'], ph: [' ph', 'acid', 'alkaline'], 'keep in groups of': ['group', 'how many', 'school', 'shoal'], temperament: ['peaceful', 'aggressive', 'community', 'temperament', 'get along', 'tankmate'], diet: ['eat', 'food', 'feed', 'diet'], 'adult size': ['big', 'size', 'grow', 'length'] };

  function answer(raw) {
    var q = ' ' + norm(raw) + ' ';
    var ask = has(q, [' price ', ' cost ', ' how much ', ' rate ', ' rs ']);

    if (/^\s*(hi|hello|hey|namaste|namaskar|good (morning|afternoon|evening))\b/.test(q)) {
      return { html: '<p>Namaste! I can help with fish and plants we stock, prices, opening hours, delivery, water testing and our services. What are you looking for?</p>', chips: DEFAULT_CHIPS };
    }
    if (has(q, [' human ', ' person ', ' staff ', ' talk to ', ' speak ', ' call ', ' phone ', ' whatsapp ', ' contact ', ' email ', ' number '])) {
      return { html: '<p>Happy to put you through to the shop.</p>' + handoff('') };
    }
    if (has(q, [' dog', ' cat ', ' cats ', ' puppy', ' kitten', ' bird', ' parrot', ' hamster', ' rabbit', ' guinea pig', ' horse', ' cattle', ' poultry', ' chicken'])) {
      return { html: '<p>We are an aquarium and koi pond specialist, so we only stock fish, aquatic plants and the equipment and food for them. For other pets you would need a general pet shop.</p>', chips: ['Show me fish', 'Show me plants'] };
    }
    var days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    var asked = days.filter(function (d) { return q.indexOf(' ' + d + ' ') !== -1; })[0];
    if (asked && has(q, [' open', ' hour', ' timing', ' close', ' time ', ' when '])) {
      var cap = asked.charAt(0).toUpperCase() + asked.slice(1);
      var row = (KB.hours || []).filter(function (h) {
        var m = /(\w+)\s*-\s*(\w+)/.exec(h.days), order = days.map(function (d) { return d.charAt(0).toUpperCase() + d.slice(1); });
        if (m) { var a = order.indexOf(m[1]), b = order.indexOf(m[2]), i = order.indexOf(cap); return i >= a && i <= b; }
        return h.days.indexOf(cap) !== -1;
      })[0];
      return { html: row ? '<p>On ' + cap + ' we are open <strong>' + esc(row.time) + '</strong> (Kathmandu time).</p>' : '<p>We are closed on ' + cap + '.</p>', chips: ['Opening hours', 'Where are you?'] };
    }
    if (has(q, [' test my water', ' water test', ' test water', ' water sample', ' testing my water', ' check my water'])) {
      var wf = (KB.faqs || []).filter(function (f) { return /test/i.test(f.q); })[0];
      return { html: '<p>' + esc(wf ? wf.a : 'Yes, bring a water sample to the counter and we will test it free.') + '</p>', chips: ['Opening hours', 'Where are you?'] };
    }
    if (has(q, [' open ', ' hour ', ' hours ', ' timing ', ' close ', ' closed ', ' today ', ' when '])) {
      return { html: '<p>' + openNow() + '</p><ul class="nbc-list">' + (KB.hours || []).map(function (h) { return '<li><b>' + esc(h.days) + '</b><span>' + esc(h.time) + '</span></li>'; }).join('') + '</ul>', chips: ['Where are you?', 'Free water testing'] };
    }
    if (has(q, [' where ', ' address ', ' location ', ' direction ', ' map ', ' parking ', ' find you ', ' visit '])) {
      return { html: '<p>We are at <strong>' + esc(KB.address) + '</strong>. ' + esc(KB.parking || '') + '</p><p><a class="nbc-link" href="' + esc(BASE + 'contact/') + '">Map and directions</a></p>', chips: ['Opening hours'] };
    }
    if (has(q, [' deliver', ' shipping ', ' ship ', ' courier ', ' send ', ' postage '])) {
      var t = KB.freeShippingThreshold;
      return { html: '<p>' + esc(KB.livestockRule) + '</p><p>Dry goods: valley delivery ' + money(KB.localDelivery) + '; courier elsewhere in Nepal ' + money(KB.flatShipping) + ', free on orders over ' + money(t) + '. Collection from the shop is always free.</p><p><a class="nbc-link" href="' + esc(BASE + 'shipping-policy/') + '">Full delivery policy</a></p>' };
    }
    if (has(q, [' refund ', ' return ', ' exchange ', ' died ', ' dead ', ' doa '])) {
      return { html: '<p>Our returns and live-arrival terms are on one page:</p><p><a class="nbc-link" href="' + esc(BASE + 'refund-policy/') + '">Returns policy</a> <a class="nbc-link" href="' + esc(BASE + 'shipping-policy/') + '">Live arrival</a></p>' + handoff('a return') };
    }
    if (has(q, [' pay ', ' payment ', ' esewa ', ' khalti ', ' card ', ' cash '])) {
      return { html: '<p>Orders placed on the website are requests: we call to confirm before anything is reserved, and agree payment with you then.</p>' + handoff('payment') };
    }

    // A specific service?
    var svc = (KB.services || []).filter(function (s) {
      var st = tokens(s.name);
      return tokens(raw).some(function (w) { return st.indexOf(w) !== -1 && ['aquarium', 'pond', 'koi'].indexOf(w) === -1; });
    });
    if (has(q, [' service', ' install', ' maintenance ', ' maintain ', ' setup ', ' set up ', ' design ', ' build ', ' contract ', ' holiday ', ' cleaning ', ' clean '])) {
      var list = svc.length ? svc : KB.services || [];
      return { html: '<p>' + (svc.length ? 'Here is what that costs:' : 'We design, install and look after tanks and ponds:') + '</p><ul class="nbc-list">' + list.map(function (s) {
        return '<li><a href="' + esc(BASE + 'services/' + s.slug + '/') + '"><b>' + esc(s.name) + '</b></a><span>' + money(s.price) + ' ' + esc(s.priceNote) + '</span></li>';
      }).join('') + '</ul><p>Exact quotes follow a site visit.</p>' + handoff('a site visit') };
    }

    var prods = findProducts(raw);
    var faq = bestFaq(raw);

    // A bare category ("plants", "fish food", "koi pond pump") beats tag-only
    // product hits. Pond words steer to the pond side of the shop.
    var pondQ = has(q, [' koi ', ' pond ', ' ponds ', ' garden ']);
    var colHit = COLLECTIONS.filter(function (c) {
      var ct = tokens(c.name), qt = tokens(raw);
      return ct.length && ct.every(function (w) { return qt.indexOf(w) !== -1; });
    }).sort(function (a, b) {
      var pa = (a.division === 'koi-pond') === pondQ ? 1 : 0, pb = (b.division === 'koi-pond') === pondQ ? 1 : 0;
      return (pb - pa) || (tokens(b.name).length - tokens(a.name).length);
    })[0];
    var isQuestion = /\b(do|does|can|could|will|would|how|what|why|is|are|should|when)\b/.test(q);

    // An FAQ beats products that only matched on a category or tag word
    // ("do you take unwanted fish?" is not a question about fish nets),
    // but a short browse query like "koi pond pump" is not a question.
    if (faq && !prods.nameHit && (isQuestion || !colHit)) return { html: '<p>' + esc(faq.a) + '</p>' };
    if (colHit && !prods.nameHit) {
      var inC = PRODUCTS.filter(function (p) { return p.collection === colHit.slug; });
      return { html: '<p>Our ' + esc(colHit.name.toLowerCase()) + ' range:</p>' + productCards(inC.slice(0, 4)) + '<p><a class="nbc-link" href="' + esc(BASE + 'collections/' + colHit.slug + '/') + '">See all ' + inC.length + '</a></p>' };
    }

    // A care question about one specific species or product.
    if (prods.length) {
      var top = prods[0], d = DETAILS[top.slug] || {};
      for (var key in SPEC_WORDS) {
        var specKey = Object.keys(d.specs || {}).filter(function (k) { return k.toLowerCase() === key; })[0];
        if (specKey && has(q, SPEC_WORDS[key])) {
          return { html: '<p><strong>' + esc(top.name) + '</strong>, ' + esc(specKey.toLowerCase()) + ': <strong>' + esc(d.specs[specKey]) + '</strong>.</p>' + productCards([top]) };
        }
      }
      if (ask && prods.length >= 1) {
        return { html: '<p><strong>' + esc(top.name) + '</strong> is ' + money(top.price) + ' (' + esc(top.unit) + ').</p>' + productCards(prods.slice(0, 3)) };
      }
      if (!faq || prods.length) {
        var intro = prods.length === 1 ? '<p>' + esc(d.short || '') + '</p>' : '<p>Here is what we have:</p>';
        return { html: intro + productCards(prods.slice(0, 4)) + (prods.length > 4 ? '<p class="nbc-muted">' + (prods.length - 4) + ' more match. Try a more specific name.</p>' : '') };
      }
    }
    if (faq) return { html: '<p>' + esc(faq.a) + '</p>' };

    // Category words without a product hit, e.g. "plants".
    var col = COLLECTIONS.filter(function (c) { return tokens(raw).some(function (w) { return tokens(c.name).indexOf(w) !== -1; }); })[0];
    if (col) {
      var inCol = PRODUCTS.filter(function (p) { return p.collection === col.slug; });
      return { html: '<p>Our ' + esc(col.name.toLowerCase()) + ' range:</p>' + productCards(inCol.slice(0, 4)) + '<p><a class="nbc-link" href="' + esc(BASE + 'collections/' + col.slug + '/') + '">See all ' + inCol.length + '</a></p>' };
    }

    if (has(q, [' koi ', ' pond ', ' ponds '])) {
      var pondCols = COLLECTIONS.filter(function (c) { return c.division === 'koi-pond'; });
      return { html: '<p>Our koi pond range covers ' + pondCols.map(function (c) { return esc(c.name.toLowerCase()); }).join(', ') + ', and we design and build ponds too. For live koi availability, ask the shop directly.</p><p><a class="nbc-link" href="' + esc(BASE + 'koi-pond/') + '">Koi pond range</a><a class="nbc-link" href="' + esc(BASE + 'services/koi-pond-build/') + '">Pond building</a></p>' + handoff('koi') };
    }

    return { html: '<p>I am not sure about that one, and I would rather not guess. The shop can answer it directly:</p>' + handoff(raw.slice(0, 80)), chips: DEFAULT_CHIPS };
  }

  var DEFAULT_CHIPS = ['Opening hours', 'Do you deliver live fish?', 'Free water testing', 'Show me plants', 'Aquarium maintenance', 'Talk to a person'];
  var CHIP_MAP = { 'Free water testing': 'Will you test my water?', 'Show me plants': 'plants', 'Aquarium maintenance': 'maintenance service', 'Where are you?': 'where are you' };

  /* ---------------------------------------------------------------- UI -- */

  var root, log, input, form, launcher, history = [];

  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-30))); } catch (e) {} }
  function load() { try { return JSON.parse(sessionStorage.getItem(STORE) || '[]') || []; } catch (e) { return []; } }

  function bubble(role, html, chips, skipSave) {
    var b = document.createElement('div');
    b.className = 'nbc-msg nbc-msg--' + role;
    b.innerHTML = html;
    if (chips && chips.length) {
      var c = document.createElement('div');
      c.className = 'nbc-chips';
      c.innerHTML = chips.map(function (t) { return '<button type="button" class="nbc-chip">' + esc(t) + '</button>'; }).join('');
      b.appendChild(c);
    }
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    if (!skipSave) { history.push({ role: role, html: html, chips: chips || null }); save(); }
  }

  function typing() {
    var t = document.createElement('div');
    t.className = 'nbc-msg nbc-msg--bot nbc-typing';
    t.setAttribute('aria-label', 'Assistant is typing');
    t.innerHTML = '<i></i><i></i><i></i>';
    log.appendChild(t); log.scrollTop = log.scrollHeight;
    return t;
  }

  function respond(text) {
    bubble('user', '<p>' + esc(text) + '</p>');
    var t = typing();
    var delay = reduced ? 50 : 450 + Math.min(700, text.length * 12);

    if (CFG.chatEndpoint) {
      var msgs = history.filter(function (h) { return h.role === 'user' || h.role === 'bot'; }).slice(-12).map(function (h) {
        var d = document.createElement('div'); d.innerHTML = h.html;
        return { role: h.role === 'bot' ? 'assistant' : 'user', content: d.textContent.trim() };
      });
      fetch(CFG.chatEndpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: msgs }) })
        .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { t.remove(); bubble('bot', '<p>' + esc(d.reply || '').replace(/\n+/g, '</p><p>') + '</p>'); })
        .catch(function () { t.remove(); var a = answer(text); bubble('bot', a.html, a.chips); });
      return;
    }
    window.setTimeout(function () { t.remove(); var a = answer(text); bubble('bot', a.html, a.chips); }, delay);
  }

  function open() {
    root.hidden = false;
    launcher.setAttribute('aria-expanded', 'true');
    launcher.classList.remove('has-dot');
    try { localStorage.setItem('nb_chat_seen', '1'); } catch (e) {}
    requestAnimationFrame(function () { root.classList.add('is-open'); });
    if (!log.children.length) {
      bubble('bot', '<p>Namaste! I am the NB Aquarium House assistant. I can answer questions about our fish, plants, prices, hours, delivery and services.</p><p class="nbc-muted">I am automated. For anything I cannot answer, I will connect you to the shop.</p>', DEFAULT_CHIPS);
    }
    if (window.matchMedia('(min-width: 600px)').matches) input.focus();
  }
  function close() {
    root.classList.remove('is-open');
    launcher.setAttribute('aria-expanded', 'false');
    window.setTimeout(function () { root.hidden = true; }, reduced ? 0 : 250);
    launcher.focus();
  }

  function build() {
    launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = 'nbc-launcher';
    launcher.setAttribute('aria-controls', 'nbc-panel');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.2 3.6c-.5.4-1.3 0-1.3-.6V16A2.5 2.5 0 0 1 4 13.5v-8Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="9.6" r="1.1" fill="currentColor"/><circle cx="12" cy="9.6" r="1.1" fill="currentColor"/><circle cx="15.5" cy="9.6" r="1.1" fill="currentColor"/></svg><span class="nbc-launcher__label">Ask us</span>';
    try { if (!localStorage.getItem('nb_chat_seen')) launcher.classList.add('has-dot'); } catch (e) {}

    root = document.createElement('section');
    root.className = 'nbc';
    root.id = 'nbc-panel';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Chat with the NB Aquarium House assistant');
    root.innerHTML =
      '<header class="nbc-head">' +
        '<span class="nbc-avatar" aria-hidden="true"><svg viewBox="0 0 32 32" width="20" height="20"><path d="M16 5c4.2 5.3 7.2 9.3 7.2 13.4a7.2 7.2 0 0 1-14.4 0C8.8 14.3 11.8 10.3 16 5Z" fill="currentColor"/></svg></span>' +
        '<span><b>NB Aquarium assistant</b><small><i class="nbc-online"></i>Automated &middot; answers from our shop info</small></span>' +
        '<button type="button" class="nbc-close" aria-label="Close chat">&times;</button>' +
      '</header>' +
      '<div class="nbc-log" role="log" aria-live="polite"></div>' +
      '<form class="nbc-form"><label class="sr-only" for="nbc-input">Your question</label>' +
        '<input id="nbc-input" type="text" autocomplete="off" maxlength="300" placeholder="Ask about fish, plants, delivery&hellip;">' +
        '<button type="submit" aria-label="Send"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>' +
      '</form>';
    document.body.appendChild(root);
    document.body.appendChild(launcher);

    log = root.querySelector('.nbc-log');
    input = root.querySelector('input');
    form = root.querySelector('form');

    load().forEach(function (h) { history.push(h); bubble(h.role, h.html, h.chips, true); });

    launcher.addEventListener('click', function () { if (root.hidden) open(); else close(); });
    root.querySelector('.nbc-close').addEventListener('click', close);
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var v = input.value.trim(); if (!v) return;
      input.value = '';
      respond(v);
    });
    log.addEventListener('click', function (e) {
      var chip = e.target.closest && e.target.closest('.nbc-chip');
      if (chip) { var t = chip.textContent; respond(CHIP_MAP[t] ? t : t); return; }
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !root.hidden) close(); });

    // The chip text is what the visitor sees; route a few to clearer queries.
    var origAnswer = answer;
    answer = function (text) { return origAnswer(CHIP_MAP[text] || text); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
