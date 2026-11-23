-- Manual rollback of 0019_settings (not run automatically). Run it before 0018_media_rights_down.sql (newest first).
BEGIN;
DROP TABLE IF EXISTS "settings_revisions";
-- forget that 0019 ran
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795399244955;
COMMIT;
