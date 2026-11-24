// SEO audit engine v2: a BUILD AUDIT of the HTML the website build produced (not the public site, and not Google's view).
// Every finding has a severity, a category, evidence, why it matters and a recommended fix. Standards violations and
// heuristics are labelled separately. Scores are reported per area; there is no single "Google score".
// Crawled HTML is treated as data only: it is parsed with fixed patterns and never executed or followed outside the site.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type Category = 'technical' | 'metadata' | 'content' | 'structured' | 'linking' | 'performance';
export type Finding = { code: string; file: string; severity: Severity; category: Category; kind: 'standard' | 'heuristic'; title: string; why: string; fix: string; evidence: string[] };
export type PageScan = {
  file: string; url: string; title: string; description: string; lang: string; canonical: string; robots: string; inSitemap: boolean;
  h1: string[]; headings: { level: number; text: string }[]; words: number; og: { title: string; description: string; image: string };
  schema: { types: string[]; errors: string[] }; linksOut: string[]; inbound: string[]; images: number; size: number;
  checks?: Check[];
};
/** One line of a page's checklist. `status` comes only from this audit's findings for the page (no finding = pass),
 *  so the checklist and the issue list always agree. */
export type CheckStatus = 'pass' | 'warn' | 'fail' | 'info';
export type Check = { id: string; group: CheckGroup; label: string; status: CheckStatus; detail: string; codes: string[] };
export type CheckGroup = 'basic' | 'advanced' | 'content' | 'performance';
export type BuildAudit = { kind: 'build'; at: string; site: string; production: boolean; pages: PageScan[]; redirects?: { file: string; to: string }[]; findings: Finding[]; scores: Record<Category | 'overall', number>; counts: Record<Severity, number> };

import { DEFAULT_SITE } from './site.ts';
const pageUrlFor = (site: string) => (f: string) => site + (f === 'index.html' ? '' : f);
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m));
const attr = (tag: string, n: string) => tag.match(new RegExp(`\\s${n}="([^"]*)"`, 'i'))?.[1] ?? null;
const meta = (html: string, key: string, by = 'name') => { const t = html.match(new RegExp(`<meta[^>]*\\s${by}="${key}"[^>]*>`, 'i'))?.[0]; return t ? decode(attr(t, 'content') ?? '') : ''; };
const text = (h: string) => decode(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Rule texts: what it is, why it matters, what to do. Kept in one place so wording stays consistent. */
const R: Record<string, Omit<Finding, 'file' | 'evidence'>> = {
  'tech.noindex': { code: 'tech.noindex', severity: 'critical', category: 'technical', kind: 'standard', title: 'Page is set to noindex', why: 'Search engines are told not to list this page.', fix: 'Remove “Hide from search engines” in the page’s SEO settings unless hiding it is intended.' },
  'tech.title-missing': { code: 'tech.title-missing', severity: 'high', category: 'technical', kind: 'standard', title: 'No page title', why: 'The title is the main line shown in search results and browser tabs.', fix: 'Add a descriptive title in the page’s editor or SEO settings.' },
  'tech.canonical-missing': { code: 'tech.canonical-missing', severity: 'high', category: 'technical', kind: 'standard', title: 'No canonical link', why: 'Without it, search engines guess which address is the main one.', fix: 'The build adds canonicals to every page; a missing one means the page was not built by build.mjs. Rebuild the site.' },
  'tech.canonical-mismatch': { code: 'tech.canonical-mismatch', severity: 'high', category: 'technical', kind: 'standard', title: 'Canonical points to a different address', why: 'Search engines may index the other address instead of this page.', fix: 'Check that the canonical matches this page’s own address, unless the page intentionally duplicates another.' },
  'tech.lang-missing': { code: 'tech.lang-missing', severity: 'medium', category: 'technical', kind: 'standard', title: 'Page language not declared', why: 'Search engines and screen readers use it to understand the content.', fix: 'Add lang="en" to the <html> element in the page template.' },
  'tech.broken-links': { code: 'tech.broken-links', severity: 'high', category: 'technical', kind: 'standard', title: 'Links to pages that do not exist', why: 'Visitors and crawlers hit dead ends, and the linked content looks missing.', fix: 'Correct or remove the links, or publish the missing pages.' },
  'tech.sitemap-ghost': { code: 'tech.sitemap-ghost', severity: 'high', category: 'technical', kind: 'standard', title: 'Sitemap lists a page that does not exist', why: 'Search engines are sent to an address that returns nothing.', fix: 'Rebuild the site so the sitemap matches the published pages.' },
  'tech.not-in-sitemap': { code: 'tech.not-in-sitemap', severity: 'info', category: 'technical', kind: 'heuristic', title: 'Not listed in the sitemap', why: 'Pages marked noindex are left out on purpose; other pages are easier to discover when listed.', fix: 'If this page should appear in search, make sure it is not marked noindex.' },
  'tech.double-escaped': { code: 'tech.double-escaped', severity: 'high', category: 'metadata', kind: 'standard', title: 'Text escaped twice', why: 'Search results and link previews would show “&amp;” instead of “&”.', fix: 'Fixed in build.mjs for titles; if it appears again, report it to the website team.' },
  'meta.desc-missing': { code: 'meta.desc-missing', severity: 'medium', category: 'metadata', kind: 'standard', title: 'No meta description', why: 'Search engines may then pick a random snippet from the page.', fix: 'Write one or two sentences that say what the page offers.' },
  'meta.title-dup': { code: 'meta.title-dup', severity: 'medium', category: 'metadata', kind: 'heuristic', title: 'Same title as other pages', why: 'Identical titles make pages hard to tell apart in search results.', fix: 'Give each page a title that names its specific subject.' },
  'meta.desc-dup': { code: 'meta.desc-dup', severity: 'low', category: 'metadata', kind: 'heuristic', title: 'Same description as other pages', why: 'Repeated descriptions do not help people choose the right page.', fix: 'Describe what is unique about this page.' },
  'meta.title-vague': { code: 'meta.title-vague', severity: 'low', category: 'metadata', kind: 'heuristic', title: 'Title may not describe the page clearly', why: 'The title is empty of meaning (for example “Home” or “Untitled”), so it does not say what the page is about.', fix: 'Name the page’s subject, e.g. “Youth Empowerment · AFCD Foundation”.' },
  'meta.title-long': { code: 'meta.title-long', severity: 'low', category: 'metadata', kind: 'heuristic', title: 'Title may be shortened in results', why: 'Search engines show roughly the first 60 characters; the end may be cut off.', fix: 'Put the most important words first.' },
  'meta.desc-short': { code: 'meta.desc-short', severity: 'low', category: 'metadata', kind: 'heuristic', title: 'Description is very brief', why: 'A fuller description can explain why the page is worth visiting. Search engines may still write their own.', fix: 'Add a sentence about who the page is for or what it offers.' },
  'meta.desc-long': { code: 'meta.desc-long', severity: 'low', category: 'metadata', kind: 'heuristic', title: 'Description may be shortened in results', why: 'Long descriptions are usually cut at around 155–160 characters.', fix: 'Lead with the essential point.' },
  'meta.og-missing': { code: 'meta.og-missing', severity: 'low', category: 'metadata', kind: 'standard', title: 'Incomplete link-preview data', why: 'Social networks and messaging apps use it to build the preview card.', fix: 'The build adds Open Graph tags; check the page’s title, description and share image.' },
  'content.h1-missing': { code: 'content.h1-missing', severity: 'high', category: 'content', kind: 'standard', title: 'No main heading (h1)', why: 'The main heading tells people and search engines what the page is about.', fix: 'Give the page one clear main heading.' },
  'content.h1-many': { code: 'content.h1-many', severity: 'low', category: 'content', kind: 'heuristic', title: 'More than one main heading', why: 'One h1 makes the page’s subject clearest.', fix: 'Keep one h1 and use h2 for sections.' },
  'content.heading-skip': { code: 'content.heading-skip', severity: 'low', category: 'content', kind: 'heuristic', title: 'Heading levels skipped', why: 'A regular outline (h1, h2, h3) helps screen-reader users and makes structure clear.', fix: 'Do not jump from h2 to h4; use the next level down.' },
  'content.placeholder': { code: 'content.placeholder', severity: 'medium', category: 'content', kind: 'heuristic', title: 'Shows sample or placeholder text', why: 'Placeholder content looks unfinished and does not answer what people search for.', fix: 'Replace it with real content, or keep the page out of search until it is ready.' },
  'content.thin': { code: 'content.thin', severity: 'low', category: 'content', kind: 'heuristic', title: 'Little text on the page', why: 'Pages with very little text are harder for search engines to understand. Short can be fine for some pages.', fix: 'Add useful context if the page should rank on its own.' },
  'content.img-alt': { code: 'content.img-alt', severity: 'medium', category: 'content', kind: 'standard', title: 'Images without alt text', why: 'Alt text describes images for screen readers and image search.', fix: 'Add alt text in the Media Library (decorative images may use an empty alt).' },
  'perf.img-size': { code: 'perf.img-size', severity: 'low', category: 'performance', kind: 'heuristic', title: 'Large image files', why: 'Big images slow the page down, especially on mobile data.', fix: 'Upload through the Media Library, which makes smaller versions automatically.' },
  'perf.img-dimensions': { code: 'perf.img-dimensions', severity: 'low', category: 'performance', kind: 'standard', title: 'Images without width and height', why: 'Without dimensions the layout jumps while images load (layout shift).', fix: 'Studio images include dimensions; add width and height to hand-written images.' },
  'schema.invalid': { code: 'schema.invalid', severity: 'high', category: 'structured', kind: 'standard', title: 'Structured data cannot be read', why: 'Broken JSON-LD is ignored by search engines.', fix: 'Fix the JSON-LD block in the page template.' },
  'schema.org-missing': { code: 'schema.org-missing', severity: 'medium', category: 'structured', kind: 'heuristic', title: 'Homepage has no Organization data', why: 'It states AFCD’s official name, logo and profiles in a machine-readable way.', fix: 'The build adds it to index.html; rebuild the site.' },
  'schema.article-suggest': { code: 'schema.article-suggest', severity: 'info', category: 'structured', kind: 'heuristic', title: 'Story page could describe itself as an article', why: 'Article data (headline, date, image) can help search engines present the story. It does not guarantee any special result.', fix: 'Switch on Article markup in SEO → Structured data and publish it; stories published through Studio then carry it.' },
  'link.orphan': { code: 'link.orphan', severity: 'medium', category: 'linking', kind: 'heuristic', title: 'No other page links here', why: 'Pages without internal links are hard for visitors and crawlers to find.', fix: 'Link to it from a related page (its pillar, project or listing).' },
  'site.preview-build': { code: 'site.preview-build', severity: 'info', category: 'technical', kind: 'standard', title: 'Preview build: every page is noindex', why: 'Preview builds are kept out of search on purpose. This audit cannot judge indexability for the public site.', fix: 'Production builds (npm run build:production) are indexable; audit the public site after deployment.' },
};
R['link.via-redirect'] = { code: 'link.via-redirect', severity: 'low', category: 'linking', kind: 'standard', title: 'Links to a redirected address', why: 'Visitors and search engines take an extra hop through the redirect page before reaching the content.', fix: 'Point the link straight at the new page.' };
export const RULES = R;
const STUB_MARK = '<!-- studio-redirect -->';   // redirect pages written by Studio (see redirects.ts)
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];
const GENERIC_TITLE = /^(home|page|untitled|new page|title|test|index|welcome|default)$/i;
const LISTING = new Set(['contact.html', 'team.html', 'news.html', 'events.html', 'projects.html', 'partners.html', 'opportunities.html', 'publications.html', 'pillars.html', 'get-involved.html']);
const WEIGHT: Record<Severity, number> = { critical: 40, high: 20, medium: 8, low: 3, info: 0 };

function scanPage(root: string, file: string, pageUrl: (f: string) => string) {
  const html = readFileSync(resolve(root, file), 'utf8');
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? '';
  const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
  const headings = [...main.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: clip(text(m[2]), 120) }));
  const schema = { types: [] as string[], errors: [] as string[] };
  for (const m of html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try { const j = JSON.parse(m[1]); for (const x of Array.isArray(j) ? j : [j]) schema.types.push(String(x?.['@type'] ?? 'Unknown')); } catch (e) { schema.errors.push((e as Error).message.slice(0, 120)); }
  }
  const links = [...main.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)].map((m) => m[1]).filter((h) => !/^(https?:|mailto:|tel:|#|javascript:|\/\/)/i.test(h) && h !== '').map((h) => decode(h).split(/[?#]/)[0]).filter(Boolean);
  const imgs = [...main.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  return {
    html, head, main,
    scan: { file, url: pageUrl(file), title: decode(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim(), description: meta(html, 'description').trim(),
      lang: html.match(/<html[^>]*\slang="([^"]*)"/i)?.[1] ?? '', canonical: attr(html.match(/<link[^>]*rel="canonical"[^>]*>/i)?.[0] ?? '', 'href') ?? '', robots: meta(html, 'robots'),
      inSitemap: false, h1: headings.filter((h) => h.level === 1).map((h) => h.text), headings, words: text(main).split(' ').filter(Boolean).length,
      og: { title: meta(html, 'og:title', 'property'), description: meta(html, 'og:description', 'property'), image: meta(html, 'og:image', 'property') },
      schema, linksOut: [...new Set(links)], inbound: [] as string[], images: imgs.length, size: Buffer.byteLength(html) } as PageScan,
    imgs,
  };
}

/** Runs the build audit over every built page in `root`. */
/** `site` is the canonical address pages should declare (Settings → General; afcdfoundation.com by default). */
export function runBuildAudit(root: string, now = new Date(), site = DEFAULT_SITE): BuildAudit {
  const pageUrl = pageUrlFor(site);
  const all = readdirSync(root).filter((f) => /^[a-z0-9][a-z0-9-]*\.html$/.test(f)).sort();
  // redirect pages are not content: list them separately and leave them out of the page checks
  const redirectsOut: { file: string; to: string }[] = [];
  const files = all.filter((f) => { const h = readFileSync(resolve(root, f), 'utf8'); if (!h.includes(STUB_MARK)) return true;
    redirectsOut.push({ file: f, to: decode(h.match(/http-equiv="refresh" content="0; url=([^"]+)"/i)?.[1] ?? '') }); return false; });
  const redirected = new Map(redirectsOut.map((r) => [r.file, r.to]));
  const robotsTxt = existsSync(resolve(root, 'robots.txt')) ? readFileSync(resolve(root, 'robots.txt'), 'utf8') : '';
  const production = !/Disallow:\s*\/\s*$/m.test(robotsTxt);
  const sitemapXml = existsSync(resolve(root, 'sitemap.xml')) ? readFileSync(resolve(root, 'sitemap.xml'), 'utf8') : '';
  const sitemap = new Set([...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => { const u = m[1].replace(/^https?:\/\/[^/]+\//, ''); return u === '' ? 'index.html' : u; }));
  const scanned = files.map((f) => scanPage(root, f, pageUrl));
  const byFile = new Map(scanned.map((s) => [s.scan.file, s.scan]));
  for (const s of scanned) { s.scan.inSitemap = sitemap.has(s.scan.file); for (const t of s.scan.linksOut) { const target = byFile.get(t); if (target && t !== s.scan.file && !target.inbound.includes(s.scan.file)) target.inbound.push(s.scan.file); } }
  // links in the shared header and footer count too: pages reachable from navigation are not orphans
  const nav = (() => { const first = scanned[0]?.html ?? ''; const chrome = (first.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? '') + (first.match(/<footer[\s\S]*?<\/footer>/i)?.[0] ?? '');
    return new Set([...chrome.matchAll(/\shref="([^"#?]+\.html)/gi)].map((m) => m[1])); })();

  const findings: Finding[] = [];
  const add = (code: string, file: string, evidence: string[] = [], over: Partial<Finding> = {}) => findings.push({ ...R[code], ...over, file, evidence });
  if (!production) add('site.preview-build', 'robots.txt', ['robots.txt: Disallow: /', 'Every page has <meta name="robots" content="noindex, nofollow">']);

  for (const { scan: p, head, imgs } of scanned) {
    const is404 = p.file === '404.html';
    if (!p.title) add('tech.title-missing', p.file);
    if (production && /noindex/i.test(p.robots) && p.inSitemap) add('tech.noindex', p.file, [`<meta name="robots" content="${p.robots}">`]);
    if (!is404) {
      if (!p.canonical) add('tech.canonical-missing', p.file);
      else if (p.canonical !== p.url) add('tech.canonical-mismatch', p.file, [`Canonical: ${p.canonical}`, `This page: ${p.url}`]);
      if (!p.inSitemap) add('tech.not-in-sitemap', p.file);
    }
    if (!p.lang) add('tech.lang-missing', p.file);
    const broken = p.linksOut.filter((l) => !existsSync(resolve(root, l)));
    if (broken.length) add('tech.broken-links', p.file, broken.slice(0, 8).map((b) => `Links to ${b}`));
    const hops = p.linksOut.filter((l) => redirected.has(l));
    if (hops.length) add('link.via-redirect', p.file, hops.slice(0, 8).map((l) => `Links to ${l}, which redirects to ${redirected.get(l)}`));
    if (/&amp;(?:amp|lt|gt|quot|#\d+);/.test(head)) add('tech.double-escaped', p.file, [clip(head.match(/[^\n]*&amp;(?:amp|lt|gt|quot|#\d+);[^\n]*/)?.[0]?.trim() ?? '', 140)]);
    if (!p.description) add('meta.desc-missing', p.file);
    else if (p.description.length < 50) add('meta.desc-short', p.file, [`“${p.description}” (${p.description.length} characters)`]);
    else if (p.description.length > 170) add('meta.desc-long', p.file, [`${p.description.length} characters`]);
    const core = p.title.replace(/\s*·\s*AFCD Foundation$/i, '');
    // short titles are fine for standard pages (About Us, Contact) and named projects; flag only titles that say nothing
    if (p.title && !is404 && (core.length < 4 || GENERIC_TITLE.test(core) || /^afcd( foundation)?$/i.test(core) && p.file !== 'index.html')) add('meta.title-vague', p.file, [`Title: “${p.title}”`]);
    if (p.title.length > 70) add('meta.title-long', p.file, [`${p.title.length} characters: “${clip(p.title, 80)}”`]);
    const ogMissing = [!p.og.title && 'og:title', !p.og.description && 'og:description', !p.og.image && 'og:image'].filter(Boolean) as string[];
    if (ogMissing.length && !is404) add('meta.og-missing', p.file, ogMissing.map((x) => `Missing ${x}`));
    if (!is404) {
      if (!p.h1.length) add('content.h1-missing', p.file);
      if (p.h1.length > 1) add('content.h1-many', p.file, p.h1.map((h) => `h1: ${h}`));
      const skips: string[] = []; for (let i = 1; i < p.headings.length; i++) if (p.headings[i].level > p.headings[i - 1].level + 1) skips.push(`h${p.headings[i - 1].level} “${clip(p.headings[i - 1].text, 40)}” → h${p.headings[i].level} “${clip(p.headings[i].text, 40)}”`);
      if (skips.length) add('content.heading-skip', p.file, skips.slice(0, 4));
      const ph = text(scanned.find((x) => x.scan.file === p.file)!.main).match(/.{0,40}(lorem ipsum|consectetur adipiscing|sample event|placeholder).{0,40}/i);
      if (ph) add('content.placeholder', p.file, [`“…${ph[0].trim()}…”`]);
      // listings, contact and people pages are short by design: their job is to lead elsewhere
      if (p.words < 150 && !LISTING.has(p.file) && !/noindex/i.test(production ? p.robots : '')) add('content.thin', p.file, [`${p.words} words in the main content`]);
    }
    const noAlt = imgs.filter((t) => attr(t, 'alt') === null);
    if (noAlt.length) add('content.img-alt', p.file, noAlt.slice(0, 5).map((t) => `<img src="${attr(t, 'src') ?? '?'}">`));
    const noDim = imgs.filter((t) => !attr(t, 'width') || !attr(t, 'height'));
    if (noDim.length) add('perf.img-dimensions', p.file, noDim.slice(0, 5).map((t) => attr(t, 'src') ?? '?'));
    const big = imgs.map((t) => attr(t, 'src') ?? '').filter((src) => src && !/^(https?:|data:)/.test(src)).map((src) => { const f = resolve(root, src.split('?')[0]); return existsSync(f) ? { src, kb: Math.round(statSync(f).size / 1024) } : null; })
      .filter((x): x is { src: string; kb: number } => !!x && x.kb > 400);
    if (big.length) add('perf.img-size', p.file, big.map((b) => `${b.src}: ${b.kb} KB`));
    if (p.schema.errors.length) add('schema.invalid', p.file, p.schema.errors);
    if (p.file === 'index.html' && !p.schema.types.includes('NGO') && !p.schema.types.includes('Organization')) add('schema.org-missing', p.file);
    if (/^news-/.test(p.file) && !p.schema.types.some((t) => /Article|BlogPosting|NewsArticle/.test(t))) add('schema.article-suggest', p.file);
    if (!is404 && p.file !== 'index.html' && !p.inbound.length && !nav.has(p.file)) add('link.orphan', p.file, ['No links from other pages or the menu']);
  }
  for (const f of sitemap) if (!byFile.has(f)) add('tech.sitemap-ghost', 'sitemap.xml', [`Listed: ${f}`]);
  // duplicates across pages
  for (const [field, code] of [['title', 'meta.title-dup'], ['description', 'meta.desc-dup']] as const) {
    const seen = new Map<string, string[]>();
    for (const { scan: p } of scanned) if (p[field] && p.file !== '404.html') seen.set(p[field], [...(seen.get(p[field]) ?? []), p.file]);
    for (const [v, fs] of seen) if (fs.length > 1) for (const f of fs) add(code, f, [`“${clip(v, 80)}”`, `Also on: ${fs.filter((x) => x !== f).join(', ')}`]);
  }

  // scores per area: each page starts at 100 in each area and loses points for that area's findings
  const pages = scanned.map((s) => s.scan);
  for (const p of pages) p.checks = pageChecklist(p, findings.filter((f) => f.file === p.file), production);
  const cats: Category[] = ['technical', 'metadata', 'content', 'structured', 'linking', 'performance'];
  const scores = Object.fromEntries(cats.map((c) => {
    const per = pages.map((p) => Math.max(0, 100 - findings.filter((f) => f.file === p.file && f.category === c).reduce((n, f) => n + WEIGHT[f.severity], 0)));
    return [c, per.length ? Math.round(per.reduce((a, b) => a + b, 0) / per.length) : 0];
  })) as Record<Category, number>;
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, findings.filter((f) => f.severity === s).length])) as Record<Severity, number>;
  return { kind: 'build', at: now.toISOString(), site, production, pages, redirects: redirectsOut, findings, scores: { ...scores, overall: scores.technical }, counts };
}

// ---------------------------------------------------------------- Per-page checklist
const STATUS_OF: Record<Severity, CheckStatus> = { critical: 'fail', high: 'fail', medium: 'warn', low: 'warn', info: 'info' };
const WORST: CheckStatus[] = ['fail', 'warn', 'info', 'pass'];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
type CheckDef = { id: string; group: CheckGroup; label: string; codes: string[]; pass: (p: PageScan) => string; skip404?: boolean };
/** The checklist, in display order. A check passes when none of its rule codes was found on the page. */
export const CHECKS: CheckDef[] = [
  { id: 'title', group: 'basic', label: 'Page title', codes: ['tech.title-missing', 'meta.title-long', 'meta.title-vague', 'meta.title-dup'], pass: (p) => `“${clip(p.title, 70)}” (${p.title.length} characters)` },
  { id: 'description', group: 'basic', label: 'Meta description', codes: ['meta.desc-missing', 'meta.desc-short', 'meta.desc-long', 'meta.desc-dup'], pass: (p) => `${p.description.length} characters, unique to this page` },
  { id: 'h1', group: 'basic', label: 'Main heading (h1)', codes: ['content.h1-missing', 'content.h1-many'], pass: (p) => `“${clip(p.h1[0] ?? '', 70)}”`, skip404: true },
  { id: 'headings', group: 'basic', label: 'Heading order', codes: ['content.heading-skip'], pass: (p) => p.headings.length > 1 ? `${p.headings.length} headings, no level skipped` : 'No sub-headings to check', skip404: true },
  { id: 'alt', group: 'basic', label: 'Image alt text', codes: ['content.img-alt'], pass: (p) => p.images ? `All ${plural(p.images, 'image')} have alt text` : 'No images in the main content' },
  { id: 'lang', group: 'basic', label: 'Page language', codes: ['tech.lang-missing'], pass: (p) => `lang="${p.lang}"` },
  { id: 'indexable', group: 'advanced', label: 'Search engines may index it', codes: ['tech.noindex'], pass: (p) => /noindex/i.test(p.robots) ? 'Preview build: noindex on purpose' : 'No noindex' },
  { id: 'canonical', group: 'advanced', label: 'Canonical link', codes: ['tech.canonical-missing', 'tech.canonical-mismatch'], pass: (p) => p.canonical, skip404: true },
  { id: 'sitemap', group: 'advanced', label: 'Listed in the sitemap', codes: ['tech.not-in-sitemap'], pass: () => 'sitemap.xml lists it', skip404: true },
  { id: 'og', group: 'advanced', label: 'Link preview (Open Graph)', codes: ['meta.og-missing'], pass: () => 'Title, description and image', skip404: true },
  { id: 'schema', group: 'advanced', label: 'Structured data', codes: ['schema.invalid', 'schema.org-missing', 'schema.article-suggest'], pass: (p) => p.schema.types.length ? p.schema.types.join(', ') : 'None needed on this page' },
  { id: 'escaping', group: 'advanced', label: 'Text in search results', codes: ['tech.double-escaped'], pass: () => 'Nothing escaped twice' },
  { id: 'placeholder', group: 'content', label: 'No sample or placeholder text', codes: ['content.placeholder'], pass: () => 'None found', skip404: true },
  { id: 'words', group: 'content', label: 'Amount of text', codes: ['content.thin'], pass: (p) => `${p.words} words in the main content`, skip404: true },
  { id: 'inbound', group: 'content', label: 'Linked from other pages', codes: ['link.orphan'], pass: (p) => p.file === 'index.html' ? 'Homepage' : p.inbound.length ? `From ${plural(p.inbound.length, 'page')}` : 'From the menu or footer', skip404: true },
  { id: 'broken', group: 'content', label: 'Links work', codes: ['tech.broken-links'], pass: (p) => p.linksOut.length ? `${plural(p.linksOut.length, 'internal link')}, none broken` : 'No internal links' },
  { id: 'redirect-links', group: 'content', label: 'Links go straight to the page', codes: ['link.via-redirect'], pass: () => 'No link goes through a redirect' },
  { id: 'img-dims', group: 'performance', label: 'Image width and height', codes: ['perf.img-dimensions'], pass: (p) => p.images ? 'Set on every image' : 'No images' },
  { id: 'img-size', group: 'performance', label: 'Image file sizes', codes: ['perf.img-size'], pass: (p) => p.images ? 'No image over 400 KB' : 'No images' },
];

export function pageChecklist(p: PageScan, found: Finding[], production = true): Check[] {
  const is404 = p.file === '404.html';
  return CHECKS.filter((c) => !(is404 && c.skip404)).map((c) => {
    const hits = found.filter((f) => c.codes.includes(f.code));
    if (!hits.length) {
      // on a preview build every page is noindex on purpose: say so instead of claiming it may be indexed
      if (c.id === 'indexable' && !production) return { id: c.id, group: c.group, label: c.label, status: 'info' as const, detail: 'Preview build: noindex on purpose. Audit a production build to check.', codes: c.codes };
      return { id: c.id, group: c.group, label: c.label, status: 'pass' as const, detail: c.pass(p), codes: c.codes };
    }
    const status = hits.map((f) => STATUS_OF[f.severity]).sort((x, y) => WORST.indexOf(x) - WORST.indexOf(y))[0];
    return { id: c.id, group: c.group, label: c.label, status, detail: hits.map((f) => f.evidence[0] ? `${f.title}: ${f.evidence[0]}` : f.title).join(' · '), codes: hits.map((f) => f.code) };
  });
}
