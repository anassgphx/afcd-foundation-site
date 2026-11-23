CREATE TYPE "public"."publication_type" AS ENUM('report', 'study', 'policy_brief', 'guide', 'annual_report', 'toolkit', 'other');--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"mime" text DEFAULT 'application/pdf' NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publication_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"publication_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"type" "publication_type" DEFAULT 'report' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"abstract" text DEFAULT '' NOT NULL,
	"published_on" text,
	"authors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"organisation" text DEFAULT '' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"pillar_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cover_media_id" uuid,
	"document_id" uuid,
	"external_url" text DEFAULT '' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"status" "workflow_status" DEFAULT 'draft' NOT NULL,
	"published_revision_id" uuid,
	"approved_revision_id" uuid,
	"published_at" timestamp with time zone,
	"submitted_by" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_revisions" ADD CONSTRAINT "publication_revisions_publication_id_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "public"."publications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_revisions" ADD CONSTRAINT "publication_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_cover_media_id_media_id_fk" FOREIGN KEY ("cover_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publications" ADD CONSTRAINT "publications_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "documents_storage_uq" ON "documents" USING btree ("storage_key");--> statement-breakpoint
CREATE UNIQUE INDEX "publication_revisions_num_uq" ON "publication_revisions" USING btree ("publication_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "publications_slug_uq" ON "publications" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "publications_status_idx" ON "publications" USING btree ("status");