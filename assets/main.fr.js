(function () {
  'use strict';
  var doc = document.documentElement;
  doc.classList.add('js');
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };

  /* ---------- Toast ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast'); t.textContent = msg; t.style.opacity = '1';
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.style.opacity = '0'; }, 3200);
  }

  /* ---------- Year ---------- */
  var y = new Date().getFullYear();
  $('#year').textContent = y;
  var yrs = $('#years-since'); if (yrs) yrs.textContent = (y - 2007);
  $$('[data-years-since]').forEach(function (el) { el.textContent = y - 2007; });

  /* ---------- Auto reveal: cards and headings across the site, staggered by position ---------- */
  (function () {
    if (reduce) return;
    var groups = ['.so-card', '.nw-card', '.wd-card', '.pj-step', '.os-step', '.ct-q', '.pl-card', '.pl-other',
                  '.gi-tile', '.cta-way', '.ap-step', '.os-act', '.wd-person', '.ct-faq', '.pj-nav', '.os-area', '.pj-obj'];
    groups.forEach(function (sel) {
      $$(sel).forEach(function (el) {
        if (el.hasAttribute('data-reveal') || el.closest('[data-reveal]')) return;
        var item = el.parentElement && el.parentElement.tagName === 'LI' ? el.parentElement : el;
        var sibs = item.parentElement ? Array.prototype.indexOf.call(item.parentElement.children, item) : 0;
        el.setAttribute('data-reveal', '');
        el.style.setProperty('--d', Math.min(sibs, 6) * 80 + 'ms');
      });
    });
    $$('.sh-title, .sh-desc, .phd-hr').forEach(function (el) {
      if (!el.hasAttribute('data-reveal') && !el.classList.contains('reveal')) el.setAttribute('data-reveal', '');
    });
    $$('.pl-hero, .ap-band, .wd-who, .os-band, .cta-card, .ct-form, .nw-feat, .pj-hero').forEach(function (el) {
      if (!el.hasAttribute('data-reveal')) el.setAttribute('data-reveal', 'block');
    });
  })();

  /* ---------- Get Involved: path tabs on desktop (all panels stay visible on small screens) ---------- */
  (function () {
    var tabs = $$('.gi-tab'); if (!tabs.length) return;
    var panels = $$('.gi-panel'), mq = window.matchMedia('(min-width: 1024px)');
    function select(id, focus) {
      tabs.forEach(function (t) { var on = t.getAttribute('aria-controls') === id; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
      panels.forEach(function (p) { p.hidden = mq.matches && p.id !== id; });
    }
    function sync() { document.documentElement.classList.toggle('js-tabs', mq.matches); var cur = tabs.filter(function (t) { return t.getAttribute('aria-selected') === 'true'; })[0]; select(cur.getAttribute('aria-controls')); }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t.getAttribute('aria-controls')); history.replaceState(null, '', '#' + t.getAttribute('aria-controls')); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length].getAttribute('aria-controls'), true); }
      });
    });
    var fromHash = location.hash.slice(1);
    if (fromHash && $('#' + fromHash + '.gi-panel')) tabs.forEach(function (t) { t.setAttribute('aria-selected', t.getAttribute('aria-controls') === fromHash ? 'true' : 'false'); });
    (mq.addEventListener ? mq.addEventListener('change', sync) : mq.addListener(sync));
    sync();
  })();

  /* ---------- Scroll reveal for [data-reveal] (skipped with reduced motion) ---------- */
  (function () {
    var els = $$('[data-reveal]');
    if (!els.length || reduce || !('IntersectionObserver' in window)) return;
    doc.classList.add('rv-ready');
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  })();

  /* ---------- Projects page: filter by pillar (also reads ?pillar= from the URL) ---------- */
  (function () {
    var grid = $('#proj-grid'); if (!grid) return;
    var buttons = $$('.proj-filter'), cards = $$('.proj-card', grid), empty = $('#proj-empty');
    function apply(key) {
      var shown = 0;
      buttons.forEach(function (b) { var on = b.dataset.filter === key; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
      cards.forEach(function (c) { var show = key === 'all' || c.dataset.pillar === key; c.hidden = !show; if (show) shown++; });
      if (empty) empty.classList.toggle('hidden', shown > 0);
    }
    buttons.forEach(function (b) { b.addEventListener('click', function () { apply(b.dataset.filter); }); });
    var fromUrl = new URLSearchParams(location.search).get('pillar');
    apply(buttons.some(function (b) { return b.dataset.filter === fromUrl; }) ? fromUrl : 'all');
  })();

  /* ---------- Forms → AFCD Studio (only when the build adds <meta name="afcd-forms">) ---------- */
  var FORMS = (function () { var m = document.querySelector('meta[name="afcd-forms"]'); return m && m.content ? m.content.replace(/\/+$/, '') : ''; })();
  var PAGE_T0 = Date.now();
  var NET_FAIL = 'Votre message n’a pas pu être envoyé. Veuillez réessayer, ou écrire à contact@afcdteam.com.';
  if (FORMS) {
    $$('[data-forms-off]').forEach(function (el) { el.hidden = true; });
    $$('[data-forms-on]').forEach(function (el) { el.hidden = false; });
  }
  function postForm(path, data) {
    return fetch(FORMS + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', body: JSON.stringify(data) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j || {} }; }); });
  }
  function formProblem(res) {
    var b = res.body || {};
    if (b.details && b.details.length) return b.details.map(function (d) { return d.message; }).filter(Boolean).join(' ');
    if (res.status === 429) return b.error || 'Trop de tentatives. Veuillez patienter quelques minutes et réessayer.';
    return b.error || b.message || NET_FAIL;
  }
  function busy(btn, on) { if (!btn) return; btn.disabled = on; if (on) btn.setAttribute('aria-busy', 'true'); else btn.removeAttribute('aria-busy'); }

  /* ---------- Newsletter (footer): sends to Studio when connected, otherwise a local check only ---------- */
  (function () {
    var form = $('#newsletter-form'); if (!form) return;
    var err = $('.ft-error'), errDefault = err ? err.textContent : '';
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim());
      if (err) err.classList.toggle('hidden', ok);
      form.email.setAttribute('aria-invalid', String(!ok));
      if (!ok) { if (err) err.textContent = errDefault; form.email.focus(); return; }
      if (!FORMS) { toast('Merci ! La lettre d’information n’est pas encore connectée : rien n’a été envoyé.'); form.reset(); return; }
      var btn = $('button[type="submit"]', form); busy(btn, true);
      postForm('/newsletter', { email: form.email.value.trim(), website: form.website ? form.website.value : '', t: Date.now() - PAGE_T0, page: location.pathname })
        .then(function (res) {
          if (res.status === 200 && res.body.ok) { toast(res.body.message || 'Merci ! Vous êtes abonné.'); form.reset(); form.email.removeAttribute('aria-invalid'); }
          else { if (err) { err.textContent = formProblem(res); err.classList.remove('hidden'); } }
        }, function () { if (err) { err.textContent = NET_FAIL; err.classList.remove('hidden'); } })
        .then(function () { busy(btn, false); });
    });
  })();

  /* ---------- Back to top ---------- */
  (function () {
    var b = $('#back-to-top'); if (!b) return;
    b.addEventListener('click', function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
      var skip = $('a[href="#main"]'); if (skip) skip.focus({ preventScroll: true });
    });
  })();

  /* ---------- Contact form: client checks, then sends to Studio when connected ---------- */
  (function () {
    var form = $('#contact-form'); if (!form) return;
    // Topic hint: what to include, and which team inbox it goes to
    var hintT = $('.ct-hint-t', form), hintTo = $('.ct-hint-to', form);
    // Topic dropdown: a button that opens a menu of radio options
    var dd = $('.ct-dd', form), ddBtn = dd && $('.ct-dd-btn', dd), ddMenu = dd && $('.ct-dd-menu', dd), ddCur = dd && $('.ct-dd-cur', dd);
    function ddOpen(open) {
      if (!dd) return;
      ddMenu.hidden = !open; ddBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { var c = $('input:checked', ddMenu) || $('input', ddMenu); if (c) c.focus(); }
    }
    if (dd) {
      ddBtn.addEventListener('click', function () { ddOpen(ddMenu.hidden); });
      document.addEventListener('click', function (e) { if (!dd.contains(e.target)) ddOpen(false); });
      dd.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !ddMenu.hidden) { ddOpen(false); ddBtn.focus(); } });
      $$('.ct-opt', ddMenu).forEach(function (o) {
        o.addEventListener('click', function () { setTimeout(function () { ddOpen(false); ddBtn.focus(); }, 0); });
        o.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('input', o).checked = true; $('input', o).dispatchEvent(new Event('change')); ddOpen(false); ddBtn.focus(); } });
      });
    }
    $$('input[name="topic"]', form).forEach(function (r) {
      r.addEventListener('change', function () {
        if (hintT && r.dataset.hint) hintT.textContent = r.dataset.hint;
        if (hintTo && r.dataset.to) hintTo.textContent = r.dataset.to;
        if (ddCur) ddCur.innerHTML = r.nextElementSibling.innerHTML;
      });
    });
    // Pre-select a topic from links such as contact.html?topic=Volunteering
    var wanted = new URLSearchParams(location.search).get('topic');
    if (wanted) {
      var match = $$('input[name="topic"]', form).filter(function (r) { return r.value.toLowerCase() === wanted.toLowerCase(); })[0];
      if (match) { match.checked = true; match.dispatchEvent(new Event('change')); }
    }
    // Character counter
    var count = $('.ct-count', form);
    if (count && form.message) form.message.addEventListener('input', function () { count.textContent = form.message.value.length; });
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var checks = [
        [form.name, !!form.name.value.trim()],
        [form.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim())],
        [form.message, !!form.message.value.trim()]
      ];
      var ok = true;
      checks.forEach(function (c) { c[0].setAttribute('aria-invalid', c[1] ? 'false' : 'true'); if (!c[1]) ok = false; });
      if (form.consent && !form.consent.checked) ok = false;
      var errBox = $('.form-error', form);
      if (!errBox.dataset.def) errBox.dataset.def = errBox.textContent;
      errBox.textContent = errBox.dataset.def;
      errBox.classList.toggle('hidden', ok);
      function cleared(msg) {
        toast(msg);
        form.reset(); if (count) count.textContent = '0';
        var first0 = $('input[name="topic"]:checked', form); if (first0) first0.dispatchEvent(new Event('change'));
        checks.forEach(function (c) { c[0].removeAttribute('aria-invalid'); });
      }
      function problem(msg, res) {
        errBox.textContent = msg; errBox.classList.remove('hidden');
        ((res && res.body && res.body.details) || []).forEach(function (d) { var f = d.path && form.elements[String(d.path).split('.')[0]]; if (f && f.setAttribute) f.setAttribute('aria-invalid', 'true'); });
        errBox.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
      }
      if (ok && !FORMS) {
        cleared('Merci ! Le formulaire n’est pas encore connecté : rien n’a été envoyé.');
      } else if (ok) {
        var btn = $('button[type="submit"]', form), topic = $('input[name="topic"]:checked', form);
        busy(btn, true);
        postForm('/contact', {
          topic: topic ? topic.value : 'General question', name: form.name.value.trim(), email: form.email.value.trim(),
          phone: form.phone.value.trim(), org: form.org.value.trim(), message: form.message.value.trim(), consent: true,
          website: form.website ? form.website.value : '', t: Date.now() - PAGE_T0
        }).then(function (res) {
          if (res.status === 200 && res.body.ok) cleared(res.body.message || 'Merci ! Votre message a bien été envoyé.');
          else problem(formProblem(res), res);
        }, function () { problem(NET_FAIL); }).then(function () { busy(btn, false); });
      } else {
        var first = checks.filter(function (c) { return !c[1]; })[0];
        (first ? first[0] : form.consent).focus();
      }
    });
  })();

  /* ---------- Desktop dropdowns ---------- */
  var dds = $$('.dd');
  function syncScrim() { document.body.classList.toggle('mega-open', dds.some(function (d) { return d.classList.contains('open'); })); }
  function closeAll(except) { dds.forEach(function (d) { if (d !== except) { d.classList.remove('open'); $('.dd-btn', d).setAttribute('aria-expanded', 'false'); } }); syncScrim(); }
  var hoverT, openT;
  dds.forEach(function (dd) {
    var btn = $('.dd-btn', dd);
    function open() { clearTimeout(hoverT); closeAll(dd); dd.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); syncScrim(); }
    function close() { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); syncScrim(); }
    btn.addEventListener('click', function () { dd.classList.contains('open') ? close() : open(); });
    // Small intent delay so sweeping across the bar doesn't flash panels; switching between open menus is instant.
    dd.addEventListener('mouseenter', function () { clearTimeout(hoverT); clearTimeout(openT); if (document.body.classList.contains('mega-open')) open(); else openT = setTimeout(open, 90); });
    dd.addEventListener('mouseleave', function () { clearTimeout(openT); hoverT = setTimeout(close, 180); });
    dd.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); btn.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!dd.classList.contains('open')) open(); var links = $$('a', dd); var i = links.indexOf(document.activeElement); (links[i + 1] || links[0]).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); var l = $$('a', dd); var j = l.indexOf(document.activeElement); (l[j - 1] || l[l.length - 1]).focus(); }
    });
    dd.addEventListener('focusout', function (e) { if (!dd.contains(e.relatedTarget)) close(); });
    $$('a', dd).forEach(function (a) { a.addEventListener('click', close); });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.dd')) closeAll(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeAll(); });

  /* ---------- Header: hide the top bar once the page scrolls ---------- */
  var header = $('#site-header'), ticking = false;
  function onScroll() { header.classList.toggle('is-scrolled', window.scrollY > 120); ticking = false; }
  window.addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  /* ---------- Mobile drawer ---------- */
  var drawer = $('#drawer'), scrim = $('#drawer-scrim'), openBtn = $('#menu-open');
  function openDrawer() {
    drawer.classList.add('open'); drawer.removeAttribute('inert'); drawer.setAttribute('aria-hidden', 'false');
    scrim.classList.remove('hidden'); requestAnimationFrame(function () { scrim.classList.add('show'); });
    openBtn.setAttribute('aria-expanded', 'true');
    // focus the panel itself (screen readers land in the menu; no ring on the close button for mouse and touch users)
    document.body.style.overflow = 'hidden'; setTimeout(function () { drawer.focus({ preventScroll: true }); }, 50);
  }
  function closeDrawer(focusBack) {
    drawer.classList.remove('open'); drawer.setAttribute('inert', ''); drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('show'); scrim.classList.add('hidden'); openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = ''; if (focusBack) openBtn.focus();
  }
  openBtn.addEventListener('click', openDrawer);
  $('#menu-close').addEventListener('click', function () { closeDrawer(true); });
  scrim.addEventListener('click', function () { closeDrawer(true); });
  drawer.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDrawer(true);
    if (e.key === 'Tab') {
      var f = $$('a, button', drawer).filter(function (el) { return el.offsetParent !== null; });
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });
  drawer.setAttribute('tabindex', '-1');
  // the current page: highlighted in the menu, and its group opened
  (function () {
    var here = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    $$('nav[aria-label="Mobile"] > *', drawer).forEach(function (el, i) { el.style.setProperty('--i', i); });
    $$('a.m-link', drawer).forEach(function (a) {
      var href = (a.getAttribute('href') || '').split('#')[0].split('?')[0].toLowerCase();
      if (!href || href !== here) return;
      a.classList.add('is-current'); a.setAttribute('aria-current', 'page');
      var panel = a.closest('.m-panel'); if (panel) { var acc = panel.previousElementSibling; if (acc) acc.classList.add('is-current'); }
    });
  })();
  $$('.m-acc').forEach(function (b) {
    b.addEventListener('click', function () {
      var p = b.nextElementSibling, open = b.getAttribute('aria-expanded') === 'true';
      b.setAttribute('aria-expanded', String(!open)); p.classList.toggle('hidden', open);
      $('.m-plus', b).textContent = open ? '+' : '−';
    });
  });
  $$('.m-link', drawer).forEach(function (a) { a.addEventListener('click', function () { closeDrawer(false); }); });
  window.addEventListener('resize', function () { if (window.innerWidth >= 1280 && drawer.classList.contains('open')) closeDrawer(false); });

  /* ---------- Language: English is live; French and Arabic are announced, not faked ---------- */
  var SOON = { fr: 'Version française bientôt disponible.', ar: 'النسخة العربية قريبًا.' };
  $$('.lang-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var lang = b.dataset.lang;
      if (SOON[lang]) toast(SOON[lang]);
    });
  });

  /* ---------- News: filter stories by type ---------- */
  (function () {
    var btns = $$('[data-news-filter]');
    if (!btns.length) return;
    var items = $$('#news-grid .nw-item'), empty = $('.nw-empty');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.dataset.newsFilter, shown = 0;
        btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        items.forEach(function (li) {
          var on = f === 'all' || li.dataset.type === f;
          li.hidden = !on; if (on) shown++;
        });
        if (empty) empty.classList.toggle('hidden', shown > 0);
      });
    });
  })();

  /* ---------- Hero slider (cinematic, story bar) ---------- */
  (function () {
    var root = $('#hero'); if (!root) return;
    var slides = $$('.hx-slide', root), copies = $$('.hx-copy', root), tabs = $$('[data-go]', root);
    var bars = $$('.hx-bars .hx-bar i', root), count = $('.hx-count', root), pb = $('[data-pause]', root);
    var cur = 0, DUR = 7000, done = 0, t0 = performance.now(), userPaused = reduce, hover = false;
    var rtl = function () { return doc.dir === 'rtl' ? -1 : 1; };
    function running() { return !userPaused && !hover; }
    function go(i) {
      cur = (i + slides.length) % slides.length; done = 0; t0 = performance.now();
      slides.forEach(function (s, k) { var on = k === cur; s.classList.toggle('is-on', on); if (on) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true'); });
      copies.forEach(function (c, k) { c.classList.toggle('is-on', k === cur); c.hidden = k !== cur; });
      tabs.forEach(function (t) { var on = +t.dataset.go === cur; t.classList.toggle('is-on', on); t.setAttribute('aria-current', on ? 'true' : 'false'); });
      bars.forEach(function (b, k) { b.style.transform = 'scaleX(' + (k < cur || (k === cur && userPaused) ? 1 : 0) + ')'; });
      if (count) count.textContent = pad(cur + 1);
    }
    function setPaused(on) {
      userPaused = on; root.classList.toggle('is-paused', on);
      pb.setAttribute('aria-label', on ? 'Play slideshow' : 'Pause slideshow');
      if (!on) t0 = performance.now();
    }
    function tick(now) {
      if (running()) {
        var p = Math.min(1, done + (now - t0) / DUR);
        bars[cur].style.transform = 'scaleX(' + p + ')';
        if (p >= 1) go(cur + 1);
      }
      requestAnimationFrame(tick);
    }
    function hold(on) {
      if (on === hover) return;
      if (on) done = Math.min(1, done + (performance.now() - t0) / DUR); else t0 = performance.now();
      hover = on;
    }
    function user(i) { go(i); }
    tabs.forEach(function (t) { t.addEventListener('click', function () { user(+t.dataset.go); }); });
    $('[data-prev]', root).addEventListener('click', function () { user(cur - rtl()); });
    $('[data-next]', root).addEventListener('click', function () { user(cur + rtl()); });
    pb.addEventListener('click', function () { if (!userPaused) done = Math.min(1, done + (performance.now() - t0) / DUR); setPaused(!userPaused); });
    root.addEventListener('mouseenter', function () { hold(true); });
    root.addEventListener('mouseleave', function () { hold(false); });
    root.addEventListener('focusin', function () { hold(true); });
    root.addEventListener('focusout', function (e) { if (!root.contains(e.relatedTarget)) hold(false); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') user(cur + rtl());
      if (e.key === 'ArrowLeft') user(cur - rtl());
    });
    var tx = null;
    root.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (tx === null) return; var dx = e.changedTouches[0].clientX - tx; tx = null;
      if (Math.abs(dx) > 45) user(cur + (dx < 0 ? 1 : -1) * rtl());
    });
    if (reduce) setPaused(true);
    go(0); requestAnimationFrame(tick);
  })();

  /* ---------- About band: mission / vision / approach slider ---------- */
  (function () {
    var root = $('.ab-slider'); if (!root) return;
    var slides = $$('.ab-slide', root), dots = $$('.ab-dot', root), cur = 0, timer;
    function go(i) {
      cur = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        var on = k === cur; s.classList.toggle('is-active', on);
        if (on) s.removeAttribute('aria-hidden'); else s.setAttribute('aria-hidden', 'true');
      });
      dots.forEach(function (d, k) { d.classList.toggle('is-on', k === cur); });
      $('.ab-cur', root).textContent = pad(cur + 1);
    }
    function stop() { clearInterval(timer); timer = null; }
    function step(dir) { stop(); go(cur + dir * (doc.dir === 'rtl' ? -1 : 1)); }
    $('.ab-next', root).addEventListener('click', function () { step(1); });
    $('.ab-prev', root).addEventListener('click', function () { step(-1); });
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    });
    var sx = null;
    root.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 40) step(dx < 0 ? 1 : -1);
    });
    root.addEventListener('mouseenter', stop);
    root.addEventListener('focusin', stop);
    if (!reduce) timer = setInterval(function () { go(cur + 1); }, 6500);
    go(0);
  })();

  /* ---------- Pillars: expanding panel explorer ---------- */
  (function () {
    var root = $('#pillar-explorer'); if (!root) return;
    var panels = $$('.pl-panel', root), heads = $$('.pl-head', root), hoverT, cur = 0;
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    function open(i, focus) {
      cur = i;
      panels.forEach(function (p, k) {
        var on = k === i;
        p.classList.toggle('is-open', on);
        heads[k].setAttribute('aria-expanded', String(on));
        $('.pl-body', p).inert = !on;
      });
      if (focus) heads[i].focus();
    }
    heads.forEach(function (h, i) {
      h.addEventListener('click', function () { open(i); });
      h.addEventListener('keydown', function (e) {
        var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
        if (step) {
          e.preventDefault();
          if (doc.dir === 'rtl' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) step = -step;
          open((i + step + panels.length) % panels.length, true);
        }
        if (e.key === 'Home') { e.preventDefault(); open(0, true); }
        if (e.key === 'End') { e.preventDefault(); open(panels.length - 1, true); }
      });
    });
    // Desktop: hovering a panel opens it after a short intent delay
    panels.forEach(function (p, i) {
      p.addEventListener('mouseenter', function () {
        if (!fine.matches || window.innerWidth < 1024) return;
        clearTimeout(hoverT);
        hoverT = setTimeout(function () { open(i); }, 140);
      });
      p.addEventListener('mouseleave', function () { clearTimeout(hoverT); });
    });
    $$('[data-goto-pillar]').forEach(function (a) {
      a.addEventListener('click', function () { open(+a.dataset.gotoPillar); });
    });
    // Previous / next arrows on the open panel; keep focus on the matching arrow of the new panel
    $$('.pl-step', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var step = +b.dataset.step;
        var next = (cur + step + panels.length) % panels.length;
        open(next);
        var same = $('.pl-step[data-step="' + step + '"]', panels[next]);
        if (same) setTimeout(function () { same.focus({ preventScroll: true }); }, 50);
      });
    });
    open(0);
  })();

  /* ---------- Stacked projects ---------- */
  (function () {
    if (!$('#stack')) return;
  var PROJECTS = [
    { n: '01', name: 'Leadership Lab 2.0', dot: '#FFB2B9', href: 'project-leadership-lab.html', pillar: 'Youth Empowerment', cat: 'Youth Leadership', surface: 'pc-1', phTone: '#E2E2E2', dark: false,
      photo: 'Leadership Lab 2.0 · photo de la page du projet',
      lede: 'Accompagner les leaders émergents par l’entrepreneuriat et l’engagement citoyen.',
      rows: [
        ['Context', 'Au Maroc, une large population de jeunes se tourne vers l’entrepreneuriat, et le regard sur l’innovation et la prise de risque évolue.'],
        ['Approach', 'Adapte des pratiques du système entrepreneurial américain et des principes de la démocratie participative.'],
        ['Activities', 'Parcours de formation d’un an à l’engagement citoyen et à l’entrepreneuriat pour des jeunes sélectionnés.'],
        ['Results', 'Récits de participants partagés sur le blog de l’AFCD (2023).']
      ] },
    { n: '02', name: 'Eco Citizen', dot: '#82E591', href: 'project-eco-citizen.html', pillar: 'Environment and Climate', cat: 'Environment', surface: 'pc-2', phTone: '#E6E6E6', dark: false,
      photo: 'Eco Citizen · Aït Ourir 2021',
      lede: 'Encourager la sensibilisation environnementale et l’action portée par la communauté.',
      rows: [
        ['Context', 'Les habitants et les décideurs d’Aït Ourir décrivent la gestion des déchets ménagers comme un problème persistant.'],
        ['Approach', 'Une démarche participative réunissant habitants, ONG locales et élus.'],
        ['Activities', 'Campagnes de sensibilisation (2020), puis ateliers sur le tri et le recyclage des déchets et formation de nouveaux comités locaux (2021).'],
        ['Results', 'Des propositions alternatives de gestion des déchets élaborées avec la communauté.']
      ] },
    { n: '03', name: 'Youth Green Generation', dot: '#82E591', href: 'project-youth-green-generation.html', pillar: 'Environment and Climate', cat: 'Climate Action', surface: 'pc-3', phTone: '#DADADA', dark: false,
      photo: 'call-for-application.jpg · 2024 call',
      lede: 'Accompagner les jeunes dans l’élaboration de réponses aux défis climatiques.',
      rows: [
        ['Context', 'S’appuie sur les précédents projets climat de l’AFCD, aux niveaux local et national (blog, novembre 2023).'],
        ['Approach', 'Donner aux jeunes les moyens de prendre la tête de l’action climatique dans leurs communautés.'],
        ['Activities', 'Appel à candidatures pour la promotion 2024.']
      ] }
  ];
  (function () {   /* cards come from the project module (Studio) via <template id="home-projects-data"> when present */
    var t = document.getElementById('home-projects-data'); if (!t || !t.content) return;
    var list = Array.prototype.map.call(t.content.querySelectorAll('article'), function (a) {
      var q = function (s) { var e = a.querySelector(s); return e ? e.innerHTML : ''; };
      var img = a.querySelector('img');
      return { n: a.dataset.n, name: q('h3'), dot: a.dataset.dot, href: a.dataset.href, pillar: q('.pp'), kind: q('.pk'), cat: q('.pc'),
        surface: a.dataset.surface, phTone: a.dataset.ph, photo: q('.ph'), img: img ? img.outerHTML : '', lede: q('.pl'),
        rows: Array.prototype.map.call(a.querySelectorAll('dl > div'), function (r) { return [r.querySelector('dt').innerHTML, r.querySelector('dd').innerHTML]; }) };
    });
    if (list.length) PROJECTS = list;
  })();
  var stack = $('#stack'), dotsWrap = $('#stack-dots'), sCur = 0;
  PROJECTS.forEach(function (p, i) {
    var card = document.createElement('article');
    card.className = 'pcard overflow-hidden rounded-[28px] text-ink ' + p.surface;
    card.setAttribute('aria-roledescription', 'project card');
    card.setAttribute('aria-label', p.name);
    card.innerHTML =
      '<button class="pcard-spine pcard-spine-btn pointer-events-none absolute inset-y-0 right-0 z-[2] flex w-[14.1%] flex-col justify-between p-6 text-left rtl:left-0 rtl:right-auto rtl:text-right" aria-label="Show project ' + p.n + ': ' + p.name + '" tabindex="-1">' +
        '<span class="text-[22px] font-medium tabular-nums">' + p.n + '</span>' +
        '<span class="block origin-bottom-left text-lg font-semibold tracking-[-0.02em] [writing-mode:vertical-rl] rotate-180 self-start">' + p.name + '</span>' +
        '<span class="grid h-10 w-10 place-items-center rounded-full bg-white/60 text-base" aria-hidden="true">→</span>' +
      '</button>' +
      '<div class="pcard-body flex h-full flex-col p-6 md:p-8 lg:p-10">' +
        '<header class="flex flex-wrap items-center justify-between gap-4">' +
          '<div class="flex min-w-0 items-center gap-4">' +
            '<span class="pc-no tabular-nums">' + p.n + '</span>' +
            '<h3 class="text-[26px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[36px] lg:text-[42px]">' + p.name + '</h3>' +
          '</div>' +
          '<span class="pc-pillar"><span class="pc-pillar-dot" style="--c:' + p.dot + '" aria-hidden="true"></span>' + p.pillar + '</span>' +
        '</header>' +
        '<div class="mt-5 flex flex-wrap gap-2"><span class="pc-pill">' + (p.kind || 'Case study') + '</span>' + (p.cat ? '<span class="pc-pill">' + p.cat + '</span>' : '') + '</div>' +
        '<div class="mt-6 grid min-h-0 flex-1 gap-5 md:grid-cols-12 md:gap-6">' +
          '<div class="pc-inner flex min-h-[280px] flex-col rounded-[24px] p-4 md:col-span-5 md:p-5">' +
            (p.img ? '<div class="pc-photo aspect-[4/3] w-full overflow-hidden rounded-[18px] md:aspect-auto md:flex-1">' + p.img + '</div>' : '<div class="ph aspect-[4/3] w-full rounded-[18px] md:aspect-auto md:flex-1" style="--ph:' + p.phTone + ';--ph-line:rgba(0,0,0,.08)"><span class="ph-cap"><b>Photo</b> · ' + p.photo + '</span></div>') +
            '<p class="mt-4 px-1 text-[17px] font-medium leading-snug tracking-[-0.01em] md:text-[19px]">' + p.lede + '</p>' +
          '</div>' +
          '<div class="flex min-w-0 flex-col md:col-span-7">' +
            '<dl class="grid flex-1 gap-3 sm:grid-cols-2">' + p.rows.map(function (r, k) {
              return '<div class="pc-tile"><dt class="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black/55"><span class="pc-tile-n tabular-nums">0' + (k + 1) + '</span>' + r[0] + '</dt><dd class="mt-3 text-[15px] leading-relaxed">' + r[1] + '</dd></div>';
            }).join('') + '</dl>' +
            '<div class="mt-5 flex flex-wrap items-center justify-end gap-x-6 gap-y-3">' +
              '<a href="projects.html" class="link-arrow text-[14px]">All projects <span class="arr" aria-hidden="true">↗</span></a>' +
              '<a href="' + p.href + '" class="pc-btn">Explore project <span class="pc-arr" aria-hidden="true">→</span></a>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    stack.appendChild(card);
    $('.pcard-spine-btn', card).addEventListener('click', function () { setStack(i); });
    var dot = document.createElement('button');
    dot.className = 'stack-dot h-11 px-1'; dot.setAttribute('aria-label', 'Project ' + p.n + ': ' + p.name);
    dot.innerHTML = '<span class="block h-[4px] w-8 rounded-full bg-ink-light transition-colors"></span>';
    dot.addEventListener('click', function () { setStack(i); });
    dotsWrap.appendChild(dot);
  });
  var cards = $$('.pcard', stack), sDots = $$('.stack-dot', dotsWrap);
  function setStack(i) {
    sCur = (i + cards.length) % cards.length;
    cards.forEach(function (c, k) {
      var pos = (k - sCur + cards.length) % cards.length;
      c.dataset.pos = pos;
      var body = $('.pcard-body', c), spine = $('.pcard-spine-btn', c);
      if (pos === 0) { body.removeAttribute('inert'); body.removeAttribute('aria-hidden'); spine.tabIndex = -1; spine.setAttribute('aria-hidden', 'true'); }
      else { body.setAttribute('inert', ''); body.setAttribute('aria-hidden', 'true'); spine.tabIndex = window.innerWidth >= 1024 ? 0 : -1; spine.removeAttribute('aria-hidden'); }
    });
    sDots.forEach(function (d, k) { var on = k === sCur; $('span', d).classList.toggle('bg-ink-pure', on); $('span', d).classList.toggle('bg-ink-light', !on); if (on) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
    $('#stack-cur').textContent = pad(sCur + 1);
  }
  function layoutStack() { setStack(sCur); }
  window.addEventListener('resize', layoutStack);
  $('#stack-next').addEventListener('click', function () { setStack(sCur + (doc.dir === 'rtl' ? -1 : 1)); });
  $('#stack-prev').addEventListener('click', function () { setStack(sCur - (doc.dir === 'rtl' ? -1 : 1)); });
  var sx = null, sy = null;
  stack.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stack.addEventListener('touchend', function (e) {
    if (sx === null) return; var dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; sx = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy)) setStack(sCur + (dx < 0 ? 1 : -1) * (doc.dir === 'rtl' ? -1 : 1));
  });
  setStack(0);
  })();

  /* ---------- Partners ---------- */
  var PARTNER_GROUPS = [
    ['International', ['World Denver', 'Danish Youth Council', 'Embassy of Switzerland in Morocco', 'Ambassade des États-Unis au Maroc', 'Embassy of France in Morocco', 'Service Civil International (Allemagne)', 'Plugged In Band Program', 'Rebild Ungdomsskole', 'MapWorks Learning']],
    ['National', ['High Atlas Foundation', 'Heinrich Böll Stiftung Rabat', 'Moroccan Institute for Policy Analysis', 'Dar America Casablanca', 'Anoual Association', 'International Youth Council Morocco', 'Student Voice', 'Y-PEER PETRI Morocco']],
    ['Local', ['Commune of Ait Ourir']]
  ];
  (function () {   /* names come from the page's <template id="partner-data"> so each language version shows its own */
    var t = document.getElementById('partner-data'); if (!t || !t.content) return;
    var g = Array.prototype.map.call(t.content.querySelectorAll('ul[data-g]'), function (u) { return [u.dataset.g, Array.prototype.map.call(u.children, function (li) { return li.textContent.trim(); })]; });
    if (g.length) PARTNER_GROUPS = g;
  })();

  /* Homepage: compact strip with filters */
  (function () {
    var strip = $('#partner-strip'); if (!strip) return;
    function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function label(key) {   /* the filter button's own (translated) text, without its count */
      var b = $('.pt-filter[data-g="' + key + '"]'); if (!b) return key;
      var n = b.firstChild; return (n && n.nodeType === 3 ? n.textContent : b.textContent).trim() || key;
    }
    function tile(name, group) {
      return '<li class="pt-tile"><span class="pt-logo">Logo</span><span class="pt-name">' + esc(name) + '</span><span class="pt-tag">' + esc(label(group)) + '</span></li>';
    }
    function list(groups) {
      var out = [];
      PARTNER_GROUPS.forEach(function (g) { if (groups.indexOf(g[0]) > -1) g[1].forEach(function (n) { out.push(tile(n, g[0])); }); });
      return out.join('');
    }
    function row(groups, dir) {
      var items = list(groups);
      if (reduce) return '<div class="pt-row is-static"><ul class="pt-track">' + items + '</ul></div>';
      return '<div class="pt-row" data-dir="' + dir + '"><ul class="pt-track">' + items + '</ul><ul class="pt-track" aria-hidden="true">' + items + '</ul></div>';
    }
    function render(key) {
      strip.innerHTML = key === 'all'
        ? row(['International'], 'left') + row(['National', 'Local'], 'right')
        : '<ul class="pt-grid">' + list([key]) + '</ul>';
    }
    var btns = $$('.pt-filter');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        btns.forEach(function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', String(on)); });
        render(b.dataset.g);
      });
    });
    render('all');
  })();

  /* Staff login: links to the AFCD Studio dashboard.
     Set STUDIO_URL once Studio has a live address; until then the link only appears on a local machine. */
  (function () {
    var STUDIO_URL = '';
    var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
    var url = STUDIO_URL || (local ? 'http://localhost:4400/studio/' : '');
    if (!url) return;
    $$('[data-studio-login]').forEach(function (a) {
      a.href = url; a.hidden = false;
      a.addEventListener('click', function () { try { localStorage.setItem('afcd.staff', '1'); } catch (e) { /* storage off */ } });
    });
    /* Edit this page: once "Staff login" has been used in this browser, every page shows a small button that opens the
       Studio editor for that page (Studio still asks to sign in). The x hides it until "Staff login" is used again. */
    var staff = false; try { staff = localStorage.getItem('afcd.staff') === '1'; } catch (e) { /* storage off */ }
    if (!staff) return;
    var file = location.pathname.split('/').pop() || 'index.html';
    if (!/^[a-z0-9-]+\.html$/i.test(file)) return;
    var box = document.createElement('div');
    box.className = 'studio-edit';
    box.innerHTML = '<a href="' + url + 'open?page=' + encodeURIComponent(file) + '" target="_blank" rel="noopener">'
      + '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 2.5l3 3L6 13H3v-3z"/><path d="M9 4l3 3"/></svg>'
      + '<span>Edit this page</span></a><button type="button" aria-label="Hide the edit button">&times;</button>';
    box.querySelector('button').addEventListener('click', function () { try { localStorage.setItem('afcd.staff', '0'); } catch (e) { /* storage off */ } box.parentNode.removeChild(box); });
    document.body.appendChild(box);
  })();

  /* Article pages: copy the page link */
  $$('[data-copy-link]').forEach(function (b) {
    b.addEventListener('click', function () {
      var done = function () { toast('Lien copié.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(location.href).then(done, function () { toast(location.href); });
      else toast(location.href);
    });
  });

  /* ---------- Participant stories carousel ([data-tm]) ---------- */
  $$('[data-tm]').forEach(function (root) {
    var slides = $$('.tm-slide', root), bars = $$('[data-tm-go]', root), cur = $('[data-tm-cur]', root);
    var n = slides.length, i = 0, D = 8000, t0 = 0, elapsed = 0, raf = 0, paused = reduce, hold = false;
    if (n < 2) { $('.tm-ctrl', root).hidden = true; $('.tm-bars', root).hidden = true; return; }
    $$('[data-tm-initials]', root).forEach(function (av) {
      var nm = av.nextElementSibling && av.nextElementSibling.querySelector('.font-medium');
      if (nm) { var w = nm.textContent.trim().split(/\s+/); av.textContent = (w[0].charAt(0) + (w.length > 1 ? w[w.length - 1].charAt(0) : '')).toUpperCase(); }
    });
    function show(k, user) {
      i = (k + n) % n; elapsed = 0; t0 = performance.now();
      slides.forEach(function (s, j) {
        var on = j === i; s.classList.toggle('is-on', on);
        if (on) { s.removeAttribute('aria-hidden'); s.inert = false; } else { s.setAttribute('aria-hidden', 'true'); s.inert = true; }
      });
      bars.forEach(function (b, j) { b.classList.toggle('is-on', j === i); b.classList.toggle('is-done', j < i); b.style.setProperty('--p', 0); if (j === i) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
      if (cur) cur.textContent = String(i + 1).padStart(2, '0');
      $('.tm-track', root).setAttribute('aria-live', user ? 'polite' : 'off');
    }
    function tick(now) {
      raf = requestAnimationFrame(tick);
      if (paused || hold) { t0 = now - elapsed; return; }
      elapsed = now - t0; var p = Math.min(1, elapsed / D);
      if (bars[i]) bars[i].style.setProperty('--p', p.toFixed(4));
      if (p >= 1) show(i + 1);
    }
    function setPaused(v) {
      paused = v; root.classList.toggle('is-paused', v);
      var b = $('[data-tm-pause]', root); if (b) b.setAttribute('aria-label', v ? 'Play stories' : 'Pause stories');
    }
    $('[data-tm-next]', root).addEventListener('click', function () { show(i + 1, true); });
    $('[data-tm-prev]', root).addEventListener('click', function () { show(i - 1, true); });
    $('[data-tm-pause]', root).addEventListener('click', function () { setPaused(!paused); });
    bars.forEach(function (b) { b.addEventListener('click', function () { show(+b.dataset.tmGo, true); }); });
    root.addEventListener('mouseenter', function () { hold = true; });
    root.addEventListener('mouseleave', function () { hold = false; });
    root.addEventListener('focusin', function () { hold = true; });
    root.addEventListener('focusout', function (e) { if (!root.contains(e.relatedTarget)) hold = false; });
    root.addEventListener('keydown', function (e) {
      var rtl = document.dir === 'rtl';
      if (e.key === 'ArrowRight') { show(i + (rtl ? -1 : 1), true); e.preventDefault(); }
      if (e.key === 'ArrowLeft') { show(i + (rtl ? 1 : -1), true); e.preventDefault(); }
    });
    var sx = null;
    root.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    root.addEventListener('touchend', function (e) {
      if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 40) { var fwd = dx < 0; if (document.dir === 'rtl') fwd = !fwd; show(i + (fwd ? 1 : -1), true); }
    }, { passive: true });
    if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { es.forEach(function (e) { hold = !e.isIntersecting; }); }).observe(root);
    setPaused(paused); show(0); raf = requestAnimationFrame(tick);
  });

  /* ---------- Pillar pages: highlight the current section in the sticky bar ([data-pl-tabs]) ---------- */
  (function () {
    var bar = $('[data-pl-tabs]'); if (!bar || !('IntersectionObserver' in window)) return;
    var tabs = $$('.pl-tab', bar), map = {};
    tabs.forEach(function (t) { var id = t.getAttribute('href').slice(1), sec = document.getElementById(id); if (sec) map[id] = t; });
    var seen = {};
    function pick() {
      var best = null;
      Object.keys(map).forEach(function (id) { var r = document.getElementById(id).getBoundingClientRect(); if (r.top < innerHeight * .45 && r.bottom > 140 && (!best || r.top > best.top)) best = { id: id, top: r.top }; });
      tabs.forEach(function (t) { t.classList.remove('is-on'); t.removeAttribute('aria-current'); });
      if (best) { var t = map[best.id]; t.classList.add('is-on'); t.setAttribute('aria-current', 'true'); var box = t.parentNode; if (box.scrollWidth > box.clientWidth) box.scrollTo({ left: t.offsetLeft - 16, behavior: reduce ? 'auto' : 'smooth' }); }
    }
    var io = new IntersectionObserver(pick, { threshold: [0, .25, .5, 1] });
    Object.keys(map).forEach(function (id) { io.observe(document.getElementById(id)); });
    pick();
    // "is-stuck" once the bar sits under the header: it then gets its full-width background
    var raf = 0;
    function stuck() { raf = 0; var top = parseFloat(getComputedStyle(bar).top) || 0; bar.classList.toggle('is-stuck', bar.getBoundingClientRect().top <= top + 1 && window.scrollY > 0); }
    window.addEventListener('scroll', function () { if (!raf) raf = requestAnimationFrame(stuck); }, { passive: true });
    window.addEventListener('resize', stuck); stuck();
  })();

  /* ---------- Social sharing ([data-shr]): links follow this language's canonical URL; native share where available ---------- */
  (function () {
    var bars = $$('[data-shr]'); if (!bars.length) return;
    var can = document.querySelector('link[rel="canonical"]'), url = (can && can.href) || location.href.split('#')[0];
    var title = (document.querySelector('h1') || {}).textContent || document.title; title = title.trim();
    var u = encodeURIComponent(url), t = encodeURIComponent(title);
    var map = { facebook: 'https://www.facebook.com/sharer/sharer.php?u=' + u, linkedin: 'https://www.linkedin.com/sharing/share-offsite/?url=' + u,
      x: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t, whatsapp: 'https://wa.me/?text=' + t + '%20' + u };
    bars.forEach(function (b) {
      $$('[data-net]', b).forEach(function (a) { if (map[a.dataset.net]) a.href = map[a.dataset.net]; });
      if (navigator.share) $$('[data-shr-native]', b).forEach(function (n) { n.hidden = false; });
    });
  })();

  /* ---------- Photo galleries ([data-lb]): tiles open a full-screen viewer with arrows, swipe, keyboard and captions ---------- */
  (function () {
    var groups = $$('[data-lb]'); if (!groups.length) return;
    var box = document.createElement('div');
    box.className = 'lbx'; box.hidden = true;
    box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Photo viewer');
    box.innerHTML = '<div class="lbx-top"><span class="lbx-title"></span><span class="lbx-count" aria-live="polite"></span>'
      + '<button type="button" class="lbx-btn lbx-x" aria-label="Close"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M5 5l10 10M15 5 5 15"/></svg></button></div>'
      + '<figure class="lbx-stage"><img alt=""><figcaption class="lbx-cap"></figcaption></figure>'
      + '<button type="button" class="lbx-btn lbx-prev" aria-label="Previous photo"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="rtl:-scale-x-100"><path d="M12.5 4.5 7 10l5.5 5.5"/></svg></button>'
      + '<button type="button" class="lbx-btn lbx-next" aria-label="Next photo"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="rtl:-scale-x-100"><path d="M7.5 4.5 13 10l-5.5 5.5"/></svg></button>'
      + '<div class="lbx-strip" role="tablist" aria-label="Photos"></div>';
    document.body.appendChild(box);
    var img = $('.lbx-stage img', box), cap = $('.lbx-cap', box), cnt = $('.lbx-count', box), ttl = $('.lbx-title', box), strip = $('.lbx-strip', box);
    var items = [], i = 0, opener = null;
    function show(k) {
      i = (k + items.length) % items.length;
      var it = items[i];
      img.classList.remove('is-in'); img.src = it.full; img.alt = it.alt;
      if (img.complete) img.classList.add('is-in'); else img.onload = function () { img.classList.add('is-in'); };
      cap.textContent = it.alt; cap.hidden = !it.alt;
      cnt.textContent = (i + 1) + ' / ' + items.length;
      $$('button', strip).forEach(function (b, j) { b.classList.toggle('is-on', j === i); b.setAttribute('aria-selected', String(j === i)); });
      var on = strip.children[i]; if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
      var multi = items.length > 1; $('.lbx-prev', box).hidden = !multi; $('.lbx-next', box).hidden = !multi; strip.hidden = !multi;
    }
    function open(g, k, from) {
      items = $$('[data-lb-items] img', g).map(function (im) { return { full: im.src, alt: im.getAttribute('alt') || '' }; });
      if (!items.length) return;
      ttl.textContent = g.dataset.lbTitle || '';
      strip.innerHTML = items.map(function (it, j) { return '<button type="button" role="tab" aria-label="Photo ' + (j + 1) + '"><img src="' + it.full + '" alt="" loading="lazy"></button>'; }).join('');
      $$('button', strip).forEach(function (b, j) { b.addEventListener('click', function () { show(j); }); });
      opener = from; box.hidden = false; document.documentElement.classList.add('lbx-open');
      requestAnimationFrame(function () { box.classList.add('is-on'); });
      show(k); $('.lbx-x', box).focus();
    }
    function close() {
      box.classList.remove('is-on'); document.documentElement.classList.remove('lbx-open');
      setTimeout(function () { box.hidden = true; }, reduce ? 0 : 200);
      if (opener) opener.focus();
    }
    groups.forEach(function (g) {
      $$('[data-lb-open]', g).forEach(function (b) { b.addEventListener('click', function () { open(g, +b.dataset.lbOpen, b); }); });
    });
    $('.lbx-x', box).addEventListener('click', close);
    $('.lbx-prev', box).addEventListener('click', function () { show(i - 1); });
    $('.lbx-next', box).addEventListener('click', function () { show(i + 1); });
    box.addEventListener('click', function (e) { if (e.target === box || e.target.classList.contains('lbx-stage')) close(); });
    document.addEventListener('keydown', function (e) {
      if (box.hidden) return;
      var rtl = document.dir === 'rtl';
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowRight') show(i + (rtl ? -1 : 1));
      else if (e.key === 'ArrowLeft') show(i + (rtl ? 1 : -1));
      else if (e.key === 'Tab') {   /* keep focus inside the viewer */
        var f = $$('button', box).filter(function (b) { return !b.hidden && b.offsetParent !== null; });
        if (!f.length) return; var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
      }
    });
    var sx = null;
    box.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (sx === null) return; var dx = e.changedTouches[0].clientX - sx; sx = null;
      if (Math.abs(dx) > 40) { var fwd = dx < 0; if (document.dir === 'rtl') fwd = !fwd; show(i + (fwd ? 1 : -1)); }
    }, { passive: true });
  })();

  /* ---------- Count-up numbers ([data-countup]) and gentle parallax ([data-par]) ---------- */
  (function () {
    var nums = $$('[data-countup]');
    if (nums.length && !reduce && 'IntersectionObserver' in window) {
      nums = nums.filter(function (n) { n.dataset.full = n.textContent.trim(); return /\d/.test(n.dataset.full); });
      nums.forEach(function (n) { n.textContent = n.dataset.full.replace(/\d+/, '0'); });
      var io = new IntersectionObserver(function (es) {
        es.forEach(function (e) {
          if (!e.isIntersecting) return; io.unobserve(e.target);
          var el = e.target, m = el.dataset.full.match(/^(\D*)(\d+)(.*)$/), t0 = performance.now(), D = 1400;
          if (!m) { el.textContent = el.dataset.full; return; }
          (function step(now) { var p = Math.min(1, (now - t0) / D), k = 1 - Math.pow(1 - p, 3); el.textContent = m[1] + Math.round(+m[2] * k) + m[3]; if (p < 1) requestAnimationFrame(step); })(t0);
        });
      }, { threshold: .6 });
      nums.forEach(function (n) { io.observe(n); });
    }
    var tiles = $$('[data-par]');
    if (reduce || !tiles.length) return;
    var ticking = false;
    function upd() {
      ticking = false;
      tiles.forEach(function (t) {
        var box = t.parentElement.getBoundingClientRect(), vh = innerHeight;
        if (box.bottom < 0 || box.top > vh) return;
        var p = (box.top + box.height / 2 - vh / 2) / vh;
        t.style.transform = 'translate3d(0,' + (p * +t.dataset.par).toFixed(1) + 'px,0)';
      });
    }
    addEventListener('scroll', function () { if (!ticking) { ticking = true; requestAnimationFrame(upd); } }, { passive: true });
    upd();
  })();

  /* ---------- Event details: countdown, add to calendar, share, phone registration bar ---------- */
  $$('[data-countdown]').forEach(function (el) {
    var p = el.dataset.countdown.split('-'), t = new Date(+p[0], +p[1] - 1, +p[2]), n = new Date(); n.setHours(0, 0, 0, 0);
    var d = Math.round((t - n) / 864e5); if (isNaN(d) || d < 0) return;
    el.textContent = d === 0 ? 'Aujourd’hui' : d === 1 ? 'Demain' : 'Dans ' + d + ' jours'; el.hidden = false;
  });
  $$('[data-ics]').forEach(function (b) {
    b.addEventListener('click', function () {
      var d = b.dataset, day = d.start.replace(/-/g, ''), two = function (n) { return ('0' + n).slice(-2); };
      var m = (d.time || '').match(/(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})/), s, e;
      if (m) { s = 'DTSTART;TZID=Africa/Casablanca:' + day + 'T' + two(m[1]) + m[2] + '00'; e = 'DTEND;TZID=Africa/Casablanca:' + day + 'T' + two(m[3]) + m[4] + '00'; }
      else { var nx = new Date(d.start + 'T00:00:00Z'); nx.setUTCDate(nx.getUTCDate() + 1); s = 'DTSTART;VALUE=DATE:' + day; e = 'DTEND;VALUE=DATE:' + nx.toISOString().slice(0, 10).replace(/-/g, ''); }
      var esc = function (t) { return String(t || '').replace(/([,;\\])/g, '\\$1'); };
      var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//AFCD Foundation//Events//EN', 'BEGIN:VEVENT', 'UID:' + d.uid + '@afcdfoundation.org',
        'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z', s, e, 'SUMMARY:' + esc(d.title), 'LOCATION:' + esc(d.where),
        'URL:' + location.href.split('#')[0], 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
      var link = document.createElement('a'), url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar' }));
      link.href = url; link.download = d.uid + '.ics';
      document.body.appendChild(link); link.click(); document.body.removeChild(link);
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
      toast('Fichier calendrier prêt : ouvrez-le pour ajouter l’événement.');
    });
  });
  $$('[data-share]').forEach(function (b) {
    b.addEventListener('click', function () {
      var url = location.href.split('#')[0];
      if (navigator.share) { navigator.share({ title: document.title, url: url }).catch(function () {}); return; }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { toast('Lien copié.'); }, function () { toast(url); });
      else toast(url);
    });
  });
  (function () {
    var bar = $('[data-evd-bar]'), card = $('#register');
    if (!bar || !card || !('IntersectionObserver' in window)) return;
    bar.hidden = false;
    new IntersectionObserver(function (es) {
      var en = es[0], on = !en.isIntersecting && en.boundingClientRect.top < 0;
      bar.classList.toggle('is-on', on); bar.setAttribute('aria-hidden', on ? 'false' : 'true');
    }).observe(card);
  })();

  /* Tabs inside a section ([data-tabs]): all panels stay visible if scripts don't run */
  $$('[data-tabs]').forEach(function (root) {
    var tabs = $$('[role="tab"]', root), panels = $$('[role="tabpanel"]', root);
    root.classList.add('tabs-on');
    function show(i, focus) {
      tabs.forEach(function (t, k) { var on = k === i; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; if (on && focus) t.focus(); });
      panels.forEach(function (p, k) { p.hidden = k !== i; });
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { show(i); });
      t.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (d) { e.preventDefault(); show((i + d + tabs.length) % tabs.length, true); }
      });
    });
    show(0);
  });

  /* Events page: upcoming / past filter */
  (function () {
    var list = $('#event-list'); if (!list) return;
    var rows = $$('.ev-row', list), btns = $$('[data-ev]'), empty = $('.ev-empty');
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.dataset.ev, shown = 0;
        btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        rows.forEach(function (r) { var on = f === 'all' || r.dataset.when === f; r.hidden = !on; if (on) shown++; });
        if (empty) empty.classList.toggle('hidden', shown > 0);
      });
    });
  })();

  /* Partners page: filter by scope and search by name (the list itself is plain HTML) */
  (function () {
    var grid = $('#partner-grid'); if (!grid) return;
    var cards = $$('.pr-card', grid), btns = $$('[data-pf]'), search = $('#partner-search'), empty = $('.pr-empty');
    var group = 'all';
    function apply() {
      var q = (search && search.value || '').trim().toLowerCase(), shown = 0;
      cards.forEach(function (c) {
        var on = (group === 'all' || c.dataset.group === group) && (!q || c.dataset.name.indexOf(q) > -1);
        c.hidden = !on; if (on) shown++;
      });
      if (empty) empty.classList.toggle('hidden', shown > 0);
    }
    btns.forEach(function (b) {
      b.addEventListener('click', function () {
        group = b.dataset.pf;
        btns.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
        apply();
      });
    });
    if (search) search.addEventListener('input', apply);
  })();

})();
