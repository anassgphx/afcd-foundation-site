// Delivery to the public website. Exports published revisions as JSON, copies approved image derivatives, runs the existing
// generator (src/content.py) and build (build.mjs + Tailwind), then VERIFIES the output before the database records success.
import { confirmPublic } from './public-check.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNotNull, lte } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { media, pages, pageRevisions, projects, projectRevisions, publishJobs } from '../../db/schema.ts';
import { buildCtx, canvasHtml, docMediaIds, pageSource, type PageSnapshot } from '../pages/render.ts';
import { snapshotOf } from '../pages/service.ts';
import { validateDoc } from '../pages/blocks.ts';
import { articles, articleRevisions } from '../../db/schema.ts';
import { articleFile, articleSource, bodyMediaIds, listingEntry, newsCtx, type ArticleSnapshot } from '../news/render.ts';
import { loadArticle, toArticleSnapshot } from '../news/service.ts';
import { partners, partnerRevisions, events, eventRevisions, opportunities, opportunityRevisions, seoOverrides, seoRevisions } from '../../db/schema.ts';
import type { OverrideSnapshot } from '../seo/service.ts';
import { pageContents, pageContentRevisions } from '../../db/schema.ts';
import { HOME, TEXT_PAGES, valueMediaIds } from '../home/service.ts';
import { exportLayout, resolveFieldValues } from '../home/render.ts';
import { currentLayout, layoutBlocks, type LayoutEntry } from '../home/layout.ts';
import { publicRef } from '../media/service.ts';
import { detailSource, listingSource, oppCtx, oppState, opportunityFile, type LiveOpp } from '../opportunities/render.ts';
import type { OpportunitySnapshot } from '../opportunities/service.ts';
import { publications, publicationRevisions, documents } from '../../db/schema.ts';
import { detailSource as pubDetailSource, listingSource as pubListingSource, pubAssets, pubCtx, publicationFile, PUBLIC_DOC_DIR, type LivePub } from '../publications/render.ts';
import { DOC_FILE, documentFile, documentPath, type DocumentRow } from '../publications/documents.ts';
import { TYPE_LABEL as PUB_TYPE_LABEL, type PublicationSnapshot } from '../publications/service.ts';
import { eventEntries, eventFile, isUpcoming } from '../events/render.ts';
import type { EventSnapshot } from '../events/service.ts';
import { partnerEntries } from '../partners/render.ts';
import { pillars, pillarRevisions } from '../../db/schema.ts';
import { pillarEntries } from '../pillars/render.ts';
import { VIDEO_FILE, videosDir } from '../pillars/video.ts';
import type { PillarSnapshot } from '../pillars/service.ts';
import type { PartnerSnapshot } from '../partners/service.ts';
import { aboutPages, aboutPageRevisions, objectives } from '../../db/schema.ts';
import { aboutEntries, type LiveAbout } from '../about/render.ts';
import { ABOUT_META, type AboutKey, type AboutSnapshot } from '../about/service.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { derivativeFiles } from '../media/service.ts';
import { loadProject, toSnapshot, type Snapshot } from '../projects/service.ts';
import { redirects } from '../../db/schema.ts';
import { checkRedirect, redirectsFile, stubHtml, STUB_MARK, REDIRECTS_HEADER } from '../seo/redirects.ts';
import { siteUrl } from '../seo/site.ts';
import type { Role } from '../../rbac.ts';
import { seoSettings } from '../../db/schema.ts';
import { buildSchemaFile, KEY as SCHEMA_KEY, settingsSchema, type LiveForSchema, type SchemaSettings } from '../seo/schema.ts';
import * as TR from '../translations/service.ts';
import * as MENU from '../menus/service.ts';
import * as SET from '../settings/service.ts';

const run = promisify(execFile);
const MEDIA_FILE = /^[0-9a-f]{24}-\d+\.webp$/;

export type BuildRunner = (cfg: Config, mode: { kind: 'live' } | { kind: 'preview'; dataFile: string; pagesDir: string; outDir: string; only?: 'pages'; newsFile?: string; partnersFile?: string; eventsFile?: string; fieldsFile?: string; pillarsFile?: string; aboutFile?: string }) => Promise<string>;

/** Default runner: the real generator and build. Tests inject a fake. */
export const realRunner: BuildRunner = async (cfg, mode) => {
  const opts = { cwd: cfg.siteRoot, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 };
  if (mode.kind === 'live') {
    const a = await run('python3', ['-I', 'src/content.py'], { ...opts, env: { ...process.env } });
    const b = await run('npm', ['run', 'build'], { ...opts, env: { ...process.env } });
    return [a.stdout, b.stdout, b.stderr].join('\n');
  }
  const env = { ...process.env, STUDIO_PROJECTS_JSON: mode.dataFile, STUDIO_OUT: mode.pagesDir, PAGES_DIR: mode.pagesDir, OUT_DIR: mode.outDir, ...(mode.newsFile ? { STUDIO_NEWS_JSON: mode.newsFile } : {}), ...(mode.partnersFile ? { STUDIO_PARTNERS_JSON: mode.partnersFile } : {}), ...(mode.eventsFile ? { STUDIO_EVENTS_JSON: mode.eventsFile } : {}), ...(mode.fieldsFile ? { PAGE_FIELDS_JSON: mode.fieldsFile } : {}), ...(mode.pillarsFile ? { STUDIO_PILLARS_JSON: mode.pillarsFile } : {}), ...(mode.aboutFile ? { STUDIO_ABOUT_JSON: mode.aboutFile } : {}) };
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
  async liveEntries(override?: { projectId: string; revisionId: string | null }, pubOverride?: { publicationId: string; revisionId: string | null }) {
    const live = await this.db.select({ id: projects.id, rev: projects.publishedRevisionId }).from(projects).where(isNotNull(projects.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.projectId, override.revisionId); else map.delete(override.projectId); }
    if (!map.size) return [];
    const revs = await this.db.select().from(projectRevisions).where(inArray(projectRevisions.id, [...map.values()]));
    const pubs = await this.livePublications(pubOverride);   // a project's outputs: the published publications that list it (including one being published or removed now)
    // their PDFs, for a direct "Download PDF" next to each one (the same file the publication page offers)
    const dIds = [...new Set(pubs.map((p) => p.snap.documentId).filter(Boolean) as string[])];
    const pdfOf = new Map((dIds.length ? await this.db.select().from(documents).where(inArray(documents.id, dIds)) : []).map((d) => [d.id, `${PUBLIC_DOC_DIR}/${documentFile(d)}`]));
    return revs.map((r) => {
      const s = escapeSnapshot(structuredClone(r.snapshot) as unknown as Snapshot);
      if (s.detail && Object.keys(s.detail).length) {
        const d = s.detail as Record<string, unknown>; d.revision = r.id;
        const ref = (p: LivePub) => ({ title: escapeHtml(p.snap.title), type: escapeHtml(PUB_TYPE_LABEL[p.snap.type] ?? 'Publication'), file: publicationFile(p.snap.slug), year: (p.snap.publishedOn ?? '').slice(0, 4),
          ...(p.snap.documentId && pdfOf.get(p.snap.documentId) ? { pdf: pdfOf.get(p.snap.documentId), slug: p.snap.slug } : {}) });
        // publications linked to an activity: shown under it, live ones only (a draft or unpublished one is left out)
        const acts = (d.activities ?? []) as { publications?: string[] }[];
        const bySlug = new Map(pubs.map((p) => [p.snap.slug, p]));
        for (const a of acts) {
          const list = (a.publications ?? []).map((sl) => bySlug.get(sl)).filter((p): p is LivePub => !!p).map(ref);
          if (list.length) (a as Record<string, unknown>).publications = list; else delete a.publications;
        }
        const fromActs = new Set(acts.flatMap((a) => ((a.publications ?? []) as unknown as { file: string }[]).map((x) => x.file)));
        // the project's Publications section: those that list the project, plus those linked to its activities
        const outs = pubs.filter((p) => p.snap.projectSlugs.includes(s.slug) || fromActs.has(publicationFile(p.snap.slug)))
          .sort((a, b) => (b.snap.publishedOn ?? '').localeCompare(a.snap.publishedOn ?? ''))
          .map(ref);
        if (outs.length) d.outputs = outs;
      }
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
    return live.flatMap((x) => [x.snap.heroMediaId, ...x.snap.galleryMediaIds, ...bodyMediaIds(x.snap.body)].filter(Boolean) as string[]);
  }

  get newsFile() { return resolve(this.cfg.siteRoot, 'src/data/news.json'); }

  get partnersFile() { return resolve(this.cfg.siteRoot, 'src/data/partners.json'); }

  /** Live partners (optionally overriding one). */
  async livePartners(override?: { partnerId: string; revisionId: string | null }) {
    const live = await this.db.select({ id: partners.id, rev: partners.publishedRevisionId }).from(partners).where(isNotNull(partners.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.partnerId, override.revisionId); else map.delete(override.partnerId); }
    if (!map.size) return [] as { id: string; snap: PartnerSnapshot }[];
    const revs = await this.db.select().from(partnerRevisions).where(inArray(partnerRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as PartnerSnapshot }));
  }

  /** partners.json is only written once partner records exist in Studio, so the site keeps its own list until the import. Returns logo media ids. */
  private async writePartners(file: string, override?: { partnerId: string; revisionId: string | null }, projectOverride?: { projectId: string; revisionId: string | null }) {
    if (!(await this.db.select({ id: partners.id }).from(partners).limit(1)).length) return [] as string[];
    const live = await this.livePartners(override);
    const list = await partnerEntries(this.db, live, { projectOverride });
    mkdirSync(resolve(file, '..'), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), partners: list }, null, 2) + '\n'); renameSync(tmp, file);
    return live.map((x) => x.snap.logoMediaId).filter(Boolean) as string[];
  }

  get pillarsFile() { return resolve(this.cfg.siteRoot, 'src/data/pillars.json'); }

  /** Live pillar revisions (optionally overriding one). */
  async livePillars(override?: { pillarId: string; revisionId: string | null }) {
    const rows = await this.db.select({ id: pillars.id, rev: pillars.publishedRevisionId, draft: pillars.draft, sort: pillars.sort }).from(pillars);
    // Until the current pillar content is imported into Studio, the site keeps the pillars written in src/content.py.
    if (!rows.length || rows.some((r) => !r.draft)) return null;
    const map = new Map(rows.filter((r) => r.rev).map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.pillarId, override.revisionId); else map.delete(override.pillarId); }
    if (!map.size) return null;
    const revs = await this.db.select().from(pillarRevisions).where(inArray(pillarRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as PillarSnapshot, sort: rows.find((x) => x.id === r.pillarId)?.sort ?? 0 }));
  }

  /** pillars.json exists once the pillar content is in Studio, and lists the live pillars in their order. Returns photo ids. */
  private async writePillars(file: string, override?: { pillarId: string; revisionId: string | null }) {
    const live = await this.livePillars(override);
    if (!live) { if (existsSync(file)) rmSync(file); return [] as string[]; }
    const list = await pillarEntries(this.db, live);
    mkdirSync(resolve(file, '..'), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), pillars: list }, null, 2) + '\n'); renameSync(tmp, file);
    this.copyVideos(live.flatMap((x) => (x.snap.video?.kind === 'file' ? [x.snap.video.file] : [])));
    return live.flatMap((x) => [x.snap.mediaId, x.snap.workMediaId ?? null, ...(x.snap.objectivesMediaIds ?? [])]).filter(Boolean) as string[];
  }

  /** Uploaded pillar videos go to assets/media/video/; videos no live pillar uses any more are removed there. */
  private copyVideos(files: string[]) {
    const dest = resolve(this.cfg.siteRoot, 'assets/media/video');
    const keep = new Set(files.filter((f) => VIDEO_FILE.test(f)));
    if (keep.size) mkdirSync(dest, { recursive: true });
    for (const f of keep) {
      const src = resolve(videosDir(this.cfg), f);
      if (!existsSync(src)) throw new Error(`Missing video file ${f}. Upload the video again.`);
      const out = resolve(dest, f);
      if (!existsSync(out) || statSync(out).size !== statSync(src).size) copyFileSync(src, out);
    }
    if (existsSync(dest)) for (const f of readdirSync(dest)) if (VIDEO_FILE.test(f) && !keep.has(f)) rmSync(resolve(dest, f));
  }

  get aboutFile() { return resolve(this.cfg.siteRoot, 'src/data/about.json'); }

  /** Live About page revisions (optionally overriding one). */
  async liveAbout(override?: { pageId: string; revisionId: string | null }): Promise<LiveAbout[]> {
    const rows = await this.db.select({ id: aboutPages.id, rev: aboutPages.publishedRevisionId }).from(aboutPages);
    const map = new Map(rows.filter((r) => r.rev).map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.pageId, override.revisionId); else map.delete(override.pageId); }
    if (!map.size) return [];
    const revs = await this.db.select().from(aboutPageRevisions).where(inArray(aboutPageRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as AboutSnapshot }));
  }

  /** about.json lists the About pages published from Studio; without any, the generator keeps its built-in text. */
  private async writeAbout(file: string, live: LiveAbout[]) {
    if (!live.length) { if (existsSync(file)) rmSync(file); return [] as string[]; }
    const { pages: list, mediaIds } = await aboutEntries(this.db, live);
    mkdirSync(resolve(file, '..'), { recursive: true });
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), pages: list }, null, 2) + '\n'); renameSync(tmp, file);
    return mediaIds;
  }

  get eventsFile() { return resolve(this.cfg.siteRoot, 'src/data/events.json'); }

  /** Live events (optionally overriding one). */
  async liveEvents(override?: { eventId: string; revisionId: string | null }) {
    const live = await this.db.select({ id: events.id, rev: events.publishedRevisionId }).from(events).where(isNotNull(events.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.eventId, override.revisionId); else map.delete(override.eventId); }
    if (!map.size) return [] as { id: string; snap: EventSnapshot }[];
    const revs = await this.db.select().from(eventRevisions).where(inArray(eventRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as EventSnapshot }));
  }

  /** events.json exists only while at least one Studio event is live; otherwise the site shows its own sample list.
   *  Event pages that no longer belong to the list are removed (the generator recreates the right ones). Returns poster media ids. */
  private async writeEvents(file: string, override?: { eventId: string; revisionId: string | null }, projectOverride?: { projectId: string; revisionId: string | null }) {
    const live = await this.liveEvents(override);
    const list = live.length ? await eventEntries(this.db, live, { projectOverride }) : [];
    if (!list.length) { if (existsSync(file)) rmSync(file); }
    else {
      mkdirSync(resolve(file, '..'), { recursive: true });
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), events: list }, null, 2) + '\n'); renameSync(tmp, file);
    }
    // pages of events that are no longer live go too, also when none is left (else the last unpublished event's page lingers)
    const keep = new Set(list.map((e) => eventFile(e.slug)));
    for (const dir of [this.cfg.siteRoot, resolve(this.cfg.siteRoot, 'src/pages')]) {
      if (existsSync(dir)) for (const f of readdirSync(dir)) if (/^event-[a-z0-9-]+\.html$/.test(f) && !keep.has(f)) rmSync(resolve(dir, f));
    }
    return live.map((x) => x.snap.posterMediaId).filter(Boolean) as string[];
  }

  /** Live opportunities (optionally overriding one). */
  async liveOpportunities(override?: { opportunityId: string; revisionId: string | null }): Promise<LiveOpp[]> {
    const live = await this.db.select({ id: opportunities.id, rev: opportunities.publishedRevisionId }).from(opportunities).where(isNotNull(opportunities.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.opportunityId, override.revisionId); else map.delete(override.opportunityId); }
    if (!map.size) return [];
    const revs = await this.db.select().from(opportunityRevisions).where(inArray(opportunityRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as OpportunitySnapshot }));
  }

  /** Writes opportunities.html and one page per opportunity into `pagesDir`. With nothing live, the pages are removed
   *  (also from `outDirs`), so the site has no empty listing. Stale opportunity pages are always removed. Returns image ids. */
  private async writeOpportunities(pagesDir: string, outDirs: string[], live: LiveOpp[], projectOverride?: { projectId: string; revisionId: string | null }) {
    const keep = new Set(live.length ? ['opportunities.html', ...live.map((o) => opportunityFile(o.snap.slug))] : []);
    for (const dir of [pagesDir, ...outDirs]) {
      if (existsSync(dir)) for (const f of readdirSync(dir)) if ((f === 'opportunities.html' || /^opportunity-[a-z0-9-]+\.html$/.test(f)) && !keep.has(f)) rmSync(resolve(dir, f));
    }
    if (!live.length) return [] as string[];
    const ctx = await oppCtx(this.db, live.map((o) => o.snap), { projectOverride });
    mkdirSync(pagesDir, { recursive: true });
    const write = (f: string, src: string) => { const file = resolve(pagesDir, f); const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`; writeFileSync(tmp, src); renameSync(tmp, file); };
    write('opportunities.html', listingSource(live, ctx));
    for (const o of live) write(opportunityFile(o.snap.slug), detailSource(o, ctx));
    return live.map((o) => o.snap.heroMediaId).filter(Boolean) as string[];
  }

  /** Live publications (optionally overriding one). */
  async livePublications(override?: { publicationId: string; revisionId: string | null }): Promise<LivePub[]> {
    const live = await this.db.select({ id: publications.id, rev: publications.publishedRevisionId }).from(publications).where(isNotNull(publications.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.publicationId, override.revisionId); else map.delete(override.publicationId); }
    if (!map.size) return [];
    const revs = await this.db.select().from(publicationRevisions).where(inArray(publicationRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as PublicationSnapshot }));
  }

  /** Writes publications.html and one page per publication into `pagesDir`, like opportunities: with nothing live the
   *  pages are removed (also from `outDirs`), and stale publication pages are always removed. Returns the files they need. */
  private async writePublications(pagesDir: string, outDirs: string[], live: LivePub[], projectOverride?: { projectId: string; revisionId: string | null }) {
    const keep = new Set(live.length ? ['publications.html', ...live.map((p) => publicationFile(p.snap.slug))] : []);
    for (const dir of [pagesDir, ...outDirs]) {
      if (existsSync(dir)) for (const f of readdirSync(dir)) if ((f === 'publications.html' || /^publication-[a-z0-9-]+\.html$/.test(f)) && !keep.has(f)) rmSync(resolve(dir, f));
    }
    if (!live.length) return { mediaIds: [] as string[], docs: [] as DocumentRow[] };
    const ctx = await pubCtx(this.db, live.map((p) => p.snap), { projectOverride });
    mkdirSync(pagesDir, { recursive: true });
    const write = (f: string, src: string) => { const file = resolve(pagesDir, f); const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`; writeFileSync(tmp, src); renameSync(tmp, file); };
    write('publications.html', pubListingSource(live, ctx));
    for (const p of live) write(publicationFile(p.snap.slug), pubDetailSource(p, ctx));
    return pubAssets(live, ctx);
  }

  /** Copies the PDFs of live publications to assets/documents/ (prune: removes PDFs no live publication uses). */
  private copyDocuments(docs: DocumentRow[], destDir: string, prune: boolean) {
    const keep = new Set<string>();
    if (docs.length) mkdirSync(destDir, { recursive: true });
    for (const d of docs) {
      const src = documentPath(this.cfg, d);
      if (!existsSync(src)) throw new Error(`Missing PDF file for “${d.originalName}”. Upload it again.`);
      keep.add(documentFile(d));
      copyFileSync(src, resolve(destDir, documentFile(d)));
    }
    if (prune && existsSync(destDir)) for (const f of readdirSync(destDir)) if (DOC_FILE.test(f) && !keep.has(f)) rmSync(resolve(destDir, f));
  }

  get seoFile() { return resolve(this.cfg.siteRoot, 'src/data/seo.json'); }

  async liveSeo(override?: { overrideId: string; revisionId: string | null }) {
    const live = await this.db.select({ id: seoOverrides.id, rev: seoOverrides.publishedRevisionId }).from(seoOverrides).where(isNotNull(seoOverrides.publishedRevisionId));
    const map = new Map(live.map((r) => [r.id, r.rev as string]));
    if (override) { if (override.revisionId) map.set(override.overrideId, override.revisionId); else map.delete(override.overrideId); }
    if (!map.size) return [] as { id: string; snap: OverrideSnapshot }[];
    const revs = await this.db.select().from(seoRevisions).where(inArray(seoRevisions.id, [...map.values()]));
    return revs.map((r) => ({ id: r.id, snap: r.snapshot as unknown as OverrideSnapshot }));
  }

  /** seo.json (read by build.mjs) exists only while an SEO override is live. Values are plain text; build.mjs escapes them. */
  private async writeSeo(override?: { overrideId: string; revisionId: string | null }) {
    const live = await this.liveSeo(override);
    if (!live.length) { if (existsSync(this.seoFile)) rmSync(this.seoFile); return [] as string[]; }
    const ids = [...new Set(live.map((x) => x.snap.imageMediaId).filter(Boolean) as string[])];
    const rows = ids.length ? await this.db.select().from(media).where(inArray(media.id, ids)) : [];
    const pagesOut: Record<string, unknown> = {};
    for (const { id, snap: s } of live) {
      const m = rows.find((r) => r.id === s.imageMediaId);
      const ref = m ? publicRef(m, 'assets/media/') : null;
      pagesOut[s.file] = { title: s.title || undefined, description: s.description || undefined, noindex: s.noindex || undefined,
        image: ref ? { src: ref.src, w: ref.w, h: ref.h, alt: m!.alt } : undefined, revision: id };
    }
    const tmp = `${this.seoFile}.${randomBytes(4).toString('hex')}.tmp`;
    mkdirSync(resolve(this.seoFile, '..'), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), pages: pagesOut }, null, 2) + '\n'); renameSync(tmp, this.seoFile);
    return ids;
  }

  get fieldsFile() { return resolve(this.cfg.siteRoot, 'src/data/page-fields.json'); }

  /** Resolves stored values for build.mjs: images become { src, srcset, w, h, alt, fx, fy }. Returns [values, media ids]. */
  private async resolveFields(values: Record<string, unknown>): Promise<[Record<string, unknown>, string[]]> {
    return [await resolveFieldValues(this.db, values), valueMediaIds(values)];
  }

  /** page-fields.json (read by build.mjs) exists only while edited text of a Studio-edited page (TEXT_PAGES) is live.
   *  `override` replaces one page's live revision (null = that page back to its own text). */
  private async writeFields(override?: { file?: string; revisionId: string | null }, ctxOpts: Parameters<typeof exportLayout>[2] = {}) {
    const rows = await this.db.select().from(pageContents);
    const pagesOut: Record<string, unknown> = {}; const ids: string[] = [];
    for (const file of Object.keys(TEXT_PAGES)) {
      const c = rows.find((r) => r.file === file);
      const revId = override && (override.file ?? HOME) === file ? override.revisionId : c?.publishedRevisionId ?? null;
      if (!revId) continue;
      const [rev] = await this.db.select().from(pageContentRevisions).where(eq(pageContentRevisions.id, revId));
      const snap = rev.snapshot as { values: Record<string, unknown>; layout?: unknown };
      const [values, fieldIds] = await this.resolveFields(snap.values);
      const layout = snap.layout && TEXT_PAGES[file].layout ? currentLayout(this.cfg.siteRoot, file, snap.layout) : null;
      const exported = await exportLayout(this.db, layout, ctxOpts);
      ids.push(...fieldIds, ...(layout ? docMediaIds({ blocks: layoutBlocks(layout) }) : []));
      pagesOut[file] = { revision: revId, fields: values, ...(exported ? { layout: exported } : {}) };
    }
    if (!Object.keys(pagesOut).length) { if (existsSync(this.fieldsFile)) rmSync(this.fieldsFile); return [] as string[]; }
    const tmp = `${this.fieldsFile}.${randomBytes(4).toString('hex')}.tmp`;
    mkdirSync(resolve(this.fieldsFile, '..'), { recursive: true });
    writeFileSync(tmp, JSON.stringify({ version: 1, source: 'AFCD Studio', generatedAt: new Date().toISOString(), pages: pagesOut }, null, 2) + '\n'); renameSync(tmp, this.fieldsFile);
    return ids;
  }

  private async writeSite(o: { project?: { projectId: string; revisionId: string | null }; page?: { pageId: string; revisionId: string | null }; article?: { articleId: string; revisionId: string | null }; partner?: { partnerId: string; revisionId: string | null }; pillar?: { pillarId: string; revisionId: string | null }; about?: { pageId: string; revisionId: string | null }; event?: { eventId: string; revisionId: string | null }; opportunity?: { opportunityId: string; revisionId: string | null }; publication?: { publicationId: string; revisionId: string | null }; seo?: { overrideId: string; revisionId: string | null }; home?: { file?: string; revisionId: string | null }; redirects?: 'pending'; schema?: { settings: SchemaSettings; revision: string } | null; translations?: { lang: TR.Lang; data: TR.LangData; revision: string }; menus?: { menu: MENU.Menu; revision: string }; settings?: { values: SET.Values; revision: string } } = {}) {
    const entries = await this.liveEntries(o.project, o.publication);
    await this.writeRedirects(o.redirects === 'pending');
    this.writeData(this.dataFile, entries);
    const partnerMedia = await this.writePartners(this.partnersFile, o.partner, o.project);
    const pillarMedia = await this.writePillars(this.pillarsFile, o.pillar);
    const aboutMedia = await this.writeAbout(this.aboutFile, await this.liveAbout(o.about));
    const eventMedia = await this.writeEvents(this.eventsFile, o.event, o.project);
    const seoMedia = await this.writeSeo(o.seo);
    await this.writeSchema(o.schema, o.article, o.event);
    await this.writeTranslations(o.translations);
    await this.writeMenus(o.menus);
    const settingsMedia = await this.writeSiteSettings(o.settings);
    const pending = { article: o.article, event: o.event, opportunity: o.opportunity, partner: o.partner };
    const homeMedia = await this.writeFields(o.home, { projectOverride: o.project, pending });
    const oppMedia = await this.writeOpportunities(resolve(this.cfg.siteRoot, 'src/pages'), [this.cfg.siteRoot], await this.liveOpportunities(o.opportunity), o.project);
    // the language copies (fr/, ar/) are removed with the English page: build.mjs only writes pages, it never deletes them
    const pub = await this.writePublications(resolve(this.cfg.siteRoot, 'src/pages'), [this.cfg.siteRoot, ...TR.LANGS.map((l) => resolve(this.cfg.siteRoot, l))], await this.livePublications(o.publication), o.project);
    this.copyDocuments(pub.docs, resolve(this.cfg.siteRoot, PUBLIC_DOC_DIR), true);
    const newsMedia = await this.writeNews(this.newsFile, resolve(this.cfg.siteRoot, 'src/pages'), await this.liveArticles(o.article), o.project);
    const live = await this.livePages(o.page);
    const ctx = await buildCtx(this.db, live.map((x) => x.snap.doc), { projectOverride: o.project, pending });
    const dir = resolve(this.cfg.siteRoot, 'src/pages');
    mkdirSync(dir, { recursive: true });
    for (const { id, snap } of live) {
      const file = resolve(dir, `${snap.slug}.html`);
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, pageSource(snap, ctx, id)); renameSync(tmp, file);
    }
    await this.copyMedia([...entries.flatMap((e) => e.media ?? []), ...live.flatMap((x) => docMediaIds(x.snap.doc)), ...newsMedia, ...partnerMedia, ...pillarMedia, ...aboutMedia, ...eventMedia, ...oppMedia, ...pub.mediaIds, ...seoMedia, ...homeMedia, ...settingsMedia], resolve(this.cfg.siteRoot, 'assets/media'), true);
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
  private async deliver(kind: string, actor: NonNullable<Actor>, entityId: string | null, revisionId: string | null, apply: (log: string[]) => Promise<void>, failLabel: string) {
    const [job] = await this.db.insert(publishJobs).values({ kind, entityId, revisionId, requestedBy: actor.id }).returning();
    const log: string[] = [];
    try { await apply(log); }
    catch (e) {
      const msg = (e as Error).message;
      try { await this.rebuildFromDb(log); } catch (e2) { log.push(`Restore also failed: ${(e2 as Error).message}`); }
      await this.db.update(publishJobs).set({ status: 'failed', error: msg, log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
      await audit(this.db, actor, `${kind}_failed`, { type: kind.includes('settings') ? 'settings' : kind.includes('about') ? 'about_page' : kind.includes('redirect') ? 'redirect' : kind.includes('partner') ? 'partner' : kind.includes('pillar') ? 'pillar' : kind.includes('event') ? 'event' : kind.includes('opportunity') ? 'opportunity' : kind.includes('publication') ? 'publication' : kind.includes('seo') ? 'seo' : kind.includes('home') ? 'page_content' : 'page', id: entityId ?? undefined }, `${failLabel}: ${msg}`, { jobId: job.id });
      throw new AppError(409, `${failLabel}, the live site was left as it was. ${msg}`);
    }
    void confirmPublic(this.db, this.cfg, job.id, actor);   // in the background: is the public copy serving this build?
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
      // stories from the old blog also get a page from the site's template (news-<slug>.html), so remove that too
      const file = articleFile(rev.snapshot as unknown as ArticleSnapshot) ?? `news-${(rev.snapshot as unknown as ArticleSnapshot).slug}.html`;
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

  // ---------------------------------------------------------------- Partners
  /** Checks partners.html. Uses the per-card revision marker when the template outputs it, otherwise the escaped name. */
  private verifyPartner(name: string, revisionId: string, removed: boolean) {
    const html = readFileSync(resolve(this.cfg.siteRoot, 'partners.html'), 'utf8');
    const marked = html.includes('data-studio-partner-rev=');
    const present = marked ? html.includes(`data-studio-partner-rev="${revisionId}"`) : html.includes(`>${escapeHtml(name)}<`);
    if (removed && present) throw new Error('The partner is still listed on partners.html.');
    if (!removed && !present) throw new Error('The partner is missing from partners.html.');
  }

  async publishPartner(actor: NonNullable<Actor>, partnerId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(partners).where(eq(partners.id, partnerId));
      if (!p) throw new AppError(404, 'Partner not found.');
      if (p.status !== 'approved' || !p.approvedRevisionId) throw new AppError(409, 'Only an approved partner can be published.');
      const [rev] = await this.db.select().from(partnerRevisions).where(eq(partnerRevisions.id, p.approvedRevisionId));
      const snap = rev.snapshot as unknown as PartnerSnapshot;
      const { job, log } = await this.deliver('publish_partner', actor, partnerId, rev.id, async (log) => {
        await this.writeSite({ partner: { partnerId, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyPartner(snap.name, rev.id, false);
      }, `Publishing “${p.name}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(partners).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(partners.id, partnerId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'partner.publish', { type: 'partner', id: partnerId }, `Published partner “${p.name}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: 'partners.html' };
    });
  }

  async unpublishPartner(actor: NonNullable<Actor>, partnerId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(partners).where(eq(partners.id, partnerId));
      if (!p) throw new AppError(404, 'Partner not found.');
      if (!p.publishedRevisionId) throw new AppError(409, 'This partner is not on the live site.');
      const [rev] = await this.db.select().from(partnerRevisions).where(eq(partnerRevisions.id, p.publishedRevisionId));
      const snap = rev.snapshot as unknown as PartnerSnapshot;
      const { job, log } = await this.deliver('unpublish_partner', actor, partnerId, rev.id, async (log) => {
        await this.writeSite({ partner: { partnerId, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyPartner(snap.name, rev.id, true);
      }, `Removing “${p.name}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(partners).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(partners.id, partnerId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'partner.unpublish', { type: 'partner', id: partnerId }, `Removed partner “${p.name}” from the website`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Builds partners.html with the saved working copy in an isolated folder. */
  async previewPartner(partnerId: string, snap: PartnerSnapshot) {
    return this.locked(async () => {
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json'), partnersFile = resolve(dir, 'partners.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      const live = (await this.livePartners({ partnerId, revisionId: null })).concat({ id: 'preview', snap });
      const list = await partnerEntries(this.db, live);
      writeFileSync(partnersFile, JSON.stringify({ version: 1, source: 'AFCD Studio (preview)', partners: list }, null, 2));
      await this.writeNews(resolve(dir, 'news.json'), pagesDir, await this.liveArticles());
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, newsFile: resolve(dir, 'news.json'), partnersFile });
      if (!existsSync(resolve(outDir, 'partners.html'))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file: 'partners.html', mediaIds: snap.logoMediaId ? [snap.logoMediaId] : [] };
    });
  }

  // ---------------------------------------------------------------- About pages
  /** The strategic objectives' wording follows the published Strategy page (other modules read these rows). */
  private async setObjectives(rows: { ref: string; title: string; description: string }[]) {
    for (const r of rows) await this.db.update(objectives).set({ title: r.title, description: r.description }).where(eq(objectives.ref, r.ref));
  }

  async publishAboutPage(actor: NonNullable<Actor>, pageId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(aboutPages).where(eq(aboutPages.id, pageId));
      if (!p) throw new AppError(404, 'Page not found.');
      if (p.status !== 'approved' || !p.approvedRevisionId) throw new AppError(409, 'Only an approved page can be published.');
      const [rev] = await this.db.select().from(aboutPageRevisions).where(eq(aboutPageRevisions.id, p.approvedRevisionId));
      const snap = rev.snapshot as unknown as AboutSnapshot;
      const meta = ABOUT_META[p.key as AboutKey];
      const objs = snap.key === 'strategy' ? (snap.objectives as { ref: string; title: string; text: string }[]) : null;
      const before = objs ? await this.db.select({ ref: objectives.ref, title: objectives.title, description: objectives.description }).from(objectives) : [];
      const { job, log } = await this.deliver('publish_about', actor, pageId, rev.id, async (log) => {
        if (objs) await this.setObjectives(objs.map((o) => ({ ref: o.ref, title: o.title, description: o.text })));
        try {
          await this.writeSite({ about: { pageId, revisionId: rev.id } });
          log.push(await this.runner(this.cfg, { kind: 'live' }));
          const f = resolve(this.cfg.siteRoot, meta.file);
          if (!existsSync(f)) throw new Error(`${meta.file} was not generated.`);
          if (!readFileSync(f, 'utf8').includes(`data-studio-rev="${rev.id}"`)) throw new Error(`${meta.file} does not contain the published revision.`);
        } catch (e) { if (objs) await this.setObjectives(before); throw e; }
      }, `Publishing ${meta.title} failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(aboutPages).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(aboutPages.id, pageId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'about.publish', { type: 'about_page', id: pageId }, `Published ${meta.title} (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: meta.file };
    });
  }

  /** Builds the page with the saved working copy in an isolated folder. */
  async previewAboutPage(pageId: string, snap: AboutSnapshot) {
    return this.locked(async () => {
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json'), aboutFile = resolve(dir, 'about.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      const live = (await this.liveAbout()).filter((x) => x.snap.key !== snap.key).concat({ id: 'preview', snap });
      const { pages } = await aboutEntries(this.db, live);
      writeFileSync(aboutFile, JSON.stringify({ version: 1, source: 'AFCD Studio (preview)', pages }, null, 2));
      await this.writeNews(resolve(dir, 'news.json'), pagesDir, await this.liveArticles());
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, newsFile: resolve(dir, 'news.json'), aboutFile });
      const file = ABOUT_META[snap.key].file;
      if (!existsSync(resolve(outDir, file))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file, mediaIds: [] as string[] };
    });
  }

  // ---------------------------------------------------------------- Pillars
  /** Checks the pillar's own page and the Our Pillars hub show the published name and summary. */
  private verifyPillar(snap: PillarSnapshot) {
    const name = escapeHtml(snap.name), summary = escapeHtml(snap.summary);
    for (const file of [snap.publicFile, 'pillars.html']) {
      const p = resolve(this.cfg.siteRoot, file);
      if (!existsSync(p)) throw new Error(`${file} was not generated.`);
      const html = readFileSync(p, 'utf8');
      if (!html.includes(name) || !html.includes(summary)) throw new Error(`${file} does not show the published pillar text.`);
    }
  }

  async publishPillar(actor: NonNullable<Actor>, pillarId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(pillars).where(eq(pillars.id, pillarId));
      if (!p) throw new AppError(404, 'Pillar not found.');
      if (p.status === 'approved' && p.removeRequested) return this.removePillar(actor, p);
      if (p.status !== 'approved' || !p.approvedRevisionId) throw new AppError(409, 'Only an approved pillar can be published.');
      const [rev] = await this.db.select().from(pillarRevisions).where(eq(pillarRevisions.id, p.approvedRevisionId));
      const snap = rev.snapshot as unknown as PillarSnapshot;
      // name, summary and colour are also read by other modules (story tags, project pages): switch them for this build,
      // and put the old values back if the delivery fails, before the site is rebuilt from the database.
      const before = { name: p.name, description: p.description, colour: p.colour };
      const setLive = (v: typeof before) => this.db.update(pillars).set(v).where(eq(pillars.id, pillarId));
      const { job, log } = await this.deliver('publish_pillar', actor, pillarId, rev.id, async (log) => {
        await setLive({ name: snap.name, description: snap.summary, colour: snap.colour });
        try {
          await this.writeSite({ pillar: { pillarId, revisionId: rev.id } });
          log.push(await this.runner(this.cfg, { kind: 'live' }));
          this.verifyPillar(snap);
        } catch (e) { await setLive(before); throw e; }
      }, `Publishing pillar “${p.name}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(pillars).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(pillars.id, pillarId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'pillar.publish', { type: 'pillar', id: pillarId }, `Published pillar “${snap.name}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: snap.publicFile };
    });
  }

  /** Takes an approved removal live: the pillar leaves pillars.json, its page becomes a redirect to pillars.html (also in
   *  French and Arabic), the site is rebuilt and checked, and only then is the pillar deleted from Studio. */
  private async removePillar(actor: NonNullable<Actor>, p: typeof pillars.$inferSelect) {
    const [rev] = p.publishedRevisionId ? await this.db.select().from(pillarRevisions).where(eq(pillarRevisions.id, p.publishedRevisionId)) : [];
    if (!rev) throw new AppError(409, 'This pillar is not on the website.');
    const snap = rev.snapshot as unknown as PillarSnapshot;
    const file = p.publicFile, root = this.cfg.siteRoot;
    let redirectId: string | null = null;
    const { job, log } = await this.deliver('remove_pillar', actor, p.id, rev.id, async (log) => {
      try {
        for (const f of [resolve(root, file), resolve(root, 'src/pages', file), resolve(root, 'fr', file), resolve(root, 'ar', file)]) if (existsSync(f)) rmSync(f);
        const [existing] = await this.db.select().from(redirects).where(eq(redirects.source, file));
        if (!existing) {
          const value = { source: file, destination: 'pillars.html', code: 301 };
          const [r] = await this.db.insert(redirects).values({ ...value, reason: `Pillar “${p.name}” removed from the website`, status: 'active', published: value, publishedAt: new Date(), createdBy: actor.id, updatedBy: actor.id }).returning();
          redirectId = r.id;
        }
        await this.writeSite({ pillar: { pillarId: p.id, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        const hub = readFileSync(resolve(root, 'pillars.html'), 'utf8');
        if (hub.includes(`href="${file}"`)) throw new Error('pillars.html still links to the removed pillar.');
        if (!existsSync(resolve(root, file)) || !readFileSync(resolve(root, file), 'utf8').includes(STUB_MARK)) throw new Error(`${file} was not turned into a redirect.`);
      } catch (e) { if (redirectId) await this.db.delete(redirects).where(eq(redirects.id, redirectId)); throw e; }
    }, `Removing pillar “${p.name}” failed`);
    await this.db.transaction(async (tx) => {
      await tx.delete(pillars).where(eq(pillars.id, p.id));
      await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
      await audit(tx, actor, 'pillar.remove', { type: 'pillar', id: p.id }, `Removed pillar “${snap.name}” from the website; ${file} now redirects to pillars.html`, { jobId: job.id, revisionId: rev.id });
    });
    return { jobId: job.id, revisionId: rev.id, file: 'pillars.html', removed: true };
  }

  /** New order of the pillars (numbers follow it). Rebuilds and checks the hub when pillar content is managed in Studio. */
  async reorderPillars(actor: NonNullable<Actor>, next: { id: string; sort: number; number: string }[], before: { id: string; sort: number }[]) {
    return this.locked(async () => {
      const apply = async (rows: { id: string; sort: number; number?: string }[]) => { for (const r of rows) await this.db.update(pillars).set(r.number ? { sort: r.sort, number: r.number } : { sort: r.sort }).where(eq(pillars.id, r.id)); };
      const live = await this.livePillars();
      if (!live) { await apply(next); await audit(this.db, actor, 'pillar.reorder', { type: 'pillar' }, 'Changed the order of the pillars'); return { rebuilt: false }; }
      const { job, log } = await this.deliver('reorder_pillars', actor, null, null, async (log) => {
        await apply(next);
        try {
          await this.writeSite();
          log.push(await this.runner(this.cfg, { kind: 'live' }));
          const hub = readFileSync(resolve(this.cfg.siteRoot, 'pillars.html'), 'utf8');
          const want = (await this.livePillars())!.sort((a, b) => a.sort - b.sort).map((x) => hub.indexOf(`href="${x.snap.publicFile}"`));
          if (want.some((i) => i < 0) || want.some((i, k) => k > 0 && i < want[k - 1])) throw new Error('pillars.html does not show the new order.');
        } catch (e) { await apply(before); throw e; }
      }, 'Changing the order of the pillars failed');
      await this.db.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
      await audit(this.db, actor, 'pillar.reorder', { type: 'pillar' }, 'Changed the order of the pillars on the website', { jobId: job.id });
      return { rebuilt: true, jobId: job.id };
    });
  }

  /** Builds the pillar's page with the saved working copy in an isolated folder. */
  async previewPillar(pillarId: string, snap: PillarSnapshot, sort = 0) {
    return this.locked(async () => {
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json'), pillarsFile = resolve(dir, 'pillars.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      const live = await this.livePillars();
      if (!live) throw new AppError(409, 'Import the current pillar content first.');
      const list = await pillarEntries(this.db, live.filter((x) => x.snap.key !== snap.key).concat({ id: 'preview', snap, sort }));
      writeFileSync(pillarsFile, JSON.stringify({ version: 1, source: 'AFCD Studio (preview)', pillars: list }, null, 2));
      await this.writeNews(resolve(dir, 'news.json'), pagesDir, await this.liveArticles());
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, newsFile: resolve(dir, 'news.json'), pillarsFile });
      if (!existsSync(resolve(outDir, snap.publicFile))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file: snap.publicFile, mediaIds: snap.mediaId ? [snap.mediaId] : [] };
    });
  }

  // ---------------------------------------------------------------- Events
  private verifyEvent(slug: string, title: string, revisionId: string) {
    const root = this.cfg.siteRoot;
    const listing = readFileSync(resolve(root, 'events.html'), 'utf8');
    if (!listing.includes(`>${escapeHtml(title)}<`)) throw new Error('The event is missing from events.html.');
    const file = resolve(root, eventFile(slug));
    if (!existsSync(file)) throw new Error(`${eventFile(slug)} was not generated.`);
    const html = readFileSync(file, 'utf8');
    if (!html.includes(`data-studio-event-rev="${revisionId}"`)) throw new Error(`${eventFile(slug)} does not show the published revision (the site's event template must output data-studio-event-rev).`);
    if (html.includes('Sample event')) throw new Error(`${eventFile(slug)} still shows sample content.`);
  }

  async publishEvent(actor: NonNullable<Actor>, eventId: string) {
    return this.locked(async () => {
      const [e] = await this.db.select().from(events).where(eq(events.id, eventId));
      if (!e) throw new AppError(404, 'Event not found.');
      if (e.status !== 'approved' || !e.approvedRevisionId) throw new AppError(409, 'Only an approved event can be published.');
      const [rev] = await this.db.select().from(eventRevisions).where(eq(eventRevisions.id, e.approvedRevisionId));
      const snap = rev.snapshot as unknown as EventSnapshot;
      const { job, log } = await this.deliver('publish_event', actor, eventId, rev.id, async (log) => {
        await this.writeSite({ event: { eventId, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyEvent(snap.slug, snap.title, rev.id);
      }, `Publishing “${e.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(events).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(events.id, eventId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'event.publish', { type: 'event', id: eventId }, `Published event “${e.title}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: eventFile(snap.slug) };
    });
  }

  async unpublishEvent(actor: NonNullable<Actor>, eventId: string) {
    return this.locked(async () => {
      const [e] = await this.db.select().from(events).where(eq(events.id, eventId));
      if (!e) throw new AppError(404, 'Event not found.');
      if (!e.publishedRevisionId) throw new AppError(409, 'This event is not on the live site.');
      const [rev] = await this.db.select().from(eventRevisions).where(eq(eventRevisions.id, e.publishedRevisionId));
      const snap = rev.snapshot as unknown as EventSnapshot;
      const { job, log } = await this.deliver('unpublish_event', actor, eventId, rev.id, async (log) => {
        this.removeOrphanPages(eventFile(snap.slug));
        await this.writeSite({ event: { eventId, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        const f = resolve(this.cfg.siteRoot, eventFile(snap.slug));
        if (existsSync(f) && readFileSync(f, 'utf8').includes(`data-studio-event-rev="${rev.id}"`)) throw new Error(`${eventFile(snap.slug)} is still on the site.`);
      }, `Removing “${e.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(events).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(events.id, eventId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'event.unpublish', { type: 'event', id: eventId }, `Removed event “${e.title}” from the website`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Builds the calendar and the event page with the saved working copy in an isolated folder. */
  async previewEvent(eventId: string, snap: EventSnapshot) {
    return this.locked(async () => {
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json'), eventsFile = resolve(dir, 'events.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      const list = await eventEntries(this.db, (await this.liveEvents({ eventId, revisionId: null })).concat({ id: 'preview', snap }));
      writeFileSync(eventsFile, JSON.stringify({ version: 1, source: 'AFCD Studio (preview)', events: list }, null, 2));
      await this.writeNews(resolve(dir, 'news.json'), pagesDir, await this.liveArticles());
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, newsFile: resolve(dir, 'news.json'), eventsFile });
      const file = existsSync(resolve(outDir, eventFile(snap.slug))) ? eventFile(snap.slug) : 'events.html';
      if (!existsSync(resolve(outDir, file))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file };
    });
  }

  /** Rebuilds when an event has moved from upcoming to past since the last export (checked by the scheduler). */
  async refreshEventStates(now = new Date()) {
    if (!existsSync(this.eventsFile)) return false;
    let stale = false;
    try {
      const cur = JSON.parse(readFileSync(this.eventsFile, 'utf8')).events as { revision: string; upcoming: boolean }[];
      const live = await this.liveEvents();
      const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
      stale = live.some((l) => { const c = cur.find((x) => x.revision === l.id); return !c || c.upcoming !== isUpcoming(l.snap, today); });
    } catch { stale = true; }
    if (!stale) return false;
    await this.locked(async () => { const log: string[] = []; await this.rebuildFromDb(log); });
    await audit(this.db, null, 'event.refresh', { type: 'event' }, 'Rebuilt the events calendar because an event has passed');
    return true;
  }

  // ---------------------------------------------------------------- Opportunities
  private verifyOpportunity(slug: string, revisionId: string, removed: boolean) {
    const root = this.cfg.siteRoot;
    const page = resolve(root, opportunityFile(slug)), listing = resolve(root, 'opportunities.html');
    if (removed) {
      if (existsSync(page)) throw new Error(`${opportunityFile(slug)} is still on the site.`);
      if (existsSync(listing) && readFileSync(listing, 'utf8').includes(`data-studio-opportunity="${revisionId}"`)) throw new Error('The opportunity is still listed on opportunities.html.');
      return;
    }
    if (!existsSync(page) || !readFileSync(page, 'utf8').includes(`data-studio-opportunity-rev="${revisionId}"`)) throw new Error(`${opportunityFile(slug)} does not contain the published revision.`);
    // closed opportunities leave the listing 12 months after their deadline, so only open or coming ones must be listed
    const closed = readFileSync(page, 'utf8').includes('data-state="closed"');
    if (!closed && (!existsSync(listing) || !readFileSync(listing, 'utf8').includes(`data-studio-opportunity="${revisionId}"`))) throw new Error('The opportunity is missing from opportunities.html.');
  }

  async publishOpportunity(actor: NonNullable<Actor>, opportunityId: string) {
    return this.locked(async () => {
      const [o] = await this.db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
      if (!o) throw new AppError(404, 'Opportunity not found.');
      if (o.status !== 'approved' || !o.approvedRevisionId) throw new AppError(409, 'Only an approved opportunity can be published.');
      const [rev] = await this.db.select().from(opportunityRevisions).where(eq(opportunityRevisions.id, o.approvedRevisionId));
      const snap = rev.snapshot as unknown as OpportunitySnapshot;
      const { job, log } = await this.deliver('publish_opportunity', actor, opportunityId, rev.id, async (log) => {
        await this.writeSite({ opportunity: { opportunityId, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyOpportunity(snap.slug, rev.id, false);
      }, `Publishing “${o.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(opportunities).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(opportunities.id, opportunityId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'opportunity.publish', { type: 'opportunity', id: opportunityId }, `Published opportunity “${o.title}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: opportunityFile(snap.slug) };
    });
  }

  async unpublishOpportunity(actor: NonNullable<Actor>, opportunityId: string) {
    return this.locked(async () => {
      const [o] = await this.db.select().from(opportunities).where(eq(opportunities.id, opportunityId));
      if (!o) throw new AppError(404, 'Opportunity not found.');
      if (!o.publishedRevisionId) throw new AppError(409, 'This opportunity is not on the live site.');
      const [rev] = await this.db.select().from(opportunityRevisions).where(eq(opportunityRevisions.id, o.publishedRevisionId));
      const snap = rev.snapshot as unknown as OpportunitySnapshot;
      const { job, log } = await this.deliver('unpublish_opportunity', actor, opportunityId, rev.id, async (log) => {
        await this.writeSite({ opportunity: { opportunityId, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyOpportunity(snap.slug, rev.id, true);
      }, `Removing “${o.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(opportunities).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(opportunities.id, opportunityId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'opportunity.unpublish', { type: 'opportunity', id: opportunityId }, `Removed opportunity “${o.title}” from the website`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Builds the listing and the opportunity page with the saved working copy in an isolated folder. */
  async previewOpportunity(opportunityId: string, snap: OpportunitySnapshot) {
    return this.locked(async () => {
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      await this.writeOpportunities(pagesDir, [], (await this.liveOpportunities({ opportunityId, revisionId: null })).concat({ id: 'preview', snap }));
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, only: 'pages' });
      const file = opportunityFile(snap.slug);
      if (!existsSync(resolve(outDir, file))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file };
    });
  }

  /** Rebuilds when an opportunity has opened or closed since its page was built (checked by the scheduler). */
  async refreshOpportunityStates(now = new Date()) {
    const live = await this.liveOpportunities();
    if (!live.length) return false;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
    const stale = live.some((o) => {
      const f = resolve(this.cfg.siteRoot, opportunityFile(o.snap.slug));
      if (!existsSync(f)) return true;
      const m = readFileSync(f, 'utf8').match(/data-state="(open|soon|closed)"/);
      return m?.[1] !== oppState(o.snap, today);
    });
    if (!stale) return false;
    await this.locked(async () => { const log: string[] = []; await this.rebuildFromDb(log); });
    await audit(this.db, null, 'opportunity.refresh', { type: 'opportunity' }, 'Rebuilt opportunities because one has opened or closed');
    return true;
  }

  // ---------------------------------------------------------------- Publications
  private verifyPublication(snap: PublicationSnapshot, revisionId: string, removed: boolean, docKey: string | null) {
    const root = this.cfg.siteRoot;
    const file = publicationFile(snap.slug);
    const page = resolve(root, file), listing = resolve(root, 'publications.html');
    if (removed) {
      for (const p of [page, ...TR.LANGS.map((l) => resolve(root, l, file))]) if (existsSync(p)) throw new Error(`${p.slice(root.length + 1)} is still on the site.`);
      if (existsSync(listing) && readFileSync(listing, 'utf8').includes(`data-studio-publication="${revisionId}"`)) throw new Error('The publication is still listed on publications.html.');
      return;
    }
    if (!existsSync(page) || !readFileSync(page, 'utf8').includes(`data-studio-publication-rev="${revisionId}"`)) throw new Error(`${file} does not contain the published revision.`);
    if (!existsSync(listing) || !readFileSync(listing, 'utf8').includes(`data-studio-publication="${revisionId}"`)) throw new Error('The publication is missing from publications.html.');
    if (docKey && !existsSync(resolve(root, PUBLIC_DOC_DIR, `${docKey}.pdf`))) throw new Error('The PDF was not copied to the website.');
    const sitemap = resolve(root, 'sitemap.xml');
    if (!existsSync(sitemap) || !readFileSync(sitemap, 'utf8').includes(file)) throw new Error(`${file} is missing from sitemap.xml.`);
  }

  private async docKeyOf(snap: PublicationSnapshot) {
    if (!snap.documentId) return null;
    const ctx = await pubCtx(this.db, [snap]);
    const d = ctx.doc(snap.documentId);
    if (!d) throw new AppError(409, 'The PDF of this publication no longer exists. Upload it again and resubmit.');
    return d.storageKey;
  }

  async publishPublication(actor: NonNullable<Actor>, publicationId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(publications).where(eq(publications.id, publicationId));
      if (!p) throw new AppError(404, 'Publication not found.');
      if (p.status !== 'approved' || !p.approvedRevisionId) throw new AppError(409, 'Only an approved publication can be published.');
      const [rev] = await this.db.select().from(publicationRevisions).where(eq(publicationRevisions.id, p.approvedRevisionId));
      const snap = rev.snapshot as unknown as PublicationSnapshot;
      const docKey = await this.docKeyOf(snap);
      const { job, log } = await this.deliver('publish_publication', actor, publicationId, rev.id, async (log) => {
        await this.writeSite({ publication: { publicationId, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyPublication(snap, rev.id, false, docKey);
      }, `Publishing “${p.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(publications).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(publications.id, publicationId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'publication.publish', { type: 'publication', id: publicationId }, `Published publication “${p.title}” (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: publicationFile(snap.slug) };
    });
  }

  async unpublishPublication(actor: NonNullable<Actor>, publicationId: string) {
    return this.locked(async () => {
      const [p] = await this.db.select().from(publications).where(eq(publications.id, publicationId));
      if (!p) throw new AppError(404, 'Publication not found.');
      if (!p.publishedRevisionId) throw new AppError(409, 'This publication is not on the live site.');
      const [rev] = await this.db.select().from(publicationRevisions).where(eq(publicationRevisions.id, p.publishedRevisionId));
      const snap = rev.snapshot as unknown as PublicationSnapshot;
      const { job, log } = await this.deliver('unpublish_publication', actor, publicationId, rev.id, async (log) => {
        await this.writeSite({ publication: { publicationId, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyPublication(snap, rev.id, true, null);
      }, `Removing “${p.title}” failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(publications).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(publications.id, publicationId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'publication.unpublish', { type: 'publication', id: publicationId }, `Removed publication “${p.title}” from the website`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Builds the listing and the publication page with the saved working copy in an isolated folder. The PDF is served
   *  from Studio's own copy (signed-in only), never copied to the site. */
  async previewPublication(publicationId: string, snap: PublicationSnapshot) {
    return this.locked(async () => {
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      await this.writePublications(pagesDir, [], (await this.livePublications({ publicationId, revisionId: null })).concat({ id: 'preview', snap }));
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, only: 'pages' });
      const file = publicationFile(snap.slug);
      if (!existsSync(resolve(outDir, file))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file };
    });
  }

  // ---------------------------------------------------------------- SEO overrides
  private verifySeo(file: string, revisionId: string, removed: boolean) {
    const p = resolve(this.cfg.siteRoot, file);
    if (!existsSync(p)) throw new Error(`${file} was not built.`);
    const has = readFileSync(p, 'utf8').includes(`<meta name="studio-seo-rev" content="${revisionId}">`);
    if (!removed && !has) throw new Error(`${file} does not carry the published SEO settings (build.mjs must apply src/data/seo.json).`);
    if (removed && has) throw new Error(`${file} still carries the removed SEO settings.`);
  }

  async publishSeo(actor: NonNullable<Actor>, overrideId: string) {
    return this.locked(async () => {
      const [o] = await this.db.select().from(seoOverrides).where(eq(seoOverrides.id, overrideId));
      if (!o) throw new AppError(404, 'SEO settings not found.');
      if (o.status !== 'approved' || !o.approvedRevisionId) throw new AppError(409, 'Only approved SEO settings can be published.');
      const [rev] = await this.db.select().from(seoRevisions).where(eq(seoRevisions.id, o.approvedRevisionId));
      const { job, log } = await this.deliver('publish_seo', actor, overrideId, rev.id, async (log) => {
        await this.writeSite({ seo: { overrideId, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifySeo(o.file, rev.id, false);
      }, `Publishing SEO for ${o.file} failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(seoOverrides).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(seoOverrides.id, overrideId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'seo.publish', { type: 'seo', id: overrideId }, `Published SEO for ${o.file} (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file: o.file };
    });
  }

  /** Removes the override from the site: the page goes back to its own title and description. */
  async unpublishSeo(actor: NonNullable<Actor>, overrideId: string) {
    return this.locked(async () => {
      const [o] = await this.db.select().from(seoOverrides).where(eq(seoOverrides.id, overrideId));
      if (!o) throw new AppError(404, 'SEO settings not found.');
      if (!o.publishedRevisionId) throw new AppError(409, 'These SEO settings are not on the live site.');
      const rev = o.publishedRevisionId;
      const { job, log } = await this.deliver('unpublish_seo', actor, overrideId, rev, async (log) => {
        await this.writeSite({ seo: { overrideId, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifySeo(o.file, rev, true);
      }, `Restoring the page’s own SEO for ${o.file} failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(seoOverrides).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(seoOverrides.id, overrideId));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'seo.unpublish', { type: 'seo', id: overrideId }, `Restored the page’s own SEO for ${o.file}`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  // ---------------------------------------------------------------- Homepage fields
  private verifyHome(revisionId: string, removed: boolean, file = HOME) {
    const html = readFileSync(resolve(this.cfg.siteRoot, file), 'utf8');
    const has = html.includes(`<meta name="studio-fields-rev" content="${revisionId}">`);
    if (!removed && !has) throw new Error(`${file} does not carry the published changes (build.mjs must apply src/data/page-fields.json).`);
    if (removed && has) throw new Error(`${file} still carries the removed changes.`);
    if (html.includes('data-sf=')) throw new Error(`${file} still contains editing markers.`);
    // a page generator (src/content.py) that rewrites the source without its markers would make the edits vanish silently
    if (!removed && !readFileSync(resolve(this.cfg.siteRoot, 'src/pages', file), 'utf8').includes('data-sf=')) throw new Error(`src/pages/${file} lost its Studio field markers, so the edits were not applied.`);
  }

  async publishHome(actor: NonNullable<Actor>, file = HOME) {
    const page = TEXT_PAGES[file];
    return this.locked(async () => {
      const [c] = await this.db.select().from(pageContents).where(eq(pageContents.file, file));
      if (!c || c.status !== 'approved' || !c.approvedRevisionId) throw new AppError(409, `Only approved ${page.noun} changes can be published.`);
      const [rev] = await this.db.select().from(pageContentRevisions).where(eq(pageContentRevisions.id, c.approvedRevisionId));
      const { job, log } = await this.deliver('publish_home', actor, c.id, rev.id, async (log) => {
        await this.writeSite({ home: { file, revisionId: rev.id } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyHome(rev.id, false, file);
      }, `Publishing the ${page.noun} failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(pageContents).set({ status: 'published', publishedRevisionId: rev.id, publishedAt: new Date(), approvedRevisionId: null, updatedAt: new Date() }).where(eq(pageContents.id, c.id));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'home.publish', { type: 'page_content', id: c.id }, `Published ${page.noun} changes (revision ${rev.number})`, { revisionId: rev.id, jobId: job.id });
      });
      return { jobId: job.id, revisionId: rev.id, file };
    });
  }

  /** Puts the homepage back to the text written in the page. The edits stay in Studio as a draft. */
  async unpublishHome(actor: NonNullable<Actor>, file = HOME) {
    const page = TEXT_PAGES[file];
    return this.locked(async () => {
      const [c] = await this.db.select().from(pageContents).where(eq(pageContents.file, file));
      if (!c?.publishedRevisionId) throw new AppError(409, `No ${page.noun} changes are live.`);
      const rev = c.publishedRevisionId;
      const { job, log } = await this.deliver('unpublish_home', actor, c.id, rev, async (log) => {
        await this.writeSite({ home: { file, revisionId: null } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyHome(rev, true, file);
      }, `Restoring the original ${page.noun} failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(pageContents).set({ status: 'draft', publishedRevisionId: null, publishedAt: null, updatedAt: new Date() }).where(eq(pageContents.id, c.id));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'home.unpublish', { type: 'page_content', id: c.id }, `Restored the ${page.noun}’s original text`, { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  /** Builds the homepage with the saved working copy into an isolated folder. */
  async previewHome(file = HOME) {
    return this.locked(async () => {
      const [c] = await this.db.select().from(pageContents).where(eq(pageContents.file, file));
      this.cleanupPreviews();
      const token = randomBytes(16).toString('hex');
      const dir = resolve(this.cfg.previewDir, token);
      const pagesDir = resolve(dir, 'pages'), outDir = resolve(dir, 'site'), dataFile = resolve(dir, 'projects.json'), fieldsFile = resolve(dir, 'page-fields.json');
      mkdirSync(pagesDir, { recursive: true }); mkdirSync(outDir, { recursive: true });
      this.writeData(dataFile, await this.liveEntries());
      copyFileSync(resolve(this.cfg.siteRoot, 'src/pages', file), resolve(pagesDir, file));
      const [values] = await this.resolveFields(c?.values ?? {});
      const layout = c?.layout && TEXT_PAGES[file]?.layout ? currentLayout(this.cfg.siteRoot, file, c.layout) : null;
      const exported = await exportLayout(this.db, layout);
      writeFileSync(fieldsFile, JSON.stringify({ version: 1, source: 'AFCD Studio (preview)', pages: { [file]: { revision: 'preview', fields: values, ...(exported ? { layout: exported } : {}) } } }, null, 2));
      await this.runner(this.cfg, { kind: 'preview', dataFile, pagesDir, outDir, only: 'pages', fieldsFile });
      if (!existsSync(resolve(outDir, file))) throw new AppError(409, 'The preview could not be generated.');
      return { token, file };
    });
  }

  // ---------------------------------------------------------------- Redirects
  /** Redirect pages at the old addresses and the _redirects file. Live = each redirect's published copy; 'pending' = what
   *  publishing will deliver (every redirect that is not disabled). Studio only ever replaces or removes its own files. */
  private async redirectSet(pending: boolean) {
    const rows = await this.db.select().from(redirects);
    const want = pending
      ? rows.filter((r) => r.status !== 'disabled').map((r) => ({ source: r.source, destination: r.destination, code: r.code }))
      : rows.flatMap((r) => (r.published ? [r.published] : []));
    return { rows, want };
  }
  private async writeRedirects(pending: boolean) {
    const root = this.cfg.siteRoot; const { rows, want } = await this.redirectSet(pending); const site = await siteUrl(this.db);
    const keep = new Set(want.map((r) => r.source));
    const candidates = new Set([...readdirSync(root).filter((f) => f.endsWith('.html')), ...rows.map((r) => r.source), ...rows.flatMap((r) => (r.published ? [r.published.source] : []))]);
    for (const f of candidates) {
      const file = resolve(root, f);
      if (!keep.has(f) && existsSync(file) && readFileSync(file, 'utf8').includes(STUB_MARK)) rmSync(file);
    }
    for (const r of want) {
      const file = resolve(root, r.source);
      if (existsSync(file) && !readFileSync(file, 'utf8').includes(STUB_MARK)) throw new Error(`${r.source} is a real page on the site; the redirect was not written over it.`);
      mkdirSync(resolve(file, '..'), { recursive: true });
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`; writeFileSync(tmp, stubHtml(r, site)); renameSync(tmp, file);
    }
    const rf = resolve(root, '_redirects');
    const ours = !existsSync(rf) || readFileSync(rf, 'utf8').startsWith(REDIRECTS_HEADER);
    if (!ours) { if (want.length) throw new Error('A _redirects file not made by Studio is already on the site; Studio will not replace it.'); return; }
    if (want.length) { const tmp = `${rf}.${randomBytes(4).toString('hex')}.tmp`; writeFileSync(tmp, redirectsFile(want)); renameSync(tmp, rf); }
    else if (existsSync(rf)) rmSync(rf);
  }
  private verifyRedirects(want: { source: string; destination: string; code: number }[], gone: string[]) {
    const root = this.cfg.siteRoot;
    for (const r of want) {
      const file = resolve(root, r.source);
      const html = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (!html.includes(STUB_MARK) || !html.includes(stubHtml(r).match(/url=([^"]+)"/)![1])) throw new Error(`The redirect page ${r.source} was not written correctly.`);
    }
    for (const f of gone) { const file = resolve(root, f); if (existsSync(file) && readFileSync(file, 'utf8').includes(STUB_MARK)) throw new Error(`The old redirect page ${f} is still on the site.`); }
    const rf = resolve(root, '_redirects'); const txt = existsSync(rf) ? readFileSync(rf, 'utf8') : '';
    for (const r of want) if (!txt.includes(`/${r.source} `)) throw new Error(`_redirects is missing ${r.source}.`);
  }

  /** Puts every pending redirect change on the site at once: new and edited redirects go live, disabled ones are removed. */
  async publishRedirects(actor: NonNullable<Actor>, role: Role) {
    return this.locked(async () => {
      const { rows, want } = await this.redirectSet(true);
      const changes = rows.filter((r) => r.status === 'draft' || (r.status === 'disabled' && r.published));
      if (!changes.length) throw new AppError(409, 'There are no redirect changes to publish.');
      const problems: { path: string; message: string }[] = [];
      for (const r of rows.filter((x) => x.status !== 'disabled')) {
        const { errors } = await checkRedirect(this.db, this.cfg, { source: r.source, destination: r.destination, code: r.code as 301, reason: r.reason }, role, r.id);
        for (const m of errors) problems.push({ path: r.source, message: `${r.source}: ${m}` });
      }
      if (problems.length) throw new AppError(422, 'Some redirects need attention before publishing.', problems);
      const gone = rows.filter((r) => r.status === 'disabled' && r.published).map((r) => r.published!.source)
        .concat(rows.flatMap((r) => (r.published && r.status !== 'disabled' && r.published.source !== r.source ? [r.published.source] : [])));
      const { job, log } = await this.deliver('publish_redirects', actor, null, null, async (log) => {
        await this.writeSite({ redirects: 'pending' });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyRedirects(want, gone);
      }, 'Publishing redirects failed');
      await this.db.transaction(async (tx) => {
        const now = new Date();
        for (const r of rows) {
          if (r.status === 'disabled') { if (r.published) await tx.update(redirects).set({ published: null, publishedAt: null }).where(eq(redirects.id, r.id)); }
          else await tx.update(redirects).set({ status: 'active', published: { source: r.source, destination: r.destination, code: r.code }, publishedAt: r.status === 'draft' ? now : r.publishedAt }).where(eq(redirects.id, r.id));
        }
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: now }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'redirect.publish', { type: 'redirect' }, `Published redirects: ${want.length} live, ${gone.length} removed`, { jobId: job.id });
      });
      return { jobId: job.id, live: want.length, removed: gone.length };
    });
  }

  // ---------------------------------------------------------------- Structured data (schema.json, read by build.mjs)
  get schemaFile() { return resolve(this.cfg.siteRoot, 'src/data/schema.json'); }
  /** Published records the generated markup describes (with the same pending overrides as the rest of the delivery). */
  async schemaLive(article?: { articleId: string; revisionId: string | null }, event?: { eventId: string; revisionId: string | null }): Promise<LiveForSchema> {
    const arts = await this.liveArticles(article); const evs = await this.liveEvents(event);
    const ids = [...arts.map((a) => a.snap.heroMediaId), ...evs.map((e) => e.snap.posterMediaId)].filter(Boolean) as string[];
    const rows = ids.length ? await this.db.select().from(media).where(inArray(media.id, ids)) : [];
    const img = (id: string | null) => { const m = id ? rows.find((r) => r.id === id) : null; if (!m) return null; const r = publicRef(m, 'assets/media/'); return { src: r.src, w: r.w, h: r.h }; };
    return { articles: arts.map((a) => ({ snap: a.snap, img: img(a.snap.heroMediaId) })), events: evs.map((e) => ({ snap: e.snap, img: img(e.snap.posterMediaId) })) };
  }
  /** schema.json exists only while structured data settings are published. undefined = as published; null = none. */
  private async writeSchema(override: { settings: SchemaSettings; revision: string } | null | undefined, article?: { articleId: string; revisionId: string | null }, event?: { eventId: string; revisionId: string | null }) {
    let cur = override;
    if (cur === undefined) {
      const [row] = await this.db.select().from(seoSettings).where(eq(seoSettings.key, SCHEMA_KEY));
      const pub = row?.published as (SchemaSettings & { _revision?: string }) | null | undefined;
      cur = pub?._revision ? { settings: settingsSchema.parse({ organization: pub.organization, articles: pub.articles, events: pub.events }), revision: pub._revision } : null;
    }
    if (!cur) { if (existsSync(this.schemaFile)) rmSync(this.schemaFile); return null; }
    const out = buildSchemaFile(cur.settings, await this.schemaLive(article, event), cur.revision, await siteUrl(this.db));
    const tmp = `${this.schemaFile}.${randomBytes(4).toString('hex')}.tmp`;
    mkdirSync(resolve(this.schemaFile, '..'), { recursive: true });
    writeFileSync(tmp, JSON.stringify(out, null, 2) + '\n'); renameSync(tmp, this.schemaFile);
    return out;
  }
  private verifySchema(revision: string, removed: boolean) {
    const root = this.cfg.siteRoot; const home = readFileSync(resolve(root, 'index.html'), 'utf8');
    const has = home.includes(`<meta name="studio-schema-rev" content="${revision}">`);
    if (removed) { if (has) throw new Error('index.html still carries the removed structured data.'); return; }
    if (!has) throw new Error('index.html does not carry the published structured data (build.mjs must apply src/data/schema.json).');
    const data = JSON.parse(readFileSync(this.schemaFile, 'utf8')) as { pages: Record<string, { '@type': string }[]> };
    for (const [file, objs] of Object.entries(data.pages)) {
      const p = resolve(root, file); if (!existsSync(p)) throw new Error(`${file} is missing.`);
      const html = readFileSync(p, 'utf8');
      for (const o of objs) if (!html.includes(`"@type":"${o['@type']}"`)) throw new Error(`${file} does not carry its ${o['@type']} markup.`);
    }
  }

  async publishSchema(actor: NonNullable<Actor>) {
    return this.locked(async () => {
      const [row] = await this.db.select().from(seoSettings).where(eq(seoSettings.key, SCHEMA_KEY));
      if (!row || row.status !== 'approved' || !row.draft) throw new AppError(409, 'Only approved structured data settings can be published.');
      const bf = resolve(this.cfg.siteRoot, 'build.mjs');
      if (!existsSync(bf) || !/SCHEMA_JSON|schema\.json/.test(readFileSync(bf, 'utf8'))) throw new AppError(409, 'The website build does not read Studio’s structured data yet (build.mjs needs the schema.json hook). Nothing was changed.');
      const settings = settingsSchema.parse(row.draft); const revision = randomUUID();
      const { job, log } = await this.deliver('publish_seo_schema', actor, null, null, async (log) => {
        await this.writeSite({ schema: { settings, revision } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifySchema(revision, false);
      }, 'Publishing structured data failed');
      await this.db.transaction(async (tx) => {
        await tx.update(seoSettings).set({ status: 'published', published: { ...settings, _revision: revision }, publishedAt: new Date(), updatedAt: new Date() }).where(eq(seoSettings.key, SCHEMA_KEY));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'schema.publish', { type: 'seo_settings', id: SCHEMA_KEY }, 'Published structured data settings', { jobId: job.id, revision });
      });
      return { jobId: job.id, revision };
    });
  }

  /** Takes Studio's structured data off the site: the homepage goes back to the markup written in build.mjs. */
  async unpublishSchema(actor: NonNullable<Actor>) {
    return this.locked(async () => {
      const [row] = await this.db.select().from(seoSettings).where(eq(seoSettings.key, SCHEMA_KEY));
      const rev = (row?.published as { _revision?: string } | null)?._revision;
      if (!rev) throw new AppError(409, 'No structured data settings are on the live site.');
      const { job, log } = await this.deliver('unpublish_seo_schema', actor, null, null, async (log) => {
        await this.writeSite({ schema: null });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifySchema(rev, true);
      }, 'Removing structured data failed');
      await this.db.transaction(async (tx) => {
        await tx.update(seoSettings).set({ status: 'draft', published: null, publishedAt: null, updatedAt: new Date() }).where(eq(seoSettings.key, SCHEMA_KEY));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'schema.unpublish', { type: 'seo_settings', id: SCHEMA_KEY }, 'Removed Studio structured data from the site', { jobId: job.id });
      });
      return { jobId: job.id };
    });
  }

  // ---------------------------------------------------------------- Translations (src/i18n/<lang>.json, read by lib/i18n.mjs)
  /** Writes each language Studio manages from its published copy (or the one being delivered). Others stay as they are. */
  private async writeTranslations(override?: { lang: TR.Lang; data: TR.LangData; revision: string }) {
    for (const { lang, content } of await TR.publishedFiles(this.db, this.cfg, override)) {
      const file = resolve(this.cfg.siteRoot, 'src/i18n', `${lang}.json`);
      if (existsSync(file) && readFileSync(file, 'utf8') === content) continue;
      mkdirSync(resolve(file, '..'), { recursive: true });
      const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, content); renameSync(tmp, file);
    }
  }

  /** Every page of the language carries the new revision, and its text came from the new file. */
  private verifyTranslations(lang: TR.Lang, revision: string) {
    const dir = resolve(this.cfg.siteRoot, lang);
    const home = resolve(dir, 'index.html');
    if (!existsSync(home)) throw new Error(`${lang}/index.html was not built (lib/i18n.mjs must build the ${lang} pages).`);
    const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));
    const stale = pages.filter((f) => !readFileSync(resolve(dir, f), 'utf8').includes(`<meta name="studio-i18n-rev" content="${revision}">`));
    if (stale.length) throw new Error(`${stale.length} ${lang} page${stale.length === 1 ? '' : 's'} do not carry the new translations (e.g. ${stale[0]}).`);
  }

  async publishTranslations(actor: NonNullable<Actor>, lang: TR.Lang) {
    return this.locked(async () => {
      const row = await TR.loadRow(this.db, lang);
      if (!row || row.status !== 'approved' || !row.draft) throw new AppError(409, 'Only approved translations can be published.');
      const data = structuredClone(row.draft as TR.LangData); const revision = randomUUID();
      const { job, log } = await this.deliver('publish_translations', actor, null, null, async (log) => {
        await this.writeSite({ translations: { lang, data, revision } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyTranslations(lang, revision);
      }, `Publishing ${TR.LANG_INFO[lang].name} translations failed`);
      await this.db.transaction(async (tx) => {
        await tx.update(seoSettings).set({ status: 'published', published: { ...data, _revision: revision }, publishedAt: new Date(), updatedAt: new Date() }).where(eq(seoSettings.key, TR.KEY_OF(lang)));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'translation.publish', { type: 'translation', id: lang }, `Published ${TR.LANG_INFO[lang].name} translations${data.live ? ' (public on the live site)' : ' (preview only)'}`, { jobId: job.id, revision, strings: Object.keys(data.strings).length });
      });
      TR.clearSegmentCache();
      return { jobId: job.id, revision };
    });
  }

  // ---------------------------------------------------------------- Menus (src/data/menu.json, read by build.mjs through lib/menu.mjs)
  get menuFile() { return resolve(this.cfg.siteRoot, 'src/data/menu.json'); }
  /** menu.json holds the published menus (or the ones being delivered); without published Studio menus there is no file. */
  private async writeMenus(override?: { menu: MENU.Menu; revision: string }) {
    const content = await MENU.publishedFile(this.db, override);
    if (content === null) { if (existsSync(this.menuFile)) rmSync(this.menuFile); return; }
    if (existsSync(this.menuFile) && readFileSync(this.menuFile, 'utf8') === content) return;
    mkdirSync(resolve(this.menuFile, '..'), { recursive: true });
    const tmp = `${this.menuFile}.${randomBytes(4).toString('hex')}.tmp`;
    writeFileSync(tmp, content); renameSync(tmp, this.menuFile);
  }
  /** Every built page carries the new menu revision. */
  private verifyMenus(revision: string) {
    const pages = readdirSync(resolve(this.cfg.siteRoot, 'src/pages')).filter((f) => f.endsWith('.html'));
    const stale = pages.filter((f) => { const p = resolve(this.cfg.siteRoot, f); return !existsSync(p) || !readFileSync(p, 'utf8').includes(`<meta name="studio-menu-rev" content="${revision}">`); });
    if (stale.length) throw new Error(`${stale.length} page${stale.length === 1 ? '' : 's'} do not carry the new menus (e.g. ${stale[0]}). build.mjs must apply src/data/menu.json.`);
  }
  async publishMenus(actor: NonNullable<Actor>) {
    return this.locked(async () => {
      const row = await MENU.loadRow(this.db);
      if (!row || row.status !== 'approved' || !row.draft) throw new AppError(409, 'Only approved menus can be published.');
      const menu = MENU.menuSchema.parse(row.draft); const revision = randomUUID();
      const { job, log } = await this.deliver('publish_menus', actor, null, null, async (log) => {
        await this.writeSite({ menus: { menu, revision } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifyMenus(revision);
      }, 'Publishing the menus failed');
      await this.db.transaction(async (tx) => {
        await tx.update(seoSettings).set({ status: 'published', published: { ...menu, _revision: revision } as unknown as Record<string, unknown>, publishedAt: new Date(), updatedAt: new Date() }).where(eq(seoSettings.key, MENU.KEY));
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'menu.publish', { type: 'menu', id: MENU.KEY }, 'Published the website menus', { jobId: job.id, revision });
      });
      return { jobId: job.id, revision };
    });
  }

  // ---------------------------------------------------------------- Settings Center (src/data/site-settings.json)
  get siteSettingsFile() { return resolve(this.cfg.siteRoot, 'src/data/site-settings.json'); }
  /** Writes the published (or the given) website settings; removes the file when settings were never published. */
  private async writeSiteSettings(override?: { values: SET.Values; revision: string }) {
    const v = override ? { ...override.values, revision: override.revision } : await SET.publishedValues(this.db);
    const f = this.siteSettingsFile;
    if (!v) { if (existsSync(f)) rmSync(f); return []; }
    const { content, mediaIds } = await SET.siteFile(this.db, v, v.revision);
    if (!existsSync(f) || readFileSync(f, 'utf8') !== content) {
      mkdirSync(resolve(f, '..'), { recursive: true });
      const tmp = `${f}.${randomBytes(4).toString('hex')}.tmp`;
      writeFileSync(tmp, content); renameSync(tmp, f);
    }
    return mediaIds;
  }
  /** Every built page carries the new settings revision. */
  private verifySiteSettings(revision: string) {
    const pages = readdirSync(resolve(this.cfg.siteRoot, 'src/pages')).filter((f) => f.endsWith('.html'));
    const stale = pages.filter((f) => { const p = resolve(this.cfg.siteRoot, f); return !existsSync(p) || !readFileSync(p, 'utf8').includes(`<meta name="studio-settings-rev" content="${revision}">`); });
    if (stale.length) throw new Error(`${stale.length} page${stale.length === 1 ? '' : 's'} do not carry the new settings (e.g. ${stale[0]}). build.mjs must apply src/data/site-settings.json.`);
  }
  /** Publishes the saved General, Branding and Contact settings: writes the file, rebuilds, verifies, then records it. */
  async publishSiteSettings(actor: NonNullable<Actor>) {
    return this.locked(async () => {
      const values = await SET.draftValues(this.db); const revision = randomUUID();
      const { job, log } = await this.deliver('publish_settings', actor, null, null, async (log) => {
        await this.writeSite({ settings: { values, revision } });
        log.push(await this.runner(this.cfg, { kind: 'live' }));
        this.verifySiteSettings(revision);
      }, 'Publishing the settings failed');
      await this.db.transaction(async (tx) => {
        for (const c of SET.SITE_CATEGORIES) {
          const published = { ...values[c], _revision: revision } as unknown as Record<string, unknown>;
          const key = SET.rowKey(c); const now = new Date();
          const [row] = await tx.select({ key: seoSettings.key }).from(seoSettings).where(eq(seoSettings.key, key));
          if (row) await tx.update(seoSettings).set({ published, status: 'published', publishedAt: now, updatedAt: now }).where(eq(seoSettings.key, key));
          else await tx.insert(seoSettings).values({ key, draft: values[c] as unknown as Record<string, unknown>, published, status: 'published', publishedAt: now, updatedBy: actor.id });
        }
        await tx.update(publishJobs).set({ status: 'succeeded', log: log.join('\n').slice(-20000), finishedAt: new Date() }).where(eq(publishJobs.id, job.id));
        await audit(tx, actor, 'settings.publish', { type: 'settings', id: 'site' }, 'Published the website settings', { jobId: job.id, revision });
      });
      return { jobId: job.id, revision };
    });
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
      ...(Array.isArray(d.partners) ? { partners: (d.partners as { name: string; slug: string }[]).map((x) => ({ name: e(x.name), slug: e(x.slug) })) } : {}),
      // media_img escapes alt itself; keep alt raw here to avoid double escaping
    } : {},
  };
}
