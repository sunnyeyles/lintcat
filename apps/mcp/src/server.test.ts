import { chmodSync, readFileSync } from "node:fs";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  CreateMessageRequestSchema,
  ProgressNotificationSchema,
  type CallToolResult,
  type CreateMessageRequest,
  type Progress,
} from "@modelcontextprotocol/sdk/types.js";
import {
  finalFindingsJson,
  makeFinding,
  makeGithub,
  makeHangingModel,
  makeModel,
  message,
  textBlock,
} from "@pr-review/ai/agent-test-support";
import {
  ingestReviewRecord,
  memberships,
  organizations,
  users,
  type Database,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import type { FileContentsRequest } from "@pr-review/github";
import { MAX_REFERENCE_FILES, UNINDEXED_PATH_REASON } from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpEnvironment } from "#src/environment";
import { createServer } from "#src/server";
import { createTestRepo, type TestRepo } from "#src/test-repo";

let repo: TestRepo;

beforeEach(() => {
  repo = createTestRepo({
    "package.json": '{ "name": "fixture" }\n',
    "src/sessions.ts": "export const sessions = [];\nexport function createSession() {}\n",
    "src/api.ts": 'import { createSession } from "./sessions";\n',
    "src/sessions.test.ts": 'import { sessions } from "./sessions";\n',
  });
  repo.git("checkout", "-q", "-b", "feature");
  repo.write(
    "src/sessions.ts",
    "export const sessions = [];\nexport function createSession() {}\nexport const admin = true;\n",
  );
});

afterEach(() => repo.remove());

function environment(overrides: Partial<McpEnvironment> = {}): McpEnvironment {
  return {
    env: { OPENAI_API_KEY: "sk-test" },
    cwd: repo.root,
    logger: createCapturingLogger().logger,
    createLanguageModel: () => {
      throw new Error("no model scripted");
    },
    createTokenClient: () => {
      throw new Error("no GitHub client scripted");
    },
    gh: async () => "gh-token",
    database: () => {
      throw new Error("no database scripted");
    },
    ...overrides,
  };
}

async function connect(env: McpEnvironment, githubId?: () => Promise<number>): Promise<Client> {
  const server = createServer(env, githubId ? { githubId } : {});
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const texts = result.content.flatMap((part) => (part.type === "text" ? [part.text] : []));
  return { isError: result.isError === true, texts, content: result.content };
}

async function readResource(client: Client, uri: string) {
  const { contents } = await client.readResource({ uri });
  return contents[0] as { uri: string; mimeType?: string; text: string };
}

/** Replaces the fixture repository, so `afterEach` still removes exactly one. */
function useRepo(files: Record<string, string>): TestRepo {
  repo.remove();
  repo = createTestRepo(files);
  return repo;
}

function scriptedModel(findings: ReturnType<typeof makeFinding>[]) {
  return makeModel([message([textBlock(finalFindingsJson(findings))], "end_turn")]).model;
}

describe("the tool list", () => {
  it("offers every tool, marking the read-only ones", async () => {
    const client = await connect(environment());
    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "apply_fix",
      "describe_file",
      "find_references",
      "get_review",
      "list_review_agents",
      "list_reviews",
      "repository_overview",
      "review_local_changes",
      "review_pull_request",
      "review_trends",
      "search_code",
      "validate_agent_config",
    ]);
    const writes = tools.filter((tool) => tool.annotations?.readOnlyHint !== true);
    expect(writes.map((tool) => tool.name).sort()).toEqual(["apply_fix", "review_pull_request"]);
    const applyFix = tools.find((tool) => tool.name === "apply_fix");
    expect(applyFix?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });
});

describe("index tools", () => {
  it("finds the files importing one exported name", async () => {
    const client = await connect(environment());
    const { texts } = await call(client, "find_references", { path: "src/sessions.ts", name: "createSession" });

    expect(JSON.parse(texts[0]!)).toMatchObject({
      known: true,
      total: 1,
      references: [{ path: "src/api.ts", imports: [{ name: "createSession" }] }],
    });
  });

  it("describes a file's role, coverage and imports", async () => {
    const client = await connect(environment());
    const { texts } = await call(client, "describe_file", { path: "src/sessions.ts" });

    expect(JSON.parse(texts[0]!)).toMatchObject({
      path: "src/sessions.ts",
      role: "source",
      coveredBy: "src/sessions.test.ts",
      importerCount: 2,
    });
  });

  it("gives the shared unknown-path answer, header and all", async () => {
    const client = await connect(environment());
    const { texts } = await call(client, "find_references", { path: "src/missing.ts" });

    const payload = JSON.parse(texts[0]!);
    expect(payload).toMatchObject({
      path: "src/missing.ts",
      known: false,
      reason: UNINDEXED_PATH_REASON,
    });
    expect(Object.keys(payload.index).sort()).toEqual(["files", "languages", "sha", "truncated"]);
  });

  it("advertises the one cap the shared query enforces", async () => {
    const client = await connect(environment());
    const { tools } = await client.listTools();
    const found = tools.find((tool) => tool.name === "find_references");

    expect(found?.description).toContain(`At most ${MAX_REFERENCE_FILES} files`);
  });

  it("sees a file created after the first call", async () => {
    const client = await connect(environment());
    await call(client, "repository_overview", {});
    repo.write("src/admin.ts", 'import { sessions } from "./sessions";\n');

    const { texts } = await call(client, "find_references", { path: "src/sessions.ts" });
    expect(JSON.parse(texts[0]!).references.map((ref: { path: string }) => ref.path)).toContain("src/admin.ts");
  });
});

describe("search_code", () => {
  it("returns every matching line with its path and line number", async () => {
    const client = await connect(environment());
    const { isError, texts } = await call(client, "search_code", { query: "createSession" });

    expect(isError).toBe(false);
    const result = JSON.parse(texts[0]!);
    expect(result).toMatchObject({ query: "createSession", total: 2, truncated: false });
    expect(result.matches).toEqual([
      { path: "src/api.ts", line: 1, text: 'import { createSession } from "./sessions";' },
      { path: "src/sessions.ts", line: 2, text: "export function createSession() {}" },
    ]);
  });

  it("searches the working tree, not the commit", async () => {
    const client = await connect(environment());
    const { texts } = await call(client, "search_code", { query: "admin", path: "src" });

    expect(JSON.parse(texts[0]!).matches).toEqual([
      { path: "src/sessions.ts", line: 3, text: "export const admin = true;" },
    ]);
  });

  it("returns an empty result rather than an error when nothing matches", async () => {
    const client = await connect(environment());
    const { isError, texts } = await call(client, "search_code", { query: "nowhereInThisRepo" });

    expect(isError).toBe(false);
    expect(JSON.parse(texts[0]!)).toMatchObject({ total: 0, matches: [] });
  });

  it("refuses a path that escapes the checkout", async () => {
    const client = await connect(environment());
    const { isError, texts } = await call(client, "search_code", { query: "sessions", path: "../.." });

    expect(isError).toBe(true);
    expect(texts[0]).toContain("outside the repository");
  });
});

describe("list_review_agents", () => {
  function configuredRepo(config: string): void {
    useRepo({
      ".github/pr-review-agents.yml": config,
      "src/sessions.ts": "export const sessions = [];\n",
      "packages/api/server.ts": "export const server = {};\n",
    });
    repo.git("checkout", "-q", "-b", "feature");
    repo.write("src/sessions.ts", "export const sessions = [1];\n");
  }

  it("reports each agent's category and gate, and which the changes wake", async () => {
    configuredRepo(
      ["agents:", "  - agent: security", "    paths:", "      - packages/**", "  - correctness", ""].join("\n"),
    );
    const client = await connect(environment({ env: {} }));

    const { isError, texts } = await call(client, "list_review_agents", { base: "main" });

    expect(isError).toBe(false);
    const listing = JSON.parse(texts[1]!);
    expect(listing.configured).toBe(true);
    expect(listing.changedFiles).toEqual(["src/sessions.ts"]);
    expect(listing.agents).toMatchObject([
      { category: "security", paths: ["packages/**"], wakes: false },
      { category: "correctness", paths: null, wakes: true },
    ]);
    expect(texts[0]).toContain("correctness would run on the current changes");
  });

  it("says nothing would run when every gate misses the changes", async () => {
    configuredRepo(["agents:", "  - agent: security", "    paths:", "      - packages/**", ""].join("\n"));
    const client = await connect(environment({ env: {} }));

    const { texts } = await call(client, "list_review_agents", { base: "main" });

    const listing = JSON.parse(texts[1]!);
    expect(listing.agents).toMatchObject([
      { category: "security", wakes: false, reason: "no changed file matches its paths" },
    ]);
    expect(texts[0]).toContain("none would run on the current changes");
  });

  it("reports the defaults for a repository that configures nothing", async () => {
    const client = await connect(environment({ env: {} }));

    const { isError, texts } = await call(client, "list_review_agents", { base: "main" });

    expect(isError).toBe(false);
    const listing = JSON.parse(texts[1]!);
    expect(listing.configured).toBe(false);
    expect(listing.agents).toMatchObject([{ category: "general", paths: null, wakes: true }]);
    expect(texts[0]).toContain("no .github/pr-review-agents.yml, so these are the defaults");
  });
});

describe("review_local_changes", () => {
  it("returns only findings on lines the working tree changed", async () => {
    const env = environment({
      createLanguageModel: () =>
        scriptedModel([
          makeFinding("general", { file: "src/sessions.ts", line: 3, title: "Admin is always on" }),
          makeFinding("general", { file: "src/sessions.ts", line: 1, title: "On an untouched line" }),
        ]),
    });
    const client = await connect(env);

    const { isError, texts } = await call(client, "review_local_changes", { base: "main", index: false });

    expect(isError).toBe(false);
    expect(texts[0]).toContain("Reviewed 1 changed file(s)");
    const details = JSON.parse(texts[1]!);
    expect(details.agents).toEqual(["general"]);
    expect(details.findings.map((finding: { title: string }) => finding.title)).toEqual(["Admin is always on"]);
  });

  it("says so when there is nothing to review", async () => {
    repo.commit("admin");
    repo.git("checkout", "-q", "main");
    const client = await connect(environment());

    const { texts } = await call(client, "review_local_changes", { base: "main" });
    expect(texts[0]).toContain("No changes between main");
  });

  it("uses whichever provider has a key", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([]));
    const client = await connect(environment({ env: { ANTHROPIC_API_KEY: "sk-ant" }, createLanguageModel }));

    await call(client, "review_local_changes", { base: "main", index: false });
    expect(createLanguageModel).toHaveBeenCalledWith(expect.objectContaining({ provider: "anthropic" }));
  });

  it("names the missing key rather than failing mid-review", async () => {
    const client = await connect(environment({ env: {} }));

    const { isError, texts } = await call(client, "review_local_changes", { base: "main" });
    expect(isError).toBe(true);
    expect(texts[0]).toContain("No model API key is set");
  });
});

describe("review scopes", () => {
  const admin = makeFinding("general", { file: "src/sessions.ts", line: 3, title: "Admin is always on" });

  it("reviews only the index, leaving unstaged work out", async () => {
    repo.git("add", "src/sessions.ts");
    repo.write("src/api.ts", 'import { createSession } from "./sessions";\nexport const unstaged = 1;\n');
    const client = await connect(environment({ createLanguageModel: () => scriptedModel([admin]) }));

    const { isError, texts } = await call(client, "review_local_changes", {
      scope: "staged",
      index: false,
    });

    expect(isError).toBe(false);
    expect(texts[0]).toContain("Reviewed 1 changed file(s)");
    expect(texts[0]).toContain("the staged changes");
    expect(JSON.parse(texts[1]!).findings).toMatchObject([{ title: "Admin is always on" }]);
  });

  it("reviews an explicit commit range, leaving the working tree out", async () => {
    repo.commit("admin");
    repo.write("src/api.ts", "export const notReviewed = 1;\n");
    const client = await connect(environment({ createLanguageModel: () => scriptedModel([admin]) }));

    const { isError, texts } = await call(client, "review_local_changes", {
      range: "main..feature",
      index: false,
    });

    expect(isError).toBe(false);
    expect(texts[0]).toContain("Reviewed 1 changed file(s)");
    expect(JSON.parse(texts[1]!).findings).toMatchObject([{ title: "Admin is always on" }]);
  });

  it("names an unknown ref before calling the model", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([]));
    const client = await connect(environment({ createLanguageModel }));

    const { isError, texts } = await call(client, "review_local_changes", { range: "main..nope" });

    expect(isError).toBe(true);
    expect(texts[0]).toContain('unknown commit "nope"');
    expect(createLanguageModel).not.toHaveBeenCalled();
  });

  it("refuses a range handed to a scope that cannot take one", async () => {
    const client = await connect(environment());

    const { isError, texts } = await call(client, "review_local_changes", {
      scope: "staged",
      range: "main..feature",
    });

    expect(isError).toBe(true);
    expect(texts[0]).toContain("drop one of them");
  });

  it("makes no model call when the range is empty", async () => {
    const createLanguageModel = vi.fn(() => scriptedModel([]));
    const client = await connect(environment({ createLanguageModel }));

    const { isError, texts } = await call(client, "review_local_changes", { range: "HEAD..HEAD" });

    expect(isError).toBe(false);
    expect(texts[0]).toContain("No changes between");
    expect(createLanguageModel).not.toHaveBeenCalled();
  });

  it("gates the agents on the scope's changed files, not the working tree's", async () => {
    repo.git("add", "src/sessions.ts");
    repo.write("src/api.ts", "export const unstaged = 1;\n");
    const client = await connect(environment({ env: {} }));

    const { texts } = await call(client, "list_review_agents", { scope: "staged" });

    expect(JSON.parse(texts[1]!).changedFiles).toEqual(["src/sessions.ts"]);
  });
});

describe("review progress", () => {
  function reported(progress: Progress[]) {
    return progress.map(({ progress: done, total, message }) => ({ done, total, message }));
  }

  it("reports each agent starting and finishing to a caller that sent a progress token", async () => {
    const client = await connect(environment({ createLanguageModel: () => scriptedModel([]) }));
    const progress: Progress[] = [];

    await client.callTool(
      { name: "review_local_changes", arguments: { base: "main", index: false } },
      undefined,
      { onprogress: (update) => progress.push(update) },
    );

    expect(reported(progress)).toEqual([
      { done: 0, total: 1, message: "general started" },
      { done: 1, total: 1, message: "general completed" },
    ]);
  });

  it("sends nothing to a caller that sent no progress token", async () => {
    const notified = vi.fn();
    const client = await connect(environment({ createLanguageModel: () => scriptedModel([]) }));
    client.setNotificationHandler(ProgressNotificationSchema, notified);

    const { isError } = await call(client, "review_local_changes", { base: "main", index: false });

    expect(isError).toBe(false);
    expect(notified).not.toHaveBeenCalled();
  });
});

describe("review_pull_request", () => {
  function github() {
    const client = makeGithub();
    client.getFileContents.mockImplementation(async (request: FileContentsRequest) => {
      if (request.path.startsWith(".github/")) {
        throw Object.assign(new Error("Not Found"), { status: 404 });
      }
      return "export const sessions = [];\n";
    });
    return client;
  }

  it("writes nothing to GitHub on a dry run", async () => {
    const client = github();
    const createTokenClient = vi.fn(() => client);
    const mcp = await connect(
      environment({ createTokenClient, createLanguageModel: () => scriptedModel([makeFinding("general")]) }),
    );

    const { isError, texts } = await call(mcp, "review_pull_request", {
      owner: "octo-org",
      repo: "example-service",
      number: 42,
    });

    expect(isError).toBe(false);
    expect(texts[0]).toContain("nothing was posted");
    expect(createTokenClient).toHaveBeenCalledWith({ token: "gh-token" });
    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(client.createReview).not.toHaveBeenCalled();
    expect(client.createCommitOnBranch).not.toHaveBeenCalled();
  });

  it("publishes the check run when asked to", async () => {
    const client = github();
    const mcp = await connect(
      environment({
        env: { OPENAI_API_KEY: "sk-test", GITHUB_TOKEN: "env-token" },
        createTokenClient: () => client,
        createLanguageModel: () => scriptedModel([]),
      }),
    );

    await call(mcp, "review_pull_request", { owner: "octo-org", repo: "example-service", number: 42, publish: true });

    expect(client.createCheckRun).toHaveBeenCalledTimes(1);
    expect(client.createCommitOnBranch).not.toHaveBeenCalled();
  });

  it("stops the agents and publishes nothing when the tool call is cancelled", async () => {
    const client = github();
    const { model, firstCall } = makeHangingModel();
    const { logger, entries } = createCapturingLogger();
    const mcp = await connect(
      environment({ createTokenClient: () => client, createLanguageModel: () => model, logger }),
    );
    const controller = new AbortController();

    const pending = mcp.callTool(
      {
        name: "review_pull_request",
        arguments: { owner: "octo-org", repo: "example-service", number: 42, publish: true },
      },
      undefined,
      { signal: controller.signal },
    );
    await firstCall;
    controller.abort();
    await expect(pending).rejects.toThrow();

    await vi.waitFor(() =>
      expect(entries.map((logged) => logged.event)).toContain("review.cancelled"),
    );
    expect(entries.map((logged) => logged.event)).toContain("agent.cancelled");
    expect(client.createCheckRun).not.toHaveBeenCalled();
    expect(client.createReview).not.toHaveBeenCalled();
  });
});

describe("apply_fix", () => {
  const adminLine = "export const admin = true;";
  const patch = {
    file: "src/sessions.ts",
    startLine: 3,
    endLine: 3,
    expected: adminLine,
    replacement: "export const admin = false;",
  };

  function read(file: string): string {
    return readFileSync(path.join(repo.root, file), "utf8");
  }

  it("writes the patch into the working tree without committing", async () => {
    const client = await connect(environment());
    const head = repo.git("rev-parse", "HEAD");

    const { isError, texts } = await call(client, "apply_fix", { patches: [patch] });

    expect(isError).toBe(false);
    expect(texts[0]).toContain("No commit was made and nothing was pushed");
    expect(read("src/sessions.ts")).toContain("export const admin = false;");
    expect(repo.git("rev-parse", "HEAD")).toBe(head);
    expect(repo.git("status", "--porcelain")).toContain("src/sessions.ts");
    expect(repo.git("diff", "--cached", "--name-only")).toBe("");
  });

  it("refuses when the file changed since the review that produced the patch", async () => {
    const client = await connect(environment());
    repo.write("src/sessions.ts", "export const sessions = [];\nexport function createSession() {}\n");

    const { isError, texts } = await call(client, "apply_fix", { patches: [patch] });

    expect(isError).toBe(true);
    expect(texts[0]).toContain("no longer holds the text the review proved the patch against");
    expect(read("src/sessions.ts")).not.toContain("admin");
  });

  it("refuses a patch whose file is not in the working tree", async () => {
    const client = await connect(environment());

    const { isError, texts } = await call(client, "apply_fix", {
      patches: [{ ...patch, file: "src/gone.ts" }],
    });

    expect(isError).toBe(true);
    expect(texts[0]).toContain("does not exist in the working tree");
  });

  it("leaves every file as it was when one of the writes fails", async () => {
    repo.write("src/api.ts", 'import { createSession } from "./sessions";\nexport const port = 80;\n');
    const locked = path.join(repo.root, "src/api.ts");
    const before = { sessions: read("src/sessions.ts"), api: read("src/api.ts") };
    chmodSync(locked, 0o444);
    const client = await connect(environment());

    const { isError, texts } = await call(client, "apply_fix", {
      patches: [
        patch,
        {
          file: "src/api.ts",
          startLine: 2,
          endLine: 2,
          expected: "export const port = 80;",
          replacement: "export const port = 443;",
        },
      ],
    });
    chmodSync(locked, 0o644);

    expect(isError).toBe(true);
    expect(texts[0]).toContain("put back as it was");
    expect(read("src/sessions.ts")).toBe(before.sessions);
    expect(read("src/api.ts")).toBe(before.api);
  });
});

describe("history tools", () => {
  let database: Database;
  const member = 101;

  beforeEach(async () => {
    database = await createTestDatabase();
    const [acme] = await database
      .insert(organizations)
      .values({ githubAccountId: 10, accountType: "organization", slug: "acme", name: "Acme" })
      .returning();
    const [user] = await database.insert(users).values({ githubId: member, login: "mona" }).returning();
    await database.insert(memberships).values({ userId: user!.id, organizationId: acme!.id, role: "owner" });
    const ingested = await ingestReviewRecord(database, acme!.id, {
      owner: "acme",
      repo: "widgets",
      prNumber: 7,
      headSha: "a".repeat(40),
      agents: ["security"],
      summary: "One finding.",
      durationMs: 1_000,
      agentRuns: [
        {
          agent: "security",
          durationMs: 1_000,
          findingCount: 1,
          inputTokens: 10,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 5,
        },
      ],
      findings: [
        {
          agent: "security",
          file: "src/auth.ts",
          line: 3,
          category: "security",
          severity: "high",
          title: "Token compared with ==",
          explanation: "Timing leak.",
          confidence: 0.9,
        },
      ],
    });
    if (!ingested.ok) throw new Error(ingested.reason);
  });

  it("lists and opens reviews for a member", async () => {
    const client = await connect(environment({ database: () => database }), async () => member);

    const listing = await call(client, "list_reviews", { org: "acme" });
    const listed = JSON.parse(listing.texts[0]!);
    expect(listed).toMatchObject([{ repo: "acme/widgets", prNumber: 7, findingCount: 1 }]);

    const review = JSON.parse((await call(client, "get_review", { org: "acme", id: listed[0].id })).texts[0]!);
    expect(review.findings).toMatchObject([{ title: "Token compared with ==", severity: "high" }]);
  });

  it("links each listed review as a resource instead of inlining its findings", async () => {
    const client = await connect(environment({ database: () => database }), async () => member);

    const listing = await call(client, "list_reviews", { org: "acme" });
    const [id] = JSON.parse(listing.texts[0]!).map((review: { id: number }) => review.id);
    const links = listing.content.filter((part) => part.type === "resource_link");

    expect(links).toMatchObject([
      { uri: `pr-review://review/acme/${id}`, name: `acme/widgets#7 review ${id}`, mimeType: "application/json" },
    ]);
    expect(listing.texts.join("")).not.toContain("Token compared with ==");
  });

  it("resolves a stored review through its resource URI", async () => {
    const client = await connect(environment({ database: () => database }), async () => member);
    const [{ id }] = JSON.parse((await call(client, "list_reviews", { org: "acme" })).texts[0]!);

    const contents = await readResource(client, `pr-review://review/acme/${id}`);

    expect(contents.mimeType).toBe("application/json");
    expect(JSON.parse(contents.text)).toMatchObject({
      repo: "acme/widgets",
      findings: [{ title: "Token compared with ==", severity: "high" }],
    });
  });

  it("refuses a review resource for someone who is not a member", async () => {
    const client = await connect(environment({ database: () => database }), async () => 999);

    await expect(readResource(client, "pr-review://review/acme/1")).rejects.toThrow(/No organization "acme"/);
  });

  it("aggregates trends for a member", async () => {
    const client = await connect(environment({ database: () => database }), async () => member);

    const { texts } = await call(client, "review_trends", { org: "acme", range: "7d", repo: "acme/widgets" });
    expect(JSON.parse(texts[0]!)).toMatchObject({ range: "7d", trends: { totals: { reviews: 1, findings: 1 } } });
  });

  it("refuses someone who is not a member", async () => {
    const client = await connect(environment({ database: () => database }), async () => 999);

    const { isError, texts } = await call(client, "list_reviews", { org: "acme" });
    expect(isError).toBe(true);
    expect(texts[0]).toContain('No organization "acme"');
  });
});

describe("resources", () => {
  it("offers the configuration resource and a template per addressable kind", async () => {
    const client = await connect(environment());

    const { resources } = await client.listResources();
    const { resourceTemplates } = await client.listResourceTemplates();

    expect(resources.map((resource) => resource.uri)).toEqual(["pr-review://config"]);
    expect(resourceTemplates.map((template) => template.uriTemplate).sort()).toEqual([
      "pr-review://file/{+path}",
      "pr-review://review/{org}/{id}",
    ]);
  });

  it("resolves the checkout's agent configuration", async () => {
    const client = await connect(environment());

    const contents = await readResource(client, "pr-review://config");

    expect(contents.mimeType).toBe("application/json");
    expect(JSON.parse(contents.text)).toMatchObject({
      checkout: repo.root,
      present: false,
      valid: true,
      usingDefaults: true,
      agents: [{ agent: "general" }],
    });
  });

  it("reads a file from the working tree, not the commit", async () => {
    const client = await connect(environment());

    const contents = await readResource(client, "pr-review://file/src/sessions.ts");

    expect(contents.mimeType).toBe("text/plain");
    expect(contents.text).toContain("export const admin = true;");
  });

  it("refuses a file path that escapes the checkout", async () => {
    const client = await connect(environment());

    await expect(readResource(client, "pr-review://file//etc/hosts")).rejects.toThrow(
      /outside the repository/,
    );
  });

  it("says which file is missing", async () => {
    const client = await connect(environment());

    await expect(readResource(client, "pr-review://file/src/missing.ts")).rejects.toThrow(
      /does not exist in the working tree/,
    );
  });

  it("rejects a review URI whose id is not a number", async () => {
    const client = await connect(environment());

    await expect(readResource(client, "pr-review://review/acme/latest")).rejects.toThrow(
      /non-numeric review id "latest"/,
    );
  });

  it("rejects a URI no scheme covers", async () => {
    const client = await connect(environment());

    await expect(readResource(client, "pr-review://nonsense/1")).rejects.toThrow(/not found/);
  });
});

describe("the prompt list", () => {
  it("offers every workflow prompt, described and with arguments", async () => {
    const client = await connect(environment());
    const { prompts } = await client.listPrompts();

    expect(prompts.map((prompt) => prompt.name).sort()).toEqual([
      "review_branch",
      "review_history",
      "triage_finding",
    ]);
    for (const prompt of prompts) {
      expect(prompt.description).toMatch(/Use this /);
      expect(prompt.arguments?.length ?? 0).toBeGreaterThan(0);
    }
    const triage = prompts.find((prompt) => prompt.name === "triage_finding");
    expect(triage?.arguments).toContainEqual(expect.objectContaining({ name: "org", required: true }));
  });

  it("renders the branch review with the arguments it was given", async () => {
    const client = await connect(environment());

    const { messages } = await client.getPrompt({
      name: "review_branch",
      arguments: { base: "origin/main", agents: "security" },
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    const text = messages[0]!.content.type === "text" ? messages[0]!.content.text : "";
    expect(text).toContain('`review_local_changes` with base "origin/main", agents "security"');
    expect(text).toContain("find_references");
  });

  it("names the most severe finding when none is given", async () => {
    const client = await connect(environment());

    const { messages } = await client.getPrompt({ name: "triage_finding", arguments: { org: "acme", review: "12" } });

    const text = messages[0]!.content.type === "text" ? messages[0]!.content.text : "";
    expect(text).toContain("the most severe finding");
    expect(text).toContain('`get_review` with org "acme" and id 12');
  });
});

describe("a review through client sampling", () => {
  /** A client that answers sampling/createMessage with `reply`, recording what it was asked. */
  async function samplingClient(env: McpEnvironment, reply: string) {
    const asked: CreateMessageRequest["params"][] = [];
    const server = createServer(env);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" }, { capabilities: { sampling: {} } });
    client.setRequestHandler(CreateMessageRequestSchema, (request) => {
      asked.push(request.params);
      return { model: "client-model", role: "assistant" as const, content: { type: "text" as const, text: reply } };
    });
    await client.connect(clientTransport);
    return { client, asked };
  }

  it("reviews with no provider key at all, and says the review was reduced", async () => {
    const { client, asked } = await samplingClient(
      environment({ env: {} }),
      finalFindingsJson([makeFinding("general", { file: "src/sessions.ts", line: 3, title: "Admin is always on" })]),
    );

    const { isError, texts } = await call(client, "review_local_changes", { base: "main", index: false });

    expect(isError).toBe(false);
    expect(texts[0]).toContain("Reduced single-shot review");
    expect(texts[1]).toContain("Reviewed 1 changed file(s)");
    const details = JSON.parse(texts[2]!);
    expect(details).toMatchObject({ singleShot: true, agents: ["general"], synthesis: "skipped" });
    expect(details.findings.map((finding: { title: string }) => finding.title)).toEqual(["Admin is always on"]);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.messages[0]!.content).toMatchObject({ type: "text" });
  });

  it("validates a sampled finding exactly as it validates any other agent's", async () => {
    const { client } = await samplingClient(
      environment({ env: {} }),
      finalFindingsJson([
        makeFinding("general", { file: "src/sessions.ts", line: 1, title: "On an untouched line" }),
        makeFinding("general", { file: "src/nowhere.ts", line: 3, title: "In an unchanged file" }),
      ]),
    );

    const { texts } = await call(client, "review_local_changes", { base: "main", index: false });

    expect(JSON.parse(texts[2]!).findings).toEqual([]);
  });

  it("leaves the sampling client alone whenever a provider key is present", async () => {
    const { client, asked } = await samplingClient(
      environment({ createLanguageModel: () => scriptedModel([]) }),
      finalFindingsJson([]),
    );

    const { isError, texts } = await call(client, "review_local_changes", { base: "main", index: false });

    expect(isError).toBe(false);
    expect(texts[0]).not.toContain("Reduced single-shot review");
    expect(asked).toEqual([]);
  });

  it("names both ways out when there is neither a key nor sampling", async () => {
    const client = await connect(environment({ env: {} }));

    const { isError, texts } = await call(client, "review_local_changes", { base: "main", index: false });

    expect(isError).toBe(true);
    expect(texts[0]).toContain("No model API key is set and this client does not offer sampling");
    expect(texts[0]).toContain("sampling/createMessage");
  });
});
