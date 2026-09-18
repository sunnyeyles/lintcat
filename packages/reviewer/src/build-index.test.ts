import { createCapturingLogger } from "@pr-review/logging";
import { describe, expect, it, vi } from "vitest";

import { buildRepositoryIndex, type IndexTarget } from "./build-index.js";

const target: IndexTarget = {
  owner: "octo-org",
  repo: "example-service",
  pullRequestNumber: 42,
  headSha: "6dcb09b5b57875f334f61aebed695e2e4193db5e",
  baseSha: "0000000000000000000000000000000000000000",
};

const tree = [
  "package.json",
  "packages/api/package.json",
  "packages/api/src/server.ts",
  "packages/api/src/server.test.ts",
];

const manifests: Record<string, string> = {
  "package.json": JSON.stringify({
    name: "example-service",
    workspaces: ["packages/*"],
  }),
  "packages/api/package.json": JSON.stringify({ name: "@example/api" }),
};

function makeClient(
  listing: { paths: string[]; truncated: boolean } = {
    paths: tree,
    truncated: false,
  },
) {
  return {
    listTree: vi.fn(async () => listing),
    getFileContents: vi.fn(async (request: { path: string; ref: string }) => {
      const content = manifests[request.path];
      if (content === undefined) {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      }
      return content;
    }),
  };
}

describe("buildRepositoryIndex", () => {
  it("builds Layer A from the base commit's tree", async () => {
    const client = makeClient();
    const { logger, entries } = createCapturingLogger();

    const index = await buildRepositoryIndex(client, target, logger);

    expect(client.listTree).toHaveBeenCalledExactlyOnceWith({
      owner: target.owner,
      repo: target.repo,
      ref: target.baseSha,
    });
    expect(
      client.getFileContents.mock.calls.every(
        ([request]) => request.ref === target.baseSha,
      ),
    ).toBe(true);
    await expect(index?.describeArea("packages/api/src/server.ts")).resolves
      .toMatchObject({
        known: true,
        role: "source",
        language: "typescript",
        package: { name: "@example/api", root: "packages/api" },
        tests: ["packages/api/src/server.test.ts"],
      });
    expect(entries).toContainEqual(
      expect.objectContaining({
        event: "index.built",
        sha: target.baseSha,
        files: 4,
        packages: 1,
        truncated: false,
      }),
    );
  });

  it("serves a truncated tree, which is coverage rather than failure", async () => {
    const client = makeClient({ paths: tree, truncated: true });
    const { logger, entries } = createCapturingLogger();

    const index = await buildRepositoryIndex(client, target, logger);

    await expect(index?.status()).resolves.toMatchObject({
      coverage: expect.objectContaining({ truncated: true }),
    });
    expect(entries).toContainEqual(
      expect.objectContaining({ event: "index.built", truncated: true }),
    );
  });

  it("falls back to absent mode when the tree cannot be read", async () => {
    const client = {
      ...makeClient(),
      listTree: vi.fn(() => Promise.reject(new Error("rate limit exceeded"))),
    };
    const { logger, entries } = createCapturingLogger();

    await expect(
      buildRepositoryIndex(client, target, logger),
    ).resolves.toBeUndefined();

    expect(entries).toContainEqual(
      expect.objectContaining({
        level: "error",
        event: "index.failed",
        reason: "rate limit exceeded",
      }),
    );
  });

  it("falls back to absent mode when a manifest read fails", async () => {
    const client = {
      ...makeClient(),
      getFileContents: vi.fn(() =>
        Promise.reject(Object.assign(new Error("HTTP 403"), { status: 403 })),
      ),
    };
    const { logger, entries } = createCapturingLogger();

    await expect(
      buildRepositoryIndex(client, target, logger),
    ).resolves.toBeUndefined();

    expect(entries).toContainEqual(
      expect.objectContaining({ event: "index.failed", reason: "HTTP 403" }),
    );
  });
});
