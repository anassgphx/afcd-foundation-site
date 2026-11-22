import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { auditSite } from '../src/server/modules/seo/audit.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const page = (title: string, desc: string, main: string, extra = '') =>
  `<!doctype html><html><head><title>${title}</title><meta name="description" content="${desc}"><link rel="canonical" href="https://afcdfoundation.org/x"><meta name="robots" content="index, follow, max-image-preview:large">${extra}</head><body><main>${main}</main></body></html>`;
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

describe('SEO audit', () => {
  it('finds real problems in built pages', () => {
    const dir = join(process.env.TMPDIR ?? '/tmp', `seo-audit-${Date.now()}`); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'good.html'), page('A good page title for the AFCD Foundation site', 'A clear description of what this page is about, long enough for search results to show it well.', `<h1>Good</h1><p>${words(200)}</p><img src="a.webp" alt="A photo"><a href="other.html">x</a>`));
    writeFileSync(join(dir, 'other.html'), page('A good page title for the AFCD Foundation site', 'Short.', `<h1>One</h1><h1>Two</h1><p>Lorem ipsum dolor sit amet</p><img src="b.webp"><a href="missing.html#top">broken</a>`, '<meta property="og:title" content="Mission &amp;amp; Values">'));
    writeFileSync(join(dir, 'sitemap.xml'), '<urlset><url><loc>https://afcdfoundation.org/good.html</loc></url></urlset>');
    const r = auditSite(dir);
    const good = r.pages.find((p) => p.file === 'good.html')!, other = r.pages.find((p) => p.file === 'other.html')!;
    expect(good.issues.map((i) => i.code)).toEqual(['dup-title']);
    expect(other.issues.map((i) => i.code).sort()).toEqual(['broken-links', 'desc-short', 'double-escaped', 'dup-title', 'h1-many', 'img-alt', 'not-in-sitemap', 'sample-content', 'thin'].sort());
    expect(other.score).toBeLessThan(good.score);
  });
});

describe('SEO overrides', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'seo@afcd.test', 'seo_manager'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/about.html'), '---\ntitle: About · AFCD Foundation\ndescription: About us.\nactive: about\n---\n<h1>About</h1>');
  });

  it('reviews, publishes, verifies and removes an override for a template page', async () => {
    const seo = await client(h.app, 'seo@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: list } = await seo.get('/seo/pages');
    expect(list.map((x: any) => x.file)).toContain('about.html');
    expect(list.find((x: any) => x.file === 'about.html').defaults.title).toBe('About · AFCD Foundation');
    expect((await seo.put('/seo/pages/about.html', { title: 'About <b>', description: '', noindex: false, imageMediaId: null })).status).toBe(422);
    const { body: o } = await seo.put('/seo/pages/about.html', { title: 'About AFCD Foundation & our work in Morocco', description: '', noindex: false, imageMediaId: null });
    expect((await seo.post(`/seo/overrides/${o.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await seo.post(`/seo/overrides/${o.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await rev.post(`/seo/overrides/${o.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await seo.post(`/seo/overrides/${o.id}/publish`)).status).toBe(403);
    const pub = await admin.post(`/seo/overrides/${o.id}/publish`);
    expect(pub.status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/seo.json'), 'utf8'));
    expect(data.pages['about.html']).toMatchObject({ title: 'About AFCD Foundation & our work in Morocco', revision: pub.body.revisionId });   // plain text; build.mjs escapes
    expect(readFileSync(join(h.siteRoot, 'about.html'), 'utf8')).toContain(`<meta name="studio-seo-rev" content="${pub.body.revisionId}">`);
    expect((await admin.post(`/seo/overrides/${o.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'src/data/seo.json'))).toBe(false);
    expect(readFileSync(join(h.siteRoot, 'about.html'), 'utf8')).not.toContain('studio-seo-rev');
    expect((await seo.post(`/seo/overrides/${o.id}/discard`)).status).toBe(200);
    expect((await seo.get('/seo/pages')).body.find((x: any) => x.file === 'about.html').override).toBeNull();
  });

  it('refuses overrides for pages Studio manages, and runs the audit', async () => {
    const seo = await client(h.app, 'seo@afcd.test');
    const r = await seo.put('/seo/pages/project-eco-citizen.html', { title: 'Eco Citizen project page', description: '', noindex: false, imageMediaId: null });
    expect(r.status).toBe(409);
    writeFileSync(join(h.siteRoot, 'about.html'), page('About', '', '<h1>About</h1>'));
    writeFileSync(join(h.siteRoot, 'project-eco-citizen.html'), page('Eco Citizen', 'x', '<h1>Eco Citizen</h1>'));
    const a = await seo.post('/seo/audit');
    expect(a.status).toBe(200);
    const about = a.body.pages.find((p: any) => p.file === 'about.html');
    expect(about.owner.kind).toBe('template');
    expect(a.body.pages.find((p: any) => p.file === 'project-eco-citizen.html')?.owner.kind).toBe('project');
    expect((await seo.get('/seo/audit')).body.history.length).toBe(1);
  });
});
