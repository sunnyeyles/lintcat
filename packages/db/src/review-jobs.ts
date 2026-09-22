/** The hosted review queue: the webhook enqueues, a worker claims, runs and settles. */
import { and, asc, eq, inArray, lt, lte, ne, or, sql } from "drizzle-orm";
import type { PgUpdateSetSource } from "drizzle-orm/pg-core";

import type { Database } from "./client";
import { reviewJobs, type ReviewJob } from "./schema";

export interface ReviewJobRequest {
  repoId: number;
  prNumber: number;
  headSha: string;
  /** X-GitHub-Delivery; null when the caller has none. */
  deliveryId: string | null;
}

export type EnqueueResult =
  | { status: "queued"; job: ReviewJob; superseded: number }
  | { status: "duplicate" };

const ACTIVE = ["queued", "running"] as const;

/** Needs `.transaction()`. A newer head supersedes the pull request's other active jobs. */
export async function enqueueReviewJob(
  database: Database,
  request: ReviewJobRequest,
): Promise<EnqueueResult> {
  return database.transaction(async (tx) => {
    // Both the delivery id and the active-head index make a repeat a no-op.
    const [job] = await tx.insert(reviewJobs).values(request).onConflictDoNothing().returning();
    if (!job) return { status: "duplicate" as const };
    const superseded = await tx
      .update(reviewJobs)
      .set({ status: "superseded", finishedAt: sql`now()`, leaseExpiresAt: null })
      .where(
        and(
          eq(reviewJobs.repoId, request.repoId),
          eq(reviewJobs.prNumber, request.prNumber),
          ne(reviewJobs.headSha, request.headSha),
          inArray(reviewJobs.status, [...ACTIVE]),
        ),
      )
      .returning({ id: reviewJobs.id });
    return { status: "queued" as const, job, superseded: superseded.length };
  });
}

/** The next job due: queued and past its retry delay, or running on a lapsed lease. */
export function claimableJob(database: Database) {
  return database
    .select({ id: reviewJobs.id })
    .from(reviewJobs)
    .where(
      or(
        and(eq(reviewJobs.status, "queued"), lte(reviewJobs.runAfter, sql`now()`)),
        and(eq(reviewJobs.status, "running"), lt(reviewJobs.leaseExpiresAt, sql`now()`)),
      ),
    )
    .orderBy(asc(reviewJobs.runAfter), asc(reviewJobs.id))
    .limit(1)
    .for("update", { skipLocked: true });
}

const lease = (leaseMs: number) => sql`now() + ${`${leaseMs} milliseconds`}::interval`;

/** One statement, so it needs no transaction and two workers never share a job. */
export async function claimReviewJob(
  database: Database,
  { leaseMs }: { leaseMs: number },
): Promise<ReviewJob | undefined> {
  const [job] = await database
    .update(reviewJobs)
    .set({
      status: "running",
      attempts: sql`${reviewJobs.attempts} + 1`,
      leaseExpiresAt: lease(leaseMs),
    })
    .where(inArray(reviewJobs.id, claimableJob(database)))
    .returning();
  return job;
}

const running = (jobId: number) =>
  and(eq(reviewJobs.id, jobId), eq(reviewJobs.status, "running"));

/** False once the job is no longer running, such as when a newer push superseded it. */
export async function renewReviewJobLease(
  database: Database,
  jobId: number,
  leaseMs: number,
): Promise<boolean> {
  const rows = await database
    .update(reviewJobs)
    .set({ leaseExpiresAt: lease(leaseMs) })
    .where(running(jobId))
    .returning({ id: reviewJobs.id });
  return rows.length > 0;
}

async function settle(
  database: Database,
  jobId: number,
  set: PgUpdateSetSource<typeof reviewJobs>,
): Promise<boolean> {
  const rows = await database
    .update(reviewJobs)
    .set({ leaseExpiresAt: null, ...set })
    .where(running(jobId))
    .returning({ id: reviewJobs.id });
  return rows.length > 0;
}

export function completeReviewJob(database: Database, jobId: number): Promise<boolean> {
  return settle(database, jobId, { status: "succeeded", finishedAt: sql`now()` });
}

export function supersedeReviewJob(database: Database, jobId: number): Promise<boolean> {
  return settle(database, jobId, { status: "superseded", finishedAt: sql`now()` });
}

export interface RetryPolicy {
  maxAttempts: number;
  retryDelayMs: number;
}

/** Requeues until `maxAttempts` claims have failed; `error` must already be free of secrets. */
export async function failReviewJob(
  database: Database,
  jobId: number,
  error: string,
  { maxAttempts, retryDelayMs }: RetryPolicy,
): Promise<"retrying" | "failed" | "superseded"> {
  const [row] = await database
    .update(reviewJobs)
    .set({
      leaseExpiresAt: null,
      lastError: error,
      status: sql`case when ${reviewJobs.attempts} >= ${maxAttempts} then 'failed' else 'queued' end::review_job_status`,
      finishedAt: sql`case when ${reviewJobs.attempts} >= ${maxAttempts} then now() end`,
      runAfter: sql`now() + ${`${retryDelayMs} milliseconds`}::interval`,
    })
    .where(running(jobId))
    .returning({ status: reviewJobs.status });
  if (!row) return "superseded";
  return row.status === "failed" ? "failed" : "retrying";
}
