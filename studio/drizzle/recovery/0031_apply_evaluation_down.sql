-- Manual rollback of 0031_apply_evaluation (not run automatically). DELETES rubrics, reviewer assignments, reviews,
-- conflict-of-interest declarations and decisions, and the scores stored on applications. Applications themselves and
-- their statuses are kept. Export what you need first and keep the database backup. Run with Studio stopped, together
-- with reverting the code. Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "apply_decisions";
DROP TABLE IF EXISTS "apply_reviews";
DROP TABLE IF EXISTS "apply_assignments";
DROP TABLE IF EXISTS "apply_rubric_versions";
DROP TABLE IF EXISTS "apply_rubrics";
ALTER TABLE "apply_submissions" DROP COLUMN IF EXISTS "score_bp";
ALTER TABLE "apply_submissions" DROP COLUMN IF EXISTS "score_reviews";
ALTER TABLE "apply_submissions" DROP COLUMN IF EXISTS "disagreement";
-- forget that 0031 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795687160770;
COMMIT;
