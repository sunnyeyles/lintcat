import type { ProfileMetrics } from "#src/engine/metrics";
import { describe, expect, it } from "vitest";

import { parseArguments, UsageError } from "#src/options";
import { renderMetrics, retentionDays } from "#src/report";

describe("report arguments", () => {
  it("parses report and prune", () => {
    expect(parseArguments(["report", "--json", "--repo", "x", "--since-days", "7"])).toEqual({ kind: "report", json: true, repoPath: "x", sinceDays: 7 });
    expect(parseArguments(["prune"])).toEqual({ kind: "prune", days: undefined });
    expect(() => parseArguments(["prune", "--days", "0"])).toThrow(UsageError);
  });

  it("reads the retention window from the environment", () => {
    expect(retentionDays({}, undefined)).toBe(90);
    expect(retentionDays({ FACTORY_RETENTION_DAYS: "14" }, undefined)).toBe(14);
    expect(retentionDays({ FACTORY_RETENTION_DAYS: "14" }, 3)).toBe(3);
    expect(() => retentionDays({ FACTORY_RETENTION_DAYS: "soon" }, undefined)).toThrow(/whole number/);
  });
});

describe("report rendering", () => {
  const metrics: ProfileMetrics = {
    profile: "quick",
    runs: 4,
    delivered: 2,
    failed: 1,
    cancelled: 1,
    verifiedDeliveryRate: 0.5,
    firstPassSuccessRate: 0.25,
    wallTimeMs: { median: 20_000, p95: 400_000 },
    commands: 5,
    commandFailureRate: 0.6,
    repeatedFailureRate: 0.5,
    repairSuccessRate: 0.5,
    testRegressionRate: null,
    escalationRate: 0,
    agentRunsPerRun: 1.25,
    cost: { estimatedUsd: 0.4, perVerifiedSuccessUsd: 0.2, runsWithoutCost: 1 },
    otherEventKinds: { new_kind: 2 },
  };

  it("labels subscription cost as notional and marks unknowns", () => {
    const text = renderMetrics([metrics], "subscription");
    expect(text).toMatch(/quick\s+4\s+50%\s+25%\s+20\.0s\s+6\.7m\s+60%\s+50%\s+50%\s+-\s+0%\s+\$0\.20 \(1 unknown\)/);
    expect(text).toContain("notional");
    expect(text).toContain("quick:new_kind×2");
    expect(renderMetrics([metrics], "api-key")).not.toContain("notional");
  });
});
