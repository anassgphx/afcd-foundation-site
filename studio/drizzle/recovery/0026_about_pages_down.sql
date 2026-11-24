-- Manual rollback of 0026_about_pages (not run automatically). Removes the About pages module (Our Story, Mission & Vision,
-- Strategy, Team, Partners page texts) and its revisions. Delete src/data/about.json afterwards so the site uses the text
-- written in src/content.py again, then rebuild. Strategic objective titles published from Studio stay in "objectives".
-- Run it with Studio stopped and together with reverting the About pages code. Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "about_page_revisions";
DROP TABLE IF EXISTS "about_pages";
-- forget that 0026 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795548963474;
COMMIT;
