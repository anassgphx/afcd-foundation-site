// AFCD Studio HTTP application: JSON API under /studio/api, admin SPA under /studio, previews under /studio/preview.
import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit } from 'hono/body-limit';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
import * as G from './modules/pages/service.ts';
import * as N from './modules/news/service.ts';
import * as PT from './modules/partners/service.ts';
import * as EV from './modules/events/service.ts';
import * as OP from './modules/opportunities/service.ts';
import * as FM from './modules/forms/service.ts';
import { importPartners } from './modules/partners/import.ts';
import { blockCatalog } from './modules/pages/blocks.ts';
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

  // ---------------------------------------------------------------- Public form intake (the website posts here; no cookies, no session)
  const formOrigins = new Set([new URL(cfg.publicSiteUrl).origin, ...(process.env.FORMS_ALLOWED_ORIGINS ?? '').split(',').map((x) => x.trim()).filter(Boolean)]);
  const cors = (c: { req: { header: (n: string) => string | undefined }; header: (n: string, v: string) => void }) => {
    const o = c.req.header('origin');
    if (o && formOrigins.has(o)) { c.header('Access-Control-Allow-Origin', o); c.header('Vary', 'Origin'); }
    return !o || formOrigins.has(o);
  };
  app.options('/forms/v1/:key', (c) => {
    if (!cors(c)) return c.body(null, 403);
    c.header('Access-Control-Allow-Methods', 'POST'); c.header('Access-Control-Allow-Headers', 'Content-Type'); c.header('Access-Control-Max-Age', '600');
    return c.body(null, 204);
  });
  app.post('/forms/v1/:key', bodyLimit({ maxSize: 16 * 1024, onError: (c) => c.json({ error: 'The message is too long.' }, 413) }), async (c) => {
    if (!cors(c)) return c.json({ error: 'This website is not allowed to send forms here.' }, 403);
    c.header('Cache-Control', 'no-store');
    const key = c.req.param('key');
    if (!FM.isFormKey(key)) return c.json({ error: 'Unknown form.' }, 404);
    if (!(c.req.header('content-type') ?? '').includes('application/json')) return c.json({ error: 'Send JSON.' }, 415);
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== 'object') return c.json({ error: 'Send JSON.' }, 400);
    return c.json(await FM.receive(db, cfg, key, body, clientIp(c)));
  });
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

  // Public, non-sensitive settings for the sign-in screen.
  api.get('/public-config', (c) => c.json({ siteUrl: cfg.publicSiteUrl }));

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
    const pageRows = await db.select({ status: t.pages.status, live: sql<boolean>`${t.pages.publishedRevisionId} is not null` }).from(t.pages);
    const pagesInfo = { total: pageRows.length, live: pageRows.filter((r) => r.live).length, review: pageRows.filter((r) => r.status === 'in_review' || r.status === 'approved').length };
    const newsRows = await db.select({ status: t.articles.status, scheduledAt: t.articles.scheduledAt, title: t.articles.title, id: t.articles.id, live: sql<boolean>`${t.articles.publishedRevisionId} is not null` }).from(t.articles);
    const news = { live: newsRows.filter((r) => r.live).length, review: newsRows.filter((r) => r.status === 'in_review').length,
      scheduled: newsRows.filter((r) => r.status === 'scheduled').map((r) => ({ id: r.id, title: r.title, at: r.scheduledAt })) };
    const ptRows = await db.select({ status: t.partners.status, live: sql<boolean>`${t.partners.publishedRevisionId} is not null` }).from(t.partners);
    const partnersInfo = { total: ptRows.length, live: ptRows.filter((r) => r.live).length, review: ptRows.filter((r) => r.status === 'in_review' || r.status === 'approved').length };
    return c.json({ counts, live, pendingEdits, mediaTotal, mediaNeedsRights, recent, queue, jobs: jobs.map(({ log: _l, ...j }) => j), failed24h, pages: pagesInfo, news, partners: partnersInfo });
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


  // ---------------------------------------------------------------- Pages (visual builder)
  api.get('/pages', perm('page.read'), async (c) => c.json(await G.listPages(db)));
  api.get('/pages/catalog', perm('page.read'), (c) => c.json({
    blocks: blockCatalog(),
    templates: Object.entries(G.TEMPLATES).map(([id, t]) => ({ id, label: t.label, description: t.description })),
    links: readdirSync(cfg.siteRoot).filter((f) => /^[a-z0-9-]+\.html$/.test(f) && f !== '404.html').sort(),
  }));
  api.post('/pages', perm('page.create'), async (c) => c.json(await G.createPage(db, cfg, actor(c), await c.req.json()), 201));
  api.get('/pages/:id', perm('page.read'), async (c) => {
    const [p] = await db.select().from(t.pages).where(eq(t.pages.id, c.req.param('id')));
    if (!p) throw new AppError(404, 'Page not found.');
    return c.json({ ...p, problems: await G.pageProblems(db, p), history: await G.pageHistory(db, p.id) });
  });
  api.put('/pages/:id', perm('page.update'), async (c) => c.json(await G.savePage(db, cfg, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/pages/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !G.pageTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, G.pageTransitionPerm(body.data.action)!);
    return c.json(await G.transitionPage(db, actor(c), u.role, c.req.param('id'), body.data.action, body.data.comment));
  });
  api.post('/pages/:id/publish', perm('page.publish'), async (c) => c.json(await publisher.publishPage(actor(c), c.req.param('id'))));
  api.post('/pages/:id/unpublish', perm('page.publish'), async (c) => c.json(await publisher.unpublishPage(actor(c), c.req.param('id'))));
  api.post('/pages/:id/preview', perm('page.read'), async (c) => { const r = await publisher.previewPage(c.req.param('id')); return c.json({ url: `/studio/preview/${r.token}/${r.file}` }); });
  api.post('/pages/:id/revisions/:rev/restore', perm('page.update'), async (c) => { await G.restorePageRevision(db, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });
  api.post('/pages/canvas', perm('page.read'), bodyLimit({ maxSize: 512 * 1024, onError: () => { throw new AppError(422, 'The page is too large.'); } }), async (c) => {
    const body = z.object({ title: z.string().max(200), description: z.string().max(400).default(''), navSection: z.string().max(20).default('none'), doc: z.unknown() }).safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Invalid canvas request.');
    const html = await publisher.canvas({ slug: 'canvas', noindex: true, ...body.data, doc: body.data.doc as never });
    return c.json({ html });
  });


  // ---------------------------------------------------------------- News & Stories
  api.get('/news', perm('news.read'), async (c) => c.json(await N.listArticles(db)));
  api.post('/news', perm('news.create'), async (c) => c.json(await N.createArticle(db, actor(c), await c.req.json()), 201));
  api.get('/news/:id', perm('news.read'), async (c) => {
    const a = await N.loadArticle(db, c.req.param('id'));
    const ids = [a.heroMediaId, ...a.galleryMediaIds].filter(Boolean) as string[];
    const mediaRows = ids.length ? await db.select().from(t.media).where(inArray(t.media.id, ids)) : [];
    return c.json({ ...a, media: mediaRows.map(withUrl), problems: await N.articleProblems(db, a), history: await N.articleHistory(db, a.id) });
  });
  api.put('/news/:id', perm('news.update'), async (c) => c.json(await N.updateArticle(db, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/news/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default(''), at: z.string().max(40).optional() }).safeParse(await c.req.json());
    if (!body.success || !N.articleTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, N.articleTransitionPerm(body.data.action)!);
    return c.json(await N.transitionArticle(db, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment, at: body.data.at }));
  });
  api.post('/news/:id/publish', perm('news.publish'), async (c) => c.json(await publisher.publishArticle(actor(c), c.req.param('id'))));
  api.post('/news/:id/unpublish', perm('news.publish'), async (c) => c.json(await publisher.unpublishArticle(actor(c), c.req.param('id'))));
  api.post('/news/:id/preview', perm('news.read'), async (c) => { const r = await publisher.previewArticle(c.req.param('id')); return c.json({ url: `/studio/preview/${r.token}/${r.file}` }); });
  api.post('/news/:id/revisions/:rev/restore', perm('news.update'), async (c) => { await N.restoreArticleRevision(db, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });

  // ---------------------------------------------------------------- Partners
  api.get('/partners', perm('partner.read'), async (c) => c.json(await PT.listPartners(db)));
  api.post('/partners', perm('partner.create'), async (c) => c.json(await PT.createPartner(db, actor(c), await c.req.json()), 201));
  api.post('/partners/import', perm('partner.publish'), async (c) => c.json(await importPartners(db, cfg, actor(c))));
  api.get('/partners/:id', perm('partner.read'), async (c) => {
    const p = await PT.loadPartner(db, c.req.param('id'));
    const mediaRows = p.logoMediaId ? await db.select().from(t.media).where(eq(t.media.id, p.logoMediaId)) : [];
    return c.json({ ...p, media: mediaRows.map(withUrl), problems: await PT.partnerProblems(db, p), history: await PT.partnerHistory(db, p.id) });
  });
  api.put('/partners/:id', perm('partner.update'), async (c) => c.json(await PT.updatePartner(db, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/partners/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !PT.partnerTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, PT.partnerTransitionPerm(body.data.action)!);
    return c.json(await PT.transitionPartner(db, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/partners/:id/publish', perm('partner.publish'), async (c) => c.json(await publisher.publishPartner(actor(c), c.req.param('id'))));
  api.post('/partners/:id/unpublish', perm('partner.publish'), async (c) => c.json(await publisher.unpublishPartner(actor(c), c.req.param('id'))));
  api.post('/partners/:id/preview', perm('partner.read'), async (c) => {
    const r = await publisher.previewPartner(c.req.param('id'), PT.toPartnerSnapshot(await PT.loadPartner(db, c.req.param('id'))));
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/partners/:id/revisions/:rev/restore', perm('partner.update'), async (c) => { await PT.restorePartnerRevision(db, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });

  // ---------------------------------------------------------------- Events
  api.get('/events', perm('event.read'), async (c) => c.json(await EV.listEvents(db)));
  api.post('/events', perm('event.create'), async (c) => c.json(await EV.createEvent(db, actor(c), await c.req.json()), 201));
  api.get('/events/:id', perm('event.read'), async (c) => {
    const e = await EV.loadEvent(db, c.req.param('id'));
    const mediaRows = e.posterMediaId ? await db.select().from(t.media).where(eq(t.media.id, e.posterMediaId)) : [];
    return c.json({ ...e, media: mediaRows.map(withUrl), problems: await EV.eventProblems(db, e), history: await EV.eventHistory(db, e.id), kinds: EV.KINDS });
  });
  api.put('/events/:id', perm('event.update'), async (c) => c.json(await EV.updateEvent(db, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/events/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !EV.eventTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, EV.eventTransitionPerm(body.data.action)!);
    return c.json(await EV.transitionEvent(db, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/events/:id/publish', perm('event.publish'), async (c) => c.json(await publisher.publishEvent(actor(c), c.req.param('id'))));
  api.post('/events/:id/unpublish', perm('event.publish'), async (c) => c.json(await publisher.unpublishEvent(actor(c), c.req.param('id'))));
  api.post('/events/:id/preview', perm('event.read'), async (c) => {
    const r = await publisher.previewEvent(c.req.param('id'), EV.toEventSnapshot(await EV.loadEvent(db, c.req.param('id'))));
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/events/:id/revisions/:rev/restore', perm('event.update'), async (c) => { await EV.restoreEventRevision(db, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });

  // ---------------------------------------------------------------- Opportunities
  api.get('/opportunities', perm('opportunity.read'), async (c) => c.json(await OP.listOpportunities(db)));
  api.post('/opportunities', perm('opportunity.create'), async (c) => c.json(await OP.createOpportunity(db, actor(c), await c.req.json()), 201));
  api.get('/opportunities/:id', perm('opportunity.read'), async (c) => {
    const o = await OP.loadOpportunity(db, c.req.param('id'));
    const mediaRows = o.heroMediaId ? await db.select().from(t.media).where(eq(t.media.id, o.heroMediaId)) : [];
    return c.json({ ...o, media: mediaRows.map(withUrl), problems: await OP.opportunityProblems(db, o), history: await OP.opportunityHistory(db, o.id) });
  });
  api.put('/opportunities/:id', perm('opportunity.update'), async (c) => c.json(await OP.updateOpportunity(db, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/opportunities/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !OP.opportunityTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, OP.opportunityTransitionPerm(body.data.action)!);
    return c.json(await OP.transitionOpportunity(db, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/opportunities/:id/publish', perm('opportunity.publish'), async (c) => c.json(await publisher.publishOpportunity(actor(c), c.req.param('id'))));
  api.post('/opportunities/:id/unpublish', perm('opportunity.publish'), async (c) => c.json(await publisher.unpublishOpportunity(actor(c), c.req.param('id'))));
  api.post('/opportunities/:id/preview', perm('opportunity.read'), async (c) => {
    const r = await publisher.previewOpportunity(c.req.param('id'), OP.toOpportunitySnapshot(await OP.loadOpportunity(db, c.req.param('id'))));
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/opportunities/:id/revisions/:rev/restore', perm('opportunity.update'), async (c) => { await OP.restoreOpportunityRevision(db, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });

  // ---------------------------------------------------------------- Forms (personal data: administrators only)
  api.get('/forms', perm('forms.read'), async (c) => c.json(await FM.overview(db)));
  api.get('/forms/:key/submissions', perm('forms.read'), async (c) => {
    const key = c.req.param('key'); if (!FM.isFormKey(key)) throw new AppError(404, 'Unknown form.');
    return c.json(await FM.listSubmissions(db, key, c.req.query('status') ?? null));
  });
  api.patch('/forms/submissions/:id', perm('forms.manage'), async (c) => { await FM.updateSubmission(db, actor(c), c.req.param('id'), await c.req.json()); return c.json({ ok: true }); });
  api.post('/forms/submissions/delete', perm('forms.manage'), async (c) => {
    const b = z.object({ ids: z.array(z.string().uuid()).max(500) }).safeParse(await c.req.json());
    if (!b.success) throw new AppError(422, 'Invalid selection.');
    return c.json({ deleted: await FM.deleteSubmissions(db, actor(c), b.data.ids) });
  });
  api.get('/forms/subscribers', perm('forms.read'), async (c) => c.json(await FM.listSubscribers(db)));
  api.post('/forms/subscribers/:id/:action', perm('forms.manage'), async (c) => {
    const a = c.req.param('action'); if (a !== 'unsubscribe' && a !== 'delete') throw new AppError(404, 'Unknown action.');
    await FM.setSubscriber(db, actor(c), c.req.param('id'), a); return c.json({ ok: true });
  });
  api.put('/forms/:key/settings', perm('forms.manage'), async (c) => {
    const key = c.req.param('key'); if (!FM.isFormKey(key)) throw new AppError(404, 'Unknown form.');
    await FM.saveSettings(db, actor(c), key, await c.req.json()); return c.json({ ok: true });
  });
  api.get('/forms/export/:what', perm('forms.read'), async (c) => {
    const w = c.req.param('what'); if (w !== 'contact' && w !== 'newsletter') throw new AppError(404, 'Unknown export.');
    const csv = await FM.exportCsv(db, actor(c), w);
    c.header('Content-Type', 'text/csv; charset=utf-8'); c.header('Cache-Control', 'no-store');
    c.header('Content-Disposition', `attachment; filename="afcd-${w}-${new Date().toISOString().slice(0, 10)}.csv"`);
    return c.body(csv);
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

  // Brand files for the sign-in screen (public; allow-listed names only).
  app.get('/studio/brand/:name', (c) => {
    const name = c.req.param('name');
    if (!['afcd-logo-white.png', 'afcd-mark.png', 'afcd-logo.png', 'afcd-symbol.svg'].includes(name)) return c.notFound();
    return sendFile(c, resolve(cfg.siteRoot, 'assets/brand', name), { immutable: false });
  });

  // Site assets for the builder canvas (iframe srcdoc with <base href="/studio/site/">).
  app.get('/studio/site/*', (c) => {
    requireUser(c);
    const rest = c.req.path.slice('/studio/site/'.length);
    if (rest.startsWith('assets/media/')) {
      const name = rest.slice('assets/media/'.length);
      if (!/^[0-9a-f]{24}-\d+\.webp$/.test(name)) return c.notFound();
      return sendFile(c, resolve(cfg.mediaDir, name), { private: true });
    }
    const p = resolve(cfg.siteRoot, rest);
    if (!p.startsWith(resolve(cfg.siteRoot, 'assets') + '/')) return c.notFound();
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

