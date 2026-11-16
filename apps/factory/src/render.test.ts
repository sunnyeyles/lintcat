import type { FactoryCommand, FactoryRun } from "#src/engine/store/schema";
import type { Spec } from "#src/engine/contract";
import { describe, expect, it } from "vitest";

import { formatData, formatEvent, renderFailedCommand, renderResult, renderRuns, renderSpec } from "#src/render";

const spec: Spec = {
  title: "Add a --json flag",
  objective: "Machine-readable output",
  category: "feature",
  requirements: ["prints JSON"],
  nonGoals: ["YAML"],
  constraints: [],
  acceptanceCriteria: [{ id: "AC1", text: "--json prints valid JSON", verification: "automated" }],
  plan: ["add the flag", "test it"],
  architectureDecisions: [],
  repositoryFindings: [],
  assumptions: ["stdout only"],
  estimatedFiles: 3,
  risk: "low",
  touchesSecurityOrData: false,
};

describe("rendering a spec", () => {
  it("shows the routed profile, the criteria and the numbered plan, and drops empty sections", () => {
    const text = renderSpec(spec, { profile: "feature", reason: "new behaviour", overridden: false }, "r1");
    expect(text).toContain("── Add a --json flag (r1)");
    expect(text).toContain("Profile:   feature: new behaviour");
    expect(text).toContain("  AC1 [automated] --json prints valid JSON");
    expect(text).toContain("  2. test it");
    expect(text).toContain("Non-goals:\n  - YAML");
    expect(text).not.toContain("Constraints:");
  });
});

describe("rendering a scoping record", () => {
  const route = { profile: "refactor", reason: "structure", overridden: false } as const;
  const scoping = {
    verdict: "change" as const,
    from: "bugfix" as const,
    proposed: "refactor" as const,
    final: "refactor" as const,
    reason: "three call sites",
    evidence: ["src/a.ts:10 parses by hand"],
    followUps: [],
    applied: true,
    promptVersion: "scoper@1+00000000",
  };

  it("shows an applied change after the category, with its evidence", () => {
    const text = renderSpec({ ...spec, category: "refactor", scoping }, route, "r1");
    expect(text).toMatch(/Category:.*\nScoping: {3}proposed refactor instead of bugfix \(applied\): three call sites\n {2}- src\/a.ts:10 parses by hand/);
  });

  it("shows a rebuttal", () => {
    expect(renderSpec({ ...spec, scoping: { ...scoping, final: "bugfix", applied: false } }, route, "r1")).toContain("(rebutted): three call sites");
  });

  it("shows a third category the user settled on", () => {
    const text = renderSpec({ ...spec, category: "feature", scoping: { ...scoping, final: "feature", applied: false } }, route, "r1");
    expect(text).toContain("(changed to feature): three call sites");
  });

  it("lists follow-ups from an accept without a scoping line", () => {
    const accept = { ...scoping, verdict: "accept" as const, proposed: "bugfix" as const, final: "bugfix" as const, evidence: [], followUps: ["split the parser"] };
    const text = renderSpec({ ...spec, scoping: accept }, route, "r1");
    expect(text).not.toContain("Scoping:");
    expect(text).toContain("Follow-ups:\n  - split the parser");
  });

  it("shows nothing without a record", () => {
    const text = renderSpec(spec, route, "r1");
    expect(text).not.toContain("Scoping:");
    expect(text).not.toContain("Follow-ups:");
  });
});

describe("formatting an event", () => {
  it("is one line: time, stage, kind and the scalar data", () => {
    const line = formatEvent({
      at: new Date("2026-11-11T10:20:30Z"),
      kind: "checks_finished",
      stage: "verify",
      data: { repairs: 1, results: [1, 2], nested: { a: 1 }, empty: null },
    });
    expect(line).toBe("10:20:30 verify    checks_finished    repairs=1 results=[2]");
  });

  it("truncates long strings", () => {
    expect(formatData({ blocker: "x".repeat(100) })).toBe(`blocker=${"x".repeat(77)}...`);
  });
});

describe("a failed command", () => {
  it("keeps only the tail of its output", () => {
    const command = {
      stage: "verify",
      name: "test",
      command: "pnpm test",
      exitCode: 1,
      timedOut: false,
      durationMs: 1200,
      output: Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"),
    } as FactoryCommand;
    const text = renderFailedCommand(command, 5);
    expect(text.split("\n")[0]).toBe("✗ verify/test (exit 1, 1200ms): pnpm test");
    expect(text).toContain("... 45 earlier lines");
    expect(text).toContain("line 49");
    expect(text).not.toContain("line 44\n");
  });
});

const run = {
  id: "r1",
  title: "Add a --json flag",
  status: "delivered",
  profile: "feature",
  stage: "deliver",
  branch: "factory/add-json",
  blocker: null,
  createdAt: new Date("2026-11-11T10:00:00Z"),
  outcome: {
    summary: "done",
    branch: "factory/add-json",
    pullRequestUrl: "https://github.com/o/r/pull/1",
    checks: [{ name: "test", exitCode: 0, passed: true }],
    usage: { inputTokens: 10, estimatedCostUsd: null },
  },
} as unknown as FactoryRun;

describe("runs and results", () => {
  it("aligns the runs table", () => {
    const [header, row] = renderRuns([run]).split("\n");
    expect(header!.indexOf("STATUS")).toBe(row!.indexOf("delivered"));
  });

  it("shows the branch, PR, checks, usage and task path", () => {
    const text = renderResult(run, "/repo/.factory/runs/r1/task.md");
    expect(text).toContain("PR:      https://github.com/o/r/pull/1");
    expect(text).toContain("  ✓ test (exit 0)");
    expect(text).toContain("Usage:   inputTokens=10");
    expect(text).toContain("Task:    /repo/.factory/runs/r1/task.md");
  });
});
