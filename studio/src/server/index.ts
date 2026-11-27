// Starts AFCD Studio: opens the database (applying migrations) and serves the app.
import { serve } from '@hono/node-server';
import { loadConfig } from './config.ts';
import { openDb } from './db/client.ts';
import { createApp } from './app.ts';
import { purgeExpired } from './modules/forms/service.ts';
import * as GSC from './modules/google/gsc.ts';
import { enqueue } from './modules/jobs/service.ts';
import { runCallSchedule } from './modules/apply/calls.ts';
import { purgeExpiredDrafts } from './modules/apply/applicant.ts';
import { processQueue } from './modules/apply/messages.ts';
import * as HEALTH from './modules/health/service.ts';

const cfg = loadConfig();
const { db } = await openDb(cfg);
const { app, publisher, runJobs } = createApp(db, cfg);

// Scheduled publishing: checks every minute. Each publish is verified like a manual one; failures return the story
// to "approved" and are shown on the Publishing page. Both loops run through HEALTH.loop: a run still going when the
// next tick comes is never started twice (that tick is skipped), and each part that fails is reported on the
// Dashboard's site checks and at /studio/api/health/details as well as in the server log.
const report = (fail: (m: string) => void, part: string) => (e: unknown) => { console.error(`[scheduler] ${part}`, e); fail(`${part}: ${(e as Error)?.message ?? String(e)}`); };
const tick = HEALTH.loop('scheduler', 'The scheduler (scheduled publishing, calls, events)', 60_000, async (fail) => {
  try { for (const r of await publisher.runScheduled()) { console.log(`[scheduler] ${r.ok ? 'published' : 'FAILED'} ${r.id}${r.error ? `: ${r.error}` : ''}`); if (!r.ok) fail(`scheduled publish failed: ${r.error ?? r.id}`); } }
  catch (e) { report(fail, 'scheduled publishing')(e); }
  // AFCD Apply: calls open and close on server time
  try { for (const r of await runCallSchedule(db)) console.log(`[scheduler] call ${r.reference} ${r.to}`); }
  catch (e) { report(fail, 'apply calls')(e); }
  try { if (await publisher.refreshApplyPages()) console.log('[scheduler] application pages rebuilt'); }
  catch (e) { report(fail, 'application pages')(e); }
  try { const n = await purgeExpiredDrafts(db, cfg); if (n) console.log(`[scheduler] deleted ${n} expired application draft(s)`); }
  catch (e) { report(fail, 'application drafts')(e); }
  // Events move from "upcoming" to "past" when their last day ends (Morocco time): rebuild then. At most every 15 minutes.
  if (Date.now() - lastEventCheck > 15 * 60_000) {
    lastEventCheck = Date.now();
    try { if (await publisher.refreshEventStates()) console.log('[scheduler] events calendar rebuilt'); }
    catch (e) { report(fail, 'events refresh')(e); }
    try { if (await publisher.refreshOpportunityStates()) console.log('[scheduler] opportunities rebuilt'); }
    catch (e) { report(fail, 'opportunities refresh')(e); }
    try { const n = await purgeExpired(db); if (n) console.log(`[scheduler] deleted ${n} form message(s) past retention`); }
    catch (e) { report(fail, 'forms retention')(e); }
  }
});
let lastEventCheck = 0;
setInterval(() => { void tick().then((r) => { if (r === 'skipped') console.log('[scheduler] previous run still going; this tick skipped'); }); }, 60_000).unref();

// SEO Pro background jobs (Search Console sync, ...): one job at a time, every 10 seconds when there is work.
// Search Console is re-synced daily when it is connected and auto sync is on.
const jobsTick = HEALTH.loop('jobs', 'Background jobs and the email outbox', 10_000, async (fail) => {
  try {
    const c = await GSC.connection(db);
    if (c?.status === 'connected' && c.property && (await GSC.settings(db)).autoSync && (!c.lastSyncAt || Date.now() - c.lastSyncAt.getTime() > 20 * 3600_000)) await enqueue(db, 'gsc_sync');
    for (let i = 0; i < 5; i++) { const j = await runJobs(); if (!j) break; console.log(`[jobs] ${j.kind} ${j.status}${j.error ? `: ${j.error}` : ''}`); }
    // AFCD Apply outbox: a few emails every 10 seconds, with retries (modules/apply/messages.ts)
    const m = await processQueue(db, cfg); if (m.sent || m.failed) console.log(`[apply] emails sent ${m.sent}, failed ${m.failed}`);
  } catch (e) { console.error('[jobs]', e); fail((e as Error)?.message ?? String(e)); }
});
setInterval(() => { void jobsTick(); }, 10_000).unref();
void tick();
serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`AFCD Studio on ${cfg.origin}/studio/  (site root: ${cfg.siteRoot}, database: ${cfg.databaseUrl ? 'PostgreSQL server' : 'embedded PGlite'})`);
  void info;
});
