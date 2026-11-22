// SEO audit of the built public site (the root *.html files the build produced). Read-only: it reports what search
// engines and link previews actually see, and says where each page is edited.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export type Issue = { level: 'error' | 'warning'; code: string; message: string };
export type PageReport = {
  file: string; title: string; description: string; h1: string; noindex: boolean; inSitemap: boolean; words: number;
  ogImage: string; issues: Issue[]; score: number;
};

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
export const decode = (s: string) => s.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+\d*);/gi, (m, e: string) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? m);
const attr = (tag: string, name: string) => tag.match(new RegExp(`\\s${name}="([^"]*)"`, 'i'))?.[1] ?? null;
const meta = (html: string, key: string, by = 'name') => { const t = html.match(new RegExp(`<meta[^>]*${by}="${key}"[^>]*>`, 'i'))?.[0]; return t ? attr(t, 'content') : null; };
const textOf = (html: string) => decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

export const LIMITS = { title: [30, 65], description: [70, 160], words: 150 } as const;

export function auditSite(siteRoot: string): { pages: PageReport[]; score: number; counts: { errors: number; warnings: number }; at: string } {
  const files = readdirSync(siteRoot).filter((f) => f.endsWith('.html')).sort();
  const sitemapXml = existsSync(resolve(siteRoot, 'sitemap.xml')) ? readFileSync(resolve(siteRoot, 'sitemap.xml'), 'utf8') : '';
  const inMap = new Set([...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => { const u = m[1].replace(/^https?:\/\/[^/]+\//, ''); return u === '' ? 'index.html' : u; }));
  const pages: PageReport[] = files.map((file) => {
    const html = readFileSync(resolve(siteRoot, file), 'utf8');
    const main = html.match(/<main[\s\S]*?<\/main>/i)?.[0] ?? html;
    const rawTitle = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '';
    const title = decode(rawTitle).trim(), description = decode(meta(html, 'description') ?? '').trim();
    const robots = meta(html, 'robots') ?? '';
    const noindex = /noindex/i.test(robots) && !/max-image-preview/.test(robots) ? true : /noindex/i.test(robots);
    const h1s = [...main.matchAll(/<h1\b[\s\S]*?<\/h1>/gi)].map((m) => textOf(m[0]));
    const words = textOf(main).split(' ').filter(Boolean).length;
    const issues: Issue[] = [];
    const add = (level: Issue['level'], code: string, message: string) => issues.push({ level, code, message });
    if (!title) add('error', 'title-missing', 'The page has no title.');
    else if (title.length < LIMITS.title[0]) add('warning', 'title-short', `Title is short (${title.length} characters). Aim for ${LIMITS.title[0]}–${LIMITS.title[1]}.`);
    else if (title.length > LIMITS.title[1]) add('warning', 'title-long', `Title is long (${title.length} characters); search results may cut it after about ${LIMITS.title[1]}.`);
    if (!description) add('error', 'desc-missing', 'The page has no meta description.');
    else if (description.length < LIMITS.description[0]) add('warning', 'desc-short', `Description is short (${description.length} characters). Aim for ${LIMITS.description[0]}–${LIMITS.description[1]}.`);
    else if (description.length > LIMITS.description[1]) add('warning', 'desc-long', `Description is long (${description.length} characters); it will be cut after about ${LIMITS.description[1]}.`);
    if (file !== '404.html') {
      if (h1s.length === 0) add('error', 'h1-missing', 'The page has no main heading (h1).');
      if (h1s.length > 1) add('warning', 'h1-many', `The page has ${h1s.length} main headings (h1); use one.`);
      if (!/<link rel="canonical"/.test(html)) add('error', 'canonical-missing', 'No canonical link.');
    }
    if (/&amp;(?:amp|lt|gt|quot|#\d+);/.test(html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? '')) add('error', 'double-escaped', 'A title or description is escaped twice (shows “&amp;” in search results or link previews).');
    const noAlt = [...main.matchAll(/<img\b[^>]*>/gi)].filter((m) => attr(m[0], 'alt') === null).length;
    if (noAlt) add('warning', 'img-alt', `${noAlt} image(s) have no alt attribute.`);
    const broken = new Set<string>();
    for (const m of main.matchAll(/<a\b[^>]*\shref="([^"]+)"/gi)) {
      const href = m[1];
      if (/^(https?:|mailto:|tel:|#|javascript:)/i.test(href) || href === '') continue;
      const path = decode(href).split(/[?#]/)[0];
      if (path && !existsSync(resolve(siteRoot, path))) broken.add(path);
    }
    if (broken.size) add('error', 'broken-links', `Links to missing pages: ${[...broken].slice(0, 6).join(', ')}${broken.size > 6 ? '…' : ''}`);
    if (/lorem ipsum|consectetur adipiscing|sample event|placeholder/i.test(textOf(main))) add('warning', 'sample-content', 'Shows sample or placeholder text.');
    if (file !== '404.html' && !noindex && words < LIMITS.words) add('warning', 'thin', `Little text on the page (${words} words).`);
    const sitemapNoindex = !/max-image-preview/.test(robots) && /noindex/.test(robots);   // preview builds are noindex everywhere
    if (file !== '404.html' && !sitemapNoindex) { if (!inMap.has(file)) add('warning', 'not-in-sitemap', 'Not listed in sitemap.xml.'); }
    const errors = issues.filter((i) => i.level === 'error').length, warnings = issues.length - errors;
    return { file, title, description, h1: h1s[0] ?? '', noindex: sitemapNoindex, inSitemap: inMap.has(file), words, ogImage: meta(html, 'og:image', 'property') ?? '',
      issues, score: Math.max(0, 100 - errors * 15 - warnings * 5) };
  });
  // duplicates across pages
  for (const [key, label] of [['title', 'title'], ['description', 'description']] as const) {
    const seen = new Map<string, string[]>();
    for (const p of pages) if (p[key]) seen.set(p[key], [...(seen.get(p[key]) ?? []), p.file]);
    for (const [, fs] of seen) if (fs.length > 1) for (const f of fs) {
      const p = pages.find((x) => x.file === f)!;
      p.issues.push({ level: key === 'title' ? 'error' : 'warning', code: `dup-${key}`, message: `Same ${label} as ${fs.filter((x) => x !== f).join(', ')}.` });
      p.score = Math.max(0, p.score - (key === 'title' ? 15 : 5));
    }
  }
  const counts = { errors: pages.reduce((n, p) => n + p.issues.filter((i) => i.level === 'error').length, 0), warnings: pages.reduce((n, p) => n + p.issues.filter((i) => i.level === 'warning').length, 0) };
  return { pages, score: pages.length ? Math.round(pages.reduce((n, p) => n + p.score, 0) / pages.length) : 0, counts, at: new Date().toISOString() };
}
