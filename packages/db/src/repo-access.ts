import { and, asc, eq, inArray, isNotNull, isNull, notInArray, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import {
  memberships,
  repoAccess,
  repos,
  users,
  type MembershipRole,
  type Repo,
  type RepoPermission,
} from "./schema";

// Derived, never stored: no membership, but a `repo_access` row on a live repo of the account.
export type AccessRole = MembershipRole | "collaborator";

export interface ReadableRepo {
  id: number;
  /** Organization owner, or `admin`/`maintain` on the repo. */
  isOwner: boolean;
}

/** The live repos the user may read: owners all, members public plus granted, collaborators granted only. */
export async function readableRepos(
  database: Database,
  { organizationId, userId, role }: { organizationId: number; userId: number; role: AccessRole },
): Promise<ReadableRepo[]> {
  const rows = await database
    .select({ id: repos.id, private: repos.private, permission: repoAccess.permission })
    .from(repos)
    .leftJoin(
      repoAccess,
      and(eq(repoAccess.repoId, repos.id), eq(repoAccess.userId, userId)),
    )
    .where(
      and(
        eq(repos.organizationId, organizationId),
        isNull(repos.removedAt),
        role === "owner"
          ? undefined
          : role === "collaborator"
            ? isNotNull(repoAccess.id)
            : or(eq(repos.private, false), isNotNull(repoAccess.id)),
      ),
    )
    .orderBy(asc(repos.id));
  return rows.map((row) => ({
    id: row.id,
    isOwner:
      role === "owner" || row.permission === "admin" || row.permission === "maintain",
  }));
}

/** Null permission deletes the row: the user has no access. */
export async function setRepoAccess(
  database: Database,
  { userId, repoId, permission }: { userId: number; repoId: number; permission: RepoPermission | null },
): Promise<void> {
  if (permission === null) {
    await database
      .delete(repoAccess)
      .where(and(eq(repoAccess.userId, userId), eq(repoAccess.repoId, repoId)));
    return;
  }
  await database
    .insert(repoAccess)
    .values({ userId, repoId, permission })
    .onConflictDoUpdate({
      target: [repoAccess.userId, repoAccess.repoId],
      set: { permission, syncedAt: sql`now()` },
    });
}

/** Makes the repo's rows exactly `grants`, keyed by GitHub user id; users never seen are skipped. */
export async function replaceRepoAccess(
  database: Database,
  repoId: number,
  grants: readonly { githubId: number; permission: RepoPermission }[],
): Promise<void> {
  const known =
    grants.length === 0
      ? []
      : await database
          .select({ id: users.id, githubId: users.githubId })
          .from(users)
          .where(inArray(users.githubId, grants.map((grant) => grant.githubId)));
  const byGithubId = new Map(known.map((user) => [user.githubId, user.id]));
  const kept: number[] = [];
  for (const grant of grants) {
    const userId = byGithubId.get(grant.githubId);
    if (userId === undefined) continue;
    kept.push(userId);
    await setRepoAccess(database, { userId, repoId, permission: grant.permission });
  }
  await database
    .delete(repoAccess)
    .where(
      and(
        eq(repoAccess.repoId, repoId),
        kept.length === 0 ? undefined : notInArray(repoAccess.userId, kept),
      ),
    );
}

/** Drops a user's rows on every repo of the organization, as when they leave it. */
export async function deleteOrganizationRepoAccess(
  database: Database,
  organizationId: number,
  githubUserId: number,
): Promise<void> {
  const user = database
    .select({ id: users.id })
    .from(users)
    .where(eq(users.githubId, githubUserId));
  const organizationRepos = database
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.organizationId, organizationId));
  await database
    .delete(repoAccess)
    .where(
      and(inArray(repoAccess.userId, user), inArray(repoAccess.repoId, organizationRepos)),
    );
}

/** The live private repos GitHub knows, which are the only ones a member needs a row for. */
export async function listPrivateRepos(
  database: Database,
  organizationId: number,
): Promise<Repo[]> {
  return database
    .select()
    .from(repos)
    .where(
      and(
        eq(repos.organizationId, organizationId),
        eq(repos.private, true),
        isNull(repos.removedAt),
        isNotNull(repos.githubRepoId),
      ),
    )
    .orderBy(asc(repos.id));
}

/** The organizations the user belongs to, with their role in each. */
export async function listUserMemberships(
  database: Database,
  githubUserId: number,
): Promise<{ userId: number; organizationId: number; role: MembershipRole }[]> {
  return database
    .select({
      userId: users.id,
      organizationId: memberships.organizationId,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(users.githubId, githubUserId))
    .orderBy(asc(memberships.organizationId));
}

/** Makes the user's rows in one account exactly `grants`; repos not mirrored yet are skipped. */
export async function replaceUserRepoAccess(
  database: Database,
  {
    userId,
    organizationId,
    grants,
  }: {
    userId: number;
    organizationId: number;
    grants: readonly { githubRepoId: number; permission: RepoPermission }[];
  },
): Promise<void> {
  const known =
    grants.length === 0
      ? []
      : await database
          .select({ id: repos.id, githubRepoId: repos.githubRepoId })
          .from(repos)
          .where(
            and(
              eq(repos.organizationId, organizationId),
              isNull(repos.removedAt),
              inArray(repos.githubRepoId, grants.map((grant) => grant.githubRepoId)),
            ),
          );
  const byGithubRepoId = new Map(known.map((repo) => [repo.githubRepoId, repo.id]));
  const kept: number[] = [];
  for (const grant of grants) {
    const repoId = byGithubRepoId.get(grant.githubRepoId);
    if (repoId === undefined) continue;
    kept.push(repoId);
    await setRepoAccess(database, { userId, repoId, permission: grant.permission });
  }
  const accountRepos = database
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.organizationId, organizationId));
  await database
    .delete(repoAccess)
    .where(
      and(
        eq(repoAccess.userId, userId),
        inArray(repoAccess.repoId, accountRepos),
        kept.length === 0 ? undefined : notInArray(repoAccess.repoId, kept),
      ),
    );
}

/** Accounts where the user holds repo rows but no membership: where they are a collaborator. */
export async function listCollaboratorOrganizationIds(
  database: Database,
  githubUserId: number,
): Promise<number[]> {
  const rows = await database
    .selectDistinct({ organizationId: repos.organizationId })
    .from(repoAccess)
    .innerJoin(users, eq(users.id, repoAccess.userId))
    .innerJoin(repos, eq(repos.id, repoAccess.repoId))
    .leftJoin(
      memberships,
      and(
        eq(memberships.userId, users.id),
        eq(memberships.organizationId, repos.organizationId),
      ),
    )
    .where(and(eq(users.githubId, githubUserId), isNull(memberships.id)))
    .orderBy(asc(repos.organizationId));
  return rows.map((row) => row.organizationId);
}
