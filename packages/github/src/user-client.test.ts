/** The user client over an injected Octokit stub: no network, no token. */
import { describe, expect, it, vi } from "vitest";

import { createUserClient, type UserOctokitLike } from "#src/user-client";

function stub(routes: { installations?: unknown[]; repositories?: unknown[] }) {
  const listInstallations = Symbol("listInstallationsForAuthenticatedUser");
  const listRepos = Symbol("listInstallationReposForAuthenticatedUser");
  const paginate = vi.fn(async (route: unknown, _params: Record<string, unknown>) => {
    if (route === listInstallations) return routes.installations ?? [];
    if (route === listRepos) return routes.repositories ?? [];
    throw new Error("unexpected route");
  });
  const octokit: UserOctokitLike = {
    paginate,
    rest: {
      apps: {
        listInstallationsForAuthenticatedUser: listInstallations,
        listInstallationReposForAuthenticatedUser: listRepos,
      },
    },
  };
  return { client: createUserClient(octokit), paginate, listInstallations, listRepos };
}

function repository(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 10,
    name: "widget",
    private: true,
    owner: { login: "alice" },
    permissions: { pull: true },
    ...overrides,
  };
}

describe("listInstallations", () => {
  it("returns every installation the user can reach, paginated", async () => {
    const { client, paginate, listInstallations } = stub({
      installations: [
        { id: 1, account: { id: 7, login: "alice", type: "User" }, app_id: 99 },
        { id: 2, account: { id: 8, login: "acme", type: "Organization" } },
      ],
    });
    await expect(client.listInstallations()).resolves.toEqual([
      { id: 1, account: { id: 7, login: "alice", type: "User" } },
      { id: 2, account: { id: 8, login: "acme", type: "Organization" } },
    ]);
    expect(paginate).toHaveBeenCalledWith(listInstallations, { per_page: 100 });
  });

  it("rejects a malformed response", async () => {
    const { client } = stub({ installations: [{ id: "1" }] });
    await expect(client.listInstallations()).rejects.toThrow();
  });
});

describe("listInstallationRepositories", () => {
  it("returns the readable repos with the user's permission, paginated", async () => {
    const { client, paginate, listRepos } = stub({
      repositories: [
        repository(),
        repository({ id: 11, name: "public", private: false, permissions: { pull: true, push: true } }),
      ],
    });
    await expect(client.listInstallationRepositories(1)).resolves.toEqual([
      { id: 10, owner: "alice", name: "widget", private: true, permission: "read" },
      { id: 11, owner: "alice", name: "public", private: false, permission: "write" },
    ]);
    expect(paginate).toHaveBeenCalledWith(listRepos, { installation_id: 1, per_page: 100 });
  });

  it("prefers role_name, which carries maintain and triage", async () => {
    const { client } = stub({
      repositories: [repository({ role_name: "maintain", permissions: { push: true } })],
    });
    const [repo] = await client.listInstallationRepositories(1);
    expect(repo?.permission).toBe("maintain");
  });

  it("drops a repo with no permission", async () => {
    const { client } = stub({
      repositories: [repository({ permissions: {} }), repository({ id: 11, permissions: null })],
    });
    await expect(client.listInstallationRepositories(1)).resolves.toEqual([]);
  });
});
