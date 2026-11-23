// Projects list actions: duplicate as a new draft, and permanent delete of projects that are not on the website.
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, projectInput } from './helpers.ts';
import { articles, auditLog, projects } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('project duplicate and delete', () => {
  it('duplicates a project as a draft with a free address and the same content', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');
    const src = await ed.post('/projects', projectInput({ programObjectives: [{ title: 'Train teachers', text: 'In 12 schools.' }] }));
    expect(src.status).toBe(201);

    const a = await ed.post(`/projects/${src.body.id}/duplicate`);
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ name: 'Copy of Green Schools', slug: 'green-schools-copy', status: 'draft', publishedRevisionId: null });
    const b = await ed.post(`/projects/${src.body.id}/duplicate`);
    expect(b.body.slug).toBe('green-schools-copy-2');

    const copy = (await ed.get(`/projects/${a.body.id}`)).body;
    expect(copy.summary).toBe('Schools act on climate.');
    expect(copy.programObjectives).toEqual([{ title: 'Train teachers', text: 'In 12 schools.' }]);
    expect(copy.pillars.map((p: { key: string }) => p.key).sort()).toEqual(['green-thumbs', 'youth-empowerment']);
    expect(copy.objectiveRefs).toEqual(['SO-03']);

    const log = await h.db.select().from(auditLog).where(eq(auditLog.action, 'project.duplicate'));
    expect(log).toHaveLength(2);
    expect((await ed.post('/projects/00000000-0000-4000-8000-000000000000/duplicate')).status).toBe(404);
  });

  it('deletes only drafts and archived projects that are not live, for administrators', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    await addUser(h.db, 'boss@afcd.test', 'super_admin');
    const ed = await client(h.app, 'ed@afcd.test');
    const boss = await client(h.app, 'boss@afcd.test');
    const draft = (await ed.post('/projects', projectInput({ slug: 'to-delete', name: 'To delete' }))).body;

    expect((await ed.raw('DELETE', `/projects/${draft.id}`)).status).toBe(403);   // editors can't delete

    const review = (await ed.post('/projects', projectInput({ slug: 'in-review', name: 'In review' }))).body;
    expect((await ed.post(`/projects/${review.id}/transition`, { action: 'submit' })).status).toBe(200);
    const r1 = await boss.raw('DELETE', `/projects/${review.id}`);
    expect(r1.status).toBe(409); expect(r1.body.error).toMatch(/Withdraw it from review/);

    // a live project (published revision set) is refused until it is unpublished
    expect((await boss.post(`/projects/${review.id}/transition`, { action: 'approve' })).status).toBe(200);
    const [row] = await h.db.select().from(projects).where(eq(projects.id, review.id));
    await h.db.update(projects).set({ publishedRevisionId: row.approvedRevisionId, status: 'published' }).where(eq(projects.id, review.id));
    const r2 = await boss.raw('DELETE', `/projects/${review.id}`);
    expect(r2.status).toBe(409); expect(r2.body.error).toMatch(/on the website/);

    const ok = await boss.raw('DELETE', `/projects/${draft.id}`);
    expect(ok.status).toBe(200);
    expect(await h.db.select().from(projects).where(eq(projects.id, draft.id))).toHaveLength(0);
    expect((await boss.get(`/projects/${draft.id}`)).status).toBe(404);
    const [entry] = await h.db.select().from(auditLog).where(eq(auditLog.action, 'project.delete'));
    expect(entry).toMatchObject({ entityId: draft.id, summary: 'Deleted “To delete”' });

    // archived projects can be deleted too
    const old = (await ed.post('/projects', projectInput({ slug: 'old', name: 'Old' }))).body;
    expect((await boss.post(`/projects/${old.id}/transition`, { action: 'archive' })).status).toBe(200);
    expect((await boss.raw('DELETE', `/projects/${old.id}`)).status).toBe(200);
  });

  it('lists photo counts and photo issues per project', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    const ed = await client(h.app, 'ed@afcd.test');
    await ed.post('/projects', projectInput());
    const [p] = (await ed.get('/projects')).body;
    expect(p).toMatchObject({ photoCount: 0, photoIssues: 0 });
  });
});

describe('delete for the other content lists', () => {
  it('deletes draft and archived stories, events, opportunities, partners and publications, for publishers only', async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor');
    await addUser(h.db, 'boss@afcd.test', 'super_admin');
    const ed = await client(h.app, 'ed@afcd.test');
    const boss = await client(h.app, 'boss@afcd.test');
    const stamp = Date.now().toString(36);
    const made = {
      news: await ed.post('/news', { title: 'Draft story', slug: `s-${stamp}`, publishDate: '2026-11-01' }),
      events: await ed.post('/events', { title: 'Draft event', slug: `e-${stamp}`, startDate: '2026-12-01', registration: 'contact' }),
      opportunities: await ed.post('/opportunities', { title: 'Draft call', slug: `o-${stamp}`, applyMethod: 'contact' }),
      partners: await ed.post('/partners', { name: 'Draft Partner Org', slug: `p-${stamp}`, scope: 'national' }),
      publications: await ed.post('/publications', { title: 'Draft report', slug: `r-${stamp}` }),
    };
    for (const [kind, res] of Object.entries(made)) {
      expect(res.status, kind).toBe(201);
      expect((await ed.raw('DELETE', `/${kind}/${res.body.id}`)).status, kind).toBe(403);
    }
    // in review → refused until withdrawn
    await h.db.update(articles).set({ status: 'in_review' }).where(eq(articles.id, made.news.body.id));
    const r = await boss.raw('DELETE', `/news/${made.news.body.id}`);
    expect(r.status).toBe(409); expect(r.body.error).toMatch(/Withdraw/);
    expect((await boss.post(`/news/${made.news.body.id}/transition`, { action: 'archive' })).status).toBe(200);
    for (const [kind, res] of Object.entries(made)) {
      expect((await boss.raw('DELETE', `/${kind}/${res.body.id}`)).status, kind).toBe(200);
      expect((await boss.get(`/${kind}/${res.body.id}`)).status, kind).toBe(404);
    }
    const log = await h.db.select().from(auditLog);
    expect(log.filter((l) => l.action.endsWith('.delete')).map((l) => l.action).sort()).toEqual(['event.delete', 'opportunity.delete', 'partner.delete', 'publication.delete', 'story.delete']);
  });
});
