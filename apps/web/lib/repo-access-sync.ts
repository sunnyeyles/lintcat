import {
  listCollaboratorOrganizationIds,
  listInstalledOrganizations,
  listPrivateRepos,
  listUserMemberships,
  replaceUserRepoAccess,
  setRepoAccess,
  upsertAccountUser,
  type GithubAccount,
  type Organization,
  type Repo,
  type RepoPermission,
} from "@pr-review/db";
import type { GithubAppClient, GithubUserClient } from "@pr-review/github";

import { installedAccount, type MembershipSyncDeps } from "@/lib/membership-sync";
import { reconcile } from "@/lib/reconcile";

export interface RepoAccessLookup {
  organization: Organization;
  repo: Repo;
  permission: RepoPermission | null;
}

type SyncDeps = MembershipSyncDeps & { github: GithubAppClient };

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

interface RepoCandidate {
  organization: Organization;
  repo: Repo;
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

  const candidates: RepoCandidate[] = [];
  for (const organization of organizations) {
    for (const repo of await listPrivateRepos(deps.database, organization.id)) {
      candidates.push({ organization, repo });
    }
  }

  await reconcile<RepoCandidate, RepoAccessLookup>({
    database: deps.database,
    logger: deps.logger,
    skippedEvent: "repo_access.skipped",
    candidates,
    fields: ({ organization, repo }) => ({
      source,
      organization: organization.slug,
      repo: `${repo.owner}/${repo.name}`,
      githubUserId: account.githubId,
      login: account.login,
    }),
    order: ({ repo }) => repo.id,
    async lookup({ organization, repo }) {
      return {
        organization,
        repo,
        permission: await lookupRepoPermission(deps.github, organization, repo, account),
      };
    },
    apply: (database, entry) =>
      applyRepoAccess({ ...deps, database }, userId, account, entry, source),
  });
}

interface CollaboratorGrants {
  organization: Organization;
  grants: { githubRepoId: number; permission: RepoPermission }[];
}

// One call for the user's installations, then one per account they collaborate in but don't belong to.
export async function syncSignInCollaboratorAccess(
  deps: MembershipSyncDeps & { userGithub?: GithubUserClient },
  account: GithubAccount,
): Promise<void> {
  const source = "sign_in";
  const identity = { source, githubUserId: account.githubId, login: account.login };
  const { userGithub } = deps;
  if (!userGithub) {
    deps.logger.info("repo_access.skipped", { ...identity, reason: "no_user_token" });
    return;
  }
  const listed = new Set((await userGithub.listInstallations()).map((entry) => entry.id));
  const memberOf = new Set(
    (await listUserMemberships(deps.database, account.githubId)).map(
      (membership) => membership.organizationId,
    ),
  );
  const stored = new Set(await listCollaboratorOrganizationIds(deps.database, account.githubId));
  // A suspended account keeps its rows; authorize already shuts it.
  const candidates = (await listInstalledOrganizations(deps.database)).filter(
    (organization) =>
      !organization.suspendedAt &&
      !memberOf.has(organization.id) &&
      (listed.has(organization.installationId!) || stored.has(organization.id)),
  );
  if (candidates.length === 0) return;
  const user = await upsertAccountUser(deps.database, account);

  await reconcile<Organization, CollaboratorGrants>({
    database: deps.database,
    logger: deps.logger,
    skippedEvent: "repo_access.skipped",
    candidates,
    fields: (organization) => ({ ...identity, organization: organization.slug }),
    order: ({ organization }) => organization.id,
    async lookup(organization) {
      if (!listed.has(organization.installationId!)) return { organization, grants: [] };
      const repositories = await userGithub.listInstallationRepositories(
        organization.installationId!,
      );
      return {
        organization,
        grants: repositories.map((repo) => ({
          githubRepoId: repo.id,
          permission: repo.permission,
        })),
      };
    },
    async apply(database, { organization, grants }) {
      await replaceUserRepoAccess(database, {
        userId: user.id,
        organizationId: organization.id,
        grants,
      });
      deps.logger.info("repo_access.collaborator_synced", {
        ...identity,
        organization: organization.slug,
        repos: grants.length,
      });
    },
  });
}
