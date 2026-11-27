// AFCD Apply, staff side of applications: a paginated, filtered list (never every application in the browser), the
// application with its answers in the form's order, audited file downloads, status changes (single or bulk, with a
// reason and a confirmed count) and eligibility corrections that keep the automatic result next to the staff one.
import { readFileSync, existsSync } from 'node:fs';
import { alias } from 'drizzle-orm/pg-core';
import { and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { APPLICATION_STATUSES, ELIGIBILITY, applyCalls, applyDecisions, applyDrafts, applyFiles, applyFormVersions, applyMessages, applySubmissionEvents, applySubmissions, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { filePath } from './files.ts';

type Me = NonNullable<Actor>;
type Status = (typeof APPLICATION_STATUSES)[number];
const uuid = z.string().uuid();

export const STATUS_LABEL: Record<Status, string> = {
  submitted: 'Submitted', eligibility_review: 'Eligibility review', under_evaluation: 'Under evaluation', shortlisted: 'Shortlisted', interview: 'Interview',
  selected: 'Selected', waitlisted: 'Waitlisted', not_selected: 'Not selected', withdrawn: 'Withdrawn',
};
/** Moves staff can make directly. Final outcomes (selected, waitlisted, not selected) only come from an approved
 *  decision (decisions.ts): someone proposes, someone else approves, and nothing is sent to applicants. */
export const MOVES: Partial<Record<Status, Status[]>> = {
  submitted: ['eligibility_review', 'under_evaluation', 'withdrawn'],
  eligibility_review: ['submitted', 'under_evaluation', 'withdrawn'],
  under_evaluation: ['eligibility_review', 'shortlisted', 'withdrawn'],
  shortlisted: ['under_evaluation', 'interview', 'withdrawn'],
  interview: ['shortlisted', 'withdrawn'],
  withdrawn: ['submitted'],
};

// ---------------------------------------------------------------- List
const listSchema = z.object({
  call: z.string().uuid().optional(),
  // one status, or several separated by commas (a pipeline stage such as shortlisted,interview)
  status: z.string().max(200).transform((v) => [...new Set(v.split(',').map((x) => x.trim()).filter(Boolean))]).pipe(z.array(z.enum(APPLICATION_STATUSES)).max(APPLICATION_STATUSES.length)).optional(), eligibility: z.enum(ELIGIBILITY).optional(),
  bin: z.literal('1').optional(),   // 1 = only applications in the bin; otherwise the bin is left out
  q: z.string().trim().max(120).optional(), cursor: z.string().max(200).optional(), limit: z.coerce.number().int().min(10).max(100).default(50),
});
const enc = (d: Date, id: string) => Buffer.from(`${d.toISOString()}|${id}`).toString('base64url');
function dec(c: string) {
  const [iso, id] = Buffer.from(c, 'base64url').toString().split('|');
  if (!iso || !uuid.safeParse(id).success || Number.isNaN(Date.parse(iso))) throw new AppError(422, 'Bad page link.');
  return { at: new Date(iso), id };
}

/** Newest first, 50 at a time, keyset pagination on (submitted_at, id), which the indexes cover. */
export async function listSubmissions(db: DB, raw: Record<string, string | undefined>) {
  const p = listSchema.safeParse(raw);
  if (!p.success) throw new AppError(422, 'Check the filters.');
  const f = p.data;
  const where: SQL[] = [f.bin ? isNotNull(applySubmissions.deletedAt) : isNull(applySubmissions.deletedAt)];
  if (f.call) where.push(eq(applySubmissions.callId, f.call));
  if (f.status?.length) where.push(f.status.length === 1 ? eq(applySubmissions.status, f.status[0]) : inArray(applySubmissions.status, f.status));
  if (f.eligibility) where.push(eq(applySubmissions.eligibility, f.eligibility));
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push(or(ilike(applySubmissions.reference, like), ilike(applySubmissions.applicantName, like), ilike(applySubmissions.applicantEmail, like))!);
  }
  const base = and(...where);
  const page = f.cursor ? (() => { const c = dec(f.cursor!); return or(lt(applySubmissions.submittedAt, c.at), and(eq(applySubmissions.submittedAt, c.at), lt(applySubmissions.id, c.id))); })() : undefined;
  const rows = await db.select({
    id: applySubmissions.id, reference: applySubmissions.reference, applicantName: applySubmissions.applicantName, applicantEmail: applySubmissions.applicantEmail,
    status: applySubmissions.status, eligibility: applySubmissions.eligibility, overridden: sql<boolean>`${applySubmissions.eligibilityOverride} is not null`,
    submittedAt: applySubmissions.submittedAt, deletedAt: applySubmissions.deletedAt, lang: applySubmissions.lang, callId: applySubmissions.callId, callReference: applyCalls.reference, callTitle: applyCalls.title,
  }).from(applySubmissions).innerJoin(applyCalls, eq(applyCalls.id, applySubmissions.callId))
    .where(page ? (base ? and(base, page) : page) : base).orderBy(desc(applySubmissions.submittedAt), desc(applySubmissions.id)).limit(f.limit + 1);
  const [{ total }] = await db.select({ total: count() }).from(applySubmissions).where(base);
  const more = rows.length > f.limit;
  const items = rows.slice(0, f.limit);
  return { items, total, next: more ? enc(items[items.length - 1].submittedAt, items[items.length - 1].id) : null };
}

/** Counts per call for the filters and the overview (never personal data). */
export async function submissionCounts(db: DB, callId?: string) {
  const w = and(isNull(applySubmissions.deletedAt), callId ? eq(applySubmissions.callId, callId) : undefined);
  const [{ deleted }] = await db.select({ deleted: count() }).from(applySubmissions).where(and(isNotNull(applySubmissions.deletedAt), callId ? eq(applySubmissions.callId, callId) : undefined));
  const byStatus = await db.select({ k: applySubmissions.status, n: count() }).from(applySubmissions).where(w).groupBy(applySubmissions.status);
  const byElig = await db.select({ k: applySubmissions.eligibility, n: count() }).from(applySubmissions).where(w).groupBy(applySubmissions.eligibility);
  const [{ drafts }] = await db.select({ drafts: count() }).from(applyDrafts).where(callId ? and(eq(applyDrafts.status, 'active'), eq(applyDrafts.callId, callId)) : eq(applyDrafts.status, 'active'));
  return { status: Object.fromEntries(byStatus.map((r) => [r.k, r.n])), eligibility: Object.fromEntries(byElig.map((r) => [r.k, r.n])), drafts, deleted, total: byStatus.reduce((s, r) => s + r.n, 0) };
}

/** Applications per call and status, and drafts in progress per call: the Applicants table. Counts only, no personal data. */
export async function countsByCall(db: DB) {
  const rows = await db.select({ call: applySubmissions.callId, k: applySubmissions.status, n: count() }).from(applySubmissions).where(isNull(applySubmissions.deletedAt)).groupBy(applySubmissions.callId, applySubmissions.status);
  const drafts = await db.select({ call: applyDrafts.callId, n: count() }).from(applyDrafts).where(eq(applyDrafts.status, 'active')).groupBy(applyDrafts.callId);
  const out: Record<string, { status: Record<string, number>; total: number; drafts: number }> = {};
  const of = (id: string) => (out[id] ??= { status: {}, total: 0, drafts: 0 });
  for (const r of rows) { const o = of(r.call); o.status[r.k] = r.n; o.total += r.n; }
  for (const r of drafts) of(r.call).drafts = r.n;
  return out;
}

// ---------------------------------------------------------------- One application
async function load(db: DB, id: string) {
  if (!uuid.safeParse(id).success) throw new AppError(404, 'Application not found.');
  const [s] = await db.select().from(applySubmissions).where(eq(applySubmissions.id, id));
  if (!s) throw new AppError(404, 'Application not found.');
  return s;
}
/** Applications in the bin are read-only until restored. */
function live(s: typeof applySubmissions.$inferSelect) {
  if (s.deletedAt) throw new AppError(409, `${s.reference} is in the bin. Restore it first.`);
  return s;
}

export async function getSubmission(db: DB, id: string) {
  const s = await load(db, id);
  const [c] = await db.select({ id: applyCalls.id, reference: applyCalls.reference, title: applyCalls.title, status: applyCalls.status, timeZone: applyCalls.timeZone }).from(applyCalls).where(eq(applyCalls.id, s.callId));
  const [v] = await db.select({ number: applyFormVersions.number, definition: applyFormVersions.definition }).from(applyFormVersions).where(eq(applyFormVersions.id, s.versionId));
  const files = await db.select({ id: applyFiles.id, fieldId: applyFiles.fieldId, name: applyFiles.originalName, kind: applyFiles.kind, mime: applyFiles.mime, bytes: applyFiles.bytes, sha256: applyFiles.sha256, createdAt: applyFiles.createdAt })
    .from(applyFiles).where(eq(applyFiles.submissionId, s.id)).orderBy(asc(applyFiles.createdAt));
  const events = await db.select({ id: applySubmissionEvents.id, kind: applySubmissionEvents.kind, fromValue: applySubmissionEvents.fromValue, toValue: applySubmissionEvents.toValue, body: applySubmissionEvents.body,
    meta: applySubmissionEvents.meta, createdAt: applySubmissionEvents.createdAt, actorName: users.name }).from(applySubmissionEvents).leftJoin(users, eq(users.id, applySubmissionEvents.actorId))
    .where(eq(applySubmissionEvents.submissionId, s.id)).orderBy(desc(applySubmissionEvents.createdAt), desc(applySubmissionEvents.id)).limit(300);
  const proposer = alias(users, 'proposer'), decider = alias(users, 'decider');
  const decisions = await db.select({ id: applyDecisions.id, outcome: applyDecisions.outcome, status: applyDecisions.status, reason: applyDecisions.reason, decisionNote: applyDecisions.decisionNote,
    createdAt: applyDecisions.createdAt, decidedAt: applyDecisions.decidedAt, notifiedAt: applyDecisions.notifiedAt, proposedBy: applyDecisions.proposedBy, proposer: proposer.name, decider: decider.name })
    .from(applyDecisions).leftJoin(proposer, eq(proposer.id, applyDecisions.proposedBy)).leftJoin(decider, eq(decider.id, applyDecisions.decidedBy))
    .where(eq(applyDecisions.submissionId, s.id)).orderBy(desc(applyDecisions.createdAt));
  const [cx] = await db.select({ eligibility: applyCalls.eligibility, places: applyCalls.places }).from(applyCalls).where(eq(applyCalls.id, s.callId));
  const [{ n: selected }] = await db.select({ n: count() }).from(applySubmissions).where(and(eq(applySubmissions.callId, s.callId), eq(applySubmissions.status, 'selected'), isNull(applySubmissions.deletedAt)));
  const { ipHash: _ip, idempotencyKey: _k, ...rest } = s;
  return { ...rest, call: { ...c, eligibility: cx?.eligibility ?? [], places: cx?.places ?? null, selected }, version: v, files, events, decisions, moves: MOVES[s.status] ?? [] };
}

/** Downloads one file of an application: signed in, permission checked by the route, recorded, always an attachment. */
export async function fileForDownload(db: DB, cfg: Config, me: Me, submissionId: string, fileId: string) {
  const s = await load(db, submissionId);
  if (!uuid.safeParse(fileId).success) throw new AppError(404, 'File not found.');
  const [f] = await db.select().from(applyFiles).where(and(eq(applyFiles.id, fileId), eq(applyFiles.submissionId, s.id)));
  if (!f || !existsSync(filePath(cfg, f.storageKey))) throw new AppError(404, 'File not found.');
  await db.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'download', meta: { file: f.id, name: f.originalName } });
  await audit(db, me, 'apply.file.download', { type: 'apply_submission', id: s.id }, `Downloaded a file of ${s.reference}`, { file: f.id });
  return { bytes: new Uint8Array(readFileSync(filePath(cfg, f.storageKey))), name: f.originalName, mime: f.mime };
}

// ---------------------------------------------------------------- Status
const statusSchema = z.object({ to: z.enum(APPLICATION_STATUSES), reason: z.string().trim().max(1000).default('') }).strict();

const FORWARD: Status[] = ['under_evaluation', 'shortlisted', 'interview'];
async function move(tx: DB, me: Me, s: typeof applySubmissions.$inferSelect, to: Status, reason: string) {
  live(s);
  if (!(MOVES[s.status] ?? []).includes(to)) throw new AppError(409, `${s.reference}: cannot move from ${STATUS_LABEL[s.status]} to ${STATUS_LABEL[to]}.`);
  // an application marked ineligible moves forward only with a recorded reason (an override); it never becomes eligible by moving
  if (s.eligibility === 'ineligible' && FORWARD.includes(to) && reason.trim().length < 3) throw new AppError(422, `${s.reference} is marked ineligible: give the reason for moving it forward anyway.`);
  await tx.update(applySubmissions).set({ status: to, updatedAt: new Date() }).where(eq(applySubmissions.id, s.id));
  await tx.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'status', fromValue: s.status, toValue: to, body: reason });
}

export async function setStatus(db: DB, me: Me, id: string, raw: unknown) {
  const b = statusSchema.safeParse(raw);
  if (!b.success) throw new AppError(422, 'Choose the new status.');
  if (b.data.to === 'withdrawn' && b.data.reason.length < 3) throw new AppError(422, 'Say why the application is withdrawn.');
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const [s] = await t2.select().from(applySubmissions).where(eq(applySubmissions.id, (await load(t2, id)).id)).for('update');
    await move(t2, me, s, b.data.to, b.data.reason);
    await audit(tx, me, 'apply.submission.status', { type: 'apply_submission', id: s.id }, `${s.reference}: ${STATUS_LABEL[s.status]} → ${STATUS_LABEL[b.data.to]}`, b.data.reason ? { reason: b.data.reason } : undefined);
    return { status: b.data.to };
  });
}

/** Bulk status change. `confirm` must equal the number of applications, so a stale or mistaken selection cannot slip
 *  through; all or none move, and each move is recorded on its application with the reason. */
export async function bulkStatus(db: DB, me: Me, raw: unknown) {
  const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), to: z.enum(APPLICATION_STATUSES), reason: z.string().trim().min(3, 'Give a reason for the record.').max(1000), confirm: z.number().int() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, b.error.issues[0]?.message ?? 'Check the selection.');
  const ids = [...new Set(b.data.ids)];
  if (b.data.confirm !== ids.length) throw new AppError(422, `Confirm the number of applications (${ids.length}).`);
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const rows = await t2.select().from(applySubmissions).where(inArray(applySubmissions.id, ids)).for('update');
    if (rows.length !== ids.length) throw new AppError(404, 'Some applications no longer exist. Reload and try again.');
    for (const s of rows) await move(t2, me, s, b.data.to, b.data.reason);
    await audit(tx, me, 'apply.submission.bulk_status', { type: 'apply_submission' }, `${rows.length} application(s) → ${STATUS_LABEL[b.data.to]}`, { ids, reason: b.data.reason });
    return { moved: rows.length };
  });
}

// ---------------------------------------------------------------- Eligibility
/** Staff correct the automatic result (never replace it): the override is stored with who, when and why, and can be
 *  removed to go back to the automatic result. Nothing here rejects an applicant. */
export async function setEligibility(db: DB, me: Me, id: string, raw: unknown) {
  const b = z.union([z.object({ result: z.enum(ELIGIBILITY), reason: z.string().trim().min(3, 'Explain the correction.').max(1000) }).strict(), z.object({ clear: z.literal(true) }).strict()]).safeParse(raw);
  if (!b.success) throw new AppError(422, b.error.issues[0]?.message ?? 'Choose a result and explain it.');
  const s = live(await load(db, id));
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, me.id));
  const before = s.eligibility;
  if ('clear' in b.data) {
    await db.update(applySubmissions).set({ eligibility: s.eligibilityAuto.result, eligibilityOverride: null, updatedAt: new Date() }).where(eq(applySubmissions.id, s.id));
    await db.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'eligibility', fromValue: before, toValue: s.eligibilityAuto.result, body: 'Back to the automatic result' });
  } else {
    const o = { result: b.data.result, reason: b.data.reason, by: me.id, byName: u?.name ?? me.email, at: new Date().toISOString() };
    await db.update(applySubmissions).set({ eligibility: b.data.result, eligibilityOverride: o, updatedAt: new Date() }).where(eq(applySubmissions.id, s.id));
    await db.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'eligibility', fromValue: before, toValue: b.data.result, body: b.data.reason });
  }
  await audit(db, me, 'apply.submission.eligibility', { type: 'apply_submission', id: s.id }, `${s.reference}: eligibility ${before} → ${'clear' in b.data ? `${s.eligibilityAuto.result} (automatic)` : b.data.result}`);
  return { ok: true };
}

/** Bulk eligibility: the same staff assessment, with its reason, on every chosen application; all or none, each recorded. */
export async function bulkEligibility(db: DB, me: Me, raw: unknown) {
  const b = z.object({ ids: z.array(z.string().uuid()).min(1).max(500), result: z.enum(ELIGIBILITY), reason: z.string().trim().min(3, 'Explain the assessment.').max(1000), confirm: z.number().int() }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, b.error.issues[0]?.message ?? 'Choose a result and explain it.');
  const ids = [...new Set(b.data.ids)];
  if (b.data.confirm !== ids.length) throw new AppError(422, `Confirm the number of applications (${ids.length}).`);
  const [u] = await db.select({ name: users.name }).from(users).where(eq(users.id, me.id));
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const rows = await t2.select().from(applySubmissions).where(inArray(applySubmissions.id, ids)).for('update');
    if (rows.length !== ids.length) throw new AppError(404, 'Some applications no longer exist. Reload and try again.');
    rows.forEach(live);
    const at = new Date();
    const o = { result: b.data.result, reason: b.data.reason, by: me.id, byName: u?.name ?? me.email, at: at.toISOString() };
    for (const s of rows) {
      await t2.update(applySubmissions).set({ eligibility: b.data.result, eligibilityOverride: o, updatedAt: at }).where(eq(applySubmissions.id, s.id));
      await t2.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'eligibility', fromValue: s.eligibility, toValue: b.data.result, body: b.data.reason });
    }
    await audit(tx, me, 'apply.submission.bulk_eligibility', { type: 'apply_submission' }, `${rows.length} application(s): eligibility → ${b.data.result}`, { ids, reason: b.data.reason });
    return { updated: rows.length };
  });
}

export async function addNote(db: DB, me: Me, id: string, raw: unknown) {
  const b = z.object({ body: z.string().trim().min(1).max(5000) }).strict().safeParse(raw);
  if (!b.success) throw new AppError(422, 'Write the note.');
  const s = live(await load(db, id));
  await db.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'note', body: b.data.body });
  await audit(db, me, 'apply.submission.note', { type: 'apply_submission', id: s.id }, `Note on ${s.reference}`);   // never the note text
  return { ok: true };
}

// ---------------------------------------------------------------- Bin
/** Delete = move to the bin. Nothing is erased: answers, files, reviews, decisions and history stay, and Restore puts the
 *  application back where it was. While in the bin it is left out of lists, counts, reviews and emails, and emails still
 *  waiting to go to this applicant are cancelled (they are not re-queued on restore). */
export async function deleteSubmission(db: DB, me: Me, id: string, raw: unknown) {
  const b = z.object({ reason: z.string().trim().max(1000).default('') }).strict().safeParse(raw ?? {});
  if (!b.success) throw new AppError(422, 'Check the reason.');
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const [s] = await t2.select().from(applySubmissions).where(eq(applySubmissions.id, (await load(t2, id)).id)).for('update');
    if (s.deletedAt) throw new AppError(409, `${s.reference} is already in the bin.`);
    const at = new Date();
    await t2.update(applySubmissions).set({ deletedAt: at, deletedBy: me.id, updatedAt: at }).where(eq(applySubmissions.id, s.id));
    const cancelled = await t2.update(applyMessages).set({ status: 'cancelled', updatedAt: at })
      .where(and(eq(applyMessages.submissionId, s.id), or(eq(applyMessages.status, 'queued'), eq(applyMessages.status, 'failed')))).returning({ id: applyMessages.id });
    await t2.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'deleted', body: b.data.reason, meta: cancelled.length ? { cancelledEmails: cancelled.length } : null });
    await audit(tx, me, 'apply.submission.delete', { type: 'apply_submission', id: s.id }, `${s.reference} moved to the bin`, { reason: b.data.reason || undefined, cancelledEmails: cancelled.length });
    return { ok: true, cancelledEmails: cancelled.length };
  });
}

export async function restoreSubmission(db: DB, me: Me, id: string) {
  return db.transaction(async (tx) => {
    const t2 = tx as unknown as DB;
    const [s] = await t2.select().from(applySubmissions).where(eq(applySubmissions.id, (await load(t2, id)).id)).for('update');
    if (!s.deletedAt) throw new AppError(409, `${s.reference} is not in the bin.`);
    await t2.update(applySubmissions).set({ deletedAt: null, deletedBy: null, updatedAt: new Date() }).where(eq(applySubmissions.id, s.id));
    await t2.insert(applySubmissionEvents).values({ submissionId: s.id, actorId: me.id, kind: 'restored' });
    await audit(tx, me, 'apply.submission.restore', { type: 'apply_submission', id: s.id }, `${s.reference} restored from the bin`);
    return { ok: true };
  });
}
