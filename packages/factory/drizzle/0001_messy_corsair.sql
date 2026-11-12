CREATE TYPE "public"."factory_lesson_status" AS ENUM('proposed', 'retired');--> statement-breakpoint
CREATE TABLE "factory_lessons" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"target" text NOT NULL,
	"title" text NOT NULL,
	"root_cause" text NOT NULL,
	"proposal" text NOT NULL,
	"confidence" real NOT NULL,
	"evidence_run_ids" jsonb NOT NULL,
	"occurrences" integer NOT NULL,
	"status" "factory_lesson_status" DEFAULT 'proposed' NOT NULL,
	"retired_reason" text,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "factory_lessons_status_idx" ON "factory_lessons" USING btree ("status","expires_at");