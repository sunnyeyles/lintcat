import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createCapturingLogger } from "@pr-review/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveCheckoutPath } from "#src/checkout-path";
import { staticClient } from "#src/client-capabilities";
import type { McpEnvironment } from "#src/environment";
import { createServer } from "#src/server";
import { createTestRepo, type TestRepo } from "#src/test-repo";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({
    "package.json": '{ "name": "fixture" }\n',
    "src/sessions.ts": "export const sessions = [];\n",
  });
});

afterEach(() => repo.remove());

function environment(cwd: string): McpEnvironment {
  return {
    env: {},
    cwd,
    logger: createCapturingLogger().logger,
    createLanguageModel: () => {
      throw new Error("no model scripted");
    },
    createTokenClient: () => {
      throw new Error("no GitHub client scripted");
    },
    gh: async () => {
      throw new Error("no gh scripted");
    },
    database: () => {
      throw new Error("no database scripted");
    },
  };
}

const workspace = (...roots: string[]) => staticClient({}, roots);

describe("resolving a checkout path against the client's roots", () => {
  it("defaults to the root holding the working directory", async () => {
    const nested = path.join(repo.root, "src");
    const client = workspace("/elsewhere", repo.root);

    await expect(resolveCheckoutPath(environment(nested), client, undefined)).resolves.toBe(repo.root);
  });

  it("defaults to the first root when none holds the working directory", async () => {
    const client = workspace("/first", "/second");

    await expect(resolveCheckoutPath(environment(repo.root), client, undefined)).resolves.toBe("/first");
  });

  it("accepts a path inside a root", async () => {
    const client = workspace(repo.root);

    await expect(resolveCheckoutPath(environment(repo.root), client, "src")).resolves.toBe(
      path.join(repo.root, "src"),
    );
  });

  it("accepts a root itself", async () => {
    const client = workspace(repo.root);

    await expect(resolveCheckoutPath(environment(repo.root), client, ".")).resolves.toBe(repo.root);
  });

  it("refuses a path outside every root, naming what was allowed", async () => {
    const client = workspace(repo.root, "/other/workspace");

    await expect(resolveCheckoutPath(environment(repo.root), client, "/etc")).rejects.toThrow(
      `/etc is outside the workspace you have open. Allowed: ${repo.root}, /other/workspace.`,
    );
  });

  it("refuses a sibling whose name merely starts with a root's", async () => {
    const client = workspace("/work/repo");

    await expect(resolveCheckoutPath(environment("/work/repo"), client, "/work/repo-two")).rejects.toThrow(
      "outside the workspace",
    );
  });

  it("takes any path when the client serves no roots", async () => {
    const client = staticClient();

    await expect(resolveCheckoutPath(environment(repo.root), client, "/etc")).resolves.toBe("/etc");
    await expect(resolveCheckoutPath(environment(repo.root), client, undefined)).resolves.toBe(repo.root);
  });
});

describe("a tool reading the roots", () => {
  async function call(
    client: ReturnType<typeof staticClient>,
    args: Record<string, unknown>,
  ): Promise<CallToolResult> {
    const server = createServer(environment(repo.root), { client });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const caller = new Client({ name: "test", version: "0.0.0" });
    await caller.connect(clientTransport);
    return (await caller.callTool({ name: "search_code", arguments: args })) as CallToolResult;
  }

  it("searches the root by default", async () => {
    const result = await call(workspace(repo.root), { query: "sessions" });

    expect(result.isError).toBeFalsy();
    expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toMatchObject({ root: repo.root });
  });

  it("refuses a checkout outside the root", async () => {
    const result = await call(workspace(repo.root), { query: "sessions", repoPath: "/etc" });

    expect(result.isError).toBe(true);
    expect((result.content as { text: string }[])[0]!.text).toContain("outside the workspace you have open");
  });
});
