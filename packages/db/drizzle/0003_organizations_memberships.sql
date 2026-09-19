CREATE TYPE "public"."account_type" AS ENUM('organization', 'user');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"role" "membership_role" NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"github_account_id" integer NOT NULL,
	"account_type" "account_type" NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"installation_id" integer,
	"suspended_at" timestamp with time zone,
	"ingest_token" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_github_account_id_unique" UNIQUE("github_account_id"),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug"),
	CONSTRAINT "organizations_installation_id_unique" UNIQUE("installation_id"),
	CONSTRAINT "organizations_ingest_token_unique" UNIQUE("ingest_token")
);
--> statement-breakpoint
ALTER TABLE "repos" DROP CONSTRAINT "repos_team_id_teams_id_fk";
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_team_id_teams_id_fk";
--> statement-breakpoint
DROP TABLE "teams";--> statement-breakpoint
DROP INDEX "repos_team_owner_name_idx";--> statement-breakpoint
ALTER TABLE "repos" ADD COLUMN "organization_id" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_organization_idx" ON "memberships" USING btree ("user_id","organization_id");--> statement-breakpoint
ALTER TABLE "repos" ADD CONSTRAINT "repos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repos_organization_owner_name_idx" ON "repos" USING btree ("organization_id","owner","name");--> statement-breakpoint
ALTER TABLE "repos" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "team_id";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role";--> statement-breakpoint
DROP TYPE "public"."role";