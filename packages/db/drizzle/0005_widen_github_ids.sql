ALTER TABLE "organizations" ALTER COLUMN "github_account_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "organizations" ALTER COLUMN "installation_id" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "github_id" SET DATA TYPE bigint;