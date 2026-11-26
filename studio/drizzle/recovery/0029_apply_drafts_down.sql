-- Manual rollback of 0029_apply_drafts (not run automatically). Removes applicants' drafts, their resume tokens and the
-- uploaded-file records, and the "AFCD Apply" apply method of opportunities (those opportunities fall back to the contact
-- form; republish them afterwards). The uploaded files themselves stay in <dataDir>/apply-files: delete that folder by
-- hand once you no longer need them. Run with Studio stopped, after a database backup, together with reverting the code.
-- Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "apply_resume_tokens";
DROP TABLE IF EXISTS "apply_files";
DROP TABLE IF EXISTS "apply_drafts";
UPDATE "opportunities" SET "apply_method" = 'contact' WHERE "apply_method"::text = 'studio';
ALTER TABLE "opportunities" DROP CONSTRAINT IF EXISTS "opportunities_apply_call_id_apply_calls_id_fk";
ALTER TABLE "opportunities" DROP COLUMN IF EXISTS "apply_call_id";
-- Postgres cannot drop an enum value: rebuild "apply_method" without "studio"
ALTER TABLE "opportunities" ALTER COLUMN "apply_method" DROP DEFAULT;
ALTER TYPE "apply_method" RENAME TO "apply_method_before_0029_down";
CREATE TYPE "apply_method" AS ENUM('external', 'email', 'contact');
ALTER TABLE "opportunities" ALTER COLUMN "apply_method" TYPE "apply_method" USING "apply_method"::text::"apply_method";
ALTER TABLE "opportunities" ALTER COLUMN "apply_method" SET DEFAULT 'external';
DROP TYPE "apply_method_before_0029_down";
-- forget that 0029 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795685494532;
COMMIT;
