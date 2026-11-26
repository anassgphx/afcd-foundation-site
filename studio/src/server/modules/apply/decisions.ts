// AFCD Apply decisions: final outcomes (selected, waitlisted, not selected) are proposed with a reason, then approved or
// rejected by someone else (four eyes; a Super Administrator may approve their own). Approval changes the application's
// status and records who and why. Nothing here sends anything to applicants: notifying them is a separate, authorized
// communications step (apply_decisions.notified_at stays empty until then).
import { and, desc, eq, inArray } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { DECISION_OUTCOMES, applyCalls, applyDecisions, applySubmissionEvents, applySubmissions, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';

type Me = NonNullable<Actor>;
const OUTCOME_LABEL = { selected: 'Selected', waitlisted: 'Waitlisted', not_selected: 'Not selected' } as const;
const DECIDABLE = ['under_evaluation', 'shortlisted', 'interview'];

export async function propose(db: DB, me: Me, raw: unknown) {
  const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), outcome: z.enum(DECISION_OUTCOMES), reason: z.string().trim().min(3, 'Give the reason for the record.').max(2000), confirm: z.number().int() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, b.error.issues[0]?.message ?? 'Check the decision.');
  const ids = [...new Set(b.data.ids)];
  if (b.data.confirm !== ids.length) throw new AppError(422, `Confirm the number of applications (${ids.length}).`);
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const subs = await t2.select().from(applySubmissions).where(inArray(applySubmissions.id, ids)).for('update');
    if (subs.length !== ids.length) throw new AppError(404, 'Some applications no longer exist.');
    const bad = subs.filter((s) => !DECIDABLE.includes(s.status));
    if (bad.length) throw new AppError(409, `Only applications under evaluation, shortlisted or at interview can get a decision (${bad.map((s) => s.reference).join(', ')}).`);
    const open = await t2.select({ s: applyDecisions.submissionId }).from(applyDecisions).where(and(inArray(applyDecisions.submissionId, ids), eq(applyDecisions.status, 'proposed')));
    if (open.length) throw new AppError(409, 'Some applications already have a proposed decision waiting for approval.');
    await t2.insert(applyDecisions).values(subs.map((s) => ({ submissionId: s.id, callId: s.callId, outcome: b.data.outcome, reason: b.data.reason, proposedBy: me.id })));
    for (const s of subs) await t2.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'decision', toValue: `proposed:${b.data.outcome}`, body: b.data.reason });
    await audit(tx, me, 'apply.decision.propose', { type: 'apply_submission' }, `Proposed “${OUTCOME_LABEL[b.data.outcome]}” for ${subs.length} application(s)`, { ids, reason: b.data.reason });
    return { proposed: subs.length };
  });
}

/** Approve or reject proposed decisions, all or none; the person who proposed cannot approve (except a Super Administrator). */
export async function decide(db: DB, me: Me, role: Role, raw: unknown) {
  const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), approve: z.boolean(), note: z.string().trim().max(2000).default(''), confirm: z.number().int() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Check the selection.');
  const ids = [...new Set(b.data.ids)];
  if (b.data.confirm !== ids.length) throw new AppError(422, `Confirm the number of decisions (${ids.length}).`);
  if (!b.data.approve && b.data.note.length < 3) throw new AppError(422, 'Say why the decision is rejected.');
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const ds = await t2.select().from(applyDecisions).where(inArray(applyDecisions.id, ids)).for('update');
    if (ds.length !== ids.length || ds.some((d) => d.status !== 'proposed')) throw new AppError(409, 'Some decisions are no longer waiting for approval. Reload.');
    if (role !== 'super_admin' && ds.some((d) => d.proposedBy === me.id)) throw new AppError(409, 'You proposed some of these decisions: someone else must approve or reject them.');
    const now = new Date();
    for (const d of ds) {
      await t2.update(applyDecisions).set({ status: b.data.approve ? 'approved' : 'rejected', decidedBy: me.id, decidedAt: now, decisionNote: b.data.note }).where(eq(applyDecisions.id, d.id));
      if (b.data.approve) {
        const [s] = await t2.select().from(applySubmissions).where(eq(applySubmissions.id, d.submissionId)).for('update');
        await t2.update(applySubmissions).set({ status: d.outcome, updatedAt: now }).where(eq(applySubmissions.id, s.id));
        await t2.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'status', fromValue: s.status, toValue: d.outcome, body: `Decision approved: ${d.reason}`, meta: { decision: d.id } });
      } else await t2.insert(applySubmissionEvents).values({ submissionId: d.submissionId, actorId: me.id, kind: 'decision', toValue: `rejected:${d.outcome}`, body: b.data.note });
    }
    await audit(tx, me, b.data.approve ? 'apply.decision.approve' : 'apply.decision.reject', { type: 'apply_submission' }, `${b.data.approve ? 'Approved' : 'Rejected'} ${ds.length} decision(s)`, { ids, note: b.data.note || undefined });
    return { done: ds.length };
  });
}

export async function withdrawDecision(db: DB, me: Me, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'Decision not found.');
  const [d] = await db.update(applyDecisions).set({ status: 'withdrawn', decidedBy: me.id, decidedAt: new Date() }).where(and(eq(applyDecisions.id, id), eq(applyDecisions.status, 'proposed'))).returning();
  if (!d) throw new AppError(409, 'Only a proposed decision can be withdrawn.');
  await audit(db, me, 'apply.decision.withdraw', { type: 'apply_submission', id: d.submissionId }, 'Withdrew a proposed decision');
  return { ok: true };
}

export async function listDecisions(db: DB, q: { call?: string; status?: string }) {
  const proposer = alias(users, 'proposer'), decider = alias(users, 'decider');
  const where = [q.call && z.string().uuid().safeParse(q.call).success ? eq(applyDecisions.callId, q.call) : undefined, q.status ? eq(applyDecisions.status, q.status) : undefined].filter(Boolean);
  return db.select({ id: applyDecisions.id, outcome: applyDecisions.outcome, reason: applyDecisions.reason, status: applyDecisions.status, decisionNote: applyDecisions.decisionNote, createdAt: applyDecisions.createdAt, decidedAt: applyDecisions.decidedAt,
    notifiedAt: applyDecisions.notifiedAt, proposedBy: applyDecisions.proposedBy, proposer: proposer.name, decider: decider.name, submissionId: applySubmissions.id, reference: applySubmissions.reference,
    applicantName: applySubmissions.applicantName, scoreBp: applySubmissions.scoreBp, callTitle: applyCalls.title })
    .from(applyDecisions).innerJoin(applySubmissions, eq(applySubmissions.id, applyDecisions.submissionId)).innerJoin(applyCalls, eq(applyCalls.id, applyDecisions.callId))
    .leftJoin(proposer, eq(proposer.id, applyDecisions.proposedBy)).leftJoin(decider, eq(decider.id, applyDecisions.decidedBy))
    .where(where.length ? and(...(where as never[])) : undefined).orderBy(desc(applyDecisions.createdAt)).limit(1000);
}
