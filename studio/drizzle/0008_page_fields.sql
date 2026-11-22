CREATE TABLE "page_content_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_contents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file" text NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "workflow_status" DEFAULT 'draft' NOT NULL,
	"published_revision_id" uuid,
	"approved_revision_id" uuid,
	"published_at" timestamp with time zone,
	"submitted_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "page_content_revisions" ADD CONSTRAINT "page_content_revisions_content_id_page_contents_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."page_contents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_content_revisions" ADD CONSTRAINT "page_content_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_contents" ADD CONSTRAINT "page_contents_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_contents" ADD CONSTRAINT "page_contents_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "page_content_revisions_num_uq" ON "page_content_revisions" USING btree ("content_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "page_contents_file_uq" ON "page_contents" USING btree ("file");