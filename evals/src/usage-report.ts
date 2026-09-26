/**
 * Per-fixture token spend for an eval run: the before/after evidence for
 * any change meant to make reviews cheaper.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentUsageReport } from "@pr-review/ai";
import {
  addTokenUsage,
  costOf,
  emptyTokenUsage,
  modelPrice,
  type TokenUsage,
} from "@pr-review/schemas";

/** What one fixture's review spent, and how its assertions went. */
export interface FixtureUsageRow {
  fixture: string;
  steps: number;
  salvaged: number;
  durationMs: number;
  usage: TokenUsage;
  costUsd: number | undefined;
  passed: number;
  total: number;
}

export interface UsageReport {
  provider: string;
  model: string;
  indexMode: "on" | "off";
  startedAt: string;
  rows: FixtureUsageRow[];
  totals: Omit<FixtureUsageRow, "fixture">;
}

/** Undefined for an unpriced model: a report must not pass a guess off as its cost. */
export function estimateCostUsd(
  model: string,
  usage: TokenUsage,
): number | undefined {
  return modelPrice(model) === undefined ? undefined : costOf(model, usage);
}

export function createUsageCollector(model: string) {
  const rows = new Map<string, FixtureUsageRow>();
  let current: FixtureUsageRow | undefined;

  const row = (fixture: string): FixtureUsageRow => {
    let existing = rows.get(fixture);
    if (existing === undefined) {
      existing = {
        fixture,
        steps: 0,
        salvaged: 0,
        durationMs: 0,
        usage: emptyTokenUsage(),
        costUsd: undefined,
        passed: 0,
        total: 0,
      };
      rows.set(fixture, existing);
    }
    return existing;
  };

  return {
    begin(fixture: string): void {
      current = row(fixture);
    },
    onUsage(report: AgentUsageReport): void {
      if (current === undefined) {
        return;
      }
      current.steps += report.steps;
      current.salvaged += report.salvaged ? 1 : 0;
      current.durationMs += report.durationMs;
      current.usage = addTokenUsage(current.usage, report.usage);
      current.costUsd = estimateCostUsd(model, current.usage);
    },
    record(fixture: string, passed: boolean): void {
      const target = row(fixture);
      target.total += 1;
      if (passed) {
        target.passed += 1;
      }
    },
    rows(): FixtureUsageRow[] {
      return [...rows.values()];
    },
  };
}

export function sumRows(
  rows: readonly FixtureUsageRow[],
  model: string,
): UsageReport["totals"] {
  const usage = rows.reduce(
    (total, entry) => addTokenUsage(total, entry.usage),
    emptyTokenUsage(),
  );
  return {
    steps: rows.reduce((sum, entry) => sum + entry.steps, 0),
    salvaged: rows.reduce((sum, entry) => sum + entry.salvaged, 0),
    durationMs: rows.reduce((sum, entry) => sum + entry.durationMs, 0),
    usage,
    costUsd: estimateCostUsd(model, usage),
    passed: rows.reduce((sum, entry) => sum + entry.passed, 0),
    total: rows.reduce((sum, entry) => sum + entry.total, 0),
  };
}

function thousands(count: number): string {
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

function line(
  label: string,
  entry: UsageReport["totals"],
): string {
  const cells = [
    label.padEnd(32),
    String(entry.steps).padStart(5),
    thousands(entry.usage.inputTokens).padStart(8),
    thousands(entry.usage.cacheCreationInputTokens).padStart(8),
    thousands(entry.usage.cacheReadInputTokens).padStart(9),
    thousands(entry.usage.outputTokens).padStart(7),
    (entry.costUsd === undefined ? "?" : entry.costUsd.toFixed(2)).padStart(6),
    `${(entry.durationMs / 1000).toFixed(0)}s`.padStart(6),
    `${entry.passed}/${entry.total}`.padStart(7),
  ];
  return cells.join(" ");
}

/** One row per fixture and a total, as fixed-width text. */
export function renderUsageTable(report: UsageReport): string {
  const header = [
    "fixture".padEnd(32),
    "steps".padStart(5),
    "input".padStart(8),
    "cache-w".padStart(8),
    "cache-r".padStart(9),
    "output".padStart(7),
    "est$".padStart(6),
    "time".padStart(6),
    "passed".padStart(7),
  ].join(" ");
  return [
    `Token spend — ${report.provider} ${report.model}, index ${report.indexMode}`,
    header,
    ...report.rows.map((entry) => line(entry.fixture, entry)),
    line("TOTAL", report.totals),
  ].join("\n");
}

/** Writes the report as JSON under `dir`, named by time, provider, and model. */
export function writeUsageReport(dir: string, report: UsageReport): string {
  mkdirSync(dir, { recursive: true });
  const stamp = report.startedAt.replace(/[:.]/g, "-").replace(/Z$/, "");
  const path = join(dir, `${stamp}-${report.provider}-${report.model}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}
