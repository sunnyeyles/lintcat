import { and, eq, inArray, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "./client";
import { organizations, repos, type Organization, type Repo } from "./schema";

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
  { reinstall = false }: { reinstall?: boolean } = {},
): Promise<Organization> {
  const values = {
    githubAccountId: installation.accountId,
    accountType: installation.accountType,
    slug: installation.login.toLowerCase(),
    name: installation.login,
    installationId: installation.installationId,
    suspendedAt: installation.suspendedAt,
    ...(reinstall ? { uninstalledAt: null } : {}),
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

/** Soft: memberships, repos and reviews stay for a reinstall to bring back. */
export async function markUninstalled(
  database: Database,
  accountId: number,
): Promise<void> {
  await database
    .update(organizations)
    .set({
      installationId: null,
      uninstalledAt: sql`coalesce(${organizations.uninstalledAt}, now())`,
    })
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
        removedAt: null,
      },
    });
}

export async function removeRepositories(
  database: Database,
  organizationId: number,
  githubRepoIds: readonly number[],
): Promise<void> {
  if (githubRepoIds.length === 0) return;
  await markRemoved(
    database,
    and(
      eq(repos.organizationId, organizationId),
      inArray(repos.githubRepoId, [...githubRepoIds]),
    ),
  );
}

// Keeps the first removal time, so a redelivery changes nothing.
async function markRemoved(database: Database, where: SQL | undefined): Promise<void> {
  await database
    .update(repos)
    .set({ removedAt: sql`now()` })
    .where(and(where, isNull(repos.removedAt)));
}

export async function findRepoByGithubId(
  database: Database,
  githubRepoId: number,
): Promise<Repo | undefined> {
  const [row] = await database
    .select()
    .from(repos)
    .where(eq(repos.githubRepoId, githubRepoId))
    .limit(1);
  return row;
}

/** Follows a rename or visibility change of a repo the installation already reported. */
export async function updateRepository(
  database: Database,
  githubRepoId: number,
  changes: Partial<Pick<RepositoryInput, "owner" | "name" | "private">>,
): Promise<void> {
  await database.update(repos).set(changes).where(eq(repos.githubRepoId, githubRepoId));
}

export async function findOrganizationById(
  database: Database,
  id: number,
): Promise<Organization | undefined> {
  const [row] = await database
    .select()
    .from(organizations)
    .where(eq(organizations.id, id))
    .limit(1);
  return row;
}

export async function removeRepository(
  database: Database,
  githubRepoId: number,
): Promise<void> {
  await markRemoved(database, eq(repos.githubRepoId, githubRepoId));
}

/** Makes the organization's live repos exactly `repositories`, marking any others removed. */
export async function replaceRepositories(
  database: Database,
  organizationId: number,
  repositories: readonly RepositoryInput[],
): Promise<void> {
  await upsertRepositories(database, organizationId, repositories);
  const keep = repositories.map((repo) => repo.githubRepoId);
  await markRemoved(
    database,
    and(
      eq(repos.organizationId, organizationId),
      keep.length === 0
        ? undefined
        : or(isNull(repos.githubRepoId), notInArray(repos.githubRepoId, keep)),
    ),
  );
}
