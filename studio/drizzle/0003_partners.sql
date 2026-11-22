CREATE TYPE "public"."partner_scope" AS ENUM('international', 'national', 'local');--> statement-breakpoint
CREATE TABLE "partner_projects" (
	"partner_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	CONSTRAINT "partner_projects_partner_id_project_id_pk" PRIMARY KEY("partner_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "partner_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"partner_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_key" text NOT NULL,
	"scope" "partner_scope" NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"website_url" text DEFAULT '' NOT NULL,
	"since_year" integer,
	"current" boolean DEFAULT true NOT NULL,
	"verified_at" timestamp with time zone,
	"provenance" text DEFAULT '' NOT NULL,
	"logo_media_id" uuid,
	"sort" integer DEFAULT 100 NOT NULL,
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
ALTER TABLE "partner_projects" ADD CONSTRAINT "partner_projects_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_projects" ADD CONSTRAINT "partner_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_revisions" ADD CONSTRAINT "partner_revisions_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_revisions" ADD CONSTRAINT "partner_revisions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_logo_media_id_media_id_fk" FOREIGN KEY ("logo_media_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_revisions_num_uq" ON "partner_revisions" USING btree ("partner_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_slug_uq" ON "partners" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_name_key_uq" ON "partners" USING btree ("name_key");--> statement-breakpoint
CREATE INDEX "partners_status_idx" ON "partners" USING btree ("status");