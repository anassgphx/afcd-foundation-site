-- Manual rollback of 0017_pillar_removal (not run automatically). Run it before 0016_pillars_down.sql (newest first).
BEGIN;
ALTER TABLE "pillars" DROP COLUMN IF EXISTS "remove_requested";
-- forget that 0017 ran
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795377292754;
COMMIT;
