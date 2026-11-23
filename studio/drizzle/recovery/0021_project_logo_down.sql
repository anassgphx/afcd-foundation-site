-- Undo 0021_project_logo: removes the project logo and its framing settings.
-- The chosen logos are lost (the images stay in the Media Library); published project pages keep what was last exported until the next publish.
BEGIN;
ALTER TABLE "projects" DROP CONSTRAINT IF EXISTS "projects_logo_media_id_media_id_fk";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "logo_style";
ALTER TABLE "projects" DROP COLUMN IF EXISTS "logo_media_id";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795438901056;
COMMIT;
