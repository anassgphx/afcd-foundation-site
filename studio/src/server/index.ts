// Starts AFCD Studio: opens the database (applying migrations) and serves the app.
import { serve } from '@hono/node-server';
import { loadConfig } from './config.ts';
import { openDb } from './db/client.ts';
import { createApp } from './app.ts';

const cfg = loadConfig();
const { db } = await openDb(cfg);
const { app, publisher } = createApp(db, cfg);

// Scheduled publishing: checks every minute. Each publish is verified like a manual one; failures return the story
// to "approved" and are shown on the Publishing page.
const tick = async () => {
  try { for (const r of await publisher.runScheduled()) console.log(`[scheduler] ${r.ok ? 'published' : 'FAILED'} ${r.id}${r.error ? `: ${r.error}` : ''}`); }
  catch (e) { console.error('[scheduler]', e); }
  // Events move from "upcoming" to "past" when their last day ends (Morocco time): rebuild then. At most every 15 minutes.
  if (Date.now() - lastEventCheck > 15 * 60_000) {
    lastEventCheck = Date.now();
    try { if (await publisher.refreshEventStates()) console.log('[scheduler] events calendar rebuilt'); }
    catch (e) { console.error('[scheduler] events refresh failed', e); }
    try { if (await publisher.refreshOpportunityStates()) console.log('[scheduler] opportunities rebuilt'); }
    catch (e) { console.error('[scheduler] opportunities refresh failed', e); }
  }
};
let lastEventCheck = 0;
setInterval(tick, 60_000).unref();
void tick();
serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`AFCD Studio on ${cfg.origin}/studio/  (site root: ${cfg.siteRoot}, database: ${cfg.databaseUrl ? 'PostgreSQL server' : 'embedded PGlite'})`);
  void info;
});
