import { memberships, organizations, repos, users, type Database } from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import type {
  AppInstallation,
  GithubAppClient,
  InstallationRepository,
  OrganizationMember,
} from "@pr-review/github";
import { createCapturingLogger, type CapturedLogEvent } from "@pr-review/logging";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { completeSetup, installOrganization, setupRequest } from "@/lib/installation";

const INSTALLATION_ID = 555;
const ACCOUNT_ID = 1_000;

const widgets: InstallationRepository = {
  id: 2_900_000_001,
  owner: "Acme",
  name: "widgets",
  private: false,
};

const octocat: OrganizationMember = {
  id: 3_000_000_001,
  login: "octocat",
  avatarUrl: null,
  role: "admin",
};
const hubot: OrganizationMember = {
  id: 3_000_000_002,
  login: "hubot",
  avatarUrl: null,
  role: "member",
};

let database: Database;
let installation: AppInstallation;
let members: OrganizationMember[];
let repoLookupFails: boolean;
let log: CapturedLogEvent[];

const github: GithubAppClient = {
  async createInstallationToken() {
    throw new Error("installing never mints a token");
  },
  async getInstallation(installationId) {
    expect(installationId).toBe(INSTALLATION_ID);
    return installation;
  },
  async listInstallationRepositories() {
    return [widgets];
  },
  async listOrganizationMembers() {
    return members;
  },
  async getOrganizationMembership() {
    throw new Error("setup never reads one membership");
  },
  async getRepositoryPermission() {
    if (repoLookupFails) throw new Error("GitHub is down");
    return null;
  },
  async listRepositoryCollaborators() {
    throw new Error("setup never lists collaborators");
  },
};

beforeEach(async () => {
  database = await createTestDatabase();
  installation = {
    id: INSTALLATION_ID,
    account: { id: ACCOUNT_ID, login: "Acme", type: "Organization" },
    suspendedAt: null,
  };
  members = [octocat, hubot];
  repoLookupFails = false;
  log = [];
});

function deps() {
  const capturing = createCapturingLogger();
  log = capturing.entries;
  return { database, github, logger: capturing.logger };
}

const account = (member: OrganizationMember) => ({
  githubId: member.id,
  login: member.login,
  avatarUrl: null,
});

async function counts() {
  return {
    organizations: (await database.select().from(organizations)).length,
    repos: (await database.select().from(repos)).length,
    memberships: (await database.select().from(memberships)).length,
  };
}

describe("setupRequest", () => {
  it("syncs on install and update", () => {
    expect(setupRequest({ installation_id: "555", setup_action: "install" })).toEqual({
      kind: "sync",
      installationId: 555,
    });
    expect(setupRequest({ installation_id: "555", setup_action: "update" })).toEqual({
      kind: "sync",
      installationId: 555,
    });
    expect(setupRequest({ installation_id: "555" })).toEqual({ kind: "sync", installationId: 555 });
  });

  it("recognises a pending request", () => {
    expect(setupRequest({ setup_action: "request" })).toEqual({ kind: "request" });
  });

  it("rejects a missing or malformed installation", () => {
    expect(setupRequest({})).toEqual({ kind: "invalid" });
    expect(setupRequest({ installation_id: "abc" })).toEqual({ kind: "invalid" });
    expect(setupRequest({ installation_id: ["1", "2"] })).toEqual({ kind: "invalid" });
    expect(setupRequest({ installation_id: "1", setup_action: ["install"] })).toEqual({
      kind: "invalid",
    });
  });
});

describe("completeSetup", () => {
  it("mirrors the installation before the webhook and lands the installer in it", async () => {
    const result = await completeSetup(deps(), INSTALLATION_ID, account(octocat));

    expect(result).toEqual({ status: "member", slug: "acme" });
    expect(await counts()).toEqual({ organizations: 1, repos: 1, memberships: 2 });
    const rows = await database
      .select({ login: users.login, role: memberships.role })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .orderBy(asc(memberships.id));
    expect(rows).toEqual([
      { login: "octocat", role: "owner" },
      { login: "hubot", role: "member" },
    ]);
    expect(log).toContainEqual(
      expect.objectContaining({ event: "membership.granted", source: "setup.install" }),
    );
  });

  it("converges when the webhook created the organization first", async () => {
    const d = deps();
    await installOrganization(
      d,
      {
        installationId: INSTALLATION_ID,
        accountId: ACCOUNT_ID,
        accountType: "organization",
        login: "Acme",
        suspendedAt: null,
      },
      "installation.created",
    );
    const before = await counts();

    const result = await completeSetup(d, INSTALLATION_ID, account(hubot));

    expect(result).toEqual({ status: "member", slug: "acme" });
    expect(await counts()).toEqual(before);
  });

  it("names the installed account for a signed-in user GitHub does not list", async () => {
    members = [octocat];

    const result = await completeSetup(deps(), INSTALLATION_ID, account(hubot));

    expect(result).toEqual({ status: "not_member", slug: "acme", accountType: "organization" });
    expect(await counts()).toEqual({ organizations: 1, repos: 1, memberships: 1 });
  });

  it("refuses an account type the dashboard does not serve", async () => {
    installation = { ...installation, account: { ...installation.account, type: "Enterprise" } };

    const result = await completeSetup(deps(), INSTALLATION_ID, account(octocat));

    expect(result).toEqual({ status: "unsupported" });
    expect(await counts()).toEqual({ organizations: 0, repos: 0, memberships: 0 });
  });

  it("survives a failed repo-access refresh", async () => {
    repoLookupFails = true;

    const result = await completeSetup(deps(), INSTALLATION_ID, account(hubot));

    expect(result).toEqual({ status: "member", slug: "acme" });
  });
});
