// AFCD Apply, phase 1: calls for applications (records, lifecycle, server-time schedule, history, export).
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN } from './helpers.ts';
import { applyCalls, applyCallEvents, auditLog } from '../src/server/db/schema.ts';
import { runCallSchedule } from '../src/server/modules/apply/calls.ts';
import { utcToLocal, zonedToUtc } from '../src/server/modules/apply/time.ts';

let h: Awaited<ReturnType<typeof makeApp>> | undefined;
afterEach(async () => { await h?.close(); h = undefined; });

const DESC = 'Young people from Al Haouz join a twelve-week fellowship on climate action. Fellows meet every Saturday, plan a local project with mentors and present it to the commune at the end.';
const call = (over: Record<string, unknown> = {}) => ({
  title: 'Green Fellows 2099', slug: 'green-fellows-2099', summary: 'A twelve-week fellowship for young climate leaders.', description: DESC,
  callType: 'fellowship', audience: 'Young people aged 18 to 30', eligibility: ['Aged 18 to 30', 'Living in Al Haouz'], location: 'Ait Ourir', format: 'hybrid', language: 'multi',
  pillarKey: 'green-thumbs', projectSlug: null, heroMediaId: null, opensLocal: '2099-01-10T09:00', closesLocal: '2099-02-15T23:59', timeZone: 'Africa/Casablanca',
  places: 25, contactEmail: 'apply@afcd.test', terms: '', privacyNotice: 'We collect your name, contact details and answers to assess your application. Only the selection team sees them; they are deleted 12 months after the call closes.',
  seoTitle: '', seoDescription: '', unlisted: false, ...over,
});

describe('time zones', () => {
  it('converts local times and refuses times skipped by a clock change', () => {
    expect(zonedToUtc('2027-01-20T09:00', 'Europe/Paris')!.toISOString()).toBe('2027-01-20T08:00:00.000Z');
    expect(zonedToUtc('2027-07-20T09:00', 'Europe/Paris')!.toISOString()).toBe('2027-07-20T07:00:00.000Z');
    expect(zonedToUtc('2027-03-28T02:30', 'Europe/Paris')).toBeNull();      // does not exist (clocks jump to 03:00)
    expect(zonedToUtc('2027-02-30T10:00', 'UTC')).toBeNull();
    expect(zonedToUtc('2027-01-20T09:00', 'Mars/Olympus')).toBeNull();
    expect(utcToLocal(new Date('2027-01-20T08:00:00Z'), 'Europe/Paris')).toBe('2027-01-20T09:00');
  });
});

describe('apply calls', () => {
  beforeEach(async () => {
    h = await makeApp();
    for (const [e, r] of [['mgr@afcd.test', 'application_manager'], ['mgr2@afcd.test', 'application_manager'], ['rev@afcd.test', 'content_reviewer'],
      ['ar@afcd.test', 'application_reviewer'], ['ed@afcd.test', 'content_editor'], ['ro@afcd.test', 'read_only'], ['admin@afcd.test', 'website_admin']] as const) await addUser(h!.db, e, r);
  });

  async function created(over: Record<string, unknown> = {}) {
    const mgr = await client(h!.app, 'mgr@afcd.test');
    const r = await mgr.post('/apply/calls', call(over));
    expect(r.status).toBe(201);
    return { mgr, id: r.body.id as string, body: r.body };
  }
  const detail = async (id: string) => (await (await client(h!.app, 'admin@afcd.test')).get(`/apply/calls/${id}`)).body;

  it('lets only Apply roles in, and keeps applicants’ future data away from content roles', async () => {
    const ed = await client(h!.app, 'ed@afcd.test'), ro = await client(h!.app, 'ro@afcd.test'), ar = await client(h!.app, 'ar@afcd.test');
    expect((await ed.get('/apply/calls')).status).toBe(403);
    expect((await ro.get('/apply/overview')).status).toBe(403);
    expect((await ar.get('/apply/calls')).status).toBe(200);
    expect((await ar.post('/apply/calls', call())).status).toBe(403);
    const anon = await h!.app.request('/studio/api/apply/calls');
    expect(anon.status).toBe(401);
    // the Users screen offers the two new roles
    const roles = (await (await client(h!.app, 'admin@afcd.test')).get('/users')).body.roles.map((r: { id: string }) => r.id);
    expect(roles).toEqual(expect.arrayContaining(['application_manager', 'application_reviewer']));
  });

  it('validates input, stores UTC and gives references in sequence', async () => {
    const mgr = await client(h!.app, 'mgr@afcd.test');
    expect((await mgr.post('/apply/calls', call({ slug: 'Bad Slug' }))).status).toBe(422);
    expect((await mgr.post('/apply/calls', call({ title: '<script>x</script>' }))).status).toBe(422);
    expect((await mgr.post('/apply/calls', call({ closesLocal: '2099-01-01T09:00' }))).body.details[0].path).toBe('closesLocal');
    expect((await mgr.post('/apply/calls', call({ timeZone: 'Mars/Olympus' }))).status).toBe(422);
    expect((await mgr.post('/apply/calls', call({ timeZone: 'Europe/Paris', opensLocal: '2099-03-29T02:30' }))).status).toBe(422);
    expect((await mgr.post('/apply/calls', call({ extra: 1 }))).status).toBe(422);
    const a = await mgr.post('/apply/calls', call());
    const b = await mgr.post('/apply/calls', call({ slug: 'green-fellows-2099-b' }));
    expect(a.body.reference).toMatch(/^AFCD-\d{4}-001$/);
    expect(b.body.reference).toMatch(/^AFCD-\d{4}-002$/);
    expect((await mgr.post('/apply/calls', call())).status).toBe(409);   // slug taken
    const d = await detail(a.body.id);
    expect(d.opensLocal).toBe('2099-01-10T09:00');
    expect(new Date(d.opensAt).toISOString()).toBe(zonedToUtc('2099-01-10T09:00', 'Africa/Casablanca')!.toISOString());
    expect(d.history.events[0]).toMatchObject({ kind: 'status', toStatus: 'draft' });
  });

  it('refuses a stale save instead of overwriting someone else’s changes', async () => {
    const { mgr, id } = await created();
    const other = await client(h!.app, 'mgr2@afcd.test');
    expect((await mgr.put(`/apply/calls/${id}`, { ...call({ summary: 'First edit.' }), rev: 1 })).status).toBe(200);
    const stale = await other.put(`/apply/calls/${id}`, { ...call({ summary: 'Second edit.' }), rev: 1 });
    expect(stale.status).toBe(409);
    expect((await detail(id)).summary).toBe('First edit.');
    expect((await mgr.put(`/apply/calls/${id}`, call())).status).toBe(422);   // no rev at all
  });

  it('runs the review workflow: readiness, four eyes, schedule', async () => {
    const { mgr, id } = await created({ privacyNotice: '', contactEmail: '' });
    const notReady = await mgr.post(`/apply/calls/${id}/transition`, { action: 'submit' });
    expect(notReady.status).toBe(422);
    expect(notReady.body.details.map((x: { message: string }) => x.message).join(' ')).toMatch(/privacy notice/);
    await mgr.put(`/apply/calls/${id}`, { ...call(), rev: 1 });
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'submit' })).body.status).toBe('in_review');
    expect((await mgr.put(`/apply/calls/${id}`, { ...call({ summary: 'x' }), rev: 3 })).status).toBe(409);       // in review: withdraw first
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'approve' })).status).toBe(409);          // not their own
    const rev = await client(h!.app, 'rev@afcd.test');
    expect((await rev.post(`/apply/calls/${id}/transition`, { action: 'request_changes' })).status).toBe(422);  // needs a reason
    expect((await rev.post(`/apply/calls/${id}/transition`, { action: 'schedule' })).status).toBe(403);         // content reviewers cannot open calls
    expect((await rev.post(`/apply/calls/${id}/transition`, { action: 'approve' })).body.status).toBe('approved');
    // an edit after approval sends it back to draft
    const d = await detail(id);
    expect(d.actions.map((a: { action: string }) => a.action)).toEqual(expect.arrayContaining(['schedule', 'withdraw']));
    const noForm = await mgr.post(`/apply/calls/${id}/transition`, { action: 'schedule' });
    expect(noForm.status).toBe(409);
    expect(noForm.body.error).toMatch(/Publish the application form/);
    await publishForm(mgr, id);
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'schedule' })).body.status).toBe('scheduled');
    const [row] = await h!.db.select().from(applyCalls).where(eq(applyCalls.id, id));
    expect(row.openedAt).toBeNull();
  });

  async function publishForm(mgr: Awaited<ReturnType<typeof client>>, id: string) {
    const f = await mgr.post(`/apply/calls/${id}/form`, { template: 'youth_program' });
    expect(f.status).toBe(201);
    expect((await mgr.post(`/apply/calls/${id}/form/publish`, { rev: f.body.form.rev })).status).toBe(200);
  }
  async function scheduled(over: Record<string, unknown> = {}) {
    const c = await created(over);
    const rev = await client(h!.app, 'rev@afcd.test');
    await c.mgr.post(`/apply/calls/${c.id}/transition`, { action: 'submit' });
    await rev.post(`/apply/calls/${c.id}/transition`, { action: 'approve' });
    await publishForm(c.mgr, c.id);
    expect((await c.mgr.post(`/apply/calls/${c.id}/transition`, { action: 'schedule' })).body.status).toBe('scheduled');
    return c;
  }
  const rowOf = async (id: string) => (await h!.db.select().from(applyCalls).where(eq(applyCalls.id, id)))[0];

  it('opens and closes on server time, once', async () => {
    const { id } = await scheduled();
    const opens = zonedToUtc('2099-01-10T09:00', 'Africa/Casablanca')!, closes = zonedToUtc('2099-02-15T23:59', 'Africa/Casablanca')!;
    expect(await runCallSchedule(h!.db, new Date(opens.getTime() - 60_000))).toEqual([]);
    expect((await runCallSchedule(h!.db, opens)).map((r) => r.to)).toEqual(['open']);
    expect(await runCallSchedule(h!.db, opens)).toEqual([]);
    expect((await rowOf(id)).openedAt!.toISOString()).toBe(opens.toISOString());
    expect((await runCallSchedule(h!.db, closes)).map((r) => r.to)).toEqual(['closed']);
    expect((await rowOf(id)).status).toBe('closed');
    const ev = await h!.db.select().from(applyCallEvents).where(eq(applyCallEvents.callId, id));
    expect(ev.filter((e) => e.actorId === null).map((e) => e.toStatus).sort()).toEqual(['closed', 'open']);
    expect((await h!.db.select().from(auditLog).where(eq(auditLog.action, 'apply.call.auto_close'))).length).toBe(1);
  });

  it('locks the address and dates of a released call; changes go through recorded actions', async () => {
    const { mgr, id } = await scheduled();
    let r = await rowOf(id);
    expect((await mgr.put(`/apply/calls/${id}`, { ...call({ opensLocal: '2099-01-11T09:00' }), rev: r.rev })).status).toBe(409);
    expect((await mgr.put(`/apply/calls/${id}`, { ...call({ slug: 'renamed' }), rev: r.rev })).status).toBe(409);
    await runCallSchedule(h!.db, zonedToUtc('2099-01-10T09:00', 'Africa/Casablanca')!);
    r = await rowOf(id);
    expect((await mgr.put(`/apply/calls/${id}`, { ...call({ closesLocal: '2099-03-01T23:59' }), rev: r.rev })).body.error).toMatch(/Extend deadline/);
    // texts can still be corrected, and the correction is kept as a revision
    expect((await mgr.put(`/apply/calls/${id}`, { ...call({ summary: 'A twelve-week fellowship for young climate leaders in Al Haouz.' }), rev: r.rev })).status).toBe(200);
    const d = await detail(id);
    expect(d.history.revisions[0].reason).toBe('live_edit');
    expect(d.history.events[0]).toMatchObject({ kind: 'edit', meta: { fields: ['summary'] } });
    // extend: needs a reason and a later deadline
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'extend', closesLocal: '2099-03-01T23:59' })).status).toBe(422);
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'extend', reason: 'Partners asked', closesLocal: '2099-02-01T23:59' })).status).toBe(422);
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'extend', reason: 'Partners asked for two more weeks', closesLocal: '2099-03-01T23:59' })).body.status).toBe('open');
    const ext = (await detail(id)).history.events[0];
    expect(ext).toMatchObject({ kind: 'extend', reason: 'Partners asked for two more weeks' });
    expect(ext.meta.to).toBe(zonedToUtc('2099-03-01T23:59', 'Africa/Casablanca')!.toISOString());
    // close early, then reopen only on purpose, with a reason and a new deadline
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'close', reason: 'All places filled' })).body.status).toBe('closed');
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'reopen', reason: 'Places freed up' })).status).toBe(422);
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'reopen', reason: 'Places freed up', closesLocal: '2099-03-10T23:59' })).body.status).toBe('open');
    expect((await detail(id)).history.events[0].kind).toBe('reopen');
    // a manual close cannot be undone by the scheduler, and evaluation follows a close
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'close', reason: 'Done' });
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'pause', reason: 'x y z' })).status).toBe(409);
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'start_evaluation' })).body.status).toBe('under_evaluation');
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'reopen', reason: 'Nope', closesLocal: '2099-04-01T23:59' })).status).toBe(409);
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'complete' })).body.status).toBe('completed');
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'archive' })).body.status).toBe('archived');
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'restore' })).body.status).toBe('completed');
  });

  it('pauses and resumes; a paused call past its deadline closes', async () => {
    const { mgr, id } = await scheduled();
    await runCallSchedule(h!.db, zonedToUtc('2099-01-10T09:00', 'Africa/Casablanca')!);
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'pause', reason: 'Fixing a typo in the terms' })).body.status).toBe('paused');
    expect((await mgr.post(`/apply/calls/${id}/transition`, { action: 'resume' })).body.status).toBe('open');
    await mgr.post(`/apply/calls/${id}/transition`, { action: 'pause', reason: 'Again' });
    expect((await runCallSchedule(h!.db, zonedToUtc('2099-02-16T00:00', 'Africa/Casablanca')!)).map((r) => r.to)).toEqual(['closed']);
  });

  it('duplicates as a fresh draft and exports a safe CSV', async () => {
    const { mgr, id } = await created({ title: '=HYPERLINK("http://evil.example")' });
    const dup = await mgr.post(`/apply/calls/${id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body).toMatchObject({ slug: 'green-fellows-2099-copy', status: 'draft', opensAt: null, closesAt: null });
    expect(dup.body.reference).toMatch(/-002$/);
    expect((await mgr.post(`/apply/calls/${id}/duplicate`)).body.slug).toBe('green-fellows-2099-copy-2');

    const ar = await client(h!.app, 'ar@afcd.test');
    expect((await ar.raw('GET', '/apply/calls/export.csv')).status).toBe(403);
    const res = await h!.app.request('/studio/api/apply/calls/export.csv', { headers: { Cookie: mgr.cookie, Origin: ORIGIN } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment/);
    const csv = await res.text();
    expect(csv).toContain(`"'=HYPERLINK(""http://evil.example"")"`);
    expect(csv).not.toMatch(/(^|,)=HYPERLINK/m);
    expect((await h!.db.select().from(auditLog).where(eq(auditLog.action, 'apply.calls_export'))).length).toBe(1);
  });

  it('shows real numbers on the overview', async () => {
    const mgr = await client(h!.app, 'mgr@afcd.test');
    expect((await mgr.get('/apply/overview')).body.kpis).toMatchObject({ open: 0, scheduled: 0, total: 0 });
    const { id } = await scheduled();
    await created({ slug: 'second-call' });
    await runCallSchedule(h!.db, zonedToUtc('2099-01-10T09:00', 'Africa/Casablanca')!);
    const o = (await mgr.get('/apply/overview')).body;
    expect(o.kpis).toMatchObject({ open: 1, scheduled: 0, drafts: 1, total: 2 });
    expect(o.deadlines.map((d: { id: string }) => d.id)).toEqual([id]);
    expect(o.activity[0]).toMatchObject({ toStatus: 'open', actorName: null });
  });
});

describe('migrations 0028 and 0027 rollback', () => {
  it('removes the calls and demotes Apply roles to read-only, and migrating forward works again', async () => {
    const { PGlite } = await import('@electric-sql/pglite');
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { MIGRATIONS } = await import('../src/server/db/client.ts');
    const pg = new PGlite();
    const db = drizzle(pg);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await pg.exec(`insert into users (email, name, password_hash, role) values ('m@afcd.test', 'm', 'x', 'application_manager'), ('a@afcd.test', 'a', 'x', 'website_admin')`);
    await pg.exec(`insert into apply_calls (reference, slug, title) values ('AFCD-2099-001', 'fake-call', 'Fake call')`);
    await pg.exec(`insert into apply_forms (call_id, definition) select id, '{}'::jsonb from apply_calls`);
    await pg.exec(`insert into opportunities (slug, title, apply_method) values ('fake-opp', 'Fake', 'studio')`);
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0032_apply_messages_down.sql'), 'utf8'));   // newer first
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0031_apply_evaluation_down.sql'), 'utf8'));
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0030_apply_submissions_down.sql'), 'utf8'));
    expect((await pg.query(`select to_regclass('apply_submissions') as t`)).rows[0]).toEqual({ t: null });
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0029_apply_drafts_down.sql'), 'utf8'));
    expect((await pg.query(`select apply_method::text as m from opportunities`)).rows).toEqual([{ m: 'contact' }]);
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0028_apply_forms_down.sql'), 'utf8'));
    expect((await pg.query(`select to_regclass('apply_forms') as t`)).rows[0]).toEqual({ t: null });
    await pg.exec(readFileSync(join(MIGRATIONS, 'recovery/0027_apply_calls_down.sql'), 'utf8'));
    expect((await pg.query<{ email: string; role: string }>('select email, role::text as role from users order by email')).rows).toEqual([{ email: 'a@afcd.test', role: 'website_admin' }, { email: 'm@afcd.test', role: 'read_only' }]);
    expect((await pg.query(`select to_regclass('apply_calls') as t`)).rows[0]).toEqual({ t: null });
    await migrate(db, { migrationsFolder: MIGRATIONS });
    await pg.exec(`update users set role = 'application_reviewer' where email = 'm@afcd.test'`);
    expect((await pg.query(`select count(*)::int as n from apply_calls`)).rows[0]).toEqual({ n: 0 });
    await pg.close();
  });
});
