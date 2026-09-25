import {
  authorize,
  memberships,
  organizations,
  repoAccess,
  repos,
  users,
  type Database,
  type GithubAccount,
  type MembershipRole,
  type Organization,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import type { GithubAppClient, RepositoryPermission } from "@pr-review/github";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { syncSignInRepoAccess } from "@/lib/repo-access-sync";

const mona: GithubAccount = { githubId: 3_000_000_001, login: "mona", avatarUrl: null };

let database: Database;
let log: CapturedLogEvent[];
// "owner/name" -> mona's permission on GitHub; "down" makes the lookup fail.
let githubPermissions: Record<string, RepositoryPermission | "down" | "someone-else">;
let lookups: string[];
let monaId: number;

const github: GithubAppClient = {
  async createInstallationToken() {
    throw new Error("sign-in never mints a token");
  },
  async listInstallationRepositories() {
    throw new Error("sign-in never lists repositories");
  },
  async listOrganizationMembers() {
    throw new Error("sign-in never lists members");
  },
  async getOrganizationMembership() {
    throw new Error("repo access sync never reads memberships");
  },
  async getRepositoryPermission(_installationId, owner, repo, username) {
    const key = `${owner}/${repo}`;
    lookups.push(key);
    const permission = githubPermissions[key];
    if (permission === "down") throw new Error(`GitHub is down for ${key}`);
    if (!permission) return null;
    const id = permission === "someone-else" ? 42 : mona.githubId;
    return { id, login: username, permission: permission === "someone-else" ? "admin" : permission };
  },
  async listRepositoryCollaborators() {
    throw new Error("sign-in never lists collaborators");
  },
  async findUserInstallation() {
    throw new Error("sign-in never looks up an installation");
  },
  async getInstallation() {
    throw new Error("sign-in never reads the installation");
  },
};

let nextAccountId = 100;

async function install(
  slug: string,
  role: MembershipRole,
  options: { suspendedAt?: Date } = {},
): Promise<Organization> {
  const accountId = nextAccountId++;
  const [organization] = await database
    .insert(organizations)
    .values({
      githubAccountId: accountId,
      accountType: "organization",
      slug,
      name: slug,
      installationId: accountId + 50_000,
      suspendedAt: options.suspendedAt ?? null,
    })
    .returning();
  await database
    .insert(memberships)
    .values({ userId: monaId, organizationId: organization!.id, role });
  return organization!;
}

let nextRepoId = 9_000_000_000;

async function addRepo(
  organization: Organization,
  name: string,
  isPrivate: boolean,
): Promise<number> {
  const [repo] = await database
    .insert(repos)
    .values({
      organizationId: organization.id,
      githubRepoId: nextRepoId++,
      owner: organization.slug,
      name,
      private: isPrivate,
    })
    .returning({ id: repos.id });
  return repo!.id;
}

beforeEach(async () => {
  database = await createTestDatabase();
  log = [];
  githubPermissions = {};
  lookups = [];
  const [user] = await database
    .insert(users)
    .values({ githubId: mona.githubId, login: mona.login })
    .returning({ id: users.id });
  monaId = user!.id;
});

function sync(): Promise<void> {
  const capturing = createCapturingLogger();
  log = capturing.entries;
  return syncSignInRepoAccess({ database, github, logger: capturing.logger }, mona);
}

async function access() {
  return database
    .select({ repo: repos.name, permission: repoAccess.permission })
    .from(repoAccess)
    .innerJoin(repos, eq(repos.id, repoAccess.repoId))
    .where(eq(repoAccess.userId, monaId))
    .orderBy(asc(repos.name));
}

async function readable(slug: string) {
  const result = await authorize(database, mona, slug);
  if (result.status !== "allowed") return result.status;
  const rows = await database.select({ id: repos.id, name: repos.name }).from(repos);
  return result.readableRepos
    .map((entry) => rows.find((row) => row.id === entry.id)!.name)
    .sort();
}

describe("syncSignInRepoAccess", () => {
  it("asks GitHub about private repos only, and lets the member read the ones they can", async () => {
    const acme = await install("acme", "member");
    await addRepo(acme, "widgets", false);
    await addRepo(acme, "vault", true);
    await addRepo(acme, "ledger", true);
    githubPermissions = { "acme/ledger": "maintain" };

    await sync();

    expect(lookups.sort()).toEqual(["acme/ledger", "acme/vault"]);
    expect(await access()).toEqual([{ repo: "ledger", permission: "maintain" }]);
    expect(await readable("acme")).toEqual(["ledger", "widgets"]);
    expect(log).toContainEqual(
      expect.objectContaining({
        event: "repo_access.granted",
        source: "sign_in",
        repo: "acme/ledger",
        permission: "maintain",
      }),
    );
  });

  it("revokes access GitHub no longer grants and updates a changed permission", async () => {
    const acme = await install("acme", "member");
    await addRepo(acme, "vault", true);
    await addRepo(acme, "ledger", true);
    githubPermissions = { "acme/vault": "read", "acme/ledger": "read" };
    await sync();

    githubPermissions = { "acme/ledger": "admin" };
    await sync();

    expect(await access()).toEqual([{ repo: "ledger", permission: "admin" }]);
    expect(await readable("acme")).toEqual(["ledger"]);
  });

  it("makes no call for an organization owner, a suspended organization or a public repo", async () => {
    const acme = await install("acme", "owner");
    await addRepo(acme, "vault", true);
    const globex = await install("globex", "member", { suspendedAt: new Date() });
    await addRepo(globex, "secret", true);
    const initech = await install("initech", "member");
    await addRepo(initech, "open", false);

    await sync();

    expect(lookups).toEqual([]);
    expect(await readable("acme")).toEqual(["vault"]);
  });

  it("keeps stored access when GitHub fails, and still syncs the other repos", async () => {
    const acme = await install("acme", "member");
    await addRepo(acme, "vault", true);
    await addRepo(acme, "ledger", true);
    githubPermissions = { "acme/vault": "write", "acme/ledger": "write" };
    await sync();

    githubPermissions = { "acme/vault": "down" };
    await sync();

    expect(await access()).toEqual([{ repo: "vault", permission: "write" }]);
    expect(log).toContainEqual(
      expect.objectContaining({
        event: "repo_access.skipped",
        repo: "acme/vault",
        reason: "github_lookup_failed",
      }),
    );
  });

  it("treats a login that now belongs to someone else as no access", async () => {
    const acme = await install("acme", "member");
    await addRepo(acme, "vault", true);
    githubPermissions = { "acme/vault": "someone-else" };

    await sync();

    expect(await access()).toEqual([]);
  });

  it("converges when run twice", async () => {
    const acme = await install("acme", "member");
    await addRepo(acme, "vault", true);
    githubPermissions = { "acme/vault": "triage" };

    await sync();
    const once = await access();
    await sync();

    expect(await access()).toEqual(once);
  });
});
