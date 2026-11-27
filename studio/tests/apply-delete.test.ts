// AFCD Apply, plain row actions: "Delete" on a call archives it (nothing erased, Restore brings it back, only where the
// server's lifecycle allows), and "Delete" on an application moves it to the bin (hidden from lists, counts, reviews and
// emails; read-only; restorable; audited). Nothing in either path removes a row.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { applyCalls, applyMessages, applySubmissionEvents, applySubmissions, auditLog } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
afterEach(async () => { await h?.close(); h = undefined; });
const SITE = 'http://localhost:4321';
const DESC = 'Young people from Al Haouz join a twelve-week programme on climate action. Participants meet every Saturday, plan a local project with mentors and present it at the end.';

async function openCall() {
  const mgr = await client(h!.app, 'mgr@afcd.test'), rev = await client(h!.app, 'rev@afcd.test');
  const id = (await mgr.post('/apply/calls', { title: 'Youth Programme 2099', slug: 'youth-2099', summary: 'A programme.', description: DESC, eligibility: ['Aged 18 to 30'], opensLocal: '2026-01-01T09:00',
    closesLocal: '2099-02-15T23:59', contactEmail: 'apply@afcd.test', privacyNotice: 'We collect your name, contact details and answers to assess your application, then delete them after a year.' })).body.id as string;
  const f = (await mgr.post(`/apply/calls/${id}/form`, { template: 'youth_program' })).body.form;
  await mgr.post(`/apply/calls/${id}/form/publish`, { rev: f.rev });
  await mgr.post(`/apply/calls/${id}/transition`, { action: 'submit' });
  await rev.post(`/apply/calls/${id}/transition`, { action: 'approve' });
  expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'schedule' })).body.status).toBe('open');
  return { id, mgr };
}

async function submit(email: string) {
  let token = '';
  const req = async (method: string, path: string, body?: unknown) => {
    const res = await h!.app.request(`/apply/v1${path}`, { method, headers: { Origin: SITE, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  token = (await req('POST', '/calls/youth-2099/drafts', {})).body.token;
  expect((await req('PUT', '/drafts/me', { rev: 1, answers: { full_name: 'Test Applicant', email, city: 'Ait Ourir', age: 25, motivation: 'Test motivation text. '.repeat(6),
    volunteered: false, availability: ['saturday'], consent_privacy: true, consent_truth: true } })).status).toBe(200);
  const r = await req('POST', '/drafts/me/submit', { idempotencyKey: `key-${Math.random().toString(36).slice(2)}-abcdefgh` });
  expect(r.status).toBe(200);
  return r.body.reference as string;
}

describe('apply: Delete on an application moves it to the bin', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'mgr@afcd.test', 'application_manager'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); await addUser(h.db, 'scorer@afcd.test', 'application_reviewer');
  });

  it('hides it everywhere, keeps every row, refuses changes, cancels waiting emails, and restores it', async () => {
    const { id, mgr } = await openCall();
    const ref1 = await submit('one@example.org'); await submit('two@example.org');
    const [s1] = await h!.db.select().from(applySubmissions).where(eq(applySubmissions.reference, ref1));
    const sids = (await h!.db.select().from(applySubmissions)).map((s) => s.id);
    expect((await mgr.post('/apply/messages/custom', { callId: id, submissionIds: sids, subject: 'Info session', body: 'Dear {{applicant_name}}, see you Saturday.', confirm: 2 })).status).toBe(200);

    // only people who manage applications may delete
    const scorer = await client(h!.app, 'scorer@afcd.test');
    expect((await scorer.raw('DELETE', `/apply/submissions/${s1.id}`)).status).toBe(403);

    const d = await mgr.raw('DELETE', `/apply/submissions/${s1.id}`, { reason: 'Duplicate application' });
    expect(d.status).toBe(200);
    expect(d.body.cancelledEmails).toBe(1);
    expect((await mgr.raw('DELETE', `/apply/submissions/${s1.id}`)).status).toBe(409);   // already in the bin

    // still in the database, with who and when
    const [after] = await h!.db.select().from(applySubmissions).where(eq(applySubmissions.id, s1.id));
    expect(after.deletedAt).not.toBeNull(); expect(after.answers).toEqual(s1.answers);
    const msgs = await h!.db.select().from(applyMessages).where(eq(applyMessages.submissionId, s1.id));
    expect(msgs.map((m) => m.status)).toEqual(['cancelled']);

    // left out of the list and the counts; shown in the bin
    const list = (await mgr.get(`/apply/submissions?call=${id}`)).body;
    expect(list.total).toBe(1); expect(list.items.map((r: { reference: string }) => r.reference)).not.toContain(ref1);
    const counts = (await mgr.get(`/apply/submissions/counts?call=${id}`)).body;
    expect(counts).toMatchObject({ total: 1, deleted: 1 });
    expect((await mgr.get('/apply/submissions/by-call')).body[id].total).toBe(1);
    const bin = (await mgr.get(`/apply/submissions?call=${id}&bin=1`)).body;
    expect(bin.items.map((r: { reference: string }) => r.reference)).toEqual([ref1]);

    // read-only while in the bin
    expect((await mgr.post(`/apply/submissions/${s1.id}/status`, { to: 'under_evaluation' })).status).toBe(409);
    expect((await mgr.post(`/apply/submissions/${s1.id}/notes`, { body: 'x' })).status).toBe(409);
    expect((await mgr.post('/apply/messages/custom', { callId: id, submissionIds: [s1.id], subject: 'Info session', body: 'Dear {{applicant_name}}, see you Saturday.', confirm: 1 })).status).toBe(409);
    expect((await mgr.get(`/apply/submissions/${s1.id}`)).status).toBe(200);   // can still be viewed

    // restore
    expect((await scorer.post(`/apply/submissions/${s1.id}/restore`)).status).toBe(403);
    expect((await mgr.post(`/apply/submissions/${s1.id}/restore`)).status).toBe(200);
    expect((await mgr.post(`/apply/submissions/${s1.id}/restore`)).status).toBe(409);
    expect((await mgr.get(`/apply/submissions/counts?call=${id}`)).body).toMatchObject({ total: 2, deleted: 0 });
    expect((await mgr.post(`/apply/submissions/${s1.id}/status`, { to: 'under_evaluation' })).status).toBe(200);

    // recorded on the application and in the audit log
    const kinds = (await h!.db.select().from(applySubmissionEvents).where(eq(applySubmissionEvents.submissionId, s1.id))).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['deleted', 'restored']));
    const audits = (await h!.db.select().from(auditLog)).map((a) => a.action);
    expect(audits).toEqual(expect.arrayContaining(['apply.submission.delete', 'apply.submission.restore']));
    expect(await h!.db.select().from(applySubmissions)).toHaveLength(2);
  });
});

describe('apply: Delete on a call archives it', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'mgr@afcd.test', 'application_manager'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); });

  it('archives a draft (kept, restorable) and refuses an open call with applications', async () => {
    const mgr = await client(h!.app, 'mgr@afcd.test');
    const draft = (await mgr.post('/apply/calls', { title: 'moonshoot', slug: 'moonshoot' })).body.id as string;
    expect((await mgr.post(`/apply/calls/${draft}/transition`, { action: 'archive' })).body.status).toBe('archived');
    expect((await h!.db.select().from(applyCalls).where(eq(applyCalls.id, draft)))[0].status).toBe('archived');
    expect((await mgr.post(`/apply/calls/${draft}/transition`, { action: 'restore' })).body.status).toBe('draft');

    const { id } = await openCall();
    await submit('one@example.org');
    const r = await mgr.post(`/apply/calls/${id}/transition`, { action: 'archive' });
    expect(r.status).toBe(409);
    expect((await h!.db.select().from(applyCalls).where(eq(applyCalls.id, id)))[0].status).toBe('open');
    expect(await h!.db.select().from(applySubmissions)).toHaveLength(1);
  });
});
