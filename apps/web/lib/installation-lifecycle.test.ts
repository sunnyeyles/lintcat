import {
  authorize,
  memberships,
  organizationSlugRedirects,
  organizations,
  repos,
  reviews,
  users,
  type Database,
  type InstallationInput,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import type {
  GithubAppClient,
  InstallationRepository,
  OrganizationMember,
  RepositoryCollaborator,
} from "@pr-review/github";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  applyInstallationEvent,
  type AccountRef,
  type InstallationEvent,
  type RepositoryChange,
} from "@/lib/installation-lifecycle";
import { membershipsForUser } from "@/lib/organization";

const INSTALLATION_ID = 555;
const ACCOUNT_ID = 1_000;
const SUSPENDED_AT = new Date("2026-09-01T12:00:00Z");

const widgets: InstallationRepository = {
  id: 2_900_000_001,
  owner: "Acme",
  name: "widgets",
  private: false,
};
const secrets: InstallationRepository = {
  id: 2_900_000_002,
  owner: "Acme",
  name: "secrets",
  private: true,
};

const octocat: OrganizationMember = {
  id: 3_000_000_001,
  login: "octocat",
  avatarUrl: "https://avatars.example.test/octocat.png",
  role: "admin",
};
const hubot: OrganizationMember = {
  id: 3_000_000_002,
  login: "hubot",
  avatarUrl: null,
  role: "member",
};
const mallory: OrganizationMember = {
  id: 3_000_000_003,
  login: "mallory",
  avatarUrl: null,
  role: "member",
};

let database: Database;
let listed: InstallationRepository[];
let members: OrganizationMember[];
let githubCalls: number;
// "owner/name" (lowercased) -> who can read it on GitHub; a missing repo makes a listing fail.
let collaborators: Record<string, RepositoryCollaborator[]>;
let log: CapturedLogEvent[];

// GitHub's current truth; tests change `members` to simulate edits made on GitHub.
const github: GithubAppClient = {
  async createInstallationToken() {
    throw new Error("the lifecycle never mints a token");
  },
  async findUserInstallation() {
    throw new Error("the lifecycle never looks up an installation");
  },
  async getInstallation() {
    throw new Error("the lifecycle never reads the installation");
  },
  async listInstallationRepositories(installationId) {
    return installationId === INSTALLATION_ID ? listed : [];
  },
  async listOrganizationMembers(installationId, org) {
    githubCalls += 1;
    expect([installationId, org.toLowerCase()]).toEqual([INSTALLATION_ID, "acme"]);
    return members;
  },
  async getOrganizationMembership(installationId, org, username) {
    githubCalls += 1;
    expect([installationId, org.toLowerCase()]).toEqual([INSTALLATION_ID, "acme"]);
    return members.find((member) => member.login === username) ?? null;
  },
  async getRepositoryPermission(installationId, owner, repo, username) {
    githubCalls += 1;
    expect(installationId).toBe(INSTALLATION_ID);
    return (
      collaborators[`${owner}/${repo}`.toLowerCase()]?.find(
        (collaborator) => collaborator.login === username,
      ) ?? null
    );
  },
  async listRepositoryCollaborators(installationId, owner, repo) {
    githubCalls += 1;
    expect(installationId).toBe(INSTALLATION_ID);
    const listed = collaborators[`${owner}/${repo}`.toLowerCase()];
    if (!listed) throw new Error(`GitHub is down for ${owner}/${repo}`);
    return listed;
  },
};

beforeEach(async () => {
  database = await createTestDatabase();
  listed = [widgets, secrets];
  members = [octocat, hubot];
  githubCalls = 0;
  collaborators = {};
  log = [];
});

function apply(event: InstallationEvent): Promise<boolean> {
  const capturing = createCapturingLogger();
  log = capturing.entries;
  return applyInstallationEvent({ database, github, logger: capturing.logger }, event);
}

function installation(
  accountType: InstallationInput["accountType"] = "organization",
  login = "Acme",
  suspendedAt: Date | null = null,
): InstallationInput {
  return { installationId: INSTALLATION_ID, accountId: ACCOUNT_ID, accountType, login, suspendedAt };
}

const installed = (input = installation()): InstallationEvent => ({
  kind: "installed",
  installation: input,
  source: "installation.created",
});

const uninstalled = (): InstallationEvent => ({
  kind: "uninstalled",
  installation: installation(),
  source: "installation.deleted",
});

const suspended = (): InstallationEvent => ({
  kind: "suspended",
  installation: installation("organization", "Acme", SUSPENDED_AT),
  source: "installation.suspend",
});

const unsuspended = (): InstallationEvent => ({
  kind: "unsuspended",
  installation: installation(),
  source: "installation.unsuspend",
});

function asInput(repo: InstallationRepository) {
  return { githubRepoId: repo.id, owner: repo.owner, name: repo.name, private: repo.private };
}

function repositoriesChanged(
  action: "added" | "removed",
  changed: InstallationRepository[],
  input = installation(),
): InstallationEvent {
  return {
    kind: "repositories_changed",
    installation: input,
    added: action === "added" ? changed.map(asInput) : [],
    removed: action === "removed" ? changed.map((repo) => repo.id) : [],
    source: `installation_repositories.${action}`,
  };
}

async function seedReview(repo: InstallationRepository): Promise<void> {
  const [row] = await database
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.githubRepoId, repo.id));
  await database.insert(reviews).values({
    repoId: row!.id,
    prNumber: 1,
    headSha: `sha-${repo.name}`,
    summary: "ok",
  });
}

async function state() {
  const orgs = await database
    .select({
      githubAccountId: organizations.githubAccountId,
      accountType: organizations.accountType,
      slug: organizations.slug,
      name: organizations.name,
      installationId: organizations.installationId,
      suspendedAt: organizations.suspendedAt,
      uninstalled: sql<boolean>`${organizations.uninstalledAt} is not null`,
    })
    .from(organizations)
    .orderBy(asc(organizations.id));
  const repoRows = await database
    .select({
      githubRepoId: repos.githubRepoId,
      owner: repos.owner,
      name: repos.name,
      private: repos.private,
      removed: sql<boolean>`${repos.removedAt} is not null`,
    })
    .from(repos)
    .orderBy(asc(repos.githubRepoId));
  const memberRows = await database
    .select({ githubId: users.githubId, login: users.login, role: memberships.role })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .orderBy(asc(users.githubId));
  return { organizations: orgs, repos: repoRows, memberships: memberRows };
}

const empty = { organizations: [], repos: [], memberships: [] };

function repoRow(repo: InstallationRepository, removed = false) {
  return {
    githubRepoId: repo.id,
    owner: repo.owner,
    name: repo.name,
    private: repo.private,
    removed,
  };
}

describe("applyInstallationEvent installation", () => {
  it("creates an organization and its repositories on an organization install", async () => {
    expect(await apply(installed())).toBe(true);
    expect(await state()).toEqual({
      organizations: [
        {
          githubAccountId: ACCOUNT_ID,
          accountType: "organization",
          slug: "acme",
          name: "Acme",
          installationId: INSTALLATION_ID,
          suspendedAt: null,
          uninstalled: false,
        },
      ],
      repos: [repoRow(widgets), repoRow(secrets)],
      memberships: [
        { githubId: octocat.id, login: "octocat", role: "owner" },
        { githubId: hubot.id, login: "hubot", role: "member" },
      ],
    });
    expect(log).toEqual([
      expect.objectContaining({
        event: "membership.granted",
        source: "installation.created",
        organization: "acme",
        githubUserId: octocat.id,
        role: "owner",
        reason: "github_org_admin",
      }),
      expect.objectContaining({
        event: "membership.granted",
        githubUserId: hubot.id,
        role: "member",
        reason: "github_org_member",
      }),
    ]);
  });

  it("creates a user-type organization on a personal account install", async () => {
    listed = [{ ...widgets, owner: "Mona" }];
    expect(await apply(installed(installation("user", "Mona")))).toBe(true);
    const { organizations: orgs, repos: repoRows } = await state();
    expect(orgs).toMatchObject([{ accountType: "user", slug: "mona", name: "Mona" }]);
    expect(repoRows).toEqual([{ ...repoRow(widgets), owner: "Mona" }]);
    expect((await state()).memberships).toEqual([
      { githubId: ACCOUNT_ID, login: "Mona", role: "owner" },
    ]);
    expect(log).toEqual([
      expect.objectContaining({
        event: "membership.granted",
        reason: "personal_account_owner",
      }),
    ]);
    expect(githubCalls).toBe(0);
  });

  it("claims a repository ingest already recorded, keeping its reviews", async () => {
    const [org] = await database
      .insert(organizations)
      .values({
        githubAccountId: ACCOUNT_ID,
        accountType: "organization",
        slug: "acme",
        name: "Acme",
      })
      .returning();
    const [repo] = await database
      .insert(repos)
      .values({ organizationId: org!.id, owner: "Acme", name: "widgets" })
      .returning();
    await database.insert(reviews).values({
      repoId: repo!.id,
      prNumber: 1,
      headSha: "abc",
      summary: "ok",
    });

    await apply(installed());

    expect((await state()).repos).toEqual([repoRow(widgets), repoRow(secrets)]);
    expect(await database.select().from(reviews)).toHaveLength(1);
  });

  it("marks removed the repositories the installation no longer lists when installed again", async () => {
    await apply(installed());
    listed = [secrets];
    await apply(installed());
    expect((await state()).repos).toEqual([repoRow(widgets, true), repoRow(secrets)]);
  });

  it("sets and clears suspended_at on suspend and unsuspend", async () => {
    await apply(installed());

    expect(await apply(suspended())).toBe(true);
    expect((await state()).organizations[0]?.suspendedAt).toEqual(SUSPENDED_AT);

    expect(await apply(unsuspended())).toBe(true);
    expect((await state()).organizations[0]?.suspendedAt).toBeNull();
  });

  it("keeps the organization, its repositories and reviews on uninstall, but closes access", async () => {
    await apply(installed());
    await seedReview(widgets);
    expect(await apply(uninstalled())).toBe(true);

    const after = await state();
    expect(after.organizations).toMatchObject([
      { slug: "acme", installationId: null, uninstalled: true },
    ]);
    expect(after.repos).toEqual([repoRow(widgets), repoRow(secrets)]);
    expect(after.memberships).toHaveLength(2);
    expect(await database.select().from(reviews)).toHaveLength(1);
    expect(await authorize(database, { githubId: octocat.id }, "acme")).toEqual({
      status: "not-found",
    });
    expect(await membershipsForUser(database, octocat.id)).toEqual([]);
  });

  it("converges when an uninstall arrives twice", async () => {
    await apply(installed());
    await apply(uninstalled());
    const [once] = await database.select().from(organizations);
    await apply(uninstalled());
    expect(await database.select().from(organizations)).toEqual([once]);
  });

  it("brings the organization and its re-listed repositories back on reinstall", async () => {
    await apply(installed());
    await seedReview(widgets);
    await seedReview(secrets);
    await apply(uninstalled());

    listed = [widgets];
    members = [octocat];
    expect(await apply(installed())).toBe(true);

    const after = await state();
    expect(after.organizations).toMatchObject([
      { installationId: INSTALLATION_ID, uninstalled: false },
    ]);
    expect(after.repos).toEqual([repoRow(widgets), repoRow(secrets, true)]);
    expect(after.memberships).toEqual([
      { githubId: octocat.id, login: "octocat", role: "owner" },
    ]);
    expect(await database.select().from(reviews)).toHaveLength(2);
    expect(await authorize(database, { githubId: octocat.id }, "acme")).toMatchObject({
      status: "allowed",
    });
  });

  it("does not revive an uninstalled organization for a late repositories change", async () => {
    await apply(installed());
    await apply(uninstalled());
    expect(await apply(repositoriesChanged("added", [widgets]))).toBe(false);
    expect((await state()).organizations).toMatchObject([
      { installationId: null, uninstalled: true },
    ]);
  });

  it("leaves state unchanged when the same install arrives twice", async () => {
    await apply(installed());
    const once = await state();
    expect(await apply(installed())).toBe(true);
    expect(await state()).toEqual(once);
  });

  it("does nothing on accepted permissions for an account it does not know", async () => {
    const accepted: InstallationEvent = {
      kind: "permissions_accepted",
      installation: installation(),
      source: "installation.new_permissions_accepted",
    };
    expect(await apply(accepted)).toBe(false);
    expect(await state()).toEqual(empty);
  });

  it("writes nothing when the install fails halfway", async () => {
    await database.execute(sql`
      create function fail_repo_insert() returns trigger language plpgsql as $$
      begin raise exception 'repo insert failed'; end $$;
    `);
    await database.execute(sql`
      create trigger fail_repo_insert before insert on repos
      for each row execute function fail_repo_insert();
    `);

    await expect(apply(installed())).rejects.toThrow();
    expect(await state()).toEqual(empty);
  });
});

describe("applyInstallationEvent repositories_changed", () => {
  beforeEach(async () => {
    listed = [widgets];
    await apply(installed());
  });

  it("adds repositories", async () => {
    expect(await apply(repositoriesChanged("added", [secrets]))).toBe(true);
    expect((await state()).repos).toEqual([repoRow(widgets), repoRow(secrets)]);
  });

  it("marks repositories removed, keeping their reviews", async () => {
    await seedReview(widgets);
    expect(await apply(repositoriesChanged("removed", [widgets]))).toBe(true);
    expect((await state()).repos).toEqual([repoRow(widgets, true)]);
    expect(await database.select().from(reviews)).toHaveLength(1);
  });

  it("converges when a removal arrives twice", async () => {
    await apply(repositoriesChanged("removed", [widgets]));
    const once = await database.select().from(repos);
    await apply(repositoriesChanged("removed", [widgets]));
    expect(await database.select().from(repos)).toEqual(once);
  });

  it("restores a removed repository added again", async () => {
    await apply(repositoriesChanged("removed", [widgets]));
    await apply(repositoriesChanged("added", [widgets]));
    expect((await state()).repos).toEqual([repoRow(widgets)]);
  });

  it("converges when an add arrives twice", async () => {
    await apply(repositoriesChanged("added", [secrets]));
    const once = await state();
    await apply(repositoriesChanged("added", [secrets]));
    expect(await state()).toEqual(once);
  });

  it("sets up the whole organization, members included, when an add arrives before the install", async () => {
    database = await createTestDatabase();
    listed = [widgets, secrets];
    expect(await apply(repositoriesChanged("added", [secrets]))).toBe(true);
    expect(await state()).toMatchObject({
      organizations: [{ slug: "acme", installationId: INSTALLATION_ID }],
      repos: [repoRow(widgets), repoRow(secrets)],
      memberships: [
        { githubId: octocat.id, login: "octocat", role: "owner" },
        { githubId: hubot.id, login: "hubot", role: "member" },
      ],
    });
  });

  it("makes a personal account's owner its owner when an add arrives before the install", async () => {
    database = await createTestDatabase();
    const monaWidgets = { ...widgets, owner: "Mona" };
    listed = [monaWidgets];
    await apply(repositoriesChanged("added", [monaWidgets], installation("user", "Mona")));
    expect((await state()).memberships).toEqual([
      { githubId: ACCOUNT_ID, login: "Mona", role: "owner" },
    ]);
  });
});

const acme: AccountRef = { accountId: ACCOUNT_ID, login: "Acme" };

function memberChanged(
  source: string,
  member: OrganizationMember,
  account: AccountRef = acme,
  repo?: InstallationRepository,
): InstallationEvent {
  return {
    kind: "member_changed",
    account,
    user: { githubId: member.id, login: member.login, avatarUrl: member.avatarUrl },
    githubRepoId: repo?.id,
    source,
  };
}

async function roles() {
  return (await state()).memberships.map(({ login, role }) => ({ login, role }));
}

describe("applyInstallationEvent organization members", () => {
  beforeEach(async () => {
    members = [octocat];
    await apply(installed());
  });

  it("adds a member who joined the organization", async () => {
    members = [octocat, hubot];
    expect(await apply(memberChanged("organization.member_added", hubot))).toBe(true);
    expect(await roles()).toEqual([
      { login: "octocat", role: "owner" },
      { login: "hubot", role: "member" },
    ]);
    expect(log).toEqual([
      expect.objectContaining({
        event: "membership.granted",
        source: "organization.member_added",
        githubUserId: hubot.id,
        role: "member",
        reason: "github_org_member",
      }),
    ]);
  });

  it("removes a member, who then no longer passes authorize", async () => {
    members = [octocat, hubot];
    await apply(memberChanged("organization.member_added", hubot));
    expect(await authorize(database, { githubId: hubot.id }, "acme")).toMatchObject({
      status: "allowed",
      role: "member",
    });

    members = [octocat];
    expect(await apply(memberChanged("organization.member_removed", hubot))).toBe(true);

    expect(await roles()).toEqual([{ login: "octocat", role: "owner" }]);
    expect(await authorize(database, { githubId: hubot.id }, "acme")).toEqual({
      status: "not-found",
    });
    expect(log).toEqual([
      expect.objectContaining({
        event: "membership.revoked",
        source: "organization.member_removed",
        reason: "not_github_org_member",
        removed: true,
      }),
    ]);
  });

  it("promotes a member made an organization admin", async () => {
    members = [octocat, hubot];
    await apply(memberChanged("organization.member_added", hubot));
    members = [octocat, { ...hubot, role: "admin" }];
    expect(await apply(memberChanged("membership.added", hubot))).toBe(true);
    expect(await roles()).toContainEqual({ login: "hubot", role: "owner" });
    expect(await authorize(database, { githubId: hubot.id }, "acme")).toMatchObject({
      role: "owner",
    });
  });

  it("demotes an admin made a plain member", async () => {
    members = [{ ...octocat, role: "member" }];
    expect(await apply(memberChanged("member.edited", octocat))).toBe(true);
    expect(await roles()).toEqual([{ login: "octocat", role: "member" }]);
  });

  it("converges when the same change arrives twice", async () => {
    members = [octocat, hubot];
    await apply(memberChanged("organization.member_added", hubot));
    const once = await state();
    expect(await apply(memberChanged("organization.member_added", hubot))).toBe(true);
    expect(await state()).toEqual(once);
  });

  it("follows GitHub, not the event, when a stale removal arrives late", async () => {
    members = [octocat, hubot];
    await apply(memberChanged("organization.member_added", hubot));
    await apply(memberChanged("organization.member_removed", hubot));
    expect(await roles()).toContainEqual({ login: "hubot", role: "member" });
  });

  it("revokes members GitHub no longer lists when the App is installed again", async () => {
    members = [hubot];
    await apply(installed());
    expect(await roles()).toEqual([{ login: "hubot", role: "member" }]);
    expect(log).toContainEqual(
      expect.objectContaining({
        event: "membership.revoked",
        githubUserId: octocat.id,
        reason: "not_github_org_member",
        removed: true,
      }),
    );
  });

  it("resyncs members on unsuspend", async () => {
    members = [hubot];
    await apply(unsuspended());
    expect(await roles()).toEqual([{ login: "hubot", role: "member" }]);
  });

  it("skips an organization that is suspended, keeping its members", async () => {
    await apply(suspended());
    githubCalls = 0;
    members = [];
    expect(await apply(memberChanged("organization.member_removed", octocat))).toBe(false);
    expect(githubCalls).toBe(0);
    expect(await roles()).toEqual([{ login: "octocat", role: "owner" }]);
    expect(log).toEqual([
      expect.objectContaining({ event: "membership.skipped", reason: "installation_suspended" }),
    ]);
  });

  it("skips an organization that has not installed the App", async () => {
    const other = { accountId: 9_999, login: "Other" };
    expect(await apply(memberChanged("membership.added", hubot, other))).toBe(false);
    expect(log).toEqual([
      expect.objectContaining({
        event: "membership.skipped",
        organization: "other",
        reason: "organization_not_installed",
      }),
    ]);
  });
});

function repositoryChanged(
  change: RepositoryChange,
  repo: InstallationRepository,
  ownerId = ACCOUNT_ID,
): InstallationEvent {
  return {
    kind: "repository_changed",
    change,
    repository: {
      githubRepoId: repo.id,
      owner: { accountId: ownerId, login: repo.owner },
      name: repo.name,
    },
    source: `repository.${change}`,
  };
}

async function readableBy(member: OrganizationMember): Promise<string[] | "not-found" | "redirect"> {
  const result = await authorize(database, { githubId: member.id }, "acme");
  if (result.status !== "allowed") return result.status;
  const rows = await database.select({ id: repos.id, name: repos.name }).from(repos);
  return result.readableRepos
    .map((entry) => rows.find((row) => row.id === entry.id)!.name)
    .sort();
}

const readAs = (member: OrganizationMember, permission: RepositoryCollaborator["permission"]) => ({
  id: member.id,
  login: member.login,
  permission,
});

describe("applyInstallationEvent repository_changed", () => {
  beforeEach(async () => {
    await apply(installed());
  });

  it("follows a rename, keeping the repository's reviews", async () => {
    await seedReview(widgets);
    expect(await apply(repositoryChanged("renamed", { ...widgets, name: "gizmos" }))).toBe(true);
    expect((await state()).repos).toContainEqual(
      expect.objectContaining({ githubRepoId: widgets.id, owner: "Acme", name: "gizmos" }),
    );
    expect(await database.select().from(reviews)).toHaveLength(1);
    expect(log).toContainEqual(
      expect.objectContaining({
        event: "repository.updated",
        source: "repository.renamed",
        repo: "Acme/gizmos",
        organization: "acme",
      }),
    );
  });

  it("hides a repository made private from members without access", async () => {
    expect(await readableBy(hubot)).toEqual(["widgets"]);
    collaborators = { "acme/widgets": [readAs(octocat, "admin")] };

    expect(await apply(repositoryChanged("privatized", { ...widgets, private: true }))).toBe(true);

    expect(await readableBy(hubot)).toEqual([]);
    expect(await readableBy(octocat)).toEqual(["secrets", "widgets"]);
  });

  it("keeps a repository made private readable by the members GitHub lets read it", async () => {
    collaborators = { "acme/widgets": [readAs(octocat, "admin"), readAs(hubot, "maintain")] };

    await apply(repositoryChanged("privatized", { ...widgets, private: true }));

    expect(await readableBy(hubot)).toEqual(["widgets"]);
    const access = await authorize(database, { githubId: hubot.id }, "acme", {
      owner: "Acme",
      name: "widgets",
    });
    expect(access).toMatchObject({ status: "allowed", repo: { isOwner: true } });
  });

  it("still hides a repository made private when GitHub cannot list who reads it", async () => {
    expect(await apply(repositoryChanged("privatized", { ...widgets, private: true }))).toBe(true);

    expect(await readableBy(hubot)).toEqual([]);
    expect(log).toContainEqual(
      expect.objectContaining({ event: "repo_access.skipped", reason: "github_lookup_failed" }),
    );
  });

  it("shows a repository made public to every member", async () => {
    expect(await apply(repositoryChanged("publicized", { ...secrets, private: false }))).toBe(true);
    expect(await readableBy(hubot)).toEqual(["secrets", "widgets"]);
  });

  it("marks a deleted repository removed, keeping its reviews", async () => {
    await seedReview(secrets);
    await apply(repositoryChanged("deleted", secrets));

    expect((await state()).repos).toContainEqual(
      expect.objectContaining({ githubRepoId: secrets.id, removed: true }),
    );
    expect(await database.select().from(reviews)).toHaveLength(1);
    expect(await readableBy(octocat)).toEqual(["widgets"]);
  });

  it("marks a repository transferred to another account removed", async () => {
    await apply(repositoryChanged("transferred", { ...widgets, owner: "Globex" }, 2_000));
    expect(await readableBy(octocat)).toEqual(["secrets"]);
  });

  it("follows a repository transferred within its own account", async () => {
    await apply(repositoryChanged("transferred", { ...widgets, name: "gizmos" }));
    expect((await state()).repos).toContainEqual(repoRow({ ...widgets, name: "gizmos" }));
  });

  it("converges when the same rename arrives twice", async () => {
    await apply(repositoryChanged("renamed", { ...widgets, name: "gizmos" }));
    const once = await state();
    await apply(repositoryChanged("renamed", { ...widgets, name: "gizmos" }));
    expect(await state()).toEqual(once);
  });

  it("skips a repository the installation never reported", async () => {
    expect(await apply(repositoryChanged("renamed", { ...widgets, id: 1 }))).toBe(false);
    expect(log).toEqual([
      expect.objectContaining({ event: "repository.skipped", reason: "repository_not_tracked" }),
    ]);
  });
});

describe("applyInstallationEvent repository collaborators", () => {
  beforeEach(async () => {
    await apply(installed());
  });

  const collaboratorChanged = (action: string, member: OrganizationMember, repo: InstallationRepository) =>
    memberChanged(`member.${action}`, member, acme, repo);

  it("grants, changes and revokes a member's access to a private repository", async () => {
    collaborators = { "acme/secrets": [readAs(hubot, "write")] };
    await apply(collaboratorChanged("added", hubot, secrets));
    expect(await readableBy(hubot)).toEqual(["secrets", "widgets"]);

    collaborators = { "acme/secrets": [readAs(hubot, "admin")] };
    await apply(collaboratorChanged("edited", hubot, secrets));
    expect(
      await authorize(database, { githubId: hubot.id }, "acme", { owner: "Acme", name: "secrets" }),
    ).toMatchObject({ repo: { isOwner: true } });

    collaborators = { "acme/secrets": [] };
    expect(await apply(collaboratorChanged("removed", hubot, secrets))).toBe(true);
    expect(await readableBy(hubot)).toEqual(["widgets"]);
    expect(log).toContainEqual(
      expect.objectContaining({ event: "repo_access.revoked", source: "member.removed" }),
    );
  });

  it("asks GitHub, not the event, so a stale removal leaves current access", async () => {
    collaborators = { "acme/secrets": [readAs(hubot, "read")] };
    await apply(collaboratorChanged("removed", hubot, secrets));
    expect(await readableBy(hubot)).toEqual(["secrets", "widgets"]);
  });

  it("gives an outside collaborator that repo alone, and no membership", async () => {
    collaborators = { "acme/secrets": [readAs(mallory, "write")] };

    expect(await apply(collaboratorChanged("added", mallory, secrets))).toBe(true);

    expect(await readableBy(mallory)).toEqual(["secrets"]);
    expect((await roles()).map(({ login }) => login)).not.toContain("mallory");

    collaborators = { "acme/secrets": [] };
    await apply(collaboratorChanged("removed", mallory, secrets));
    expect(await readableBy(mallory)).toBe("not-found");
  });
});

describe("applyInstallationEvent personal repository collaborators", () => {
  const mona: AccountRef = { accountId: ACCOUNT_ID, login: "Mona" };
  const monaSecrets = { ...secrets, owner: "Mona" };
  const monaWidgets = { ...widgets, owner: "Mona" };

  beforeEach(async () => {
    listed = [monaSecrets, monaWidgets];
    await apply(installed(installation("user", "Mona")));
  });

  async function readableInMona(member: OrganizationMember) {
    const result = await authorize(database, { githubId: member.id }, "mona");
    if (result.status !== "allowed") return result.status;
    const rows = await database.select({ id: repos.id, name: repos.name }).from(repos);
    return result.readableRepos.map((entry) => rows.find((row) => row.id === entry.id)!.name).sort();
  }

  it("grants a collaborator that repository only, then revokes it", async () => {
    collaborators = { "mona/secrets": [readAs(hubot, "write")] };

    expect(await apply(memberChanged("member.added", hubot, mona, monaSecrets))).toBe(true);

    expect(await readableInMona(hubot)).toEqual(["secrets"]);
    expect(await authorize(database, { githubId: hubot.id }, "mona")).toMatchObject({
      role: "collaborator",
    });

    collaborators = { "mona/secrets": [] };
    await apply(memberChanged("member.removed", hubot, mona, monaSecrets));
    expect(await readableInMona(hubot)).toBe("not-found");
  });

  it("refreshes a personal repository's readers who have signed in, when it is made private", async () => {
    await database.insert(users).values({ githubId: hubot.id, login: hubot.login });
    collaborators = { "mona/widgets": [readAs(hubot, "maintain")] };

    await apply(repositoryChanged("privatized", { ...monaWidgets, private: true }));

    expect(await readableInMona(hubot)).toEqual(["widgets"]);
  });
});

const renamed = (login: string): InstallationEvent => ({
  kind: "account_renamed",
  account: { accountId: ACCOUNT_ID, login },
  source: "organization.renamed",
});

function repositoriesAddedAs(
  accountId: number,
  login: string,
  accountType: InstallationInput["accountType"],
  installationId = INSTALLATION_ID,
): InstallationEvent {
  return {
    kind: "repositories_changed",
    installation: { installationId, accountId, accountType, login, suspendedAt: null },
    added: [],
    removed: [],
    source: "installation_repositories.added",
  };
}

async function slugs() {
  const orgs = await database
    .select({ githubAccountId: organizations.githubAccountId, slug: organizations.slug, name: organizations.name })
    .from(organizations)
    .orderBy(asc(organizations.id));
  const redirects = await database
    .select({ slug: organizationSlugRedirects.slug, githubAccountId: organizations.githubAccountId })
    .from(organizationSlugRedirects)
    .innerJoin(organizations, eq(organizations.id, organizationSlugRedirects.organizationId))
    .orderBy(asc(organizationSlugRedirects.slug));
  return { organizations: orgs, redirects };
}

describe("applyInstallationEvent account rename", () => {
  beforeEach(async () => {
    await apply(installed());
  });

  it("moves the slug and name and records the old slug as a redirect", async () => {
    expect(await apply(renamed("Acme-Corp"))).toBe(true);
    expect(await slugs()).toEqual({
      organizations: [{ githubAccountId: ACCOUNT_ID, slug: "acme-corp", name: "Acme-Corp" }],
      redirects: [{ slug: "acme", githubAccountId: ACCOUNT_ID }],
    });
    expect(log).toContainEqual(
      expect.objectContaining({
        event: "organization.renamed",
        source: "organization.renamed",
        from: "acme",
        to: "acme-corp",
      }),
    );
    expect(await authorize(database, { githubId: octocat.id }, "acme")).toEqual({
      status: "redirect",
      slug: "acme-corp",
    });
    expect(await authorize(database, { githubId: octocat.id }, "acme-corp")).toMatchObject({
      status: "allowed",
      role: "owner",
    });
    expect((await state()).repos).toEqual([repoRow(widgets), repoRow(secrets)]);
  });

  it("converges on redelivery", async () => {
    await apply(renamed("Acme-Corp"));
    const once = await slugs();
    expect(await apply(renamed("Acme-Corp"))).toBe(false);
    expect(await slugs()).toEqual(once);
  });

  it("keeps every earlier slug redirecting to the current one", async () => {
    await apply(renamed("Acme-Corp"));
    await apply(renamed("Acme-Global"));
    expect(await slugs()).toEqual({
      organizations: [{ githubAccountId: ACCOUNT_ID, slug: "acme-global", name: "Acme-Global" }],
      redirects: [
        { slug: "acme", githubAccountId: ACCOUNT_ID },
        { slug: "acme-corp", githubAccountId: ACCOUNT_ID },
      ],
    });
    expect(await authorize(database, { githubId: hubot.id }, "acme")).toEqual({
      status: "redirect",
      slug: "acme-global",
    });
  });

  it("renaming back to an earlier slug drops that redirect", async () => {
    await apply(renamed("Acme-Corp"));
    await apply(renamed("Acme"));
    expect(await slugs()).toEqual({
      organizations: [{ githubAccountId: ACCOUNT_ID, slug: "acme", name: "Acme" }],
      redirects: [{ slug: "acme-corp", githubAccountId: ACCOUNT_ID }],
    });
    expect(await readableBy(hubot)).toEqual(["widgets"]);
  });

  it("follows a login change seen on a repositories change", async () => {
    expect(await apply(repositoriesAddedAs(ACCOUNT_ID, "Acme-Corp", "organization"))).toBe(true);
    expect(await slugs()).toEqual({
      organizations: [{ githubAccountId: ACCOUNT_ID, slug: "acme-corp", name: "Acme-Corp" }],
      redirects: [{ slug: "acme", githubAccountId: ACCOUNT_ID }],
    });
    expect(log).toContainEqual(
      expect.objectContaining({ event: "organization.renamed", source: "installation_repositories.added" }),
    );
  });

  it("follows a login change on accepted permissions", async () => {
    const accepted: InstallationEvent = {
      kind: "permissions_accepted",
      installation: installation("organization", "Acme-Corp"),
      source: "installation.new_permissions_accepted",
    };
    expect(await apply(accepted)).toBe(true);
    expect((await slugs()).organizations).toEqual([
      { githubAccountId: ACCOUNT_ID, slug: "acme-corp", name: "Acme-Corp" },
    ]);
  });

  it("gives a retired slug to a new account that claims it, dropping the redirect", async () => {
    await apply(renamed("Acme-Corp"));
    await apply(repositoriesAddedAs(2_000, "Acme", "user", 556));
    expect(await slugs()).toEqual({
      organizations: [
        { githubAccountId: ACCOUNT_ID, slug: "acme-corp", name: "Acme-Corp" },
        { githubAccountId: 2_000, slug: "acme", name: "Acme" },
      ],
      redirects: [],
    });
    expect(await authorize(database, { githubId: octocat.id }, "acme")).toEqual({ status: "not-found" });
  });

  it("moves a stale holder of the slug aside for the account that now has the login", async () => {
    await apply(repositoriesAddedAs(2_000, "Acme", "user", 556));
    expect((await slugs()).organizations).toEqual([
      { githubAccountId: ACCOUNT_ID, slug: "acme_1000", name: "Acme" },
      { githubAccountId: 2_000, slug: "acme", name: "Acme" },
    ]);
  });

  it("skips a rename of an account it does not know and writes nothing", async () => {
    const before = await slugs();
    const elsewhere: InstallationEvent = {
      kind: "account_renamed",
      account: { accountId: 9_999, login: "Elsewhere" },
      source: "organization.renamed",
    };
    expect(await apply(elsewhere)).toBe(false);
    expect(await slugs()).toEqual(before);
    expect(log).toContainEqual(
      expect.objectContaining({ event: "organization.rename_skipped", githubAccountId: 9_999 }),
    );
  });
});
