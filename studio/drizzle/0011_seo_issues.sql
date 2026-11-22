CREATE TYPE "public"."seo_issue_status" AS ENUM('open', 'reviewed', 'resolved');--> statement-breakpoint
CREATE TABLE "seo_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"file" text NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "seo_issue_status" DEFAULT 'open' NOT NULL,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"reviewed_by" uuid,
	"note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "seo_issues_key_uq" ON "seo_issues" USING btree ("code","file");--> statement-breakpoint
CREATE INDEX "seo_issues_status_idx" ON "seo_issues" USING btree ("status","severity");