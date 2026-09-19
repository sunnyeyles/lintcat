CREATE TYPE "public"."repo_permission" AS ENUM('admin', 'maintain', 'write', 'triage', 'read');--> statement-breakpoint
CREATE TABLE "repo_access" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"repo_id" integer NOT NULL,
	"permission" "repo_permission" NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repo_access" ADD CONSTRAINT "repo_access_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_access" ADD CONSTRAINT "repo_access_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_access_user_repo_idx" ON "repo_access" USING btree ("user_id","repo_id");