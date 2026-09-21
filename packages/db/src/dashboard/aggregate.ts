import type { Repo } from "../schema";

import {
  AGENTS,
  type AgentBreakdown,
  type AgentName,
  type CategoryCount,
  type Range,
  type ReviewDetail,
  type Severity,
  type TokenCounts,
  type Trends,
  type Usage,
  type UsagePoint,
} from "./types";

// USD per million tokens; cache reads bill at a tenth of input.
const PRICE = { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 };

const KNOWN_AGENTS = new Set<string>(AGENTS);

export function isAgentName(name: string): name is AgentName {
  return KNOWN_AGENTS.has(name);
}

export function emptySeverity(): Record<Severity, number> {
  return { low: 0, medium: 0, high: 0 };
}

export function zeroTokens(): TokenCounts {
  return {
    inputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    outputTokens: 0,
  };
}

export function addTokens(into: TokenCounts, from: TokenCounts) {
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

function agentBreakdown(reviews: ReviewDetail[]): AgentBreakdown[] {
  const byAgent = new Map<
    AgentName,
    { findingCount: number; durations: number[]; tokens: TokenCounts }
  >();
  for (const v of reviews) {
    for (const run of v.runs) {
      let entry = byAgent.get(run.agent);
      if (!entry) {
        entry = { findingCount: 0, durations: [], tokens: zeroTokens() };
        byAgent.set(run.agent, entry);
      }
      entry.findingCount += run.findingCount;
      entry.durations.push(run.durationMs);
      addTokens(entry.tokens, run);
    }
  }

  return AGENTS.flatMap((agent) => {
    const entry = byAgent.get(agent);
    if (!entry) return [];
    return {
      agent,
      findingCount: entry.findingCount,
      reviewCount: entry.durations.length,
      medianDurationMs: median(entry.durations),
      costUsd: costOf(entry.tokens),
      ...entry.tokens,
    };
  });
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
  scoped: ReviewDetail[],
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
  for (const v of scoped) {
    durations.push(v.durationMs);
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
    byAgent: agentBreakdown(scoped),
    byCategory,
    totals: {
      reviews: scoped.length,
      findings: bySeverity.low + bySeverity.medium + bySeverity.high,
      bySeverity,
      medianDurationMs: median(durations),
    },
  };
}

/** Reviews must already be scoped to the range and repo. */
export function computeUsage(
  scoped: ReviewDetail[],
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
    byAgent: agentBreakdown(scoped),
    byRepo: perRepo,
    totals: { ...totals, costUsd: costOf(totals), reviewCount: scoped.length },
  };
}
