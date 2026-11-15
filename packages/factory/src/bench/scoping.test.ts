import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createFakeRuntime } from "@pr-review/agent-runtime";
import { describe, expect, it } from "vitest";

import { parseBenchConfig } from "#src/bench/config";
import { buildRepo } from "#src/bench/fixtures";
import { gradeScoping, listScopingFixtures, loadScopingFixture, runScopingBenchmark, summarizeScoping } from "#src/bench/scoping";

const BENCH = path.resolve(import.meta.dirname, "../../../../benchmarks/factory");
const temp = (prefix: string) => mkdtempSync(path.join(tmpdir(), prefix));
const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();

const verdict = (structured: object) => () => ({ structured: { reason: "", evidence: [], followUps: [], ...structured } });
const toRefactor = verdict({
  verdict: "change",
  category: "refactor",
  reason: "findUser returns undefined and four callers dereference it.",
  evidence: ["src/users.mjs:6", "src/email.mjs:4", "src/billing.mjs:4"],
});

describe("scoping fixtures", () => {
  it("are two matched pairs", () => {
    expect(listScopingFixtures(BENCH)).toEqual(["bandaid-null-check", "oneoff-null-check", "refactor-changes-behaviour", "true-refactor"]);
    const draft = (name: string) => readFileSync(path.join(BENCH, "scoping", name, "draft.json"), "utf8");
    expect(draft("bandaid-null-check")).toBe(draft("oneoff-null-check"));
    expect(draft("refactor-changes-behaviour")).toBe(draft("true-refactor"));
  });

  it.each(listScopingFixtures(BENCH))("%s builds to its recorded SHA with nothing uncommitted", async (name) => {
    const fixture = loadScopingFixture(BENCH, name);
    const { repoPath, sha } = await buildRepo(fixture, temp("scoping-"));
    expect(sha).toBe(fixture.baseSha);
    expect(git(repoPath, "status", "--porcelain")).toBe("");
  });

  it("keeps the expectation out of the repo the scoper reads", () => {
    for (const name of listScopingFixtures(BENCH)) {
      expect(readdirSync(path.join(BENCH, "scoping", name, "repo"))).not.toContain("expected.json");
    }
  });
});

describe("grading a verdict", () => {
  const bandaid = loadScopingFixture(BENCH, "bandaid-null-check");
  const oneoff = loadScopingFixture(BENCH, "oneoff-null-check");
  const change = { verdict: "change" as const, from: "bugfix" as const, proposed: "refactor" as const, reason: "x", evidence: ["src/users.mjs", "src/email.mjs", "src/billing.mjs"], followUps: [], promptVersion: "scoper@1+0" };
  const accept = { ...change, verdict: "accept" as const, proposed: "bugfix" as const, evidence: [] };

  it("passes a right pushback that cites every required file", () => {
    expect(gradeScoping(bandaid, change)).toMatchObject({ shouldPushBack: true, pushedBack: true, passed: true });
  });

  it("fails a right category with missing evidence", () => {
    expect(gradeScoping(bandaid, { ...change, evidence: ["src/profile.mjs"] })).toMatchObject({ passed: false, missingCitations: ["src/users.mjs", "src/email.mjs", "src/billing.mjs"] });
  });

  it("fails a false pushback and passes a correct accept", () => {
    expect(gradeScoping(oneoff, change)).toMatchObject({ shouldPushBack: false, pushedBack: true, passed: false });
    expect(gradeScoping(oneoff, accept)).toMatchObject({ pushedBack: false, passed: true });
    expect(gradeScoping(bandaid, accept)).toMatchObject({ passed: false });
  });
});

describe("the scoping benchmark", () => {
  it("runs only the scoper, read-only, on each repetition, and counts right and false pushbacks apart", async () => {
    const runtime = createFakeRuntime([toRefactor, toRefactor, toRefactor, verdict({ verdict: "accept" })]);
    const resultsDir = temp("scoping-results-");
    const config = parseBenchConfig({ name: "scoping", model: "claude-test", repeat: 2 });
    const results = await runScopingBenchmark({ runtime, benchDir: BENCH, config, fixtures: ["bandaid-null-check", "oneoff-null-check"], resultsDir });
    expect(runtime.specs.map((s) => [s.role, s.readOnly, s.model])).toEqual(Array(4).fill(["scoper", true, "claude-test"]));
    expect(runtime.specs[0]?.prompt).toContain("Fix the crash on the profile page");
    expect(results.map((r) => [r.fixture.name, r.passed])).toEqual([
      ["bandaid-null-check", true],
      ["bandaid-null-check", true],
      ["oneoff-null-check", false],
      ["oneoff-null-check", true],
    ]);
    expect(summarizeScoping(results)).toEqual({ passed: 3, total: 4, rightPushbacks: 2, mislabelled: 2, falsePushbacks: 1, correctlyLabelled: 2 });
    expect(readdirSync(path.join(resultsDir, `scoping-${config.hash.slice(0, 8)}`))).toHaveLength(4);
  });
});
