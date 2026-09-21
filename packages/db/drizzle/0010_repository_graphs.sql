CREATE TABLE "repository_graphs" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"base_sha" text NOT NULL,
	"snapshot" "bytea" NOT NULL,
	"file_count" integer NOT NULL,
	"edge_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "base_sha" text;--> statement-breakpoint
ALTER TABLE "reviews" ADD COLUMN "changed_files" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "repository_graphs" ADD CONSTRAINT "repository_graphs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_graphs_repo_base_sha_idx" ON "repository_graphs" USING btree ("repo_id","base_sha");