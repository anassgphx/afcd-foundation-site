CREATE TABLE "apply_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"rubric_version_id" uuid NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"coi" jsonb,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'proposed' NOT NULL,
	"proposed_by" uuid,
	"decided_by" uuid,
	"decision_note" text DEFAULT '' NOT NULL,
	"notified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "apply_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"comments" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overall_comment" text DEFAULT '' NOT NULL,
	"recommendation" text,
	"total_bp" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"final_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_rubric_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"call_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"criteria" jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"settings" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"published_version_id" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD COLUMN "score_bp" integer;--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD COLUMN "score_reviews" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD COLUMN "disagreement" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apply_assignments" ADD CONSTRAINT "apply_assignments_submission_id_apply_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."apply_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_assignments" ADD CONSTRAINT "apply_assignments_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_assignments" ADD CONSTRAINT "apply_assignments_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_assignments" ADD CONSTRAINT "apply_assignments_rubric_version_id_apply_rubric_versions_id_fk" FOREIGN KEY ("rubric_version_id") REFERENCES "public"."apply_rubric_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_assignments" ADD CONSTRAINT "apply_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_decisions" ADD CONSTRAINT "apply_decisions_submission_id_apply_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."apply_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_decisions" ADD CONSTRAINT "apply_decisions_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_decisions" ADD CONSTRAINT "apply_decisions_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_decisions" ADD CONSTRAINT "apply_decisions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_reviews" ADD CONSTRAINT "apply_reviews_assignment_id_apply_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."apply_assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_rubric_versions" ADD CONSTRAINT "apply_rubric_versions_rubric_id_apply_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."apply_rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_rubric_versions" ADD CONSTRAINT "apply_rubric_versions_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_rubric_versions" ADD CONSTRAINT "apply_rubric_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_rubrics" ADD CONSTRAINT "apply_rubrics_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_rubrics" ADD CONSTRAINT "apply_rubrics_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apply_assignments_pair_uq" ON "apply_assignments" USING btree ("submission_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "apply_assignments_reviewer_idx" ON "apply_assignments" USING btree ("reviewer_id","status");--> statement-breakpoint
CREATE INDEX "apply_assignments_call_idx" ON "apply_assignments" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "apply_decisions_call_idx" ON "apply_decisions" USING btree ("call_id","status");--> statement-breakpoint
CREATE INDEX "apply_decisions_sub_idx" ON "apply_decisions" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_reviews_assignment_uq" ON "apply_reviews" USING btree ("assignment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_rubric_versions_num_uq" ON "apply_rubric_versions" USING btree ("rubric_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_rubrics_call_uq" ON "apply_rubrics" USING btree ("call_id");