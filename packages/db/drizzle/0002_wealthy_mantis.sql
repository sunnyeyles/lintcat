ALTER TABLE "findings" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "ingest_token" text;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_repo_pr_head_sha_idx" ON "reviews" USING btree ("repo_id","pr_number","head_sha");--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_ingest_token_unique" UNIQUE("ingest_token");