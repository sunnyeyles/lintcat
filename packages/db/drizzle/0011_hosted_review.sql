CREATE TYPE "public"."review_job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'superseded');--> statement-breakpoint
CREATE TABLE "model_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"provider" text NOT NULL,
	"sealed_key" "bytea" NOT NULL,
	"last4" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_keys_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "review_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"pr_number" integer NOT NULL,
	"head_sha" text NOT NULL,
	"delivery_id" text,
	"status" "review_job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_jobs_delivery_id_unique" UNIQUE("delivery_id")
);
--> statement-breakpoint
ALTER TABLE "model_keys" ADD CONSTRAINT "model_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_jobs" ADD CONSTRAINT "review_jobs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "review_jobs_active_head_idx" ON "review_jobs" USING btree ("repo_id","pr_number","head_sha") WHERE "review_jobs"."status" in ('queued', 'running');--> statement-breakpoint
CREATE INDEX "review_jobs_claim_idx" ON "review_jobs" USING btree ("status","run_after");