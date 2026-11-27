CREATE TABLE "team_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"show" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_layout_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "team_member_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"role" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"group_id" uuid NOT NULL,
	"photo_media_id" uuid,
	"email" text DEFAULT '' NOT NULL,
	"links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort" integer DEFAULT 100 NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"provenance" text DEFAULT '' NOT NULL,
	"status" "workflow_status" DEFAULT 'draft' NOT NULL,
	"published_revision_id" uuid,
	"approved_revision_id" uuid,
	"published_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"submitted_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_layout_revisions" ADD CONSTRAINT "team_layout_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_revisions" ADD CONSTRAINT "team_member_revisions_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_revisions" ADD CONSTRAINT "team_member_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_group_id_team_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."team_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_photo_media_id_media_id_fk" FOREIGN KEY ("photo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "team_groups_key_uq" ON "team_groups" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "team_layout_revisions_num_uq" ON "team_layout_revisions" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "team_member_revisions_num_uq" ON "team_member_revisions" USING btree ("member_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "team_members_slug_uq" ON "team_members" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "team_members_status_idx" ON "team_members" USING btree ("status");--> statement-breakpoint
CREATE INDEX "team_members_group_idx" ON "team_members" USING btree ("group_id","sort");--> statement-breakpoint
-- ---------------------------------------------------------------- data: one record per person, copied from the About page "team"
-- Nothing is invented and nothing is deleted: about_pages / about_page_revisions keep the old list (rollback: recovery/0034_team_down.sql).
-- Groups: the four built-in groups with the headings, visibility and order the published Our Team page had (else its draft).
INSERT INTO "team_groups" ("key", "name", "description", "sort", "show")
SELECT g.key,
  COALESCE(NULLIF(btrim(s.src #>> ARRAY['sections', g.key, 'label']), ''), g.name),
  COALESCE(s.src #>> ARRAY['sections', g.key, 'desc'], ''),
  COALESCE((SELECT o.n * 10 FROM jsonb_array_elements_text(COALESCE(s.src -> 'order', '[]'::jsonb)) WITH ORDINALITY AS o(v, n) WHERE o.v = g.key LIMIT 1), 1000 + g.n * 10),
  COALESCE((s.src #>> ARRAY['sections', g.key, 'show'])::boolean, true)
FROM (VALUES ('board', 'Board', 1), ('executive', 'Executive team', 2), ('staff', 'Staff', 3), ('volunteers', 'Volunteers & ambassadors', 4)) AS g(key, name, n)
LEFT JOIN (SELECT COALESCE(r.snapshot, p.draft) AS src FROM "about_pages" p LEFT JOIN "about_page_revisions" r ON r.id = p.published_revision_id WHERE p.key = 'team') s ON true
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- People: the published list and the working draft are matched by name (nth person of that name); each person becomes one row.
CREATE TEMP TABLE "_team_0034" AS
WITH page AS (
  SELECT p.draft, p.published_at, r.snapshot AS pub FROM "about_pages" p LEFT JOIN "about_page_revisions" r ON r.id = p.published_revision_id WHERE p.key = 'team'
), pk AS (
  SELECT x.v, x.n, lower(btrim(COALESCE(x.v ->> 'name', ''))) AS k FROM page, jsonb_array_elements(COALESCE(page.pub -> 'people', '[]'::jsonb)) WITH ORDINALITY AS x(v, n)
), dk AS (
  SELECT x.v, x.n, lower(btrim(COALESCE(x.v ->> 'name', ''))) AS k FROM page, jsonb_array_elements(COALESCE(page.draft -> 'people', '[]'::jsonb)) WITH ORDINALITY AS x(v, n)
), pko AS (SELECT *, row_number() OVER (PARTITION BY k ORDER BY n) AS occ FROM pk),
   dko AS (SELECT *, row_number() OVER (PARTITION BY k ORDER BY n) AS occ FROM dk),
joined AS (
  SELECT d.v AS dv, p.v AS pv, COALESCE(d.n, 1000 + p.n) AS pos, COALESCE(p.n, 1000 + d.n) AS livepos FROM pko p FULL JOIN dko d ON d.k = p.k AND d.occ = p.occ
), named AS (
  SELECT j.*, COALESCE(j.dv, j.pv) AS w,
    NULLIF(btrim(regexp_replace(translate(lower(btrim(COALESCE(COALESCE(j.dv, j.pv) ->> 'name', ''))), 'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]+', '-', 'g'), '-'), '') AS base
  FROM joined j
)
SELECT gen_random_uuid() AS id, n.dv, n.pv, n.w, n.pos, n.livepos,
  COALESCE(n.base, 'person') || CASE WHEN n.base IS NULL OR row_number() OVER (PARTITION BY n.base ORDER BY n.pos) > 1 THEN '-' || row_number() OVER (PARTITION BY n.base ORDER BY n.pos) ELSE '' END AS slug,
  btrim(regexp_replace(translate(lower(btrim(COALESCE(n.w ->> 'name', ''))), 'àáâäãåçèéêëìíîïñòóôöõùúûüýÿ', 'aaaaaaceeeeiiiinooooouuuuyy'), '[^a-z0-9]+', ' ', 'g')) AS name_key,
  (SELECT published_at FROM page) AS published_at
FROM named n;
--> statement-breakpoint
INSERT INTO "team_members" ("id", "slug", "name", "name_key", "role", "bio", "group_id", "photo_media_id", "sort", "status", "provenance", "published_at", "verified_at")
SELECT i.id, i.slug, btrim(COALESCE(i.w ->> 'name', '')), i.name_key, COALESCE(i.w ->> 'role', ''), COALESCE(i.w ->> 'bio', ''),
  COALESCE(g.id, (SELECT id FROM "team_groups" WHERE key = 'executive')),
  (SELECT m.id FROM "media" m WHERE m.id::text = i.w ->> 'mediaId'),
  i.pos * 10,
  (CASE WHEN i.pv IS NOT NULL AND (i.dv IS NULL OR i.dv = i.pv) THEN 'published' ELSE 'draft' END)::"workflow_status",
  'Moved from the Our Team page (About pages) by migration 0034'
    || CASE WHEN i.dv IS NULL THEN '; it was on the website but no longer in the page draft' WHEN i.pv IS NOT NULL AND i.dv <> i.pv THEN '; the draft has unpublished changes' ELSE '' END,
  CASE WHEN i.pv IS NOT NULL THEN COALESCE(i.published_at, now()) END,
  CASE WHEN i.pv IS NOT NULL THEN COALESCE(i.published_at, now()) END
FROM "_team_0034" i LEFT JOIN "team_groups" g ON g.key = (i.w ->> 'group');
--> statement-breakpoint
-- the published wording of each live person becomes that member's published revision 1
INSERT INTO "team_member_revisions" ("member_id", "number", "snapshot", "reason")
SELECT i.id, 1, jsonb_build_object(
    'name', btrim(COALESCE(i.pv ->> 'name', '')), 'slug', i.slug, 'role', COALESCE(i.pv ->> 'role', ''), 'bio', COALESCE(i.pv ->> 'bio', ''),
    'groupKey', COALESCE((SELECT key FROM "team_groups" WHERE key = i.pv ->> 'group'), 'executive'),
    'photoMediaId', (SELECT to_jsonb(m.id) FROM "media" m WHERE m.id::text = i.pv ->> 'mediaId'),
    'email', '', 'links', '[]'::jsonb),
  'imported'
FROM "_team_0034" i WHERE i.pv IS NOT NULL;
--> statement-breakpoint
UPDATE "team_members" t SET "published_revision_id" = r.id FROM "team_member_revisions" r WHERE r.member_id = t.id AND r.number = 1 AND r.reason = 'imported';
--> statement-breakpoint
-- the layout as the website shows it today: groups in page order, live people in their published order
INSERT INTO "team_layout_revisions" ("number", "snapshot", "reason", "published_at")
SELECT 1, jsonb_build_object(
    'groups', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', g.key, 'name', g.name, 'description', g.description, 'show', g.show) ORDER BY g.sort, g.key) FROM "team_groups" g), '[]'::jsonb),
    'order', COALESCE((SELECT jsonb_agg(to_jsonb(i.id::text) ORDER BY i.livepos) FROM "_team_0034" i WHERE i.pv IS NOT NULL), '[]'::jsonb)),
  'imported', now()
WHERE NOT EXISTS (SELECT 1 FROM "team_layout_revisions");
--> statement-breakpoint
DROP TABLE "_team_0034";
