CREATE TABLE "about_page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "about_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"draft" jsonb,
	"provenance" text DEFAULT '' NOT NULL,
	"status" "workflow_status" DEFAULT 'draft' NOT NULL,
	"published_revision_id" uuid,
	"approved_revision_id" uuid,
	"published_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"submitted_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "about_page_revisions" ADD CONSTRAINT "about_page_revisions_page_id_about_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."about_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "about_page_revisions" ADD CONSTRAINT "about_page_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "about_pages" ADD CONSTRAINT "about_pages_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "about_pages" ADD CONSTRAINT "about_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "about_page_revisions_num_uq" ON "about_page_revisions" USING btree ("page_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "about_pages_key_uq" ON "about_pages" USING btree ("key");--> statement-breakpoint
INSERT INTO "about_pages" ("key") VALUES ('our-story'), ('mission-vision'), ('strategy'), ('team'), ('partners') ON CONFLICT DO NOTHING;