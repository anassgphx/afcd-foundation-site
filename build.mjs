// Assembles the static pages: src/pages/*.html + shared partials -> ./<page>.html
// Each page starts with a small front-matter block:
//   ---
//   title: Page title
//   description: Meta description
//   active: home | about | pillars | projects | news | partners | contact | involved
//   ---
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { renderPage } from './lib/page-fields.mjs';
import { activeLangs, decorateEnglish, buildLanguages } from './lib/i18n.mjs';
import { execSync } from 'node:child_process';

const SRC = 'src';
const partial = (name) => readFileSync(join(SRC, 'partials', `${name}.html`), 'utf8');

// Cache-busting: a short content hash on the CSS/JS links, so browsers and GitHub Pages
// visitors always load the latest build. Run after the CSS is compiled (see npm run build).
const version = (file) => createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 8);
const CSS_V = version('assets/styles.css');
const JS_V = version('assets/main.js');

const head = partial('head').replace('href="assets/styles.css"', `href="assets/styles.css?v=${CSS_V}"`);
const header = partial('header');
const footer = partial('footer');

const NAV = ['home', 'about', 'pillars', 'projects', 'news', 'partners', 'contact', 'involved', 'none'];
// Escapes for attributes without double-escaping entities already in the text (front matter titles may contain &amp;).
const escapeAttr = (s) => s.replace(/&(?!(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/"/g, '&quot;');
const escapeText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

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
function markActive(html, active) {
  return html
    .replace(/\{\{cur:([a-z]+)\}\}/g, (_, k) => (k === active ? 'is-current' : ''))
    .replace(/\{\{aria:([a-z]+)\}\}/g, (_, k) => (k === active ? ' aria-current="page"' : ''));
}

// ---------------------------------------------------------------- SEO
// Canonical production domain. Preview builds (the default, e.g. GitHub Pages) are noindex so the
// preview copy never competes with the real site. Use `npm run build:production` for afcdfoundation.org.
const SITE = 'https://afcdfoundation.org/';
const PRODUCTION = process.env.SITE_ENV === 'production';
const FORMS_ENDPOINT = (process.env.FORMS_ENDPOINT || '').trim().replace(/\/+$/, '');
if (FORMS_ENDPOINT && !/^https?:\/\/[^\s"<>]+$/.test(FORMS_ENDPOINT)) throw new Error(`FORMS_ENDPOINT must be an http(s) URL, got "${FORMS_ENDPOINT}"`);
const OG_IMAGE = SITE + 'assets/img/og-default.jpg';
const pageUrl = (file) => SITE + (file === 'index.html' ? '' : file);

// Public organization facts only (approved fields from the AFCD Connect profile).
// The full Marrakech street address is omitted until AFCD confirms it is current.
const ORG = {
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
const WEBSITE = { '@context': 'https://schema.org', '@type': 'WebSite', '@id': SITE + '#website', name: 'AFCD Foundation', url: SITE, inLanguage: 'en', publisher: { '@id': SITE + '#organization' } };

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
    `<meta property="og:site_name" content="AFCD Foundation">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${desc}">`,
    `<meta property="og:url" content="${pageUrl(file)}">`,
    `<meta property="og:image" content="${meta.ogImage ? SITE + meta.ogImage.src : OG_IMAGE}">`,
    `<meta property="og:image:width" content="${meta.ogImage ? meta.ogImage.w : 1200}">`,
    `<meta property="og:image:height" content="${meta.ogImage ? meta.ogImage.h : 630}">`,
    `<meta property="og:image:alt" content="${meta.ogImage ? escapeAttr(escapeText(meta.ogImage.alt)) : 'AFCD Leadership Lab panel discussion'}">`,
    ...(meta.seoRevision ? [`<meta name="studio-seo-rev" content="${meta.seoRevision}">`] : []),
    ...(FIELDS[file]?.revision ? [`<meta name="studio-fields-rev" content="${FIELDS[file].revision}">`] : []),
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  // Website forms → AFCD Studio: only when FORMS_ENDPOINT is set (e.g. http://localhost:4400/forms/v1).
  // Without it the contact and newsletter forms keep their "not connected, nothing was sent" behaviour.
  if (FORMS_ENDPOINT) tags.push(`<meta name="afcd-forms" content="${escapeAttr(FORMS_ENDPOINT)}">`);
  const ld = [];
  if (file === 'index.html') {
    ld.push(SCHEMA ? schemaOrg() : ORG, WEBSITE);
    if (SCHEMA?.revision) tags.push(`<meta name="studio-schema-rev" content="${escapeAttr(String(SCHEMA.revision))}">`);
    tags.push('<link rel="preload" as="image" href="assets/img/hero-leadership-lab.webp" fetchpriority="high">');
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
    markActive(header, meta.active).trimEnd(),
    '',
    `<main id="main" data-page="${meta.active}">`,
    renderPage(body.trim(), FIELDS[file]),
    '</main>',
    '',
    markActive(footer, meta.active).trimEnd(),
    '',
    `<script src="assets/main.js?v=${JS_V}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  writeFileSync(join(OUT_DIR, file), LANGS.length ? decorateEnglish(html, file, { site: SITE, langs: LANGS, pageUrl }) : html);
  console.log('built', file);
}
if (LANGS.length) {
  const r = buildLanguages({ src: SRC, outDir: OUT_DIR, files: pages, site: SITE, production: PRODUCTION, lastmod, noindexFiles });
  sitemap.push(...r.sitemap);
}

// Sitemap: indexable canonical pages only, absolute production URLs.
writeFileSync(join(OUT_DIR, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join('\n')}\n</urlset>\n`);
// robots.txt: open on production, closed on preview builds. (Not access control: private systems need auth.)
writeFileSync(join(OUT_DIR, 'robots.txt'), PRODUCTION
  ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`
  : `# Preview build: not for indexing. Production builds use: npm run build:production\nUser-agent: *\nDisallow: /\n`);
console.log(`sitemap.xml (${sitemap.length} urls), robots.txt [${PRODUCTION ? 'production' : 'preview'}]`);
