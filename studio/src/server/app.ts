// AFCD Studio HTTP application: JSON API under /studio/api, admin SPA under /studio, previews under /studio/preview.
import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { and, asc, count, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import type { DB } from './db/client.ts';
import type { Config } from './config.ts';
import * as t from './db/schema.ts';
import { AppError, clientIp, csrfGuard, loadSession, perm, requirePerm, requireUser, securityHeaders, type Env } from './http.ts';
import { SESSION_COOKIE, createSession, deleteSession, hashPassword, recordAttempt, tooManyAttempts, validatePasswordStrength, verifyPassword } from './auth/session.ts';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES, type Role } from './rbac.ts';
import { audit } from './audit.ts';
import * as P from './modules/projects/service.ts';
import * as M from './modules/media/service.ts';
import { Publisher, type BuildRunner } from './modules/publish/service.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.xml': 'application/xml',
};

// Argon2id hash of a random value, used only to equalize response timing for unknown emails.
const dummyHash = hashPassword(randomBytes(24).toString('hex'));

export function createApp(db: DB, cfg: Config, opts: { runner?: BuildRunner } = {}) {
  const publisher = new Publisher(db, cfg, opts.runner);
  const app = new Hono<Env>();

  app.use('*', async (c, next) => { c.set('db', db); c.set('cfg', cfg); c.set('publisher', publisher); await next(); });
  app.use('*', securityHeaders);
  app.use('/studio/*', loadSession);
  app.use('/studio/api/*', csrfGuard);

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.message, details: err.details ?? null }, err.status);
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    console.error(err);
    return c.json({ error: 'Something went wrong on the server.' }, 500);
  });

  const actor = (c: { var: Env['Variables'] }) => ({ id: c.var.user!.id, email: c.var.user!.email });
  const api = new Hono<Env>();

  // ---------------------------------------------------------------- Auth
  const loginSchema = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(256) });
  api.post('/auth/login', async (c) => {
    const body = loginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!body.success) throw new AppError(422, 'Enter your email and password.');
    const { email, password } = body.data;
    const ip = clientIp(c);
    if (await tooManyAttempts(db, email, ip)) throw new HTTPException(429, { message: 'Too many attempts. Try again in 15 minutes.' });
    const [u] = await db.select().from(t.users).where(eq(t.users.email, email));
    // Always run a hash verification so response time does not reveal whether the account exists.
    const ok = u ? await verifyPassword(u.passwordHash, password) : (await verifyPassword(await dummyHash, password), false);
    await recordAttempt(db, email, ip, !!(ok && u?.active));
    if (!u || !ok || !u.active) {
      await audit(db, null, 'auth.login_failed', { type: 'user', id: u?.id }, email, undefined, ip);
      throw new HTTPException(401, { message: 'Email or password is incorrect.' });
    }
    const s = await createSession(db, u.id, ip, c.req.header('user-agent') ?? null);
    setCookie(c, SESSION_COOKIE, s.token, { httpOnly: true, sameSite: 'Strict', secure: cfg.secureCookies, path: '/studio', maxAge: s.maxAge });
    await db.update(t.users).set({ lastLoginAt: new Date() }).where(eq(t.users.id, u.id));
    await audit(db, { id: u.id, email: u.email }, 'auth.login', { type: 'user', id: u.id }, '', undefined, ip);
    return c.json({ ok: true });
  });

  api.post('/auth/logout', async (c) => {
    if (c.var.sessionId) { await deleteSession(db, c.var.sessionId); await audit(db, c.var.user ? actor(c) : null, 'auth.logout'); }
    deleteCookie(c, SESSION_COOKIE, { path: '/studio' });
    return c.json({ ok: true });
  });

  api.get('/me', (c) => {
    const u = requireUser(c);
    return c.json({ user: { ...u, roleLabel: ROLE_LABELS[u.role] }, permissions: ROLE_PERMISSIONS[u.role], csrf: c.var.csrf, siteUrl: cfg.publicSiteUrl });
  });

  // ---------------------------------------------------------------- Dashboard (all counts from the database)
  api.get('/dashboard', perm('dashboard.read'), async (c) => {
    const counts = Object.fromEntries((await P.statusCounts(db)).map((r) => [r.status, r.n]));
    const [{ live }] = await db.select({ live: count() }).from(t.projects).where(sql`${t.projects.publishedRevisionId} is not null`);
    const [{ pendingEdits }] = await db.select({ pendingEdits: count() }).from(t.projects).where(and(sql`${t.projects.publishedRevisionId} is not null`, sql`${t.projects.status} <> 'published'`));
    const [{ mediaTotal }] = await db.select({ mediaTotal: count() }).from(t.media);
    const [{ mediaNeedsRights }] = await db.select({ mediaNeedsRights: count() }).from(t.media).where(sql`not ${t.media.rightsConfirmed} or ${t.media.alt} = ''`);
    const recent = await db.select({ id: t.projects.id, name: t.projects.name, status: t.projects.status, updatedAt: t.projects.updatedAt, live: sql<boolean>`${t.projects.publishedRevisionId} is not null` })
      .from(t.projects).orderBy(desc(t.projects.updatedAt)).limit(6);
    const queue = await db.select({ id: t.projects.id, name: t.projects.name, status: t.projects.status, updatedAt: t.projects.updatedAt })
      .from(t.projects).where(inArray(t.projects.status, ['in_review', 'approved'])).orderBy(asc(t.projects.updatedAt));
    const jobs = await publisher.recentJobs(5);
    const [{ failed24h }] = await db.select({ failed24h: count() }).from(t.publishJobs).where(and(eq(t.publishJobs.status, 'failed'), gte(t.publishJobs.createdAt, new Date(Date.now() - 864e5))));
    return c.json({ counts, live, pendingEdits, mediaTotal, mediaNeedsRights, recent, queue, jobs: jobs.map(({ log: _l, ...j }) => j), failed24h });
  });

  // ---------------------------------------------------------------- Strategy references
  api.get('/pillars', perm('project.read'), async (c) => c.json(await db.select().from(t.pillars).orderBy(asc(t.pillars.sort))));
  api.get('/objectives', perm('project.read'), async (c) => {
    const objs = await db.select().from(t.objectives).orderBy(asc(t.objectives.sort));
    const links = await db.select({ o: t.objectivePillars.objectiveId, key: t.pillars.key }).from(t.objectivePillars).innerJoin(t.pillars, eq(t.pillars.id, t.objectivePillars.pillarId));
    return c.json(objs.map((o) => ({ ...o, pillarKeys: links.filter((l) => l.o === o.id).map((l) => l.key) })));
  });

  // ---------------------------------------------------------------- Projects
  api.get('/projects', perm('project.read'), async (c) => c.json(await P.listProjects(db)));
  api.get('/projects/:id', perm('project.read'), async (c) => {
    const p = await P.loadProject(db, c.req.param('id'));
    return c.json({ ...p, hero: p.hero && withUrl(p.hero), gallery: p.gallery.map(withUrl), problems: P.publishProblems(p), history: await P.projectHistory(db, p.id) });
  });
  api.post('/projects', perm('project.create'), async (c) => c.json(await P.createProject(db, actor(c), await c.req.json()), 201));
  api.put('/projects/:id', async (c) => {
    const u = requireUser(c);
    if (!(ROLE_PERMISSIONS[u.role].includes('project.update') || ROLE_PERMISSIONS[u.role].includes('project.seo'))) requirePerm(c, 'project.update');
    return c.json(await P.updateProject(db, actor(c), u.role, c.req.param('id'), await c.req.json()));
  });

  const TRANSITION_PERM = {
    submit: 'project.update', withdraw: 'project.update', request_changes: 'project.review', approve: 'project.approve',
    archive: 'project.archive', restore: 'project.archive',
  } as const;
  api.post('/projects/:id/transition', async (c) => {
    const body = z.object({ action: z.enum(['submit', 'withdraw', 'request_changes', 'approve', 'archive', 'restore']), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, TRANSITION_PERM[body.data.action]);
    return c.json(await P.transition(db, actor(c), u.role, c.req.param('id'), body.data.action, body.data.comment));
  });
  api.post('/projects/:id/publish', perm('project.publish'), async (c) => c.json(await publisher.publish(actor(c), c.req.param('id'))));
  api.post('/projects/:id/unpublish', perm('project.publish'), async (c) => c.json(await publisher.unpublish(actor(c), c.req.param('id'))));
  api.post('/projects/:id/preview', perm('project.read'), async (c) => {
    const r = await publisher.preview(c.req.param('id'));
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/projects/:id/revisions/:rev/restore', perm('project.update'), async (c) => {
    await P.restoreRevision(db, actor(c), c.req.param('id'), c.req.param('rev'));
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- Media
  api.get('/media', perm('media.read'), async (c) => c.json(await M.listMedia(db, c.req.query('q')?.slice(0, 80), 60, Number(c.req.query('offset') || 0))));
  api.post('/media', perm('media.upload'), bodyLimit({ maxSize: cfg.maxUploadBytes + 64 * 1024, onError: () => { throw new AppError(422, 'The file is too large.'); } }), async (c) => {
    const form = await c.req.parseBody();
    const f = form.file;
    if (!(f instanceof File)) throw new AppError(422, 'Choose an image to upload.');
    const row = await M.ingestUpload(db, cfg, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, c.var.user!.id);
    await audit(db, actor(c), 'media.upload', { type: 'media', id: row.id }, row.originalName);
    return c.json(withUrl(row), 201);
  });
  api.patch('/media/:id', perm('media.update'), async (c) => {
    const body = M.mediaUpdateSchema.safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Some fields need attention.', body.error.issues);
    const [row] = await db.update(t.media).set({ ...body.data, updatedAt: new Date() }).where(eq(t.media.id, c.req.param('id'))).returning();
    if (!row) throw new AppError(404, 'Media not found.');
    await audit(db, actor(c), 'media.update', { type: 'media', id: row.id }, row.originalName, { fields: Object.keys(body.data) });
    return c.json(withUrl(row));
  });
  api.delete('/media/:id', perm('media.delete'), async (c) => {
    const m = await M.deleteMedia(db, cfg, c.req.param('id'));
    await audit(db, actor(c), 'media.delete', { type: 'media', id: m.id }, m.originalName);
    return c.json({ ok: true });
  });

  // ---------------------------------------------------------------- Publishing jobs, audit, users
  api.get('/publish-jobs', perm('dashboard.read'), async (c) => c.json(await publisher.recentJobs(30)));
  api.get('/audit', perm('audit.read'), async (c) => {
    const limit = Math.min(200, Number(c.req.query('limit') || 100));
    return c.json(await db.select().from(t.auditLog).orderBy(desc(t.auditLog.at)).limit(limit));
  });
  api.get('/users', perm('users.read'), async (c) => {
    const rows = await db.select({ id: t.users.id, email: t.users.email, name: t.users.name, role: t.users.role, active: t.users.active, lastLoginAt: t.users.lastLoginAt }).from(t.users).orderBy(asc(t.users.name));
    return c.json({ users: rows, roles: ROLES.map((r) => ({ id: r, label: ROLE_LABELS[r], permissions: ROLE_PERMISSIONS[r] })) });
  });
  api.post('/users', perm('users.manage'), async (c) => {
    const body = z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(2).max(120), role: z.enum(ROLES), password: z.string() }).safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Some fields need attention.', body.error.issues);
    const weak = validatePasswordStrength(body.data.password);
    if (weak) throw new AppError(422, weak);
    const [u] = await db.insert(t.users).values({ ...body.data, passwordHash: await hashPassword(body.data.password) }).onConflictDoNothing().returning({ id: t.users.id });
    if (!u) throw new AppError(409, 'A user with this email already exists.');
    await audit(db, actor(c), 'users.create', { type: 'user', id: u.id }, `${body.data.email} as ${body.data.role}`);
    return c.json(u, 201);
  });
  api.patch('/users/:id', perm('users.manage'), async (c) => {
    const body = z.object({ role: z.enum(ROLES).optional(), active: z.boolean().optional() }).strict().safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Some fields need attention.');
    if (c.req.param('id') === c.var.user!.id) throw new AppError(409, 'You cannot change your own role or access.');
    const [u] = await db.update(t.users).set({ ...body.data, updatedAt: new Date() }).where(eq(t.users.id, c.req.param('id'))).returning({ id: t.users.id, email: t.users.email });
    if (!u) throw new AppError(404, 'User not found.');
    if (body.data.active === false) await db.delete(t.sessions).where(eq(t.sessions.userId, u.id));
    await audit(db, actor(c), 'users.update', { type: 'user', id: u.id }, u.email, body.data);
    return c.json({ ok: true });
  });

  app.route('/studio/api', api);
  app.all('/studio/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  // ---------------------------------------------------------------- Files: media (signed-in only), previews, admin SPA
  app.get('/studio/media-file/:name', (c) => {
    requireUser(c);
    const name = c.req.param('name');
    if (!/^[0-9a-f]{24}-\d+\.webp$/.test(name)) return c.notFound();
    return sendFile(c, resolve(cfg.mediaDir, name), { private: true });
  });
  app.get('/studio/preview/:token/*', (c) => {
    requireUser(c);
    const token = c.req.param('token');
    const rest = c.req.path.split(`/studio/preview/${token}/`)[1] ?? '';
    c.header('X-Robots-Tag', 'noindex, nofollow');
    if (rest.startsWith('assets/media/')) {
      const name = rest.slice('assets/media/'.length);
      if (!/^[0-9a-f]{24}-\d+\.webp$/.test(name)) return c.notFound();
      return sendFile(c, resolve(cfg.mediaDir, name), { private: true });
    }
    if (rest.startsWith('assets/')) {
      const p = resolve(cfg.siteRoot, rest);
      if (!p.startsWith(resolve(cfg.siteRoot, 'assets') + '/')) return c.notFound();
      return sendFile(c, p, { private: true });
    }
    const p = publisher.previewPath(token, rest);
    if (!p) return c.html('<p style="font:15px system-ui;padding:24px">This preview has expired. Open a new preview from AFCD Studio.</p>', 404);
    // The preview is the real public template; it only needs its own scripts and styles.
    c.header('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; frame-ancestors 'self'");
    return sendFile(c, p, { private: true });
  });

  const adminDir = resolve(cfg.studioDir, 'dist/admin');
  app.get('/studio/assets/*', (c) => {
    const p = resolve(adminDir, c.req.path.replace('/studio/', ''));
    if (!p.startsWith(adminDir + '/')) return c.notFound();
    return sendFile(c, p, { immutable: true });
  });
  app.get('/studio', (c) => c.redirect('/studio/'));
  app.get('/studio/*', (c) => {
    const index = resolve(adminDir, 'index.html');
    if (!existsSync(index)) return c.text('Admin app not built. Run: npm run build:admin', 503);
    c.header('Cache-Control', 'no-store');
    return c.html(readFileSync(index, 'utf8'));
  });
  app.get('/', (c) => c.redirect('/studio/'));

  return { app, publisher };
}

function withUrl(m: M.MediaRow) { return { ...m, url: `/studio/media-file/${m.storageKey}-480.webp`, large: `/studio/media-file/${M.publicRef(m).src.split('/').pop()}` }; }

function sendFile(c: { header: (k: string, v: string) => void; body: (d: Uint8Array, s?: number) => Response; notFound: () => Response | Promise<Response> }, p: string, o: { private?: boolean; immutable?: boolean } = {}) {
  if (!existsSync(p)) return c.notFound();
  c.header('Content-Type', MIME[extname(p)] ?? 'application/octet-stream');
  c.header('Cache-Control', o.immutable ? 'public, max-age=31536000, immutable' : o.private ? 'private, no-store' : 'no-cache');
  return c.body(new Uint8Array(readFileSync(p)));
}

