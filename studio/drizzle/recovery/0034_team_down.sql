-- Manual rollback of 0034_team (not run automatically). Removes the Team module tables. The people stay where they were
-- before 0034: in the About page "team" (about_pages.draft.people and its published revision), which 0034 never changed.
-- Edits made in the Team module after 0034 are lost: export them first (Team > Export CSV) if they matter.
-- Then delete src/data/team.json so team.html uses about.json again, and rebuild. Run with Studio stopped, together with
-- reverting the Team module code. Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "team_layout_revisions";
DROP TABLE IF EXISTS "team_member_revisions";
DROP TABLE IF EXISTS "team_members";
DROP TABLE IF EXISTS "team_groups";
-- forget that 0034 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795770068497;
COMMIT;
