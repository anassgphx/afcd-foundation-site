-- Recovery for 0015_inbox: puts form_submissions back in the 0006 shape. Not run automatically (it is outside the
-- migration journal). Use it only together with reverting the Inbox code to a commit before 0015.
--
-- Safest path first: before upgrading, stop Studio and copy studio/.data/pg (e.g. cp -R .data/pg .data/pg-before-0015).
-- Restoring that copy is a complete rollback. Use this script only when you need to keep messages received since then.
--
-- Run it with Studio stopped, e.g. with psql against DATABASE_URL, or from a small PGlite script.
-- What is lost: personal stars, read/archived state, the activity history except notes (notes are joined back into
-- the single legacy note field), and the closed-message retention setting.
BEGIN;
ALTER TABLE "form_submissions" DROP CONSTRAINT IF EXISTS "form_submissions_status_ck";
UPDATE "form_submissions" SET "status" = 'done' WHERE "status" IN ('replied', 'closed');
UPDATE "form_submissions" SET "status" = 'spam' WHERE "spam";
UPDATE "form_submissions" s SET "note" = left(coalesce((SELECT string_agg(e."body", E'\n\n' ORDER BY e."created_at") FROM "submission_events" e
  WHERE e."submission_id" = s."id" AND e."kind" = 'note'), s."note"), 2000);
CREATE TYPE "public"."submission_status" AS ENUM('new', 'in_progress', 'done', 'spam');
ALTER TABLE "form_submissions" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "form_submissions" ALTER COLUMN "status" SET DATA TYPE "public"."submission_status" USING "status"::"public"."submission_status";
ALTER TABLE "form_submissions" ALTER COLUMN "status" SET DEFAULT 'new';
DROP INDEX IF EXISTS "form_submissions_inbox_idx";
ALTER TABLE "form_submissions" DROP COLUMN "spam", DROP COLUMN "spam_reason", DROP COLUMN "read_at", DROP COLUMN "archived_at", DROP COLUMN "closed_at";
ALTER TABLE "form_settings" DROP COLUMN "closed_retention_months";
DROP TABLE "submission_events";
DROP TABLE "submission_stars";
-- forget that 0015 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795365193053;
COMMIT;
