// The review workflow every kind of content shares: draft → in review → approved → (published by the Publisher).
//
// Before this file, each module (projects, stories, events, partners, pages, …) carried its own copy of the same rules
// and the same transition function, 14 copies in all. They are adopted here one module at a time, each behind its
// existing tests, so the messages and the stored rows stay exactly as they were. Adopted so far: events, partners.
//
// What a transition does, in this order, inside one transaction with the row locked:
//   1. the action must exist and the current status must allow it (409 otherwise);
//   2. archive: never while the item is on the website; request_changes: a comment is required;
//      approve: someone other than the person who submitted it (a Super Administrator may approve their own);
//   3. submit and approve: the item must pass its own checks (422 with each problem), then a frozen revision is saved;
//      approve records it as the revision the Publisher will publish; withdraw and restore clear it;
//   4. the status is saved, a review comment is kept (except a withdraw without a comment) and the change is audited.
import { eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import type { DB } from '../../db/client.ts';
import { reviewComments } from '../../db/schema.ts';
import { AppError } from '../../http.ts';
import { audit, type Actor } from '../../audit.ts';
import type { Permission, Role } from '../../rbac.ts';

export type WorkflowStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved' | 'scheduled' | 'published' | 'archived';
export type ReviewAction = 'submit' | 'withdraw' | 'request_changes' | 'approve' | 'archive' | 'restore';
type Rule = { from: WorkflowStatus[]; to: WorkflowStatus; needs: 'update' | 'approve' };

export const REVIEW_RULES: Record<ReviewAction, Rule> = {
  submit: { from: ['draft', 'changes_requested'], to: 'in_review', needs: 'update' },
  withdraw: { from: ['in_review', 'approved'], to: 'draft', needs: 'update' },
  request_changes: { from: ['in_review'], to: 'changes_requested', needs: 'approve' },
  approve: { from: ['in_review'], to: 'approved', needs: 'approve' },
  archive: { from: ['draft', 'changes_requested', 'approved', 'in_review'], to: 'archived', needs: 'update' },
  restore: { from: ['archived'], to: 'draft', needs: 'update' },
};

/** The permission an action needs for a content kind, e.g. ('event', 'approve') → 'event.approve'; undefined = unknown action. */
export const transitionPerm = (kind: string, action: string): Permission | undefined => {
  const r = REVIEW_RULES[action as ReviewAction];
  return r ? `${kind}.${r.needs}` as Permission : undefined;
};

type Row = { id: string; status: WorkflowStatus; submittedBy: string | null; publishedRevisionId: string | null };

export type WorkflowSpec<R extends Row, Full, Snap> = {
  table: PgTable & { id: any };   // the content table (id, status, submittedBy, publishedRevisionId, approvedRevisionId, updatedAt)
  kind: string;                   // entity type in review comments and the audit log: 'event', 'partner'
  /** How messages name it: { a: 'an event', the: 'the event', this: 'this event', Name: 'Event' }. */
  noun: { a: string; the: string; this: string; Name: string };
  title: (row: R) => string;
  load: (db: DB, id: string) => Promise<Full>;
  problems: (db: DB, full: Full) => Promise<string[]> | string[];
  snapshot: (full: Full) => Snap;
  addRevision: (db: DB, id: string, snap: Snap, reason: string, userId: string) => Promise<{ id: string }>;
  /** Extra fields saved with an approval (e.g. partners record when they were verified). */
  onApprove?: () => Record<string, unknown>;
};

export async function runTransition<R extends Row, Full, Snap>(spec: WorkflowSpec<R, Full, Snap>, db: DB, actor: NonNullable<Actor>, role: Role, id: string, action: string, rawComment = '') {
  const rule = REVIEW_RULES[action as ReviewAction];
  if (!rule) throw new AppError(422, 'Unknown action.');
  const comment = rawComment.trim();
  const { noun } = spec; const table = spec.table as any;
  return db.transaction(async (tx) => {
    const t = tx as unknown as DB;
    const [cur] = await t.select().from(table).where(eq(table.id, id)).for('update') as R[];
    if (!cur) throw new AppError(404, `${noun.Name} not found.`);
    if (!rule.from.includes(cur.status)) throw new AppError(409, `Cannot ${action.replace('_', ' ')} ${noun.a} that is ${cur.status.replace('_', ' ')}.`);
    if (action === 'archive' && cur.publishedRevisionId) throw new AppError(409, `Remove ${noun.the} from the website before archiving it.`);
    if (action === 'request_changes' && !comment) throw new AppError(422, 'Explain what needs to change.');
    if (action === 'approve' && cur.submittedBy === actor.id && role !== 'super_admin') throw new AppError(409, `Someone other than the author must approve ${noun.this}.`);
    const patch: Record<string, unknown> = { status: rule.to, updatedAt: new Date() };
    let revId: string | null = null;
    if (action === 'submit' || action === 'approve') {
      const full = await spec.load(t, id);
      const problems = await spec.problems(t, full);
      if (problems.length) throw new AppError(422, `${noun.this[0].toUpperCase()}${noun.this.slice(1)} is not ready yet.`, problems.map((m) => ({ path: '', message: m })));
      const rev = await spec.addRevision(t, id, spec.snapshot(full), action === 'submit' ? 'submitted' : 'approved', actor.id);
      revId = rev.id;
      if (action === 'submit') patch.submittedBy = actor.id;
      if (action === 'approve') Object.assign(patch, { approvedRevisionId: rev.id }, spec.onApprove?.() ?? {});
    }
    if (action === 'withdraw' || action === 'restore') patch.approvedRevisionId = null;
    await t.update(table).set(patch).where(eq(table.id, id));
    if (comment || action !== 'withdraw') await t.insert(reviewComments).values({ entityType: spec.kind, entityId: id, authorId: actor.id, kind: action, body: comment.slice(0, 2000) });
    await audit(tx, actor, `${spec.kind}.${action}`, { type: spec.kind, id }, `${spec.title(cur)}: ${cur.status} → ${rule.to}`, { revisionId: revId });
    return { status: rule.to, revisionId: revId };
  });
}
