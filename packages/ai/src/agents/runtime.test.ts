/**
 * The shared agent-runtime behaviours — loop, tool wiring, output
 * parsing, failure semantics — exercised through the review agent.
 */
import { buildRepositoryIndex } from "@pr-review/index";
import { createCapturingLogger } from "@pr-review/logging";
import { emptyTokenUsage } from "@pr-review/schemas";
import { describe, expect, it } from "vitest";

import {
  buildReviewSystemPrompt,
} from "#src/agents/definition";
import { GENERAL_AGENT } from "#src/agents/general-agent";
import { INDEX_ABSENT_LINE } from "#src/agents/repository-index";
import { AgentRunError } from "#src/agents/output";
import { createReviewAgent, type AgentUsageReport } from "#src/agents/runtime";
import {
  REVIEW_TOOL_NAMES,
  archiveFiles,
  baseSha,
  context,
  finalFindingsJson,
  headSha,
  makeFinding,
  makeGithub,
  makeHangingModel,
  makeModel,
  message,
  pullRequest,
  textBlock,
  toolUseBlock,
} from "#src/agent-test-support";

type ScriptedResponse = ReturnType<typeof message>;

/** One provider-level call as the SDK assembled it. */
type Call = {
  prompt: unknown[];
  tools?: unknown[];
  providerOptions?: unknown;
  toolChoice?: unknown;
};

const generalAgent = GENERAL_AGENT;

/** The system instructions of one recorded call. */
function systemOf(call: Call | undefined): string {
  const system = (call?.prompt ?? []).find(
    (entry) => (entry as { role?: string }).role === "system",
  );
  return String((system as { content?: string } | undefined)?.content ?? "");
}

function userTextOf(call: Call | undefined, which: "first" | "last"): string {
  const users = (call?.prompt ?? []).filter(
    (entry) => (entry as { role?: string }).role === "user",
  );
  const user = which === "first" ? users[0] : users[users.length - 1];
  const parts = (user as { content?: { type: string; text?: string }[] })
    ?.content;
  return (parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

/** The opening user text of one recorded call. */
function openingOf(call: Call | undefined): string {
  return userTextOf(call, "first");
}

function toolNamesOf(call: Call | undefined): string[] {
  return (call?.tools ?? [])
    .map((tool) => String((tool as { name?: string }).name))
    .sort();
}

/** Every Anthropic cache breakpoint in one recorded call's prompt. */
function cacheMarkersOf(call: Call | undefined): unknown[] {
  return (call?.prompt ?? [])
    .map(
      (entry) =>
        (
          entry as {
            providerOptions?: { anthropic?: { cacheControl?: unknown } };
          }
        ).providerOptions?.anthropic?.cacheControl,
    )
    .filter((marker) => marker !== undefined);
}

interface ToolResultPart {
  toolCallId: string;
  toolName: string;
  output: { type: string; value: unknown };
}

/** The tool results the SDK fed back into one recorded call. */
function toolResultsOf(call: Call | undefined): ToolResultPart[] {
  return (call?.prompt ?? [])
    .filter((entry) => (entry as { role?: string }).role === "tool")
    .flatMap(
      (entry) => (entry as { content: ToolResultPart[] }).content ?? [],
    );
}

const finding = {
  file: "src/sessions.ts",
  line: 42,
  category: "general" as const,
  severity: "high" as const,
  title: "Assignment instead of comparison in admin check",
  explanation: "The if condition assigns instead of comparing, so every user passes.",
  confidence: 0.95,
};

const finalJson = JSON.stringify({ findings: [finding] });

/** The index the fake archive builds, as the reviewer would build it. */
function fakeIndex() {
  return buildRepositoryIndex({ sha: baseSha, files: archiveFiles });
}

function makeAgent(
  responses: ScriptedResponse[],
  options: {
    maxTurns?: number;
    index?: ReturnType<typeof fakeIndex>;
  } = {},
) {
  const { model, doGenerate: create, calls } = makeModel(responses);
  const github = makeGithub();
  const { logger, entries } = createCapturingLogger();
  const agent = createReviewAgent(generalAgent, {
    model,
    github,
    logger,
    ...(options.maxTurns !== undefined ? { maxTurns: options.maxTurns } : {}),
    ...(options.index !== undefined ? { index: options.index } : {}),
  });
  return { agent, create, calls: calls as unknown as Call[], github, entries };
}

describe("the review agent", () => {
  it("is named general", () => {
    const { agent } = makeAgent([]);

    expect(agent.name).toBe("general");
  });

  it("returns findings parsed from the model's final JSON message", async () => {
    const { agent, create } = makeAgent([message([textBlock(finalJson)], "end_turn")]);

    const findings = await agent.run(context);

    expect(findings).toEqual([finding]);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("opens with the PR title, description, changed files, and each file's patch", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    const opening = openingOf(calls[0]);
    expect(opening).toContain(pullRequest.title);
    expect(opening).toContain(pullRequest.body);
    expect(opening).toContain("src/sessions.ts");
    expect(opening).toContain("user.isAdmin = true");
    expect(opening).not.toContain("Omitted from the diff");
  });

  it("leaves lockfiles and binaries out of the diff, and says so", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run({
      ...context,
      changedFiles: [
        ...context.changedFiles,
        { filename: "pnpm-lock.yaml", status: "modified", additions: 900, deletions: 900, patch: "+lockfile churn" },
        { filename: "docs/logo.png", status: "added", additions: 0, deletions: 0 },
      ],
    });

    const opening = openingOf(calls[0]);
    expect(opening).toContain("user.isAdmin = true");
    expect(opening).not.toContain("lockfile churn");
    expect(opening).toContain(
      "Omitted from the diff below (a patch is still available through get_diff with the path, a file through get_file): pnpm-lock.yaml (generated), docs/logo.png (binary)",
    );
  });

  it("caps the description and points at get_pull_request for the rest", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run({
      ...context,
      pullRequest: { ...pullRequest, body: "x".repeat(5_000) },
    });

    const opening = openingOf(calls[0]);
    expect(opening).toContain("x".repeat(4_000) + "\n[... description truncated; get_pull_request returns it whole]");
    expect(opening).not.toContain("x".repeat(4_001));
  });

  it("says the diff is narrowed, and where the rest of the pull request is", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run({
      ...context,
      diff: "@@ -2 +2 @@\n+const limit = 0;\n",
      changedFiles: [
        {
          filename: "src/limits.ts",
          status: "modified",
          additions: 1,
          deletions: 1,
          patch: "@@ -2 +2 @@\n+const limit = 0;",
        },
      ],
      incremental: {
        sinceSha: "old111",
        diff: context.diff,
        changedFiles: context.changedFiles,
      },
    });

    const opening = openingOf(calls[0]);
    expect(opening).toContain('<review_scope since="old111">');
    expect(opening).toContain("+const limit = 0;");
    // The whole pull request stays reachable, so it is not in the message.
    expect(opening).not.toContain("user.isAdmin = true");
  });

  it("says nothing about scope when the whole pull request is under review", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    expect(openingOf(calls[0])).not.toContain("<review_scope");
  });

  it("exposes exactly the eight read-only review tools to the model", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    expect(toolNamesOf(calls[0])).toEqual(REVIEW_TOOL_NAMES);
  });

  it("hardens the system prompt against prompt injection", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    const system = systemOf(calls[0]);
    // The hardening rules plus the security agent's own focus.
    expect(system).toMatch(/data.*not instructions|never instructions/is);
    expect(system).toMatch(/comments?.*(never|not).*instructions/is);
    expect(system).toMatch(/tool (results?|output).*(no|cannot|never).*(permission|privilege)/is);
    expect(system).toMatch(/final JSON/i);
    expect(system).toMatch(/security/i);
    expect(system).toMatch(/(not|never).*(formatting|style)/is);
  });

  it("round-trips a tool call through the github client and replays the result", async () => {
    const { agent, calls, github } = makeAgent([
      message(
        [toolUseBlock("toolu_1", "get_file", { path: "src/sessions.ts" })],
        "tool_use",
      ),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    const findings = await agent.run(context);

    expect(findings).toEqual([finding]);
    expect(github.getFileContents).toHaveBeenCalledExactlyOnceWith({
      owner: "octo-org",
      repo: "example-service",
      path: "src/sessions.ts",
      ref: headSha,
    });

    expect(toolResultsOf(calls[1])).toEqual([
      {
        type: "tool-result",
        toolCallId: "toolu_1",
        toolName: "get_file",
        output: { type: "text", value: "export const sessions = [];\n" },
      },
    ]);
  });

  it("answers malformed tool input with an error result and keeps going", async () => {
    const { agent, calls, github } = makeAgent([
      message(
        [toolUseBlock("toolu_1", "get_file", { path: "../../etc/passwd" })],
        "tool_use",
      ),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    const findings = await agent.run(context);

    expect(findings).toEqual([finding]);
    expect(github.getFileContents).not.toHaveBeenCalled();
    expect(toolResultsOf(calls[1])).toEqual([
      expect.objectContaining({
        toolCallId: "toolu_1",
        output: expect.objectContaining({ type: "error-text" }),
      }),
    ]);
  });

  it("answers an unknown tool with an error result", async () => {
    const { agent, calls } = makeAgent([
      message([toolUseBlock("toolu_1", "merge_pull_request", {})], "tool_use"),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    expect(toolResultsOf(calls[1])).toEqual([
      expect.objectContaining({
        toolCallId: "toolu_1",
        output: expect.objectContaining({ type: "error-text" }),
      }),
    ]);
  });

  it("surfaces a failing github call to the model rather than throwing", async () => {
    const { agent, github, calls } = makeAgent([
      message(
        [toolUseBlock("toolu_1", "get_file", { path: "src/missing.ts" })],
        "tool_use",
      ),
      message([textBlock(finalJson)], "end_turn"),
    ]);
    github.getFileContents.mockRejectedValueOnce(new Error("404 not found"));

    await expect(agent.run(context)).resolves.toEqual([finding]);
    expect(toolResultsOf(calls[1])).toEqual([
      expect.objectContaining({
        toolCallId: "toolu_1",
        output: { type: "error-text", value: expect.stringContaining("404") },
      }),
    ]);
  });

  it("answers parallel tool calls with one result each", async () => {
    const { agent, calls } = makeAgent([
      message(
        [
          toolUseBlock("toolu_1", "get_file", { path: "src/sessions.ts" }),
          toolUseBlock("toolu_2", "search_repository", { query: "isAdmin" }),
        ],
        "tool_use",
      ),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    expect(toolResultsOf(calls[1]).map((part) => part.toolCallId)).toEqual([
      "toolu_1",
      "toolu_2",
    ]);
  });

  it("runs a turn's tool calls concurrently", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const slow = async <T>(value: T): Promise<T> => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return value;
    };
    const { agent, github } = makeAgent([
      message(
        [
          toolUseBlock("toolu_1", "get_file", { path: "src/sessions.ts" }),
          toolUseBlock("toolu_2", "search_repository", { query: "isAdmin" }),
        ],
        "tool_use",
      ),
      message([textBlock(finalJson)], "end_turn"),
    ]);
    github.getFileContents.mockImplementation(() => slow("export const x = 1;\n"));
    github.searchCode.mockImplementation(() =>
      slow({ matches: [], totalCount: 0, incompleteResults: false }),
    );

    await agent.run(context);

    expect(peakInFlight).toBe(2);
  });

  it("extracts findings from a fenced JSON final message", async () => {
    const fenced = ["My review is complete.", "```json", finalJson, "```"].join("\n");
    const { agent } = makeAgent([message([textBlock(fenced)], "end_turn")]);

    await expect(agent.run(context)).resolves.toEqual([finding]);
  });

  it("repairs a final message that is not findings JSON with one tool-free turn", async () => {
    const { agent, calls, create, entries } = makeAgent([
      message([textBlock("I found several bugs, here they are in prose.")], "end_turn"),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await expect(agent.run(context)).resolves.toEqual([finding]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(calls[1]?.toolChoice).toEqual({ type: "none" });
    expect(userTextOf(calls[1], "last")).toMatch(/not valid findings JSON/);
    expect(openingOf(calls[1])).toBe(openingOf(calls[0]));
    expect(entries.map((entry) => entry.event)).toEqual([
      "agent.started",
      "agent.repaired",
      "agent.completed",
    ]);
  });

  it("rejects with AgentRunError when the repair turn is not findings JSON either", async () => {
    const { agent, create } = makeAgent([
      message([textBlock("prose")], "end_turn"),
      message([textBlock("more prose")], "end_turn"),
    ]);

    await expect(agent.run(context)).rejects.toThrow(/after one repair turn/);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("forces a tool-free final turn at the cap and returns its findings", async () => {
    const { agent, calls, create, entries } = makeAgent(
      [
        message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use"),
        message([textBlock(finalJson)], "end_turn"),
      ],
      { maxTurns: 2 },
    );

    await expect(agent.run(context)).resolves.toEqual([finding]);

    expect(create).toHaveBeenCalledTimes(2);
    expect(calls[0]?.toolChoice).toEqual({ type: "auto" });
    expect(calls[1]?.toolChoice).toEqual({ type: "none" });
    expect(userTextOf(calls[1], "last")).toMatch(/last turn/);
    expect(entries[entries.length - 1]).toMatchObject({
      event: "agent.completed",
      salvaged: true,
      steps: 2,
    });
  });

  it("rejects with AgentRunError when the max-turns cap is exceeded", async () => {
    const toolTurn = () =>
      message(
        [toolUseBlock("toolu_1", "get_diff", {})],
        "tool_use",
      );
    const { agent, create } = makeAgent([toolTurn(), toolTurn(), toolTurn()], {
      maxTurns: 2,
    });

    await expect(agent.run(context)).rejects.toThrow(/turn/i);
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("category integrity", () => {
  // The runtime filters rather than re-stamps: relabelling would
  // fabricate a claim the model never made.
  it("drops findings outside the agent's own category and keeps its own", async () => {
    const own = makeFinding("general");
    const leakedOther = makeFinding("docs-drift", { line: 43 });
    const leakedThird = makeFinding("performance", { line: 44 });
    const { agent } = makeAgent([
      message(
        [textBlock(finalFindingsJson([leakedOther, own, leakedThird]))],
        "end_turn",
      ),
    ]);

    await expect(agent.run(context)).resolves.toEqual([own]);
  });

  it("returns an empty set when every finding leaked out of category", async () => {
    const { agent } = makeAgent([
      message(
        [textBlock(finalFindingsJson([makeFinding("docs-drift")]))],
        "end_turn",
      ),
    ]);

    await expect(agent.run(context)).resolves.toEqual([]);
  });
});

describe("lifecycle events (spec §26)", () => {
  // Every event carries the review's identity plus the agent name.
  const correlation = {
    repository: "octo-org/example-service",
    pullRequestNumber: 42,
    headSha,
    agent: "general",
  };

  it("emits agent.started with the correlation fields before any model call", async () => {
    const { agent, entries } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    expect(entries[0]).toMatchObject({
      level: "info",
      event: "agent.started",
      ...correlation,
    });
  });

  it("emits agent.completed with duration, aggregated token usage, and finding count", async () => {
    // A two-turn run: usage must be summed across both model calls.
    const { agent, entries } = makeAgent([
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use", {
        inputTokens: 100,
        outputTokens: 10,
      }),
      message([textBlock(finalJson)], "end_turn", {
        inputTokens: 250,
        outputTokens: 25,
      }),
    ]);

    await agent.run(context);

    expect(entries.map((entry) => entry.event)).toEqual([
      "agent.started",
      "agent.completed",
    ]);
    const completed = entries[1];
    expect(completed).toMatchObject({
      level: "info",
      event: "agent.completed",
      ...correlation,
      steps: 2,
      inputTokens: 350,
      outputTokens: 35,
      findingCount: 1,
    });
    expect(typeof completed?.["durationMs"]).toBe("number");
  });

  it("emits agent.failed with the error and usage so far when the final output is invalid", async () => {
    const { agent, entries } = makeAgent([
      message([textBlock("prose, not JSON")], "end_turn", {
        inputTokens: 80,
        outputTokens: 8,
      }),
      message([textBlock("still prose")], "end_turn", {
        inputTokens: 90,
        outputTokens: 9,
      }),
    ]);

    await expect(agent.run(context)).rejects.toThrow(AgentRunError);

    expect(entries.map((entry) => entry.event)).toEqual([
      "agent.started",
      "agent.failed",
    ]);
    const failed = entries[1];
    expect(failed).toMatchObject({
      level: "error",
      event: "agent.failed",
      ...correlation,
      errorName: "AgentRunError",
      steps: 2,
      inputTokens: 170,
      outputTokens: 17,
    });
    expect(failed?.["error"]).toMatch(/invalid findings output/i);
    expect(typeof failed?.["durationMs"]).toBe("number");
  });

  it("emits agent.failed when the model API call rejects", async () => {
    const { model, doGenerate } = makeModel([]);
    doGenerate.mockRejectedValueOnce(new Error("529 overloaded"));
    const { logger, entries } = createCapturingLogger();
    const agent = createReviewAgent(generalAgent, {
      model,
      github: makeGithub(),
      logger,
    });

    await expect(agent.run(context)).rejects.toThrow("529 overloaded");

    expect(entries[1]).toMatchObject({
      level: "error",
      event: "agent.failed",
      ...correlation,
      error: "529 overloaded",
      errorName: "Error",
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("reports the tokens already spent when a later model call rejects", async () => {
    const toolTurn = message(
      [toolUseBlock("toolu_1", "get_diff", {})],
      "tool_use",
      { inputTokens: 40, outputTokens: 4 },
    );
    const { model, doGenerate } = makeModel([]);
    doGenerate
      .mockImplementationOnce(async () => toolTurn)
      .mockRejectedValueOnce(new Error("529 overloaded"));
    const { logger, entries } = createCapturingLogger();
    const agent = createReviewAgent(generalAgent, {
      model,
      github: makeGithub(),
      logger,
    });

    await expect(agent.run(context)).rejects.toThrow("529 overloaded");

    expect(entries[1]).toMatchObject({
      event: "agent.failed",
      inputTokens: 40,
      outputTokens: 4,
    });
  });

  it("emits agent.failed when the turn cap is exceeded, with the usage burned so far", async () => {
    const toolTurn = () =>
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use", {
        inputTokens: 40,
        outputTokens: 4,
      });
    const { agent, entries } = makeAgent([toolTurn(), toolTurn(), toolTurn()], {
      maxTurns: 2,
    });

    await expect(agent.run(context)).rejects.toThrow(/turn/i);

    const failed = entries[1];
    expect(failed).toMatchObject({
      level: "error",
      event: "agent.failed",
      ...correlation,
      errorName: "AgentRunError",
      steps: 2,
      inputTokens: 80,
      outputTokens: 8,
    });
    expect(failed?.["error"]).toMatch(/turn/i);
  });
});

describe("the onUsage callback", () => {
  function makeCollecting(responses: ScriptedResponse[]) {
    const { model, doGenerate } = makeModel(responses);
    const reports: AgentUsageReport[] = [];
    const agent = createReviewAgent(generalAgent, {
      model,
      github: makeGithub(),
      logger: createCapturingLogger().logger,
      onUsage: (report) => reports.push(report),
    });
    return { agent, doGenerate, reports };
  }

  it("reports the agent's usage summed across turns when the run succeeds", async () => {
    const { agent, reports } = makeCollecting([
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use", {
        inputTokens: 100,
        outputTokens: 10,
        cacheCreationInputTokens: 4_000,
      }),
      message([textBlock(finalJson)], "end_turn", {
        inputTokens: 250,
        outputTokens: 25,
        cacheReadInputTokens: 4_000,
      }),
    ]);

    await agent.run(context);

    expect(reports).toEqual([
      {
        agent: "general",
        durationMs: expect.any(Number),
        steps: 2,
        salvaged: false,
        usage: {
          inputTokens: 350,
          cacheCreationInputTokens: 4_000,
          cacheReadInputTokens: 4_000,
          outputTokens: 35,
        },
      },
    ]);
  });

  it("reports the usage burned so far when the run fails, repair turn included", async () => {
    const { agent, reports } = makeCollecting([
      message([textBlock("prose, not JSON")], "end_turn", {
        inputTokens: 80,
        outputTokens: 8,
      }),
      message([textBlock("still prose")], "end_turn", {
        inputTokens: 90,
        outputTokens: 9,
      }),
    ]);

    await expect(agent.run(context)).rejects.toThrow(AgentRunError);

    expect(reports).toEqual([
      {
        agent: "general",
        durationMs: expect.any(Number),
        steps: 2,
        salvaged: false,
        usage: {
          inputTokens: 170,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          outputTokens: 17,
        },
      },
    ]);
  });

  it("reports zero usage when the first model call rejects", async () => {
    const { agent, doGenerate, reports } = makeCollecting([]);
    doGenerate.mockRejectedValueOnce(new Error("529 overloaded"));

    await expect(agent.run(context)).rejects.toThrow("529 overloaded");

    expect(reports.map((report) => report.usage)).toEqual([emptyTokenUsage()]);
    expect(reports.map((report) => report.steps)).toEqual([0]);
  });
});

describe("prompt caching", () => {
  it("asks the provider to cache the stable prefix on every turn", async () => {
    const { agent, create, calls } = makeAgent([
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use"),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    expect(create).toHaveBeenCalledTimes(2);
    for (const call of calls) {
      expect(systemOf(call)).toBe(buildReviewSystemPrompt(generalAgent));
      expect(cacheMarkersOf(call)).toEqual([{ type: "ephemeral" }]);
    }
  });

  it("asks the provider to cache the growing conversation tail on every turn", async () => {
    // A call-level breakpoint lands on the last block, so turn two reads turn one.
    const { agent, calls } = makeAgent([
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use"),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    for (const call of calls) {
      expect(call.providerOptions).toMatchObject({
        anthropic: { cacheControl: { type: "ephemeral" } },
      });
    }
  });

  it("gives OpenAI one prompt cache key per review, the same on every turn", async () => {
    const { agent, calls } = makeAgent([
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use"),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    const keys = calls.map(
      (call) => (call.providerOptions as { openai?: { promptCacheKey?: string } }).openai?.promptCacheKey,
    );
    expect(keys).toEqual([
      `pr-review:octo-org/example-service:42:${headSha.slice(0, 12)}:general`,
      `pr-review:octo-org/example-service:42:${headSha.slice(0, 12)}:general`,
    ]);
  });

  it("sends a byte-identical prefix between turns, so the cache can hit", async () => {
    // Caching depends on turn two repeating turn one's prefix unchanged.
    const { agent, calls } = makeAgent([
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use"),
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    const [first, second] = calls;
    expect(systemOf(second)).toEqual(systemOf(first));
    expect(second?.tools).toEqual(first?.tools);
    expect(cacheMarkersOf(second)).toEqual(cacheMarkersOf(first));
    expect(second?.prompt.slice(0, first?.prompt.length)).toEqual(first?.prompt);
    expect(second?.prompt.length).toBeGreaterThan(first?.prompt.length ?? 0);
  });

  it("reports cache writes and reads separately on agent.completed", async () => {
    // A working cache: turn one writes the prefix, turn two reads it.
    const { agent, entries } = makeAgent([
      message([toolUseBlock("toolu_1", "get_diff", {})], "tool_use", {
        inputTokens: 12,
        outputTokens: 10,
        cacheCreationInputTokens: 4_000,
      }),
      message([textBlock(finalJson)], "end_turn", {
        inputTokens: 8,
        outputTokens: 25,
        cacheCreationInputTokens: 300,
        cacheReadInputTokens: 4_000,
      }),
    ]);

    await agent.run(context);

    expect(entries[1]).toMatchObject({
      event: "agent.completed",
      inputTokens: 20,
      cacheCreationInputTokens: 4_300,
      cacheReadInputTokens: 4_000,
      outputTokens: 35,
    });
  });
});

describe("the repository index block", () => {
  const scripted = [message([textBlock(finalJson)], "end_turn")];

  async function openingWith(index?: ReturnType<typeof fakeIndex>) {
    const { agent, calls } = makeAgent(
      scripted,
      index === undefined ? {} : { index },
    );
    await agent.run(context);
    return openingOf(calls[0]);
  }

  it("says the index is absent when the reviewer built none", async () => {
    const opening = await openingWith();

    expect(opening).toContain("<repository_index>");
    expect(opening).toContain(INDEX_ABSENT_LINE);
    expect(opening).not.toContain("<repository_index sha=");
  });

  it("carries the commit and the truncation flag", async () => {
    const opening = await openingWith(fakeIndex());

    expect(opening).toContain(
      `<repository_index sha="${baseSha}" truncated="false">`,
    );
  });

  it("gives each changed file its role, covering test and importer count", async () => {
    const opening = await openingWith(fakeIndex());

    expect(opening).toContain(
      "- src/sessions.ts — source, covered by src/sessions.test.ts, 4 importers\n",
    );
  });

  it("says a file nothing imports is dead", async () => {
    const { agent, calls } = makeAgent(scripted, { index: fakeIndex() });

    await agent.run({
      ...context,
      changedFiles: [
        { filename: "src/boot.ts", status: "modified", additions: 1, deletions: 0 },
      ],
    });

    expect(openingOf(calls[0])).toContain(
      "- src/boot.ts — source, no test, 0 importers, dead (not an entry point)",
    );
  });

  it("says a file in an import cycle is in one", async () => {
    const cycling = buildRepositoryIndex({
      sha: baseSha,
      files: new Map([
        ["src/a.ts", 'import "./b";\n'],
        ["src/b.ts", 'import "./a";\n'],
      ]),
    });
    const { agent, calls } = makeAgent(scripted, { index: cycling });

    await agent.run({
      ...context,
      changedFiles: [
        { filename: "src/a.ts", status: "modified", additions: 1, deletions: 0 },
      ],
    });

    expect(openingOf(calls[0])).toContain(
      "- src/a.ts — source, no test, 1 importer, in import cycle\n",
    );
  });

  it("says so for a changed file with no covering test", async () => {
    const { agent, calls } = makeAgent(scripted, { index: fakeIndex() });

    await agent.run({
      ...context,
      changedFiles: [
        { filename: "src/untested.ts", status: "modified", additions: 1, deletions: 0 },
      ],
    });

    expect(openingOf(calls[0])).toContain(
      "- src/untested.ts — source, no test, 1 importer",
    );
  });

  it("says a file the base commit did not have is not in the index", async () => {
    const { agent, calls } = makeAgent(scripted, { index: fakeIndex() });

    await agent.run({
      ...context,
      changedFiles: [
        { filename: "src/added.ts", status: "added", additions: 9, deletions: 0 },
      ],
    });

    expect(openingOf(calls[0])).toContain(
      "- src/added.ts — not in the index at this commit",
    );
  });

  it("reports a truncated index as truncated", async () => {
    const opening = await openingWith(
      buildRepositoryIndex({ sha: baseSha, files: archiveFiles, truncated: true }),
    );

    expect(opening).toContain(`truncated="true"`);
  });

  it("sits between the changed files and the diff", async () => {
    const opening = await openingWith(fakeIndex());

    expect(opening.indexOf("</changed_files>")).toBeLessThan(
      opening.indexOf("<repository_index"),
    );
    expect(opening.indexOf("</repository_index>")).toBeLessThan(
      opening.indexOf("<diff>"),
    );
  });

  it("caps the list the same way the changed-files block does", async () => {
    const changedFiles = Array.from({ length: 302 }, (_unused, at) => ({
      filename: `src/file-${at}.ts`,
      status: "modified",
      additions: 1,
      deletions: 0,
    }));
    const { agent, calls } = makeAgent(scripted, { index: fakeIndex() });

    await agent.run({ ...context, changedFiles });

    expect(openingOf(calls[0])).toContain("- [... 2 more files]");
  });
});

describe("the repository block", () => {
  const scripted = [message([textBlock(finalJson)], "end_turn")];

  /** A monorepo the archive fixture is not, so the block has packages to list. */
  function monorepoIndex() {
    return buildRepositoryIndex({
      sha: baseSha,
      files: new Map([
        ["pnpm-workspace.yaml", "packages:\n  - packages/*\n"],
        [
          "packages/core/package.json",
          JSON.stringify({ name: "@acme/core", exports: { ".": "./index.ts" } }),
        ],
        ["packages/core/index.ts", "export const core = 1;\n"],
        ["packages/app/package.json", JSON.stringify({ name: "@acme/app" })],
        ["packages/app/main.ts", 'import { core } from "@acme/core";\n'],
        ["README.md", "# Example\n"],
      ]),
    });
  }

  async function openingWith(index?: ReturnType<typeof fakeIndex>) {
    const { agent, calls } = makeAgent(
      scripted,
      index === undefined ? {} : { index },
    );
    await agent.run(context);
    return openingOf(calls[0]);
  }

  it("lists each workspace package with its root", async () => {
    const opening = await openingWith(monorepoIndex());

    expect(opening).toContain("Packages (2):");
    expect(opening).toContain("- @acme/app — packages/app");
    expect(opening).toContain("- @acme/core — packages/core");
  });

  it("says so when no workspace manifest declares any package", async () => {
    const opening = await openingWith(fakeIndex());

    expect(opening).toContain("Packages: none declared by a workspace manifest.");
  });

  it("carries the commit, the truncation flag and the coverage summary", async () => {
    const opening = await openingWith(monorepoIndex());

    expect(opening).toContain(`<repository sha="${baseSha}" truncated="false">`);
    expect(opening).toContain(
      "typescript 2 files (indexed, 1/1 internal imports resolved, 100%)",
    );
    expect(opening).toContain("Languages: json 2 files (not indexed)");
    expect(opening).toContain("markdown 1 file (not indexed)");
  });

  it("renders no block at all when the reviewer built no index", async () => {
    const opening = await openingWith();

    expect(opening).not.toContain("<repository ");
    expect(opening).toContain(INDEX_ABSENT_LINE);
  });

  it("sits between the changed files and the per-file index", async () => {
    const opening = await openingWith(monorepoIndex());

    expect(opening.indexOf("</changed_files>")).toBeLessThan(
      opening.indexOf("<repository "),
    );
    expect(opening.indexOf("</repository>")).toBeLessThan(
      opening.indexOf("<repository_index"),
    );
  });

  it("caps the package list and says how many it left out", async () => {
    const files = new Map([["pnpm-workspace.yaml", "packages:\n  - packages/*\n"]]);
    for (let at = 0; at < 52; at += 1) {
      files.set(
        `packages/p${String(at).padStart(3, "0")}/package.json`,
        JSON.stringify({ name: `@acme/p${at}` }),
      );
    }
    const opening = await openingWith(
      buildRepositoryIndex({ sha: baseSha, files }),
    );

    expect(opening).toContain("Packages (52):");
    expect(opening).toContain("- [... 2 more packages]");
    expect(opening).not.toContain("@acme/p51 —");
  });

  it("names the package a changed file belongs to", async () => {
    const { agent, calls } = makeAgent(scripted, { index: monorepoIndex() });

    await agent.run({
      ...context,
      changedFiles: [
        {
          filename: "packages/app/main.ts",
          status: "modified",
          additions: 1,
          deletions: 0,
        },
      ],
    });

    expect(openingOf(calls[0])).toContain(
      "- packages/app/main.ts — @acme/app, source, no test, 0 importers, dead (not an entry point)",
    );
  });
});

describe("find_references through the agent runtime", () => {
  const callReferences = (input: unknown): ScriptedResponse[] => [
    message([toolUseBlock("toolu_1", "find_references", input)], "tool_use"),
    message([textBlock(finalJson)], "end_turn"),
  ];

  async function referencesResult(
    input: unknown,
    index?: ReturnType<typeof fakeIndex>,
  ): Promise<string> {
    const { agent, calls } = makeAgent(
      callReferences(input),
      index === undefined ? {} : { index },
    );
    await agent.run(context);
    return String(toolResultsOf(calls[1])[0]?.output.value ?? "");
  }

  it("answers from the index the reviewer built, with no GitHub call", async () => {
    const { agent, calls, github } = makeAgent(
      callReferences({ path: "src/sessions.ts" }),
      { index: fakeIndex() },
    );

    await agent.run(context);

    expect(github.searchCode).not.toHaveBeenCalled();
    const payload = JSON.parse(
      String(toolResultsOf(calls[1])[0]?.output.value ?? ""),
    );
    expect(payload.known).toBe(true);
    expect(payload.total).toBe(4);
    expect(payload.index).toMatchObject({ sha: baseSha, truncated: false });
  });

  it("narrows to one exported name", async () => {
    const payload = JSON.parse(
      await referencesResult(
        { path: "src/sessions.ts", name: "createSession" },
        fakeIndex(),
      ),
    );

    expect(payload.references.map((entry: { path: string }) => entry.path)).toEqual([
      "src/admin.ts",
      "src/api.ts",
    ]);
  });

  it("returns the absent one-liner when the reviewer built no index", async () => {
    expect(await referencesResult({ path: "src/sessions.ts" })).toBe(
      INDEX_ABSENT_LINE,
    );
  });
});

describe("cancellation", () => {
  it("passes the review's abort signal to the model call", async () => {
    const controller = new AbortController();
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run({ ...context, signal: controller.signal });

    const { abortSignal } = calls[0] as { abortSignal?: AbortSignal };
    expect(abortSignal?.aborted).toBe(false);
    controller.abort();
    expect(abortSignal?.aborted).toBe(true);
  });

  it("leaves the model call unsignalled when the review carries none", async () => {
    const { agent, calls } = makeAgent([
      message([textBlock(finalJson)], "end_turn"),
    ]);

    await agent.run(context);

    expect(
      (calls[0] as { abortSignal?: AbortSignal }).abortSignal,
    ).toBeUndefined();
  });

  it("emits agent.cancelled, not agent.failed, when the run is aborted", async () => {
    const { model, firstCall } = makeHangingModel();
    const { logger, entries } = createCapturingLogger();
    const agent = createReviewAgent(generalAgent, {
      model,
      github: makeGithub(),
      logger,
    });
    const controller = new AbortController();

    const run = agent.run({ ...context, signal: controller.signal });
    await firstCall;
    controller.abort();
    await expect(run).rejects.toThrow();

    expect(entries.map((entry) => entry.event)).toEqual([
      "agent.started",
      "agent.cancelled",
    ]);
    expect(entries[1]).toMatchObject({ level: "info", agent: "general" });
  });
});
