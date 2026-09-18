CREATE TYPE "public"."index_status" AS ENUM('building', 'ready', 'failed', 'unsupported');--> statement-breakpoint
CREATE TABLE "index_builds" (
	"id" serial PRIMARY KEY NOT NULL,
	"repo_id" integer NOT NULL,
	"sha" text NOT NULL,
	"schema_version" integer DEFAULT 1 NOT NULL,
	"coverage" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	"build_ms" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_edges" (
	"index_id" integer NOT NULL,
	"src" integer NOT NULL,
	"dst" integer NOT NULL,
	"kind" text NOT NULL,
	"line" integer
);
--> statement-breakpoint
CREATE TABLE "index_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"index_id" integer NOT NULL,
	"path" text NOT NULL,
	"package_id" integer,
	"role" text NOT NULL,
	"language" text,
	"loc" integer,
	"owners" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"index_id" integer NOT NULL,
	"name" text NOT NULL,
	"root" text NOT NULL,
	"entry_points" text[] NOT NULL,
	"depends_on" text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "index_symbols" (
	"id" serial PRIMARY KEY NOT NULL,
	"index_id" integer NOT NULL,
	"file_id" integer NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"exported" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_index" (
	"repo_id" integer PRIMARY KEY NOT NULL,
	"current_index_id" integer,
	"status" "index_status" DEFAULT 'building' NOT NULL,
	"default_branch" text,
	"failure_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "index_builds" ADD CONSTRAINT "index_builds_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_edges" ADD CONSTRAINT "index_edges_index_id_index_builds_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."index_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_files" ADD CONSTRAINT "index_files_index_id_index_builds_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."index_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_files" ADD CONSTRAINT "index_files_package_id_index_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."index_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_packages" ADD CONSTRAINT "index_packages_index_id_index_builds_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."index_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_symbols" ADD CONSTRAINT "index_symbols_index_id_index_builds_id_fk" FOREIGN KEY ("index_id") REFERENCES "public"."index_builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "index_symbols" ADD CONSTRAINT "index_symbols_file_id_index_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."index_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_index" ADD CONSTRAINT "repo_index_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_index" ADD CONSTRAINT "repo_index_current_index_id_index_builds_id_fk" FOREIGN KEY ("current_index_id") REFERENCES "public"."index_builds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "index_edges_index_src_kind_idx" ON "index_edges" USING btree ("index_id","src","kind");--> statement-breakpoint
CREATE INDEX "index_edges_index_dst_kind_idx" ON "index_edges" USING btree ("index_id","dst","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "index_files_index_path_idx" ON "index_files" USING btree ("index_id","path");--> statement-breakpoint
CREATE INDEX "index_symbols_index_file_idx" ON "index_symbols" USING btree ("index_id","file_id");--> statement-breakpoint
CREATE INDEX "index_symbols_index_name_idx" ON "index_symbols" USING btree ("index_id","name");