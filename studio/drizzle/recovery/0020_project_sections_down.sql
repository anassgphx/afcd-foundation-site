-- Undo 0020_project_sections: removes the project page section lists (programme objectives, outcomes, activities).
-- Their content is lost; published project pages keep what was last exported until the next publish.
BEGIN;
ALTER TABLE "projects" DROP COLUMN IF EXISTS "activity_items";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "outcomes";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "program_objectives";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795431350170;
COMMIT;
