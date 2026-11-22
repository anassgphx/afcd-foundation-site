import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client, fakeRunner } from './helpers.ts';
import { runBuildAudit } from '../src/server/modules/seo/engine.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('Redirects', () => {
  let fail = false;
  beforeEach(async () => {
    fail = false;
    h = await makeApp({ runner: fakeRunner({ fail: () => fail }) });
    await addUser(h.db, 'seo@afcd.test', 'seo_manager'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'about.html'), '<h1>About</h1>');
    writeFileSync(join(h.siteRoot, 'projects.html'), '<h1>Projects</h1>');
  });

  it('checks redirects before they are saved', async () => {
    const seo = await client(h.app, 'seo@afcd.test');
    const check = async (source: string, destination: string) => (await seo.post('/seo/redirects/check', { source, destination })).body;
    expect((await check('about.html', 'projects.html')).errors[0]).toMatch(/real page/);
    expect((await check('index.html', 'about.html')).errors[0]).toMatch(/protected/);
    expect((await check('old.html', 'missing.html')).errors[0]).toMatch(/does not exist/);
    expect((await check('old.html', 'old.html')).errors[0]).toMatch(/itself/);
    expect((await check('old.html', 'https://example.org/x')).errors[0]).toMatch(/administrators/);
    expect((await check('old.html', 'about.html')).errors).toEqual([]);
    expect((await seo.post('/seo/redirects', { source: 'Old Page.html', destination: 'about.html' })).status).toBe(422);
    const a = await seo.post('/seo/redirects', { source: '/old.html', destination: 'about.html', code: 301 });
    expect(a.status).toBe(201); expect(a.body.source).toBe('old.html');
    expect((await seo.post('/seo/redirects', { source: 'old.html', destination: 'projects.html' })).status).toBe(422);   // duplicate
    expect((await check('older.html', 'old.html')).warnings[0]).toMatch(/chain/);
    expect((await check('about-us.html', 'old.html')).errors).toEqual([]);
  });

  it('publishes, verifies and removes redirect pages, never over a real page', async () => {
    const seo = await client(h.app, 'seo@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: r } = await seo.post('/seo/redirects', { source: 'old.html', destination: 'about.html', code: 301, reason: 'Renamed' });
    expect((await seo.post('/seo/redirects/publish')).status).toBe(403);   // editors draft, administrators publish
    expect(existsSync(join(h.siteRoot, 'old.html'))).toBe(false);
    const pub = await admin.post('/seo/redirects/publish');
    expect(pub.status).toBe(200); expect(pub.body).toMatchObject({ live: 1, removed: 0 });
    const stub = readFileSync(join(h.siteRoot, 'old.html'), 'utf8');
    expect(stub).toContain('<!-- studio-redirect -->'); expect(stub).toContain('url=about.html'); expect(stub).toContain('noindex');
    expect(readFileSync(join(h.siteRoot, '_redirects'), 'utf8')).toContain('/old.html /about.html 301');
    expect((await seo.get('/seo/redirects')).body[0]).toMatchObject({ status: 'active', live: true, pending: null });
    expect((await seo.raw("DELETE", `/seo/redirects/${r.id}`)).status).toBe(409);

    // the audit lists redirect pages separately and flags links that go through them
    writeFileSync(join(h.siteRoot, 'news.html'), '<html lang="en"><head><title>News</title></head><body><main><h1>News</h1><a href="old.html">x</a></main></body></html>');
    const audit = runBuildAudit(h.siteRoot);
    expect(audit.redirects).toEqual([{ file: 'old.html', to: 'about.html' }]);
    expect(audit.pages.some((p) => p.file === 'old.html')).toBe(false);
    expect(audit.findings.some((f) => f.code === 'link.via-redirect' && f.file === 'news.html')).toBe(true);

    // an edit stays a draft: the live redirect is unchanged until published again
    await seo.put(`/seo/redirects/${r.id}`, { source: 'old.html', destination: 'projects.html', code: 302 });
    expect((await seo.get('/seo/redirects')).body[0]).toMatchObject({ pending: 'edited' });
    expect(readFileSync(join(h.siteRoot, 'old.html'), 'utf8')).toContain('url=about.html');

    // a failed build restores the site as it was
    fail = true;
    expect((await admin.post('/seo/redirects/publish')).status).toBe(409);
    fail = false;
    expect(readFileSync(join(h.siteRoot, 'old.html'), 'utf8')).toContain('url=about.html');

    await admin.post('/seo/redirects/publish');
    expect(readFileSync(join(h.siteRoot, 'old.html'), 'utf8')).toContain('url=projects.html');

    // disable + publish removes the page and the _redirects file; then it can be deleted
    await seo.post(`/seo/redirects/${r.id}/disable`);
    expect((await admin.post('/seo/redirects/publish')).body).toMatchObject({ live: 0, removed: 1 });
    expect(existsSync(join(h.siteRoot, 'old.html'))).toBe(false);
    expect(existsSync(join(h.siteRoot, '_redirects'))).toBe(false);
    expect((await seo.raw("DELETE", `/seo/redirects/${r.id}`)).status).toBe(200);
    expect((await admin.post('/seo/redirects/publish')).status).toBe(409);   // nothing left to publish
  });

  it('refuses to publish when a page now exists at the old address', async () => {
    const seo = await client(h.app, 'seo@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    await seo.post('/seo/redirects', { source: 'old.html', destination: 'about.html' });
    writeFileSync(join(h.siteRoot, 'old.html'), '<h1>A real page</h1>');
    const r = await admin.post('/seo/redirects/publish');
    expect(r.status).toBe(422);
    expect(readFileSync(join(h.siteRoot, 'old.html'), 'utf8')).toBe('<h1>A real page</h1>');
  });
});
