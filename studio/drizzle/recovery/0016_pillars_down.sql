-- Manual rollback of 0016_pillars (not run automatically). Removes the Pillars module's workflow columns and revisions.
-- The canonical pillar rows (key, number, name, description, colour, public_file, sort) are kept, so projects, stories,
-- events and objectives stay linked. Delete src/data/pillars.json afterwards so the site uses src/content.py again.
-- Run it with Studio stopped and together with reverting the Pillars code. Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "pillar_revisions";
ALTER TABLE "pillars" DROP CONSTRAINT IF EXISTS "pillars_media_id_media_id_fk";
ALTER TABLE "pillars" DROP CONSTRAINT IF EXISTS "pillars_submitted_by_users_id_fk";
ALTER TABLE "pillars" DROP CONSTRAINT IF EXISTS "pillars_updated_by_users_id_fk";
ALTER TABLE "pillars" DROP COLUMN IF EXISTS "draft", DROP COLUMN IF EXISTS "media_id", DROP COLUMN IF EXISTS "provenance",
  DROP COLUMN IF EXISTS "status", DROP COLUMN IF EXISTS "published_revision_id", DROP COLUMN IF EXISTS "approved_revision_id",
  DROP COLUMN IF EXISTS "published_at", DROP COLUMN IF EXISTS "verified_at", DROP COLUMN IF EXISTS "submitted_by",
  DROP COLUMN IF EXISTS "updated_by", DROP COLUMN IF EXISTS "updated_at";
-- forget that 0016 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795375887766;
COMMIT;
