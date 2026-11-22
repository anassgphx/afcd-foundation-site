import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, fakeRunner } from './helpers.ts';
import { partners, publishJobs } from '../src/server/db/schema.ts';
import { importPartners } from '../src/server/modules/partners/import.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const SITE = [{ scope: 'International', names: ['Danish Youth Council', 'Embassy of Switzerland in Morocco'] }, { scope: 'Local', names: ['Commune of Ait Ourir'] }];
const partner = (over: Record<string, unknown> = {}) => ({ name: 'Green Atlas Network', slug: 'green-atlas-network', scope: 'national', category: 'Association', description: 'Co-runs climate workshops.', websiteUrl: 'https://example.org', sinceYear: 2024, current: true, logoMediaId: null, projectSlugs: ['eco-citizen'], sort: 500, provenance: 'Test', ...over });

describe('partners', () => {
  beforeEach(async () => {
    h = await makeApp({ partners: SITE });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  });

  it('imports the current list once, as published records, without inventing details', async () => {
    const admin = await client(h.app, 'admin@afcd.test');
    const { body: list } = await admin.get('/partners');
    expect(list.map((p: any) => p.name)).toEqual(['Danish Youth Council', 'Embassy of Switzerland in Morocco', 'Commune of Ait Ourir']);
    expect(list.every((p: any) => p.publishedRevisionId && !p.category && !p.websiteUrl && !p.logoMediaId)).toBe(true);
    expect(await importPartners(h.db, h.cfg, null, SITE)).toEqual({ imported: 0, skipped: 3 });
    expect((await (await client(h.app, 'ed@afcd.test')).post('/partners/import')).status).toBe(403);
  });

  it('blocks duplicate organisations and unsafe input', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.post('/partners', partner({ name: 'danish youth council', slug: 'dyc' }))).status).toBe(409);
    expect((await ed.post('/partners', partner({ websiteUrl: 'javascript:alert(1)' }))).status).toBe(422);
    expect((await ed.post('/partners', partner({ name: 'Bad <script>' }))).status).toBe(422);
  });

  it('reviews, publishes with verification, and removes a partner', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { status, body: p } = await ed.post('/partners', partner({ name: 'Green & Atlas' }));
    expect(status).toBe(201);
    expect((await ed.post(`/partners/${p.id}/publish`)).status).toBe(403);
    expect((await ed.post(`/partners/${p.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await ed.post(`/partners/${p.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await rev.post(`/partners/${p.id}/transition`, { action: 'approve' })).status).toBe(200);
    const pub = await admin.post(`/partners/${p.id}/publish`);
    expect(pub.status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/partners.json'), 'utf8'));
    const entry = data.partners.find((x: any) => x.slug === 'green-atlas-network');
    expect(entry).toMatchObject({ name: 'Green &amp; Atlas', scope: 'National', url: 'https://example.org', projects: [{ name: 'Eco Citizen', file: 'project-eco-citizen.html' }], revision: pub.body.revisionId });
    expect(data.partners).toHaveLength(4);
    expect(JSON.stringify(data)).not.toContain('Test');   // provenance stays internal
    expect(readFileSync(join(h.siteRoot, 'partners.html'), 'utf8')).toContain(`data-studio-partner-rev="${pub.body.revisionId}"`);

    expect((await admin.post(`/partners/${p.id}/unpublish`)).status).toBe(200);
    expect(readFileSync(join(h.siteRoot, 'partners.html'), 'utf8')).not.toContain('Green &amp; Atlas');
    const [row] = await h.db.select().from(partners).where(eq(partners.id, p.id));
    expect(row.status).toBe('draft');
  });

  it('leaves the live list alone when a build fails', async () => {
    let fail = false;
    await h.close();
    h = await makeApp({ partners: SITE, runner: fakeRunner({ fail: () => fail }) });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: p } = await ed.post('/partners', partner());
    await ed.post(`/partners/${p.id}/transition`, { action: 'submit' }); await rev.post(`/partners/${p.id}/transition`, { action: 'approve' });
    fail = true;
    expect((await admin.post(`/partners/${p.id}/publish`)).status).toBe(409);
    const [row] = await h.db.select().from(partners).where(eq(partners.id, p.id));
    expect(row.publishedRevisionId).toBeNull();
    expect((await h.db.select().from(publishJobs).where(eq(publishJobs.entityId, p.id)))[0].status).toBe('failed');
    expect(existsSync(join(h.siteRoot, 'src/data/partners.json')) ? JSON.parse(readFileSync(join(h.siteRoot, 'src/data/partners.json'), 'utf8')).partners.length : 3).toBe(3);
  });
});
