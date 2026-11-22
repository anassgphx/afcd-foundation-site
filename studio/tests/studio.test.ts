import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN, PW, pngBytes, projectInput, fakeRunner } from './helpers.ts';
import { auditLog, projects, publishJobs } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('authentication and request security', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'ed@afcd.test', 'content_editor'); });

  it('rejects unauthenticated API access', async () => {
    expect((await h.app.request('/studio/api/projects')).status).toBe(401);
  });

  it('rejects a wrong password with a generic message and logs the failure', async () => {
    const r = await h.app.request('/studio/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'ed@afcd.test', password: 'nope' }) });
    expect(r.status).toBe(401);
    expect((await r.json()).error).toBe('Email or password is incorrect.');
    expect((await h.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login_failed'))).length).toBe(1);
  });

  it('locks out after repeated failures', async () => {
    const bad = () => h.app.request('/studio/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'ed@afcd.test', password: 'nope' }) });
    for (let i = 0; i < 5; i++) await bad();
    expect((await bad()).status).toBe(429);
  });

  it('sets an HttpOnly, SameSite=Strict session cookie scoped to /studio', async () => {
    const r = await h.app.request('/studio/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN }, body: JSON.stringify({ email: 'ed@afcd.test', password: PW }) });
    const c = r.headers.get('set-cookie')!;
    expect(c).toMatch(/HttpOnly/); expect(c).toMatch(/SameSite=Strict/); expect(c).toMatch(/Path=\/studio/);
  });

  it('blocks writes without the CSRF token or from another origin', async () => {
    const c = await client(h.app, 'ed@afcd.test');
    const noToken = await c.raw('POST', '/projects', projectInput(), { 'X-CSRF-Token': '' });
    expect(noToken.status).toBe(403);
    const otherOrigin = await c.raw('POST', '/projects', projectInput(), { Origin: 'https://evil.example' });
    expect(otherOrigin.status).toBe(403);
  });

  it('logout ends the session', async () => {
    const c = await client(h.app, 'ed@afcd.test');
    expect((await c.post('/auth/logout')).status).toBe(200);
    expect((await c.get('/projects')).status).toBe(401);
  });
});

describe('permissions are enforced on the server', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ro@afcd.test', 'read_only'); await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'seo@afcd.test', 'seo_manager');
  });

  it('read-only users cannot create projects or upload media', async () => {
    const c = await client(h.app, 'ro@afcd.test');
    expect((await c.post('/projects', projectInput())).status).toBe(403);
    expect((await c.get('/projects')).status).toBe(200);
  });

  it('editors cannot approve or publish', async () => {
    const c = await client(h.app, 'ed@afcd.test');
    const { body: p } = await c.post('/projects', projectInput());
    await c.post(`/projects/${p.id}/transition`, { action: 'submit' });
    expect((await c.post(`/projects/${p.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await c.post(`/projects/${p.id}/publish`)).status).toBe(403);
  });

  it('SEO managers can change SEO fields only', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    const { body: p } = await ed.post('/projects', projectInput());
    const seo = await client(h.app, 'seo@afcd.test');
    const r = await seo.put(`/projects/${p.id}`, projectInput({ name: 'Hijacked', seoTitle: 'Green Schools in Marrakech' }));
    expect(r.status).toBe(200);
    const [row] = await h.db.select().from(projects).where(eq(projects.id, p.id));
    expect(row.name).toBe('Green Schools'); expect(row.seoTitle).toBe('Green Schools in Marrakech');
  });
});

describe('create → review → approve → publish → edit → rollback', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  });

  it('runs the whole editorial workflow and delivers to the site', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');

    // Image upload + metadata
    const fd = new FormData(); fd.append('file', new File([await pngBytes()], 'school.png', { type: 'image/png' }));
    const up = await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } });
    expect(up.status).toBe(201);
    const img = await up.json();
    expect(existsSync(join(h.cfg.mediaDir, `${img.storageKey}-480.webp`))).toBe(true);

    const { status, body: p } = await ed.post('/projects', projectInput({ heroMediaId: img.id }));
    expect(status).toBe(201);

    // Not ready: image has no alt text / rights yet
    const blocked = await ed.post(`/projects/${p.id}/transition`, { action: 'submit' });
    expect(blocked.status).toBe(422);
    expect(JSON.stringify(blocked.body.details)).toMatch(/alt text/);
    await h.app.request(`/studio/api/media/${img.id}`, { method: 'PATCH', headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ alt: 'Pupils planting trees', rightsConfirmed: true }) });

    expect((await ed.post(`/projects/${p.id}/transition`, { action: 'submit' })).body.status).toBe('in_review');
    expect((await ed.put(`/projects/${p.id}`, projectInput())).status).toBe(409);            // locked while in review

    // Preview uses the working copy and never touches the live site
    const pv = await ed.post(`/projects/${p.id}/preview`);
    expect(pv.status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'project-green-schools.html'))).toBe(false);
    const page = await h.app.request(pv.body.url, { headers: { Cookie: ed.cookie } });
    expect(await page.text()).toContain('Green Schools');
    expect((await h.app.request(pv.body.url)).status).toBe(401);                           // previews need a session

    expect((await rev.post(`/projects/${p.id}/transition`, { action: 'request_changes', comment: '' })).status).toBe(422);
    expect((await rev.post(`/projects/${p.id}/transition`, { action: 'approve', comment: 'Looks right' })).body.status).toBe('approved');

    const pub = await admin.post(`/projects/${p.id}/publish`);
    expect(pub.status).toBe(200);
    const html = readFileSync(join(h.siteRoot, 'project-green-schools.html'), 'utf8');
    expect(html).toContain(`data-studio-rev="${pub.body.revisionId}"`);
    expect(readFileSync(join(h.siteRoot, 'projects.html'), 'utf8')).toContain('Green Schools');
    expect(existsSync(join(h.siteRoot, 'assets/media', `${img.storageKey}-480.webp`))).toBe(true);
    const exported = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/projects.json'), 'utf8'));
    expect(exported.projects.find((x: any) => x.slug === 'green-schools').pillars).toEqual(['green-thumbs', 'youth-empowerment']);
    expect(exported.projects.some((x: any) => x.slug === 'eco-citizen')).toBe(true);        // imported project kept

    // Editing a published project leaves the live page untouched
    await ed.put(`/projects/${p.id}`, projectInput({ heroMediaId: img.id, summary: 'A new summary.' }));
    const [row] = await h.db.select().from(projects).where(eq(projects.id, p.id));
    expect(row.status).toBe('draft'); expect(row.publishedRevisionId).toBe(pub.body.revisionId);
    expect(readFileSync(join(h.siteRoot, 'project-green-schools.html'), 'utf8')).toContain('Schools act on climate.');

    // Earlier revisions remain recoverable
    const detail = await ed.get(`/projects/${p.id}`);
    const first = detail.body.history.revisions.at(-1);
    expect((await ed.post(`/projects/${p.id}/revisions/${first.id}/restore`)).status).toBe(200);
    expect((await ed.get(`/projects/${p.id}`)).body.summary).toBe('Schools act on climate.');

    // Unpublish removes the page
    expect((await admin.post(`/projects/${p.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'project-green-schools.html'))).toBe(false);
  });

  it('authors cannot approve their own submission', async () => {
    await addUser(h.db, 'both@afcd.test', 'website_admin');
    const both = await client(h.app, 'both@afcd.test');
    const { body: p } = await both.post('/projects', projectInput());
    await both.post(`/projects/${p.id}/transition`, { action: 'submit' });
    const r = await both.post(`/projects/${p.id}/transition`, { action: 'approve' });
    expect(r.status).toBe(409);
  });

  it('only approved content can be published', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: p } = await ed.post('/projects', projectInput());
    expect((await admin.post(`/projects/${p.id}/publish`)).status).toBe(409);
  });
});

describe('delivery failures and escaping', () => {
  it('a failed build is reported, keeps the project unpublished and restores the live data', async () => {
    let fail = false;
    h = await makeApp({ runner: fakeRunner({ fail: () => fail }) });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer');
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: p } = await ed.post('/projects', projectInput());
    await ed.post(`/projects/${p.id}/transition`, { action: 'submit' });
    await rev.post(`/projects/${p.id}/transition`, { action: 'approve' });
    fail = true;
    const r = await admin.post(`/projects/${p.id}/publish`);
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/Publishing failed/);
    const [row] = await h.db.select().from(projects).where(eq(projects.id, p.id));
    expect(row.status).toBe('approved'); expect(row.publishedRevisionId).toBeNull();
    const [job] = await h.db.select().from(publishJobs);
    expect(job.status).toBe('failed');
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/projects.json'), 'utf8'));
    expect(data.projects.some((x: any) => x.slug === 'green-schools')).toBe(false);
  });

  it('escapes editor text so it cannot inject HTML into the public site', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer');
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: p } = await ed.post('/projects', projectInput({ name: 'Bad <script>alert(1)</script> & co', summary: '<img src=x onerror=alert(1)>' }));
    await ed.post(`/projects/${p.id}/transition`, { action: 'submit' });
    await rev.post(`/projects/${p.id}/transition`, { action: 'approve' });
    expect((await admin.post(`/projects/${p.id}/publish`)).status).toBe(200);
    const html = readFileSync(join(h.siteRoot, 'project-green-schools.html'), 'utf8');
    expect(html).not.toContain('<script>'); expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('refuses files that are not images', async () => {
    h = await makeApp(); await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');
    const fd = new FormData(); fd.append('file', new File(['<svg onload=alert(1)>'], 'x.png', { type: 'image/png' }));
    const r = await h.app.request('/studio/api/media', { method: 'POST', body: fd, headers: { Cookie: ed.cookie, Origin: ORIGIN, 'X-CSRF-Token': ed.csrf } });
    expect(r.status).toBe(422);
  });

  it('the import is idempotent', async () => {
    h = await makeApp();
    const { seed } = await import('../src/server/seed.ts');
    const { STRATEGY } = await import('./helpers.ts');
    const again = await seed(h.db, h.cfg, { strategy: STRATEGY });
    expect(again).toEqual({ pillars: 0, objectives: 0, projects: 0, skipped: 1, news: 0 });
  });
});
