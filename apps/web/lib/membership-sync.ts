import {
  deleteMembership,
  deleteOrganizationRepoAccess,
  listInstalledOrganizations,
  listOrganizationMembers,
  upsertAccountUser,
  upsertMembership,
  type Database,
  type GithubAccount,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import type { GithubAppClient, OrganizationMember } from "@pr-review/github";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

export type MembershipDecision =
  | {
      action: "grant";
      role: MembershipRole;
      reason: "github_org_admin" | "github_org_member" | "personal_account_owner";
    }
  | {
      action: "revoke";
      reason: "not_github_org_member" | "not_personal_account_owner";
    };

export interface AccountDecision {
  account: GithubAccount;
  decision: MembershipDecision;
}

export interface MembershipSyncDeps {
  /** Writes run in the caller's transaction when it passes one. */
  database: Database;
  logger: StructuredLogger;
}

/** The GitHub account behind an installation, as GitHub lookups need it. */
export interface InstalledAccount {
  accountType: Organization["accountType"];
  accountId: number;
  login: string;
  installationId: number;
}

export function installedAccount(
  organization: Organization,
): InstalledAccount | undefined {
  if (organization.installationId === null || organization.uninstalledAt) return undefined;
  return {
    accountType: organization.accountType,
    accountId: organization.githubAccountId,
    login: organization.slug,
    installationId: organization.installationId,
  };
}

export function memberDecision(member: OrganizationMember | null): MembershipDecision {
  if (!member) return { action: "revoke", reason: "not_github_org_member" };
  return member.role === "admin"
    ? { action: "grant", role: "owner", reason: "github_org_admin" }
    : { action: "grant", role: "member", reason: "github_org_member" };
}

function personalAccountDecision(
  installed: InstalledAccount,
  githubUserId: number,
): MembershipDecision {
  return installed.accountId === githubUserId
    ? { action: "grant", role: "owner", reason: "personal_account_owner" }
    : { action: "revoke", reason: "not_personal_account_owner" };
}

export function accountOf(member: OrganizationMember): GithubAccount {
  return { githubId: member.id, login: member.login, avatarUrl: member.avatarUrl };
}

/** One user's standing in one account; a personal account costs no GitHub call. */
export async function lookupMembership(
  github: GithubAppClient,
  installed: InstalledAccount,
  account: GithubAccount,
): Promise<MembershipDecision> {
  if (installed.accountType === "user") {
    return personalAccountDecision(installed, account.githubId);
  }
  const member = await github.getOrganizationMembership(
    installed.installationId,
    installed.login,
    account.login,
  );
  // A login can have changed hands; only the id identifies the user.
  return memberDecision(member?.id === account.githubId ? member : null);
}

/** Everyone who belongs to the account: its members, or a personal account's own user. */
export async function lookupMembers(
  github: GithubAppClient,
  installed: InstalledAccount,
): Promise<AccountDecision[]> {
  if (installed.accountType === "user") {
    return [
      {
        account: { githubId: installed.accountId, login: installed.login, avatarUrl: null },
        decision: personalAccountDecision(installed, installed.accountId),
      },
    ];
  }
  const members = await github.listOrganizationMembers(
    installed.installationId,
    installed.login,
  );
  return members.map((member) => ({
    account: accountOf(member),
    decision: memberDecision(member),
  }));
}

export async function applyMembership(
  { database, logger }: MembershipSyncDeps,
  organization: Organization,
  { account, decision }: AccountDecision,
  source: string,
): Promise<void> {
  const fields = {
    source,
    organization: organization.slug,
    organizationId: organization.id,
    githubUserId: account.githubId,
    login: account.login,
    reason: decision.reason,
  };
  if (decision.action === "grant") {
    const user = await upsertAccountUser(database, account);
    await upsertMembership(database, {
      userId: user.id,
      organizationId: organization.id,
      role: decision.role,
    });
    logger.info("membership.granted", { ...fields, role: decision.role });
    return;
  }
  const removed = await deleteMembership(database, organization.id, account.githubId);
  await deleteOrganizationRepoAccess(database, organization.id, account.githubId);
  logger.info("membership.revoked", { ...fields, removed });
}

/** Makes the organization's memberships exactly `members`' grants, revoking everyone else. */
export async function replaceMembers(
  deps: MembershipSyncDeps,
  organization: Organization,
  members: readonly AccountDecision[],
  source: string,
): Promise<void> {
  for (const member of members) {
    await applyMembership(deps, organization, member, source);
  }
  const granted = new Set(
    members
      .filter((member) => member.decision.action === "grant")
      .map((member) => member.account.githubId),
  );
  const reason =
    organization.accountType === "user"
      ? "not_personal_account_owner"
      : "not_github_org_member";
  for (const existing of await listOrganizationMembers(
    deps.database,
    organization.id,
  )) {
    if (granted.has(existing.githubId)) continue;
    await applyMembership(
      deps,
      organization,
      {
        account: { githubId: existing.githubId, login: existing.login, avatarUrl: null },
        decision: { action: "revoke", reason },
      },
      source,
    );
  }
}

const LOOKUP_CONCURRENCY = 8;

// Lookups finish before the transaction opens; a failed or suspended one keeps what was stored.
export async function syncSignInMemberships(
  deps: MembershipSyncDeps & { github: GithubAppClient },
  account: GithubAccount,
): Promise<void> {
  const source = "sign_in";
  const organizations = await listInstalledOrganizations(deps.database);
  const decided: { organization: Organization; decision: MembershipDecision }[] = [];

  const lookup = async (organization: Organization) => {
    const fields = {
      source,
      organization: organization.slug,
      organizationId: organization.id,
      githubUserId: account.githubId,
      login: account.login,
    };
    const installed = installedAccount(organization);
    if (!installed) return;
    if (organization.suspendedAt) {
      deps.logger.info("membership.skipped", { ...fields, reason: "installation_suspended" });
      return;
    }
    try {
      decided.push({
        organization,
        decision: await lookupMembership(deps.github, installed, account),
      });
    } catch (error) {
      deps.logger.error("membership.skipped", {
        ...fields,
        reason: "github_lookup_failed",
        error: errorMessage(error),
      });
    }
  };
  for (let start = 0; start < organizations.length; start += LOOKUP_CONCURRENCY) {
    await Promise.all(organizations.slice(start, start + LOOKUP_CONCURRENCY).map(lookup));
  }

  decided.sort((a, b) => a.organization.id - b.organization.id);
  await deps.database.transaction(async (tx) => {
    for (const { organization, decision } of decided) {
      await applyMembership(
        { ...deps, database: tx },
        organization,
        { account, decision },
        source,
      );
    }
  });
}
