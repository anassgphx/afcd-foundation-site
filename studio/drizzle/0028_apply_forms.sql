CREATE TABLE "apply_form_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"definition" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"based_on" text,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_form_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"form_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"definition" jsonb NOT NULL,
	"sha256" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"definition" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"source_template" text,
	"published_version_id" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apply_form_templates" ADD CONSTRAINT "apply_form_templates_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_form_templates" ADD CONSTRAINT "apply_form_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_form_versions" ADD CONSTRAINT "apply_form_versions_form_id_apply_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."apply_forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_form_versions" ADD CONSTRAINT "apply_form_versions_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_form_versions" ADD CONSTRAINT "apply_form_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_forms" ADD CONSTRAINT "apply_forms_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_forms" ADD CONSTRAINT "apply_forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apply_form_templates_name_idx" ON "apply_form_templates" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_form_versions_num_uq" ON "apply_form_versions" USING btree ("form_id","number");--> statement-breakpoint
CREATE INDEX "apply_form_versions_call_idx" ON "apply_form_versions" USING btree ("call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_forms_call_uq" ON "apply_forms" USING btree ("call_id");