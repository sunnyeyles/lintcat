import {
  enqueueReviewJob,
  organizations,
  repos,
  type Database,
  type ReviewJob,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { createCapturingLogger } from "@pr-review/logging";
import { beforeEach, describe, expect, it } from "vitest";

import { runWorker } from "#src/worker";

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

describe("runWorker", () => {
  it("drains the queue one job at a time, then stops when asked to run once", async () => {
    for (const prNumber of [1, 2]) {
      await enqueueReviewJob(database, { repoId, prNumber, headSha: "a", deliveryId: `d${prNumber}` });
    }
    const seen: number[] = [];
    const processed = await runWorker(
      {
        database,
        logger: createCapturingLogger().logger,
        leaseMs: 60_000,
        runJob: async (job: ReviewJob) => {
          seen.push(job.prNumber);
          return "succeeded";
        },
      },
      { once: true, pollMs: 1 },
    );
    expect(processed).toBe(2);
    expect(seen).toEqual([1, 2]);
  });

  it("polls an empty queue until stopped", async () => {
    const stop = new AbortController();
    const running = runWorker(
      {
        database,
        logger: createCapturingLogger().logger,
        leaseMs: 60_000,
        runJob: async () => "succeeded",
      },
      { once: false, pollMs: 5, signal: stop.signal },
    );
    setTimeout(() => stop.abort(), 20);
    await expect(running).resolves.toBe(0);
  });

  it("keeps going after a job throws", async () => {
    await enqueueReviewJob(database, { repoId, prNumber: 1, headSha: "a", deliveryId: "d1" });
    await enqueueReviewJob(database, { repoId, prNumber: 2, headSha: "a", deliveryId: "d2" });
    const { logger, entries } = createCapturingLogger();
    const processed = await runWorker(
      {
        database,
        logger,
        leaseMs: 60_000,
        runJob: async (job) => {
          if (job.prNumber === 1) throw new Error("database blip");
          return "succeeded";
        },
      },
      { once: true, pollMs: 1 },
    );
    expect(processed).toBe(2);
    expect(entries).toContainEqual(expect.objectContaining({ event: "worker.job_crashed" }));
  });
});
