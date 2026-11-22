import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { formSubmissions, newsletterSubscribers, auditLog } from '../src/server/db/schema.ts';
import { purgeExpired, toCsv } from '../src/server/modules/forms/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const SITE = 'http://localhost:4321';
const send = (key: string, body: unknown, opts: { origin?: string; ip?: string } = {}) => h.app.request(`/forms/v1/${key}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: opts.origin ?? SITE, 'X-Forwarded-For': opts.ip ?? '203.0.113.7' }, body: JSON.stringify(body),
});
const msg = (over: Record<string, unknown> = {}) => ({ topic: 'Volunteering', name: 'Salma B.', email: 'Salma@Example.org', phone: '', org: '', message: 'I would like to help at the next community day.', consent: true, website: '', t: 9000, ...over });

describe('public form intake', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'ed@afcd.test', 'content_editor'); });

  it('accepts a contact message from the site, with CORS, and stores no IP address', async () => {
    const pre = await h.app.request('/forms/v1/contact', { method: 'OPTIONS', headers: { Origin: SITE, 'Access-Control-Request-Method': 'POST' } });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe(SITE);
    const r = await send('contact', msg());
    expect(r.status).toBe(200);
    expect(r.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(r.headers.get('set-cookie')).toBeNull();
    const [row] = await h.db.select().from(formSubmissions);
    expect(row).toMatchObject({ formKey: 'contact', topic: 'Volunteering', email: 'salma@example.org', status: 'new' });
    expect(row.ipHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain('203.0.113.7');
  });

  it('rejects other websites, bad input and missing consent', async () => {
    expect((await send('contact', msg(), { origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('contact', msg({ consent: false }))).status).toBe(422);
    expect((await send('contact', msg({ email: 'nope' }))).status).toBe(422);
    expect((await send('contact', msg({ topic: 'Something else' }))).status).toBe(422);
    expect((await send('contact', msg({ extra: 'x' }))).status).toBe(422);
    expect((await send('contact', msg({ message: 'x'.repeat(1001) }))).status).toBe(422);
    expect((await send('unknown', msg())).status).toBe(404);
    expect((await h.app.request('/forms/v1/contact', { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: SITE }, body: 'hi' })).status).toBe(415);
  });

  it('keeps spam apart and limits repeated sending', async () => {
    expect((await send('contact', msg({ website: 'http://spam.example' }))).status).toBe(200);   // honeypot: looks accepted
    expect((await send('contact', msg({ t: 300 }), { ip: '198.51.100.1' })).status).toBe(200);    // too fast for a person
    expect((await h.db.select().from(formSubmissions).where(eq(formSubmissions.status, 'spam'))).length).toBe(2);
    for (let i = 0; i < 4; i++) expect((await send('contact', msg())).status).toBe(200);
    const r = await send('contact', msg());   // 5 from this address in 10 minutes already
    expect(r.status).toBe(429);
    expect((await send('contact', msg(), { ip: '192.0.2.44' })).status).toBe(200);
  });

  it('subscribes to the newsletter once, and pausing a form stops intake', async () => {
    expect((await send('newsletter', { email: 'a@example.org', website: '', t: 5000, page: '/index.html' })).status).toBe(200);
    expect((await send('newsletter', { email: 'A@example.org', website: '', t: 5000, page: '/news.html' }, { ip: '192.0.2.9' })).status).toBe(200);
    expect(await h.db.select().from(newsletterSubscribers)).toHaveLength(1);
    const admin = await client(h.app, 'admin@afcd.test');
    expect((await admin.put('/forms/contact/settings', { enabled: false, retentionDays: 365 })).status).toBe(200);
    expect((await send('contact', msg())).status).toBe(503);
  });
});

describe('forms inbox', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'ed@afcd.test', 'content_editor'); });

  it('is for administrators only, and staff can triage, export and delete', async () => {
    await send('contact', msg({ message: '=HYPERLINK("http://x")' }));
    const ed = await client(h.app, 'ed@afcd.test'), admin = await client(h.app, 'admin@afcd.test');
    expect((await ed.get('/forms')).status).toBe(403);
    expect((await ed.get('/forms/contact/submissions')).status).toBe(403);
    const { body: list } = await admin.get('/forms/contact/submissions?status=new');
    expect(list).toHaveLength(1);
    const id = list[0].id;
    expect((await admin.raw('PATCH', `/forms/submissions/${id}`, { status: 'in_progress', note: 'Called back' })).status).toBe(200);
    const res = await h.app.request('/studio/api/forms/export/contact', { headers: { Cookie: admin.cookie } });
    const csv = await res.text();
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);   // formula neutralised
    const logs = await h.db.select().from(auditLog);
    expect(JSON.stringify(logs)).not.toContain('community day');   // the audit log never copies message text
    expect((await admin.post('/forms/submissions/delete', { ids: [id] })).body).toEqual({ deleted: 1 });
    expect(await h.db.select().from(formSubmissions)).toHaveLength(0);
  });

  it('deletes messages past their retention period', async () => {
    await send('contact', msg());
    await h.db.update(formSubmissions).set({ createdAt: new Date(Date.now() - 400 * 864e5) });
    expect(await purgeExpired(h.db)).toBe(1);
  });

  it('writes safe CSV', () => {
    expect(toCsv(['a'], [['+1 555'], ['x,y']])).toBe('﻿a\r\n\'+1 555\r\n"x,y"\r\n');
  });
});
