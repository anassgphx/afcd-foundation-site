// Permanent delete for stories, events, opportunities, partners and publications: only items that are not on the
// website (no published revision) and are drafts, changes-requested or archived. Their revisions and links go with
// them (cascade); photos and documents in the Media Library stay. Each delete is permission-checked and audited.
import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { DB } from '../../db/client.ts';
import { articles, events, opportunities, partners, publications } from '../../db/schema.ts';
import { AppError, perm, type Env } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Permission } from '../../rbac.ts';

const KINDS = {
  news: { table: articles, label: 'story', perm: 'news.publish', name: (r: Record<string, unknown>) => r.title as string },
  events: { table: events, label: 'event', perm: 'event.publish', name: (r: Record<string, unknown>) => r.title as string },
  opportunities: { table: opportunities, label: 'opportunity', perm: 'opportunity.publish', name: (r: Record<string, unknown>) => r.title as string },
  partners: { table: partners, label: 'partner', perm: 'partner.publish', name: (r: Record<string, unknown>) => r.name as string },
  publications: { table: publications, label: 'publication', perm: 'publication.publish', name: (r: Record<string, unknown>) => r.title as string },
} as const;
export type DeletableKind = keyof typeof KINDS;
export const DELETABLE_STATUSES = ['draft', 'changes_requested', 'archived'];

export async function deleteContent(db: DB, actor: NonNullable<Actor>, kind: DeletableKind, id: string) {
  const k = KINDS[kind]; const t = k.table as typeof articles;   // every table here has id, status and publishedRevisionId
  const [row] = await db.select().from(t).where(eq(t.id, id)) as unknown as Record<string, unknown>[];
  if (!row) throw new AppError(404, `That ${k.label} doesn’t exist.`);
  if (row.publishedRevisionId) throw new AppError(409, `This ${k.label} is on the website. Unpublish it first, then delete it.`);
  if (!DELETABLE_STATUSES.includes(row.status as string)) throw new AppError(409, `Only drafts and archived items can be deleted. Withdraw this ${k.label} from review first.`);
  const name = k.name(row);
  await db.transaction(async (tx) => {
    await tx.delete(t).where(eq(t.id, id));
    await audit(tx, actor, `${k.label}.delete`, { type: k.label, id }, `Deleted “${name}”`, { slug: row.slug, status: row.status });
  });
  return { ok: true };
}

export function contentDeleteRoutes(api: Hono<Env>, db: DB, actor: (c: never) => NonNullable<Actor>) {
  for (const kind of Object.keys(KINDS) as DeletableKind[]) {
    api.delete(`/${kind}/:id{[0-9a-f-]{36}}`, perm(KINDS[kind].perm as Permission), async (c) => c.json(await deleteContent(db, actor(c as never), kind, c.req.param('id'))));
  }
}
