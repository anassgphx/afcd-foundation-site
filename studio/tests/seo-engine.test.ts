import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { runBuildAudit } from '../src/server/modules/seo/engine.ts';
import { seoIssues } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const page = (file: string, o: { title?: string; desc?: string; canonical?: string; main: string; robots?: string; lang?: boolean; ld?: string }) =>
  `<!doctype html><html${o.lang === false ? '' : ' lang="en"'}><head><title>${o.title ?? 'A clear page title · AFCD Foundation'}</title><meta name="description" content="${o.desc ?? `A clear description of what ${file} offers, long enough to be useful in results.`}">` +
  `<link rel="canonical" href="${o.canonical ?? `https://afcdfoundation.org/${file === 'index.html' ? '' : file}`}"><meta name="robots" content="${o.robots ?? 'index, follow'}">` +
  `<meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i">${o.ld ?? ''}</head><body><header><a href="index.html">Home</a></header><main>${o.main}</main></body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

function site(dir: string, production: boolean) {
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'robots.txt'), production ? 'User-agent: *\nAllow: /\n' : 'User-agent: *\nDisallow: /\n');
  writeFileSync(join(dir, 'sitemap.xml'), '<urlset><url><loc>https://afcdfoundation.org/</loc></url><url><loc>https://afcdfoundation.org/a.html</loc></url><url><loc>https://afcdfoundation.org/gone.html</loc></url></urlset>');
  writeFileSync(join(dir, 'index.html'), page('index.html', { main: `<h1>Home</h1><p>${words(200)}</p><a href="a.html">A</a>`, ld: '<script type="application/ld+json">{"@type":"NGO"}</script>' }));
  writeFileSync(join(dir, 'a.html'), page('a.html', { title: 'A', robots: 'noindex, nofollow', canonical: 'https://afcdfoundation.org/other.html', lang: false, main: `<h1>One</h1><h1>Two</h1><h4>Deep</h4><p>Lorem ipsum dolor sit amet</p><img src="x.webp"><a href="missing.html">x</a>`, ld: '<script type="application/ld+json">{broken</script>' }));
  writeFileSync(join(dir, 'b.html'), page('b.html', { title: 'A', main: `<h1>B</h1><p>${words(200)}</p>` }));
}

describe('build audit engine v2', () => {
  it('reports findings with severity, evidence and separate scores', () => {
    const dir = join(process.env.TMPDIR ?? '/tmp', `seo-v2-${Date.now()}`); site(dir, true);
    const a = runBuildAudit(dir);
    const on = (file: string) => a.findings.filter((f) => f.file === file).map((f) => f.code).sort();
    expect(on('a.html')).toEqual(['content.h1-many', 'content.heading-skip', 'content.img-alt', 'content.placeholder', 'meta.title-dup',   // no 'thin' finding: the page is noindex
      'meta.title-vague', 'perf.img-dimensions',
      'schema.invalid', 'tech.broken-links', 'tech.canonical-mismatch', 'tech.lang-missing', 'tech.noindex'].sort());
    expect(a.findings.find((f) => f.code === 'tech.noindex')!.severity).toBe('critical');
    expect(a.findings.find((f) => f.code === 'tech.broken-links')!.evidence).toEqual(['Links to missing.html']);
    expect(a.findings.find((f) => f.code === 'tech.sitemap-ghost')!.evidence).toEqual(['Listed: gone.html']);
    expect(on('b.html')).toEqual(['link.orphan', 'meta.title-dup', 'meta.title-vague', 'tech.not-in-sitemap'].sort());
    expect(on('index.html')).toEqual([]);
    expect(Object.keys(a.scores).sort()).toEqual(['content', 'linking', 'metadata', 'overall', 'performance', 'structured', 'technical']);
    expect(a.findings.every((f) => f.why && f.fix && f.title)).toBe(true);
  });

  it('does not report noindex on a preview build, and says why', () => {
    const dir = join(process.env.TMPDIR ?? '/tmp', `seo-v2p-${Date.now()}`); site(dir, false);
    const a = runBuildAudit(dir);
    expect(a.production).toBe(false);
    expect(a.findings.some((f) => f.code === 'tech.noindex')).toBe(false);
    expect(a.findings.find((f) => f.code === 'site.preview-build')!.severity).toBe('info');
  });
});

describe('issue tracking', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'seo@afcd.test', 'seo_manager'); });

  it('opens, keeps, resolves on verification, and never lets critical issues be set aside', async () => {
    const seo = await client(h.app, 'seo@afcd.test');
    site(h.siteRoot, true);
    expect((await seo.post('/seo/audit')).status).toBe(200);
    const issues = (await seo.get('/seo/issues')).body as any[];
    const crit = issues.find((i) => i.code === 'tech.noindex'), low = issues.find((i) => i.code === 'content.heading-skip');
    expect(crit.rule.title).toBe('Page is set to noindex');
    expect((await seo.post(`/seo/issues/${crit.id}/review`, { reviewed: true })).status).toBe(409);
    expect((await seo.post(`/seo/issues/${low.id}/review`, { reviewed: true })).status).toBe(200);
    // fix the page, audit again: issues that are gone become resolved
    writeFileSync(join(h.siteRoot, 'a.html'), page('a.html', { title: 'About AFCD in Ait Ourir', main: `<h1>A</h1><p>${words(200)}</p><a href="b.html">b</a>` }));
    await seo.post('/seo/audit');
    const [c2] = await h.db.select().from(seoIssues).where(eq(seoIssues.id, crit.id));
    expect(c2.status).toBe('resolved'); expect(c2.resolvedAt).not.toBeNull();
    const audit = (await seo.get('/seo/audit')).body;
    expect(audit.last.kind).toBe('build');
    expect(audit.history.length).toBe(2);
  });
});
