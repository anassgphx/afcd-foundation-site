// Inbox email: SMTP settings (password encrypted, never returned) and sending replies from Studio.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { auditLog, formSubmissions, submissionEvents } from '../src/server/db/schema.ts';
import { setSender, type SendInput } from '../src/server/modules/inbox/mail.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
let sent: { password: string; host: string; m: SendInput }[] = [];
let fail: string | null = null;
afterEach(async () => { setSender(null); await h?.close(); h = undefined as never; });

const SMTP = { enabled: true, host: 'smtp.example.org', port: 587, security: 'starttls', user: 'mailer@example.org', password: 'fake-app-password-123', fromName: 'AFCD Foundation', fromEmail: 'contact@example.org', replyTo: '' };
const send = (body: Record<string, unknown>) => h.app.request('/forms/v1/contact', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4321', 'X-Forwarded-For': '203.0.113.9' },
  body: JSON.stringify({ topic: 'Volunteering', name: 'Test Person', email: 'test.person@example.org', phone: '', org: '', message: 'Fake test message.', consent: true, website: '', t: 9000, ...body }) });

describe('inbox email', () => {
  let admin: Awaited<ReturnType<typeof client>>, ed: Awaited<ReturnType<typeof client>>, id: string;
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'ed@afcd.test', 'content_editor');
    admin = await client(h.app, 'admin@afcd.test'); ed = await client(h.app, 'ed@afcd.test');
    sent = []; fail = null;
    setSender(async (s, m) => { if (fail) throw new Error(fail); sent.push({ password: s.password, host: s.host, m }); return { messageId: `<fake-${sent.length}@example.org>` }; });
    await send({});
    [{ id }] = await h.db.select().from(formSubmissions);
  });

  it('is off until an administrator sets it up, and only managers see the settings', async () => {
    expect((await admin.get('/inbox/mail')).body).toEqual({ ready: false, fromEmail: '', fromName: '' });
    expect((await admin.post(`/inbox/messages/${id}/send`, { subject: 'Hi', body: 'Hello' })).status).toBe(409);
    for (const [m, p] of [['GET', '/inbox/mail/settings'], ['PUT', '/inbox/mail/settings'], ['POST', '/inbox/mail/test'], ['POST', `/inbox/messages/${id}/send`], ['GET', '/inbox/mail']] as const)
      expect((await ed.raw(m, p, m === 'GET' ? undefined : {})).status, p).toBe(403);
    expect((await admin.put('/inbox/mail/settings', { ...SMTP, fromEmail: '' })).status).toBe(422);   // can't switch on half set up
    expect((await admin.put('/inbox/mail/settings', { ...SMTP, host: 'smtp example' })).status).toBe(422);
  });

  it('stores the password encrypted and never returns it', async () => {
    const r = await admin.put('/inbox/mail/settings', SMTP);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ready: true, hasPassword: true, host: 'smtp.example.org' });
    expect(JSON.stringify(r.body)).not.toContain(SMTP.password);
    expect(JSON.stringify((await admin.get('/inbox/mail/settings')).body)).not.toContain(SMTP.password);
    const onDisk = readFileSync(join(h.cfg.dataDir, 'mail-settings.json'), 'utf8');
    expect(onDisk).not.toContain(SMTP.password);
    expect(onDisk).toMatch(/"passwordBox": "v1\./);
    // saving without a password keeps the saved one
    const { password: _pw, ...noPw } = SMTP;
    await admin.put('/inbox/mail/settings', { ...noPw, fromName: 'AFCD Team' });
    expect((await admin.post('/inbox/mail/test', {})).body).toMatchObject({ ok: true, to: 'admin@afcd.test' });
    expect(sent[0]).toMatchObject({ password: SMTP.password, host: 'smtp.example.org' });
    expect(sent[0].m).toMatchObject({ from: '"AFCD Team" <contact@example.org>', to: 'admin@afcd.test' });
    expect(JSON.stringify(await h.db.select().from(auditLog))).not.toContain(SMTP.password);
  });

  it('sends a reply, keeps it in the history, marks the message replied, and logs no content', async () => {
    await admin.put('/inbox/mail/settings', { ...SMTP, replyTo: 'team@example.org' });
    expect((await admin.get('/inbox/mail')).body).toEqual({ ready: true, fromEmail: 'contact@example.org', fromName: 'AFCD Foundation' });
    const r = await admin.post(`/inbox/messages/${id}/send`, { subject: 'Re: Volunteering\r\nBcc: x@evil.example', body: 'Fake reply: thank you, see you Saturday.' });
    expect(r.status).toBe(200);
    expect(sent).toHaveLength(1);
    // sent in the branded layout (Settings → Email templates): HTML plus a text version that starts with the reply itself
    expect(sent[0].m).toMatchObject({ from: '"AFCD Foundation" <contact@example.org>', to: 'test.person@example.org', replyTo: 'team@example.org', subject: 'Re: Volunteering Bcc: x@evil.example' });
    expect(Object.keys(sent[0].m).sort()).toEqual(['from', 'html', 'replyTo', 'subject', 'text', 'to']);
    expect(sent[0].m.text.startsWith('Fake reply: thank you, see you Saturday.')).toBe(true);
    expect(sent[0].m.html).toContain('Fake reply: thank you, see you Saturday.');
    expect(sent[0].m.html).toContain('assets/brand/afcd-logo.png');
    const { body: m } = await admin.get(`/inbox/messages/${id}`);
    expect(m.status).toBe('replied');
    const ev = m.events.find((e: { kind: string }) => e.kind === 'email_sent');
    expect(ev).toMatchObject({ body: 'Fake reply: thank you, see you Saturday.', actorName: 'admin' });
    expect(ev.meta).toMatchObject({ to: 'test.person@example.org', from: 'contact@example.org', messageId: '<fake-1@example.org>' });
    const logs = JSON.stringify(await h.db.select().from(auditLog).where(eq(auditLog.action, 'inbox.reply_sent')));
    expect(logs).toContain('Sent an email reply');
    expect(logs).not.toContain('see you Saturday');
    expect(logs).not.toContain('test.person@example.org');
    // keep the status when asked
    await admin.raw('PATCH', `/inbox/messages/${id}`, { status: 'in_progress' });
    await admin.post(`/inbox/messages/${id}/send`, { subject: 'Again', body: 'Fake follow-up.', markReplied: false });
    expect((await admin.get(`/inbox/messages/${id}`)).body.status).toBe('in_progress');
  });

  it('reports a refused or unreachable server and records nothing', async () => {
    await admin.put('/inbox/mail/settings', SMTP);
    fail = 'Invalid login: 535 Authentication failed';
    const r = await admin.post(`/inbox/messages/${id}/send`, { subject: 'Hi', body: 'Fake.' });
    expect(r.status).toBe(502);
    expect(r.body.error).toContain('535 Authentication failed');
    expect(await h.db.select().from(submissionEvents).where(eq(submissionEvents.kind, 'email_sent'))).toHaveLength(0);
    expect((await admin.get(`/inbox/messages/${id}`)).body.status).toBe('new');
  });

  it('does not reply to spam, and needs a subject and text', async () => {
    await admin.put('/inbox/mail/settings', SMTP);
    expect((await admin.post(`/inbox/messages/${id}/send`, { subject: ' ', body: 'x' })).status).toBe(422);
    expect((await admin.post(`/inbox/messages/${id}/send`, { subject: 'x', body: '' })).status).toBe(422);
    await admin.post('/inbox/flag', { ids: [id], flag: 'spam' });
    expect((await admin.post(`/inbox/messages/${id}/send`, { subject: 'x', body: 'y' })).status).toBe(409);
    expect(sent).toHaveLength(0);
  });
});
