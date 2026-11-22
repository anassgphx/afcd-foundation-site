// Opportunities: calls for applications, volunteering, jobs, internships, consultancies and calls for partners.
// Real opportunities only; nothing is imported. Same editorial workflow; only published revisions reach the website.
import { and, asc, desc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { opportunities, opportunityRevisions, pillars, projects, media, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';

type Status = typeof opportunities.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');

export const TYPE_LABEL: Record<string, string> = {
  call_for_applications: 'Call for applications', volunteering: 'Volunteering', job: 'Job', internship: 'Internship', consultancy: 'Consultancy', call_for_partners: 'Call for partners',
};

export const opportunitySchema = z.object({
  title: plain(140).pipe(z.string().min(3, 'Add a title.')),
  slug: z.string().trim().max(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  type: z.enum(['call_for_applications', 'volunteering', 'job', 'internship', 'consultancy', 'call_for_partners']).default('call_for_applications'),
  summary: plain(320).default(''),
  body: z.string().max(20000).default(''),
  eligibility: z.array(plain(200).pipe(z.string().min(1))).max(12).default([]),
  benefits: z.array(plain(200).pipe(z.string().min(1))).max(12).default([]),
  location: plain(120).default(''),
  commitment: plain(80).default(''),
  opensOn: z.string().regex(DATE, 'Use a date like 2027-01-20.').nullable().default(null),
  deadline: z.string().regex(DATE, 'Use a date like 2027-02-15.').nullable().default(null),
  applyMethod: z.enum(['external', 'email', 'contact']).default('external'),
  applyUrl: z.string().trim().max(500).refine((u) => u === '' || HTTPS.test(u), 'Use a full https:// address.').default(''),
  applyEmail: z.string().trim().max(160).refine((u) => u === '' || EMAIL.test(u), 'Use a valid email address.').default(''),
  pillarKey: z.string().nullable().default(null),
  projectSlug: z.string().nullable().default(null),
  heroMediaId: z.string().uuid().nullable().default(null),
  seoTitle: plain(70).default(''),
  seoDescription: plain(170).default(''),
}).strict().superRefine((v, ctx) => {
  if (v.opensOn && v.deadline && v.deadline < v.opensOn) ctx.addIssue({ code: 'custom', path: ['deadline'], message: 'The deadline is before the opening date.' });
  if (v.applyMethod === 'external' && !v.applyUrl) ctx.addIssue({ code: 'custom', path: ['applyUrl'], message: 'Add the application link.' });
  if (v.applyMethod === 'email' && !v.applyEmail) ctx.addIssue({ code: 'custom', path: ['applyEmail'], message: 'Add the email address applications go to.' });
});
export type OpportunityInput = z.infer<typeof opportunitySchema>;
export type OpportunitySnapshot = OpportunityInput;

function parse(raw: unknown): OpportunityInput {
  const r = opportunitySchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export type FullOpportunity = typeof opportunities.$inferSelect & { pillarKey: string | null; projectSlug: string | null };

export async function loadOpportunity(db: DB, id: string): Promise<FullOpportunity> {
  const [o] = await db.select().from(opportunities).where(eq(opportunities.id, id));
  if (!o) throw new AppError(404, 'Opportunity not found.');
  const pk = o.pillarId ? (await db.select({ key: pillars.key }).from(pillars).where(eq(pillars.id, o.pillarId)))[0]?.key ?? null : null;
  const ps = o.projectId ? (await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, o.projectId)))[0]?.slug ?? null : null;
  return { ...o, pillarKey: pk, projectSlug: ps };
}

export const toOpportunitySnapshot = (o: FullOpportunity): OpportunitySnapshot => ({
  title: o.title, slug: o.slug, type: o.type, summary: o.summary, body: o.body, eligibility: o.eligibility, benefits: o.benefits, location: o.location,
  commitment: o.commitment, opensOn: o.opensOn, deadline: o.deadline, applyMethod: o.applyMethod, applyUrl: o.applyUrl, applyEmail: o.applyEmail,
  pillarKey: o.pillarKey, projectSlug: o.projectSlug, heroMediaId: o.heroMediaId, seoTitle: o.seoTitle, seoDescription: o.seoDescription,
});

export async function opportunityProblems(db: DB, o: FullOpportunity) {
  const out: string[] = [];
  if (!o.summary) out.push('Add a short summary for the list and search results.');
  if (o.body.trim().split(/\s+/).filter(Boolean).length < 20) out.push('Describe the opportunity (at least 20 words): what it is and what people will do.');
  if (!o.eligibility.length) out.push('Add who can apply (at least one eligibility point).');
  if (o.heroMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, o.heroMediaId));
    if (!m) out.push('The image no longer exists in the media library.');
    else {
      if (!m.alt) out.push(`Add alt text to “${m.originalName}”.`);
      if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`);
    }
  }
  return out;
}

async function relationIds(db: DB, input: OpportunityInput) {
  const pillarId = input.pillarKey ? (await db.select({ id: pillars.id }).from(pillars).where(eq(pillars.key, input.pillarKey)))[0]?.id : null;
  if (input.pillarKey && !pillarId) throw new AppError(422, 'Unknown pillar.');
  const projectId = input.projectSlug ? (await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, input.projectSlug)))[0]?.id : null;
  if (input.projectSlug && !projectId) throw new AppError(422, 'Unknown project.');
  if (input.heroMediaId && !(await db.select({ id: media.id }).from(media).where(eq(media.id, input.heroMediaId))).length) throw new AppError(422, 'The image no longer exists in the media library.');
  const { pillarKey: _a, projectSlug: _b, ...rest } = input;
  return { ...rest, pillarId: pillarId ?? null, projectId: projectId ?? null };
}

async function assertSlugFree(db: DB, slug: string, exceptId?: string) {
  if ((await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.slug, slug))).some((r) => r.id !== exceptId)) throw new AppError(409, 'Another opportunity already uses this address.');
}

export async function createOpportunity(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    await assertSlugFree(t, input.slug);
    const [o] = await t.insert(opportunities).values({ ...(await relationIds(t, input)), createdBy: actor.id, updatedBy: actor.id }).returning();
    await audit(tx, actor, 'opportunity.create', { type: 'opportunity', id: o.id }, `Created opportunity “${o.title}”`);
    return o;
  });
}

const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updateOpportunity(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(opportunities).where(eq(opportunities.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Opportunity not found.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, cur.status === 'in_review' ? 'This opportunity is in review. Withdraw it before editing.' : 'Restore this opportunity before editing.');
    if (input.slug !== cur.slug) { if (cur.publishedRevisionId) throw new AppError(409, 'The address of a published opportunity cannot change.'); await assertSlugFree(t, input.slug, id); }
    const [o] = await t.update(opportunities).set({ ...(await relationIds(t, input)), status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(opportunities.id, id)).returning();
    await audit(tx, actor, 'opportunity.update', { type: 'opportunity', id }, `Edited opportunity “${o.title}”`);
    return o;
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'opportunity.update' | 'opportunity.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'opportunity.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'opportunity.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'opportunity.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'opportunity.approve' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', perm: 'opportunity.update' },
  restore: { from: ['archived'], to: 'draft', perm: 'opportunity.update' },
};
export const opportunityTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, opportunityId: string, snap: OpportunitySnapshot, reason: string, userId: string) {
  const [{ n }] = await db.select({ n: max(opportunityRevisions.number) }).from(opportunityRevisions).where(eq(opportunityRevisions.opportunityId, opportunityId));
  const [rev] = await db.insert(opportunityRevisions).values({ opportunityId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

export async function transitionOpportunity(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(opportunities).where(eq(opportunities.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Opportunity not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} an opportunity that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, 'Remove the opportunity from the website before archiving it.');
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this opportunity.');
    const patch: Partial<typeof opportunities.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadOpportunity(t, id);
      const problems = await opportunityProblems(t, full);
      if (problems.length) throw new AppError(422, 'This opportunity is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, id, toOpportunitySnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;
    }
    if (action === 'withdraw' || action === 'restore') patch.approvedRevisionId = null;
    await t.update(opportunities).set(patch).where(eq(opportunities.id, id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'opportunity', entityId: id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `opportunity.${action}`, { type: 'opportunity', id }, `${cur.title}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restoreOpportunityRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(opportunityRevisions).where(and(eq(opportunityRevisions.id, revisionId), eq(opportunityRevisions.opportunityId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const s = rev.snapshot as unknown as OpportunitySnapshot;
  const cur = await loadOpportunity(db, id);
  await updateOpportunity(db, actor, id, { ...s, slug: cur.publishedRevisionId ? cur.slug : s.slug });
}

export async function listOpportunities(db: DB) {
  return db.select({ id: opportunities.id, slug: opportunities.slug, title: opportunities.title, type: opportunities.type, deadline: opportunities.deadline, opensOn: opportunities.opensOn, location: opportunities.location, status: opportunities.status, publishedRevisionId: opportunities.publishedRevisionId, updatedAt: opportunities.updatedAt, pillarName: pillars.name })
    .from(opportunities).leftJoin(pillars, eq(pillars.id, opportunities.pillarId)).orderBy(desc(opportunities.updatedAt), asc(opportunities.title));
}

export async function opportunityHistory(db: DB, id: string) {
  const revisions = await db.select({ id: opportunityRevisions.id, number: opportunityRevisions.number, reason: opportunityRevisions.reason, createdAt: opportunityRevisions.createdAt }).from(opportunityRevisions).where(eq(opportunityRevisions.opportunityId, id)).orderBy(desc(opportunityRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'opportunity'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
