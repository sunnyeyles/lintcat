import {
  findOrganizationByAccountId,
  findOrganizationById,
  findRepoByGithubId,
  markUninstalled,
  removeRepositories,
  removeRepository,
  replaceRepoAccess,
  setInstallationSuspended,
  updateRepository,
  upsertAccountUser,
  upsertInstallation,
  upsertRepositories,
  type GithubAccount,
  type InstallationInput,
  type Organization,
  type RepoPermission,
  type RepositoryInput,
} from "@pr-review/db";
import { errorMessage } from "@pr-review/logging";

import { followRename, installOrganization, type InstallationDeps } from "@/lib/installation";
import {
  applyMembership,
  installedAccount,
  lookupMembers,
  lookupMembership,
  replaceMembers,
} from "@/lib/membership-sync";
import { applyRepoAccess, lookupRepoPermission } from "@/lib/repo-access-sync";

/** A GitHub account as an event names it: its id is the identity, its login taken as current. */
export interface AccountRef {
  accountId: number;
  login: string;
}

interface RepositoryRef {
  githubRepoId: number;
  owner: AccountRef;
  name: string;
}

export type RepositoryChange = "renamed" | "privatized" | "publicized" | "transferred" | "deleted";

/** `source` names where the event came from, for logs only. */
export type InstallationEvent = { source: string } & (
  | {
      kind: "installed" | "uninstalled" | "suspended" | "unsuspended" | "permissions_accepted";
      installation: InstallationInput;
    }
  | {
      kind: "repositories_changed";
      installation: InstallationInput;
      added: RepositoryInput[];
      removed: number[];
    }
  | { kind: "account_renamed"; account: AccountRef }
  | { kind: "member_changed"; account: AccountRef; user: GithubAccount; githubRepoId?: number }
  | { kind: "repository_changed"; change: RepositoryChange; repository: RepositoryRef }
);

/** Mirrors one change on GitHub; false when there was nothing to act on. */
export async function applyInstallationEvent(
  deps: InstallationDeps,
  event: InstallationEvent,
): Promise<boolean> {
  switch (event.kind) {
    case "repositories_changed":
      return onRepositoriesChanged(deps, event);
    case "account_renamed":
      return onAccountRenamed(deps, event.account, event.source);
    case "member_changed":
      return onMemberChanged(deps, event);
    case "repository_changed":
      return onRepositoryChanged(deps, event.change, event.repository, event.source);
    default:
      return onInstallation(deps, event.kind, event.installation, event.source);
  }
}

async function onInstallation(
  deps: InstallationDeps,
  kind: "installed" | "uninstalled" | "suspended" | "unsuspended" | "permissions_accepted",
  installation: InstallationInput,
  source: string,
): Promise<boolean> {
  const { database, github } = deps;
  switch (kind) {
    case "installed":
      await installOrganization(deps, installation, source);
      return true;
    case "uninstalled":
      await database.transaction(async (tx) => {
        await followRename(deps, tx, installation, source);
        await markUninstalled(tx, installation.accountId);
      });
      return true;
    case "suspended":
      await database.transaction(async (tx) => {
        await followRename(deps, tx, installation, source);
        await setInstallationSuspended(
          tx,
          installation.accountId,
          installation.suspendedAt ?? new Date(),
        );
      });
      return true;
    case "permissions_accepted":
      return database.transaction((tx) => followRename(deps, tx, installation, source));
    case "unsuspended": {
      // No deliveries arrive while suspended, so members may have drifted.
      const members = await lookupMembers(github, installation);
      await database.transaction(async (tx) => {
        await followRename(deps, tx, installation, source);
        await setInstallationSuspended(tx, installation.accountId, null);
        const organization = await findOrganizationByAccountId(tx, installation.accountId);
        if (organization && !organization.uninstalledAt) {
          await replaceMembers({ ...deps, database: tx }, organization, members, source);
        }
      });
      return true;
    }
  }
}

async function onRepositoriesChanged(
  deps: InstallationDeps,
  event: Extract<InstallationEvent, { kind: "repositories_changed" }>,
): Promise<boolean> {
  const { database } = deps;
  const { installation, source } = event;
  // Only `installed` brings an uninstalled organization back, so a late delivery cannot.
  const existing = await findOrganizationByAccountId(database, installation.accountId);
  if (existing?.uninstalledAt) return false;
  // A missed install leaves no organization; set it up whole so it has an owner.
  if (!existing) {
    await installOrganization(deps, installation, source);
    return true;
  }
  await database.transaction(async (tx) => {
    await followRename(deps, tx, installation, source);
    const organization = await upsertInstallation(tx, installation);
    await upsertRepositories(tx, organization.id, event.added);
    await removeRepositories(tx, organization.id, event.removed);
  });
  return true;
}

async function onAccountRenamed(
  deps: InstallationDeps,
  account: AccountRef,
  source: string,
): Promise<boolean> {
  const renamed = await deps.database.transaction((tx) =>
    followRename(deps, tx, account, source),
  );
  if (!renamed) {
    deps.logger.info("organization.rename_skipped", {
      source,
      githubAccountId: account.accountId,
      login: account.login,
      reason: "unchanged_or_not_installed",
    });
  }
  return renamed;
}

// The event's role is not trusted: GitHub is asked for the current one, so reordered deliveries converge.
async function onMemberChanged(
  deps: InstallationDeps,
  event: Extract<InstallationEvent, { kind: "member_changed" }>,
): Promise<boolean> {
  const { source, user: account } = event;
  const organization = await findOrganizationByAccountId(deps.database, event.account.accountId);
  const installed = organization && installedAccount(organization);
  const skip = (reason: string) => {
    deps.logger.info("membership.skipped", {
      source,
      organization: event.account.login.toLowerCase(),
      githubUserId: account.githubId,
      login: account.login,
      reason,
    });
    return false;
  };
  if (!organization || !installed) return skip("organization_not_installed");
  if (organization.suspendedAt) return skip("installation_suspended");

  const decision = await lookupMembership(deps.github, installed, account);
  const repo =
    event.githubRepoId === undefined
      ? undefined
      : await findRepoByGithubId(deps.database, event.githubRepoId);
  const tracked = repo && repo.organizationId === organization.id && !repo.removedAt;
  // Asked whatever the membership: an outside collaborator holds the repo without one.
  const permission = tracked
    ? await lookupRepoPermission(deps.github, organization, repo, account)
    : undefined;
  await deps.database.transaction(async (tx) => {
    const txDeps = { ...deps, database: tx };
    await applyMembership(txDeps, organization, { account, decision }, source);
    if (!tracked || permission === undefined) return;
    const { id: userId } = await upsertAccountUser(tx, account);
    await applyRepoAccess(txDeps, userId, account, { organization, repo, permission }, source);
  });
  return true;
}

// Each change writes only its own field, so a late delivery of another cannot undo it.
async function onRepositoryChanged(
  deps: InstallationDeps,
  change: RepositoryChange,
  repository: RepositoryRef,
  source: string,
): Promise<boolean> {
  const { githubRepoId, owner, name } = repository;
  const fields = { source, githubRepoId, repo: `${owner.login}/${name}` };
  const existing = await findRepoByGithubId(deps.database, githubRepoId);
  const organization = existing && (await findOrganizationById(deps.database, existing.organizationId));
  if (!existing || !organization) {
    deps.logger.info("repository.skipped", { ...fields, reason: "repository_not_tracked" });
    return false;
  }
  const { database } = deps;

  switch (change) {
    case "renamed":
      await updateRepository(database, githubRepoId, { owner: owner.login, name });
      break;
    case "publicized":
      await updateRepository(database, githubRepoId, { private: false });
      break;
    case "privatized": {
      const readers = await listReaders(deps, organization, repository, fields);
      await database.transaction(async (tx) => {
        await updateRepository(tx, githubRepoId, { private: true });
        if (readers) await replaceRepoAccess(tx, existing.id, readers);
      });
      break;
    }
    case "transferred":
      if (owner.accountId === organization.githubAccountId) {
        await updateRepository(database, githubRepoId, { owner: owner.login, name });
      } else {
        await removeRepository(database, githubRepoId);
      }
      break;
    case "deleted":
      await removeRepository(database, githubRepoId);
      break;
  }
  deps.logger.info("repository.updated", { ...fields, organization: organization.slug });
  return true;
}

// Undefined when GitHub cannot say; the repo is still made private, and stored rows stay.
async function listReaders(
  deps: InstallationDeps,
  organization: Organization,
  repository: RepositoryRef,
  fields: Record<string, unknown>,
): Promise<{ githubId: number; permission: RepoPermission }[] | undefined> {
  const installed = installedAccount(organization);
  if (!installed || organization.suspendedAt) return undefined;
  try {
    const listed = await deps.github.listRepositoryCollaborators(
      installed.installationId,
      repository.owner.login,
      repository.name,
    );
    return listed.map(({ id, permission }) => ({ githubId: id, permission }));
  } catch (error) {
    deps.logger.error("repo_access.skipped", {
      ...fields,
      organization: organization.slug,
      reason: "github_lookup_failed",
      error: errorMessage(error),
    });
    return undefined;
  }
}
