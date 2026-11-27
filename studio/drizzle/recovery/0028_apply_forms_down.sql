-- Manual rollback of 0028_apply_forms (not run automatically). Removes AFCD Apply's application forms, their published
-- versions and the custom form templates (export any template you want to keep as JSON first, from Applications →
-- Templates). Calls (0027) are kept. Run it with Studio stopped, after a database backup, and together with reverting
-- the Apply forms code. Undo newer migrations first (newest first).
BEGIN;
DROP TABLE IF EXISTS "apply_form_versions";
DROP TABLE IF EXISTS "apply_forms";
DROP TABLE IF EXISTS "apply_form_templates";
-- forget that 0028 ran (drizzle keys applied migrations by the journal's "when" value)
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795683852193;
COMMIT;
