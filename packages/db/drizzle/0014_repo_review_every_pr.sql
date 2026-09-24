ALTER TABLE "repo_settings" ALTER COLUMN "mode" SET DEFAULT 'every_pr';--> statement-breakpoint
-- Repos already installed keep the label mode they had; only new ones review every pull request.
INSERT INTO "repo_settings" ("repo_id", "mode")
SELECT "id", 'label' FROM "repos"
WHERE "id" NOT IN (SELECT "repo_id" FROM "repo_settings");
