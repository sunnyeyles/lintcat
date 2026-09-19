ALTER TABLE "organizations" ADD COLUMN "uninstalled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "removed_at" timestamp with time zone;