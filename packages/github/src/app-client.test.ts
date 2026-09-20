/** The App client over an injected Octokit stub: no network, no PEM. */
import { describe, expect, it, vi } from "vitest";

import {
  createAppClient,
  highestFlag,
  repositoryPermission,
  type AppOctokitLike,
  type RepositoryPermission,
} from "#src/app-client";

const installationId = 4242;

interface StubRoutes {
  installation?: unknown;
  repositories?: unknown[];
  members?: Record<"admin" | "all", unknown[]>;
  membership?: unknown;
  permissionLevel?: unknown;
  collaborators?: unknown[];
}

function notFound(): Error {
  return Object.assign(new Error("Not Found"), { status: 404 });
}

/** Routes are named by identity, the way Octokit's paginate takes a method. */
function stub(routes: StubRoutes) {
  const listRepos = Symbol("listReposAccessibleToInstallation");
  const listMembers = Symbol("listMembers");
  const listCollaborators = Symbol("listCollaborators");
  const paginate = vi.fn(async (route: unknown, params: Record<string, unknown>) => {
    if (route === listRepos) return routes.repositories ?? [];
    if (route === listMembers) {
      return routes.members?.[params.role as "admin" | "all"] ?? [];
    }
    if (route === listCollaborators) return routes.collaborators ?? [];
    throw new Error("unexpected route");
  });
  const getMembershipForUser = vi.fn(async () => {
    if (routes.membership === undefined) throw notFound();
    return { data: routes.membership };
  });
  const getCollaboratorPermissionLevel = vi.fn(async () => {
    if (routes.permissionLevel === undefined) throw notFound();
    return { data: routes.permissionLevel };
  });
  const getInstallation = vi.fn(async () => {
    if (routes.installation === undefined) throw notFound();
    return { data: routes.installation };
  });
  const octokit: AppOctokitLike = {
    paginate,
    rest: {
      apps: { listReposAccessibleToInstallation: listRepos, getInstallation },
      orgs: { listMembers, getMembershipForUser },
      repos: { listCollaborators, getCollaboratorPermissionLevel },
    },
  };
  const installation = vi.fn(() => octokit);
  return { client: createAppClient(installation), installation, paginate };
}

function collaborator(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: 1, login: "octocat", role_name: null, permissions: {}, ...overrides };
}

describe("getInstallation", () => {
  it("returns the account behind the installation", async () => {
    const { client, installation } = stub({
      installation: {
        id: installationId,
        account: { id: 7, login: "octo-org", type: "Organization" },
        suspended_at: "2026-09-01T12:00:00Z",
      },
    });
    await expect(client.getInstallation(installationId)).resolves.toEqual({
      id: installationId,
      account: { id: 7, login: "octo-org", type: "Organization" },
      suspendedAt: new Date("2026-09-01T12:00:00Z"),
    });
    expect(installation).toHaveBeenCalledWith(installationId);
  });

  it("rejects a response without an account", async () => {
    const { client } = stub({ installation: { id: installationId } });
    await expect(client.getInstallation(installationId)).rejects.toThrow();
  });
});

describe("repositoryPermission", () => {
  it("prefers role_name, which alone carries maintain and triage", () => {
    expect(repositoryPermission("maintain", "push")).toBe("maintain");
    expect(repositoryPermission("triage", "pull")).toBe("triage");
  });

  it("falls back to the legacy permission when role_name is a custom role", () => {
    expect(repositoryPermission("security-auditor", "read")).toBe("read");
    expect(repositoryPermission(null, "admin")).toBe("admin");
    expect(repositoryPermission(undefined, "write")).toBe("write");
  });

  it("is null when neither field names a known permission", () => {
    expect(repositoryPermission("security-auditor", "custom")).toBeNull();
    expect(repositoryPermission(null, null)).toBeNull();
    expect(repositoryPermission(null, "push")).toBeNull();
  });
});

describe("highestFlag", () => {
  const ordered: [Record<string, boolean>, RepositoryPermission][] = [
    [{ admin: true, maintain: true, push: true, triage: true, pull: true }, "admin"],
    [{ maintain: true, push: true, triage: true, pull: true }, "maintain"],
    [{ push: true, triage: true, pull: true }, "write"],
    [{ triage: true, pull: true }, "triage"],
    [{ pull: true }, "read"],
  ];

  it.each(ordered)("resolves %o to the highest flag set", (flags, expected) => {
    expect(highestFlag(flags)).toBe(expected);
  });

  it("ignores flags that are false or unknown", () => {
    expect(highestFlag({ admin: false, push: false, pull: true })).toBe("read");
    expect(highestFlag({ sudo: true })).toBeNull();
  });

  it("is null with no flags at all", () => {
    expect(highestFlag({})).toBeNull();
    expect(highestFlag(null)).toBeNull();
    expect(highestFlag(undefined)).toBeNull();
  });
});

describe("listInstallationRepositories", () => {
  it("maps owner, name and visibility for public and private repos", async () => {
    const { client, installation } = stub({
      repositories: [
        { id: 1, name: "public-service", private: false, owner: { login: "octo-org" } },
        { id: 2, name: "secrets", private: true, owner: { login: "octo-org" } },
      ],
    });
    await expect(client.listInstallationRepositories(installationId)).resolves.toEqual([
      { id: 1, owner: "octo-org", name: "public-service", private: false },
      { id: 2, owner: "octo-org", name: "secrets", private: true },
    ]);
    expect(installation).toHaveBeenCalledWith(installationId);
  });
});

describe("listOrganizationMembers", () => {
  it("marks members returned by the admin listing as admins", async () => {
    const { client } = stub({
      members: {
        admin: [{ id: 1, login: "owner", avatar_url: "https://img/1" }],
        all: [
          { id: 1, login: "owner", avatar_url: "https://img/1" },
          { id: 2, login: "dev", avatar_url: null },
        ],
      },
    });
    await expect(client.listOrganizationMembers(installationId, "octo-org")).resolves.toEqual(
      [
        { id: 1, login: "owner", avatarUrl: "https://img/1", role: "admin" },
        { id: 2, login: "dev", avatarUrl: null, role: "member" },
      ],
    );
  });
});

describe("getOrganizationMembership", () => {
  it("returns the active member with their role", async () => {
    const { client } = stub({
      membership: {
        state: "active",
        role: "admin",
        user: { id: 7, login: "owner", avatar_url: null },
      },
    });
    await expect(
      client.getOrganizationMembership(installationId, "octo-org", "owner"),
    ).resolves.toEqual({ id: 7, login: "owner", avatarUrl: null, role: "admin" });
  });

  it("is null for a pending invitation and for a 404", async () => {
    const pending = stub({
      membership: {
        state: "pending",
        role: "member",
        user: { id: 8, login: "invitee", avatar_url: null },
      },
    });
    await expect(
      pending.client.getOrganizationMembership(installationId, "octo-org", "invitee"),
    ).resolves.toBeNull();
    const absent = stub({});
    await expect(
      absent.client.getOrganizationMembership(installationId, "octo-org", "stranger"),
    ).resolves.toBeNull();
  });

  it("rethrows anything that is not a 404", async () => {
    const client = createAppClient(() => ({
      paginate: async () => [],
      rest: {
        apps: { listReposAccessibleToInstallation: null, getInstallation: async () => ({ data: null }) },
        orgs: {
          listMembers: null,
          getMembershipForUser: async () => {
            throw Object.assign(new Error("boom"), { status: 500 });
          },
        },
        repos: {
          listCollaborators: null,
          getCollaboratorPermissionLevel: async () => ({ data: null }),
        },
      },
    }));
    await expect(
      client.getOrganizationMembership(installationId, "octo-org", "owner"),
    ).rejects.toThrow("boom");
  });
});

describe("getRepositoryPermission", () => {
  it("resolves maintain from role_name, which the legacy field cannot express", async () => {
    const { client } = stub({
      permissionLevel: {
        permission: "write",
        role_name: "maintain",
        user: collaborator({ id: 3, login: "maintainer" }),
      },
    });
    await expect(
      client.getRepositoryPermission(installationId, "octo-org", "secrets", "maintainer"),
    ).resolves.toEqual({ id: 3, login: "maintainer", permission: "maintain" });
  });

  it("falls back to the legacy permission for a custom role", async () => {
    const { client } = stub({
      permissionLevel: {
        permission: "read",
        role_name: "security-auditor",
        user: collaborator({ id: 4, login: "auditor" }),
      },
    });
    await expect(
      client.getRepositoryPermission(installationId, "octo-org", "secrets", "auditor"),
    ).resolves.toEqual({ id: 4, login: "auditor", permission: "read" });
  });

  it("denies a user whose permission is none, even with a user body", async () => {
    const { client } = stub({
      permissionLevel: {
        permission: "none",
        role_name: "read",
        user: collaborator({ id: 5, login: "outsider" }),
      },
    });
    await expect(
      client.getRepositoryPermission(installationId, "octo-org", "secrets", "outsider"),
    ).resolves.toBeNull();
  });

  it("denies when the private repo hides the user behind a 404", async () => {
    const { client } = stub({});
    await expect(
      client.getRepositoryPermission(installationId, "octo-org", "secrets", "stranger"),
    ).resolves.toBeNull();
  });
});

describe("listRepositoryCollaborators", () => {
  it("orders each collaborator by role_name first, then by highest flag", async () => {
    const { client, paginate } = stub({
      collaborators: [
        collaborator({ id: 1, login: "owner", role_name: "admin" }),
        collaborator({ id: 2, login: "maintainer", role_name: "maintain" }),
        collaborator({
          id: 3,
          login: "auditor",
          role_name: "security-auditor",
          permissions: { triage: true, pull: true },
        }),
        collaborator({
          id: 4,
          login: "writer",
          permissions: { push: true, triage: true, pull: true },
        }),
        collaborator({ id: 5, login: "reader", permissions: { pull: true } }),
      ],
    });
    await expect(
      client.listRepositoryCollaborators(installationId, "octo-org", "secrets"),
    ).resolves.toEqual([
      { id: 1, login: "owner", permission: "admin" },
      { id: 2, login: "maintainer", permission: "maintain" },
      { id: 3, login: "auditor", permission: "triage" },
      { id: 4, login: "writer", permission: "write" },
      { id: 5, login: "reader", permission: "read" },
    ]);
    expect(paginate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ affiliation: "all" }),
    );
  });

  it("drops a collaborator with no resolvable permission", async () => {
    const { client } = stub({
      collaborators: [
        collaborator({ id: 6, login: "ghost", role_name: "custom", permissions: {} }),
        collaborator({ id: 7, login: "reader", permissions: { pull: true } }),
      ],
    });
    await expect(
      client.listRepositoryCollaborators(installationId, "octo-org", "secrets"),
    ).resolves.toEqual([{ id: 7, login: "reader", permission: "read" }]);
  });
});

describe("installation resolution", () => {
  it("asks for the installation's Octokit on every call", async () => {
    const { client, installation } = stub({ repositories: [] });
    await client.listInstallationRepositories(1);
    await client.listInstallationRepositories(2);
    expect(installation.mock.calls).toEqual([[1], [2]]);
  });
});
