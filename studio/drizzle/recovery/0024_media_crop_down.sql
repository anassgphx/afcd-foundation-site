-- Manual rollback of 0024_media_crop (not run automatically). Run it before 0023_project_poster_down.sql (newest first).
-- Cropped images keep their cropped derivative files; re-upload or "Reset crop" first if the full images are needed.
BEGIN;
ALTER TABLE "media" DROP COLUMN IF EXISTS "crop";
-- forget that 0024 ran
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795526414768;
COMMIT;
