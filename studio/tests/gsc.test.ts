import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { makeApp, addUser, client, ORIGIN } from './helpers.ts';
import { googleConnections, gscMetrics, seoJobs } from '../src/server/db/schema.ts';
import { GSC_SCOPE } from '../src/server/modules/google/client.ts';

let h: Awaited<ReturnType<typeof makeApp>>;
afterEach(async () => { await h?.close(); });

const KEY = randomBytes(32).toString('base64');
const GOOGLE = { googleClientId: 'test-client.apps.googleusercontent.com', googleClientSecret: 'test-secret', encryptionKey: KEY, googleRedirectUri: `${ORIGIN}/studio/api/seo/google/callback` };
const NOW = new Date('2026-11-22T12:00:00Z');   // last final Search Console day: 2026-11-19

/** A stand-in for Google's OAuth and Search Console endpoints, strict like the real ones about PKCE and tokens. */
function fakeGoogle() {
  const g = { challenges: new Map<string, string>(), revoked: false, calls: { sa: 0, inspect: 0, token: 0 }, lastAuthorized: '' };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const days = (a: string, b: string) => { const out: string[] = []; for (let d = a; d <= b; d = new Date(Date.parse(d) + 86_400_000).toISOString().slice(0, 10)) out.push(d); return out; };
  // deterministic data: clicks grow by day; two pages, three queries
  const dayN = (d: string) => Number(d.slice(8, 10));
  const http = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); const auth = (init?.headers as Record<string, string> | undefined)?.authorization;
    if (url === 'https://oauth2.googleapis.com/token') {
      g.calls.token++;
      const p = new URLSearchParams(String(init!.body));
      if (p.get('client_secret') !== 'test-secret') return json(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' });
      if (p.get('grant_type') === 'authorization_code') {
        const ch = g.challenges.get(p.get('code')!);
        if (!ch || createHash('sha256').update(p.get('code_verifier')!).digest('base64url') !== ch) return json(400, { error: 'invalid_grant', error_description: 'Bad code or PKCE verifier.' });
        const idt = ['x', Buffer.from(JSON.stringify({ email: 'seo@afcdteam.com' })).toString('base64url'), 'sig'].join('.');
        return json(200, { access_token: 'at-1', expires_in: 3600, refresh_token: 'rt-secret-1', scope: `openid email ${GSC_SCOPE}`, token_type: 'Bearer', id_token: idt });
      }
      if (g.revoked) return json(400, { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' });
      return json(200, { access_token: 'at-2', expires_in: 3600, token_type: 'Bearer' });
    }
    if (url === 'https://oauth2.googleapis.com/revoke') { g.revoked = true; return json(200, {}); }
    if (!auth?.startsWith('Bearer at-')) return json(401, { error: { status: 'UNAUTHENTICATED', message: 'Invalid credentials' } });
    if (url.endsWith('/webmasters/v3/sites')) return json(200, { siteEntry: [{ siteUrl: 'sc-domain:afcdfoundation.org', permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.example/', permissionLevel: 'siteUnverifiedUser' }] });
    if (url.includes('/searchAnalytics/query')) {
      g.calls.sa++;
      const b = JSON.parse(String(init!.body)); const dims: string[] = b.dimensions;
      if (b.startRow > 0) return json(200, {});
      const rows = days(b.startDate, b.endDate).flatMap((d) => {
        if (dims[0] === 'date') return [{ keys: [d], clicks: 10 + dayN(d), impressions: 200 + dayN(d), ctr: (10 + dayN(d)) / (200 + dayN(d)), position: 8.5 }];
        const pages = ['https://afcdfoundation.org/', 'https://afcdfoundation.org/about.html'];
        const qs = ['afcd foundation', 'ait ourir association', 'youth morocco'];
        if (dims.join() === 'query') return qs.map((q, i) => ({ keys: [q], clicks: i === 0 ? dayN(d) : 2, impressions: 50, ctr: 0.1, position: 3 + i }));
        if (dims.join() === 'page') return pages.map((p, i) => ({ keys: [p], clicks: i === 0 ? 8 : dayN(d) > 15 ? 1 : 4, impressions: 120, ctr: 0.05, position: 5 }));
        if (dims.join() === 'query,page') return [{ keys: [qs[0], pages[0]], clicks: 5, impressions: 40, ctr: 0.125, position: 2 }];
        if (dims[0] === 'country') return [{ keys: ['mar'], clicks: 9, impressions: 150, ctr: 0.06, position: 7 }];
        if (dims[0] === 'device') return [{ keys: ['MOBILE'], clicks: 6, impressions: 100, ctr: 0.06, position: 9 }, { keys: ['DESKTOP'], clicks: 4, impressions: 100, ctr: 0.04, position: 8 }];
        return [];
      });
      return json(200, { rows });
    }
    if (url.includes('urlInspection/index:inspect')) {
      g.calls.inspect++;
      return json(200, { inspectionResult: { inspectionResultLink: 'https://search.google.com/search-console/inspect?x', indexStatusResult: { verdict: 'PASS', coverageState: 'Submitted and indexed', indexingState: 'INDEXING_ALLOWED', lastCrawlTime: '2026-11-18T08:00:00Z', googleCanonical: 'https://afcdfoundation.org/about.html', userCanonical: 'https://afcdfoundation.org/about.html' } } });
    }
    return json(404, { error: { message: `fake google: no route ${url}` } });
  }) as typeof fetch;
  return { g, http };
}

describe('Search Console when Google is not set up', () => {
  it('says what is missing and never shows a connection', async () => {
    h = await makeApp();
    await addUser(h.db, 'admin@afcd.test', 'website_admin');
    const admin = await client(h.app, 'admin@afcd.test');
    const s = await admin.get('/seo/google/status');
    expect(s.body.setup).toMatchObject({ configured: false, missing: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'STUDIO_ENCRYPTION_KEY'] });
    expect(s.body.connection).toBeNull();
    expect((await admin.post('/seo/google/connect')).status).toBe(409);
    expect((await admin.get('/seo/gsc/overview?from=2026-11-01&to=2026-11-19')).body.current).toBeNull();   // no data, not zeroes
  });
});

describe('Search Console connection and sync', () => {
  let fake: ReturnType<typeof fakeGoogle>;
  beforeEach(async () => {
    fake = fakeGoogle();
    h = await makeApp({ googleHttp: fake.http, cfg: GOOGLE });
    await addUser(h.db, 'admin@afcd.test', 'website_admin'); await addUser(h.db, 'admin2@afcd.test', 'website_admin');
    await addUser(h.db, 'seo@afcd.test', 'seo_manager');
  });

  /** Plays the browser + Google consent: follows the auth URL, then calls our callback like Google's redirect would. */
  async function authorize(c: Awaited<ReturnType<typeof client>>, opts: { code?: string; state?: string } = {}) {
    const { body } = await c.post('/seo/google/connect');
    const u = new URL(body.url);
    const code = opts.code ?? `code-${Math.random()}`; fake.g.challenges.set(code, u.searchParams.get('code_challenge')!);
    const res = await h.app.request(`/studio/api/seo/google/callback?state=${encodeURIComponent(opts.state ?? u.searchParams.get('state')!)}&code=${code}`, { headers: { Cookie: c.cookie } });
    return { u, location: res.headers.get('location') ?? '' };
  }

  it('connects only through a real authorization with state and PKCE, and keeps tokens encrypted', async () => {
    const admin = await client(h.app, 'admin@afcd.test'), other = await client(h.app, 'admin2@afcd.test'), seo = await client(h.app, 'seo@afcd.test');
    expect((await seo.post('/seo/google/connect')).status).toBe(403);
    const { body } = await admin.post('/seo/google/connect');
    const u = new URL(body.url);
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: GOOGLE.googleClientId, redirect_uri: GOOGLE.googleRedirectUri, response_type: 'code', code_challenge_method: 'S256', access_type: 'offline', scope: `openid email ${GSC_SCOPE}` });
    expect(u.searchParams.get('state')!.length).toBeGreaterThan(20);

    // a forged state, a state started by someone else, and a reused state are all refused
    expect((await authorize(admin, { state: 'forged' })).location).toMatch(/gsc_error=.*not%20valid/);
    const started = await admin.post('/seo/google/connect'); const st = new URL(started.body.url).searchParams.get('state')!;
    const stolen = await h.app.request(`/studio/api/seo/google/callback?state=${st}&code=x`, { headers: { Cookie: other.cookie } });
    expect(stolen.headers.get('location')).toMatch(/gsc_error/);
    // a denied consent screen connects nothing
    const denied = await admin.post('/seo/google/connect'); const ds = new URL(denied.body.url).searchParams.get('state')!;
    expect((await h.app.request(`/studio/api/seo/google/callback?state=${ds}&error=access_denied`, { headers: { Cookie: admin.cookie } })).headers.get('location')).toMatch(/not%20granted/);
    expect((await admin.get('/seo/google/status')).body.connection).toBeNull();

    const ok = await authorize(admin);
    expect(ok.location).toBe('/studio/seo/integrations?gsc=connected');
    const reuse = await h.app.request(`/studio/api/seo/google/callback?state=${ok.u.searchParams.get('state')}&code=again`, { headers: { Cookie: admin.cookie } });
    expect(reuse.headers.get('location')).toMatch(/gsc_error/);

    const s = (await admin.get('/seo/google/status')).body;
    expect(s.connection).toMatchObject({ status: 'connected', accountEmail: 'seo@afcdteam.com', property: null });
    expect(JSON.stringify(s)).not.toMatch(/rt-secret-1|at-1/);                     // tokens never reach the browser
    const [row] = await h.db.select().from(googleConnections);
    expect(row.refreshTokenEnc).not.toContain('rt-secret-1'); expect(row.refreshTokenEnc.startsWith('v1.')).toBe(true);
  });

  it('chooses a verified property, syncs final days without duplicates and reports only stored Google rows', async () => {
    const admin = await client(h.app, 'admin@afcd.test'), seo = await client(h.app, 'seo@afcd.test');
    await authorize(admin);
    expect((await admin.get('/seo/google/properties')).body.map((p: any) => [p.siteUrl, p.usable])).toEqual([['https://other.example/', false], ['sc-domain:afcdfoundation.org', true]]);
    expect((await admin.put('/seo/google/property', { siteUrl: 'https://other.example/' })).status).toBe(422);
    expect((await admin.put('/seo/google/settings', { backfillDays: 10, retentionDays: 486, autoSync: true })).status).toBe(200);
    expect((await admin.put('/seo/google/property', { siteUrl: 'sc-domain:afcdfoundation.org' })).status).toBe(200);   // queues the first sync
    expect((await seo.post('/seo/google/sync')).status).toBe(200);                    // already queued: no second job
    expect((await h.db.select().from(seoJobs)).length).toBe(1);

    const job = await h.runJobs(NOW);
    expect(job).toMatchObject({ kind: 'gsc_sync', status: 'succeeded', progress: 100 });
    expect(job!.result).toMatchObject({ days: 10, from: '2026-11-10', to: '2026-11-19' });
    const count = async () => Number((await h.db.select({ n: sql<number>`count(*)` }).from(gscMetrics))[0].n);
    const first = await count();
    // syncing again re-reads the last days but stores no duplicates
    await seo.post('/seo/google/sync'); await h.runJobs(NOW);
    expect(await count()).toBe(first);

    const o = (await seo.get('/seo/gsc/overview?from=2026-11-10&to=2026-11-19')).body;
    const expectClicks = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19].reduce((a, d) => a + 10 + d, 0);
    expect(o.current.totals.clicks).toBe(expectClicks);
    expect(o.current.totals.position).toBeCloseTo(8.5);
    expect(o.coverage).toMatchObject({ from: '2026-11-10', to: '2026-11-19', days: 10 });
    expect((await seo.get('/seo/gsc/overview?from=2026-11-10&to=2026-11-19&device=MOBILE')).body.current.totals).toMatchObject({ clicks: 60, impressions: 1000 });
    expect((await seo.get('/seo/gsc/overview?from=2026-11-10&to=2026-11-19&device=MOBILE&country=mar')).status).toBe(422);

    const q = (await seo.get('/seo/gsc/queries?from=2026-11-10&to=2026-11-19')).body;
    expect(q[0]).toMatchObject({ key: 'afcd foundation', clicks: 145, impressions: 500 });
    const pg = (await seo.get(`/seo/gsc/page?url=${encodeURIComponent('https://afcdfoundation.org/')}&from=2026-11-10&to=2026-11-19`)).body;
    expect(pg.series).toHaveLength(10); expect(pg.queries[0]).toMatchObject({ key: 'afcd foundation', clicks: 50 });

    // winners/losers: second half vs first half; about.html dropped from 4 to 1 click a day after the 15th
    const m = (await seo.get('/seo/gsc/movers?from=2026-11-15&to=2026-11-19&min=20')).body;
    expect(m.pages.losers[0]).toMatchObject({ key: 'https://afcdfoundation.org/about.html', clicks: 8, prevClicks: 20 })   // 4 on the 15th, then 1 a day;
    expect(m.queries.winners[0].key).toBe('afcd foundation');
    expect(m.pages.method).toMatch(/at least 20 impressions/);
  });

  it('inspects only addresses of the property, within quota, and records Google’s indexed-version answer', async () => {
    const admin = await client(h.app, 'admin@afcd.test'), seo = await client(h.app, 'seo@afcd.test');
    await authorize(admin); await admin.put('/seo/google/property', { siteUrl: 'sc-domain:afcdfoundation.org' });
    expect((await seo.post('/seo/gsc/inspect', { url: 'https://evil.example/x' })).status).toBe(422);
    const r = await seo.post('/seo/gsc/inspect', { url: 'https://afcdfoundation.org/about.html' });
    expect(r.status).toBe(200); expect(r.body).toMatchObject({ verdict: 'PASS', coverageState: 'Submitted and indexed' });
    expect((await seo.get('/seo/gsc/inspections')).body[0]).toMatchObject({ url: 'https://afcdfoundation.org/about.html', link: expect.stringContaining('search.google.com') });
    expect((await seo.get('/seo/google/status')).body.usage.urlInspection).toMatchObject({ used: 1, limit: 1800 });
  });

  it('marks a revoked grant as needing reconnection, and disconnect revokes and deletes tokens', async () => {
    const admin = await client(h.app, 'admin@afcd.test');
    await authorize(admin); await admin.put('/seo/google/property', { siteUrl: 'sc-domain:afcdfoundation.org' });
    // the access token expires and Google has revoked the grant meanwhile
    await h.db.update(googleConnections).set({ accessExpiresAt: new Date(0) });
    fake.g.revoked = true;
    const job = await h.runJobs(NOW);
    expect(job).toMatchObject({ status: 'failed' });
    expect(job!.error).toMatch(/Reconnect/);
    expect((await admin.get('/seo/google/status')).body.connection.status).toBe('error');

    fake.g.revoked = false;
    const d = await admin.post('/seo/google/disconnect');
    expect(d.body).toEqual({ revoked: true });
    expect(await h.db.select().from(googleConnections).where(eq(googleConnections.provider, 'gsc'))).toEqual([]);
  });
});
