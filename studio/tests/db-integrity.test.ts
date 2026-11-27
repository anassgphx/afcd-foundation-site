// scripts/db-integrity.sql: the read-only check the audit asked for (revision pointers have no foreign key). This runs the
// script's queries on a seeded test database: they must be valid SQL, find nothing on a healthy database, and find a
// pointer that has gone stale.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql, eq } from 'drizzle-orm';
import { makeApp } from './helpers.ts';
import { projects } from '../src/server/db/schema.ts';

const script = readFileSync(resolve(import.meta.dirname, '../scripts/db-integrity.sql'), 'utf8');
const part = (n: 1 | 2) => script.split(`-- part ${n}:`)[1].split(/\n-- part \d:|\nrollback;/)[0].replace(/^[^\n]*\n/, '').trim().replace(/;$/, '');
type Row = { check_name: string; table_name: string; problems: number; sample_ids: string };

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

describe('database integrity script', () => {
  it('only reads', () => {
    expect(script).toMatch(/begin transaction read only;/);
    expect(script.trim().endsWith('rollback;')).toBe(true);
    expect(script.replace(/^--.*$/gm, '')).not.toMatch(/\b(update|delete|insert|alter|drop|truncate)\b/i);
  });

  it('finds nothing on a healthy database and names a stale revision pointer', async () => {
    h = await makeApp();
    const rows = (await h.db.execute(sql.raw(part(1)))).rows as Row[];
    expect(rows.length).toBeGreaterThan(50);
    expect(rows.filter((r) => r.problems > 0)).toEqual([]);
    expect((await h.db.execute(sql.raw(part(2)))).rows.length).toBeGreaterThan(0);

    const [p] = await h.db.select().from(projects).limit(1);
    const stale = randomUUID();
    await h.db.update(projects).set({ publishedRevisionId: stale }).where(eq(projects.id, p.id));
    const bad = ((await h.db.execute(sql.raw(part(1)))).rows as Row[]).filter((r) => r.problems > 0);
    expect(bad).toEqual([{ check_name: 'published_revision_id points to a missing revision', table_name: 'projects', problems: 1, sample_ids: p.id }]);
  });
});
