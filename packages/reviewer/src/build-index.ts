/**
 * Builds one review's repository index. Never throws: the index can only
 * improve a review, never fail one.
 */
import type { PullRequestReadClient } from "@pr-review/github";
import {
  buildRepositoryIndex,
  findCodeowners,
  type RepositoryIndex,
} from "@pr-review/index";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { reviewCorrelation, type ReviewTarget } from "#src/review-target";

export interface ReviewIndexRequest {
  client: PullRequestReadClient;
  target: ReviewTarget;
  /** Always the pull request's base: a branch must not shape its own index. */
  baseSha: string;
  /** False skips the archive request entirely. */
  enabled: boolean;
  logger: StructuredLogger;
}

/** What one review reads out of the base archive. */
export interface ReviewIndex {
  /** undefined whenever the index is off or could not be built. */
  index: RepositoryIndex | undefined;
  /** The CODEOWNERS file GitHub reads, kept even when the index build fails. */
  codeowners: string | undefined;
}

export async function buildReviewIndex({
  client,
  target,
  baseSha,
  enabled,
  logger,
}: ReviewIndexRequest): Promise<ReviewIndex> {
  const fields = reviewCorrelation(target);
  if (!enabled) {
    logger.info("index.skipped", { ...fields, reason: "the index input is off" });
    return { index: undefined, codeowners: undefined };
  }

  const startedAt = Date.now();
  let codeowners: string | undefined;
  try {
    const archive = await client.getRepositoryArchive({
      owner: target.owner,
      repo: target.repo,
      ref: baseSha,
    });
    codeowners = findCodeowners(archive.files);
    const index = buildRepositoryIndex({
      sha: archive.sha,
      files: archive.files,
      truncated: archive.truncated,
      oversized: archive.oversized,
    });
    logger.info("index.built", {
      ...fields,
      sha: index.sha,
      files: index.files.size,
      truncated: index.truncated,
      durationMs: Date.now() - startedAt,
    });
    return { index, codeowners };
  } catch (error) {
    logger.error("index.failed", {
      ...fields,
      reason: errorMessage(error),
      durationMs: Date.now() - startedAt,
      fallback: "reviewing without the repository index",
    });
    return { index: undefined, codeowners };
  }
}
