/**
 * Builds one review's repository index. Never throws: the index can only
 * improve a review, never fail one.
 */
import type { GithubInstallationClient } from "@pr-review/github";
import { buildRepositoryIndex, type RepositoryIndex } from "@pr-review/index";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { reviewCorrelation, type ReviewTarget } from "#src/review-target";

export interface ReviewIndexRequest {
  client: GithubInstallationClient;
  target: ReviewTarget;
  /** Always the pull request's base: a branch must not shape its own index. */
  baseSha: string;
  /** False skips the archive request entirely. */
  enabled: boolean;
  logger: StructuredLogger;
}

/** undefined whenever the index is off or could not be built. */
export async function buildReviewIndex({
  client,
  target,
  baseSha,
  enabled,
  logger,
}: ReviewIndexRequest): Promise<RepositoryIndex | undefined> {
  const fields = reviewCorrelation(target);
  if (!enabled) {
    logger.info("index.skipped", { ...fields, reason: "the index input is off" });
    return undefined;
  }

  const startedAt = Date.now();
  try {
    const archive = await client.getRepositoryArchive({
      owner: target.owner,
      repo: target.repo,
      ref: baseSha,
    });
    const index = buildRepositoryIndex({
      sha: archive.sha,
      files: archive.files,
      truncated: archive.truncated,
    });
    logger.info("index.built", {
      ...fields,
      sha: index.sha,
      files: index.files.size,
      truncated: index.truncated,
      durationMs: Date.now() - startedAt,
    });
    return index;
  } catch (error) {
    logger.error("index.failed", {
      ...fields,
      reason: errorMessage(error),
      durationMs: Date.now() - startedAt,
      fallback: "reviewing without the repository index",
    });
    return undefined;
  }
}
