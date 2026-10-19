/** Re-enqueues a pull request's live head when a job finds its own head has moved. */
import {
  effectiveRepoSettings,
  enqueueReviewJob,
  headJobSucceededOrActive,
  reviewsPullRequestNow,
} from "@pr-review/db";

import type { WriteDatabaseRunner } from "#src/record-review";

export interface LiveHead {
  repoId: number;
  prNumber: number;
  headSha: string;
  labels: readonly string[];
}

/** Skips a head already succeeded or active, or one the repo's settings would not review now. */
export async function enqueueLiveHead(
  withWriteDatabase: WriteDatabaseRunner,
  { repoId, prNumber, headSha, labels }: LiveHead,
): Promise<boolean> {
  let enqueued = false;
  await withWriteDatabase(async (database) => {
    if (await headJobSucceededOrActive(database, { repoId, prNumber, headSha })) return;
    const { mode } = await effectiveRepoSettings(database, repoId);
    if (!reviewsPullRequestNow(mode, labels)) return;
    const result = await enqueueReviewJob(database, { repoId, prNumber, headSha, deliveryId: null });
    enqueued = result.status === "queued";
  });
  return enqueued;
}
