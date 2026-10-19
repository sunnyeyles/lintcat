import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Database } from "./client";
import {
  claimableJob,
  claimReviewJob,
  completeReviewJob,
  enqueueReviewJob,
  failReviewJob,
  headJobSucceededOrActive,
  renewReviewJobLease,
  supersedePullRequestJobs,
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
    await completeReviewJob(database, job!);
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
    await failReviewJob(database, job!, "boom", { maxAttempts: 3, retryDelayMs: 60_000 });
    expect(await claimReviewJob(database, LEASE)).toBeUndefined();
  });
});

describe("finishing a job", () => {
  it("renews the lease only while the job is still running", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    expect(await renewReviewJobLease(database, job!, LEASE.leaseMs)).toBe(true);
    await enqueueReviewJob(database, request({ headSha: "bbb", deliveryId: "d2" }));
    expect(await renewReviewJobLease(database, job!, LEASE.leaseMs)).toBe(false);
  });

  it("completes a running job, but not a superseded one", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    expect(await supersedeReviewJob(database, job!)).toBe(true);
    expect(await completeReviewJob(database, job!)).toBe(false);
    expect(await statuses()).toEqual([{ headSha: "aaa", status: "superseded" }]);
  });

  it("retries a failed job a bounded number of times, then fails it", async () => {
    await enqueueReviewJob(database, request());
    const retry = { maxAttempts: 2, retryDelayMs: 0 };
    let job = await claimReviewJob(database, LEASE);
    expect(await failReviewJob(database, job!, "first", retry)).toBe("retrying");
    job = await claimReviewJob(database, LEASE);
    expect(job).toMatchObject({ attempts: 2, lastError: "first" });
    expect(await failReviewJob(database, job!, "second", retry)).toBe("failed");
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
      await failReviewJob(database, job!, "boom", { maxAttempts: 1, retryDelayMs: 0 }),
    ).toBe("superseded");
  });
});

describe("fencing a worker whose lease was reclaimed", () => {
  async function reclaimed() {
    await enqueueReviewJob(database, request());
    const workerA = await claimReviewJob(database, LEASE);
    await database
      .update(reviewJobs)
      .set({ leaseExpiresAt: sql`now() - interval '1 second'` })
      .where(eq(reviewJobs.id, workerA!.id));
    const workerB = await claimReviewJob(database, LEASE);
    expect(workerB).toMatchObject({ id: workerA!.id, attempts: 2, status: "running" });
    const [row] = await database.select().from(reviewJobs);
    return { workerA: workerA!, before: row! };
  }

  async function expectUnchanged(before: typeof reviewJobs.$inferSelect) {
    const [row] = await database.select().from(reviewJobs);
    expect(row).toEqual(before);
    expect(row).toMatchObject({ status: "running", attempts: 2 });
  }

  it("AC1: a stale worker's lease renewal returns false and leaves the row unchanged", async () => {
    const { workerA, before } = await reclaimed();
    expect(await renewReviewJobLease(database, workerA, 10 * LEASE.leaseMs)).toBe(false);
    await expectUnchanged(before);
  });

  it("AC1: the reclaiming worker can still renew its own lease", async () => {
    const { before } = await reclaimed();
    expect(await renewReviewJobLease(database, before, LEASE.leaseMs)).toBe(true);
  });

  it("AC2: a stale worker cannot complete the reclaimed job", async () => {
    const { workerA, before } = await reclaimed();
    expect(await completeReviewJob(database, workerA)).toBe(false);
    await expectUnchanged(before);
  });

  it("AC2: a stale worker cannot supersede the reclaimed job", async () => {
    const { workerA, before } = await reclaimed();
    expect(await supersedeReviewJob(database, workerA)).toBe(false);
    await expectUnchanged(before);
  });

  it("AC2: a stale worker's failReviewJob returns superseded and does not requeue or fail the job", async () => {
    const { workerA, before } = await reclaimed();
    expect(
      await failReviewJob(database, workerA, "stale", { maxAttempts: 3, retryDelayMs: 0 }),
    ).toBe("superseded");
    expect(
      await failReviewJob(database, workerA, "stale", { maxAttempts: 0, retryDelayMs: 0 }),
    ).toBe("superseded");
    await expectUnchanged(before);
  });

  it("AC2: fencing matches on id and attempts, not only on attempts", async () => {
    const { before } = await reclaimed();
    expect(await completeReviewJob(database, { id: before.id + 1, attempts: 2 })).toBe(false);
    expect(await completeReviewJob(database, { id: before.id, attempts: 2 })).toBe(true);
  });
});

describe("supersedePullRequestJobs", () => {
  async function seedPullRequest() {
    const [otherRepo] = await database
      .insert(repos)
      .values({ organizationId: (await database.select().from(organizations))[0]!.id, owner: "acme", name: "gadgets" })
      .returning();
    await enqueueReviewJob(database, request({ headSha: "done", deliveryId: "d0" }));
    await completeReviewJob(database, (await claimReviewJob(database, LEASE))!);
    await enqueueReviewJob(database, request({ headSha: "run", deliveryId: "d1" }));
    const runningJob = await claimReviewJob(database, LEASE);
    expect(runningJob).toMatchObject({ headSha: "run", status: "running" });
    // A second active head for the same PR, inserted directly since enqueue would supersede it.
    await database.insert(reviewJobs).values(request({ headSha: "wait", deliveryId: "d2" }));
    await enqueueReviewJob(database, request({ prNumber: 8, headSha: "other-pr", deliveryId: "d3" }));
    await enqueueReviewJob(
      database,
      request({ repoId: otherRepo!.id, headSha: "other-repo", deliveryId: "d4" }),
    );
  }

  async function rows() {
    return database
      .select({
        headSha: reviewJobs.headSha,
        status: reviewJobs.status,
        leaseExpiresAt: reviewJobs.leaseExpiresAt,
        finishedAt: reviewJobs.finishedAt,
      })
      .from(reviewJobs)
      .orderBy(asc(reviewJobs.id));
  }

  it("AC11: supersedes the pull request's queued and running jobs and returns the count", async () => {
    await seedPullRequest();
    const before = Date.now();
    expect(await supersedePullRequestJobs(database, { repoId, prNumber: 7 })).toBe(2);
    const after = await rows();
    expect(after.map(({ headSha, status }) => ({ headSha, status }))).toEqual([
      { headSha: "done", status: "succeeded" },
      { headSha: "run", status: "superseded" },
      { headSha: "wait", status: "superseded" },
      { headSha: "other-pr", status: "queued" },
      { headSha: "other-repo", status: "queued" },
    ]);
    for (const row of after.filter((row) => row.status === "superseded")) {
      expect(row.leaseExpiresAt).toBeNull();
      expect(row.finishedAt).not.toBeNull();
      expect(row.finishedAt!.getTime()).toBeGreaterThan(before - 60_000);
    }
  });

  it("AC11: a superseded running job can no longer renew its lease or complete", async () => {
    await enqueueReviewJob(database, request());
    const job = await claimReviewJob(database, LEASE);
    expect(await supersedePullRequestJobs(database, { repoId, prNumber: 7 })).toBe(1);
    expect(await renewReviewJobLease(database, job!, LEASE.leaseMs)).toBe(false);
    expect(await completeReviewJob(database, job!)).toBe(false);
    expect(await statuses()).toEqual([{ headSha: "aaa", status: "superseded" }]);
  });

  it("AC11: returns 0 and changes nothing when the pull request has no active job", async () => {
    await enqueueReviewJob(database, request());
    await completeReviewJob(database, (await claimReviewJob(database, LEASE))!);
    expect(await supersedePullRequestJobs(database, { repoId, prNumber: 7 })).toBe(0);
    expect(await supersedePullRequestJobs(database, { repoId, prNumber: 99 })).toBe(0);
    expect(await statuses()).toEqual([{ headSha: "aaa", status: "succeeded" }]);
  });
});

describe("headJobSucceededOrActive", () => {
  const head = (headSha: string, prNumber = 7) => ({ repoId, prNumber, headSha });

  it("AC8: is false when no job exists for the head", async () => {
    expect(await headJobSucceededOrActive(database, head("aaa"))).toBe(false);
  });

  it("AC8: is true while a job for the head is queued", async () => {
    await enqueueReviewJob(database, request());
    expect(await headJobSucceededOrActive(database, head("aaa"))).toBe(true);
  });

  it("AC8: is true while a job for the head is running", async () => {
    await enqueueReviewJob(database, request());
    await claimReviewJob(database, LEASE);
    expect(await headJobSucceededOrActive(database, head("aaa"))).toBe(true);
  });

  it("AC8: is true once a job for the head has succeeded", async () => {
    await enqueueReviewJob(database, request());
    await completeReviewJob(database, (await claimReviewJob(database, LEASE))!);
    expect(await headJobSucceededOrActive(database, head("aaa"))).toBe(true);
  });

  it("AC8: is false when the head's only jobs were superseded or failed", async () => {
    await enqueueReviewJob(database, request({ deliveryId: "d1" }));
    await supersedeReviewJob(database, (await claimReviewJob(database, LEASE))!);
    await enqueueReviewJob(database, request({ deliveryId: "d2" }));
    await failReviewJob(database, (await claimReviewJob(database, LEASE))!, "boom", {
      maxAttempts: 0,
      retryDelayMs: 0,
    });
    expect(await statuses()).toEqual([
      { headSha: "aaa", status: "superseded" },
      { headSha: "aaa", status: "failed" },
    ]);
    expect(await headJobSucceededOrActive(database, head("aaa"))).toBe(false);
  });

  it("AC8: only counts jobs for the same repo, pull request and head", async () => {
    const [otherRepo] = await database
      .insert(repos)
      .values({ organizationId: (await database.select().from(organizations))[0]!.id, owner: "acme", name: "gadgets" })
      .returning();
    await enqueueReviewJob(database, request({ headSha: "aaa", deliveryId: "d1" }));
    await enqueueReviewJob(database, request({ prNumber: 8, headSha: "bbb", deliveryId: "d2" }));
    await enqueueReviewJob(database, request({ repoId: otherRepo!.id, headSha: "ccc", deliveryId: "d3" }));
    expect(await headJobSucceededOrActive(database, head("bbb"))).toBe(false);
    expect(await headJobSucceededOrActive(database, head("ccc"))).toBe(false);
    expect(await headJobSucceededOrActive(database, head("aaa", 8))).toBe(false);
    expect(await headJobSucceededOrActive(database, head("bbb", 8))).toBe(true);
  });
});
