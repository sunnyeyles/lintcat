import {
  authorize,
  renameOrganization,
  replaceRepositories,
  upsertInstallation,
  type Database,
  type GithubAccount,
  type InstallationInput,
  type Organization,
  type RepositoryInput,
} from "@pr-review/db";
import type { AppInstallation, GithubAppClient } from "@pr-review/github";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { lookupMembers, replaceMembers } from "@/lib/membership-sync";
import { syncSignInRepoAccess } from "@/lib/repo-access-sync";

export interface InstallationDeps {
  /** Must support `.transaction()`: the WebSocket pool in production, PGlite in tests. */
  database: Database;
  github: GithubAppClient;
  logger: StructuredLogger;
}

/** Undefined for account types the dashboard does not serve, such as Enterprise. */
export function toInstallation(installation: AppInstallation): InstallationInput | undefined {
  const { type } = installation.account;
  const accountType =
    type === "Organization" ? "organization" : type === "User" ? "user" : undefined;
  if (!accountType) return undefined;
  return {
    installationId: installation.id,
    accountId: installation.account.id,
    accountType,
    login: installation.account.login,
    suspendedAt: installation.suspendedAt,
  };
}

// The payload's login is taken as current, so a stale redelivery can move the slug back.
export async function followRename(
  deps: Pick<InstallationDeps, "logger">,
  database: Database,
  account: Pick<InstallationInput, "accountId" | "login">,
  source: string,
): Promise<boolean> {
  const renamed = await renameOrganization(database, account.accountId, account.login);
  if (renamed && renamed.from !== renamed.to) {
    deps.logger.info("organization.renamed", {
      source,
      githubAccountId: account.accountId,
      from: renamed.from,
      to: renamed.to,
    });
  }
  return renamed !== undefined;
}

/** Mirrors an installation from GitHub; the webhook and the setup page both run it, in either order. */
export async function installOrganization(
  deps: InstallationDeps,
  installation: InstallationInput,
  source: string,
): Promise<Organization> {
  const { database, github } = deps;
  // Fetched before the transaction opens, so no connection idles on GitHub.
  const listed = await github.listInstallationRepositories(installation.installationId);
  const members = await lookupMembers(github, installation);
  const repositories = listed.map(
    (repo): RepositoryInput => ({
      githubRepoId: repo.id,
      owner: repo.owner,
      name: repo.name,
      private: repo.private,
    }),
  );
  return database.transaction(async (tx) => {
    await followRename(deps, tx, installation, source);
    const organization = await upsertInstallation(tx, installation, { reinstall: true });
    await replaceRepositories(tx, organization.id, repositories);
    await replaceMembers({ ...deps, database: tx }, organization, members, source);
    return organization;
  });
}

export type SetupRequest =
  | { kind: "sync"; installationId: number }
  | { kind: "request" }
  | { kind: "invalid" };

/** What GitHub's Setup URL query asks for. */
export function setupRequest(params: {
  installation_id?: unknown;
  setup_action?: unknown;
}): SetupRequest {
  if (params.setup_action === "request") return { kind: "request" };
  if (typeof params.setup_action !== "string" && params.setup_action !== undefined) {
    return { kind: "invalid" };
  }
  const installationId =
    typeof params.installation_id === "string" && /^\d+$/.test(params.installation_id)
      ? Number(params.installation_id)
      : undefined;
  if (installationId === undefined || !Number.isSafeInteger(installationId)) {
    return { kind: "invalid" };
  }
  return { kind: "sync", installationId };
}

export type SetupResult =
  | { status: "member"; slug: string }
  | { status: "not_member" }
  | { status: "unsupported" };

/** Mirrors the installation now, without waiting for the webhook, then says where the user belongs. */
export async function completeSetup(
  deps: InstallationDeps,
  installationId: number,
  account: GithubAccount,
): Promise<SetupResult> {
  const installation = toInstallation(await deps.github.getInstallation(installationId));
  if (!installation) return { status: "unsupported" };
  const organization = await installOrganization(deps, installation, "setup.install");
  try {
    await syncSignInRepoAccess(deps, account);
  } catch (error) {
    deps.logger.error("repo_access.setup_sync_failed", {
      githubUserId: account.githubId,
      login: account.login,
      error: errorMessage(error),
    });
  }
  const access = await authorize(deps.database, account, organization.slug);
  return access.status === "allowed"
    ? { status: "member", slug: organization.slug }
    : { status: "not_member" };
}
