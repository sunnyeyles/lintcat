import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ProgressNotificationSchema,
  type CallToolResult,
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
  return { isError: result.isError === true, texts };
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
    expect(writes.map((tool) => tool.name)).toEqual(["review_pull_request"]);
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

    const listed = JSON.parse((await call(client, "list_reviews", { org: "acme" })).texts[0]!);
    expect(listed).toMatchObject([{ repo: "acme/widgets", prNumber: 7, findingCount: 1 }]);

    const review = JSON.parse((await call(client, "get_review", { org: "acme", id: listed[0].id })).texts[0]!);
    expect(review.findings).toMatchObject([{ title: "Token compared with ==", severity: "high" }]);
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
