// Approval Queue: everything moving through review, across every kind of content, in one place.
//
// Each item links to its own editor and uses its own module's transition/publish endpoints (the queue never changes
// content itself). The diff compares what was submitted (the latest revision, or the draft for settings) with what the
// website shows (the published revision), field by field.
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { DB } from '../../db/client.ts';
import * as t from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { can, type Role } from '../../rbac.ts';
import { TEXT_PAGES } from '../home/service.ts';

const ACTIVE = ['in_review', 'approved', 'changes_requested'] as const;
type Perms = { read: string; approve: string; publish: string };
type RecordSrc = {
  type: string; label: string; perm: Perms; href: (id: string) => string; api: (id: string) => string;
  table: PgTable & Record<string, any>; title: any; rev: PgTable & Record<string, any>; revFk: string;
};
const R = (type: string, label: string, perm: string, table: any, title: any, rev: any, revFk: string, href: (id: string) => string, api: (id: string) => string): RecordSrc =>
  ({ type, label, perm: { read: `${perm}.read`, approve: `${perm}.approve`, publish: `${perm}.publish` }, table, title, rev, revFk, href, api });

export const RECORDS: RecordSrc[] = [
  R('project', 'Project', 'project', t.projects, t.projects.name, t.projectRevisions, 'projectId', (id) => `/studio/projects/${id}`, (id) => `/projects/${id}`),
  R('story', 'Story', 'news', t.articles, t.articles.title, t.articleRevisions, 'articleId', (id) => `/studio/news/${id}`, (id) => `/news/${id}`),
  R('event', 'Event', 'event', t.events, t.events.title, t.eventRevisions, 'eventId', (id) => `/studio/events/${id}`, (id) => `/events/${id}`),
  R('opportunity', 'Opportunity', 'opportunity', t.opportunities, t.opportunities.title, t.opportunityRevisions, 'opportunityId', (id) => `/studio/opportunities/${id}`, (id) => `/opportunities/${id}`),
  R('publication', 'Publication', 'publication', t.publications, t.publications.title, t.publicationRevisions, 'publicationId', (id) => `/studio/publications/${id}`, (id) => `/publications/${id}`),
  R('partner', 'Partner', 'partner', t.partners, t.partners.name, t.partnerRevisions, 'partnerId', (id) => `/studio/partners/${id}`, (id) => `/partners/${id}`),
  R('pillar', 'Pillar', 'pillar', t.pillars, t.pillars.name, t.pillarRevisions, 'pillarId', (id) => `/studio/pillars/${id}`, (id) => `/pillars/${id}`),
  R('page', 'Page', 'page', t.pages, t.pages.title, t.pageRevisions, 'pageId', (id) => `/studio/pages/${id}`, (id) => `/pages/${id}`),
  R('homepage', 'Homepage', 'page', t.pageContents, t.pageContents.file, t.pageContentRevisions, 'contentId', () => '/studio/home', () => '/home'),
  R('seo', 'SEO settings', 'seo', t.seoOverrides, t.seoOverrides.file, t.seoRevisions, 'overrideId', () => '/studio/seo/pages', (id) => `/seo/overrides/${id}`),
];
/** Draft/published settings kept in seo_settings rows (translations, menus, structured data). */
const SETTINGS: { key: string; type: string; label: string; title: string; perm: Perms; href: string; api: string }[] = [
  { key: 'i18n:fr', type: 'translation', label: 'Translations', title: 'French translations', perm: { read: 'translation.read', approve: 'translation.approve', publish: 'translation.publish' }, href: '/studio/translations?lang=fr', api: '/translations/fr' },
  { key: 'i18n:ar', type: 'translation', label: 'Translations', title: 'Arabic translations', perm: { read: 'translation.read', approve: 'translation.approve', publish: 'translation.publish' }, href: '/studio/translations?lang=ar', api: '/translations/ar' },
  { key: 'menu:site', type: 'menu', label: 'Menus', title: 'Website menus', perm: { read: 'page.read', approve: 'page.approve', publish: 'page.publish' }, href: '/studio/menus', api: '/menus' },
  { key: 'organization', type: 'schema', label: 'Structured data', title: 'Structured data settings', perm: { read: 'seo.read', approve: 'seo.approve', publish: 'seo.publish' }, href: '/studio/seo/schema', api: '/seo/schema' },
];

export type QueueItem = {
  uid: string; type: string; label: string; id: string; title: string; status: string; href: string; api: string;
  submittedBy: { id: string; name: string } | null; at: string; live: boolean;
  own: boolean; canApprove: boolean; canPublish: boolean; blocked: string | null;
};

export async function queue(db: DB, user: { id: string; role: Role }) {
  const role = user.role;
  const names = new Map((await db.select({ id: t.users.id, name: t.users.name }).from(t.users)).map((u) => [u.id, u.name]));
  const items: QueueItem[] = [];
  const push = (src: { type: string; label: string; perm: Perms }, r: { id: string; title: string; status: string; submittedBy: string | null; updatedAt: Date; live: boolean }, href: string, api: string) => {
    const own = r.submittedBy === user.id;
    const mayApprove = can(role, src.perm.approve as never);
    const blocked = r.status === 'in_review' && mayApprove && own && role !== 'super_admin' ? 'You submitted this. Someone else must review it.' : null;
    items.push({
      uid: `${src.type}:${r.id}`, type: src.type, label: src.label, id: r.id, title: r.title || 'Untitled', status: r.status, href, api,
      submittedBy: r.submittedBy ? { id: r.submittedBy, name: names.get(r.submittedBy) ?? 'Former user' } : null,
      at: r.updatedAt.toISOString(), live: r.live, own,
      canApprove: r.status === 'in_review' && mayApprove && !blocked, canPublish: r.status === 'approved' && can(role, src.perm.publish as never), blocked,
    });
  };
  for (const s of RECORDS) {
    if (!can(role, s.perm.read as never)) continue;
    const rows = await db.select({ id: s.table.id, title: s.title, status: s.table.status, submittedBy: s.table.submittedBy, updatedAt: s.table.updatedAt, pub: s.table.publishedRevisionId })
      .from(s.table).where(inArray(s.table.status, [...ACTIVE]));
    for (const r of rows) {
      // page_contents rows are the Studio-edited pages (homepage, contact page): each links to its own editor
      const tp = s.type === 'homepage' ? TEXT_PAGES[String(r.title)] : undefined;
      if (tp) push({ ...s, label: tp.label }, { ...r, title: `${tp.label} changes`, live: !!r.pub }, tp.href, tp.api);
      else push(s, { ...r, title: String(r.title ?? ''), live: !!r.pub }, s.href(r.id), s.api(r.id));
    }
  }
  const settings = await db.select().from(t.seoSettings).where(inArray(t.seoSettings.key, SETTINGS.map((x) => x.key)));
  for (const row of settings) {
    const s = SETTINGS.find((x) => x.key === row.key)!;
    if (!can(role, s.perm.read as never) || !(ACTIVE as readonly string[]).includes(row.status)) continue;
    push(s, { id: row.key, title: s.title, status: row.status, submittedBy: row.submittedBy, updatedAt: row.updatedAt, live: !!row.published }, s.href, s.api);
  }
  return items.sort((a, b) => a.at.localeCompare(b.at));   // oldest first: the longest wait comes first
}

// ---------------------------------------------------------------- what changed
type Change = { path: string; before: string | null; after: string | null };
const show = (v: unknown) => (v === null || v === undefined || v === '' ? null : typeof v === 'string' ? v : JSON.stringify(v));
/** Flattens objects into readable paths ("detail.facts.2.1"); arrays of primitives stay as one value. */
function flat(v: unknown, path: string, out: Map<string, unknown>) {
  if (v && typeof v === 'object' && !Array.isArray(v)) { for (const [k, x] of Object.entries(v)) if (!k.startsWith('_') && k !== 'revision') flat(x, path ? `${path}.${k}` : k, out); return; }
  if (Array.isArray(v) && v.some((x) => x && typeof x === 'object')) { v.forEach((x, i) => flat(x, `${path}.${i + 1}`, out)); if (!v.length) out.set(path, []); return; }
  out.set(path, v);
}
export function diff(before: unknown, after: unknown): Change[] {
  const a = new Map<string, unknown>(), b = new Map<string, unknown>();
  flat(before ?? {}, '', a); flat(after ?? {}, '', b);
  const keys = [...new Set([...a.keys(), ...b.keys()])];
  return keys.filter((k) => JSON.stringify(a.get(k) ?? null) !== JSON.stringify(b.get(k) ?? null))
    .map((k) => ({ path: k, before: show(a.get(k))?.slice(0, 4000) ?? null, after: show(b.get(k))?.slice(0, 4000) ?? null }))
    .filter((c) => c.before !== c.after)
    // a field that is empty on both sides is not a change worth reading ([] or false or {} where nothing was before)
    .filter((c) => !(c.before === null && (c.after === null || c.after === '[]' || c.after === '{}' || c.after === 'false')))
    .slice(0, 200);
}

export async function itemDiff(db: DB, role: Role, type: string, id: string) {
  const rec = RECORDS.find((x) => x.type === type);
  if (rec) {
    if (!can(role, rec.perm.read as never)) throw new AppError(404, 'Not found.');
    const [row] = await db.select({ pub: rec.table.publishedRevisionId }).from(rec.table).where(eq(rec.table.id, id));
    if (!row) throw new AppError(404, 'Not found.');
    const [latest] = await db.select().from(rec.rev).where(eq(rec.rev[rec.revFk], id)).orderBy(desc(rec.rev.number)).limit(1);
    const [live] = row.pub ? await db.select().from(rec.rev).where(and(eq(rec.rev.id, row.pub), eq(rec.rev[rec.revFk], id))) : [];
    if (!latest) return { kind: 'new', changes: [], note: 'No submitted version yet.' };
    if (live && live.id === latest.id) return { kind: 'same', changes: [], note: 'The submitted version is the one on the website.' };
    return { kind: live ? 'changed' : 'new', changes: diff(live?.snapshot ?? null, latest.snapshot), submitted: { number: latest.number, at: latest.createdAt }, live: live ? { number: live.number, at: live.createdAt } : null };
  }
  const set = SETTINGS.find((x) => x.type === type && x.key === id);
  if (!set) throw new AppError(404, 'Unknown item.');
  if (!can(role, set.perm.read as never)) throw new AppError(404, 'Not found.');
  const [row] = await db.select().from(t.seoSettings).where(eq(t.seoSettings.key, id));
  if (!row) throw new AppError(404, 'Not found.');
  return { kind: row.published ? 'changed' : 'new', changes: diff(row.published, row.draft) };
}
