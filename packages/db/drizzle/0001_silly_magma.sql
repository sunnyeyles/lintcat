CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"review_id" integer NOT NULL,
	"agent" text NOT NULL,
	"duration_ms" integer NOT NULL,
	"finding_count" integer NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_creation_input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "duration_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_review_id_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_review_agent_idx" ON "agent_runs" USING btree ("review_id","agent");