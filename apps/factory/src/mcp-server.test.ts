import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createFakeRuntime, type FakeRuntime } from "@pr-review/agent-runtime";
import { createFactoryService, type FactoryRun, type Spec } from "@pr-review/factory";
import { createSilentLogger } from "@pr-review/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// The package exports no test helpers, so these come from its sources.
import { createFakeSandboxProvider } from "@pr-review/factory/fake-sandbox";
import { createTestFactoryDatabase } from "@pr-review/factory/test-store";

import { createFactoryMcpServer, type LaunchResult } from "#src/mcp-server";

const spec: Spec = {
  title: "Add a --version flag",
  objective: "Print the version",
  category: "quick",
  requirements: ["--version prints the package version"],
  nonGoals: [],
  constraints: [],
  acceptanceCriteria: [{ id: "AC1", text: "Given the CLI, when run with --version, then it prints the version", verification: "automated" }],
  plan: ["Edit src/cli.js"],
  architectureDecisions: [],
  repositoryFindings: [],
  assumptions: [],
  estimatedFiles: 1,
  risk: "low",
  touchesSecurityOrData: false,
};

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

let repo: string;
let client: Client;
let launched: FactoryRun[];
let runtime: FakeRuntime;
let turns: Parameters<typeof createFakeRuntime>[0];

beforeEach(async () => {
  repo = mkdtempSync(path.join(tmpdir(), "factory-mcp-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  writeFileSync(path.join(repo, "cli.js"), "console.log('hi');\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");

  turns = [];
  runtime = createFakeRuntime(turns);
  launched = [];
  const service = createFactoryService({
    database: await createTestFactoryDatabase(),
    runtime: createFakeRuntime([]),
    sandboxes: createFakeSandboxProvider(),
    logger: createSilentLogger(),
  });
  const launch = async (run: FactoryRun): Promise<LaunchResult> => {
    launched.push(run);
    return { mode: "detached", pid: 4242, log: path.join(run.repoPath, ".factory", "factory.log") };
  };
  const server = createFactoryMcpServer({ service, runtime, cwd: repo, launch });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});

afterEach(async () => {
  await client.close();
  rmSync(repo, { recursive: true, force: true });
});

interface Reply {
  kind: string;
  runId: string;
  run: { status: string; title: string };
  runs: unknown[];
  pendingQuestion: { question: string };
  spec: Spec;
  launch: unknown;
  outcome: unknown;
  written: boolean;
  terminal: boolean;
  taskPath: string;
}

async function call(name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  return { result, text, data: (result.structuredContent ?? {}) as unknown as Reply };
}

async function proposed(): Promise<string> {
  const { data } = await call("factory_start", { repoPath: repo, spec });
  return data.runId;
}

describe("factory MCP server", () => {
  it("lists the six factory tools plus factory_answer", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "factory_answer",
      "factory_approve",
      "factory_cancel",
      "factory_read_task",
      "factory_result",
      "factory_start",
      "factory_status",
    ]);
  });

  it("records a host-written spec as awaiting approval without running an agent", async () => {
    const { result, data, text } = await call("factory_start", { repoPath: repo, spec });
    expect(result.isError).toBeFalsy();
    expect(text).toContain("factory_approve");
    const status = await call("factory_status", { runId: data.runId });
    expect(status.data.run.status).toBe("awaiting_approval");
    expect(runtime.specs).toHaveLength(0);
    expect(launched).toHaveLength(0);

    const task = await call("factory_read_task", { runId: data.runId });
    expect(task.text).toContain("Add a --version flag");
    expect(task.data.written).toBe(false);
  });

  it("rejects an invalid spec and a call with both or neither of spec and outcome", async () => {
    const invalid = await call("factory_start", { repoPath: repo, spec: { ...spec, acceptanceCriteria: [] } });
    expect(invalid.result.isError).toBe(true);
    const both = await call("factory_start", { repoPath: repo, spec, outcome: "x" });
    expect(both.result.isError).toBe(true);
    expect(both.text).toMatch(/exactly one/);
    const neither = await call("factory_start", { repoPath: repo });
    expect(neither.result.isError).toBe(true);
    expect((await call("factory_status", {})).data.runs).toEqual([]);
  });

  it("runs discovery one turn per call: question, answer, proposal, revision, approval", async () => {
    turns.push(
      () => ({ structured: { kind: "question", question: "Which flag name?", facts: ["CLI in cli.js"] } }),
      () => ({ structured: { kind: "proposal", spec } }),
      () => ({ structured: { kind: "proposal", spec: { ...spec, title: "Add --version and -v" } } }),
    );
    const start = await call("factory_start", { repoPath: repo, outcome: "add a version flag" });
    expect(start.result.isError).toBeFalsy();
    expect(start.data.kind).toBe("question");
    expect(start.text).toContain("Which flag name?");
    const runId = start.data.runId;

    const draft = await call("factory_status", { runId });
    expect(draft.data.run.status).toBe("draft");
    expect(draft.data.pendingQuestion.question).toBe("Which flag name?");
    expect((await call("factory_approve", { runId })).result.isError).toBe(true);

    const proposal = await call("factory_answer", { runId, answer: "--version" });
    expect(proposal.data).toMatchObject({ kind: "proposal", runId, spec: { title: spec.title } });
    expect(runtime.specs[1]?.resumeSessionId).toBe("fake-session-1");
    expect(runtime.specs[1]?.prompt).toBe("Answer: --version");
    expect(runtime.specs.every((s) => s.readOnly)).toBe(true);

    const revised = await call("factory_answer", { runId, answer: "also -v" });
    expect(revised.data.spec.title).toBe("Add --version and -v");
    expect(runtime.specs[2]?.prompt).toMatch(/Revise the spec[\s\S]*also -v/);
    expect((await call("factory_status", { runId })).data.run).toMatchObject({ status: "awaiting_approval", title: "Add --version and -v" });

    const approve = await call("factory_approve", { runId });
    expect(approve.result.isError).toBeFalsy();
    expect(launched.map((r) => r.id)).toEqual([runId]);
  });

  it("keeps a draft whose first turn failed so factory_answer can retry it", async () => {
    turns.push(() => ({ ok: false }), () => ({ structured: { kind: "proposal", spec } }));
    const start = await call("factory_start", { repoPath: repo, outcome: "add a version flag" });
    expect(start.result.isError).toBe(true);
    const runId = /run (r\w+) is kept as a draft/.exec(start.text)?.[1];
    expect(runId).toBeDefined();
    const retry = await call("factory_answer", { runId, answer: "keep it small" });
    expect(retry.data.kind).toBe("proposal");
    expect(runtime.specs[1]?.prompt).toMatch(/Desired outcome[\s\S]*keep it small/);
  });

  it("approves, launches execution detached and returns at once", async () => {
    const runId = await proposed();
    const approve = await call("factory_approve", { runId });
    expect(approve.result.isError).toBeFalsy();
    expect(approve.data.run.status).toBe("queued");
    expect(approve.data.launch).toMatchObject({ mode: "detached", pid: 4242 });
    expect(launched.map((r) => r.id)).toEqual([runId]);
    expect(launched[0]?.contract.approval.state).toBe("approved");

    const again = await call("factory_approve", { runId });
    expect(again.result.isError).toBe(true);
    expect(launched).toHaveLength(1);
  });

  it("cancels a queued run and a discovery draft", async () => {
    const runId = await proposed();
    await call("factory_approve", { runId });
    const cancel = await call("factory_cancel", { runId });
    expect(cancel.data.outcome).toBe("cancelled");
    expect((await call("factory_status", { runId })).data).toMatchObject({ run: { status: "cancelled" }, terminal: true });
    expect((await call("factory_cancel", { runId })).data.outcome).toBe("finished");

    turns.push(() => ({ structured: { kind: "question", question: "Which?" } }));
    const draft = (await call("factory_start", { repoPath: repo, outcome: "x" })).data.runId;
    expect((await call("factory_cancel", { runId: draft })).data.outcome).toBe("cancelled");
    expect((await call("factory_answer", { runId: draft, answer: "y" })).text).toMatch(/discovery is over/);
  });

  it("reports a result's evidence, marked unfinished until the run is terminal", async () => {
    const runId = await proposed();
    const result = await call("factory_result", { runId });
    expect(result.result.isError).toBeFalsy();
    expect(result.data).toMatchObject({ terminal: false, outcome: null, decisions: [], commands: [] });
    expect(result.data.taskPath).toBe(path.join(git(repo, "rev-parse", "--show-toplevel"), ".factory", "runs", runId, "task.md"));
    expect(result.text).toMatch(/Not finished yet/);
  });

  it("answers an unknown run id with a tool error", async () => {
    for (const name of ["factory_status", "factory_read_task", "factory_approve", "factory_cancel", "factory_result"]) {
      const { result, text } = await call(name, { runId: "r-missing" });
      expect(result.isError, name).toBe(true);
      expect(text, name).toContain("no run r-missing");
    }
    expect((await call("factory_answer", { runId: "r-missing", answer: "x" })).text).toContain("no run r-missing");
  });

  it("keeps discovery state out of git", async () => {
    turns.push(() => ({ structured: { kind: "question", question: "Which?" } }));
    const runId = (await call("factory_start", { repoPath: repo, outcome: "x" })).data.runId;
    expect(existsSync(path.join(repo, ".factory", "runs", runId, "discovery.json"))).toBe(true);
    expect(git(repo, "status", "--porcelain")).toBe("");
  });
});
