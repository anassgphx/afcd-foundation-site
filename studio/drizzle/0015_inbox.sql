-- 0015 Inbox: reply workflow (new, in_progress, replied, closed) with separate spam/archive/read flags, personal stars,
-- an activity table for notes and changes, and a closed-message retention setting.
-- Recovery: see drizzle/recovery/0015_inbox_down.sql (restores the enum and status values; the new tables are dropped).
CREATE TABLE "submission_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"actor_id" uuid,
	"kind" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_stars" (
	"submission_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submission_stars_submission_id_user_id_pk" PRIMARY KEY("submission_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "form_submissions" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "form_submissions" ALTER COLUMN "status" SET DATA TYPE text USING "status"::text;--> statement-breakpoint
ALTER TABLE "form_submissions" ALTER COLUMN "status" SET DEFAULT 'new';--> statement-breakpoint
ALTER TABLE "form_settings" ADD COLUMN "closed_retention_months" integer;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "spam" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "spam_reason" text;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "read_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "form_submissions" ADD COLUMN "closed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_events" ADD CONSTRAINT "submission_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_stars" ADD CONSTRAINT "submission_stars_submission_id_form_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."form_submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_stars" ADD CONSTRAINT "submission_stars_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "submission_events_sub_idx" ON "submission_events" USING btree ("submission_id","created_at");--> statement-breakpoint
CREATE INDEX "form_submissions_inbox_idx" ON "form_submissions" USING btree ("form_key","spam","archived_at","read_at");--> statement-breakpoint
-- Data: the old enum mixed workflow and spam. done → closed; spam becomes a flag (workflow back to new);
-- messages that already existed count as read, so the new unread badge starts from real new mail only.
UPDATE "form_submissions" SET "status" = 'closed', "closed_at" = "updated_at" WHERE "status" = 'done';--> statement-breakpoint
UPDATE "form_submissions" SET "spam" = true, "spam_reason" = 'legacy', "status" = 'new' WHERE "status" = 'spam';--> statement-breakpoint
UPDATE "form_submissions" SET "read_at" = "updated_at" WHERE "status" <> 'new' OR "form_key" <> 'contact';--> statement-breakpoint
INSERT INTO "submission_events" ("submission_id", "kind", "body", "created_at") SELECT "id", 'note', "note", "updated_at" FROM "form_submissions" WHERE "note" <> '';--> statement-breakpoint
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_status_ck" CHECK ("status" IN ('new', 'in_progress', 'replied', 'closed'));--> statement-breakpoint
DROP TYPE "public"."submission_status";