-- Manual rollback of 0018_media_rights (not run automatically). Run it before 0017_pillar_removal_down.sql (newest first).
BEGIN;
ALTER TABLE "media" DROP COLUMN IF EXISTS "rights_expires_on";
ALTER TABLE "media" DROP COLUMN IF EXISTS "licence";
-- forget that 0018 ran
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795387164690;
COMMIT;
