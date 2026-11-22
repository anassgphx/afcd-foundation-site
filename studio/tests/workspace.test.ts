import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeApp, addUser, client, projectInput } from './helpers.ts';
import { formSubmissions } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('top bar search and notifications', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ed@afcd.test', 'content_editor'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'media@afcd.test', 'media_manager');
  });

  it('searches titles across modules, treats % and _ literally, and needs 2 characters', async () => {
    const ed = await client(h.app, 'ed@afcd.test');
    expect((await ed.get('/search?q=eco')).body.map((x: any) => [x.kind, x.title])).toContainEqual(['Project', 'Eco Citizen']);
    expect((await ed.get('/search?q=e')).body).toEqual([]);
    expect((await ed.get('/search?q=%25')).body).toEqual([]);
  });

  it('tells reviewers what waits for them and authors what came back, never their own submission', async () => {
    const ed = await client(h.app, 'ed@afcd.test'), rev = await client(h.app, 'rev@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    const { body: p } = await ed.post('/projects', projectInput());
    expect((await ed.post(`/projects/${p.id}/transition`, { action: 'submit' })).status).toBe(200);
    expect((await ed.get('/notifications')).body.filter((n: any) => n.kind === 'review')).toHaveLength(0);
    const notes = (await rev.get('/notifications')).body;
    expect(notes.find((n: any) => n.kind === 'review')).toMatchObject({ title: 'Project: Green Schools', href: `/studio/projects/${p.id}` });
    expect((await rev.post(`/projects/${p.id}/transition`, { action: 'request_changes', comment: 'Add results.' })).status).toBe(200);
    expect((await ed.get('/notifications')).body.find((n: any) => n.kind === 'changes')).toBeTruthy();
    // form messages: administrators only
    await h.db.insert(formSubmissions).values({ formKey: 'contact', email: 'x@example.org', name: 'X', status: 'new' });
    expect((await admin.get('/notifications')).body.find((n: any) => n.kind === 'forms').title).toBe('1 new contact message');
    expect((await rev.get('/notifications')).body.find((n: any) => n.kind === 'forms')).toBeUndefined();
  });
});
