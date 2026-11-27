-- Manual rollback of 0027_apply_calls (not run automatically). Removes AFCD Apply's calls (and their revisions and
-- history) and the two Apply roles. Users who had an Apply role become Read-Only users first (their accounts are kept).
-- Run it with Studio stopped, after a database backup, and together with reverting the Apply code. Undo newer migrations
-- first (newest first).
BEGIN;
DROP TABLE IF EXISTS "apply_call_events";
DROP TABLE IF EXISTS "apply_call_revisions";
DROP TABLE IF EXISTS "apply_calls";
DROP TYPE IF EXISTS "apply_call_status";
-- Postgres cannot drop enum values: rebuild "role" without the two Apply roles
UPDATE "users" SET "role" = 'read_only' WHERE "role"::text IN ('application_manager', 'application_reviewer');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TYPE "role" RENAME TO "role_before_0027_down";
CREATE TYPE "role" AS ENUM('super_admin', 'website_admin', 'content_editor', 'content_reviewer', 'media_manager', 'seo_manager', 'read_only');
ALTER TABLE "users" ALTER COLUMN "role" TYPE "role" USING "role"::text::"role";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'read_only';
DROP TYPE "role_before_0027_down";
-- forget that 0027 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795682403204;
COMMIT;
