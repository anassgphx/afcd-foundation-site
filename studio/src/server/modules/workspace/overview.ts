// Dashboard overview: one read across every module, filtered by the user's permissions. Only real counts and records.
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lte, ne, sql } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import type { Config } from '../../config.ts';
import { articles, events, formSubmissions, media, opportunities, publications, pageContents, pages, partners, pillars, projects, publishJobs, seoAudits, teamMembers } from '../../db/schema.ts';
import { can, type Role } from '../../rbac.ts';
import { TEXT_PAGES } from '../home/service.ts';
import { todayMorocco } from '../events/render.ts';
import { notifications, openFailures } from './service.ts';
import { recentPublicState, type PublicState } from '../publish/public-check.ts';
import { details as healthDetails } from '../health/service.ts';

type Mod = { key: string; label: string; href: string; icon: string; live: number; drafts: number; review: number; note?: string; scheduled?: number };
type Recent = { kind: string; title: string; status: string; live: boolean; href: string; at: string };

const JOB_LABEL: Record<string, string> = {
  publish_project: 'Published a project', unpublish_project: 'Removed a project', publish_page: 'Published a page', unpublish_page: 'Removed a page',
  publish_article: 'Published a story', publish_article_scheduled: 'Published a scheduled story', unpublish_article: 'Removed a story',
  publish_partner: 'Published a partner', publish_pillar: 'Published a pillar', unpublish_partner: 'Removed a partner', publish_event: 'Published an event', unpublish_event: 'Removed an event',
  publish_opportunity: 'Published an opportunity', unpublish_opportunity: 'Removed an opportunity', publish_publication: 'Published a publication', unpublish_publication: 'Removed a publication', publish_seo: 'Published SEO settings', unpublish_seo: 'Restored a page’s own SEO',
  publish_home: 'Published the homepage', unpublish_home: 'Restored the original homepage', rebuild: 'Rebuilt the website',
  publish_redirects: 'Published redirects', publish_seo_schema: 'Published structured data', unpublish_seo_schema: 'Removed structured data',
  publish_translations: 'Published translations',
  publish_team: 'Published a team member', unpublish_team: 'Removed a team member', hide_team: 'Hid a team member', show_team: 'Showed a team member', publish_team_layout: 'Published the team order and groups',
};

export async function overview(db: DB, user: { id: string; role: Role }, cfg?: Config) {
  const role = user.role; const today = todayMorocco();
  const statusCounts = async (table: typeof projects | typeof articles | typeof events | typeof opportunities | typeof publications | typeof partners | typeof pages | typeof pillars | typeof teamMembers) => {
    const t = table as typeof projects;
    const rows = await db.select({ status: t.status, live: sql<boolean>`${t.publishedRevisionId} is not null`, n: count() }).from(t).groupBy(t.status, sql`${t.publishedRevisionId} is not null`);
    const sum = (f: (r: typeof rows[number]) => boolean) => rows.filter(f).reduce((a, r) => a + r.n, 0);
    return { live: sum((r) => r.live), drafts: sum((r) => ['draft', 'changes_requested'].includes(r.status) && !r.live), review: sum((r) => ['in_review', 'approved'].includes(r.status)) };
  };
  const modules: Mod[] = [];
  if (can(role, 'project.read')) modules.push({ key: 'projects', label: 'Projects', href: '/studio/projects', icon: 'folder', ...(await statusCounts(projects)) });
  if (can(role, 'news.read')) {
    const [{ n }] = await db.select({ n: count() }).from(articles).where(eq(articles.status, 'scheduled'));
    modules.push({ key: 'news', label: 'Stories', href: '/studio/news', icon: 'log', ...(await statusCounts(articles)), note: n ? `${n} scheduled` : undefined, scheduled: n });
  }
  if (can(role, 'event.read')) {
    const [{ n }] = await db.select({ n: count() }).from(events).where(and(isNotNull(events.publishedRevisionId), sql`coalesce(${events.endDate}, ${events.startDate}) >= ${today}`));
    modules.push({ key: 'events', label: 'Events', href: '/studio/events', icon: 'calendar', ...(await statusCounts(events)), note: `${n} upcoming on the site` });
  }
  if (can(role, 'opportunity.read')) {
    const [{ n }] = await db.select({ n: count() }).from(opportunities).where(and(isNotNull(opportunities.publishedRevisionId), sql`(${opportunities.deadline} is null or ${opportunities.deadline} >= ${today})`, sql`(${opportunities.opensOn} is null or ${opportunities.opensOn} <= ${today})`));
    modules.push({ key: 'opportunities', label: 'Opportunities', href: '/studio/opportunities', icon: 'spark', ...(await statusCounts(opportunities)), note: `${n} open now` });
  }
  if (can(role, 'publication.read')) modules.push({ key: 'publications', label: 'Publications', href: '/studio/publications', icon: 'book', ...(await statusCounts(publications)) });
  if (can(role, 'pillar.read')) modules.push({ key: 'pillars', label: 'Pillars', href: '/studio/pillars', icon: 'pillars', ...(await statusCounts(pillars)) });
  if (can(role, 'partner.read')) modules.push({ key: 'partners', label: 'Partners', href: '/studio/partners', icon: 'partner', ...(await statusCounts(partners)) });
  if (can(role, 'team.read')) modules.push({ key: 'team', label: 'Team', href: '/studio/team', icon: 'users', ...(await statusCounts(teamMembers)) });
  if (can(role, 'page.read')) modules.push({ key: 'pages', label: 'Custom pages', href: '/studio/pages', icon: 'layers', ...(await statusCounts(pages)) });

  // recently edited, across modules (archived left out)
  const recent: Recent[] = [];
  const take = async <T extends { id: string; title: string; status: string; live: boolean; at: Date }>(kind: string, href: (id: string) => string, rows: Promise<T[]>) => { for (const r of await rows) recent.push({ kind, title: r.title, status: r.status, live: r.live, href: href(r.id), at: r.at.toISOString() }); };
  const q = (tbl: unknown, title: typeof projects.name) => { const t = tbl as typeof projects; return db.select({ id: t.id, title, status: t.status, live: sql<boolean>`${t.publishedRevisionId} is not null`, at: t.updatedAt }).from(t).where(ne(t.status, 'archived')).orderBy(desc(t.updatedAt)).limit(6); };
  if (can(role, 'project.read')) await take('Project', (id) => `/studio/projects/${id}`, q(projects, projects.name));
  if (can(role, 'news.read')) await take('Story', (id) => `/studio/news/${id}`, q(articles as never, articles.title as never));
  if (can(role, 'event.read')) await take('Event', (id) => `/studio/events/${id}`, q(events as never, events.title as never));
  if (can(role, 'opportunity.read')) await take('Opportunity', (id) => `/studio/opportunities/${id}`, q(opportunities as never, opportunities.title as never));
  if (can(role, 'publication.read')) await take('Publication', (id) => `/studio/publications/${id}`, q(publications as never, publications.title as never));
  if (can(role, 'partner.read')) await take('Partner', (id) => `/studio/partners/${id}`, q(partners as never, partners.name as never));
  if (can(role, 'team.read')) await take('Team member', (id) => `/studio/team/${id}`, q(teamMembers as never, teamMembers.name as never));
  if (can(role, 'pillar.read')) await take('Pillar', (id) => `/studio/pillars/${id}`, db.select({ id: pillars.id, title: pillars.name, status: pillars.status, live: sql<boolean>`${pillars.publishedRevisionId} is not null`, at: pillars.updatedAt }).from(pillars).where(isNotNull(pillars.draft)).orderBy(desc(pillars.updatedAt)).limit(6));
  if (can(role, 'page.read')) {
    await take('Page', (id) => `/studio/pages/${id}`, q(pages as never, pages.title as never));
    for (const c of await db.select().from(pageContents)) if (c.publishedRevisionId || Object.keys(c.values ?? {}).length || c.layout) { const p = TEXT_PAGES[c.file]; if (p) recent.push({ kind: p.label, title: p.label, status: c.status, live: !!c.publishedRevisionId, href: p.href, at: c.updatedAt.toISOString() }); }
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
    const failed = (await openFailures(db, 864e5)).length;   // not counting failures a later delivery fixed
    // "Working" needs evidence that visitors get the build, not only that Studio built it (the public copy is synced separately)
    const pub = cfg ? await recentPublicState(cfg) : { checked: false, match: null, error: null };
    const stale = pub.checked && pub.match === false && !!lastOk?.at && Date.now() - lastOk.at.getTime() > 3 * 60_000;
    health.push({ key: 'delivery', label: 'Publishing', value: failed ? `${failed} failed` : stale ? 'Not on the public site' : 'Working', tone: failed || stale ? 'bad' : 'ok', href: '/studio/publishing',
      detail: failed ? 'In the last 24 hours. Open Publishing for details.'
        : stale ? `The last publish was built, but the public site still serves an older version${pub.error ? ` (${pub.error})` : ''}. Check the site sync on the server.`
        : lastOk?.at ? `Last update delivered ${lastOk.at.toISOString()}${pub.checked && pub.match ? ', public site confirmed' : ''}` : 'No delivery yet' });
    // background loops (scheduler, jobs and outbox): shown once the server has registered them (modules/health)
    if (cfg) {
      const h = await healthDetails(db, cfg, { publicCheck: async () => pub as PublicState });
      if (h.loops.length) {
        const bad = h.loops.filter((l) => !l.ok);
        const first = bad[0];
        health.push({ key: 'background', label: 'Background work', value: bad.length ? 'Needs attention' : 'Running', tone: bad.some((l) => l.late) ? 'bad' : bad.length ? 'warn' : 'ok', href: '/studio/publishing',
          detail: first ? (first.late ? `${first.label} has not run since ${first.lastStartedAt ?? 'the server started'}.` : `${first.label}: ${first.lastErrors[0]}`)
            : `Scheduler last ran ${h.loops.find((l) => l.name === 'scheduler')?.lastStartedAt ?? h.loops[0].lastStartedAt ?? 'not yet'}` });
      }
    }
  }
  if (can(role, 'seo.read')) {
    const [a] = await db.select().from(seoAudits).orderBy(desc(seoAudits.createdAt)).limit(1);
    // audits store either { errors, warnings } (site audit) or severity counts (build audit)
    const r = a?.result as { score?: number; scores?: { overall?: number }; counts?: Record<string, number> } | undefined;
    const c = r?.counts ?? {}; const score = r?.score ?? r?.scores?.overall;
    const errors = (c.errors ?? 0) + (c.critical ?? 0) + (c.high ?? 0); const warnings = (c.warnings ?? 0) + (c.medium ?? 0) + (c.low ?? 0);
    const checked = a ? `checked ${a.createdAt.toISOString()}` : '';
    health.push({ key: 'seo', label: 'Technical SEO', value: r && score != null ? `${score}/100` : 'Not checked', tone: !r || score == null ? 'warn' : errors ? 'bad' : score >= 90 ? 'ok' : 'warn', href: '/studio/seo',
      detail: r ? `Studio’s check of titles, links and indexing, not a Google score. ${errors ? `${errors} serious issue${errors === 1 ? '' : 's'}` : 'No serious issues'}${warnings ? `, ${warnings} to improve` : ''} · ${checked}` : 'Run the site audit' });
  }
  if (can(role, 'media.read')) {
    const rows = await db.select({ alt: media.alt, originalName: media.originalName, rightsConfirmed: media.rightsConfirmed }).from(media);
    const total = rows.length, need = rows.filter((m) => !m.rightsConfirmed).length;
    health.push({ key: 'media', label: 'Media', value: need ? `${need} to fix` : `${total} ready`, tone: need ? 'warn' : 'ok', href: '/studio/media', detail: need ? 'Need confirmed usage rights before they can be published.' : `${total} images, all with confirmed rights` });
  }
  if (can(role, 'forms.read')) {
    const [{ n }] = await db.select({ n: count() }).from(formSubmissions).where(and(eq(formSubmissions.formKey, 'contact'), eq(formSubmissions.spam, false), isNull(formSubmissions.archivedAt), isNull(formSubmissions.readAt)));
    health.push({ key: 'forms', label: 'Messages', value: n ? `${n} unread` : 'None unread', tone: n ? 'warn' : 'ok', href: '/studio/inbox', detail: n ? 'From the website contact form, not opened yet.' : 'Inbox is clear' });
  }
  if (cfg && (can(role, 'settings.read') || can(role, 'apply.message'))) {
    // one email server for the whole of Studio (inbox/mail.ts); applicant emails wait in an outbox with retries
    const { email: e } = await healthDetails(db, cfg, { publicCheck: async () => ({ checked: false, built: null, live: null, match: null, error: null, at: '' }) });
    const o = e.outbox;
    health.push({ key: 'email', label: 'Email', value: o.failed ? `${o.failed} not sent` : !e.serverReady ? 'Not set up' : o.queued ? `${o.queued} waiting` : 'Working',
      tone: o.failed ? 'bad' : !e.serverReady ? 'warn' : 'ok', href: '/studio/settings/email',
      detail: o.failed ? 'Emails to applicants that failed after every retry. Open Applications › Messages.'
        : !e.serverReady ? `No email server is set up, so Studio cannot send password resets, Inbox replies or applicant emails${o.queued ? ` (${o.queued} waiting)` : ''}.`
        : o.queued ? 'Being sent now, a few every 10 seconds.' : 'The email server is set up and nothing is waiting.' });
  }

  // website delivery, in plain words, with what it was about
  const jobs = can(role, 'dashboard.read') ? await db.select({ id: publishJobs.id, kind: publishJobs.kind, status: publishJobs.status, entityId: publishJobs.entityId, at: publishJobs.createdAt, error: publishJobs.error }).from(publishJobs).orderBy(desc(publishJobs.createdAt)).limit(6) : [];
  const ids = jobs.map((j) => j.entityId).filter(Boolean) as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    for (const [t, col] of [[projects, projects.name], [articles, articles.title], [events, events.title], [opportunities, opportunities.title], [publications, publications.title], [partners, partners.name], [pillars, pillars.name], [pages, pages.title], [teamMembers, teamMembers.name]] as const) {
      for (const r of await db.select({ id: (t as typeof projects).id, n: col as typeof projects.name }).from(t as typeof projects).where(inArray((t as typeof projects).id, ids))) names.set(r.id, r.n);
    }
  }
  const delivery = jobs.map((j) => ({ id: j.id, label: JOB_LABEL[j.kind] ?? j.kind.replace(/_/g, ' '), what: (j.entityId && names.get(j.entityId)) || '', status: j.status, at: j.at.toISOString(), error: j.error }));

  const all = (await notifications(db, user)).filter((n) => n.kind !== 'forms');
  const decisionCounts = { review: 0, publish: 0, changes: 0, failed: 0 } as Record<string, number>;
  for (const n of all) decisionCounts[n.kind] = (decisionCounts[n.kind] ?? 0) + 1;
  return { modules, recent: recent.slice(0, 8), upcoming: upcoming.slice(0, 8), health, delivery, decisions: all.slice(0, 8), decisionCounts, today };
}
