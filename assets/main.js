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

  /* ---------- Desktop dropdowns ---------- */
  var dds = $$('.dd');
  function closeAll(except) { dds.forEach(function (d) { if (d !== except) { d.classList.remove('open'); $('.dd-btn', d).setAttribute('aria-expanded', 'false'); } }); }
  dds.forEach(function (dd) {
    var btn = $('.dd-btn', dd), hoverT;
    function open() { closeAll(dd); dd.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); }
    function close() { dd.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function () { dd.classList.contains('open') ? close() : open(); });
    dd.addEventListener('mouseenter', function () { clearTimeout(hoverT); open(); });
    dd.addEventListener('mouseleave', function () { hoverT = setTimeout(close, 120); });
    dd.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); btn.focus(); }
      if (e.key === 'ArrowDown') { e.preventDefault(); if (!dd.classList.contains('open')) open(); var links = $$('a', dd); var i = links.indexOf(document.activeElement); (links[i + 1] || links[0]).focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); var l = $$('a', dd); var j = l.indexOf(document.activeElement); (l[j - 1] || l[l.length - 1]).focus(); }
    });
    dd.addEventListener('focusout', function (e) { if (!dd.contains(e.relatedTarget)) close(); });
    $$('a', dd).forEach(function (a) { a.addEventListener('click', close); });
  });
  document.addEventListener('click', function (e) { if (!e.target.closest('.dd')) closeAll(); });

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
  window.addEventListener('resize', function () { if (window.innerWidth >= 1024 && drawer.classList.contains('open')) closeDrawer(false); });

  /* ---------- Language (wireframe behaviour) ---------- */
  $$('.lang-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var lang = b.dataset.lang;
      if (lang === 'fr') { toast('The French version is built in Stage 4 with real translated content.'); return; }
      var rtl = lang === 'ar';
      doc.setAttribute('dir', rtl ? 'rtl' : 'ltr');
      $$('.lang-btn').forEach(function (x) {
        var on = x.dataset.lang === lang; x.setAttribute('aria-pressed', String(on));
        if (x.closest('#drawer')) { x.classList.toggle('bg-ink-pure', on); x.classList.toggle('text-white', on); x.classList.toggle('border-ink-pure', on); x.classList.toggle('border-ink-light', !on); }
        else { x.classList.toggle('text-white', on); x.classList.toggle('text-white/50', !on); }
      });
      toast(rtl ? 'RTL layout preview. Arabic copy comes in Stage 4; logos and photos are not mirrored.' : 'Back to English, left to right.');
      layoutStack();
    });
  });

  /* ---------- Notes toggle ---------- */
  var nt = $('#notes-toggle');
  nt.addEventListener('click', function () {
    var on = document.body.classList.toggle('show-notes');
    nt.setAttribute('aria-pressed', String(on)); nt.textContent = on ? 'Hide notes' : 'Show notes';
    nt.classList.toggle('bg-ink-pure', on); nt.classList.toggle('text-white', on); nt.classList.toggle('bg-white', !on);
  });

  /* ---------- Hero slider ---------- */
  (function () {
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

  /* ---------- Wording toggle ---------- */
  $$('.wording-btn').forEach(function (b) {
    b.addEventListener('click', function () {
      var w = b.dataset.w;
      $$('.wording-btn').forEach(function (x) { var on = x === b; x.setAttribute('aria-pressed', String(on)); x.classList.toggle('bg-ink-pure', on); x.classList.toggle('text-white', on); x.classList.toggle('border-ink-pure', on); x.classList.toggle('border-ink-light', !on); });
      $$('[data-proposed]').forEach(function (p) { p.textContent = p.dataset[w]; });
      $('#wording-flag').textContent = w === 'official' ? 'Official wording as published on afcdfoundation.org.' : 'Proposed editorial summary. To approve against AFCD’s official texts.';
    });
  });

  /* ---------- Pillars ---------- */
  var PILLARS = [
    { n: '01', t: 'Youth Empowerment', d: 'Developing leadership, civic participation, entrepreneurship and skills among young people.', photo: 'youth-empowerment-scaled.jpg', tone: '#BDBDBD', link: '/our-pillars/youth-empowerment/', related: 'Leadership Lab 2.0 · Youth First Academy · Let’s Dialogue' },
    { n: '02', t: 'Women Empowerment', d: 'Supporting economic opportunities, entrepreneurship, leadership and inclusion for women.', photo: 'woman-empowerment-scaled.jpg', tone: '#A3A3A3', link: '/our-pillars/women-empowerment/', related: 'META Skills for Women Empowerment · TOT: Gender-based violence' },
    { n: '03', t: 'Green Thumbs', d: 'Promoting environmental education, climate action and sustainable communities.', photo: 'environment-scaled.jpg', tone: '#C8C8C8', link: '/our-pillars/green-thumbs/', related: 'Eco Citizen · Oxygen · Al Haouz Environmental Film Festival' },
    { n: '04', t: 'Digital Empowerment', d: 'Expanding access to digital knowledge, technology, innovation and learning.', photo: 'digital-scaled.jpg', tone: '#B0B0B0', link: '/our-pillars/digital-empowerment/', related: 'SAADA Initiative Project' }
  ];
  var pList = $('#pillar-list'), pStage = $('#pillar-stage'), pDetail = $('#pillar-detail'), pCur = 0;
  function phHTML(p, extra) { return '<div class="ph ' + (extra || '') + '" style="--ph:' + p.tone + '"><span class="ph-cap"><b>Photo</b> · ' + p.photo + ' · afcdfoundation.org</span></div>'; }
  function detailHTML(p) {
    return '<p class="body text-ink-charcoal">' + p.d + '</p>' +
      '<p class="mt-4 text-sm text-ink-mid"><span class="label mr-2 text-ink-dark">Projects</span>' + p.related + '</p>' +
      '<a href="#projects" class="link-arrow mt-6">Explore ' + p.t + ' <span class="arr" aria-hidden="true">↗</span></a>';
  }
  PILLARS.forEach(function (p, i) {
    pStage.insertAdjacentHTML('beforeend', '<div class="pillar-img absolute inset-0 ' + (i === 0 ? 'active' : '') + '">' + phHTML(p, 'h-full w-full') + '<span class="absolute right-4 top-4 z-[1] text-[80px] font-semibold leading-none tracking-tightest text-white/70 tabular-nums">' + p.n + '</span></div>');
    var row = document.createElement('div');
    row.className = 'border-t border-ink-light';
    row.innerHTML =
      '<button role="tab" id="ptab-' + i + '" aria-controls="pillar-detail" aria-selected="' + (i === 0) + '" tabindex="' + (i === 0 ? 0 : -1) + '" class="pillar-row relative flex w-full items-center gap-5 py-6 text-left rtl:text-right md:gap-8 lg:py-7">' +
        '<span class="w-8 shrink-0 text-sm tabular-nums text-ink-mid">' + p.n + '</span>' +
        '<span class="pillar-title flex-1 text-2xl md:text-[34px] font-semibold tracking-[-0.035em] leading-[1.05] transition-colors duration-300">' + p.t + '</span>' +
        '<svg class="pillar-arr h-5 w-5 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5"/></svg>' +
      '</button>' +
      '<div class="pillar-m lg:hidden ' + (i === 0 ? '' : 'hidden') + ' pb-8">' + phHTML(p, 'aspect-[4/3] w-full') + '<div class="mt-5">' + detailHTML(p) + '</div></div>';
    pList.appendChild(row);
  });
  var tabs = $$('[role="tab"]', pList);
  function setPillar(i, focus) {
    pCur = i;
    tabs.forEach(function (t, k) { var on = k === i; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; });
    $$('.pillar-img', pStage).forEach(function (im, k) { im.classList.toggle('active', k === i); });
    $$('.pillar-m', pList).forEach(function (m, k) { m.classList.toggle('hidden', k !== i); });
    pDetail.innerHTML = '<div class="pt-8"><p class="label text-ink-mid">' + PILLARS[i].n + ' — Selected pillar</p><h3 class="h3 mt-3">' + PILLARS[i].t + '</h3><div class="mt-4">' + detailHTML(PILLARS[i]) + '</div></div>';
    pDetail.setAttribute('aria-labelledby', 'ptab-' + i);
    if (focus) tabs[i].focus();
  }
  tabs.forEach(function (t, i) {
    t.addEventListener('click', function () { setPillar(i); });
    t.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setPillar((pCur + 1) % 4, true); }
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setPillar((pCur + 3) % 4, true); }
      if (e.key === 'Home') { e.preventDefault(); setPillar(0, true); }
      if (e.key === 'End') { e.preventDefault(); setPillar(3, true); }
    });
  });
  setPillar(0);
  $$('[data-goto-pillar]').forEach(function (a) { a.addEventListener('click', function () { setPillar(+a.dataset.gotoPillar); }); });

  /* ---------- Stacked projects ---------- */
  var TODO = '<span class="tag-todo ml-1 align-middle">To fill</span>';
  var PROJECTS = [
    { n: '01', name: 'Leadership Lab 2.0', pillar: 'Youth Empowerment', cat: 'Youth Leadership', surface: 'bg-white text-ink', phTone: '#D4D4D4', dark: false,
      photo: 'Leadership Lab 2.0 · project page photo',
      lede: 'Supporting emerging leaders through entrepreneurship and civic engagement.',
      rows: [
        ['Context', 'A large youth population in Morocco is turning to entrepreneurship, and attitudes toward innovation and risk-taking are shifting.'],
        ['Approach', 'Adapts practices from the U.S. entrepreneurial system and principles of participatory democracy.'],
        ['Activities', 'Year-long civic engagement and entrepreneurship training tracks for selected young people.'],
        ['Results', 'Participant stories on the AFCD blog (2023). Verified outcomes ' + TODO]
      ] },
    { n: '02', name: 'Eco Citizen', pillar: 'Green Thumbs', cat: 'Environment', surface: 'bg-ink-light text-ink', phTone: '#A3A3A3', dark: false,
      photo: 'Eco Citizen · Ait Ourir 2021',
      lede: 'Encouraging environmental awareness and community-led action.',
      rows: [
        ['Context', 'Residents and decision-makers in Ait Ourir describe household waste management as a persistent problem.'],
        ['Approach', 'A participatory process bringing residents, local NGOs and elected representatives together.'],
        ['Activities', 'Awareness campaigns (2020), then workshops on waste sorting and recycling and training for new local committees (2021).'],
        ['Results', 'Alternative waste-management proposals developed with the community. Figures ' + TODO]
      ] },
    { n: '03', name: 'Youth Green Generation', pillar: 'Green Thumbs', cat: 'Climate Action', surface: 'bg-ink-charcoal text-white on-dark', phTone: '#404040', dark: true,
      photo: 'call-for-application.jpg · 2024 call',
      lede: 'Supporting young people in developing responses to climate challenges.',
      rows: [
        ['Context', 'Builds on AFCD’s earlier climate projects, locally and nationally (blog, November 2023).'],
        ['Approach', 'Empowering youth to tackle climate change. Detail ' + TODO],
        ['Activities', 'Call for applications for the 2024 cohort. Programme ' + TODO],
        ['Results', 'Intended contributions ' + TODO]
      ] }
  ];
  var stack = $('#stack'), dotsWrap = $('#stack-dots'), sCur = 0;
  PROJECTS.forEach(function (p, i) {
    var card = document.createElement('article');
    card.className = 'pcard ' + p.surface + ' border ' + (p.dark ? 'border-white/10' : 'border-ink-light');
    card.setAttribute('aria-roledescription', 'project card');
    card.setAttribute('aria-label', p.name);
    var muted = p.dark ? 'text-white/60' : 'text-ink-mid';
    var rule = p.dark ? 'border-white/15' : 'border-ink-light';
    card.innerHTML =
      '<button class="pcard-spine pcard-spine-btn pointer-events-none absolute inset-y-0 right-0 z-[2] flex w-[14.1%] flex-col justify-between p-5 text-left rtl:left-0 rtl:right-auto rtl:text-right" aria-label="Show project ' + p.n + ': ' + p.name + '" tabindex="-1">' +
        '<span class="text-sm tabular-nums ' + muted + '">' + p.n + '</span>' +
        '<span class="block origin-bottom-left text-lg font-semibold tracking-[-0.02em] [writing-mode:vertical-rl] rotate-180 self-start">' + p.name + '</span>' +
        '<span class="text-lg" aria-hidden="true">↗</span>' +
      '</button>' +
      '<div class="pcard-body flex h-full flex-col p-5 md:p-8 lg:p-10">' +
        '<header class="flex flex-wrap items-start justify-between gap-4 border-b ' + rule + ' pb-5">' +
          '<div class="flex items-baseline gap-4 md:gap-6"><span class="text-sm tabular-nums ' + muted + '">' + p.n + '</span><h3 class="text-[26px] md:text-[36px] font-semibold leading-[1.05] tracking-[-0.035em]">' + p.name + '</h3></div>' +
          '<div class="flex flex-wrap items-center gap-2"><span class="label border ' + rule + ' px-2.5 py-1.5">' + p.pillar + '</span><span class="label ' + muted + ' px-1">' + p.cat + '</span></div>' +
        '</header>' +
        '<div class="mt-6 grid min-h-0 flex-1 gap-6 md:grid-cols-12 md:gap-8">' +
          '<div class="ph ' + (p.dark ? 'is-dark' : '') + ' aspect-[4/3] md:col-span-6 md:aspect-auto md:h-full" style="--ph:' + p.phTone + '"><span class="ph-cap"><b>Photo</b> · ' + p.photo + '</span></div>' +
          '<div class="flex min-w-0 flex-col md:col-span-6">' +
            '<p class="text-lg md:text-xl leading-snug tracking-[-0.01em]">' + p.lede + '</p>' +
            '<dl class="mt-5 text-sm leading-relaxed">' + p.rows.map(function (r) {
              return '<div class="grid grid-cols-[92px_1fr] gap-3 border-t ' + rule + ' py-3"><dt class="label pt-0.5 ' + muted + '">' + r[0] + '</dt><dd>' + r[1] + '</dd></div>';
            }).join('') + '</dl>' +
            '<a href="#projects" class="link-arrow mt-auto self-start pt-5">Explore Project <span class="arr" aria-hidden="true">↗</span></a>' +
          '</div>' +
        '</div>' +
      '</div>';
    stack.appendChild(card);
    $('.pcard-spine-btn', card).addEventListener('click', function () { setStack(i); });
    var dot = document.createElement('button');
    dot.className = 'stack-dot h-11 px-1'; dot.setAttribute('aria-label', 'Project ' + p.n + ': ' + p.name);
    dot.innerHTML = '<span class="block h-[3px] w-8 bg-ink-light transition-colors"></span>';
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

  /* ---------- Partners ---------- */
  var GROUPS = [
    ['International', ['World Denver', 'Danish Youth Council', 'Embassy of Switzerland in Morocco', 'U.S. Embassy Morocco', 'Embassy of France in Morocco', 'Service Civil International (Germany)', 'Plugged In Band Program', 'Rebild Ungdomsskole', 'MapWorks Learning']],
    ['National', ['High Atlas Foundation', 'Heinrich Böll Stiftung Rabat', 'Moroccan Institute for Policy Analysis', 'Dar America Casablanca', 'Anoual Association', 'International Youth Council Morocco', 'Student Voice', 'Y-PEER PETRI Morocco']],
    ['Local', ['Commune of Ait Ourir']]
  ];
  var pg = $('#partner-groups');
  GROUPS.forEach(function (g) {
    var cells = g[1].map(function (name) {
      return '<li class="group flex min-h-[132px] flex-col justify-between border-b border-r border-ink-light bg-white p-4 md:min-h-[150px] md:p-5">' +
        '<span class="grid h-14 place-items-center"><span class="grid h-full w-[72%] max-w-[150px] place-items-center border border-dashed border-ink-light text-[10px] uppercase tracking-[0.12em] text-ink-mid transition-colors group-hover:border-ink-mid">Logo</span></span>' +
        '<span class="mt-3 text-[13px] leading-snug text-ink-dark">' + name + '</span></li>';
    }).join('');
    pg.insertAdjacentHTML('beforeend',
      '<div class="grid gap-4 border-t border-ink-light py-8 lg:grid-cols-12 lg:gap-8">' +
        '<div class="lg:col-span-2"><p class="label">' + g[0] + '</p><p class="mt-1 text-xs tabular-nums text-ink-mid">' + g[1].length + (g[1].length === 1 ? ' partner' : ' partners') + '</p></div>' +
        '<ul class="grid grid-cols-2 border-l border-t border-ink-light sm:grid-cols-3 lg:col-span-10 lg:grid-cols-5 rtl:border-l-0 rtl:border-r">' + cells + '</ul>' +
      '</div>');
  });

})();
