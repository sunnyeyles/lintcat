import {
  addTokenUsage,
  costOf as modelCostOf,
  emptySeverityCounts,
  emptyTokenUsage,
  SEVERITIES,
  type TokenUsage,
} from "@pr-review/schemas";

import type { Repo } from "../schema";

import {
  type CategoryCount,
  type Range,
  type ReviewDetail,
  type Severity,
  type Trends,
  type Usage,
  type UsagePoint,
} from "./types";

export const emptySeverity: () => Record<Severity, number> = emptySeverityCounts;

function addTokens(into: TokenUsage, from: TokenUsage) {
  Object.assign(into, addTokenUsage(into, from));
}

// Reviews do not record their model, so every one is costed at the fallback rate.
export function costOf(t: TokenUsage): number {
  return modelCostOf(undefined, t);
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
  scoped: ReviewDetail[],
  range: Range,
  byCategory: CategoryCount[],
): Trends {
  const byDay = new Map(
    dayBuckets(range).map((date) => [
      date,
      { date, reviews: 0, ...emptySeverity() },
    ]),
  );
  const bySeverity = emptySeverity();
  const durations: number[] = [];
  for (const v of scoped) {
    durations.push(v.durationMs);
    const bucket = byDay.get(dayKey(v.createdAt));
    if (bucket) bucket.reviews += 1;
    for (const severity of SEVERITIES) {
      bySeverity[severity] += v.bySeverity[severity];
      if (bucket) bucket[severity] += v.bySeverity[severity];
    }
  }

  return {
    points: [...byDay.values()],
    byCategory,
    totals: {
      reviews: scoped.length,
      findings: SEVERITIES.reduce((sum, severity) => sum + bySeverity[severity], 0),
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
    dayBuckets(range).map((date) => [date, { date, costUsd: 0, ...emptyTokenUsage() }]),
  );
  const totals = emptyTokenUsage();
  const byRepo = new Map<number, { reviewCount: number; tokens: TokenUsage }>();
  for (const v of scoped) {
    addTokens(totals, v);
    let entry = byRepo.get(v.repoId);
    if (!entry) {
      entry = { reviewCount: 0, tokens: emptyTokenUsage() };
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
        tokens: emptyTokenUsage(),
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
