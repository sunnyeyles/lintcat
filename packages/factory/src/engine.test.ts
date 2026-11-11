import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFakeRuntime, type FakeTurn } from "@pr-review/agent-runtime";
import { createSilentLogger } from "@pr-review/logging";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Spec } from "#src/contract";
import { createFakeSandboxProvider, type FakeSandboxProvider } from "#src/sandbox/fake-sandbox";
import { createFactoryService } from "#src/service";
import { claimRun, findEffect, listCommands, listEvents, recordEffect, requestCancel, saveProgress } from "#src/store/runs";
import type { FactoryDatabase } from "#src/store/client";
import { createTestFactoryDatabase } from "#src/store/test-store";
import { executeRun } from "#src/engine";
import { createWorktree, headSha } from "#src/git";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function fixtureRepo(): string {
  const repo = mkdtempSync(path.join(tmpdir(), "factory-repo-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  mkdirSync(path.join(repo, "src"));
  writeFileSync(path.join(repo, "src", "greet.js"), "export const greet = () => 'hi';\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  mkdirSync(path.join(repo, ".factory"));
  writeFileSync(path.join(repo, ".factory", "checks"), "!install: npm install\ntest: node test.js\n");
  return repo;
}

const spec: Spec = {
  title: "Make greet say hello",
  objective: "greet() returns hello",
  category: "quick",
  requirements: ["greet returns 'hello'"],
  nonGoals: [],
  constraints: [],
  acceptanceCriteria: [{ id: "AC1", text: "Given greet, when called, then it returns hello", verification: "automated" }],
  plan: ["Edit src/greet.js"],
  architectureDecisions: ["Change src/greet.js in place"],
  repositoryFindings: ["src/greet.js defines greet"],
  assumptions: [],
  estimatedFiles: 1,
  risk: "low",
  touchesSecurityOrData: false,
};

const done = { status: "done", summary: "changed greet", decisions: ["kept the export name"], acceptance: [{ id: "AC1", coverage: "test.js" }], blockers: [] };

/** The check passes once greet.js says hello; its output names the content so different wrong answers differ. */
function checkingSandbox(): FakeSandboxProvider {
  const provider: FakeSandboxProvider = createFakeSandboxProvider((request, phase) => {
    const create = provider.calls.find((c) => c.kind === "create");
    const worktree = create && create.kind === "create" ? create.config.worktreePath : "";
    if (phase === "setup") {
      writeFileSync(path.join(worktree, "generated.lock"), "from install");
      return { exitCode: 0, output: "installed" };
    }
    if (request.command !== "node test.js") return { exitCode: 0, output: "" };
    const source = readFileSync(path.join(worktree, "src", "greet.js"), "utf8");
    return source.includes("hello") ? { exitCode: 0, output: "ok" } : { exitCode: 1, output: `expected hello in: ${source}` };
  });
  return provider;
}

const writeGreet = (content: string, structured: unknown = done) =>
  ({ spec: s }: { spec: { cwd: string } }): FakeTurn => {
    writeFileSync(path.join(s.cwd, "src", "greet.js"), content);
    return { structured };
  };

describe("quick workflow", () => {
  let database: FactoryDatabase;
  let repo: string;

  beforeEach(async () => {
    database = await createTestFactoryDatabase();
    repo = fixtureRepo();
  });

  async function approvedRun(turns: Parameters<typeof createFakeRuntime>[0], sandboxes = checkingSandbox(), extra = {}) {
    const runtime = createFakeRuntime(turns);
    const service = createFactoryService({ database, runtime, sandboxes, logger: createSilentLogger(), heartbeatMs: 20, ...extra });
    const { run } = await service.propose({ repoPath: repo, spec, promptVersion: "test" });
    await service.approve(run.id);
    return { service, runtime, sandboxes, runId: run.id };
  }

  it("delivers one verified commit on a factory branch with a gitignored task.md", async () => {
    const { service, runtime, sandboxes, runId } = await approvedRun([writeGreet("export const greet = () => 'hello';\n")]);
    const result = await service.runNext({ runId });
    expect(result?.status).toBe("delivered");

    const run = (await service.get(runId))!;
    expect(run.branch).toMatch(/^factory\/make-greet-say-hello-/);
    expect(git(repo, "rev-list", "--count", `main..${run.branch}`)).toBe("1");
    expect(git(repo, "log", "-1", "--format=%s", run.branch!)).toBe(spec.title);
    expect(git(repo, "show", "--name-only", "--format=", run.branch!).split("\n")).toEqual(["src/greet.js"]);

    const taskMd = readFileSync(path.join(repo, ".factory", "runs", runId, "task.md"), "utf8");
    expect(taskMd).toContain("Make greet say hello");
    expect(taskMd).toContain("kept the export name");
    expect(git(repo, "check-ignore", ".factory/runs")).toBe(".factory/runs");
    expect(git(repo, "status", "--porcelain")).toBe("");

    const kinds = sandboxes.calls.map((c) => c.kind);
    expect(kinds.indexOf("isolate")).toBeLessThan(kinds.indexOf("exec"));
    expect(kinds.at(-1)).toBe("destroy");
    expect(runtime.specs[0]?.tools?.map((t) => t.name)).toEqual(["sandbox_exec"]);
    const events = (await listEvents(database, runId)).map((e) => e.kind);
    expect(events).toContain("run_delivered");
    expect((await listCommands(database, runId)).map((c) => c.name)).toEqual(["install", "test"]);
  });

  it("repairs a failing check once, resuming the same agent session", async () => {
    const { service, runtime, runId } = await approvedRun([
      writeGreet("export const greet = () => 'hey';\n"),
      writeGreet("export const greet = () => 'hello';\n"),
    ]);
    expect((await service.runNext({ runId }))?.status).toBe("delivered");
    expect(runtime.specs[1]?.resumeSessionId).toBe("fake-session-1");
    expect(runtime.specs[1]?.prompt).toContain("expected hello");
    expect(runtime.specs[1]?.maxTurns).toBe(runtime.specs[0]!.maxTurns - 1);
    const failed = (await listCommands(database, runId)).filter((c) => c.exitCode !== 0);
    expect(failed).toHaveLength(1);
  });

  it("stops when a repair leaves the same failure", async () => {
    const { service, runId } = await approvedRun([
      writeGreet("export const greet = () => 'hey';\n"),
      ({ spec: s }) => {
        writeFileSync(path.join(s.cwd, "notes.txt"), "tried");
        return { structured: done };
      },
    ]);
    expect((await service.runNext({ runId }))?.status).toBe("failed");
    const run = (await service.get(runId))!;
    expect(run.blocker).toMatch(/failed identically/);
    expect((await listEvents(database, runId)).map((e) => e.kind)).toContain("repeated_failure");
  });

  it("fails cleanly once the repair budget is spent", async () => {
    const { service, runId } = await approvedRun([
      writeGreet("export const greet = () => 'a';\n"),
      writeGreet("export const greet = () => 'b';\n"),
    ]);
    expect((await service.runNext({ runId }))?.status).toBe("failed");
    expect((await service.get(runId))!.blocker).toMatch(/after 1 repair pass/);
    expect(readFileSync(path.join(repo, ".factory", "runs", runId, "task.md"), "utf8")).toMatch(/Blockers/);
  });

  it("cancels a running run at the next heartbeat", async () => {
    let runIdRef = "";
    const { service, runId } = await approvedRun([
      async ({ spec: s }) => {
        await requestCancel(database, runIdRef);
        await new Promise((resolve) => setTimeout(resolve, 150));
        writeFileSync(path.join(s.cwd, "src", "greet.js"), "export const greet = () => 'hello';\n");
        return { structured: done };
      },
    ]);
    runIdRef = runId;
    expect((await service.runNext({ runId }))?.status).toBe("cancelled");
    expect((await service.get(runId))!.status).toBe("cancelled");
  });

  it("recovers an interrupted run from its checkpoint, discarding uncommitted work", async () => {
    const { service, runtime, runId } = await approvedRun([writeGreet("export const greet = () => 'hello';\n")]);
    const crashed = (await claimRun(database, { leaseMs: 60_000, runId }))!;
    const worktree = path.join(repo, ".factory", "worktrees", runId);
    await createWorktree(repo, { path: worktree, branch: `factory/crashed-${runId.slice(-6)}`, baseSha: crashed.contract.baseSha });
    await saveProgress(database, runId, {
      branch: `factory/crashed-${runId.slice(-6)}`,
      worktreePath: worktree,
      checkpoint: { stage: "locate", sha: await headSha(worktree), nextStage: "implement", data: { locate: { files: [] } } },
    });
    writeFileSync(path.join(worktree, "half-written.txt"), "partial");
    await database.execute(sql`update factory_runs set lease_expires_at = now() - interval '1 second' where id = ${runId}`);

    expect((await service.runNext({ runId }))?.status).toBe("delivered");
    expect(existsSync(path.join(worktree, "half-written.txt"))).toBe(false);
    expect(runtime.specs).toHaveLength(1);
    const run = (await service.get(runId))!;
    expect(run.recoveries).toBe(1);
    expect((await listEvents(database, runId)).map((e) => e.kind)).toEqual(
      expect.arrayContaining(["recovery_started", "worktree_reconciled", "run_delivered"]),
    );
  });

  it("never opens a second pull request for the same run", async () => {
    const remote = mkdtempSync(path.join(tmpdir(), "factory-remote-"));
    execFileSync("git", ["init", "-q", "--bare", remote]);
    git(repo, "remote", "add", "origin", remote);
    let opened = 0;
    const openPullRequest = async () => ({ url: `https://example.test/pr/${++opened}` });
    const runtime = createFakeRuntime([writeGreet("export const greet = () => 'hello';\n")]);
    const service = createFactoryService({ database, runtime, sandboxes: checkingSandbox(), logger: createSilentLogger(), delivery: "pr", openPullRequest });
    const { run } = await service.propose({ repoPath: repo, spec, promptVersion: "test", allowPullRequest: true });
    await service.approve(run.id);
    await recordEffect(database, { key: `pr:${run.id}`, runId: run.id, kind: "pull_request", result: { url: "https://example.test/pr/earlier" } });

    expect((await service.runNext({ runId: run.id }))?.status).toBe("delivered");
    expect(opened).toBe(0);
    expect((await service.get(run.id))!.outcome?.pullRequestUrl).toBe("https://example.test/pr/earlier");
    expect(await findEffect(database, `push:${run.id}:${git(repo, "rev-parse", (await service.get(run.id))!.branch!)}`)).toBeDefined();
  });

  it("refuses to run a contract edited after approval", async () => {
    const { service, runId } = await approvedRun([writeGreet("x")]);
    await database.execute(
      sql`update factory_runs set contract = jsonb_set(contract, '{spec,title}', '"Something else"') where id = ${runId}`,
    );
    const claimed = (await claimRun(database, { leaseMs: 60_000, runId }))!;
    const status = await executeRun(
      { database, runtime: createFakeRuntime([]), sandboxes: checkingSandbox(), logger: createSilentLogger(), delivery: "branch" },
      claimed,
    );
    expect(status).toBe("failed");
    expect((await service.get(runId))!.blocker).toMatch(/changed after approval/);
  });
});
