import { and, eq, inArray, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import { organizations, repos, type Organization } from "./schema";

/** One GitHub App installation as its webhook payloads describe it. */
export interface InstallationInput {
  installationId: number;
  accountId: number;
  accountType: Organization["accountType"];
  login: string;
  suspendedAt: Date | null;
}

export interface RepositoryInput {
  githubRepoId: number;
  owner: string;
  name: string;
  private: boolean;
}

/** Keyed on the account id, so a redelivered or reordered event lands on the same row. */
export async function upsertInstallation(
  database: Database,
  installation: InstallationInput,
): Promise<Organization> {
  const values = {
    githubAccountId: installation.accountId,
    accountType: installation.accountType,
    slug: installation.login.toLowerCase(),
    name: installation.login,
    installationId: installation.installationId,
    suspendedAt: installation.suspendedAt,
  };
  const rows = await database
    .insert(organizations)
    .values(values)
    .onConflictDoUpdate({ target: organizations.githubAccountId, set: values })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("organization upsert returned no row");
  return row;
}

/** Cascades to the organization's memberships, repos and their reviews. */
export async function deleteInstallation(
  database: Database,
  accountId: number,
): Promise<void> {
  await database
    .delete(organizations)
    .where(eq(organizations.githubAccountId, accountId));
}

export async function setInstallationSuspended(
  database: Database,
  accountId: number,
  suspendedAt: Date | null,
): Promise<void> {
  await database
    .update(organizations)
    .set({ suspendedAt })
    .where(eq(organizations.githubAccountId, accountId));
}

export async function upsertRepositories(
  database: Database,
  organizationId: number,
  repositories: readonly RepositoryInput[],
): Promise<void> {
  if (repositories.length === 0) return;
  // A repo ingest created before the install has no GitHub id yet; claim it so its reviews stay.
  for (const repo of repositories) {
    await database
      .update(repos)
      .set({ githubRepoId: repo.githubRepoId })
      .where(
        and(
          eq(repos.organizationId, organizationId),
          eq(repos.owner, repo.owner),
          eq(repos.name, repo.name),
          isNull(repos.githubRepoId),
        ),
      );
  }
  await database
    .insert(repos)
    .values(repositories.map((repo) => ({ organizationId, ...repo })))
    .onConflictDoUpdate({
      target: repos.githubRepoId,
      set: {
        organizationId,
        owner: sql`excluded.owner`,
        name: sql`excluded.name`,
        private: sql`excluded.private`,
      },
    });
}

export async function removeRepositories(
  database: Database,
  organizationId: number,
  githubRepoIds: readonly number[],
): Promise<void> {
  if (githubRepoIds.length === 0) return;
  await database
    .delete(repos)
    .where(
      and(
        eq(repos.organizationId, organizationId),
        inArray(repos.githubRepoId, [...githubRepoIds]),
      ),
    );
}

/** Makes the organization's repos exactly `repositories`, deleting any others. */
export async function replaceRepositories(
  database: Database,
  organizationId: number,
  repositories: readonly RepositoryInput[],
): Promise<void> {
  await upsertRepositories(database, organizationId, repositories);
  const keep = repositories.map((repo) => repo.githubRepoId);
  await database
    .delete(repos)
    .where(
      and(
        eq(repos.organizationId, organizationId),
        keep.length === 0
          ? undefined
          : or(isNull(repos.githubRepoId), notInArray(repos.githubRepoId, keep)),
      ),
    );
}
