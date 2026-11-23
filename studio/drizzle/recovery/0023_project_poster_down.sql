-- Undo 0023_project_poster: removes the project poster field.
-- The chosen posters are lost (the images stay in the Media Library); published project pages keep what was last exported until the next publish.
BEGIN;
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_poster_media_id_media_id_fk";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "poster_media_id";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795454187906;
COMMIT;
