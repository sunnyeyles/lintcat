import {
  agentRuns,
  findings,
  repos,
  reviews,
  type AgentRun as AgentRunRow,
  type Database,
  type Finding,
  type Repo,
  type Organization,
  type Review,
} from "@pr-review/db";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  max,
  sql,
  type SQL,
} from "drizzle-orm";

import { DEFAULT_CONFIG } from "@/lib/agent-config";

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
import type {
  AgentRun,
  DataSource,
  RepoSummary,
  ReviewDetail,
  ReviewSummary,
  Severity,
} from "./types";

type ReviewFilter = {
  id?: number;
  repoId?: number;
  since?: Date;
  limit?: number;
};

const tokenSums = {
  inputTokens: sql<number>`coalesce(sum(${agentRuns.inputTokens}), 0)`.mapWith(Number),
  cacheCreationInputTokens:
    sql<number>`coalesce(sum(${agentRuns.cacheCreationInputTokens}), 0)`.mapWith(Number),
  cacheReadInputTokens:
    sql<number>`coalesce(sum(${agentRuns.cacheReadInputTokens}), 0)`.mapWith(Number),
  outputTokens: sql<number>`coalesce(sum(${agentRuns.outputTokens}), 0)`.mapWith(Number),
};

function knownRuns(rows: AgentRunRow[]): AgentRun[] {
  return rows.filter((run): run is AgentRun => isAgentName(run.agent));
}

function toDetail(
  review: Review,
  repo: Repo,
  reviewFindings: Finding[],
  runs: AgentRunRow[],
  bySeverity: Record<Severity, number>,
): ReviewDetail {
  const totals = zeroTokens();
  for (const run of runs) addTokens(totals, run);
  return {
    ...review,
    agents: review.agents.filter(isAgentName),
    repo,
    findings: reviewFindings,
    runs: knownRuns(runs),
    findingCount: bySeverity.low + bySeverity.medium + bySeverity.high,
    bySeverity,
    costUsd: costOf(totals),
    ...totals,
  };
}

function strip(review: ReviewDetail): ReviewSummary {
  const { findings: _f, runs: _r, ...rest } = review;
  return rest;
}

/** Every read is scoped to the organization through the review's repo. */
export function createDbSource(
  database: Database,
  organization: Organization,
): DataSource {
  async function organizationRepos(): Promise<Repo[]> {
    return database
      .select()
      .from(repos)
      .where(eq(repos.organizationId, organization.id))
      .orderBy(asc(repos.owner), asc(repos.name));
  }

  // withFindings false loads severity counts only, for list pages.
  async function loadReviews(
    filter: ReviewFilter,
    withFindings: boolean,
  ): Promise<ReviewDetail[]> {
    const conditions: SQL[] = [eq(repos.organizationId, organization.id)];
    if (filter.id !== undefined) conditions.push(eq(reviews.id, filter.id));
    if (filter.repoId !== undefined) conditions.push(eq(reviews.repoId, filter.repoId));
    if (filter.since !== undefined) conditions.push(gte(reviews.createdAt, filter.since));

    const base = database
      .select({ review: reviews, repo: repos })
      .from(reviews)
      .innerJoin(repos, eq(repos.id, reviews.repoId))
      .where(and(...conditions))
      .orderBy(desc(reviews.createdAt), desc(reviews.id));
    const rows = await (filter.limit === undefined ? base : base.limit(filter.limit));
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.review.id);
    const runRows = await database
      .select()
      .from(agentRuns)
      .where(inArray(agentRuns.reviewId, ids))
      .orderBy(asc(agentRuns.agent));
    const findingRows = withFindings
      ? await database
          .select()
          .from(findings)
          .where(inArray(findings.reviewId, ids))
          .orderBy(desc(findings.severity), asc(findings.file), asc(findings.id))
      : [];
    const severityRows = withFindings
      ? findingRows.map((f) => ({ reviewId: f.reviewId, severity: f.severity, n: 1 }))
      : await database
          .select({
            reviewId: findings.reviewId,
            severity: findings.severity,
            n: count(),
          })
          .from(findings)
          .where(inArray(findings.reviewId, ids))
          .groupBy(findings.reviewId, findings.severity);

    return rows.map(({ review, repo }) => {
      const bySeverity = emptySeverity();
      for (const row of severityRows) {
        if (row.reviewId === review.id) bySeverity[row.severity] += row.n;
      }
      return toDetail(
        review,
        repo,
        findingRows.filter((f) => f.reviewId === review.id),
        runRows.filter((run) => run.reviewId === review.id),
        bySeverity,
      );
    });
  }

  async function repoSummaries(where: SQL): Promise<RepoSummary[]> {
    const [repoRows, reviewStats, findingStats, tokenStats] = await Promise.all([
      database.select().from(repos).where(where),
      database
        .select({
          repoId: reviews.repoId,
          reviewCount: count(),
          lastReviewedAt: max(reviews.createdAt),
        })
        .from(reviews)
        .innerJoin(repos, eq(repos.id, reviews.repoId))
        .where(where)
        .groupBy(reviews.repoId),
      database
        .select({
          repoId: reviews.repoId,
          findingCount: count(),
          high: sql<number>`count(*) filter (where ${findings.severity} = 'high')`.mapWith(
            Number,
          ),
        })
        .from(findings)
        .innerJoin(reviews, eq(reviews.id, findings.reviewId))
        .innerJoin(repos, eq(repos.id, reviews.repoId))
        .where(where)
        .groupBy(reviews.repoId),
      database
        .select({ repoId: reviews.repoId, ...tokenSums })
        .from(agentRuns)
        .innerJoin(reviews, eq(reviews.id, agentRuns.reviewId))
        .innerJoin(repos, eq(repos.id, reviews.repoId))
        .where(where)
        .groupBy(reviews.repoId),
    ]);

    return repoRows.map((repo) => {
      const reviewStat = reviewStats.find((row) => row.repoId === repo.id);
      const findingStat = findingStats.find((row) => row.repoId === repo.id);
      const tokens = tokenStats.find((row) => row.repoId === repo.id);
      return {
        ...repo,
        reviewCount: reviewStat?.reviewCount ?? 0,
        findingCount: findingStat?.findingCount ?? 0,
        openHighSeverity: findingStat?.high ?? 0,
        lastReviewedAt: reviewStat?.lastReviewedAt ?? null,
        costUsd: tokens ? costOf(tokens) : 0,
      };
    });
  }

  return {
    isDemo: false,
    organization,

    listRepos() {
      return repoSummaries(eq(repos.organizationId, organization.id));
    },

    async getRepo(owner, name) {
      const [repo] = await repoSummaries(
        and(eq(repos.organizationId, organization.id), eq(repos.owner, owner), eq(repos.name, name))!,
      );
      return repo ?? null;
    },

    async listReviews({ repoId, limit } = {}) {
      const rows = await loadReviews(
        {
          ...(repoId === undefined ? {} : { repoId }),
          ...(limit === undefined ? {} : { limit }),
        },
        false,
      );
      return rows.map(strip);
    },

    async getReview(id) {
      const [review] = await loadReviews({ id }, true);
      return review ?? null;
    },

    async getTrends(range, repoId) {
      const since = new Date(windowStart(range));
      const scoped = await loadReviews(
        { since, ...(repoId === undefined ? {} : { repoId }) },
        true,
      );
      return computeTrends(scoped, range);
    },

    async getUsage(range, repoId) {
      const since = new Date(windowStart(range));
      const [scoped, repoRows] = await Promise.all([
        loadReviews({ since, ...(repoId === undefined ? {} : { repoId }) }, false),
        organizationRepos(),
      ]);
      return computeUsage(scoped, repoRows, range);
    },

    // No agent configuration is stored yet; the settings page stays on the fixture.
    async getAgentConfig() {
      return DEFAULT_CONFIG;
    },
  };
}
