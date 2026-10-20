/** Supersedes a job whose head moved and re-enqueues the pull request's live head. */
import {
  effectiveRepoSettings,
  enqueueReviewJob,
  headJobSucceededOrActive,
  reviewsPullRequestNow,
  supersedeReviewJob,
  type ReviewJob,
} from "@pr-review/db";

import type { WriteDatabaseRunner } from "#src/record-review";

export interface LiveHead {
  headSha: string;
  labels: readonly string[];
}

/** One transaction; the enqueue skips a head already succeeded or active, or one settings would not review now. */
export async function supersedeForLiveHead(
  withWriteDatabase: WriteDatabaseRunner,
  job: Pick<ReviewJob, "id" | "attempts" | "repoId" | "prNumber">,
  { headSha, labels }: LiveHead,
): Promise<{ requeued: boolean }> {
  let requeued = false;
  const { repoId, prNumber } = job;
  await withWriteDatabase((database) =>
    database.transaction(async (tx) => {
      // Fenced, so a no-op for a stale worker or once a newer enqueue superseded it; the enqueue runs either way.
      await supersedeReviewJob(tx, job);
      if (await headJobSucceededOrActive(tx, { repoId, prNumber, headSha })) return;
      const { mode } = await effectiveRepoSettings(tx, repoId);
      if (!reviewsPullRequestNow(mode, labels)) return;
      const result = await enqueueReviewJob(tx, { repoId, prNumber, headSha, deliveryId: null });
      requeued = result.status === "queued";
    }),
  );
  return { requeued };
}
