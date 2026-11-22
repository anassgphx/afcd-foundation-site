// Partner data for the public site. src/content.py reads src/data/partners.json (see the Studio loader next to PARTNERS).
// Every string is HTML-escaped here, because the generator inserts the values as-is.
import { inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { media } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc, type MediaRef, type ProjectCard } from '../pages/blocks.ts';
import { buildCtx } from '../pages/render.ts';
import { SCOPE_LABEL, type PartnerSnapshot } from './service.ts';

export async function partnerEntries(db: DB, live: { id: string; snap: PartnerSnapshot }[], opts: { projectOverride?: { projectId: string; revisionId: string | null } } = {}) {
  const ids = [...new Set(live.map((x) => x.snap.logoMediaId).filter(Boolean) as string[])];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const byId = new Map(rows.map((m) => [m.id, publicRef(m, 'assets/media/') as MediaRef]));
  const projects = (await buildCtx(db, [], { projectOverride: opts.projectOverride })).projects as ProjectCard[];
  return live
    .sort((a, b) => a.snap.sort - b.snap.sort || a.snap.name.localeCompare(b.snap.name))
    .map(({ id, snap: s }) => ({
      name: esc(s.name), slug: s.slug, scope: SCOPE_LABEL[s.scope], category: esc(s.category), description: esc(s.description),
      url: s.websiteUrl ? esc(s.websiteUrl) : null, logo: s.logoMediaId ? byId.get(s.logoMediaId) ?? null : null,
      since: s.sinceYear, current: s.current, revision: id,
      // only projects that are live on the site are linked
      projects: s.projectSlugs.map((sl) => projects.find((p) => p.slug === sl)).filter(Boolean).map((p) => ({ name: esc(p!.name), file: p!.file })),
    }));
}
export type PartnerEntry = Awaited<ReturnType<typeof partnerEntries>>[number];
