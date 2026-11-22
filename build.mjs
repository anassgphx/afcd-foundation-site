// Assembles the static pages: src/pages/*.html + shared partials -> ./<page>.html
// Each page starts with a small front-matter block:
//   ---
//   title: Page title
//   description: Meta description
//   active: home | about | pillars | projects | news | partners | contact | involved
//   ---
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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
const escapeAttr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function parse(file) {
  const raw = readFileSync(join(SRC, 'pages', file), 'utf8');
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
    `<meta property="og:image" content="${OG_IMAGE}">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="AFCD Leadership Lab panel discussion">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ];
  const ld = [];
  if (file === 'index.html') {
    ld.push(ORG, WEBSITE);
    tags.push('<link rel="preload" as="image" href="assets/img/hero-leadership-lab.webp" fetchpriority="high">');
  }
  const bc = breadcrumbs(file, meta);
  if (bc) ld.push(bc);
  for (const obj of ld) tags.push(`<script type="application/ld+json">${JSON.stringify(obj)}</script>`);
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
const pages = readdirSync(join(SRC, 'pages')).filter((f) => f.endsWith('.html'));
for (const file of pages) {
  const { meta, body } = parse(file);
  if (!NAV.includes(meta.active)) throw new Error(`${file}: unknown active "${meta.active}"`);
  if (meta.noindex !== 'true') sitemap.push(`  <url><loc>${pageUrl(file)}</loc><lastmod>${lastmod(file)}</lastmod></url>`);
  const html = [
    head.replace('{{title}}', meta.title).replace('{{description}}', escapeAttr(meta.description)).replace('</head>', seoTags(file, meta) + '\n</head>').trimEnd(),
    '<body class="font-sans">',
    `<!-- Generated by build.mjs from src/pages/${file}. Edit the source, then run: npm run build -->`,
    '<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:bg-white focus:px-4 focus:py-2 focus:text-sm">Skip to content</a>',
    '',
    markActive(header, meta.active).trimEnd(),
    '',
    `<main id="main" data-page="${meta.active}">`,
    body.trim(),
    '</main>',
    '',
    markActive(footer, meta.active).trimEnd(),
    '',
    `<script src="assets/main.js?v=${JS_V}"></script>`,
    '</body>',
    '</html>',
    '',
  ].join('\n');
  writeFileSync(file, html);
  console.log('built', file);
}

// Sitemap: indexable canonical pages only, absolute production URLs.
writeFileSync('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemap.join('\n')}\n</urlset>\n`);
// robots.txt: open on production, closed on preview builds. (Not access control: private systems need auth.)
writeFileSync('robots.txt', PRODUCTION
  ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`
  : `# Preview build: not for indexing. Production builds use: npm run build:production\nUser-agent: *\nDisallow: /\n`);
console.log(`sitemap.xml (${sitemap.length} urls), robots.txt [${PRODUCTION ? 'production' : 'preview'}]`);
