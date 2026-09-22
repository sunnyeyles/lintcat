import { eq, sql } from "drizzle-orm";

import type { Database } from "./client";
import { repoSettings, type RepoReviewMode, type RepoSettings } from "./schema";

/** What a repo without a row gets: reviewed on the `ai-review` label, no model override, no fixes. */
export const DEFAULT_REPO_SETTINGS: EffectiveRepoSettings = {
  mode: "label",
  model: null,
  fixes: false,
};

export interface EffectiveRepoSettings {
  mode: RepoReviewMode;
  model: string | null;
  fixes: boolean;
}

export interface RepoSettingsInput {
  mode: RepoReviewMode;
  model: string | null;
  fixes: boolean;
}

export async function findRepoSettings(
  database: Database,
  repoId: number,
): Promise<RepoSettings | undefined> {
  const [row] = await database
    .select()
    .from(repoSettings)
    .where(eq(repoSettings.repoId, repoId))
    .limit(1);
  return row;
}

/** A repo with no row gets the defaults, matching #176's label-triggered behaviour. */
export async function effectiveRepoSettings(
  database: Database,
  repoId: number,
): Promise<EffectiveRepoSettings> {
  const row = await findRepoSettings(database, repoId);
  if (!row) return DEFAULT_REPO_SETTINGS;
  return { mode: row.mode, model: row.model, fixes: row.fixes };
}

export async function saveRepoSettings(
  database: Database,
  repoId: number,
  input: RepoSettingsInput,
): Promise<RepoSettings> {
  const values = { repoId, ...input };
  const [row] = await database
    .insert(repoSettings)
    .values(values)
    .onConflictDoUpdate({
      target: repoSettings.repoId,
      set: { ...input, updatedAt: sql`now()` },
    })
    .returning();
  if (!row) throw new Error("repo settings upsert returned no row");
  return row;
}
