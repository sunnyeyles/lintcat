ALTER TABLE "reviews" ADD COLUMN "input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "cache_creation_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "cache_read_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "output_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "reviews" SET
	"input_tokens" = "spent"."input_tokens",
	"cache_creation_input_tokens" = "spent"."cache_creation_input_tokens",
	"cache_read_input_tokens" = "spent"."cache_read_input_tokens",
	"output_tokens" = "spent"."output_tokens"
FROM (
	SELECT
		"review_id",
		SUM("input_tokens")::integer AS "input_tokens",
		SUM("cache_creation_input_tokens")::integer AS "cache_creation_input_tokens",
		SUM("cache_read_input_tokens")::integer AS "cache_read_input_tokens",
		SUM("output_tokens")::integer AS "output_tokens"
	FROM "agent_runs"
	GROUP BY "review_id"
) AS "spent"
WHERE "reviews"."id" = "spent"."review_id";--> statement-breakpoint
DROP TABLE "agent_runs" CASCADE;--> statement-breakpoint
ALTER TABLE "findings" DROP COLUMN "agent";--> statement-breakpoint
ALTER TABLE "reviews" DROP COLUMN "agents";
