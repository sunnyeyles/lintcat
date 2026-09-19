import {
  ingestReviewRecord,
  memberships,
  organizations,
  repoAccess,
  repos,
  users,
  type Database,
  type Organization,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import type { ReviewRecord, ReviewRecordAgentRun } from "@pr-review/schemas";
import { eq, inArray } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { authorize } from "@/lib/authorize";
import { costOf } from "@/lib/data";
import { createDbSource } from "@/lib/data/db";

function run(agent: string, findingCount: number): ReviewRecordAgentRun {
  return {
    agent,
    durationMs: 10_000,
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
