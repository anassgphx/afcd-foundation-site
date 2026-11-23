-- Undo 0022_publications: removes publications, their revisions and the uploaded document records.
-- Every publication and its history is lost. The PDF files stay in <dataDir>/documents and the published pages and
-- assets/documents/ files stay on the site until the next publish; back up studio/.data/pg first.
BEGIN;
DROP TABLE IF EXISTS "publication_revisions";
DROP TABLE IF EXISTS "publications";
DROP TABLE IF EXISTS "documents";
DROP TYPE IF EXISTS "public"."publication_type";
DELETE FROM "drizzle"."__drizzle_migrations" WHERE "created_at" = 1795447258895;
COMMIT;
