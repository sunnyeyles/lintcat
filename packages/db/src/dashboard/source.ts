import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  max,
  sql,
  type SQL,
} from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";

import type { Database } from "../client";
import { findRepositoryGraph } from "../repository-graphs";
import {
  findings,
  repos,
  reviews,
  type Finding,
  type Repo,
  type Organization,
  type Review,
} from "../schema";

import {
  computeTrends,
  computeUsage,
  costOf,
  emptySeverity,
  windowStart,
} from "./aggregate";
import type {
  CategoryCount,
  DataSource,
  RepoSummary,
  ReviewDetail,
  ReviewStat,
  ReviewSummary,
  Severity,
} from "./types";

type ReviewFilter = {
  id?: number;
  repoId?: number;
  since?: Date;
  limit?: number;
};

type CategoryRow = {
  category: string;
  severity: Severity;
  n: number;
  firstSeen: number;
};

const subqueries = new QueryBuilder();

function severityCount(severity: Severity) {
  return sql<number>`count(${findings.id}) filter (where ${findings.severity} = ${severity})`.mapWith(
    Number,
  );
}

const tokenSums = {
  inputTokens: sql<number>`coalesce(sum(${reviews.inputTokens}), 0)`.mapWith(Number),
  cacheCreationInputTokens:
    sql<number>`coalesce(sum(${reviews.cacheCreationInputTokens}), 0)`.mapWith(Number),
  cacheReadInputTokens:
    sql<number>`coalesce(sum(${reviews.cacheReadInputTokens}), 0)`.mapWith(Number),
  outputTokens: sql<number>`coalesce(sum(${reviews.outputTokens}), 0)`.mapWith(Number),
};

function toDetail(
  review: Review,
  repo: Repo,
  reviewFindings: Finding[],
  bySeverity: Record<Severity, number>,
): ReviewDetail {
  return {
    ...review,
    repo,
    findings: reviewFindings,
    findingCount: bySeverity.low + bySeverity.medium + bySeverity.high,
    bySeverity,
    costUsd: costOf(review),
  };
}

function strip(review: ReviewDetail): ReviewSummary {
  const { findings: _f, ...rest } = review;
  return rest;
}

function groupBy<T>(rows: T[], keyOf: (row: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

// `firstSeen` breaks ties exactly as the JS rollup's insertion order did.
function toCategoryCounts(rows: CategoryRow[]): CategoryCount[] {
  const seen = new Map<string, { entry: CategoryCount; firstSeen: number }>();
  for (const row of rows) {
    let hit = seen.get(row.category);
    if (!hit) {
      hit = {
        entry: { category: row.category, count: 0, bySeverity: emptySeverity() },
        firstSeen: row.firstSeen,
      };
      seen.set(row.category, hit);
    }
    hit.firstSeen = Math.min(hit.firstSeen, row.firstSeen);
    hit.entry.count += row.n;
    hit.entry.bySeverity[row.severity] += row.n;
  }
  return [...seen.values()]
    .sort((a, b) => b.entry.count - a.entry.count || a.firstSeen - b.firstSeen)
    .map((hit) => hit.entry);
}

/** Every read is scoped through the review's repo to the repos `authorize` let the viewer read. */
export function createDbSource(
  database: Database,
  organization: Organization,
  readableRepoIds: readonly number[],
): DataSource {
  // A removed repo and its reviews stay stored but are never shown.
  const liveRepos = and(
    eq(repos.organizationId, organization.id),
    isNull(repos.removedAt),
    inArray(repos.id, [...readableRepoIds]),
  )!;

  // Per-instance, so one request's source shares reads and no state outlives it.
  const reviewReads = new Map<string, Promise<ReviewDetail[]>>();
  const categoryReads = new Map<string, Promise<CategoryCount[]>>();
  const statReads = new Map<string, Promise<ReviewStat[]>>();
  let repoRead: Promise<Repo[]> | undefined;

  function scopeOf(filter: ReviewFilter): SQL[] {
    const conditions: SQL[] = [liveRepos];
    if (filter.id !== undefined) conditions.push(eq(reviews.id, filter.id));
    if (filter.repoId !== undefined) conditions.push(eq(reviews.repoId, filter.repoId));
    if (filter.since !== undefined) conditions.push(gte(reviews.createdAt, filter.since));
    return conditions;
  }

  async function fetchOrganizationRepos(): Promise<Repo[]> {
    return database
      .select()
      .from(repos)
      .where(liveRepos)
      .orderBy(asc(repos.owner), asc(repos.name));
  }

  function organizationRepos(): Promise<Repo[]> {
    repoRead ??= fetchOrganizationRepos();
    return repoRead;
  }

  // withFindings false loads severity counts only, for list pages.
  async function fetchReviews(
    filter: ReviewFilter,
    withFindings: boolean,
  ): Promise<ReviewDetail[]> {
    const base = database
      .select({ review: reviews, repo: repos })
      .from(reviews)
      .innerJoin(repos, eq(repos.id, reviews.repoId))
      .where(and(...scopeOf(filter)))
      .orderBy(desc(reviews.createdAt), desc(reviews.id));
    const rows = await (filter.limit === undefined ? base : base.limit(filter.limit));
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.review.id);
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

    const findingsFor = groupBy(findingRows, (f) => f.reviewId);
    const severityFor = new Map<number, Record<Severity, number>>();
    for (const row of severityRows) {
      let counts = severityFor.get(row.reviewId);
      if (!counts) severityFor.set(row.reviewId, (counts = emptySeverity()));
      counts[row.severity] += row.n;
    }

    return rows.map(({ review, repo }) =>
      toDetail(
        review,
        repo,
        findingsFor.get(review.id) ?? [],
        severityFor.get(review.id) ?? emptySeverity(),
      ),
    );
  }

  function filterKey(filter: ReviewFilter): string {
    return JSON.stringify([
      filter.id ?? null,
      filter.repoId ?? null,
      filter.since?.getTime() ?? null,
      filter.limit ?? null,
    ]);
  }

  function reviewKey(filter: ReviewFilter, withFindings: boolean): string {
    return `${filterKey(filter)}:${withFindings}`;
  }

  // Caches the in-flight promise so concurrent callers share one round trip.
  function loadReviews(
    filter: ReviewFilter,
    withFindings: boolean,
  ): Promise<ReviewDetail[]> {
    const key = reviewKey(filter, withFindings);
    // A withFindings read is a superset, so it also answers one without.
    const hit =
      reviewReads.get(key) ??
      (withFindings ? undefined : reviewReads.get(reviewKey(filter, true)));
    if (hit) return hit;

    const pending = fetchReviews(filter, withFindings);
    reviewReads.set(key, pending);
    pending.catch(() => reviewReads.delete(key));
    return pending;
  }

  // One round trip carrying only the columns the trend and usage rollups read.
  async function fetchReviewStats(filter: ReviewFilter): Promise<ReviewStat[]> {
    const rows = await database
      .select({
        id: reviews.id,
        repoId: reviews.repoId,
        createdAt: reviews.createdAt,
        durationMs: reviews.durationMs,
        inputTokens: reviews.inputTokens,
        cacheCreationInputTokens: reviews.cacheCreationInputTokens,
        cacheReadInputTokens: reviews.cacheReadInputTokens,
        outputTokens: reviews.outputTokens,
        low: severityCount("low"),
        medium: severityCount("medium"),
        high: severityCount("high"),
      })
      .from(reviews)
      .innerJoin(repos, eq(repos.id, reviews.repoId))
      .leftJoin(findings, eq(findings.reviewId, reviews.id))
      .where(and(...scopeOf(filter)))
      .groupBy(reviews.id);
    return rows.map(({ low, medium, high, ...stat }) => ({
      ...stat,
      bySeverity: { low, medium, high },
      costUsd: costOf(stat),
    }));
  }

  function loadReviewStats(filter: ReviewFilter): Promise<ReviewStat[]> {
    const key = filterKey(filter);
    const hit = statReads.get(key);
    if (hit) return hit;

    const pending = fetchReviewStats(filter);
    statReads.set(key, pending);
    pending.catch(() => statReads.delete(key));
    return pending;
  }

  // Counted in Postgres: the window's finding rows never cross the wire.
  async function fetchCategoryCounts(filter: ReviewFilter): Promise<CategoryCount[]> {
    const ordered = subqueries
      .select({
        category: findings.category,
        severity: findings.severity,
        seq: sql<number>`row_number() over (order by ${reviews.createdAt} desc, ${reviews.id} desc, ${findings.severity} desc, ${findings.file} asc, ${findings.id} asc)`.as(
          "seq",
        ),
      })
      .from(findings)
      .innerJoin(reviews, eq(reviews.id, findings.reviewId))
      .innerJoin(repos, eq(repos.id, reviews.repoId))
      .where(and(...scopeOf(filter)))
      .as("ordered");

    const rows = await database
      .select({
        category: ordered.category,
        severity: ordered.severity,
        n: count(),
        firstSeen: sql<number>`min(${ordered.seq})`.mapWith(Number),
      })
      .from(ordered)
      .groupBy(ordered.category, ordered.severity);
    return toCategoryCounts(rows);
  }

  function loadCategoryCounts(filter: ReviewFilter): Promise<CategoryCount[]> {
    const key = filterKey(filter);
    const hit = categoryReads.get(key);
    if (hit) return hit;

    const pending = fetchCategoryCounts(filter);
    categoryReads.set(key, pending);
    pending.catch(() => categoryReads.delete(key));
    return pending;
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
        .from(reviews)
        .innerJoin(repos, eq(repos.id, reviews.repoId))
        .where(where)
        .groupBy(reviews.repoId),
    ]);

    const reviewStatFor = new Map(reviewStats.map((row) => [row.repoId, row]));
    const findingStatFor = new Map(findingStats.map((row) => [row.repoId, row]));
    const tokenStatFor = new Map(tokenStats.map((row) => [row.repoId, row]));

    return repoRows.map((repo) => {
      const reviewStat = reviewStatFor.get(repo.id);
      const findingStat = findingStatFor.get(repo.id);
      const tokens = tokenStatFor.get(repo.id);
      return {
        ...repo,
        reviewCount: reviewStat?.reviewCount ?? 0,
        findingCount: findingStat?.findingCount ?? 0,
        highSeverity: findingStat?.high ?? 0,
        lastReviewedAt: reviewStat?.lastReviewedAt ?? null,
        costUsd: tokens ? costOf(tokens) : 0,
      };
    });
  }

  return {
    organization,

    listRepos() {
      return repoSummaries(liveRepos);
    },

    async getRepo(owner, name) {
      const [repo] = await repoSummaries(
        and(liveRepos, eq(repos.owner, owner), eq(repos.name, name))!,
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

    async getRepositoryGraph(id) {
      const [row] = await database
        .select({ repoId: reviews.repoId, baseSha: reviews.baseSha })
        .from(reviews)
        .innerJoin(repos, eq(repos.id, reviews.repoId))
        .where(and(...scopeOf({ id })))
        .limit(1);
      if (row?.baseSha == null) return undefined;
      return findRepositoryGraph(database, row.repoId, row.baseSha);
    },

    async getChangedFiles(id) {
      const [row] = await database
        .select({ changedFiles: reviews.changedFiles })
        .from(reviews)
        .innerJoin(repos, eq(repos.id, reviews.repoId))
        .where(and(...scopeOf({ id })))
        .limit(1);
      return row?.changedFiles ?? [];
    },

    async getTrends(range, repoId) {
      const since = new Date(windowStart(range));
      const filter = { since, ...(repoId === undefined ? {} : { repoId }) };
      const [scoped, byCategory] = await Promise.all([
        loadReviewStats(filter),
        loadCategoryCounts(filter),
      ]);
      return computeTrends(scoped, range, byCategory);
    },

    async getUsage(range, repoId) {
      const since = new Date(windowStart(range));
      const [scoped, repoRows] = await Promise.all([
        loadReviewStats({ since, ...(repoId === undefined ? {} : { repoId }) }),
        organizationRepos(),
      ]);
      return computeUsage(scoped, repoRows, range);
    },

  };
}
