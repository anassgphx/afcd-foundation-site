// AFCD Apply, phase 5: rubric, assignments, conflict of interest, blind reviews, final locked scores, shortlists and
// four-eyes decisions.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client } from './helpers.ts';
import { applyDecisions, applySubmissions, auditLog, users } from '../src/server/db/schema.ts';
import { aggregate, weightedScore } from '../src/server/modules/apply/evaluation.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
afterEach(async () => { await h?.close(); h = undefined; });
const SITE = 'http://localhost:4321';
const DESC = 'Young people from Al Haouz join a twelve-week programme on climate action. Participants meet every Saturday, plan a local project with mentors and present it at the end.';
const RUBRIC = [
  { id: 'motivation', label: 'Motivation', weight: 30, min: 1, max: 5, commentRequired: true },
  { id: 'relevance', label: 'Relevance', weight: 30, min: 1, max: 5 },
  { id: 'impact', label: 'Impact', weight: 40, min: 0, max: 10 },
];

describe('scores', () => {
  it('are integers from the rubric, rounded half up, the same every time', () => {
    expect(weightedScore(RUBRIC, { motivation: 5, relevance: 5, impact: 10 })).toBe(10000);
    expect(weightedScore(RUBRIC, { motivation: 1, relevance: 1, impact: 0 })).toBe(0);
    expect(weightedScore(RUBRIC, { motivation: 3, relevance: 3, impact: 5 })).toBe(5000);
    // 0.3*(3/4) + 0.3*(1/4) + 0.4*(7/10) = 0.225 + 0.075 + 0.28 = 0.58
    expect(weightedScore(RUBRIC, { motivation: 4, relevance: 2, impact: 7 })).toBe(5800);
    expect(weightedScore([{ id: 'a', label: 'A', weight: 1, min: 0, max: 3 }], { a: 1 })).toBe(3333);
    expect(weightedScore([{ id: 'a', label: 'A', weight: 1, min: 0, max: 3 }], { a: 2 })).toBe(6667);
    expect(weightedScore(RUBRIC, { motivation: 4, relevance: 2 })).toBeNull();
    expect(weightedScore(RUBRIC, { motivation: 6, relevance: 2, impact: 7 })).toBeNull();
    expect(aggregate([8000, 5000], 20)).toEqual({ scoreBp: 6500, disagreement: true });
    expect(aggregate([7001, 6000], 20)).toEqual({ scoreBp: 6501, disagreement: false });
    expect(aggregate([], 20)).toEqual({ scoreBp: null, disagreement: false });
  });
});

describe('evaluation', () => {
  let mgr: Awaited<ReturnType<typeof client>>, callId: string, subs: string[], ids: Record<string, string>;
  beforeEach(async () => {
    h = await makeApp();
    for (const [e, r] of [['mgr@afcd.test', 'application_manager'], ['mgr2@afcd.test', 'application_manager'], ['rev@afcd.test', 'content_reviewer'], ['r1@afcd.test', 'application_reviewer'],
      ['r2@afcd.test', 'application_reviewer'], ['ed@afcd.test', 'content_editor']] as const) await addUser(h.db, e, r);
    ids = Object.fromEntries((await h.db.select().from(users)).map((u) => [u.email, u.id]));
    mgr = await client(h.app, 'mgr@afcd.test');
    const rv = await client(h.app, 'rev@afcd.test');
    callId = (await mgr.post('/apply/calls', { title: 'Youth 2099', slug: 'youth-2099', summary: 'A programme.', description: DESC, eligibility: ['Aged 18 to 30'], opensLocal: '2026-01-01T09:00',
      closesLocal: '2099-02-15T23:59', contactEmail: 'apply@afcd.test', privacyNotice: 'We collect your name, contact details and answers to assess your application, then delete them after a year.' })).body.id;
    const f = (await mgr.post(`/apply/calls/${callId}/form`, { template: 'youth_program' })).body.form;
    await mgr.post(`/apply/calls/${callId}/form/publish`, { rev: f.rev });
    await mgr.post(`/apply/calls/${callId}/transition`, { action: 'submit' });
    await rv.post(`/apply/calls/${callId}/transition`, { action: 'approve' });
    await mgr.post(`/apply/calls/${callId}/transition`, { action: 'schedule' });
    for (let i = 0; i < 3; i++) {
      const req = async (method: string, path: string, body: unknown, token = '') => (await h!.app.request(`/apply/v1${path}`, { method, headers: { Origin: SITE, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })).json() as Promise<any>;
      const tok = (await req('POST', '/calls/youth-2099/drafts', {})).token;
      await req('PUT', '/drafts/me', { rev: 1, answers: { full_name: `Applicant ${i}`, email: `a${i}@example.org`, city: 'Ait Ourir', age: 20 + i, motivation: 'Test motivation text. '.repeat(6), volunteered: false, availability: ['saturday'], consent_privacy: true, consent_truth: true } }, tok);
      await req('POST', '/drafts/me/submit', { idempotencyKey: `eval-key-${i}-1234567890` }, tok);
    }
    subs = (await h.db.select().from(applySubmissions).orderBy(applySubmissions.reference)).map((s) => s.id);
  });

  async function setup() {
    expect((await mgr.put(`/apply/calls/${callId}/rubric`, { criteria: RUBRIC, settings: { mode: 'double', reviewersPerApplication: 3, blind: true, disagreementPoints: 20 }, rev: 0 })).status).toBe(422);
    expect((await mgr.put(`/apply/calls/${callId}/rubric`, { criteria: RUBRIC, settings: { mode: 'double', reviewersPerApplication: 2, blind: true, disagreementPoints: 20 }, rev: 0 })).body.rev).toBe(1);
    expect((await mgr.post(`/apply/calls/${callId}/assignments`, { submissionIds: subs, reviewerIds: [ids['r1@afcd.test']] })).status).toBe(409);   // not published
    expect((await mgr.post(`/apply/calls/${callId}/rubric/publish`)).body.version).toBe(1);
    expect((await mgr.post(`/apply/calls/${callId}/assignments`, { submissionIds: subs, reviewerIds: [ids['ed@afcd.test']] })).status).toBe(422);  // cannot review
    const a = await mgr.post(`/apply/calls/${callId}/assignments`, { submissionIds: subs, reviewerIds: [ids['r1@afcd.test'], ids['r2@afcd.test']] });
    expect(a.body).toEqual({ created: 6, notEnoughReviewers: 0 });
    expect((await mgr.post(`/apply/calls/${callId}/assignments`, { submissionIds: subs, reviewerIds: [ids['r1@afcd.test'], ids['r2@afcd.test']] })).body.created).toBe(0);   // idempotent
  }

  it('assigns reviewers, who see only their own work, blind, after declaring conflicts', async () => {
    await setup();
    expect((await h!.db.select().from(applySubmissions)).every((s) => s.status === 'under_evaluation')).toBe(true);
    const r1 = await client(h!.app, 'r1@afcd.test'), r2 = await client(h!.app, 'r2@afcd.test');
    expect((await r1.get('/apply/submissions')).status).toBe(403);                  // reviewers never get the list of applications
    expect((await r1.get(`/apply/calls/${callId}/evaluation`)).status).toBe(403);
    const mine = (await r1.get('/apply/my-reviews')).body;
    expect(mine).toHaveLength(3);
    const a = mine[0].id;
    const before = (await r1.get(`/apply/reviews/${a}`)).body;
    expect(before.application).toBeNull();                                          // nothing before the declaration
    const theirs = (await r2.get('/apply/my-reviews')).body[0].id;
    expect((await r1.get(`/apply/reviews/${theirs}`)).status).toBe(404);
    expect((await r1.put(`/apply/reviews/${theirs}`, { scores: {}, comments: {}, overallComment: '', recommendation: null, rev: 0 })).status).toBe(404);
    expect((await r1.put(`/apply/reviews/${a}`, { scores: {}, comments: {}, overallComment: '', recommendation: null, rev: 0 })).status).toBe(409);   // declare first
    expect((await r1.post(`/apply/reviews/${a}/coi`, { hasConflict: false })).body.status).toBe('in_progress');
    expect((await r1.post(`/apply/reviews/${a}/coi`, { hasConflict: true, note: 'changed my mind' })).status).toBe(409);
    const v = (await r1.get(`/apply/reviews/${a}`)).body;
    expect(v.application.answers).not.toHaveProperty('email');
    expect(v.application.answers).not.toHaveProperty('full_name');
    expect(v.application.applicantName).toBeNull();
    expect(v.application.reference).toMatch(/^Application \d{4}$/);
    expect(v.application.answers.motivation).toBeTruthy();
    expect(v.application.files).toBeNull();
    // a conflict closes the assignment for that reviewer
    const c = (await r2.get('/apply/my-reviews')).body[0].id;
    expect((await r2.post(`/apply/reviews/${c}/coi`, { hasConflict: true })).status).toBe(422);    // needs a note
    expect((await r2.post(`/apply/reviews/${c}/coi`, { hasConflict: true, note: 'Applicant is my cousin' })).body.status).toBe('conflict');
    expect((await r2.get(`/apply/reviews/${c}`)).body.application).toBeNull();
  });

  it('locks final reviews, computes scores on the server and flags disagreement', async () => {
    await setup();
    const r1 = await client(h!.app, 'r1@afcd.test'), r2 = await client(h!.app, 'r2@afcd.test');
    const pick = async (cl: typeof r1, sub: string) => {
      const ref = (await h!.db.select().from(applySubmissions).where(eq(applySubmissions.id, sub)))[0].reference;
      const a = (await cl.get('/apply/my-reviews')).body.find((x: { reference: string }) => x.reference === ref).id;
      await cl.post(`/apply/reviews/${a}/coi`, { hasConflict: false });
      return a;
    };
    const a1 = await pick(r1, subs[0]), a2 = await pick(r2, subs[0]);
    expect((await r1.put(`/apply/reviews/${a1}`, { scores: { motivation: 9 }, comments: {}, overallComment: '', recommendation: null, rev: 0 })).status).toBe(422);
    expect((await r1.put(`/apply/reviews/${a1}`, { scores: { motivation: 5, relevance: 5 }, comments: {}, overallComment: '', recommendation: 'yes', rev: 0 })).body.rev).toBe(1);
    expect((await r1.put(`/apply/reviews/${a1}`, { scores: {}, comments: {}, overallComment: '', recommendation: null, rev: 0 })).status).toBe(409);   // stale
    const incomplete = await r1.post(`/apply/reviews/${a1}/final`, { rev: 1 });
    expect(incomplete.status).toBe(422);
    expect(incomplete.body.details.map((d: { message: string }) => d.message)).toEqual(['Score “Impact”.', 'Comment on “Motivation”.']);
    await r1.put(`/apply/reviews/${a1}`, { scores: { motivation: 5, relevance: 5, impact: 10 }, comments: { motivation: 'Clear and committed' }, overallComment: 'Strong', recommendation: 'yes', rev: 1 });
    expect((await r1.post(`/apply/reviews/${a1}/final`, { rev: 2 })).body.totalBp).toBe(10000);
    expect((await r1.put(`/apply/reviews/${a1}`, { scores: { motivation: 1, relevance: 1, impact: 0 }, comments: {}, overallComment: '', recommendation: 'no', rev: 2 })).status).toBe(409);   // locked
    expect((await mgr.raw('DELETE', `/apply/assignments/${a1}`)).status).toBe(409);
    await r2.put(`/apply/reviews/${a2}`, { scores: { motivation: 3, relevance: 3, impact: 5 }, comments: { motivation: 'Average' }, overallComment: '', recommendation: 'maybe', rev: 0 });
    await r2.post(`/apply/reviews/${a2}/final`, { rev: 1 });
    const [s] = await h!.db.select().from(applySubmissions).where(eq(applySubmissions.id, subs[0]));
    expect(s).toMatchObject({ scoreBp: 7500, scoreReviews: 2, disagreement: true });   // 100 vs 50 points, more than 20 apart
    const all = (await mgr.get(`/apply/submissions/${subs[0]}/reviews`)).body;
    expect(all.map((x: { totalBp: number }) => x.totalBp).sort()).toEqual([10000, 5000]);
    expect((await r1.get(`/apply/submissions/${subs[0]}/reviews`)).status).toBe(403);
    const p = (await mgr.get(`/apply/calls/${callId}/evaluation`)).body;
    expect(p.workload.map((w: { final: number }) => w.final)).toEqual([1, 1]);
    expect((await mgr.get('/apply/overview')).body.reviews.pending).toBe(4);
    expect((await r1.get('/apply/overview')).body.myPending).toBe(2);
  });

  it('shortlists and decides with four eyes; nothing is sent to applicants', async () => {
    await setup();
    expect((await mgr.post(`/apply/submissions/${subs[0]}/status`, { to: 'shortlisted', reason: 'Top score' })).body.status).toBe('shortlisted');
    expect((await mgr.post(`/apply/submissions/${subs[0]}/status`, { to: 'selected' })).status).toBe(409);       // only through a decision
    const r1 = await client(h!.app, 'r1@afcd.test');
    expect((await r1.post('/apply/decisions', { ids: [subs[0]], outcome: 'selected', reason: 'Best fit', confirm: 1 })).status).toBe(403);
    expect((await mgr.post('/apply/decisions', { ids: [subs[0], subs[1]], outcome: 'selected', reason: 'Best fit', confirm: 1 })).status).toBe(422);
    expect((await mgr.post('/apply/decisions', { ids: [subs[0], subs[1]], outcome: 'selected', reason: 'Best fit', confirm: 2 })).body.proposed).toBe(2);
    expect((await mgr.post('/apply/decisions', { ids: [subs[0]], outcome: 'waitlisted', reason: 'Again', confirm: 1 })).status).toBe(409);   // one open proposal at a time
    const ds = (await mgr.get(`/apply/decisions?call=${callId}&status=proposed`)).body as { id: string; submissionId: string }[];
    expect(ds).toHaveLength(2);
    expect((await mgr.post('/apply/decisions/decide', { ids: ds.map((d) => d.id), approve: true, confirm: 2 })).status).toBe(409);       // not their own
    const m2 = await client(h!.app, 'mgr2@afcd.test');
    expect((await m2.post('/apply/decisions/decide', { ids: ds.map((d) => d.id), approve: false, confirm: 2 })).status).toBe(422);       // rejecting needs a reason
    const one = ds.find((d) => d.submissionId === subs[1])!;
    expect((await m2.post('/apply/decisions/decide', { ids: [one.id], approve: false, note: 'Not enough reviews yet', confirm: 1 })).body.done).toBe(1);
    const other = ds.find((d) => d.submissionId === subs[0])!;
    expect((await m2.post('/apply/decisions/decide', { ids: [other.id], approve: true, confirm: 1 })).body.done).toBe(1);
    const rows = await h!.db.select().from(applySubmissions);
    expect(rows.find((s) => s.id === subs[0])!.status).toBe('selected');
    expect(rows.find((s) => s.id === subs[1])!.status).toBe('under_evaluation');
    expect((await h!.db.select().from(applyDecisions)).every((d) => d.notifiedAt === null)).toBe(true);
    expect((await mgr.post('/apply/decisions', { ids: [subs[2]], outcome: 'not_selected', reason: 'Lower score', confirm: 1 })).status).toBe(201);
    const subTwo = (await h!.db.select().from(applySubmissions).where(eq(applySubmissions.id, subs[2])))[0];
    await mgr.post(`/apply/submissions/${subTwo.id}/status`, { to: 'withdrawn', reason: 'Applicant withdrew' });
    expect((await mgr.post('/apply/decisions', { ids: [subs[2]], outcome: 'selected', reason: 'x y z', confirm: 1 })).status).toBe(409);
    const acts = (await h!.db.select().from(auditLog)).map((a) => a.action);
    expect(acts).toEqual(expect.arrayContaining(['apply.decision.propose', 'apply.decision.approve', 'apply.decision.reject']));
  });
});
