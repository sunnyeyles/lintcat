CREATE TABLE "run_trace_files" (
	"run_id" text NOT NULL,
	"file_name" text NOT NULL,
	"text" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_trace_files_run_id_file_name_pk" PRIMARY KEY("run_id","file_name")
);
--> statement-breakpoint
CREATE TABLE "run_traces" (
	"run_id" text PRIMARY KEY NOT NULL,
	"title" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_trace_files" ADD CONSTRAINT "run_trace_files_run_id_run_traces_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."run_traces"("run_id") ON DELETE cascade ON UPDATE no action;