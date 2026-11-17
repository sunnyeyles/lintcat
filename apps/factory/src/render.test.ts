import type { FactoryCommand, FactoryRun } from "#src/engine/store/schema";
import type { Spec } from "#src/engine/contract";
import { describe, expect, it } from "vitest";

import { formatData, formatEvent, renderFailedCommand, renderResult, renderRuns, renderSpec, renderSpecAudit } from "#src/render";

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

describe("rendering a spec review", () => {
  const paraphrase = { proposes: "Adds a --json flag", existingSystem: "Output is plain text" };
  const finding = (id: string, severity: "blocker" | "major" | "nit", problem: string, lens: "readiness" | "scope" = "readiness", evidence: string[] = []) => ({
    id,
    severity,
    lens,
    field: lens === "scope" ? "category" : "plan",
    problem,
    evidence,
  });

  it("puts the paraphrase and scope first, then escalations ahead of settled findings", () => {
    const scope = finding("F1", "blocker", "refactor: two call sites", "scope", ["src/a.ts:10 parses by hand"]);
    const fixed = finding("F2", "major", "which encoder?");
    const escalated = finding("F3", "blocker", "no YAML");
    const wordy = finding("F4", "nit", "wordy");
    const text = renderSpecAudit({
      review: { promptVersion: "v", paraphrase, findings: [scope, fixed, escalated, wordy] },
      resolutions: [
        { finding: fixed, action: "fix", note: "JSON.stringify" },
        { finding: escalated, action: "escalate", note: "you said YAML is out" },
      ],
    });
    expect(text).toContain("It reads this as: Adds a --json flag");
    expect(text).toContain("Scope (your call; discovery left it alone):\n  - [blocker] category: refactor: two call sites\n      · src/a.ts:10 parses by hand");
    expect(text.indexOf("Scope (your call")).toBeLessThan(text.indexOf("Needs your call"));
    expect(text.indexOf("Needs your call")).toBeLessThan(text.indexOf("Resolved by discovery"));
    expect(text).toContain("fix: [major] plan: which encoder?\n      → JSON.stringify");
    expect(text).toContain("Unanswered:\n  - [nit] plan: wordy");
  });

  it("doesn't call findings discovery never saw unanswered", () => {
    const text = renderSpecAudit({ review: { promptVersion: "v", paraphrase, findings: [finding("F1", "nit", "wordy")] }, resolutions: [] });
    expect(text).toContain("Other findings:\n  - [nit] plan: wordy");
    expect(text).not.toContain("Unanswered");
  });

  it("says when there is nothing to show", () => {
    expect(renderSpecAudit({ review: { promptVersion: "v", paraphrase, findings: [] }, resolutions: [] })).toContain("No findings.");
    expect(renderSpecAudit({ review: null, resolutions: [] })).toContain("no valid answer");
  });
});

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
