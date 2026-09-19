import {
  memberships,
  organizations,
  users,
  type Database,
  type GithubAccount,
  type Organization,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import type { GithubAppClient, OrganizationMember } from "@pr-review/github";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { authorize } from "@/lib/authorize";
import { syncSignInMemberships } from "@/lib/membership-sync";

const mona: GithubAccount = { githubId: 3_000_000_001, login: "mona", avatarUrl: null };

let database: Database;
let log: CapturedLogEvent[];
// Org login -> the members GitHub reports for it; a missing login makes the lookup fail.
let githubMembers: Record<string, OrganizationMember[]>;
let lookups: string[];

const github: GithubAppClient = {
  async listInstallationRepositories() {
    throw new Error("sign-in never lists repositories");
  },
  async listOrganizationMembers() {
    throw new Error("sign-in never lists members");
  },
  async getOrganizationMembership(_installationId, org, username) {
    lookups.push(org);
    const listed = githubMembers[org];
    if (!listed) throw new Error(`GitHub is down for ${org}`);
    return listed.find((member) => member.login === username) ?? null;
  },
};

beforeEach(async () => {
  database = await createTestDatabase();
  log = [];
  githubMembers = {};
  lookups = [];
});

let nextAccountId = 100;

async function install(
  slug: string,
  options: {
    accountType?: Organization["accountType"];
    accountId?: number;
    suspendedAt?: Date;
    installed?: boolean;
  } = {},
): Promise<Organization> {
  const accountId = options.accountId ?? nextAccountId++;
  const [organization] = await database
    .insert(organizations)
    .values({
      githubAccountId: accountId,
      accountType: options.accountType ?? "organization",
      slug,
      name: slug,
      installationId: options.installed === false ? null : accountId + 50_000,
      suspendedAt: options.suspendedAt ?? null,
    })
    .returning();
  return organization!;
}

function sync(account: GithubAccount = mona): Promise<void> {
  const capturing = createCapturingLogger();
  log = capturing.entries;
  return syncSignInMemberships({ database, github, logger: capturing.logger }, account);
}

async function roles() {
  return database
    .select({ organization: organizations.slug, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(users.githubId, mona.githubId))
    .orderBy(asc(organizations.slug));
}

const monaAs = (role: OrganizationMember["role"]): OrganizationMember => ({
  id: mona.githubId,
  login: mona.login,
  avatarUrl: null,
  role,
});

describe("syncSignInMemberships", () => {
  it("creates memberships with roles from GitHub in every installed organization", async () => {
    await install("acme");
    await install("globex");
    await install("initech");
    githubMembers = { acme: [monaAs("admin")], globex: [monaAs("member")], initech: [] };

    await sync();

    expect(await roles()).toEqual([
      { organization: "acme", role: "owner" },
      { organization: "globex", role: "member" },
    ]);
    expect(await authorize(database, mona, "globex")).toMatchObject({
      status: "allowed",
      role: "member",
    });
    expect(log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "membership.granted",
          source: "sign_in",
          organization: "acme",
          reason: "github_org_admin",
        }),
        expect.objectContaining({
          event: "membership.revoked",
          organization: "initech",
          reason: "not_github_org_member",
          removed: false,
        }),
      ]),
    );
  });

  it("refreshes a changed role and drops an organization the user left", async () => {
    await install("acme");
    await install("globex");
    githubMembers = { acme: [monaAs("member")], globex: [monaAs("member")] };
    await sync();

    githubMembers = { acme: [monaAs("admin")], globex: [] };
    await sync();

    expect(await roles()).toEqual([{ organization: "acme", role: "owner" }]);
    expect(await authorize(database, mona, "globex")).toEqual({ status: "not-found" });
  });

  it("makes a personal account's own user its owner, with no GitHub call", async () => {
    await install("mona", { accountType: "user", accountId: mona.githubId });
    await install("someone-else", { accountType: "user" });

    await sync();

    expect(await roles()).toEqual([{ organization: "mona", role: "owner" }]);
    expect(lookups).toEqual([]);
    expect(log).toContainEqual(
      expect.objectContaining({
        organization: "someone-else",
        reason: "not_personal_account_owner",
      }),
    );
  });

  it("keeps what it had when GitHub fails or the installation is suspended", async () => {
    await install("acme");
    await install("globex");
    githubMembers = { acme: [monaAs("admin")], globex: [monaAs("admin")] };
    await sync();

    await database
      .update(organizations)
      .set({ suspendedAt: new Date() })
      .where(eq(organizations.slug, "globex"));
    githubMembers = {};
    lookups = [];
    await sync();

    expect(lookups).toEqual(["acme"]);
    expect(await roles()).toEqual([
      { organization: "acme", role: "owner" },
      { organization: "globex", role: "owner" },
    ]);
    expect(log).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          level: "error",
          event: "membership.skipped",
          organization: "acme",
          reason: "github_lookup_failed",
        }),
        expect.objectContaining({
          event: "membership.skipped",
          organization: "globex",
          reason: "installation_suspended",
        }),
      ]),
    );
  });

  it("ignores an organization without an installation", async () => {
    await install("legacy", { installed: false });
    await sync();
    expect(lookups).toEqual([]);
    expect(await roles()).toEqual([]);
  });

  it("treats a login that now belongs to someone else as not a member", async () => {
    await install("acme");
    githubMembers = { acme: [{ ...monaAs("admin"), id: 42 }] };
    await sync();
    expect(await roles()).toEqual([]);
  });

  it("converges when run twice", async () => {
    await install("acme");
    githubMembers = { acme: [monaAs("member")] };
    await sync();
    const once = await roles();
    await sync();
    expect(await roles()).toEqual(once);
    expect(await database.select().from(memberships)).toHaveLength(1);
  });
});
