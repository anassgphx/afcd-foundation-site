// Publications: reports, studies, policy briefs, guides, annual reports and toolkits, with a downloadable PDF.
// Real AFCD documents only; nothing is imported. Same editorial workflow as events and opportunities: revisions,
// review by someone other than the author, and only published revisions reach the website.
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { documents, media, pillars, projects, publications, publicationRevisions, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { documentOnDisk } from './documents.ts';
import { altProblem } from '../media/alt.ts';

type Status = typeof publications.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS = /^https:\/\/[^\s"'<>]+\.[^\s"'<>]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');

export const PUB_TYPES = ['report', 'study', 'policy_brief', 'guide', 'annual_report', 'toolkit', 'other'] as const;
export const TYPE_LABEL: Record<string, string> = {
  report: 'Report', study: 'Study', policy_brief: 'Policy brief', guide: 'Guide', annual_report: 'Annual report', toolkit: 'Toolkit', other: 'Publication',
};
export const LANGS = ['en', 'fr', 'ar', 'multi'] as const;
export const LANG_LABEL: Record<string, string> = { en: 'English', fr: 'French', ar: 'Arabic', multi: 'Several languages' };

export const publicationSchema = z.object({
  title: plain(160).pipe(z.string().min(3, 'Add a title.')),
  slug: z.string().trim().max(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  type: z.enum(PUB_TYPES).default('report'),
  summary: plain(320).default(''),
  abstract: z.string().max(20000).default(''),
  publishedOn: z.string().regex(DATE, 'Use a date like 2026-06-30.').refine((v) => !Number.isNaN(Date.parse(v)), 'Not a real date.').nullable().default(null),
  authors: z.array(plain(120).pipe(z.string().min(1))).max(20).default([]),
  organisation: plain(160).default(''),
  language: z.enum(LANGS).default('en'),
  pillarKeys: z.array(z.string().max(80)).max(8).default([]),
  projectSlugs: z.array(z.string().max(80)).max(12).default([]),
  coverMediaId: z.string().uuid().nullable().default(null),
  documentId: z.string().uuid().nullable().default(null),
  externalUrl: z.string().trim().max(500).refine((u) => u === '' || HTTPS.test(u), 'Use a full https:// address.').default(''),
  seoTitle: plain(70).default(''),
  seoDescription: plain(170).default(''),
}).strict();
export type PublicationInput = z.infer<typeof publicationSchema>;
export type PublicationSnapshot = PublicationInput;

function parse(raw: unknown): PublicationInput {
  const r = publicationSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return { ...r.data, pillarKeys: [...new Set(r.data.pillarKeys)], projectSlugs: [...new Set(r.data.projectSlugs)] };
}

export type FullPublication = typeof publications.$inferSelect & { pillarKeys: string[]; projectSlugs: string[] };

export async function loadPublication(db: DB, id: string): Promise<FullPublication> {
  const [p] = await db.select().from(publications).where(eq(publications.id, id));
  if (!p) throw new AppError(404, 'Publication not found.');
  const pl = p.pillarIds.length ? await db.select({ id: pillars.id, key: pillars.key }).from(pillars).where(inArray(pillars.id, p.pillarIds)) : [];
  const pr = p.projectIds.length ? await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(inArray(projects.id, p.projectIds)) : [];
  // keep the editor's order; links whose record no longer exists drop out
  return { ...p, pillarKeys: p.pillarIds.map((x) => pl.find((r) => r.id === x)?.key).filter(Boolean) as string[], projectSlugs: p.projectIds.map((x) => pr.find((r) => r.id === x)?.slug).filter(Boolean) as string[] };
}

export const toPublicationSnapshot = (p: FullPublication): PublicationSnapshot => ({
  title: p.title, slug: p.slug, type: p.type, summary: p.summary, abstract: p.abstract, publishedOn: p.publishedOn, authors: p.authors,
  organisation: p.organisation, language: p.language as PublicationSnapshot['language'], pillarKeys: p.pillarKeys, projectSlugs: p.projectSlugs,
  coverMediaId: p.coverMediaId, documentId: p.documentId, externalUrl: p.externalUrl, seoTitle: p.seoTitle, seoDescription: p.seoDescription,
});

/** What must be done before the publication can be reviewed. */
export async function publicationProblems(db: DB, cfg: Config, p: Pick<FullPublication, 'summary' | 'publishedOn' | 'authors' | 'organisation' | 'documentId' | 'externalUrl' | 'coverMediaId'>) {
  const out: string[] = [];
  if (!p.summary) out.push('Add a short summary for the list and search results.');
  if (!p.publishedOn) out.push('Add the publication date shown on the document.');
  if (!p.authors.length && !p.organisation) out.push('Add the authors or the organisation that produced it.');
  if (!p.documentId && !p.externalUrl) out.push('Upload the PDF or add a link to where the document can be read.');
  if (p.documentId) {
    const [d] = await db.select().from(documents).where(eq(documents.id, p.documentId));
    if (!d || !documentOnDisk(cfg, d)) out.push('The PDF file is missing. Upload it again.');
  }
  if (p.coverMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, p.coverMediaId));
    if (!m) out.push('The cover image no longer exists in the media library.');
    else {
      { const ap = altProblem(m, `Add alt text to “${m.originalName}”.`); if (ap) out.push(ap); }
      if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`);
    }
  }
  return out;
}

async function relationIds(db: DB, input: PublicationInput) {
  const pl = input.pillarKeys.length ? await db.select({ id: pillars.id, key: pillars.key }).from(pillars).where(inArray(pillars.key, input.pillarKeys)) : [];
  if (pl.length !== input.pillarKeys.length) throw new AppError(422, 'Unknown pillar.');
  const pr = input.projectSlugs.length ? await db.select({ id: projects.id, slug: projects.slug }).from(projects).where(inArray(projects.slug, input.projectSlugs)) : [];
  if (pr.length !== input.projectSlugs.length) throw new AppError(422, 'Unknown project.');
  if (input.coverMediaId && !(await db.select({ id: media.id }).from(media).where(eq(media.id, input.coverMediaId))).length) throw new AppError(422, 'The cover image no longer exists in the media library.');
  if (input.documentId && !(await db.select({ id: documents.id }).from(documents).where(eq(documents.id, input.documentId))).length) throw new AppError(422, 'The PDF no longer exists. Upload it again.');
  const { pillarKeys, projectSlugs, ...rest } = input;
  return { ...rest, pillarIds: pillarKeys.map((k) => pl.find((x) => x.key === k)!.id), projectIds: projectSlugs.map((s) => pr.find((x) => x.slug === s)!.id) };
}

async function assertSlugFree(db: DB, slug: string, exceptId?: string) {
  if ((await db.select({ id: publications.id }).from(publications).where(eq(publications.slug, slug))).some((r) => r.id !== exceptId)) throw new AppError(409, 'Another publication already uses this address.');
}

export async function createPublication(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    await assertSlugFree(t, input.slug);
    const [p] = await t.insert(publications).values({ ...(await relationIds(t, input)), createdBy: actor.id, updatedBy: actor.id }).returning();
    await audit(tx, actor, 'publication.create', { type: 'publication', id: p.id }, `Created publication “${p.title}”`);
    return p;
  });
}

const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updatePublication(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(publications).where(eq(publications.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Publication not found.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, cur.status === 'in_review' ? 'This publication is in review. Withdraw it before editing.' : 'Restore this publication before editing.');
    if (input.slug !== cur.slug) { if (cur.publishedRevisionId) throw new AppError(409, 'The address of a published publication cannot change.'); await assertSlugFree(t, input.slug, id); }
    const [p] = await t.update(publications).set({ ...(await relationIds(t, input)), status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(publications.id, id)).returning();
    await audit(tx, actor, 'publication.update', { type: 'publication', id }, `Edited publication “${p.title}”`, cur.documentId !== p.documentId ? { documentId: p.documentId } : undefined);
    return p;
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'publication.update' | 'publication.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'publication.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'publication.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'publication.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'publication.approve' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', perm: 'publication.update' },
  restore: { from: ['archived'], to: 'draft', perm: 'publication.update' },
};
export const publicationTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, publicationId: string, snap: PublicationSnapshot, reason: string, userId: string) {
  const [{ n }] = await db.select({ n: max(publicationRevisions.number) }).from(publicationRevisions).where(eq(publicationRevisions.publicationId, publicationId));
  const [rev] = await db.insert(publicationRevisions).values({ publicationId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

export async function transitionPublication(db: DB, cfg: Config, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(publications).where(eq(publications.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Publication not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a publication that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, 'Remove the publication from the website before archiving it.');
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this publication.');
    const patch: Partial<typeof publications.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadPublication(t, id);
      const problems = await publicationProblems(t, cfg, full);
      if (problems.length) throw new AppError(422, 'This publication is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, id, toPublicationSnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;
    }
    if (action === 'withdraw' || action === 'restore') patch.approvedRevisionId = null;
    await t.update(publications).set(patch).where(eq(publications.id, id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'publication', entityId: id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `publication.${action}`, { type: 'publication', id }, `${cur.title}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restorePublicationRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(publicationRevisions).where(and(eq(publicationRevisions.id, revisionId), eq(publicationRevisions.publicationId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const s = rev.snapshot as unknown as PublicationSnapshot;
  const cur = await loadPublication(db, id);
  await updatePublication(db, actor, id, { ...s, slug: cur.publishedRevisionId ? cur.slug : s.slug });
}

export async function listPublications(db: DB) {
  const rows = await db.select({ id: publications.id, slug: publications.slug, title: publications.title, type: publications.type, publishedOn: publications.publishedOn,
    language: publications.language, pillarIds: publications.pillarIds, status: publications.status, publishedRevisionId: publications.publishedRevisionId, updatedAt: publications.updatedAt,
    externalUrl: publications.externalUrl, documentBytes: documents.bytes, coverKey: media.storageKey })
    .from(publications).leftJoin(documents, eq(documents.id, publications.documentId)).leftJoin(media, eq(media.id, publications.coverMediaId))
    .orderBy(desc(publications.updatedAt), asc(publications.title));
  const names = new Map((await db.select({ id: pillars.id, name: pillars.name }).from(pillars)).map((p) => [p.id, p.name]));
  return rows.map(({ pillarIds, coverKey, ...r }) => ({ ...r, pillarNames: pillarIds.map((x) => names.get(x)).filter(Boolean) as string[], cover: coverKey ? `/studio/media-file/${coverKey}-480.webp` : null }));
}

export async function publicationHistory(db: DB, id: string) {
  const revisions = await db.select({ id: publicationRevisions.id, number: publicationRevisions.number, reason: publicationRevisions.reason, createdAt: publicationRevisions.createdAt }).from(publicationRevisions).where(eq(publicationRevisions.publicationId, id)).orderBy(desc(publicationRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'publication'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
