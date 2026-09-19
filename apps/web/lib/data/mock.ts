import type { Finding, Organization, Repo } from "@pr-review/db";

import {
  addTokens,
  computeTrends,
  computeUsage,
  costOf,
  emptySeverity,
  isAgentName,
  windowStart,
  zeroTokens,
} from "./aggregate";
import {
  AGENTS,
  type AgentConfig,
  type AgentName,
  type AgentRun,
  type DataSource,
  type Range,
  type RepoSummary,
  type ReviewDetail,
  type ReviewSummary,
  type Severity,
  type TokenCounts,
  type Trends,
  type Usage,
} from "./types";

const SEED = 0x5eed_1234;
const DAYS = 90;

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

// Recorded findings use the agent's name as their category; the fixture uses finer ones.
export function agentForCategory(category: string): AgentName | null {
  return AGENT_OF_CATEGORY.get(category) ?? (isAgentName(category) ? category : null);
}

function severityFor(r: () => number, agent: AgentName): Severity {
  const roll = r();
  if (agent === "security") return roll < 0.3 ? "high" : roll < 0.7 ? "medium" : "low";
  if (agent === "docs-drift") return roll < 0.05 ? "medium" : "low";
  if (agent === "correctness") return roll < 0.18 ? "high" : roll < 0.6 ? "medium" : "low";
  return roll < 0.08 ? "high" : roll < 0.45 ? "medium" : "low";
}

type World = {
  organization: Organization;
  repos: Repo[];
  reviews: ReviewDetail[];
};

function build(now: Date, ceiling: number): World {
  const r = rng(SEED);
  const organization: Organization = {
    id: 1,
    githubAccountId: 1,
    accountType: "organization",
    slug: "acme",
    name: "Acme Engineering",
    installationId: null,
    suspendedAt: null,
    uninstalledAt: null,
    ingestToken: null,
    createdAt: new Date(now.getTime() - DAYS * 864e5),
  };

  const repos: Repo[] = REPOS.map(([owner, name], i) => ({
    id: i + 1,
    organizationId: organization.id,
    githubRepoId: null,
    owner,
    name,
    private: false,
    removedAt: null,
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
  return { organization, repos, reviews };
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

function withinRange(reviews: ReviewDetail[], range: Range, repoId?: number) {
  const cutoff = windowStart(range);
  return reviews.filter(
    (v) => v.createdAt.getTime() >= cutoff && (repoId === undefined || v.repoId === repoId),
  );
}

function strip(review: ReviewDetail): ReviewSummary {
  const { findings: _f, runs: _r, ...rest } = review;
  return rest;
}

export function createMockSource(): DataSource {
  const { organization, repos, reviews } = world();

  return {
    isDemo: true,
    organization,

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
      return computeTrends(withinRange(reviews, range, repoId), range);
    },

    async getUsage(range, repoId): Promise<Usage> {
      return computeUsage(withinRange(reviews, range, repoId), repos, range);
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


