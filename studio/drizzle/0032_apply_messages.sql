CREATE TABLE "apply_message_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"count" integer NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"queued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_message_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid,
	"key" text NOT NULL,
	"variants" jsonb NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "apply_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_id" uuid NOT NULL,
	"submission_id" uuid NOT NULL,
	"decision_id" uuid,
	"batch_id" uuid,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"to_email" text NOT NULL,
	"lang" text DEFAULT 'en' NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"queued_by" uuid,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apply_calls" ADD COLUMN "receipt_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "apply_message_batches" ADD CONSTRAINT "apply_message_batches_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_message_batches" ADD CONSTRAINT "apply_message_batches_queued_by_users_id_fk" FOREIGN KEY ("queued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_message_templates" ADD CONSTRAINT "apply_message_templates_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_message_templates" ADD CONSTRAINT "apply_message_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_messages" ADD CONSTRAINT "apply_messages_call_id_apply_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."apply_calls"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_messages" ADD CONSTRAINT "apply_messages_submission_id_apply_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."apply_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_messages" ADD CONSTRAINT "apply_messages_decision_id_apply_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."apply_decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_messages" ADD CONSTRAINT "apply_messages_batch_id_apply_message_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."apply_message_batches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apply_messages" ADD CONSTRAINT "apply_messages_queued_by_users_id_fk" FOREIGN KEY ("queued_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "apply_message_templates_uq" ON "apply_message_templates" USING btree ("call_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "apply_messages_dedupe_uq" ON "apply_messages" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "apply_messages_queue_idx" ON "apply_messages" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "apply_messages_call_idx" ON "apply_messages" USING btree ("call_id","created_at");--> statement-breakpoint
CREATE INDEX "apply_messages_sub_idx" ON "apply_messages" USING btree ("submission_id");