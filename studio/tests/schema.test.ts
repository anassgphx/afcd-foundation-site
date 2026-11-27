import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makeApp, addUser, client } from './helpers.ts';
import { articleLd, eventLd, orgOverrides, settingsSchema, validateLd } from '../src/server/modules/seo/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const BODY = 'Twenty young people met in Ait Ourir for three days of workshops on climate action and local leadership.\n\nThey mapped waste points, interviewed residents and drafted three proposals for the commune, which the council will discuss in the spring.';
const story = { title: 'Climate camp in Ait Ourir', slug: 'climate-camp', excerpt: 'Three days of workshops on climate action.', body: BODY, type: 'event_recap',
  tags: ['Climate'], authorName: 'AFCD team', authorRole: '', publishDate: '2026-11-20', featured: false, externalUrl: '',
  heroMediaId: null, galleryMediaIds: [], pillarKeys: ['green-thumbs'], projectSlugs: ['eco-citizen'], seoTitle: '', seoDescription: '' };

describe('structured data builders', () => {
  it('keeps only filled-in organization fields and validates generated markup', () => {
    const s = settingsSchema.parse({ organization: { email: 'contact@afcdteam.com', telephone: '+212 663 618 536', sameAs: ['https://www.facebook.com/afcd.foundation'] } });
    // the public email and phone are accepted (older saved drafts keep parsing) but not published from here: Settings › Contact owns them
    expect(orgOverrides(s)).toEqual({ sameAs: ['https://www.facebook.com/afcd.foundation'] });
    expect(settingsSchema.safeParse({ organization: { taxID: '123' } }).success).toBe(false);   // no field for internal identifiers
    expect(settingsSchema.safeParse({ organization: { description: 'Too short' } }).success).toBe(false);
    expect(settingsSchema.safeParse({ organization: { sameAs: ['http://insecure.example'] } }).success).toBe(false);
    expect(settingsSchema.safeParse({ organization: { email: 'someone@gmail.com' } }).success).toBe(false);   // public addresses only
    expect(settingsSchema.parse({ organization: { email: 'Akaya@afcdteam.com' } }).organization.email).toBe('akaya@afcdteam.com');
    expect(validateLd({ '@type': 'Event', name: 'Sample event', startDate: '2027-01-01', location: { '@type': 'Place', name: 'x' } }).errors[0]).toMatch(/placeholder/);
    const art = articleLd({ ...story, seo: { title: '', description: '' }, type: 'Event recap' } as never, null)!;
    expect(art).toMatchObject({ '@type': 'Article', headline: 'Climate camp in Ait Ourir', datePublished: '2026-11-20', url: 'https://afcdfoundation.com/news-climate-camp.html' });
    expect(validateLd(art)).toEqual({ errors: [], warnings: ['No image: add a cover photo to the story.'] });
    const ev = eventLd({ title: 'Bootcamp', slug: 'bootcamp', summary: '', startDate: '2027-01-20', endDate: null, location: '', online: false, registration: 'none', registrationUrl: '' } as never, null);
    expect(validateLd(ev).errors).toContain('No location: add a place, or mark the event as online.');
    expect(eventLd({ title: 'Webinar', slug: 'web', summary: 'x', startDate: '2027-01-20', endDate: null, location: '', online: true, registration: 'none', registrationUrl: '' } as never, null))
      .toMatchObject({ eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode', location: { '@type': 'VirtualLocation' } });
  });
});

describe('Schema studio workflow', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'seo@afcd.test', 'seo_manager'); await addUser(h.db, 'ed@afcd.test', 'content_editor');
    await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    writeFileSync(join(h.siteRoot, 'src/pages/index.html'), '---\ntitle: AFCD Foundation\ndescription: Home.\n---\n<h1>Home</h1>');
  });

  it('reviews, publishes, verifies and removes structured data', async () => {
    const seo = await client(h.app, 'seo@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test'), ed = await client(h.app, 'ed@afcd.test');
    // a published story gets Article markup once the settings are live
    const { body: a } = await ed.post('/news', story);
    const s1 = await ed.post(`/news/${a.id}/transition`, { action: 'submit' }); const s2 = await rev.post(`/news/${a.id}/transition`, { action: 'approve' }); expect([s1.status, s2.status]).toEqual([200, 200]);
    expect((await admin.post(`/news/${a.id}/publish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'src/data/schema.json'))).toBe(false);   // nothing until settings are published

    expect((await seo.put('/seo/schema', { organization: { email: 'not an email' } })).status).toBe(422);
    const saved = await seo.put('/seo/schema', { organization: { email: 'contact@afcdteam.com', sameAs: ['https://www.instagram.com/afcd.foundation'] }, articles: true, events: true });
    expect(saved.status).toBe(200);
    expect(saved.body.generated).toHaveLength(1);
    expect(saved.body.generated[0]).toMatchObject({ kind: 'Article', file: 'news-climate-camp.html' });
    expect((await seo.post('/seo/schema/transition', { action: 'submit' })).status).toBe(200);
    expect((await seo.put('/seo/schema', { organization: {} })).status).toBe(409);          // locked while in review
    expect((await seo.post('/seo/schema/transition', { action: 'approve' })).status).toBe(403);
    expect((await rev.post('/seo/schema/transition', { action: 'request_changes' })).status).toBe(422);   // needs a comment
    expect((await rev.post('/seo/schema/transition', { action: 'approve' })).status).toBe(200);
    expect((await seo.post('/seo/schema/publish')).status).toBe(403);
    // the website build must read schema.json before anything can be published
    const blocked = await admin.post('/seo/schema/publish');
    expect(blocked.status).toBe(409); expect(blocked.body.error).toMatch(/build/);
    expect((await admin.get('/seo/schema')).body.buildSupport).toBe(false);
    writeFileSync(join(h.siteRoot, 'build.mjs'), "const SCHEMA_FILE = process.env.SCHEMA_JSON || 'src/data/schema.json';\n");
    expect((await admin.get('/seo/schema')).body.buildSupport).toBe(true);
    const pub = await admin.post('/seo/schema/publish');
    expect(pub.status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/schema.json'), 'utf8'));
    expect(data.organization).toEqual({ sameAs: ['https://www.instagram.com/afcd.foundation'] });   // email: from Settings › Contact, not here
    expect(data.pages['news-climate-camp.html'][0]['@type']).toBe('Article');
    expect(readFileSync(join(h.siteRoot, 'index.html'), 'utf8')).toContain(`<meta name="studio-schema-rev" content="${pub.body.revision}">`);
    expect(readFileSync(join(h.siteRoot, 'news-climate-camp.html'), 'utf8')).toContain('"@type":"Article"');

    // unpublishing the story removes its markup in the same delivery
    expect((await admin.post(`/news/${a.id}/unpublish`)).status).toBe(200);
    expect(JSON.parse(readFileSync(join(h.siteRoot, 'src/data/schema.json'), 'utf8')).pages).toEqual({});

    expect((await admin.post('/seo/schema/unpublish')).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'src/data/schema.json'))).toBe(false);
    expect(readFileSync(join(h.siteRoot, 'index.html'), 'utf8')).not.toContain('studio-schema-rev');
  });
});
