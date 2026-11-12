import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFakeRuntime } from "@pr-review/agent-runtime";
import { createSilentLogger } from "@pr-review/logging";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { assertFrozen, type Spec } from "#src/contract";
import { createWorktree, headSha } from "#src/git";
import { createFakeSandboxProvider, type FakeHandler } from "#src/sandbox/fake-sandbox";
import { createFactoryService } from "#src/service";
import type { FactoryDatabase } from "#src/store/client";
import { claimRun, listCommands, listEvents, saveProgress } from "#src/store/runs";
import { createTestFactoryDatabase } from "#src/store/test-store";

const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

function fixtureRepo(checks: string): string {
  const repo = mkdtempSync(path.join(tmpdir(), "factory-profiles-"));
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  mkdirSync(path.join(repo, "src"));
  writeFileSync(path.join(repo, "src", "greet.js"), "export const greet = () => 'hi';\n");
  writeFileSync(path.join(repo, "src", "app.js"), "import { greet } from './greet.js';\nconsole.log(greet());\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "init");
  mkdirSync(path.join(repo, ".factory"));
  writeFileSync(path.join(repo, ".factory", "checks"), checks);
  return repo;
}

const baseSpec: Spec = {
  title: "Greet says hello",
  objective: "greet() returns hello",
  category: "bugfix",
  requirements: ["greet returns 'hello'"],
  nonGoals: [],
  constraints: [],
  acceptanceCriteria: [{ id: "AC1", text: "Given greet, when called, then it returns hello", verification: "automated" }],
  plan: ["Edit src/greet.js"],
  architectureDecisions: [],
  repositoryFindings: ["src/greet.js defines greet"],
  assumptions: [],
  estimatedFiles: 1,
  risk: "low",
  touchesSecurityOrData: false,
};

const done = { status: "done", summary: "changed greet", decisions: [], acceptance: [{ id: "AC1", coverage: "greet.test.js" }], blockers: [] };
const placed = { ...done, placement: { location: "src/greet.js", reuse: ["src/greet.js"], rationale: "greet already owns the greeting" } };
const reproduced = { status: "reproduced", summary: "wrote a failing test", reason: "", decisions: ["the bug is the literal in greet.js"] };

type Turn = Parameters<typeof createFakeRuntime>[0][number];

const writes =
  (files: Record<string, string>, structured: unknown): Turn =>
  ({ spec }) => {
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(spec.cwd, file)), { recursive: true });
      writeFileSync(path.join(spec.cwd, file), content);
    }
    return { structured };
  };

const answers =
  (structured: unknown): Turn =>
  () => ({ structured });

const read = (dir: string, file: string) => (existsSync(path.join(dir, file)) ? readFileSync(path.join(dir, file), "utf8") : null);

/** `test` fails only when a test demands hello and greet.js lacks it; `lint` fails while greet.js says "broken". */
const greetChecks: (worktree: string) => FakeHandler = (worktree) => (request) => {
  const greet = read(worktree, "src/greet.js") ?? "";
  if (request.command === "node test.js") {
    if (!greet.includes("export const greet")) return { exitCode: 1, output: "greet is not exported" };
    const test = read(worktree, "src/greet.test.js");
    return test?.includes("hello") && !greet.includes("hello") ? { exitCode: 1, output: `expected hello in ${greet}` } : { exitCode: 0, output: "ok" };
  }
  if (request.command === "node lint.js") return greet.includes("broken") ? { exitCode: 1, output: "lint: broken" } : { exitCode: 0, output: "" };
  if (request.command === "node legacy.js") return { exitCode: 1, output: "legacy check always fails" };
  return { exitCode: 0, output: "" };
};

describe("workflow profiles", () => {
  let database: FactoryDatabase;

  beforeEach(async () => {
    database = await createTestFactoryDatabase();
  });

  async function start(spec: Spec, turns: Turn[], checks = "test: node test.js\n") {
    const repo = fixtureRepo(checks);
    const runtime = createFakeRuntime(turns);
    let worktree = "";
    const sandboxes = createFakeSandboxProvider((request, phase) => greetChecks(worktree)(request, phase));
    const provider = {
      ...sandboxes,
      create: async (config: Parameters<typeof sandboxes.create>[0]) => {
        worktree = config.worktreePath;
        return sandboxes.create(config);
      },
    };
    const service = createFactoryService({ database, runtime, sandboxes: provider, logger: createSilentLogger(), heartbeatMs: 20 });
    const { run } = await service.propose({ repoPath: repo, spec, promptVersion: "test" });
    await service.approve(run.id);
    const artifact = (name: string) => read(path.join(repo, ".factory", "runs", run.id), name);
    return { repo, runtime, service, runId: run.id, profile: run.contract.profile, artifact, taskMd: () => artifact("task.md") ?? "" };
  }

  const eventKinds = async (runId: string) => (await listEvents(database, runId)).map((e) => e.kind);

  describe("bugfix", () => {
    it("commits a failing regression test, then a fix that makes it pass", async () => {
      const { repo, runtime, service, runId, profile, artifact, taskMd } = await start(baseSpec, [
        writes({ "src/greet.test.js": "expect(greet()).toBe('hello')\n" }, reproduced),
        writes({ "src/greet.js": "export const greet = () => 'hello';\n" }, done),
      ]);
      expect(profile).toBe("bugfix");
      expect((await service.runNext({ runId }))?.status).toBe("delivered");

      expect(runtime.specs[0]?.prompt).toMatch(/Reproduce the bug/);
      expect(runtime.specs[1]?.resumeSessionId).toBe("fake-session-1");
      expect(runtime.specs[1]?.prompt).toMatch(/regression test \(src\/greet\.test\.js\) fails in test/);
      const run = (await service.get(runId))!;
      expect(git(repo, "show", "--name-only", "--format=", run.branch!).split("\n").sort()).toEqual(["src/greet.js", "src/greet.test.js"]);

      const evidence = JSON.parse(artifact("artifacts/reproduce.json")!) as { failing: { command: string; outputHash: string }[] };
      expect(evidence.failing[0]).toMatchObject({ command: "node test.js", outputHash: expect.any(String) });
      expect(taskMd()).toMatch(/## Reproduction/);
      expect(taskMd()).toMatch(/failed before the fix .*passes after the fix/);
      expect(taskMd()).toContain("the bug is the literal in greet.js");
      expect(await eventKinds(runId)).toContain("bug_reproduced");
      const stages = (await listCommands(database, runId)).map((c) => `${c.stage}:${c.exitCode}`);
      expect(stages).toEqual(["reproduce:1", "verify:0"]);
    });

    it("stops when the regression test does not fail before the fix", async () => {
      const { service, runId, runtime } = await start(baseSpec, [writes({ "src/greet.test.js": "expect(greet()).toBe('hi')\n" }, reproduced)]);
      expect((await service.runNext({ runId }))?.status).toBe("failed");
      expect((await service.get(runId))!.blocker).toMatch(/passes before any fix, so it does not reproduce the bug/);
      expect(runtime.specs).toHaveLength(1);
    });

    it("rejects a reproduce step that touches non-test files", async () => {
      const { service, runId } = await start(baseSpec, [
        writes({ "src/greet.test.js": "expect(greet()).toBe('hello')\n", "src/greet.js": "export const greet = () => 'hello';\n" }, reproduced),
      ]);
      expect((await service.runNext({ runId }))?.status).toBe("failed");
      expect((await service.get(runId))!.blocker).toMatch(/may only add or change tests, but it changed src\/greet\.js/);
      expect(await eventKinds(runId)).toContain("reproduce_rejected");
    });

    it("needs a manual acceptance criterion to continue without reproduction", async () => {
      const impossible = { status: "not_reproducible", summary: "timing bug", reason: "depends on wall-clock races", decisions: [] };
      const blocked = await start(baseSpec, [answers(impossible)]);
      expect((await blocked.service.runNext({ runId: blocked.runId }))?.status).toBe("failed");
      expect((await blocked.service.get(blocked.runId))!.blocker).toMatch(/could not be reproduced .* requires automated verification/);

      const manual: Spec = { ...baseSpec, acceptanceCriteria: [{ id: "AC1", text: "Given a slow clock, greet still answers", verification: "manual" }] };
      const allowed = await start(manual, [answers(impossible), writes({ "src/greet.js": "export const greet = () => 'hello';\n" }, done)]);
      expect((await allowed.service.runNext({ runId: allowed.runId }))?.status).toBe("delivered");
      expect(allowed.taskMd()).toMatch(/no regression test: depends on wall-clock races/);
      expect(allowed.taskMd()).toMatch(/Not reproduced by a test/);
    });
  });

  describe("refactor", () => {
    const refactorSpec: Spec = { ...baseSpec, title: "Tidy greet", category: "refactor", plan: ["Restructure src/greet.js"] };

    it("fails when a check that passed at baseline regresses", async () => {
      const { service, runId, artifact } = await start(
        refactorSpec,
        [
          writes({ "src/greet.js": "export const greet = () => 'broken';\n" }, placed),
          writes({ "src/greet.js": "export const greet = () => 'still broken';\n" }, done),
        ],
        "test: node test.js\nlint: node lint.js\n",
      );
      expect((await service.runNext({ runId }))?.status).toBe("failed");
      expect((await service.get(runId))!.blocker).toMatch(/lint \(passed at baseline: a regression\)/);
      const baseline = JSON.parse(artifact("artifacts/baseline.json")!) as { name: string; passed: boolean }[];
      expect(baseline.map((b) => [b.name, b.passed])).toEqual([["test", true], ["lint", true]]);
    });

    it("records a check failing at baseline without blaming the run, then reviews once", async () => {
      const { service, runId, runtime, artifact, taskMd } = await start(
        refactorSpec,
        [
          writes({ "src/greet.js": "const message = 'hi';\nexport const greet = () => message;\n" }, placed),
          answers({ verdict: "approve", summary: "behaviour preserved", findings: [] }),
        ],
        "test: node test.js\nlegacy: node legacy.js\n",
      );
      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      const run = (await service.get(runId))!;
      expect(run.outcome?.summary).toMatch(/1 of 2 checks passed; the rest already failed at the base commit/);
      expect(taskMd()).toMatch(/legacy: FAIL \(pre-existing, not blamed on this run\)/);
      expect(taskMd()).toMatch(/legacy fails at the base commit too/);
      expect(taskMd()).toMatch(/placement: src\/greet\.js \(greet already owns the greeting\)/);
      expect(artifact("artifacts/architecture.md")).toMatch(/Recommended placement/);
      expect(runtime.specs[0]?.prompt).toMatch(/Architecture brief/);
      expect(runtime.specs[0]?.prompt).toMatch(/already fail at the base commit .*legacy/);
      expect((await listCommands(database, runId)).map((c) => c.stage)).toEqual(["baseline", "baseline", "verify", "verify"]);
    });

    it("does not rerun the baseline when recovering after it", async () => {
      const { service, runId, repo } = await start(
        refactorSpec,
        [writes({ "src/greet.js": "export const greet = () => 'hi' ;\n" }, placed), answers({ verdict: "approve", summary: "ok", findings: [] })],
        "test: node test.js\n",
      );
      const crashed = (await claimRun(database, { leaseMs: 60_000, runId }))!;
      const worktree = path.join(repo, ".factory", "worktrees", runId);
      const branch = `factory/crashed-${runId.slice(-6)}`;
      await createWorktree(repo, { path: worktree, branch, baseSha: crashed.contract.baseSha });
      const baseline = [{ name: "test", command: "node test.js", exitCode: 0, passed: true, outputHash: "abc" }];
      await saveProgress(database, runId, {
        branch,
        worktreePath: worktree,
        checkpoint: { stage: "baseline", sha: await headSha(worktree), nextStage: "implement", data: { locate: { files: [] }, baseline } },
      });
      await database.execute(sql`update factory_runs set lease_expires_at = now() - interval '1 second' where id = ${runId}`);

      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      expect((await listCommands(database, runId)).map((c) => c.stage)).not.toContain("baseline");
    });
  });

  describe("feature", () => {
    const featureSpec: Spec = { ...baseSpec, title: "Greeting overhaul", category: "feature", estimatedFiles: 6, risk: "medium" };
    const fix = { "src/greet.js": "export const greet = () => 'hello';\n" };

    it("delivers on approval and records placement and reuse", async () => {
      const { service, runId, runtime, artifact, taskMd } = await start(featureSpec, [
        writes(fix, placed),
        answers({ verdict: "approve", summary: "meets AC1", findings: [{ severity: "minor", file: "src/greet.js", problem: "could name the literal" }] }),
      ]);
      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      const reviewer = runtime.specs[1]!;
      expect(reviewer).toMatchObject({ role: "reviewer", readOnly: true, tools: [] });
      expect(reviewer.resumeSessionId).toBeUndefined();
      expect(reviewer.prompt).toContain("-export const greet = () => 'hi';");
      expect(reviewer.prompt).toContain("AC1");
      const review = JSON.parse(artifact("artifacts/review.json")!) as { verdict: string; findings: unknown[] };
      expect(review).toMatchObject({ verdict: "approve", findings: [expect.objectContaining({ severity: "minor" })] });
      expect(taskMd()).toMatch(/## Independent review/);
      expect(taskMd()).toMatch(/reuse: src\/greet\.js/);
      expect((await service.get(runId))!.contract.implementationDecisions.map((d) => d.decision)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^placement: /), expect.stringMatching(/^reuse: /)]),
      );
    });

    it("drops findings on files outside the diff, so they never trigger a repair", async () => {
      const { service, runId, runtime, artifact } = await start(featureSpec, [
        writes(fix, placed),
        answers({ verdict: "changes", summary: "app is wrong", findings: [{ severity: "blocking", file: "src/app.js", problem: "logs to stdout" }] }),
      ]);
      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      expect(runtime.specs).toHaveLength(2);
      const review = JSON.parse(artifact("artifacts/review.json")!) as { verdict: string; dropped: unknown[] };
      expect(review).toMatchObject({ verdict: "approve", dropped: [expect.objectContaining({ reason: "file is not in the diff" })] });
    });

    it("makes one targeted repair for a blocking finding, rechecks and delivers", async () => {
      const { service, runId, runtime, taskMd } = await start(featureSpec, [
        writes(fix, placed),
        answers({ verdict: "changes", summary: "missing edge", findings: [{ severity: "blocking", file: "./src/greet.js", line: 1, acceptanceId: "AC1", problem: "ignores the name" }] }),
        writes({ "src/greet.js": "export const greet = (name = '') => 'hello' + name;\n" }, done),
      ]);
      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      expect(runtime.specs.map((s) => s.role)).toEqual(["implementer", "reviewer", "implementer"]);
      expect(runtime.specs[2]?.resumeSessionId).toBe("fake-session-1");
      expect(runtime.specs[2]?.prompt).toContain("src/greet.js:1 (AC1): ignores the name");
      expect(taskMd()).toMatch(/One repair pass made/);
      expect((await listCommands(database, runId)).map((c) => c.stage)).toEqual(["verify", "review"]);
    });

    it("never reviews twice: a repair that breaks the checks ends the run", async () => {
      const { service, runId, runtime } = await start(
        featureSpec,
        [
          writes(fix, placed),
          answers({ verdict: "changes", summary: "bad", findings: [{ severity: "blocking", file: "src/greet.js", problem: "wrong" }] }),
          writes({ "src/greet.js": "export const greet = () => 'broken hello';\n" }, done),
        ],
        "test: node test.js\nlint: node lint.js\n",
      );
      expect((await service.runNext({ runId }))?.status).toBe("failed");
      expect((await service.get(runId))!.blocker).toMatch(/checks failing after the review repair: lint \(exit 1/);
      expect(runtime.specs.filter((s) => s.role === "reviewer")).toHaveLength(1);
    });

    it("resumes a review checkpoint with the repair, never a second review", async () => {
      const { service, runId, repo, runtime } = await start(featureSpec, [writes({ "src/greet.js": "export const greet = () => 'hello!';\n" }, done)]);
      const crashed = (await claimRun(database, { leaseMs: 60_000, runId }))!;
      const worktree = path.join(repo, ".factory", "worktrees", runId);
      const branch = `factory/crashed-${runId.slice(-6)}`;
      await createWorktree(repo, { path: worktree, branch, baseSha: crashed.contract.baseSha });
      writeFileSync(path.join(worktree, "src", "greet.js"), "export const greet = () => 'hello';\n");
      git(worktree, "commit", "-qam", "factory: implement");
      const finding = { severity: "blocking", file: "src/greet.js", problem: "needs punctuation" };
      const review = { verdict: "changes", summary: "x", findings: [finding], dropped: [], blocking: [finding] };
      await saveProgress(database, runId, {
        branch,
        worktreePath: worktree,
        agentSessionId: "earlier-session",
        checkpoint: { stage: "review", sha: await headSha(worktree), nextStage: "review", data: { locate: { files: [] }, review } },
      });
      await database.execute(sql`update factory_runs set lease_expires_at = now() - interval '1 second' where id = ${runId}`);

      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      expect(runtime.specs.map((s) => [s.role, s.resumeSessionId])).toEqual([["implementer", "earlier-session"]]);
    });
  });

  describe("quick escalation", () => {
    const quickSpec: Spec = { ...baseSpec, title: "Say hello", category: "quick" };
    const many = (count: number) =>
      Object.fromEntries([["src/greet.js", "export const greet = () => 'hello';\n"], ...Array.from({ length: count - 1 }, (_, i) => [`src/extra${i}.js`, `export const x${i} = ${i};\n`])]);

    it("adds one review when the diff outgrows the estimate, without touching the frozen contract", async () => {
      const { service, runId, runtime, profile, taskMd } = await start(quickSpec, [
        writes(many(4), done),
        answers({ verdict: "approve", summary: "fine", findings: [] }),
      ]);
      expect(profile).toBe("quick");
      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      expect(runtime.specs.map((s) => s.role)).toEqual(["implementer", "reviewer"]);
      const events = await listEvents(database, runId);
      expect(events.find((e) => e.kind === "profile_escalated")?.data).toMatchObject({ from: "quick", added: ["review"] });
      const run = (await service.get(runId))!;
      expect(() => assertFrozen(run.contract)).not.toThrow();
      expect(run.contract.profile).toBe("quick");
      expect(run.contract.implementationDecisions.map((d) => d.decision)).toEqual([expect.stringMatching(/^escalated quick to add an independent review: 4 files/)]);
      expect(taskMd()).toMatch(/## Escalation/);
      expect(taskMd()).toMatch(/\[x\] review/);
    });

    it("stops with a blocker when the diff far exceeds the approved scope", async () => {
      const { service, runId, runtime } = await start(quickSpec, [writes(many(11), done)]);
      expect((await service.runNext({ runId }))?.status).toBe("failed");
      expect((await service.get(runId))!.blocker).toMatch(/escalation exceeds the approved scope: the change touches 11 files/);
      expect(runtime.specs).toHaveLength(1);
    });

    it("leaves a contained quick run alone", async () => {
      const { service, runId, runtime } = await start(quickSpec, [writes(many(1), done)]);
      expect((await service.runNext({ runId }))?.status).toBe("delivered");
      expect(runtime.specs).toHaveLength(1);
      expect(await eventKinds(runId)).not.toContain("profile_escalated");
    });
  });
});
