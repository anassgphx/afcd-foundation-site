// News & Stories: working copy + relations, immutable revisions, editorial workflow with scheduling.
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { articles, articlePillars, articleProjects, articleGallery, articleRevisions, pillars, projects, media, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { bodyMediaIds, bodyText, type ArticleSnapshot } from './render.ts';
export { bodyMediaIds };

type Status = typeof articles.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');
const HTTPS = /^https:\/\/[^\s"'<>]+$/;

export const articleSchema = z.object({
  title: plain(160).pipe(z.string().min(3, 'Add a title.')),
  slug: z.string().trim().max(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  excerpt: plain(320).default(''),
  body: z.string().max(30000).default(''),
  type: z.enum(['programme_news', 'participant_story', 'call_for_applications', 'event_recap']).default('programme_news'),
  tags: z.array(plain(30).pipe(z.string().min(1))).max(8).default([]),
  authorName: plain(80).default(''),
  authorRole: plain(120).default(''),
  publishDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-11-22.'),
  featured: z.boolean().default(false),
  externalUrl: z.string().trim().max(500).refine((u) => u === '' || HTTPS.test(u), 'Use a full https:// address.').default(''),
  heroMediaId: z.string().uuid().nullable().default(null),
  galleryMediaIds: z.array(z.string().uuid()).max(12).default([]),
  pillarKeys: z.array(z.string()).max(4).default([]),
  projectSlugs: z.array(z.string()).max(6).default([]),
  seoTitle: plain(70).default(''),
  seoDescription: plain(170).default(''),
}).strict();
export type ArticleInput = z.infer<typeof articleSchema>;

function parse(raw: unknown): ArticleInput {
  const r = articleSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export type FullArticle = typeof articles.$inferSelect & { pillarKeys: string[]; projectSlugs: string[]; galleryMediaIds: string[] };

export async function loadArticle(db: DB, id: string): Promise<FullArticle> {
  const [a] = await db.select().from(articles).where(eq(articles.id, id));
  if (!a) throw new AppError(404, 'Story not found.');
  const pl = await db.select({ key: pillars.key, isPrimary: articlePillars.isPrimary, sort: pillars.sort }).from(articlePillars).innerJoin(pillars, eq(pillars.id, articlePillars.pillarId)).where(eq(articlePillars.articleId, id));
  pl.sort((x, y) => Number(y.isPrimary) - Number(x.isPrimary) || x.sort - y.sort);
  const pr = await db.select({ slug: projects.slug }).from(articleProjects).innerJoin(projects, eq(projects.id, articleProjects.projectId)).where(eq(articleProjects.articleId, id));
  const gal = await db.select({ id: articleGallery.mediaId }).from(articleGallery).where(eq(articleGallery.articleId, id)).orderBy(asc(articleGallery.sort));
  return { ...a, pillarKeys: pl.map((x) => x.key), projectSlugs: pr.map((x) => x.slug), galleryMediaIds: gal.map((g) => g.id) };
}

export const toArticleSnapshot = (a: FullArticle): ArticleSnapshot => ({
  slug: a.slug, title: a.title, excerpt: a.excerpt, body: a.body, type: a.type, tags: a.tags, authorName: a.authorName, authorRole: a.authorRole,
  publishDate: a.publishDate, featured: a.featured, externalUrl: a.externalUrl, heroMediaId: a.heroMediaId, galleryMediaIds: a.galleryMediaIds,
  pillarKeys: a.pillarKeys, projectSlugs: a.projectSlugs, seo: { title: a.seoTitle, description: a.seoDescription },
});

export async function articleProblems(db: DB, a: FullArticle) {
  const out: string[] = [];
  if (!a.excerpt) out.push('Add a short summary (excerpt) for cards and search results.');
  if (!a.externalUrl && bodyText(a.body).trim().split(/\s+/).filter(Boolean).length < 30) out.push('Write the story (at least 30 words), or link to where it is published.');
  if (!a.pillarKeys.length) out.push('Link the story to at least one pillar.');
  const ids = [...new Set([a.heroMediaId, ...a.galleryMediaIds, ...bodyMediaIds(a.body)].filter(Boolean) as string[])];
  if (ids.length) {
    for (const m of await db.select().from(media).where(inArray(media.id, ids))) {
      if (!m.alt) out.push(`Add alt text to “${m.originalName}”.`);
      if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`);
    }
  }
  return out;
}

async function writeRelations(db: DB, id: string, input: ArticleInput) {
  const pl = input.pillarKeys.length ? await db.select().from(pillars).where(inArray(pillars.key, input.pillarKeys)) : [];
  if (pl.length !== new Set(input.pillarKeys).size) throw new AppError(422, 'Unknown pillar.');
  const pr = input.projectSlugs.length ? await db.select().from(projects).where(inArray(projects.slug, input.projectSlugs)) : [];
  if (pr.length !== new Set(input.projectSlugs).size) throw new AppError(422, 'Unknown project.');
  const mids = [...new Set([input.heroMediaId, ...input.galleryMediaIds, ...bodyMediaIds(input.body)].filter(Boolean) as string[])];
  if (mids.length && (await db.select({ id: media.id }).from(media).where(inArray(media.id, mids))).length !== mids.length) throw new AppError(422, 'An image in this story no longer exists in the Media Library. Remove it from the text or choose another one.');
  await db.delete(articlePillars).where(eq(articlePillars.articleId, id));
  if (pl.length) await db.insert(articlePillars).values(pl.map((p) => ({ articleId: id, pillarId: p.id, isPrimary: p.key === input.pillarKeys[0] })));
  await db.delete(articleProjects).where(eq(articleProjects.articleId, id));
  if (pr.length) await db.insert(articleProjects).values(pr.map((p) => ({ articleId: id, projectId: p.id })));
  await db.delete(articleGallery).where(eq(articleGallery.articleId, id));
  const gal = [...new Set(input.galleryMediaIds)];
  if (gal.length) await db.insert(articleGallery).values(gal.map((m, i) => ({ articleId: id, mediaId: m, sort: i })));
}

const cols = (i: ArticleInput) => { const { pillarKeys: _a, projectSlugs: _b, galleryMediaIds: _c, ...rest } = i; return rest; };

async function assertSlugFree(db: DB, slug: string, exceptId?: string) {
  const rows = await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, slug));
  if (rows.some((r) => r.id !== exceptId)) throw new AppError(409, 'Another story already uses this address.');
}

export async function createArticle(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    await assertSlugFree(t, input.slug);
    const [a] = await t.insert(articles).values({ ...cols(input), createdBy: actor.id, updatedBy: actor.id }).returning();
    await writeRelations(t, a.id, input);
    await audit(tx, actor, 'news.create', { type: 'article', id: a.id }, `Created story “${a.title}”`);
    return a;
  });
}

const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updateArticle(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(articles).where(eq(articles.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Story not found.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, cur.status === 'scheduled' ? 'This story is scheduled. Unschedule it before editing.' : cur.status === 'in_review' ? 'This story is in review. Withdraw it before editing.' : 'Restore this story before editing.');
    if (input.slug !== cur.slug) { if (cur.publishedRevisionId) throw new AppError(409, 'The address of a published story cannot change.'); await assertSlugFree(t, input.slug, id); }
    const [a] = await t.update(articles).set({ ...cols(input), status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(articles.id, id)).returning();
    await writeRelations(t, id, input);
    await audit(tx, actor, 'news.update', { type: 'article', id }, `Edited story “${a.title}”`);
    return a;
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'news.update' | 'news.approve' | 'news.publish' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'news.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'news.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'news.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'news.approve' },
  schedule: { from: ['approved'], to: 'scheduled', perm: 'news.publish' },
  unschedule: { from: ['scheduled'], to: 'approved', perm: 'news.publish' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', perm: 'news.update' },
  restore: { from: ['archived'], to: 'draft', perm: 'news.update' },
};
export const articleTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, articleId: string, snap: ArticleSnapshot, reason: string, userId: string) {
  const [{ n }] = await db.select({ n: max(articleRevisions.number) }).from(articleRevisions).where(eq(articleRevisions.articleId, articleId));
  const [rev] = await db.insert(articleRevisions).values({ articleId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

export async function transitionArticle(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string; at?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(articles).where(eq(articles.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Story not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a story that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, 'Unpublish the story before archiving it.');
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this story.');
    const patch: Partial<typeof articles.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadArticle(t, id);
      const problems = await articleProblems(t, full);
      if (problems.length) throw new AppError(422, 'This story is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, id, toArticleSnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;
    }
    if (action === 'schedule') {
      const at = new Date(opts.at ?? '');
      if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 60_000) throw new AppError(422, 'Choose a date and time at least one minute from now.');
      if (at.getTime() > Date.now() + 366 * 864e5) throw new AppError(422, 'Schedule within the next year.');
      patch.scheduledAt = at;
    }
    if (action === 'unschedule') patch.scheduledAt = null;
    if (action === 'withdraw' || action === 'restore') { patch.approvedRevisionId = null; patch.scheduledAt = null; }
    await t.update(articles).set(patch).where(eq(articles.id, id));
    if (comment || !['withdraw', 'unschedule'].includes(action)) {
      await t.insert(reviewComments).values({ entityType: 'article', entityId: id, authorId: actor.id, kind: action, body: (action === 'schedule' ? `Scheduled for ${patch.scheduledAt!.toISOString()}` : comment).slice(0, 2000) });
    }
    await audit(tx, actor, `news.${action}`, { type: 'article', id }, `${cur.title}: ${cur.status} → ${rule.to}`, { revisionId: revId, at: patch.scheduledAt ?? undefined });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restoreArticleRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(articleRevisions).where(and(eq(articleRevisions.id, revisionId), eq(articleRevisions.articleId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const { seo, ...s } = rev.snapshot as unknown as ArticleSnapshot;
  const cur = await loadArticle(db, id);
  await updateArticle(db, actor, id, { ...s, seoTitle: seo.title, seoDescription: seo.description, slug: cur.publishedRevisionId ? cur.slug : s.slug });
}

export async function listArticles(db: DB) {
  const rows = await db.select({ id: articles.id, slug: articles.slug, title: articles.title, type: articles.type, status: articles.status, publishDate: articles.publishDate, featured: articles.featured, externalUrl: articles.externalUrl, scheduledAt: articles.scheduledAt, publishedRevisionId: articles.publishedRevisionId, updatedAt: articles.updatedAt })
    .from(articles).orderBy(desc(articles.publishDate), asc(articles.title));
  const pl = await db.select({ articleId: articlePillars.articleId, name: pillars.name, colour: pillars.colour, isPrimary: articlePillars.isPrimary }).from(articlePillars).innerJoin(pillars, eq(pillars.id, articlePillars.pillarId));
  return rows.map((r) => ({ ...r, pillars: pl.filter((p) => p.articleId === r.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)) }));
}

export async function articleHistory(db: DB, id: string) {
  const revisions = await db.select({ id: articleRevisions.id, number: articleRevisions.number, reason: articleRevisions.reason, createdAt: articleRevisions.createdAt }).from(articleRevisions).where(eq(articleRevisions.articleId, id)).orderBy(desc(articleRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'article'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
