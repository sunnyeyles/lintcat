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
import type { StructuredLogger } from "@pr-review/logging";

import { reconcile } from "@/lib/reconcile";

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

export type InactiveReason = "organization_not_installed" | "installation_suspended";

/** Installed and not suspended, the only state in which GitHub is asked about the account. */
export function activeInstallation(
  organization: Organization | undefined,
):
  | { organization: Organization; installed: InstalledAccount; inactive?: never }
  | { inactive: InactiveReason } {
  const installed = organization && installedAccount(organization);
  if (!organization || !installed) return { inactive: "organization_not_installed" };
  if (organization.suspendedAt) return { inactive: "installation_suspended" };
  return { organization, installed };
}

function memberDecision(member: OrganizationMember | null): MembershipDecision {
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

function accountOf(member: OrganizationMember): GithubAccount {
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

interface DecidedMembership {
  organization: Organization;
  decision: MembershipDecision;
}

export async function syncSignInMemberships(
  deps: MembershipSyncDeps & { github: GithubAppClient },
  account: GithubAccount,
): Promise<void> {
  const source = "sign_in";
  const fields = (organization: Organization) => ({
    source,
    organization: organization.slug,
    organizationId: organization.id,
    githubUserId: account.githubId,
    login: account.login,
  });
  await reconcile<Organization, DecidedMembership>({
    database: deps.database,
    logger: deps.logger,
    skippedEvent: "membership.skipped",
    candidates: await listInstalledOrganizations(deps.database),
    fields,
    order: ({ organization }) => organization.id,
    async lookup(organization) {
      const active = activeInstallation(organization);
      if (active.inactive) {
        if (active.inactive === "installation_suspended") {
          deps.logger.info("membership.skipped", {
            ...fields(organization),
            reason: active.inactive,
          });
        }
        return undefined;
      }
      return {
        organization,
        decision: await lookupMembership(deps.github, active.installed, account),
      };
    },
    apply: (database, { organization, decision }) =>
      applyMembership({ ...deps, database }, organization, { account, decision }, source),
  });
}
