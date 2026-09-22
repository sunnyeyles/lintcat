CREATE TYPE "public"."repo_review_mode" AS ENUM('off', 'label', 'every_pr');--> statement-breakpoint
CREATE TABLE "repo_settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"mode" "repo_review_mode" DEFAULT 'label' NOT NULL,
	"model" text,
	"fixes" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_settings_repo_id_unique" UNIQUE("repo_id")
);
--> statement-breakpoint
ALTER TABLE "repo_settings" ADD CONSTRAINT "repo_settings_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;