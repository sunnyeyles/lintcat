import {
  listInstalledOrganizations,
  listPrivateRepos,
  listUserMemberships,
  setRepoAccess,
  type GithubAccount,
  type Organization,
  type Repo,
  type RepoPermission,
} from "@pr-review/db";
import type { GithubAppClient } from "@pr-review/github";
import { errorMessage } from "@pr-review/logging";

import { installedAccount, type MembershipSyncDeps } from "@/lib/membership-sync";

export interface RepoAccessLookup {
  organization: Organization;
  repo: Repo;
  permission: RepoPermission | null;
}

type SyncDeps = MembershipSyncDeps & { github: GithubAppClient };

const LOOKUP_CONCURRENCY = 8;

/** The user's current permission on one repo; null is no access. */
export async function lookupRepoPermission(
  github: GithubAppClient,
  organization: Organization,
  repo: Repo,
  account: GithubAccount,
): Promise<RepoPermission | null> {
  const installed = installedAccount(organization);
  if (!installed) throw new Error(`organization ${organization.slug} is not installed`);
  const collaborator = await github.getRepositoryPermission(
    installed.installationId,
    repo.owner,
    repo.name,
    account.login,
  );
  // A login can have changed hands; only the id identifies the user.
  return collaborator?.id === account.githubId ? collaborator.permission : null;
}

export async function applyRepoAccess(
  { database, logger }: MembershipSyncDeps,
  userId: number,
  account: GithubAccount,
  { organization, repo, permission }: RepoAccessLookup,
  source: string,
): Promise<void> {
  await setRepoAccess(database, { userId, repoId: repo.id, permission });
  logger.info(permission ? "repo_access.granted" : "repo_access.revoked", {
    source,
    organization: organization.slug,
    repo: `${repo.owner}/${repo.name}`,
    repoId: repo.id,
    githubUserId: account.githubId,
    login: account.login,
    ...(permission ? { permission } : {}),
  });
}

// One call per private repo in each installed organization the user is a plain member of.
export async function syncSignInRepoAccess(
  deps: SyncDeps,
  account: GithubAccount,
): Promise<void> {
  const source = "sign_in";
  const memberOf = (await listUserMemberships(deps.database, account.githubId)).filter(
    (membership) => membership.role === "member",
  );
  if (memberOf.length === 0) return;
  const userId = memberOf[0]!.userId;
  const organizations = (await listInstalledOrganizations(deps.database)).filter(
    (organization) =>
      !organization.suspendedAt &&
      memberOf.some((membership) => membership.organizationId === organization.id),
  );

  const pending: { organization: Organization; repo: Repo }[] = [];
  for (const organization of organizations) {
    for (const repo of await listPrivateRepos(deps.database, organization.id)) {
      pending.push({ organization, repo });
    }
  }

  const found: RepoAccessLookup[] = [];
  const lookup = async ({ organization, repo }: { organization: Organization; repo: Repo }) => {
    try {
      found.push({
        organization,
        repo,
        permission: await lookupRepoPermission(deps.github, organization, repo, account),
      });
    } catch (error) {
      deps.logger.error("repo_access.skipped", {
        source,
        organization: organization.slug,
        repo: `${repo.owner}/${repo.name}`,
        githubUserId: account.githubId,
        login: account.login,
        reason: "github_lookup_failed",
        error: errorMessage(error),
      });
    }
  };
  for (let start = 0; start < pending.length; start += LOOKUP_CONCURRENCY) {
    await Promise.all(pending.slice(start, start + LOOKUP_CONCURRENCY).map(lookup));
  }

  found.sort((a, b) => a.repo.id - b.repo.id);
  await deps.database.transaction(async (tx) => {
    for (const entry of found) {
      await applyRepoAccess({ ...deps, database: tx }, userId, account, entry, source);
    }
  });
}
