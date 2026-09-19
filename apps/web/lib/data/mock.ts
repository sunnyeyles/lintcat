import type { Finding, Repo, Team } from "@pr-review/db";

import {
  AGENTS,
  type AgentBreakdown,
  type AgentConfig,
  type AgentName,
  type AgentRun,
  type CategoryCount,
  type DataSource,
  type Range,
  type RepoSummary,
  type ReviewDetail,
  type ReviewSummary,
  type Severity,
  type TokenCounts,
  type Trends,
  type Usage,
  type UsagePoint,
} from "./types";

const SEED = 0x5eed_1234;
const DAYS = 90;

// USD per million tokens; cache reads bill at a tenth of input.
const PRICE = { input: 3, cacheWrite: 3.75, cacheRead: 0.3, output: 15 };

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length)]!;
}

function intBetween(r: () => number, lo: number, hi: number) {
  return Math.floor(lo + r() * (hi - lo + 1));
}

const REPOS: ReadonlyArray<[string, string]> = [
  ["acme", "checkout-api"],
  ["acme", "billing-worker"],
  ["acme", "web-storefront"],
  ["acme", "identity"],
  ["acme", "infra-terraform"],
  ["acme", "design-system"],
];

const PATHS = [
  "src/auth/session.ts",
  "src/auth/tokens.ts",
  "src/billing/invoice.ts",
  "src/billing/webhook-handler.ts",
  "src/api/routes/checkout.ts",
  "src/api/middleware/rate-limit.ts",
  "src/db/queries/orders.ts",
  "src/db/migrations/0042_add_index.sql",
  "src/lib/retry.ts",
  "src/lib/cache.ts",
  "src/components/CartSummary.tsx",
  "src/components/AddressForm.tsx",
  "src/workers/reconcile.ts",
  "infra/modules/rds/main.tf",
  "docs/api/checkout.md",
  "README.md",
];

const CATEGORIES: Record<AgentName, string[]> = {
  security: ["auth", "injection", "secret-leak", "cross-tenant", "privilege"],
  correctness: ["null-deref", "off-by-one", "race", "error-handling", "logic"],
  performance: ["n-plus-one", "allocation", "blocking-io", "unbounded-query"],
  "test-coverage": ["untested-branch", "missing-case", "flaky", "assertion-gap"],
  "docs-drift": ["stale-example", "undocumented-flag", "broken-link"],
};

const TITLES: Record<string, string> = {
  auth: "Session token compared with non-constant-time equality",
  injection: "User-supplied sort column interpolated into SQL",
  "secret-leak": "API key written to the request log",
  "cross-tenant": "Query misses the tenant_id predicate",
  privilege: "Role check runs after the mutation, not before",
  "null-deref": "Optional chain dropped on an already-nullable value",
  "off-by-one": "Slice upper bound excludes the final element",
  race: "Read-modify-write on a shared counter without a lock",
  "error-handling": "Rejected promise swallowed by a bare catch",
  logic: "Inverted guard lets the empty case through",
  "n-plus-one": "Query issued inside the render loop",
  allocation: "Array rebuilt on every iteration",
  "blocking-io": "Synchronous file read on the request path",
  "unbounded-query": "SELECT without a LIMIT on a growing table",
  "untested-branch": "New error branch has no covering test",
  "missing-case": "Empty-input case is untested",
  flaky: "Test depends on wall-clock ordering",
  "assertion-gap": "Test exercises the path but asserts nothing",
  "stale-example": "Example still passes the removed argument",
  "undocumented-flag": "New input is missing from the options table",
  "broken-link": "Anchor points at a renamed heading",
};

const AGENT_OF_CATEGORY = new Map<string, AgentName>(
  AGENTS.flatMap((a) => CATEGORIES[a].map((c) => [c, a] as const)),
);

// Findings carry a category, not an agent; this is how the UI gets back to one.
export function agentForCategory(category: string): AgentName | null {
  return AGENT_OF_CATEGORY.get(category) ?? null;
}

function severityFor(r: () => number, agent: AgentName): Severity {
  const roll = r();
  if (agent === "security") return roll < 0.3 ? "high" : roll < 0.7 ? "medium" : "low";
  if (agent === "docs-drift") return roll < 0.05 ? "medium" : "low";
  if (agent === "correctness") return roll < 0.18 ? "high" : roll < 0.6 ? "medium" : "low";
  return roll < 0.08 ? "high" : roll < 0.45 ? "medium" : "low";
}

function emptySeverity(): Record<Severity, number> {
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

type World = {
  team: Team;
  repos: Repo[];
  reviews: ReviewDetail[];
};

function build(now: Date, ceiling: number): World {
  const r = rng(SEED);
  const team: Team = {
    id: 1,
    slug: "acme",
    name: "Acme Engineering",
    githubOrg: "acme",
    ingestToken: null,
    createdAt: new Date(now.getTime() - DAYS * 864e5),
  };

  const repos: Repo[] = REPOS.map(([owner, name], i) => ({
    id: i + 1,
    teamId: team.id,
    owner,
    name,
    createdAt: new Date(now.getTime() - (DAYS - i) * 864e5),
  }));

  const reviews: ReviewDetail[] = [];
  let reviewId = 0;
  let findingId = 0;
  let runId = 0;

  for (let dayOffset = DAYS - 1; dayOffset >= 0; dayOffset--) {
    const date = new Date(now.getTime() - dayOffset * 864e5);
    const weekday = date.getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const perDay = weekend ? intBetween(r, 0, 2) : intBetween(r, 1, 6);

    for (let k = 0; k < perDay; k++) {
      const repo = pick(r, repos);
      const enabled = AGENTS.filter(() => r() > 0.18);
      const agents = enabled.length > 0 ? enabled : (["correctness"] as AgentName[]);
      reviewId += 1;

      // Today's slots run to 19:00, so clamp back or reviews land in the future.
      const slot = date.getTime() + intBetween(r, 8, 19) * 36e5 + intBetween(r, 0, 59) * 6e4;
      const createdAt = new Date(Math.min(slot, ceiling - k * 9e4));

      const findings: Finding[] = [];
      const runs: AgentRun[] = [];
      const totals = zeroTokens();
      let durationMs = 0;

      for (const agent of agents) {
        const count = Math.max(0, intBetween(r, -1, agent === "security" ? 3 : 4));
        for (let f = 0; f < count; f++) {
          const category = pick(r, CATEGORIES[agent]);
          const severity = severityFor(r, agent);
          findingId += 1;
          findings.push({
            id: findingId,
            reviewId,
            agent,
            file: pick(r, PATHS),
            line: r() > 0.12 ? intBetween(r, 3, 480) : null,
            category,
            severity,
            title: TITLES[category] ?? category,
            explanation:
              "The change introduces this on the modified path; the surrounding code assumes the opposite invariant.",
            suggestedFix: r() > 0.45 ? "Guard the value before use and return early." : null,
            confidence: Number((0.55 + r() * 0.44).toFixed(2)),
          });
        }

        const tokens: TokenCounts = {
          inputTokens: intBetween(r, 1800, 9000),
          cacheCreationInputTokens: r() > 0.6 ? intBetween(r, 4000, 22000) : 0,
          cacheReadInputTokens: intBetween(r, 10000, 90000),
          outputTokens: intBetween(r, 400, 3200),
        };
        addTokens(totals, tokens);
        const legMs = intBetween(r, 4000, 41000);
        durationMs = Math.max(durationMs, legMs);
        runId += 1;
        runs.push({ id: runId, reviewId, agent, durationMs: legMs, findingCount: count, ...tokens });
      }

      const bySeverity = emptySeverity();
      for (const f of findings) bySeverity[f.severity as Severity] += 1;

      reviews.push({
        id: reviewId,
        repoId: repo.id,
        prNumber: intBetween(r, 100, 1400),
        headSha: Array.from({ length: 40 }, () => "0123456789abcdef"[intBetween(r, 0, 15)]).join(""),
        agents,
        summary:
          findings.length === 0
            ? "No findings survived validation on this head."
            : `${findings.length} finding${findings.length === 1 ? "" : "s"} across ${agents.length} agent${agents.length === 1 ? "" : "s"}.`,
        durationMs,
        createdAt,
        repo,
        findings,
        runs,
        findingCount: findings.length,
        bySeverity,
        costUsd: costOf(totals),
        ...totals,
      });
    }
  }

  reviews.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return { team, repos, reviews };
}

let cached: World | null = null;

function world(): World {
  // Anchored to midnight so the fixture is stable within a day.
  if (!cached) {
    const ceiling = Date.now() - 6e4;
    const now = new Date();
    now.setUTCHours(0, 0, 0, 0);
    cached = build(now, ceiling);
  }
  return cached;
}

function rangeDays(range: Range): number {
  return range === "7d" ? 7 : range === "30d" ? 30 : 90;
}

// Buckets and the range filter must share one boundary or totals drift from the chart.
function windowStart(range: Range): number {
  const midnight = new Date();
  midnight.setUTCHours(0, 0, 0, 0);
  return midnight.getTime() - (rangeDays(range) - 1) * 864e5;
}

function withinRange(reviews: ReviewDetail[], range: Range, repoId?: number) {
  const cutoff = windowStart(range);
  return reviews.filter(
    (v) => v.createdAt.getTime() >= cutoff && (repoId === undefined || v.repoId === repoId),
  );
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

function strip(review: ReviewDetail): ReviewSummary {
  const { findings: _f, runs: _r, ...rest } = review;
  return rest;
}

function agentBreakdown(reviews: ReviewDetail[]): AgentBreakdown[] {
  return AGENTS.map((agent) => {
    const runs = reviews.flatMap((v) => v.runs.filter((run) => run.agent === agent));
    const tokens = zeroTokens();
    let findingCount = 0;
    for (const run of runs) {
      addTokens(tokens, run);
      findingCount += run.findingCount;
    }
    return {
      agent,
      findingCount,
      reviewCount: runs.length,
      medianDurationMs: median(runs.map((run) => run.durationMs)),
      costUsd: costOf(tokens),
      ...tokens,
    };
  }).filter((a) => a.reviewCount > 0);
}

function dayBuckets(range: Range): string[] {
  const start = windowStart(range);
  return Array.from({ length: rangeDays(range) }, (_, i) =>
    dayKey(new Date(start + i * 864e5)),
  );
}

export function createMockSource(): DataSource {
  const { team, repos, reviews } = world();

  return {
    isDemo: true,
    team,

    async listRepos(): Promise<RepoSummary[]> {
      return repos.map((repo) => {
        const mine = reviews.filter((v) => v.repoId === repo.id);
        const tokens = zeroTokens();
        for (const v of mine) addTokens(tokens, v);
        return {
          ...repo,
          reviewCount: mine.length,
          findingCount: mine.reduce((n, v) => n + v.findingCount, 0),
          openHighSeverity: mine.reduce((n, v) => n + v.bySeverity.high, 0),
          lastReviewedAt: mine[0]?.createdAt ?? null,
          costUsd: costOf(tokens),
        };
      });
    },

    async getRepo(owner, name) {
      const all = await this.listRepos();
      return all.find((r) => r.owner === owner && r.name === name) ?? null;
    },

    async listReviews({ repoId, limit } = {}) {
      const rows = reviews
        .filter((v) => repoId === undefined || v.repoId === repoId)
        .map(strip);
      return limit ? rows.slice(0, limit) : rows;
    },

    async getReview(id) {
      return reviews.find((v) => v.id === id) ?? null;
    },

    async getTrends(range, repoId): Promise<Trends> {
      const scoped = withinRange(reviews, range, repoId);
      const byDay = new Map(
        dayBuckets(range).map((date) => [
          date,
          { date, reviews: 0, low: 0, medium: 0, high: 0 },
        ]),
      );
      for (const v of scoped) {
        const bucket = byDay.get(dayKey(v.createdAt));
        if (!bucket) continue;
        bucket.reviews += 1;
        bucket.low += v.bySeverity.low;
        bucket.medium += v.bySeverity.medium;
        bucket.high += v.bySeverity.high;
      }

      const categories = new Map<string, CategoryCount>();
      const bySeverity = emptySeverity();
      let findings = 0;
      for (const v of scoped) {
        for (const f of v.findings) {
          findings += 1;
          bySeverity[f.severity as Severity] += 1;
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

      return {
        points: [...byDay.values()],
        byAgent: agentBreakdown(scoped),
        byCategory: [...categories.values()].sort((a, b) => b.count - a.count),
        totals: {
          reviews: scoped.length,
          findings,
          bySeverity,
          medianDurationMs: median(scoped.map((v) => v.durationMs)),
        },
      };
    },

    async getUsage(range, repoId): Promise<Usage> {
      const scoped = withinRange(reviews, range, repoId);
      const byDay = new Map<string, UsagePoint>(
        dayBuckets(range).map((date) => [
          date,
          { date, costUsd: 0, ...zeroTokens() },
        ]),
      );
      const totals = zeroTokens();
      for (const v of scoped) {
        addTokens(totals, v);
        const bucket = byDay.get(dayKey(v.createdAt));
        if (!bucket) continue;
        addTokens(bucket, v);
        bucket.costUsd += v.costUsd;
      }

      const perRepo = repos
        .map((repo) => {
          const mine = scoped.filter((v) => v.repoId === repo.id);
          const tokens = zeroTokens();
          for (const v of mine) addTokens(tokens, v);
          return { repo, reviewCount: mine.length, costUsd: costOf(tokens), ...tokens };
        })
        .sort((a, b) => b.costUsd - a.costUsd);

      return {
        points: [...byDay.values()],
        byAgent: agentBreakdown(scoped),
        byRepo: perRepo,
        totals: { ...totals, costUsd: costOf(totals), reviewCount: scoped.length },
      };
    },

    async getAgentConfig(repoId) {
      const seen = new Set<AgentName>();
      for (const v of reviews.filter((x) => x.repoId === repoId).slice(0, 12)) {
        for (const a of v.agents) seen.add(a as AgentName);
      }
      const config: AgentConfig = {
        agents: AGENTS.filter((a) => seen.has(a)),
        fix: repoId % 2 === 0,
        memoryBranch: repoId % 3 === 0 ? "pr-review-memory" : null,
        paths: { include: ["src/**"], exclude: ["**/*.snap", "dist/**"] },
      };
      return config;
    },
  };
}


