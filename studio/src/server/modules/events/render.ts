// Event data for the public site. src/content.py reads src/data/events.json (Studio loader next to EVENTS).
// Keys match the site's event templates; every string is HTML-escaped here.
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { articles, articleRevisions, media, pillars } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc, type MediaRef, type ProjectCard } from '../pages/blocks.ts';
import { buildCtx } from '../pages/render.ts';
import { articleBody, articleFile, type ArticleSnapshot } from '../news/render.ts';
import type { EventSnapshot } from './service.ts';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Today in Morocco as YYYY-MM-DD: an event stays "upcoming" until its last day has passed there. */
export const todayMorocco = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const isUpcoming = (s: Pick<EventSnapshot, 'startDate' | 'endDate'>, today = todayMorocco()) => (s.endDate ?? s.startDate) >= today;
export const eventFile = (slug: string) => `event-${slug}.html`;

export async function eventEntries(db: DB, live: { id: string; snap: EventSnapshot }[], opts: { projectOverride?: { projectId: string; revisionId: string | null }; today?: string } = {}) {
  const today = opts.today ?? todayMorocco();
  const ids = [...new Set(live.map((x) => x.snap.posterMediaId).filter(Boolean) as string[])];
  const mrows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const byId = new Map(mrows.map((m) => [m.id, publicRef(m, 'assets/media/') as MediaRef]));
  const projects = (await buildCtx(db, [], { projectOverride: opts.projectOverride })).projects as ProjectCard[];
  const pl = await db.select().from(pillars);
  // recap links: only stories that are live on the site
  const slugs = [...new Set(live.map((x) => x.snap.recapArticleSlug).filter(Boolean) as string[])];
  const recaps = slugs.length ? await db.select({ slug: articles.slug, snap: articleRevisions.snapshot }).from(articles)
    .innerJoin(articleRevisions, eq(articleRevisions.id, articles.publishedRevisionId)).where(and(inArray(articles.slug, slugs), isNotNull(articles.publishedRevisionId))) : [];
  const recapOf = (slug: string | null) => {
    const r = recaps.find((x) => x.slug === slug); if (!r) return null;
    const a = r.snap as unknown as ArticleSnapshot;
    return { title: esc(a.title), url: a.externalUrl ? esc(a.externalUrl) : articleFile(a), external: !!a.externalUrl };
  };
  const entries = live.map(({ id, snap: s }) => {
    const [y, m, d] = s.startDate.split('-');
    const project = s.projectSlug ? projects.find((p) => p.slug === s.projectSlug) : undefined;
    const where = s.online ? (s.location ? `${s.location} · Online` : 'Online') : s.location;
    return {
      slug: s.slug, project: project?.file ?? null, day: d, mon: MON[Number(m) - 1], year: y, iso: s.startDate, endIso: s.endDate,
      kind: esc(s.kind), pillar: s.pillarKey ?? pl[0]?.key ?? '', title: esc(s.title), where: esc(where), time: esc(s.timeLabel), desc: esc(s.summary),
      upcoming: isUpcoming(s, today), online: s.online, sample: false, studio: true, revision: id,
      bodyHtml: articleBody(s.body), agenda: s.agenda.map((a) => ({ title: esc(a.title), text: esc(a.text) })), audience: s.audience.map(esc),
      poster: s.posterMediaId ? byId.get(s.posterMediaId) ?? null : null,
      registration: { mode: s.registration, url: s.registration === 'external' ? esc(s.registrationUrl) : s.registration === 'contact' ? 'contact.html?topic=General+question#message' : null,
        label: s.registration === 'external' ? 'Register' : s.registration === 'contact' ? 'Register interest' : '' },
      recap: recapOf(s.recapArticleSlug),
      seoTitle: esc(s.seoTitle), seoDescription: esc(s.seoDescription),
    };
  });
  // upcoming first (soonest first), then past (most recent first)
  return [...entries.filter((e) => e.upcoming).sort((a, b) => a.iso.localeCompare(b.iso)), ...entries.filter((e) => !e.upcoming).sort((a, b) => b.iso.localeCompare(a.iso))];
}
export type EventEntry = Awaited<ReturnType<typeof eventEntries>>[number];
