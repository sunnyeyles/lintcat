import {
  buildRepositoryIndex,
  encodeRepositoryGraph,
  snapshotRepositoryIndex,
} from "@pr-review/index";
import type {
  ReviewRecord,
  ReviewRecordAgentRun,
  ReviewRecordChangedFile,
} from "@pr-review/schemas";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { authorize } from "../authorize";
import type { Database } from "../client";
import { ingestReviewRecord } from "../ingest";
import {
  memberships,
  organizations,
  repoAccess,
  repos,
  reviews,
  users,
  type Organization,
} from "../schema";
import { createTestDatabase } from "../test-database";
import { categoryCounts, computeTrends, costOf } from "./aggregate";
import { createDbSource } from "./source";

function run(
  agent: string,
  findingCount: number,
  durationMs = 10_000,
): ReviewRecordAgentRun {
  return {
    agent,
    durationMs,
    findingCount,
    inputTokens: 1_000,
    cacheCreationInputTokens: 2_000,
    cacheReadInputTokens: 3_000,
    outputTokens: 400,
  };
}

function record(overrides: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    owner: "acme",
    repo: "widgets",
    prNumber: 7,
    headSha: "a".repeat(40),
    agents: ["security", "performance"],
    summary: "Two findings.",
    durationMs: 12_000,
    agentRuns: [run("security", 1), run("performance", 1)],
    findings: [
      {
        agent: "security",
        file: "src/auth.ts",
        line: 3,
        category: "security",
        severity: "high",
        title: "Token compared with ==",
        explanation: "Timing leak.",
        confidence: 0.9,
      },
      {
        agent: "performance",
        file: "src/list.ts",
        category: "performance",
        severity: "low",
        title: "Quadratic scan",
        explanation: "Inner loop rescans.",
        confidence: 0.5,
      },
    ],
    ...overrides,
  };
}

let database: Database;
let acme: Organization;
let globex: Organization;

async function insertOrganization(
  githubAccountId: number,
  slug: string,
): Promise<Organization> {
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId, accountType: "organization", slug, name: slug })
    .returning();
  return organization!;
}

async function ingest(
  organization: Organization,
  value: ReviewRecord,
): Promise<number> {
  const result = await ingestReviewRecord(database, organization.id, value);
  if (!result.ok) throw new Error(result.reason);
  return result.reviewId;
}

// Every repo of the organization readable, as for an organization owner.
async function sourceFor(organization: Organization) {
  const rows = await database
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.organizationId, organization.id));
  return createDbSource(
    database,
    organization,
    rows.map((row) => row.id),
  );
}

beforeEach(async () => {
  database = await createTestDatabase();
  acme = await insertOrganization(10, "acme");
  globex = await insertOrganization(20, "globex");
});

describe("createDbSource", () => {
  it("lists only the organization's repos, with totals from reviews, findings and runs", async () => {
    await ingest(acme, record());
    await ingest(acme, record({ headSha: "b".repeat(40), findings: [], agentRuns: [run("security", 0)] }));
    await ingest(globex, record({ owner: "globex", repo: "secret" }));

    const repos = await (await sourceFor(acme)).listRepos();

    expect(repos).toHaveLength(1);
    const perRun = costOf(run("security", 0));
    expect(repos[0]).toMatchObject({
      owner: "acme",
      name: "widgets",
      reviewCount: 2,
      findingCount: 2,
      highSeverity: 1,
    });
    expect(repos[0]!.lastReviewedAt).toBeInstanceOf(Date);
    expect(repos[0]!.costUsd).toBeCloseTo(perRun * 3, 10);
  });

  it("finds a repo by owner and name only within the organization", async () => {
    await ingest(globex, record({ owner: "globex", repo: "secret" }));

    expect(await (await sourceFor(acme)).getRepo("globex", "secret")).toBeNull();
    expect(await (await sourceFor(globex)).getRepo("globex", "secret")).toMatchObject({
      reviewCount: 1,
    });
  });

  it("lists reviews newest first with severity counts, tokens and cost", async () => {
    await ingest(acme, record());
    await ingest(acme, record({ headSha: "b".repeat(40), prNumber: 8, findings: [] }));
    await ingest(globex, record({ owner: "globex", repo: "secret" }));

    const reviews = await (await sourceFor(acme)).listReviews();

    expect(reviews.map((review) => review.prNumber)).toEqual([8, 7]);
    const [, first] = reviews;
    expect(first).toMatchObject({
      agents: ["security", "performance"],
      findingCount: 2,
      bySeverity: { high: 1, medium: 0, low: 1 },
      durationMs: 12_000,
      inputTokens: 2_000,
      outputTokens: 800,
      repo: { owner: "acme", name: "widgets" },
    });
    expect(first!.costUsd).toBeCloseTo(costOf(run("x", 0)) * 2, 10);
    expect(await (await sourceFor(acme)).listReviews({ limit: 1 })).toHaveLength(1);
  });

  it("returns a review with its findings and runs, and not another organization's", async () => {
    const mine = await ingest(acme, record());
    const theirs = await ingest(globex, record({ owner: "globex", repo: "secret" }));
    const source = await sourceFor(acme);

    const review = await source.getReview(mine);
    expect(review?.findings.map((f) => f.severity)).toEqual(["high", "low"]);
    expect(review?.findings[0]).toMatchObject({ agent: "security" });
    expect(review?.runs.map((r) => r.agent).sort()).toEqual(["performance", "security"]);
    expect(await source.getReview(theirs)).toBeNull();
  });

  it("drops agents the dashboard cannot render but still counts their spend", async () => {
    const id = await ingest(
      acme,
      record({ agents: ["general"], agentRuns: [run("general", 0)], findings: [] }),
    );

    const review = await (await sourceFor(acme)).getReview(id);

    expect(review?.agents).toEqual([]);
    expect(review?.runs).toEqual([]);
    expect(review?.outputTokens).toBe(400);
  });

  it("aggregates trends and usage over the organization's recent reviews", async () => {
    await ingest(acme, record());
    await ingest(globex, record({ owner: "globex", repo: "secret" }));
    const source = await sourceFor(acme);

    const trends = await source.getTrends("30d");
    expect(trends.totals).toMatchObject({
      reviews: 1,
      findings: 2,
      bySeverity: { high: 1, medium: 0, low: 1 },
      medianDurationMs: 12_000,
    });
    expect(trends.points).toHaveLength(30);
    expect(trends.points.at(-1)?.reviews).toBe(1);
    expect(trends.byAgent.map((a) => a.agent).sort()).toEqual(["performance", "security"]);

    const usage = await source.getUsage("30d");
    expect(usage.totals.reviewCount).toBe(1);
    expect(usage.totals.costUsd).toBeCloseTo(costOf(run("x", 0)) * 2, 10);
    expect(usage.byRepo.map((row) => row.repo.name)).toEqual(["widgets"]);
  });

  it("hides a removed repo and its reviews from lists, totals and direct lookups", async () => {
    await ingest(acme, record());
    const hidden = await ingest(acme, record({ repo: "gadgets" }));
    await database
      .update(repos)
      .set({ removedAt: new Date() })
      .where(eq(repos.name, "gadgets"));
    const source = await sourceFor(acme);

    expect((await source.listRepos()).map((repo) => repo.name)).toEqual(["widgets"]);
    expect(await source.getRepo("acme", "gadgets")).toBeNull();
    expect((await source.listReviews()).map((review) => review.repo.name)).toEqual([
      "widgets",
    ]);
    expect(await source.getReview(hidden)).toBeNull();
    expect((await source.getTrends("30d")).totals.reviews).toBe(1);
    const usage = await source.getUsage("30d");
    expect(usage.totals.reviewCount).toBe(1);
    expect(usage.byRepo.map((row) => row.repo.name)).toEqual(["widgets"]);
  });

  it("returns the review's graph snapshot and changed files, decompressed", async () => {
    const snapshot = snapshotRepositoryIndex(
      buildRepositoryIndex({
        sha: "b".repeat(40),
        files: new Map([
          ["src/session.ts", "export const session = 1;\n"],
          ["src/login.ts", "import { session } from './session';\n"],
        ]),
      }),
    );
    const changedFiles: ReviewRecordChangedFile[] = [
      { path: "src/login.ts", status: "modified", additions: 4, deletions: 1 },
    ];
    const id = await ingest(
      acme,
      record({
        baseSha: snapshot.sha,
        changedFiles,
        graph: {
          gzip: Buffer.from(encodeRepositoryGraph(snapshot)).toString("base64"),
          fileCount: snapshot.files.length,
          edgeCount: snapshot.edges.length,
        },
      }),
    );
    const source = await sourceFor(acme);

    expect(await source.getRepositoryGraph(id)).toEqual(snapshot);
    expect(await source.getChangedFiles(id)).toEqual(changedFiles);
  });

  it("has no graph for a review whose index was off, or one it may not read", async () => {
    const mine = await ingest(acme, record());
    const theirs = await ingest(globex, record({ owner: "globex", repo: "secret" }));
    const source = await sourceFor(acme);

    expect(await source.getRepositoryGraph(mine)).toBeUndefined();
    expect(await source.getChangedFiles(mine)).toEqual([]);
    expect(await source.getRepositoryGraph(theirs)).toBeUndefined();
    expect(await source.getChangedFiles(theirs)).toEqual([]);
    expect(await source.getRepositoryGraph(999_999)).toBeUndefined();
  });

  it("is empty for an organization with nothing recorded", async () => {
    const source = await sourceFor(acme);
    expect(await source.listRepos()).toEqual([]);
    expect(await source.listReviews()).toEqual([]);
    expect((await source.getTrends("7d")).totals.reviews).toBe(0);
  });
});

describe("createDbSource for the repos authorize lets a viewer read", () => {
  const mona = { githubId: 1 };
  const octo = { githubId: 2 };
  let hidden: number;

  async function viewerSource(session: { githubId: number }) {
    const access = await authorize(database, session, "acme");
    if (access.status !== "allowed") throw new Error("not allowed");
    return createDbSource(
      database,
      access.organization,
      access.readableRepos.map((repo) => repo.id),
    );
  }

  beforeEach(async () => {
    await ingest(acme, record());
    hidden = await ingest(acme, record({ repo: "vault", prNumber: 9 }));
    await ingest(acme, record({ repo: "ledger", prNumber: 10 }));
    await database
      .update(repos)
      .set({ private: true })
      .where(inArray(repos.name, ["vault", "ledger"]));
    const [ledger] = await database.select().from(repos).where(eq(repos.name, "ledger"));
    const [monaRow, octoRow] = await database
      .insert(users)
      .values([
        { githubId: mona.githubId, login: "mona" },
        { githubId: octo.githubId, login: "octo" },
      ])
      .returning();
    await database.insert(memberships).values([
      { userId: monaRow!.id, organizationId: acme.id, role: "member" },
      { userId: octoRow!.id, organizationId: acme.id, role: "owner" },
    ]);
    await database
      .insert(repoAccess)
      .values({ userId: monaRow!.id, repoId: ledger!.id, permission: "read" });
  });

  it("leaves an unreadable private repo out of a member's lists, totals, trends and usage", async () => {
    const source = await viewerSource(mona);

    expect((await source.listRepos()).map((repo) => repo.name).sort()).toEqual([
      "ledger",
      "widgets",
    ]);
    expect((await source.listReviews()).map((review) => review.repo.name).sort()).toEqual([
      "ledger",
      "widgets",
    ]);
    expect((await source.getTrends("30d")).totals.reviews).toBe(2);
    const usage = await source.getUsage("30d");
    expect(usage.totals.reviewCount).toBe(2);
    expect(usage.byRepo.map((row) => row.repo.name).sort()).toEqual(["ledger", "widgets"]);
  });

  it("answers an unreadable repo and its review exactly as unknown ones", async () => {
    const source = await viewerSource(mona);
    const [vault] = await database.select().from(repos).where(eq(repos.name, "vault"));

    expect(await source.getRepo("acme", "vault")).toStrictEqual(
      await source.getRepo("acme", "no-such-repo"),
    );
    expect(await source.getReview(hidden)).toStrictEqual(await source.getReview(999_999));
    expect(await source.listReviews({ repoId: vault!.id })).toEqual([]);
    expect((await source.getTrends("30d", vault!.id)).totals.reviews).toBe(0);
  });

  it("shows an organization owner every repo", async () => {
    const source = await viewerSource(octo);

    expect((await source.listRepos()).map((repo) => repo.name).sort()).toEqual([
      "ledger",
      "vault",
      "widgets",
    ]);
    expect(await source.getReview(hidden)).not.toBeNull();
    expect((await source.getTrends("30d")).totals.reviews).toBe(3);
  });

  it("shows nothing when nothing is readable", async () => {
    const source = createDbSource(database, acme, []);

    expect(await source.listRepos()).toEqual([]);
    expect(await source.listReviews()).toEqual([]);
    expect((await source.getUsage("30d")).totals.reviewCount).toBe(0);
  });
});

// Counts round trips by intercepting the one call every read goes through.
function countingDatabase(target: Database) {
  let selects = 0;
  const counted = new Proxy(target, {
    get(source, property, receiver) {
      if (property !== "select") return Reflect.get(source, property, receiver);
      return (...args: never[]) => {
        selects += 1;
        return (source.select as (...a: never[]) => unknown)(...args);
      };
    },
  });
  return { database: counted as Database, selects: () => selects };
}

async function repoIdsOf(organization: Organization): Promise<number[]> {
  const rows = await database
    .select({ id: repos.id })
    .from(repos)
    .where(eq(repos.organizationId, organization.id));
  return rows.map((row) => row.id);
}

describe("createDbSource deduplicates reads within one instance", () => {
  beforeEach(async () => {
    await ingest(acme, record());
    await ingest(acme, record({ headSha: "b".repeat(40), prNumber: 8 }));
  });

  it("fetches one window's reviews once for trends and usage together", async () => {
    const ids = await repoIdsOf(acme);

    const separate = countingDatabase(database);
    const apartTrends = await createDbSource(separate.database, acme, ids).getTrends("30d");
    const apartUsage = await createDbSource(separate.database, acme, ids).getUsage("30d");

    const shared = countingDatabase(database);
    const source = createDbSource(shared.database, acme, ids);
    const [trends, usage] = await Promise.all([
      source.getTrends("30d"),
      source.getUsage("30d"),
    ]);

    expect(separate.selects()).toBe(8);
    expect(shared.selects()).toBe(5);
    expect(trends).toEqual(apartTrends);
    expect(usage).toEqual(apartUsage);
  });

  it("shares one in-flight fetch between concurrent callers of the same filter", async () => {
    const counted = countingDatabase(database);
    const source = createDbSource(counted.database, acme, await repoIdsOf(acme));

    const [first, second] = await Promise.all([
      source.listReviews(),
      source.listReviews(),
    ]);

    expect(counted.selects()).toBe(3);
    expect(first).toEqual(second);
  });

  it("re-reads nothing on a repeated usage call", async () => {
    const counted = countingDatabase(database);
    const source = createDbSource(counted.database, acme, await repoIdsOf(acme));

    const first = await source.getUsage("30d");
    const after = counted.selects();

    expect(await source.getUsage("30d")).toEqual(first);
    expect(counted.selects()).toBe(after);
  });

  it("adds only the category rollup for trends after a usage read", async () => {
    const counted = countingDatabase(database);
    const source = createDbSource(counted.database, acme, await repoIdsOf(acme));

    await source.getUsage("30d");
    const afterUsage = counted.selects();
    const trends = await source.getTrends("30d");

    expect(counted.selects()).toBe(afterUsage + 1);
    expect(trends.totals.findings).toBe(4);
  });
});

describe("createDbSource rolls trends up in Postgres", () => {
  async function backdate(reviewId: number, days: number): Promise<void> {
    await database
      .update(reviews)
      .set({ createdAt: new Date(Date.now() - days * 864e5) })
      .where(eq(reviews.id, reviewId));
  }

  function finding(
    agent: string,
    category: string,
    severity: "low" | "medium" | "high",
    file: string,
  ) {
    return {
      agent,
      file,
      category,
      severity,
      title: `${category} in ${file}`,
      explanation: "Fixture.",
      confidence: 0.5,
    };
  }

  // The reviews as the JS rollup sees them: newest first, findings loaded.
  async function loadedReviews(source: Awaited<ReturnType<typeof sourceFor>>) {
    const summaries = await source.listReviews();
    const loaded = await Promise.all(summaries.map((s) => source.getReview(s.id)));
    return loaded.flatMap((v) => (v === null ? [] : [v]));
  }

  beforeEach(async () => {
    const today = await ingest(acme, record());
    const yesterday = await ingest(
      acme,
      record({
        headSha: "b".repeat(40),
        prNumber: 8,
        agents: ["correctness", "security"],
        agentRuns: [run("correctness", 2, 8_000), run("security", 1, 4_000)],
        findings: [
          finding("correctness", "correctness", "medium", "src/a.ts"),
          finding("correctness", "correctness", "low", "src/b.ts"),
          finding("security", "security", "high", "src/c.ts"),
        ],
      }),
    );
    const empty = await ingest(
      acme,
      record({
        headSha: "c".repeat(40),
        prNumber: 9,
        agents: ["security"],
        agentRuns: [run("security", 0)],
        findings: [],
      }),
    );
    const older = await ingest(
      acme,
      record({
        headSha: "d".repeat(40),
        prNumber: 10,
        agents: ["docs-drift"],
        agentRuns: [run("docs-drift", 1, 20_000)],
        findings: [finding("docs-drift", "docs", "low", "docs/readme.md")],
      }),
    );
    await ingest(globex, record({ owner: "globex", repo: "secret" }));

    await backdate(today, 0);
    await backdate(yesterday, 1);
    await backdate(empty, 1);
    await backdate(older, 3);
  });

  it("matches the JS rollup over reviews spanning days, agents and severities", async () => {
    const source = await sourceFor(acme);
    const scoped = await loadedReviews(source);

    expect(scoped).toHaveLength(4);
    expect(await source.getTrends("30d")).toEqual(
      computeTrends(scoped, "30d", categoryCounts(scoped)),
    );
  });

  it("counts categories in Postgres, breaking ties as the JS rollup does", async () => {
    const source = await sourceFor(acme);
    const scoped = await loadedReviews(source);
    const { byCategory } = await source.getTrends("30d");

    expect(byCategory).toEqual(categoryCounts(scoped));
    expect(byCategory.map((c) => [c.category, c.count])).toEqual([
      ["security", 2],
      ["correctness", 2],
      ["performance", 1],
      ["docs", 1],
    ]);
    expect(byCategory[0]!.bySeverity).toEqual({ low: 0, medium: 0, high: 2 });
    expect(byCategory[1]!.bySeverity).toEqual({ low: 1, medium: 1, high: 0 });
  });

  it("keeps a bucket for a day with no reviews and a review with no findings", async () => {
    const { points, totals } = await (await sourceFor(acme)).getTrends("30d");

    expect(points).toHaveLength(30);
    const [older, quiet, yesterday, today] = points.slice(-4);
    expect(older).toMatchObject({ reviews: 1, low: 1, medium: 0, high: 0 });
    expect(quiet).toMatchObject({ reviews: 0, low: 0, medium: 0, high: 0 });
    expect(yesterday).toMatchObject({ reviews: 2, low: 1, medium: 1, high: 1 });
    expect(today).toMatchObject({ reviews: 1, low: 1, medium: 0, high: 1 });
    expect(totals).toMatchObject({
      reviews: 4,
      findings: 6,
      bySeverity: { low: 3, medium: 1, high: 2 },
    });
  });

  it("never lets another organization's findings into the rollup", async () => {
    const { byCategory, totals } = await (await sourceFor(globex)).getTrends("30d");

    expect(totals.reviews).toBe(1);
    expect(byCategory.map((c) => c.category)).toEqual(["security", "performance"]);
  });
});
