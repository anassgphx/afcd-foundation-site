ALTER TYPE "public"."apply_method" ADD VALUE 'studio';--> statement-breakpoint
CREATE TABLE "apply_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page" text,
	"lang" text DEFAULT 'en' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid,
	"call_id" uuid NOT NULL,
	"field_id" text NOT NULL,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"kind" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_resume_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"ip_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "opportunities" ADD COLUMN "apply_call_id" uuid;--> statement-breakpoint
ALTER TABLE "apply_drafts" ADD CONSTRAINT "apply_drafts_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_drafts" ADD CONSTRAINT "apply_drafts_version_id_apply_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."apply_form_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_files" ADD CONSTRAINT "apply_files_draft_id_apply_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."apply_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_files" ADD CONSTRAINT "apply_files_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_resume_tokens" ADD CONSTRAINT "apply_resume_tokens_draft_id_apply_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."apply_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apply_drafts_call_idx" ON "apply_drafts" USING btree ("call_id","status");--> statement-breakpoint
CREATE INDEX "apply_drafts_expiry_idx" ON "apply_drafts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "apply_drafts_ip_idx" ON "apply_drafts" USING btree ("ip_hash","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_files_storage_uq" ON "apply_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "apply_files_draft_idx" ON "apply_files" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_resume_tokens_hash_uq" ON "apply_resume_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "apply_resume_tokens_draft_idx" ON "apply_resume_tokens" USING btree ("draft_id","created_at");--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_apply_call_id_apply_calls_id_fk" FOREIGN KEY ("apply_call_id") REFERENCES "public"."apply_calls"("id") ON DELETE set null ON UPDATE no action;