import { setTimeout as sleep } from "node:timers/promises";

import { claimReviewJob, type Database, type ReviewJob } from "@pr-review/db";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import type { JobOutcome } from "#src/run-job";

export interface WorkerDeps {
  database: Database;
  logger: StructuredLogger;
  leaseMs: number;
  runJob: (job: ReviewJob) => Promise<JobOutcome>;
}

export interface WorkerOptions {
  /** Stop as soon as the queue is empty, rather than polling. */
  once: boolean;
  pollMs: number;
  /** Aborting stops the loop between jobs; a job in flight finishes first. */
  signal?: AbortSignal | undefined;
}

/** Claims and runs jobs one at a time; returns how many it ran. */
export async function runWorker(
  { database, logger, leaseMs, runJob }: WorkerDeps,
  { once, pollMs, signal }: WorkerOptions,
): Promise<number> {
  let processed = 0;
  while (!signal?.aborted) {
    const job = await claimReviewJob(database, { leaseMs });
    if (!job) {
      if (once) break;
      await sleep(pollMs, undefined, { signal }).catch(() => undefined);
      continue;
    }
    processed += 1;
    try {
      const outcome = await runJob(job);
      logger.info("worker.job_finished", { jobId: job.id, outcome });
    } catch (error: unknown) {
      // The lease lapses and another claim retries it.
      logger.error("worker.job_crashed", { jobId: job.id, error: errorMessage(error) });
    }
  }
  return processed;
}
