// Health (modules/health/service.ts). Before: no health endpoint (/studio/api/health was a 404), and the 60-second
// scheduler could start a second run while a slow one (a full site build) was still going.
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { makeApp, addUser, client } from './helpers.ts';
import { publishJobs } from '../src/server/db/schema.ts';
import { loop, resetLoops, details } from '../src/server/modules/health/service.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { resetLoops(); await h?.close(); });

describe('background loop guard', () => {
  it('never starts a run while the previous one is still going, and counts the skipped tick', async () => {
    let release!: () => void; let runs = 0;
    const tick = loop('t1', 'Test loop', 60_000, async () => { runs++; await new Promise<void>((r) => { release = r; }); });
    const first = tick();
    expect(await tick()).toBe('skipped');
    expect(await tick()).toBe('skipped');
    release(); expect(await first).toBe('ran');
    expect(runs).toBe(1);
    const p = tick(); release(); expect(await p).toBe('ran');
    expect(runs).toBe(2);
  });

  it('keeps the failures a run reports, and a run that throws does not stop the next one', async () => {
    let mode: 'fail' | 'throw' | 'ok' = 'fail';
    const tick = loop('t2', 'Test loop', 60_000, async (fail) => { if (mode === 'fail') fail('apply calls: boom'); if (mode === 'throw') throw new Error('crash'); });
    h = await makeApp();
    await tick();
    let d = await details(h.db, h.cfg);
    expect(d.loops.find((l) => l.name === 't2')).toMatchObject({ runs: 1, ok: false, lastErrors: ['apply calls: boom'] });
    expect(d.problems).toContain('Test loop: apply calls: boom');
    mode = 'throw'; await tick();
    d = await details(h.db, h.cfg);
    expect(d.loops.find((l) => l.name === 't2')!.lastErrors).toEqual(['crash']);
    mode = 'ok'; expect(await tick()).toBe('ran');
    d = await details(h.db, h.cfg);
    expect(d.loops.find((l) => l.name === 't2')).toMatchObject({ runs: 3, ok: true, lastErrors: [] });
    expect(d.status).toBe('ok');
  });

  it('reports a loop that has stopped running as late', async () => {
    h = await makeApp();
    const tick = loop('t3', 'The scheduler', 60_000, async () => {});
    await tick();
    const d = await details(h.db, h.cfg, { now: new Date(Date.now() + 10 * 60_000) });
    expect(d.loops.find((l) => l.name === 't3')).toMatchObject({ late: true, ok: false });
    expect(d.status).toBe('attention');
    expect(d.problems.some((p) => p.startsWith('The scheduler has not run for'))).toBe(true);
  });
});

describe('health endpoints', () => {
  beforeEach(async () => {
    h = await makeApp();
    await addUser(h.db, 'ro@afcd.test', 'read_only'); await addUser(h.db, 'admin@afcd.test', 'website_admin');
  });

  it('answers a public yes/no without a session and reveals nothing else', async () => {
    const res = await h.app.request('/studio/api/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ ok: true });
  });

  it('keeps the details for signed-in staff', async () => {
    expect((await h.app.request('/studio/api/health/details')).status).toBe(401);
    const ro = await client(h.app, 'ro@afcd.test');
    const d = (await ro.get('/health/details')).body;
    expect(d).toMatchObject({ status: 'ok', problems: [], database: { ok: true }, email: { serverReady: false, outbox: { queued: 0, failed: 0 } }, delivery: { last: null, failedLast24h: 0 } });
  });

  it('names a failed website delivery as a problem', async () => {
    await h.db.insert(publishJobs).values({ kind: 'publish_project', status: 'failed', error: 'build exploded', finishedAt: new Date() });
    const admin = await client(h.app, 'admin@afcd.test');
    const d = (await admin.get('/health/details')).body;
    expect(d.status).toBe('attention');
    expect(d.delivery).toMatchObject({ failedLast24h: 1, last: { kind: 'publish_project', status: 'failed', error: 'build exploded' } });
    expect(d.problems).toContain('1 website delivery failed in the last 24 hours.');
  });

  it('shows background work and email on the dashboard site checks', async () => {
    const tick = loop('scheduler', 'The scheduler', 60_000, async (fail) => { fail('apply calls: boom'); });
    await tick();
    const admin = await client(h.app, 'admin@afcd.test');
    const checks = (await admin.get('/overview')).body.health as { key: string; value: string; tone: string; detail: string }[];
    expect(checks.find((c) => c.key === 'background')).toMatchObject({ value: 'Needs attention', tone: 'warn', detail: 'The scheduler: apply calls: boom' });
    expect(checks.find((c) => c.key === 'email')).toMatchObject({ value: 'Not set up', tone: 'warn' });
    // a read-only user sees background work but not the email server
    const ro = await client(h.app, 'ro@afcd.test');
    const roChecks = (await ro.get('/overview')).body.health as { key: string }[];
    expect(roChecks.map((c) => c.key)).toContain('background');
    expect(roChecks.map((c) => c.key)).not.toContain('email');
  });
});
