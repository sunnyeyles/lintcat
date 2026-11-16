import { createHmac } from "node:crypto";

import {
  authorize,
  memberships,
  organizations,
  repoSettings,
  repos,
  reviewJobs,
  saveRepoSettings,
  users,
  type Database,
  type RepoReviewMode,
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
let pingCalls: number;

// GitHub's current truth; tests change `members` to simulate edits made on GitHub.
const github: GithubAppClient = {
  async createInstallationToken() {
    throw new Error("the webhook never mints a token");
  },
  async findUserInstallation() {
    throw new Error("the webhook never looks up an installation");
  },
  async getInstallation() {
    throw new Error("the webhook never reads the installation");
  },
  async listInstallationRepositories(installationId) {
    listCalls += 1;
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
  listCalls = 0;
  members = [octocat, hubot];
  githubCalls = 0;
  collaborators = {};
  log = [];
  pingCalls = 0;
});

function installation(
  type: "Organization" | "User" | "Enterprise" = "Organization",
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
    pingWorker: () => {
      pingCalls += 1;
    },
  });
}

const uninstalled = () =>
  delivery("installation", { action: "deleted", installation: installation() });

const created = (type: "Organization" | "User" | "Enterprise" = "Organization", login = "Acme") =>
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
      {
        database,
        github,
        logger: createCapturingLogger().logger,
        webhookSecret: "",
        pingWorker: () => {},
      },
    );
    expect(response.status).toBe(401);
    expect(await state()).toEqual(empty);
  });
});

describe("handleGithubWebhook installation", () => {
  it("installs on created, logging the delivery as the source", async () => {
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
    expect(log).toContainEqual(
      expect.objectContaining({ event: "membership.granted", source: "installation.created" }),
    );
  });

  it("reads a personal account install as a user-type organization", async () => {
    listed = [{ ...widgets, owner: "Mona" }];
    expect((await deliver(created("User", "Mona"))).status).toBe(200);
    expect((await state()).organizations).toMatchObject([{ accountType: "user", slug: "mona" }]);
  });

  it("204s an account type the dashboard does not serve", async () => {
    expect((await deliver(created("Enterprise"))).status).toBe(204);
    expect(await state()).toEqual(empty);
    expect(listCalls).toBe(0);
  });

  it("sets suspended_at from the payload on suspend and clears it on unsuspend", async () => {
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

  it("uninstalls on deleted", async () => {
    await deliver(created());
    expect((await deliver(uninstalled())).status).toBe(200);
    expect((await state()).organizations).toMatchObject([
      { installationId: null, uninstalled: true },
    ]);
  });

  it("follows a login change on new_permissions_accepted, and 204s one with nothing to follow", async () => {
    const accepted = (login: string) =>
      delivery("installation", {
        action: "new_permissions_accepted",
        installation: installation("Organization", login),
      });
    expect((await deliver(accepted("Acme"))).status).toBe(204);
    expect(await state()).toEqual(empty);

    await deliver(created());
    expect((await deliver(accepted("Acme-Corp"))).status).toBe(200);
    expect((await state()).organizations).toMatchObject([{ slug: "acme-corp" }]);
  });

  it("204s an installation action it does not act on", async () => {
    await deliver(created());
    const response = await deliver(
      delivery("installation", { action: "unknown", installation: installation() }),
    );
    expect(response.status).toBe(204);
  });

  it("400s a malformed installation payload", async () => {
    const response = await deliver(delivery("installation", { action: "created" }));
    expect(response.status).toBe(400);
    expect(await state()).toEqual(empty);
  });
});

describe("handleGithubWebhook installation_repositories", () => {
  beforeEach(async () => {
    listed = [widgets];
    await deliver(created());
  });

  it("adds repositories, taking the owner from the full name", async () => {
    const response = await deliver(repositoriesChanged("added", [secrets]));
    expect(response.status).toBe(200);
    expect((await state()).repos).toEqual([repoRow(widgets), repoRow(secrets)]);
  });

  it("marks repositories removed", async () => {
    const response = await deliver(repositoriesChanged("removed", [widgets]));
    expect(response.status).toBe(200);
    expect((await state()).repos).toEqual([repoRow(widgets, true)]);
  });

  it("logs the delivery as the source of a login change", async () => {
    await deliver(
      delivery("installation_repositories", {
        action: "added",
        installation: installation("Organization", "Acme-Corp"),
        repositories_added: [],
        repositories_removed: [],
      }),
    );
    expect(log).toContainEqual(
      expect.objectContaining({ event: "organization.renamed", source: "installation_repositories.added" }),
    );
  });

  it("204s a late delivery for an uninstalled organization", async () => {
    await deliver(uninstalled());
    expect((await deliver(repositoriesChanged("added", [secrets]))).status).toBe(204);
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

const readAs = (member: OrganizationMember, permission: RepositoryCollaborator["permission"]) => ({
  id: member.id,
  login: member.login,
  permission,
});

describe("handleGithubWebhook members", () => {
  beforeEach(async () => {
    members = [octocat];
    await deliver(created());
  });

  it("syncs a member on organization.member_added, logging the delivery as the source", async () => {
    members = [octocat, hubot];
    const response = await deliver(organizationEvent("member_added", hubot));
    expect(response.status).toBe(200);
    expect(await roles()).toEqual([
      { login: "octocat", role: "owner" },
      { login: "hubot", role: "member" },
    ]);
    expect(log).toEqual([
      expect.objectContaining({ event: "membership.granted", source: "organization.member_added" }),
    ]);
  });

  it("syncs a member on organization.member_removed", async () => {
    members = [octocat, hubot];
    await deliver(organizationEvent("member_added", hubot));
    members = [octocat];
    expect((await deliver(organizationEvent("member_removed", hubot))).status).toBe(200);
    expect(await roles()).toEqual([{ login: "octocat", role: "owner" }]);
  });

  it("syncs a member on membership and member deliveries", async () => {
    members = [{ ...octocat, role: "member" }];
    expect((await deliver(memberEvent("member", "edited", octocat))).status).toBe(200);
    expect(await roles()).toEqual([{ login: "octocat", role: "member" }]);

    members = [octocat];
    expect((await deliver(memberEvent("membership", "added", octocat))).status).toBe(200);
    expect(await roles()).toEqual([{ login: "octocat", role: "owner" }]);
  });

  it("204s an organization that has not installed the App", async () => {
    const response = await deliver(
      memberEvent("membership", "added", hubot, { id: 9_999, login: "Other" }),
    );
    expect(response.status).toBe(204);
    expect(log).toEqual([
      expect.objectContaining({ event: "membership.skipped", organization: "other" }),
    ]);
  });

  it("204s a collaborator change that names no account at all", async () => {
    const response = await deliver(memberEvent("member", "added", hubot, null));
    expect(response.status).toBe(204);
    expect(log).toEqual([]);
    expect(await roles()).toEqual([{ login: "octocat", role: "owner" }]);
  });

  it("204s actions it does not act on, without asking GitHub", async () => {
    githubCalls = 0;
    const invited = delivery("organization", { action: "member_invited", organization: acme });
    expect((await deliver(invited)).status).toBe(204);
    expect((await deliver(memberEvent("membership", "edited", hubot))).status).toBe(204);
    expect(githubCalls).toBe(0);
  });

  it("passes a collaborator delivery's repository on, logging it as the source", async () => {
    collaborators = { "acme/secrets": [readAs(hubot, "write")] };
    const response = await deliver(
      delivery("member", {
        action: "added",
        member: payloadUser(hubot),
        repository: { id: secrets.id, name: secrets.name, full_name: "Acme/secrets" },
        organization: acme,
        installation: { id: INSTALLATION_ID },
      }),
    );
    expect(response.status).toBe(200);
    expect(log).toContainEqual(
      expect.objectContaining({ event: "repo_access.granted", source: "member.added" }),
    );
  });
});

describe("handleGithubWebhook personal repository collaborators", () => {
  const mona = { id: ACCOUNT_ID, login: "Mona" };
  const monaSecrets = { ...secrets, owner: "Mona" };

  beforeEach(async () => {
    listed = [monaSecrets];
    await deliver(created("User", "Mona"));
  });

  it("takes the repository's owner as the account when the delivery names no organization", async () => {
    collaborators = { "mona/secrets": [readAs(hubot, "write")] };
    const response = await deliver(
      delivery("member", {
        action: "added",
        member: payloadUser(hubot),
        repository: { id: secrets.id, name: secrets.name, full_name: "Mona/secrets", owner: mona },
        installation: { id: INSTALLATION_ID },
      }),
    );
    expect(response.status).toBe(200);
    expect(await authorize(database, { githubId: hubot.id }, "mona")).toMatchObject({
      status: "allowed",
      role: "collaborator",
    });
  });

  it("ignores a team membership delivery's repository owner", async () => {
    const response = await deliver(
      delivery("membership", {
        action: "added",
        member: payloadUser(hubot),
        repository: { id: secrets.id, owner: mona },
        installation: { id: INSTALLATION_ID },
      }),
    );
    expect(response.status).toBe(204);
  });
});

function repositoryEvent(
  action: string,
  repo: InstallationRepository,
  ownerId = ACCOUNT_ID,
) {
  return delivery("repository", {
    action,
    repository: {
      id: repo.id,
      name: repo.name,
      full_name: `${repo.owner}/${repo.name}`,
      private: repo.private,
      owner: { id: ownerId, login: repo.owner },
    },
    organization: acme,
    installation: { id: INSTALLATION_ID },
  });
}

describe("handleGithubWebhook repository", () => {
  beforeEach(async () => {
    await deliver(created());
  });

  it("follows a rename, logging the delivery as the source", async () => {
    const response = await deliver(repositoryEvent("renamed", { ...widgets, name: "gizmos" }));
    expect(response.status).toBe(200);
    expect((await state()).repos).toContainEqual(repoRow({ ...widgets, name: "gizmos" }));
    expect(log).toContainEqual(
      expect.objectContaining({ event: "repository.updated", source: "repository.renamed" }),
    );
  });

  it("maps each action it acts on", async () => {
    collaborators = { "acme/widgets": [] };
    expect((await deliver(repositoryEvent("privatized", { ...widgets, private: true }))).status).toBe(200);
    expect((await deliver(repositoryEvent("publicized", widgets))).status).toBe(200);
    expect((await deliver(repositoryEvent("transferred", widgets, 2_000))).status).toBe(200);
    expect((await deliver(repositoryEvent("deleted", secrets))).status).toBe(200);
    expect((await state()).repos).toEqual([repoRow(widgets, true), repoRow(secrets, true)]);
  });

  it("204s a repository the installation never reported, and actions it does not act on", async () => {
    const unknown = { ...widgets, id: 1 };
    expect((await deliver(repositoryEvent("renamed", unknown))).status).toBe(204);
    expect((await deliver(repositoryEvent("archived", widgets))).status).toBe(204);
    expect(log).toEqual([]);
  });
});

const renamed = (login: string, id = ACCOUNT_ID) =>
  delivery("organization", {
    action: "renamed",
    changes: { login: { from: "Acme" } },
    organization: { id, login },
    installation: { id: INSTALLATION_ID },
  });

describe("handleGithubWebhook organization rename", () => {
  beforeEach(async () => {
    await deliver(created());
  });

  it("follows the new login", async () => {
    const response = await deliver(renamed("Acme-Corp"));
    expect(response.status).toBe(200);
    expect((await state()).organizations).toMatchObject([{ slug: "acme-corp", name: "Acme-Corp" }]);
    expect(log).toContainEqual(
      expect.objectContaining({ event: "organization.renamed", source: "organization.renamed" }),
    );
  });

  it("204s a redelivery, and an account it does not know", async () => {
    await deliver(renamed("Acme-Corp"));
    expect((await deliver(renamed("Acme-Corp"))).status).toBe(204);
    expect((await deliver(renamed("Elsewhere", 9_999))).status).toBe(204);
  });
});

describe("handleGithubWebhook other deliveries", () => {
  it("204s an event it does not act on", async () => {
    const response = await deliver(delivery("push", { ref: "refs/heads/main" }));
    expect(response.status).toBe(204);
    expect(await state()).toEqual(empty);
  });

  it("400s a body that is not JSON", async () => {
    const body = "{not json";
    const response = await deliver(
      new Request("https://example.test/api/github/webhook", {
        method: "POST",
        headers: { "x-github-event": "installation", "x-hub-signature-256": signature(SECRET, body) },
        body,
      }),
    );
    expect(response.status).toBe(400);
  });
});

describe("handleGithubWebhook pull_request", () => {
  beforeEach(async () => {
    await deliver(created());
    await setMode(widgets, "label");
  });

  let deliveries = 0;
  function pullRequestEvent(
    action: string,
    {
      labels = ["ai-review"],
      label,
      headSha = "head-1",
      number = 7,
      state = "open",
      repo = widgets,
      deliveryId = `delivery-${++deliveries}`,
    }: {
      labels?: string[];
      label?: string;
      headSha?: string;
      number?: number;
      state?: string;
      repo?: InstallationRepository;
      deliveryId?: string;
    } = {},
  ): Request {
    const payload = {
      action,
      number,
      ...(label === undefined ? {} : { label: { name: label } }),
      pull_request: {
        number,
        state,
        head: { sha: headSha },
        labels: labels.map((name) => ({ name })),
      },
      repository: { id: repo.id, name: repo.name, owner: { login: repo.owner } },
      installation: { id: INSTALLATION_ID },
    };
    const request = delivery("pull_request", payload);
    request.headers.set("x-github-delivery", deliveryId);
    return request;
  }

  async function jobs() {
    return database
      .select({
        githubRepoId: repos.githubRepoId,
        prNumber: reviewJobs.prNumber,
        headSha: reviewJobs.headSha,
        status: reviewJobs.status,
      })
      .from(reviewJobs)
      .innerJoin(repos, eq(repos.id, reviewJobs.repoId))
      .orderBy(asc(reviewJobs.id));
  }

  const queued = (headSha: string) => ({
    githubRepoId: widgets.id,
    prNumber: 7,
    headSha,
    status: "queued",
  });

  async function setMode(repo: InstallationRepository, mode: RepoReviewMode): Promise<void> {
    const [row] = await database
      .select({ id: repos.id })
      .from(repos)
      .where(eq(repos.githubRepoId, repo.id));
    await saveRepoSettings(database, row!.id, { mode, model: null, fixes: false });
  }

  it("queues a review when the ai-review label is added", async () => {
    const response = await deliver(pullRequestEvent("labeled", { label: "ai-review" }));
    expect(response.status).toBe(200);
    expect(await jobs()).toEqual([queued("head-1")]);
    expect(pingCalls).toBe(1);
  });

  it("ignores any other label", async () => {
    const response = await deliver(
      pullRequestEvent("labeled", { label: "bug", labels: ["bug", "ai-review"] }),
    );
    expect(response.status).toBe(204);
    expect(await jobs()).toEqual([]);
    expect(pingCalls).toBe(0);
  });

  it("queues a push or a reopen on a labelled pull request, superseding the older head", async () => {
    await deliver(pullRequestEvent("labeled", { label: "ai-review" }));
    expect((await deliver(pullRequestEvent("synchronize", { headSha: "head-2" }))).status).toBe(200);
    expect((await deliver(pullRequestEvent("reopened", { headSha: "head-3" }))).status).toBe(200);
    expect(await jobs()).toEqual([
      { ...queued("head-1"), status: "superseded" },
      { ...queued("head-2"), status: "superseded" },
      queued("head-3"),
    ]);
    expect(pingCalls).toBe(3);
  });

  it("ignores a push or a reopen on a pull request without the label", async () => {
    for (const action of ["synchronize", "reopened"]) {
      const response = await deliver(pullRequestEvent(action, { labels: [] }));
      expect(response.status).toBe(204);
    }
    expect(await jobs()).toEqual([]);
  });

  it("ignores every other action, and a closed pull request", async () => {
    for (const action of ["opened", "edited", "closed", "unlabeled"]) {
      expect((await deliver(pullRequestEvent(action, { label: "ai-review" }))).status).toBe(204);
    }
    const closed = pullRequestEvent("labeled", { label: "ai-review", state: "closed" });
    expect((await deliver(closed)).status).toBe(204);
    expect(await jobs()).toEqual([]);
  });

  it("creates one job for a redelivered webhook", async () => {
    const first = await deliver(
      pullRequestEvent("labeled", { label: "ai-review", deliveryId: "same" }),
    );
    const again = await deliver(
      pullRequestEvent("labeled", { label: "ai-review", deliveryId: "same" }),
    );
    expect([first.status, again.status]).toEqual([200, 200]);
    expect(await jobs()).toEqual([queued("head-1")]);
    expect(log).toContainEqual(
      expect.objectContaining({ event: "review_job.duplicate", deliveryId: "same" }),
    );
    expect(pingCalls).toBe(1);
  });

  it("ignores a repository the installation does not cover", async () => {
    const stranger = { ...widgets, id: 42, name: "stranger" };
    await deliver(repositoriesChanged("removed", [secrets]));
    for (const repo of [stranger, secrets]) {
      const response = await deliver(pullRequestEvent("labeled", { label: "ai-review", repo }));
      expect(response.status).toBe(204);
    }
    expect(await jobs()).toEqual([]);
  });

  it("ignores a suspended or uninstalled organization", async () => {
    await deliver(
      delivery("installation", {
        action: "suspend",
        installation: installation("Organization", "Acme", SUSPENDED_AT),
      }),
    );
    expect((await deliver(pullRequestEvent("labeled", { label: "ai-review" }))).status).toBe(204);
    await deliver(uninstalled());
    expect((await deliver(pullRequestEvent("labeled", { label: "ai-review" }))).status).toBe(204);
    expect(await jobs()).toEqual([]);
  });

  it("400s a malformed pull_request payload", async () => {
    const response = await deliver(delivery("pull_request", { action: "labeled" }));
    expect(response.status).toBe(400);
  });

  describe("mode off", () => {
    it("enqueues nothing, even with the label", async () => {
      await setMode(widgets, "off");
      const response = await deliver(pullRequestEvent("labeled", { label: "ai-review" }));
      expect(response.status).toBe(204);
      expect(await jobs()).toEqual([]);
    });
  });

  describe("mode every_pr", () => {
    it("is what a repository with no saved settings gets", async () => {
      await database.delete(repoSettings);
      const response = await deliver(pullRequestEvent("opened", { labels: [] }));
      expect(response.status).toBe(200);
      expect(await jobs()).toEqual([queued("head-1")]);
    });

    it("queues opened, synchronize and reopened without the label", async () => {
      await setMode(widgets, "every_pr");
      for (const [index, action] of ["opened", "synchronize", "reopened"].entries()) {
        const response = await deliver(
          pullRequestEvent(action, { labels: [], headSha: `head-${index}` }),
        );
        expect(response.status).toBe(200);
      }
      expect(await jobs()).toHaveLength(3);
    });

    it("still ignores a closed pull request", async () => {
      await setMode(widgets, "every_pr");
      const response = await deliver(pullRequestEvent("opened", { labels: [], state: "closed" }));
      expect(response.status).toBe(204);
      expect(await jobs()).toEqual([]);
    });

    it("ignores actions no mode reviews", async () => {
      await setMode(widgets, "every_pr");
      const response = await deliver(pullRequestEvent("edited", { labels: [] }));
      expect(response.status).toBe(204);
      expect(await jobs()).toEqual([]);
    });
  });
});
