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

  /* ---------- Contact form: client-side checks only (no backend yet) ---------- */
  (function () {
    var form = $('#contact-form'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ok = form.name.value.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.value.trim()) && form.message.value.trim();
      $('.form-error', form).classList.toggle('hidden', !!ok);
      if (ok) { toast('Thanks! The form isn’t connected yet, so nothing was sent.'); form.reset(); }
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
    scrim.classList.remove('hidden'); openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden'; setTimeout(function () { $('#menu-close').focus(); }, 50);
  }
  function closeDrawer(focusBack) {
    drawer.classList.remove('open'); drawer.setAttribute('inert', ''); drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.add('hidden'); openBtn.setAttribute('aria-expanded', 'false');
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

  /* ---------- Hero slider ---------- */
  (function () {
    if (!$('#hero')) return;
    var slides = $$('.hero-slide'), dots = $$('.hero-dot'), bars = $$('.hero-progress-bar');
    var cur = 0, playing = !reduce, DURATION = 7000, start = 0, elapsed = 0, raf, userPaused = reduce;
    var pauseBtn = $('#hero-pause');
    function go(i) {
      i = (i + slides.length) % slides.length;
      slides.forEach(function (s, k) {
        var on = k === i; s.classList.toggle('active', on);
        if (on) { s.removeAttribute('inert'); s.removeAttribute('aria-hidden'); } else { s.setAttribute('inert', ''); s.setAttribute('aria-hidden', 'true'); }
      });
      dots.forEach(function (d, k) { if (k === i) d.setAttribute('aria-current', 'true'); else d.removeAttribute('aria-current'); });
      bars.forEach(function (b, k) { b.style.transform = 'scaleX(' + (k < i ? 1 : 0) + ')'; });
      cur = i; $('#hero-cur').textContent = pad(i + 1); elapsed = 0; start = performance.now();
      if (!playing) bars[i].style.transform = 'scaleX(1)';
    }
    function tick(now) {
      if (playing) {
        var p = Math.min(1, (elapsed + now - start) / DURATION);
        bars[cur].style.transform = 'scaleX(' + p + ')';
        if (p >= 1) go(cur + 1);
      }
      raf = requestAnimationFrame(tick);
    }
    function setPlaying(on) {
      if (on === playing) return;
      if (on) { start = performance.now(); } else { elapsed += performance.now() - start; }
      playing = on;
      $('#ico-pause').classList.toggle('hidden', !on); $('#ico-play').classList.toggle('hidden', on);
      pauseBtn.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow');
    }
    function userAct() { userPaused = true; setPlaying(false); }
    $('#hero-next').addEventListener('click', function () { userAct(); go(cur + (doc.dir === 'rtl' ? -1 : 1)); });
    $('#hero-prev').addEventListener('click', function () { userAct(); go(cur - (doc.dir === 'rtl' ? -1 : 1)); });
    dots.forEach(function (d, k) { d.addEventListener('click', function () { userAct(); go(k); }); });
    pauseBtn.addEventListener('click', function () { userPaused = playing; setPlaying(!playing); });
    var hero = $('#hero');
    hero.addEventListener('mouseenter', function () { setPlaying(false); });
    hero.addEventListener('mouseleave', function () { if (!userPaused) setPlaying(true); });
    hero.addEventListener('focusin', function () { setPlaying(false); });
    hero.setAttribute('tabindex', '-1');
    hero.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { userAct(); go(cur + (doc.dir === 'rtl' ? -1 : 1)); }
      if (e.key === 'ArrowLeft') { userAct(); go(cur - (doc.dir === 'rtl' ? -1 : 1)); }
    });
    var tx = null;
    hero.addEventListener('touchstart', function (e) { tx = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', function (e) {
      if (tx === null) return; var dx = e.changedTouches[0].clientX - tx; tx = null;
      if (Math.abs(dx) > 45) { userAct(); go(cur + (dx < 0 ? 1 : -1) * (doc.dir === 'rtl' ? -1 : 1)); }
    });
    if (reduce) { $('#ico-pause').classList.add('hidden'); $('#ico-play').classList.remove('hidden'); pauseBtn.setAttribute('aria-label', 'Play slideshow'); }
    go(0); raf = requestAnimationFrame(tick);
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
    var panels = $$('.pl-panel', root), heads = $$('.pl-head', root), hoverT;
    var fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    function open(i, focus) {
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
    open(0);
  })();

  /* ---------- Stacked projects ---------- */
  (function () {
    if (!$('#stack')) return;
  var PROJECTS = [
    { n: '01', name: 'Leadership Lab 2.0', href: 'project-leadership-lab.html', pillar: 'Youth Empowerment', cat: 'Youth Leadership', surface: 'pc-1', phTone: '#E2E2E2', dark: false,
      photo: 'Leadership Lab 2.0 · project page photo',
      lede: 'Supporting emerging leaders through entrepreneurship and civic engagement.',
      rows: [
        ['Context', 'A large youth population in Morocco is turning to entrepreneurship, and attitudes toward innovation and risk-taking are shifting.'],
        ['Approach', 'Adapts practices from the U.S. entrepreneurial system and principles of participatory democracy.'],
        ['Activities', 'Year-long civic engagement and entrepreneurship training tracks for selected young people.'],
        ['Results', 'Participant stories shared on the AFCD blog (2023).']
      ] },
    { n: '02', name: 'Eco Citizen', href: 'project-eco-citizen.html', pillar: 'Green Thumbs', cat: 'Environment', surface: 'pc-2', phTone: '#E6E6E6', dark: false,
      photo: 'Eco Citizen · Ait Ourir 2021',
      lede: 'Encouraging environmental awareness and community-led action.',
      rows: [
        ['Context', 'Residents and decision-makers in Ait Ourir describe household waste management as a persistent problem.'],
        ['Approach', 'A participatory process bringing residents, local NGOs and elected representatives together.'],
        ['Activities', 'Awareness campaigns (2020), then workshops on waste sorting and recycling and training for new local committees (2021).'],
        ['Results', 'Alternative waste-management proposals developed with the community.']
      ] },
    { n: '03', name: 'Youth Green Generation', href: 'project-youth-green-generation.html', pillar: 'Green Thumbs', cat: 'Climate Action', surface: 'pc-3', phTone: '#DADADA', dark: false,
      photo: 'call-for-application.jpg · 2024 call',
      lede: 'Supporting young people in developing responses to climate challenges.',
      rows: [
        ['Context', 'Builds on AFCD’s earlier climate projects, locally and nationally (blog, November 2023).'],
        ['Approach', 'Empowering young people to take the lead on climate action in their communities.'],
        ['Activities', 'Call for applications for the 2024 cohort.']
      ] }
  ];
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
        '<header class="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-4 md:grid-cols-[auto_1fr_auto]">' +
          '<span class="text-[22px] font-medium tabular-nums md:text-[26px]">' + p.n + '</span>' +
          '<h3 class="text-[22px] font-semibold leading-[1.1] tracking-[-0.025em] md:text-center md:text-[28px]">' + p.name + '</h3>' +
          '<span class="hidden text-sm font-medium md:block">' + p.pillar + '</span>' +
        '</header>' +
        '<div class="mt-5 flex flex-wrap gap-2"><span class="pc-pill">Case study</span><span class="pc-pill">' + p.cat + '</span></div>' +
        '<div class="mt-6 grid min-h-0 flex-1 gap-6 md:grid-cols-12 md:gap-10">' +
          '<div class="pc-inner flex min-h-[260px] flex-col justify-between rounded-[22px] p-5 md:col-span-5 md:p-6">' +
            '<div class="ph aspect-[4/3] w-full rounded-2xl md:aspect-auto md:flex-1" style="--ph:' + p.phTone + ';--ph-line:rgba(0,0,0,.08)"><span class="ph-cap"><b>Photo</b> · ' + p.photo + '</span></div>' +
            '<p class="mt-5 text-[17px] font-medium leading-snug tracking-[-0.01em] md:text-lg">' + p.lede + '</p>' +
          '</div>' +
          '<div class="flex min-w-0 flex-col md:col-span-7">' +
            '<dl class="space-y-5 text-[15px] leading-relaxed">' + p.rows.map(function (r) {
              return '<div class="border-l-2 border-black/15 pl-5 rtl:border-l-0 rtl:border-r-2 rtl:pl-0 rtl:pr-5"><dt class="text-[11px] font-medium uppercase tracking-[0.16em] text-black/55">' + r[0] + '</dt><dd class="mt-1.5">' + r[1] + '</dd></div>';
            }).join('') + '</dl>' +
            '<a href="' + p.href + '" class="pc-btn mt-auto self-end">Explore project <span class="pc-arr" aria-hidden="true">→</span></a>' +
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
  (function () {
    if (!$('#partner-groups')) return;
  var GROUPS = [
    ['International', ['World Denver', 'Danish Youth Council', 'Embassy of Switzerland in Morocco', 'U.S. Embassy Morocco', 'Embassy of France in Morocco', 'Service Civil International (Germany)', 'Plugged In Band Program', 'Rebild Ungdomsskole', 'MapWorks Learning']],
    ['National', ['High Atlas Foundation', 'Heinrich Böll Stiftung Rabat', 'Moroccan Institute for Policy Analysis', 'Dar America Casablanca', 'Anoual Association', 'International Youth Council Morocco', 'Student Voice', 'Y-PEER PETRI Morocco']],
    ['Local', ['Commune of Ait Ourir']]
  ];
  var pg = $('#partner-groups');
  GROUPS.forEach(function (g) {
    var cells = g[1].map(function (name) {
      return '<li class="group flex min-h-[132px] flex-col justify-between rounded-2xl border border-ink-light bg-white p-4 transition-colors hover:border-ink-mid md:min-h-[150px] md:p-5">' +
        '<span class="grid h-14 place-items-center"><span class="grid h-full w-[72%] max-w-[150px] place-items-center rounded-lg border border-dashed border-ink-light text-[10px] uppercase tracking-[0.12em] text-ink-mid transition-colors group-hover:border-ink-mid">Logo</span></span>' +
        '<span class="mt-3 text-[13px] leading-snug text-ink-dark">' + name + '</span></li>';
    }).join('');
    pg.insertAdjacentHTML('beforeend',
      '<div class="grid gap-4 border-t border-ink-light py-8 lg:grid-cols-12 lg:gap-8">' +
        '<div class="lg:col-span-2"><p class="label">' + g[0] + '</p><p class="mt-1 text-xs tabular-nums text-ink-mid">' + g[1].length + (g[1].length === 1 ? ' partner' : ' partners') + '</p></div>' +
        '<ul class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-10 lg:grid-cols-5">' + cells + '</ul>' +
      '</div>');
  });
  })();

})();
