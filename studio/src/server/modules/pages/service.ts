// Pages: working copy (settings + block document), immutable revisions and the same editorial workflow as projects.
import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { pages, pageRevisions, media, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { BLOCK_MAP, DOC_VERSION, validateDoc, type Doc } from './blocks.ts';
import { docMediaIds, type PageSnapshot } from './render.ts';

type Status = typeof pages.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RESERVED = new Set(['index', '404', 'studio', 'assets', 'sitemap', 'robots']);
const NO_MARKUP = (v: string) => !/[<>\r\n]/.test(v);

export const settingsSchema = z.object({
  title: z.string().trim().min(2, 'Add a page title.').max(80).refine(NO_MARKUP, 'Titles cannot contain < > or line breaks.'),
  slug: z.string().trim().max(60).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  description: z.string().trim().max(170).refine(NO_MARKUP, 'The description cannot contain < > or line breaks.').default(''),
  navSection: z.enum(['none', 'about', 'pillars', 'projects', 'news', 'partners', 'contact', 'involved']).default('none'),
  noindex: z.boolean().default(false),
}).strict();
const saveSchema = settingsSchema.extend({ doc: z.unknown() }).strict();

export const newId = () => randomBytes(6).toString('hex');
const blk = (type: string, props: Record<string, unknown> = {}) => {
  const d = BLOCK_MAP.get(type)!;
  return { id: newId(), type, v: d.version, hidden: false, props: { ...structuredClone(d.defaults), ...props } };
};

export const TEMPLATES: Record<string, { label: string; description: string; build: (title: string) => Doc }> = {
  blank: { label: 'Blank page', description: 'Just the page header.', build: (title) => ({ version: DOC_VERSION, blocks: [blk('page_header', { title, label: title })] }) },
  content: { label: 'Content page', description: 'Header, text and a call to action.', build: (title) => ({ version: DOC_VERSION, blocks: [blk('page_header', { title, label: title }), blk('rich_text'), blk('cta')] }) },
  campaign: { label: 'Campaign landing page', description: 'Header, story with image, key figures, link cards, projects and a call to action.', build: (title) => ({ version: DOC_VERSION, blocks: [
    blk('page_header', { title, label: 'Campaign' }), blk('image_text'), blk('stats'), blk('section_heading', { number: '02', label: 'Take part', title: 'Ways to get involved', soft: '' }), blk('cards'), blk('project_list', { title: 'Related projects', limit: '3' }), blk('cta'),
  ] }) },
};

/** A slug may not collide with any existing site page that Studio does not own (projects, pillars, about…). */
export async function assertSlugAllowed(db: DB, cfg: Config, slug: string, exceptId?: string) {
  if (RESERVED.has(slug) || slug.startsWith('project-')) throw new AppError(409, 'This address is reserved.');
  const own = await db.select({ id: pages.id }).from(pages).where(eq(pages.slug, slug));
  if (own.some((r) => r.id !== exceptId)) throw new AppError(409, 'Another Studio page already uses this address.');
  if (own.length === 0 || own.every((r) => r.id === exceptId)) {
    const studioSlugs = new Set((await db.select({ slug: pages.slug }).from(pages)).map((r) => r.slug));
    const siteFiles = existsSync(resolve(cfg.siteRoot, 'src/pages')) ? readdirSync(resolve(cfg.siteRoot, 'src/pages')) : [];
    if (siteFiles.includes(`${slug}.html`) && !studioSlugs.has(slug)) throw new AppError(409, 'A page with this address already exists on the website.');
  }
}

export const snapshotOf = (p: typeof pages.$inferSelect): PageSnapshot =>
  ({ slug: p.slug, title: p.title, description: p.description, navSection: p.navSection, noindex: p.noindex, doc: p.doc as Doc });

export async function pageProblems(db: DB, p: typeof pages.$inferSelect) {
  const out: string[] = [];
  const { problems, doc } = validateDoc(p.doc);
  out.push(...problems.map((x) => x.message));
  const visible = doc.blocks.filter((b) => !b.hidden);
  if (!visible.length) out.push('Add at least one visible block.');
  if (visible[0]?.type !== 'page_header') out.push('Start the page with a Page header block, so it has a proper title.');
  if (!p.description) out.push('Add a short description for search results (Page settings).');
  const ids = docMediaIds({ blocks: visible });
  if (ids.length) {
    const rows = await db.select().from(media).where(inArray(media.id, ids));
    if (rows.length !== ids.length) out.push('An image used on this page no longer exists.');
    for (const m of rows) {
      if (!m.alt) out.push(`Add alt text to “${m.originalName}”.`);
      if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`);
    }
  }
  return [...new Set(out)];
}

export async function createPage(db: DB, cfg: Config, actor: NonNullable<Actor>, raw: unknown) {
  const body = z.object({ title: settingsSchema.shape.title, slug: settingsSchema.shape.slug, template: z.enum(['blank', 'content', 'campaign']).default('blank') }).safeParse(raw);
  if (!body.success) throw new AppError(422, 'Some fields need attention.', body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  await assertSlugAllowed(db, cfg, body.data.slug);
  const [p] = await db.insert(pages).values({ title: body.data.title, slug: body.data.slug, doc: TEMPLATES[body.data.template].build(body.data.title), createdBy: actor.id, updatedBy: actor.id }).returning();
  await audit(db, actor, 'page.create', { type: 'page', id: p.id }, `Created page “${p.title}” from the ${body.data.template} template`);
  return p;
}

const EDITABLE: Status[] = ['draft', 'changes_requested', 'published', 'approved'];

export async function savePage(db: DB, cfg: Config, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const body = saveSchema.safeParse(raw);
  if (!body.success) throw new AppError(422, 'Some fields need attention.', body.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  const { doc, problems } = validateDoc(body.data.doc);
  // Structural problems block saving; content problems (e.g. an empty required field) are allowed in drafts and reported.
  if (problems.some((x) => x.path === 'doc' || x.message.startsWith('Unknown block'))) throw new AppError(422, 'The page layout is not valid.', problems);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(pages).where(eq(pages.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Page not found.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, cur.status === 'in_review' ? 'This page is in review. Withdraw it before editing.' : 'Restore this page before editing.');
    if (body.data.slug !== cur.slug) {
      if (cur.publishedRevisionId) throw new AppError(409, 'The address of a published page cannot change here. Unpublish it first.');
      await assertSlugAllowed(t, cfg, body.data.slug, id);
    }
    const { doc: _d, ...settings } = body.data;
    // Keep each block's unvalidated props for drafts so editors don't lose half-finished work.
    const merged = { version: DOC_VERSION, blocks: doc.blocks };
    const [p] = await t.update(pages).set({ ...settings, doc: merged, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(pages.id, id)).returning();
    await audit(tx, actor, 'page.update', { type: 'page', id }, `Edited page “${p.title}”`, { blocks: doc.blocks.length });
    return { page: p, problems };
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'page.update' | 'page.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'page.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'page.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'page.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'page.approve' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', perm: 'page.update' },
  restore: { from: ['archived'], to: 'draft', perm: 'page.update' },
};
export const pageTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, pageId: string, snap: PageSnapshot, reason: string, userId: string) {
  const [{ n }] = await db.select({ n: max(pageRevisions.number) }).from(pageRevisions).where(eq(pageRevisions.pageId, pageId));
  const [rev] = await db.insert(pageRevisions).values({ pageId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

export async function transitionPage(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, comment = '') {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(pages).where(eq(pages.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Page not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a page that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, 'Unpublish the page before archiving it.');
    if (action === 'request_changes' && !comment.trim()) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this page.');
    const patch: Partial<typeof pages.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const problems = await pageProblems(t, cur);
      if (problems.length) throw new AppError(422, 'This page is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const { doc } = validateDoc(cur.doc);
      const rev = await addRevision(t, id, { ...snapshotOf(cur), doc }, action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;
    }
    if (action === 'withdraw' || action === 'restore') patch.approvedRevisionId = null;
    await t.update(pages).set(patch).where(eq(pages.id, id));
    if (comment.trim() || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'page', entityId: id, authorId: actor.id, kind: action, body: comment.trim().slice(0, 2000) });
    await audit(tx, actor, `page.${action}`, { type: 'page', id }, `${cur.title}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restorePageRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(pageRevisions).where(and(eq(pageRevisions.id, revisionId), eq(pageRevisions.pageId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const [cur] = await db.select().from(pages).where(eq(pages.id, id));
  if (cur.status === 'in_review') throw new AppError(409, 'Withdraw the page from review first.');
  const s = rev.snapshot as unknown as PageSnapshot;
  await db.update(pages).set({ title: s.title, description: s.description, navSection: s.navSection, noindex: s.noindex, doc: s.doc, slug: cur.publishedRevisionId ? cur.slug : s.slug, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(pages.id, id));
  await audit(db, actor, 'page.restore_revision', { type: 'page', id }, `Restored revision ${rev.number} of “${s.title}” as a draft`, { revisionId });
}

export async function listPages(db: DB) {
  return db.select({ id: pages.id, slug: pages.slug, title: pages.title, status: pages.status, publishedRevisionId: pages.publishedRevisionId, updatedAt: pages.updatedAt, navSection: pages.navSection })
    .from(pages).orderBy(asc(pages.title));
}

export async function pageHistory(db: DB, id: string) {
  const revisions = await db.select({ id: pageRevisions.id, number: pageRevisions.number, reason: pageRevisions.reason, createdAt: pageRevisions.createdAt })
    .from(pageRevisions).where(eq(pageRevisions.pageId, id)).orderBy(desc(pageRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'page'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
