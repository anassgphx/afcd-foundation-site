// Projects: working copy, relations, immutable revisions and the editorial state machine.
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import {
  projects, projectPillars, projectObjectives, projectGallery, projectRevisions, pillars, objectives, media, reviewComments, users,
} from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { publicRef, type MediaRow } from '../media/service.ts';
import type { Role } from '../../rbac.ts';

export type Status = typeof projects.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (max: number) => z.string().trim().max(max);

// ---------------------------------------------------------------- Validation (server-side, every write)
export const projectInputSchema = z.object({
  name: text(160).min(2, 'Add a project name.'),
  slug: text(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  reference: text(40).default(''),
  category: text(80).default(''),
  summary: text(400).default(''),
  location: text(120).default(''),
  years: text(60).default(''),
  extraFacts: z.array(z.object({ label: text(40).min(1), value: text(120).min(1) })).max(4).default([]),
  context: text(2000).default(''),
  approach: text(2000).default(''),
  activities: text(2000).default(''),
  results: text(2000).default(''),
  hasDetailPage: z.boolean().default(true),
  photoCaption: text(160).default(''),
  heroMediaId: z.string().uuid().nullable().default(null),
  galleryMediaIds: z.array(z.string().uuid()).max(12).default([]),
  pillarKeys: z.array(z.string()).min(1, 'Link the project to at least one pillar.').max(4),
  primaryPillarKey: z.string(),
  objectiveRefs: z.array(z.string().regex(/^SO-\d{2}$/)).max(6).default([]),
  seoTitle: text(70).default(''),
  seoDescription: text(170).default(''),
  sort: z.number().int().min(0).max(10000).default(100),
}).strict().refine((v) => v.pillarKeys.includes(v.primaryPillarKey), { message: 'The primary pillar must be one of the linked pillars.', path: ['primaryPillarKey'] });
export type ProjectInput = z.infer<typeof projectInputSchema>;

/** Rules that must hold before content can go to review or be published. */
export function publishProblems(p: FullProject): string[] {
  const out: string[] = [];
  if (!p.summary) out.push('Add a one-line summary.');
  if (!p.pillars.length) out.push('Link at least one pillar.');
  if (p.hasDetailPage && !(p.context || p.activities)) out.push('Add the context or the activities for the project page.');
  for (const m of [p.hero, ...p.gallery].filter(Boolean) as MediaRow[]) {
    if (!m.alt) out.push(`Add alt text to “${m.originalName}”.`);
    if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`);
  }
  return out;
}

// ---------------------------------------------------------------- Loading
export type FullProject = typeof projects.$inferSelect & {
  pillars: { key: string; name: string; isPrimary: boolean }[];
  objectiveRefs: string[];
  hero: MediaRow | null;
  gallery: MediaRow[];
};

export async function loadProject(db: DB, id: string): Promise<FullProject> {
  const [p] = await db.select().from(projects).where(eq(projects.id, id));
  if (!p) throw new AppError(404, 'Project not found.');
  const pls = await db.select({ key: pillars.key, name: pillars.name, isPrimary: projectPillars.isPrimary, sort: pillars.sort })
    .from(projectPillars).innerJoin(pillars, eq(pillars.id, projectPillars.pillarId)).where(eq(projectPillars.projectId, id));
  pls.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sort - b.sort);
  const objs = await db.select({ ref: objectives.ref }).from(projectObjectives)
    .innerJoin(objectives, eq(objectives.id, projectObjectives.objectiveId)).where(eq(projectObjectives.projectId, id)).orderBy(asc(objectives.sort));
  const hero = p.heroMediaId ? (await db.select().from(media).where(eq(media.id, p.heroMediaId)))[0] ?? null : null;
  const gallery = await db.select({ m: media }).from(projectGallery).innerJoin(media, eq(media.id, projectGallery.mediaId))
    .where(eq(projectGallery.projectId, id)).orderBy(asc(projectGallery.sort));
  return { ...p, pillars: pls.map(({ sort: _s, ...r }) => r), objectiveRefs: objs.map((o) => o.ref), hero, gallery: gallery.map((g) => g.m) };
}

// ---------------------------------------------------------------- Public snapshot (exact entry written to src/data/projects.json)
export type Snapshot = {
  slug: string; file: string | null; name: string; pillar: string; pillars: string[]; category: string; summary: string; sort: number;
  seo: { title: string; description: string };
  media: string[];                                   // media ids referenced (for copying derivatives)
  detail: Record<string, unknown>;
};

export function toSnapshot(p: FullProject): Snapshot {
  const primary = p.pillars.find((x) => x.isPrimary) ?? p.pillars[0];
  const facts: [string, string][] = [['Pillar', primary?.name ?? ''], ['Category', p.category]];
  if (p.location) facts.push(['Location', p.location]);
  if (p.years) facts.push(['Years', p.years]);
  for (const f of p.extraFacts) facts.push([f.label, f.value]);
  const rows = ([['Context', p.context], ['Approach', p.approach], ['Activities', p.activities], ['Results', p.results]] as [string, string][])
    .filter(([, v]) => v);
  const detail = p.hasDetailPage ? {
    lede: p.summary, facts: facts.filter(([, v]) => v), rows,
    photo: p.photoCaption || `${p.name} · project photo`,
    hero: p.hero ? publicRef(p.hero) : null,
    gallery: p.gallery.map((m) => publicRef(m)),
    objectives: p.objectiveRefs,
    revision: '',
  } : {};
  return {
    slug: p.slug, file: p.hasDetailPage ? `project-${p.slug}.html` : null, name: p.name,
    pillar: primary?.key ?? '', pillars: p.pillars.map((x) => x.key), category: p.category, summary: p.summary, sort: p.sort,
    seo: { title: p.seoTitle, description: p.seoDescription },
    media: [p.hero, ...p.gallery].filter(Boolean).map((m) => (m as MediaRow).id),
    detail,
  };
}

async function addRevision(db: DB, projectId: string, snap: Snapshot, reason: string, userId: string | null) {
  const [{ n }] = await db.select({ n: max(projectRevisions.number) }).from(projectRevisions).where(eq(projectRevisions.projectId, projectId));
  const [rev] = await db.insert(projectRevisions).values({ projectId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

// ---------------------------------------------------------------- Writes
const EDITABLE: Status[] = ['draft', 'changes_requested', 'published', 'approved'];

async function writeRelations(db: DB, id: string, input: ProjectInput) {
  const pl = await db.select().from(pillars).where(inArray(pillars.key, input.pillarKeys));
  if (pl.length !== new Set(input.pillarKeys).size) throw new AppError(422, 'Unknown pillar.');
  const ob = input.objectiveRefs.length ? await db.select().from(objectives).where(inArray(objectives.ref, input.objectiveRefs)) : [];
  if (ob.length !== new Set(input.objectiveRefs).size) throw new AppError(422, 'Unknown strategic objective.');
  const mediaIds = [...new Set([input.heroMediaId, ...input.galleryMediaIds].filter(Boolean) as string[])];
  if (mediaIds.length) {
    const found = await db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds));
    if (found.length !== mediaIds.length) throw new AppError(422, 'An image no longer exists in the media library.');
  }
  await db.delete(projectPillars).where(eq(projectPillars.projectId, id));
  await db.insert(projectPillars).values(pl.map((x) => ({ projectId: id, pillarId: x.id, isPrimary: x.key === input.primaryPillarKey })));
  await db.delete(projectObjectives).where(eq(projectObjectives.projectId, id));
  if (ob.length) await db.insert(projectObjectives).values(ob.map((o) => ({ projectId: id, objectiveId: o.id })));
  await db.delete(projectGallery).where(eq(projectGallery.projectId, id));
  const gal = [...new Set(input.galleryMediaIds)];
  if (gal.length) await db.insert(projectGallery).values(gal.map((m, i) => ({ projectId: id, mediaId: m, sort: i })));
}

function columns(input: ProjectInput) {
  const { galleryMediaIds: _g, pillarKeys: _p, primaryPillarKey: _pp, objectiveRefs: _o, ...cols } = input;
  return cols;
}

export async function createProject(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    await assertSlugFree(tx as unknown as DB, input.slug);
    const [p] = await tx.insert(projects).values({ ...columns(input), status: 'draft', createdBy: actor.id, updatedBy: actor.id }).returning();
    await writeRelations(tx as unknown as DB, p.id, input);
    await audit(tx, actor, 'project.create', { type: 'project', id: p.id }, `Created “${p.name}”`);
    return p;
  });
}

/** Editing a published or approved project creates a new draft; the live site keeps the published revision. */
export async function updateProject(db: DB, actor: NonNullable<Actor>, role: Role, id: string, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(projects).where(eq(projects.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Project not found.');
    if (!EDITABLE.includes(cur.status)) {
      throw new AppError(409, cur.status === 'in_review' ? 'This project is in review. Withdraw it before editing.' : 'Restore this project before editing.');
    }
    if (role === 'seo_manager') {
      // SEO managers may only touch SEO fields.
      const [p] = await t.update(projects).set({ seoTitle: input.seoTitle, seoDescription: input.seoDescription, updatedBy: actor.id, updatedAt: new Date() }).where(eq(projects.id, id)).returning();
      await audit(tx, actor, 'project.seo', { type: 'project', id }, `Updated SEO for “${p.name}”`);
      return p;
    }
    if (input.slug !== cur.slug) {
      if (cur.publishedRevisionId) throw new AppError(409, 'The URL of a published project cannot change here. Unpublish it first, or ask for a redirect.');
      await assertSlugFree(t, input.slug, id);
    }
    const [p] = await t.update(projects).set({
      ...columns(input), status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date(),
    }).where(eq(projects.id, id)).returning();
    await writeRelations(t, id, input);
    await audit(tx, actor, 'project.update', { type: 'project', id }, `Edited “${p.name}”`, { from: cur.status });
    return p;
  });
}

function parse(raw: unknown): ProjectInput {
  const r = projectInputSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

async function assertSlugFree(db: DB, slug: string, exceptId?: string) {
  const rows = await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, slug));
  if (rows.some((r) => r.id !== exceptId)) throw new AppError(409, 'Another project already uses this URL.');
}

// ---------------------------------------------------------------- Workflow
export type Transition = 'submit' | 'withdraw' | 'request_changes' | 'approve' | 'archive' | 'restore';

const RULES: Record<Transition, { from: Status[]; to: Status }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft' },
  request_changes: { from: ['in_review'], to: 'changes_requested' },
  approve: { from: ['in_review'], to: 'approved' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived' },
  restore: { from: ['archived'], to: 'draft' },
};

export async function transition(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: Transition, comment = '') {
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(projects).where(eq(projects.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Project not found.');
    const rule = RULES[action];
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a project that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, 'Unpublish the project before archiving it.');
    if (action === 'request_changes' && !comment.trim()) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') {
      throw new AppError(409, 'Someone other than the author must approve this project.');
    }

    const patch: Partial<typeof projects.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadProject(t, id);
      const problems = publishProblems(full);
      if (problems.length) throw new AppError(422, 'This project is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, id, toSnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') patch.approvedRevisionId = rev.id;   // this frozen snapshot is what gets published
    }
    if (action === 'withdraw' || action === 'restore') patch.approvedRevisionId = null;
    await t.update(projects).set(patch).where(eq(projects.id, id));
    if (comment.trim() || action !== 'withdraw') {
      await t.insert(reviewComments).values({ entityType: 'project', entityId: id, authorId: actor.id, kind: action, body: comment.trim().slice(0, 2000) });
    }
    await audit(tx, actor, `project.${action}`, { type: 'project', id }, `${cur.name}: ${cur.status} → ${rule.to}`, { revisionId: revId, comment: comment || undefined });
    return { status: rule.to, revisionId: revId };
  });
}

/** Copy an older revision back into the working copy as a new draft (a rollback that still goes through review). */
export async function restoreRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [rev] = await t.select().from(projectRevisions).where(and(eq(projectRevisions.id, revisionId), eq(projectRevisions.projectId, id)));
    if (!rev) throw new AppError(404, 'Revision not found.');
    const s = rev.snapshot as unknown as Snapshot;
    const d = s.detail as Record<string, unknown> & { facts?: [string, string][]; rows?: [string, string][]; hero?: { id: string } | null; gallery?: { id: string }[]; objectives?: string[]; photo?: string };
    const row = (k: string) => d.rows?.find((r) => r[0] === k)?.[1] ?? '';
    const fact = (k: string) => d.facts?.find((r) => r[0] === k)?.[1] ?? '';
    const input: ProjectInput = projectInputSchema.parse({
      name: s.name, slug: s.slug, category: s.category, summary: s.summary, sort: s.sort,
      location: fact('Location'), years: fact('Years'),
      extraFacts: (d.facts ?? []).filter((f) => !['Pillar', 'Category', 'Location', 'Years'].includes(f[0])).map(([label, value]) => ({ label, value })),
      context: row('Context'), approach: row('Approach'), activities: row('Activities'), results: row('Results'),
      hasDetailPage: !!s.file, photoCaption: d.photo ?? '', heroMediaId: d.hero?.id ?? null, galleryMediaIds: (d.gallery ?? []).map((g) => g.id),
      pillarKeys: s.pillars, primaryPillarKey: s.pillar, objectiveRefs: d.objectives ?? [],
      seoTitle: s.seo?.title ?? '', seoDescription: s.seo?.description ?? '',
    });
    const [cur] = await t.select().from(projects).where(eq(projects.id, id)).for('update');
    if (cur.status === 'in_review') throw new AppError(409, 'Withdraw the project from review first.');
    await t.update(projects).set({ ...columns(input), status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(projects.id, id));
    await writeRelations(t, id, input);
    await audit(tx, actor, 'project.restore_revision', { type: 'project', id }, `Restored revision ${rev.number} of “${s.name}” as a draft`, { revisionId });
  });
}

// ---------------------------------------------------------------- Listing
export async function listProjects(db: DB) {
  const rows = await db.select().from(projects).orderBy(asc(projects.sort), asc(projects.name));
  const pl = await db.select({ projectId: projectPillars.projectId, key: pillars.key, name: pillars.name, colour: pillars.colour, isPrimary: projectPillars.isPrimary })
    .from(projectPillars).innerJoin(pillars, eq(pillars.id, projectPillars.pillarId));
  // list extras: a small thumbnail of the main photo and who last edited the record
  const mids = [...new Set(rows.map((r) => r.heroMediaId).filter(Boolean) as string[])];
  const thumbs = new Map((mids.length ? await db.select({ id: media.id, key: media.storageKey }).from(media).where(inArray(media.id, mids)) : []).map((m) => [m.id, `/studio/media-file/${m.key}-480.webp`]));
  const uids = [...new Set(rows.map((r) => r.updatedBy).filter(Boolean) as string[])];
  const names = new Map((uids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uids)) : []).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r, thumb: r.heroMediaId ? thumbs.get(r.heroMediaId) ?? null : null, updatedByName: r.updatedBy ? names.get(r.updatedBy) ?? null : null,
    pillars: pl.filter((x) => x.projectId === r.id).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary)) }));
}

export async function projectHistory(db: DB, id: string) {
  const revs = await db.select({ id: projectRevisions.id, number: projectRevisions.number, reason: projectRevisions.reason, createdAt: projectRevisions.createdAt, createdBy: projectRevisions.createdBy })
    .from(projectRevisions).where(eq(projectRevisions.projectId, id)).orderBy(desc(projectRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'project'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions: revs, comments };
}

export const statusCounts = (db: DB) =>
  db.select({ status: projects.status, n: sql<number>`count(*)::int` }).from(projects).groupBy(projects.status);
