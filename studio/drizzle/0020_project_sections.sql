ALTER TABLE "projects" ADD COLUMN "program_objectives" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "activity_items" jsonb DEFAULT '[]'::jsonb NOT NULL;