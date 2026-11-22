// Site menus: the main navigation (desktop and phone) and the footer link columns, as data.
//
// The header and footer partials stay the source of the design. `readMenus` turns their current menus into a model
// (AFCD Studio uses it to start the menu editor), and `renderMenus` writes a model back into the same markup.
// build.mjs applies a model only when src/data/menu.json exists, so without it every page builds exactly as before.
// Only the menus change: logo, top bar, language switcher, contact column and scripts stay as the partials have them.
//
// Model (menu.json):
// { version: 1, revision, header: { items: Item[], cta: { label, href }, phoneExtra: Link[] }, footer: { columns: Column[] } }
// Item = { label, href?, key, panel?: { title, text, all: Link, links: PanelLink[], feature: { photo, kicker, title, href },
//          prompt, pills: Link[] }, phone: Link[] }      (a panel makes it a dropdown; key highlights it on its pages)
// PanelLink = { title, desc, href, dot? }   Link = { label, href }   Column = { title, links: { label, href, dot? }[] }
import { closeIndex } from './page-fields.mjs';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const text = (html) => unesc(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
const attr = (tag, name) => unesc((tag.match(new RegExp(`\\s${name}="([^"]*)"`)) || [])[1] ?? '');
const two = (n) => String(n).padStart(2, '0');
const slug = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'menu';

/** The element that starts at `i` (an opening tag of `tag`), with its full outer HTML and end index. */
function element(html, i, tag) {
  const openEnd = html.indexOf('>', i) + 1;
  const close = closeIndex(html, tag, openEnd);
  const end = close + `</${tag}>`.length;
  return { open: html.slice(i, openEnd), inner: html.slice(openEnd, close), outer: html.slice(i, end), start: i, end, innerStart: openEnd, innerEnd: close };
}
function find(html, re, tag, from = 0) { re.lastIndex = from; const m = re.exec(html); return m ? element(html, m.index, tag) : null; }
function children(inner, tag) {       // top-level <tag> elements inside a fragment
  const out = []; const re = new RegExp(`<${tag}\\b`, 'gi'); let m;
  while ((m = re.exec(inner))) { const el = element(inner, m.index, tag); out.push(el); re.lastIndex = el.end; }
  return out;
}

// ---------------------------------------------------------------- read the partials into a model
export function readMenus(headerHtml, footerHtml) {
  const ul = find(headerHtml, /<ul\b[^>]*id="desk-nav"/g, 'ul');
  if (!ul) throw new Error('header.html: no <ul id="desk-nav">');
  const drawerNav = find(headerHtml, /<nav\b[^>]*aria-label="Mobile"/g, 'nav');
  const phoneBlocks = drawerNav ? phoneParts(drawerNav.inner) : [];
  const items = children(ul.inner, 'li').map((li) => {
    const key = (li.inner.match(/\{\{cur:([a-z]+)\}\}/) || [])[1] ?? 'none';
    if (!/class="dd\b/.test(li.open)) {
      const a = li.inner.match(/<a\b[^>]*>/)[0];
      return { label: text(li.inner), href: attr(a, 'href'), key, phone: [] };
    }
    const btn = li.inner.match(/<button\b[^>]*>([\s\S]*?)<\/button>/);
    const label = text(btn[1]);
    const intro = find(li.inner, /<div class="mm-intro\b/g, 'div');
    const ps = [...intro.inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]);
    const allA = intro.inner.match(/<a\b[^>]*class="mm-intro-link"[^>]*>([\s\S]*?)<\/a>/);
    const list = find(li.inner, /<ul class="col-span-6/g, 'ul');
    const links = children(list.inner, 'li').map((x) => {
      const a = x.inner.match(/<a\b[^>]*>/)[0];
      const dot = (x.inner.match(/mm-dot style=["']?--c:(#[0-9A-Fa-f]{3,8})/) || [])[1];
      return { title: text((x.inner.match(/<span class="mm-title">([\s\S]*?)<\/span>/) || [])[1] ?? ''), desc: text((x.inner.match(/<span class="mm-desc">([\s\S]*?)<\/span>/) || [])[1] ?? ''), href: attr(a, 'href'), ...(dot ? { dot } : {}) };
    });
    const feat = find(li.inner, /<a class="mm-feat\b/g, 'a');
    const fps = feat ? [...feat.inner.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]) : [];
    const photo = feat ? text((feat.inner.match(/<span class="ph-cap"[^>]*>([\s\S]*?)<\/span>/) || [])[1] ?? '').replace(/^Photo\s*·\s*/, '') : '';
    const bar = li.inner.match(/<span class="text-ink-mid">([\s\S]*?)<\/span>\s*<span class="flex items-center gap-2">([\s\S]*?)<\/span>\s*<\/div>/);
    const pills = bar ? [...bar[2].matchAll(/<a class="mm-pill" href="([^"]*)">([\s\S]*?)<\/a>/g)].map((m) => ({ label: text(m[2]).replace(/\s*↗$/, ''), href: unesc(m[1]) })) : [];
    const phone = (phoneBlocks.find((b) => b.label === label)?.links) ?? links.map((l) => ({ label: l.title, href: l.href }));
    return {
      label, key, phone, id: attr(btn[0].match(/<button\b[^>]*>/)[0], 'aria-controls'),
      panel: { title: text(ps[1] ?? ''), text: text(ps[2] ?? ''), all: allA ? { label: text(allA[1]).replace(/\s*↗$/, ''), href: attr(allA[0], 'href') } : { label: '', href: '' },
        links, feature: feat ? { photo, kicker: text(fps[0] ?? ''), title: text(fps[1] ?? '').replace(/\s*↗$/, ''), href: attr(feat.open, 'href') } : null,
        prompt: bar ? text(bar[1]) : '', pills },
    };
  });
  const cta = headerHtml.match(/<a href="([^"]*)" class="nav-cta\b[^"]*">([\s\S]*?)<\/a>/);
  const deskHrefs = new Set(items.filter((i) => !i.panel).map((i) => i.href));
  const phoneExtra = phoneBlocks.filter((b) => !b.links && !deskHrefs.has(b.href)).map((b) => ({ label: b.label, href: b.href }));
  return {
    version: 1,
    header: { items, cta: cta ? { label: text(cta[2]).replace(/\s*↗$/, ''), href: unesc(cta[1]) } : { label: '', href: '' }, phoneExtra },
    footer: { columns: readFooter(footerHtml) },
  };
}
function phoneParts(inner) {   // drawer: plain links and accordions, in order (the staff login link is not a menu item)
  const out = []; const re = /<a href="([^"]*)" class="m-link flex[^"]*"[^>]*>([\s\S]*?)<\/a>|<div class="border-b border-ink-light">([\s\S]*?)<\/div>\s*<\/div>/g; let m;
  while ((m = re.exec(inner))) {
    if (m[1] !== undefined) { if (!/data-studio-login/.test(m[0])) out.push({ label: text(m[2]), href: unesc(m[1]) }); continue; }
    const label = text((m[3].match(/<button\b[^>]*>([\s\S]*?)<span/) || [])[1] ?? '');
    const links = [...m[3].matchAll(/<a class="m-link block py-2\.5" href="([^"]*)">([\s\S]*?)<\/a>/g)].map((x) => ({ label: text(x[2]), href: unesc(x[1]) }));
    out.push({ label, links });
  }
  return out;
}
function readFooter(html) {
  const panel = find(html, /<div class="ft-panel\b/g, 'div'); if (!panel) return [];
  return children(panel.inner, 'nav').filter((n) => /class="ft-col"/.test(n.open)).map((n) => ({
    aria: attr(n.open, 'aria-label'),
    title: text((n.inner.match(/<p class="ft-head"><span>[^<]*<\/span>([\s\S]*?)<\/p>/) || [])[1] ?? ''),
    links: [...n.inner.matchAll(/<a href="([^"]*)" class="ft-link">([\s\S]*?)<\/a>/g)].map((x) => {
      const dot = (x[2].match(/ft-dot-p" style="--c:(#[0-9A-Fa-f]{3,8})/) || [])[1];
      return { label: text(x[2]).replace(/\s*↗$/, ''), href: unesc(x[1]), ...(dot ? { dot } : {}) };
    }),
  }));
}

// ---------------------------------------------------------------- render a model into the partials
const ARR = '<svg class="mm-arr h-4 w-4 shrink-0 rtl:-scale-x-100" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4"/></svg>';
const CHEV = '<svg class="dd-chev h-3 w-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';
const cur = (key) => (key && key !== 'none' ? `{{cur:${key}}}` : '');
const aria = (key) => (key && key !== 'none' ? `{{aria:${key}}}` : '');

function deskItem(it, n) {
  if (!it.panel) return `        <li class="flex"><a href="${esc(it.href)}" class="nav-a nav-item flex items-center px-3 text-ink-dark hover:text-ink-pure ${cur(it.key)}"${aria(it.key)}>${esc(it.label)}</a></li>`;
  const p = it.panel; const id = /^dd-[a-z0-9-]+$/.test(it.id ?? '') ? it.id : `dd-${slug(it.label)}`;
  const links = p.links.map((l, i) => `<li><a class="mm-link group" href="${esc(l.href)}"><span class="mm-badge" aria-hidden="true">${l.dot ? `<span class=mm-dot style=--c:${esc(l.dot)}></span>` : two(i + 1)}</span><span class="min-w-0 flex-1"><span class="mm-title">${esc(l.title)}</span><span class="mm-desc">${esc(l.desc)}</span></span>${ARR}</a></li>`).join('');
  const f = p.feature;
  return `        <li class="dd flex">
          <button class="dd-btn nav-item flex items-center gap-1.5 px-3 text-ink-dark hover:text-ink-pure ${cur(it.key)}" aria-expanded="false" aria-controls="${id}">${esc(it.label)} ${CHEV}</button>
          <div id="${id}" class="dd-panel mega absolute inset-x-0 top-full whitespace-normal border-b border-ink-light bg-white text-[15px]" role="region" aria-label="${esc(it.label)}">
            <div class="wrap grid grid-cols-12 gap-5 py-6">
              <div class="mm-intro col-span-3">
                <p class="label text-ink-mid">${two(n)} / ${esc(it.label)}</p>
                <p class="mt-3 text-[24px] font-semibold leading-[1.08] tracking-[-0.035em]" style="text-wrap:balance">${esc(p.title)}</p>
                <p class="mt-2 text-[13.5px] leading-relaxed text-ink-dark">${esc(p.text)}</p>
${p.all?.label && p.all?.href ? `                <a class="mm-intro-link" href="${esc(p.all.href)}">${esc(p.all.label)} <span aria-hidden="true">↗</span></a>\n` : ''}              </div>
              <ul class="col-span-6 grid grid-cols-2 content-start gap-2">${links}</ul>
${f && f.href ? `              <a class="mm-feat group col-span-3" href="${esc(f.href)}">
                <div class="ph aspect-[16/9] w-full rounded-xl" style="--ph:#DADADA"><span class="ph-cap" style="font-size:9.5px"><b>Photo</b> · ${esc(f.photo || f.title)}</span></div>
                <p class="label mt-3 text-ink-mid">${esc(f.kicker)}</p>
                <p class="mt-1.5 flex items-start justify-between gap-3 text-[15px] font-medium leading-snug tracking-[-0.01em]">${esc(f.title)}<span class="mm-feat-arr shrink-0" aria-hidden="true">↗</span></p>
              </a>
` : ''}            </div>
${p.pills?.length ? `            <div class="border-t border-ink-light bg-ink-off">
              <div class="wrap flex h-12 items-center justify-between gap-4 text-[13px]">
                <span class="text-ink-mid">${esc(p.prompt)}</span>
                <span class="flex items-center gap-2">${p.pills.map((x) => `<a class="mm-pill" href="${esc(x.href)}">${esc(x.label)} ↗</a>`).join('')}</span>
              </div>
            </div>
` : ''}          </div>
        </li>`;
}
function phoneNav(m, keep) {
  const row = (l) => `    <a href="${esc(l.href)}" class="m-link flex min-h-[56px] items-center border-b border-ink-light font-medium">${esc(l.label)}</a>`;
  const acc = (it) => `    <div class="border-b border-ink-light">
      <button class="m-acc flex min-h-[56px] w-full items-center justify-between font-medium" aria-expanded="false">${esc(it.label)} <span class="m-plus text-xl font-light" aria-hidden="true">+</span></button>
      <div class="m-panel hidden pb-3 text-[15px] text-ink-dark">
        ${(it.phone?.length ? it.phone : it.panel.links.map((l) => ({ label: l.title, href: l.href }))).map((l) => `<a class="m-link block py-2.5" href="${esc(l.href)}">${esc(l.label)}</a>`).join('')}
      </div>
    </div>`;
  return '\n' + [...m.header.items.map((it) => (it.panel ? acc(it) : row(it))), ...(m.header.phoneExtra ?? []).map(row), ...keep].join('\n') + '\n  ';
}
function footerCols(m) {
  return m.footer.columns.map((c, i) => `        <nav class="ft-col" aria-label="${esc(c.aria || c.title)}">
          <p class="ft-head"><span>${two(i + 1)}</span>${esc(c.title)}</p>
          <ul>${c.links.map((l) => `<li><a href="${esc(l.href)}" class="ft-link">${l.dot ? `<span class="ft-dot-p" style="--c:${esc(l.dot)}"></span><span>${esc(l.label)}</span>` : `<span>${esc(l.label)}</span><span class="ft-link-arr" aria-hidden="true">↗</span>`}</a></li>`).join('')}</ul>
        </nav>`).join('\n');
}

/** header.html and footer.html with the model's menus. Everything outside the menus is left exactly as it is. */
export function renderMenus(headerHtml, footerHtml, m) {
  let header = headerHtml;
  const ul = find(header, /<ul\b[^>]*id="desk-nav"/g, 'ul');
  header = header.slice(0, ul.innerStart) + '\n' + m.header.items.map((it, i) => deskItem(it, m.header.items.slice(0, i + 1).filter((x) => x.panel).length)).join('\n') + '\n      ' + header.slice(ul.innerEnd);
  if (m.header.cta?.label && m.header.cta?.href) {
    header = header.replace(/<a href="[^"]*" class="nav-cta\b([^"]*)">[\s\S]*?<\/a>/, (_, cls) => `<a href="${esc(m.header.cta.href)}" class="nav-cta${cls}">${esc(m.header.cta.label)} <span class="nav-cta-ico" aria-hidden="true">↗</span></a>`)
      .replace(/<a href="[^"]*" class="m-link btn-dark w-full">[\s\S]*?<\/a>/, `<a href="${esc(m.header.cta.href)}" class="m-link btn-dark w-full">${esc(m.header.cta.label)}</a>`);
  }
  const nav = find(header, /<nav\b[^>]*aria-label="Mobile"/g, 'nav');
  if (nav) {
    const keep = (nav.inner.match(/^\s*<a href="#"[^>]*data-studio-login[\s\S]*?<\/a>/m) || []).map((s) => s.replace(/^\n+/, ''));
    header = header.slice(0, nav.innerStart) + phoneNav(m, keep) + header.slice(nav.innerEnd);
  }
  let footer = footerHtml;
  const panel = find(footer, /<div class="ft-panel\b/g, 'div');
  if (panel && m.footer?.columns?.length) {
    const cols = children(panel.inner, 'nav').filter((n) => /class="ft-col"/.test(n.open));
    if (cols.length) {
      const a = panel.innerStart + cols[0].start, b = panel.innerStart + cols[cols.length - 1].end;
      const lead = footer.slice(footer.lastIndexOf('\n', a) + 1, a);
      footer = footer.slice(0, a - lead.length) + footerCols(m) + footer.slice(b);
    }
  }
  return { header, footer };
}

/** Every link in a model, with where it sits (for checks in Studio). */
export function menuLinks(m) {
  const out = [];
  m.header.items.forEach((it, i) => {
    if (!it.panel) out.push({ where: `Main menu · ${it.label}`, href: it.href });
    else {
      if (it.panel.all?.href) out.push({ where: `${it.label} · “${it.panel.all.label}”`, href: it.panel.all.href });
      it.panel.links.forEach((l) => out.push({ where: `${it.label} · ${l.title}`, href: l.href }));
      if (it.panel.feature?.href) out.push({ where: `${it.label} · featured card`, href: it.panel.feature.href });
      (it.panel.pills ?? []).forEach((l) => out.push({ where: `${it.label} · ${l.label}`, href: l.href }));
      (it.phone ?? []).forEach((l) => out.push({ where: `Phone menu · ${it.label} · ${l.label}`, href: l.href }));
    }
    void i;
  });
  if (m.header.cta?.href) out.push({ where: 'Main button', href: m.header.cta.href });
  (m.header.phoneExtra ?? []).forEach((l) => out.push({ where: `Phone menu · ${l.label}`, href: l.href }));
  m.footer.columns.forEach((c) => c.links.forEach((l) => out.push({ where: `Footer · ${c.title} · ${l.label}`, href: l.href })));
  return out;
}
