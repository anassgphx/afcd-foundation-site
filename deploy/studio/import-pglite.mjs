// One-time copy of a Studio PGlite database (the old local data folder) into the PostgreSQL in DATABASE_URL.
// Run inside the studio-app container from /app/studio:  node import-pglite.mjs /import/pg
// The target must have the schema already (start Studio once: it applies the migrations) and be empty.
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

const src = process.argv[2];
if (!src || !process.env.DATABASE_URL) { console.error('usage: DATABASE_URL=... node import-pglite.mjs <pglite dir>'); process.exit(2); }
const lite = new PGlite(src);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const db = await pool.connect();

const q = (sql) => lite.query(sql).then((r) => r.rows);
const tables = (await q(`select tablename from pg_tables where schemaname = 'public' order by tablename`)).map((r) => r.tablename);
const target = new Set((await db.query(`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => r.tablename));

let total = 0;
// The target is a fresh database: migrations may have pre-filled a few lookup rows, so it is emptied first.
// Safety: refuse if it already has user accounts (someone has started using it).
if (target.has('users') && Number((await db.query('select count(*)::int as n from users')).rows[0].n) > 0) throw new Error('target already has users; refusing to overwrite');
await db.query('begin');
await db.query(`truncate ${[...target].map((t) => `"${t}"`).join(', ')} cascade`);
await db.query('set local session_replication_role = replica');   // load in any order; constraints were valid in the source
for (const t of tables) {
  if (!target.has(t)) { console.log(`skip ${t} (not in target schema)`); continue; }
  const rows = await q(`select to_jsonb(x) as j from "${t}" x`);
  for (const { j } of rows) await db.query(`insert into "${t}" select * from jsonb_populate_record(null::"${t}", $1::jsonb)`, [JSON.stringify(j)]);
  total += rows.length;
  console.log(`${t}: ${rows.length}`);
}
// serial / identity sequences continue after the copied ids
const seqs = (await db.query(`
  select c.relname as t, a.attname as col, pg_get_serial_sequence(format('%I', c.relname), a.attname) as seq
  from pg_class c join pg_attribute a on a.attrelid = c.oid join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
    and pg_get_serial_sequence(format('%I', c.relname), a.attname) is not null`)).rows;
for (const s of seqs) await db.query(`select setval($1, coalesce((select max("${s.col}") from "${s.t}"), 0) + 1, false)`, [s.seq]);
await db.query('commit');
console.log(`done: ${total} rows from ${tables.length} tables, ${seqs.length} sequences reset`);
db.release(); await pool.end(); await lite.close();
