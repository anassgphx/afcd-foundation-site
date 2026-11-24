// Gap G of the audit: a publish "succeeded" once Studio's own build was checked, but visitors get a copy synced separately.
// confirmPublic compares the build stamp of robots.txt on both sides and records what it saw.
import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { makeApp } from './helpers.ts';
import { auditLog, publishJobs } from '../src/server/db/schema.ts';
import { checksPublic, confirmPublic, publicState, stampOf } from '../src/server/modules/publish/public-check.ts';

const robots = (stamp: string) => `User-agent: *\nAllow: /\n\nSitemap: https://afcdfoundation.com/sitemap.xml\n\n# studio-build: ${stamp}\n`;
const serving = (body: string | null, status = 200) => (async () => new Response(body ?? '', { status })) as unknown as typeof fetch;
const noWait = async () => {};

describe('public site check after publishing', () => {
  let env: string | undefined;
  afterEach(() => { if (env === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = env; });
  const setup = async () => {
    env = process.env.NODE_ENV; process.env.NODE_ENV = 'production';   // the check is off under test unless asked for
    const h = await makeApp({ cfg: { publicSiteUrl: 'https://afcdfoundation.com/' } });
    writeFileSync(join(h.siteRoot, 'robots.txt'), robots('aaaa1111bbbb2222'));
    const [job] = await h.db.insert(publishJobs).values({ kind: 'publish_project', status: 'succeeded', log: 'built' }).returning();
    return { ...h, job };
  };

  it('reads the stamp build.mjs writes', () => {
    expect(stampOf(robots('aaaa1111bbbb2222'))).toBe('aaaa1111bbbb2222');
    expect(stampOf('User-agent: *\nAllow: /\n')).toBeNull();
  });

  it('is off for local and test setups', async () => {
    const h = await makeApp({ cfg: { publicSiteUrl: 'http://localhost:4321/' } });
    expect(checksPublic(h.cfg)).toBe(false);
    expect((await publicState(h.cfg)).checked).toBe(false);
    await h.close();
  });

  it('confirms once the public site serves the same build, and records it', async () => {
    const h = await setup();
    expect(await confirmPublic(h.db, h.cfg, h.job.id, null, { fetcher: serving(robots('aaaa1111bbbb2222')), wait: noWait })).toBe(true);
    const [j] = await h.db.select().from(publishJobs).where(eq(publishJobs.id, h.job.id));
    expect(j.log).toMatch(/^built\nPublic site: serving this build \(aaaa1111bbbb2222\)/);
    expect((await h.db.select().from(auditLog)).some((a) => a.action === 'publish.public_confirmed')).toBe(true);
    await h.close();
  });

  it('reports a publish that never reached visitors instead of calling it done', async () => {
    const h = await setup();
    let calls = 0; const old = (async () => { calls++; return new Response(robots('0000000000000000')); }) as unknown as typeof fetch;
    expect(await confirmPublic(h.db, h.cfg, h.job.id, null, { fetcher: old, wait: noWait, timeoutMs: 0 })).toBe(false);
    expect(calls).toBeGreaterThan(0);
    const [j] = await h.db.select().from(publishJobs).where(eq(publishJobs.id, h.job.id));
    expect(j.log).toMatch(/Public site: NOT serving this build/);
    expect(j.status).toBe('succeeded');   // the build itself was fine; the gap is shown next to it, not hidden
    expect((await h.db.select().from(auditLog)).some((a) => a.action === 'publish.public_missing')).toBe(true);
    const st = await publicState(h.cfg, old);
    expect(st).toMatchObject({ checked: true, built: 'aaaa1111bbbb2222', live: '0000000000000000', match: false });
    await h.close();
  });

  it('says why when the public site cannot be read', async () => {
    const h = await setup();
    expect(await publicState(h.cfg, serving('oops', 503))).toMatchObject({ checked: true, match: false, error: 'The public site answered 503.' });
    const down = (async () => { throw new Error('ECONNREFUSED'); }) as unknown as typeof fetch;
    expect((await publicState(h.cfg, down)).error).toMatch(/Could not reach the public site \(ECONNREFUSED\)/);
    await h.close();
  });

  it('waits for the sync, then confirms', async () => {
    const h = await setup();
    let n = 0; const later = (async () => new Response(robots(++n < 3 ? '0000000000000000' : 'aaaa1111bbbb2222'))) as unknown as typeof fetch;
    expect(await confirmPublic(h.db, h.cfg, h.job.id, null, { fetcher: later, wait: noWait, timeoutMs: 60_000 })).toBe(true);
    expect(n).toBe(3);
    await h.close();
  });
});
