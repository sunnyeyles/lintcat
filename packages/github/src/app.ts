import type {
  PullRequestReadClient,
  RepositoryHistoryClient,
  ReviewPublishClient,
} from "#src/client";
import { createInstallationHistoryClient } from "#src/installation-history";
import { createInstallationPublishClient } from "#src/installation-publish";
import { createInstallationReadClient } from "#src/installation-read";
import type { OctokitLike } from "#src/installation-shared";

export type { OctokitLike } from "#src/installation-shared";

/**
 * Wraps an authenticated Octokit in the read-only PR client, so
 * authentication is the only thing a caller has to supply.
 */
export function createInstallationClient(
  octokit: OctokitLike,
): PullRequestReadClient & RepositoryHistoryClient & ReviewPublishClient {
  return {
    ...createInstallationReadClient(octokit),
    ...createInstallationHistoryClient(octokit),
    ...createInstallationPublishClient(octokit),
  };
}
