// Settings Center routes. Permissions are checked here, on the server, for every call:
//   settings.read    see the Settings Center (secrets are never included for anyone)
//   settings.update  save General (except admin fields), Branding, Contact & social
//   settings.admin   canonical domain, environment, email server, test email, diagnostics, restoring revisions
//   settings.publish publish the saved website settings (rebuilds the site)
// Email templates: read with settings.read, edit with settings.update; the Inbox composer fills them in with forms.manage.
// Domain checks run with settings.update. Security, backups, maintenance and notifications need settings.admin.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { AppError, perm, requirePerm, type Env } from '../../http.ts';
import { can } from '../../rbac.ts';
import { CATEGORIES, FIELDS } from './catalog.ts';
import * as S from './service.ts';
import * as E from './email.ts';
import * as SCH from '../seo/schema.ts';
import * as OPS from './ops.ts';
import * as DNS from './dns.ts';
import * as T from './templates.ts';
import * as N from './notify.ts';

/** History categories that only administrators may see (they describe the email server and who gets notices). */
const ADMIN_HISTORY = ['email', 'notifications'];

export function registerSettingsRoutes(api: Hono<Env>) {
  const me = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });

  api.get('/settings', perm('settings.read'), async (c) => {
    const { db, cfg, user } = c.var;
    const isAdmin = can(user!.role, 'settings.admin');
    const [site, hist, schemaRow] = await Promise.all([S.view(db), S.history(db, undefined, 1), SCH.loadSettings(db)]);
    const mail = E.view(cfg);
    const tests = isAdmin ? await E.lastTests(db, 1) : [];
    const [domain, templates, notices] = await Promise.all([DNS.last(db), T.list(db), isAdmin ? N.load(db) : null]);
    const problems = domain ? domain.groups.flatMap((g) => g.checks).filter((x) => x.ok === false).length : null;
    const unpublished = Object.values(site.categories).reduce((n, x) => n + x.unpublished.length, 0);
    const publishedAt = Object.values(site.categories).map((x) => x.publishedAt).filter(Boolean).sort().pop() ?? null;
    const buildFile = resolve(cfg.siteRoot, 'build.mjs');
    const org = (schemaRow?.published as SCH.SchemaSettings | null)?.organization ?? null;
    return c.json({
      categories: CATEGORIES, fields: FIELDS,
      permissions: { update: can(user!.role, 'settings.update'), admin: isAdmin, publish: can(user!.role, 'settings.publish') },
      summary: {
        unpublished, publishedAt,
        buildSupport: existsSync(buildFile) && readFileSync(buildFile, 'utf8').includes('site-settings.json'),
        email: mail.ready ? 'ready' : mail.enabled ? 'incomplete' : 'off',
        lastTest: tests[0] ? { at: tests[0].at, ok: tests[0].action !== 'settings.email_test_failed', actorEmail: tests[0].actorEmail, summary: tests[0].summary, source: tests[0].action === 'inbox.mail_test' ? 'inbox' : 'settings' } : null,
        lastChange: hist[0] ?? null,
      },
      // small real states for the category list (null = nothing to say)
      badges: {
        general: site.categories.general.unpublished.length ? 'unpublished' : null,
        branding: site.categories.branding.unpublished.length ? 'unpublished' : null,
        contact: site.categories.contact.unpublished.length ? 'unpublished' : null,
        email: mail.ready ? 'on' : 'off',
        domain: problems === null ? null : problems ? 'problem' : 'ok',
        templates: templates.length ? String(templates.length) : null,
        notifications: notices ? (notices.newMessages.enabled ? 'on' : 'off') : null,
      },
      site,
      // Organization identity is owned by Schema studio (reviewed); shown here, edited there.
      identity: { published: org, status: schemaRow?.status ?? null, publishedAt: schemaRow?.publishedAt ?? null },
      studio: { origin: cfg.origin, publicSiteUrl: cfg.publicSiteUrl },
      // only administrators see the email server; nobody ever sees the password
      email: isAdmin ? mail : { ready: mail.ready },
    });
  });

  api.put('/settings/:category{general|branding|contact|email}', perm('settings.update'), async (c) => {
    const cat = c.req.param('category');
    if (cat === 'email') {
      requirePerm(c, 'settings.admin');
      return c.json({ email: await E.save(c.var.db, c.var.cfg, me(c), await c.req.json()) });
    }
    if (!S.isSiteCategory(cat)) throw new AppError(404, 'Unknown settings category.');
    const r = await S.save(c.var.db, me(c), c.var.user!.role, cat, await c.req.json());
    return c.json({ ...r, site: await S.view(c.var.db) });
  });

  api.get('/settings/history', perm('settings.read'), async (c) => {
    const cat = c.req.query('category');
    if (cat && !S.isHistoryCategory(cat)) throw new AppError(404, 'Unknown settings category.');
    if (cat && ADMIN_HISTORY.includes(cat) && !can(c.var.user!.role, 'settings.admin')) throw new AppError(404, 'Unknown settings category.');
    const rows = await S.history(c.var.db, cat as S.HistoryCategory | undefined, Number(c.req.query('limit') || 50));
    return c.json(can(c.var.user!.role, 'settings.admin') ? rows : rows.filter((r) => !ADMIN_HISTORY.includes(r.category)));
  });
  api.get('/settings/history/:id', perm('settings.read'), async (c) => {
    const r = await S.revision(c.var.db, c.req.param('id'));
    if (ADMIN_HISTORY.includes(r.category) && !can(c.var.user!.role, 'settings.admin')) throw new AppError(404, 'Revision not found.');
    return c.json(r);
  });
  api.post('/settings/history/:id/restore', perm('settings.admin'), async (c) => {
    const r = await S.revision(c.var.db, c.req.param('id'));
    if (r.category === 'email') return c.json({ category: 'email', email: await E.restore(c.var.db, c.var.cfg, me(c), r.id) });
    if (r.category === 'templates') return c.json({ category: 'templates', ...(await T.save(c.var.db, me(c), r.values, r.id)) });
    if (r.category === 'notifications') return c.json({ category: 'notifications', ...(await N.save(c.var.db, c.var.cfg, me(c), r.values, r.id)) });
    return c.json(await S.restore(c.var.db, me(c), c.var.user!.role, r.id));
  });

  api.post('/settings/publish', perm('settings.publish'), async (c) => c.json(await c.var.publisher.publishSiteSettings(me(c))));

  api.post('/settings/email/test', perm('settings.admin'), async (c) => c.json(await E.sendTest(c.var.db, c.var.cfg, me(c))));
  api.post('/settings/email/diagnose', perm('settings.admin'), async (c) => c.json(await E.diagnose(c.var.cfg)));

  // ---------------------------------------------------------------- Read-only facts per category
  api.get('/settings/facts/seo', perm('settings.read'), async (c) => c.json(await OPS.seo(c.var.db, c.var.cfg)));
  api.get('/settings/facts/localization', perm('settings.read'), async (c) => c.json(await OPS.localization(c.var.db, c.var.cfg)));
  api.get('/settings/facts/media', perm('settings.read'), async (c) => c.json(await OPS.mediaFacts(c.var.db, c.var.cfg)));
  api.get('/settings/facts/performance', perm('settings.read'), async (c) => c.json(await OPS.performance(c.var.db, c.var.cfg)));
  api.get('/settings/facts/security', perm('settings.admin'), async (c) => c.json(await OPS.security(c.var.db, c.var.cfg, me(c))));
  api.post('/settings/security/sign-out-others', perm('settings.read'), async (c) => c.json(await OPS.signOutOtherSessions(c.var.db, me(c), c.var.sessionId)));
  api.get('/settings/facts/maintenance', perm('settings.admin'), async (c) => c.json(await OPS.maintenance(c.var.db)));

  // ---------------------------------------------------------------- Backups (embedded database)
  api.get('/settings/backups', perm('settings.admin'), (c) => c.json(OPS.listBackups(c.var.cfg)));
  api.post('/settings/backups', perm('settings.admin'), async (c) => c.json(await OPS.createBackup(c.var.db, c.var.cfg, me(c))));
  api.delete('/settings/backups/:name', perm('settings.admin'), async (c) => c.json(await OPS.deleteBackup(c.var.db, c.var.cfg, me(c), c.req.param('name'))));

  // ---------------------------------------------------------------- Domain & DNS (real lookups on request)
  api.get('/settings/domain', perm('settings.read'), async (c) => c.json({ last: await DNS.last(c.var.db) }));
  api.post('/settings/domain/check', perm('settings.update'), async (c) => c.json(await DNS.runGuarded(c.var.db, c.var.cfg, me(c))));

  // ---------------------------------------------------------------- Email templates
  api.get('/settings/templates', async (c) => {
    const u = c.var.user; if (!u) throw new AppError(404, 'Not found.');
    if (!can(u.role, 'settings.read') && !can(u.role, 'forms.manage')) requirePerm(c, 'settings.read');
    return c.json({ templates: await T.list(c.var.db), variables: T.VARIABLES, canEdit: can(u.role, 'settings.update') });
  });
  api.put('/settings/templates', perm('settings.update'), async (c) => c.json(await T.save(c.var.db, me(c), await c.req.json())));
  api.post('/settings/templates/preview', perm('settings.read'), async (c) => {
    const b = await c.req.json().catch(() => ({})) as { subject?: unknown; body?: unknown };
    return c.json(T.preview({ subject: String(b.subject ?? '').slice(0, 200), body: String(b.body ?? '').slice(0, 5000) }));
  });
  api.post('/inbox/messages/:id/template/:tid', perm('forms.manage'), async (c) => c.json(await T.renderFor(c.var.db, { ...me(c), name: c.var.user!.name }, c.req.param('tid'), c.req.param('id'))));

  // ---------------------------------------------------------------- Notifications
  api.get('/settings/notifications', perm('settings.admin'), async (c) => c.json(await N.view(c.var.db, c.var.cfg)));
  api.put('/settings/notifications', perm('settings.admin'), async (c) => c.json(await N.save(c.var.db, c.var.cfg, me(c), await c.req.json())));
  api.post('/settings/notifications/test', perm('settings.admin'), async (c) => c.json(await N.sendTest(c.var.db, c.var.cfg, me(c))));

  // Advanced & diagnostics: read-only facts, all read from this installation.
  api.get('/settings/diagnostics', perm('settings.admin'), async (c) => {
    const { db, cfg } = c.var;
    const pkg = JSON.parse(readFileSync(resolve(cfg.studioDir, 'package.json'), 'utf8')) as { version: string };
    const journal = JSON.parse(readFileSync(resolve(cfg.studioDir, 'drizzle/meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    let applied: number | null = null;
    try { const r = await db.execute(sql`select count(*)::int as n from drizzle.__drizzle_migrations`) as unknown as { rows: { n: number }[] }; applied = r.rows[0]?.n ?? null; } catch { applied = null; }
    return c.json({
      studioVersion: pkg.version, node: process.version, platform: `${process.platform} ${process.arch}`,
      database: cfg.databaseUrl ? 'PostgreSQL server (DATABASE_URL)' : 'Embedded PGlite (studio/.data/pg)',
      migrations: { applied, known: journal.entries.length, latest: journal.entries.at(-1)?.tag ?? null },
      encryptionKey: cfg.encryptionKey ? 'STUDIO_ENCRYPTION_KEY (environment)' : 'Random key in the data folder (set STUDIO_ENCRYPTION_KEY for production)',
      origin: cfg.origin, publicSiteUrl: cfg.publicSiteUrl, maxUploadMb: Math.round(cfg.maxUploadBytes / 1024 / 1024),
      google: cfg.googleClientId ? 'Configured' : 'Not configured',
      uptimeSeconds: Math.round(process.uptime()),
    });
  });
}
