// Settings Center: read-only facts for SEO & analytics, Localization, Media, Security, Performance and Maintenance, plus
// database backups. Everything here is read from the database, the built site or the data folder at the time of the
// request; nothing is estimated. Where Studio has no source for something, the response says so instead of a number.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, count, desc, eq, gte, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { loginAttempts, media, publishJobs, redirects, seoIssues, seoJobs, sessions, users } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { ROLES, ROLE_LABELS, ROLE_PERMISSIONS } from '../../rbac.ts';
import * as TR from '../translations/service.ts';
import * as GSC from '../google/gsc.ts';
import { loadRows } from './service.ts';
import { placeholderAlt } from '../media/alt.ts';

type Me = NonNullable<Actor>;
const DAY = 86400_000;
const n = (r: { n: number }[]) => Number(r[0]?.n ?? 0);

// ---------------------------------------------------------------- SEO & analytics (SEO Pro is the owner; this is a summary)
export async function seo(db: DB, cfg: Config) {
  const gsc = await GSC.status(db, cfg);
  const rows = await loadRows(db);
  const env = { saved: rows.general.draft.environment, published: rows.general.published?.environment ?? null };
  const robotsFile = resolve(cfg.siteRoot, 'robots.txt'), sitemapFile = resolve(cfg.siteRoot, 'sitemap.xml');
  const robots = existsSync(robotsFile) ? readFileSync(robotsFile, 'utf8') : null;
  const sitemapUrls = existsSync(sitemapFile) ? (readFileSync(sitemapFile, 'utf8').match(/<loc>/g) ?? []).length : null;
  const [openIssues, activeRedirects] = await Promise.all([
    db.select({ n: count() }).from(seoIssues).where(eq(seoIssues.status, 'open')).then(n),
    db.select({ n: count() }).from(redirects).where(eq(redirects.status, 'active')).then(n),
  ]);
  return {
    searchConsole: { configured: gsc.setup.configured, status: gsc.connection?.status ?? null, property: gsc.connection?.property ?? null, lastSyncAt: gsc.connection?.lastSyncAt ?? null, lastError: gsc.connection?.lastError ?? null },
    // what the built site says right now, read from robots.txt (not from settings)
    indexing: robots === null ? 'unknown' : /Disallow:\s*\/\s*$/m.test(robots) ? 'blocked' : 'open',
    environment: env, sitemapUrls, openIssues, activeRedirects,
    analytics: { connected: false, note: 'Google Analytics 4 is not connected. Adding its tracking tag to the site also needs a cookie consent banner, which the site does not have.' },
  };
}

// ---------------------------------------------------------------- Localization (Translations is the owner)
export async function localization(db: DB, cfg: Config) {
  const langs = await TR.overview(db, cfg);
  return { languages: langs.map((l) => ({ lang: l.lang, name: l.name, native: l.native, dir: l.dir, total: l.total, translated: l.translated, status: l.status, live: l.publishedLive })) };
}

// ---------------------------------------------------------------- Media (Media library is the owner)
export async function mediaFacts(db: DB, cfg: Config) {
  const soon = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10), today = new Date().toISOString().slice(0, 10);
  const [all, noAlt, noRights, expiring, expired, bytes] = await Promise.all([
    db.select({ n: count() }).from(media).then(n),
    db.select({ alt: media.alt, originalName: media.originalName }).from(media).then((r) => r.filter((m) => !m.alt.trim() || placeholderAlt(m.alt, m.originalName)).length),
    db.select({ n: count() }).from(media).where(eq(media.rightsConfirmed, false)).then(n),
    db.select({ n: count() }).from(media).where(and(isNotNull(media.rightsExpiresOn), gte(media.rightsExpiresOn, today), lte(media.rightsExpiresOn, soon))).then(n),
    db.select({ n: count() }).from(media).where(and(isNotNull(media.rightsExpiresOn), sql`${media.rightsExpiresOn} < ${today}`)).then(n),
    db.select({ n: sql<number>`coalesce(sum(${media.bytes}), 0)::bigint` }).from(media).then(n),
  ]);
  return { total: all, missingAlt: noAlt, rightsUnconfirmed: noRights, rightsExpiringIn30Days: expiring, rightsExpired: expired, originalBytes: bytes, maxUploadMb: Math.round(cfg.maxUploadBytes / 1024 / 1024) };
}

// ---------------------------------------------------------------- Security & access
export async function security(db: DB, cfg: Config, me: Me) {
  const [byRole, inactive, localOnly, neverIn, failed24, failed7, activeSessions] = await Promise.all([
    db.select({ role: users.role, n: count() }).from(users).where(eq(users.active, true)).groupBy(users.role),
    db.select({ n: count() }).from(users).where(eq(users.active, false)).then(n),
    db.select({ n: count() }).from(users).where(and(eq(users.active, true), eq(users.localOnlyPassword, true))).then(n),
    db.select({ n: count() }).from(users).where(and(eq(users.active, true), sql`${users.lastLoginAt} is null`)).then(n),
    db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.success, false), gte(loginAttempts.createdAt, new Date(Date.now() - DAY)))).then(n),
    db.select({ n: count() }).from(loginAttempts).where(and(eq(loginAttempts.success, false), gte(loginAttempts.createdAt, new Date(Date.now() - 7 * DAY)))).then(n),
    db.select({ n: count() }).from(sessions).where(gte(sessions.expiresAt, new Date())).then(n),
  ]);
  const [mine] = await db.select({ n: count() }).from(sessions).where(and(eq(sessions.userId, me.id), gte(sessions.expiresAt, new Date())));
  return {
    roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r], users: Number(byRole.find((x) => x.role === r)?.n ?? 0), permissions: ROLE_PERMISSIONS[r].length })),
    inactiveUsers: inactive, localOnlyPasswords: localOnly, neverSignedIn: neverIn,
    failedSignIns: { last24h: failed24, last7d: failed7 }, activeSessions, mySessions: Number(mine?.n ?? 0),
    transport: { origin: cfg.origin, https: cfg.origin.startsWith('https://'), secureCookies: cfg.secureCookies },
    encryptionKey: cfg.encryptionKey ? 'env' : 'data-folder',
    fixed: 'Set in code, not configurable here: passwords of at least 12 characters; sign-in blocked for 15 minutes after 5 failed attempts for one email (or 25 from one address); the roles and their permissions.',
  };
}
/** Signs out every other session of the current user (e.g. after using a shared computer). */
export async function signOutOtherSessions(db: DB, me: Me, currentSessionId: string | null) {
  const where = currentSessionId ? and(eq(sessions.userId, me.id), ne(sessions.id, currentSessionId)) : eq(sessions.userId, me.id);
  const gone = await db.delete(sessions).where(where).returning({ id: sessions.id });
  await audit(db, me, 'settings.sessions_revoked', { type: 'user', id: me.id }, `Signed out ${gone.length} other session${gone.length === 1 ? '' : 's'}`);
  return { signedOut: gone.length };
}

// ---------------------------------------------------------------- Performance (the built site as it is on disk)
function sizeOf(p: string): { bytes: number; files: number } {
  if (!existsSync(p)) return { bytes: 0, files: 0 };
  const st = statSync(p);
  if (!st.isDirectory()) return { bytes: st.size, files: 1 };
  let bytes = 0, files = 0;
  for (const e of readdirSync(p)) { const s = sizeOf(join(p, e)); bytes += s.bytes; files += s.files; }
  return { bytes, files };
}
export async function performance(db: DB, cfg: Config) {
  const root = cfg.siteRoot;
  const pages = readdirSync(root).filter((f) => f.endsWith('.html')).map((f) => ({ file: f, bytes: statSync(join(root, f)).size }));
  const langPages = ['fr', 'ar'].map((l) => ({ lang: l, ...sizeOf(join(root, l)) }));
  const file = (p: string) => (existsSync(join(root, p)) ? statSync(join(root, p)).size : null);
  const jobs = await db.select({ kind: publishJobs.kind, createdAt: publishJobs.createdAt, finishedAt: publishJobs.finishedAt })
    .from(publishJobs).where(and(eq(publishJobs.status, 'succeeded'), isNotNull(publishJobs.finishedAt))).orderBy(desc(publishJobs.createdAt)).limit(10);
  const durations = jobs.map((j) => j.finishedAt!.getTime() - j.createdAt.getTime());
  return {
    pages: { count: pages.length, bytes: pages.reduce((a, p) => a + p.bytes, 0), largest: [...pages].sort((a, b) => b.bytes - a.bytes).slice(0, 5) },
    languages: langPages,
    assets: { css: file('assets/styles.css'), js: file('assets/main.js'), media: sizeOf(join(root, 'assets/media')), images: sizeOf(join(root, 'assets/img')) },
    builds: { measured: durations.length, medianMs: durations.length ? [...durations].sort((a, b) => a - b)[Math.floor(durations.length / 2)] : null, lastAt: jobs[0]?.finishedAt ?? null },
    note: 'Sizes are files on disk before compression. Studio cannot measure real page speed for visitors.',
  };
}

// ---------------------------------------------------------------- Maintenance (jobs Studio runs)
export async function maintenance(db: DB) {
  const week = new Date(Date.now() - 7 * DAY);
  const [recent, failed7, seoQueue] = await Promise.all([
    db.select({ id: publishJobs.id, kind: publishJobs.kind, status: publishJobs.status, error: publishJobs.error, createdAt: publishJobs.createdAt, finishedAt: publishJobs.finishedAt }).from(publishJobs).orderBy(desc(publishJobs.createdAt)).limit(8),
    db.select({ n: count() }).from(publishJobs).where(and(eq(publishJobs.status, 'failed'), gte(publishJobs.createdAt, week))).then(n),
    db.select({ status: seoJobs.status, n: count() }).from(seoJobs).where(gte(seoJobs.createdAt, week)).groupBy(seoJobs.status),
  ]);
  return {
    recent, failedLast7Days: failed7,
    seoJobs: Object.fromEntries(seoQueue.map((r) => [r.status, Number(r.n)])),
    scheduler: 'Every minute Studio publishes scheduled stories; every 15 minutes it rebuilds when an event or opportunity has passed and deletes form messages past their retention.',
    maintenanceMode: 'The public site is static: there is no maintenance mode. To take a page down, unpublish it.',
  };
}

// ---------------------------------------------------------------- Backups (embedded database only)
const BACKUP = /^studio-db-(\d{8}-\d{6})\.tar\.gz$/;
const backupDir = (cfg: Config) => resolve(cfg.dataDir, 'backups');
export function listBackups(cfg: Config) {
  const dir = backupDir(cfg);
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => BACKUP.test(f)).map((f) => ({ name: f, bytes: statSync(join(dir, f)).size, createdAt: statSync(join(dir, f)).mtime, kind: 'studio' as const })) : [];
  // copies of the database folder made by hand before migrations (studio/.data/pg-before-…)
  const manual = existsSync(cfg.dataDir) ? readdirSync(cfg.dataDir).filter((f) => /^pg-before-[\w-]+$/.test(f)).map((f) => ({ name: f, bytes: sizeOf(join(cfg.dataDir, f)).bytes, createdAt: statSync(join(cfg.dataDir, f)).mtime, kind: 'manual' as const })) : [];
  return {
    supported: !cfg.databaseUrl,
    backups: [...files, ...manual].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    folder: 'studio/.data/backups',
    covers: 'The database only (content, users, settings, history). Uploaded images live in studio/.data/media and the SMTP password file in studio/.data: copy those folders as well.',
    restore: 'To restore: stop Studio, move studio/.data/pg aside, create an empty studio/.data/pg and unpack the archive into it (tar -xzf <file> -C studio/.data/pg), then start Studio.',
  };
}
export async function createBackup(db: DB, cfg: Config, me: Me) {
  if (cfg.databaseUrl) throw new AppError(409, 'Studio uses a PostgreSQL server: back it up with pg_dump on that server.');
  const client = (db as unknown as { $client?: { dumpDataDir?: (c?: 'gzip' | 'none' | 'auto') => Promise<Blob> } }).$client;
  if (!client?.dumpDataDir) throw new AppError(409, 'This database cannot be backed up from Studio.');
  const recent = listBackups(cfg).backups.find((b) => b.kind === 'studio' && Date.now() - b.createdAt.getTime() < 60_000);
  if (recent) throw new AppError(429, 'A backup was made less than a minute ago.');
  const blob = await client.dumpDataDir('gzip');
  const d = new Date(); const p = (x: number) => String(x).padStart(2, '0');
  const name = `studio-db-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.tar.gz`;
  mkdirSync(backupDir(cfg), { recursive: true });
  const buf = Buffer.from(await blob.arrayBuffer());
  writeFileSync(join(backupDir(cfg), name), buf, { mode: 0o600 });
  await audit(db, me, 'settings.backup_created', { type: 'backup', id: name }, `Database backup ${name} (${Math.round(buf.length / 1024)} KB)`);
  return { name, bytes: buf.length };
}
export async function deleteBackup(db: DB, cfg: Config, me: Me, name: string) {
  if (!BACKUP.test(name)) throw new AppError(404, 'Backup not found. Only backups made by Studio can be deleted here.');
  const f = join(backupDir(cfg), name);
  if (!existsSync(f)) throw new AppError(404, 'Backup not found.');
  rmSync(f);
  await audit(db, me, 'settings.backup_deleted', { type: 'backup', id: name }, `Deleted database backup ${name}`);
  return { ok: true };
}
