-- Manual rollback of 0033_password_resets (not run automatically). Removes the "forgot password" requests and
-- password links; links already emailed stop working. Accounts and passwords are not touched. Run with Studio stopped,
-- after a database backup, together with reverting the code. Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "password_resets";
-- forget that 0033 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795767703878;
COMMIT;
