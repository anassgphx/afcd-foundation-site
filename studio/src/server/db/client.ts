// Database connection: PGlite (embedded PostgreSQL) locally and in tests, node-postgres when DATABASE_URL is set.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import * as schema from './schema.ts';
import type { Config } from '../config.ts';

export type DB = ReturnType<typeof drizzlePglite<typeof schema>>;
export const MIGRATIONS = resolve(import.meta.dirname, '../../../drizzle');

/** Opens the database and applies pending migrations. `memory` gives a throwaway database (tests). */
export async function openDb(cfg: Config, opts: { memory?: boolean } = {}): Promise<{ db: DB; close: () => Promise<void> }> {
  if (cfg.databaseUrl && !opts.memory) {
    const pool = new pg.Pool({ connectionString: cfg.databaseUrl, max: 10 });
    const db = drizzlePg(pool, { schema }) as unknown as DB;
    await migratePg(db as never, { migrationsFolder: MIGRATIONS });
    return { db, close: () => pool.end() };
  }
  let client: PGlite;
  if (opts.memory) client = new PGlite();
  else { mkdirSync(cfg.dataDir, { recursive: true }); client = new PGlite(resolve(cfg.dataDir, 'pg')); }
  const db = drizzlePglite(client, { schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
