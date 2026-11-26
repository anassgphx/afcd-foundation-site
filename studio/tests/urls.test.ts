// Category/page addresses (lib/urls.mjs): the file ↔ address map, the production rewrite of built pages, and the SEO
// audit reading such a build (links, canonicals and the sitemap map back to the page files).
import { describe, it, expect } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileFromPath, prettifyAbsolute, prettifyHtml, prettyPath } from '../../lib/urls.mjs';
import { linkTarget, runBuildAudit } from '../src/server/modules/seo/engine.ts';

const SITE = 'https://afcdfoundation.com/';

describe('page addresses', () => {
  it('puts every kind of page under its category, without .html', () => {
    expect(prettyPath('index.html')).toBe('/');
    expect(prettyPath('about.html')).toBe('/about');
    expect(prettyPath('team.html')).toBe('/about/team');
    expect(prettyPath('careers.html')).toBe('/about/careers'); expect(fileFromPath('/about/careers')).toEqual({ lang: '', file: 'careers.html' });
    expect(prettyPath('womens-empowerment.html')).toBe('/pillars/womens-empowerment');
    expect(prettyPath('climate-justice.html', ['climate-justice'])).toBe('/pillars/climate-justice');   // a pillar added in Studio
    expect(prettyPath('project-cso-care.html')).toBe('/projects/cso-care');
    expect(prettyPath('news-journey-with-the-afcd-family.html')).toBe('/news/journey-with-the-afcd-family');
    expect(prettyPath('event-climate-advocacy-workshop-in-oujda.html')).toBe('/events/climate-advocacy-workshop-in-oujda');
    expect(prettyPath('publication-policy-paper.html')).toBe('/publications/policy-paper');
    expect(prettyPath('apply-green-fellows-2027.html')).toBe('/apply/green-fellows-2027');
    expect(fileFromPath('/fr/apply/green-fellows-2027')).toEqual({ lang: 'fr', file: 'apply-green-fellows-2027.html' });
    expect(prettyPath('opportunity-call-2026.html')).toBe('/opportunities/call-2026');
    expect(prettyPath('projects.html')).toBe('/projects');   // listings keep their section name
    expect(prettyPath('partners.html')).toBe('/partners');
  });

  it('maps addresses back to files, old style and new, in every language', () => {
    expect(fileFromPath('/')).toEqual({ lang: '', file: 'index.html' });
    expect(fileFromPath('/projects/cso-care')).toEqual({ lang: '', file: 'project-cso-care.html' });
    expect(fileFromPath('/fr/pillars/womens-empowerment/')).toEqual({ lang: 'fr', file: 'womens-empowerment.html' });
    expect(fileFromPath('/ar/')).toEqual({ lang: 'ar', file: 'index.html' });
    expect(fileFromPath('/about/team?x=1#top')).toEqual({ lang: '', file: 'team.html' });
    expect(fileFromPath('/project-cso-care.html')).toEqual({ lang: '', file: 'project-cso-care.html' });
    expect(fileFromPath('/a/b/c')).toBeNull();
    for (const f of ['index.html', 'team.html', 'womens-empowerment.html', 'project-cso-care.html', 'news-x.html', 'contact.html']) expect(fileFromPath(prettyPath(f))?.file).toBe(f);
  });

  it('rewrites a built page: links and assets root-relative, site URLs pretty, the file named in the head', () => {
    const page = `<html><head><link rel="canonical" href="${SITE}project-cso-care.html"><link rel="stylesheet" href="assets/styles.css?v=1">` +
      `<link rel="alternate" hreflang="fr" href="${SITE}fr/project-cso-care.html"><script type="application/ld+json">{"item":"${SITE}projects.html"}</script></head>` +
      `<body><a href="about.html#team">About</a> <a href="contact.html?topic=Volunteering">Volunteer</a> <a href="#top">Top</a> <a href="https://example.org/x.html">Out</a>` +
      `<a href="mailto:contact@afcdteam.com">Mail</a><img src="assets/media/a-480.webp" srcset="assets/media/a-480.webp 480w, assets/media/a-960.webp 960w">` +
      `<article data-href="project-eco-citizen.html"></article><div style="background:url(assets/img/x.webp)"></div></body></html>`;
    const out = prettifyHtml(page, { file: 'project-cso-care.html', site: SITE });
    expect(out).toContain(`<link rel="canonical" href="${SITE}projects/cso-care">`);
    expect(out).toContain(`hreflang="fr" href="${SITE}fr/projects/cso-care"`);
    expect(out).toContain(`"item":"${SITE}projects"`);
    expect(out).toContain('href="/assets/styles.css?v=1"');
    expect(out).toContain('href="/about#team"'); expect(out).toContain('href="/contact?topic=Volunteering"');
    expect(out).toContain('href="#top"'); expect(out).toContain('href="https://example.org/x.html"'); expect(out).toContain('href="mailto:contact@afcdteam.com"');
    expect(out).toContain('srcset="/assets/media/a-480.webp 480w, /assets/media/a-960.webp 960w"');
    expect(out).toContain('data-href="/projects/eco-citizen"'); expect(out).toContain('url(/assets/img/x.webp)');
    expect(out).toContain('<meta name="afcd-file" content="project-cso-care.html">');
    expect(prettifyHtml(out, { file: 'project-cso-care.html', site: SITE })).toBe(out);   // running it twice changes nothing
  });

  it('resolves a French page’s relative links inside /fr, and leaves Studio redirect pages alone', () => {
    const fr = prettifyHtml('<head></head><a href="about.html">À propos</a><a href="../team.html">EN</a><img src="../assets/a.webp">', { file: 'index.html', lang: 'fr', site: SITE });
    expect(fr).toContain('href="/fr/about"'); expect(fr).toContain('href="/about/team"'); expect(fr).toContain('src="/assets/a.webp"');
    const stub = '<!-- studio-redirect --><meta http-equiv="refresh" content="0; url=about.html"><a href="about.html">x</a>';
    expect(prettifyHtml(stub, { file: 'old.html', site: SITE })).toBe(stub);
    expect(prettifyAbsolute(`<loc>${SITE}</loc><loc>${SITE}fr/team.html</loc>`, SITE)).toBe(`<loc>${SITE}</loc><loc>${SITE}fr/about/team</loc>`);
  });
});

describe('the SEO audit reads a category/page build', () => {
  it('maps links, canonicals and the sitemap back to the files, so nothing is reported broken or mismatched', () => {
    expect(linkTarget('/projects/x#a')).toBe('project-x.html'); expect(linkTarget('/fr/about')).toBe('fr/about.html');
    expect(linkTarget('/assets/doc.pdf')).toBe('assets/doc.pdf'); expect(linkTarget('about.html')).toBe('about.html');
    const dir = join(process.env.TMPDIR ?? '/tmp', `seo-urls-${Date.now()}`); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
    const page = (file: string, body: string) => prettifyHtml(`<!doctype html><html lang="en"><head><title>${file} page title · AFCD Foundation</title>` +
      `<meta name="description" content="A clear description of ${file}, long enough to be useful in search results."><link rel="canonical" href="${SITE}${file === 'index.html' ? '' : file}">` +
      `<meta name="robots" content="index, follow"><meta property="og:title" content="t"><meta property="og:description" content="d"><meta property="og:image" content="i"></head>` +
      `<body><header><a href="index.html">Home</a><a href="about.html">About</a></header><main><h1>${file}</h1><p>${'word '.repeat(200)}</p>${body}</main></body></html>`, { file, site: SITE });
    writeFileSync(join(dir, 'robots.txt'), 'User-agent: *\nAllow: /\n');
    writeFileSync(join(dir, 'index.html'), page('index.html', '<a href="project-cso-care.html">CSO CARE</a><script type="application/ld+json">{"@type":"NGO"}</script>'));
    writeFileSync(join(dir, 'about.html'), page('about.html', '<a href="team.html">Team</a>'));
    writeFileSync(join(dir, 'team.html'), page('team.html', '<a href="about.html">About</a><a href="missing.html">Gone</a>'));
    writeFileSync(join(dir, 'project-cso-care.html'), page('project-cso-care.html', '<a href="index.html">Home</a>'));
    writeFileSync(join(dir, 'sitemap.xml'), prettifyAbsolute(['', 'about.html', 'team.html', 'project-cso-care.html'].map((f) => `<url><loc>${SITE}${f}</loc></url>`).join(''), SITE));
    const a = runBuildAudit(dir, new Date(), SITE);
    const p = a.pages.find((x) => x.file === 'project-cso-care.html')!;
    expect(p.url).toBe(`${SITE}projects/cso-care`); expect(p.canonical).toBe(p.url); expect(p.inSitemap).toBe(true);
    expect(p.inbound).toContain('index.html');
    expect(a.findings.filter((f) => ['tech.canonical-mismatch', 'tech.sitemap-ghost', 'tech.not-in-sitemap'].includes(f.code))).toEqual([]);
    const broken = a.findings.filter((f) => f.code === 'tech.broken-links');
    expect(broken.map((f) => [f.file, f.evidence])).toEqual([['team.html', ['Links to missing.html']]]);   // the one real broken link
  });
});
