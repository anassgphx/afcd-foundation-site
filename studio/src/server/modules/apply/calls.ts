// AFCD Apply: calls for applications. Records, lifecycle, server-time scheduling, history and export.
// See docs/adr/0004-afcd-apply.md. Lifecycle: draft → in_review → approved → scheduled → open (⇄ paused) → closed →
// under_evaluation → completed → archived. Every change is checked here (never only in the browser), recorded in the
// call's history (apply_call_events) and in the audit log.
import { and, asc, desc, eq, inArray, isNotNull, lte, max, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { applyCalls, applyCallEvents, applyCallRevisions, media, pillars, projects, users } from '../../db/schema.ts';
import { HTTPException } from 'hono/http-exception';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import { can, type Permission, type Role } from '../../rbac.ts';
import { isTimeZone, utcToLocal, yearIn, zonedToUtc } from './time.ts';
import { hasPublishedForm } from './forms.ts';

type Me = NonNullable<Actor>;
export type Call = typeof applyCalls.$inferSelect;
export type CallStatus = Call['status'];

export const CALL_TYPES = ['youth_program', 'fellowship', 'training', 'volunteer', 'recruitment', 'grant', 'startup', 'event', 'expert', 'organization', 'other'] as const;
export const CALL_TYPE_LABEL: Record<(typeof CALL_TYPES)[number], string> = {
  youth_program: 'Youth programme', fellowship: 'Fellowship', training: 'Training', volunteer: 'Volunteering', recruitment: 'Recruitment', grant: 'Grant',
  startup: 'Start-up / incubation', event: 'Event participation', expert: 'Call for experts', organization: 'Organisations', other: 'Other',
};
export const STATUS_LABEL: Record<CallStatus, string> = {
  draft: 'Draft', in_review: 'In review', changes_requested: 'Changes requested', approved: 'Approved', scheduled: 'Scheduled', open: 'Open', paused: 'Paused',
  closed: 'Closed', under_evaluation: 'Under evaluation', completed: 'Completed', archived: 'Archived',
};
/** Statuses where the call has been released: its address, time zone and dates change only through actions. */
const RELEASED: CallStatus[] = ['scheduled', 'open', 'paused', 'closed', 'under_evaluation', 'completed'];
const PRE: CallStatus[] = ['draft', 'changes_requested', 'approved'];

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i;
const LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const clean = (v: string) => v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
const plain = (n: number) => z.string().trim().max(n).transform(clean).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');
const long = (n: number) => z.string().max(n).transform(clean);   // multi-line text; always escaped when shown
const tr = z.object({ title: plain(160).optional(), summary: plain(400).optional(), description: long(20000).optional() }).strict();

export const callSchema = z.object({
  title: plain(160).pipe(z.string().min(3, 'Add a title (at least 3 characters).')),
  slug: z.string().trim().max(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  summary: plain(400).default(''),
  description: long(20000).default(''),
  i18n: z.object({ fr: tr.optional(), ar: tr.optional() }).strict().default({}),
  callType: z.enum(CALL_TYPES).default('youth_program'),
  audience: plain(300).default(''),
  eligibility: z.array(plain(240).pipe(z.string().min(1))).max(15, 'Use at most 15 eligibility points.').default([]),
  location: plain(160).default(''),
  format: z.enum(['in_person', 'online', 'hybrid']).default('in_person'),
  language: z.enum(['en', 'fr', 'ar', 'multi']).default('en'),
  pillarKey: z.string().max(80).nullable().default(null),
  projectSlug: z.string().max(120).nullable().default(null),
  heroMediaId: z.string().uuid().nullable().default(null),
  opensLocal: z.string().regex(LOCAL, 'Use a date and time like 2027-01-20T09:00.').nullable().default(null),
  closesLocal: z.string().regex(LOCAL, 'Use a date and time like 2027-02-15T23:59.').nullable().default(null),
  timeZone: z.string().max(64).refine(isTimeZone, 'Choose a valid time zone.').default('Africa/Casablanca'),
  places: z.number().int().min(1).max(100000).nullable().default(null),
  contactEmail: z.string().trim().max(160).refine((v) => v === '' || EMAIL.test(v), 'Use a valid email address.').default(''),
  terms: long(20000).default(''),
  privacyNotice: long(20000).default(''),
  seoTitle: plain(70).default(''),
  seoDescription: plain(170).default(''),
  unlisted: z.boolean().default(false),
}).strict();
export type CallInput = z.infer<typeof callSchema>;

function issues(e: z.ZodError) { return e.issues.map((i) => ({ path: i.path.join('.'), message: i.message })); }
function parse(raw: unknown): CallInput {
  const r = callSchema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', issues(r.error));
  return r.data;
}

/** Local texts → UTC instants (null when empty). */
function instants(input: CallInput) {
  const conv = (v: string | null, path: string) => {
    if (!v) return null;
    const d = zonedToUtc(v, input.timeZone);
    if (!d) throw new AppError(422, 'Some fields need attention.', [{ path, message: `${v.replace('T', ' ')} does not exist in ${input.timeZone} (for example during a clock change).` }]);
    return d;
  };
  const opensAt = conv(input.opensLocal, 'opensLocal'), closesAt = conv(input.closesLocal, 'closesLocal');
  if (opensAt && closesAt && closesAt <= opensAt) throw new AppError(422, 'Some fields need attention.', [{ path: 'closesLocal', message: 'The deadline must be after the opening.' }]);
  return { opensAt, closesAt };
}

async function relations(db: DB, input: CallInput) {
  const pillarId = input.pillarKey ? (await db.select({ id: pillars.id }).from(pillars).where(eq(pillars.key, input.pillarKey)))[0]?.id : null;
  if (input.pillarKey && !pillarId) throw new AppError(422, 'Unknown pillar.');
  const projectId = input.projectSlug ? (await db.select({ id: projects.id }).from(projects).where(eq(projects.slug, input.projectSlug)))[0]?.id : null;
  if (input.projectSlug && !projectId) throw new AppError(422, 'Unknown project.');
  if (input.heroMediaId && !(await db.select({ id: media.id }).from(media).where(eq(media.id, input.heroMediaId))).length) throw new AppError(422, 'The image no longer exists in the media library.');
  return { pillarId: pillarId ?? null, projectId: projectId ?? null };
}

function columns(input: CallInput) {
  const { pillarKey: _p, projectSlug: _s, opensLocal: _o, closesLocal: _c, ...rest } = input;
  return rest;
}

async function assertSlugFree(db: DB, slug: string, exceptId?: string) {
  if ((await db.select({ id: applyCalls.id }).from(applyCalls).where(eq(applyCalls.slug, slug))).some((r) => r.id !== exceptId)) throw new AppError(409, 'Another call already uses this address.');
}

/** Next reference for the current year, e.g. AFCD-2027-004 (year in Morocco time). */
async function nextReference(db: DB, now = new Date()) {
  const prefix = `AFCD-${yearIn(now, 'Africa/Casablanca')}-`;
  const [{ m }] = await db.select({ m: sql<string | null>`max(${applyCalls.reference})` }).from(applyCalls).where(sql`${applyCalls.reference} like ${prefix + '%'}`);
  const n = m ? Number(m.slice(prefix.length)) || 0 : 0;
  return `${prefix}${String(n + 1).padStart(3, '0')}`;
}

async function event(db: Pick<DB, 'insert'>, callId: string, actorId: string | null, kind: string, e: { from?: string | null; to?: string | null; reason?: string; meta?: Record<string, unknown> } = {}) {
  await db.insert(applyCallEvents).values({ callId, actorId, kind, fromStatus: e.from ?? null, toStatus: e.to ?? null, reason: (e.reason ?? '').slice(0, 2000), meta: e.meta ?? null });
}

/** Inserts a call with a fresh reference; retries if two people create one at the same moment. */
async function insertCall(db: DB, values: Omit<typeof applyCalls.$inferInsert, 'reference'>) {
  for (let i = 0; ; i++) {
    try {
      return await db.transaction(async (tx) => {
        const t = tx as unknown as DB;
        const [c] = await t.insert(applyCalls).values({ ...values, reference: await nextReference(t) }).returning();
        return c;
      });
    } catch (e) {
      if (i < 3 && /apply_calls_reference_uq/.test(String((e as Error).message ?? e) + String((e as { cause?: unknown }).cause ?? ''))) continue;
      throw e;
    }
  }
}

export async function createCall(db: DB, me: Me, raw: unknown) {
  const input = parse(raw);
  await assertSlugFree(db, input.slug);
  const at = instants(input);
  const c = await insertCall(db, { ...columns(input), ...(await relations(db, input)), ...at, createdBy: me.id, updatedBy: me.id });
  await event(db, c.id, me.id, 'status', { to: 'draft' });
  await audit(db, me, 'apply.call.create', { type: 'apply_call', id: c.id }, `Created call ${c.reference} “${c.title}”`);
  return c;
}

export async function loadCall(db: DB, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw new AppError(404, 'Call not found.');
  const [c] = await db.select().from(applyCalls).where(eq(applyCalls.id, id));
  if (!c) throw new AppError(404, 'Call not found.');
  const pillarKey = c.pillarId ? (await db.select({ key: pillars.key }).from(pillars).where(eq(pillars.id, c.pillarId)))[0]?.key ?? null : null;
  const projectSlug = c.projectId ? (await db.select({ slug: projects.slug }).from(projects).where(eq(projects.id, c.projectId)))[0]?.slug ?? null : null;
  return { ...c, pillarKey, projectSlug, opensLocal: c.opensAt ? utcToLocal(c.opensAt, c.timeZone) : null, closesLocal: c.closesAt ? utcToLocal(c.closesAt, c.timeZone) : null };
}
export type FullCall = Awaited<ReturnType<typeof loadCall>>;

export const toInput = (c: FullCall): CallInput => ({
  title: c.title, slug: c.slug, summary: c.summary, description: c.description, i18n: c.i18n, callType: c.callType as CallInput['callType'], audience: c.audience,
  eligibility: c.eligibility, location: c.location, format: c.format as CallInput['format'], language: c.language as CallInput['language'], pillarKey: c.pillarKey,
  projectSlug: c.projectSlug, heroMediaId: c.heroMediaId, opensLocal: c.opensLocal, closesLocal: c.closesLocal, timeZone: c.timeZone, places: c.places,
  contactEmail: c.contactEmail, terms: c.terms, privacyNotice: c.privacyNotice, seoTitle: c.seoTitle, seoDescription: c.seoDescription, unlisted: c.unlisted,
});

/** What still stops this call from going to review / opening. Plain sentences for the editor. */
export async function callProblems(db: DB, c: FullCall, now = new Date()) {
  const out: string[] = [];
  if (!c.summary) out.push('Add a short summary (it is shown in lists and search results).');
  if (c.description.trim().split(/\s+/).filter(Boolean).length < 20) out.push('Describe the call (at least 20 words): what it offers and what participants will do.');
  if (!c.eligibility.length) out.push('Add who can apply (at least one eligibility point).');
  if (!c.opensAt) out.push('Set the opening date and time.');
  if (!c.closesAt) out.push('Set the deadline.');
  else if (c.closesAt <= now && PRE.includes(c.status)) out.push('The deadline has already passed. Choose a later one.');
  if (!EMAIL.test(c.contactEmail)) out.push('Add a contact email for applicants’ questions.');
  if (c.privacyNotice.trim().length < 40) out.push('Write the privacy notice: what personal data is collected, why, who sees it and how long it is kept.');
  if (c.heroMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, c.heroMediaId));
    if (!m) out.push('The image no longer exists in the media library.');
    else if (!m.rightsConfirmed) out.push(`Confirm usage rights and consent for “${m.originalName}” in the media library.`);
  }
  return out;
}

const same = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/** Saves the editor. `rev` must be the one the editor loaded (two people never overwrite each other silently).
 *  Before release: any change, and an approved call goes back to draft. After release (scheduled…completed): texts,
 *  image, contact and SEO only; the address, time zone and dates change only through Unschedule / Extend / Close. */
export async function updateCall(db: DB, me: Me, id: string, raw: unknown) {
  const rev = z.object({ rev: z.number().int().min(1) }).safeParse(raw);
  if (!rev.success) throw new AppError(422, 'Reload the call and try again (missing revision).');
  const { rev: _r, ...rest } = raw as Record<string, unknown>;
  const input = parse(rest);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(applyCalls).where(eq(applyCalls.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Call not found.');
    if (cur.rev !== rev.data.rev) throw new AppError(409, 'Someone else changed this call after you opened it. Reload to see their changes, then edit again.', [{ path: 'rev', message: 'stale' }]);
    if (cur.status === 'in_review') throw new AppError(409, 'This call is in review. Withdraw it before editing.');
    if (cur.status === 'archived') throw new AppError(409, 'Restore this call before editing.');
    const at = instants(input);
    const released = RELEASED.includes(cur.status);
    if (released) {
      if (input.slug !== cur.slug) throw new AppError(409, 'The address of a released call cannot change: applicants and links already use it.');
      if (input.timeZone !== cur.timeZone) throw new AppError(409, 'The time zone of a released call cannot change.');
      if (!same(at.opensAt, cur.opensAt)) throw new AppError(409, cur.status === 'scheduled' ? 'Unschedule the call to change its opening.' : 'The opening of a call that has opened cannot change.');
      if (!same(at.closesAt, cur.closesAt)) throw new AppError(409, 'Use “Extend deadline” or “Close now” to change the deadline: both are recorded with a reason.');
    } else if (input.slug !== cur.slug) await assertSlugFree(t, input.slug, id);
    const before = toInput(await loadCall(t, id));
    const changed = (Object.keys(input) as (keyof CallInput)[]).filter((k) => JSON.stringify(input[k]) !== JSON.stringify(before[k]));
    if (!changed.length) return cur;
    const next: Partial<Call> = { ...columns(input), ...(await relations(t, input)), ...at, rev: cur.rev + 1, updatedBy: me.id, updatedAt: new Date() };
    if (cur.status === 'approved') Object.assign(next, { status: 'draft', approvedRevisionId: null });
    const [c] = await t.update(applyCalls).set(next).where(eq(applyCalls.id, id)).returning();
    if (released) {
      await addRevision(t, id, input, 'live_edit', me.id);
      await event(t, id, me.id, 'edit', { meta: { fields: changed } });
    } else if (cur.status === 'approved') await event(t, id, me.id, 'status', { from: 'approved', to: 'draft', reason: 'Edited after approval', meta: { fields: changed } });
    await audit(tx, me, 'apply.call.update', { type: 'apply_call', id }, `Edited call ${cur.reference}${released ? ' (released)' : ''}`, { fields: changed });
    return c;
  });
}

async function addRevision(db: DB, callId: string, snap: CallInput, reason: string, userId: string | null) {
  const [{ n }] = await db.select({ n: max(applyCallRevisions.number) }).from(applyCallRevisions).where(eq(applyCallRevisions.callId, callId));
  const [r] = await db.insert(applyCallRevisions).values({ callId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return r;
}

// ---------------------------------------------------------------- Lifecycle
type Rule = { from: CallStatus[]; perm: Permission; label: string; reason?: 'required' | 'optional'; deadline?: boolean };
export const ACTIONS: Record<string, Rule> = {
  submit: { from: ['draft', 'changes_requested'], perm: 'apply.call.manage', label: 'Submit for review' },
  withdraw: { from: ['in_review', 'approved'], perm: 'apply.call.manage', label: 'Back to draft' },
  request_changes: { from: ['in_review'], perm: 'apply.call.approve', label: 'Request changes', reason: 'required' },
  approve: { from: ['in_review'], perm: 'apply.call.approve', label: 'Approve', reason: 'optional' },
  schedule: { from: ['approved'], perm: 'apply.call.publish', label: 'Schedule opening' },
  unschedule: { from: ['scheduled'], perm: 'apply.call.publish', label: 'Unschedule' },
  pause: { from: ['open'], perm: 'apply.call.publish', label: 'Pause', reason: 'required' },
  resume: { from: ['paused'], perm: 'apply.call.publish', label: 'Resume' },
  extend: { from: ['open', 'paused'], perm: 'apply.call.publish', label: 'Extend deadline', reason: 'required', deadline: true },
  close: { from: ['open', 'paused'], perm: 'apply.call.publish', label: 'Close now', reason: 'required' },
  reopen: { from: ['closed'], perm: 'apply.call.publish', label: 'Reopen', reason: 'required', deadline: true },
  start_evaluation: { from: ['closed'], perm: 'apply.call.manage', label: 'Start evaluation' },
  complete: { from: ['under_evaluation'], perm: 'apply.call.manage', label: 'Mark completed' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'completed'], perm: 'apply.call.manage', label: 'Archive' },
  restore: { from: ['archived'], perm: 'apply.call.manage', label: 'Restore' },
};

/** The actions this role may take on a call in its current status (the editor shows only these). */
export const allowedActions = (role: Role, status: CallStatus) =>
  Object.entries(ACTIONS).filter(([, r]) => r.from.includes(status) && can(role, r.perm)).map(([k, r]) => ({ action: k, label: r.label, reason: r.reason ?? null, deadline: !!r.deadline }));

const transitionSchema = z.object({ action: z.string().max(30), reason: z.string().trim().max(2000).default(''), closesLocal: z.string().regex(LOCAL).nullable().optional() }).strict();

export async function transitionCall(db: DB, me: Me, role: Role, id: string, raw: unknown, now = new Date()) {
  const b = transitionSchema.safeParse(raw);
  if (!b.success || !ACTIONS[b.data.action]) throw new AppError(422, 'Unknown action.');
  const { action, reason } = b.data;
  const rule = ACTIONS[action];
  if (!can(role, rule.perm)) throw new HTTPException(403, { message: `Your role cannot do this (${rule.perm}).` });
  if (rule.reason === 'required' && reason.length < 3) throw new AppError(422, 'Give a reason: it is kept in the call’s history.');
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(applyCalls).where(eq(applyCalls.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Call not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `You can’t ${rule.label.toLowerCase()} a call that is ${STATUS_LABEL[cur.status].toLowerCase()}.`);
    const patch: Partial<Call> = { rev: cur.rev + 1, updatedAt: now, updatedBy: me.id };
    let to: CallStatus = cur.status;
    let kind = 'status';
    const meta: Record<string, unknown> = {};
    const full = await loadCall(t, id);
    const ready = async () => {
      const p = await callProblems(t, full, now);
      if (p.length) throw new AppError(422, 'This call is not ready yet.', p.map((m) => ({ path: '', message: m })));
    };
    switch (action) {
      case 'submit': await ready(); to = 'in_review'; patch.submittedBy = me.id; await addRevision(t, id, toInput(full), 'submitted', me.id); break;
      case 'withdraw': to = 'draft'; patch.approvedRevisionId = null; break;
      case 'request_changes': to = 'changes_requested'; break;
      case 'approve': {
        if (cur.submittedBy === me.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the person who submitted it must approve this call.');
        await ready();
        const r = await addRevision(t, id, toInput(full), 'approved', me.id);
        to = 'approved'; patch.approvedRevisionId = r.id; meta.revisionId = r.id; break;
      }
      case 'schedule': {
        await ready();
        if (!cur.closesAt || cur.closesAt <= now) throw new AppError(409, 'The deadline has passed. Send the call back to draft and choose a later one.');
        if (!(await hasPublishedForm(t, id))) throw new AppError(409, 'Publish the application form before scheduling the call (Form builder → Publish).');
        to = cur.opensAt && cur.opensAt > now ? 'scheduled' : 'open';
        if (to === 'open') { patch.openedAt = cur.openedAt ?? now; meta.openedEarly = !!cur.opensAt && cur.opensAt > now; }
        break;
      }
      case 'unschedule': to = 'approved'; break;
      case 'pause': to = 'paused'; break;
      case 'resume': to = cur.closesAt && cur.closesAt > now ? 'open' : 'closed'; if (to === 'closed') patch.closedAt = now; break;
      case 'close': to = 'closed'; patch.closedAt = now; meta.scheduledDeadline = cur.closesAt?.toISOString() ?? null; break;
      case 'extend':
      case 'reopen': {
        const d = b.data.closesLocal ? zonedToUtc(b.data.closesLocal, cur.timeZone) : null;
        if (!d) throw new AppError(422, 'Choose the new deadline.', [{ path: 'closesLocal', message: `Use a valid date and time in ${cur.timeZone}.` }]);
        if (d <= now) throw new AppError(422, 'The new deadline must be in the future.');
        if (action === 'extend' && cur.closesAt && d <= cur.closesAt) throw new AppError(422, 'An extension must move the deadline later. To end early, use “Close now”.');
        meta.from = cur.closesAt?.toISOString() ?? null; meta.to = d.toISOString();
        patch.closesAt = d;
        kind = action;
        if (action === 'reopen') { to = 'open'; patch.closedAt = null; }
        break;
      }
      case 'start_evaluation': to = 'under_evaluation'; break;
      case 'complete': to = 'completed'; break;
      case 'archive': to = 'archived'; patch.archivedFrom = cur.status; break;
      case 'restore': to = cur.archivedFrom === 'completed' ? 'completed' : 'draft'; patch.archivedFrom = null; patch.approvedRevisionId = null; break;
    }
    patch.status = to;
    await t.update(applyCalls).set(patch).where(eq(applyCalls.id, id));
    await event(t, id, me.id, kind, { from: cur.status, to, reason, meta });
    await audit(tx, me, `apply.call.${action}`, { type: 'apply_call', id }, `${cur.reference}: ${STATUS_LABEL[cur.status]} → ${STATUS_LABEL[to]}${kind !== 'status' ? ` (${action}, deadline ${meta.to})` : ''}`, { reason: reason || undefined, ...meta });
    return { status: to, rev: patch.rev };
  });
}

/** Opens and closes calls on server time. Called every minute by the server; safe to call any time.
 *  Each change is conditional on the status it expects, so two runs never apply the same step twice. */
export async function runCallSchedule(db: DB, now = new Date()) {
  const done: { id: string; reference: string; to: CallStatus }[] = [];
  const due = await db.select().from(applyCalls).where(and(eq(applyCalls.status, 'scheduled'), isNotNull(applyCalls.opensAt), lte(applyCalls.opensAt, now)));
  for (const c of due) {
    const [u] = await db.update(applyCalls).set({ status: 'open', openedAt: c.openedAt ?? now, rev: c.rev + 1, updatedAt: now }).where(and(eq(applyCalls.id, c.id), eq(applyCalls.status, 'scheduled'))).returning();
    if (!u) continue;
    await event(db, c.id, null, 'status', { from: 'scheduled', to: 'open', reason: 'Opening time reached (server time)' });
    await audit(db, null, 'apply.call.auto_open', { type: 'apply_call', id: c.id }, `${c.reference} opened on schedule`);
    done.push({ id: c.id, reference: c.reference, to: 'open' });
  }
  const ending = await db.select().from(applyCalls).where(and(inArray(applyCalls.status, ['open', 'paused']), isNotNull(applyCalls.closesAt), lte(applyCalls.closesAt, now)));
  for (const c of ending) {
    const [u] = await db.update(applyCalls).set({ status: 'closed', closedAt: now, rev: c.rev + 1, updatedAt: now }).where(and(eq(applyCalls.id, c.id), eq(applyCalls.status, c.status))).returning();
    if (!u) continue;
    await event(db, c.id, null, 'status', { from: c.status, to: 'closed', reason: 'Deadline reached (server time)' });
    await audit(db, null, 'apply.call.auto_close', { type: 'apply_call', id: c.id }, `${c.reference} closed at its deadline`);
    done.push({ id: c.id, reference: c.reference, to: 'closed' });
  }
  return done;
}

/** A new draft with the same content: new reference, new address, no dates, no history. */
export async function duplicateCall(db: DB, me: Me, id: string) {
  const src = await loadCall(db, id);
  let slug = `${src.slug}-copy`.slice(0, 80);
  for (let i = 2; (await db.select({ id: applyCalls.id }).from(applyCalls).where(eq(applyCalls.slug, slug))).length; i++) slug = `${src.slug.slice(0, 72)}-copy-${i}`;
  const input = { ...toInput(src), slug, title: `${src.title} (copy)`.slice(0, 160), opensLocal: null, closesLocal: null };
  const c = await insertCall(db, { ...columns(input), pillarId: src.pillarId, projectId: src.projectId, opensAt: null, closesAt: null, createdBy: me.id, updatedBy: me.id });
  await event(db, c.id, me.id, 'duplicate', { to: 'draft', reason: `Copied from ${src.reference}`, meta: { from: src.id } });
  await audit(db, me, 'apply.call.duplicate', { type: 'apply_call', id: c.id }, `Duplicated ${src.reference} as ${c.reference}`, { from: src.id });
  return c;
}

// ---------------------------------------------------------------- Reading
export async function listCalls(db: DB) {
  return db.select({
    id: applyCalls.id, reference: applyCalls.reference, slug: applyCalls.slug, title: applyCalls.title, callType: applyCalls.callType, status: applyCalls.status,
    opensAt: applyCalls.opensAt, closesAt: applyCalls.closesAt, timeZone: applyCalls.timeZone, location: applyCalls.location, format: applyCalls.format,
    places: applyCalls.places, unlisted: applyCalls.unlisted, updatedAt: applyCalls.updatedAt, pillarName: pillars.name, projectName: projects.name,
  }).from(applyCalls).leftJoin(pillars, eq(pillars.id, applyCalls.pillarId)).leftJoin(projects, eq(projects.id, applyCalls.projectId))
    .orderBy(desc(applyCalls.updatedAt)).limit(1000);
}

export async function callHistory(db: DB, id: string) {
  const events = await db.select({ id: applyCallEvents.id, kind: applyCallEvents.kind, fromStatus: applyCallEvents.fromStatus, toStatus: applyCallEvents.toStatus, reason: applyCallEvents.reason,
    meta: applyCallEvents.meta, createdAt: applyCallEvents.createdAt, actorName: users.name }).from(applyCallEvents).leftJoin(users, eq(users.id, applyCallEvents.actorId))
    .where(eq(applyCallEvents.callId, id)).orderBy(desc(applyCallEvents.createdAt), desc(applyCallEvents.id)).limit(200);
  const revisions = await db.select({ id: applyCallRevisions.id, number: applyCallRevisions.number, reason: applyCallRevisions.reason, createdAt: applyCallRevisions.createdAt })
    .from(applyCallRevisions).where(eq(applyCallRevisions.callId, id)).orderBy(desc(applyCallRevisions.number));
  return { events, revisions };
}

/** Applications overview: only numbers that exist. Application counts arrive with submissions (phase 4). */
export async function overview(db: DB, now = new Date()) {
  const byStatus = Object.fromEntries((await db.select({ s: applyCalls.status, n: sql<number>`count(*)::int` }).from(applyCalls).groupBy(applyCalls.status)).map((r) => [r.s, r.n])) as Partial<Record<CallStatus, number>>;
  const week = new Date(now.getTime() + 7 * 86400_000);
  const pick = { id: applyCalls.id, reference: applyCalls.reference, title: applyCalls.title, status: applyCalls.status, opensAt: applyCalls.opensAt, closesAt: applyCalls.closesAt, timeZone: applyCalls.timeZone };
  const deadlines = await db.select(pick).from(applyCalls).where(and(inArray(applyCalls.status, ['open', 'paused']), isNotNull(applyCalls.closesAt))).orderBy(asc(applyCalls.closesAt)).limit(8);
  const openings = await db.select(pick).from(applyCalls).where(eq(applyCalls.status, 'scheduled')).orderBy(asc(applyCalls.opensAt)).limit(8);
  const waiting = await db.select(pick).from(applyCalls).where(eq(applyCalls.status, 'in_review')).orderBy(asc(applyCalls.updatedAt)).limit(8);
  const activity = await db.select({ id: applyCallEvents.id, callId: applyCallEvents.callId, reference: applyCalls.reference, title: applyCalls.title, kind: applyCallEvents.kind,
    toStatus: applyCallEvents.toStatus, fromStatus: applyCallEvents.fromStatus, createdAt: applyCallEvents.createdAt, actorName: users.name })
    .from(applyCallEvents).innerJoin(applyCalls, eq(applyCalls.id, applyCallEvents.callId)).leftJoin(users, eq(users.id, applyCallEvents.actorId))
    .orderBy(desc(applyCallEvents.createdAt), desc(applyCallEvents.id)).limit(10);
  return {
    kpis: {
      open: byStatus.open ?? 0, paused: byStatus.paused ?? 0, scheduled: byStatus.scheduled ?? 0, inReview: byStatus.in_review ?? 0,
      closingThisWeek: deadlines.filter((d) => d.status === 'open' && d.closesAt! <= week).length,
      underEvaluation: byStatus.under_evaluation ?? 0, drafts: (byStatus.draft ?? 0) + (byStatus.changes_requested ?? 0),
      total: Object.entries(byStatus).filter(([s]) => s !== 'archived').reduce((a, [, n]) => a + (n ?? 0), 0),
    },
    deadlines, openings, waiting, activity, serverTime: now.toISOString(),
  };
}

// ---------------------------------------------------------------- Export
/** A cell that a spreadsheet will never run as a formula. */
const cell = (v: unknown) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export async function exportCallsCsv(db: DB, me: Me) {
  const rows = await listCalls(db);
  const head = ['Reference', 'Title', 'Type', 'Status', 'Opens (local)', 'Deadline (local)', 'Time zone', 'Location', 'Format', 'Places', 'Pillar', 'Project', 'Unlisted', 'Updated (UTC)'];
  const lines = rows.map((r) => [r.reference, r.title, CALL_TYPE_LABEL[r.callType as keyof typeof CALL_TYPE_LABEL] ?? r.callType, STATUS_LABEL[r.status],
    r.opensAt ? utcToLocal(r.opensAt, r.timeZone).replace('T', ' ') : '', r.closesAt ? utcToLocal(r.closesAt, r.timeZone).replace('T', ' ') : '', r.timeZone,
    r.location, r.format, r.places ?? '', r.pillarName ?? '', r.projectName ?? '', r.unlisted ? 'yes' : 'no', r.updatedAt.toISOString()].map(cell).join(','));
  await audit(db, me, 'apply.calls_export', { type: 'apply_call' }, `Exported ${rows.length} call(s) as CSV`);
  return '﻿' + [head.join(','), ...lines].join('\r\n') + '\r\n';
}
