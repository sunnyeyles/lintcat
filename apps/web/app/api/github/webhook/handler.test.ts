import { createHmac } from "node:crypto";

import {
  memberships,
  organizations,
  repos,
  reviews,
  users,
  type Database,
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

import { authorize } from "@/lib/authorize";
import { membershipsForUser } from "@/lib/organization";

import { handleGithubWebhook } from "./handler";

const SECRET = "webhook-secret";
const INSTALLATION_ID = 555;
const ACCOUNT_ID = 1_000;
const SUSPENDED_AT = "2026-09-01T12:00:00Z";

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

let database: Database;
let listed: InstallationRepository[];
let listCalls: number;
let members: OrganizationMember[];
let githubCalls: number;
// "owner/name" (lowercased) -> who can read it on GitHub; a missing repo makes a listing fail.
let collaborators: Record<string, RepositoryCollaborator[]>;
let log: CapturedLogEvent[];

// GitHub's current truth; tests change `members` to simulate edits made on GitHub.
const github: GithubAppClient = {
  async listInstallationRepositories(installationId) {
    listCalls += 1;
    expect(installationId).toBe(INSTALLATION_ID);
    return listed;
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
  listCalls = 0;
  members = [octocat, hubot];
  githubCalls = 0;
  collaborators = {};
  log = [];
});

function installation(
  type: "Organization" | "User" = "Organization",
  login = "Acme",
  suspendedAt: string | null = null,
) {
  return {
    id: INSTALLATION_ID,
    account: { id: ACCOUNT_ID, login, type },
    suspended_at: suspendedAt,
  };
}

function payloadRepo(repo: InstallationRepository) {
  return {
    id: repo.id,
    name: repo.name,
    full_name: `${repo.owner}/${repo.name}`,
    private: repo.private,
  };
}

function delivery(
  event: string,
  payload: unknown,
  sign: (body: string) => string | undefined = (body) => signature(SECRET, body),
): Request {
  const body = JSON.stringify(payload);
  const signed = sign(body);
  return new Request("https://example.test/api/github/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": event,
      ...(signed ? { "x-hub-signature-256": signed } : {}),
    },
    body,
  });
}

function signature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function deliver(request: Request): Promise<Response> {
  const capturing = createCapturingLogger();
  log = capturing.entries;
  return handleGithubWebhook(request, {
    database,
    github,
    logger: capturing.logger,
    webhookSecret: SECRET,
  });
}

const uninstalled = () =>
  delivery("installation", { action: "deleted", installation: installation() });

async function seedReview(repo: InstallationRepository): Promise<void> {
  const [row] = await database
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.githubRepoId, repo.id));
  await database.insert(reviews).values({
    repoId: row!.id,
    prNumber: 1,
    headSha: `sha-${repo.name}`,
    agents: ["security"],
    summary: "ok",
  });
}

const created = (type: "Organization" | "User" = "Organization", login = "Acme") =>
  delivery("installation", { action: "created", installation: installation(type, login) });

function repositoriesChanged(
  action: "added" | "removed",
  changed: InstallationRepository[],
) {
  return delivery("installation_repositories", {
    action,
    installation: installation(),
    repositories_added: action === "added" ? changed.map(payloadRepo) : [],
    repositories_removed: action === "removed" ? changed.map(payloadRepo) : [],
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

describe("handleGithubWebhook signature", () => {
  it("401s a delivery with no signature and writes nothing", async () => {
    const response = await deliver(
      delivery(
        "installation",
        { action: "created", installation: installation() },
        () => undefined,
      ),
    );
    expect(response.status).toBe(401);
    expect(await state()).toEqual(empty);
    expect(listCalls).toBe(0);
  });

  it("401s a delivery signed with another secret", async () => {
    const response = await deliver(
      delivery(
        "installation",
        { action: "created", installation: installation() },
        (body) => signature("not-the-secret", body),
      ),
    );
    expect(response.status).toBe(401);
    expect(await state()).toEqual(empty);
  });

  it("401s a body that does not match its signature", async () => {
    const response = await deliver(
      delivery(
        "installation",
        { action: "created", installation: installation() },
        () => signature(SECRET, "{}"),
      ),
    );
    expect(response.status).toBe(401);
    expect(await state()).toEqual(empty);
  });

  it("401s everything when no secret is configured", async () => {
    const response = await handleGithubWebhook(
      delivery("installation", { action: "created", installation: installation() }, (body) =>
        signature("", body),
      ),
      { database, github, logger: createCapturingLogger().logger, webhookSecret: "" },
    );
    expect(response.status).toBe(401);
    expect(await state()).toEqual(empty);
  });
});

describe("handleGithubWebhook installation", () => {
  it("creates an organization and its repositories on an organization install", async () => {
    const response = await deliver(created());
    expect(response.status).toBe(200);
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
    const response = await deliver(created("User", "Mona"));
    expect(response.status).toBe(200);
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
      agents: ["security"],
      summary: "ok",
    });

    await deliver(created());

    expect((await state()).repos).toEqual([repoRow(widgets), repoRow(secrets)]);
    expect(await database.select().from(reviews)).toHaveLength(1);
  });

  it("marks removed the repositories the installation no longer lists when created again", async () => {
    await deliver(created());
    listed = [secrets];
    await deliver(created());
    expect((await state()).repos).toEqual([repoRow(widgets, true), repoRow(secrets)]);
  });

  it("sets and clears suspended_at on suspend and unsuspend", async () => {
    await deliver(created());

    const suspend = await deliver(
      delivery("installation", {
        action: "suspend",
        installation: installation("Organization", "Acme", SUSPENDED_AT),
      }),
    );
    expect(suspend.status).toBe(200);
    expect((await state()).organizations[0]?.suspendedAt).toEqual(new Date(SUSPENDED_AT));

    const unsuspend = await deliver(
      delivery("installation", { action: "unsuspend", installation: installation() }),
    );
    expect(unsuspend.status).toBe(200);
    expect((await state()).organizations[0]?.suspendedAt).toBeNull();
  });

  it("keeps the organization, its repositories and reviews on uninstall, but closes access", async () => {
    await deliver(created());
    await seedReview(widgets);
    const response = await deliver(uninstalled());
    expect(response.status).toBe(200);

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

  it("converges when an uninstall is delivered twice", async () => {
    await deliver(created());
    const request = uninstalled();
    await deliver(request.clone());
    const [once] = await database.select().from(organizations);
    await deliver(request);
    expect(await database.select().from(organizations)).toEqual([once]);
  });

  it("brings the organization and its re-listed repositories back on reinstall", async () => {
    await deliver(created());
    await seedReview(widgets);
    await seedReview(secrets);
    await deliver(uninstalled());

    listed = [widgets];
    members = [octocat];
    const response = await deliver(created());

    expect(response.status).toBe(200);
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

  it("does not revive an uninstalled organization for a late repositories delivery", async () => {
    await deliver(created());
    await deliver(uninstalled());
    const response = await deliver(repositoriesChanged("added", [widgets]));
    expect(response.status).toBe(204);
    expect((await state()).organizations).toMatchObject([
      { installationId: null, uninstalled: true },
    ]);
  });

  it("leaves state unchanged when the same delivery arrives twice", async () => {
    const request = created();
    await deliver(request.clone());
    const once = await state();
    const again = await deliver(request);
    expect(again.status).toBe(200);
    expect(await state()).toEqual(once);
  });
});

describe("handleGithubWebhook installation_repositories", () => {
  beforeEach(async () => {
    listed = [widgets];
    await deliver(created());
  });

  it("adds repositories", async () => {
    const response = await deliver(repositoriesChanged("added", [secrets]));
    expect(response.status).toBe(200);
    expect((await state()).repos).toEqual([repoRow(widgets), repoRow(secrets)]);
  });

  it("marks repositories removed, keeping their reviews", async () => {
    await seedReview(widgets);
    const response = await deliver(repositoriesChanged("removed", [widgets]));
    expect(response.status).toBe(200);
    expect((await state()).repos).toEqual([repoRow(widgets, true)]);
    expect(await database.select().from(reviews)).toHaveLength(1);
  });

  it("converges when a removal is delivered twice", async () => {
    const request = repositoriesChanged("removed", [widgets]);
    await deliver(request.clone());
    const once = await database.select().from(repos);
    await deliver(request);
    expect(await database.select().from(repos)).toEqual(once);
  });

  it("restores a removed repository added again", async () => {
    await deliver(repositoriesChanged("removed", [widgets]));
    await deliver(repositoriesChanged("added", [widgets]));
    expect((await state()).repos).toEqual([repoRow(widgets)]);
  });

  it("converges when an add is delivered twice", async () => {
    const request = repositoriesChanged("added", [secrets]);
    await deliver(request.clone());
    const once = await state();
    await deliver(request);
    expect(await state()).toEqual(once);
  });

  it("creates the organization when an add arrives before the install", async () => {
    database = await createTestDatabase();
    await deliver(repositoriesChanged("added", [secrets]));
    const { organizations: orgs, repos: repoRows } = await state();
    expect(orgs).toMatchObject([{ slug: "acme", installationId: INSTALLATION_ID }]);
    expect(repoRows).toEqual([repoRow(secrets)]);
  });
});

function payloadUser(member: OrganizationMember) {
  return { id: member.id, login: member.login, avatar_url: member.avatarUrl };
}

const acme = { id: ACCOUNT_ID, login: "Acme" };

function organizationEvent(
  action: "member_added" | "member_removed",
  member: OrganizationMember,
) {
  return delivery("organization", {
    action,
    organization: acme,
    membership: { user: payloadUser(member), role: member.role, state: "active" },
    installation: { id: INSTALLATION_ID },
  });
}

function memberEvent(
  event: "member" | "membership",
  action: string,
  member: OrganizationMember,
  organization: typeof acme | null = acme,
) {
  return delivery(event, {
    action,
    member: payloadUser(member),
    ...(organization ? { organization } : {}),
    installation: { id: INSTALLATION_ID },
  });
}

async function roles() {
  return (await state()).memberships.map(({ login, role }) => ({ login, role }));
}

describe("handleGithubWebhook organization members", () => {
  beforeEach(async () => {
    members = [octocat];
    await deliver(created());
  });

  it("adds a member who joined the organization", async () => {
    members = [octocat, hubot];
    const response = await deliver(organizationEvent("member_added", hubot));
    expect(response.status).toBe(200);
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
    await deliver(organizationEvent("member_added", hubot));
    expect(await authorize(database, { githubId: hubot.id }, "acme")).toMatchObject({
      status: "allowed",
      role: "member",
    });

    members = [octocat];
    const response = await deliver(organizationEvent("member_removed", hubot));

    expect(response.status).toBe(200);
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
    await deliver(organizationEvent("member_added", hubot));
    members = [octocat, { ...hubot, role: "admin" }];
    const response = await deliver(memberEvent("membership", "added", hubot));
    expect(response.status).toBe(200);
    expect(await roles()).toContainEqual({ login: "hubot", role: "owner" });
    expect(await authorize(database, { githubId: hubot.id }, "acme")).toMatchObject({
      role: "owner",
    });
  });

  it("demotes an admin made a plain member", async () => {
    members = [{ ...octocat, role: "member" }];
    const response = await deliver(memberEvent("member", "edited", octocat));
    expect(response.status).toBe(200);
    expect(await roles()).toEqual([{ login: "octocat", role: "member" }]);
  });

  it("converges when the same delivery arrives twice", async () => {
    members = [octocat, hubot];
    const request = organizationEvent("member_added", hubot);
    await deliver(request.clone());
    const once = await state();
    const again = await deliver(request);
    expect(again.status).toBe(200);
    expect(await state()).toEqual(once);
  });

  it("follows GitHub, not the payload, when a stale removal arrives late", async () => {
    members = [octocat, hubot];
    await deliver(organizationEvent("member_added", hubot));
    await deliver(organizationEvent("member_removed", hubot));
    expect(await roles()).toContainEqual({ login: "hubot", role: "member" });
  });

  it("revokes members GitHub no longer lists when the App is installed again", async () => {
    members = [hubot];
    await deliver(created());
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
    await deliver(
      delivery("installation", { action: "unsuspend", installation: installation() }),
    );
    expect(await roles()).toEqual([{ login: "hubot", role: "member" }]);
  });

  it("skips an organization that is suspended, keeping its members", async () => {
    await deliver(
      delivery("installation", {
        action: "suspend",
        installation: installation("Organization", "Acme", SUSPENDED_AT),
      }),
    );
    githubCalls = 0;
    members = [];
    const response = await deliver(organizationEvent("member_removed", octocat));
    expect(response.status).toBe(204);
    expect(githubCalls).toBe(0);
    expect(await roles()).toEqual([{ login: "octocat", role: "owner" }]);
    expect(log).toEqual([
      expect.objectContaining({ event: "membership.skipped", reason: "installation_suspended" }),
    ]);
  });

  it("204s an organization that has not installed the App", async () => {
    const response = await deliver(
      memberEvent("membership", "added", hubot, { id: 9_999, login: "Other" }),
    );
    expect(response.status).toBe(204);
    expect(log).toEqual([
      expect.objectContaining({
        event: "membership.skipped",
        organization: "other",
        reason: "organization_not_installed",
      }),
    ]);
  });

  it("204s a collaborator change on a personal repository", async () => {
    const response = await deliver(memberEvent("member", "added", hubot, null));
    expect(response.status).toBe(204);
    expect(await roles()).toEqual([{ login: "octocat", role: "owner" }]);
  });

  it("204s organization actions it does not act on", async () => {
    const response = await deliver(
      delivery("organization", { action: "renamed", organization: acme }),
    );
    expect(response.status).toBe(204);
  });
});

describe("handleGithubWebhook other deliveries", () => {
  it("204s an event it does not act on", async () => {
    const response = await deliver(delivery("push", { ref: "refs/heads/main" }));
    expect(response.status).toBe(204);
    expect(await state()).toEqual(empty);
  });

  it("204s an installation action it does not act on", async () => {
    const response = await deliver(
      delivery("installation", {
        action: "new_permissions_accepted",
        installation: installation(),
      }),
    );
    expect(response.status).toBe(204);
    expect(await state()).toEqual(empty);
  });

  it("400s a malformed installation payload", async () => {
    const response = await deliver(delivery("installation", { action: "created" }));
    expect(response.status).toBe(400);
    expect(await state()).toEqual(empty);
  });

  it("writes nothing when the delivery fails halfway", async () => {
    await database.execute(sql`
      create function fail_repo_insert() returns trigger language plpgsql as $$
      begin raise exception 'repo insert failed'; end $$;
    `);
    await database.execute(sql`
      create trigger fail_repo_insert before insert on repos
      for each row execute function fail_repo_insert();
    `);

    await expect(deliver(created())).rejects.toThrow();
    expect(await state()).toEqual(empty);
  });
});
