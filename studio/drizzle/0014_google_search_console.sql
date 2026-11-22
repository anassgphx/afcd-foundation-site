CREATE TABLE "api_usage" (
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"day" text NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_usage_provider_endpoint_day_pk" PRIMARY KEY("provider","endpoint","day")
);
--> statement-breakpoint
CREATE TABLE "google_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"account_email" text,
	"scopes" text DEFAULT '' NOT NULL,
	"property" text,
	"permission_level" text,
	"refresh_token_enc" text NOT NULL,
	"access_token_enc" text,
	"access_expires_at" timestamp with time zone,
	"connected_by" uuid,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_synced_date" text,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property" text NOT NULL,
	"search_type" text DEFAULT 'web' NOT NULL,
	"dims" text NOT NULL,
	"date" text NOT NULL,
	"query" text DEFAULT '' NOT NULL,
	"page" text DEFAULT '' NOT NULL,
	"country" text DEFAULT '' NOT NULL,
	"device" text DEFAULT '' NOT NULL,
	"clicks" integer NOT NULL,
	"impressions" integer NOT NULL,
	"ctr" text NOT NULL,
	"position" text NOT NULL,
	"data_state" text DEFAULT 'final' NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"code_verifier_enc" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 4 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"result" jsonb,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "url_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"property" text NOT NULL,
	"url" text NOT NULL,
	"verdict" text,
	"coverage_state" text,
	"indexing_state" text,
	"robots_txt_state" text,
	"page_fetch_state" text,
	"last_crawl_time" text,
	"google_canonical" text,
	"user_canonical" text,
	"raw" jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_connections" ADD CONSTRAINT "google_connections_connected_by_users_id_fk" FOREIGN KEY ("connected_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_states" ADD CONSTRAINT "oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_jobs" ADD CONSTRAINT "seo_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "url_inspections" ADD CONSTRAINT "url_inspections_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "google_connections_provider_uq" ON "google_connections" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_metrics_uq" ON "gsc_metrics" USING btree ("property","search_type","dims","date","query","page","country","device");--> statement-breakpoint
CREATE INDEX "gsc_metrics_lookup_idx" ON "gsc_metrics" USING btree ("property","dims","date");--> statement-breakpoint
CREATE INDEX "seo_jobs_status_idx" ON "seo_jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "url_inspections_url_idx" ON "url_inspections" USING btree ("property","url","created_at");