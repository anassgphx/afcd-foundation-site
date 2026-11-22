CREATE TYPE "public"."redirect_status" AS ENUM('draft', 'active', 'disabled');--> statement-breakpoint
CREATE TABLE "redirects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"destination" text NOT NULL,
	"code" integer DEFAULT 301 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"status" "redirect_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"draft" jsonb,
	"published" jsonb,
	"status" "workflow_status" DEFAULT 'draft' NOT NULL,
	"submitted_by" uuid,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirects" ADD CONSTRAINT "redirects_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_settings" ADD CONSTRAINT "seo_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "redirects_source_uq" ON "redirects" USING btree ("source");