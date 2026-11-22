// Delivery to the public website. Exports published revisions as JSON, copies approved image derivatives, runs the existing
// generator (src/content.py) and build (build.mjs + Tailwind), then VERIFIES the output before the database records success.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { desc, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, projects, projectRevisions, publishJobs } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { derivativeFiles } from '../media/service.ts';
import { loadProject, toSnapshot, type Snapshot } from '../projects/service.ts';

const run = promisify(execFile);
const MEDIA_FILE = /^[0-9a-f]{24}-\d+\.webp$/;

export type BuildRunner = (cfg: Config, mode: { kind: 'live' } | { kind: 'preview'; dataFile: string; pagesDir: string; outDir: string }) => Promise<string>;

/** Default runner: the real generator and build. Tests inject a fake. */
export const realRunner: BuildRunner = async (cfg, mode) => {
  const opts = { cwd: cfg.siteRoot, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 };
  if (mode.kind === 'live') {
    const a = await run('python3', ['-I', 'src/content.py'], { ...opts, env: { ...process.env } });
    const b = await run('npm', ['run', 'build'], { ...opts, env: { ...process.env } });
    return [a.stdout, b.stdout, b.stderr].join('\n');
  }
  const env = { ...process.env, STUDIO_PROJECTS_JSON: mode.dataFile, STUDIO_OUT: mode.pagesDir, PAGES_DIR: mode.pagesDir, OUT_DIR: mode.outDir };
  const a = await run('python3', ['-I', 'src/content.py'], { ...opts, env });
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

  private async copyMedia(entries: Snapshot[], destDir: string, prune: boolean) {
    const ids = [...new Set(entries.flatMap((e) => e.media ?? []))];
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
    const entries = await this.liveEntries();
    this.writeData(this.dataFile, entries);
    await this.copyMedia(entries, resolve(this.cfg.siteRoot, 'assets/media'), true);
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
        const entries = await this.liveEntries({ projectId, revisionId: rev.id });
        this.writeData(this.dataFile, entries);
        await this.copyMedia(entries, resolve(this.cfg.siteRoot, 'assets/media'), true);
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
        const entries = await this.liveEntries({ projectId, revisionId: null });
        this.writeData(this.dataFile, entries);
        await this.copyMedia(entries, resolve(this.cfg.siteRoot, 'assets/media'), true);
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
