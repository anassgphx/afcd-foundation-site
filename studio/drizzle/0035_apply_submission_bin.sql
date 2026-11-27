ALTER TABLE "apply_submissions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD COLUMN "deleted_by" uuid;--> statement-breakpoint
ALTER TABLE "apply_submissions" ADD CONSTRAINT "apply_submissions_deleted_by_users_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;