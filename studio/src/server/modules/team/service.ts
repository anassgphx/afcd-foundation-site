// Team: the people on team.html, one record per person, each with the usual review workflow
// (draft → in review → approved → published). Migration 0034 moved them here from the About page "team".
//
// Two lighter things sit next to the members and are published by someone with team.publish, without a review step:
//  - the layout: the groups (name, description, shown or not, order) and the order of the people inside each group.
//    Staff edit the working copy (team_groups, team_members.sort); "Publish order and groups" stores it as a
//    team_layout_revisions row, and only the newest published one reaches the website.
//  - visibility: a live member can be hidden from the page (and shown again) at once; the published revision stays.
// Role and bio are plain text: the website build translates them like any other text (Translations).
import { and, asc, desc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import { z } from 'zod';
import type { DB } from '../../db/client.ts';
import { media, reviewComments, teamGroups, teamLayoutRevisions, teamMemberRevisions, teamMembers, type TeamLink } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Role } from '../../rbac.ts';
import { altProblem } from '../media/alt.ts';

type Status = typeof teamMembers.$inferSelect['status'];
/** The only email addresses that may appear on the public website (same rule as the About pages and build.mjs). */
export { PUBLIC_EMAILS } from '../../identity.ts';
import { PUBLIC_EMAILS } from '../../identity.ts';
export const LINK_KINDS = { linkedin: 'LinkedIn', x: 'X', facebook: 'Facebook', instagram: 'Instagram', website: 'Website' } as const;
const LINK_HOSTS: Record<string, RegExp> = {
  linkedin: /(^|\.)linkedin\.com$/, x: /(^|\.)(x|twitter)\.com$/, facebook: /(^|\.)(facebook|fb)\.com$/, instagram: /(^|\.)instagram\.com$/, website: /./,
};
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HTTPS = /^https:\/\/[^\s"'<>]+$/;
const plain = (max: number) => z.string().trim().max(max, `Up to ${max} characters.`).refine((v) => !/[<>]/.test(v), 'Use plain text without < or >.');

export const nameKey = (n: string) => n.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const slugify = (n: string) => nameKey(n).replace(/ /g, '-').slice(0, 80);

const linkSchema = z.object({
  kind: z.enum(['linkedin', 'x', 'facebook', 'instagram', 'website']),
  url: z.string().trim().max(300).regex(HTTPS, 'Use a full https:// address.'),
}).strict().superRefine((l, ctx) => {
  let host = ''; try { host = new URL(l.url).hostname.toLowerCase(); } catch { /* the regex reports it */ }
  if (host && !LINK_HOSTS[l.kind].test(host)) ctx.addIssue({ code: 'custom', path: ['url'], message: `This is not a ${LINK_KINDS[l.kind]} address.` });
});

export const memberSchema = z.object({
  name: plain(80).pipe(z.string().min(2, 'Add the person’s name.')),
  slug: z.string().trim().max(80).regex(SLUG, 'Use lower-case letters, numbers and hyphens.'),
  role: plain(100).default(''),
  bio: plain(700).default(''),
  groupId: z.string().uuid('Choose a group.'),
  photoMediaId: z.string().uuid().nullable().default(null),
  email: z.string().trim().toLowerCase().max(120).refine((e) => e === '' || PUBLIC_EMAILS.includes(e), `Only ${PUBLIC_EMAILS.join(' or ')} can be shown on the website.`).default(''),
  links: z.array(linkSchema).max(6).default([]),
  provenance: plain(300).default(''),
}).strict();
export type MemberInput = z.infer<typeof memberSchema>;
/** What a revision stores: the public fields, with the group by its key (groups can be renamed, keys never change). */
export type MemberSnapshot = { name: string; slug: string; role: string; bio: string; groupKey: string; photoMediaId: string | null; email: string; links: TeamLink[] };

function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const r = schema.safeParse(raw);
  if (!r.success) throw new AppError(422, 'Some fields need attention.', r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  return r.data;
}

// ---------------------------------------------------------------- loading
export type MemberRow = typeof teamMembers.$inferSelect;
export async function loadMember(db: DB, id: string): Promise<MemberRow & { groupKey: string }> {
  const [m] = await db.select().from(teamMembers).where(eq(teamMembers.id, id));
  if (!m) throw new AppError(404, 'Team member not found.');
  const [g] = await db.select({ key: teamGroups.key }).from(teamGroups).where(eq(teamGroups.id, m.groupId));
  return { ...m, groupKey: g.key };
}

export const toMemberSnapshot = (m: MemberRow & { groupKey: string }): MemberSnapshot => ({
  name: m.name, slug: m.slug, role: m.role, bio: m.bio, groupKey: m.groupKey, photoMediaId: m.photoMediaId, email: m.email, links: m.links,
});

/** What still stops the member from going to review. */
export async function memberProblems(db: DB, m: MemberRow): Promise<string[]> {
  const out: string[] = [];
  if (!m.name.trim()) out.push('Add the person’s name.');
  if (!m.role.trim()) out.push('Add the role or title shown under the name.');
  if (/legal\s+rep|repr[ée]sentant\s+l[ée]gal/i.test(`${m.role} ${m.bio}`)) out.push('The legal representative is not shown on the website. Describe the role instead (for example, President).');
  if (/\b(?:ICE|IF|RC|CNSS|patente)\b\s*(?:n[°o]\.?|number|:)?\s*\d{4,}/i.test(`${m.role} ${m.bio}`)) out.push('Remove registration, tax and CNSS numbers: they are not published on the website.');
  for (const e of new Set(`${m.role} ${m.bio}`.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g) ?? [])) if (!PUBLIC_EMAILS.includes(e.toLowerCase())) out.push(`The address ${e} is not public. Only ${PUBLIC_EMAILS.join(' and ')} may appear on the website.`);
  if (m.photoMediaId) {
    const [p] = await db.select().from(media).where(eq(media.id, m.photoMediaId));
    if (!p) out.push('The photo no longer exists in the media library.');
    else {
      { const ap = altProblem(p, `Add alt text to the photo “${p.originalName}” in the media library (usually the person’s name).`); if (ap) out.push(ap); }
      if (!p.rightsConfirmed) out.push(`Confirm AFCD may use the photo “${p.originalName}” (usage rights and the person’s consent).`);
    }
  }
  return out;
}

// ---------------------------------------------------------------- editing members
async function checkRefs(db: DB, input: MemberInput) {
  if (!(await db.select({ id: teamGroups.id }).from(teamGroups).where(eq(teamGroups.id, input.groupId))).length) throw new AppError(422, 'This group no longer exists.');
  if (input.photoMediaId && !(await db.select({ id: media.id }).from(media).where(eq(media.id, input.photoMediaId))).length) throw new AppError(422, 'The photo no longer exists in the media library.');
}
async function assertSlug(db: DB, slug: string, exceptId?: string) {
  const rows = await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.slug, slug));
  if (rows.some((r) => r.id !== exceptId)) throw new AppError(409, 'Another team member already uses this record key.');
}
/** A free record key from the name (adds -2, -3… for homonyms). */
async function freeSlug(db: DB, name: string) {
  const base = slugify(name) || 'person';
  const taken = new Set((await db.select({ slug: teamMembers.slug }).from(teamMembers)).map((r) => r.slug));
  for (let i = 1; ; i++) { const s = i === 1 ? base : `${base}-${i}`; if (!taken.has(s)) return s; }
}

export async function createMember(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const body = (raw ?? {}) as Record<string, unknown>;
  const input = parse(memberSchema, { ...body, slug: body.slug || (await freeSlug(db, String(body.name ?? ''))) });
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    await checkRefs(t, input); await assertSlug(t, input.slug);
    const [{ n }] = await t.select({ n: max(teamMembers.sort) }).from(teamMembers).where(eq(teamMembers.groupId, input.groupId));
    const [m] = await t.insert(teamMembers).values({ ...input, nameKey: nameKey(input.name), sort: (n ?? 0) + 10, createdBy: actor.id, updatedBy: actor.id }).returning();
    await audit(tx, actor, 'team.create', { type: 'team_member', id: m.id }, `Added team member “${m.name}”`);
    return m;
  });
}

const EDITABLE: Status[] = ['draft', 'changes_requested', 'approved', 'published'];

export async function updateMember(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(memberSchema, raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(teamMembers).where(eq(teamMembers.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Team member not found.');
    if (!EDITABLE.includes(cur.status)) throw new AppError(409, cur.status === 'in_review' ? 'This person is in review. Withdraw it before editing.' : 'Restore this person before editing.');
    if (input.slug !== cur.slug && cur.publishedRevisionId) throw new AppError(409, 'The record key of a published team member cannot change.');
    await checkRefs(t, input); await assertSlug(t, input.slug, id);
    const moved = input.groupId !== cur.groupId;
    let sort = cur.sort;
    if (moved) { const [{ n }] = await t.select({ n: max(teamMembers.sort) }).from(teamMembers).where(eq(teamMembers.groupId, input.groupId)); sort = (n ?? 0) + 10; }
    const [m] = await t.update(teamMembers).set({ ...input, nameKey: nameKey(input.name), sort, status: 'draft', approvedRevisionId: null, updatedBy: actor.id, updatedAt: new Date() }).where(eq(teamMembers.id, id)).returning();
    await audit(tx, actor, 'team.update', { type: 'team_member', id }, `Edited team member “${m.name}”`);
    return m;
  });
}

const RULES: Record<string, { from: Status[]; to: Status; perm: 'team.update' | 'team.approve' }> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', perm: 'team.update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', perm: 'team.update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', perm: 'team.approve' },
  approve: { from: ['in_review'], to: 'approved', perm: 'team.approve' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', perm: 'team.update' },
  restore: { from: ['archived'], to: 'draft', perm: 'team.update' },
};
export const memberTransitionPerm = (a: string) => RULES[a]?.perm;

async function addRevision(db: DB, memberId: string, snap: MemberSnapshot, reason: string, userId: string | null) {
  const [{ n }] = await db.select({ n: max(teamMemberRevisions.number) }).from(teamMemberRevisions).where(eq(teamMemberRevisions.memberId, memberId));
  const [rev] = await db.insert(teamMemberRevisions).values({ memberId, number: (n ?? 0) + 1, snapshot: snap as unknown as Record<string, unknown>, reason, createdBy: userId }).returning();
  return rev;
}

export async function transitionMember(db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, opts: { comment?: string } = {}) {
  const rule = RULES[action];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = (opts.comment ?? '').trim();
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(teamMembers).where(eq(teamMembers.id, id)).for('update');
    if (!cur) throw new AppError(404, 'Team member not found.');
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} a team member who is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, 'Remove this person from the website before archiving the record.');
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, 'Someone other than the author must approve this team member.');
    const patch: Partial<typeof teamMembers.$inferInsert> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await loadMember(t, id);
      const problems = await memberProblems(t, full);
      if (problems.length) throw new AppError(422, 'This team member is not ready yet.', problems.map((m) => ({ path: '', message: m })));
      const rev = await addRevision(t, id, toMemberSnapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') { patch.approvedRevisionId = rev.id; patch.verifiedAt = new Date(); }
    }
    if (action === 'withdraw' || action === 'restore') patch.approvedRevisionId = null;
    await t.update(teamMembers).set(patch).where(eq(teamMembers.id, id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: 'team_member', entityId: id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `team.${action}`, { type: 'team_member', id }, `${cur.name}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}

export async function restoreMemberRevision(db: DB, actor: NonNullable<Actor>, id: string, revisionId: string) {
  const [rev] = await db.select().from(teamMemberRevisions).where(and(eq(teamMemberRevisions.id, revisionId), eq(teamMemberRevisions.memberId, id)));
  if (!rev) throw new AppError(404, 'Revision not found.');
  const s = rev.snapshot as unknown as MemberSnapshot;
  const cur = await loadMember(db, id);
  const [g] = await db.select({ id: teamGroups.id }).from(teamGroups).where(eq(teamGroups.key, s.groupKey));
  await updateMember(db, actor, id, { name: s.name, slug: cur.slug, role: s.role, bio: s.bio, groupId: g?.id ?? cur.groupId, photoMediaId: s.photoMediaId, email: s.email, links: s.links, provenance: cur.provenance });
}

export async function memberHistory(db: DB, id: string) {
  const revisions = await db.select({ id: teamMemberRevisions.id, number: teamMemberRevisions.number, reason: teamMemberRevisions.reason, createdAt: teamMemberRevisions.createdAt })
    .from(teamMemberRevisions).where(eq(teamMemberRevisions.memberId, id)).orderBy(desc(teamMemberRevisions.number));
  const comments = await db.select().from(reviewComments).where(and(eq(reviewComments.entityType, 'team_member'), eq(reviewComments.entityId, id))).orderBy(desc(reviewComments.createdAt));
  return { revisions, comments };
}

// ---------------------------------------------------------------- layout: groups and order
export type LayoutSnapshot = (typeof teamLayoutRevisions.$inferSelect)['snapshot'];
export async function liveLayout(db: DB) {
  const [r] = await db.select().from(teamLayoutRevisions).where(isNotNull(teamLayoutRevisions.publishedAt)).orderBy(desc(teamLayoutRevisions.number)).limit(1);
  return r ?? null;
}
/** The layout as Studio has it now (groups in order, then every non-archived member in group order). */
export async function workingLayout(db: DB): Promise<LayoutSnapshot> {
  const groups = await db.select().from(teamGroups).orderBy(asc(teamGroups.sort), asc(teamGroups.key));
  const rank = new Map(groups.map((g, i) => [g.id, i]));
  const ms = (await db.select({ id: teamMembers.id, groupId: teamMembers.groupId, sort: teamMembers.sort, name: teamMembers.name }).from(teamMembers))
    .sort((a, b) => rank.get(a.groupId)! - rank.get(b.groupId)! || a.sort - b.sort || a.name.localeCompare(b.name));
  return { groups: groups.map((g) => ({ key: g.key, name: g.name, description: g.description, show: g.show })), order: ms.map((m) => m.id) };
}
// field by field: jsonb does not keep the key order of the objects it stores
const groupSig = (g: LayoutSnapshot['groups'][number]) => [g.key, g.name, g.description ?? '', g.show !== false].join('\u0000');
const sameLayout = (a: LayoutSnapshot, b: LayoutSnapshot, live: Set<string>) =>
  a.groups.map(groupSig).join('\u0001') === b.groups.map(groupSig).join('\u0001') && a.order.filter((x) => live.has(x)).join() === b.order.filter((x) => live.has(x)).join();

/** Whether the working groups/order differ from what the website shows (only live people's order counts). */
export async function layoutPending(db: DB) {
  const live = await liveLayout(db);
  if (!live) return true;
  const ids = new Set((await db.select({ id: teamMembers.id }).from(teamMembers).where(isNotNull(teamMembers.publishedRevisionId))).map((r) => r.id));
  return !sameLayout(await workingLayout(db), live.snapshot, ids);
}

const groupSchema = z.object({
  name: plain(60).pipe(z.string().min(2, 'Give the group a name.')),
  description: plain(400).default(''),
  show: z.boolean().default(true),
}).strict();

export async function createGroup(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const input = parse(groupSchema, raw);
  const key = slugify(input.name).slice(0, 30).replace(/-$/, '') || 'group';
  const taken = new Set((await db.select({ key: teamGroups.key }).from(teamGroups)).map((g) => g.key));
  // section ids on the page: never one the page already uses for something else
  for (const k of ['overview', 'people', 'main', 'top']) taken.add(k);
  let k = /^[a-z]/.test(key) ? key : `g-${key}`; for (let i = 2; taken.has(k); i++) k = `${key}-${i}`;
  const [{ n }] = await db.select({ n: max(teamGroups.sort) }).from(teamGroups);
  const [g] = await db.insert(teamGroups).values({ ...input, key: k, sort: (n ?? 0) + 10 }).returning();
  await audit(db, actor, 'team.group_create', { type: 'team_group', id: g.id }, `Added the team group “${g.name}”`);
  return g;
}

export async function updateGroup(db: DB, actor: NonNullable<Actor>, id: string, raw: unknown) {
  const input = parse(groupSchema, raw);
  const [g] = await db.update(teamGroups).set({ ...input, updatedAt: new Date() }).where(eq(teamGroups.id, id)).returning();
  if (!g) throw new AppError(404, 'Group not found.');
  await audit(db, actor, 'team.group_update', { type: 'team_group', id }, `Edited the team group “${g.name}”`);
  return g;
}

export async function deleteGroup(db: DB, actor: NonNullable<Actor>, id: string) {
  const [g] = await db.select().from(teamGroups).where(eq(teamGroups.id, id));
  if (!g) throw new AppError(404, 'Group not found.');
  if ((await db.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.groupId, id)).limit(1)).length) throw new AppError(409, 'Move the people in this group to another group first.');
  // an empty group shows nothing on the website; the live layout drops it the next time it is published
  await db.delete(teamGroups).where(eq(teamGroups.id, id));
  await audit(db, actor, 'team.group_delete', { type: 'team_group', id }, `Removed the empty team group “${g.name}”`);
  return { ok: true };
}

/** New order of the groups, or of the people inside one group (ids in display order). */
export async function reorder(db: DB, actor: NonNullable<Actor>, raw: unknown) {
  const b = parse(z.object({ groupId: z.string().uuid().nullable().default(null), ids: z.array(z.string().uuid()).min(1).max(500) }).strict(), raw);
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    if (!b.groupId) {
      const all = await t.select({ id: teamGroups.id }).from(teamGroups);
      if (all.length !== b.ids.length || new Set(b.ids).size !== all.length || all.some((g) => !b.ids.includes(g.id))) throw new AppError(422, 'List every group once.');
      for (const [i, id] of b.ids.entries()) await t.update(teamGroups).set({ sort: (i + 1) * 10, updatedAt: new Date() }).where(eq(teamGroups.id, id));
      await audit(tx, actor, 'team.reorder', { type: 'team_group' }, 'Reordered the team groups');
    } else {
      const inGroup = await t.select({ id: teamMembers.id }).from(teamMembers).where(eq(teamMembers.groupId, b.groupId));
      if (inGroup.length !== b.ids.length || new Set(b.ids).size !== b.ids.length || inGroup.some((m) => !b.ids.includes(m.id))) throw new AppError(422, 'List every person of the group once. Reload the list and try again.');
      for (const [i, id] of b.ids.entries()) await t.update(teamMembers).set({ sort: (i + 1) * 10 }).where(eq(teamMembers.id, id));
      const [g] = await t.select({ name: teamGroups.name }).from(teamGroups).where(eq(teamGroups.id, b.groupId));
      await audit(tx, actor, 'team.reorder', { type: 'team_group', id: b.groupId }, `Reordered the people in “${g?.name ?? 'a group'}”`);
    }
    return { ok: true };
  });
}

export async function addLayoutRevision(db: DB, snap: LayoutSnapshot, reason: string, userId: string | null) {
  const [{ n }] = await db.select({ n: max(teamLayoutRevisions.number) }).from(teamLayoutRevisions);
  const [rev] = await db.insert(teamLayoutRevisions).values({ number: (n ?? 0) + 1, snapshot: snap, reason, createdBy: userId }).returning();
  return rev;
}

// ---------------------------------------------------------------- lists
export async function listTeam(db: DB) {
  const groups = await db.select().from(teamGroups).orderBy(asc(teamGroups.sort), asc(teamGroups.key));
  const rank = new Map(groups.map((g, i) => [g.id, i]));
  const members = (await db.select({
    id: teamMembers.id, slug: teamMembers.slug, name: teamMembers.name, role: teamMembers.role, groupId: teamMembers.groupId, photoMediaId: teamMembers.photoMediaId,
    email: teamMembers.email, links: teamMembers.links, sort: teamMembers.sort, hidden: teamMembers.hidden, status: teamMembers.status, publishedRevisionId: teamMembers.publishedRevisionId,
    bio: teamMembers.bio, updatedAt: teamMembers.updatedAt,
  }).from(teamMembers)).sort((a, b) => rank.get(a.groupId)! - rank.get(b.groupId)! || a.sort - b.sort || a.name.localeCompare(b.name));
  const photos = [...new Set(members.map((m) => m.photoMediaId).filter(Boolean) as string[])];
  const mrows = photos.length ? await db.select({ id: media.id, storageKey: media.storageKey }).from(media).where(inArray(media.id, photos)) : [];
  const thumb = new Map(mrows.map((m) => [m.id, `/studio/media-file/${m.storageKey}-480.webp`]));
  const live = await liveLayout(db);
  return {
    groups: groups.map((g) => ({ ...g, count: members.filter((m) => m.groupId === g.id && m.status !== 'archived').length, live: !!live?.snapshot.groups.some((x) => x.key === g.key) })),
    members: members.map(({ bio, ...m }) => ({ ...m, hasBio: !!bio.trim(), photo: m.photoMediaId ? thumb.get(m.photoMediaId) ?? null : null })),
    layout: { pending: await layoutPending(db), publishedAt: live?.publishedAt ?? null, number: live?.number ?? null },
  };
}
