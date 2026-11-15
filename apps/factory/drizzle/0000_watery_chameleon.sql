CREATE TYPE "public"."factory_run_status" AS ENUM('draft', 'awaiting_approval', 'queued', 'running', 'verifying', 'delivered', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "factory_commands" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"stage" text NOT NULL,
	"name" text NOT NULL,
	"command" text NOT NULL,
	"cwd" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"exit_code" integer NOT NULL,
	"timed_out" boolean NOT NULL,
	"error_category" text,
	"output_hash" text NOT NULL,
	"output" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_effects" (
	"key" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"kind" text NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"stage" text,
	"agent_id" text,
	"workflow_version" text,
	"prompt_version" text,
	"tool_version" text,
	"repository_sha" text,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "factory_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"repo_path" text NOT NULL,
	"title" text NOT NULL,
	"status" "factory_run_status" DEFAULT 'draft' NOT NULL,
	"stage" text,
	"profile" text,
	"workflow_version" text,
	"contract" jsonb NOT NULL,
	"contract_hash" text,
	"base_sha" text,
	"branch" text,
	"worktree_path" text,
	"checkpoint" jsonb,
	"agent_session_id" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"recoveries" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"cancel_requested" boolean DEFAULT false NOT NULL,
	"outcome" jsonb,
	"blocker" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "factory_commands" ADD CONSTRAINT "factory_commands_run_id_factory_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."factory_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_effects" ADD CONSTRAINT "factory_effects_run_id_factory_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."factory_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "factory_events" ADD CONSTRAINT "factory_events_run_id_factory_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."factory_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "factory_commands_run_idx" ON "factory_commands" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "factory_events_run_idx" ON "factory_events" USING btree ("run_id","id");--> statement-breakpoint
CREATE INDEX "factory_runs_status_lease_idx" ON "factory_runs" USING btree ("status","lease_expires_at");