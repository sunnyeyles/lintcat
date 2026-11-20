import { describe, expect, it } from "vitest";

import { computeCiTrends, percentile, runDurationMs, type CiRunStat } from "./aggregate";

const T0 = new Date("2026-11-10T12:00:00Z");

function run(
  minutes: number,
  overrides: Partial<CiRunStat> & { startOffsetMin?: number } = {},
): CiRunStat {
  const { startOffsetMin = 0, ...rest } = overrides;
  const runStartedAt = new Date(T0.getTime() + startOffsetMin * 60_000);
  return {
    workflowId: 1,
    workflowName: "CI",
    status: "completed",
    conclusion: "success",
    runStartedAt,
    githubUpdatedAt: new Date(runStartedAt.getTime() + minutes * 60_000),
    ...rest,
  };
}

describe("runDurationMs", () => {
  it("is the span from start to GitHub's last update, for a completed run only", () => {
    expect(runDurationMs(run(3))).toBe(180_000);
    expect(runDurationMs(run(3, { status: "in_progress", conclusion: null }))).toBeNull();
  });
});

describe("percentile", () => {
  it("takes the nearest rank", () => {
    const xs = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBeNull();
  });
});

describe("computeCiTrends", () => {
  it("rates failures and timeouts over runs with a verdict, leaving cancelled and skipped out", () => {
    const trends = computeCiTrends([
      run(2),
      run(4, { conclusion: "failure" }),
      run(10, { conclusion: "timed_out" }),
      run(1, { conclusion: "cancelled" }),
      run(0, { conclusion: "skipped" }),
      run(0, { status: "in_progress", conclusion: null, startOffsetMin: 60 }),
    ]);

    expect(trends.totals).toMatchObject({ runs: 6, failures: 2, failureRate: 2 / 3 });
    expect(trends.workflows).toEqual([
      {
        workflowId: 1,
        workflowName: "CI",
        runs: 6,
        failures: 2,
        failureRate: 2 / 3,
        p50DurationMs: 240_000,
        p95DurationMs: 600_000,
        lastStatus: "in_progress",
        lastConclusion: null,
        lastRunAt: new Date(T0.getTime() + 60 * 60_000),
      },
    ]);
  });

  it("names each workflow by its latest run, busiest first, and finds the slowest by median", () => {
    const trends = computeCiTrends([
      run(2, { workflowName: "Old name" }),
      run(4, { startOffsetMin: 5 }),
      run(6, { startOffsetMin: 10, conclusion: "failure" }),
      run(20, { workflowId: 2, workflowName: "Deploy" }),
    ]);

    expect(trends.workflows.map((w) => [w.workflowName, w.runs, w.lastConclusion])).toEqual([
      ["CI", 3, "failure"],
      ["Deploy", 1, "success"],
    ]);
    expect(trends.totals.slowestWorkflow).toEqual({
      workflowId: 2,
      workflowName: "Deploy",
      p50DurationMs: 1_200_000,
    });
    expect(trends.totals.medianDurationMs).toBe(300_000);
  });

  it("counts startup failures as failures and leaves neutral and action_required out", () => {
    const trends = computeCiTrends([
      run(2),
      run(0, { conclusion: "startup_failure" }),
      run(0, { conclusion: "action_required" }),
      run(0, { conclusion: "neutral" }),
    ]);

    expect(trends.totals).toMatchObject({ runs: 4, failures: 1, failureRate: 1 / 2 });
    expect(computeCiTrends([run(0, { conclusion: "action_required" })]).totals).toMatchObject({
      failureRate: null,
      medianDurationMs: null,
    });
  });

  it("has no rate or durations without a verdict", () => {
    const trends = computeCiTrends([run(0, { status: "queued", conclusion: null })]);

    expect(trends.workflows[0]).toMatchObject({
      failureRate: null,
      p50DurationMs: null,
      p95DurationMs: null,
    });
    expect(trends.totals).toMatchObject({
      runs: 1,
      failureRate: null,
      medianDurationMs: null,
      slowestWorkflow: null,
    });
    expect(computeCiTrends([]).workflows).toEqual([]);
  });
});
