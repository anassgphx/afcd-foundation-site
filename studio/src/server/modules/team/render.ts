// Team data for the public site: src/content.py reads src/data/team.json (env STUDIO_TEAM_JSON) for team.html, and
// build.mjs adds Person structured data from it. Values go out as PLAIN TEXT (the generator escapes them).
// Only published revisions of members that are not hidden, in the groups and order of the live layout.
import { inArray, isNotNull } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { media, teamMemberRevisions, teamMembers } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { LINK_KINDS, type LayoutSnapshot, type MemberSnapshot } from './service.ts';

export type LiveMember = { id: string; revisionId: string; snap: MemberSnapshot };
export type TeamOverride = { memberId: string; revisionId?: string | null; hidden?: boolean };

/** Live members (optionally overriding one: a new revision, removed with null, or hidden/shown). */
export async function liveMembers(db: DB, override?: TeamOverride): Promise<LiveMember[]> {
  const rows = await db.select({ id: teamMembers.id, rev: teamMembers.publishedRevisionId, hidden: teamMembers.hidden }).from(teamMembers).where(isNotNull(teamMembers.publishedRevisionId));
  const map = new Map(rows.filter((r) => !r.hidden).map((r) => [r.id, r.rev as string]));
  if (override) {
    const cur = rows.find((r) => r.id === override.memberId);
    const rev = override.revisionId === undefined ? cur?.rev ?? null : override.revisionId;
    const hidden = override.hidden ?? cur?.hidden ?? false;
    if (rev && !hidden) map.set(override.memberId, rev); else map.delete(override.memberId);
  }
  if (!map.size) return [];
  const revs = await db.select().from(teamMemberRevisions).where(inArray(teamMemberRevisions.id, [...map.values()]));
  return revs.map((r) => ({ id: r.memberId, revisionId: r.id, snap: r.snapshot as unknown as MemberSnapshot }));
}

export async function teamEntries(db: DB, live: LiveMember[], layout: { id: string; snapshot: LayoutSnapshot }) {
  const ids = [...new Set(live.map((x) => x.snap.photoMediaId).filter(Boolean) as string[])];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const image = (id: string | null) => {
    const m = id ? rows.find((r) => r.id === id) : undefined;
    if (!m) return null;
    const ref = publicRef(m, 'assets/media/');
    return { src: ref.src, srcset: ref.srcset, w: ref.w, h: ref.h, alt: m.alt, fx: m.focalX ?? 50, fy: m.focalY ?? 50 };
  };
  const groups = layout.snapshot.groups;
  const keys = new Set(groups.map((g) => g.key));
  const pos = new Map(layout.snapshot.order.map((id, i) => [id, i]));
  const members = live.filter((m) => keys.has(m.snap.groupKey))
    .sort((a, b) => (pos.get(a.id) ?? 1e6) - (pos.get(b.id) ?? 1e6) || a.snap.name.localeCompare(b.snap.name))
    .map(({ id, revisionId, snap: s }) => ({
      id, slug: s.slug, name: s.name, role: s.role, bio: s.bio, group: s.groupKey, image: image(s.photoMediaId), email: s.email || null,
      links: s.links.map((l) => ({ kind: l.kind, label: LINK_KINDS[l.kind], url: l.url })), revision: revisionId,
    }));
  return { layoutRevision: layout.id, groups, members, mediaIds: members.map((m) => live.find((x) => x.id === m.id)!.snap.photoMediaId).filter(Boolean) as string[] };
}

/** Members whose published revision puts them in a group the live layout does not have (they would not show). */
export async function membersOutsideLayout(db: DB, layout: LayoutSnapshot) {
  const keys = new Set(layout.groups.map((g) => g.key));
  return (await liveMembers(db)).filter((m) => !keys.has(m.snap.groupKey));
}
