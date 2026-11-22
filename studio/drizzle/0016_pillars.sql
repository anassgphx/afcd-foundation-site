CREATE TABLE "pillar_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pillar_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "draft" jsonb;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "media_id" uuid;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "provenance" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "status" "workflow_status" DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "published_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "approved_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "submitted_by" uuid;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "pillars" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pillar_revisions" ADD CONSTRAINT "pillar_revisions_pillar_id_pillars_id_fk" FOREIGN KEY ("pillar_id") REFERENCES "public"."pillars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pillar_revisions" ADD CONSTRAINT "pillar_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pillar_revisions_num_uq" ON "pillar_revisions" USING btree ("pillar_id","number");--> statement-breakpoint
ALTER TABLE "pillars" ADD CONSTRAINT "pillars_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pillars" ADD CONSTRAINT "pillars_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pillars" ADD CONSTRAINT "pillars_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;