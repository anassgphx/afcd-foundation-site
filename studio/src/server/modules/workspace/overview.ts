// Dashboard overview: one read across every module, filtered by the user's permissions. Only real counts and records.
import { and, count, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { articles, events, formSubmissions, media, opportunities, pageContents, pages, partners, projects, publishJobs, seoAudits } from '../../db/schema.ts';
import { can, type Role } from '../../rbac.ts';
import { todayMorocco } from '../events/render.ts';
import { notifications } from './service.ts';

type Mod = { key: string; label: string; href: string; icon: string; live: number; drafts: number; review: number; note?: string };
type Recent = { kind: string; title: string; status: string; live: boolean; href: string; at: string };

const JOB_LABEL: Record<string, string> = {
  publish_project: 'Published a project', unpublish_project: 'Removed a project', publish_page: 'Published a page', unpublish_page: 'Removed a page',
  publish_article: 'Published a story', publish_article_scheduled: 'Published a scheduled story', unpublish_article: 'Removed a story',
  publish_partner: 'Published a partner', unpublish_partner: 'Removed a partner', publish_event: 'Published an event', unpublish_event: 'Removed an event',
  publish_opportunity: 'Published an opportunity', unpublish_opportunity: 'Removed an opportunity', publish_seo: 'Published SEO settings', unpublish_seo: 'Restored a page’s own SEO',
  publish_home: 'Published the homepage', unpublish_home: 'Restored the original homepage', rebuild: 'Rebuilt the website',
};

export async function overview(db: DB, user: { id: string; role: Role }) {
  const role = user.role; const today = todayMorocco();
  const statusCounts = async (table: typeof projects | typeof articles | typeof events | typeof opportunities | typeof partners | typeof pages) => {
    const t = table as typeof projects;
    const rows = await db.select({ status: t.status, live: sql<boolean>`${t.publishedRevisionId} is not null`, n: count() }).from(t).groupBy(t.status, sql`${t.publishedRevisionId} is not null`);
    const sum = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).reduce((a, r) => a + r.n, 0);
    return { live: sum((r) => r.live), drafts: sum((r) => ['draft', 'changes_requested'].includes(r.status) && !r.live), review: sum((r) => ['in_review', 'approved'].includes(r.status)) };
  };
  const modules: Mod[] = [];
  if (can(role, 'project.read')) modules.push({ key: 'projects', label: 'Projects', href: '/studio/projects', icon: 'folder', ...(await statusCounts(projects)) });
  if (can(role, 'news.read')) {
    const [{ n }] = await db.select({ n: count() }).from(articles).where(eq(articles.status, 'scheduled'));
    modules.push({ key: 'news', label: 'Stories', href: '/studio/news', icon: 'log', ...(await statusCounts(articles)), note: n ? `${n} scheduled` : undefined });
  }
  if (can(role, 'event.read')) {
    const [{ n }] = await db.select({ n: count() }).from(events).where(and(isNotNull(events.publishedRevisionId), sql`coalesce(${events.endDate}, ${events.startDate}) >= ${today}`));
    modules.push({ key: 'events', label: 'Events', href: '/studio/events', icon: 'calendar', ...(await statusCounts(events)), note: `${n} upcoming on the site` });
  }
  if (can(role, 'opportunity.read')) {
    const [{ n }] = await db.select({ n: count() }).from(opportunities).where(and(isNotNull(opportunities.publishedRevisionId), sql`(${opportunities.deadline} is null or ${opportunities.deadline} >= ${today})`, sql`(${opportunities.opensOn} is null or ${opportunities.opensOn} <= ${today})`));
    modules.push({ key: 'opportunities', label: 'Opportunities', href: '/studio/opportunities', icon: 'spark', ...(await statusCounts(opportunities)), note: `${n} open now` });
  }
  if (can(role, 'partner.read')) modules.push({ key: 'partners', label: 'Partners', href: '/studio/partners', icon: 'partner', ...(await statusCounts(partners)) });
  if (can(role, 'page.read')) modules.push({ key: 'pages', label: 'Custom pages', href: '/studio/pages', icon: 'layers', ...(await statusCounts(pages)) });

  // recently edited, across modules (archived left out)
  const recent: Recent[] = [];
  const take = async <T extends { id: string; title: string; status: string; live: boolean; at: Date }>(kind: string, href: (id: string) => string, rows: Promise<T[]>) => { for (const r of await rows) recent.push({ kind, title: r.title, status: r.status, live: r.live, href: href(r.id), at: r.at.toISOString() }); };
  const q = (tbl: unknown, title: typeof projects.name) => { const t = tbl as typeof projects; return db.select({ id: t.id, title, status: t.status, live: sql<boolean>`${t.publishedRevisionId} is not null`, at: t.updatedAt }).from(t).where(ne(t.status, 'archived')).orderBy(desc(t.updatedAt)).limit(6); };
  if (can(role, 'project.read')) await take('Project', (id) => `/studio/projects/${id}`, q(projects, projects.name));
  if (can(role, 'news.read')) await take('Story', (id) => `/studio/news/${id}`, q(articles as never, articles.title as never));
  if (can(role, 'event.read')) await take('Event', (id) => `/studio/events/${id}`, q(events as never, events.title as never));
  if (can(role, 'opportunity.read')) await take('Opportunity', (id) => `/studio/opportunities/${id}`, q(opportunities as never, opportunities.title as never));
  if (can(role, 'partner.read')) await take('Partner', (id) => `/studio/partners/${id}`, q(partners as never, partners.name as never));
  if (can(role, 'page.read')) {
    await take('Page', (id) => `/studio/pages/${id}`, q(pages as never, pages.title as never));
    for (const c of await db.select().from(pageContents)) if (c.publishedRevisionId || Object.keys(c.values ?? {}).length || c.layout) recent.push({ kind: 'Homepage', title: 'Homepage', status: c.status, live: !!c.publishedRevisionId, href: '/studio/home', at: c.updatedAt.toISOString() });
  }
  recent.sort((a, b) => b.at.localeCompare(a.at));

  // coming up: scheduled stories, events in the next 45 days, deadlines in the next 30 days
  const soon = new Date(Date.parse(`${today}T12:00:00Z`) + 45 * 864e5).toISOString().slice(0, 10);
  const soon30 = new Date(Date.parse(`${today}T12:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10);
  const upcoming: { kind: string; title: string; date: string; href: string; label: string }[] = [];
  if (can(role, 'news.read')) for (const a of await db.select({ id: articles.id, title: articles.title, at: articles.scheduledAt }).from(articles).where(and(eq(articles.status, 'scheduled'), isNotNull(articles.scheduledAt))).limit(10)) upcoming.push({ kind: 'Story', title: a.title, date: a.at!.toISOString(), href: `/studio/news/${a.id}`, label: 'Publishes automatically' });
  if (can(role, 'event.read')) for (const e of await db.select({ id: events.id, title: events.title, d: events.startDate, live: sql<boolean>`${events.publishedRevisionId} is not null` }).from(events).where(and(ne(events.status, 'archived'), gte(events.startDate, today), lte(events.startDate, soon))).limit(10)) upcoming.push({ kind: 'Event', title: e.title, date: e.d, href: `/studio/events/${e.id}`, label: e.live ? 'Event day' : 'Event day · not published yet' });
  if (can(role, 'opportunity.read')) for (const o of await db.select({ id: opportunities.id, title: opportunities.title, d: opportunities.deadline }).from(opportunities).where(and(isNotNull(opportunities.publishedRevisionId), gte(opportunities.deadline, today), lte(opportunities.deadline, soon30))).limit(10)) upcoming.push({ kind: 'Opportunity', title: o.title, date: o.d!, href: `/studio/opportunities/${o.id}`, label: 'Applications close' });
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  // website health
  const health: { key: string; label: string; value: string; tone: 'ok' | 'warn' | 'bad'; href: string; detail: string }[] = [];
  if (can(role, 'dashboard.read')) {
    const [lastOk] = await db.select({ at: publishJobs.finishedAt }).from(publishJobs).where(eq(publishJobs.status, 'succeeded')).orderBy(desc(publishJobs.finishedAt)).limit(1);
    const [{ failed }] = await db.select({ failed: count() }).from(publishJobs).where(and(eq(publishJobs.status, 'failed'), gte(publishJobs.createdAt, new Date(Date.now() - 864e5))));
    health.push({ key: 'delivery', label: 'Publishing', value: failed ? `${failed} failed` : 'Working', tone: failed ? 'bad' : 'ok', href: '/studio/publishing', detail: failed ? 'In the last 24 hours. Open Publishing for details.' : lastOk?.at ? `Last update delivered ${lastOk.at.toISOString()}` : 'No delivery yet' });
  }
  if (can(role, 'seo.read')) {
    const [a] = await db.select().from(seoAudits).orderBy(desc(seoAudits.createdAt)).limit(1);
    const r = a?.result as { score: number; counts: { errors: number; warnings: number } } | undefined;
    health.push({ key: 'seo', label: 'SEO', value: r ? `${r.score}/100` : 'Not checked', tone: !r ? 'warn' : r.counts.errors ? 'bad' : r.score >= 90 ? 'ok' : 'warn', href: '/studio/seo', detail: r ? `${r.counts.errors} errors, ${r.counts.warnings} warnings · checked ${a!.createdAt.toISOString()}` : 'Run the site audit' });
  }
  if (can(role, 'media.read')) {
    const [{ total }] = await db.select({ total: count() }).from(media);
    const [{ need }] = await db.select({ need: count() }).from(media).where(sql`not ${media.rightsConfirmed} or ${media.alt} = ''`);
    health.push({ key: 'media', label: 'Media', value: need ? `${need} to fix` : `${total} ready`, tone: need ? 'warn' : 'ok', href: '/studio/media', detail: need ? 'Need alt text or confirmed usage rights before they can be published.' : `${total} images, all with alt text and rights` });
  }
  if (can(role, 'forms.read')) {
    const [{ n }] = await db.select({ n: count() }).from(formSubmissions).where(and(eq(formSubmissions.formKey, 'contact'), eq(formSubmissions.status, 'new')));
    health.push({ key: 'forms', label: 'Messages', value: n ? `${n} new` : 'None new', tone: n ? 'warn' : 'ok', href: '/studio/forms', detail: n ? 'From the website contact form, waiting for a reply.' : 'Contact form inbox is clear' });
  }

  // website delivery, in plain words, with what it was about
  const jobs = can(role, 'dashboard.read') ? await db.select({ id: publishJobs.id, kind: publishJobs.kind, status: publishJobs.status, entityId: publishJobs.entityId, at: publishJobs.createdAt, error: publishJobs.error }).from(publishJobs).orderBy(desc(publishJobs.createdAt)).limit(6) : [];
  const ids = jobs.map((j) => j.entityId).filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    for (const [t, col] of [[projects, projects.name], [articles, articles.title], [events, events.title], [opportunities, opportunities.title], [partners, partners.name], [pages, pages.title]] as const) {
      for (const r of await db.select({ id: (t as typeof projects).id, n: col as typeof projects.name }).from(t as typeof projects).where(inArray((t as typeof projects).id, ids))) names.set(r.id, r.n);
    }
  }
  const delivery = jobs.map((j) => ({ id: j.id, label: JOB_LABEL[j.kind] ?? j.kind.replace(/_/g, ' '), what: (j.entityId && names.get(j.entityId)) || '', status: j.status, at: j.at.toISOString(), error: j.error }));

  const decisions = (await notifications(db, user)).filter((n) => n.kind !== 'forms').slice(0, 8);
  return { modules, recent: recent.slice(0, 8), upcoming: upcoming.slice(0, 8), health, delivery, decisions, today };
}
