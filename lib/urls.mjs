// Public page addresses: category / page, without ".html".
//   index.html → /    about.html → /about    our-story.html → /about/our-story    womens-empowerment.html → /pillars/womens-empowerment
//   project-x.html → /projects/x    news-x.html → /news/x    event-x.html → /events/x    publication-x.html → /publications/x
//   opportunity-x.html → /opportunities/x    projects.html → /projects (listings keep their section name)
// The page files keep their names on disk (Studio, the audit and publishing work with files); production builds of the
// site root rewrite every internal address to these paths (prettifyHtml), and the web server maps them back to the files
// and sends the old .html addresses here with a 301 (deploy/caddy-urls.caddy). French and Arabic use the same paths
// under /fr and /ar.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Detail pages by file prefix → section. */
export const SECTIONS = [['project-', 'projects'], ['news-', 'news'], ['event-', 'events'], ['publication-', 'publications'], ['opportunity-', 'opportunities']];
/** Pages under /about/. */
export const ABOUT = ['our-story', 'mission-vision', 'strategy', 'team'];
/** The site's own pillar pages; Studio pillars add theirs through src/data/pillars.json. */
export const DEFAULT_PILLARS = ['youth-empowerment', 'womens-empowerment', 'environment-climate', 'digital-inclusion'];
const LANGS = ['fr', 'ar'];

/** The pillar page files (stems) of a site root: Studio's pillars.json when present, else the built-in four. */
export function pillarStems(root = '.') {
  try {
    const p = join(root, 'src', 'data', 'pillars.json');
    if (existsSync(p)) {
      const list = JSON.parse(readFileSync(p, 'utf8')).pillars ?? [];
      const stems = list.map((x) => String(x.file || '').replace(/\.html$/, '')).filter((x) => /^[a-z0-9-]+$/.test(x));
      if (stems.length) return [...new Set([...stems, ...DEFAULT_PILLARS])];
    }
  } catch { /* fall back */ }
  return [...DEFAULT_PILLARS];
}

/** "project-cso-care.html" → "/projects/cso-care" (English path; prefix "/fr" or "/ar" for other languages). */
export function prettyPath(file, pillars = DEFAULT_PILLARS) {
  const stem = String(file).replace(/\.html$/, '');
  if (stem === 'index') return '/';
  for (const [pre, sec] of SECTIONS) if (stem.startsWith(pre) && stem.length > pre.length) return `/${sec}/${stem.slice(pre.length)}`;
  if (ABOUT.includes(stem)) return `/about/${stem}`;
  if (pillars.includes(stem)) return `/pillars/${stem}`;
  return `/${stem}`;
}

/** The reverse: a site path (pretty or old style, with or without /fr or /ar) → { lang, file }, or null if it is not a page. */
export function fileFromPath(path) {
  let p = String(path).split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  let lang = '';
  const m = p.match(/^\/(fr|ar)(\/.*)?$/); if (m) { lang = m[1]; p = m[2] || '/'; }
  if (p === '/' || p === '/index' || p === '/index.html') return { lang, file: 'index.html' };
  const parts = p.replace(/^\//, '').replace(/\.html$/, '').split('/');
  if (parts.some((x) => !/^[a-z0-9][a-z0-9-]*$/i.test(x))) return null;
  if (parts.length === 1) return { lang, file: `${parts[0]}.html` };
  if (parts.length !== 2) return null;
  const [sec, slug] = parts;
  const pre = SECTIONS.find(([, s]) => s === sec)?.[0];
  if (pre) return { lang, file: `${pre}${slug}.html` };
  if (sec === 'about' || sec === 'pillars') return { lang, file: `${slug}.html` };
  return null;
}

const SKIP = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/|\/|\{\{)/i;   // absolute (scheme or //), root-relative, in-page, template
/** A relative reference on page `lang/file` → root-relative: pages to their pretty path, other files (assets) kept. */
function absolutize(ref, { lang, file, pillars }) {
  if (!ref || SKIP.test(ref)) return ref;
  let u;
  try { u = new URL(ref, `https://x/${lang ? `${lang}/` : ''}${file}`); } catch { return ref; }
  const tail = u.search + u.hash;
  const hit = /\.html$/.test(u.pathname) ? fileFromPath(u.pathname) : null;
  if (hit && LANGS.concat('').includes(hit.lang)) {
    const pretty = prettyPath(hit.file, pillars);
    return (hit.lang ? `/${hit.lang}${pretty === '/' ? '/' : pretty}` : pretty) + tail;
  }
  return u.pathname + tail;
}

/** Absolute site URLs to old-style pages → pretty ("https://site/fr/project-x.html" → "https://site/fr/projects/x"). */
export function prettifyAbsolute(text, site, pillars = DEFAULT_PILLARS) {
  const esc = site.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return text.replace(new RegExp(`${esc}((?:fr|ar)/)?([a-z0-9][a-z0-9-]*)\\.html`, 'g'), (m, l, stem) => {
    const p = prettyPath(`${stem}.html`, pillars);
    return site + (l ?? '') + (p === '/' ? '' : p.slice(1));
  });
}

const ATTRS = /(\s(?:href|src|poster|action|data-href|data-full|data-src|data-logo)=")([^"]*)"/g;
/** Rewrites a built page (`file`, in language `lang` or '' for English) to category/page addresses: relative links and
 *  asset paths become root-relative (they must work from /projects/x too), absolute site URLs become pretty, and the
 *  page names its own file in <meta name="afcd-file"> (the "Edit this page" button). Studio redirect pages are left alone. */
export function prettifyHtml(html, { file, lang = '', site, pillars = DEFAULT_PILLARS }) {
  if (html.includes('<!-- studio-redirect -->')) return html;
  const ctx = { lang, file, pillars };
  let out = html
    .replace(ATTRS, (m, a, v) => `${a}${absolutize(v, ctx)}"`)
    .replace(/(\ssrcset=")([^"]*)"/g, (m, a, v) => a + v.split(',').map((part) => { const [u, ...d] = part.trim().split(/\s+/); return [absolutize(u, ctx), ...d].join(' '); }).join(', ') + '"')
    .replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, v) => `url(${q}${absolutize(v, ctx)}${q})`);
  out = prettifyAbsolute(out, site, pillars);
  if (!out.includes('name="afcd-file"')) out = out.replace('</head>', `<meta name="afcd-file" content="${file}">\n</head>`);
  return out;
}
