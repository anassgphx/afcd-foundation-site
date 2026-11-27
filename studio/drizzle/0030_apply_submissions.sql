CREATE TABLE "apply_submission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"from_value" text,
	"to_value" text,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"draft_id" uuid,
	"reference" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"answers" jsonb NOT NULL,
	"applicant_name" text DEFAULT '' NOT NULL,
	"applicant_email" text DEFAULT '' NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"eligibility" text DEFAULT 'not_assessed' NOT NULL,
	"eligibility_auto" jsonb NOT NULL,
	"eligibility_override" jsonb,
	"consent" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ip_hash" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apply_files" ADD COLUMN "submission_id" uuid;--> statement-breakpoint
ALTER TABLE "apply_submission_events" ADD CONSTRAINT "apply_submission_events_submission_id_apply_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."apply_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_submission_events" ADD CONSTRAINT "apply_submission_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD CONSTRAINT "apply_submissions_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD CONSTRAINT "apply_submissions_version_id_apply_form_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."apply_form_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD CONSTRAINT "apply_submissions_draft_id_apply_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."apply_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apply_submission_events_sub_idx" ON "apply_submission_events" USING btree ("submission_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_submissions_reference_uq" ON "apply_submissions" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_submissions_draft_uq" ON "apply_submissions" USING btree ("draft_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_submissions_idem_uq" ON "apply_submissions" USING btree ("call_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "apply_submissions_list_idx" ON "apply_submissions" USING btree ("call_id","submitted_at","id");--> statement-breakpoint
CREATE INDEX "apply_submissions_status_idx" ON "apply_submissions" USING btree ("call_id","status");--> statement-breakpoint
CREATE INDEX "apply_submissions_elig_idx" ON "apply_submissions" USING btree ("call_id","eligibility");--> statement-breakpoint
CREATE INDEX "apply_submissions_time_idx" ON "apply_submissions" USING btree ("submitted_at","id");--> statement-breakpoint
ALTER TABLE "apply_files" ADD CONSTRAINT "apply_files_submission_id_apply_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."apply_submissions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apply_files_submission_idx" ON "apply_files" USING btree ("submission_id");