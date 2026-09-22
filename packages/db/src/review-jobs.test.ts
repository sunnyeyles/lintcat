import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  claimableJob,
  claimReviewJob,
  completeReviewJob,
  enqueueReviewJob,
  failReviewJob,
  renewReviewJobLease,
  supersedeReviewJob,
  type ReviewJobRequest,
} from "./review-jobs";
import { organizations, repos, reviewJobs } from "./schema";
import { createTestDatabase } from "./test-database";

const LEASE = { leaseMs: 60_000 };

let database: Database;
let repoId: number;

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme" })
    .returning();
  const [repo] = await database
    .insert(repos)
    .values({ organizationId: organization!.id, owner: "acme", name: "widgets" })
    .returning();
  repoId = repo!.id;
});

function request(overrides: Partial<ReviewJobRequest> = {}): ReviewJobRequest {
  return { repoId, prNumber: 7, headSha: "aaa", deliveryId: "delivery-1", ...overrides };
}

async function statuses() {
  return database
    .select({ headSha: reviewJobs.headSha, status: reviewJobs.status })
    .from(reviewJobs)
    .orderBy(asc(reviewJobs.id));
}

describe("enqueueReviewJob", () => {
  it("queues one job per delivery", async () => {
    const queued = await enqueueReviewJob(database, request());
    expect(queued).toMatchObject({ status: "queued", job: { status: "queued", attempts: 0 } });
    expect(await enqueueReviewJob(database, request())).toEqual({ status: "duplicate" });
    expect(await statuses()).toEqual([{ headSha: "aaa", status: "queued" }]);
  });

  it("keeps one pending job per pull request head across deliveries", async () => {
    await enqueueReviewJob(database, request());
    expect(await enqueueReviewJob(database, request({ deliveryId: "delivery-2" }))).toEqual({
      status: "duplicate",
    });
  });

  it("queues the same head again once the earlier job has finished", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    await completeReviewJob(database, job!.id);
    const again = await enqueueReviewJob(database, request({ deliveryId: "delivery-2" }));
    expect(again.status).toBe("queued");
  });

  it("supersedes queued and running jobs for an older head of the same pull request", async () => {
    await enqueueReviewJob(database, request({ headSha: "aaa", deliveryId: "d1" }));
    await claimReviewJob(database, LEASE);
    await enqueueReviewJob(database, request({ headSha: "bbb", deliveryId: "d2" }));
    await enqueueReviewJob(database, request({ prNumber: 8, headSha: "zzz", deliveryId: "d3" }));
    const queued = await enqueueReviewJob(database, request({ headSha: "ccc", deliveryId: "d4" }));
    expect(queued).toMatchObject({ status: "queued", superseded: 1 });
    expect(await statuses()).toEqual([
      { headSha: "aaa", status: "superseded" },
      { headSha: "bbb", status: "superseded" },
      { headSha: "zzz", status: "queued" },
      { headSha: "ccc", status: "queued" },
    ]);
  });
});

describe("claimReviewJob", () => {
  it("claims the oldest queued job, leases it and counts the attempt", async () => {
    await enqueueReviewJob(database, request({ prNumber: 1, deliveryId: "d1" }));
    await enqueueReviewJob(database, request({ prNumber: 2, deliveryId: "d2" }));
    const first = await claimReviewJob(database, LEASE);
    expect(first).toMatchObject({ prNumber: 1, status: "running", attempts: 1 });
    expect(first!.leaseExpiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(await claimReviewJob(database, LEASE)).toMatchObject({ prNumber: 2 });
    expect(await claimReviewJob(database, LEASE)).toBeUndefined();
  });

  it("skips rows another worker holds", () => {
    // PGlite is one connection, so the lock itself is only visible in the SQL.
    expect(claimableJob(database).toSQL().sql).toMatch(/for update skip locked/i);
  });

  it("reclaims a running job whose lease lapsed", async () => {
    await enqueueReviewJob(database, request());
    const first = await claimReviewJob(database, LEASE);
    expect(await claimReviewJob(database, LEASE)).toBeUndefined();
    await database
      .update(reviewJobs)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(reviewJobs.id, first!.id));
    expect(await claimReviewJob(database, LEASE)).toMatchObject({ id: first!.id, attempts: 2 });
  });

  it("leaves a job alone until its retry is due", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    await failReviewJob(database, job!.id, "boom", { maxAttempts: 3, retryDelayMs: 60_000 });
    expect(await claimReviewJob(database, LEASE)).toBeUndefined();
  });
});

describe("finishing a job", () => {
  it("renews the lease only while the job is still running", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    expect(await renewReviewJobLease(database, job!.id, LEASE.leaseMs)).toBe(true);
    await enqueueReviewJob(database, request({ headSha: "bbb", deliveryId: "d2" }));
    expect(await renewReviewJobLease(database, job!.id, LEASE.leaseMs)).toBe(false);
  });

  it("completes a running job, but not a superseded one", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    expect(await supersedeReviewJob(database, job!.id)).toBe(true);
    expect(await completeReviewJob(database, job!.id)).toBe(false);
    expect(await statuses()).toEqual([{ headSha: "aaa", status: "superseded" }]);
  });

  it("retries a failed job a bounded number of times, then fails it", async () => {
    await enqueueReviewJob(database, request());
    const retry = { maxAttempts: 2, retryDelayMs: 0 };
    let job = await claimReviewJob(database, LEASE);
    expect(await failReviewJob(database, job!.id, "first", retry)).toBe("retrying");
    job = await claimReviewJob(database, LEASE);
    expect(job).toMatchObject({ attempts: 2, lastError: "first" });
    expect(await failReviewJob(database, job!.id, "second", retry)).toBe("failed");
    expect(await claimReviewJob(database, LEASE)).toBeUndefined();
    const [row] = await database.select().from(reviewJobs);
    expect(row).toMatchObject({ status: "failed", lastError: "second" });
    expect(row!.finishedAt).not.toBeNull();
  });

  it("does not fail a job that was superseded meanwhile", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    await enqueueReviewJob(database, request({ headSha: "bbb", deliveryId: "d2" }));
    expect(
      await failReviewJob(database, job!.id, "boom", { maxAttempts: 1, retryDelayMs: 0 }),
    ).toBe("superseded");
  });
});
