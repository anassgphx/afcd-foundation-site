// Inbox: triage of website messages, privacy (permissions, audit of views/exports), subscribers, retention, migration.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { makeApp, addUser, client } from './helpers.ts';
import { auditLog, formSubmissions, newsletterSubscribers, submissionEvents, users } from '../src/server/db/schema.ts';
import { MIGRATIONS } from '../src/server/db/client.ts';
import { purgeExpired } from '../src/server/modules/forms/service.ts';
import { notifications } from '../src/server/modules/workspace/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); h = undefined as never; });

const SITE = 'http://localhost:4321';
let ipN = 0;
const send = (key: string, body: unknown) => h.app.request(`/forms/v1/${key}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: SITE, 'X-Forwarded-For': `203.0.113.${++ipN % 250}` }, body: JSON.stringify(body),
});
const msg = (over: Record<string, unknown> = {}) => ({ topic: 'Volunteering', name: 'Test Person', email: 'test.person@example.org', phone: '', org: '', message: 'Fake test message about the community day.', consent: true, website: '', t: 9000, ...over });

async function setup() {
  h = await makeApp();
  await addUser(h.db, 'admin@afcd.test', 'website_admin');
  await addUser(h.db, 'admin2@afcd.test', 'super_admin');
  await addUser(h.db, 'ed@afcd.test', 'content_editor');
  return { admin: await client(h.app, 'admin@afcd.test'), admin2: await client(h.app, 'admin2@afcd.test'), ed: await client(h.app, 'ed@afcd.test') };
}
const idOf = async (email: string) => (await h.db.select().from(users).where(eq(users.email, email)))[0].id;

describe('inbox access and privacy', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { c = await setup(); });

  it('is closed to roles without forms.read', async () => {
    await send('contact', msg());
    const [m] = await h.db.select().from(formSubmissions);
    for (const p of ['/inbox/summary', '/inbox/unread', '/inbox/messages', `/inbox/messages/${m.id}`, '/inbox/subscribers', '/inbox/export.csv', '/inbox/people']) expect((await c.ed.get(p)).status, p).toBe(403);
    expect((await c.ed.post('/inbox/flag', { ids: [m.id], flag: 'archive' })).status).toBe(403);
    expect((await c.admin.get('/inbox/summary')).status).toBe(200);
  });

  it('shows new mail as unread, marks it read when opened, and logs each view once', async () => {
    await send('contact', msg());
    expect((await c.admin.get('/inbox/unread')).body).toEqual({ unread: 1 });
    const { body: list } = await c.admin.get('/inbox/messages?view=unread');
    expect(list.total).toBe(1);
    expect(list.rows[0]).toMatchObject({ name: 'Test Person', topic: 'Volunteering', unread: true, starred: false, status: 'new' });
    expect(list.rows[0].preview).toContain('community day');
    const note = (await notifications(h.db, { id: await idOf('admin@afcd.test'), role: 'website_admin' })).find((n) => n.kind === 'forms');
    expect(note).toMatchObject({ title: '1 unread message in the Inbox', href: '/studio/inbox?view=unread' });

    const id = list.rows[0].id;
    const { body: m } = await c.admin.get(`/inbox/messages/${id}`);
    expect(m).toMatchObject({ message: 'Fake test message about the community day.', page: 'contact.html', unread: false });
    await c.admin.get(`/inbox/messages/${id}`);
    expect((await c.admin.get('/inbox/unread')).body).toEqual({ unread: 0 });
    const views = await h.db.select().from(auditLog).where(eq(auditLog.action, 'inbox.view'));
    expect(views).toHaveLength(1);   // the second open within 30 minutes is not logged again
    expect((await notifications(h.db, { id: await idOf('admin@afcd.test'), role: 'website_admin' })).some((n) => n.kind === 'forms')).toBe(false);
    expect((await c.admin.post('/inbox/flag', { ids: [id], flag: 'unread' })).body).toEqual({ changed: 1 });
    expect((await c.admin.get('/inbox/unread')).body).toEqual({ unread: 1 });
  });

  it('exports CSV for admins only, neutralises formulas, and logs the export without content', async () => {
    await send('contact', msg({ message: '=HYPERLINK("http://x")' }));
    const res = await h.app.request('/studio/api/inbox/export.csv?view=all', { headers: { Cookie: c.admin.cookie } });
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const csv = await res.text();
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv.split('\r\n')[0]).toContain('received_at,status,topic,name,email');
    const [log] = await h.db.select().from(auditLog).where(eq(auditLog.action, 'inbox.export'));
    expect(log.summary).toBe('Exported 1 contact message(s) as CSV');
    const all = JSON.stringify(await h.db.select().from(auditLog));
    expect(all).not.toContain('HYPERLINK');
    expect(all).not.toContain('test.person@example.org');
  });
});

describe('inbox triage', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { c = await setup(); });

  it('assigns to teammates who can see the inbox, changes status, and keeps an activity history', async () => {
    await send('contact', msg());
    const [{ id }] = await h.db.select().from(formSubmissions);
    const admin2 = await idOf('admin2@afcd.test');
    const { body: people } = await c.admin.get('/inbox/people');
    expect(people.map((p: { name: string }) => p.name).sort()).toEqual(['admin', 'admin2']);   // not the editor
    expect((await c.admin.raw('PATCH', `/inbox/messages/${id}`, { assignedTo: await idOf('ed@afcd.test') })).status).toBe(422);
    expect((await c.admin.raw('PATCH', `/inbox/messages/${id}`, { assignedTo: admin2, status: 'in_progress' })).status).toBe(200);
    expect((await c.admin2.get('/inbox/messages?view=mine')).body.total).toBe(1);
    expect((await c.admin.get('/inbox/messages?view=mine')).body.total).toBe(0);
    expect((await c.admin.post(`/inbox/messages/${id}/reply`)).status).toBe(200);
    expect((await c.admin.raw('PATCH', `/inbox/messages/${id}`, { status: 'replied' })).status).toBe(200);
    expect((await c.admin.post(`/inbox/messages/${id}/notes`, { body: 'Fake note: called back on Monday.' })).status).toBe(200);
    expect((await c.admin.post(`/inbox/messages/${id}/notes`, { body: '  ' })).status).toBe(422);
    expect((await c.admin.raw('PATCH', `/inbox/messages/${id}`, { status: 'closed' })).status).toBe(200);
    const { body: m } = await c.admin.get(`/inbox/messages/${id}`);
    expect(m.status).toBe('closed');
    expect(m.closedAt).toBeTruthy();
    expect(m.assigneeName).toBe('admin2');
    expect(m.events.map((e: { kind: string }) => e.kind)).toEqual(['status', 'assign', 'reply', 'status', 'note', 'status']);
    const noteEv = m.events.find((e: { kind: string }) => e.kind === 'note');
    expect(noteEv).toMatchObject({ body: 'Fake note: called back on Monday.', actorName: 'admin' });
    // only the author can delete their note
    expect((await c.admin2.raw('DELETE', `/inbox/messages/${id}/notes/${noteEv.id}`)).status).toBe(403);
    expect((await c.admin.raw('DELETE', `/inbox/messages/${id}/notes/${noteEv.id}`)).status).toBe(200);
    expect(JSON.stringify(await h.db.select().from(auditLog))).not.toContain('called back');
  });

  it('stars per person, and moves messages between inbox, archive and spam', async () => {
    await send('contact', msg({ name: 'Test Alpha', topic: 'Partnership', message: 'Fake partnership idea.' }));
    await send('contact', msg({ name: 'Test Beta', message: 'Fake volunteering question.' }));
    const { body: all } = await c.admin.get('/inbox/messages?sort=oldest');
    expect(all.rows.map((r: { name: string }) => r.name)).toEqual(['Test Alpha', 'Test Beta']);
    const [a, b] = all.rows.map((r: { id: string }) => r.id);
    await c.admin.post(`/inbox/messages/${a}/star`, { starred: true });
    expect((await c.admin.get('/inbox/messages?view=starred')).body.total).toBe(1);
    expect((await c.admin2.get('/inbox/messages?view=starred')).body.total).toBe(0);
    expect((await c.admin.get('/inbox/messages?topic=Partnership')).body.total).toBe(1);
    expect((await c.admin.get('/inbox/messages?q=volunteering%20question')).body.rows[0].name).toBe('Test Beta');
    expect((await c.admin.get('/inbox/messages?q=100%25')).body.total).toBe(0);   // wildcards are literal

    await c.admin.post('/inbox/flag', { ids: [a], flag: 'archive' });
    await c.admin.post('/inbox/flag', { ids: [b], flag: 'spam' });
    const { body: s } = await c.admin.get('/inbox/summary');
    expect(s.views.all.total).toBe(0);
    expect(s.views.archived.total).toBe(1);
    expect(s.views.spam.total).toBe(1);
    expect(s.views.starred.total).toBe(1);   // starred stays visible while archived
    expect((await h.db.select().from(formSubmissions).where(eq(formSubmissions.id, b)))[0].spamReason).toBe('manual');
    await c.admin.post('/inbox/flag', { ids: [a, b], flag: 'unarchive' });
    await c.admin.post('/inbox/flag', { ids: [b], flag: 'not_spam' });
    expect((await c.admin.get('/inbox/summary')).body.views.all.total).toBe(2);
    expect((await c.admin.post('/inbox/delete', { ids: [a, b] })).body).toEqual({ deleted: 2 });
    expect(await h.db.select().from(submissionEvents)).toHaveLength(0);   // history goes with the message
  });

  it('puts honeypot submissions in Spam with the reason', async () => {
    await send('contact', msg({ website: 'http://spam.example' }));
    const { body } = await c.admin.get('/inbox/messages?view=spam');
    expect(body.rows[0]).toMatchObject({ spam: true, spamReason: 'honeypot' });
    expect((await c.admin.get('/inbox/unread')).body).toEqual({ unread: 0 });
  });
});

describe('newsletter subscribers and retention', () => {
  let c: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { c = await setup(); });

  it('lists, unsubscribes and exports only subscribed addresses', async () => {
    await send('newsletter', { email: 'fake.one@example.org', website: '', t: 5000, page: '/index.html' });
    await send('newsletter', { email: 'fake.two@example.org', website: '', t: 5000, page: '/news.html' });
    const { body } = await c.admin.get('/inbox/subscribers');
    expect(body.counts).toEqual({ subscribed: 2, unsubscribed: 0 });
    const one = body.rows.find((r: { email: string }) => r.email === 'fake.one@example.org');
    expect((await c.ed.post(`/inbox/subscribers/${one.id}/unsubscribe`)).status).toBe(403);
    expect((await c.admin.post(`/inbox/subscribers/${one.id}/unsubscribe`)).status).toBe(200);
    expect((await c.admin.get('/inbox/subscribers?status=unsubscribed')).body.rows).toHaveLength(1);
    const csv = await (await h.app.request('/studio/api/inbox/subscribers/export.csv', { headers: { Cookie: c.admin.cookie } })).text();
    expect(csv).toContain('fake.two@example.org');
    expect(csv).not.toContain('fake.one@example.org');
    // sign-ups are not messages to answer: they never count as unread
    expect((await c.admin.get('/inbox/unread')).body).toEqual({ unread: 0 });
    expect(await h.db.select().from(newsletterSubscribers)).toHaveLength(2);
  });

  it('deletes closed messages after the chosen number of months, and validates the setting', async () => {
    expect((await c.admin.put('/inbox/settings/contact', { enabled: true, retentionDays: 365, closedRetentionMonths: 0 })).status).toBe(422);
    expect((await c.admin.put('/inbox/settings/contact', { enabled: true, retentionDays: 365, closedRetentionMonths: 3 })).status).toBe(200);
    await send('contact', msg({ name: 'Test Closed' }));
    await send('contact', msg({ name: 'Test Open' }));
    const old = new Date(Date.now() - 100 * 864e5);
    await h.db.update(formSubmissions).set({ createdAt: old });
    await h.db.update(formSubmissions).set({ status: 'closed', closedAt: old }).where(eq(formSubmissions.name, 'Test Closed'));
    expect(await purgeExpired(h.db)).toBe(1);
    expect((await h.db.select().from(formSubmissions)).map((r) => r.name)).toEqual(['Test Open']);
    expect((await c.admin.get('/inbox/summary')).body.forms.find((f: { key: string }) => f.key === 'contact').settings.closedRetentionMonths).toBe(3);
  });
});

describe('0015_inbox migration', () => {
  it('moves legacy statuses and notes, and the recovery script restores the old shape', async () => {
    // a migrations folder that stops at 0014, to create the database as it was before the Inbox
    const dir = mkdtempSync(join(tmpdir(), 'studio-mig-'));
    cpSync(MIGRATIONS, dir, { recursive: true });
    const j = JSON.parse(readFileSync(join(dir, 'meta/_journal.json'), 'utf8'));
    j.entries = j.entries.filter((e: { idx: number }) => e.idx < 15);   // everything before 0015 (later migrations too are left out)
    writeFileSync(join(dir, 'meta/_journal.json'), JSON.stringify(j));
    const pg = new PGlite();
    const db = drizzle(pg);
    await migrate(db, { migrationsFolder: dir });
    await pg.exec(`insert into form_submissions (form_key, name, email, status, note) values
      ('contact', 'Fake New', 'n@example.org', 'new', ''), ('contact', 'Fake Done', 'd@example.org', 'done', 'Fake legacy note'),
      ('contact', 'Fake Spam', 's@example.org', 'spam', ''), ('newsletter', '', 'l@example.org', 'done', '')`);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const rows = (await pg.query<{ name: string; status: string; spam: boolean; read_at: string | null; closed_at: string | null }>('select name, status, spam, read_at, closed_at from form_submissions order by name')).rows;
    expect(rows.map((r) => [r.name, r.status, r.spam, !!r.read_at])).toEqual([
      ['', 'closed', false, true], ['Fake Done', 'closed', false, true], ['Fake New', 'new', false, false], ['Fake Spam', 'new', true, false]]);
    expect((await pg.query<{ body: string }>(`select body from submission_events where kind = 'note'`)).rows).toEqual([{ body: 'Fake legacy note' }]);
    await expect(pg.exec(`update form_submissions set status = 'done'`)).rejects.toThrow();   // CHECK constraint

    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0018_media_rights_down.sql'), 'utf8'));   // newer migrations are undone first
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0017_pillar_removal_down.sql'), 'utf8'));   // newer migrations are undone first
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0016_pillars_down.sql'), 'utf8'));   // newer migrations are undone first
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0015_inbox_down.sql'), 'utf8'));
    const back = (await pg.query<{ name: string; status: string; note: string }>('select name, status::text as status, note from form_submissions order by name')).rows;
    expect(back.map((r) => [r.name, r.status])).toEqual([['', 'done'], ['Fake Done', 'done'], ['Fake New', 'new'], ['Fake Spam', 'spam']]);
    expect(back.find((r) => r.name === 'Fake Done')!.note).toBe('Fake legacy note');
    // and migrating forward again works
    await migrate(db, { migrationsFolder: MIGRATIONS });
    expect((await pg.query<{ n: number }>(`select count(*)::int as n from form_submissions where status = 'closed'`)).rows[0].n).toBe(2);
    await pg.close();
  });
});
