// Starts AFCD Studio: opens the database (applying migrations) and serves the app.
import { serve } from '@hono/node-server';
import { loadConfig } from './config.ts';
import { openDb } from './db/client.ts';
import { createApp } from './app.ts';

const cfg = loadConfig();
const { db } = await openDb(cfg);
const { app } = createApp(db, cfg);
serve({ fetch: app.fetch, port: cfg.port }, (info) => {
  console.log(`AFCD Studio on ${cfg.origin}/studio/  (site root: ${cfg.siteRoot}, database: ${cfg.databaseUrl ? 'PostgreSQL server' : 'embedded PGlite'})`);
  void info;
});
