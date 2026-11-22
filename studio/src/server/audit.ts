// Append-only audit trail. Nothing in the app updates or deletes audit rows.
import type { DB } from './db/client.ts';
import { auditLog } from './db/schema.ts';

export type Actor = { id: string; email: string } | null;

export async function audit(
  db: Pick<DB, 'insert'>, actor: Actor, action: string,
  entity: { type?: string; id?: string } = {}, summary = '', meta?: Record<string, unknown>, ip?: string | null,
) {
  await db.insert(auditLog).values({
    actorId: actor?.id ?? null, actorEmail: actor?.email ?? null, action,
    entityType: entity.type ?? null, entityId: entity.id ?? null, summary, meta: meta ?? null, ip: ip ?? null,
  });
}
