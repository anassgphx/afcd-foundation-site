// Background jobs for SEO Pro: queued in the database, claimed one at a time, with progress, retries with backoff,
// cancellation, failure details and history. Nothing long runs inside an HTTP request.
import { and, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { seoJobs } from '../../db/schema.ts';
import { AppError } from '../../http.ts';

export type Job = typeof seoJobs.$inferSelect;
export type JobCtx = { job: Job; progress: (pct: number, message?: string) => Promise<void>; cancelled: () => Promise<boolean> };
export type Handler = (ctx: JobCtx) => Promise<Record<string, unknown>>;
/** Thrown by a handler for failures that retrying cannot fix (missing setup, revoked access). */
export class PermanentError extends Error {}

const BACKOFF_S = [60, 300, 1500, 3600];

/** Adds a job unless the same kind with the same key is already waiting or running (idempotent enqueue). */
export async function enqueue(db: DB, kind: string, params: Record<string, unknown> = {}, opts: { key?: string; by?: string | null; maxAttempts?: number } = {}) {
  const open = await db.select().from(seoJobs).where(and(eq(seoJobs.kind, kind), inArray(seoJobs.status, ['queued', 'running'])));
  const dup = open.find((j) => (j.params as { key?: string }).key === (opts.key ?? kind));
  if (dup) return { job: dup, existing: true };
  const [job] = await db.insert(seoJobs).values({ kind, params: { ...params, key: opts.key ?? kind }, createdBy: opts.by ?? null, maxAttempts: opts.maxAttempts ?? 4 }).returning();
  return { job, existing: false };
}

export async function cancelJob(db: DB, id: string) {
  const [j] = await db.update(seoJobs).set({ status: 'cancelled', finishedAt: new Date(), message: 'Cancelled' }).where(and(eq(seoJobs.id, id), inArray(seoJobs.status, ['queued', 'running']))).returning();
  if (!j) throw new AppError(409, 'This job is not waiting or running.');
  return j;
}

export const listJobs = (db: DB, kinds?: string[], limit = 20) =>
  db.select().from(seoJobs).where(kinds ? inArray(seoJobs.kind, kinds) : undefined).orderBy(desc(seoJobs.createdAt)).limit(limit);

/** Runs the next due job, if any. Safe to call often; a claimed job is marked running atomically. */
export async function runNext(db: DB, handlers: Record<string, Handler>, now = new Date()) {
  // a job left "running" by a stopped server is put back in the queue after 30 minutes
  await db.update(seoJobs).set({ status: 'queued', message: 'Restarted after an interruption' })
    .where(and(eq(seoJobs.status, 'running'), lte(seoJobs.startedAt, new Date(now.getTime() - 30 * 60_000))));
  const [next] = await db.select().from(seoJobs).where(and(eq(seoJobs.status, 'queued'), lte(seoJobs.runAfter, now), inArray(seoJobs.kind, Object.keys(handlers))))
    .orderBy(seoJobs.runAfter).limit(1);
  if (!next) return null;
  const [job] = await db.update(seoJobs).set({ status: 'running', startedAt: now, attempts: sql`${seoJobs.attempts} + 1`, error: null })
    .where(and(eq(seoJobs.id, next.id), eq(seoJobs.status, 'queued'))).returning();
  if (!job) return null;
  const ctx: JobCtx = {
    job,
    progress: async (pct, message) => { await db.update(seoJobs).set({ progress: Math.max(0, Math.min(100, Math.round(pct))), ...(message ? { message } : {}) }).where(eq(seoJobs.id, job.id)); },
    cancelled: async () => (await db.select({ s: seoJobs.status }).from(seoJobs).where(eq(seoJobs.id, job.id)))[0]?.s === 'cancelled',
  };
  try {
    const result = await handlers[job.kind](ctx);
    if (await ctx.cancelled()) return { ...job, status: 'cancelled' };
    const [done] = await db.update(seoJobs).set({ status: 'succeeded', progress: 100, result, finishedAt: new Date() }).where(eq(seoJobs.id, job.id)).returning();
    return done;
  } catch (e) {
    const err = e as Error & { retry?: boolean };
    const permanent = e instanceof PermanentError || err.retry === false || job.attempts >= job.maxAttempts;
    const wait = BACKOFF_S[Math.min(job.attempts - 1, BACKOFF_S.length - 1)];
    const [after] = await db.update(seoJobs).set(permanent
      ? { status: 'failed', error: err.message.slice(0, 2000), finishedAt: new Date() }
      : { status: 'queued', error: err.message.slice(0, 2000), runAfter: new Date(Date.now() + wait * 1000), message: `Attempt ${job.attempts} failed; retrying in ${Math.round(wait / 60)} min` })
      .where(eq(seoJobs.id, job.id)).returning();
    return after;
  }
}
