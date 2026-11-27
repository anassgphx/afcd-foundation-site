// Events: real AFCD events with details, agenda, audience, poster, registration and an optional recap story.
// Same editorial workflow as the other modules; only published revisions reach the website.
import { and, asc, desc, eq, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { events, eventRevisions, pillars, projects, articles, media, reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { altProblem } from '../media/alt.ts';
import { runTransition, transitionPerm, type WorkflowSpec } from '../content/workflow.ts';

type Status = typeof events.$inferSelect['status'];
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const plain = (max: number) => z.string().trim().max(max).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');

export const KINDS = ['Workshop', 'Training', 'Community day', 'Webinar', 'Bootcamp', 'Conference', 'Festival', 'Meeting', 'Other'];

export const eventSchema = z.object({
  title: plain(140).pipe(z.string().min(3, 'Add a title.')),
  slug: z.string().trim().max(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  kind: z.enum(KINDS as [string, ...string[]]).default('Workshop'),
  summary: plain(320).default(''),
  body: z.string().max(20000).default(''),
  startDate: z.string().regex(DATE, 'Use a date like 2027-01-20.'),
  endDate: z.string().regex(DATE, 'Use a date like 2027-01-22.').nullable().default(null),
  timeLabel: plain(60).default(''),
  location: plain(120).default(''),
  online: z.boolean().default(false),
  pillarKey: z.string().nullable().default(null),
  projectSlug: z.string().nullable().default(null),
  posterMediaId: z.string().uuid().nullable().default(null),
  agenda: z.array(z.object({ title: plain(80).pipe(z.string().min(1, 'Name each agenda item.')), text: plain(240).default('') }).strict()).max(12).default([]),
  audience: z.array(plain(120).pipe(z.string().min(1))).max(8).default([]),
  registration: z.enum(['none', 'contact', 'external']).default('contact'),
  registrationUrl: z.string().trim().max(500).refine((u) => u === '' || HTTPS.test(u), 'Use a full https:// address.').default(''),
  recapArticleSlug: z.string().nullable().default(null),
  seoTitle: plain(70).default(''),
  seoDescription: plain(170).default(''),
}).strict().superRefine((v, ctx) => {
  if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'The end date is before the start date.' });
  if (v.registration === 'external' && !v.registrationUrl) ctx.addIssue({ code: 'custom', path: ['registrationUrl'], message: 'Add the registration link.' });
});
export type EventInput = z.infer<typeof eventSchema>;
export type EventSnapshot = EventInput;

function parse(raw: unknown): EventInput {
  const r = eventSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

export type FullEvent = typeof events.$inferSelect & { pillarKey: string | null; projectSlug: string | null; recapArticleSlug: string | null };

export async function loadEvent(db: DB, id: string): Promise<FullEvent> {
  const [e] = await db.select().from(events).where(eq(events.id, id));
  if (!e) throw new AppError(404, 'Event not found.');
  const pk = e.pillarId ? (await db.select({ key: pillars.key }).from(pillars).where(eq(pillars.id, e.pillarId)))[0]?.key ?? null : null;
  const ps = e.projectId ? (await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, e.projectId)))[0]?.slug ?? null : null;
  const as = e.recapArticleId ? (await db.select({ slug: articles.slug }).from(articles).where(eq(articles.id, e.recapArticleId)))[0]?.slug ?? null : null;
  return { ...e, pillarKey: pk, projectSlug: ps, recapArticleSlug: as };
}

export const toEventSnapshot = (e: FullEvent): EventSnapshot => ({
  title: e.title, slug: e.slug, kind: e.kind, summary: e.summary, body: e.body, startDate: e.startDate, endDate: e.endDate, timeLabel: e.timeLabel,
  location: e.location, online: e.online, pillarKey: e.pillarKey, projectSlug: e.projectSlug, posterMediaId: e.posterMediaId, agenda: e.agenda,
  audience: e.audience, registration: e.registration, registrationUrl: e.registrationUrl, recapArticleSlug: e.recapArticleSlug, seoTitle: e.seoTitle, seoDescription: e.seoDescription,
});

export async function eventProblems(db: DB, e: FullEvent) {
  const out: string[] = [];
  if (!e.summary) out.push('Add a short description for the calendar and search results.');
  if (!e.pillarKey) out.push('Choose the pillar this event belongs to.');
  if (!e.location && !e.online) out.push('Add where the event takes place, or mark it as online.');
  if (!e.timeLabel) out.push('Add the time (for example 10:00 – 13:00, or Full day).');
  if (e.posterMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, e.posterMediaId));
    if (!m) out.push('The poster no longer exists in the media library.');
    else {
      { const ap = altProblem(m, `Add alt text to “${m.originalName}”.`); if (ap) out.push(ap); }
      if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}”.`);
    }
  }
  return out;
}

async function relationIds(db: DB, input: EventInput) {
  const pillarId = input.pillarKey ? (await db.select({ id: pillars.id }).from(pillars).where(eq(pillars.key, input.pillarKey)))[0]?.id : null;
  if (input.pillarKey && !pillarId) throw new AppError(422, 'Unknown pillar.');
  const projectId = input.projectSlug ? (await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, input.projectSlug)))[0]?.id : null;
  if (input.projectSlug && !projectId) throw new AppError(422, 'Unknown project.');
  const recapArticleId = input.recapArticleSlug ? (await db.select({ id: articles.id }).from(articles).where(eq(articles.slug, input.recapArticleSlug)))[0]?.id : null;
  if (input.recapArticleSlug && !recapArticleId) throw new AppError(422, 'Unknown story.');
  if (input.posterMediaId && !(await db.select({ id: media.id }).from(media).where(eq(media.id, input.posterMediaId))).length) throw new AppError(422, 'The poster no longer exists in the media library.');
  const { pillarKey: _a, projectSlug: _b, recapArticleSlug: _c, ...rest } = input;
  return { ...rest, pillarId: pillarId ?? null, projectId: projectId ?? null, recapArticleId: recapArticleId ?? null };
}

async function assertSlugFree(db: DB, slug: string, exceptId?: string) {
  if ((await db.select({ id: events.id }).from(events).where(eq(events.slug, slug))).some((r) => r.id !== exceptId)) throw new AppError(409, 'Another event already uses this address.');
}

export async function createEvent(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    await assertSlugFree(t, input.slug);
    const [e] = await t.insert(events).values({ ...(await relationIds(t, input)), createdBy: actor.id, updatedBy: actor.id }).returning();
    await audit(tx, actor, 'event.create', { type: 'event', id: e.id }, `Created event “${e.title}”`);
    return e;
  });
}

const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updateEvent(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(events).where(eq(events.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Event not found.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, cur.status === 'in_review' ? 'This event is in review. Withdraw it before editing.' : 'Restore this event before editing.');
    if (input.slug !== cur.slug) { if (cur.publishedRevisionId) throw new AppError(409, 'The address of a published event cannot change.'); await assertSlugFree(t, input.slug, id); }
    const [e] = await t.update(events).set({ ...(await relationIds(t, input)), status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(events.id, id)).returning();
    await audit(tx, actor, 'event.update', { type: 'event', id }, `Edited event “${e.title}”`);
    return e;
  });
}

// The review rules are shared with every content kind (modules/content/workflow.ts).
export const eventTransitionPerm = (a: string) => transitionPerm('event', a);

async function addRevision(db: DB, eventId: string, snap: EventSnapshot, reason: string, userId: string) {
  const [{ n }] = await db.select({ n: max(eventRevisions.number) }).from(eventRevisions).where(eq(eventRevisions.eventId, eventId));
  const [rev] = await db.insert(eventRevisions).values({ eventId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

const WORKFLOW: WorkflowSpec<typeof events.$inferSelect, Awaited<ReturnType<typeof loadEvent>>, ReturnType<typeof toEventSnapshot>> = {
  table: events, kind: 'event', noun: { a: 'an event', the: 'the event', this: 'this event', Name: 'Event' }, title: (r) => r.title,
  load: loadEvent, problems: eventProblems, snapshot: toEventSnapshot, addRevision,
};

export async function transitionEvent(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string } = {}) {
  return runTransition(WORKFLOW, db, actor, role, id, action, opts.comment ?? '');
}

export async function restoreEventRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(eventRevisions).where(and(eq(eventRevisions.id, revisionId), eq(eventRevisions.eventId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const s = rev.snapshot as unknown as EventSnapshot;
  const cur = await loadEvent(db, id);
  await updateEvent(db, actor, id, { ...s, slug: cur.publishedRevisionId ? cur.slug : s.slug });
}

export async function listEvents(db: DB) {
  const rows = await db.select({ id: events.id, slug: events.slug, title: events.title, kind: events.kind, startDate: events.startDate, endDate: events.endDate, location: events.location, online: events.online, status: events.status, publishedRevisionId: events.publishedRevisionId, updatedAt: events.updatedAt, pillarName: pillars.name, pillarColour: pillars.colour })
    .from(events).leftJoin(pillars, eq(pillars.id, events.pillarId)).orderBy(desc(events.startDate), asc(events.title));
  return rows;
}

export async function eventHistory(db: DB, id: string) {
  const revisions = await db.select({ id: eventRevisions.id, number: eventRevisions.number, reason: eventRevisions.reason, createdAt: eventRevisions.createdAt }).from(eventRevisions).where(eq(eventRevisions.eventId, id)).orderBy(desc(eventRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'event'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}
