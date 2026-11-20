import type { Repo, WorkflowRun } from "../schema";

import {
  type CategoryCount,
  type CiConclusionFilter,
  type CiTrends,
  type Range,
  type ReviewDetail,
  type ReviewStat,
  type Severity,
  type TokenCounts,
  type Trends,
  type Usage,
  type UsagePoint,
  type WorkflowTrend,
} from "./types";

// USD per million tokens; cache reads bill at a tenth of input.
const PRICE = { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 };

export function emptySeverity(): Record<Severity, number> {
  return { low: 0, medium: 0, high: 0 };
}

function zeroTokens(): TokenCounts {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  };
}

function addTokens(into: TokenCounts, from: TokenCounts) {
  into.inputTokens += from.inputTokens;
  into.cacheCreationInputTokens += from.cacheCreationInputTokens;
  into.cacheReadInputTokens += from.cacheReadInputTokens;
  into.outputTokens += from.outputTokens;
}

export function costOf(t: TokenCounts): number {
  return (
    (t.inputTokens * PRICE.input +
      t.cacheCreationInputTokens * PRICE.cacheWrite +
      t.cacheReadInputTokens * PRICE.cacheRead +
      t.outputTokens * PRICE.output) /
    1_000_000
  );
}

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function rangeDays(range: Range): number {
  return range === "7d" ? 7 : range === "30d" ? 30 : 90;
}

// Buckets and the range filter must share one boundary or totals drift from the chart.
export function windowStart(range: Range): number {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return midnight.getTime() - (rangeDays(range) - 1) * 864e5;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

function dayBuckets(range: Range): string[] {
  const start = windowStart(range);
  return Array.from({ length: rangeDays(range) }, (_, i) =>
    dayKey(new Date(start + i * 864e5)),
  );
}

/** The JS rollup the SQL one in `source.ts` must agree with; needs loaded findings. */
export function categoryCounts(scoped: ReviewDetail[]): CategoryCount[] {
  const categories = new Map<string, CategoryCount>();
  for (const v of scoped) {
    for (const f of v.findings) {
      const entry = categories.get(f.category) ?? {
        category: f.category,
        count: 0,
        bySeverity: emptySeverity(),
      };
      entry.count += 1;
      entry.bySeverity[f.severity as Severity] += 1;
      categories.set(f.category, entry);
    }
  }
  return [...categories.values()].sort((a, b) => b.count - a.count);
}

/** Reviews must already be scoped to the range and repo; findings need not be loaded. */
export function computeTrends(
  scoped: ReviewStat[],
  range: Range,
  byCategory: CategoryCount[],
): Trends {
  const byDay = new Map(
    dayBuckets(range).map((date) => [
      date,
      { date, reviews: 0, low: 0, medium: 0, high: 0 },
    ]),
  );
  const bySeverity = emptySeverity();
  const durations: number[] = [];
  let costUsd = 0;
  for (const v of scoped) {
    durations.push(v.durationMs);
    costUsd += v.costUsd;
    bySeverity.low += v.bySeverity.low;
    bySeverity.medium += v.bySeverity.medium;
    bySeverity.high += v.bySeverity.high;
    const bucket = byDay.get(dayKey(v.createdAt));
    if (!bucket) continue;
    bucket.reviews += 1;
    bucket.low += v.bySeverity.low;
    bucket.medium += v.bySeverity.medium;
    bucket.high += v.bySeverity.high;
  }

  return {
    points: [...byDay.values()],
    byCategory,
    totals: {
      reviews: scoped.length,
      findings: bySeverity.low + bySeverity.medium + bySeverity.high,
      bySeverity,
      medianDurationMs: median(durations),
      costUsd,
    },
  };
}

/** Reviews must already be scoped to the range and repo. */
export function computeUsage(
  scoped: ReviewStat[],
  repos: Repo[],
  range: Range,
): Usage {
  const byDay = new Map<string, UsagePoint>(
    dayBuckets(range).map((date) => [date, { date, costUsd: 0, ...zeroTokens() }]),
  );
  const totals = zeroTokens();
  const byRepo = new Map<number, { reviewCount: number; tokens: TokenCounts }>();
  for (const v of scoped) {
    addTokens(totals, v);
    let entry = byRepo.get(v.repoId);
    if (!entry) {
      entry = { reviewCount: 0, tokens: zeroTokens() };
      byRepo.set(v.repoId, entry);
    }
    entry.reviewCount += 1;
    addTokens(entry.tokens, v);
    const bucket = byDay.get(dayKey(v.createdAt));
    if (!bucket) continue;
    addTokens(bucket, v);
    bucket.costUsd += v.costUsd;
  }

  const perRepo = repos
    .map((repo) => {
      const { reviewCount, tokens } = byRepo.get(repo.id) ?? {
        reviewCount: 0,
        tokens: zeroTokens(),
      };
      return { repo, reviewCount, costUsd: costOf(tokens), ...tokens };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    points: [...byDay.values()],
    byRepo: perRepo,
    totals: { ...totals, costUsd: costOf(totals), reviewCount: scoped.length },
  };
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

export const CONCLUSIONS_FOR: Record<CiConclusionFilter, readonly string[]> = {
  success: ["success"],
  failure: [...FAILED],
  cancelled: ["cancelled"],
};

export type CiRunStat = Pick<
  WorkflowRun,
  | "workflowId"
  | "workflowName"
  | "status"
  | "conclusion"
  | "runStartedAt"
  | "githubUpdatedAt"
>;

export function runDurationMs(run: Pick<CiRunStat, "status" | "runStartedAt" | "githubUpdatedAt">): number | null {
  if (run.status !== "completed") return null;
  return Math.max(0, run.githubUpdatedAt.getTime() - run.runStartedAt.getTime());
}

// Only a pass or a fail counts; cancelled, skipped, neutral and action_required stay out.
function hasVerdict(run: CiRunStat): boolean {
  return run.status === "completed" && (run.conclusion === "success" || isFailedRun(run));
}

function isFailedRun(run: Pick<CiRunStat, "conclusion">): boolean {
  return run.conclusion !== null && FAILED.has(run.conclusion);
}

// Nearest rank, so every value reported is a duration some run really took.
export function percentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}

type WorkflowAccumulator = {
  latest: CiRunStat;
  runs: number;
  failures: number;
  decided: number;
  durations: number[];
};

/** Runs must already be scoped to the repo and window; every attempt counts as a run. */
export function computeCiTrends(runs: CiRunStat[]): CiTrends {
  const byWorkflow = new Map<number, WorkflowAccumulator>();
  let failures = 0;
  let decided = 0;
  const durations: number[] = [];
  for (const run of runs) {
    let entry = byWorkflow.get(run.workflowId);
    if (!entry) {
      entry = { latest: run, runs: 0, failures: 0, decided: 0, durations: [] };
      byWorkflow.set(run.workflowId, entry);
    }
    if (run.runStartedAt > entry.latest.runStartedAt) entry.latest = run;
    entry.runs += 1;
    if (!hasVerdict(run)) continue;
    const failed = isFailedRun(run);
    const duration = runDurationMs(run)!;
    entry.decided += 1;
    entry.durations.push(duration);
    durations.push(duration);
    decided += 1;
    if (failed) {
      entry.failures += 1;
      failures += 1;
    }
  }

  const workflows: WorkflowTrend[] = [...byWorkflow.values()]
    .map((entry) => ({
      workflowId: entry.latest.workflowId,
      workflowName: entry.latest.workflowName,
      runs: entry.runs,
      failures: entry.failures,
      failureRate: entry.decided === 0 ? null : entry.failures / entry.decided,
      p50DurationMs: percentile(entry.durations, 50),
      p95DurationMs: percentile(entry.durations, 95),
      lastStatus: entry.latest.status,
      lastConclusion: entry.latest.conclusion,
      lastRunAt: entry.latest.runStartedAt,
    }))
    .sort((a, b) => b.runs - a.runs || a.workflowName.localeCompare(b.workflowName));

  let slowest: CiTrends["totals"]["slowestWorkflow"] = null;
  for (const w of workflows) {
    if (w.p50DurationMs !== null && (slowest === null || w.p50DurationMs > slowest.p50DurationMs)) {
      slowest = { workflowId: w.workflowId, workflowName: w.workflowName, p50DurationMs: w.p50DurationMs };
    }
  }

  return {
    workflows,
    totals: {
      runs: runs.length,
      failures,
      failureRate: decided === 0 ? null : failures / decided,
      medianDurationMs: durations.length === 0 ? null : median(durations),
      slowestWorkflow: slowest,
    },
  };
}
