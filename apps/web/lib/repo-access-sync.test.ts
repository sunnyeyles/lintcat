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
import type {
  GithubAppClient,
  GithubUserClient,
  RepositoryPermission,
  UserRepository,
} from "@pr-review/github";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { syncSignInCollaboratorAccess, syncSignInRepoAccess } from "@/lib/repo-access-sync";

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

describe("syncSignInCollaboratorAccess", () => {
  // Installation id -> the repos GitHub lists for mona there; "down" makes the listing fail.
  let listed: Map<number, UserRepository[] | "down">;
  let installationsDown: boolean;
  let listings: number[];

  const userGithub: GithubUserClient = {
    async listInstallations() {
      if (installationsDown) throw new Error("GitHub is down");
      return [...listed.keys()].map((id) => ({
        id,
        account: { id: id - 50_000, login: "someone", type: "User" },
      }));
    },
    async listInstallationRepositories(installationId) {
      listings.push(installationId);
      const repositories = listed.get(installationId);
      if (repositories === "down") throw new Error(`GitHub is down for ${installationId}`);
      return repositories ?? [];
    },
  };

  beforeEach(() => {
    listed = new Map();
    installationsDown = false;
    listings = [];
  });

  async function account(
    slug: string,
    options: { suspendedAt?: Date; installed?: boolean } = {},
  ): Promise<Organization> {
    const accountId = nextAccountId++;
    const [organization] = await database
      .insert(organizations)
      .values({
        githubAccountId: accountId,
        accountType: "user",
        slug,
        name: slug,
        installationId: options.installed === false ? null : accountId + 50_000,
        suspendedAt: options.suspendedAt ?? null,
      })
      .returning();
    return organization!;
  }

  async function listedRepo(
    organization: Organization,
    name: string,
    permission: RepositoryPermission,
    isPrivate = true,
  ): Promise<UserRepository> {
    const id = await addRepo(organization, name, isPrivate);
    const [repo] = await database.select().from(repos).where(eq(repos.id, id));
    return { id: repo!.githubRepoId!, owner: organization.slug, name, private: isPrivate, permission };
  }

  function collaboratorSync({ token = true } = {}): Promise<void> {
    const capturing = createCapturingLogger();
    log = capturing.entries;
    return syncSignInCollaboratorAccess(
      { database, userGithub: token ? userGithub : undefined, logger: capturing.logger },
      mona,
    );
  }

  it("grants the repos GitHub lists, public ones included, and opens the account", async () => {
    const alice = await account("alice");
    await addRepo(alice, "secret", true);
    listed.set(alice.installationId!, [
      await listedRepo(alice, "vault", "write"),
      await listedRepo(alice, "site", "read", false),
    ]);

    await collaboratorSync();

    expect(await access()).toEqual([
      { repo: "site", permission: "read" },
      { repo: "vault", permission: "write" },
    ]);
    expect(await readable("alice")).toEqual(["site", "vault"]);
  });

  it("ignores installations it does not know, and suspended or uninstalled accounts", async () => {
    const suspended = await account("suspended", { suspendedAt: new Date() });
    const uninstalled = await account("uninstalled", { installed: false });
    listed.set(suspended.installationId!, [await listedRepo(suspended, "vault", "admin")]);
    listed.set(777_777, []);
    await addRepo(uninstalled, "vault", true);

    await collaboratorSync();

    expect(listings).toEqual([]);
    expect(await access()).toEqual([]);
  });

  it("skips an account the user is a member of", async () => {
    const acme = await install("acme", "member");
    listed.set(acme.installationId!, [await listedRepo(acme, "vault", "admin")]);

    await collaboratorSync();

    expect(listings).toEqual([]);
    expect(await access()).toEqual([]);
  });

  it("clears rows in an account GitHub no longer lists, and ones it no longer grants", async () => {
    const alice = await account("alice");
    const bob = await account("bob");
    const vault = await listedRepo(alice, "vault", "write");
    const ledger = await listedRepo(alice, "ledger", "write");
    const tools = await listedRepo(bob, "tools", "read");
    listed.set(alice.installationId!, [vault, ledger]);
    listed.set(bob.installationId!, [tools]);
    await collaboratorSync();

    listed = new Map([[alice.installationId!, [{ ...vault, permission: "admin" }]]]);
    await collaboratorSync();

    expect(await access()).toEqual([{ repo: "vault", permission: "admin" }]);
    expect(await readable("bob")).toBe("not-found");
  });

  it("keeps stored rows when GitHub fails", async () => {
    const alice = await account("alice");
    listed.set(alice.installationId!, [await listedRepo(alice, "vault", "write")]);
    await collaboratorSync();

    listed.set(alice.installationId!, "down");
    await collaboratorSync();
    expect(log).toContainEqual(
      expect.objectContaining({ event: "repo_access.skipped", reason: "github_lookup_failed" }),
    );
    installationsDown = true;
    await expect(collaboratorSync()).rejects.toThrow("GitHub is down");

    expect(await access()).toEqual([{ repo: "vault", permission: "write" }]);
  });

  it("skips repos the dashboard has not mirrored yet", async () => {
    const alice = await account("alice");
    listed.set(alice.installationId!, [
      { id: 123, owner: "alice", name: "new", private: true, permission: "write" },
    ]);

    await collaboratorSync();

    expect(await access()).toEqual([]);
  });

  it("makes no call and changes nothing without a user token", async () => {
    const alice = await account("alice");
    listed.set(alice.installationId!, [await listedRepo(alice, "vault", "write")]);

    await collaboratorSync({ token: false });

    expect(listings).toEqual([]);
    expect(await access()).toEqual([]);
    expect(log).toContainEqual(expect.objectContaining({ reason: "no_user_token" }));
  });

  it("converges when run twice", async () => {
    const alice = await account("alice");
    listed.set(alice.installationId!, [await listedRepo(alice, "vault", "maintain")]);

    await collaboratorSync();
    const once = await access();
    await collaboratorSync();

    expect(await access()).toEqual(once);
  });
});
