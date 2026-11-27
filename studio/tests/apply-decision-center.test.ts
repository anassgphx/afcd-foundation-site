// AFCD Apply decision center (the application drawer's server side): the full application with its decisions and the
// call's places, In review, approval by a Super Administrator, the capacity limit, an ineligible application moving
// forward only with a reason, and one approval email per decision. No real email is sent.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { inflateRawSync } from 'node:zlib';
import { makeApp, addUser, client } from './helpers.ts';
import { applyMessages, applySubmissionEvents, applySubmissions, auditLog, users } from '../src/server/db/schema.ts';
import { setSender, type SendInput } from '../src/server/modules/inbox/mail.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
let sent: SendInput[] = [];
afterEach(async () => { setSender(null); await h?.close(); h = undefined; });
const SITE = 'http://localhost:4321';
const DESC = 'Young people from Al Haouz join a twelve-week programme on climate action. Participants meet every Saturday, plan a local project with mentors and present it at the end.';

describe('decision center', () => {
  let admin: Awaited<ReturnType<typeof client>>, mgr: Awaited<ReturnType<typeof client>>, callId: string;
  async function apply(i: number, over: Record<string, unknown> = {}) {
    const req = async (method: string, path: string, body: unknown, token = '') => (await h!.app.request(`/apply/v1${path}`, { method, headers: { Origin: SITE, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
    const tok = (await req('POST', '/calls/dc-2099/drafts', { lang: 'en' })).token;
    await req('PUT', '/drafts/me', { rev: 1, answers: { full_name: `Applicant ${i}`, email: `a${i}@example.org`, city: 'Ait Ourir', age: 22, motivation: 'Test motivation text. '.repeat(6), volunteered: false, availability: ['saturday'], consent_privacy: true, consent_truth: true, ...over } }, tok);
    const ref = (await req('POST', '/drafts/me/submit', { idempotencyKey: `dc-key-${i}-1234567890` }, tok)).reference as string;
    return (await h!.db.select().from(applySubmissions).where(eq(applySubmissions.reference, ref)))[0];
  }

  beforeEach(async () => {
    sent = [];
    setSender(async (_s, m) => { sent.push(m); return { messageId: `<fake-${sent.length}@example.org>` }; });
    h = await makeApp();
    for (const [e, r] of [['admin@afcd.test', 'super_admin'], ['mgr@afcd.test', 'application_manager'], ['rev@afcd.test', 'content_reviewer']] as const) await addUser(h.db, e, r);
    admin = await client(h.app, 'admin@afcd.test'); mgr = await client(h.app, 'mgr@afcd.test');
    const rv = await client(h.app, 'rev@afcd.test');
    callId = (await mgr.post('/apply/calls', { title: 'DC 2099', slug: 'dc-2099', summary: 'A programme.', description: DESC, eligibility: ['Aged 18 to 30'], opensLocal: '2026-01-01T09:00', places: 1,
      closesLocal: '2099-02-15T23:59', contactEmail: 'apply@afcd.test', privacyNotice: 'We collect your name, contact details and answers to assess your application, then delete them after a year.' })).body.id;
    const f = (await mgr.post(`/apply/calls/${callId}/form`, { template: 'youth_program' })).body.form;
    await mgr.post(`/apply/calls/${callId}/form/publish`, { rev: f.rev });
    await mgr.post(`/apply/calls/${callId}/transition`, { action: 'submit' });
    await rv.post(`/apply/calls/${callId}/transition`, { action: 'approve' });
    await mgr.post(`/apply/calls/${callId}/transition`, { action: 'schedule' });
  });

  it('shows the whole application with its decisions and the call’s places', async () => {
    const s = await apply(1);
    const d = (await admin.get(`/apply/submissions/${s.id}`)).body;
    expect(d.call).toMatchObject({ places: 1, selected: 0, eligibility: ['Aged 18 to 30'] });
    expect(d.decisions).toEqual([]);
    expect(d.moves).toContain('under_evaluation');
  });

  it('In review → approved by a Super Administrator → one approval email, all recorded', async () => {
    const s = await apply(2);
    expect((await admin.post(`/apply/submissions/${s.id}/status`, { to: 'under_evaluation', reason: '' })).status).toBe(200);
    expect((await admin.post('/apply/decisions', { ids: [s.id], outcome: 'selected', reason: 'Strong local project', confirm: 1 })).status).toBe(201);
    let d = (await admin.get(`/apply/submissions/${s.id}`)).body;
    const p = d.decisions.find((x: { status: string }) => x.status === 'proposed');
    // the manager who did not propose it can decide; a manager cannot approve their own (tested in apply-evaluation); a super admin can
    expect((await admin.post('/apply/decisions/decide', { ids: [p.id], approve: true, note: '', confirm: 1 })).status).toBe(200);
    d = (await admin.get(`/apply/submissions/${s.id}`)).body;
    expect(d.status).toBe('selected');
    expect(d.call.selected).toBe(1);
    expect(d.decisions[0]).toMatchObject({ status: 'approved', outcome: 'selected', notifiedAt: null });
    // the approval email: queued once, never twice
    expect((await admin.post('/apply/messages/decisions', { callId, decisionIds: [p.id], confirm: 1 })).body.queued).toBe(1);
    expect((await admin.post('/apply/messages/decisions', { callId, decisionIds: [p.id], confirm: 1 })).status).toBe(409);
    const msgs = await h!.db.select().from(applyMessages).where(eq(applyMessages.submissionId, s.id));
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ kind: 'decision', toEmail: 'a2@example.org', status: 'queued' });
    const kinds = (await h!.db.select().from(applySubmissionEvents).where(eq(applySubmissionEvents.submissionId, s.id))).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['submitted', 'status', 'decision']));
    const actions = (await h!.db.select().from(auditLog)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['apply.submission.status', 'apply.decision.propose', 'apply.decision.approve']));
  });

  it('does not select more people than the call has places, unless overridden with a note', async () => {
    const a = await apply(3), b = await apply(4);
    for (const s of [a, b]) await admin.post(`/apply/submissions/${s.id}/status`, { to: 'under_evaluation', reason: '' });
    await admin.post('/apply/decisions', { ids: [a.id, b.id], outcome: 'selected', reason: 'Both strong', confirm: 2 });
    const ids = (await admin.get(`/apply/decisions?call=${callId}`)).body.map((x: { id: string }) => x.id);
    expect((await admin.post('/apply/decisions/decide', { ids, approve: true, note: '', confirm: 2 })).status).toBe(409);
    expect((await admin.post('/apply/decisions/decide', { ids: [ids[0]], approve: true, note: '', confirm: 1 })).status).toBe(200);
    expect((await admin.post('/apply/decisions/decide', { ids: [ids[1]], approve: true, note: '', overCapacity: true, confirm: 1 })).status).toBe(409);   // the override needs a note
    expect((await admin.post('/apply/decisions/decide', { ids: [ids[1]], approve: true, note: 'Second place funded by a partner', overCapacity: true, confirm: 1 })).status).toBe(200);
  });

  it('moves an ineligible application forward only with a reason, and never makes it eligible', async () => {
    const s = await apply(5, { age: 45 });
    const [u] = await h!.db.select().from(users).where(eq(users.email, 'admin@afcd.test'));
    await h!.db.update(applySubmissions).set({ eligibility: 'ineligible' }).where(eq(applySubmissions.id, s.id));
    expect((await admin.post(`/apply/submissions/${s.id}/status`, { to: 'under_evaluation', reason: '' })).status).toBe(422);
    expect((await admin.post(`/apply/submissions/${s.id}/status`, { to: 'under_evaluation', reason: 'Age limit waived by the board' })).status).toBe(200);
    const [after] = await h!.db.select().from(applySubmissions).where(eq(applySubmissions.id, s.id));
    expect(after).toMatchObject({ status: 'under_evaluation', eligibility: 'ineligible' });
    expect(u).toBeTruthy();
  });

  it('bulk eligibility: one assessment with its reason on every chosen application, all or none, recorded', async () => {
    const a = await apply(7), b = await apply(8);
    expect((await admin.post('/apply/submissions/bulk-eligibility', { ids: [a.id, b.id], result: 'eligible', reason: 'ok', confirm: 2 })).status).toBe(422);   // reason too short
    expect((await admin.post('/apply/submissions/bulk-eligibility', { ids: [a.id, b.id], result: 'eligible', reason: 'Checked the ages', confirm: 1 })).status).toBe(422);   // wrong count
    expect((await admin.post('/apply/submissions/bulk-eligibility', { ids: [a.id, b.id], result: 'eligible', reason: 'Checked the ages', confirm: 2 })).body).toEqual({ updated: 2 });
    for (const s of [a, b]) {
      const d = (await admin.get(`/apply/submissions/${s.id}`)).body;
      expect(d.eligibility).toBe('eligible');
      expect(d.eligibilityOverride).toMatchObject({ result: 'eligible', reason: 'Checked the ages' });
      expect(d.events.some((e: { kind: string; body: string }) => e.kind === 'eligibility' && e.body === 'Checked the ages')).toBe(true);
    }
    // then both to In review in one go, and a reviewer role cannot do either
    expect((await admin.post('/apply/submissions/bulk-status', { ids: [a.id, b.id], to: 'under_evaluation', reason: 'Eligible, to review', confirm: 2 })).body).toEqual({ moved: 2 });
    const rv = await client(h!.app, 'rev@afcd.test');
    expect((await rv.post('/apply/submissions/bulk-eligibility', { ids: [a.id], result: 'ineligible', reason: 'Not allowed', confirm: 1 })).status).toBe(403);
  });

  it('exports chosen applications to a styled Excel workbook, for staff allowed to export, recorded', async () => {
    const a = await apply(9, { full_name: '=HYPERLINK("http://x")' }), b = await apply(10);
    await admin.post(`/apply/submissions/${b.id}/status`, { to: 'under_evaluation', reason: '' });
    const res = await h!.app.request('/studio/api/apply/submissions/export.xlsx', { method: 'POST', headers: { Cookie: admin.cookie, Origin: 'http://localhost:4400', 'X-CSRF-Token': admin.csrf, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [a.id, b.id] }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="AFCD-\d{4}-\d{3}-applicants-\d{4}-\d{2}-\d{2}\.xlsx"/);
    const zip = Buffer.from(await res.arrayBuffer());
    expect(zip.subarray(0, 2).toString()).toBe('PK');
    // read the zip's entries (local headers + deflate)
    const files: Record<string, string> = {}; let o = 0;
    while (zip.readUInt32LE(o) === 0x04034b50) {
      const comp = zip.readUInt32LE(o + 18), n = zip.readUInt16LE(o + 26), ex = zip.readUInt16LE(o + 28);
      const name = zip.subarray(o + 30, o + 30 + n).toString(); const data = zip.subarray(o + 30 + n + ex, o + 30 + n + ex + comp);
      files[name] = inflateRawSync(data).toString('utf8'); o += 30 + n + ex + comp;
    }
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['[Content_Types].xml', 'xl/workbook.xml', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']));
    expect(files['xl/workbook.xml']).toContain('name="Applicants"');
    expect(files['xl/workbook.xml']).toMatch(/name="Answers AFCD-\d{4}-\d{3}"/);
    const s1 = files['xl/worksheets/sheet1.xml'];
    expect(s1).toContain('state="frozen"'); expect(s1).toContain('<autoFilter ref="A4:');
    expect(s1).toContain('In review'); expect(s1).toContain('New'); expect(s1).toContain(a.reference);
    expect(s1).not.toContain('<f>');                                                    // never a formula
    expect(s1).toContain('=HYPERLINK(&quot;http://x&quot;)');                           // the text stays text
    expect(files['xl/worksheets/sheet2.xml']).toContain('Why do you want to join this programme?');
    expect((await h!.db.select().from(auditLog)).some((x) => x.action === 'apply.submission.export')).toBe(true);
    const rv = await client(h!.app, 'rev@afcd.test');   // content reviewer: may not read applications
    expect((await rv.raw('POST', '/apply/submissions/export.xlsx', { ids: [a.id] })).status).toBe(403);
    expect((await mgr.raw('POST', '/apply/submissions/export.xlsx', { ids: [] })).status).toBe(422);
  });

  it('keeps applications from people who may not read them', async () => {
    const s = await apply(6);
    const rv = await client(h!.app, 'rev@afcd.test');
    expect((await rv.get(`/apply/submissions/${s.id}`)).status).toBe(403);
    expect((await rv.post(`/apply/submissions/${s.id}/status`, { to: 'under_evaluation', reason: '' })).status).toBe(403);
  });
});
