// Live content for blocks: published stories, events, opportunities and partners, read from their published revisions.
// `pending` applies a publish or removal that is in progress, so a page rebuilt during that delivery already shows it.
// Self-contained on purpose (no imports from the module renderers) to keep the dependency graph acyclic.
import { inArray, isNotNull } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { articles, articleRevisions, events, eventRevisions, media, opportunities, opportunityRevisions, partners, partnerRevisions, pillars } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import type { MediaRef } from './blocks.ts';

export type Pending = { article?: { articleId: string; revisionId: string | null }; event?: { eventId: string; revisionId: string | null }; opportunity?: { opportunityId: string; revisionId: string | null }; partner?: { partnerId: string; revisionId: string | null } };
export type StoryCard = { title: string; url: string; type: string; typeKey: string; pillar: string; pillarKey: string; colour: string; date: string; dateLabel: string; hero: MediaRef | null; excerpt: string };
export type EventCard = { title: string; file: string; start: string; end: string | null; upcoming: boolean; kind: string; where: string; time: string; pillarKey: string; colour: string; poster: MediaRef | null };
export type OppCard = { title: string; file: string; type: string; typeKey: string; state: 'open' | 'soon' | 'closed'; deadline: string | null; opensOn: string | null; location: string; pillarKey: string };
export type PartnerCard = { name: string; scope: string; scopeKey: string; logo: MediaRef | null; url: string | null };
export type Sources = { stories: StoryCard[]; events: EventCard[]; opportunities: OppCard[]; partners: PartnerCard[]; today: string };

const STORY_TYPE: Record<string, string> = { programme_news: 'Programme news', participant_story: 'Participant story', call_for_applications: 'Call for applications', event_recap: 'Event recap' };
const OPP_TYPE: Record<string, string> = { call_for_applications: 'Call for applications', volunteering: 'Volunteering', job: 'Job', internship: 'Internship', consultancy: 'Consultancy', call_for_partners: 'Call for partners' };
const SCOPE: Record<string, string> = { international: 'International', national: 'National', local: 'Local' };
export const todayMa = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Casablanca', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export const longDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

async function live<S>(db: DB, table: typeof articles, revs: typeof articleRevisions, pending?: { id: string; revisionId: string | null }) {
  const rows = await db.select({ id: table.id, rev: table.publishedRevisionId }).from(table).where(isNotNull(table.publishedRevisionId));
  const map = new Map(rows.map((r) => [r.id, r.rev as string]));
  if (pending) { if (pending.revisionId) map.set(pending.id, pending.revisionId); else map.delete(pending.id); }
  if (!map.size) return [] as S[];
  return (await db.select().from(revs).where(inArray(revs.id, [...map.values()]))).map((r) => r.snapshot as unknown as S);
}

export async function loadSources(db: DB, pending: Pending = {}, mediaPrefix = 'assets/media/'): Promise<Sources> {
  const today = todayMa();
  type A = { slug: string; title: string; excerpt: string; type: string; publishDate: string; heroMediaId: string | null; pillarKeys: string[] };
  type E = { slug: string; title: string; kind: string; startDate: string; endDate: string | null; timeLabel: string; location: string; online: boolean; pillarKey: string | null; posterMediaId: string | null };
  type O = { slug: string; title: string; type: string; opensOn: string | null; deadline: string | null; location: string; pillarKey: string | null };
  type P = { name: string; scope: string; logoMediaId: string | null; websiteUrl: string; sort: number };
  const [as, es, os, ps] = await Promise.all([
    live<A>(db, articles, articleRevisions, pending.article && { id: pending.article.articleId, revisionId: pending.article.revisionId }),
    live<E>(db, events as never, eventRevisions as never, pending.event && { id: pending.event.eventId, revisionId: pending.event.revisionId }),
    live<O>(db, opportunities as never, opportunityRevisions as never, pending.opportunity && { id: pending.opportunity.opportunityId, revisionId: pending.opportunity.revisionId }),
    live<P>(db, partners as never, partnerRevisions as never, pending.partner && { id: pending.partner.partnerId, revisionId: pending.partner.revisionId }),
  ]);
  const ids = [...new Set([...as.map((a) => a.heroMediaId), ...es.map((e) => e.posterMediaId), ...ps.map((p) => p.logoMediaId)].filter(Boolean) as string[])];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const ref = new Map(rows.map((m) => [m.id, publicRef(m, mediaPrefix) as MediaRef]));
  const pl = await db.select().from(pillars);
  const pillar = (k: string | null | undefined) => pl.find((p) => p.key === k);
  const stories: StoryCard[] = as.map((a) => ({ title: a.title, url: `news-${a.slug}.html`, type: STORY_TYPE[a.type] ?? 'Programme news', typeKey: a.type, pillar: pillar(a.pillarKeys?.[0])?.name ?? '', pillarKey: a.pillarKeys?.[0] ?? '', colour: pillar(a.pillarKeys?.[0])?.colour ?? '#D4D4D4',
    date: a.publishDate, dateLabel: longDate(a.publishDate), hero: a.heroMediaId ? ref.get(a.heroMediaId) ?? null : null, excerpt: a.excerpt })).sort((x, y) => y.date.localeCompare(x.date));
  const eventsOut: EventCard[] = es.map((e) => ({ title: e.title, file: `event-${e.slug}.html`, start: e.startDate, end: e.endDate, upcoming: (e.endDate ?? e.startDate) >= today, kind: e.kind,
    where: e.online ? (e.location ? `${e.location} · Online` : 'Online') : e.location, time: e.timeLabel, pillarKey: e.pillarKey ?? '', colour: pillar(e.pillarKey)?.colour ?? '#D4D4D4', poster: e.posterMediaId ? ref.get(e.posterMediaId) ?? null : null }))
    .sort((x, y) => x.start.localeCompare(y.start));
  const opps: OppCard[] = os.map((o) => ({ title: o.title, file: `opportunity-${o.slug}.html`, type: OPP_TYPE[o.type] ?? o.type, typeKey: o.type, deadline: o.deadline, opensOn: o.opensOn, location: o.location, pillarKey: o.pillarKey ?? '',
    state: (o.deadline && o.deadline < today ? 'closed' : o.opensOn && o.opensOn > today ? 'soon' : 'open') as OppCard['state'] })).sort((x, y) => (x.deadline ?? '9999').localeCompare(y.deadline ?? '9999'));
  const partnersOut: PartnerCard[] = ps.sort((x, y) => x.sort - y.sort || x.name.localeCompare(y.name)).map((p) => ({ name: p.name, scope: SCOPE[p.scope] ?? p.scope, scopeKey: p.scope, logo: p.logoMediaId ? ref.get(p.logoMediaId) ?? null : null, url: p.websiteUrl || null }));
  return { stories, events: eventsOut, opportunities: opps, partners: partnersOut, today };
}
