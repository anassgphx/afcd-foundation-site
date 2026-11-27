// Health: is Studio working right now?
//
// - liveness(): a public yes/no (the database answers) for the container healthcheck and an uptime monitor. It says
//   nothing else, so it reveals nothing about the content or the setup.
// - details(): the facts behind it for signed-in staff: when each background loop last ran and how it ended, the last
//   delivery to the website, whether the public site serves that build, the email outbox and background jobs.
//   Everything is read at request time; a loop that has not run since the server started says so.
// - loop(): wraps a background loop so a slow run is never started twice at once (the next tick is skipped and counted)
//   and so its state is visible here. Before this, the 60-second scheduler had no overlap guard.
import { and, count, desc, eq, gte, inArray, min, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { applyMessages, publishJobs, seoJobs } from '../../db/schema.ts';
import { recentPublicState, type PublicState } from '../publish/public-check.ts';
import { mailSettings } from '../inbox/mail.ts';

export type LoopState = {
  name: string; label: string; everyMs: number; runs: number; skipped: number; running: boolean;
  lastStartedAt: string | null; lastFinishedAt: string | null; lastDurationMs: number | null; lastErrors: string[];
};
const loops = new Map<string, LoopState>();
const startedAt = new Date();

/** Wraps a background loop. `fn` gets `fail(msg)` to report a part that failed without stopping the rest of the run.
 *  The returned function resolves to 'ran' or, when the previous run is still going, 'skipped' (nothing is started). */
export function loop(name: string, label: string, everyMs: number, fn: (fail: (msg: string) => void) => Promise<void>) {
  const s: LoopState = { name, label, everyMs, runs: 0, skipped: 0, running: false, lastStartedAt: null, lastFinishedAt: null, lastDurationMs: null, lastErrors: [] };
  loops.set(name, s);
  return async (): Promise<'ran' | 'skipped'> => {
    if (s.running) { s.skipped++; return 'skipped'; }
    s.running = true;
    const t0 = Date.now(); s.lastStartedAt = new Date(t0).toISOString();
    const errors: string[] = [];
    try { await fn((m) => { errors.push(m.slice(0, 300)); }); }
    catch (e) { errors.push(((e as Error)?.message ?? String(e)).slice(0, 300)); console.error(`[${name}]`, e); }
    finally {
      s.running = false; s.runs++; s.lastErrors = errors.slice(0, 5);
      s.lastFinishedAt = new Date().toISOString(); s.lastDurationMs = Date.now() - t0;
    }
    return 'ran';
  };
}

/** For tests: forget registered loops. */
export function resetLoops() { loops.clear(); }

/** A loop is late when it has not started for three of its intervals (after the server has been up that long). */
function loopView(s: LoopState, now: number) {
  const since = s.lastStartedAt ? now - Date.parse(s.lastStartedAt) : now - startedAt.getTime();
  const late = since > 3 * s.everyMs && !(s.running && s.lastStartedAt && now - Date.parse(s.lastStartedAt) < 10 * 60_000);
  return { ...s, late, ok: !late && s.lastErrors.length === 0 };
}

export async function liveness(db: DB) {
  const t0 = Date.now();
  try { await db.execute(sql`select 1`); return { ok: true as const, ms: Date.now() - t0 }; }
  catch { return { ok: false as const, ms: Date.now() - t0 }; }
}

export type Details = Awaited<ReturnType<typeof details>>;

/** Staff view. `publicCheck` is injectable for tests; by default the 30-second cached check of the public site. */
export async function details(db: DB, cfg: Config, opts: { now?: Date; publicCheck?: () => Promise<PublicState> } = {}) {
  const now = opts.now ?? new Date();
  const day = new Date(now.getTime() - 864e5);
  const database = await liveness(db);
  const bg = [...loops.values()].map((s) => loopView(s, now.getTime()));

  const [lastJob] = database.ok ? await db.select({ kind: publishJobs.kind, status: publishJobs.status, at: publishJobs.createdAt, finishedAt: publishJobs.finishedAt, error: publishJobs.error })
    .from(publishJobs).orderBy(desc(publishJobs.createdAt)).limit(1) : [];
  const [failedDeliveries] = database.ok ? await db.select({ n: count() }).from(publishJobs).where(and(eq(publishJobs.status, 'failed'), gte(publishJobs.createdAt, day))) : [{ n: 0 }];
  const outboxRows = database.ok ? await db.select({ status: applyMessages.status, n: count(), oldest: min(applyMessages.nextAttemptAt) })
    .from(applyMessages).where(inArray(applyMessages.status, ['queued', 'sending', 'failed'])).groupBy(applyMessages.status) : [];
  const outbox = { queued: 0, sending: 0, failed: 0, oldestQueuedAt: null as string | null };
  for (const r of outboxRows) {
    outbox[r.status as 'queued' | 'sending' | 'failed'] = Number(r.n);
    if (r.status === 'queued' && r.oldest) outbox.oldestQueuedAt = new Date(r.oldest).toISOString();
  }
  const jobRows = database.ok ? await db.select({ status: seoJobs.status, n: count() }).from(seoJobs)
    .where(and(inArray(seoJobs.status, ['queued', 'running', 'failed']), gte(seoJobs.createdAt, new Date(now.getTime() - 7 * 864e5)))).groupBy(seoJobs.status) : [];
  const jobs = { queued: 0, running: 0, failed: 0 };
  for (const r of jobRows) jobs[r.status as 'queued' | 'running' | 'failed'] = Number(r.n);
  const mail = mailSettings(cfg);
  const publicSite = await (opts.publicCheck ?? (() => recentPublicState(cfg)))();

  // what needs attention, in plain words (empty = all good)
  const problems: string[] = [];
  if (!database.ok) problems.push('The database does not answer.');
  for (const l of bg) {
    if (l.late) problems.push(`${l.label} has not run for ${Math.round((now.getTime() - Date.parse(l.lastStartedAt ?? startedAt.toISOString())) / 60_000)} min.`);
    else if (l.lastErrors.length) problems.push(`${l.label}: ${l.lastErrors[0]}`);
  }
  if (Number(failedDeliveries?.n ?? 0)) problems.push(`${failedDeliveries.n} website deliver${Number(failedDeliveries.n) === 1 ? 'y' : 'ies'} failed in the last 24 hours.`);
  if (publicSite.checked && publicSite.match === false) problems.push(`The public site does not serve the latest build${publicSite.error ? ` (${publicSite.error})` : ''}.`);
  if (outbox.failed) problems.push(`${outbox.failed} email${outbox.failed === 1 ? '' : 's'} to applicants could not be sent.`);
  if (outbox.queued && !mail.ready) problems.push(`${outbox.queued} email${outbox.queued === 1 ? ' is' : 's are'} waiting: the email server is not set up.`);
  if (jobs.failed) problems.push(`${jobs.failed} background job${jobs.failed === 1 ? '' : 's'} failed this week.`);

  return {
    status: problems.length ? 'attention' as const : 'ok' as const, problems, at: now.toISOString(),
    server: { startedAt: startedAt.toISOString(), uptimeS: Math.round((now.getTime() - startedAt.getTime()) / 1000) },
    database, loops: bg,
    delivery: { last: lastJob ? { ...lastJob, at: lastJob.at.toISOString(), finishedAt: lastJob.finishedAt?.toISOString() ?? null } : null, failedLast24h: Number(failedDeliveries?.n ?? 0) },
    publicSite,
    email: { serverReady: mail.ready, outbox },
    jobs,
  };
}
