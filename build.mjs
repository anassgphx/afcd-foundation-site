// Assembles the static pages: src/pages/*.html + shared partials -> ./<page>.html
// Each page starts with a small front-matter block:
//   ---
//   title: Page title
//   description: Meta description
//   active: home | about | pillars | projects | news | events | partners | contact | involved
//   ---
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderPage, closeIndex } from './lib/page-fields.mjs';
import { activeLangs, decorateEnglish, buildLanguages } from './lib/i18n.mjs';
import { renderMenus } from './lib/menu.mjs';
import { loadSiteSettings, applyHead, applyPage, applyOrg } from './lib/site-settings.mjs';
import { pillarStems, prettifyHtml, prettifyAbsolute } from './lib/urls.mjs';
import { execSync } from 'node:child_process';

const SRC = 'src';
const partial = (name) => readFileSync(join(SRC, 'partials', `${name}.html`), 'utf8');

// Cache-busting: a short content hash on the CSS/JS links, so browsers and GitHub Pages
// visitors always load the latest build. Run after the CSS is compiled (see npm run build).
const version = (file) => createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8);
const CSS_V = version('assets/styles.css');
const JS_V = version('assets/main.js');

// Studio website settings (owned by AFCD Studio → Settings): src/data/site-settings.json, or env SITE_SETTINGS_JSON. See
// lib/site-settings.mjs. Without it the site builds exactly as written.
const SETTINGS = loadSiteSettings(process.env.SITE_SETTINGS_JSON || join(SRC, 'data', 'site-settings.json'));
const head0 = partial('head').replace('href="assets/styles.css"', `href="assets/styles.css?v=${CSS_V}"`);
const head = SETTINGS ? applyHead(head0, SETTINGS) : head0;
// Studio menus (owned by AFCD Studio): src/data/menu.json, or env MENU_JSON, replaces the main, phone and footer menus of the
// partials (see lib/menu.mjs). Without it the partials are used exactly as written.
const MENU_FILE = process.env.MENU_JSON || join(SRC, 'data', 'menu.json');
const MENU = existsSync(MENU_FILE) ? JSON.parse(readFileSync(MENU_FILE, 'utf8')) : null;
const menus = MENU ? renderMenus(partial('header'), partial('footer'), MENU) : null;
const headerBase = menus ? menus.header : partial('header');
const footer = menus ? menus.footer : partial('footer');

// Projects menu: a "Projects by pillar" row in the Projects dropdown and a "By pillar" list in its phone panel, from the
// published data (src/data/pillars.json and src/data/projects.json, written by AFCD Studio). It is added after the Studio
// menu (if any) is applied, so it follows pillar and project changes. Without the data files the header is used as written.
function withPillarProjects(html) {
  const pf = join(SRC, 'data', 'pillars.json'), jf = join(SRC, 'data', 'projects.json');
  if (!existsSync(pf) || !existsSync(jf)) return html;
  const pillars = [...(JSON.parse(readFileSync(pf, 'utf8')).pillars ?? [])].sort((a, b) => String(a.number).localeCompare(String(b.number)));
  const projects = JSON.parse(readFileSync(jf, 'utf8')).projects ?? [];
  if (!pillars.length) return html;
  // Studio writes these files already HTML-escaped ("Youth Empowerment &amp; Civic Engagement"), so existing entities are
  // kept as they are (escapeAttr), and only a stray <, >, & or " is escaped. escapeText would turn &amp; into &amp;amp;.
  const e = (s) => escapeAttr(String(s ?? '').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
  const colour = (c) => (/^#[0-9a-f]{3,8}$/i.test(c ?? '') ? c : '#E5E5E5');
  const listOf = (key) => `projects.html?pillar=${encodeURIComponent(key)}#proj-grid`;
  const safeFile = (f) => (/^[a-z0-9-]+\.html$/.test(f ?? '') ? f : null);
  const MAX = 4;
  const cols = pillars.map((p) => {
    const mine = projects.filter((x) => x.pillar === p.key);
    const items = mine.slice(0, MAX).map((x) => `<li><a href="${e(safeFile(x.file) ?? listOf(p.key))}">${e(x.name)}</a></li>`).join('');
    const more = mine.length > MAX ? `<li><a class="mm-pp-more" href="${e(listOf(p.key))}">+${mine.length - MAX} more</a></li>` : '';
    return `<div class="mm-pp-col" style="--c:${colour(p.colour)}"><a class="mm-pp-head" href="${e(safeFile(p.file) ?? listOf(p.key))}"><span class="mm-dot" aria-hidden="true"></span><span class="mm-pp-name">${e(p.name)}</span><span class="mm-pp-n" title="${mine.length} project${mine.length === 1 ? '' : 's'}">${mine.length}</span></a>`
      + `<ul class="mm-pp-list">${items || '<li class="mm-pp-none">No projects yet</li>'}${more}</ul></div>`;
  }).join('');
  const block = `<div class="wrap mm-pp" aria-label="Projects by pillar"><p class="mm-pp-h">Projects by pillar</p><div class="mm-pp-grid">${cols}</div></div>\n            `;
  let out = html;
  const at = out.indexOf('id="dd-projects"');
  if (at >= 0) {   // desktop: just above the prompt bar at the bottom of the Projects dropdown
    const openEnd = out.indexOf('>', at) + 1, end = closeIndex(out, 'div', openEnd);
    const bar = out.indexOf('<div class="border-t border-ink-light bg-ink-off">', openEnd);
    const pos = bar > 0 && bar < end ? bar : end;
    out = out.slice(0, pos) + block + out.slice(pos);
  }
  const acc = out.search(/<button class="m-acc[^"]*"[^>]*>Projects\s*<span/);
  if (acc >= 0) {  // phone: the end of the Projects panel
    const pStart = out.indexOf('<div class="m-panel', acc);
    if (pStart > 0) {
      const openEnd = out.indexOf('>', pStart) + 1, end = closeIndex(out, 'div', openEnd);
      const phone = `<p class="m-pp-h">By pillar</p>` + pillars.map((p) => `<a class="m-link m-pp" href="${e(listOf(p.key))}" style="--c:${colour(p.colour)}"><span class="mm-dot" aria-hidden="true"></span><span>${e(p.name)}</span><span class="m-pp-n">${projects.filter((x) => x.pillar === p.key).length}</span></a>`).join('');
      out = out.slice(0, end) + phone + out.slice(end);
    }
  }
  return out;
}

const NAV = ['home', 'about', 'pillars', 'projects', 'news', 'partners', 'contact', 'involved', 'events', 'none'];
// Escapes for attributes without double-escaping entities already in the text (front matter titles may contain &amp;).
const escapeAttr = (s) => s.replace(/&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;');
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const header = withPillarProjects(headerBase);

function parse(file) {
  const raw = readFileSync(join(PAGES_DIR, file), 'utf8');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta = Object.fromEntries(
    m[1].split('\n').filter(Boolean).map((line) => {
      const i = line.indexOf(':');
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
  );
  for (const key of ['title', 'description', 'active']) {
    if (!meta[key]) throw new Error(`${file}: front matter needs "${key}"`);
  }
  return { meta, body: raw.slice(m[0].length) };
}

// {{cur:about}} -> "is-current" on the active item; {{aria:about}} -> aria-current on links
// Top-bar "Open calls" button: the Opportunities page once Studio has published one, else the programmes on Get Involved.
const OPPS_HREF = existsSync(join(SRC, 'pages', 'opportunities.html')) ? 'opportunities.html' : 'get-involved.html#programs';
// Top-bar "Publications" button, next to Open calls: only once Studio has published a publication (publications.html exists).
const PUBS_LINK = existsSync(join(SRC, 'pages', 'publications.html'))
  ? '<a class="tb-pub" href="publications.html"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2H4.5a1.2 1.2 0 0 0-1.2 1.2v9.6A1.2 1.2 0 0 0 4.5 14h7a1.2 1.2 0 0 0 1.2-1.2V5.2Z"/><path d="M9.5 2v3.2h3.2M6 8.5h4M6 11h2.5"/></svg>Publications</a>'
  : '';

function markActive(html, active) {
  return html
    .replace(/\{\{cur:([a-z]+)\}\}/g, (_, k) => (k === active ? 'is-current' : ''))
    .replace(/\{\{aria:([a-z]+)\}\}/g, (_, k) => (k === active ? ' aria-current="page"' : ''));
}

// ---------------------------------------------------------------- SEO
// Canonical production domain. Preview builds (the default, e.g. GitHub Pages) are noindex so the
// preview copy never competes with the real site. Use `npm run build:production` for afcdfoundation.com.
// Studio settings may set the canonical domain and the environment; SITE_ENV (e.g. npm run build:production) still wins.
const SITE = SETTINGS?.canonicalUrl || 'https://afcdfoundation.com/';
const PRODUCTION = process.env.SITE_ENV ? process.env.SITE_ENV === 'production' : SETTINGS?.environment === 'production';
const SITE_NAME = SETTINGS?.name || 'AFCD Foundation';
const FORMS_ENDPOINT = (process.env.FORMS_ENDPOINT || '').trim().replace(/\/+$/, '');
if (FORMS_ENDPOINT && !/^https?:\/\/[^\s"<>]+$/.test(FORMS_ENDPOINT)) throw new Error(`FORMS_ENDPOINT must be an http(s) URL, got "${FORMS_ENDPOINT}"`);
const OG_DEFAULT = SETTINGS?.socialImage ?? { src: 'assets/img/og-default.jpg', w: 1200, h: 630, alt: 'AFCD Leadership Lab panel discussion' };
const pageUrl = (file) => SITE + (file === 'index.html' ? '' : file);

// Public organization facts only (approved fields from the AFCD Connect profile).
// The full Marrakech street address is omitted until AFCD confirms it is current.
const ORG0 = {
  '@context': 'https://schema.org',
  '@type': 'NGO',
  '@id': SITE + '#organization',
  name: 'AFCD Foundation',
  alternateName: 'AFCD',
  legalName: 'Association le Futur pour les Chantiers et le Développement',
  url: SITE,
  logo: SITE + 'assets/brand/afcd-mark.png',
  description: 'To promote sustainable development by strengthening the capacities of young people and women through environmental education, economic empowerment, and innovation.',
  email: 'contact@afcdteam.com',
  telephone: '+212663618536',
  foundingDate: '2007',
  foundingLocation: { '@type': 'Place', name: 'Ait Ourir, Al Haouz, Morocco' },
  address: { '@type': 'PostalAddress', addressLocality: 'Marrakech', postalCode: '40000', addressCountry: 'MA' },
  areaServed: { '@type': 'Country', name: 'Morocco' },
  sameAs: ['https://www.facebook.com/afcd.foundation', 'https://www.instagram.com/afcd.foundation', 'https://www.linkedin.com/company/afcd-foundation'],
};
const ORG = SETTINGS ? applyOrg(ORG0, SETTINGS, SITE) : ORG0;
const WEBSITE = { '@context': 'https://schema.org', '@type': 'WebSite', '@id': SITE + '#website', name: SITE_NAME, url: SITE, inLanguage: 'en', publisher: { '@id': SITE + '#organization' } };

function breadcrumbs(file, meta) {
  if (file === 'index.html' || file === '404.html') return null;
  const items = [{ name: 'Home', url: SITE }];
  if (file.startsWith('project-')) items.push({ name: 'Projects', url: pageUrl('projects.html') });
  if (meta.parent) { const [name, href] = meta.parent.split('|'); items.push({ name, url: pageUrl(href) }); }
  items.push({ name: meta.title.split(' · ')[0], url: pageUrl(file) });
  return { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: it.url })) };
}

// Studio SEO overrides (owned by AFCD Studio): src/data/seo.json, or env SEO_JSON, sets the title, description, noindex
// and share image of template pages. Values are plain text; they are escaped here.
const SEO_FILE = process.env.SEO_JSON || join(SRC, 'data', 'seo.json');
const SEO = existsSync(SEO_FILE) ? JSON.parse(readFileSync(SEO_FILE, 'utf8')).pages ?? {} : {};
function applySeo(file, meta) {
  const o = SEO[file]; if (!o) return meta;
  if (o.title) meta.title = escapeText(o.title);
  if (o.description) meta.description = o.description;
  if (o.noindex) meta.noindex = 'true';
  if (o.image) meta.ogImage = o.image;   // { src, w, h, alt } relative to the site root
  if (o.revision) meta.seoRevision = o.revision;
  return meta;
}

// Studio page fields and homepage sections (owned by AFCD Studio): see lib/page-fields.mjs. src/data/page-fields.json (or env
// PAGE_FIELDS_JSON) holds edited values and section layouts; without it pages build exactly as written.
const FIELDS_FILE = process.env.PAGE_FIELDS_JSON || join(SRC, 'data', 'page-fields.json');
const FIELDS = existsSync(FIELDS_FILE) ? JSON.parse(readFileSync(FIELDS_FILE, 'utf8')).pages ?? {} : {};

// Studio structured data (owned by AFCD Studio): src/data/schema.json (or env SCHEMA_JSON), written only after reviewed
// settings are published, adds Organization fields to the homepage markup and Article/Event markup to Studio pages.
// Without it pages build exactly as written. Only public organization fields pass (never tax, CNSS or registration
// numbers, the legal representative or the street address), and only the foundation's public email addresses.
const SCHEMA_FILE = process.env.SCHEMA_JSON || join(SRC, 'data', 'schema.json');
const SCHEMA = existsSync(SCHEMA_FILE) ? JSON.parse(readFileSync(SCHEMA_FILE, 'utf8')) : null;
const SCHEMA_ORG_KEYS = ['alternateName', 'legalName', 'description', 'email', 'telephone', 'foundingDate', 'sameAs'];
const PUBLIC_EMAILS = ['contact@afcdteam.com', 'akaya@afcdteam.com'];
function schemaOrg() {
  const o = SCHEMA?.organization ?? {}; const out = { ...ORG };
  for (const k of SCHEMA_ORG_KEYS) if (o[k] !== undefined && o[k] !== '' && (k !== 'email' || PUBLIC_EMAILS.includes(o[k]))) out[k] = o[k];
  return out;
}
const schemaPage = (file) => (SCHEMA?.pages?.[file] ?? []).filter((x) => x && (x['@type'] === 'Article' || x['@type'] === 'Event'));
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');   // editor text can never close the script tag

function seoTags(file, meta) {
  const noindex = !PRODUCTION || meta.noindex === 'true';
  const title = escapeAttr(meta.title), desc = escapeAttr(meta.description);
  const tags = [
    `<link rel="canonical" href="${pageUrl(file)}">`,
    `<meta name="robots" content="${noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escapeAttr(SITE_NAME)}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${pageUrl(file)}">`,
    `<meta property="og:image" content="${SITE + (meta.ogImage ?? OG_DEFAULT).src}">`,
    `<meta property="og:image:width" content="${(meta.ogImage ?? OG_DEFAULT).w}">`,
    `<meta property="og:image:height" content="${(meta.ogImage ?? OG_DEFAULT).h}">`,
    `<meta property="og:image:alt" content="${escapeAttr(escapeText((meta.ogImage ?? OG_DEFAULT).alt))}">`,
    ...(meta.seoRevision ? [`<meta name="studio-seo-rev" content="${meta.seoRevision}">`] : []),
    ...(FIELDS[file]?.revision ? [`<meta name="studio-fields-rev" content="${FIELDS[file].revision}">`] : []),
    ...(MENU?.revision && /^[\w-]{1,64}$/.test(MENU.revision) ? [`<meta name="studio-menu-rev" content="${MENU.revision}">`] : []),
    ...(SETTINGS?.revision ? [`<meta name="studio-settings-rev" content="${SETTINGS.revision}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  // Website forms → AFCD Studio: only when FORMS_ENDPOINT is set (e.g. http://localhost:4400/forms/v1).
  // Without it the contact and newsletter forms keep their "not connected, nothing was sent" behaviour.
  if (FORMS_ENDPOINT) tags.push(`<meta name="afcd-forms" content="${escapeAttr(FORMS_ENDPOINT)}">`);
  const ld = [];
  if (file === 'index.html') {
    ld.push(SCHEMA ? schemaOrg() : ORG, WEBSITE);
    if (SCHEMA?.revision) tags.push(`<meta name="studio-schema-rev" content="${escapeAttr(String(SCHEMA.revision))}">`);
    // no image preload here: the hero's first photo already asks for high priority itself (preloading another file only slowed it down)
  }
  const bc = breadcrumbs(file, meta);
  if (bc) ld.push(bc);
  ld.push(...schemaPage(file));
  for (const obj of ld) tags.push(`<script type="application/ld+json">${jsonLd(obj)}</script>`);
  return tags.join('\n');
}

// Real last-modified dates from git history of each page source (falls back to today).
function lastmod(file) {
  try {
    const d = execSync(`git log -1 --format=%cs -- "src/pages/${file}"`, { encoding: 'utf8' }).trim();
    return d || new Date().toISOString().slice(0, 10);
  } catch { return new Date().toISOString().slice(0, 10); }
}

const sitemap = [];
// Studio previews render into a separate folder: PAGES_DIR (sources) and OUT_DIR (output). Defaults build the live site.
const PAGES_DIR = process.env.PAGES_DIR || join(SRC, 'pages');
const OUT_DIR = process.env.OUT_DIR || '.';
const pages = readdirSync(PAGES_DIR).filter((f) => f.endsWith('.html'));
// Site languages (lib/i18n.mjs, src/i18n/*.json): only for full builds of the site root, where assets/ sits next to the pages.
const WITH_LANGS = existsSync(join(OUT_DIR, 'assets', 'main.js')) && process.env.SKIP_LANGS !== '1';
const LANGS = WITH_LANGS ? activeLangs(SRC, PRODUCTION) : [];
const noindexFiles = new Set();
for (const file of pages) {
  const { meta: meta0, body } = parse(file);
  const meta = applySeo(file, meta0);
  if (!NAV.includes(meta.active)) throw new Error(`${file}: unknown active "${meta.active}"`);
  if (meta.noindex !== 'true') sitemap.push(`  <url><loc>${pageUrl(file)}</loc><lastmod>${lastmod(file)}</lastmod></url>`);
  else noindexFiles.add(file);
  const html = [
    head.replace('{{title}}', meta.title).replace('{{description}}', escapeAttr(meta.description)).replace('</head>', seoTags(file, meta) + '\n</head>').trimEnd(),
    '<body class="font-sans">',
    `<!-- Generated by build.mjs from src/pages/${file}. Edit the source, then run: npm run build -->`,
    '<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:px-4 focus:py-2 focus:text-sm">Skip to content</a>',
    '',
    markActive(header, meta.active).replace(/\{\{opps_href\}\}/g, OPPS_HREF).replace('{{pubs_link}}', PUBS_LINK).trimEnd(),
    '',
    `<main id="main" data-page="${meta.active}">`,
    renderPage(body.trim(), FIELDS[file]).replace(/\{\{opps_href\}\}/g, OPPS_HREF),
    '</main>',
    '',
    markActive(footer, meta.active).trimEnd(),
    '',
    `<script src="assets/main.js?v=${JS_V}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  const page = SETTINGS ? applyPage(html, SETTINGS) : html;
  writeFileSync(join(OUT_DIR, file), LANGS.length ? decorateEnglish(page, file, { site: SITE, langs: LANGS, pageUrl }) : page);
  console.log('built', file);
}
if (LANGS.length) {
  const r = buildLanguages({ src: SRC, outDir: OUT_DIR, files: pages, site: SITE, production: PRODUCTION, lastmod, noindexFiles });
  sitemap.push(...r.sitemap);
}

// Category/page addresses (lib/urls.mjs: /projects/x, /pillars/x, /about/team, no ".html"): production builds of the site
// root only. Every page, in every language, gets root-relative links and pretty absolute URLs; previews keep file links.
if (PRODUCTION && OUT_DIR === '.') {
  const pillars = pillarStems('.');
  for (const dir of ['', ...LANGS]) {
    for (const f of readdirSync(join(OUT_DIR, dir)).filter((x) => /^[a-z0-9][a-z0-9-]*\.html$/.test(x))) {
      const p = join(OUT_DIR, dir, f);
      writeFileSync(p, prettifyHtml(readFileSync(p, 'utf8'), { file: f, lang: dir, site: SITE, pillars }));
    }
  }
  for (let i = 0; i < sitemap.length; i++) sitemap[i] = prettifyAbsolute(sitemap[i], SITE, pillars);
}
// Sitemap: indexable canonical pages only, absolute production URLs.
writeFileSync(join(OUT_DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join('\n')}\n</urlset>\n`);
// robots.txt: open on production, closed on preview builds. (Not access control: private systems need auth.)
// The build stamp: a hash of the English pages and the sitemap, exactly as written. Studio reads it here and on the public
// site after each publish, so "Published" is only confirmed once visitors get these very files (see studio publish/public-check.ts).
const BUILD_STAMP = createHash('sha1').update([...readdirSync(OUT_DIR).filter((f) => /\.html$/.test(f)).sort(), 'sitemap.xml']
  .map((f) => `${f}\n${readFileSync(join(OUT_DIR, f))}`).join('\n')).digest('hex').slice(0, 16);
writeFileSync(join(OUT_DIR, 'robots.txt'), PRODUCTION
  ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n\n# studio-build: ${BUILD_STAMP}\n`
  : `# Preview build: not for indexing. Production builds use: npm run build:production\nUser-agent: *\nDisallow: /\n`);
console.log(`sitemap.xml (${sitemap.length} urls), robots.txt [${PRODUCTION ? 'production' : 'preview'}]`);
