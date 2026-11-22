// Pillar data for the public site. src/content.py reads src/data/pillars.json (see STUDIO_PILLARS next to PILLARS there)
// and builds pillars.html and the four pillar pages from it. Every string is HTML-escaped here, because the generator
// inserts the values as-is. With the imported content unchanged, the generated pages are byte-identical to before.
import { inArray } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { media } from '../../db/schema.ts';
import { publicRef } from '../media/service.ts';
import { esc } from '../pages/blocks.ts';
import type { PillarSnapshot } from './service.ts';

/** The approach heading as the generator writes it: the second part in the softer colour. */
export const approachTitleHtml = (s: Pick<PillarSnapshot, 'approachTitle' | 'approachSoft'>) =>
  s.approachSoft ? `${esc(s.approachTitle)} <span class="text-white/45">${esc(s.approachSoft)}</span>` : esc(s.approachTitle);

export async function pillarEntries(db: DB, live: { id: string; snap: PillarSnapshot }[]) {
  const ids = [...new Set(live.map((x) => x.snap.mediaId).filter(Boolean) as string[])];
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];
  const image = (id: string | null) => {
    const m = id ? rows.find((r) => r.id === id) : undefined;
    if (!m) return null;
    const ref = publicRef(m, 'assets/media/');
    return { src: ref.src, srcset: ref.srcset, w: ref.w, h: ref.h, alt: m.alt, fx: m.focalX ?? 50, fy: m.focalY ?? 50 };
  };
  return live
    .sort((a, b) => a.snap.number.localeCompare(b.snap.number))
    .map(({ id, snap: s }) => ({
      key: s.key, number: s.number, file: s.publicFile, revision: id,
      name: esc(s.name), short: esc(s.short), summary: esc(s.summary), intro: esc(s.intro), colour: s.colour, brand: esc(s.brand),
      highlights: s.highlights.map(esc),
      approach: { title: approachTitleHtml(s), view: esc(s.view), principles: s.principles.map(esc), steps: s.steps.map((x) => [esc(x.title), esc(x.text)]) },
      activities: s.activities, groups: s.groups, image: image(s.mediaId),
    }));
}
export type PillarEntry = Awaited<ReturnType<typeof pillarEntries>>[number];
