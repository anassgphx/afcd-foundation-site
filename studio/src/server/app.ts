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
import { SESSION_COOKIE, createSession, deleteSession, hashPassword, recordAttempt, tooManyAttempts, validatePasswordStrength, verifyPassword, isLocalOrigin } from './auth/session.ts';
import { ROLE_LABELS, ROLE_PERMISSIONS, ROLES, type Role } from './rbac.ts';
import { audit } from './audit.ts';
import * as P from './modules/projects/service.ts';
import * as M from './modules/media/service.ts';
import * as G from './modules/pages/service.ts';
import * as N from './modules/news/service.ts';
import * as PT from './modules/partners/service.ts';
import { trimIfUncropped } from './modules/media/trim.ts';
import * as EV from './modules/events/service.ts';
import * as OP from './modules/opportunities/service.ts';
import * as FM from './modules/forms/service.ts';
import * as SEO from './modules/seo/service.ts';
import * as RD from './modules/seo/redirects.ts';
import * as SCH from './modules/seo/schema.ts';
import * as GSC from './modules/google/gsc.ts';
import * as SITE from './modules/seo/site.ts';
import * as JOBS from './modules/jobs/service.ts';
import * as TR from './modules/translations/service.ts';
import { registerMenuRoutes } from './modules/menus/routes.ts';
import { registerReviewRoutes } from './modules/review/routes.ts';
import { registerMediaLibraryRoutes } from './modules/media/routes.ts';
import { registerInboxRoutes } from './modules/inbox/routes.ts';
import { registerSettingsRoutes } from './modules/settings/routes.ts';
import { registerPublicationRoutes } from './modules/publications/routes.ts';
import { projectManageRoutes } from './modules/projects/manage.ts';
import { contentDeleteRoutes } from './modules/content/delete.ts';
import { documentsDir } from './modules/publications/documents.ts';
import * as NOTIFY from './modules/settings/notify.ts';
import * as HM from './modules/home/service.ts';
import * as WS from './modules/workspace/service.ts';
import { overview as dashboardOverview } from './modules/workspace/overview.ts';
import { fieldSections, readFields, SECTION_LABEL, siteSections } from './modules/home/fields.ts';
import { currentLayout, validateLayout, HOME_BLOCKS } from './modules/home/layout.ts';
import { homeCanvas } from './modules/home/render.ts';
import { docMediaIds } from './modules/pages/render.ts';
import { importPartners } from './modules/partners/import.ts';
import * as PL from './modules/pillars/service.ts';
import * as AB from './modules/about/service.ts';
import { blockCatalog } from './modules/pages/blocks.ts';
import { Publisher, type BuildRunner } from './modules/publish/service.ts';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.ico': 'image/x-icon', '.xml': 'application/xml', '.pdf': 'application/pdf',
};

// Argon2id hash of a random value, used only to equalize response timing for unknown emails.
const dummyHash = hashPassword(randomBytes(24).toString('hex'));

export function createApp(db: DB, cfg: Config, opts: { runner?: BuildRunner; googleHttp?: typeof fetch } = {}) {
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
    const received = await FM.receive(db, cfg, key, body, clientIp(c));
    if (key === 'contact') NOTIFY.afterReceive(db, cfg);   // Settings → Notifications (no-op when off)
    return c.json(received);
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
    // A local-only (short) password never works once Studio runs on a real address.
    if (u.localOnlyPassword && !isLocalOrigin(cfg.origin)) {
      await audit(db, null, 'auth.login_refused_local_password', { type: 'user', id: u.id }, email, undefined, ip);
      throw new HTTPException(403, { message: 'This account has a local-only password. An administrator must set a strong password (12+ characters) before it can sign in here.' });
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
  // pillars that projects, stories, events and opportunities may link to (live ones; a new pillar appears once published)
  api.get('/pillars', perm('project.read'), async (c) => c.json(await PL.linkablePillars(db)));
  api.get('/objectives', perm('project.read'), async (c) => {
    const objs = await db.select().from(t.objectives).orderBy(asc(t.objectives.sort));
    const links = await db.select({ o: t.objectivePillars.objectiveId, key: t.pillars.key }).from(t.objectivePillars).innerJoin(t.pillars, eq(t.pillars.id, t.objectivePillars.pillarId));
    return c.json(objs.map((o) => ({ ...o, pillarKeys: links.filter((l) => l.o === o.id).map((l) => l.key) })));
  });

  // ---------------------------------------------------------------- Projects
  api.get('/projects', perm('project.read'), async (c) => c.json(await P.listProjects(db)));
  api.get('/projects/:id', perm('project.read'), async (c) => {
    const p = await P.loadProject(db, c.req.param('id'));
    return c.json({ ...p, hero: p.hero && withUrl(p.hero), logo: p.logo && withUrl(p.logo), poster: p.poster && withUrl(p.poster), gallery: p.gallery.map(withUrl), problems: P.publishProblems(p), history: await P.projectHistory(db, p.id) });
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
  projectManageRoutes(api, db, actor);   // duplicate (project.create) and delete (project.archive): modules/projects/manage.ts
  contentDeleteRoutes(api, db, actor);   // delete drafts/archived stories, events, opportunities, partners, publications: modules/content/delete.ts

  // ---------------------------------------------------------------- Media
  registerMediaLibraryRoutes(api);   // library view, replace, original download, bulk edits (modules/media/routes.ts)
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
    const ids = [...new Set([a.heroMediaId, ...a.galleryMediaIds, ...N.bodyMediaIds(a.body)].filter(Boolean) as string[])];   // + photos placed in the story text
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
  // a partner's logo is trimmed of empty margins when it is first chosen (media/trim.ts), so every logo shows at full size
  api.post('/partners', perm('partner.create'), async (c) => { const p = await PT.createPartner(db, actor(c), await c.req.json()); await trimIfUncropped(db, cfg, p.logoMediaId).catch(() => null); return c.json(p, 201); });
  api.post('/partners/import', perm('partner.publish'), async (c) => c.json(await importPartners(db, cfg, actor(c))));
  api.get('/partners/:id', perm('partner.read'), async (c) => {
    const p = await PT.loadPartner(db, c.req.param('id'));
    const mediaRows = p.logoMediaId ? await db.select().from(t.media).where(eq(t.media.id, p.logoMediaId)) : [];
    return c.json({ ...p, media: mediaRows.map(withUrl), problems: await PT.partnerProblems(db, p), history: await PT.partnerHistory(db, p.id) });
  });
  api.put('/partners/:id', perm('partner.update'), async (c) => { const p = await PT.updatePartner(db, actor(c), c.req.param('id'), await c.req.json()); await trimIfUncropped(db, cfg, (p as { logoMediaId?: string | null }).logoMediaId).catch(() => null); return c.json(p); });
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

  // ---------------------------------------------------------------- Pillars (the four strategic pillars and their pages)
  api.get('/pillars/records', perm('pillar.read'), async (c) => c.json(await PL.listPillars(db)));
  api.post('/pillars/import', perm('pillar.publish'), async (c) => c.json(await PL.importPillars(db, cfg, actor(c))));
  api.post('/pillars', perm('pillar.create'), async (c) => c.json(await PL.createPillar(db, cfg, actor(c), await c.req.json()), 201));
  api.post('/pillars/order', perm('pillar.publish'), async (c) => { const { next, before } = await PL.planOrder(db, (await c.req.json())?.ids); return c.json(await publisher.reorderPillars(actor(c), next, before)); });
  api.delete('/pillars/:id{[0-9a-f-]{36}}', perm('pillar.update'), async (c) => c.json(await PL.deleteDraftPillar(db, actor(c), c.req.param('id'))));
  api.get('/pillars/:id{[0-9a-f-]{36}}', perm('pillar.read'), async (c) => {
    const p = await PL.loadPillar(db, c.req.param('id'));
    const mediaRows = p.mediaId ? await db.select().from(t.media).where(eq(t.media.id, p.mediaId)) : [];
    return c.json({ ...p, draft: undefined, media: mediaRows.map(withUrl), problems: await PL.pillarProblems(db, p), history: await PL.pillarHistory(db, p.id), lists: PL.siteLists(cfg), colours: PL.COLOURS });
  });
  api.put('/pillars/:id{[0-9a-f-]{36}}', perm('pillar.update'), async (c) => c.json(await PL.updatePillar(db, cfg, actor(c), c.req.param('id'), await c.req.json())));
  api.post('/pillars/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !PL.pillarTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, PL.pillarTransitionPerm(body.data.action)!);
    return c.json(await PL.transitionPillar(db, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/pillars/:id/publish', perm('pillar.publish'), async (c) => c.json(await publisher.publishPillar(actor(c), c.req.param('id'))));
  api.post('/pillars/:id/preview', perm('pillar.read'), async (c) => {
    const p = await PL.loadPillar(db, c.req.param('id'));
    const r = await publisher.previewPillar(p.id, PL.toPillarSnapshot(p), p.sort);
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/pillars/:id/revisions/:rev/restore', perm('pillar.update'), async (c) => { await PL.restorePillarRevision(db, cfg, actor(c), c.req.param('id'), c.req.param('rev')); return c.json({ ok: true }); });

  // ---------------------------------------------------------------- About pages (Our Story, Mission & Vision, Strategy, Team, Partners texts)
  // :ref is the page key (our-story) or its id
  api.get('/about/records', perm('about.read'), async (c) => c.json(await AB.listAbout(db)));
  api.post('/about/import', perm('about.publish'), async (c) => c.json(await AB.importAbout(db, cfg, actor(c))));
  api.get('/about/:ref', perm('about.read'), async (c) => {
    const p = await AB.loadAbout(db, c.req.param('ref'));
    const ids = p.content ? AB.contentMediaIds(p.key, p.content) : [];
    const mediaRows = ids.length ? await db.select().from(t.media).where(inArray(t.media.id, ids)) : [];
    return c.json({ ...p, draft: undefined, meta: AB.ABOUT_META[p.key], media: mediaRows.map(withUrl), problems: await AB.aboutProblems(db, p), history: await AB.aboutHistory(db, p.id), context: await AB.aboutContext(db) });
  });
  api.put('/about/:ref', perm('about.update'), async (c) => c.json(await AB.updateAbout(db, actor(c), c.req.param('ref'), await c.req.json())));
  api.post('/about/:ref/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !AB.aboutTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, AB.aboutTransitionPerm(body.data.action)!);
    return c.json(await AB.transitionAbout(db, actor(c), u.role, c.req.param('ref'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/about/:ref/publish', perm('about.publish'), async (c) => c.json(await publisher.publishAboutPage(actor(c), (await AB.findPage(db, c.req.param('ref'))).id)));
  api.post('/about/:ref/preview', perm('about.read'), async (c) => {
    const p = await AB.loadAbout(db, c.req.param('ref'));
    const r = await publisher.previewAboutPage(p.id, AB.toAboutSnapshot(p));
    return c.json({ url: `/studio/preview/${r.token}/${r.file}` });
  });
  api.post('/about/:ref/revisions/:rev/restore', perm('about.update'), async (c) => { await AB.restoreAboutRevision(db, actor(c), c.req.param('ref'), c.req.param('rev')); return c.json({ ok: true }); });

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

  // ---------------------------------------------------------------- Publications (reports, studies…) and their PDF files
  registerPublicationRoutes(api);   // modules/publications

  // ---------------------------------------------------------------- Inbox: website messages and newsletter list (personal data, forms.read / forms.manage)
  registerInboxRoutes(api);   // modules/inbox
  registerSettingsRoutes(api);   // Settings Center (modules/settings)

  // ---------------------------------------------------------------- SEO studio
  api.get('/seo/audit', perm('seo.read'), async (c) => c.json({ last: await SEO.lastAudit(db), history: await SEO.auditHistory(db) }));
  api.post('/seo/audit', perm('seo.read'), async (c) => c.json(await SEO.runAudit(db, cfg, actor(c))));
  api.get('/seo/issues', perm('seo.read'), async (c) => c.json(await SEO.listIssues(db, cfg)));
  api.post('/seo/issues/:id/review', perm('seo.update'), async (c) => {
    const b = z.object({ reviewed: z.boolean(), note: z.string().max(500).optional() }).safeParse(await c.req.json());
    if (!b.success) throw new AppError(422, 'Invalid change.');
    await SEO.reviewIssue(db, actor(c), c.req.param('id'), b.data); return c.json({ ok: true });
  });
  api.get('/seo/pages', perm('seo.read'), async (c) => c.json(await SEO.listOverrides(db, cfg)));
  api.get('/seo/pages/:file', perm('seo.read'), async (c) => {
    const file = c.req.param('file');
    const defaults = SEO.pageDefaults(cfg, file); if (!defaults) throw new AppError(404, 'Unknown page.');
    const [o] = await db.select().from(t.seoOverrides).where(eq(t.seoOverrides.file, file));
    const mediaRows = o?.imageMediaId ? await db.select().from(t.media).where(eq(t.media.id, o.imageMediaId)) : [];
    const owner = (await SEO.owners(db, cfg)).get(file) ?? null;
    return c.json({ file, defaults, owner, override: o ?? null, media: mediaRows.map(withUrl), problems: o ? await SEO.overrideProblems(db, o) : [], history: o ? await SEO.overrideHistory(db, o.id) : { revisions: [], comments: [] } });
  });
  api.put('/seo/pages/:file', perm('seo.update'), async (c) => c.json(await SEO.saveOverride(db, cfg, actor(c), c.req.param('file'), await c.req.json())));
  api.post('/seo/overrides/:id/transition', async (c) => {
    const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
    if (!body.success || !SEO.seoTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, SEO.seoTransitionPerm(body.data.action)!);
    return c.json(await SEO.transitionOverride(db, actor(c), u.role, c.req.param('id'), body.data.action, { comment: body.data.comment }));
  });
  api.post('/seo/overrides/:id/discard', perm('seo.update'), async (c) => { await SEO.discardOverride(db, actor(c), c.req.param('id')); return c.json({ ok: true }); });
  api.post('/seo/overrides/:id/publish', perm('seo.publish'), async (c) => c.json(await publisher.publishSeo(actor(c), c.req.param('id'))));
  api.post('/seo/overrides/:id/unpublish', perm('seo.publish'), async (c) => c.json(await publisher.unpublishSeo(actor(c), c.req.param('id'))));
  // redirects: editors draft them (seo.update), administrators put them on the site (seo.publish)
  api.get('/seo/redirects', perm('seo.read'), async (c) => c.json(await RD.listRedirects(db, cfg)));
  api.post('/seo/redirects/check', perm('seo.update'), async (c) => {
    const p = RD.redirectSchema.safeParse(await c.req.json());
    if (!p.success) return c.json({ errors: p.error.issues.map((i) => i.message), warnings: [] });
    return c.json(await RD.checkRedirect(db, cfg, p.data, requireUser(c).role, c.req.query('id') || undefined));
  });
  api.post('/seo/redirects', perm('seo.update'), async (c) => c.json(await RD.saveRedirect(db, cfg, actor(c), requireUser(c).role, await c.req.json()), 201));
  api.put('/seo/redirects/:id', perm('seo.update'), async (c) => c.json(await RD.saveRedirect(db, cfg, actor(c), requireUser(c).role, await c.req.json(), c.req.param('id'))));
  api.post('/seo/redirects/:id/disable', perm('seo.update'), async (c) => { await RD.setRedirectStatus(db, actor(c), c.req.param('id'), 'disabled'); return c.json({ ok: true }); });
  api.post('/seo/redirects/:id/enable', perm('seo.update'), async (c) => { await RD.setRedirectStatus(db, actor(c), c.req.param('id'), 'draft'); return c.json({ ok: true }); });
  api.delete('/seo/redirects/:id', perm('seo.update'), async (c) => { await RD.deleteRedirect(db, actor(c), c.req.param('id')); return c.json({ ok: true }); });
  api.post('/seo/redirects/publish', perm('seo.publish'), async (c) => c.json(await publisher.publishRedirects(actor(c), requireUser(c).role)));
  // structured data: drafted (seo.update), reviewed by someone else (seo.approve), published (seo.publish)
  api.get('/seo/schema', perm('seo.read'), async (c) => c.json(await SCH.settingsView(db, cfg, await publisher.schemaLive())));
  api.put('/seo/schema', perm('seo.update'), async (c) => { await SCH.saveSettings(db, actor(c), await c.req.json()); return c.json(await SCH.settingsView(db, cfg, await publisher.schemaLive())); });
  api.post('/seo/schema/transition', async (c) => {
    const body = z.object({ action: z.enum(['submit', 'withdraw', 'request_changes', 'approve']), comment: z.string().max(2000).optional() }).safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, SCH.SCHEMA_ACTIONS[body.data.action]);
    await SCH.transitionSettings(db, actor(c), u.role, body.data.action, body.data.comment ?? '');
    return c.json(await SCH.settingsView(db, cfg, await publisher.schemaLive()));
  });
  api.post('/seo/schema/publish', perm('seo.publish'), async (c) => c.json(await publisher.publishSchema(actor(c))));
  api.post('/seo/schema/unpublish', perm('seo.publish'), async (c) => c.json(await publisher.unpublishSchema(actor(c))));
  registerMenuRoutes(api);   // website menus (modules/menus)
  registerReviewRoutes(api); // approval queue across all content (modules/review)

  // ---------------------------------------------------------------- SEO Pro: Google Search Console + background jobs
  // Admins (seo.publish) connect, choose the property, change sync settings and disconnect; SEO editors (seo.update)
  // start syncs and URL inspections; everyone with seo.read sees the stored Google data.
  const http = opts.googleHttp ?? fetch;
  // the public website's canonical address (Settings → General, else afcdfoundation.com), for previews in any editor
  api.get('/seo/site', async (c) => { requireUser(c); const url = await SITE.siteUrl(db); return c.json({ url, host: SITE.siteHost(url) }); });
  api.get('/seo/google/status', perm('seo.read'), async (c) => c.json({ ...(await GSC.status(db, cfg)), coverage: await GSC.coverage(db), jobs: await JOBS.listJobs(db, ['gsc_sync'], 8) }));
  api.post('/seo/google/connect', perm('seo.publish'), async (c) => c.json(await GSC.startConnect(db, cfg, actor(c))));
  api.get('/seo/google/callback', async (c) => {
    // Google redirects the browser here (top-level GET, so the session cookie is sent). Errors are shown in Studio.
    const back = (q: string) => c.redirect(`/studio/seo/integrations?${q}`);
    if (!c.var.user) return back('gsc_error=' + encodeURIComponent('Please sign in to Studio, then connect again.'));
    requirePerm(c, 'seo.publish');
    try { await GSC.finishConnect(db, cfg, http, actor(c), { state: c.req.query('state'), code: c.req.query('code'), error: c.req.query('error') }); return back('gsc=connected'); }
    catch (e) { return back('gsc_error=' + encodeURIComponent((e as Error).message.slice(0, 300))); }
  });
  api.get('/seo/google/properties', perm('seo.publish'), async (c) => c.json(await GSC.listProperties(db, cfg, http).catch((e) => { throw new AppError(409, (e as Error).message); })));
  api.put('/seo/google/property', perm('seo.publish'), async (c) => {
    const b = z.object({ siteUrl: z.string().min(3).max(300) }).safeParse(await c.req.json()); if (!b.success) throw new AppError(422, 'Choose a property.');
    await GSC.chooseProperty(db, cfg, http, actor(c), b.data.siteUrl);
    await JOBS.enqueue(db, 'gsc_sync', {}, { by: actor(c).id });
    return c.json(await GSC.status(db, cfg));
  });
  api.put('/seo/google/settings', perm('seo.publish'), async (c) => {
    const b = z.object({ backfillDays: z.number().int().min(7).max(486), retentionDays: z.number().int().min(30).max(486), autoSync: z.boolean() }).strict().safeParse(await c.req.json());
    if (!b.success) throw new AppError(422, 'Use 7–486 days to import and 30–486 days to keep.');
    if (b.data.retentionDays < b.data.backfillDays) throw new AppError(422, 'Keep data at least as long as the import window.');
    await GSC.saveSettings(db, actor(c), b.data); return c.json(await GSC.status(db, cfg));
  });
  api.post('/seo/google/disconnect', perm('seo.publish'), async (c) => c.json(await GSC.disconnect(db, cfg, http, actor(c))));
  api.post('/seo/google/sync', perm('seo.update'), async (c) => {
    const conn = await GSC.connection(db); if (!conn?.property) throw new AppError(409, 'Connect Search Console and choose a property first.');
    const r = await JOBS.enqueue(db, 'gsc_sync', {}, { by: actor(c).id }); return c.json(r, r.existing ? 200 : 201);
  });
  api.post('/seo/jobs/:id/cancel', perm('seo.update'), async (c) => c.json(await JOBS.cancelJob(db, c.req.param('id'))));
  api.get('/seo/jobs', perm('seo.read'), async (c) => c.json(await JOBS.listJobs(db, undefined, 30)));
  const range = (c: { req: { query: (k: string) => string | undefined } }): GSC.Range => {
    const d = /^\d{4}-\d{2}-\d{2}$/; const from = c.req.query('from') ?? '', to = c.req.query('to') ?? '';
    if (!d.test(from) || !d.test(to) || from > to) throw new AppError(422, 'Use a date range like from=2026-10-01&to=2026-10-28.');
    const device = c.req.query('device'), country = c.req.query('country');
    if (device && !['DESKTOP', 'MOBILE', 'TABLET'].includes(device)) throw new AppError(422, 'Unknown device.');
    if (country && !/^[a-z]{3}$/.test(country)) throw new AppError(422, 'Use a three-letter country code (Search Console format, e.g. mar).');
    if (device && country) throw new AppError(422, 'Search Console data here is stored per device or per country, not both at once. Choose one filter.');
    return { from, to, ...(device ? { device } : {}), ...(country ? { country } : {}) };
  };
  api.get('/seo/gsc/overview', perm('seo.read'), async (c) => { const r = range(c); return c.json({ coverage: await GSC.coverage(db), current: await GSC.overview(db, r),
    previous: c.req.query('compare') === '1' ? await GSC.overview(db, (() => { const len = (Date.parse(r.to) - Date.parse(r.from)) / 86_400_000 + 1; const f = new Date(Date.parse(r.from) - len * 86_400_000).toISOString().slice(0, 10); const t = new Date(Date.parse(r.from) - 86_400_000).toISOString().slice(0, 10); return { ...r, from: f, to: t }; })()) : null }); });
  api.get('/seo/gsc/queries', perm('seo.read'), async (c) => c.json(await GSC.queries(db, range(c))));
  api.get('/seo/gsc/pages', perm('seo.read'), async (c) => c.json(await GSC.pages(db, range(c))));
  api.get('/seo/gsc/breakdown', perm('seo.read'), async (c) => { const r = range(c); return c.json({ countries: await GSC.countries(db, r), devices: await GSC.devices(db, r) }); });
  api.get('/seo/gsc/page', perm('seo.read'), async (c) => { const p = c.req.query('url'); if (!p) throw new AppError(422, 'Which page?'); return c.json(await GSC.pageHistory(db, p, range(c))); });
  api.get('/seo/gsc/movers', perm('seo.read'), async (c) => { const r = range(c); const min = Math.max(1, Math.min(10000, Number(c.req.query('min') ?? 20) || 20));
    return c.json({ pages: await GSC.movers(db, 'page', r, min), queries: await GSC.movers(db, 'query', r, min) }); });
  api.get('/seo/gsc/inspections', perm('seo.read'), async (c) => c.json(await GSC.inspections(db)));
  api.post('/seo/gsc/inspect', perm('seo.update'), async (c) => {
    const b = z.object({ url: z.string().url().max(2000) }).safeParse(await c.req.json()); if (!b.success) throw new AppError(422, `Enter a full address, like ${await SITE.siteUrl(db)}about.html`);
    return c.json(await GSC.inspect(db, cfg, http, actor(c), b.data.url));
  });

  // ---------------------------------------------------------------- Translations: edited (translation.update), reviewed by someone else (translation.approve), published (translation.publish)
  const langOf = (c: { req: { param: (k: string) => string } }) => { const l = c.req.param('lang'); if (!TR.isLang(l)) throw new AppError(404, 'Unknown language.'); return l; };
  api.get('/translations', perm('translation.read'), async (c) => c.json(await TR.overview(db, cfg)));
  api.post('/translations/record', perm('translation.read'), async (c) => c.json(await TR.recordView(db, cfg, actor(c), await c.req.json())));
  api.get('/translations/:lang', perm('translation.read'), async (c) => c.json(await TR.view(db, cfg, langOf(c), actor(c))));
  api.patch('/translations/:lang', perm('translation.update'), async (c) => { const l = langOf(c); await TR.save(db, cfg, l, actor(c), await c.req.json()); return c.json(await TR.view(db, cfg, l, actor(c))); });
  api.post('/translations/:lang/transition', async (c) => {
    const l = langOf(c);
    const body = z.object({ action: z.enum(['submit', 'withdraw', 'request_changes', 'approve']), comment: z.string().max(2000).optional() }).safeParse(await c.req.json());
    if (!body.success) throw new AppError(422, 'Unknown action.');
    const u = requirePerm(c, TR.TRANSLATION_ACTIONS[body.data.action]);
    await TR.transition(db, l, actor(c), u.role, body.data.action, body.data.comment ?? '');
    return c.json(await TR.view(db, cfg, l, actor(c)));
  });
  api.post('/translations/:lang/publish', perm('translation.publish'), async (c) => c.json(await publisher.publishTranslations(actor(c), langOf(c))));

  // ---------------------------------------------------------------- Top bar: search and notifications (permission-filtered)
  api.get('/search', async (c) => { const u = requireUser(c); return c.json(await WS.search(db, u.role, c.req.query('q') ?? '')); });
  api.get('/overview', perm('dashboard.read'), async (c) => c.json(await dashboardOverview(db, requireUser(c))));
  api.get('/notifications', async (c) => { const u = requireUser(c); return c.json(await WS.notifications(db, u)); });

  // ---------------------------------------------------------------- Homepage and contact page editing (marked text, review, publishing)
  // Same endpoints for each page in HM.TEXT_PAGES: /home for the homepage (with its section layout), /page-text/contact.html.
  const textPageRoutes = (prefix: string, file: string) => {
    const page = HM.TEXT_PAGES[file];
    api.get(prefix, perm('page.read'), async (c) => {
      const fields = readFields(cfg.siteRoot, file);
      const content = await HM.loadContent(db, file);
      const ids = HM.valueMediaIds(content?.values ?? {});   // image fields and participant-story photos
      const mediaRows = ids.length ? await db.select().from(t.media).where(inArray(t.media.id, ids)) : [];
      // a page without a layout lists its sections that have fields, in page order (selection only)
      const sections = page.layout ? siteSections(cfg.siteRoot, file) : fieldSections(cfg.siteRoot, file);
      const layout = page.layout ? currentLayout(cfg.siteRoot, file, content?.layout ?? null) : sections.map((x) => ({ kind: 'section' as const, id: x.id, hidden: false }));
      const blockIds = layout.flatMap((e) => (e.kind === 'block' ? docMediaIds({ blocks: [e] }) : []));
      const extra = blockIds.length ? await db.select().from(t.media).where(inArray(t.media.id, blockIds)) : [];
      return c.json({ page: { file, ...page }, fields, sections: SECTION_LABEL, siteSections: sections, layout, content, media: [...mediaRows, ...extra].map(withUrl),
        catalog: page.layout ? blockCatalog().filter((b) => HOME_BLOCKS.includes(b.type)) : [],
        problems: content ? await HM.contentProblems(db, cfg, content.values, content.layout, file) : [],
        issues: content ? await HM.contentIssues(db, cfg, content.values, content.layout, file) : [], history: content ? await HM.contentHistory(db, content.id) : { revisions: [], comments: [] } });
    });
    api.put(prefix, perm('page.update'), async (c) => c.json(await HM.saveContent(db, cfg, actor(c), await c.req.json(), file)));
    // Live canvas of the unsaved working copy (no files written): the real page, composed by the same code as the build.
    api.post(`${prefix}/canvas`, perm('page.read'), bodyLimit({ maxSize: 512 * 1024 }), async (c) => {
      const b = await c.req.json().catch(() => ({})) as { values?: unknown; layout?: unknown };
      const values = HM.validateValues(readFields(cfg.siteRoot, file), b.values ?? {});
      const layout = page.layout ? validateLayout(cfg.siteRoot, file, b.layout ?? currentLayout(cfg.siteRoot, file, null)).layout : null;
      return c.json({ html: await homeCanvas(db, cfg, file, values, layout) });
    });
    api.post(`${prefix}/transition`, async (c) => {
      const body = z.object({ action: z.string().max(30), comment: z.string().max(2000).default('') }).safeParse(await c.req.json());
      if (!body.success || !HM.homeTransitionPerm(body.data.action)) throw new AppError(422, 'Unknown action.');
      const u = requirePerm(c, HM.homeTransitionPerm(body.data.action)!);
      return c.json(await HM.transitionContent(db, cfg, actor(c), u.role, body.data.action, { comment: body.data.comment }, file));
    });
    api.post(`${prefix}/publish`, perm('page.publish'), async (c) => c.json(await publisher.publishHome(actor(c), file)));
    api.post(`${prefix}/unpublish`, perm('page.publish'), async (c) => c.json(await publisher.unpublishHome(actor(c), file)));
    api.post(`${prefix}/preview`, perm('page.read'), async (c) => { const r = await publisher.previewHome(file); return c.json({ url: `/studio/preview/${r.token}/${r.file}` }); });
    api.post(`${prefix}/revisions/:rev/restore`, perm('page.update'), async (c) => { await HM.restoreContentRevision(db, cfg, actor(c), c.req.param('rev'), file); return c.json({ ok: true }); });
  };
  for (const [file, page] of Object.entries(HM.TEXT_PAGES)) textPageRoutes(page.api, file);

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
    if (rest.startsWith('assets/documents/')) {   // a publication preview's PDF: Studio's stored copy, never the site's
      const name = rest.slice('assets/documents/'.length);
      if (!/^[0-9a-f]{24}\.pdf$/.test(name)) return c.notFound();
      return sendFile(c, resolve(documentsDir(cfg), name), { private: true });
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

  // background jobs: the server calls runJobs() on a timer; tests call it directly
  // `today` only changes which Search Console days count as final (tests use a fixed date); scheduling uses the clock
  const runJobs = (today?: Date) => JOBS.runNext(db, { gsc_sync: (ctx) => GSC.syncJob(db, cfg, opts.googleHttp ?? fetch, ctx, today) });
  return { app, publisher, runJobs };
}

function withUrl(m: M.MediaRow) { return { ...m, url: `/studio/media-file/${m.storageKey}-480.webp`, large: `/studio/media-file/${M.publicRef(m).src.split('/').pop()}` }; }

function sendFile(c: { header: (k: string, v: string) => void; body: (d: Uint8Array, s?: number) => Response; notFound: () => Response | Promise<Response> }, p: string, o: { private?: boolean; immutable?: boolean } = {}) {
  if (!existsSync(p)) return c.notFound();
  c.header('Content-Type', MIME[extname(p)] ?? 'application/octet-stream');
  c.header('Cache-Control', o.immutable ? 'public, max-age=31536000, immutable' : o.private ? 'private, no-store' : 'no-cache');
  return c.body(new Uint8Array(readFileSync(p)));
}

