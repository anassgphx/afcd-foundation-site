-- Manual rollback of 0035_apply_submission_bin (not run automatically). Applications in the bin come back into every
-- list and count: nothing is erased either way. Run with Studio stopped, together with reverting the code.
BEGIN;
ALTER TABLE "apply_submissions" DROP CONSTRAINT IF EXISTS "apply_submissions_deleted_by_users_id_fk";
ALTER TABLE "apply_submissions" DROP COLUMN IF EXISTS "deleted_by";
ALTER TABLE "apply_submissions" DROP COLUMN IF EXISTS "deleted_at";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795797416946;
COMMIT;
