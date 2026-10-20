import {
  claimReviewJob,
  enqueueReviewJob,
  organizations,
  repos,
  reviewJobs,
  saveRepoSettings,
  type Database,
} from "@pr-review/db";
import { createTestDatabase } from "@pr-review/db/test-database";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { supersedeForLiveHead } from "#src/head-repair";

const OLD = "1".repeat(40);
const LIVE = "2".repeat(40);

let database: Database;
let repoId: number;

const withWriteDatabase = <T,>(run: (database: Database) => Promise<T>): Promise<T> => run(database);

beforeEach(async () => {
  database = await createTestDatabase();
  const [organization] = await database
    .insert(organizations)
    .values({ githubAccountId: 1, accountType: "organization", slug: "acme", name: "Acme", installationId: 7 })
    .returning();
  const [repo] = await database
    .insert(repos)
    .values({ organizationId: organization!.id, githubRepoId: 9, owner: "acme", name: "widgets" })
    .returning();
  repoId = repo!.id;
});

afterEach(async () => {
  await (database as unknown as { $client: { close(): Promise<void> } }).$client.close();
});

async function claimOld() {
  await enqueueReviewJob(database, { repoId, prNumber: 3, headSha: OLD, deliveryId: "d-1" });
  const job = await claimReviewJob(database, { leaseMs: 60_000 });
  if (!job) throw new Error("nothing to claim");
  return job;
}

async function rows() {
  return database.select().from(reviewJobs);
}

describe("supersedeForLiveHead", () => {
  it("enqueues the live head and supersedes the job in one write", async () => {
    const job = await claimOld();

    expect(await supersedeForLiveHead(withWriteDatabase, job, { headSha: LIVE, labels: [] })).toEqual({
      requeued: true,
    });

    const all = await rows();
    expect(all.find((row) => row.headSha === OLD)?.status).toBe("superseded");
    expect(all.find((row) => row.headSha === LIVE)?.status).toBe("queued");
  });

  it("still enqueues the live head for a worker whose lease was reclaimed", async () => {
    const job = await claimOld();
    const stale = { ...job, attempts: job.attempts - 1 };

    expect(await supersedeForLiveHead(withWriteDatabase, stale, { headSha: LIVE, labels: [] })).toEqual({
      requeued: true,
    });

    const all = await rows();
    expect(all.find((row) => row.headSha === OLD)?.status).toBe("superseded");
    expect(all.find((row) => row.headSha === LIVE)?.status).toBe("queued");
  });

  it("supersedes without enqueueing when settings would not review the pull request", async () => {
    await saveRepoSettings(database, repoId, { mode: "off", model: null, fixes: false });
    const job = await claimOld();

    expect(await supersedeForLiveHead(withWriteDatabase, job, { headSha: LIVE, labels: [] })).toEqual({
      requeued: false,
    });

    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]?.status).toBe("superseded");
  });
});
