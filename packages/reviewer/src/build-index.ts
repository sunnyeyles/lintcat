/**
 * Layer A of the repository index, built live at review start. The index can
 * make a review better; it must never make one fail.
 */
import type { GithubInstallationClient } from "@pr-review/github";
import {
  buildLayerA,
  createGithubFileSource,
  createInMemoryIndex,
  type RepositoryIndex,
} from "@pr-review/index";
import { errorMessage, type StructuredLogger } from "@pr-review/logging";

import { reviewCorrelation, type ReviewTarget } from "./review-target.js";

/** The commit the index covers: the base, never the head the pull request controls. */
export interface IndexTarget extends ReviewTarget {
  baseSha: string;
}

/** One tree listing plus a handful of manifest reads; undefined is absent mode. */
export async function buildRepositoryIndex(
  client: Pick<GithubInstallationClient, "listTree" | "getFileContents">,
  target: IndexTarget,
  logger: StructuredLogger,
): Promise<RepositoryIndex | undefined> {
  const startedAt = Date.now();
  try {
    // A truncated tree is coverage, not failure: the index says so and serves the rest.
    const layerA = await buildLayerA(
      createGithubFileSource(
        client,
        { owner: target.owner, repo: target.repo },
        target.baseSha,
      ),
    );
    logger.info("index.built", {
      ...reviewCorrelation(target),
      sha: layerA.sha,
      files: layerA.coverage.files,
      packages: layerA.packages.length,
      truncated: layerA.coverage.truncated,
      durationMs: Date.now() - startedAt,
    });
    return createInMemoryIndex(layerA);
  } catch (error) {
    logger.error("index.failed", {
      ...reviewCorrelation(target),
      sha: target.baseSha,
      reason: errorMessage(error),
      durationMs: Date.now() - startedAt,
      fallback: "reviewing without the repository index",
    });
    return undefined;
  }
}
