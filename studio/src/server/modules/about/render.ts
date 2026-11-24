// About pages for the public site: src/content.py reads src/data/about.json ({pages: {<key>: content}}) and builds
// our-story.html, mission-vision.html, strategy.html, team.html and the texts of partners.html from it. Values go out
// as PLAIN TEXT (the generator escapes them). Media ids become image refs; strategic objectives carry the keys of the
// pillars they belong to (from objective_pillars).
import { eq, inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { media, objectivePillars, objectives, pillars } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { contentMediaIds, type AboutKey, type AboutSnapshot } from './service.ts';

export type LiveAbout = { id: string; snap: AboutSnapshot };

export async function aboutEntries(db: DB, live: LiveAbout[]) {
  const ids = [...new Set(live.flatMap((x) => contentMediaIds(x.snap.key, x.snap)))];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const image = (id: unknown) => {
    const m = typeof id === 'string' ? rows.find((r) => r.id === id) : undefined;
    if (!m) return null;
    const ref = publicRef(m, 'assets/media/');
    return { src: ref.src, srcset: ref.srcset, w: ref.w, h: ref.h, alt: m.alt, fx: m.focalX ?? 50, fy: m.focalY ?? 50 };
  };
  const links = await db.select({ ref: objectives.ref, key: pillars.key }).from(objectivePillars)
    .innerJoin(objectives, eq(objectives.id, objectivePillars.objectiveId)).innerJoin(pillars, eq(pillars.id, objectivePillars.pillarId));
  const pages: Record<string, Record<string, unknown>> = {};
  for (const { id, snap } of live) {
    const { key, ...c } = structuredClone(snap) as Record<string, any> & { key: AboutKey };
    if (key === 'our-story') {
      c.image = image(c.mediaId);
      if (c.statement) c.statement.image = image(c.statement.mediaId);
    }
    if (key === 'team') c.people = (c.people ?? []).map((p: any) => ({ ...p, image: image(p.mediaId) }));
    if (key === 'strategy') c.objectives = (c.objectives ?? []).map((o: any) => ({ ...o, pillars: links.filter((l) => l.ref === o.ref).map((l) => l.key) }));
    pages[key] = { ...c, revision: id };
  }
  return { pages, mediaIds: ids };
}
