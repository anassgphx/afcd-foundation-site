-- Manual rollback of 0032_apply_messages (not run automatically). Removes AFCD Apply's email templates, the outbox
-- (queued, sent and failed messages with their delivery history) and the per-call "send a receipt" setting. Emails that
-- were already sent are not affected. Run with Studio stopped, after a database backup, together with reverting the
-- code. Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "apply_messages";
DROP TABLE IF EXISTS "apply_message_batches";
DROP TABLE IF EXISTS "apply_message_templates";
ALTER TABLE "apply_calls" DROP COLUMN IF EXISTS "receipt_enabled";
-- forget that 0032 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795688754405;
COMMIT;
