-- Manual rollback of 0025_media_quality (not run automatically). Run it before 0024_media_crop_down.sql (newest first).
BEGIN;
ALTER TABLE "media" DROP COLUMN IF EXISTS "quality";
-- forget that 0025 ran
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795534400720;
COMMIT;
