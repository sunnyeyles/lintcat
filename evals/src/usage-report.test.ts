/** The usage report's arithmetic and attribution, with no model involved. */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentUsageReport } from "@pr-review/ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  createUsageCollector,
  estimateCostUsd,
  renderUsageTable,
  sumRows,
  writeUsageReport,
  type UsageReport,
} from "#src/usage-report";

function report(overrides: Partial<AgentUsageReport> = {}): AgentUsageReport {
  return {
    agent: "general",
    durationMs: 1_000,
    steps: 3,
    usage: {
      inputTokens: 1_000,
      cacheCreationInputTokens: 10_000,
      cacheReadInputTokens: 100_000,
      outputTokens: 5_000,
    },
    ...overrides,
  };
}

describe("estimateCostUsd", () => {
  it("prices each counter at its own rate", () => {
    const cost = estimateCostUsd("claude-sonnet-5", report().usage);

    // 1k×2 + 10k×2.5 + 100k×0.2 + 5k×10 = 97,000 per million.
    expect(cost).toBeCloseTo(0.097, 6);
  });

  it("is undefined for a model the table does not price", () => {
    expect(estimateCostUsd("gpt-5.6-luna", report().usage)).toBeUndefined();
  });
});

describe("createUsageCollector", () => {
  it("attributes each report to the fixture begun last", () => {
    const collector = createUsageCollector("claude-sonnet-5");

    collector.begin("first");
    collector.onUsage(report({ steps: 2 }));
    collector.begin("second");
    collector.onUsage(report({ steps: 5 }));

    expect(collector.rows().map((row) => [row.fixture, row.steps])).toEqual([
      ["first", 2],
      ["second", 5],
    ]);
  });

  it("sums several agents' reports within one fixture", () => {
    const collector = createUsageCollector("claude-sonnet-5");

    collector.begin("one");
    collector.onUsage(report({ steps: 2, durationMs: 100 }));
    collector.onUsage(report({ steps: 3, durationMs: 200 }));

    const [row] = collector.rows();
    expect(row).toMatchObject({
      steps: 5,
      durationMs: 300,
      usage: { inputTokens: 2_000, outputTokens: 10_000 },
    });
    expect(row?.costUsd).toBeCloseTo(0.194, 6);
  });

  it("counts assertions per fixture", () => {
    const collector = createUsageCollector("claude-sonnet-5");

    collector.begin("one");
    collector.record("one", true);
    collector.record("one", false);

    expect(collector.rows()[0]).toMatchObject({ passed: 1, total: 2 });
  });

  it("ignores a report that arrives before any fixture begins", () => {
    const collector = createUsageCollector("claude-sonnet-5");

    collector.onUsage(report());

    expect(collector.rows()).toEqual([]);
  });
});

describe("the rendered table", () => {
  const rows = [
    {
      fixture: "clean-pagination",
      steps: 4,
      durationMs: 30_000,
      usage: report().usage,
      costUsd: 0.097,
      passed: 2,
      total: 2,
    },
    {
      fixture: "performance-n-plus-one",
      steps: 6,
      durationMs: 45_000,
      usage: report().usage,
      costUsd: 0.097,
      passed: 0,
      total: 1,
    },
  ];
  const usageReport: UsageReport = {
    provider: "anthropic",
    model: "claude-sonnet-5",
    indexMode: "on",
    startedAt: "2026-10-01T09:30:00.000Z",
    rows,
    totals: sumRows(rows, "claude-sonnet-5"),
  };

  it("has one line per fixture and a total", () => {
    const table = renderUsageTable(usageReport);
    const lines = table.split("\n");

    // A title, a header, the two fixtures, and the total.
    expect(lines).toHaveLength(5);
    expect(lines[2]).toMatch(/^clean-pagination\s+4\s+1\.0k\s+10\.0k\s+100\.0k\s+5\.0k\s+0\.10\s+30s\s+2\/2$/);
    expect(lines[4]).toMatch(/^TOTAL\s+10\s+2\.0k\s+20\.0k\s+200\.0k\s+10\.0k\s+0\.19\s+75s\s+2\/3$/);
  });

  it("prints ? where the model is unpriced", () => {
    const unpriced = {
      ...usageReport,
      model: "gpt-5.6-luna",
      rows: rows.map((row) => ({ ...row, costUsd: undefined })),
      totals: sumRows(rows, "gpt-5.6-luna"),
    };

    expect(renderUsageTable(unpriced).split("\n")[4]).toMatch(/\s\?\s/);
  });

  describe("written as JSON", () => {
    let dir: string;
    afterEach(() => rmSync(dir, { recursive: true, force: true }));

    it("names the file by time, provider, and model", () => {
      dir = mkdtempSync(join(tmpdir(), "usage-report-"));

      const path = writeUsageReport(dir, usageReport);

      expect(path).toBe(
        join(dir, "2026-10-01T09-30-00-000-anthropic-claude-sonnet-5.json"),
      );
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(usageReport);
    });
  });
});
