import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { BenchResult, ProfileMetrics } from "@pr-review/factory";
import { describe, expect, it } from "vitest";

import { benchCompare } from "#src/bench";
import type { CommandContext } from "#src/commands";
import { parseArguments, UsageError } from "#src/options";
import { renderMetrics, retentionDays } from "#src/report";

describe("report and bench arguments", () => {
  it("parses report, prune and bench commands", () => {
    expect(parseArguments(["report", "--json", "--repo", "x", "--since-days", "7"])).toEqual({ kind: "report", json: true, repoPath: "x", sinceDays: 7 });
    expect(parseArguments(["prune"])).toEqual({ kind: "prune", days: undefined });
    expect(parseArguments(["bench", "run", "--config", "c.json", "--fixture", "quick,bugfix", "--keep"])).toEqual({
      kind: "bench-run",
      configPath: "c.json",
      fixtures: ["quick", "bugfix"],
      keep: true,
    });
    expect(parseArguments(["evaluate", "compare", "a.json", "b"])).toEqual({ kind: "bench-compare", a: "a.json", b: "b" });
    expect(() => parseArguments(["bench", "run"])).toThrow(UsageError);
    expect(() => parseArguments(["bench", "compare", "a"])).toThrow(UsageError);
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

describe("bench compare", () => {
  it("compares two result directories", () => {
    const root = mkdtempSync(path.join(tmpdir(), "bench-cli-"));
    const write = (dir: string, verified: boolean) => {
      mkdirSync(path.join(root, dir));
      const result = {
        schemaVersion: 1,
        config: { name: dir, hash: "f".repeat(64), model: null },
        fixture: { name: "quick", baseSha: "0".repeat(40) },
        repetition: 1,
        profile: "quick",
        factoryStatus: "delivered",
        hidden: { ran: true, passed: verified, exitCode: 0, output: "" },
        verified,
        repairs: 0,
        wallTimeMs: 1000,
        estimatedCostUsd: null,
        promptVersions: [],
        startedAt: "2026-06-01T00:00:00.000Z",
      } as unknown as BenchResult;
      writeFileSync(path.join(root, dir, "r.json"), JSON.stringify(result));
    };
    write("a", false);
    write("b", true);
    const out: string[] = [];
    const ctx = { cwd: root, env: {}, out: (t: string) => out.push(t) } as unknown as CommandContext;
    expect(benchCompare(ctx, { a: "a", b: "b" })).toBe(0);
    expect(out.join("\n")).toMatch(/quick\s+verified \(hidden checks\)\s+0\/1 0%\s+1\/1 100%\s+\+100%/);
  });
});
