import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  finalFindingsJson,
  makeFinding,
  makeGithub,
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
      "list_reviews",
      "repository_overview",
      "review_local_changes",
      "review_pull_request",
      "review_trends",
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

  it("says when a path is not in the index", async () => {
    const client = await connect(environment());
    const { texts } = await call(client, "find_references", { path: "src/missing.ts" });

    expect(JSON.parse(texts[0]!)).toMatchObject({ known: false });
  });

  it("sees a file created after the first call", async () => {
    const client = await connect(environment());
    await call(client, "repository_overview", {});
    repo.write("src/admin.ts", 'import { sessions } from "./sessions";\n');

    const { texts } = await call(client, "find_references", { path: "src/sessions.ts" });
    expect(JSON.parse(texts[0]!).references.map((ref: { path: string }) => ref.path)).toContain("src/admin.ts");
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
