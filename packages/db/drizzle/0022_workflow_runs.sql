CREATE TABLE "workflow_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"github_job_id" bigint NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"conclusion" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"runner_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_jobs_github_job_id_unique" UNIQUE("github_job_id")
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"github_run_id" bigint NOT NULL,
	"run_attempt" integer NOT NULL,
	"workflow_id" bigint NOT NULL,
	"workflow_name" text NOT NULL,
	"event" text NOT NULL,
	"head_branch" text,
	"head_sha" text NOT NULL,
	"pr_number" integer,
	"status" text NOT NULL,
	"conclusion" text,
	"run_started_at" timestamp with time zone NOT NULL,
	"github_updated_at" timestamp with time zone NOT NULL,
	"html_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_settings" ADD COLUMN "ci_insights" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_jobs" ADD CONSTRAINT "workflow_jobs_run_id_workflow_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."workflow_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workflow_jobs_run_idx" ON "workflow_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_github_run_attempt_idx" ON "workflow_runs" USING btree ("github_run_id","run_attempt");--> statement-breakpoint
CREATE INDEX "workflow_runs_repo_started_idx" ON "workflow_runs" USING btree ("repo_id","run_started_at");