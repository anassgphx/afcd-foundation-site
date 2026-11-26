CREATE TYPE "public"."apply_call_status" AS ENUM('draft', 'in_review', 'changes_requested', 'approved', 'scheduled', 'open', 'paused', 'closed', 'under_evaluation', 'completed', 'archived');--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'application_manager';--> statement-breakpoint
ALTER TYPE "public"."role" ADD VALUE 'application_reviewer';--> statement-breakpoint
CREATE TABLE "apply_call_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"reason" text DEFAULT '' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_call_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"i18n" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"call_type" text DEFAULT 'youth_program' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"eligibility" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"format" text DEFAULT 'in_person' NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"pillar_id" uuid,
	"project_id" uuid,
	"hero_media_id" uuid,
	"opens_at" timestamp with time zone,
	"closes_at" timestamp with time zone,
	"time_zone" text DEFAULT 'Africa/Casablanca' NOT NULL,
	"places" integer,
	"contact_email" text DEFAULT '' NOT NULL,
	"terms" text DEFAULT '' NOT NULL,
	"privacy_notice" text DEFAULT '' NOT NULL,
	"seo_title" text DEFAULT '' NOT NULL,
	"seo_description" text DEFAULT '' NOT NULL,
	"unlisted" boolean DEFAULT false NOT NULL,
	"status" "apply_call_status" DEFAULT 'draft' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"approved_revision_id" uuid,
	"submitted_by" uuid,
	"opened_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"archived_from" "apply_call_status",
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apply_call_events" ADD CONSTRAINT "apply_call_events_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_call_events" ADD CONSTRAINT "apply_call_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_call_revisions" ADD CONSTRAINT "apply_call_revisions_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_call_revisions" ADD CONSTRAINT "apply_call_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_calls" ADD CONSTRAINT "apply_calls_pillar_id_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."pillars"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_calls" ADD CONSTRAINT "apply_calls_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_calls" ADD CONSTRAINT "apply_calls_hero_media_id_media_id_fk" FOREIGN KEY ("hero_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_calls" ADD CONSTRAINT "apply_calls_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_calls" ADD CONSTRAINT "apply_calls_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_calls" ADD CONSTRAINT "apply_calls_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apply_call_events_call_idx" ON "apply_call_events" USING btree ("call_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_call_revisions_num_uq" ON "apply_call_revisions" USING btree ("call_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_calls_slug_uq" ON "apply_calls" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_calls_reference_uq" ON "apply_calls" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "apply_calls_status_idx" ON "apply_calls" USING btree ("status");--> statement-breakpoint
CREATE INDEX "apply_calls_schedule_idx" ON "apply_calls" USING btree ("status","opens_at","closes_at");