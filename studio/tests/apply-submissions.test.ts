// AFCD Apply, phase 4: transactional, idempotent submission; eligibility; the staff list, detail, files and status.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN } from './helpers.ts';
import { applyDrafts, applyFiles, applySubmissionEvents, applySubmissions, auditLog } from '../src/server/db/schema.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
afterEach(async () => { await h?.close(); h = undefined; });
const SITE = 'http://localhost:4321';
const DESC = 'Young people from Al Haouz join a twelve-week programme on climate action. Participants meet every Saturday, plan a local project with mentors and present it at the end.';
const PDF = () => new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n');

function pub() {
  let token = '';
  const req = async (method: string, path: string, body?: unknown) => {
    const res = await h!.app.request(`/apply/v1${path}`, { method, headers: { Origin: SITE, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  return { req, set: (t: string) => { token = t; } };
}

async function openCall(template = 'youth_program', slug = 'youth-2099') {
  const mgr = await client(h!.app, 'mgr@afcd.test'), rev = await client(h!.app, 'rev@afcd.test');
  const id = (await mgr.post('/apply/calls', { title: 'Youth Programme 2099', slug, summary: 'A programme.', description: DESC, eligibility: ['Aged 18 to 30'], opensLocal: '2026-01-01T09:00',
    closesLocal: '2099-02-15T23:59', contactEmail: 'apply@afcd.test', privacyNotice: 'We collect your name, contact details and answers to assess your application, then delete them after a year.' })).body.id as string;
  const f = (await mgr.post(`/apply/calls/${id}/form`, { template })).body.form;
  await mgr.post(`/apply/calls/${id}/form/publish`, { rev: f.rev });
  await mgr.post(`/apply/calls/${id}/transition`, { action: 'submit' });
  await rev.post(`/apply/calls/${id}/transition`, { action: 'approve' });
  expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'schedule' })).body.status).toBe('open');
  return { id, mgr, slug };
}
const youth = (over: Record<string, unknown> = {}) => ({ full_name: 'Test Applicant', email: 'Applicant@Example.org', city: 'Ait Ourir', age: 25, motivation: 'Test motivation text. '.repeat(6),
  volunteered: false, availability: ['saturday'], consent_privacy: true, consent_truth: true, ...over });

async function apply(slug: string, answers: Record<string, unknown>, key = `key-${Math.random().toString(36).slice(2)}-abcdefgh`) {
  const p = pub();
  p.set((await p.req('POST', `/calls/${slug}/drafts`, {})).body.token);
  expect((await p.req('PUT', '/drafts/me', { rev: 1, answers })).status).toBe(200);
  return { p, key, submit: () => p.req('POST', '/drafts/me/submit', { idempotencyKey: key }) };
}

describe('apply: submitting', () => {
  beforeEach(async () => { h = await makeApp(); await addUser(h.db, 'mgr@afcd.test', 'application_manager'); await addUser(h.db, 'rev@afcd.test', 'content_reviewer'); });

  it('stores one application per draft, whatever happens: retries, other keys, races', async () => {
    const { slug } = await openCall();
    const a = await apply(slug, youth({ volunteer_details: 'Should be dropped: the question is hidden' }));
    const [r1, r2] = await Promise.all([a.submit(), a.submit()]);
    expect(r1.status).toBe(200); expect(r2.status).toBe(200);
    expect(r1.body.reference).toMatch(/^AFCD-\d{4}-001-0001$/);
    expect(r2.body.reference).toBe(r1.body.reference);
    expect((await a.p.req('POST', '/drafts/me/submit', { idempotencyKey: 'another-key-1234567890' })).body).toMatchObject({ reference: r1.body.reference, already: true });
    const rows = await h!.db.select().from(applySubmissions);
    expect(rows).toHaveLength(1);
    const s = rows[0];
    expect(s.answers).not.toHaveProperty('volunteer_details');
    expect(s.applicantEmail).toBe('applicant@example.org');
    expect(s.applicantName).toBe('Test Applicant');
    expect(s.eligibilityAuto).toMatchObject({ result: 'not_assessed', formVersion: 1 });
    expect(s.consent.map((c) => c.field)).toEqual(['consent_privacy', 'consent_truth']);
    expect(s.consent[0].label).toMatch(/privacy notice/);
    expect((await h!.db.select().from(applyDrafts))[0].status).toBe('submitted');
    expect((await a.p.req('GET', '/drafts/me')).status).toBe(404);        // a submitted draft can no longer be opened
    expect((await a.p.req('PUT', '/drafts/me', { rev: 2, answers: {} })).status).toBe(404);
    const audits = (await h!.db.select().from(auditLog).where(eq(auditLog.action, 'apply.submission.received'))).map((x) => `${x.summary}${JSON.stringify(x.meta)}`).join(' ');
    expect(audits).not.toMatch(/Applicant|example\.org/i);
    const b = await apply(slug, youth({ email: 'second@example.org' }));
    expect((await b.submit()).body.reference).toMatch(/-0002$/);
  });

  it('validates on the server, records eligibility with its reasons, and refuses after the deadline', async () => {
    const { id, mgr, slug } = await openCall();
    const bad = await apply(slug, youth({ consent_truth: false, motivation: 'Too short' }));
    const r = await bad.submit();
    expect(r.status).toBe(422);
    expect(r.body.details.map((d: { path: string }) => d.path).sort()).toEqual(['consent.consent_truth', 'motivation_page.motivation']);
    expect(await h!.db.select().from(applySubmissions)).toEqual([]);
    const young = await apply(slug, youth({ age: 16 }));
    expect((await young.submit()).status).toBe(200);
    const [s] = await h!.db.select().from(applySubmissions);
    expect(s.eligibility).toBe('ineligible');
    expect(s.eligibilityAuto).toMatchObject({ result: 'ineligible', rules: ['age_range'] });
    expect(s.status).toBe('submitted');                                    // flagged, never rejected automatically
    const late = await apply(slug, youth());
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'close', reason: 'Deadline brought forward' });
    expect((await late.submit()).status).toBe(409);
  });

  it('attaches the files the application uses, privately', async () => {
    const { slug } = await openCall('fellowship', 'fellows-2099');
    const p = pub();
    p.set((await p.req('POST', `/calls/${slug}/drafts`, {})).body.token);
    const fd = new FormData(); fd.append('field', 'cv'); fd.append('file', new File([PDF() as unknown as BlobPart], 'cv.pdf'));
    const f = (await p.req('POST', '/drafts/me/files', fd)).body;
    await p.req('PUT', '/drafts/me', { rev: 1, answers: { full_name: 'Test Fellow', email: 'fellow@example.org', city: 'Marrakech', age: 27, education: 'master', cv: [{ id: f.id }],
      project_title: 'Test project', project_summary: 'Test summary text. '.repeat(10), motivation: 'Test motivation text. '.repeat(6), consent_privacy: true, consent_truth: true } });
    expect((await p.req('POST', '/drafts/me/submit', { idempotencyKey: 'fellow-key-1234567890' })).status).toBe(200);
    const [s] = await h!.db.select().from(applySubmissions);
    const [row] = await h!.db.select().from(applyFiles);
    expect(row.submissionId).toBe(s.id);
    const mgr = await client(h!.app, 'mgr@afcd.test');
    const d = await mgr.get(`/apply/submissions/${s.id}`);
    expect(d.body.files).toHaveLength(1);
    expect(d.body).not.toHaveProperty('ipHash');
    expect(d.body).not.toHaveProperty('idempotencyKey');
    const res = await h!.app.request(`/studio/api/apply/submissions/${s.id}/files/${row.id}`, { headers: { Cookie: mgr.cookie, Origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment/);
    expect(res.headers.get('content-security-policy')).toMatch(/sandbox/);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF());
    expect((await h!.db.select().from(applySubmissionEvents).where(eq(applySubmissionEvents.kind, 'download'))).length).toBe(1);
    expect((await h!.db.select().from(auditLog).where(eq(auditLog.action, 'apply.file.download'))).length).toBe(1);
  });
});

describe('apply: staff side of applications', () => {
  let call: Awaited<ReturnType<typeof openCall>>;
  beforeEach(async () => {
    h = await makeApp();
    for (const [e, r] of [['mgr@afcd.test', 'application_manager'], ['rev@afcd.test', 'content_reviewer'], ['ar@afcd.test', 'application_reviewer'], ['ed@afcd.test', 'content_editor']] as const) await addUser(h.db, e, r);
    call = await openCall();
  });

  it('keeps applications from roles that should not see personal data', async () => {
    await (await apply(call.slug, youth())).submit();
    for (const e of ['ar@afcd.test', 'ed@afcd.test', 'rev@afcd.test']) expect((await (await client(h!.app, e)).get('/apply/submissions')).status, e).toBe(403);
    const o = (await (await client(h!.app, 'ar@afcd.test')).get('/apply/overview')).body;
    expect(o.applications.total).toBe(1);
    expect(o.recent).toBeNull();
    expect((await call.mgr.get('/apply/overview')).body.recent).toHaveLength(1);
  });

  it('lists 50 at a time on the server, filters and searches', async () => {
    for (let i = 0; i < 12; i++) await (await apply(call.slug, youth({ full_name: `Applicant ${i}`, email: `a${i}@example.org`, age: i === 3 ? 16 : 25 }))).submit();
    const p1 = await call.mgr.get('/apply/submissions?limit=10');
    expect(p1.body.items).toHaveLength(10);
    expect(p1.body.total).toBe(12);
    expect(p1.body.items[0].applicantName).toBe('Applicant 11');
    const p2 = await call.mgr.get(`/apply/submissions?limit=10&cursor=${p1.body.next}`);
    expect(p2.body.items.map((x: { applicantName: string }) => x.applicantName)).toEqual(['Applicant 1', 'Applicant 0']);
    expect(p2.body.next).toBeNull();
    expect((await call.mgr.get('/apply/submissions?eligibility=ineligible')).body.items.map((x: { applicantName: string }) => x.applicantName)).toEqual(['Applicant 3']);
    expect((await call.mgr.get('/apply/submissions?q=a7%40example')).body.total).toBe(1);
    expect((await call.mgr.get('/apply/submissions?q=%25')).body.total).toBe(0);    // "%" is searched literally
    expect((await call.mgr.get(`/apply/submissions?call=${call.id}&status=submitted`)).body.total).toBe(12);
    expect((await call.mgr.get('/apply/submissions?cursor=garbage')).status).toBe(422);
    // a pipeline stage asks for several statuses at once
    expect((await call.mgr.get(`/apply/submissions?call=${call.id}&status=submitted,withdrawn`)).body.total).toBe(12);
    expect((await call.mgr.get(`/apply/submissions?call=${call.id}&status=shortlisted,interview`)).body.total).toBe(0);
    expect((await call.mgr.get('/apply/submissions?status=submitted,nonsense')).status).toBe(422);
  });

  it('changes status with a reason and a confirmed count, and corrects eligibility without losing the automatic result', async () => {
    for (let i = 0; i < 3; i++) await (await apply(call.slug, youth({ email: `b${i}@example.org`, age: i === 0 ? 16 : 25 }))).submit();
    const ids = (await call.mgr.get('/apply/submissions')).body.items.map((x: { id: string }) => x.id) as string[];
    const one = ids[0];
    expect((await call.mgr.post(`/apply/submissions/${one}/status`, { to: 'selected' })).status).toBe(409);       // decisions come with evaluation
    expect((await call.mgr.post(`/apply/submissions/${one}/status`, { to: 'withdrawn' })).status).toBe(422);      // needs a reason
    expect((await call.mgr.post(`/apply/submissions/${one}/status`, { to: 'under_evaluation', reason: 'Complete file' })).body.status).toBe('under_evaluation');
    expect((await call.mgr.post('/apply/submissions/bulk-status', { ids: ids.slice(1), to: 'eligibility_review', reason: 'Check documents', confirm: 3 })).status).toBe(422);
    expect((await call.mgr.post('/apply/submissions/bulk-status', { ids: ids.slice(1), to: 'eligibility_review', reason: 'Check documents', confirm: 2 })).body.moved).toBe(2);
    expect((await call.mgr.post('/apply/submissions/bulk-status', { ids, to: 'eligibility_review', reason: 'Again', confirm: 3 })).status).toBe(409);   // all or none
    expect((await h!.db.select().from(applySubmissions).where(eq(applySubmissions.id, one)))[0].status).toBe('under_evaluation');
    const young = (await call.mgr.get('/apply/submissions?eligibility=ineligible')).body.items[0].id;
    expect((await call.mgr.post(`/apply/submissions/${young}/eligibility`, { result: 'eligible', reason: 'x' })).status).toBe(422);
    expect((await call.mgr.post(`/apply/submissions/${young}/eligibility`, { result: 'eligible', reason: 'Turns 18 before the programme starts' })).status).toBe(200);
    let d = (await call.mgr.get(`/apply/submissions/${young}`)).body;
    expect(d).toMatchObject({ eligibility: 'eligible', eligibilityAuto: { result: 'ineligible' }, eligibilityOverride: { result: 'eligible', reason: 'Turns 18 before the programme starts' } });
    await call.mgr.post(`/apply/submissions/${young}/eligibility`, { clear: true });
    d = (await call.mgr.get(`/apply/submissions/${young}`)).body;
    expect(d).toMatchObject({ eligibility: 'ineligible', eligibilityOverride: null });
    await call.mgr.post(`/apply/submissions/${young}/notes`, { body: 'Called the applicant: private note' });
    d = (await call.mgr.get(`/apply/submissions/${young}`)).body;
    expect(d.events.map((e: { kind: string }) => e.kind)).toEqual(['note', 'eligibility', 'eligibility', 'status', 'submitted']);
    const notes = (await h!.db.select().from(auditLog).where(eq(auditLog.action, 'apply.submission.note'))).map((a) => `${a.summary}${JSON.stringify(a.meta)}`).join('');
    expect(notes).not.toContain('private note');
    expect((await (await client(h!.app, 'rev@afcd.test')).post(`/apply/submissions/${one}/notes`, { body: 'x' })).status).toBe(403);
  });
});
