// AFCD Apply evaluation: rubric (working copy + immutable versions), reviewer assignments, conflict-of-interest
// declarations, blind mode, draft and final reviews, and scores. Reviewers reach ONLY their own assignments (every query
// filters on reviewer = me); a final review is locked; scores are integers computed on the server from the rubric
// version the assignment uses, so the same review always gives the same score.
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { applyAssignments, applyCalls, applyFiles, applyFormVersions, applyReviews, applyRubrics, applyRubricVersions, applySubmissionEvents, applySubmissions, users,
  type RubricCriterion, type RubricSettings } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { can, type Role } from '../../rbac.ts';
import { allFields, type FormDef } from './engine.ts';

type Me = NonNullable<Actor>;
const uuid = z.string().uuid();
const ID = /^[a-z][a-z0-9_]{0,39}$/;

// ---------------------------------------------------------------- Scoring (pure)
const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const lcm = (a: number, b: number) => (a / gcd(a, b)) * b;
/** Weighted score in basis points (0–10000), integer arithmetic only. Each criterion is scaled to 0..1 on its own range,
 *  weighted, and the result rounded half up. Returns null while any criterion is unscored or out of range. */
export function weightedScore(criteria: RubricCriterion[], scores: Record<string, number>): number | null {
  if (!criteria.length) return null;
  const R = criteria.reduce((acc, c) => lcm(acc, c.max - c.min), 1);
  const W = criteria.reduce((s, c) => s + c.weight, 0);
  if (!W) return null;
  let num = 0;
  for (const c of criteria) {
    const s = scores[c.id];
    if (!Number.isInteger(s) || s < c.min || s > c.max) return null;
    num += c.weight * (s - c.min) * (R / (c.max - c.min));
  }
  return Math.floor((2 * num * 10000 + W * R) / (2 * W * R));
}
/** Mean of final scores (rounded half up) and whether reviewers are further apart than the threshold. */
export function aggregate(finals: number[], disagreementPoints: number) {
  if (!finals.length) return { scoreBp: null as number | null, disagreement: false };
  const sum = finals.reduce((a, b) => a + b, 0);
  return { scoreBp: Math.floor((2 * sum + finals.length) / (2 * finals.length)), disagreement: finals.length > 1 && Math.max(...finals) - Math.min(...finals) > disagreementPoints * 100 };
}

// ---------------------------------------------------------------- Rubric
const criterionSchema = z.object({
  id: z.string().regex(ID), label: z.string().trim().min(2).max(160).refine((v) => !/[<>]/.test(v), 'Plain text only.'), description: z.string().trim().max(1000).optional(),
  weight: z.number().int().min(1).max(100), min: z.number().int().min(0).max(100), max: z.number().int().min(1).max(100), commentRequired: z.boolean().optional(),
}).strict().refine((c) => c.max > c.min, 'The highest score must be above the lowest.');
const settingsSchema = z.object({
  mode: z.enum(['single', 'double', 'committee', 'panel', 'consensus']), reviewersPerApplication: z.number().int().min(1).max(12), blind: z.boolean(), disagreementPoints: z.number().int().min(1).max(100),
}).strict().superRefine((s, ctx) => {
  const need = s.mode === 'single' ? 1 : s.mode === 'double' ? 2 : null;
  if (need && s.reviewersPerApplication !== need) ctx.addIssue({ code: 'custom', path: ['reviewersPerApplication'], message: `${s.mode === 'single' ? 'One reviewer' : 'Two reviewers'} per application in this mode.` });
  if (!need && s.reviewersPerApplication < 2) ctx.addIssue({ code: 'custom', path: ['reviewersPerApplication'], message: 'A committee, panel or consensus needs at least 2 reviewers.' });
});
const DEFAULT_SETTINGS: RubricSettings = { mode: 'double', reviewersPerApplication: 2, blind: true, disagreementPoints: 20 };
const DEFAULT_CRITERIA: RubricCriterion[] = [
  { id: 'motivation', label: 'Motivation and commitment', weight: 30, min: 1, max: 5, commentRequired: true },
  { id: 'relevance', label: 'Relevance of experience', weight: 30, min: 1, max: 5 },
  { id: 'potential', label: 'Potential impact in the community', weight: 40, min: 1, max: 5, commentRequired: true },
];

async function callOf(db: DB, callId: string) {
  if (!uuid.safeParse(callId).success) throw new AppError(404, 'Call not found.');
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, callId));
  if (!c) throw new AppError(404, 'Call not found.');
  return c;
}

export async function getRubric(db: DB, callId: string) {
  await callOf(db, callId);
  const [r] = await db.select().from(applyRubrics).where(eq(applyRubrics.callId, callId));
  const versions = r ? await db.select({ id: applyRubricVersions.id, number: applyRubricVersions.number, createdAt: applyRubricVersions.createdAt }).from(applyRubricVersions).where(eq(applyRubricVersions.rubricId, r.id)).orderBy(desc(applyRubricVersions.number)) : [];
  return r ? { ...r, versions } : { id: null, callId, criteria: DEFAULT_CRITERIA, settings: DEFAULT_SETTINGS, rev: 0, publishedVersionId: null, versions: [] };
}

export async function saveRubric(db: DB, me: Me, callId: string, raw: unknown) {
  const b = z.object({ criteria: z.array(criterionSchema).min(1, 'Add at least one criterion.').max(20), settings: settingsSchema, rev: z.number().int().min(0) }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, b.error.issues[0]?.message ?? 'Check the rubric.', b.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  if (new Set(b.data.criteria.map((c) => c.id)).size !== b.data.criteria.length) throw new AppError(422, 'Two criteria have the same ID.');
  await callOf(db, callId);
  const [cur] = await db.select().from(applyRubrics).where(eq(applyRubrics.callId, callId));
  if ((cur?.rev ?? 0) !== b.data.rev) throw new AppError(409, 'Someone else saved this rubric after you opened it. Reload and try again.');
  if (!cur) {
    const [r] = await db.insert(applyRubrics).values({ callId, criteria: b.data.criteria, settings: b.data.settings, updatedBy: me.id }).onConflictDoNothing().returning();
    if (!r) throw new AppError(409, 'Someone else created this rubric just now. Reload.');
    return { rev: r.rev };
  }
  const [r] = await db.update(applyRubrics).set({ criteria: b.data.criteria, settings: b.data.settings, rev: cur.rev + 1, updatedBy: me.id, updatedAt: new Date() }).where(and(eq(applyRubrics.id, cur.id), eq(applyRubrics.rev, cur.rev))).returning();
  if (!r) throw new AppError(409, 'Someone else saved this rubric after you opened it. Reload and try again.');
  return { rev: r.rev };
}

/** Freezes the saved rubric as a new version. New assignments use it; existing ones keep the version they started with. */
export async function publishRubric(db: DB, me: Me, callId: string) {
  const c = await callOf(db, callId);
  const [r] = await db.select().from(applyRubrics).where(eq(applyRubrics.callId, callId));
  if (!r) throw new AppError(409, 'Save the rubric first.');
  const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${applyRubricVersions.number}), 0)::int` }).from(applyRubricVersions).where(eq(applyRubricVersions.rubricId, r.id));
  const [v] = await db.insert(applyRubricVersions).values({ rubricId: r.id, callId, number: n + 1, criteria: r.criteria, settings: r.settings, publishedBy: me.id }).returning();
  await db.update(applyRubrics).set({ publishedVersionId: v.id }).where(eq(applyRubrics.id, r.id));
  await audit(db, me, 'apply.rubric.publish', { type: 'apply_call', id: callId }, `Published rubric version ${v.number} of ${c.reference}`);
  return { version: v.number };
}

// ---------------------------------------------------------------- Assignments
/** Gives each application `perApplication` reviewers (or the rubric's number), choosing the least loaded reviewers first
 *  and never the same reviewer twice for one application. Existing assignments count. */
export async function assign(db: DB, me: Me, callId: string, raw: unknown) {
  const b = z.object({ submissionIds: z.array(z.string().uuid()).min(1).max(1000), reviewerIds: z.array(z.string().uuid()).min(1).max(100), perApplication: z.number().int().min(1).max(12).optional() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Choose applications and reviewers.');
  const c = await callOf(db, callId);
  const [r] = await db.select().from(applyRubrics).where(eq(applyRubrics.callId, callId));
  if (!r?.publishedVersionId) throw new AppError(409, 'Publish the rubric before assigning reviewers.');
  const [v] = await db.select().from(applyRubricVersions).where(eq(applyRubricVersions.id, r.publishedVersionId));
  const per = b.data.perApplication ?? v.settings.reviewersPerApplication;
  const reviewers = await db.select({ id: users.id, role: users.role, active: users.active, name: users.name }).from(users).where(inArray(users.id, b.data.reviewerIds));
  const bad = reviewers.filter((u) => !u.active || !can(u.role as Role, 'apply.review') && !can(u.role as Role, 'apply.evaluation.manage'));
  if (reviewers.length !== b.data.reviewerIds.length || bad.length) throw new AppError(422, 'Every reviewer must be an active user whose role can review applications.');
  const subs = await db.select({ id: applySubmissions.id, reference: applySubmissions.reference, status: applySubmissions.status, deletedAt: applySubmissions.deletedAt }).from(applySubmissions).where(and(eq(applySubmissions.callId, callId), inArray(applySubmissions.id, b.data.submissionIds)));
  if (subs.length !== b.data.submissionIds.length) throw new AppError(422, 'Some applications do not belong to this call.');
  if (subs.some((s) => s.status === 'withdrawn')) throw new AppError(409, 'Withdrawn applications are not reviewed.');
  const binned = subs.filter((s) => s.deletedAt);
  if (binned.length) throw new AppError(409, `In the bin: ${binned.map((s) => s.reference).join(', ')}. Restore first.`);
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const existing = await t2.select({ submissionId: applyAssignments.submissionId, reviewerId: applyAssignments.reviewerId, status: applyAssignments.status }).from(applyAssignments).where(eq(applyAssignments.callId, callId));
    const load = new Map(reviewers.map((u) => [u.id, existing.filter((e) => e.reviewerId === u.id && e.status !== 'conflict').length]));
    const rows: (typeof applyAssignments.$inferInsert)[] = [];
    let short = 0;
    for (const s of subs) {
      const has = existing.filter((e) => e.submissionId === s.id);
      const active = has.filter((e) => e.status !== 'conflict').length;
      const pool = reviewers.filter((u) => !has.some((e) => e.reviewerId === u.id)).sort((a, b) => load.get(a.id)! - load.get(b.id)! || a.name.localeCompare(b.name));
      const need = Math.max(0, per - active);
      if (pool.length < need) short++;
      for (const u of pool.slice(0, need)) { rows.push({ submissionId: s.id, callId, reviewerId: u.id, rubricVersionId: v.id, assignedBy: me.id }); load.set(u.id, load.get(u.id)! + 1); }
    }
    if (rows.length) await t2.insert(applyAssignments).values(rows);
    const moved = subs.filter((s) => ['submitted', 'eligibility_review'].includes(s.status)).map((s) => s.id);
    for (const id of moved) {
      const [x] = await t2.select({ status: applySubmissions.status }).from(applySubmissions).where(eq(applySubmissions.id, id));
      if (!rows.some((r2) => r2.submissionId === id)) continue;
      await t2.update(applySubmissions).set({ status: 'under_evaluation', updatedAt: new Date() }).where(eq(applySubmissions.id, id));
      await t2.insert(applySubmissionEvents).values({ submissionId: id, actorId: me.id, kind: 'status', fromValue: x.status, toValue: 'under_evaluation', body: 'Reviewers assigned' });
    }
    await audit(tx, me, 'apply.assign', { type: 'apply_call', id: callId }, `Assigned ${rows.length} review(s) for ${c.reference}`, { reviewers: b.data.reviewerIds, applications: subs.length });
    return { created: rows.length, notEnoughReviewers: short };
  });
}

export async function unassign(db: DB, me: Me, assignmentId: string) {
  if (!uuid.safeParse(assignmentId).success) throw new AppError(404, 'Assignment not found.');
  const [a] = await db.select().from(applyAssignments).where(eq(applyAssignments.id, assignmentId));
  if (!a) throw new AppError(404, 'Assignment not found.');
  if (a.status === 'final') throw new AppError(409, 'This review is final and locked; it cannot be removed.');
  await db.delete(applyAssignments).where(eq(applyAssignments.id, a.id));
  await audit(db, me, 'apply.unassign', { type: 'apply_submission', id: a.submissionId }, 'Removed a reviewer assignment', { reviewer: a.reviewerId });
  return { ok: true };
}

/** Per call: every application with its reviewers, final count, score and disagreement; and reviewer workload. */
export async function progress(db: DB, callId: string) {
  await callOf(db, callId);
  const subs = await db.select({ id: applySubmissions.id, reference: applySubmissions.reference, applicantName: applySubmissions.applicantName, status: applySubmissions.status,
    eligibility: applySubmissions.eligibility, scoreBp: applySubmissions.scoreBp, scoreReviews: applySubmissions.scoreReviews, disagreement: applySubmissions.disagreement, submittedAt: applySubmissions.submittedAt })
    .from(applySubmissions).where(and(eq(applySubmissions.callId, callId), isNull(applySubmissions.deletedAt))).orderBy(asc(applySubmissions.submittedAt)).limit(2000);
  const as = await db.select({ id: applyAssignments.id, submissionId: applyAssignments.submissionId, reviewerId: applyAssignments.reviewerId, status: applyAssignments.status, reviewer: users.name, totalBp: applyReviews.totalBp })
    .from(applyAssignments).innerJoin(users, eq(users.id, applyAssignments.reviewerId)).leftJoin(applyReviews, eq(applyReviews.assignmentId, applyAssignments.id)).where(eq(applyAssignments.callId, callId));
  const workload = new Map<string, { reviewerId: string; name: string; assigned: number; final: number; conflict: number }>();
  for (const a of as) {
    const w = workload.get(a.reviewerId) ?? { reviewerId: a.reviewerId, name: a.reviewer, assigned: 0, final: 0, conflict: 0 };
    if (a.status === 'conflict') w.conflict++; else w.assigned++;
    if (a.status === 'final') w.final++;
    workload.set(a.reviewerId, w);
  }
  return { applications: subs.map((s) => ({ ...s, reviews: as.filter((a) => a.submissionId === s.id).map(({ submissionId: _s, ...a }) => a) })), workload: [...workload.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/** Reviewers who can be assigned (active, with a role that reviews). */
export async function reviewerPool(db: DB) {
  const all = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active }).from(users).orderBy(asc(users.name));
  return all.filter((u) => u.active && (can(u.role as Role, 'apply.review') || can(u.role as Role, 'apply.evaluation.manage'))).map(({ active: _a, ...u }) => u);
}

// ---------------------------------------------------------------- Reviewer side (always "my" assignments)
async function mine(db: DB, me: Me, assignmentId: string) {
  if (!uuid.safeParse(assignmentId).success) throw new AppError(404, 'Review not found.');
  const [a] = await db.select().from(applyAssignments).where(and(eq(applyAssignments.id, assignmentId), eq(applyAssignments.reviewerId, me.id)));
  if (!a) throw new AppError(404, 'Review not found.');   // someone else's assignment looks exactly like a missing one
  return a;
}

export async function myAssignments(db: DB, me: Me) {
  return db.select({ id: applyAssignments.id, status: applyAssignments.status, reference: applySubmissions.reference, callTitle: applyCalls.title, callReference: applyCalls.reference, createdAt: applyAssignments.createdAt, reviewStatus: applyReviews.status })
    .from(applyAssignments).innerJoin(applySubmissions, eq(applySubmissions.id, applyAssignments.submissionId)).innerJoin(applyCalls, eq(applyCalls.id, applyAssignments.callId))
    .leftJoin(applyReviews, eq(applyReviews.assignmentId, applyAssignments.id)).where(and(eq(applyAssignments.reviewerId, me.id), isNull(applySubmissions.deletedAt))).orderBy(desc(applyAssignments.createdAt)).limit(500);
}

/** Conflict of interest, declared before the application is shown. A conflict closes the assignment for this reviewer. */
export async function declare(db: DB, me: Me, assignmentId: string, raw: unknown) {
  const b = z.object({ hasConflict: z.boolean(), note: z.string().trim().max(1000).default('') }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Say whether you have a conflict of interest.');
  if (b.data.hasConflict && b.data.note.length < 3) throw new AppError(422, 'Describe the conflict briefly (it is kept with the assignment).');
  const a = await mine(db, me, assignmentId);
  if (a.coi) throw new AppError(409, 'You already declared for this application.');
  await db.update(applyAssignments).set({ coi: { hasConflict: b.data.hasConflict, note: b.data.note, at: new Date().toISOString() }, status: b.data.hasConflict ? 'conflict' : 'in_progress', updatedAt: new Date() }).where(eq(applyAssignments.id, a.id));
  await audit(db, me, b.data.hasConflict ? 'apply.coi.conflict' : 'apply.coi.none', { type: 'apply_submission', id: a.submissionId }, b.data.hasConflict ? 'Declared a conflict of interest' : 'Declared no conflict of interest');
  return { status: b.data.hasConflict ? 'conflict' : 'in_progress' };
}

/** Fields hidden in blind mode: contact details, names, anything the form marks sensitive. */
function blindFields(def: FormDef) {
  return new Set(allFields(def).filter((f) => f.private || ['email', 'phone', 'url'].includes(f.type) || /(^|_)(name|full_name|contact_name|surname|first_name|last_name)$/.test(f.id)).map((f) => f.id));
}

export async function reviewView(db: DB, me: Me, assignmentId: string) {
  const a = await mine(db, me, assignmentId);
  const [v] = await db.select().from(applyRubricVersions).where(eq(applyRubricVersions.id, a.rubricVersionId));
  const [s] = await db.select().from(applySubmissions).where(eq(applySubmissions.id, a.submissionId));
  const [c] = await db.select({ title: applyCalls.title, reference: applyCalls.reference }).from(applyCalls).where(eq(applyCalls.id, a.callId));
  const [review] = await db.select().from(applyReviews).where(eq(applyReviews.assignmentId, a.id));
  const base = { assignment: { id: a.id, status: a.status, coi: a.coi }, call: c, rubric: { number: v.number, criteria: v.criteria, settings: v.settings }, review: review ?? null };
  if (!a.coi || a.coi.hasConflict) return { ...base, application: null };   // nothing about the applicant before the declaration
  const [fv] = await db.select().from(applyFormVersions).where(eq(applyFormVersions.id, s.versionId));
  const def = fv.definition as unknown as FormDef;
  const hide = v.settings.blind ? blindFields(def) : new Set<string>();
  const answers = Object.fromEntries(Object.entries(s.answers).filter(([k]) => !hide.has(k)));
  return { ...base, application: { reference: v.settings.blind ? `Application ${s.reference.slice(-4)}` : s.reference, applicantName: v.settings.blind ? null : s.applicantName,
    eligibility: s.eligibility, formVersion: fv.number, definition: def, answers, hidden: [...hide],
    files: v.settings.blind ? null : await db.select({ id: applyFiles.id, fieldId: applyFiles.fieldId, name: applyFiles.originalName, bytes: applyFiles.bytes }).from(applyFiles).where(eq(applyFiles.submissionId, s.id)) } };
}

const draftSchema = z.object({ scores: z.record(z.string().regex(ID), z.number().int()), comments: z.record(z.string().regex(ID), z.string().max(3000)), overallComment: z.string().max(5000), recommendation: z.enum(['yes', 'maybe', 'no']).nullable(), rev: z.number().int().min(0) }).strict();

async function ensureOpen(db: DB, me: Me, assignmentId: string) {
  const a = await mine(db, me, assignmentId);
  if (!a.coi) throw new AppError(409, 'Declare any conflict of interest first.');
  if (a.coi.hasConflict) throw new AppError(409, 'You declared a conflict of interest for this application.');
  if (a.status === 'final') throw new AppError(409, 'Your review is final and locked.');
  return a;
}

export async function saveReview(db: DB, me: Me, assignmentId: string, raw: unknown) {
  const b = draftSchema.safeParse(raw);
  if (!b.success) throw new AppError(422, 'Check the scores.');
  const a = await ensureOpen(db, me, assignmentId);
  const [v] = await db.select().from(applyRubricVersions).where(eq(applyRubricVersions.id, a.rubricVersionId));
  const ids = new Set(v.criteria.map((c) => c.id));
  for (const [k, s] of Object.entries(b.data.scores)) { const c = v.criteria.find((x) => x.id === k); if (!c || s < c.min || s > c.max) throw new AppError(422, `Score for “${c?.label ?? k}” must be between ${c?.min} and ${c?.max}.`); }
  const comments = Object.fromEntries(Object.entries(b.data.comments).filter(([k, x]) => ids.has(k) && x.trim()));
  const [cur] = await db.select().from(applyReviews).where(eq(applyReviews.assignmentId, a.id));
  if ((cur?.rev ?? 0) !== b.data.rev) throw new AppError(409, 'This review was saved in another window. Reload to continue.');
  const values = { scores: b.data.scores, comments, overallComment: b.data.overallComment.trim(), recommendation: b.data.recommendation, updatedAt: new Date() };
  if (!cur) { const [r] = await db.insert(applyReviews).values({ assignmentId: a.id, ...values }).onConflictDoNothing().returning(); if (!r) throw new AppError(409, 'This review was saved in another window. Reload to continue.'); return { rev: r.rev }; }
  const [r] = await db.update(applyReviews).set({ ...values, rev: cur.rev + 1 }).where(and(eq(applyReviews.id, cur.id), eq(applyReviews.rev, cur.rev), eq(applyReviews.status, 'draft'))).returning();
  if (!r) throw new AppError(409, 'This review was saved in another window. Reload to continue.');
  return { rev: r.rev };
}

/** Makes the review final: every criterion scored, required comments written. Then it is locked, the score is computed
 *  from this assignment's rubric version, and the application's mean and disagreement flag are recomputed. */
export async function finalizeReview(db: DB, me: Me, assignmentId: string, raw: unknown) {
  const b = z.object({ rev: z.number().int().min(1) }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Save the review first.');
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const a = await ensureOpen(t2, me, assignmentId);
    const [r] = await t2.select().from(applyReviews).where(eq(applyReviews.assignmentId, a.id)).for('update');
    if (!r || r.rev !== b.data.rev) throw new AppError(409, 'Save your latest changes, then submit the review.');
    const [v] = await t2.select().from(applyRubricVersions).where(eq(applyRubricVersions.id, a.rubricVersionId));
    const missing = v.criteria.filter((c) => !Number.isInteger(r.scores[c.id])).map((c) => c.label);
    const noComment = v.criteria.filter((c) => c.commentRequired && !(r.comments[c.id] ?? '').trim()).map((c) => c.label);
    if (missing.length || noComment.length || !r.recommendation) throw new AppError(422, 'The review is not complete.', [
      ...missing.map((m) => ({ path: 'scores', message: `Score “${m}”.` })), ...noComment.map((m) => ({ path: 'comments', message: `Comment on “${m}”.` })), ...(!r.recommendation ? [{ path: 'recommendation', message: 'Give a recommendation.' }] : [])]);
    const total = weightedScore(v.criteria, r.scores);
    if (total === null) throw new AppError(422, 'A score is out of range.');
    await t2.update(applyReviews).set({ status: 'final', totalBp: total, finalAt: new Date(), updatedAt: new Date() }).where(eq(applyReviews.id, r.id));
    await t2.update(applyAssignments).set({ status: 'final', updatedAt: new Date() }).where(eq(applyAssignments.id, a.id));
    await recompute(t2, a.submissionId);
    await audit(tx, me, 'apply.review.final', { type: 'apply_submission', id: a.submissionId }, `Final review (rubric v${v.number})`, { totalBp: total });
    return { totalBp: total };
  });
}

/** The application's score: mean of its final reviews; disagreement uses the rubric version of those reviews. */
export async function recompute(db: DB, submissionId: string) {
  const rows = await db.select({ total: applyReviews.totalBp, threshold: sql<number>`(${applyRubricVersions.settings}->>'disagreementPoints')::int` }).from(applyReviews)
    .innerJoin(applyAssignments, eq(applyAssignments.id, applyReviews.assignmentId)).innerJoin(applyRubricVersions, eq(applyRubricVersions.id, applyAssignments.rubricVersionId))
    .where(and(eq(applyAssignments.submissionId, submissionId), eq(applyReviews.status, 'final')));
  const g = aggregate(rows.map((r) => r.total!).filter((x) => x !== null), Math.min(...rows.map((r) => r.threshold ?? 20), 100));
  await db.update(applySubmissions).set({ scoreBp: g.scoreBp, scoreReviews: rows.length, disagreement: g.disagreement, updatedAt: new Date() }).where(eq(applySubmissions.id, submissionId));
}

/** For managers: every review of one application (scores, comments, who). Reviewers never call this. */
export async function reviewsOf(db: DB, submissionId: string) {
  return db.select({ assignmentId: applyAssignments.id, reviewer: users.name, status: applyAssignments.status, coi: applyAssignments.coi, rubricVersion: applyRubricVersions.number, criteria: applyRubricVersions.criteria,
    scores: applyReviews.scores, comments: applyReviews.comments, overallComment: applyReviews.overallComment, recommendation: applyReviews.recommendation, totalBp: applyReviews.totalBp, reviewStatus: applyReviews.status, finalAt: applyReviews.finalAt })
    .from(applyAssignments).innerJoin(users, eq(users.id, applyAssignments.reviewerId)).innerJoin(applyRubricVersions, eq(applyRubricVersions.id, applyAssignments.rubricVersionId))
    .leftJoin(applyReviews, eq(applyReviews.assignmentId, applyAssignments.id)).where(eq(applyAssignments.submissionId, submissionId)).orderBy(asc(users.name));
}

/** Dashboard: pending reviews and reviewer workload across open evaluations. */
export async function workloadSummary(db: DB) {
  const rows = await db.select({ name: users.name, status: applyAssignments.status, n: count() }).from(applyAssignments).innerJoin(users, eq(users.id, applyAssignments.reviewerId)).groupBy(users.name, applyAssignments.status);
  const by = new Map<string, { name: string; pending: number; final: number }>();
  for (const r of rows) { const w = by.get(r.name) ?? { name: r.name, pending: 0, final: 0 }; if (r.status === 'final') w.final += r.n; else if (r.status !== 'conflict') w.pending += r.n; by.set(r.name, w); }
  const list = [...by.values()].sort((a, b) => b.pending - a.pending);
  return { pending: list.reduce((s, w) => s + w.pending, 0), reviewers: list };
}

/** A file of an application, for its reviewer: only after declaring no conflict, and never in blind mode (CVs and
 *  letters name the applicant). Recorded like staff downloads. */
export async function reviewerFile(db: DB, me: Me, assignmentId: string, fileId: string) {
  const a = await mine(db, me, assignmentId);
  if (!a.coi || a.coi.hasConflict) throw new AppError(404, 'File not found.');
  const [v] = await db.select().from(applyRubricVersions).where(eq(applyRubricVersions.id, a.rubricVersionId));
  if (v.settings.blind) throw new AppError(409, 'Files are hidden in blind review.');
  if (!uuid.safeParse(fileId).success) throw new AppError(404, 'File not found.');
  const [f] = await db.select().from(applyFiles).where(and(eq(applyFiles.id, fileId), eq(applyFiles.submissionId, a.submissionId)));
  if (!f) throw new AppError(404, 'File not found.');
  await db.insert(applySubmissionEvents).values({ submissionId: a.submissionId, actorId: me.id, kind: 'download', meta: { file: f.id, name: f.originalName, asReviewer: true } });
  await audit(db, me, 'apply.file.download', { type: 'apply_submission', id: a.submissionId }, 'Downloaded a file as reviewer', { file: f.id });
  return f;
}
