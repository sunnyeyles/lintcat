import { execFileSync, execSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFakeRuntime, type FakeTurn } from "@pr-review/agent-runtime";
import { createSilentLogger } from "@pr-review/logging";
import { beforeEach, describe, expect, it } from "vitest";

import { renderComparison } from "#src/bench/compare";
import { parseBenchConfig } from "#src/bench/config";
import { buildFixture, listFixtures, loadFixture } from "#src/bench/fixtures";
import { loadResults, runBenchmark, runHiddenChecks, type BenchResult } from "#src/bench/runner";
import { createFakeSandboxProvider, type FakeSandboxProvider } from "#src/sandbox/fake-sandbox";
import type { SandboxProvider } from "#src/sandbox/sandbox";
import type { FactoryDatabase } from "#src/store/client";
import { createTestFactoryDatabase } from "#src/store/test-store";

const BENCH = path.resolve(import.meta.dirname, "../../../../benchmarks/factory");
const temp = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

// Executes on the host: only for fixture code and fake-agent edits written by these tests.
function hostSandboxes(): SandboxProvider & { calls: FakeSandboxProvider["calls"] } {
  let worktree = "";
  const fake = createFakeSandboxProvider((request) => {
    try {
      return { exitCode: 0, output: execSync(request.command, { cwd: path.join(worktree, request.cwd ?? ""), encoding: "utf8", stdio: "pipe" }) };
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string };
      return { exitCode: failed.status ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
    }
  });
  return {
    name: fake.name,
    calls: fake.calls,
    create(config) {
      worktree = config.worktreePath;
      return fake.create(config);
    },
  };
}

const done = (status = "done") => ({ status, summary: "edited greet", decisions: [], acceptance: [], blockers: [] });

const writeFile = (relative: string, content: string, structured: unknown = done()) =>
  ({ spec }: { spec: { cwd: string } }): FakeTurn => {
    writeFileSync(path.join(spec.cwd, relative), content);
    return { structured };
  };

const referenceGreet = () => readFileSync(path.join(BENCH, "fixtures/quick/reference/src/greet.mjs"), "utf8");

describe("benchmark fixtures", () => {
  it.each(listFixtures(BENCH))("%s builds to its recorded SHA every time", async (name) => {
    const fixture = loadFixture(BENCH, name);
    const first = await buildFixture(fixture, temp("bench-a-"));
    const second = await buildFixture(fixture, temp("bench-b-"));
    expect(first.sha).toBe(fixture.baseSha);
    expect(second.sha).toBe(fixture.baseSha);
    expect(git(first.repoPath, "status", "--porcelain")).toBe("?? .factory/");
  });

  it("covers the four seeded task kinds", () => {
    expect(listFixtures(BENCH)).toEqual(["bugfix", "greenfield", "quick", "refactor"]);
  });

  it("refuses a fixture whose files drifted from the recorded SHA", async () => {
    const fixture = { ...loadFixture(BENCH, "quick"), baseSha: "0".repeat(40) };
    await expect(buildFixture(fixture, temp("bench-c-"))).rejects.toThrow(/expected 0{40}/);
  });

  it.each(listFixtures(BENCH))("%s: hidden checks fail on the base and pass on the reference solution", async (name) => {
    const fixture = loadFixture(BENCH, name);
    const { repoPath } = await buildFixture(fixture, temp("bench-h-"));
    git(repoPath, "checkout", "-q", "-b", "reference");
    cpSync(path.join(fixture.dir, "reference"), repoPath, { recursive: true });
    git(repoPath, "add", "-A", "src");
    git(repoPath, "commit", "-qm", "reference");
    const hidden = (branch: string) =>
      runHiddenChecks({ repoPath, branch, fixture, sandboxes: hostSandboxes(), image: "unused", label: `h-${name}`, workDir: temp("bench-w-") });
    expect((await hidden("main")).passed).toBe(false);
    expect(await hidden("reference")).toMatchObject({ ran: true, passed: true, exitCode: 0 });
  });
});

describe("benchmark harness", () => {
  let database: FactoryDatabase;
  let resultsDir: string;

  beforeEach(async () => {
    database = await createTestFactoryDatabase();
    resultsDir = temp("bench-results-");
  });

  async function bench(turns: Parameters<typeof createFakeRuntime>[0], raw: object = { name: "test" }) {
    const runtime = createFakeRuntime(turns);
    const hidden = hostSandboxes();
    const results = await runBenchmark(
      { database, runtime, sandboxes: hostSandboxes(), hiddenSandboxes: hidden, logger: createSilentLogger(), heartbeatMs: 20 },
      { benchDir: BENCH, config: parseBenchConfig(raw), fixtures: ["quick"], resultsDir },
    );
    return { results, runtime, hidden };
  }

  it("verifies a delivery only when the hidden checks pass", async () => {
    const { results, hidden } = await bench([writeFile("src/greet.mjs", referenceGreet())]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      fixture: { name: "quick" },
      profile: "quick",
      factoryStatus: "delivered",
      claimedChecksPassed: true,
      hidden: { ran: true, passed: true },
      verified: true,
      repairs: 0,
    });
    expect(hidden.calls.filter((c) => c.kind === "exec").map((c) => (c.kind === "exec" ? c.request.command : ""))).toEqual([
      'node --test ".bench-hidden/*.test.mjs"',
    ]);
  });

  it("does not trust the factory's own verdict: delivered, but the hidden checks fail", async () => {
    const lazy = "export function greet(name) {\n  return `Hello, ${name}`; // options later\n}\n";
    const { results } = await bench([writeFile("src/greet.mjs", lazy)]);
    expect(results[0]).toMatchObject({ factoryStatus: "delivered", claimedChecksPassed: true, hidden: { ran: true, passed: false }, verified: false });
    expect(results[0]!.hidden.output).toMatch(/excited/);
  });

  it("ignores the agent's own claim when the hidden checks pass", async () => {
    const { results } = await bench([writeFile("src/greet.mjs", referenceGreet(), done("partial"))]);
    expect(results[0]).toMatchObject({ factoryStatus: "delivered", verified: true });
  });

  it("applies a config's model and budgets and records its hash", async () => {
    const config = { name: "tight", model: "claude-test", budgets: { maxRepairPasses: 0 } };
    const { results, runtime } = await bench([writeFile("src/greet.mjs", "export const greet = () => 'nope';\n")], config);
    expect(runtime.specs[0]?.model).toBe("claude-test");
    expect(results[0]).toMatchObject({ factoryStatus: "failed", verified: false, hidden: { ran: false }, config: { name: "tight", model: "claude-test", hash: parseBenchConfig(config).hash } });
    expect(results[0]!.blocker).toMatch(/after 0 repair pass/);
  });

  it("writes one JSON result per run under the config's versioned directory", async () => {
    await bench([writeFile("src/greet.mjs", referenceGreet())]);
    const [dir] = readdirSync(resultsDir);
    expect(dir).toBe(`test-${parseBenchConfig({ name: "test" }).hash.slice(0, 8)}`);
    expect(loadResults(path.join(resultsDir, dir!)).map((r) => r.verified)).toEqual([true]);
  });
});

describe("benchmark configs and comparison", () => {
  it("hashes the parsed config, not its formatting", () => {
    const a = parseBenchConfig({ name: "x", budgets: { maxRepairPasses: 1 }, repeat: 1 });
    const b = parseBenchConfig(JSON.parse('{ "repeat": 1,   "budgets": {"maxRepairPasses": 1}, "name": "x" }'));
    expect(a.hash).toBe(b.hash);
    expect(parseBenchConfig({ name: "x", budgets: { maxRepairPasses: 2 } }).hash).not.toBe(a.hash);
    expect(() => parseBenchConfig({ name: "x", unknown: true })).toThrow();
    for (const file of readdirSync(path.join(BENCH, "configs"))) {
      expect(() => parseBenchConfig(JSON.parse(readFileSync(path.join(BENCH, "configs", file), "utf8")))).not.toThrow();
    }
  });

  const result = (config: string, fixture: string, verified: boolean, extra: Partial<BenchResult> = {}): BenchResult => ({
    schemaVersion: 1,
    config: { name: config, hash: `${config}0000000000`, model: null },
    fixture: { name: fixture, baseSha: "0".repeat(40) },
    repetition: 1,
    runId: `${config}-${fixture}`,
    profile: "quick",
    workflowVersion: "1+abc",
    promptVersions: ["implementer@1+def"],
    toolVersion: "factory@0.1.0",
    factoryStatus: "delivered",
    blocker: null,
    claimedChecksPassed: true,
    hidden: { ran: true, passed: verified, exitCode: verified ? 0 : 1, output: "" },
    verified,
    repairs: 0,
    wallTimeMs: 60_000,
    estimatedCostUsd: 0.5,
    startedAt: "2026-06-01T00:00:00.000Z",
    finishedAt: "2026-06-01T00:01:00.000Z",
    ...extra,
  });

  it("prints a per-profile table with deltas and per-fixture counts", () => {
    const a = [result("base", "quick", true), result("base", "greenfield", false)];
    const b = [result("next", "quick", true, { wallTimeMs: 30_000 }), result("next", "greenfield", true, { repairs: 1, wallTimeMs: 30_000 })];
    const text = renderComparison(a, b);
    expect(text).toContain("A: base@base0000");
    expect(text).toContain("B: next@next0000");
    expect(text).toMatch(/quick\s+verified \(hidden checks\)\s+1\/2 50%\s+2\/2 100%\s+\+50%/);
    expect(text).toMatch(/first-pass rate\s+50%\s+50%\s+0/);
    expect(text).toMatch(/false claims\s+1\s+0\s+-1/);
    expect(text).toMatch(/median wall time\s+60\.0s\s+30\.0s\s+-30\.0s/);
    expect(text).toMatch(/est\. cost \/ verified\s+\$1\.00\s+\$0\.50\s+-\$0\.50/);
    expect(text).toMatch(/greenfield\s+0\/1\s+1\/1/);
  });
});
