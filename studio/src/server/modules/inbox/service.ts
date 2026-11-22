// Inbox: the staff side of the website forms. Contact messages are triaged here (read, assign, status, star, archive,
// spam, notes, reply by email); newsletter sign-ups are a subscriber list. Everything here is personal data: the routes
// require forms.read / forms.manage, views and exports are written to the audit log, and the audit log never copies
// message text, names or email addresses.
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { auditLog, formSubmissions, newsletterSubscribers, SUBMISSION_STATUSES, submissionEvents, submissionStars, users, type SubmissionStatus } from '../../db/schema.ts';
import { HTTPException } from 'hono/http-exception';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { can, type Role } from '../../rbac.ts';
import { FORMS, TOPICS, settingsOf, toCsv, type FormKey } from '../forms/service.ts';

type Me = NonNullable<Actor>;
const S = formSubmissions;
export const VIEWS = ['all', 'unread', 'mine', 'starred', 'spam', 'archived'] as const;
export type View = (typeof VIEWS)[number];
export const STATUS_LABEL: Record<SubmissionStatus, string> = { new: 'New', in_progress: 'In progress', replied: 'Replied', closed: 'Closed' };

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const starredBy = (userId: string) => sql<boolean>`exists(select 1 from ${submissionStars} where ${submissionStars.submissionId} = ${S.id} and ${submissionStars.userId} = ${userId})`;
const inbox = () => and(eq(S.formKey, 'contact'), eq(S.spam, false), isNull(S.archivedAt));

function viewWhere(view: View, userId: string): SQL {
  switch (view) {
    case 'unread': return and(inbox(), isNull(S.readAt))!;
    case 'mine': return and(inbox(), eq(S.assignedTo, userId))!;
    case 'starred': return and(eq(S.formKey, 'contact'), eq(S.spam, false), starredBy(userId))!;
    case 'spam': return and(eq(S.formKey, 'contact'), eq(S.spam, true))!;
    case 'archived': return and(eq(S.formKey, 'contact'), eq(S.spam, false), isNotNull(S.archivedAt))!;
    default: return inbox()!;
  }
}

export const listQuery = z.object({
  view: z.enum(VIEWS).catch('all'),
  topic: z.string().max(60).optional().default(''),
  status: z.enum(SUBMISSION_STATUSES).or(z.literal('')).catch(''),
  q: z.string().trim().max(80).optional().default(''),
  sort: z.enum(['newest', 'oldest', 'unread', 'sender']).catch('newest'),
  offset: z.coerce.number().int().min(0).max(100_000).catch(0),
  limit: z.coerce.number().int().min(1).max(100).catch(50),
});
export type ListQuery = z.infer<typeof listQuery>;

function filters(q: ListQuery, userId: string) {
  const parts: SQL[] = [viewWhere(q.view, userId)];
  if (q.topic && (TOPICS as readonly string[]).includes(q.topic)) parts.push(eq(S.topic, q.topic));
  if (q.status) parts.push(eq(S.status, q.status));
  if (q.q.length >= 2) {
    const p = like(q.q);
    parts.push(or(ilike(S.name, p), ilike(S.email, p), ilike(S.topic, p), sql`${S.data}->>'message' ilike ${p}`, sql`${S.data}->>'org' ilike ${p}`)!);
  }
  return and(...parts)!;
}

const ORDER = {
  newest: [desc(S.createdAt)], oldest: [asc(S.createdAt)],
  unread: [sql`(${S.readAt} is null) desc`, desc(S.createdAt)], sender: [sql`lower(${S.name})`, desc(S.createdAt)],
} as const;

/** One page of the message list. The preview is the first line of the message, trimmed. */
export async function listMessages(db: DB, me: Me, q: ListQuery) {
  const where = filters(q, me.id);
  const [{ total }] = await db.select({ total: count() }).from(S).where(where);
  const rows = await db.select({
    id: S.id, topic: S.topic, name: S.name, email: S.email, status: S.status, page: S.page, createdAt: S.createdAt,
    preview: sql<string>`left(coalesce(${S.data}->>'message', ''), 180)`,
    unread: sql<boolean>`${S.readAt} is null`, starred: starredBy(me.id), spam: S.spam, spamReason: S.spamReason,
    archived: sql<boolean>`${S.archivedAt} is not null`, assignedTo: S.assignedTo, assigneeName: users.name,
  }).from(S).leftJoin(users, eq(users.id, S.assignedTo)).where(where).orderBy(...ORDER[q.sort]).limit(q.limit).offset(q.offset);
  return { total, rows };
}

/** Counts for the filter pane and the sidebar badge (contact messages only). */
export async function summary(db: DB, me: Me) {
  const c = async (w: SQL) => (await db.select({ n: count() }).from(S).where(w))[0].n;
  const unreadOf = (v: View) => and(viewWhere(v, me.id), isNull(S.readAt))!;
  const topics = await db.select({ topic: S.topic, n: count(), unread: sql<number>`count(*) filter (where ${S.readAt} is null)`.mapWith(Number) }).from(S).where(inbox()).groupBy(S.topic);
  const statuses = await db.select({ status: S.status, n: count() }).from(S).where(inbox()).groupBy(S.status);
  const [{ subs }] = await db.select({ subs: count() }).from(newsletterSubscribers).where(eq(newsletterSubscribers.status, 'subscribed'));
  return {
    views: {
      all: { total: await c(viewWhere('all', me.id)), unread: await c(unreadOf('all')) },
      unread: { total: await c(unreadOf('all')), unread: await c(unreadOf('all')) },
      mine: { total: await c(viewWhere('mine', me.id)), unread: await c(unreadOf('mine')) },
      starred: { total: await c(viewWhere('starred', me.id)), unread: await c(unreadOf('starred')) },
      spam: { total: await c(viewWhere('spam', me.id)), unread: 0 },
      archived: { total: await c(viewWhere('archived', me.id)), unread: 0 },
    },
    topics: TOPICS.map((t) => ({ topic: t, total: topics.find((x) => x.topic === t)?.n ?? 0, unread: topics.find((x) => x.topic === t)?.unread ?? 0 })),
    statuses: Object.fromEntries(SUBMISSION_STATUSES.map((s) => [s, statuses.find((x) => x.status === s)?.n ?? 0])),
    subscribers: subs,
    forms: await Promise.all((Object.keys(FORMS) as FormKey[]).map(async (k) => ({ key: k, label: FORMS[k].label, site: FORMS[k].site, settings: await settingsOf(db, k) }))),
  };
}

export async function unreadCount(db: DB) {
  const [{ n }] = await db.select({ n: count() }).from(S).where(and(inbox(), isNull(S.readAt)));
  return n;
}

async function load(db: DB, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'Message not found.');
  const [m] = await db.select().from(S).where(and(eq(S.id, id), eq(S.formKey, 'contact')));
  if (!m) throw new AppError(404, 'Message not found.');
  return m;
}
const event = (db: DB, me: Me | null, submissionId: string, kind: string, meta?: Record<string, unknown>, body = '') =>
  db.insert(submissionEvents).values({ submissionId, actorId: me?.id ?? null, kind, body, meta: meta ?? null });

/** Opens a message: marks it read (shared inbox) and logs the view, at most once per person and message per 30 min. */
export async function openMessage(db: DB, me: Me, id: string, ip: string | null) {
  const m = await load(db, id);
  if (!m.readAt) await db.update(S).set({ readAt: new Date() }).where(eq(S.id, id));
  const [seen] = await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, 'inbox.view'), eq(auditLog.entityId, id), eq(auditLog.actorId, me.id), gte(auditLog.at, new Date(Date.now() - 30 * 60_000)))).limit(1);
  if (!seen) await audit(db, me, 'inbox.view', { type: 'submission', id }, 'Opened a contact message', undefined, ip);
  const [assignee] = m.assignedTo ? await db.select({ name: users.name }).from(users).where(eq(users.id, m.assignedTo)) : [];
  const [{ starred }] = await db.select({ starred: starredBy(me.id) }).from(S).where(eq(S.id, id));
  const events = await db.select({ id: submissionEvents.id, kind: submissionEvents.kind, body: submissionEvents.body, meta: submissionEvents.meta, at: submissionEvents.createdAt, actorId: submissionEvents.actorId, actorName: users.name })
    .from(submissionEvents).leftJoin(users, eq(users.id, submissionEvents.actorId)).where(eq(submissionEvents.submissionId, id)).orderBy(asc(submissionEvents.createdAt));
  return {
    id: m.id, topic: m.topic, name: m.name, email: m.email, phone: m.data.phone ?? '', org: m.data.org ?? '', message: m.data.message ?? '',
    page: m.page, createdAt: m.createdAt, consentAt: m.consentAt, status: m.status, spam: m.spam, spamReason: m.spamReason,
    archived: !!m.archivedAt, archivedAt: m.archivedAt, closedAt: m.closedAt, unread: false, starred,
    assignedTo: m.assignedTo, assigneeName: assignee?.name ?? null, events,
  };
}

/** People who can be assigned: active users whose role can read the inbox. */
export async function people(db: DB) {
  const rows = await db.select({ id: users.id, name: users.name, role: users.role, active: users.active }).from(users).orderBy(asc(users.name));
  return rows.filter((u) => u.active && can(u.role as Role, 'forms.read')).map(({ id, name }) => ({ id, name }));
}

const changeSchema = z.object({ status: z.enum(SUBMISSION_STATUSES).optional(), assignedTo: z.string().uuid().nullable().optional() }).strict();

export async function change(db: DB, me: Me, id: string, raw: unknown) {
  const r = changeSchema.safeParse(raw);
  if (!r.success || !Object.keys(r.data).length) throw new AppError(422, 'Invalid change.');
  const m = await load(db, id);
  const set: Partial<typeof S.$inferInsert> = { updatedAt: new Date() };
  const done: string[] = [];
  if (r.data.status && r.data.status !== m.status) {
    set.status = r.data.status; set.closedAt = r.data.status === 'closed' ? new Date() : null;
    await event(db, me, id, 'status', { from: m.status, to: r.data.status });
    done.push(`status → ${STATUS_LABEL[r.data.status]}`);
  }
  if (r.data.assignedTo !== undefined && r.data.assignedTo !== m.assignedTo) {
    let name: string | null = null;
    if (r.data.assignedTo) {
      const p = (await people(db)).find((x) => x.id === r.data.assignedTo);
      if (!p) throw new AppError(422, 'That person can’t see the Inbox. Choose a teammate with access to messages.');
      name = p.name;
    }
    set.assignedTo = r.data.assignedTo;
    await event(db, me, id, 'assign', { to: r.data.assignedTo, name });
    done.push(name ? `assigned to ${name}` : 'unassigned');
  }
  if (!done.length) return;
  await db.update(S).set(set).where(eq(S.id, id));
  await audit(db, me, 'inbox.update', { type: 'submission', id }, `Contact message: ${done.join(', ')}`);
}

export const FLAGS = ['read', 'unread', 'archive', 'unarchive', 'spam', 'not_spam', 'close'] as const;
export type Flag = (typeof FLAGS)[number];

/** Applies one flag to messages (single or bulk). Returns how many changed. */
export async function flag(db: DB, me: Me, ids: string[], what: Flag) {
  if (!ids.length || ids.length > 200 || !ids.every((x) => z.string().uuid().safeParse(x).success)) throw new AppError(422, 'Choose between 1 and 200 messages.');
  const rows = await db.select().from(S).where(and(inArray(S.id, ids), eq(S.formKey, 'contact')));
  const now = new Date();
  let n = 0;
  for (const m of rows) {
    const set: Partial<typeof S.$inferInsert> = {};
    if (what === 'read' && !m.readAt) set.readAt = now;
    if (what === 'unread' && m.readAt) set.readAt = null;
    if (what === 'archive' && !m.archivedAt) set.archivedAt = now;
    if (what === 'unarchive' && m.archivedAt) set.archivedAt = null;
    if (what === 'spam' && !m.spam) { set.spam = true; set.spamReason = 'manual'; }
    if (what === 'not_spam' && m.spam) { set.spam = false; set.spamReason = null; }
    if (what === 'close' && m.status !== 'closed') { set.status = 'closed'; set.closedAt = now; }
    if (!Object.keys(set).length) continue;
    await db.update(S).set({ ...set, ...(what === 'read' || what === 'unread' ? {} : { updatedAt: now }) }).where(eq(S.id, m.id));
    if (what === 'close') await event(db, me, m.id, 'status', { from: m.status, to: 'closed' });
    else if (what !== 'read' && what !== 'unread') await event(db, me, m.id, what);
    n++;
  }
  if (n && what !== 'read' && what !== 'unread') await audit(db, me, `inbox.${what}`, { type: 'submission', id: ids.length === 1 ? ids[0] : undefined }, `${n} contact message(s): ${what.replace('_', ' ')}`);
  return n;
}

export async function setStar(db: DB, me: Me, id: string, on: boolean) {
  await load(db, id);
  if (on) await db.insert(submissionStars).values({ submissionId: id, userId: me.id }).onConflictDoNothing();
  else await db.delete(submissionStars).where(and(eq(submissionStars.submissionId, id), eq(submissionStars.userId, me.id)));
}

export async function addNote(db: DB, me: Me, id: string, raw: unknown) {
  const r = z.object({ body: z.string().trim().min(1, 'Write a note.').max(4000) }).strict().safeParse(raw);
  if (!r.success) throw new AppError(422, r.error.issues[0]?.message ?? 'Write a note.');
  await load(db, id);
  await event(db, me, id, 'note', undefined, r.data.body);
  await db.update(S).set({ updatedAt: new Date() }).where(eq(S.id, id));
  await audit(db, me, 'inbox.note', { type: 'submission', id }, 'Added an internal note');   // never the note text
}

export async function deleteNote(db: DB, me: Me, id: string, noteId: string) {
  await load(db, id);
  const [n] = await db.select().from(submissionEvents).where(and(eq(submissionEvents.id, noteId), eq(submissionEvents.submissionId, id), eq(submissionEvents.kind, 'note')));
  if (!n) throw new AppError(404, 'Note not found.');
  if (n.actorId !== me.id) throw new HTTPException(403, { message: 'Only the person who wrote a note can delete it.' });
  await db.delete(submissionEvents).where(eq(submissionEvents.id, noteId));
  await audit(db, me, 'inbox.note_delete', { type: 'submission', id }, 'Deleted an internal note');
}

/** Studio does not send email: "Reply by email" opens the staff member's mail app. This records that it was opened. */
export async function replyOpened(db: DB, me: Me, id: string) {
  await load(db, id);
  await event(db, me, id, 'reply');
}

export async function remove(db: DB, me: Me, ids: string[]) {
  if (!ids.length || ids.length > 200) throw new AppError(422, 'Choose between 1 and 200 messages.');
  const rows = await db.delete(S).where(and(inArray(S.id, ids), eq(S.formKey, 'contact'))).returning({ id: S.id });
  await audit(db, me, 'inbox.delete', { type: 'submission' }, `Permanently deleted ${rows.length} contact message(s)`);
  return rows.length;
}

/** CSV of the current filter (up to 5000 rows). Logged with the filter, never with the content. */
export async function exportMessages(db: DB, me: Me, q: ListQuery, ip: string | null) {
  const rows = await db.select().from(S).leftJoin(users, eq(users.id, S.assignedTo)).where(filters(q, me.id)).orderBy(...ORDER[q.sort]).limit(5000);
  await audit(db, me, 'inbox.export', { type: 'form', id: 'contact' }, `Exported ${rows.length} contact message(s) as CSV`, { view: q.view, topic: q.topic || null, status: q.status || null, search: !!q.q }, ip);
  return toCsv(['received_at', 'status', 'topic', 'name', 'email', 'phone', 'organisation', 'message', 'assigned_to', 'source_page', 'spam', 'archived'],
    rows.map(({ form_submissions: r, users: u }) => [r.createdAt.toISOString(), STATUS_LABEL[r.status], r.topic, r.name, r.email, r.data.phone, r.data.org, r.data.message, u?.name ?? '', r.page, r.spam ? 'yes' : '', r.archivedAt ? 'yes' : '']));
}

// ---------------------------------------------------------------- Newsletter subscribers
export async function subscribers(db: DB, me: Me, raw: { q?: string; status?: string }, ip: string | null) {
  const q = (raw.q ?? '').trim().slice(0, 80);
  const parts: SQL[] = [];
  if (raw.status === 'subscribed' || raw.status === 'unsubscribed') parts.push(eq(newsletterSubscribers.status, raw.status));
  if (q.length >= 2) parts.push(ilike(newsletterSubscribers.email, like(q)));
  const rows = await db.select().from(newsletterSubscribers).where(parts.length ? and(...parts) : undefined).orderBy(desc(newsletterSubscribers.createdAt)).limit(5000);
  const [seen] = await db.select({ id: auditLog.id }).from(auditLog).where(and(eq(auditLog.action, 'inbox.subscribers_view'), eq(auditLog.actorId, me.id), gte(auditLog.at, new Date(Date.now() - 30 * 60_000)))).limit(1);
  if (!seen) await audit(db, me, 'inbox.subscribers_view', { type: 'form', id: 'newsletter' }, 'Viewed the newsletter subscriber list', undefined, ip);
  const [{ subscribed }] = await db.select({ subscribed: count() }).from(newsletterSubscribers).where(eq(newsletterSubscribers.status, 'subscribed'));
  const [{ all }] = await db.select({ all: count() }).from(newsletterSubscribers);
  return { rows, counts: { subscribed, unsubscribed: all - subscribed } };
}

export async function setSubscriber(db: DB, me: Me, id: string, action: 'unsubscribe' | 'delete') {
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'Subscriber not found.');
  const [cur] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, id));
  if (!cur) throw new AppError(404, 'Subscriber not found.');
  if (action === 'delete') await db.delete(newsletterSubscribers).where(eq(newsletterSubscribers.id, id));
  else if (cur.status !== 'unsubscribed') await db.update(newsletterSubscribers).set({ status: 'unsubscribed', unsubscribedAt: new Date(), updatedAt: new Date() }).where(eq(newsletterSubscribers.id, id));
  await audit(db, me, `forms.subscriber_${action}`, { type: 'subscriber', id }, action === 'delete' ? 'Deleted a newsletter subscriber' : 'Unsubscribed a newsletter subscriber');
}

/** Subscribed addresses only: an unsubscribed person must never be exported for a mailing. */
export async function exportSubscribers(db: DB, me: Me, ip: string | null) {
  const rows = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.status, 'subscribed')).orderBy(newsletterSubscribers.createdAt);
  await audit(db, me, 'inbox.export', { type: 'form', id: 'newsletter' }, `Exported ${rows.length} newsletter subscriber(s) as CSV`, undefined, ip);
  return toCsv(['email', 'subscribed_at', 'source'], rows.map((r) => [r.email, r.consentAt.toISOString(), r.source]));
}
