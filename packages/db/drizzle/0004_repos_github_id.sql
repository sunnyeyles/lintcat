ALTER TABLE "repos" ADD COLUMN "github_repo_id" bigint;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_github_repo_id_unique" UNIQUE("github_repo_id");