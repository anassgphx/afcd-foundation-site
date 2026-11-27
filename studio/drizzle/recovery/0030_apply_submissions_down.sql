-- Manual rollback of 0030_apply_submissions (not run automatically). DELETES ALL SUBMITTED APPLICATIONS and their
-- history: export them first (Applications → Submissions) and keep the database backup. Uploaded files stay in
-- <dataDir>/apply-files; their records lose the link to the application. Run with Studio stopped, together with reverting
-- the code. Undo newer migrations first (newest first).
BEGIN;
ALTER TABLE "apply_files" DROP CONSTRAINT IF EXISTS "apply_files_submission_id_apply_submissions_id_fk";
DROP INDEX IF EXISTS "apply_files_submission_idx";
ALTER TABLE "apply_files" DROP COLUMN IF EXISTS "submission_id";
DROP TABLE IF EXISTS "apply_submission_events";
DROP TABLE IF EXISTS "apply_submissions";
-- forget that 0030 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795686563863;
COMMIT;
