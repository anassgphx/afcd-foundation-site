// Top-bar workspace features: search across Studio records, and notifications computed from real state
// (nothing is stored). Every query is filtered by the signed-in user's permissions; form messages are never searched.
import { and, count, desc, eq, gte, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { articles, events, formSubmissions, opportunities, pageContents, pages, partners, projects, publishJobs, seoOverrides } from '../../db/schema.ts';
import { can, type Role } from '../../rbac.ts';

export type Hit = { kind: string; id: string; title: string; sub: string; href: string; status: string };
const LIMIT = 6;

/** Searches titles and addresses. `q` is matched literally (LIKE wildcards escaped). */
export async function search(db: DB, role: Role, raw: string): Promise<Hit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const pat = `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  const out: Hit[] = [];
  if (can(role, 'project.read')) for (const r of await db.select({ id: projects.id, t: projects.name, s: projects.category, st: projects.status }).from(projects).where(or(ilike(projects.name, pat), ilike(projects.slug, pat))).limit(LIMIT)) out.push({ kind: 'Project', id: r.id, title: r.t, sub: r.s, href: `/studio/projects/${r.id}`, status: r.st });
  if (can(role, 'news.read')) for (const r of await db.select({ id: articles.id, t: articles.title, s: articles.publishDate, st: articles.status }).from(articles).where(or(ilike(articles.title, pat), ilike(articles.slug, pat))).limit(LIMIT)) out.push({ kind: 'Story', id: r.id, title: r.t, sub: r.s, href: `/studio/news/${r.id}`, status: r.st });
  if (can(role, 'event.read')) for (const r of await db.select({ id: events.id, t: events.title, s: events.startDate, st: events.status }).from(events).where(or(ilike(events.title, pat), ilike(events.location, pat))).limit(LIMIT)) out.push({ kind: 'Event', id: r.id, title: r.t, sub: r.s, href: `/studio/events/${r.id}`, status: r.st });
  if (can(role, 'opportunity.read')) for (const r of await db.select({ id: opportunities.id, t: opportunities.title, s: opportunities.deadline, st: opportunities.status }).from(opportunities).where(ilike(opportunities.title, pat)).limit(LIMIT)) out.push({ kind: 'Opportunity', id: r.id, title: r.t, sub: r.s ? `Deadline ${r.s}` : 'Rolling', href: `/studio/opportunities/${r.id}`, status: r.st });
  if (can(role, 'partner.read')) for (const r of await db.select({ id: partners.id, t: partners.name, s: partners.scope, st: partners.status }).from(partners).where(ilike(partners.name, pat)).limit(LIMIT)) out.push({ kind: 'Partner', id: r.id, title: r.t, sub: r.s, href: `/studio/partners/${r.id}`, status: r.st });
  if (can(role, 'page.read')) for (const r of await db.select({ id: pages.id, t: pages.title, s: pages.slug, st: pages.status }).from(pages).where(or(ilike(pages.title, pat), ilike(pages.slug, pat))).limit(LIMIT)) out.push({ kind: 'Page', id: r.id, title: r.t, sub: `${r.s}.html`, href: `/studio/pages/${r.id}`, status: r.st });
  return out;
}

export type Note = { id: string; kind: 'review' | 'publish' | 'changes' | 'failed' | 'forms'; title: string; sub: string; href: string; at: string };

/** What needs this person's attention now. */
export async function notifications(db: DB, user: { id: string; role: Role }): Promise<Note[]> {
  const notes: Note[] = [];
  const role = user.role;
  type Src = { kind: string; perm: { approve: string; publish: string; read: string }; rows: () => Promise<{ id: string; title: string; status: string; submittedBy: string | null; updatedAt: Date }[]>; href: (id: string) => string };
  const sources: Src[] = [
    { kind: 'Project', perm: { read: 'project.read', approve: 'project.approve', publish: 'project.publish' }, href: (id) => `/studio/projects/${id}`,
      rows: () => db.select({ id: projects.id, title: projects.name, status: projects.status, submittedBy: projects.submittedBy, updatedAt: projects.updatedAt }).from(projects).where(inArray(projects.status, ['in_review', 'approved', 'changes_requested'])) },
    { kind: 'Story', perm: { read: 'news.read', approve: 'news.approve', publish: 'news.publish' }, href: (id) => `/studio/news/${id}`,
      rows: () => db.select({ id: articles.id, title: articles.title, status: articles.status, submittedBy: articles.submittedBy, updatedAt: articles.updatedAt }).from(articles).where(inArray(articles.status, ['in_review', 'approved', 'changes_requested'])) },
    { kind: 'Page', perm: { read: 'page.read', approve: 'page.approve', publish: 'page.publish' }, href: (id) => `/studio/pages/${id}`,
      rows: () => db.select({ id: pages.id, title: pages.title, status: pages.status, submittedBy: pages.submittedBy, updatedAt: pages.updatedAt }).from(pages).where(inArray(pages.status, ['in_review', 'approved', 'changes_requested'])) },
    { kind: 'Homepage', perm: { read: 'page.read', approve: 'page.approve', publish: 'page.publish' }, href: () => '/studio/home',
      rows: () => db.select({ id: pageContents.id, title: sql<string>`'Homepage changes'`, status: pageContents.status, submittedBy: pageContents.submittedBy, updatedAt: pageContents.updatedAt }).from(pageContents).where(inArray(pageContents.status, ['in_review', 'approved', 'changes_requested'])) },
    { kind: 'Event', perm: { read: 'event.read', approve: 'event.approve', publish: 'event.publish' }, href: (id) => `/studio/events/${id}`,
      rows: () => db.select({ id: events.id, title: events.title, status: events.status, submittedBy: events.submittedBy, updatedAt: events.updatedAt }).from(events).where(inArray(events.status, ['in_review', 'approved', 'changes_requested'])) },
    { kind: 'Opportunity', perm: { read: 'opportunity.read', approve: 'opportunity.approve', publish: 'opportunity.publish' }, href: (id) => `/studio/opportunities/${id}`,
      rows: () => db.select({ id: opportunities.id, title: opportunities.title, status: opportunities.status, submittedBy: opportunities.submittedBy, updatedAt: opportunities.updatedAt }).from(opportunities).where(inArray(opportunities.status, ['in_review', 'approved', 'changes_requested'])) },
    { kind: 'Partner', perm: { read: 'partner.read', approve: 'partner.approve', publish: 'partner.publish' }, href: (id) => `/studio/partners/${id}`,
      rows: () => db.select({ id: partners.id, title: partners.name, status: partners.status, submittedBy: partners.submittedBy, updatedAt: partners.updatedAt }).from(partners).where(inArray(partners.status, ['in_review', 'approved', 'changes_requested'])) },
    { kind: 'SEO settings', perm: { read: 'seo.read', approve: 'seo.approve', publish: 'seo.publish' }, href: (_id) => '/studio/seo/pages',
      rows: () => db.select({ id: seoOverrides.id, title: seoOverrides.file, status: seoOverrides.status, submittedBy: seoOverrides.submittedBy, updatedAt: seoOverrides.updatedAt }).from(seoOverrides).where(inArray(seoOverrides.status, ['in_review', 'approved', 'changes_requested'])) },
  ];
  for (const s of sources) {
    if (!can(role, s.perm.read as never)) continue;
    for (const r of await s.rows()) {
      const base = { title: `${s.kind}: ${r.title}`, href: s.href(r.id), at: r.updatedAt.toISOString() };
      if (r.status === 'in_review' && can(role, s.perm.approve as never) && (r.submittedBy !== user.id || role === 'super_admin')) notes.push({ id: `rev:${r.id}:${base.at}`, kind: 'review', sub: 'Waiting for your review', ...base });
      if (r.status === 'approved' && can(role, s.perm.publish as never)) notes.push({ id: `pub:${r.id}:${base.at}`, kind: 'publish', sub: 'Approved, ready to publish', ...base });
      if (r.status === 'changes_requested' && r.submittedBy === user.id) notes.push({ id: `chg:${r.id}:${base.at}`, kind: 'changes', sub: 'Changes requested on your submission', ...base });
    }
  }
  if (can(role, 'dashboard.read')) {
    for (const j of await db.select({ id: publishJobs.id, kind: publishJobs.kind, error: publishJobs.error, at: publishJobs.createdAt }).from(publishJobs).where(and(eq(publishJobs.status, 'failed'), gte(publishJobs.createdAt, new Date(Date.now() - 3 * 864e5)))).orderBy(desc(publishJobs.createdAt)).limit(5)) {
      notes.push({ id: `job:${j.id}`, kind: 'failed', title: `Publishing failed (${j.kind.replace(/_/g, ' ')})`, sub: (j.error ?? 'See the Publishing page.').slice(0, 140), href: '/studio/publishing', at: j.at.toISOString() });
    }
  }
  if (can(role, 'forms.read')) {
    // unread contact messages in the Inbox (spam and archived ones never notify)
    const [{ n, last }] = await db.select({ n: count(), last: sql<Date | null>`max(${formSubmissions.createdAt})` }).from(formSubmissions).where(and(eq(formSubmissions.formKey, 'contact'), eq(formSubmissions.spam, false), isNull(formSubmissions.archivedAt), isNull(formSubmissions.readAt)));
    if (n) notes.push({ id: `forms:${n}:${new Date(last ?? Date.now()).toISOString()}`, kind: 'forms', title: `${n} unread message${n === 1 ? '' : 's'} in the Inbox`, sub: 'From the website contact form', href: '/studio/inbox?view=unread', at: new Date(last ?? Date.now()).toISOString() });
  }
  return notes.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30);
}

