// Delivery to the public website. Exports published revisions as JSON, copies approved image derivatives, runs the existing
// generator (src/content.py) and build (build.mjs + Tailwind), then VERIFIES the output before the database records success.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, pages, pageRevisions, projects, projectRevisions, publishJobs } from '../../db/schema.ts';
import { buildCtx, canvasHtml, docMediaIds, pageSource, type PageSnapshot } from '../pages/render.ts';
import { snapshotOf } from '../pages/service.ts';
import { validateDoc } from '../pages/blocks.ts';
import { articles, articleRevisions } from '../../db/schema.ts';
import { articleFile, articleSource, listingEntry, newsCtx, type ArticleSnapshot } from '../news/render.ts';
import { loadArticle, toArticleSnapshot } from '../news/service.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { derivativeFiles } from '../media/service.ts';
import { loadProject, toSnapshot, type Snapshot } from '../projects/service.ts';

const run = promisify(execFile);
const MEDIA_FILE = /^[0-9a-f]{24}-\d+\.webp$/;

export type BuildRunner = (cfg: Config, mode: { kind: 'live' } | { kind: 'preview'; dataFile: string; pagesDir: string; outDir: string; only?: 'pages'; newsFile?: string }) => Promise<string>;

/** Default runner: the real generator and build. Tests inject a fake. */
export const realRunner: BuildRunner = async (cfg, mode) => {
  const opts = { cwd: cfg.siteRoot, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 };
  if (mode.kind === 'live') {
    const a = await run('python3', ['-I', 'src/content.py'], { ...opts, env: { ...process.env } });
    const b = await run('npm', ['run', 'build'], { ...opts, env: { ...process.env } });
    return [a.stdout, b.stdout, b.stderr].join('\n');
  }
  const env = { ...process.env, STUDIO_PROJECTS_JSON: mode.dataFile, STUDIO_OUT: mode.pagesDir, PAGES_DIR: mode.pagesDir, OUT_DIR: mode.outDir, ...(mode.newsFile ? { STUDIO_NEWS_JSON: mode.newsFile } : {}) };
  const a = mode.only === 'pages' ? { stdout: '' } : await run('python3', ['-I', 'src/content.py'], { ...opts, env });
  const b = await run('node', ['build.mjs'], { ...opts, env });
  return [a.stdout, b.stdout].join('\n');
};

export class Publisher {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(private db: DB, private cfg: Config, private runner: BuildRunner = realRunner) {}

  /** One build at a time: every delivery is serialized through this lock. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => undefined);
    return next;
  }

  get dataFile() { return resolve(this.cfg.siteRoot, 'src/data/projects.json'); }

  /** Entries for every live project, optionally overriding one project with another revision (publish) or removing it (unpublish). */
  async liveEntries(override?: { projectId: string; revisionId: string | null }) {
    const live = await this.db.select({ id: projects.id, rev: projects.publishedRevisionId }).from(projects).where(isNotNull(projects.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.projectId, override.revisionId); else map.delete(override.projectId); }
    if (!map.size) return [];
    const revs = await this.db.select().from(projectRevisions).where(inArray(projectRevisions.id, [...map.values()]));
    return revs.map((r) => {
      const s = escapeSnapshot(structuredClone(r.snapshot) as unknown as Snapshot);
      if (s.detail && Object.keys(s.detail).length) (s.detail as Record<string, unknown>).revision = r.id;
      return s;
    }).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  }

  private writeData(file: string, entries: Snapshot[]) {
    mkdirSync(resolve(file, '..'), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 2, source: 'AFCD Studio', generatedAt: new Date().toISOString(), projects: entries }, null, 2) + '\n');
    renameSync(tmp, file);   // atomic replace
  }

  /** Live Studio pages (optionally overriding one page with another revision, or removing it). */
  async livePages(override?: { pageId: string; revisionId: string | null }) {
    const live = await this.db.select({ id: pages.id, rev: pages.publishedRevisionId }).from(pages).where(isNotNull(pages.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.pageId, override.revisionId); else map.delete(override.pageId); }
    if (!map.size) return [] as { id: string; snap: PageSnapshot }[];
    const revs = await this.db.select().from(pageRevisions).where(inArray(pageRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as PageSnapshot }));
  }

  /** Writes everything Studio owns into the site sources: project data, Studio page sources and image files. */
  /** Live articles (optionally overriding one), newest first. */
  async liveArticles(override?: { articleId: string; revisionId: string | null }) {
    const live = await this.db.select({ id: articles.id, rev: articles.publishedRevisionId }).from(articles).where(isNotNull(articles.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.articleId, override.revisionId); else map.delete(override.articleId); }
    if (!map.size) return [] as { id: string; snap: ArticleSnapshot }[];
    const revs = await this.db.select().from(articleRevisions).where(inArray(articleRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as ArticleSnapshot }))
      .sort((a, b) => b.snap.publishDate.localeCompare(a.snap.publishDate) || a.snap.title.localeCompare(b.snap.title));
  }

  /** News listing data + article page sources. Returns media ids used. */
  private async writeNews(dataFile: string, pagesDir: string, live: { id: string; snap: ArticleSnapshot }[], projectOverride?: { projectId: string; revisionId: string | null }) {
    const ctx = await newsCtx(this.db, live.map((x) => x.snap), { projectOverride });
    const listing = live.map((x) => listingEntry(x.snap, ctx, x.id));
    const tmp = `${dataFile}.${randomBytes(4).toString('hex')}.tmp`;
    mkdirSync(resolve(dataFile, '..'), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), articles: listing }, null, 2) + '\n'); renameSync(tmp, dataFile);
    mkdirSync(pagesDir, { recursive: true });
    for (const x of live) {
      const file = articleFile(x.snap); if (!file) continue;
      const others = listing.filter((l) => l.slug !== x.snap.slug);
      writeFileSync(resolve(pagesDir, file), articleSource(x.snap, ctx, x.id, others));
    }
    return live.flatMap((x) => [x.snap.heroMediaId, ...x.snap.galleryMediaIds].filter(Boolean) as string[]);
  }

  get newsFile() { return resolve(this.cfg.siteRoot, 'src/data/news.json'); }

  private async writeSite(o: { project?: { projectId: string; revisionId: string | null }; page?: { pageId: string; revisionId: string | null }; article?: { articleId: string; revisionId: string | null } } = {}) {
    const entries = await this.liveEntries(o.project);
    this.writeData(this.dataFile, entries);
    const newsMedia = await this.writeNews(this.newsFile, resolve(this.cfg.siteRoot, 'src/pages'), await this.liveArticles(o.article), o.project);
    const live = await this.livePages(o.page);
    const ctx = await buildCtx(this.db, live.map((x) => x.snap.doc), { projectOverride: o.project });
    const dir = resolve(this.cfg.siteRoot, 'src/pages');
    mkdirSync(dir, { recursive: true });
    for (const { id, snap } of live) {
      const file = resolve(dir, `${snap.slug}.html`);
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, pageSource(snap, ctx, id)); renameSync(tmp, file);
    }
    await this.copyMedia([...entries.flatMap((e) => e.media ?? []), ...live.flatMap((x) => docMediaIds(x.snap.doc)), ...newsMedia], resolve(this.cfg.siteRoot, 'assets/media'), true);
    return { entries, live };
  }

  private async copyMedia(mediaIds: string[], destDir: string, prune: boolean) {
    const ids = [...new Set(mediaIds)];
    const rows = ids.length ? await this.db.select().from(media).where(inArray(media.id, ids)) : [];
    mkdirSync(destDir, { recursive: true });
    const keep = new Set<string>();
    for (const m of rows) for (const f of derivativeFiles(m)) {
      keep.add(f);
      const src = resolve(this.cfg.mediaDir, f);
      if (!existsSync(src)) throw new Error(`Missing image file ${f}. Re-upload the image.`);
      copyFileSync(src, resolve(destDir, f));
    }
    if (prune) for (const f of readdirSync(destDir)) if (MEDIA_FILE.test(f) && !keep.has(f)) rmSync(resolve(destDir, f));
  }

  private verifyLive(entries: Snapshot[], expect: { file: string | null; revisionId: string | null; name: string; removed?: boolean }) {
    const root = this.cfg.siteRoot;
    const listing = readFileSync(resolve(root, 'projects.html'), 'utf8');
    if (expect.removed) {
      if (expect.file && existsSync(resolve(root, expect.file))) throw new Error(`${expect.file} is still on the site.`);
      return;
    }
    if (!listing.includes(expect.name)) throw new Error('The project is missing from projects.html.');
    if (expect.file) {
      const html = readFileSync(resolve(root, expect.file), 'utf8');
      if (!html.includes(`data-studio-rev="${expect.revisionId}"`)) throw new Error(`${expect.file} does not contain the published revision.`);
    }
    if (entries.length && !existsSync(resolve(root, 'sitemap.xml'))) throw new Error('sitemap.xml was not written.');
  }

  private removeOrphanPages(file: string) {
    for (const p of [resolve(this.cfg.siteRoot, file), resolve(this.cfg.siteRoot, 'src/pages', file)]) if (existsSync(p)) rmSync(p);
  }

  /** Writes the live site from the database state. Used to restore the previous state when a delivery fails. */
  private async rebuildFromDb(log: string[]) {
    await this.writeSite();
    log.push(await this.runner(this.cfg, { kind: 'live' }));
  }

  async publish(actor: NonNullable<Actor>, projectId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(projects).where(eq(projects.id, projectId));
      if (!p) throw new AppError(404, 'Project not found.');
      if (p.status !== 'approved' || !p.approvedRevisionId) throw new AppError(409, 'Only an approved project can be published.');
      const [rev] = await this.db.select().from(projectRevisions).where(eq(projectRevisions.id, p.approvedRevisionId));
      const snap = rev.snapshot as unknown as Snapshot;
      const [job] = await this.db.insert(publishJobs).values({ kind: 'publish_project', entityId: projectId, revisionId: rev.id, requestedBy: actor.id }).returning();
      const log: string[] = [];
      const previousFile = p.publishedRevisionId
        ? ((await this.db.select().from(projectRevisions).where(eq(projectRevisions.id, p.publishedRevisionId)))[0]?.snapshot as unknown as Snapshot)?.file ?? null
        : null;
      try {
        const { entries } = await this.writeSite({ project: { projectId, revisionId: rev.id } });
        if (previousFile && previousFile !== snap.file) this.removeOrphanPages(previousFile);
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyLive(entries, { file: snap.file, revisionId: rev.id, name: escapeHtml(snap.name) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        try { await this.rebuildFromDb(log); } catch (e2) { log.push(`Restore also failed: ${(e2 as Error).message}`); }
        await this.db.update(publishJobs).set({ status: 'failed', error: msg, log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(this.db, actor, 'project.publish_failed', { type: 'project', id: projectId }, `Publishing “${p.name}” failed: ${msg}`, { jobId: job.id });
        throw new AppError(409, `Publishing failed, the live site was left as it was. ${msg}`);
      }
      // Delivery verified: now record it.
      await this.db.transaction(async (tx) => {
        await tx.update(projects).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(projects.id, projectId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'project.publish', { type: 'project', id: projectId }, `Published “${p.name}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: snap.file };
    });
  }

  async unpublish(actor: NonNullable<Actor>, projectId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(projects).where(eq(projects.id, projectId));
      if (!p) throw new AppError(404, 'Project not found.');
      if (!p.publishedRevisionId) throw new AppError(409, 'This project is not on the live site.');
      const [rev] = await this.db.select().from(projectRevisions).where(eq(projectRevisions.id, p.publishedRevisionId));
      const snap = rev.snapshot as unknown as Snapshot;
      const [job] = await this.db.insert(publishJobs).values({ kind: 'unpublish_project', entityId: projectId, revisionId: rev.id, requestedBy: actor.id }).returning();
      const log: string[] = [];
      try {
        const { entries } = await this.writeSite({ project: { projectId, revisionId: null } });
        if (snap.file) this.removeOrphanPages(snap.file);
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyLive(entries, { file: snap.file, revisionId: null, name: snap.name, removed: true });
      } catch (e) {
        const msg = (e as Error).message;
        try { await this.rebuildFromDb(log); } catch (e2) { log.push(`Restore also failed: ${(e2 as Error).message}`); }
        await this.db.update(publishJobs).set({ status: 'failed', error: msg, log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        throw new AppError(409, `Unpublishing failed, the live site was left as it was. ${msg}`);
      }
      await this.db.transaction(async (tx) => {
        await tx.update(projects).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(projects.id, projectId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'project.unpublish', { type: 'project', id: projectId }, `Unpublished “${p.name}”`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Renders the working copy with the real templates into an isolated folder. Nothing touches the live site. */
  async preview(projectId: string) {
    return this.locked(async () => {
      const full = await loadProject(this.db, projectId);
      const snap = escapeSnapshot(toSnapshot(full));
      if (Object.keys(snap.detail).length) (snap.detail as Record<string, unknown>).revision = 'preview';
      const entries = (await this.liveEntries({ projectId, revisionId: null })).concat(snap).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, entries);
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir });
      const file = snap.file ?? 'projects.html';
      if (!existsSync(resolve(outDir, file))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file, mediaIds: snap.media };
    });
  }

  previewPath(token: string, file: string) {
    if (!/^[0-9a-f]{32}$/.test(token) || !/^[a-z0-9-]+\.html$/.test(file)) return null;
    const p = resolve(this.cfg.previewDir, token, 'site', file);
    return existsSync(p) ? p : null;
  }

  private cleanupPreviews() {
    if (!existsSync(this.cfg.previewDir)) return;
    for (const d of readdirSync(this.cfg.previewDir)) {
      const p = resolve(this.cfg.previewDir, d);
      if (Date.now() - statSync(p).mtimeMs > 60 * 60 * 1000) rmSync(p, { recursive: true, force: true });
    }
  }

  // ---------------------------------------------------------------- Pages
  private async deliver(kind: string, actor: NonNullable<Actor>, entityId: string, revisionId: string, apply: (log: string[]) => Promise<void>, failLabel: string) {
    const [job] = await this.db.insert(publishJobs).values({ kind, entityId, revisionId, requestedBy: actor.id }).returning();
    const log: string[] = [];
    try { await apply(log); }
    catch (e) {
      const msg = (e as Error).message;
      try { await this.rebuildFromDb(log); } catch (e2) { log.push(`Restore also failed: ${(e2 as Error).message}`); }
      await this.db.update(publishJobs).set({ status: 'failed', error: msg, log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
      await audit(this.db, actor, `${kind}_failed`, { type: 'page', id: entityId }, `${failLabel}: ${msg}`, { jobId: job.id });
      throw new AppError(409, `${failLabel}, the live site was left as it was. ${msg}`);
    }
    return { job, log };
  }

  async publishPage(actor: NonNullable<Actor>, pageId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(pages).where(eq(pages.id, pageId));
      if (!p) throw new AppError(404, 'Page not found.');
      if (p.status !== 'approved' || !p.approvedRevisionId) throw new AppError(409, 'Only an approved page can be published.');
      const [rev] = await this.db.select().from(pageRevisions).where(eq(pageRevisions.id, p.approvedRevisionId));
      const snap = rev.snapshot as unknown as PageSnapshot;
      const { job, log } = await this.deliver('publish_page', actor, pageId, rev.id, async (log) => {
        await this.writeSite({ page: { pageId, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        const out = resolve(this.cfg.siteRoot, `${snap.slug}.html`);
        if (!existsSync(out) || !readFileSync(out, 'utf8').includes(`data-studio-page-rev="${rev.id}"`)) throw new Error(`${snap.slug}.html does not contain the published revision.`);
        if (!snap.noindex && !readFileSync(resolve(this.cfg.siteRoot, 'sitemap.xml'), 'utf8').includes(`${snap.slug}.html`)) throw new Error('The page is missing from sitemap.xml.');
      }, `Publishing “${p.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(pages).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(pages.id, pageId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'page.publish', { type: 'page', id: pageId }, `Published page “${p.title}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: `${snap.slug}.html` };
    });
  }

  async unpublishPage(actor: NonNullable<Actor>, pageId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(pages).where(eq(pages.id, pageId));
      if (!p) throw new AppError(404, 'Page not found.');
      if (!p.publishedRevisionId) throw new AppError(409, 'This page is not on the live site.');
      const [rev] = await this.db.select().from(pageRevisions).where(eq(pageRevisions.id, p.publishedRevisionId));
      const slug = (rev.snapshot as unknown as PageSnapshot).slug;
      const { job, log } = await this.deliver('unpublish_page', actor, pageId, rev.id, async (log) => {
        this.removeOrphanPages(`${slug}.html`);
        await this.writeSite({ page: { pageId, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        if (existsSync(resolve(this.cfg.siteRoot, `${slug}.html`))) throw new Error(`${slug}.html is still on the site.`);
      }, `Unpublishing “${p.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(pages).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(pages.id, pageId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'page.unpublish', { type: 'page', id: pageId }, `Unpublished page “${p.title}”`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Full preview of the saved working copy through the real build (isolated folder). */
  async previewPage(pageId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(pages).where(eq(pages.id, pageId));
      if (!p) throw new AppError(404, 'Page not found.');
      const snap = { ...snapshotOf(p), doc: validateDoc(p.doc).doc };
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      const ctx = await buildCtx(this.db, [snap.doc]);
      writeFileSync(resolve(pagesDir, `${snap.slug}.html`), pageSource(snap, ctx, 'preview'));
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, only: 'pages' });
      if (!existsSync(resolve(outDir, `${snap.slug}.html`))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file: `${snap.slug}.html` };
    });
  }

  /** Instant canvas for the builder from an unsaved document (no build, no files). */
  async canvas(snap: PageSnapshot) {
    const doc = validateDoc(snap.doc).doc;
    const ctx = await buildCtx(this.db, [doc], { editor: true });
    return canvasHtml(this.cfg, { ...snap, doc }, ctx);
  }

  // ---------------------------------------------------------------- News & Stories
  /** Publishes the approved revision. `actor` is null when the scheduler publishes a scheduled story. */
  async publishArticle(actor: Actor, articleId: string, opts: { scheduled?: boolean } = {}) {
    return this.locked(async () => {
      const [a] = await this.db.select().from(articles).where(eq(articles.id, articleId));
      if (!a) throw new AppError(404, 'Story not found.');
      const ok = opts.scheduled ? a.status === 'scheduled' : a.status === 'approved';
      if (!ok || !a.approvedRevisionId) throw new AppError(409, opts.scheduled ? 'This story is no longer scheduled.' : 'Only an approved story can be published.');
      const [rev] = await this.db.select().from(articleRevisions).where(eq(articleRevisions.id, a.approvedRevisionId));
      const snap = rev.snapshot as unknown as ArticleSnapshot;
      const file = articleFile(snap);
      const [job] = await this.db.insert(publishJobs).values({ kind: opts.scheduled ? 'publish_article_scheduled' : 'publish_article', entityId: articleId, revisionId: rev.id, requestedBy: actor?.id ?? null }).returning();
      const log: string[] = [];
      try {
        await this.writeSite({ article: { articleId, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        const listing = readFileSync(resolve(this.cfg.siteRoot, 'news.html'), 'utf8');
        if (!listing.includes(escapeHtml(snap.title))) throw new Error('The story is missing from news.html.');
        if (file && !readFileSync(resolve(this.cfg.siteRoot, file), 'utf8').includes(`data-studio-article-rev="${rev.id}"`)) throw new Error(`${file} does not contain the published revision.`);
      } catch (e) {
        const msg = (e as Error).message;
        try { await this.rebuildFromDb(log); } catch (e2) { log.push(`Restore also failed: ${(e2 as Error).message}`); }
        await this.db.update(publishJobs).set({ status: 'failed', error: msg, log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        if (opts.scheduled) await this.db.update(articles).set({ status: 'approved', scheduledAt: null }).where(eq(articles.id, articleId));
        await audit(this.db, actor, 'news.publish_failed', { type: 'article', id: articleId }, `Publishing “${a.title}” failed: ${msg}`, { jobId: job.id, scheduled: !!opts.scheduled });
        throw new AppError(409, `Publishing failed, the live site was left as it was. ${msg}`);
      }
      await this.db.transaction(async (tx) => {
        await tx.update(articles).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, scheduledAt: null, updatedAt: new Date() }).where(eq(articles.id, articleId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'news.publish', { type: 'article', id: articleId }, `${opts.scheduled ? 'Scheduled publish' : 'Published'} “${a.title}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file };
    });
  }

  async unpublishArticle(actor: NonNullable<Actor>, articleId: string) {
    return this.locked(async () => {
      const [a] = await this.db.select().from(articles).where(eq(articles.id, articleId));
      if (!a) throw new AppError(404, 'Story not found.');
      if (!a.publishedRevisionId) throw new AppError(409, 'This story is not on the live site.');
      const [rev] = await this.db.select().from(articleRevisions).where(eq(articleRevisions.id, a.publishedRevisionId));
      const file = articleFile(rev.snapshot as unknown as ArticleSnapshot);
      const [job] = await this.db.insert(publishJobs).values({ kind: 'unpublish_article', entityId: articleId, revisionId: rev.id, requestedBy: actor.id }).returning();
      const log: string[] = [];
      try {
        if (file) this.removeOrphanPages(file);
        await this.writeSite({ article: { articleId, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        if (file && existsSync(resolve(this.cfg.siteRoot, file))) throw new Error(`${file} is still on the site.`);
      } catch (e) {
        const msg = (e as Error).message;
        try { await this.rebuildFromDb(log); } catch (e2) { log.push(`Restore also failed: ${(e2 as Error).message}`); }
        await this.db.update(publishJobs).set({ status: 'failed', error: msg, log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        throw new AppError(409, `Unpublishing failed, the live site was left as it was. ${msg}`);
      }
      await this.db.transaction(async (tx) => {
        await tx.update(articles).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(articles.id, articleId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'news.unpublish', { type: 'article', id: articleId }, `Unpublished “${a.title}”`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Builds the saved working copy (article page + listing) in an isolated folder. */
  async previewArticle(articleId: string) {
    return this.locked(async () => {
      const snap = toArticleSnapshot(await loadArticle(this.db, articleId));
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      const live = (await this.liveArticles({ articleId, revisionId: null })).concat({ id: 'preview', snap })
        .sort((a, b) => b.snap.publishDate.localeCompare(a.snap.publishDate));
      await this.writeNews(resolve(dir, 'news.json'), pagesDir, live);
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, newsFile: resolve(dir, 'news.json') });
      const file = articleFile(snap) ?? 'news.html';
      if (!existsSync(resolve(outDir, file))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file };
    });
  }

  /** Publishes stories whose scheduled time has come. Safe to call repeatedly (status check inside the lock). */
  async runScheduled(now = new Date()) {
    const due = await this.db.select({ id: articles.id }).from(articles).where(and(eq(articles.status, 'scheduled'), lte(articles.scheduledAt, now)));
    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const d of due) {
      try { await this.publishArticle(null, d.id, { scheduled: true }); results.push({ id: d.id, ok: true }); }
      catch (e) { results.push({ id: d.id, ok: false, error: (e as Error).message }); }
    }
    return results;
  }

  async recentJobs(limit = 10) {
    return this.db.select().from(publishJobs).orderBy(desc(publishJobs.createdAt)).limit(limit);
  }
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** The public generator inserts these strings into HTML as-is, so every editor-supplied text is escaped on export. */
export function escapeSnapshot(s: Snapshot): Snapshot {
  const d = s.detail as Record<string, unknown> & { facts?: [string, string][]; rows?: [string, string][]; hero?: { alt: string } | null; gallery?: { alt: string }[] };
  const e = escapeHtml;
  return {
    ...s, name: e(s.name), category: e(s.category), summary: e(s.summary),
    seo: { title: e(s.seo?.title ?? ''), description: e(s.seo?.description ?? '') },
    detail: Object.keys(d).length ? {
      ...d, lede: e(String(d.lede ?? '')), photo: e(String(d.photo ?? '')),
      facts: (d.facts ?? []).map(([k, v]) => [e(k), e(v)]),
      rows: (d.rows ?? []).map(([k, v]) => [e(k), e(v)]),
      // media_img escapes alt itself; keep alt raw here to avoid double escaping
    } : {},
  };
}
