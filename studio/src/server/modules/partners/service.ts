// Partners: canonical organisation records with relations, immutable revisions and the same editorial workflow
// as projects (draft → in review → approved → published). Only published revisions reach the website.
import { and, asc, desc, eq, inArray, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { partners, partnerProjects, partnerRevisions, projects, media, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';

type Status = typeof partners.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');

export const SCOPE_LABEL = { international: 'International', national: 'National', local: 'Local' } as const;

export const partnerSchema = z.object({
  name: plain(140).pipe(z.string().min(2, 'Add the organisation name.')),
  slug: z.string().trim().max(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  scope: z.enum(['international', 'national', 'local']),
  category: plain(60).default(''),
  description: plain(400).default(''),
  websiteUrl: z.string().trim().max(300).refine((u) => u === '' || HTTPS.test(u), 'Use a full https:// address.').default(''),
  sinceYear: z.number().int().min(2000).max(2100).nullable().default(null),
  current: z.boolean().default(true),
  logoMediaId: z.string().uuid().nullable().default(null),
  projectSlugs: z.array(z.string()).max(12).default([]),
  sort: z.number().int().min(0).max(10000).default(100),
  provenance: plain(300).default(''),
}).strict();
export type PartnerInput = z.infer<typeof partnerSchema>;

export type PartnerSnapshot = Omit<PartnerInput, 'provenance'>;

export const nameKey = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const slugify = (n: string) => nameKey(n).replace(/ /g, '-').slice(0, 80);

function parse(raw: unknown): PartnerInput {
  const r = partnerSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export type FullPartner = typeof partners.$inferSelect & { projectSlugs: string[] };

export async function loadPartner(db: DB, id: string): Promise<FullPartner> {
  const [p] = await db.select().from(partners).where(eq(partners.id, id));
  if (!p) throw new AppError(404, 'Partner not found.');
  const pr = await db.select({ slug: projects.slug, sort: projects.sort }).from(partnerProjects).innerJoin(projects, eq(projects.id, partnerProjects.projectId)).where(eq(partnerProjects.partnerId, id));
  pr.sort((a, b) => a.sort - b.sort);
  return { ...p, projectSlugs: pr.map((x) => x.slug) };
}

export const toPartnerSnapshot = (p: FullPartner): PartnerSnapshot => ({
  name: p.name, slug: p.slug, scope: p.scope, category: p.category, description: p.description, websiteUrl: p.websiteUrl,
  sinceYear: p.sinceYear, current: p.current, logoMediaId: p.logoMediaId, projectSlugs: p.projectSlugs, sort: p.sort,
});

export async function partnerProblems(db: DB, p: FullPartner) {
  const out: string[] = [];
  if (p.logoMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, p.logoMediaId));
    if (!m) out.push('The logo no longer exists in the media library.');
    else {
      if (!m.alt) out.push(`Add alt text to the logo “${m.originalName}” (usually the organisation name).`);
      if (!m.rightsConfirmed) out.push(`Confirm AFCD may use the logo “${m.originalName}” (permission from the partner).`);
    }
  }
  return out;
}

async function writeRelations(db: DB, id: string, input: PartnerInput) {
  const pr = input.projectSlugs.length ? await db.select().from(projects).where(inArray(projects.slug, input.projectSlugs)) : [];
  if (pr.length !== new Set(input.projectSlugs).size) throw new AppError(422, 'Unknown project.');
  if (input.logoMediaId && !(await db.select({ id: media.id }).from(media).where(eq(media.id, input.logoMediaId))).length) throw new AppError(422, 'The logo no longer exists in the media library.');
  await db.delete(partnerProjects).where(eq(partnerProjects.partnerId, id));
  if (pr.length) await db.insert(partnerProjects).values(pr.map((p) => ({ partnerId: id, projectId: p.id })));
}

const cols = (i: PartnerInput) => { const { projectSlugs: _a, ...rest } = i; return { ...rest, nameKey: nameKey(i.name) }; };

async function assertUnique(db: DB, input: PartnerInput, exceptId?: string) {
  const bySlug = await db.select({ id: partners.id }).from(partners).where(eq(partners.slug, input.slug));
  if (bySlug.some((r) => r.id !== exceptId)) throw new AppError(409, 'Another partner already uses this address.');
  const byName = await db.select({ id: partners.id, name: partners.name }).from(partners).where(eq(partners.nameKey, nameKey(input.name)));
  const dup = byName.find((r) => r.id !== exceptId);
  if (dup) throw new AppError(409, `“${dup.name}” is already in Studio. Edit that record instead of adding a duplicate.`);
}

export async function createPartner(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    await assertUnique(t, input);
    const [p] = await t.insert(partners).values({ ...cols(input), createdBy: actor.id, updatedBy: actor.id }).returning();
    await writeRelations(t, p.id, input);
    await audit(tx, actor, 'partner.create', { type: 'partner', id: p.id }, `Added partner “${p.name}”`);
    return p;
  });
}

const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updatePartner(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(partners).where(eq(partners.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Partner not found.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, cur.status === 'in_review' ? 'This partner is in review. Withdraw it before editing.' : 'Restore this partner before editing.');
    if (input.slug !== cur.slug && cur.publishedRevisionId) throw new AppError(409, 'The address of a published partner cannot change.');
    await assertUnique(t, input, id);
    const [p] = await t.update(partners).set({ ...cols(input), status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(partners.id, id)).returning();
    await writeRelations(t, id, input);
    await audit(tx, actor, 'partner.update', { type: 'partner', id }, `Edited partner “${p.name}”`);
    return p;
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'partner.update' | 'partner.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'partner.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'partner.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'partner.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'partner.approve' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', perm: 'partner.update' },
  restore: { from: ['archived'], to: 'draft', perm: 'partner.update' },
};
export const partnerTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, partnerId: string, snap: PartnerSnapshot, reason: string, userId: string | null) {
  const [{ n }] = await db.select({ n: max(partnerRevisions.number) }).from(partnerRevisions).where(eq(partnerRevisions.partnerId, partnerId));
  const [rev] = await db.insert(partnerRevisions).values({ partnerId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}
export { addRevision as addPartnerRevision };

export async function transitionPartner(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(partners).where(eq(partners.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Partner not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a partner that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, 'Remove the partner from the website before archiving it.');
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this partner.');
    const patch: Partial<typeof partners.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadPartner(t, id);
      const problems = await partnerProblems(t, full);
      if (problems.length) throw new AppError(422, 'This partner is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, id, toPartnerSnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') { patch.approvedRevisionId = rev.id; patch.verifiedAt = new Date(); }
    }
    if (action === 'withdraw' || action === 'restore') patch.approvedRevisionId = null;
    await t.update(partners).set(patch).where(eq(partners.id, id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'partner', entityId: id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `partner.${action}`, { type: 'partner', id }, `${cur.name}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restorePartnerRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(partnerRevisions).where(and(eq(partnerRevisions.id, revisionId), eq(partnerRevisions.partnerId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const s = rev.snapshot as unknown as PartnerSnapshot;
  const cur = await loadPartner(db, id);
  await updatePartner(db, actor, id, { ...s, provenance: cur.provenance, slug: cur.publishedRevisionId ? cur.slug : s.slug });
}

export async function listPartners(db: DB) {
  const rows = await db.select({ id: partners.id, slug: partners.slug, name: partners.name, scope: partners.scope, category: partners.category, current: partners.current, status: partners.status, sort: partners.sort, logoMediaId: partners.logoMediaId, websiteUrl: partners.websiteUrl, publishedRevisionId: partners.publishedRevisionId, updatedAt: partners.updatedAt })
    .from(partners).orderBy(asc(partners.sort), asc(partners.name));
  const links = await db.select({ partnerId: partnerProjects.partnerId }).from(partnerProjects);
  return rows.map((r) => ({ ...r, projects: links.filter((l) => l.partnerId === r.id).length }));
}

export async function partnerHistory(db: DB, id: string) {
  const revisions = await db.select({ id: partnerRevisions.id, number: partnerRevisions.number, reason: partnerRevisions.reason, createdAt: partnerRevisions.createdAt }).from(partnerRevisions).where(eq(partnerRevisions.partnerId, id)).orderBy(desc(partnerRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'partner'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
