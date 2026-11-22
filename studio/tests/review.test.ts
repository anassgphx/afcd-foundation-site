import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeApp, addUser, client } from './helpers.ts';
import { diff } from '../src/server/modules/review/queue.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const BODY = 'Twenty young people met in Ait Ourir for three days of workshops on climate action and local leadership.\n\nThey mapped waste points, interviewed residents and drafted three proposals for the commune.';
const story = { title: 'Test story for the queue', slug: 'queue-test', excerpt: 'Three days of workshops on climate action.', body: BODY, type: 'event_recap',
  tags: [], authorName: 'Test author', authorRole: '', publishDate: '2026-11-20', featured: false, externalUrl: '',
  heroMediaId: null, galleryMediaIds: [], pillarKeys: ['green-thumbs'], projectSlugs: [], seoTitle: '', seoDescription: '' };

describe('change list', () => {
  it('lists changed fields with readable paths', () => {
    expect(diff({ title: 'A', detail: { facts: [['Place', 'Rabat']] } }, { title: 'B', detail: { facts: [['Place', 'Rabat']] }, extra: 'new' }))
      .toEqual([{ path: 'title', before: 'A', after: 'B' }, { path: 'extra', before: null, after: 'new' }]);
    expect(diff(null, { a: 1 })).toEqual([{ path: 'a', before: null, after: '1' }]);
  });
});

describe('Approval Queue', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  });

  it('shows each person what needs them, blocks self-approval and explains the change', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: a } = await ed.post('/news', story);
    expect((await ed.post(`/news/${a.id}/transition`, { action: 'submit' })).status).toBe(200);

    const forRev = (await rev.get('/review-queue')).body;
    const item = forRev.find((x: { id: string }) => x.id === a.id);
    expect(item).toMatchObject({ type: 'story', status: 'in_review', canApprove: true, canPublish: false, own: false, blocked: null, href: `/studio/news/${a.id}`, api: `/news/${a.id}` });
    expect(item.submittedBy.name).toBe('ed');
    const forEd = (await ed.get('/review-queue')).body.find((x: { id: string }) => x.id === a.id);
    expect(forEd).toMatchObject({ own: true, canApprove: false });

    const d = (await rev.get(`/review-queue/story/${a.id}/diff`)).body;
    expect(d.kind).toBe('new');
    expect(d.changes.map((c: { path: string }) => c.path)).toEqual(expect.arrayContaining(['title']));
    expect((await rev.get('/review-queue/nope/x/diff')).status).toBe(404);

    // an admin who submits their own change sees why they cannot approve it
    const { body: b } = await admin.post('/news', { ...story, title: 'Admin story', slug: 'admin-story' });
    await admin.post(`/news/${b.id}/transition`, { action: 'submit' });
    const own = (await admin.get('/review-queue')).body.find((x: { id: string }) => x.id === b.id);
    expect(own).toMatchObject({ own: true, canApprove: false });
    expect(own.blocked).toMatch(/Someone else must review/);

    // approved items become publishable for roles that may publish
    await rev.post(`/news/${a.id}/transition`, { action: 'approve' });
    expect((await admin.get('/review-queue')).body.find((x: { id: string }) => x.id === a.id)).toMatchObject({ status: 'approved', canPublish: true });
    expect((await rev.get('/review-queue')).body.find((x: { id: string }) => x.id === a.id)).toMatchObject({ status: 'approved', canPublish: false });
    expect((await (await client(h.app, 'ed@afcd.test')).get('/review-queue')).status).toBe(200);
  });
});
