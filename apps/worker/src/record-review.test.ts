import { organizations, reviews, type Database } from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { createCapturingLogger } from "@pr-review/logging";
import type { DashboardReview, ReviewTarget } from "@pr-review/reviewer";
import { beforeEach, describe, expect, it } from "vitest";

import { createDatabaseReviewPublisher } from "#src/record-review";

const target: ReviewTarget = {
  owner: "acme",
  repo: "widgets",
  pullRequestNumber: 7,
  headSha: "a".repeat(40),
};

const review: DashboardReview = {
  summary: "0 findings",
  durationMs: 1_000,
  inputTokens: 10,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 5,
  findings: [],
  risk: {
    score: 40,
    band: "medium",
    partial: false,
    factors: [{ label: "1 file depends on this change", points: 40 }],
    hubs: [{ path: "src/billing/plans.ts", dependents: 1 }],
    counts: { direct: 1, transitive: 1, entryPoints: 0, untested: 0, inCycle: 0, brokenImporters: 0 },
    packages: 1,
    dependents: ["src/billing/invoice.ts"],
  },
};

let database: Database;
let organizationId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  organizationId = organization!.id;
});

describe("createDatabaseReviewPublisher", () => {
  it("stores a valid review and logs its id", async () => {
    const { logger, entries } = createCapturingLogger();

    await createDatabaseReviewPublisher(database, organizationId, logger)(target, review);

    const stored = await database.select().from(reviews);
    expect(stored).toMatchObject([{ prNumber: 7, risk: review.risk }]);
    expect(entries).toMatchObject([{ event: "review_job.recorded", reviewId: stored[0]!.id }]);
  });

  it("logs an invalid review's paths without its values, stores nothing, and never throws", async () => {
    const { logger, entries } = createCapturingLogger();
    const invalid = { ...review, risk: { ...review.risk!, score: 150 } };

    await expect(
      createDatabaseReviewPublisher(database, organizationId, logger)(target, invalid),
    ).resolves.toBeUndefined();

    expect(entries).toEqual([
      {
        level: "error",
        event: "review_job.record_invalid",
        repository: "acme/widgets",
        pullRequestNumber: 7,
        headSha: target.headSha,
        issues: ["risk.score"],
      },
    ]);
    expect(await database.select().from(reviews)).toEqual([]);
  });
});
