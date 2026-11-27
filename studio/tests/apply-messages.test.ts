// AFCD Apply communications: templates with escaped variables, receipts, decision notices only after approval, bulk
// messages one per applicant, a queue with retries, delivery status and no duplicates. No real email is ever sent.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { applyDecisions, applyMessages, applySubmissions, users } from '../src/server/db/schema.ts';
import { saveMailSettings, setSender, type SendInput } from '../src/server/modules/inbox/mail.ts';
import { processQueue, render } from '../src/server/modules/apply/messages.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
let sent: SendInput[] = [];
let failNext = 0;
afterEach(async () => { setSender(null); await h?.close(); h = undefined; });
const SITE = 'http://localhost:4321';
const DESC = 'Young people from Al Haouz join a twelve-week programme on climate action. Participants meet every Saturday, plan a local project with mentors and present it at the end.';

describe('apply communications', () => {
  let mgr: Awaited<ReturnType<typeof client>>, callId: string;
  async function apply(i: number, over: Record<string, unknown> = {}, lang = 'en') {
    const req = async (method: string, path: string, body: unknown, token = '') => (await h!.app.request(`/apply/v1${path}`, { method, headers: { Origin: SITE, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
    const tok = (await req('POST', '/calls/youth-2099/drafts', { lang })).token;
    await req('PUT', '/drafts/me', { rev: 1, answers: { full_name: `Applicant ${i}`, email: `a${i}@example.org`, city: 'Ait Ourir', age: 22, motivation: 'Test motivation text. '.repeat(6), volunteered: false, availability: ['saturday'], consent_privacy: true, consent_truth: true, ...over } }, tok);
    return (await req('POST', '/drafts/me/submit', { idempotencyKey: `msg-key-${i}-1234567890` }, tok)).reference as string;
  }
  const subOf = async (ref: string) => (await h!.db.select().from(applySubmissions).where(eq(applySubmissions.reference, ref)))[0];

  beforeEach(async () => {
    sent = []; failNext = 0;
    setSender(async (_s, m) => { if (failNext > 0) { failNext--; throw new Error('421 try again later'); } sent.push(m); return { messageId: `<fake-${sent.length}@example.org>` }; });
    h = await makeApp();
    for (const [e, r] of [['mgr@afcd.test', 'application_manager'], ['mgr2@afcd.test', 'application_manager'], ['rev@afcd.test', 'content_reviewer'], ['ar@afcd.test', 'application_reviewer']] as const) await addUser(h.db, e, r);
    mgr = await client(h.app, 'mgr@afcd.test');
    const rv = await client(h.app, 'rev@afcd.test');
    callId = (await mgr.post('/apply/calls', { title: 'Youth 2099', slug: 'youth-2099', summary: 'A programme.', description: DESC, eligibility: ['Aged 18 to 30'], opensLocal: '2026-01-01T09:00',
      closesLocal: '2099-02-15T23:59', contactEmail: 'apply@afcd.test', privacyNotice: 'We collect your name, contact details and answers to assess your application, then delete them after a year.' })).body.id;
    const f = (await mgr.post(`/apply/calls/${callId}/form`, { template: 'youth_program' })).body.form;
    await mgr.post(`/apply/calls/${callId}/form/publish`, { rev: f.rev });
    await mgr.post(`/apply/calls/${callId}/transition`, { action: 'submit' });
    await rv.post(`/apply/calls/${callId}/transition`, { action: 'approve' });
    await mgr.post(`/apply/calls/${callId}/transition`, { action: 'schedule' });
  });
  const smtpOn = async () => {
    const [u] = await h!.db.select().from(users).where(eq(users.email, 'mgr@afcd.test'));
    await saveMailSettings(h!.db, h!.cfg, { id: u.id, email: u.email }, { enabled: true, host: 'smtp.example.org', port: 587, security: 'starttls', user: '', fromName: 'AFCD', fromEmail: 'no-reply@example.org', replyTo: '' });
  };

  it('fills variables as text, never as code', () => {
    expect(render('Hi {{applicant_name}}, {{unknown}}!', { applicant_name: '<b>Bo</b>' })).toBe('Hi <b>Bo</b>, !');
    expect(render('Line {{applicant_name}}\nbreak', { applicant_name: 'A\r\nBcc: x@y' }, true)).toBe('Line A Bcc: x@y break');
  });

  it('sends a receipt only when the call asks for one, in the applicant’s language, once', async () => {
    await smtpOn();
    await apply(1);
    expect(await h!.db.select().from(applyMessages)).toEqual([]);
    expect((await (await client(h!.app, 'ar@afcd.test')).raw('PUT', `/apply/calls/${callId}/receipts`, { enabled: true })).status).toBe(403);
    expect((await mgr.put(`/apply/calls/${callId}/receipts`, { enabled: true })).body.enabled).toBe(true);
    const ref = await apply(2, { full_name: '<b>Bold</b> & Co' }, 'fr');
    const [m] = await h!.db.select().from(applyMessages);
    expect(m).toMatchObject({ kind: 'receipt', toEmail: 'a2@example.org', lang: 'fr', status: 'queued' });
    expect(m.subject).toBe('Nous avons reçu votre candidature : Youth 2099');
    expect(m.body).toContain(ref);
    expect((await processQueue(h!.db, h!.cfg)).sent).toBe(1);
    expect((await processQueue(h!.db, h!.cfg)).sent).toBe(0);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('a2@example.org');
    expect(sent[0].html).not.toContain('<b>Bold</b>');
    expect(sent[0].html).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; Co');
    expect((await h!.db.select().from(applyMessages))[0]).toMatchObject({ status: 'sent', attempts: 1 });
  });

  it('waits while email is not set up, retries with backoff, then marks failures', async () => {
    await mgr.put(`/apply/calls/${callId}/receipts`, { enabled: true });
    await apply(3);
    expect((await processQueue(h!.db, h!.cfg)).waiting).toBe(true);
    expect((await h!.db.select().from(applyMessages))[0].status).toBe('queued');
    await smtpOn();
    failNext = 1;
    await processQueue(h!.db, h!.cfg);
    let [m] = await h!.db.select().from(applyMessages);
    expect(m).toMatchObject({ status: 'queued', attempts: 1, lastError: expect.stringContaining('421') });
    expect(m.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    failNext = 10;
    for (let i = 0; i < 5; i++) await processQueue(h!.db, h!.cfg, new Date(Date.now() + (i + 1) * 4 * 3600_000));
    [m] = await h!.db.select().from(applyMessages);
    expect(m).toMatchObject({ status: 'failed', attempts: 5 });
    expect((await mgr.get('/apply/overview')).body.outbox).toMatchObject({ failed: 1, ready: true });
    failNext = 0;
    expect((await mgr.post(`/apply/messages/${m.id}/retry`)).status).toBe(200);
    await processQueue(h!.db, h!.cfg);
    expect((await h!.db.select().from(applyMessages))[0].status).toBe('sent');
  });

  it('sends decision emails only for approved decisions, once each, and records that the applicant was told', async () => {
    await smtpOn();
    const refs = [await apply(4), await apply(5)];
    const ids = await Promise.all(refs.map(async (r) => (await subOf(r)).id));
    for (const id of ids) await mgr.post(`/apply/submissions/${id}/status`, { to: 'under_evaluation' });
    await mgr.post('/apply/decisions', { ids, outcome: 'not_selected', reason: 'Places filled', confirm: 2 });
    const ds = (await mgr.get(`/apply/decisions?call=${callId}`)).body as { id: string }[];
    expect((await mgr.post('/apply/messages/decisions', { callId, decisionIds: ds.map((d) => d.id), confirm: 2 })).status).toBe(409);   // not approved yet
    await (await client(h!.app, 'mgr2@afcd.test')).post('/apply/decisions/decide', { ids: ds.map((d) => d.id), approve: true, confirm: 2 });
    expect((await mgr.post('/apply/messages/decisions', { callId, decisionIds: ds.map((d) => d.id), confirm: 1 })).status).toBe(422);
    expect((await mgr.post('/apply/messages/decisions', { callId, decisionIds: ds.map((d) => d.id), confirm: 2 })).body.queued).toBe(2);
    expect((await mgr.post('/apply/messages/decisions', { callId, decisionIds: ds.map((d) => d.id), confirm: 2 })).status).toBe(409);   // already in the outbox
    await processQueue(h!.db, h!.cfg);
    expect(sent.map((m) => m.to).sort()).toEqual(['a4@example.org', 'a5@example.org']);
    expect(sent.every((m) => !m.to.includes(','))).toBe(true);                                // one recipient per email
    expect(sent[0].subject).toBe('Your application to Youth 2099');
    expect((await h!.db.select().from(applyDecisions)).every((d) => d.notifiedAt !== null)).toBe(true);
  });

  it('lets staff write to chosen applicants with checked templates, and keeps roles apart', async () => {
    await smtpOn();
    const ids = [await apply(6), await apply(7)].map(async (r) => (await subOf(r)).id);
    const sids = await Promise.all(ids);
    expect((await mgr.put('/apply/email-templates/receipt?call=' + callId, { variants: { en: { subject: 'Hi {{nickname}}', body: 'Body text that is long enough.' } }, rev: 0 })).status).toBe(422);
    expect((await mgr.put('/apply/email-templates/receipt?call=' + callId, { variants: { en: { subject: 'Thanks {{applicant_name}}', body: 'We got {{reference}} for {{call_title}}.' } }, rev: 0 })).status).toBe(200);
    expect((await mgr.put('/apply/email-templates/receipt?call=' + callId, { variants: { en: { subject: 'Again', body: 'Stale save attempt here.' } }, rev: 0 })).status).toBe(409);
    const t = (await mgr.get('/apply/email-templates?call=' + callId)).body.templates.find((x: { key: string }) => x.key === 'receipt');
    expect(t).toMatchObject({ source: 'call', rev: 1 });
    const pv = (await mgr.post('/apply/messages/preview', { submissionId: sids[0], key: 'receipt' })).body;
    expect(pv.subject).toBe('Thanks Applicant 6');
    expect((await mgr.post('/apply/messages/custom', { callId, submissionIds: sids, subject: 'Workshop on {{call_title}}', body: 'Dear {{applicant_name}}, the info session is on Saturday.', confirm: 1 })).status).toBe(422);
    const q = await mgr.post('/apply/messages/custom', { callId, submissionIds: sids, subject: 'Workshop on {{call_title}}', body: 'Dear {{applicant_name}}, the info session is on Saturday.', confirm: 2 });
    expect(q.body.queued).toBe(2);
    await processQueue(h!.db, h!.cfg);
    expect(sent.map((m) => m.text.includes('Dear Applicant 6') || m.text.includes('Dear Applicant 7'))).toEqual([true, true]);
    expect(sent.every((m) => m.subject === 'Workshop on Youth 2099')).toBe(true);
    const list = (await mgr.get(`/apply/messages?call=${callId}`)).body;
    expect(list).toHaveLength(2);
    expect(list.every((x: { status: string }) => x.status === 'sent')).toBe(true);
    for (const e of ['ar@afcd.test', 'rev@afcd.test']) expect((await (await client(h!.app, e)).get('/apply/messages')).status, e).toBe(403);
  });
});
