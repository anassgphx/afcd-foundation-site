// Projects: working copy, relations, immutable revisions and the editorial state machine.
import { and, asc, desc, eq, inArray, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import {
  projects, projectPillars, projectObjectives, projectGallery, projectRevisions, pillars, objectives, media, reviewComments, users, events, partners, partnerProjects
} from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { publicRef, type MediaRow } from '../media/service.ts';
import type { Role } from '../../rbac.ts';
import { altProblem } from '../media/alt.ts';

export type Status = typeof projects.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const text = (max: number) => z.string().trim().max(max);
/** Frames for the project logo: the image's own shape, square, circle, wide, landscape and tall. */
export const LOGO_SHAPES = ['original', '1:1', 'circle', '3:1', '2:1', '4:3', '16:9', '3:4', '1:3'] as const;

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
  // project page sections: plain text only, all optional
  programObjectives: z.array(z.object({ title: text(160).min(1, 'Give each programme objective a title.'), text: text(600).default('') }).strict()).max(12).default([]),
  outcomes: z.array(z.object({ title: text(160).default(''), text: text(600).default(''), figure: text(40).default('') }).strict()
    .refine((o) => !!(o.title || o.text), { message: 'Give each outcome a title or a description.' })).max(12).default([]),
  activityItems: z.array(z.object({ title: text(160).min(1, 'Give each activity a title.'), text: text(800).default(''), when: text(40).default(''), place: text(80).default(''), mediaIds: z.array(z.string().uuid()).max(12, 'Use at most 12 photos per activity.').default([]),
    publicationSlugs: z.array(z.string().max(120)).max(6, 'Link at most 6 publications per activity.').default([]) }).strict()).max(20).default([]),   // publications: shown under the activity once published
  context: text(2000).default(''),
  approach: text(2000).default(''),
  activities: text(2000).default(''),
  results: text(2000).default(''),
  hasDetailPage: z.boolean().default(true),
  photoCaption: text(160).default(''),
  heroMediaId: z.string().uuid().nullable().default(null),
  logoMediaId: z.string().uuid().nullable().default(null),
  posterMediaId: z.string().uuid().nullable().default(null),
  logoStyle: z.object({
    shape: z.enum(LOGO_SHAPES).default('original'), fit: z.enum(['contain', 'cover']).default('contain'),
    bg: z.enum(['none', 'white', 'light', 'dark', 'pillar']).default('white'), size: z.enum(['s', 'm', 'l']).default('m'),
  }).strict().default({ shape: 'original', fit: 'contain', bg: 'white', size: 'm' }),
  galleryMediaIds: z.array(z.string().uuid()).max(12).default([]),
  pillarKeys: z.array(z.string()).min(1, 'Link the project to at least one pillar.').max(4),
  primaryPillarKey: z.string(),
  objectiveRefs: z.array(z.string().regex(/^SO-\d{2}$/)).max(6).default([]),
  partnerSlugs: z.array(z.string().regex(SLUG)).max(12).default([]),   // partners of this project (the same links the Partners editor edits)
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
  for (const m of [p.hero, p.logo, p.poster, ...p.gallery, ...Object.values(p.activityMedia)].filter(Boolean) as MediaRow[]) {
    { const ap = altProblem(m, `Add alt text to “${m.originalName}”.`); if (ap) out.push(ap); }
    if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`);
  }
  return out;
}

// ---------------------------------------------------------------- Loading
export type FullProject = typeof projects.$inferSelect & {
  pillars: { key: string; name: string; isPrimary: boolean }[];
  objectiveRefs: string[];
  hero: MediaRow | null;
  logo: MediaRow | null;
  poster: MediaRow | null;
  partnerLinks: { slug: string; name: string; scope: string; live: boolean }[];
  partnerSlugs: string[];   // partners linked to this project, live or not
  gallery: MediaRow[];
  activityMedia: Record<string, MediaRow>;   // photos used by activityItems, by id
  linkedEvents: { id: string; title: string; startDate: string; status: string; live: boolean }[];   // Studio events linked to this project (read-only here)
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
  const links = (await db.select({ slug: partners.slug, name: partners.name, scope: partners.scope, rev: partners.publishedRevisionId, sort: partners.sort })
    .from(partnerProjects).innerJoin(partners, eq(partners.id, partnerProjects.partnerId)).where(eq(partnerProjects.projectId, id)))
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)).map(({ rev, sort: _s, ...r }) => ({ ...r, live: !!rev }));
  const logo = p.logoMediaId ? (await db.select().from(media).where(eq(media.id, p.logoMediaId)))[0] ?? null : null;
  const poster = p.posterMediaId ? (await db.select().from(media).where(eq(media.id, p.posterMediaId)))[0] ?? null : null;
  const gallery = await db.select({ m: media }).from(projectGallery).innerJoin(media, eq(media.id, projectGallery.mediaId))
    .where(eq(projectGallery.projectId, id)).orderBy(asc(projectGallery.sort));
  const actIds = [...new Set((p.activityItems ?? []).flatMap((a) => a.mediaIds ?? []))];
  const actRows = actIds.length ? await db.select().from(media).where(inArray(media.id, actIds)) : [];
  return { ...p, pillars: pls.map(({ sort: _s, ...r }) => r), objectiveRefs: objs.map((o) => o.ref), partnerSlugs: links.map((l) => l.slug), partnerLinks: links, hero, logo, poster, gallery: gallery.map((g) => g.m),
    activityMedia: Object.fromEntries(actRows.map((m) => [m.id, m])),
    linkedEvents: await db.select({ id: events.id, title: events.title, startDate: events.startDate, status: events.status, live: sql<boolean>`${events.publishedRevisionId} is not null` })
      .from(events).where(eq(events.projectId, id)).orderBy(desc(events.startDate)) };
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
    logo: p.logo ? { ...publicRef(p.logo), ...p.logoStyle } : null,   // the logo and how it is framed in the project summary
    // cover: up to five places, the main photo then the first gallery photos; the poster (shown whole, 1:1) takes one of the five
    cover: [p.hero, ...p.gallery].filter(Boolean).slice(0, p.poster ? 4 : 5).map((m) => publicRef(m as MediaRow)),
    poster: p.poster ? publicRef(p.poster) : null,
    partners: p.partnerLinks.filter((x) => x.live).map((x) => ({ name: x.name, slug: x.slug })),   // published partners, shown as Partner(s) on the cover
    gallery: p.gallery.map((m) => publicRef(m)),
    objectives: p.objectiveRefs,
    ...(p.programObjectives?.length ? { programObjectives: p.programObjectives.map((o) => ({ title: o.title, ...(o.text ? { text: o.text } : {}) })) } : {}),
    ...(p.outcomes?.length ? { outcomes: p.outcomes.map((o) => ({ ...(o.title ? { title: o.title } : {}), ...(o.text ? { text: o.text } : {}), ...(o.figure ? { figure: o.figure } : {}) })) } : {}),
    ...(p.activityItems?.length ? { activities: p.activityItems.map((a) => {
      const imgs = (a.mediaIds ?? []).map((mid) => p.activityMedia[mid]).filter(Boolean).map((m) => publicRef(m));
      return { title: a.title, ...(a.text ? { text: a.text } : {}), ...(a.when ? { when: a.when } : {}), ...(a.place ? { place: a.place } : {}), ...(imgs.length ? { images: imgs } : {}), ...(a.publicationSlugs?.length ? { publications: a.publicationSlugs } : {}) };
    }) } : {}),
    revision: '',
  } : {};
  return {
    slug: p.slug, file: p.hasDetailPage ? `project-${p.slug}.html` : null, name: p.name,
    pillar: primary?.key ?? '', pillars: p.pillars.map((x) => x.key), category: p.category, summary: p.summary, sort: p.sort,
    seo: { title: p.seoTitle, description: p.seoDescription },
    media: [...new Set([p.hero, p.logo, p.poster, ...p.gallery, ...(p.hasDetailPage ? p.activityItems.flatMap((a) => (a.mediaIds ?? []).map((mid) => p.activityMedia[mid])) : [])].filter(Boolean).map((m) => (m as MediaRow).id))],
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
  const mediaIds = [...new Set([input.heroMediaId, input.logoMediaId, input.posterMediaId, ...input.galleryMediaIds, ...input.activityItems.flatMap((a) => a.mediaIds)].filter(Boolean) as string[])];
  if (mediaIds.length) {
    const found = await db.select({ id: media.id }).from(media).where(inArray(media.id, mediaIds));
    if (found.length !== mediaIds.length) throw new AppError(422, 'An image no longer exists in the media library.');
  }
  await db.delete(projectPillars).where(eq(projectPillars.projectId, id));
  await db.insert(projectPillars).values(pl.map((x) => ({ projectId: id, pillarId: x.id, isPrimary: x.key === input.primaryPillarKey })));
  await db.delete(projectObjectives).where(eq(projectObjectives.projectId, id));
  if (ob.length) await db.insert(projectObjectives).values(ob.map((o) => ({ projectId: id, objectiveId: o.id })));
  // partners: the same links the Partners editor edits, so both stay in step
  const pts = input.partnerSlugs.length ? await db.select({ id: partners.id }).from(partners).where(inArray(partners.slug, input.partnerSlugs)) : [];
  if (pts.length !== new Set(input.partnerSlugs).size) throw new AppError(422, 'Unknown partner.');
  await db.delete(partnerProjects).where(eq(partnerProjects.projectId, id));
  if (pts.length) await db.insert(partnerProjects).values(pts.map((x) => ({ partnerId: x.id, projectId: id })));
  await db.delete(projectGallery).where(eq(projectGallery.projectId, id));
  const gal = [...new Set(input.galleryMediaIds)];
  if (gal.length) await db.insert(projectGallery).values(gal.map((m, i) => ({ projectId: id, mediaId: m, sort: i })));
}

function columns(input: ProjectInput) {
  const { galleryMediaIds: _g, pillarKeys: _p, primaryPillarKey: _pp, objectiveRefs: _o, partnerSlugs: _ps, ...cols } = input;
  return cols;
}

/** Every chosen image must still be in the Media Library: checked before writing, so a missing one is a clear 422. */
async function assertMediaExist(db: DB, input: ProjectInput) {
  const ids = [...new Set([input.heroMediaId, input.logoMediaId, input.posterMediaId, ...input.galleryMediaIds, ...input.activityItems.flatMap((a) => a.mediaIds)].filter(Boolean) as string[])];
  if (ids.length && (await db.select({ id: media.id }).from(media).where(inArray(media.id, ids))).length !== ids.length) throw new AppError(422, 'An image no longer exists in the media library.');
}

export async function createProject(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(raw);
  await assertMediaExist(db, input);
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
  await assertMediaExist(db, input);
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
    const d = s.detail as Record<string, unknown> & { facts?: [string, string][]; rows?: [string, string][]; hero?: { id: string } | null; logo?: { id: string; shape: string; fit: string; bg: string; size: string } | null; poster?: { id: string } | null; partners?: { slug: string; name: string }[]; gallery?: { id: string }[]; objectives?: string[]; photo?: string;
      programObjectives?: { title: string; text?: string }[]; outcomes?: { title?: string; text?: string; figure?: string }[]; activities?: { title: string; text?: string; when?: string; place?: string; images?: { id: string }[]; image?: { id: string }; publications?: (string | { slug: string })[] }[] };
    const row = (k: string) => d.rows?.find((r) => r[0] === k)?.[1] ?? '';
    const fact = (k: string) => d.facts?.find((r) => r[0] === k)?.[1] ?? '';
    const input: ProjectInput = projectInputSchema.parse({
      name: s.name, slug: s.slug, category: s.category, summary: s.summary, sort: s.sort,
      location: fact('Location'), years: fact('Years'),
      extraFacts: (d.facts ?? []).filter((f) => !['Pillar', 'Category', 'Location', 'Years'].includes(f[0])).map(([label, value]) => ({ label, value })),
      context: row('Context'), approach: row('Approach'), activities: row('Activities'), results: row('Results'),
      hasDetailPage: !!s.file, photoCaption: d.photo ?? '', heroMediaId: d.hero?.id ?? null,
      logoMediaId: d.logo?.id ?? null, posterMediaId: d.poster?.id ?? null, ...(d.partners ? { partnerSlugs: d.partners.map((x) => x.slug) } : {}), ...(d.logo ? { logoStyle: { shape: d.logo.shape, fit: d.logo.fit, bg: d.logo.bg, size: d.logo.size } } : {}),
      galleryMediaIds: (d.gallery ?? []).map((g) => g.id),
      pillarKeys: s.pillars, primaryPillarKey: s.pillar, objectiveRefs: d.objectives ?? [],
      programObjectives: (d.programObjectives ?? []).map((o) => ({ title: o.title, text: o.text ?? '' })),
      outcomes: (d.outcomes ?? []).map((o) => ({ title: o.title ?? '', text: o.text ?? '', figure: o.figure ?? '' })),
      activityItems: (d.activities ?? []).map((a) => ({ title: a.title, text: a.text ?? '', when: a.when ?? '', place: a.place ?? '', publicationSlugs: (a.publications ?? []).map((x) => (typeof x === 'string' ? x : x.slug)), mediaIds: (a.images ?? (a.image ? [a.image] : [])).map((m) => m.id) })),
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
  const mids = [...new Set(rows.flatMap((r) => [r.heroMediaId, r.posterMediaId, r.logoMediaId]).filter(Boolean) as string[])];
  const thumbs = new Map((mids.length ? await db.select({ id: media.id, key: media.storageKey }).from(media).where(inArray(media.id, mids)) : []).map((m) => [m.id, `/studio/media-file/${m.key}-480.webp`]));
  const uids = [...new Set(rows.map((r) => r.updatedBy).filter(Boolean) as string[])];
  const names = new Map((uids.length ? await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, uids)) : []).map((u) => [u.id, u.name]));
  // photos used by each project (cover, logo, poster, gallery, activities) and how many still miss alt text or confirmed rights
  const gal = await db.select({ projectId: projectGallery.projectId, mediaId: projectGallery.mediaId }).from(projectGallery);
  const used = new Map(rows.map((r) => [r.id, [...new Set([r.heroMediaId, r.logoMediaId, r.posterMediaId, ...gal.filter((g) => g.projectId === r.id).map((g) => g.mediaId),
    ...((r.activityItems ?? []) as { mediaIds?: string[] }[]).flatMap((a) => a.mediaIds ?? [])].filter(Boolean) as string[])]]));
  const allIds = [...new Set([...used.values()].flat())];
  const incomplete = new Set((allIds.length ? await db.select({ id: media.id, alt: media.alt, ok: media.rightsConfirmed }).from(media).where(inArray(media.id, allIds)) : [])
    .filter((m) => !m.ok).map((m) => m.id));
  const th = (id: string | null) => (id ? thumbs.get(id) ?? null : null);
  // for the list's "info entered" meter: how many partners and gallery photos each project has
  const pp = await db.select({ projectId: partnerProjects.projectId }).from(partnerProjects);
  return rows.map((r) => ({ ...r, partnerCount: pp.filter((x) => x.projectId === r.id).length, galleryCount: gal.filter((g) => g.projectId === r.id).length, thumb: th(r.heroMediaId) ?? th(r.posterMediaId), logoThumb: th(r.logoMediaId), updatedByName: r.updatedBy ? names.get(r.updatedBy) ?? null : null,
    photoCount: used.get(r.id)!.length, photoIssues: used.get(r.id)!.filter((x) => incomplete.has(x)).length,
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
