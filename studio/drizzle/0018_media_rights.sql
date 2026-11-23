ALTER TABLE "media" ADD COLUMN "licence" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "rights_expires_on" date;