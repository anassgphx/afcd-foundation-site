// Google Search Console for SEO Pro: connection (OAuth 2.0 + PKCE), property choice, incremental daily sync, reports
// and URL Inspection. Every number shown comes from rows Google returned; nothing is estimated or filled in.
//
// Search Console facts this module respects (documented in the UI):
// - Data is final after about 2–3 days; the sync stores final days only and re-reads the last 3 stored days.
// - The API returns at most 25,000 rows per request (paged with startRow); Google keeps about 16 months.
// - Rare (anonymized) queries are left out of query rows, so query totals are lower than site totals.
// - "Position" is Google's average position for the impressions, not a live rank.
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { apiUsage, googleConnections, gscMetrics, oauthStates, seoSettings, urlInspections } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { decrypt, encrypt, keyFrom, pkce } from './crypto.ts';
import * as G from './client.ts';
import { PermanentError, type JobCtx } from '../jobs/service.ts';

const P = 'gsc';
export const DIMS = ['query', 'page', 'query,page', 'country', 'device'] as const;
// self-imposed daily ceilings, well inside Google's published limits (URL Inspection: 2,000/day per property)
export const QUOTA = { searchAnalytics: 2000, urlInspection: 1800 } as const;
export type GscSettings = { backfillDays: number; retentionDays: number; autoSync: boolean };
export const DEFAULT_SETTINGS: GscSettings = { backfillDays: 90, retentionDays: 486, autoSync: true };

export function setup(cfg: Config) {
  const missing = [!cfg.googleClientId && 'GOOGLE_CLIENT_ID', !cfg.googleClientSecret && 'GOOGLE_CLIENT_SECRET', !cfg.encryptionKey && 'STUDIO_ENCRYPTION_KEY'].filter(Boolean) as string[];
  let keyError: string | null = null;
  if (cfg.encryptionKey) try { keyFrom(cfg.encryptionKey); } catch (e) { keyError = (e as Error).message; }
  return { configured: !missing.length && !keyError, missing, keyError, redirectUri: cfg.googleRedirectUri };
}
const key = (cfg: Config) => keyFrom(cfg.encryptionKey);
const need = (cfg: Config) => { const s = setup(cfg); if (!s.configured) throw new AppError(409, s.keyError ?? `Google is not set up on this Studio: add ${s.missing.join(', ')} to studio/.env and restart.`); };

export async function connection(db: DB) { return (await db.select().from(googleConnections).where(eq(googleConnections.provider, P)))[0] ?? null; }
export async function settings(db: DB): Promise<GscSettings> {
  const [r] = await db.select().from(seoSettings).where(eq(seoSettings.key, 'gsc:settings'));
  return { ...DEFAULT_SETTINGS, ...((r?.published as Partial<GscSettings>) ?? {}) };
}
export async function saveSettings(db: DB, actor: NonNullable<Actor>, s: GscSettings) {
  const [r] = await db.select().from(seoSettings).where(eq(seoSettings.key, 'gsc:settings'));
  if (r) await db.update(seoSettings).set({ published: s, updatedBy: actor.id, updatedAt: new Date() }).where(eq(seoSettings.key, 'gsc:settings'));
  else await db.insert(seoSettings).values({ key: 'gsc:settings', published: s, status: 'published', updatedBy: actor.id });
  await audit(db, actor, 'gsc.settings', { type: 'google', id: P }, `Search Console sync: ${s.backfillDays} days back, keep ${s.retentionDays} days, auto ${s.autoSync ? 'on' : 'off'}`);
}

/** What the UI may know about the connection. Tokens never leave the server. */
export async function status(db: DB, cfg: Config) {
  const c = await connection(db);
  return {
    setup: setup(cfg), settings: await settings(db),
    connection: c && { status: c.status, accountEmail: c.accountEmail, scopes: c.scopes.split(' ').filter(Boolean), property: c.property, permissionLevel: c.permissionLevel,
      connectedAt: c.connectedAt, lastSyncAt: c.lastSyncAt, lastSyncedDate: c.lastSyncedDate, lastError: c.lastError },
    usage: await usageToday(db),
  };
}

// ---------------------------------------------------------------- OAuth
export async function startConnect(db: DB, cfg: Config, actor: NonNullable<Actor>) {
  need(cfg);
  await db.delete(oauthStates).where(lt(oauthStates.createdAt, new Date(Date.now() - 10 * 60_000)));
  const state = randomBytes(24).toString('base64url'); const { verifier, challenge } = pkce();
  await db.insert(oauthStates).values({ state, provider: P, codeVerifierEnc: encrypt(key(cfg), verifier), userId: actor.id });
  return { url: G.authUrl(cfg, state, challenge) };
}

/** Google redirects here. The state must be ours, fresh, unused and started by the same Studio user. */
export async function finishConnect(db: DB, cfg: Config, http: G.Http, actor: NonNullable<Actor>, q: { state?: string; code?: string; error?: string }) {
  need(cfg);
  const [st] = q.state ? await db.delete(oauthStates).where(eq(oauthStates.state, q.state)).returning() : [];
  if (!st || st.provider !== P || st.userId !== actor.id || Date.now() - st.createdAt.getTime() > 10 * 60_000) throw new AppError(400, 'This Google sign-in link is not valid any more. Start the connection again from Studio.');
  if (q.error) throw new AppError(400, q.error === 'access_denied' ? 'Google access was not granted, so nothing was connected.' : `Google returned an error: ${q.error}`);
  if (!q.code) throw new AppError(400, 'Google did not return an authorization code.');
  const tok = await G.exchangeCode(http, cfg, q.code, decrypt(key(cfg), st.codeVerifierEnc)).catch((e: G.GoogleError) => { throw new AppError(400, `Google did not accept the sign-in: ${e.message}`); });
  if (!tok.refresh_token) throw new AppError(400, 'Google did not return offline access. Remove AFCD Studio from your Google account’s third-party access, then connect again.');
  if (!(tok.scope ?? '').split(' ').includes(G.GSC_SCOPE)) throw new AppError(400, 'Search Console access was not granted. Connect again and allow “View Search Console data”.');
  const k = key(cfg); const now = new Date();
  const row = { status: 'connected', accountEmail: G.idTokenEmail(tok.id_token), scopes: tok.scope ?? '', refreshTokenEnc: encrypt(k, tok.refresh_token),
    accessTokenEnc: encrypt(k, tok.access_token), accessExpiresAt: new Date(now.getTime() + (tok.expires_in - 60) * 1000), connectedBy: actor.id, connectedAt: now, lastError: null, updatedAt: now };
  const cur = await connection(db);
  if (cur) await db.update(googleConnections).set({ ...row, property: null, permissionLevel: null }).where(eq(googleConnections.id, cur.id));
  else await db.insert(googleConnections).values({ provider: P, ...row });
  await audit(db, actor, 'gsc.connect', { type: 'google', id: P }, `Connected Google Search Console${row.accountEmail ? ` as ${row.accountEmail}` : ''}`);
}

/** A valid access token, refreshed when needed. A revoked grant marks the connection as needing reconnection. */
export async function accessToken(db: DB, cfg: Config, http: G.Http) {
  need(cfg); const c = await connection(db);
  if (!c) throw new PermanentError('Search Console is not connected.');
  if (c.status !== 'connected') throw new PermanentError('Search Console access stopped working. Reconnect it in SEO → Integrations.');
  const k = key(cfg);
  if (c.accessTokenEnc && c.accessExpiresAt && c.accessExpiresAt.getTime() > Date.now()) return decrypt(k, c.accessTokenEnc);
  try {
    const t = await G.refreshAccess(http, cfg, decrypt(k, c.refreshTokenEnc));
    await db.update(googleConnections).set({ accessTokenEnc: encrypt(k, t.access_token), accessExpiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000), updatedAt: new Date() }).where(eq(googleConnections.id, c.id));
    return t.access_token;
  } catch (e) {
    const g = e as G.GoogleError;
    if (g.reauth || g.status === 400 || g.status === 401) {
      await db.update(googleConnections).set({ status: 'error', lastError: 'Google refused the stored access (revoked or expired). Reconnect Search Console.', accessTokenEnc: null, updatedAt: new Date() }).where(eq(googleConnections.id, c.id));
      throw new PermanentError('Google refused the stored access. Reconnect Search Console.');
    }
    throw e;
  }
}

export async function listProperties(db: DB, cfg: Config, http: G.Http) {
  const sites = await G.listSites(http, await accessToken(db, cfg, http));
  return sites.map((s) => ({ ...s, usable: s.permissionLevel !== 'siteUnverifiedUser' })).sort((a, b) => a.siteUrl.localeCompare(b.siteUrl));
}

export async function chooseProperty(db: DB, cfg: Config, http: G.Http, actor: NonNullable<Actor>, siteUrl: string) {
  const site = (await listProperties(db, cfg, http)).find((s) => s.siteUrl === siteUrl);
  if (!site) throw new AppError(422, 'This property is not in the connected Google account.');
  if (!site.usable) throw new AppError(422, 'The connected account is not a verified user of this property. Ask an owner to add it in Search Console.');
  const c = (await connection(db))!;
  const changed = c.property !== site.siteUrl;
  await db.update(googleConnections).set({ property: site.siteUrl, permissionLevel: site.permissionLevel, ...(changed ? { lastSyncedDate: null, lastSyncAt: null } : {}), updatedAt: new Date() }).where(eq(googleConnections.id, c.id));
  await audit(db, actor, 'gsc.property', { type: 'google', id: P }, `Search Console property: ${site.siteUrl} (${site.permissionLevel})`);
}

/** Revokes the grant at Google (best effort) and deletes the stored tokens. Imported data stays until removed. */
export async function disconnect(db: DB, cfg: Config, http: G.Http, actor: NonNullable<Actor>) {
  const c = await connection(db); if (!c) throw new AppError(409, 'Search Console is not connected.');
  let revoked = false;
  if (setup(cfg).configured) try { await G.revoke(http, decrypt(key(cfg), c.refreshTokenEnc)); revoked = true; } catch { /* still removed locally */ }
  await db.delete(googleConnections).where(eq(googleConnections.id, c.id));
  await audit(db, actor, 'gsc.disconnect', { type: 'google', id: P }, `Disconnected Google Search Console${revoked ? ' (access revoked at Google)' : ' (Google could not be reached to revoke; remove access in the Google account)'}`);
  return { revoked };
}

// ---------------------------------------------------------------- quotas
const today = () => new Date().toISOString().slice(0, 10);
export async function useQuota(db: DB, endpoint: keyof typeof QUOTA, n = 1) {
  const [row] = await db.insert(apiUsage).values({ provider: P, endpoint, day: today(), calls: n })
    .onConflictDoUpdate({ target: [apiUsage.provider, apiUsage.endpoint, apiUsage.day], set: { calls: sql`${apiUsage.calls} + ${n}` } }).returning();
  if (row.calls > QUOTA[endpoint]) throw new G.GoogleError(429, 'studio_quota', `Studio’s daily limit for ${endpoint === 'urlInspection' ? 'URL inspections' : 'Search Console requests'} (${QUOTA[endpoint]}) is used up; it resets tomorrow.`, true);
}
export async function usageToday(db: DB) {
  const rows = await db.select().from(apiUsage).where(and(eq(apiUsage.provider, P), eq(apiUsage.day, today())));
  return Object.fromEntries(Object.keys(QUOTA).map((k) => [k, { used: rows.find((r) => r.endpoint === k)?.calls ?? 0, limit: QUOTA[k as keyof typeof QUOTA] }]));
}

// ---------------------------------------------------------------- sync
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** The newest day Google treats as final (about 3 days ago, Pacific time). */
export const lastFinalDay = (now = new Date()) => addDays(now.toISOString().slice(0, 10), -3);

export async function syncJob(db: DB, cfg: Config, http: G.Http, ctx: JobCtx, now = new Date()) {
  const c = await connection(db);
  if (!c) throw new PermanentError('Search Console is not connected.');
  if (!c.property) throw new PermanentError('Choose a Search Console property first.');
  const s = await settings(db); const end = lastFinalDay(now);
  const earliest = addDays(end, -(s.backfillDays - 1));
  const start = c.lastSyncedDate ? (addDays(c.lastSyncedDate, -2) > earliest ? addDays(c.lastSyncedDate, -2) : earliest) : earliest;
  if (start > end) return { days: 0, rows: 0, note: 'Nothing new: Google has no final day after the last sync yet.' };
  const days: string[] = []; for (let d = start; d <= end; d = addDays(d, 1)) days.push(d);
  let token = await accessToken(db, cfg, http); let rows = 0;
  const put = async (dims: string, list: { date: string; query?: string; page?: string; country?: string; device?: string; r: G.SaRow }[]) => {
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500).map(({ date, query = '', page = '', country = '', device = '', r }) => ({ property: c.property!, searchType: 'web', dims, date, query, page, country, device,
        clicks: Math.round(r.clicks), impressions: Math.round(r.impressions), ctr: String(r.ctr), position: String(r.position), dataState: 'final', importedAt: new Date() }));
      await db.insert(gscMetrics).values(chunk).onConflictDoUpdate({
        target: [gscMetrics.property, gscMetrics.searchType, gscMetrics.dims, gscMetrics.date, gscMetrics.query, gscMetrics.page, gscMetrics.country, gscMetrics.device],
        set: { clicks: sql`excluded.clicks`, impressions: sql`excluded.impressions`, ctr: sql`excluded.ctr`, position: sql`excluded.position`, importedAt: sql`excluded.imported_at` } });
      rows += chunk.length;
    }
  };
  const fetchAll = async (body: G.SaRequest) => {
    const out: G.SaRow[] = [];
    for (let startRow = 0; ; startRow += 25000) {
      await useQuota(db, 'searchAnalytics');
      let page: G.SaRow[];
      try { page = await G.searchAnalytics(http, token, c.property!, { ...body, type: 'web', dataState: 'final', rowLimit: 25000, startRow }); }
      catch (e) { if ((e as G.GoogleError).status === 401) { token = await accessToken(db, cfg, http); page = await G.searchAnalytics(http, token, c.property!, { ...body, type: 'web', dataState: 'final', rowLimit: 25000, startRow }); } else throw e; }
      out.push(...page); if (page.length < 25000) return out;
    }
  };
  // site totals per day (include anonymized queries) in one request
  await put('date', (await fetchAll({ startDate: start, endDate: end, dimensions: ['date'] })).map((r) => ({ date: r.keys![0], r })));
  for (const [i, day] of days.entries()) {
    if (await ctx.cancelled()) return { days: i, rows, cancelled: true };
    for (const dims of DIMS) {
      const list = await fetchAll({ startDate: day, endDate: day, dimensions: dims.split(',') });
      const keys = dims.split(',');
      await put(dims, list.map((r) => ({ date: day, r, ...Object.fromEntries(keys.map((k, j) => [k, r.keys![j]])) })));
    }
    await db.update(googleConnections).set({ lastSyncedDate: day, lastSyncAt: new Date(), lastError: null }).where(eq(googleConnections.id, c.id));
    await ctx.progress(((i + 1) / days.length) * 100, `Imported ${day} (${i + 1} of ${days.length} days)`);
  }
  // retention: drop days older than the configured window
  const cutoff = addDays(end, -s.retentionDays);
  await db.delete(gscMetrics).where(and(eq(gscMetrics.property, c.property), lt(gscMetrics.date, cutoff)));
  return { days: days.length, rows, from: start, to: end };
}

// ---------------------------------------------------------------- reports (only from stored Google rows)
export type Range = { from: string; to: string; device?: string; country?: string };
const n = (v: unknown) => Number(v) || 0;
async function prop(db: DB) { const c = await connection(db); return c?.property ?? null; }

/** Latest stored day and how many days exist: the UI uses this to pick default ranges and show empty states. */
export async function coverage(db: DB) {
  const p = await prop(db); if (!p) return null;
  const [r] = await db.select({ min: sql<string>`min(${gscMetrics.date})`, max: sql<string>`max(${gscMetrics.date})`, days: sql<number>`count(distinct ${gscMetrics.date})`, imported: sql<string>`max(${gscMetrics.importedAt})` })
    .from(gscMetrics).where(and(eq(gscMetrics.property, p), eq(gscMetrics.dims, 'date')));
  return r?.max ? { property: p, from: r.min, to: r.max, days: n(r.days), importedAt: r.imported } : { property: p, from: null, to: null, days: 0, importedAt: null };
}

/** Daily series and totals. Device or country filters use Google's per-device / per-country rows (not both at once). */
export async function overview(db: DB, r: Range) {
  const p = await prop(db); if (!p) return null;
  const dims = r.device ? 'device' : r.country ? 'country' : 'date';
  const where = and(eq(gscMetrics.property, p), eq(gscMetrics.dims, dims), gte(gscMetrics.date, r.from), lte(gscMetrics.date, r.to),
    r.device ? eq(gscMetrics.device, r.device) : undefined, r.country ? eq(gscMetrics.country, r.country) : undefined);
  const rows = await db.select({ date: gscMetrics.date, clicks: gscMetrics.clicks, impressions: gscMetrics.impressions, position: gscMetrics.position }).from(gscMetrics).where(where).orderBy(asc(gscMetrics.date));
  const clicks = rows.reduce((a, x) => a + x.clicks, 0), impressions = rows.reduce((a, x) => a + x.impressions, 0);
  // average position weighted by impressions, the way Search Console combines days
  const position = impressions ? rows.reduce((a, x) => a + n(x.position) * x.impressions, 0) / impressions : null;
  return { series: rows.map((x) => ({ date: x.date, clicks: x.clicks, impressions: x.impressions, position: n(x.position) })), totals: { clicks, impressions, ctr: impressions ? clicks / impressions : null, position }, days: rows.length };
}

async function grouped(db: DB, dims: 'query' | 'page' | 'country' | 'device', r: Range, limit = 500, filter?: { page?: string }) {
  const p = await prop(db); if (!p) return [];
  const col = { query: gscMetrics.query, page: gscMetrics.page, country: gscMetrics.country, device: gscMetrics.device }[dims];
  const rows = await db.select({ key: col, clicks: sql<number>`sum(${gscMetrics.clicks})`, impressions: sql<number>`sum(${gscMetrics.impressions})`,
    pos: sql<number>`sum(cast(${gscMetrics.position} as double precision) * ${gscMetrics.impressions})` })
    .from(gscMetrics).where(and(eq(gscMetrics.property, p), eq(gscMetrics.dims, filter?.page ? 'query,page' : dims), gte(gscMetrics.date, r.from), lte(gscMetrics.date, r.to), filter?.page ? eq(gscMetrics.page, filter.page) : undefined))
    .groupBy(col).orderBy(desc(sql`sum(${gscMetrics.clicks})`), desc(sql`sum(${gscMetrics.impressions})`)).limit(limit);
  return rows.map((x) => ({ key: x.key, clicks: n(x.clicks), impressions: n(x.impressions), ctr: n(x.impressions) ? n(x.clicks) / n(x.impressions) : 0, position: n(x.impressions) ? n(x.pos) / n(x.impressions) : null }));
}
export const queries = (db: DB, r: Range) => grouped(db, 'query', r);
export const pages = (db: DB, r: Range) => grouped(db, 'page', r);
export const countries = (db: DB, r: Range) => grouped(db, 'country', r, 50);
export const devices = (db: DB, r: Range) => grouped(db, 'device', r, 5);

/** One page over time, and the queries it appeared for. */
export async function pageHistory(db: DB, page: string, r: Range) {
  const p = await prop(db); if (!p) return null;
  const series = await db.select({ date: gscMetrics.date, clicks: gscMetrics.clicks, impressions: gscMetrics.impressions, position: gscMetrics.position }).from(gscMetrics)
    .where(and(eq(gscMetrics.property, p), eq(gscMetrics.dims, 'page'), eq(gscMetrics.page, page), gte(gscMetrics.date, r.from), lte(gscMetrics.date, r.to))).orderBy(asc(gscMetrics.date));
  return { page, series: series.map((x) => ({ ...x, position: n(x.position) })), queries: await grouped(db, 'query', r, 100, { page }) };
}

/** Winners and losers: change in clicks between the range and the same-length period just before it. Items need at
 *  least `minImpressions` impressions in one of the two periods, so tiny numbers do not dominate. */
export async function movers(db: DB, dims: 'query' | 'page', r: Range, minImpressions = 20, top = 5) {
  const len = Math.round((Date.parse(r.to) - Date.parse(r.from)) / 86_400_000) + 1;
  const prev = { from: addDays(r.from, -len), to: addDays(r.from, -1) };
  const [cur, old] = await Promise.all([grouped(db, dims, r, 5000), grouped(db, dims, prev, 5000)]);
  const before = new Map(old.map((x) => [x.key, x]));
  const all = new Map<string, { key: string; clicks: number; prevClicks: number; impressions: number; prevImpressions: number; position: number | null; prevPosition: number | null }>();
  for (const x of cur) { const b = before.get(x.key); all.set(x.key, { key: x.key, clicks: x.clicks, prevClicks: b?.clicks ?? 0, impressions: x.impressions, prevImpressions: b?.impressions ?? 0, position: x.position, prevPosition: b?.position ?? null }); }
  for (const b of old) if (!all.has(b.key)) all.set(b.key, { key: b.key, clicks: 0, prevClicks: b.clicks, impressions: 0, prevImpressions: b.impressions, position: null, prevPosition: b.position });
  const eligible = [...all.values()].filter((x) => Math.max(x.impressions, x.prevImpressions) >= minImpressions).map((x) => ({ ...x, delta: x.clicks - x.prevClicks }));
  return {
    method: `Clicks ${r.from} – ${r.to} compared with ${prev.from} – ${prev.to}; only items with at least ${minImpressions} impressions in one period.`,
    previous: prev,
    winners: eligible.filter((x) => x.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, top),
    losers: eligible.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, top),
  };
}

// ---------------------------------------------------------------- URL Inspection (Google's indexed version)
export async function inspect(db: DB, cfg: Config, http: G.Http, actor: NonNullable<Actor>, url: string) {
  const c = await connection(db);
  if (!c?.property) throw new AppError(409, 'Connect Search Console and choose a property first.');
  const u = (() => { try { return new URL(url); } catch { return null; } })();
  const site = c.property.startsWith('sc-domain:') ? c.property.slice(10) : new URL(c.property).hostname;
  if (!u || !/^https?:$/.test(u.protocol) || !(u.hostname === site || u.hostname.endsWith(`.${site}`))) throw new AppError(422, `Only addresses of ${site} can be inspected with this property.`);
  await useQuota(db, 'urlInspection').catch((e: G.GoogleError) => { throw new AppError(429, e.message); });
  let res: G.InspectResult;
  try { res = await G.inspectUrl(http, await accessToken(db, cfg, http).catch((e) => { throw new AppError(409, e.message); }), c.property, u.toString()); }
  catch (e) { if (e instanceof AppError) throw e; const g = e as G.GoogleError; throw new AppError(g.status === 429 ? 429 : 409, `Google could not inspect this address: ${g.message}`); }
  const s = res.inspectionResult?.indexStatusResult ?? {};
  const [row] = await db.insert(urlInspections).values({ property: c.property, url: u.toString(), verdict: s.verdict ?? null, coverageState: s.coverageState ?? null, indexingState: s.indexingState ?? null,
    robotsTxtState: s.robotsTxtState ?? null, pageFetchState: s.pageFetchState ?? null, lastCrawlTime: s.lastCrawlTime ?? null, googleCanonical: s.googleCanonical ?? null, userCanonical: s.userCanonical ?? null,
    raw: res as Record<string, unknown>, createdBy: actor.id }).returning();
  await audit(db, actor, 'gsc.inspect', { type: 'google', id: P }, `URL Inspection: ${u}`);
  return row;
}
export async function inspections(db: DB, limit = 200) {
  const p = await prop(db); if (!p) return [];
  const rows = await db.select().from(urlInspections).where(eq(urlInspections.property, p)).orderBy(desc(urlInspections.createdAt)).limit(limit);
  const latest = new Map<string, typeof rows[number]>(); for (const r of rows) if (!latest.has(r.url)) latest.set(r.url, r);
  return [...latest.values()].map(({ raw, ...r }) => ({ ...r, link: (raw as G.InspectResult).inspectionResult?.inspectionResultLink ?? null }));
}

export const hasData = async (db: DB) => { const p = await prop(db); if (!p) return false; return !!(await db.select({ id: gscMetrics.id }).from(gscMetrics).where(eq(gscMetrics.property, p)).limit(1))[0]; };
