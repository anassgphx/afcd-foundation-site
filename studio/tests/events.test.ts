import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { events } from '../src/server/db/schema.ts';
import { isUpcoming } from '../src/server/modules/events/render.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const ev = (over: Record<string, unknown> = {}) => ({
  title: 'Climate & youth workshop', slug: 'climate-youth-workshop', kind: 'Workshop', summary: 'A morning of hands-on climate projects.', body: 'We meet at the community hall.',
  startDate: '2099-03-14', endDate: null, timeLabel: '10:00 – 13:00', location: 'Ait Ourir', online: false, pillarKey: 'green-thumbs', projectSlug: 'eco-citizen',
  posterMediaId: null, agenda: [{ title: '10:00 Welcome', text: 'Introductions' }], audience: ['Young people aged 16 to 25'], registration: 'contact', registrationUrl: '',
  recapArticleSlug: null, seoTitle: '', seoDescription: '', ...over,
});

describe('upcoming or past', () => {
  it('uses the last day of the event', () => {
    expect(isUpcoming({ startDate: '2026-11-20', endDate: '2026-11-22' }, '2026-11-22')).toBe(true);
    expect(isUpcoming({ startDate: '2026-11-20', endDate: null }, '2026-11-21')).toBe(false);
  });
});

describe('events', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  });

  it('validates input', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.post('/events', ev({ endDate: '2099-03-01' }))).status).toBe(422);
    expect((await ed.post('/events', ev({ registration: 'external', registrationUrl: '' }))).status).toBe(422);
    expect((await ed.post('/events', ev({ registration: 'external', registrationUrl: 'javascript:alert(1)' }))).status).toBe(422);
    expect((await ed.post('/events', ev({ title: '<b>x</b> event' }))).status).toBe(422);
    const { body } = await ed.post('/events', ev({ summary: '', location: '', timeLabel: '', pillarKey: null }));
    const submit = await ed.post(`/events/${body.id}/transition`, { action: 'submit' });
    expect(submit.status).toBe(422);
    expect(submit.body.details.length).toBe(4);
  });

  it('reviews, publishes, replaces the samples, and removes an event', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    // a sample page left by the site's own template must disappear once Studio owns the calendar
    writeFileSync(join(h.siteRoot, 'src/pages/event-bootcamp.html'), 'sample'); writeFileSync(join(h.siteRoot, 'event-bootcamp.html'), 'sample');
    const { status, body: e } = await ed.post('/events', ev());
    expect(status).toBe(201);
    expect((await ed.post(`/events/${e.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await ed.post(`/events/${e.id}/transition`, { action: 'approve' })).status).toBe(403);
    expect((await rev.post(`/events/${e.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await ed.post(`/events/${e.id}/publish`)).status).toBe(403);
    const pub = await admin.post(`/events/${e.id}/publish`);
    expect(pub.status).toBe(200);
    const data = JSON.parse(readFileSync(join(h.siteRoot, 'src/data/events.json'), 'utf8'));
    expect(data.events[0]).toMatchObject({ slug: 'climate-youth-workshop', title: 'Climate &amp; youth workshop', day: '14', mon: 'Mar', year: '2099', upcoming: true, sample: false,
      project: 'project-eco-citizen.html', pillar: 'green-thumbs', revision: pub.body.revisionId, registration: { mode: 'contact' }, agenda: [{ title: '10:00 Welcome', text: 'Introductions' }] });
    expect(readFileSync(join(h.siteRoot, 'event-climate-youth-workshop.html'), 'utf8')).toContain(`data-studio-event-rev="${pub.body.revisionId}"`);
    expect(existsSync(join(h.siteRoot, 'event-bootcamp.html'))).toBe(false);
    expect(existsSync(join(h.siteRoot, 'src/pages/event-bootcamp.html'))).toBe(false);

    expect((await admin.post(`/events/${e.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'event-climate-youth-workshop.html'))).toBe(false);
    expect(existsSync(join(h.siteRoot, 'src/data/events.json'))).toBe(false);   // no live events: the site's own list returns
    // a page of an event that is no longer live (e.g. left behind by a restore) is removed when no event is live either
    writeFileSync(join(h.siteRoot, 'src/pages/event-old-roadshow.html'), 'stale'); writeFileSync(join(h.siteRoot, 'event-old-roadshow.html'), 'stale');
    expect((await ed.post(`/events/${e.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await rev.post(`/events/${e.id}/transition`, { action: 'approve' })).status).toBe(200);
    expect((await admin.post(`/events/${e.id}/publish`)).status).toBe(200);
    writeFileSync(join(h.siteRoot, 'src/pages/event-old-roadshow.html'), 'stale');
    expect((await admin.post(`/events/${e.id}/unpublish`)).status).toBe(200);
    expect(existsSync(join(h.siteRoot, 'src/pages/event-old-roadshow.html'))).toBe(false);
    const [row] = await h.db.select().from(events).where(eq(events.id, e.id));
    expect(row.status).toBe('draft');
  });

  it('refuses to record a publish when the page lacks the revision marker', async () => {
    await h.close();
    const { fakeRunner } = await import('./helpers.ts');
    const base = fakeRunner();
    h = await makeApp({ runner: async (cfg, mode) => { const r = await base(cfg, mode); if (mode.kind === 'live') { const f = join(cfg.siteRoot, 'event-climate-youth-workshop.html'); if (existsSync(f)) writeFileSync(f, '<section>Sample event</section>'); } return r; } });
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: e } = await ed.post('/events', ev());
    await ed.post(`/events/${e.id}/transition`, { action: 'submit' }); await rev.post(`/events/${e.id}/transition`, { action: 'approve' });
    const r = await admin.post(`/events/${e.id}/publish`);
    expect(r.status).toBe(409);
    expect(r.body.error ?? r.body.message).toMatch(/revision/);
    const [row] = await h.db.select().from(events).where(eq(events.id, e.id));
    expect(row.publishedRevisionId).toBeNull();
    expect(existsSync(join(h.siteRoot, 'src/data/events.json'))).toBe(false);   // rolled back
  });
});
